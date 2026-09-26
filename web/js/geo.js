/* Georeferencing, OpenStreetMap context and raster scene construction. Depends on engine.js (VT). */
(function (G) {
"use strict";
const { D2R, pip, bounds, centroid, ringArea, ccw } = G.VT;
const R_EARTH = 6378137.0;

/* ---------- local ENU frame (equirectangular about an anchor; < 1 cm error within a few km) */
function toLocal(lat, lon, anchor) { return [(lon - anchor[1]) * D2R * R_EARTH * Math.cos(anchor[0] * D2R), (lat - anchor[0]) * D2R * R_EARTH]; }
function toLatLon(x, y, anchor) { return [anchor[0] + y / R_EARTH / D2R, anchor[1] + x / (R_EARTH * Math.cos(anchor[0] * D2R)) / D2R]; }

/* ---------- UTM (WGS84) inverse: easting/northing -> lat/lon */
function utmToLatLon(E, N, zone, south) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = E - 500000, y = south ? N - 10000000 : N, M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256)), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = x / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
  return [lat / D2R, ((zone - 1) * 6 - 180 + 3) + lon / D2R];
}
function utmZoneOf(lon) { return Math.floor((lon + 180) / 6) + 1; }

/* ---------- building heights: OSM height > levels x 3.2 m > default by type (flagged estimated) */
const TYPE_H = { apartments: 18, residential: 15, house: 7, detached: 7, commercial: 15, office: 24, retail: 8, industrial: 10, warehouse: 9, school: 12, university: 15, hospital: 18, hotel: 24, church: 12, temple: 10, mosque: 12, garage: 3, garages: 3, shed: 3, roof: 4, hut: 3, construction: 0, yes: 12 };
function heightFor(tags, defaultH) {
  const num = v => { const m = String(v).match(/[\d.]+/); return m ? parseFloat(m[0]) : NaN; };
  if (tags.height && Number.isFinite(num(tags.height))) return { h: num(tags.height), src: "osm height" };
  if (tags["building:levels"] && Number.isFinite(num(tags["building:levels"]))) return { h: num(tags["building:levels"]) * 3.2 + (tags["roof:levels"] ? num(tags["roof:levels"]) * 3.2 : 0), src: "osm levels" };
  const t = tags.building || "yes"; return { h: defaultH ?? TYPE_H[t] ?? 12, src: "estimated", type: t };
}
const ROAD_W = { motorway: 14, trunk: 14, primary: 12, secondary: 10, tertiary: 8, residential: 6, unclassified: 6, service: 4, living_street: 5, pedestrian: 4, footway: 2, path: 2, cycleway: 2, steps: 2 };

/* ---------- parse: compact bundled snapshot (web/data/*.json) */
function fromCompact(d, anchor, opts = {}) {
  const off = toLocal(d.anchor[0], d.anchor[1], anchor), P = a => { const r = []; for (let i = 0; i < a.length; i += 2) r.push([a[i] + off[0], a[i + 1] + off[1]]); return r; };
  const ctx = emptyCtx(d.source + " · fetched " + d.fetched);
  d.buildings.forEach((b, i) => { const ring = P(b.slice(3)); if (ring.length < 3) return; const known = b[1] > 0; const h = known ? b[0] : (opts.defaultH ?? TYPE_H[b[2]] ?? 12); if (h <= 0) return; ctx.buildings.push({ id: "osm-" + i, ring, height: h, base: 0, scenario: "existing", habitable: true, hsrc: known ? (b[1] === 2 ? "osm height" : "osm levels") : "estimated", type: b[2] }); });
  ctx.roads = d.roads.map(r => ({ w: r[0], line: P(r.slice(1)) }));
  ctx.parks = d.parks.map(P); ctx.water = d.water.map(P); ctx.beach = d.beach.map(P); ctx.coast = d.coast.map(P);
  return ctx;
}
function emptyCtx(source) { return { source, buildings: [], roads: [], parks: [], water: [], beach: [], coast: [], landmarks: [] }; }

/* ---------- parse: Overpass JSON (out geom) or GeoJSON FeatureCollection */
function fromOverpass(json, anchor, opts = {}) {
  const ctx = emptyCtx("OpenStreetMap contributors (ODbL) · Overpass API");
  const L = pts => pts.map(p => toLocal(p.lat, p.lon, anchor));
  const closeOpen = r => (r.length > 2 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) ? r.slice(0, -1) : r;
  for (const e of json.elements || []) {
    const t = e.tags || {};
    const rings = e.type === "way" && e.geometry ? [L(e.geometry)] : e.type === "relation" && e.members ? e.members.filter(m => m.role === "outer" && m.geometry).map(m => L(m.geometry)) : [];
    for (const g0 of rings) {
      if (g0.length < 2) continue;
      if (t.building || t["building:part"]) { const g = closeOpen(g0); if (g.length < 3) continue; const hh = heightFor(t, opts.defaultH); if (hh.h <= 0) continue; ctx.buildings.push({ id: `osm-${e.type}-${e.id}`, ring: g, height: hh.h, base: t.min_height ? parseFloat(t.min_height) || 0 : 0, scenario: "existing", habitable: true, hsrc: hh.src, type: t.building || "part" }); }
      else if (t.highway) ctx.roads.push({ w: ROAD_W[t.highway] || 3, line: g0 });
      else if (t.natural === "coastline") ctx.coast.push(g0);
      else if (["park", "pitch", "playground", "garden", "stadium"].includes(t.leisure) || ["grass", "recreation_ground"].includes(t.landuse)) ctx.parks.push(closeOpen(g0));
      else if (t.natural === "beach" || t.natural === "sand") ctx.beach.push(closeOpen(g0));
      else if (t.natural === "water" || t.waterway === "riverbank" || t.water) ctx.water.push(closeOpen(g0));
    }
  }
  return ctx;
}
function fromGeoJSON(gj, anchor, opts = {}) {
  const els = [];
  for (const f of gj.features || []) {
    const g = f.geometry, t = f.properties || {}; if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map(p => p[0]) : g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    polys.forEach((c, i) => els.push({ type: "way", id: (f.id || els.length) + "-" + i, tags: t, geometry: c.map(([lon, lat]) => ({ lat, lon })) }));
  }
  return fromOverpass({ elements: els }, anchor, opts);
}

/* ---------- live data (works on a normal web host; blocked inside sandboxed previews) */
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
function overpassQuery(lat, lon, r) {
  const a = `(around:${r},${lat},${lon})`, ac = `(around:${Math.max(4000, 2 * r)},${lat},${lon})`;
  return `[out:json][timeout:90];(way["building"]${a};relation["building"]${a};way["building:part"]${a};way["highway"]${a};way["leisure"~"park|pitch|playground|garden|stadium"]${a};way["landuse"~"grass|recreation_ground"]${a};way["natural"~"water|beach|sand"]${ac};way["natural"="coastline"]${ac};);out geom;`;
}
async function fetchOverpass(lat, lon, r, onStatus) {
  const q = overpassQuery(lat, lon, r); let lastErr = null;
  for (const url of OVERPASS) {
    try {
      onStatus && onStatus(`Requesting OpenStreetMap data from ${new URL(url).host}…`);
      const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 100000);
      const res = await fetch(url, { method: "POST", body: new URLSearchParams({ data: q }), signal: ctrl.signal }); clearTimeout(to);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no Overpass server answered");
}
async function geocode(q) {
  const res = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&q=" + encodeURIComponent(q), { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(res.status + " " + res.statusText);
  return (await res.json()).map(r => ({ name: r.display_name, lat: +r.lat, lon: +r.lon }));
}

/* ---------- raster scene: heights, water (incl. sea from coastline), parks, habitable */
function buildScene(ctx, center, half, res, opts = {}) {
  const x0 = center[0] - half, y0 = center[1] - half, nx = Math.ceil(2 * half / res), ny = nx;
  const S = { x0, y0, res, nx, ny, H: new Float32Array(nx * ny), W: new Uint8Array(nx * ny), G: new Uint8Array(nx * ny), HAB: new Uint8Array(nx * ny), landmarks: ctx.landmarks || [], warnings: [] };
  const burn = (r, fn) => { const [a, b, c, d] = bounds(r); const j0 = Math.max(0, Math.floor((a - x0) / res)), j1 = Math.min(nx, Math.ceil((c - x0) / res) + 1), i0 = Math.max(0, Math.floor((b - y0) / res)), i1 = Math.min(ny, Math.ceil((d - y0) / res) + 1); for (let i = i0; i < i1; i++) { const y = y0 + (i + 0.5) * res; for (let j = j0; j < j1; j++) { const x = x0 + (j + 0.5) * res; if (pip(x, y, r)) fn(i * nx + j); } } };
  if (ctx.coast && ctx.coast.length) floodSea(S, ctx.coast);
  for (const w of ctx.water) burn(w, k => S.W[k] = 1);
  for (const p of ctx.parks) burn(p, k => S.G[k] = 1);
  const keep = opts.scenario === "future" ? ["existing", "future"] : ["existing"];
  for (const b of ctx.buildings) { if (!keep.includes(b.scenario) || b.excluded) continue; const top = b.base + b.height; burn(b.ring, k => { if (top > S.H[k]) S.H[k] = top; if (b.habitable) S.HAB[k] = 1; }); }
  for (let k = 0; k < S.H.length; k++) if (S.H[k] > 0) { S.W[k] = 0; S.G[k] = 0; }
  return S;
}
/* OSM coastlines have land on the left and sea on the right. Rasterise them as walls, seed the
   right-hand side of every segment and flood-fill (4-connected). A leak (land seeds flooded) is
   reported and the sea is dropped rather than flooding the city. */
function floodSea(S, coast) {
  const { nx, ny, res, x0, y0 } = S, wall = new Uint8Array(nx * ny), cell = (x, y) => [Math.floor((y - y0) / res), Math.floor((x - x0) / res)];
  const plot = (i, j) => { if (i >= 0 && i < ny && j >= 0 && j < nx) wall[i * nx + j] = 1; };
  const seedsW = [], seedsL = [];
  for (const line of coast) for (let k = 0; k + 1 < line.length; k++) {
    const [ax, ay] = line[k], [bx, by] = line[k + 1], L = Math.hypot(bx - ax, by - ay); if (!L) continue;
    const steps = Math.ceil(L / (res / 3));
    for (let s = 0; s <= steps; s++) { const t = s / steps, [i, j] = cell(ax + t * (bx - ax), ay + t * (by - ay)); plot(i, j); plot(i + 1, j); plot(i, j + 1); }
    const rx = (by - ay) / L, ry = -(bx - ax) / L, mx = (ax + bx) / 2, my = (ay + by) / 2;
    seedsW.push(cell(mx + rx * res * 2.5, my + ry * res * 2.5)); seedsL.push(cell(mx - rx * res * 2.5, my - ry * res * 2.5));
  }
  const W = new Uint8Array(nx * ny), stack = new Int32Array(nx * ny); let sp = 0;
  for (const [i, j] of seedsW) if (i >= 0 && i < ny && j >= 0 && j < nx) { const q = i * nx + j; if (!wall[q] && !W[q]) { W[q] = 1; stack[sp++] = q; } }
  while (sp) { const q = stack[--sp], i = (q / nx) | 0, j = q - i * nx; const nb = [j > 0 ? q - 1 : -1, j < nx - 1 ? q + 1 : -1, i > 0 ? q - nx : -1, i < ny - 1 ? q + nx : -1]; for (const r of nb) if (r >= 0 && !wall[r] && !W[r]) { W[r] = 1; stack[sp++] = r; } }
  let leak = 0, tot = 0; for (const [i, j] of seedsL) if (i >= 0 && i < ny && j >= 0 && j < nx) { tot++; if (W[i * nx + j]) leak++; }
  if (tot && leak / tot > 0.3) { S.warnings.push("The coastline in this area is incomplete, so the sea could not be traced. Water from lakes and rivers is still used."); return; }
  for (let q = 0; q < W.length; q++) if (W[q] || (wall[q] && neighbourWater(W, q, nx, ny))) S.W[q] = 1;
}
function neighbourWater(W, q, nx, ny) { const i = (q / nx) | 0, j = q - i * nx; let n = 0; if (j > 0 && W[q - 1]) n++; if (j < nx - 1 && W[q + 1]) n++; if (i > 0 && W[q - nx]) n++; if (i < ny - 1 && W[q + nx]) n++; return n >= 2; }

/* ---------- synthetic test site (port of src/viewtower/synthetic.py) */
function syntheticContext() {
  const { box, polysIntersect, polyDistance } = G.VT;
  const BOUNDARY = [[-35, -28], [36, -30], [38, 31], [-33, 29]];
  const SEA = [[-260, -400], [-260, 800], [-600, 3200], [-3200, 3200], [-3200, -1200], [-1200, -900], [-500, -500]], PARK = box(-80, 90, 180, 330);
  const B = (id, r, h, scen = "existing") => ({ id, ring: r, height: h, base: 0, scenario: scen, habitable: true, hsrc: "synthetic" });
  const specials = [B("B-SLAB-S", box(-30, -75, 40, -50), 48), B("B-TWR-NE", box(90, 40, 125, 75), 110), B("B-TWR-SW", box(-200, -230, -170, -200), 130), B("B-FUT-NW", box(-120, 40, -85, 75), 150, "future")];
  const taken = specials.map(s => s.ring), free = fp => !polysIntersect(SEA, fp) && !polysIntersect(PARK, fp) && polyDistance(BOUNDARY, fp) > 18 && taken.every(t => polyDistance(t, fp) > 8);
  const fabric = []; let i = 0;
  for (let x = -250; x < -60; x += 42, i++) { let j = 0; for (let y = -380; y < 780; y += 52, j++) { const fp = box(x, y, x + 30, y + 40); if (free(fp)) fabric.push(B(`B-C${i}-${j}`, fp, 15 + 3 * ((i * 7 + j * 3) % 4))); } }
  i = 0; for (let x = -40; x < 900; x += 48, i++) { let j = 0; for (let y = -900; y < 900; y += 48, j++) { const fp = box(x, y, x + 34, y + 34); if (x < 60 && -60 < y && y < 90) continue; if (free(fp)) fabric.push(B(`B-U${i}-${j}`, fp, 18 + 3 * ((i * 5 + j * 11) % 10))); } }
  const roads = [{ w: 12, line: [[-50, -900], [-50, 900]] }, { w: 10, line: [[-900, 60], [900, 60]] }, { w: 8, line: [[-255, -600], [-255, 900]] }];
  return { ctx: { source: "Synthetic test context (fictitious)", buildings: specials.concat(fabric), roads, parks: [PARK], water: [SEA], beach: [], coast: [], landmarks: [{ id: "LM-BRIDGE-PYLON", x: -1400, y: 1800, z: 126, weight: 0.5 }] }, boundary: BOUNDARY, setbacks: [9, 6, 6, 9], anchor: null };
}

G.GEO = { toLocal, toLatLon, utmToLatLon, utmZoneOf, heightFor, fromCompact, fromOverpass, fromGeoJSON, fetchOverpass, overpassQuery, geocode, buildScene, syntheticContext, TYPE_H };
})(typeof self !== "undefined" ? self : this);
