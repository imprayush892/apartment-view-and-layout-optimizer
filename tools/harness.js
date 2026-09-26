/* Headless engine harness (Node, no browser): load the web engine, build the Dadar or synthetic
   scene, run a search for a JSON config and print a JSON summary. Used for A/B tests and
   data-science experiments.
   Usage: node tools/harness.js '<json config>'   (see DEFAULTS below for keys) */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..", "web");
const ctx = { console, Math, JSON, Float64Array, Float32Array, Uint8Array, Int32Array, Set, Map, Array, Object, Number, String, Infinity, NaN, isFinite, parseFloat, parseInt, URL, URLSearchParams, AbortController, setTimeout, clearTimeout };
ctx.self = ctx; vm.createContext(ctx);
for (const f of ["js/engine.js", "js/geo.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
const { VT, GEO } = ctx;

const DEFAULTS = {
  site: "dadar",                 // "dadar" | "synthetic"
  plot: null,                    // [[x,y],...] local metres; default illustrative plot
  plotCenter: [-180, -130], plotAngle: 60, plotSize: [64, 52],
  setbacks: 6, fsi: 30000, hmax: 165, reserved: [],
  typologies: [["square", { width: 28 }], ["chamfered", { width: 30, depth: 26, chamfer_m: 4 }], ["twisted", { width: 28, base: "square", twist_per_floor_deg: 1.2 }], ["y_shaped", { wing_len: 17, wing_w: 18, wing_angle_deg: 120 }]],
  rotations: [0, 30], upf: [1, 2], podium: [6], ftf: 3.6, evalEvery: 4, res: 4, defaultH: undefined, heightScale: 1,
  split: "equal_value", thresholds: {}, rates: {}, maxOptions: 999,
};
function illus(c, ang, w, d) { return VT.rot(VT.box(-w / 2, -d / 2, w / 2, d / 2), ang).map(([x, y]) => [x + c[0], y + c[1]]); }
function envelope(b, s) { // uniform setback via inward offset of each edge (convex plots)
  if (!s) return b.slice(); let r = VT.ccw(b); const n = r.length, lines = [];
  for (let i = 0; i < n; i++) { const a = r[i], q = r[(i + 1) % n], L = Math.hypot(q[0] - a[0], q[1] - a[1]), nx = -(q[1] - a[1]) / L, ny = (q[0] - a[0]) / L; lines.push([[a[0] + nx * s, a[1] + ny * s], [q[0] - a[0], q[1] - a[1]]]); }
  const out = []; for (let i = 0; i < n; i++) { const [p1, d1] = lines[(i - 1 + n) % n], [p2, d2] = lines[i], den = d1[0] * d2[1] - d1[1] * d2[0], t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den; out.push([p1[0] + t * d1[0], p1[1] + t * d1[1]]); } return out;
}
function run(cfg) {
  cfg = { ...DEFAULTS, ...cfg };
  let ctxData, plot;
  if (cfg.site === "synthetic") { const s = GEO.syntheticContext(); ctxData = s.ctx; plot = cfg.plot || s.boundary; }
  else { const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data/dadar_osm.json"), "utf8")); ctxData = GEO.fromCompact(d, d.anchor, { defaultH: cfg.defaultH }); plot = cfg.plot || illus(cfg.plotCenter, cfg.plotAngle, ...cfg.plotSize); }
  if (cfg.heightScale !== 1) ctxData.buildings.forEach(b => { if (b.hsrc === "estimated") b.height *= cfg.heightScale; });
  for (const b of ctxData.buildings) b.excluded = VT.pip(...VT.centroid(b.ring), plot);
  const env = envelope(plot, cfg.setbacks), c = VT.centroid(env);
  const t0 = process.hrtime.bigint();
  const S = GEO.buildScene(ctxData, c, 3000, cfg.res);
  const V = VT.viewSettings({ res: cfg.res });
  const field = VT.siteViewField(S, env, V, [0, 25, 50, 75, 100], 10);
  const R = { depth: 13.5, span: 12, fit: 3, cant: 3, priv: 18, coreLo: 0.08, coreHi: 0.35, frontLR: 6, frontBR: 3.6,
    vcComp: { q_lr_min: 0.25, d_min: 40, alpha_max: 30, p_max: 0.5, ...(cfg.thresholds.vcComp || {}) }, vcLR: { w_min: 0.35, q_min: 0.55, ...(cfg.thresholds.vcLR || {}) }, vcBR: { w_min: 0.2, n_min: 2, ...(cfg.thresholds.vcBR || {}) }, vcGood: { q_min: 0.4 } };
  const C = { split: cfg.split, fsi: cfg.fsi, hmax: cfg.hmax, reserved: cfg.reserved, evalEvery: cfg.evalEvery, coreFixed: 95, corePer: 14, colSpacing: 8, living: 8, bed: 4.2, beds: [5, 4, 3], R,
    E: { rate: 45000, cost: 12000, rise: 0.5, carpetFactor: 0.88, mult: { premium: 1.15, good: 1, neutral: 0.9, compromised: 0.75 }, ...cfg.rates } };
  const specs = [];
  for (const [t, p] of cfg.typologies) for (const rot of cfg.rotations) for (const upf of cfg.upf) for (const pod of cfg.podium) {
    const q = { ...p }; let w = q.width, d = q.depth; delete q.width; delete q.depth;
    if (q.wing_len) { w = 2 * q.wing_len; d = q.wing_w; }
    specs.push(VT.resolveFloors({ typology: t, width: w, depth: d ?? w, p: q, position: c.map(v => +v.toFixed(3)), rotation: rot, ftf: cfg.ftf, podium: pod, upf, coreOff: 0, n: 0 }, C));
  }
  const res = [], rej = [];
  for (const sp of specs.slice(0, cfg.maxOptions)) { const ev = VT.checkCandidate(sp, env, C, field.arc); if (ev.feasible) VT.evaluateViews(ev, S, C, V); (ev.feasible ? res : rej).push(ev); }
  VT.paretoRanks(res); res.sort(VT.cmpKey);
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  const est = ctxData.buildings.filter(b => b.hsrc === "estimated").length;
  return {
    config: { site: cfg.site, evalEvery: cfg.evalEvery, res: cfg.res, heightScale: cfg.heightScale, setbacks: cfg.setbacks },
    context: { buildings: ctxData.buildings.length, estimatedHeights: est, waterCells: S.W.reduce((a, v) => a + v, 0) },
    envelope_m2: +VT.ringArea(env).toFixed(1), premiumArc: field.arc, openingHeight: field.opening,
    rose100: { meanQ: +VT.mean(Array.from(field.rose[100].quality)).toFixed(3), meanSea: +VT.mean(Array.from(field.rose[100].water)).toFixed(3) },
    feasible: res.length, rejected: rej.map(e => ({ t: e.sp.typology, upf: e.sp.upf, rot: e.sp.rotation, viol: e.viol })), seconds: +secs.toFixed(2),
    options: res.map(e => ({ id: e.id, rank: e.rank, typology: e.sp.typology, rot: e.sp.rotation, upf: e.sp.upf, floors: e.sp.n, height: e.metrics.height, gdvCr: +e.metrics.gdvCr.toFixed(1),
      units: e.metrics.units, premium: e.metrics.premium, good: e.metrics.good, neutral: e.metrics.neutral, compromised: e.metrics.compromised, livingView: +e.metrics.livingView.toFixed(3),
      efficiency: +e.metrics.efficiency.toFixed(3), rateCV: +e.metrics.rateCV.toFixed(3), risk: +e.metrics.risk.toFixed(3), slender: +e.metrics.slender.toFixed(2),
      unitClasses: e.units.map(u => u.cls[0]).join("") })),
  };
}
if (require.main === module) { const cfg = process.argv[2] ? JSON.parse(process.argv[2]) : {}; console.log(JSON.stringify(run(cfg), null, cfg.pretty ? 1 : 0)); }
module.exports = { run, VT, GEO };
