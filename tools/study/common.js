/* Shared helpers for the architect study: random sites on real city blocks, scenes, fields. */
const H = require("../harness.js"), { VT, GEO, TOK, PC } = H, fs = require("fs"), path = require("path");
const CITIES = {
  dadar: { label: "Dadar, Mumbai", fsiRatio: [4, 8], hmax: [120, 200], setback: [3, 9], dense: false },
  nyc_lower: { label: "Lower Manhattan, New York", fsiRatio: [8, 15], hmax: [150, 320], setback: [0, 4], dense: true },
  nyc_midtown: { label: "Midtown Manhattan, New York", fsiRatio: [8, 15], hmax: [150, 320], setback: [0, 4], dense: true },
  ldn_city: { label: "City of London", fsiRatio: [6, 12], hmax: [100, 230], setback: [0, 5], dense: true },
  ldn_canary: { label: "Canary Wharf, London", fsiRatio: [6, 12], hmax: [120, 240], setback: [2, 6], dense: true },
};
const available = () => Object.keys(CITIES).filter(k => fs.existsSync(path.join(__dirname, "..", "..", "web", "data", k + "_osm.json")));
const CTX = {};
function context(key) {
  if (!CTX[key]) { const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "web", "data", key + "_osm.json"), "utf8")); CTX[key] = GEO.fromCompact(d, d.anchor, {}); CTX[key].profile = d.profile || (key === "dadar" ? "coastal" : "dense"); }
  return CTX[key];
}
/* a coarse scene of the whole snapshot, for picking plot locations (land, not water, not on a supertall) */
const PICK = {};
function pickScene(key) { if (!PICK[key]) PICK[key] = GEO.buildScene(context(key), [0, 0], 1500, 8); return PICK[key]; }
function cellOf(S, x, y) { const j = Math.floor((x - S.x0) / S.res), i = Math.floor((y - S.y0) / S.res); return i >= 0 && j >= 0 && i < S.ny && j < S.nx ? i * S.nx + j : -1; }
/* A random polygon "drawn" by an architect: 3-8 corners around a land point, radius 18-55 m, irregular. */
function randomSite(key, r) {
  const S = pickScene(key), city = CITIES[key];
  for (let tries = 0; tries < 400; tries++) {
    const a = r() * 2 * Math.PI, d = 60 + r() * (key === "dadar" ? 600 : 750), cx = d * Math.sin(a), cy = d * Math.cos(a);
    const k = 3 + Math.floor(r() * 6), R0 = 20 + r() * 55, rot0 = r() * 360, ring = [];
    const angs = Array.from({ length: k }, (_, i) => (i + 0.25 + 0.5 * r()) / k * 360 + rot0);
    for (const t of angs) { const rr = R0 * (0.7 + 0.6 * r()); ring.push([+(cx + rr * Math.sin(t * Math.PI / 180)).toFixed(1), +(cy + rr * Math.cos(t * Math.PI / 180)).toFixed(1)]); }
    const area = VT.ringArea(ring); if (area < 900) continue;
    let bad = false; for (let y = cy - R0; y <= cy + R0 && !bad; y += 6) for (let x = cx - R0; x <= cx + R0; x += 6) { if (!VT.pip(x, y, ring)) continue; const c = cellOf(S, x, y); if (c < 0 || S.W[c] || S.H[c] > 120) { bad = true; break; } }
    if (bad) continue;
    const u = (lo, hi) => lo + r() * (hi - lo), ratio = u(...city.fsiRatio), hmax = Math.round(u(...city.hmax) / 5) * 5, sb = +u(...city.setback).toFixed(1);
    return { city: key, ring: VT.ccw(ring), area: Math.round(area), fsi: Math.round(area * ratio / 100) * 100, hmax, setbacks: ring.map(() => sb) };
  }
  return null;
}
/* Scene + envelope + view field for a site (buildings touching the plot are removed). */
function prepare(site, opts = {}) {
  const ctx = context(site.city); for (const b of ctx.buildings) b.excluded = VT.polysIntersect(b.ring, site.ring) || VT.pip(...VT.centroid(b.ring), site.ring);
  let env = []; try { env = GEO.envelopeFromSetbacks(site.ring, site.setbacks, PC); } catch (e) { env = []; }
  if (!env.length || VT.ringArea(env) < 400) return null;
  const c = VT.centroid(env), S = GEO.buildScene(ctx, c, opts.half || 2000, 4, { plot: site.ring }); S.landmarks = ctx.landmarks || [];
  const V = VT.viewSettings({ res: 4, lmOn: !!S.landmarks.length, maxD: opts.half || 2000 });
  const heights = [0, 25, 50, 100, 150, 200, 250].filter(h => h <= site.hmax + 25), field = VT.siteViewField(S, env, V, heights, opts.fieldSpacing || 12);
  const prof = GEO.PROFILES[ctx.profile] || GEO.PROFILES.coastal;
  const R = { depth: 13.5, span: 12, fit: 3, cant: 3, priv: 18, coreLo: 0.08, coreHi: 0.35, frontLR: 6, frontBR: 3.6, vcComp: { q_lr_min: 0.25, ...prof, p_max: 0.35 }, vcLR: { w_min: 0.45, q_min: 0.6 }, vcBR: { w_min: 0.3, n_min: 0, share: 0.5 }, vcGood: { q_min: 0.4 } };
  const C = { keepAp: !!opts.keepAp, towerSep: 24, towers: site.towers || 1, split: "equal_value", fsi: site.fsi, hmax: site.hmax, reserved: [], evalEvery: opts.evalEvery || 4, refine: opts.refine !== false, coreFixed: 95, corePer: 14, colSpacing: 8, living: 8, bed: 4.2, beds: [5, 4, 3], R,
    E: { rate: 45000, cost: 12000, rise: 0.5, carpetFactor: 0.88, mult: { premium: 1.15, good: 1, neutral: 0.9, compromised: 0.75 }, pricing: "continuous", cont: { a: 0.655, b: 0.69, lo: 0.8, hi: 1.2 } } };
  const pos = bestCenter(env), viewAz = TOK.viewAzOf(field), ctxH = TOK.contextHeight(S, ...pos);
  return { ctx, env, S, V, field, C, pos, viewAz, ctxH, dense: ctx.profile === "dense" };
}
function bestCenter(env) { const [a, b, c, d] = VT.bounds(env), step = Math.max(0.5, Math.sqrt(VT.ringArea(env)) / 40); let best = VT.centroid(env), bd = VT.pip(best[0], best[1], env) ? VT.distToBoundary(best[0], best[1], env) : -1; for (let y = b + step / 2; y < d; y += step) for (let x = a + step / 2; x < c; x += step) if (VT.pip(x, y, env)) { const dd = VT.distToBoundary(x, y, env); if (dd > bd) { bd = dd; best = [x, y]; } } return [+best[0].toFixed(2), +best[1].toFixed(2)]; }
/* Shrink a spec (6 % steps) until it fits the envelope; null if it cannot. */
function fit(sp, env, C) { if (VT.fitsAt(sp, env)) return sp; for (let i = 1, k = 0.94; i <= 12; i++, k *= 0.94) { const q = VT.resolveFloors(VT.scaleSpec({ ...sp, n: 0 }, k), C); if (Math.min(q.width, q.depth) < 14) break; if (VT.fitsAt(q, env)) return q; } return null; }
/* Cheap geometry-only feasibility (no rays): lay out N towers and run the hard rules on each. */
function layoutChecked(P, sp, towers = 1) {
  const lay = towers > 1 ? VT.siteLayout(sp, towers, P.env, P.C) : (() => { const q = fit(sp, P.env, P.C); return q ? { sps: [q] } : null; })();
  if (!lay || !lay.sps.length) return null; const Ci = { ...P.C, fsi: P.C.fsi / lay.sps.length };
  for (const q of lay.sps) if (!VT.checkCandidate(q, P.env, Ci, P.field.arc).feasible) return null;
  return lay.sps;
}
/* Evaluate a candidate spec on the prepared site (N towers via siteLayout). */
function evaluate(P, sp, towers = 1) {
  const lay = towers > 1 ? VT.siteLayout(sp, towers, P.env, P.C) : { sps: [fit(sp, P.env, P.C)].filter(Boolean) };
  if (!lay || !lay.sps.length) return null;
  const ev = VT.evaluateSite(lay.sps, P.env, P.C, P.S, P.V, P.field.arc); return ev;
}
module.exports = { H, VT, GEO, TOK, PC, CITIES, available, context, randomSite, prepare, evaluate, fit, bestCenter, layoutChecked };
