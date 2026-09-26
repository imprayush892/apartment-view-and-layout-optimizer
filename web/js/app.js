/* Viewtower Studio UI: data sources, georeferencing, envelope, parallel search with live 3D, view cones. */
(function () {
"use strict";
const { D2R, R2D, FT2, mod, ringArea, ccw, box, rot, tr, centroid, bounds, pip, mean, polysIntersect } = VT;
const $ = id => document.getElementById(id);
const fmt = (v, d = 2) => Number.isFinite(v) ? v.toFixed(d) : "–";
const fmtInt = v => Number.isFinite(v) ? Math.round(v).toLocaleString("en-IN") : "–";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const listNums = s => String(s).split(/[,\s]+/).map(Number).filter(Number.isFinite);
const PC = window.polygonClipping;
const SCENE_HALF = 3000, RES = 4;

const TYPOS = [
  { key: "square", label: "Square", on: true, f: { width: "26, 30" } },
  { key: "rectangular", label: "Rectangular", on: true, f: { width: "34", depth: "24" } },
  { key: "chamfered", label: "Chamfered", on: true, f: { width: "30", depth: "26", chamfer_m: "4" } },
  { key: "diamond", label: "Diamond", on: false, f: { width: "36" } },
  { key: "curved", label: "Curved (superellipse)", on: true, f: { width: "34", depth: "28", exponent: "2.5" } },
  { key: "triangular", label: "Triangular", on: false, f: { width: "40", depth: "36", chamfer_m: "4" } },
  { key: "y_shaped", label: "Y-shaped", on: true, f: { wing_len: "17", wing_w: "18" } },
  { key: "t_shaped", label: "T-shaped", on: false, f: { wing_len: "18", wing_w: "18" } },
  { key: "cross", label: "Cross", on: false, f: { wing_len: "18", wing_w: "16" } },
  { key: "twisted", label: "Twisted square", on: true, f: { width: "28", twist_per_floor_deg: "1.2" } },
  { key: "tapered", label: "Tapered square", on: false, f: { width: "30", top_scale: "0.8" } },
  { key: "terraced", label: "Terraced (steps face sea)", on: false, f: { width: "32", depth: "28", step_every: "10", step_m: "2", step_side_deg: "270" } },
];
const FL = { width: "Width m", depth: "Depth m", chamfer_m: "Chamfer m", exponent: "Roundness", wing_len: "Wing length m", wing_w: "Wing width m", twist_per_floor_deg: "Twist °/floor", top_scale: "Top scale", step_every: "Step every n", step_m: "Step m", step_side_deg: "Step faces °" };
const TL = Object.fromEntries(TYPOS.map(t => [t.key, t.label]));
const label = sp => TL[sp.typology] || sp.typology;

const st = { src: "dadar", anchor: null, ctx: null, S: null, Sf: null, boundary: null, bSource: "illus", env: [], isEnv: false, setbacks: [], selEdge: null, draw: null, field: null,
  results: null, rejected: [], sel: null, level: null, cone: null, zoom: "plot", roseZ: 100, dxf: null, running: false, workers: [] };

/* ================================================================ data sources */
function illustrativePlot(center, ang = 60, w = 64, d = 52) { return rot(box(-w / 2, -d / 2, w / 2, d / 2), ang).map(([x, y]) => [x + center[0], y + center[1]]); }
async function loadDadar() {
  setInfo("ctxInfo", "Loading OpenStreetMap snapshot…");
  const d = await (await fetch("data/dadar_osm.json")).json();
  st.anchor = d.anchor.slice(); $("lat").value = d.anchor[0]; $("lon").value = d.anchor[1];
  st.ctx = GEO.fromCompact(d, st.anchor, { defaultH: defH() });
  st.dataNote = `Context: ${d.source}, fetched ${d.fetched}, about 1 km around Shivaji Park, Dadar. Building data is © OpenStreetMap contributors (ODbL).`;
  st.illusCenter = [-180, -130]; st.illusAng = 60;
  setBoundary(illustrativePlot(st.illusCenter, st.illusAng), "Illustrative plot near Shivaji Park (not the project site)", [6, 6, 6, 6], "illus");
}
function loadSynthetic() {
  const s = GEO.syntheticContext(); st.anchor = null; st.ctx = s.ctx; st.dataNote = "Context: synthetic, fictitious geometry. No real location.";
  setBoundary(s.boundary, "Synthetic coastal plot", s.setbacks, "illus");
}
async function loadLive() {
  const lat = +$("lat").value, lon = +$("lon").value, r = +$("rad").value || 900;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return setInfo("ctxInfo", "Enter a latitude and longitude, or click the map.", true);
  try {
    const json = await GEO.fetchOverpass(lat, lon, r, m => setInfo("ctxInfo", m));
    st.anchor = [lat, lon]; st.ctx = GEO.fromOverpass(json, st.anchor, { defaultH: defH() });
    st.dataNote = `Context: © OpenStreetMap contributors (ODbL), Overpass API, fetched ${new Date().toISOString().slice(0, 10)}, radius ${r} m around ${lat.toFixed(5)}, ${lon.toFixed(5)}.`;
    if (st.bSource !== "dxf") { st.illusCenter = [0, 0]; st.illusAng = 0; setBoundary(illustrativePlot([0, 0], 0, 60, 50), "Illustrative 60 × 50 m plot at the pin", [6, 6, 6, 6], "illus"); }
    else reprojectDXF();
  } catch (e) {
    setInfo("ctxInfo", `Live OpenStreetMap data could not be loaded (${e.message || e}). Previews on claude.ai block outside connections; this works on the hosted site. Here, use the Dadar snapshot or upload an Overpass/GeoJSON file.`, true);
  }
}
function loadUpload(text, name) {
  let json; try { json = JSON.parse(text); } catch (e) { return setInfo("ctxInfo", `${name} is not valid JSON.`, true); }
  let lat = +$("lat").value, lon = +$("lon").value;
  const first = json.elements ? json.elements.find(e => e.geometry && e.geometry.length) : null, gf = json.features ? json.features.find(f => f.geometry) : null;
  if (!(Number.isFinite(lat) && Number.isFinite(lon)) || st.src === "upload") { if (first) { lat = first.geometry[0].lat; lon = first.geometry[0].lon; } else if (gf) { const c = JSON.stringify(gf.geometry.coordinates).match(/-?\d+\.\d+/g); if (c) { lon = +c[0]; lat = +c[1]; } } }
  st.anchor = [lat, lon]; $("lat").value = lat.toFixed(5); $("lon").value = lon.toFixed(5);
  st.ctx = json.features ? GEO.fromGeoJSON(json, st.anchor, { defaultH: defH() }) : GEO.fromOverpass(json, st.anchor, { defaultH: defH() });
  st.dataNote = `Context: ${esc(name)} (uploaded). OpenStreetMap data is © OpenStreetMap contributors (ODbL).`;
  if (st.bSource === "dxf") reprojectDXF(); else setBoundary(illustrativePlot([0, 0], 0, 60, 50), "Illustrative 60 × 50 m plot at the data's first point", [6, 6, 6, 6], "illus");
}
const defH = () => { const v = parseFloat($("defH").value); return Number.isFinite(v) && v > 0 ? v : undefined; };

/* ================================================================ site boundary + scene */
function setBoundary(ring, name, setbacks, source) {
  st.boundary = ccwKeep(ring); st.siteName = name; st.bSource = source;
  st.setbacks = setbacks ? setbacks.slice(0, st.boundary.length) : st.boundary.map(() => 0);
  while (st.setbacks.length < st.boundary.length) st.setbacks.push(0);
  st.isEnv = false; pressEnv();
  ["bIllus", "bDraw"].forEach(id => $(id).setAttribute("aria-pressed", String((id === "bIllus" && source === "illus") || (id === "bDraw" && source === "draw"))));
  rebuildScene();
}
function ccwKeep(r) { return r.map(p => [p[0], p[1]]); }
function rebuildScene() {
  if (!st.ctx || !st.boundary) return;
  const c = centroid(st.boundary); st.center = c;
  let removed = 0; for (const b of st.ctx.buildings) { b.excluded = pip(...centroid(b.ring), st.boundary) || polyInside(b.ring, st.boundary); if (b.excluded) removed++; }
  st.S = GEO.buildScene(st.ctx, c, SCENE_HALF, RES);
  st.Sf = st.ctx.buildings.some(b => b.scenario === "future") ? GEO.buildScene(st.ctx, c, SCENE_HALF, RES, { scenario: "future" }) : null;
  const nb = st.ctx.buildings.length, est = st.ctx.buildings.filter(b => b.hsrc === "estimated").length;
  const ll = st.anchor ? GEO.toLatLon(c[0], c[1], st.anchor) : null;
  setInfo("ctxInfo", `${nb.toLocaleString("en-IN")} buildings${est ? ` (${Math.round(100 * est / nb)}% with estimated heights)` : ""}, ${st.ctx.roads.length} street segments${st.S.W.some(v => v) ? ", sea/water traced" : ", no water in range"}.${st.S.warnings.length ? " " + st.S.warnings.join(" ") : ""}`);
  let wet = 0, tot = 0; { const [a, b2, cc2, d] = bounds(st.boundary); for (let y = b2; y < d; y += 4) for (let x = a; x < cc2; x += 4) if (pip(x, y, st.boundary)) { tot++; const j = Math.floor((x - st.S.x0) / st.S.res), i = Math.floor((y - st.S.y0) / st.S.res); if (st.S.W[i * st.S.nx + j]) wet++; } }
  const wetWarn = tot && wet / tot > 0.3 ? ` <span class="warnline">About ${Math.round(100 * wet / tot)}% of this plot is on water. Check the location.</span>` : "";
  setInfo("siteInfo", `${esc(st.siteName)} · plot ${fmtInt(ringArea(st.boundary))} m²${ll ? ` · centre ${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}` : " · not georeferenced (synthetic)"}${removed ? ` · ${removed} existing building(s) on the plot removed` : ""}.${wetWarn}`);
  $("dataNote").textContent = st.dataNote || "";
  $("attrib").hidden = st.src === "synthetic";
  st.results = null; st.sel = null; st.rejected = []; st.cone = null; hideCone();
  V3D.setContext(st.ctx, st.S, c, { boundary: st.boundary, env: [] }, { el: $("stage") });
  V3D.clearDesign && V3D.clearDesign();
  if (st.bSource !== "draw" || !st.view) st.view = null;
  updateEnvelope(); renderOptions(); renderDesign(); renderKPIs();
}
function polyInside(r, outer) { return r.every(p => pip(p[0], p[1], outer)); }

/* ================================================================ DXF + georeferencing */
const INSUNITS = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0, 14: 0.1 };
function bulgePts(p, q, b) { if (!b) return []; const th = 4 * Math.atan(b), dx = q[0] - p[0], dy = q[1] - p[1], c = Math.hypot(dx, dy); if (!c) return []; const r = c / (2 * Math.sin(th / 2)), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, hl = r * Math.cos(th / 2), cx = mx - hl * dy / c, cy = my + hl * dx / c, a0 = Math.atan2(p[1] - cy, p[0] - cx), n = Math.max(2, Math.min(180, Math.ceil(Math.abs(th) / (5 * D2R)))), out = []; for (let k = 1; k < n; k++) { const a = a0 + th * k / n; out.push([cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a)]); } return out; }
function parseDXF(text) {
  const L = text.split(/\r?\n/), P = []; for (let i = 0; i + 1 < L.length; i += 2) P.push([parseInt(L[i].trim(), 10), L[i + 1].trim()]);
  let units = 0; for (let i = 0; i < P.length; i++) if (P[i][0] === 9 && P[i][1] === "$INSUNITS") { units = parseInt(P[i + 1][1], 10); break; }
  const ents = []; let cur = null, poly = null; const flush = () => { if (cur && cur.type === "LWPOLYLINE") ents.push(cur); cur = null; };
  for (const [c, v] of P) {
    if (c === 0) { if (v === "VERTEX" && poly) { cur = { type: "VERTEX", pt: [0, 0], bulge: 0 }; poly.verts.push(cur); continue; } if (v === "SEQEND" && poly) { ents.push(poly); poly = null; cur = null; continue; } flush(); if (v === "LWPOLYLINE") cur = { type: v, layer: "0", flags: 0, verts: [] }; else if (v === "POLYLINE") { poly = { type: v, layer: "0", flags: 0, verts: [] }; cur = poly; } else cur = null; continue; }
    if (!cur) continue;
    if (cur.type === "LWPOLYLINE") { if (c === 8) cur.layer = v; else if (c === 70) cur.flags = +v; else if (c === 10) cur.verts.push({ pt: [+v, 0], bulge: 0 }); else if (c === 20 && cur.verts.length) cur.verts[cur.verts.length - 1].pt[1] = +v; else if (c === 42 && cur.verts.length) cur.verts[cur.verts.length - 1].bulge = +v; }
    else if (cur.type === "POLYLINE") { if (c === 8) cur.layer = v; else if (c === 70) cur.flags = +v; }
    else if (cur.type === "VERTEX") { if (c === 10) cur.pt[0] = +v; else if (c === 20) cur.pt[1] = +v; else if (c === 42) cur.bulge = +v; }
  }
  flush();
  const polys = [];
  for (const e of ents) { if (!(e.flags & 1)) continue; const pts = []; e.verts.forEach((v, k) => { const q = e.verts[(k + 1) % e.verts.length].pt; pts.push(v.pt); pts.push(...bulgePts(v.pt, q, v.bulge)); }); if (pts.length >= 3 && ringArea(pts) > 0) polys.push({ layer: e.layer, ring: pts }); }
  const role = l => { const u = l.toUpperCase(); return /ENVELOPE|BUILDABLE/.test(u) ? "envelope" : /SITE|BOUNDARY|PLOT/.test(u) ? "boundary" : null; };
  const byRole = { boundary: polys.filter(p => role(p.layer) === "boundary"), envelope: polys.filter(p => role(p.layer) === "envelope") };
  const cands = (byRole.boundary.length ? byRole.boundary : polys.filter(p => !role(p.layer))).sort((a, b) => ringArea(b.ring) - ringArea(a.ring));
  return { units, scale: INSUNITS[units] || 1, unitsKnown: !!INSUNITS[units], cands, envelope: byRole.envelope[0] || null };
}
function onDXF(text, name) {
  const d = parseDXF(text); if (!d.cands.length) return setInfo("siteInfo", `No closed polyline in ${esc(name)}. Export the site boundary as a closed polyline.`, true);
  st.dxf = { ...d, name, idx: 0 };
  $("georef").hidden = false; $("bndPickWrap").hidden = d.cands.length < 2;
  $("bndPick").innerHTML = d.cands.slice(0, 12).map((c, i) => `<option value="${i}">${esc(c.layer)} · ${fmtInt(ringArea(c.ring) * d.scale * d.scale)} m²</option>`).join("");
  const r0 = d.cands[0].ring, big = Math.abs(r0[0][0]) > 100000 && Math.abs(r0[0][1]) > 100000;
  $("geoMode").value = big ? "utm" : "anchor"; geoModeUI();
  if (!big) { const c = centroid(r0); $("refX").value = fmt(c[0], 2); $("refY").value = fmt(c[1], 2); const cl = st.anchor ? GEO.toLatLon(...(st.center || [0, 0]), st.anchor) : [+$("lat").value, +$("lon").value]; $("refLat").value = cl[0].toFixed(6); $("refLon").value = cl[1].toFixed(6); }
  else if (st.anchor) $("utmZone").value = GEO.utmZoneOf(st.anchor[1]);
  reprojectDXF();
}
function reprojectDXF() {
  const d = st.dxf; if (!d) return; const c = d.cands[d.idx]; const north = +$("northDeg").value || 0, s = d.scale;
  let latlon;
  if ($("geoMode").value === "utm") { const z = +$("utmZone").value, south = $("utmHemi").value === "S"; latlon = c.ring.map(([E, N]) => GEO.utmToLatLon(E * s, N * s, z, south)); }
  else { const rx = +$("refX").value, ry = +$("refY").value, lat0 = +$("refLat").value, lon0 = +$("refLon").value; if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) return setInfo("siteInfo", "Enter the latitude and longitude of the reference point.", true); const loc = rot(c.ring.map(([x, y]) => [(x - rx) * s, (y - ry) * s]), north); latlon = loc.map(([x, y]) => GEO.toLatLon(x, y, [lat0, lon0])); }
  if (!st.anchor) { st.anchor = latlon[0].slice(); }
  const ring = latlon.map(([la, lo]) => GEO.toLocal(la, lo, st.anchor)), cc = centroid(ring), far = Math.hypot(cc[0], cc[1]);
  if (far > 1500) setInfo("ctxInfo", `The DXF site is ${fmtInt(far)} m from the loaded context. Load context at the site: set the pin to ${GEO.toLatLon(cc[0], cc[1], st.anchor).map(v => v.toFixed(5)).join(", ")} and press “Load context here”.`, true);
  const warn = d.unitsKnown ? "" : " Units were not stated in the DXF; assumed metres.";
  setBoundary(ring, `${d.name}${warn}`, null, "dxf");
  if (d.envelope) $("envQtext").textContent = "An ENVELOPE layer was found. Use it as the buildable envelope?";
}
function geoModeUI() { const u = $("geoMode").value === "utm"; $("geoAnchor").hidden = u; $("geoUtm").hidden = !u; }

/* ================================================================ envelope */
function pressEnv() { $("envYes").setAttribute("aria-pressed", String(st.isEnv)); $("envNo").setAttribute("aria-pressed", String(!st.isEnv)); $("setbackBox").hidden = st.isEnv; }
function envelopeFromSetbacks(b, sb) {
  const n = b.length, isC = VT.signedArea(b) >= 0, cut = [];
  for (let i = 0; i < n; i++) { const s = +sb[i] || 0; if (s <= 0) continue; const a = b[i], q = b[(i + 1) % n], dx = q[0] - a[0], dy = q[1] - a[1], L = Math.hypot(dx, dy); let nx = -dy / L, ny = dx / L; if (!isC) { nx = -nx; ny = -ny; } cut.push([[a, q, [q[0] + nx * s, q[1] + ny * s], [a[0] + nx * s, a[1] + ny * s]]]); }
  for (let i = 0; i < n; i++) { const s = Math.min(+sb[(i - 1 + n) % n] || 0, +sb[i] || 0); if (s > 0) { const d = []; for (let k = 0; k < 48; k++) { const t = 2 * Math.PI * k / 48; d.push([b[i][0] + s * Math.cos(t), b[i][1] + s * Math.sin(t)]); } cut.push([d]); } }
  if (!cut.length) return b.slice(); const env = PC.difference([b], ...cut); if (!env.length) return [];
  let best = null, ba = -1; for (const p of env) { const a = ringArea(p[0]); if (a > ba) { ba = a; best = p[0]; } } return best.slice(0, -1);
}
function faceDir(r, i) { const a = r[i], b = r[(i + 1) % r.length], isC = VT.signedArea(r) >= 0; let nx = b[1] - a[1], ny = -(b[0] - a[0]); if (!isC) { nx = -nx; ny = -ny; } return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(mod(Math.atan2(nx, ny) * R2D, 360) / 45) % 8]; }
function updateEnvelope() {
  const b = st.boundary; if (!b) return;
  $("edgeList").innerHTML = b.map((a, i) => { const q = b[(i + 1) % b.length]; return `<span class="${st.selEdge === i ? "sel" : ""}">E${i}</span><span class="muted">${fmt(Math.hypot(q[0] - a[0], q[1] - a[1]), 1)} m, faces ${faceDir(b, i)}</span><input type="number" min="0" step="0.5" id="sb-${i}" value="${st.setbacks[i]}" aria-label="Setback for side E${i}, metres" style="width:78px">`; }).join("");
  b.forEach((_, i) => $("sb-" + i).addEventListener("input", e => { st.setbacks[i] = Math.max(0, +e.target.value || 0); st.selEdge = i; recomputeEnv(); }));
  recomputeEnv();
}
function recomputeEnv() {
  const envLayer = st.bSource === "dxf" && st.dxf && st.dxf.envelope;
  st.env = st.isEnv ? (envLayer ? reprojectRing(st.dxf.envelope.ring) : st.boundary.slice()) : envelopeFromSetbacks(st.boundary, st.setbacks);
  document.querySelectorAll("#edgeList span:nth-child(3n+1)").forEach((el, i) => el.className = st.selEdge === i ? "sel" : "");
  setInfo("envInfo", st.env.length ? `Buildable envelope ${fmtInt(ringArea(st.env))} m² (plot ${fmtInt(ringArea(st.boundary))} m²).` : "The setbacks leave no buildable area. Reduce them.", !st.env.length);
  renderMap(); V3D.updateSite({ boundary: st.boundary, env: st.env });
  clearTimeout(recomputeEnv.t); recomputeEnv.t = setTimeout(computeField, 200);
  st.results = null; st.sel = null; renderOptions(); renderKPIs();
}
function reprojectRing(r) { const d = st.dxf, s = d.scale; if ($("geoMode").value === "utm") return r.map(([E, N]) => GEO.toLocal(...GEO.utmToLatLon(E * s, N * s, +$("utmZone").value, $("utmHemi").value === "S"), st.anchor)); const rx = +$("refX").value, ry = +$("refY").value, a0 = [+$("refLat").value, +$("refLon").value]; return rot(r.map(([x, y]) => [(x - rx) * s, (y - ry) * s]), +$("northDeg").value || 0).map(([x, y]) => GEO.toLocal(...GEO.toLatLon(x, y, a0), st.anchor)); }
function computeField() { if (!st.env.length || !st.S) return; const V = VT.viewSettings({ res: RES, lmOn: !!(st.ctx.landmarks && st.ctx.landmarks.length) }); st.S.landmarks = st.ctx.landmarks || []; st.field = VT.siteViewField(st.S, st.env, V, [0, 25, 50, 75, 100], 10);
  const f = st.field; let az = null; if (f.arc) az = mod(f.arc[0] + mod(f.arc[1] - f.arc[0], 360) / 2, 360); else { const r = f.rose[100]; let bi = 0; r.quality.forEach((v, i) => { if (v > r.quality[bi]) bi = i; }); az = f.az[bi]; }
  const first = V3D.state && V3D.state.seaAz == null; V3D.setSeaAz(az); if (first && !st.sel) V3D.resetView();
  renderField(); renderMap(); renderKPIs(); }

/* ================================================================ search (parallel workers, live 3D) */
function readConfig() {
  const R = { depth: +$("rDepth").value, span: +$("rSpan").value, fit: +$("rFit").value, cant: +$("rCant").value, priv: +$("rPriv").value, coreLo: 0.08, coreHi: 0.35, frontLR: 6, frontBR: 3.6,
    vcComp: { q_lr_min: +$("cQ").value, d_min: +$("cD").value, alpha_max: +$("cA").value, p_max: +$("cP").value }, vcLR: { w_min: +$("prW").value, q_min: +$("prQ").value }, vcBR: { w_min: +$("prBW").value, n_min: +$("prN").value }, vcGood: { q_min: 0.40 } };
  const mult = listNums($("eMult").value), beds = listNums($("pBeds").value);
  return { fsi: +$("fsi").value, hmax: +$("hmax").value, reserved: listNums($("reserved").value).map(Math.round), rots: listNums($("rots").value), upf: listNums($("upf").value).map(Math.round).filter(v => v >= 1 && v <= 4), pods: listNums($("pods").value).map(Math.round), ftf: listNums($("ftf").value), coff: listNums($("coff").value), evalEvery: Math.max(1, Math.round(+$("evalEvery").value || 4)),
    coreFixed: +$("coreFixed").value, corePer: +$("corePer").value, colSpacing: 8, living: +$("pLiving").value, bed: +$("pBed").value, beds: [beds[0] ?? 5, beds[1] ?? 4, beds[2] ?? 3], R,
    E: { rate: +$("eRate").value, cost: +$("eCost").value, rise: +$("eRise").value, carpetFactor: 0.88, mult: { premium: mult[0] ?? 1.15, good: mult[1] ?? 1, neutral: mult[2] ?? 0.9, compromised: mult[3] ?? 0.75 } } };
}
function buildSpecs(C) {
  const c = centroid(st.env), specs = [];
  TYPOS.forEach((t, i) => {
    if (!$(`ty-${i}`).checked) return; const vals = {}; for (const k of Object.keys(t.f)) vals[k] = listNums($(`ty-${i}-${k}`).value);
    const combos = Object.keys(vals).reduce((acc, k) => acc.flatMap(a => vals[k].map(v => ({ ...a, [k]: v }))), [{}]);
    for (const cmb of combos) for (const rotd of C.rots) for (const ftf of C.ftf) for (const pod of C.pods) for (const upf of C.upf) for (const off of C.coff) {
      const p = {}; let w = cmb.width, d = cmb.depth;
      if (["y_shaped", "t_shaped", "cross"].includes(t.key)) { w = 2 * cmb.wing_len; d = cmb.wing_w; p.wing_len = cmb.wing_len; p.wing_w = cmb.wing_w; if (t.key === "y_shaped") p.wing_angle_deg = 120; }
      for (const k of ["chamfer_m", "exponent", "twist_per_floor_deg", "top_scale", "step_every", "step_m", "step_side_deg"]) if (cmb[k] != null) p[k] = cmb[k];
      if (["twisted", "tapered"].includes(t.key)) p.base = "square"; if (t.key === "terraced") p.base = "rectangular"; if (d == null) d = w;
      specs.push(VT.resolveFloors({ typology: t.key, width: w, depth: d, p, position: [+c[0].toFixed(3), +c[1].toFixed(3)], rotation: rotd, ftf, podium: pod, upf, coreOff: off, n: 0 }, C));
    }
  });
  const seen = new Set(); return specs.filter(s => { const id = VT.specId(s); if (seen.has(id)) return false; seen.add(id); return true; });
}
function makeWorkers(n) { const ws = []; try { for (let i = 0; i < n; i++) ws.push(new Worker("js/worker.js")); } catch (e) { ws.forEach(w => w.terminate()); return []; } return ws; }
async function runSearch() {
  if (st.running) return;
  if (!st.env || !st.env.length) return setInfo("runInfo", "Set a buildable envelope first.", true);
  const C = readConfig(); if (!(C.fsi > 0) || !(C.hmax > 0)) return setInfo("runInfo", "Enter the consumable FSI area and the maximum height.", true);
  if (!st.field) computeField();
  const specs = buildSpecs(C); if (!specs.length) return setInfo("runInfo", "Tick at least one typology.", true);
  st.running = true; $("btnRun").disabled = true; hideCone(); V3D.clearDesign(); setTab("t-3d");
  const t0 = performance.now(), results = [], rejected = [], arc = st.field && st.field.arc; let done = 0, lastGhost = 0;
  $("hudSearch").hidden = false; $("hudHint").hidden = true;
  const progress = (msg) => { const pct = 100 * done / specs.length; $("prog").style.width = $("hudProg").style.width = pct + "%"; $("hudText").innerHTML = msg; setInfo("runInfo", `${done}/${specs.length} options evaluated · ${rejected.length} rejected so far.`); };
  const onMassing = m => { const now = performance.now(); if (now - lastGhost < 180) return; lastGhost = now; V3D.showGhost(m.sp, m.plates); progress(`Testing <b>${esc(label(m.sp))}</b> · ${m.sp.upf}/floor · ${m.sp.n} floors (${fmt(m.sp.n * m.sp.ftf, 0)} m) · rot ${m.sp.rotation}°${m.feasible ? "" : ` · <span style="color:#bf4d37">fails ${esc(m.viol.join(", "))}</span>`}`); };
  const onResult = ev => { done++; (ev.feasible ? results : rejected).push(ev); if (ev.feasible) { const best = results.reduce((a, b) => a.metrics.compromised < b.metrics.compromised || (a.metrics.compromised === b.metrics.compromised && a.metrics.gdv >= b.metrics.gdv) ? a : b); $("hudText").innerHTML += `<br>Best so far: ${esc(label(best.sp))}, ₹${fmtInt(best.metrics.gdvCr)} cr, ${best.metrics.compromised} compromised`; } progress($("hudText").innerHTML); };
  const nW = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1, specs.length)), ws = makeWorkers(nW);
  const scene = { x0: st.S.x0, y0: st.S.y0, res: st.S.res, nx: st.S.nx, ny: st.S.ny, H: st.S.H, W: st.S.W, G: st.S.G, HAB: st.S.HAB, landmarks: st.ctx.landmarks || [] };
  if (ws.length) {
    st.workers = ws;
    await Promise.all(ws.map((w, k) => new Promise((res, rej) => {
      w.onerror = e => { rej(e.message || "worker error"); };
      w.onmessage = e => { const m = e.data; if (m.type === "ready") w.postMessage({ type: "eval", specs: specs.filter((_, i) => i % ws.length === k) }); else if (m.type === "massing") onMassing(m); else if (m.type === "result") onResult(m.ev); else if (m.type === "batchDone") res(); };
      w.postMessage({ type: "init", scene, C, env: st.env, arc, maxD: 3000 });
    }))).catch(err => setInfo("runInfo", "A search worker failed: " + err, true));
    ws.forEach(w => w.terminate()); st.workers = [];
  } else { // fallback: main thread
    const V = VT.viewSettings({ res: RES, lmOn: !!(scene.landmarks.length) });
    for (const sp of specs) { const ev = VT.checkCandidate(sp, st.env, C, arc); onMassing({ sp, plates: ev.plates, feasible: ev.feasible, viol: ev.viol }); await new Promise(r => setTimeout(r, 0)); if (ev.feasible) VT.evaluateViews(ev, st.S, C, V); onResult(ev); }
  }
  VT.paretoRanks(results); results.sort(VT.cmpKey);
  if (st.Sf && results.length) { const V = VT.viewSettings({ res: RES }); for (const ev of results.slice(0, 8)) { const cl = { ...ev, viol: [], checks: { ...ev.checks }, metrics: { ...ev.metrics }, explain: [], units: [] }; VT.evaluateViews(cl, st.Sf, C, V); ev.metrics.futureComp = cl.metrics.compromised; ev.explain.push(`With future neighbours built: ${cl.metrics.compromised} compromised, ${cl.metrics.premium} premium.`); } }
  st.results = results; st.rejected = rejected.sort((a, b) => a.id < b.id ? -1 : 1); st.C = C;
  $("prog").style.width = "100%"; $("hudSearch").hidden = true; $("hudHint").hidden = false; $("hudHint").textContent = "Click any floor of the tower to see its view cone. Drag to orbit, scroll to zoom.";
  setInfo("runInfo", `${results.length} feasible · ${rejected.length} rejected · ${results.filter(e => e.rank === 0).length} on the Pareto front · ${fmt((performance.now() - t0) / 1000, 1)} s on ${ws.length || 1} ${ws.length ? "workers" : "thread"}.`);
  st.running = false; $("btnRun").disabled = false; V3D.clearGhost();
  select(results[0] || null, true); renderKPIs();
}

/* ================================================================ view cones + jump in */
function coneAt(level, x, y) {
  const ev = st.sel; if (!ev) return; const sp = ev.sp, plate = ev.plates[level]; if (!plate) return;
  const f = V3D.snapToFacade(plate, x, y), z = level * sp.ftf + 1.5, V = VT.viewSettings({ res: RES, lmOn: !!(st.ctx.landmarks && st.ctx.landmarks.length) });
  const own = { ring: plate, bb: bounds(plate), top: sp.n * sp.ftf }, ox = f.x + 0.75 * Math.sin(f.az * D2R), oy = f.y + 0.75 * Math.cos(f.az * D2R);
  const cone = VT.viewCone(st.S, ox, oy, z, f.az, own, V, 90, 2);
  st.cone = { level, x: f.x, y: f.y, az: f.az, ox, oy, z, cone, px: x, py: y };
  V3D.showCone({ x: ox, y: oy, z }, cone, { maxD: V.P.maxD });
  renderCone(); $("vJump").hidden = false; $("vClear").hidden = false;
}
function renderCone() {
  const c = st.cone, ev = st.sel; if (!c || !ev) return; const sp = ev.sp, rays = c.cone.rays;
  $("coneCard").hidden = false;
  $("coneTitle").textContent = `View cone · floor ${c.level} (${fmt(c.level * sp.ftf, 1)} m) · facing ${fmt(c.az, 0)}° ${compass(c.az)}`;
  const levels = []; for (let l = sp.podium; l < sp.n; l++) levels.push(l);
  $("coneLevel").innerHTML = levels.map(l => `<option value="${l}" ${l === c.level ? "selected" : ""}>${l} · ${fmt(l * sp.ftf, 0)} m</option>`).join("");
  const unit = ev.units.find(u => u.level === c.level && u.mp.some(p => pip(c.x - 0.4 * Math.sin(c.az * D2R), c.y - 0.4 * Math.cos(c.az * D2R), p[0])));
  const blocked = rays.filter(r => r.dObs < 2999 && r.water <= 0.05).length, sea = rays.filter(r => r.water > 0.05);
  $("coneKpis").innerHTML = [["Sea in view", `${fmt(100 * c.cone.water, 0)}%`], ["View quality", fmt(c.cone.quality, 2)], ["Rays blocked", `${blocked}/${rays.length}`], ["Unit here", unit ? `${unit.id.split("-")[1]} · ${unit.cls}` : "core / podium"]].map(([a, b]) => `<div class="kpi"><span>${a}</span><b style="font-size:15px">${b}</b></div>`).join("");
  const secs = sectors(rays.map(r => [r.az, r.water > 0.05])); const near = rays.filter(r => r.dObs < 200).sort((a, b) => a.dObs - b.dObs)[0];
  $("coneSectors").textContent = (secs.length ? `Sea visible at ${secs.map(([a, b]) => `${fmt(a, 0)}°–${fmt(b, 0)}°`).join(", ")}. ` : "No sea visible from this point. ") + (near ? `Nearest obstruction ${fmt(near.dObs, 0)} m away at ${fmt(near.az, 0)}°, ${fmt(near.obsH, 0)} m tall.` : "No obstruction within 200 m.");
  // floor-by-floor chart for the same facade position
  const V = VT.viewSettings({ res: RES }), step = Math.max(1, Math.round(levels.length / 30)), pts = [];
  for (let i = 0; i < levels.length; i += step) { const l = levels[i], p = ev.plates[l], f = V3D.snapToFacade(p, c.x, c.y), own = { ring: p, bb: bounds(p), top: sp.n * sp.ftf }; const k = VT.viewCone(st.S, f.x + 0.75 * Math.sin(f.az * D2R), f.y + 0.75 * Math.cos(f.az * D2R), l * sp.ftf + 1.5, f.az, own, V, 75, 5); pts.push([l, k.water, k.quality]); }
  const W = 360, H = 170, x0 = 34, y0 = 12, w = W - x0 - 10, h = H - y0 - 28, maxL = levels[levels.length - 1], minL = levels[0], X = l => x0 + w * (l - minL) / Math.max(1, maxL - minL), Y = v => y0 + h * (1 - v);
  const path = (k) => pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[k]).toFixed(1)}`).join("");
  $("coneChart").innerHTML = `${[0, .5, 1].map(v => `<line x1="${x0}" x2="${x0 + w}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${x0 - 6}" y="${Y(v) + 4}" font-size="10" text-anchor="end">${v * 100}%</text>`).join("")}
    <path d="${path(1)}" fill="none" stroke="#1f6fd1" stroke-width="2.2"/><path d="${path(2)}" fill="none" stroke="var(--ink-3)" stroke-width="1.4" stroke-dasharray="4 3"/>
    <line x1="${X(c.level)}" x2="${X(c.level)}" y1="${y0}" y2="${y0 + h}" stroke="var(--signal)" stroke-width="1.5"/>
    <text x="${x0}" y="${H - 8}" font-size="10">floor ${minL}</text><text x="${x0 + w}" y="${H - 8}" font-size="10" text-anchor="end">floor ${maxL}</text><text x="${X(c.level)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="var(--signal)">${c.level}</text>
    <text x="${x0 + w}" y="${y0 + 10}" font-size="10" text-anchor="end" fill="#1f6fd1">sea share</text><text x="${x0 + w}" y="${y0 + 22}" font-size="10" text-anchor="end">view quality (dashed)</text>`;
}
function sectors(list) { const out = []; let cur = null; for (const [a, on] of list) { if (on) { if (!cur) cur = [a, a]; else cur[1] = a; } else if (cur) { out.push(cur); cur = null; } } if (cur) out.push(cur); return out; }
const arcWidth = a => (a[0] === 0 && a[1] === 360) ? "360" : fmt(mod(a[1] - a[0], 360), 0);
const compass = az => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(mod(az, 360) / 45) % 8];
function hideCone() { $("coneCard").hidden = true; $("vJump").hidden = true; $("vClear").hidden = true; V3D.clearCone && V3D.clearCone(); }
function jump() { const c = st.cone, ev = st.sel; if (!c || !ev) return; V3D.jumpIn({ x: c.x, y: c.y, az: c.az, floorZ: c.level * ev.sp.ftf }, ev.plates[c.level], ev.sp.ftf); $("jumpbar").hidden = false; $("jumpText").textContent = `Floor ${c.level} · ${fmt(c.level * ev.sp.ftf + 1.6, 1)} m eye height · facing ${compass(c.az)}`; $("stage").querySelector(".tools").hidden = true; $("hudHint").hidden = true; }

/* ================================================================ rendering: KPIs, plan, rose, options, design */
function setInfo(id, html, warn) { const el = $(id); el.innerHTML = html; el.className = warn ? "status warnline" : "status"; }
function renderKPIs() {
  const f = st.field, best = st.results && st.results[0], k = [];
  k.push(`<div class="kpi"><span>Buildable envelope</span><b>${st.env && st.env.length ? fmtInt(ringArea(st.env)) : "–"} m²</b><em>${st.isEnv ? "given" : "after setbacks"}</em></div>`);
  k.push(`<div class="kpi"><span>Premium sea arc</span><b>${f && f.arc ? arcWidth(f.arc) + "°" : "none"}</b><em>${f && f.arc ? `${fmt(f.arc[0], 0)}°–${fmt(f.arc[1], 0)}°, opens at ${f.opening ?? ">100"} m` : "no clear sea direction"}</em></div>`);
  if (best) { const m = best.metrics; k.push(`<div class="kpi"><span>Top option</span><b>${esc(label(best.sp))}</b><em>${best.sp.upf}/floor · ${best.sp.n} floors · ${fmt(m.height, 0)} m</em></div>`, `<div class="kpi"><span>GDV (placeholder rates)</span><b>₹${fmtInt(m.gdvCr)} cr</b><em>${fmtInt(m.carpet)} m² carpet</em></div>`, `<div class="kpi"><span>Compromised units</span><b style="color:${m.compromised ? "var(--bad)" : "var(--ok)"}">${m.compromised}</b><em>${m.futureComp != null ? `${m.futureComp} with future neighbours` : "existing context"}</em></div>`, `<div class="kpi"><span>Premium units</span><b>${m.premium} / ${m.units}</b><em>${fmt(100 * m.premiumShare, 0)}% of inventory</em></div>`); }
  $("kpis").innerHTML = k.join("");
}
const pathOf = r => "M" + r.map(([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`).join("L") + "Z";
const lineOf = r => "M" + r.map(([x, y]) => `${x.toFixed(1)},${(-y).toFixed(1)}`).join("L");
function setZoom(z) {
  st.zoom = z; document.querySelectorAll("[data-zoom]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.zoom === z)));
  if (st.boundary) { const c = centroid(st.boundary), bb = bounds(st.boundary); st.view = { cx: c[0], cy: c[1], half: z === "plot" ? Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.62 + 8 : z === "nbhd" ? 260 : 900 }; }
  renderMap();
}
const MAP_MAX_HALF = 2800, MAP_MIN_HALF = 15;
function applyView() { const v = st.view; $("map").setAttribute("viewBox", `${v.cx - v.half} ${-v.cy - v.half} ${2 * v.half} ${2 * v.half}`); }
function zoomMap(f, px, py) { // f < 1 zooms in; (px, py) world point kept under the cursor
  const v = st.view, h = Math.max(MAP_MIN_HALF, Math.min(MAP_MAX_HALF, v.half * f)), r = h / v.half;
  if (px != null) { v.cx = px - (px - v.cx) * r; v.cy = py - (py - v.cy) * r; } v.half = h;
  document.querySelectorAll("[data-zoom]").forEach(b => b.setAttribute("aria-pressed", "false"));
  applyView(); scheduleMapRender();
}
function scheduleMapRender() { clearTimeout(scheduleMapRender.t); scheduleMapRender.t = setTimeout(renderMap, 140); }
function svgPoint(e) { const svg = $("map"), p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse()); return [q.x, -q.y]; }
function bindMapNav() {
  const svg = $("map"); let drag = null;
  svg.addEventListener("wheel", e => { if (!st.view) return; e.preventDefault(); const [x, y] = svgPoint(e); zoomMap(e.deltaY > 0 ? 1.18 : 1 / 1.18, x, y); }, { passive: false });
  svg.addEventListener("pointerdown", e => { if (!st.view || e.button > 0) return; drag = { x: e.clientX, y: e.clientY, cx: st.view.cx, cy: st.view.cy, moved: false, id: e.pointerId }; });
  svg.addEventListener("pointermove", e => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) { drag.moved = true; svg.setPointerCapture(drag.id); svg.style.cursor = "grabbing"; }
    const r = svg.getBoundingClientRect(), s = 2 * st.view.half / Math.min(r.width, r.height);
    st.view.cx = drag.cx - dx * s; st.view.cy = drag.cy + dy * s; applyView();
  });
  const end = e => { if (!drag) return; const moved = drag.moved; drag = null; svg.style.cursor = st.draw ? "crosshair" : ""; if (moved) { st.justPanned = true; setTimeout(() => st.justPanned = false, 0); scheduleMapRender(); } };
  svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
  svg.addEventListener("click", e => {
    if (st.justPanned || !st.draw) return; const p = svgPoint(e), d = st.draw;
    if (d.length >= 3 && Math.hypot(p[0] - d[0][0], p[1] - d[0][1]) < 10 * st.view.half / 320) return finishDraw();
    d.push(p); renderMap();
  });
}
function finishDraw() { if (!st.draw || st.draw.length < 3) return setInfo("siteInfo", "Add at least three corners.", true); const r = st.draw; st.draw = null; $("drawBox").hidden = true; setBoundary(r, "Drawn plot", null, "draw"); setZoom("plot"); }
function renderMap() {
  const svg = $("map"); if (!st.boundary || !st.ctx) return;
  if (!st.view) { st.zoom = st.zoom || "plot"; const z = st.zoom; setZoom(z); return; }
  const bc = centroid(st.boundary), c = [st.view.cx, st.view.cy], half = st.view.half, k = half / 320, out = [], cull = half * 1.6;
  applyView();
  const inView = r => { const b = bounds(r); return b[2] > c[0] - cull && b[0] < c[0] + cull && b[3] > c[1] - cull && b[1] < c[1] + cull; };
  if (st.S) { // water from the raster, as coarse rects (merged runs)
    const S = st.S, j0 = Math.max(0, Math.floor((c[0] - half - S.x0) / S.res)), j1 = Math.min(S.nx, Math.ceil((c[0] + half - S.x0) / S.res)), i0 = Math.max(0, Math.floor((c[1] - half - S.y0) / S.res)), i1 = Math.min(S.ny, Math.ceil((c[1] + half - S.y0) / S.res)), stp = Math.max(1, Math.round(half / 320 / S.res * 2));
    let d = ""; for (let i = i0; i < i1; i += stp) { let run = -1; for (let j = j0; j <= j1; j += stp) { const w = j < j1 && S.W[i * S.nx + j]; if (w && run < 0) run = j; if (!w && run >= 0) { const x = S.x0 + run * S.res, y = S.y0 + i * S.res; d += `M${x},${-(y + stp * S.res)}h${(j - run) * S.res}v${stp * S.res}h${-(j - run) * S.res}Z`; run = -1; } } }
    out.push(`<path d="${d}" fill="var(--sea)"/>`);
  }
  st.ctx.parks.forEach(p => inView(p) && out.push(`<path d="${pathOf(p)}" fill="var(--park)"/>`));
  if (st.zoom !== "plot") for (const r of st.ctx.roads) if (r.line.length > 1 && inView(r.line)) out.push(`<path d="${lineOf(r.line)}" fill="none" stroke="var(--road)" stroke-width="${Math.max(r.w, 1.5 * k)}" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`);
  if (st.field && st.field.arc && st.zoom !== "plot") { const [a0, a1] = st.field.arc, r = half * 0.92, span = mod(a1 - a0, 360), pts = [[c[0], c[1]]]; for (let t = 0; t <= 48; t++) { const a = (a0 + span * t / 48) * D2R; pts.push([c[0] + r * Math.sin(a), c[1] + r * Math.cos(a)]); } out.push(`<path d="${pathOf(pts)}" fill="var(--signal)" fill-opacity=".14" stroke="var(--signal)" stroke-width="${1.2 * k}" stroke-dasharray="${6 * k} ${4 * k}"/>`); }
  for (const b of st.ctx.buildings) { if (!inView(b.ring)) continue; const fut = b.scenario === "future"; out.push(`<path d="${pathOf(b.ring)}" fill="${fut ? "none" : "var(--bldg)"}" fill-opacity="${b.excluded ? 0.08 : fut ? 0 : (0.18 + 0.62 * Math.min(b.height / 100, 1)).toFixed(2)}" stroke="${fut ? "var(--bldg-future)" : b.excluded ? "var(--ink-3)" : "none"}" stroke-width="${1.2 * k}" stroke-dasharray="${fut || b.excluded ? `${4 * k} ${3 * k}` : "none"}"><title>${fmt(b.height, 0)} m · ${b.hsrc}${b.excluded ? " · on the plot, removed" : ""}</title></path>`); }
  out.push(`<path d="${pathOf(st.boundary)}" fill="none" stroke="var(--ink-2)" stroke-width="${1.2 * k}" stroke-dasharray="${5 * k} ${3 * k}"/>`);
  if (st.env.length) out.push(`<path d="${pathOf(st.env)}" fill="var(--accent-soft)" fill-opacity=".85" stroke="var(--accent)" stroke-width="${1.5 * k}"/>`);
  const ev = st.sel; if (ev) { const l = ev.evaluated[Math.floor(ev.evaluated.length / 2)]; out.push(`<path d="${pathOf(ev.plates[l])}" fill="var(--premium)" fill-opacity=".5" stroke="var(--ink)" stroke-width="${k}"/><path d="${pathOf(ev.cores[l])}" fill="var(--ink-2)"/>`); }
  if (!st.isEnv && st.zoom === "plot" && !st.draw) st.boundary.forEach((a, i) => { const b = st.boundary[(i + 1) % st.boundary.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dx = bc[0] - m[0], dy = bc[1] - m[1], L = Math.hypot(dx, dy) || 1, lp = [m[0] - dx / L * 11 * k, m[1] - dy / L * 11 * k], on = st.selEdge === i;
    out.push(`<line x1="${a[0]}" y1="${-a[1]}" x2="${b[0]}" y2="${-b[1]}" stroke="${on ? "var(--signal)" : "var(--accent)"}" stroke-opacity="${on ? 1 : .4}" stroke-width="${(on ? 5 : 3) * k}" stroke-linecap="round"/><line x1="${a[0]}" y1="${-a[1]}" x2="${b[0]}" y2="${-b[1]}" stroke="transparent" stroke-width="${22 * k}" data-edge="${i}" style="cursor:pointer" tabindex="0" role="button" aria-label="Side E${i}, setback ${st.setbacks[i]} m"><title>Set the setback for E${i}</title></line><text x="${lp[0]}" y="${-lp[1]}" font-size="${11 * k}" text-anchor="middle" dominant-baseline="middle" style="pointer-events:none">E${i} · ${st.setbacks[i]} m</text>`); });
  if (st.draw) { const d = st.draw; if (d.length) out.push(`<path d="${lineOf(d)}" fill="none" stroke="var(--signal)" stroke-width="${2 * k}"/>`); d.forEach(([x, y], i) => out.push(`<circle cx="${x}" cy="${-y}" r="${(i === 0 && d.length >= 3 ? 6 : 3) * k}" fill="${i === 0 && d.length >= 3 ? "none" : "var(--signal)"}" stroke="var(--signal)" stroke-width="${1.5 * k}"><title>${i === 0 ? "Click here to close the outline" : ""}</title></circle>`)); }
  const n0 = [c[0] + half * 0.86, c[1] + half * 0.84]; out.push(`<g style="pointer-events:none"><path d="M${n0[0]},${-n0[1] - 14 * k}L${n0[0] - 6 * k},${-n0[1] + 4 * k}L${n0[0]},${-n0[1]}L${n0[0] + 6 * k},${-n0[1] + 4 * k}Z" fill="var(--ink)"/><text x="${n0[0]}" y="${-n0[1] + 16 * k}" font-size="${11 * k}" text-anchor="middle">N</text></g>`);
  const bar = st.zoom === "plot" ? 10 : st.zoom === "nbhd" ? 100 : 500, bx = c[0] - half * 0.92, by = -(c[1] - half * 0.9); out.push(`<g style="pointer-events:none"><line x1="${bx}" y1="${by}" x2="${bx + bar}" y2="${by}" stroke="var(--ink)" stroke-width="${2 * k}"/><text x="${bx}" y="${by - 6 * k}" font-size="${10 * k}">${bar} m</text></g>`);
  svg.innerHTML = out.join("");
  svg.querySelectorAll("[data-edge]").forEach(el => { const f = () => { if (st.justPanned) return; st.selEdge = +el.dataset.edge; const inp = $("sb-" + st.selEdge); if (inp) { inp.focus(); inp.select(); } recomputeEnv(); }; el.addEventListener("click", f); el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); f(); } }); });
  svg.style.cursor = st.draw ? "crosshair" : "";
}
function renderField() {
  const f = st.field; if (!f) return;
  $("roseH").innerHTML = f.heights.map(z => `<button type="button" class="chip" data-z="${z}" aria-pressed="${z === st.roseZ}">${z} m</button>`).join("");
  $("roseH").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { st.roseZ = +b.dataset.z; renderField(); }));
  const r = f.rose[st.roseZ], R = 118, step = f.az[1] - f.az[0], out = [];
  for (const q of [0.25, 0.5, 0.75, 1]) out.push(`<circle r="${R * q}" fill="none" stroke="var(--line)"/>`);
  if (f.arc) { const [a0, a1] = f.arc, span = mod(a1 - a0, 360) || 360; let d = ""; for (let t = 0; t <= 60; t++) { const a = (a0 + span * t / 60) * D2R; d += (t ? "L" : "M") + (R + 9) * Math.sin(a) + "," + (-(R + 9) * Math.cos(a)); } out.push(`<path d="${d}" fill="none" stroke="var(--signal)" stroke-width="4" stroke-linecap="round"/>`); }
  f.az.forEach((a, i) => { const q = r.quality[i], w = r.water[i], a0 = (a - step / 2) * D2R, a1 = (a + step / 2) * D2R, rr = R * q; out.push(`<path d="M0,0L${rr * Math.sin(a0)},${-rr * Math.cos(a0)}L${rr * Math.sin(a1)},${-rr * Math.cos(a1)}Z" fill="${w > 0.5 ? "var(--accent)" : w > 0.05 ? "var(--sea-deep)" : "var(--bldg)"}" fill-opacity="${w > 0.05 ? .95 : .55}"><title>${a}°: quality ${fmt(q, 2)}, sea ${fmt(w, 2)}</title></path>`); });
  [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([t, a]) => out.push(`<text x="${(R + 24) * Math.sin(a * D2R)}" y="${-(R + 24) * Math.cos(a * D2R)}" font-size="12" text-anchor="middle" dominant-baseline="middle">${t}</text>`));
  $("rose").innerHTML = out.join("");
  $("fieldTbl").innerHTML = `<thead><tr><th>Height</th><th class="n">Mean view</th><th class="n">Mean sea</th><th class="n">Best direction</th></tr></thead><tbody>${f.heights.map(z => { const rz = f.rose[z]; let bi = 0; rz.quality.forEach((v, i) => { if (v > rz.quality[bi]) bi = i; }); return `<tr><td class="n">${z} m</td><td class="n">${fmt(mean(Array.from(rz.quality)), 3)}</td><td class="n">${fmt(mean(Array.from(rz.water)), 3)}</td><td class="n">${f.az[bi]}° ${compass(f.az[bi])}</td></tr>`; }).join("")}</tbody>`;
  setInfo("fieldInfo", f.arc ? `Premium sea arc ${fmt(f.arc[0], 0)}°–${fmt(f.arc[1], 0)}° (${arcWidth(f.arc)}° wide) at 100 m. Sea view opens at ${f.opening != null ? f.opening + " m" : "above 100 m"}.` : "No direction has a clear sea view from the envelope up to 100 m.");
}
function classBar(m) { const t = Math.max(m.units, 1); return `<div class="bar" title="${m.premium} premium · ${m.good} good · ${m.neutral} neutral · ${m.compromised} compromised">${["premium", "good", "neutral", "compromised"].map(c => `<i style="width:${100 * m[c] / t}%;background:var(--${c})"></i>`).join("")}</div>`; }
function renderOptions() {
  const res = st.results;
  if (!res) { $("optTbl").innerHTML = `<tbody><tr><td class="muted">Run a search to see ranked options.</td></tr></tbody>`; $("rejTbl").innerHTML = ""; return; }
  $("optTbl").innerHTML = `<thead><tr><th>Rank</th><th>Typology</th><th class="n">Rot °</th><th class="n">Units/fl</th><th class="n">Podium</th><th class="n">Floors</th><th class="n">Height m</th><th class="n">GDV ₹ cr</th><th>Unit classes</th><th class="n">Prem.</th><th class="n">Comp.</th><th class="n">Comp. future</th><th class="n">Living view</th><th class="n">Efficiency</th><th class="n">Core %</th><th class="n">Slender</th></tr></thead><tbody>${res.map((e, i) => { const m = e.metrics; return `<tr class="pick ${st.sel === e ? "on" : ""}" data-i="${i}" tabindex="0"><td>${e.rank === 0 ? `<span class="pill front">front</span>` : `<span class="pill r">${e.rank}</span>`}</td><td>${esc(label(e.sp))}</td><td class="n">${e.sp.rotation}</td><td class="n">${e.sp.upf}</td><td class="n">${e.sp.podium}</td><td class="n">${e.sp.n}</td><td class="n">${fmt(m.height, 1)}</td><td class="n">${fmtInt(m.gdvCr)}</td><td>${classBar(m)}</td><td class="n">${m.premium}</td><td class="n" style="color:${m.compromised ? "var(--bad)" : "inherit"}">${m.compromised}</td><td class="n">${m.futureComp ?? "–"}</td><td class="n">${fmt(m.livingView, 3)}</td><td class="n">${fmt(m.efficiency, 2)}</td><td class="n">${fmt(100 * m.coreRatio, 1)}</td><td class="n">1:${fmt(m.slender, 1)}</td></tr>`; }).join("")}</tbody>`;
  $("optTbl").querySelectorAll("tr.pick").forEach(tr => { const go = () => { select(res[+tr.dataset.i], true); setTab("t-3d"); }; tr.addEventListener("click", go); tr.addEventListener("keydown", e => { if (e.key === "Enter") go(); }); });
  $("rejTbl").innerHTML = st.rejected.length ? `<thead><tr><th>Typology</th><th class="n">Rot °</th><th class="n">Units/fl</th><th class="n">Podium</th><th>Failed rules</th><th>Detail</th></tr></thead><tbody>${st.rejected.map(e => `<tr><td>${esc(label(e.sp))}</td><td class="n">${e.sp.rotation}</td><td class="n">${e.sp.upf}</td><td class="n">${e.sp.podium}</td><td class="mono">${e.viol.join(", ")}</td><td style="white-space:normal">${e.viol.map(v => esc(e.checks[v] ? e.checks[v][1] : "")).join("; ")}</td></tr>`).join("")}</tbody>` : `<tbody><tr><td class="muted">No options were rejected.</td></tr></tbody>`;
}
function select(ev, frame) { st.sel = ev; st.level = ev ? ev.evaluated[Math.floor(ev.evaluated.length / 2)] : null; hideCone(); st.cone = null; if (ev) V3D.showDesign(ev, { frame }); else V3D.clearDesign(); renderOptions(); renderDesign(); renderMap(); }
function renderDesign() {
  const ev = st.sel;
  if (!ev) { $("designHead").innerHTML = `<h3>No design selected</h3><p class="hint">Run a search, then pick an option.</p>`; ["checks", "explain", "unitTbl", "plan", "lvlPick"].forEach(id => $(id).innerHTML = ""); return; }
  const m = ev.metrics, sp = ev.sp, pr = Object.entries(sp.p).filter(([k]) => k !== "base").map(([k, v]) => `${FL[k] || k} ${v}`).join(" · ");
  $("designHead").innerHTML = `<div class="row" style="justify-content:space-between"><h3>${esc(label(sp))} · ${sp.upf} unit${sp.upf > 1 ? "s" : ""} per floor · ${sp.n} floors (${fmt(m.height, 1)} m)</h3><span class="mono muted">${ev.id}</span></div><p class="hint">${sp.width} × ${sp.depth} m${pr ? " · " + esc(pr) : ""} · rotation ${sp.rotation}° · podium ${sp.podium} floors · floor-to-floor ${sp.ftf} m</p><div class="summary">${[["GDV", `₹${fmtInt(m.gdvCr)} cr`], ["Carpet", `${fmtInt(m.carpet)} m²`], ["Efficiency", fmt(m.efficiency, 2)], ["FSI used", `${fmt(100 * m.fsiUtil, 0)}%`], ["Premium", `${m.premium}/${m.units}`], ["Compromised", `${m.compromised}${m.futureComp != null ? ` (future ${m.futureComp})` : ""}`], ["Inventory risk", `${fmt(100 * m.risk, 1)}%`], ["Slenderness", `1:${fmt(m.slender, 1)}`]].map(([a, b]) => `<div class="kpi"><span>${a}</span><b style="font-size:15px">${b}</b></div>`).join("")}</div>`;
  $("checks").innerHTML = Object.entries(ev.checks).map(([id, [ok, d]]) => `<span class="${ok ? "ok" : "no"}">${ok ? "✓" : "✗"}</span><span class="mono">${id}</span><span>${esc(d)}</span>`).join("");
  $("explain").innerHTML = ev.explain.map(x => `<li>${esc(x)}</li>`).join("");
  $("lvlPick").innerHTML = ev.evaluated.map(l => `<option value="${l}" ${l === st.level ? "selected" : ""}>${l} (${fmt(l * sp.ftf, 1)} m)</option>`).join("");
  $("unitTbl").innerHTML = `<thead><tr><th>Unit</th><th class="n">Level</th><th>Class</th><th class="n">Carpet ft²</th><th class="n">₹/ft²</th><th class="n">Value ₹ cr</th><th class="n">Living view</th><th class="n">Living sea</th><th class="n">Obstruction m</th><th class="n">Beds with sea</th><th>Why</th></tr></thead><tbody>${ev.units.slice().sort((a, b) => b.level - a.level || (a.id < b.id ? -1 : 1)).map(u => { const lr = u.rooms.find(r => r.room === "living"), beds = u.rooms.filter(r => r.room.startsWith("bed")); return `<tr><td class="mono">${u.id}</td><td class="n">${u.level}</td><td><span class="pill ${u.cls}">${u.cls}</span></td><td class="n">${fmtInt(u.carpet * FT2)}</td><td class="n">${fmtInt(u.rate)}</td><td class="n">${fmt(u.value / 1e7, 2)}</td><td class="n">${lr ? fmt(lr.q, 3) : "–"}</td><td class="n">${lr ? fmt(lr.water, 2) : "–"}</td><td class="n">${lr ? fmtInt(lr.dMed) : "–"}</td><td class="n">${beds.filter(b => b.water >= st.C.R.vcBR.w_min).length}/${beds.length}</td><td style="white-space:normal;min-width:260px">${esc(u.reasons.join(" · "))}</td></tr>`; }).join("")}</tbody>`;
  renderPlan();
}
function runsOf(pts, gap) { const runs = []; let cur = []; for (const p of pts) { if (cur.length && Math.hypot(p[0] - cur[cur.length - 1][0], p[1] - cur[cur.length - 1][1]) > gap) { runs.push(cur); cur = []; } cur.push(p); } if (cur.length) runs.push(cur); return runs; }
function renderPlan() {
  const ev = st.sel, l = st.level; if (!ev || l == null) return;
  const plate = ev.plates[l], core = ev.cores[l], bb = bounds(st.env.concat(plate)), c = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], half = Math.max(bb[2] - bb[0], bb[3] - bb[1]) / 2 + 6, k = half / 320, svg = $("plan");
  svg.setAttribute("viewBox", `${c[0] - half} ${-c[1] - half} ${2 * half} ${2 * half}`);
  const out = [`<path d="${pathOf(st.boundary)}" fill="none" stroke="var(--ink-3)" stroke-dasharray="${4 * k} ${3 * k}" stroke-width="${k}"/>`, `<path d="${pathOf(st.env)}" fill="var(--accent-soft)" fill-opacity=".6" stroke="var(--accent)" stroke-width="${k}"/>`];
  for (const u of ev.units.filter(u => u.level === l)) {
    out.push(`<path d="${u.mp.map(p => p.map(pathOf).join("")).join("")}" fill="var(--${u.cls})" fill-opacity=".72" fill-rule="evenodd" stroke="var(--ink)" stroke-width="${1.2 * k}"><title>${u.id} ${u.cls}\n${esc(u.reasons.join("\n"))}</title></path>`);
    const lp = centroid(u.mp[0][0]); out.push(`<text x="${lp[0]}" y="${-lp[1]}" font-size="${12 * k}" text-anchor="middle" dominant-baseline="middle" style="pointer-events:none">U${u.id.split("-U")[1]} ${u.cls}</text>`);
    for (const r of u.rooms) { const col = r.room.startsWith("bed") ? "var(--bed)" : r.room === "living" ? "var(--living)" : "var(--service)"; for (const run of runsOf(r.pts, 3.6)) out.push(`<polyline points="${run.map(([x, y]) => `${x},${-y}`).join(" ")}" fill="none" stroke="${col}" stroke-width="${7 * k}" stroke-linecap="round"><title>${u.id} ${r.room}: view ${fmt(r.q, 2)}, sea ${fmt(r.water, 2)}</title></polyline>`); }
  }
  out.push(`<path d="${pathOf(core)}" fill="var(--ink-2)" stroke="var(--ink)" stroke-width="${k}"/>`);
  (ev.cols[l] || VT.structure(plate, core, 8).cols).forEach(([x, y]) => out.push(`<rect x="${x - 3 * k}" y="${-y - 3 * k}" width="${6 * k}" height="${6 * k}" fill="var(--ink)"/>`));
  svg.innerHTML = out.join("");
}

/* ================================================================ map (hosted only) */
let leaf = null, marker = null;
function initLeaflet() {
  if (leaf || !window.L) { if (!window.L) $("leafNote").textContent = "The map library is unavailable here; type coordinates instead."; return; }
  leaf = L.map("leaf", { worldCopyJump: true }).setView([+$("lat").value || 19.028, +$("lon").value || 72.8375], 15);
  const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(leaf);
  let tileFail = 0; tiles.on("tileerror", () => { if (++tileFail === 3) $("leafNote").textContent = "Map tiles are blocked in this preview (it allows no outside connections). Type coordinates, or open the hosted site."; });
  leaf.on("click", e => setPin(e.latlng.lat, e.latlng.lng));
}
function setPin(lat, lon) { $("lat").value = lat.toFixed(6); $("lon").value = lon.toFixed(6); if (leaf) { if (marker) marker.setLatLng([lat, lon]); else marker = L.marker([lat, lon]).addTo(leaf); leaf.panTo([lat, lon]); } $("leafNote").textContent = `Pin at ${lat.toFixed(5)}, ${lon.toFixed(5)}. Press “Load context here”.`; }

/* ================================================================ tabs + wiring */
function setTab(id) { document.querySelectorAll("nav.tabs button").forEach(b => { const on = b.id === id; b.setAttribute("aria-selected", String(on)); $(b.dataset.p).hidden = !on; }); if (id === "t-site") renderMap(); }
async function changeSource(v) {
  st.src = v; $("liveBox").hidden = v !== "live"; $("uploadBox").hidden = v !== "upload"; $("oqText").value = GEO.overpassQuery(+$("lat").value, +$("lon").value, +$("rad").value || 900);
  if (v === "live") { initLeaflet(); setTimeout(() => leaf && leaf.invalidateSize(), 50); setInfo("ctxInfo", "Search or click the map, then press “Load context here”."); }
  if (v === "dadar") await loadDadar();
  if (v === "synthetic") loadSynthetic();
}
function renderTypos() { $("typos").innerHTML = TYPOS.map((t, i) => `<div class="typo"><input type="checkbox" id="ty-${i}" ${t.on ? "checked" : ""}><label for="ty-${i}" style="font-weight:600">${t.label}</label><div class="ps">${Object.entries(t.f).map(([k, v]) => `<label class="f">${FL[k]}<input type="text" id="ty-${i}-${k}" value="${v}"></label>`).join("")}</div></div>`).join(""); }
function resultsJSON() { return JSON.stringify({ site: st.siteName, anchor_latlon: st.anchor, envelope_m2: ringArea(st.env), setbacks_m: st.isEnv ? null : st.setbacks, limits: { fsi_m2: +$("fsi").value, max_height_m: +$("hmax").value }, premium_arc_deg: st.field && st.field.arc, options: (st.results || []).map(e => ({ id: e.id, rank: e.rank, spec: e.sp, metrics: e.metrics, checks: e.checks })), rejected: st.rejected.map(e => ({ id: e.id, spec: e.sp, violations: e.viol })) }, (k, v) => typeof v === "number" ? +v.toFixed(4) : v, 1); }

async function boot() {
  if (!window.THREE || !window.polygonClipping) { setInfo("runInfo", "A required library did not load. Check your connection and reload.", true); return; }
  V3D.init($("stage"));
  V3D.on("pick", hit => { if (!st.sel || st.running) return; coneAt(hit.level, hit.x, hit.y); });
  V3D.on("exitJump", () => { $("jumpbar").hidden = true; $("stage").querySelector(".tools").hidden = false; $("hudHint").hidden = false; });
  renderTypos();
  document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => setTab(b.id)));
  document.querySelectorAll("[data-zoom]").forEach(b => b.addEventListener("click", () => setZoom(b.dataset.zoom)));
  $("src").addEventListener("change", e => changeSource(e.target.value));
  $("btnFetch").addEventListener("click", () => { if (st.src === "live") loadLive(); else if (st.src === "dadar") loadDadar(); else if (st.src === "synthetic") loadSynthetic(); else setInfo("ctxInfo", "Choose a file above.", true); });
  $("btnFind").addEventListener("click", async () => { try { const hits = await GEO.geocode($("placeQ").value); $("placeHits").innerHTML = hits.map((h, i) => `<button type="button" class="chip" data-i="${i}">${esc(h.name.split(",").slice(0, 3).join(","))}</button>`).join("") || "No match."; $("placeHits").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { const h = hits[+b.dataset.i]; setPin(h.lat, h.lon); if (leaf) leaf.setView([h.lat, h.lon], 16); })); } catch (e) { $("placeHits").textContent = "Place search is unavailable here (outside connections are blocked in this preview). Type coordinates instead."; } });
  $("osmFile").addEventListener("change", e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => loadUpload(String(r.result), f.name); r.readAsText(f); });
  $("btnCopyQ").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("oqText").value); $("btnCopyQ").textContent = "Copied"; } catch (e) { $("oqText").select(); } });
  $("dxfFile").addEventListener("change", e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => onDXF(String(r.result), f.name); r.readAsText(f); });
  $("geoMode").addEventListener("change", () => { geoModeUI(); }); $("btnGeoApply").addEventListener("click", reprojectDXF); $("bndPick").addEventListener("change", e => { st.dxf.idx = +e.target.value; reprojectDXF(); });
  $("bIllus").addEventListener("click", () => { st.draw = null; $("drawBox").hidden = true; $("georef").hidden = true; setBoundary(illustrativePlot(st.illusCenter || [0, 0], st.illusAng || 0), st.src === "dadar" ? "Illustrative plot near Shivaji Park (not the project site)" : "Illustrative plot", [6, 6, 6, 6], "illus"); });
  $("bDraw").addEventListener("click", () => { st.draw = []; $("drawBox").hidden = false; $("bDraw").setAttribute("aria-pressed", "true"); $("bIllus").setAttribute("aria-pressed", "false"); setTab("t-site"); setZoom("nbhd"); });
  $("drawUndo").addEventListener("click", () => { if (st.draw) { st.draw.pop(); renderMap(); } }); $("drawClear").addEventListener("click", () => { if (st.draw) { st.draw = []; renderMap(); } });
  $("drawDone").addEventListener("click", finishDraw);
  bindMapNav();
  $("mapIn").addEventListener("click", () => zoomMap(1 / 1.5)); $("mapOut").addEventListener("click", () => zoomMap(1.5)); $("mapFit").addEventListener("click", () => setZoom("plot"));
  $("envYes").addEventListener("click", () => { st.isEnv = true; pressEnv(); recomputeEnv(); });
  $("envNo").addEventListener("click", () => { st.isEnv = false; pressEnv(); recomputeEnv(); setTab("t-site"); setZoom("plot"); });
  $("btnRun").addEventListener("click", runSearch);
  $("lvlPick").addEventListener("change", e => { st.level = +e.target.value; renderPlan(); });
  $("coneLevel").addEventListener("change", e => { const c = st.cone; if (c) coneAt(+e.target.value, c.px, c.py); });
  $("vReset").addEventListener("click", () => st.sel ? V3D.showDesign(st.sel, { frame: true }) : V3D.resetView());
  $("vTop").addEventListener("click", V3D.topView); $("vClear").addEventListener("click", hideCone); $("vJump").addEventListener("click", jump); $("jumpExit").addEventListener("click", V3D.exitJump);
  $("btnCopy").addEventListener("click", async () => { const b = $("btnCopy"); try { await navigator.clipboard.writeText(resultsJSON()); b.textContent = "Copied"; } catch (e) { b.textContent = "Copy blocked by the browser"; } setTimeout(() => b.textContent = "Copy results JSON", 1800); });
  await changeSource("dadar");
  runSearch();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
