/* Typology tokens: a library of 500+ token towers, per-floor facade-segment features, an open
   ridge-regression model of view outcome per segment (the "vector dataset" weights), a deterministic
   screening rule and a probabilistic (cross-entropy) generator. Depends on engine.js (VT).
   See docs/spec/13_typology_tokens.md. Runs in the browser, in Web Workers and in Node. */
(function (G) {
"use strict";
const VT = G.VT, { D2R, R2D, mod, ringArea, bounds, centroid, perimeterPoints } = VT;

/* ---------------------------------------------------------------- vocabulary */
const BASES = ["square", "rectangular", "chamfered", "curved", "diamond", "triangular", "y_shaped", "cross", "t_shaped"];
const MODS = {
  none: { label: "plain extrusion", precedent: "432 Park Avenue (pure square)", p: {} },
  twist_lin_s: { label: "slow linear twist 0.6°/floor", precedent: "Cayan Tower (1.2°/floor), SOM", p: { twist: { rate: 0.6, mode: "linear" } } },
  twist_lin: { label: "linear twist 1.2°/floor", precedent: "Cayan Tower, SOM", p: { twist: { rate: 1.2, mode: "linear" } } },
  twist_lin_f: { label: "fast twist 2.5°/floor", precedent: "Absolute World (1–8°/floor), MAD", p: { twist: { rate: 2.5, mode: "linear" } } },
  twist_band: { label: "banded rotation 6° every 6 floors", precedent: "banded rotation (Telus Sky, frustum stacks)", p: { twist: { rate: 1.0, mode: "band", band: 6 } } },
  twist_ease: { label: "eased twist (S-curve)", precedent: "Absolute World variable twist", p: { twist: { rate: 1.5, mode: "ease" } } },
  taper_s: { label: "taper to 80 %", precedent: "tapering towers (53W53, The Shard)", p: { taper: { top: 0.8, mode: "linear" } } },
  taper_l: { label: "taper to 65 %", precedent: "Shard / Burj-style taper", p: { taper: { top: 0.65, mode: "linear" } } },
  frustum: { label: "stacked frustums ±8 % per 10 floors", precedent: "St. Regis / Vista Tower, Studio Gang", p: { taper: { top: 1.08, mode: "frustum", period: 10 } } },
  bulge: { label: "bulging middle", precedent: "30 St Mary Axe profile", p: { taper: { top: 1.1, mode: "bulge" } } },
  stagger2: { label: "alternating 1.5 m stagger", precedent: "Kanchanjunga split levels; stacked stagger", p: { shift: { amp: 1.5, mode: "stagger", period: 2, dir: "view" } } },
  stagger4: { label: "stagger every 4 floors", precedent: "56 Leonard (stacked cantilevers)", p: { shift: { amp: 2.5, mode: "stagger", period: 4, dir: "view" } } },
  lean_view: { label: "lean 6 m toward the view", precedent: "Vancouver House (unfolding above clearance)", p: { shift: { amp: 6, mode: "lean", dir: "view" } } },
  lean_away: { label: "lean 6 m away from the view", precedent: "control (lean away)", p: { shift: { amp: 6, mode: "lean", dir: "anti" } } },
  wave: { label: "slab-edge wave 1.5 m", precedent: "Aqua Tower (undulating slabs), Studio Gang", p: { shift: { amp: 1.5, mode: "wave", period: 12, dir: "view" } } },
  pixel: { label: "pixel shifts by 4-floor bands", precedent: "56 Leonard 'Jenga', MVRDV Valley", p: { shift: { amp: 2, mode: "pixel", period: 4, dir: "view" } } },
  terrace_view: { label: "terraces stepping toward the view", precedent: "Mountain Dwellings, Habitat 67, Doshi LIC", p: { terrace: { every: 4, step: 2.5, dir: "view" } } },
  terrace_anti: { label: "terraces stepping away from the view", precedent: "8 House height gradient", p: { terrace: { every: 4, step: 2.5, dir: "anti" } } },
  feather: { label: "feathered setbacks every 3 floors", precedent: "111 West 57th (SHoP)", p: { terrace: { every: 3, step: 1.0, dir: "view" }, taper: { top: 0.85, mode: "linear" } } },
  cut3: { label: "corner garden cut-outs every 3 floors", precedent: "Kanchanjunga (Correa) double-height gardens", p: { cut: { every: 3, size: 3 } } },
  cut6: { label: "corner garden cut-outs every 6 floors", precedent: "Kanchanjunga / sky gardens (Waves, Puri)", p: { cut: { every: 6, size: 3 } } },
  twist_taper: { label: "twist 1.2° + taper 80 %", precedent: "Cayan + taper", p: { twist: { rate: 1.2, mode: "linear" }, taper: { top: 0.8, mode: "linear" } } },
  twist_terrace: { label: "banded twist + terraces to the view", precedent: "Spiral terraces (BIG)", p: { twist: { rate: 1.0, mode: "band", band: 6 }, terrace: { every: 4, step: 2, dir: "view" } } },
  lean_terrace: { label: "lean + terraces toward the view", precedent: "VIA 57 / Vancouver House hybrid", p: { shift: { amp: 4, mode: "lean", dir: "view" }, terrace: { every: 5, step: 2, dir: "view" } } },
  stagger_cut: { label: "stagger + corner gardens", precedent: "Kanchanjunga + stagger", p: { shift: { amp: 1.5, mode: "stagger", period: 2, dir: "view" }, cut: { every: 4, size: 3 } } },
  frustum_twist: { label: "frustums + banded rotation", precedent: "Vista Tower + band rotation", p: { taper: { top: 1.08, mode: "frustum", period: 10 }, twist: { rate: 1.0, mode: "band", band: 10 } } },
  pixel_terrace: { label: "pixels + terraces", precedent: "Telus Sky pixelation (BIG)", p: { shift: { amp: 2, mode: "pixel", period: 4, dir: "view" }, terrace: { every: 6, step: 2, dir: "view" } } },
  wave_taper: { label: "wave + taper", precedent: "Aqua + taper", p: { shift: { amp: 1.5, mode: "wave", period: 12, dir: "view" }, taper: { top: 0.85, mode: "linear" } } },
};
const SIZES = { square: [[24, 24], [28, 28], [32, 32]], rectangular: [[34, 22], [40, 24], [30, 20]], chamfered: [[28, 24], [32, 26], [26, 22]], curved: [[28, 24], [32, 30], [26, 26]],
  diamond: [[30, 30], [36, 36], [26, 26]], triangular: [[34, 32], [40, 36], [30, 28]], y_shaped: [[32, 16], [36, 18], [28, 14]], cross: [[36, 14], [40, 16], [32, 12]], t_shaped: [[34, 16], [38, 18], [30, 14]] };
const BASEP = { chamfered: { chamfer_m: 4 }, curved: { exponent: 3 }, triangular: { chamfer_m: 3 }, y_shaped: { wing_angle_deg: 120 } };

/* 9 bases x 2 sizes x 28 token sets = 504 typologies (plus a third size for plain shapes) */
function library() {
  const out = [];
  for (const b of BASES) SIZES[b].forEach(([w, d], si) => {
    for (const [mk, m] of Object.entries(MODS)) {
      if (si === 2 && mk !== "none" && !mk.startsWith("twist_lin")) continue;
      const p = { base: b, ...(BASEP[b] || {}), ...JSON.parse(JSON.stringify(m.p)) };
      if (b === "y_shaped" || b === "cross" || b === "t_shaped") { p.wing_len = w / 2; p.wing_w = d; }
      out.push({ id: `${b}-${w}x${d}-${mk}`, base: b, width: w, depth: d, mod: mk, label: `${b.replace("_", "-")} ${w}×${d} m, ${m.label}`, precedent: m.precedent, p });
    }
  });
  return out;
}

/* Resolve "view"/"anti" directions to a site azimuth. */
function resolveDirs(p, viewAz) { const q = JSON.parse(JSON.stringify(p)); for (const k of ["shift", "terrace"]) if (q[k] && typeof q[k].dir === "string") q[k].dir = q[k].dir === "view" ? viewAz : mod(viewAz + 180, 360); return q; }
function toSpec(typ, pos, rot, viewAz, C, ftf = 3.6, podium = 6, upf = 2, env = null) {
  const p = resolveDirs(typ.p, viewAz); if (p.podiumBase && env) p.podiumWorld = env.map(q => q.slice()); // base token: podium to the street wall
  return VT.resolveFloors({ typology: "token", width: typ.width, depth: typ.depth, p, position: pos, rotation: rot, ftf, podium, upf, coreOff: 0, n: 0, lib: typ.id }, C);
}

/* ---------------------------------------------------------------- token vector (per tower) */
const TOKEN_KEYS = ["base_" + BASES.join(",base_"), "twist_rate", "twist_band", "twist_ease", "taper_top", "taper_frustum", "taper_bulge", "shift_amp", "shift_stagger", "shift_lean", "shift_wave", "shift_pixel", "shift_to_view",
  "terrace_step", "terrace_to_view", "cut", "aspect", "rotation_to_view"].join(",").split(",");
function tokenVector(sp, viewAz) {
  const p = sp.p, v = {}; for (const k of TOKEN_KEYS) v[k] = 0; v["base_" + (p.base || "square")] = 1;
  if (p.twist) { v.twist_rate = p.twist.rate || 0; v.twist_band = p.twist.mode === "band" ? 1 : 0; v.twist_ease = p.twist.mode === "ease" ? 1 : 0; }
  if (p.taper) { v.taper_top = (p.taper.top ?? 1) - 1; v.taper_frustum = p.taper.mode === "frustum" ? 1 : 0; v.taper_bulge = p.taper.mode === "bulge" ? 1 : 0; }
  if (p.shift) { v.shift_amp = p.shift.amp || 0; v["shift_" + (p.shift.mode || "stagger")] = 1; v.shift_to_view = viewAz == null ? 0 : Math.cos((mod((p.shift.dir || 0) - viewAz + 180, 360) - 180) * D2R); }
  if (p.terrace) { v.terrace_step = p.terrace.step || 0; v.terrace_to_view = viewAz == null ? 0 : Math.cos((mod((p.terrace.dir || 0) - viewAz + 180, 360) - 180) * D2R); }
  if (p.cut) v.cut = (p.cut.size || 0) / Math.max(1, p.cut.every || 1);
  v.aspect = sp.width / Math.max(1, sp.depth); v.rotation_to_view = viewAz == null ? 0 : Math.cos(2 * (mod(sp.rotation - viewAz, 360)) * D2R);
  return v;
}

/* ---------------------------------------------------------------- site view field lookups */
function roseAt(field, key, az, z) { // bilinear in azimuth and height
  const H = field.heights, i = Math.max(0, Math.min(H.length - 2, H.findIndex((h, k) => k === H.length - 1 || H[k + 1] >= z))), h0 = H[i], h1 = H[i + 1] ?? h0, f = h1 > h0 ? Math.max(0, Math.min(1, (z - h0) / (h1 - h0))) : 0;
  const n = field.az.length, step = field.az[1] - field.az[0], a = mod(az, 360) / step, j0 = Math.floor(a) % n, j1 = (j0 + 1) % n, g = a - Math.floor(a);
  const v = hh => { const r = field.rose[hh][key]; return r[j0] * (1 - g) + r[j1] * g; };
  return v(h0) * (1 - f) + v(h1) * f;
}
function viewAzOf(field) { if (field.arc) return mod(field.arc[0] + mod(field.arc[1] - field.arc[0], 360) / 2, 360); const top = field.heights[field.heights.length - 1], r = field.rose[top].quality; let b = 0; r.forEach((v, i) => { if (v > r[b]) b = i; }); return field.az[b]; }

/* ---------------------------------------------------------------- facade segments (per floor) */
/* Split a plate's facade into segments of similar normal (<= 20° apart, <= 12 m) and describe each. */
function segments(plate, below, spacing = 2) {
  const pp = perimeterPoints(plate, spacing), segs = []; let cur = null;
  pp.pts.forEach((pt, i) => { const nz = pp.normals[i]; if (!cur || Math.abs(mod(nz - cur.n0 + 180, 360) - 180) > 20 || cur.idx.length * spacing >= 12) { cur = { n0: nz, idx: [] }; segs.push(cur); } cur.idx.push(i); });
  const cb = below ? centroid(below) : null;
  return segs.map(sg => {
    const pts = sg.idx.map(i => pp.pts[i]), nz = mod(Math.atan2(sg.idx.reduce((a, i) => a + Math.sin(pp.normals[i] * D2R), 0), sg.idx.reduce((a, i) => a + Math.cos(pp.normals[i] * D2R), 0)) * R2D, 360);
    const c = centroid(pts.length > 2 ? pts : pts.concat(pts)), ux = Math.sin(nz * D2R), uy = Math.cos(nz * D2R);
    let out = 0; if (below) { const [x0, y0, x1, y1] = bounds(below); const proj = below.map(q => (q[0] - c[0]) * ux + (q[1] - c[1]) * uy); out = -Math.max(...proj); } // >0: this facade overhangs the floor below
    const turn = sg.idx.length > 1 ? Math.abs(mod(pp.normals[sg.idx[sg.idx.length - 1]] - pp.normals[sg.idx[0]] + 180, 360) - 180) : 0;
    return { idx: sg.idx, normal: nz, len: sg.idx.length * spacing, c, overhang: out, curvature: turn / Math.max(spacing, sg.idx.length * spacing) };
  });
}

/* Feature vector of one facade segment (used both for the dataset and the model). */
const FEAT = ["bias", "rose_prize", "rose_q", "rose_prize_x_z", "rel_cos", "rel_cos_pos", "prize_x_relcos", "q_x_relcos", "z_rel", "z_rel_sq", "above_ctx", "len", "overhang", "curvature", "corner",
  "twist_rate", "taper_top", "shift_amp", "shift_to_view", "terrace_step", "terrace_to_view", "cut", "aspect", "dense", "near", "near_hab", "probe_prize"];
/* One ray straight out of the facade: how close the first thing in front is, and whether it is someone's home. */
function probe(S, V, seg, z, own) { const ux = Math.sin(seg.normal * D2R), uy = Math.cos(seg.normal * D2R), tmp = {}; VT.castRay(S, seg.c[0] + 0.75 * ux, seg.c[1] + 0.75 * uy, z, seg.normal, V.D, V.P, own, tmp); return { near: 1 / (1 + tmp.dObs / 25), hab: tmp.hab && tmp.dObs < 60 ? 1 : 0, prize: tmp.prize }; }
function segFeatures(seg, z, field, viewAz, ctxH, tv, dense, H, pr) {
  const rp = roseAt(field, "prize", seg.normal, z), rq = roseAt(field, "quality", seg.normal, z), rel = Math.cos((mod(seg.normal - viewAz + 180, 360) - 180) * D2R);
  const zr = z / Math.max(1, H);
  return [1, rp, rq, rp * zr, rel, Math.max(0, rel), rp * Math.max(0, rel), rq * Math.max(0, rel), zr, zr * zr, Math.max(-1, Math.min(2, (z - ctxH) / Math.max(10, ctxH))), seg.len / 12, Math.max(-3, Math.min(3, seg.overhang)) / 3, Math.min(1, seg.curvature * 10), seg.len < 6 ? 1 : 0,
    tv.twist_rate, tv.taper_top, tv.shift_amp / 6, tv.shift_to_view, tv.terrace_step / 3, tv.terrace_to_view, tv.cut, Math.min(3, tv.aspect) - 1, dense ? 1 : 0, pr ? pr.near : 0, pr ? pr.hab : 0, pr ? pr.prize : 0];
}
/* Median building height around a point (context datum for "above the neighbours"). */
function contextHeight(S, x, y, r = 200) { const hs = []; for (let yy = y - r; yy <= y + r; yy += 12) for (let xx = x - r; xx <= x + r; xx += 12) { const j = Math.floor((xx - S.x0) / S.res), i = Math.floor((yy - S.y0) / S.res); if (i >= 0 && j >= 0 && i < S.ny && j < S.nx && S.H[i * S.nx + j] > 0) hs.push(S.H[i * S.nx + j]); } hs.sort((a, b) => a - b); return hs.length ? hs[hs.length >> 1] : 0; }

/* Dataset rows from one fully evaluated tower (VT.evaluateViews must have run: needs ev.apByLevel). */
function rowsFromEval(ev, S, field, viewAz, dense, siteId, V) {
  const sp = ev.sp, tv = tokenVector(sp, viewAz), ctxH = contextHeight(S, ...sp.position), H = sp.n * sp.ftf, rows = [];
  for (const l of ev.evaluated) {
    const ap = ev.apByLevel && ev.apByLevel[l]; if (!ap) continue; const plate = ev.plates[l], below = ev.plates[l - 1], z = l * sp.ftf + 1.5, own = { ring: plate, bb: bounds(plate), top: H };
    for (const sg of segments(plate, below, 2)) {
      const idx = sg.idx.filter(i => i < ap.quality.length); if (!idx.length) continue;
      const y = { q: VT.mean(idx.map(i => ap.quality[i])), prize: VT.mean(idx.map(i => ap.prize[i])), priv: VT.mean(idx.map(i => ap.privacy[i])) };
      rows.push({ site: siteId, lib: sp.lib || sp.typology, level: l, z: +z.toFixed(1), normal: +sg.normal.toFixed(1), len: sg.len, x: segFeatures(sg, z, field, viewAz, ctxH, tv, dense, H, V ? probe(S, V, sg, z, own) : null).map(v => +v.toFixed(4)), y });
    }
  }
  return rows;
}

/* ---------------------------------------------------------------- ridge regression (open weights) */
function ridge(X, Y, lambda = 1e-2) {
  const d = X[0].length, A = Array.from({ length: d }, () => new Float64Array(d)), b = new Float64Array(d);
  for (let r = 0; r < X.length; r++) { const x = X[r], y = Y[r]; for (let i = 0; i < d; i++) { b[i] += x[i] * y; for (let j = i; j < d; j++) A[i][j] += x[i] * x[j]; } }
  for (let i = 0; i < d; i++) { for (let j = 0; j < i; j++) A[i][j] = A[j][i]; A[i][i] += lambda * X.length * (i === 0 ? 0 : 1); }
  // Gaussian elimination
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < d; c++) { let p = c; for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; const piv = M[c][c] || 1e-12; for (let r = 0; r < d; r++) if (r !== c) { const f = M[r][c] / piv; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((row, i) => row[d] / (row[i] || 1e-12));
}
function train(rows, lambda) {
  const X = rows.map(r => r.x), w = {}; for (const t of ["q", "prize", "priv"]) w[t] = ridge(X, rows.map(r => r.y[t]), lambda);
  const pred = (x, t) => x.reduce((a, v, i) => a + v * w[t][i], 0), r2 = t => { const ys = rows.map(r => r.y[t]), m = VT.mean(ys), ss = ys.reduce((a, y) => a + (y - m) ** 2, 0), se = rows.reduce((a, r) => a + (r.y[t] - pred(r.x, t)) ** 2, 0); return ss ? 1 - se / ss : 0; };
  return { features: FEAT, weights: w, r2: { q: r2("q"), prize: r2("prize"), priv: r2("priv") }, n: rows.length, lambda };
}
const predict = (model, x, t) => Math.max(0, Math.min(1, x.reduce((a, v, i) => a + v * model.weights[t][i], 0)));

/* ---------------------------------------------------------------- scoring a candidate without rays */
/* Model score: predicted living-quality proxy over sampled floors (facade-length weighted), share of
   facade predicted to have a prize view (sea/skyline) above the premium line, minus predicted privacy. */
function modelScore(model, sp, field, viewAz, ctxH, dense, W = { q: 1, prize: 0.6, priv: 0.4, complexity: 0.05 }, S, V) {
  const tv = tokenVector(sp, viewAz), H = sp.n * sp.ftf; let q = 0, pz = 0, pv = 0, L = 0;
  for (let l = sp.podium; l < sp.n; l += 4) { const plate = VT.plateAt(sp, l), below = l > 0 ? VT.plateAt(sp, l - 1) : null, z = l * sp.ftf + 1.5, own = { ring: plate, bb: bounds(plate), top: H };
    for (const sg of segments(plate, below, 3)) { const x = segFeatures(sg, z, field, viewAz, ctxH, tv, dense, H, S && V ? probe(S, V, sg, z, own) : null); q += sg.len * predict(model, x, "q"); const p = predict(model, x, "prize"); pz += sg.len * (p >= 0.45 ? 1 : p / 0.45 * 0.5); pv += sg.len * predict(model, x, "priv"); L += sg.len; } }
  if (!L) return -1;
  const complexity = Math.abs(tv.twist_rate) / 2.5 + Math.abs(tv.shift_amp) / 6 + tv.cut;
  return W.q * q / L + W.prize * pz / L - W.priv * pv / L - W.complexity * complexity;
}
/* Deterministic hand rule (no learning): facade length x view-field prize and quality in each facade's
   direction at its height, favouring faces turned to the view. */
function ruleScore(sp, field, viewAz) {
  let s = 0, L = 0;
  for (let l = sp.podium; l < sp.n; l += 4) { const plate = VT.plateAt(sp, l), z = l * sp.ftf + 1.5;
    for (const sg of segments(plate, null, 3)) { s += sg.len * (0.6 * roseAt(field, "prize", sg.normal, z) + 0.4 * roseAt(field, "quality", sg.normal, z)); L += sg.len; } }
  return L ? s / L : -1;
}

/* ---------------------------------------------------------------- architect-appeal model */
/* Features of a whole design that architects can see in an image (tokens, proportion, base, crown, towers).
   Fitted by ridge regression on the architects' overall ratings (tools/study/appeal.js). */
const APPEAL_FEAT = ["bias", "twist", "twist_rate", "taper", "taper_frustum", "taper_bulge", "shift", "shift_lean", "shift_pixel", "terrace", "cut", "podium", "crown", "crown_turn", "slender", "slender_sq", "aspect", "towers", "curved_or_chamfered", "wings", "diamond_or_tri", "tall"];
function appealFeatures(sp, viewAz, towers = 1) {
  const p = sp.p || {}, b = p.base || sp.typology, H = sp.n * sp.ftf, slender = H / Math.max(8, Math.min(sp.width, sp.depth)) / 10;
  return [1, p.twist ? 1 : 0, p.twist ? Math.min(3, p.twist.rate || 0) : 0, p.taper ? 1 : 0, p.taper && p.taper.mode === "frustum" ? 1 : 0, p.taper && p.taper.mode === "bulge" ? 1 : 0, p.shift ? 1 : 0, p.shift && p.shift.mode === "lean" ? 1 : 0, p.shift && p.shift.mode === "pixel" ? 1 : 0,
    p.terrace ? 1 : 0, p.cut ? 1 : 0, p.podiumBase || p.podiumWorld ? 1 : 0, p.crown ? 1 : 0, p.crown && p.crown.rot ? 1 : 0, slender, slender * slender, Math.min(2.5, sp.width / Math.max(1, sp.depth)) - 1, (towers - 1) / 3,
    b === "curved" || b === "chamfered" ? 1 : 0, b === "y_shaped" || b === "cross" || b === "t_shaped" ? 1 : 0, b === "diamond" || b === "triangular" ? 1 : 0, Math.min(2, H / 200)];
}
/* Appeal rule for the hybrid (v3, after the third architect round): among feasible options within tolerance of
   the engine's top option (sales value within 15 %, strong-view share within 30 points, compromised flats at
   most 10 % of flats more), put first the one the architect-appeal model rates highest. The model predicts
   architects' pairwise choice 70 % of the time out of sample; the engine's view and value metrics 53 %.
   evs must already be sorted by VT.cmpKey. Returns the (re)ordered list. */
function appealPick(evs, m, viewAz, tol = { value: 0.15, premium: 0.30, comp: 0.10 }) {
  if (!m || !evs.length) return evs; const t = evs[0], M = t.metrics, val = e => e.metrics.gdv ?? 0, ps = e => e.metrics.premium / Math.max(1, e.metrics.units);
  const near = evs.filter(e => e.feasible !== false && val(e) >= val(t) * (1 - tol.value) && ps(e) >= ps(t) - tol.premium && e.metrics.compromised / Math.max(1, e.metrics.units) <= M.compromised / Math.max(1, M.units) + tol.comp);
  if (near.length < 2) return evs; const sc = e => appealScore(m, (e.towers || [e])[0].sp, viewAz, (e.towers || [e]).length);
  const best = near.reduce((a, b) => sc(b) > sc(a) + 1e-9 ? b : a, t); if (best === t) return evs;
  best.appealPick = { over: t.id, delta: +(10 * (sc(best) - sc(t))).toFixed(2) }; return [best, ...evs.filter(e => e !== best)];
}
function appealScore(m, sp, viewAz, towers) { const x = appealFeatures(sp, viewAz, towers); return (x.reduce((a, v, i) => a + v * (m.w[i] || 0), 0) - (m.mean || 6)) / 10; }

/* ---------------------------------------------------------------- probabilistic generator (cross-entropy) */
/* Distribution over tokens: categorical (base, twist mode, taper mode, shift mode) + Gaussians (sizes,
   rates, amplitudes, rotation). Sample, score with the model, refit to the elite, repeat. Seeded. */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const CATS = { base: BASES, twist: ["none", "linear", "band", "ease"], taper: ["none", "linear", "frustum", "bulge"], shift: ["none", "stagger", "lean", "wave", "pixel"], terrace: ["none", "view"], cut: ["none", "cut"], podium: ["none", "street"], crown: ["none", "crown", "crown_turn"] };
function initDist(prior) {
  const d = { cat: {}, num: { size: [28, 5], aspect: [1.2, 0.3], rate: [1.2, 0.8], top: [0.85, 0.12], amp: [2.5, 1.5], step: [2.2, 0.8], rot: [0, 30] } };
  for (const [k, vals] of Object.entries(CATS)) { d.cat[k] = {}; vals.forEach(v => d.cat[k][v] = (prior && prior[k] && prior[k][v]) ?? 1 / vals.length); }
  return d;
}
function sampleCat(r, probs) { const e = Object.entries(probs), t = e.reduce((a, [, p]) => a + p, 0); let u = r() * t; for (const [k, p] of e) { u -= p; if (u <= 0) return k; } return e[e.length - 1][0]; }
function sampleGenome(r, dist) {
  const g = {}; for (const k of Object.keys(CATS)) g[k] = sampleCat(r, dist.cat[k]);
  for (const [k, [m, s]] of Object.entries(dist.num)) g[k] = m + s * gauss(r);
  g.size = Math.max(16, Math.min(42, g.size)); g.aspect = Math.max(1, Math.min(2, g.aspect)); g.rate = Math.max(0.2, Math.min(4, g.rate)); g.top = Math.max(0.55, Math.min(1.15, g.top)); g.amp = Math.max(0.5, Math.min(6, g.amp)); g.step = Math.max(1, Math.min(4, g.step));
  return g;
}
function genomeToTyp(g) {
  const b = g.base, wing = b === "y_shaped" || b === "cross" || b === "t_shaped", w = +g.size.toFixed(1), d = +(wing ? g.size / (2 * g.aspect) : g.size / g.aspect).toFixed(1), p = { base: b, ...(BASEP[b] || {}) };
  if (wing) { p.wing_len = w / 2; p.wing_w = Math.max(10, d); }
  if (g.twist !== "none") p.twist = { rate: +g.rate.toFixed(2), mode: g.twist, band: 6 };
  if (g.taper !== "none") p.taper = { top: +g.top.toFixed(3), mode: g.taper, period: 10 };
  if (g.shift !== "none") p.shift = { amp: +g.amp.toFixed(2), mode: g.shift, period: g.shift === "stagger" ? 2 : 4, dir: "view" };
  if (g.terrace !== "none") p.terrace = { every: 4, step: +g.step.toFixed(2), dir: "view" };
  if (g.cut !== "none") p.cut = { every: 4, size: 3 };
  if (g.podium === "street") p.podiumBase = true;
  if (g.crown && g.crown !== "none") p.crown = { floors: 6, scale: 0.72, rot: g.crown === "crown_turn" ? 12 : 0 };
  return { id: `gen-${b}-${w}x${Math.max(10, d)}-${g.twist}-${g.taper}-${g.shift}-${g.terrace}-${g.cut}-${g.podium || "none"}-${g.crown || "none"}`, base: b, width: w, depth: wing ? Math.max(10, d) : Math.max(12, d), mod: "generated", label: "generated", precedent: "probabilistic generator", p, rotOff: g.rot };
}
function refit(dist, elite, alpha = 0.7) {
  const nd = JSON.parse(JSON.stringify(dist));
  for (const k of Object.keys(CATS)) { const cnt = {}; CATS[k].forEach(v => cnt[v] = 0.5); elite.forEach(e => cnt[e.g[k]]++); const t = Object.values(cnt).reduce((a, b) => a + b, 0); for (const v of CATS[k]) nd.cat[k][v] = alpha * cnt[v] / t + (1 - alpha) * dist.cat[k][v]; }
  for (const k of Object.keys(dist.num)) { const vs = elite.map(e => e.g[k]), m = VT.mean(vs), s = Math.sqrt(VT.mean(vs.map(v => (v - m) ** 2))) + 1e-3; nd.num[k] = [alpha * m + (1 - alpha) * dist.num[k][0], Math.max(dist.num[k][1] * 0.3, alpha * s + (1 - alpha) * dist.num[k][1])]; }
  return nd;
}
/* Returns the best distinct candidates (as token typologies + rotation) for full evaluation. */
function generate(model, field, env, C, opts = {}) {
  const r = rng(opts.seed || 1), viewAz = viewAzOf(field), ctxH = opts.ctxH || 0, dense = !!opts.dense, pos = opts.position || centroid(env);
  let dist = initDist(opts.prior); if (opts.numPrior) Object.assign(dist.num, opts.numPrior); const seen = new Map();
  // adapt the plate-size prior to the plot: sample around 85 % of the envelope's narrowest width (a 28 m prior fits
  // nothing on a 30 m plot), and shrink any plate that still does not fit in 6 % steps down to 16 m, as the hand-set mode does
  const wEnv = VT.minWidth(env), sMax = Math.max(16, 1.1 * wEnv), [sm, ss] = dist.num.size || [28, 5];
  dist.num.size = [Math.min(sm, Math.max(18, 0.85 * wEnv)), Math.min(ss, Math.max(2, 0.12 * wEnv))];
  const fit = sp => { if (sp.n > sp.podium && VT.fitsAt(sp, env)) return sp; for (let k = 0.94, i = 0; i < 20; i++, k *= 0.94) { const q = VT.resolveFloors(VT.scaleSpec({ ...sp, n: 0 }, k), C); if (Math.min(q.width, q.depth) < 16) break; if (q.n > q.podium && VT.fitsAt(q, env)) return q; } return null; };
  const build = g => { const typ = genomeToTyp(g), rotd = mod(viewAz + g.rot, 360) % 90; const sp0 = toSpec(typ, pos, +rotd.toFixed(1), viewAz, C, opts.ftf, opts.podium, opts.upf, env); return { typ, sp: fit(sp0) || sp0 }; };
  const okSp = sp => sp.n > sp.podium && VT.fitsAt(sp, env) && (!opts.check || opts.check(sp));
  // repair ladder: on small plates the core stops fitting once the top tapers or is cut away, so simplify step by step before rejecting
  const LADDER = [{}, { taper: "none", crown: "none" }, { taper: "none", crown: "none", cut: "none", terrace: "none" }, { taper: "none", crown: "none", cut: "none", terrace: "none", shift: "none" }, { taper: "none", crown: "none", cut: "none", terrace: "none", shift: "none", twist: "none" }, { base: "chamfered", aspect: 1, taper: "none", crown: "none", cut: "none", terrace: "none", shift: "none" }, { base: "square", aspect: 1, taper: "none", crown: "none", cut: "none", terrace: "none", shift: "none", twist: "none" }];
  const evalG = g => { g.size = Math.min(g.size, sMax); let typ, sp;
    for (const fix of LADDER) { const gg = { ...g, ...fix }; ({ typ, sp } = build(gg)); if (okSp(sp)) { if (Object.keys(fix).length) Object.assign(g, fix); break; } sp = null; }
    if (!sp) { const b = build(g); return { g, typ: b.typ, sp: b.sp, s: -1, ok: false }; }
    return { g, typ, sp, ok: true, s: modelScore(model, sp, field, viewAz, ctxH, dense, opts.W, opts.S, opts.V) + (opts.appeal ? (opts.W && opts.W.appeal || 0.3) * appealScore(opts.appeal, sp, viewAz, opts.towers || 1) : 0) }; };
  for (let it = 0; it < (opts.iters || 6); it++) {
    const pop = []; for (let k = 0; k < (opts.pop || 80); k++) pop.push(evalG(sampleGenome(r, dist)));
    pop.forEach(c => { if (c.ok) seen.set(c.typ.id + "@" + c.sp.rotation + "@" + c.sp.width, c); });
    const elite = pop.filter(c => c.ok).sort((a, b) => b.s - a.s).slice(0, Math.max(4, Math.round((opts.pop || 80) * 0.15)));
    if (elite.length >= 4) dist = refit(dist, elite);
  }
  return [...seen.values()].sort((a, b) => b.s - a.s).slice(0, opts.top || 4);
}

G.TOK = { BASES, MODS, library, resolveDirs, toSpec, tokenVector, TOKEN_KEYS, roseAt, viewAzOf, segments, FEAT, segFeatures, probe, APPEAL_FEAT, appealFeatures, appealScore, appealPick, contextHeight, rowsFromEval, ridge, train, predict, modelScore, ruleScore, rng, initDist, sampleGenome, genomeToTyp, generate, CATS };
})(typeof self !== "undefined" ? self : this);
