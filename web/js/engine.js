/* viewtower engine (browser + Web Worker). Pure functions, no DOM, no external libraries.
   JavaScript port of the Python package in src/viewtower. Rings are arrays of [x, y] in local
   metres (x east, y north), open (no repeated closing vertex). Azimuths clockwise from north. */
(function (G) {
"use strict";
const D2R = Math.PI / 180, R2D = 180 / Math.PI, FT2 = 10.7639;
const mod = (x, m) => ((x % m) + m) % m;

/* ------------------------------------------------------------------ geometry */
const signedArea = r => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const ringArea = r => Math.abs(signedArea(r));
const ccw = r => signedArea(r) >= 0 ? r : r.slice().reverse();
const box = (x0, y0, x1, y1) => [[x1, y0], [x1, y1], [x0, y1], [x0, y0]];
function rot(r, deg, ox = 0, oy = 0) { const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R); return r.map(([x, y]) => [ox + (x - ox) * c - (y - oy) * s, oy + (x - ox) * s + (y - oy) * c]); }
const tr = (r, dx, dy) => r.map(([x, y]) => [x + dx, y + dy]);
const scl = (r, k, ox = 0, oy = 0) => r.map(([x, y]) => [ox + (x - ox) * k, oy + (y - oy) * k]);
function centroid(r) { let a = 0, cx = 0, cy = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n], f = p[0] * q[1] - q[0] * p[1]; a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f; } a /= 2; return a === 0 ? r[0].slice() : [cx / (6 * a), cy / (6 * a)]; }
function bounds(r) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of r) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; } return [a, b, c, d]; }
function pip(x, y, r) { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = ax + t * dx - px, qy = ay + t * dy - py; return Math.sqrt(qx * qx + qy * qy); }
function distToBoundary(x, y, r) { let m = Infinity; for (let i = 0, n = r.length; i < n; i++) { const a = r[i], b = r[(i + 1) % n]; const d = segDist(x, y, a[0], a[1], b[0], b[1]); if (d < m) m = d; } return m; }
const distPoly = (x, y, r) => pip(x, y, r) ? 0 : distToBoundary(x, y, r);
function segCross(a, b, c, d) { const o = (p, q, s) => (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]); const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0; }
function edgesCross(A, B) { for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (segCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true; return false; }
function polysIntersect(A, B) { return A.some(p => pip(p[0], p[1], B)) || B.some(p => pip(p[0], p[1], A)) || edgesCross(A, B); }
function polyDistance(A, B) { if (polysIntersect(A, B)) return 0; let m = Infinity; for (const p of A) m = Math.min(m, distToBoundary(p[0], p[1], B)); for (const p of B) m = Math.min(m, distToBoundary(p[0], p[1], A)); return m; }
const contains = (outer, inner, tol = 0.01) => inner.every(([x, y]) => pip(x, y, outer) || distToBoundary(x, y, outer) <= tol) && !edgesCross(outer, inner);
function hull(pts) { const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); } for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); } return lo.slice(0, -1).concat(up.slice(0, -1)); }
const roundHalfEven = x => { const f = Math.floor(x), d = x - f; if (Math.abs(d - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1; return Math.round(x); };
function percentile(arr, p) { const a = Float64Array.from(arr).sort(); if (!a.length) return 0; const k = (a.length - 1) * p / 100, f = Math.floor(k), c = Math.min(f + 1, a.length - 1); return a[f] + (a[c] - a[f]) * (k - f); }
const median = arr => percentile(arr, 50);
const mean = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
function minWidth(r) { const h = hull(r); let best = Infinity, w = 0; for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!L) continue; const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; let mnU = Infinity, mxU = -Infinity, mnV = Infinity, mxV = -Infinity; for (const p of h) { const u = p[0] * ux + p[1] * uy, v = -p[0] * uy + p[1] * ux; if (u < mnU) mnU = u; if (u > mxU) mxU = u; if (v < mnV) mnV = v; if (v > mxV) mxV = v; } const area = (mxU - mnU) * (mxV - mnV); if (area < best) { best = area; w = Math.min(mxU - mnU, mxV - mnV); } } return w; }
function fnv(str) { let h1 = 0x811c9dc5, h2 = 0x01000193; for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; } return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 12); }
function lineX(p, d, q, e) { const den = d[0] * e[1] - d[1] * e[0]; if (Math.abs(den) < 1e-12) return null; const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den; return [p[0] + t * d[0], p[1] + t * d[1]]; }
/* Clip a (possibly concave) subject ring with a convex clip ring (Sutherland–Hodgman). */
function clipConvex(subject, clip) {
  let out = subject; const C = ccw(clip);
  for (let i = 0; i < C.length && out.length; i++) {
    const a = C[i], b = C[(i + 1) % C.length], inp = out; out = [];
    const side = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    for (let k = 0; k < inp.length; k++) { const P = inp[k], Q = inp[(k + 1) % inp.length], sp = side(P), sq = side(Q); if (sp >= 0) out.push(P); if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); } }
  }
  return out;
}

/* ------------------------------------------------------------------ raster scene + rays */
/* Scene: {x0,y0,res,nx,ny,H(Float32),W,G,HAB(Uint8),landmarks} — built by geo.js / app.js */
function sampleDistances(res, P) { const d = [P.minD]; while (d[d.length - 1] < P.maxD) { const v = d[d.length - 1]; d.push(v + Math.max(res / 2, P.growth * v)); } return Float64Array.from(d); }
function castRay(S, ox, oy, oz, az, D, P, own, out, trace) {
  const th = az * D2R, s = Math.sin(th), c = Math.cos(th), res = S.res, nx = S.nx, ny = S.ny;
  let prevMax = -90, water = 0, green = 0, skyline = 0, pendW = false, pendG = false, pendE = 0, found = false, dObs = P.maxD, obsH = 0, obsHab = false, firstSea = -1, lastSea = -1;
  for (let k = 0; k < D.length; k++) {
    const d = D[k]; if (d > P.maxD) break;
    const x = ox + s * d, y = oy + c * d, j = Math.floor((x - S.x0) / res), i = Math.floor((y - S.y0) / res);
    let h = 0, w = 0, g = 0, hab = 0;
    if (i >= 0 && i < ny && j >= 0 && j < nx) { const q = i * nx + j; h = S.H[q]; w = S.W[q]; g = S.G[q]; hab = S.HAB[q]; }
    else { const ci = i < 0 ? 0 : i >= ny ? ny - 1 : i, cj = j < 0 ? 0 : j >= nx ? nx - 1 : j; w = S.W[ci * nx + cj]; } // sea continues past the raster edge
    if (own && x >= own.bb[0] && x <= own.bb[2] && y >= own.bb[1] && y <= own.bb[3] && pip(x, y, own.ring)) { if (own.top > h) h = own.top; hab = 0; w = 0; g = 0; } // own tower blocks views but is not a neighbour for privacy
    const e = Math.atan2(h - oz, d) * R2D;
    // credit only the visible surface between the previous sample and this one (not a wall behind it)
    if (pendW || pendG) { const eg = Math.atan2(-oz, d) * R2D, inc = Math.max(0, Math.min(eg, e) - pendE); if (pendW) water += inc; if (pendG) green += inc; }
    const vis = e >= prevMax - 1e-9; pendW = !!w && vis; pendG = !!g && vis; pendE = e;
    // skyline: the visible face of a distant tall building (the city itself as a view)
    if (h >= P.skyMinH && d >= P.skyMinD && e > prevMax) skyline += e - Math.max(prevMax, Math.atan2(-oz, d) * R2D);
    if (trace && w && vis) { if (firstSea < 0) firstSea = d; lastSea = d; }
    if (e > prevMax) prevMax = e;
    if (!found && h > oz) { found = true; dObs = d; obsH = h; obsHab = !!hab; }
  }
  const horizon = Math.max(prevMax, 0);
  out.horizon = horizon; out.dObs = dObs; out.obsH = obsH; out.hab = obsHab;
  out.sky = 1 - Math.sin(horizon * D2R);
  out.water = Math.min(1, water / P.waterRef); out.green = Math.min(1, green / P.waterRef);
  out.skyline = Math.min(1, skyline / P.skyRef); out.prize = Math.max(out.water, P.skyW * out.skyline); // prize view = sea or skyline
  out.dist = Math.log1p(dObs / P.distRef) / Math.log1p(P.maxD / P.distRef);
  out.priv = obsHab && dObs < P.privD ? 1 - dObs / P.privD : 0;
  if (trace) { out.firstSea = firstSea; out.lastSea = lastSea; }
  return out;
}
function landmarkInfo(S, ox, oy, oz, P) {
  const out = [];
  for (const lm of S.landmarks || []) {
    const dx = lm.x - ox, dy = lm.y - oy, dist = Math.hypot(dx, dy), th = mod(Math.atan2(dx, dy) * R2D, 360);
    const D = sampleDistances(S.res, { minD: 1, maxD: Math.max(dist, 2), growth: P.growth }), s = Math.sin(th * D2R), c = Math.cos(th * D2R); let mx = -90;
    for (let k = 0; k < D.length; k++) { const d = D[k]; if (d >= dist - S.res) break; const x = ox + s * d, y = oy + c * d, j = Math.floor((x - S.x0) / S.res), i = Math.floor((y - S.y0) / S.res); let h = 0; if (i >= 0 && i < S.ny && j >= 0 && j < S.nx) h = S.H[i * S.nx + j]; const e = Math.atan2(h - oz, d) * R2D; if (e > mx) mx = e; }
    out.push({ th, w: lm.weight, vis: Math.atan2(lm.z - oz, dist) * R2D >= mx });
  }
  return out;
}
function lmTerm(info, az, half) { let s = 0; for (const l of info) { const diff = Math.abs(mod(az - l.th + 180, 360) - 180); if (l.vis && diff <= half) s += l.w; } return Math.min(s, 1); }
function corridorTerm(az, dObs, corridors) { let m = 0; for (const c of corridors || []) { const a0 = mod(c.from, 360), a1 = mod(c.to, 360); const ins = a0 <= a1 ? (az >= a0 && az <= a1) : (az >= a0 || az <= a1); if (ins && dObs >= (c.minD ?? 100)) m = Math.max(m, c.weight ?? 1); } return m; }
function quality(r, lm, corr, W) { const q = W.water * (r.prize ?? r.water) + W.dist * r.dist + W.sky * r.sky + W.green * r.green + W.lm * lm + W.corr * corr - W.priv * r.priv; return q < 0 ? 0 : q > 1 ? 1 : q; }
function normWeights(w) { const t = w.water + w.dist + w.sky + w.green + w.lm + w.corr || 1; return { water: w.water / t, dist: w.dist / t, sky: w.sky / t, green: w.green / t, lm: w.lm / t, corr: w.corr / t, priv: w.priv }; }
function viewSettings(opts = {}) {
  const P = { minD: 1, maxD: opts.maxD || 3000, growth: 0.005, waterRef: 5.0, distRef: 50, privD: 30, lmHalf: 3, skyMinH: 60, skyMinD: 150, skyRef: 5.0, skyW: 0.9 };
  return { P, D: sampleDistances(opts.res || 4, P), W: normWeights({ water: .45, dist: .2, sky: .15, green: .1, lm: .1, corr: 0, priv: .3 }), fov: 75, azStep: 2, spacing: 2, corridors: opts.corridors || [], lmOn: !!opts.lmOn };
}
function evalApertures(S, obs, normals, own, V) {
  const offs = []; for (let o = -V.fov; o <= V.fov + 1e-9; o += V.azStep) offs.push(o);
  const cw = offs.map(o => Math.cos(o * D2R)), wsum = cw.reduce((a, b) => a + b, 0), W = V.W, tmp = {};
  const N = obs.length, R = { quality: new Float64Array(N), water: new Float64Array(N), skyline: new Float64Array(N), prize: new Float64Array(N), sky: new Float64Array(N), privacy: new Float64Array(N), dMed: new Float64Array(N), hMed: new Float64Array(N) };
  const dA = new Float64Array(offs.length), hA = new Float64Array(offs.length);
  for (let n = 0; n < N; n++) {
    const [ox, oy, oz] = obs[n], li = V.lmOn ? landmarkInfo(S, ox, oy, oz, V.P) : [];
    let q = 0, w = 0, sk = 0, pr = 0, sl = 0, pz = 0;
    for (let a = 0; a < offs.length; a++) {
      const az = mod(normals[n] + offs[a], 360); castRay(S, ox, oy, oz, az, V.D, V.P, own, tmp);
      const lm = li.length ? lmTerm(li, az, V.P.lmHalf) : 0, cr = corridorTerm(az, tmp.dObs, V.corridors);
      q += cw[a] * quality(tmp, lm, cr, W); w += cw[a] * tmp.water; sl += cw[a] * tmp.skyline; pz += cw[a] * tmp.prize; sk += cw[a] * tmp.sky; pr += cw[a] * tmp.priv; dA[a] = tmp.dObs; hA[a] = tmp.horizon;
    }
    R.quality[n] = q / wsum; R.water[n] = w / wsum; R.skyline[n] = sl / wsum; R.prize[n] = pz / wsum; R.sky[n] = sk / wsum; R.privacy[n] = pr / wsum; R.dMed[n] = percentile(dA, 25); R.hMed[n] = percentile(hA, 75); // near-side obstruction (p25 distance, p75 horizon)
  }
  return R;
}
/* One facade point, full detail for the 3D view cone: per-azimuth rays over the window's field of view. */
function viewCone(S, x, y, z, normal, own, V, halfAngle = 90, step = 2) {
  const rays = [], tmp = {}; let q = 0, w = 0, ws = 0, sk = 0, pz = 0; const li = V.lmOn ? landmarkInfo(S, x, y, z, V.P) : [];
  for (let o = -halfAngle; o <= halfAngle + 1e-9; o += step) {
    const az = mod(normal + o, 360); castRay(S, x, y, z, az, V.D, V.P, own, tmp, true);
    const lm = li.length ? lmTerm(li, az, V.P.lmHalf) : 0, qq = quality(tmp, lm, corridorTerm(az, tmp.dObs, V.corridors), V.W), cw = Math.max(0, Math.cos(o * D2R));
    rays.push({ az, off: o, q: qq, water: tmp.water, skyline: tmp.skyline, prize: tmp.prize, dObs: tmp.dObs, obsH: tmp.obsH, horizon: tmp.horizon, hab: tmp.hab, firstSea: tmp.firstSea, lastSea: tmp.lastSea });
    q += cw * qq; w += cw * tmp.water; sk += cw * tmp.skyline; pz += cw * tmp.prize; ws += cw;
  }
  return { rays, quality: q / ws, water: w / ws, skyline: sk / ws, prize: pz / ws };
}
function premiumArc(vals, az, thr) {
  const ok = vals.map(v => v >= thr), n = ok.length; if (!ok.some(Boolean)) return null; if (ok.every(Boolean)) return [0, 360];
  const start = ok.indexOf(false); let best = 0, cur = 0, bestEnd = 0;
  for (let k = 1; k <= n; k++) { const idx = (start + k) % n; cur = ok[idx] ? cur + 1 : 0; if (cur > best) { best = cur; bestEnd = idx; } }
  const step = az[1] - az[0], a1 = az[bestEnd]; return [mod(a1 - (best - 1) * step, 360), a1];
}
function siteViewField(S, env, V, heights, spacing) {
  const [minx, miny, maxx, maxy] = bounds(env), pts = [];
  for (let y = miny + spacing / 2; y < maxy; y += spacing) for (let x = minx + spacing / 2; x < maxx; x += spacing) if (pip(x, y, env)) pts.push([x, y]);
  if (!pts.length) pts.push(centroid(env));
  const az = []; for (let a = 0; a < 360; a += V.azStep) az.push(a);
  const rose = {}, tmp = {};
  for (const z of heights) {
    const acc = { quality: new Float64Array(az.length), water: new Float64Array(az.length), skyline: new Float64Array(az.length), prize: new Float64Array(az.length), sky: new Float64Array(az.length), horizon: new Float64Array(az.length) };
    for (const [x, y] of pts) { const li = V.lmOn ? landmarkInfo(S, x, y, z + 1.5, V.P) : []; for (let a = 0; a < az.length; a++) { castRay(S, x, y, z + 1.5, az[a], V.D, V.P, null, tmp); const lm = li.length ? lmTerm(li, az[a], V.P.lmHalf) : 0; acc.quality[a] += quality(tmp, lm, corridorTerm(az[a], tmp.dObs, V.corridors), V.W); acc.water[a] += tmp.water; acc.skyline[a] += tmp.skyline; acc.prize[a] += tmp.prize; acc.sky[a] += tmp.sky; acc.horizon[a] += tmp.horizon; } }
    for (const k in acc) for (let a = 0; a < az.length; a++) acc[k][a] /= pts.length;
    rose[z] = acc;
  }
  const top = Math.max(...heights), arc = premiumArc(Array.from(rose[top].prize), az, 0.5);
  let opening = null;
  if (arc) { const sel = az.map(a => arc[0] <= arc[1] ? (a >= arc[0] && a <= arc[1]) : (a >= arc[0] || a <= arc[1])); for (const z of heights.slice().sort((a, b) => a - b)) { const v = mean(Array.from(rose[z].prize).filter((_, i) => sel[i])); if (v >= 0.5) { opening = z; break; } } }
  return { heights, az, rose, arc, opening, pts };
}

/* ------------------------------------------------------------------ typologies */
const MODIFIERS = ["terraced", "tapered", "twisted", "podium_tower"];
const rect = (w, d) => box(-w / 2, -d / 2, w / 2, d / 2);
function chamfer(poly, c) {
  if (c <= 0) return poly; const n = poly.length, out = [];
  for (let i = 0; i < n; i++) { const p = poly[i], a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n], va = [a[0] - p[0], a[1] - p[1]], vb = [b[0] - p[0], b[1] - p[1]], la = Math.hypot(...va), lb = Math.hypot(...vb), cc = Math.min(c, 0.45 * la, 0.45 * lb); out.push([p[0] + va[0] / la * cc, p[1] + va[1] / la * cc], [p[0] + vb[0] / lb * cc, p[1] + vb[1] / lb * cc]); }
  return out;
}
/* Exact outline of wings (length L from the centre, width Wd) radiating at the given math angles. */
function wings(angles, L, Wd) {
  const a = angles.map(v => mod(v, 360)).sort((p, q) => p - q), h = Wd / 2, out = [];
  for (let i = 0; i < a.length; i++) {
    const t = a[i] * D2R, u = [Math.cos(t), Math.sin(t)], v = [-u[1], u[0]];
    const t2 = a[(i + 1) % a.length] * D2R, u2 = [Math.cos(t2), Math.sin(t2)], v2 = [-u2[1], u2[0]];
    out.push([L * u[0] - h * v[0], L * u[1] - h * v[1]], [L * u[0] + h * v[0], L * u[1] + h * v[1]]);
    const gap = mod(a[(i + 1) % a.length] - a[i], 360) || 360;
    if (gap < 179.999) { const p = lineX([h * v[0], h * v[1]], u, [-h * v2[0], -h * v2[1]], u2); if (p) out.push(p); }
    else if (gap > 180.001) { out.push([h * v[0], h * v[1]], [-h * v2[0], -h * v2[1]]); }
  }
  return out;
}
function superellipse(a, b, n, k = 96) { const out = []; for (let i = 0; i < k; i++) { const t = 2 * Math.PI * i / k, c = Math.cos(t), s = Math.sin(t); out.push([a * Math.sign(c) * Math.abs(c) ** (2 / n), b * Math.sign(s) * Math.abs(s) ** (2 / n)]); } return out; }
function baseShape(t, w, d, p) {
  switch (t) {
    case "rectangular": case "slender": case "rotated": return rect(w, d);
    case "square": return rect(w, w);
    case "diamond": return rot(rect(w / Math.SQRT2, w / Math.SQRT2), 45);
    case "chamfered": return chamfer(rect(w, d), p.chamfer_m ?? 3);
    case "triangular": return chamfer([[-w / 2, -d / 3], [w / 2, -d / 3], [0, 2 * d / 3]], p.chamfer_m ?? 3);
    case "y_shaped": { const a = p.wing_angle_deg ?? 120; return wings([90, 90 + a, 90 - a], p.wing_len ?? w / 2, p.wing_w ?? d); }
    case "t_shaped": return wings([0, 180, 90], p.wing_len ?? w / 2, p.wing_w ?? d);
    case "cross": return wings([0, 90, 180, 270], p.wing_len ?? w / 2, p.wing_w ?? d);
    case "curved": return superellipse(w / 2, d / 2, p.exponent ?? 2.5);
  }
  throw new Error("unknown typology " + t);
}
const place = (r, sp) => tr(rot(r, -sp.rotation), sp.position[0], sp.position[1]);
function clipHalf(poly, ux, uy, cut) { const out = [], n = poly.length, f = p => p[0] * ux + p[1] * uy - cut; for (let i = 0; i < n; i++) { const P = poly[i], Q = poly[(i + 1) % n], fp = f(P), fq = f(Q); if (fp <= 0) out.push(P); if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { const t = fp / (fp - fq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); } } return out; }
/* ------------------------------------------------------------------ token typologies
   A "token" tower is a base shape plus per-floor tokens (see docs/spec/13):
     twist  {rate °/floor, mode linear|band|ease, band floors}
     taper  {top scale at the top, mode linear|frustum|bulge, period floors}
     shift  {amp m, mode stagger|lean|wave|pixel, period floors, dir site azimuth °}
     terrace{every floors, step m, dir site azimuth °, max m}
     cut    {every floors, size m} — corner cut-outs (double-height gardens), rotating corner by band
   The core stays on the tower axis; overhang and core-fit rules then bound the moves. */
const hash01 = (a, b) => { let h = Math.imul(a * 73856093 ^ b * 19349663, 0x9E3779B1) >>> 0; h ^= h >>> 15; return (h >>> 0) / 4294967296; };
function tokenPlate(sp, level) {
  const p = sp.p, first = sp.podium, n = Math.max(sp.n, first + 2), k = Math.max(level - first, 0), t = level >= first ? k / Math.max(1, n - 1 - first) : 0;
  let poly = baseShape(p.base || "square", sp.width, sp.depth, p);
  const tp = p.taper; if (tp && level >= first) { const A = (tp.top ?? 1) - 1; let sc = 1;
    if (tp.mode === "frustum") { const P = Math.max(2, tp.period || 10), ph = (k % (2 * P)) / P; sc = 1 + A * (ph <= 1 ? ph : 2 - ph); } else if (tp.mode === "bulge") sc = 1 + A * Math.sin(Math.PI * t); else sc = 1 + A * t;
    poly = scl(poly, Math.max(0.35, sc)); }
  const cu = p.cut; if (cu && level >= first && cu.every > 0 && k % cu.every < 2) { const b = bounds(poly), cx = [b[0], b[2]], cy = [b[1], b[3]], c = Math.floor(k / cu.every) % 4, sx = c % 2 ? 1 : -1, sy = c < 2 ? 1 : -1, s0 = cu.size || 5;
    poly = clipHalf(poly, sx / Math.SQRT2, sy / Math.SQRT2, (sx * (sx > 0 ? cx[1] : cx[0]) + sy * (sy > 0 ? cy[1] : cy[0])) / Math.SQRT2 - s0); }
  const te = p.terrace; if (te && level >= first) { const every = Math.max(1, Math.round(te.every || 6)), side = ((te.dir ?? 0) - (sp.rotation || 0)) * D2R, ux = Math.sin(side), uy = Math.cos(side), proj = poly.map(q => q[0] * ux + q[1] * uy), lo = Math.min(...proj), hi = Math.max(...proj);
    const retreat = Math.min((te.step ?? 3) * Math.floor(k / every), te.max ?? 0.35 * (hi - lo)); if (retreat > 0) poly = clipHalf(poly, ux, uy, Math.max(hi - retreat, lo + 12)); }
  const tw = p.twist; if (tw && level >= first) { let ang = 0; const r = tw.rate || 0;
    if (tw.mode === "band") { const B = Math.max(2, tw.band || 6); ang = r * B * Math.floor(k / B); } else if (tw.mode === "ease") { const T = r * (n - 1 - first); ang = T * (3 * t * t - 2 * t * t * t); } else ang = r * k;
    poly = rot(poly, -ang); }
  const sh = p.shift; if (sh && level >= first && sh.amp) { const P = Math.max(1, sh.period || 2), dir = ((sh.dir ?? 0) - (sp.rotation || 0)) * D2R, ux = Math.sin(dir), uy = Math.cos(dir); let a = 0;
    if (sh.mode === "lean") a = sh.amp * t; else if (sh.mode === "wave") a = sh.amp * Math.sin(2 * Math.PI * k / Math.max(4, P)); else if (sh.mode === "pixel") { const band = Math.floor(k / P); a = sh.amp * (2 * hash01(band, 7) - 1); poly = tr(poly, sh.amp * (2 * hash01(band, 11) - 1) * uy, -sh.amp * (2 * hash01(band, 11) - 1) * ux); } else a = sh.amp * (Math.floor(k / P) % 2 ? 1 : -1) / 2;
    poly = tr(poly, a * ux, a * uy); }
  return poly;
}
function localPlate(sp, level) {
  const p = sp.p;
  if (sp.typology === "token") return tokenPlate(sp, level);
  if (sp.typology === "podium_tower" && level < sp.podium) return rect(p.podium_w ?? sp.width * 1.6, p.podium_d ?? sp.depth * 1.6);
  const base = MODIFIERS.includes(sp.typology) ? (p.base || "square") : sp.typology;
  let poly = baseShape(base, sp.width, sp.depth, p);
  const first = sp.podium, top = Math.max(sp.n - 1, first + 1), t = level >= first ? (level - first) / (top - first) : 0;
  if (sp.typology === "tapered") { const k = 1 + ((p.top_scale ?? 0.7) - 1) * t; poly = scl(poly, k); }
  if (sp.typology === "terraced") {
    const every = Math.round(p.step_every ?? 6), step = p.step_m ?? 3; let retreat = level >= first ? step * Math.floor((level - first) / every) : 0;
    const side = ((p.step_side_deg ?? 0) - (sp.rotation || 0)) * D2R, ux = Math.sin(side), uy = Math.cos(side), proj = poly.map(q => q[0] * ux + q[1] * uy), lo = Math.min(...proj), hi = Math.max(...proj);
    retreat = Math.min(retreat, p.max_retreat_m ?? 0.25 * (hi - lo)); poly = clipHalf(poly, ux, uy, Math.max(hi - retreat, lo + (p.min_depth_m ?? 12)));
  }
  if (sp.typology === "twisted") poly = rot(poly, -(p.twist_per_floor_deg ?? 1.2) * Math.max(level - first, 0));
  return poly;
}
const plateAt = (sp, level) => place(localPlate(sp, level), sp);
function coreAt(sp, level, area, offM, offDir) {
  const base = MODIFIERS.includes(sp.typology) || sp.typology === "token" ? (sp.p.base || "square") : sp.typology; let loc;
  if (base === "y_shaped" || base === "t_shaped") { const r = Math.sqrt(2 * area / (3 * Math.sqrt(3))); loc = []; for (let k = 0; k < 6; k++) { const a = (90 + 60 * k) * D2R; loc.push([r * Math.cos(a), r * Math.sin(a)]); } }
  else if (base === "cross" || base === "diamond") { const s = Math.sqrt(area); loc = rot(rect(s, s), 45); }
  else { const elong = ["rectangular", "slender", "rotated", "chamfered", "curved"].includes(base); const aspect = elong ? Math.min(Math.max(sp.width / sp.depth, 0.5), 2) : 1; const cw = Math.sqrt(area * aspect); loc = rect(cw, area / cw); }
  if (sp.typology === "twisted") loc = rot(loc, -(sp.p.twist_per_floor_deg ?? 1.2) * Math.max(level - sp.podium, 0));
  if (sp.typology === "token" && sp.p.twist && sp.p.twist.mode === "linear") loc = rot(loc, -(sp.p.twist.rate || 0) * Math.max(level - sp.podium, 0)); // a twisting plate turns its core with it (Cayan); banded/eased twists keep a straight core
  let placed = place(loc, sp);
  if (offM && offDir != null) placed = tr(placed, offM * Math.sin(offDir * D2R), offM * Math.cos(offDir * D2R));
  return placed;
}

/* ------------------------------------------------------------------ structure */
function perimeterPoints(poly, spacing) {
  const r = ccw(poly), pts = [], normals = [], s = []; let s0 = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 1e-9) continue;
    const k = Math.max(1, roundHalfEven(L / spacing)), az = mod(Math.atan2(dy, -dx) * R2D, 360);
    for (let q = 0; q < k; q++) { const t = (q + 0.5) / k; pts.push([a[0] + t * dx, a[1] + t * dy]); normals.push(az); s.push(s0 + t * L); }
    s0 += L;
  }
  return { pts, normals, s, per: s0 };
}
function structure(plate, core, spacing, grid = 1) {
  const r = ccw(plate), cols = [], gaps = [];
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-9) continue; const k = Math.max(1, Math.ceil(L / spacing)); for (let q = 0; q < k; q++) cols.push([a[0] + q / k * (b[0] - a[0]), a[1] + q / k * (b[1] - a[1])]); gaps.push(L / k); }
  const fp = perimeterPoints(plate, 0.5).pts.map(([x, y]) => distPoly(x, y, core));
  const [minx, miny, maxx, maxy] = bounds(plate); let span = 0;
  for (let y = miny + grid / 2; y < maxy; y += grid) for (let x = minx + grid / 2; x < maxx; x += grid) {
    if (!pip(x, y, plate) || pip(x, y, core)) continue;
    let m = distToBoundary(x, y, core); for (const c of cols) { const d = Math.hypot(x - c[0], y - c[1]); if (d < m) m = d; }
    if (m > span) span = m;
  }
  return { cols, maxGap: Math.max(...gaps), span: 2 * span, depthP90: percentile(fp, 90), maxDepth: Math.max(...fp), minDepth: Math.min(...fp) };
}
function maxOverhang(upper, lower) { let m = 0; for (const [x, y] of upper) m = Math.max(m, distPoly(x, y, lower)); return m; }
function coreFits(plate, core, margin) {
  if (!core.every(([x, y]) => pip(x, y, plate))) return false; if (edgesCross(plate, core)) return false;
  let m = Infinity; for (const [x, y] of core) m = Math.min(m, distToBoundary(x, y, plate)); for (const [x, y] of plate) m = Math.min(m, distToBoundary(x, y, core));
  return m >= margin - 1e-9;
}

/* ------------------------------------------------------------------ units */
function splitCuts(scores, s, per, n, mode, minF = 0, start = null) {
  // start of the split: a fixed geometric point when given (stable), else the weakest facade point
  let startI = 0; if (start != null) startI = start; else for (let i = 1; i < scores.length; i++) if (scores[i] < scores[startI]) startI = i;
  if (n === 1) return [s[startI]];
  const order = []; for (let i = startI; i < s.length; i++) order.push(i); for (let i = 0; i < startI; i++) order.push(i);
  const sOrd = order.map(i => mod(s[i] - s[startI], per)), w = order.map(i => mode === "equal_area" ? 1 : Math.max(scores[i], 1e-3)), tot = w.reduce((a, b) => a + b, 0);
  const cum = []; let acc = 0; for (const v of w) { acc += v; cum.push(acc / tot); }
  const cuts = [0]; for (let u = 1; u < n; u++) { let k = cum.findIndex(c => c >= u / n); if (k < 0) k = cum.length - 1; cuts.push(sOrd[Math.min(k, sOrd.length - 1)]); }
  // keep every unit at least minF of facade (no sliver units on a short, very valuable stretch)
  if (minF > 0 && n * minF <= per) {
    const snap = v => { let b = sOrd[0], bd = Infinity; for (const x of sOrd) { const d = Math.abs(x - v); if (d < bd) { bd = d; b = x; } } return b; };
    for (let u = 1; u < n; u++) cuts[u] = Math.max(cuts[u], cuts[u - 1] + minF);
    for (let u = n - 1; u >= 1; u--) cuts[u] = Math.min(cuts[u], (u + 1 < n ? cuts[u + 1] : per) - minF);
    for (let u = 1; u < n; u++) { const c = snap(cuts[u]); if (c - cuts[u - 1] >= minF - 1e-6 && (u + 1 < n ? cuts[u + 1] : per) - c >= minF - 1e-6) cuts[u] = c; }
  }
  return cuts.map(c => mod(s[startI] + c, per));
}
/* Unit = wedge from the core centre along the facade between two cuts, minus the (convex) core.
   Exact for plates that are star-shaped about the core centre (all generated typologies). */
function unitEnvelopes(plate, core, cuts) {
  const R = ccw(plate), ring = R.concat([R[0]]), cum = [0]; for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  const per = cum[cum.length - 1], c = centroid(core), C = ccw(core);
  const pointAt = sv => { let k = 0; while (k < cum.length - 2 && cum[k + 1] <= sv) k++; const seg = cum[k + 1] - cum[k], t = seg <= 0 ? 0 : (sv - cum[k]) / seg; return [ring[k][0] + t * (ring[k + 1][0] - ring[k][0]), ring[k][1] + t * (ring[k + 1][1] - ring[k][1])]; };
  const path = (s0, s1) => { const v = []; for (let k = 0; k < ring.length - 1; k++) for (const wrap of [0, per, 2 * per]) { const sv = cum[k] + wrap; if (s0 < sv && sv < s1) v.push([sv, ring[k]]); } v.sort((a, b) => a[0] - b[0]); return [pointAt(mod(s0, per))].concat(v.map(q => q[1]), [pointAt(mod(s1, per))]); };
  const exitCore = p => { const d = [p[0] - c[0], p[1] - c[1]]; let best = null, bt = Infinity; for (let i = 0; i < C.length; i++) { const a = C[i], b = C[(i + 1) % C.length], e = [b[0] - a[0], b[1] - a[1]], den = d[0] * e[1] - d[1] * e[0]; if (Math.abs(den) < 1e-12) continue; const t = ((a[0] - c[0]) * e[1] - (a[1] - c[1]) * e[0]) / den, u = ((a[0] - c[0]) * d[1] - (a[1] - c[1]) * d[0]) / den; if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < bt) { bt = t; best = [c[0] + t * d[0], c[1] + t * d[1]]; } } return best || c; };
  if (cuts.length === 1) return [{ mp: [[R, C]], a: cuts[0], b: cuts[0] + per }];
  const cs = cuts.slice().sort((a, b) => a - b), out = [];
  const ang = p => Math.atan2(p[1] - c[1], p[0] - c[0]);
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i], b = i === cs.length - 1 ? cs[0] + per : cs[i + 1], outer = path(a, b), Pa = outer[0], Pb = outer[outer.length - 1];
    const Qa = exitCore(Pa), Qb = exitCore(Pb), ta = ang(Pa); let span = mod(ang(Pb) - ta, 2 * Math.PI); if (span < 1e-9) span = 2 * Math.PI;
    const inner = C.map(p => [p, mod(ang(p) - ta, 2 * Math.PI)]).filter(([, t]) => t > 1e-9 && t < span - 1e-9).sort((x, y) => y[1] - x[1]).map(([p]) => p);
    out.push({ mp: [[outer.concat([Qb], inner, [Qa])]], a, b });
  }
  return out;
}
function mpArea(mp) { let s = 0; for (const poly of mp) { s += ringArea(poly[0]); for (let h = 1; h < poly.length; h++) s -= ringArea(poly[h]); } return s; }
/* facade samples a room needs: its frontage in samples, allowing 10 % under (a 4.2 m bedroom takes 2 x 2 m samples, not 3) */
const roomSamples = (need, spacing) => Math.max(1, Math.ceil(0.9 * need / spacing - 1e-9));
const unitFrontage = (prog, spacing) => spacing * (roomSamples(prog.living, spacing) + prog.bedrooms * roomSamples(prog.bed, spacing) + roomSamples(prog.kitchen || 3, spacing));
function assignRooms(idx, spacing, ap, prog, pts) {
  const free = new Array(idx.length).fill(true), rooms = [], viol = [];
  const wanted = [["living", prog.living]]; for (let i = 0; i < prog.bedrooms; i++) wanted.push([`bed${i + 1}`, prog.bed]);
  const mk = (name, sel) => ({ room: name, frontage: sel.length * spacing, q: mean(sel.map(i => ap.quality[i])), water: mean(sel.map(i => ap.water[i])), skyline: mean(sel.map(i => ap.skyline[i])), prize: mean(sel.map(i => ap.prize[i])), sky: mean(sel.map(i => ap.sky[i])), privacy: Math.max(...sel.map(i => ap.privacy[i])), dMed: median(sel.map(i => ap.dMed[i])), hMed: median(sel.map(i => ap.hMed[i])), pts: sel.map(i => pts[i]) });
  for (const [name, need] of wanted) {
    const k = roomSamples(need, spacing); let best = -1, bj = -1;
    for (let j = 0; j + k <= idx.length; j++) { let ok = true, s = 0; for (let t = j; t < j + k; t++) { if (!free[t]) { ok = false; break; } s += ap.quality[idx[t]]; } if (ok && s / k > best + 1e-12) { best = s / k; bj = j; } }
    if (bj < 0) { viol.push(name === "living" ? "GR-FRONT-LR-01" : "GR-FRONT-BR-01"); continue; }
    for (let t = bj; t < bj + k; t++) free[t] = false;
    rooms.push(mk(name, idx.slice(bj, bj + k)));
  }
  const rest = idx.filter((_, t) => free[t]);
  if (rest.length) rooms.push(mk("kitchen_service", rest)); else if (prog.kitchen > 0) viol.push("GR-FRONT-UNIT-01");
  return { rooms, viol };
}
/* the facade point furthest in the landward direction (middle of that face): a split start that does not move
   when view values change slightly */
function landwardStart(pts, s, az) {
  if (az == null) return null; const ux = Math.sin(az * D2R), uy = Math.cos(az * D2R), c = centroid(pts), d = pts.map(([x, y]) => (x - c[0]) * ux + (y - c[1]) * uy), m = Math.max(...d);
  const near = d.map((v, i) => [v, i]).filter(([v]) => v >= m - 0.5).map(([, i]) => i); return near[near.length >> 1];
}
function buildUnits(level, z, plate, core, pp, spacing, ap, n, prog, mode, startAz = null) {
  const cuts = splitCuts(ap.quality, pp.s, pp.per, n, mode, unitFrontage(prog, spacing), landwardStart(pp.pts, pp.s, startAz)), envs = unitEnvelopes(plate, core, cuts), units = [], viol = new Set();
  envs.forEach((e, u) => {
    const idx = pp.s.map((_, i) => i).filter(i => n === 1 || mod(pp.s[i] - e.a, pp.per) < e.b - e.a);
    idx.sort((i, j) => mod(pp.s[i] - e.a, pp.per) - mod(pp.s[j] - e.a, pp.per));
    const { rooms, viol: v } = assignRooms(idx, spacing, ap, prog, pp.pts); v.forEach(x => viol.add(x));
    units.push({ id: `L${String(level).padStart(3, "0")}-U${u + 1}`, level, z, mp: e.mp, frontage: idx.length * spacing, rooms, cls: "", reasons: [], evaluated: true });
  });
  return { units, viol: [...viol].sort() };
}

/* ------------------------------------------------------------------ classification + economics */
const f2 = (v, d) => Number.isFinite(v) ? v.toFixed(d) : "–";
function classify(u, R) {
  const lr = u.rooms.find(r => r.room === "living"); if (!lr) return { cls: "compromised", reasons: ["VC-COMPROMISED: no living-room frontage"], margin: -1 };
  const hab = u.rooms.filter(r => r.room !== "kitchen_service"), privacy = hab.length ? Math.max(...hab.map(r => r.privacy)) : 0, c = R.vcComp;
  // the skyline-angle rule only bites when the obstruction is near (c.h_near): a tall skyline far away is a view, not a wall
  const checks = [["living view", lr.q, c.q_lr_min, 1], ["obstruction distance", lr.dMed, c.d_min, 1], ["horizon angle", lr.dMed < (c.h_near ?? Infinity) ? lr.hMed : 0, c.alpha_max, -1], ["privacy", privacy, c.p_max, -1]];
  const reasons = [], margins = [];
  for (const [name, val, thr, sense] of checks) { const slack = (val - thr) / Math.max(Math.abs(thr), 1e-9) * sense; margins.push(slack); if (slack < 0) reasons.push(`VC-COMPROMISED: ${name} ${f2(val, 2)} ${sense > 0 ? "<" : ">"} ${thr}`); }
  const margin = Math.min(...margins); if (reasons.length) return { cls: "compromised", reasons, margin };
  // premium: living room sees enough sea at good quality AND enough bedrooms see the sea (n_min, or a share of bedrooms)
  const pz = r => r.prize ?? r.water, kind = r => (r.water ?? 0) >= 0.9 * (r.skyline ?? 0) ? "sea" : "skyline";
  const beds = u.rooms.filter(r => r.room.startsWith("bed")), okB = beds.filter(b => pz(b) >= R.vcBR.w_min).length;
  const need = Math.min(beds.length, Math.max(R.vcBR.n_min || 0, Math.ceil((R.vcBR.share || 0) * beds.length - 1e-9)));
  if (pz(lr) >= R.vcLR.w_min && lr.q >= R.vcLR.q_min && okB >= need) return { cls: "premium", reasons: [`VC-LR-PREMIUM: living ${kind(lr)} view ${f2(pz(lr), 2)}, view score ${f2(lr.q, 2)}`, `VC-BR-PREMIUM: ${okB}/${beds.length} bedrooms see sea or skyline`], margin, premSlack: Math.min(pz(lr) - R.vcLR.w_min, lr.q - R.vcLR.q_min) };
  const why = []; if (pz(lr) < R.vcLR.w_min) why.push(`living sea/skyline ${f2(pz(lr), 2)} < ${R.vcLR.w_min}`); if (lr.q < R.vcLR.q_min) why.push(`living view ${f2(lr.q, 2)} < ${R.vcLR.q_min}`); if (okB < need) why.push(`${okB}/${need} bedrooms see sea or skyline`);
  if (lr.q >= R.vcGood.q_min) return { cls: "good", reasons: ["VC-GOOD: not premium because " + why.join("; ")], margin };
  // good also covers a long open outlook with no sea: far obstruction and a low horizon
  const open = R.vcGood.d_open != null && lr.dMed >= R.vcGood.d_open && lr.hMed < (R.vcGood.h_open ?? 2);
  if (open) return { cls: "good", reasons: [`VC-GOOD-OPEN: open outlook, nearest obstruction ${Math.round(lr.dMed)} m, horizon ${f2(lr.hMed, 1)}°`, "not premium because " + why.join("; ")], margin };
  return { cls: "neutral", reasons: [`VC-GOOD: living view ${f2(lr.q, 2)} < ${R.vcGood.q_min}`], margin };
}
/* Price multiplier: by class (step), or continuous in the living-room view quality q so that two
   almost identical units are never priced a whole class apart. Compromised units keep their discount. */
function unitMult(u, E) {
  if (E.pricing !== "continuous" || u.cls === "compromised") return E.mult[u.cls];
  const lr = u.rooms.find(r => r.room === "living"), c = E.cont || { a: 0.627, b: 0.734, lo: 0.75, hi: 1.2 };
  return Math.min(c.hi, Math.max(c.lo, c.a + c.b * (lr ? lr.q : 0)));
}
function priceUnits(units, first, E) {
  for (const u of units) { u.carpet = mpArea(u.mp) * E.carpetFactor; u.mult = unitMult(u, E); let rate = E.rate * (1 + E.rise / 100 * (u.level - first)) * u.mult; const ft = u.carpet * FT2; const sb = E.sizeBand || { small: -3, large: 3 }; rate *= ft < 1500 ? 1 + sb.small / 100 : ft < 4000 ? 1.0 : 1 + sb.large / 100; u.rate = rate; u.value = rate * u.carpet * FT2; }
}

/* ------------------------------------------------------------------ search stages */
function resolveFloors(sp, C) {
  const byH = Math.floor(C.hmax / sp.ftf + 1e-9), reserved = new Set(C.reserved); let used = 0, n = sp.podium; const probe = { ...sp, n: byH };
  if (sp.typology === "tapered") { // plate sizes depend on n: take the tallest tower whose total FSI fits
    for (let m = byH; m > sp.podium; m--) { const q = { ...sp, n: m }; let u = 0; for (let l = sp.podium; l < m; l++) if (!reserved.has(l)) u += ringArea(localPlate(q, l)); if (u <= C.fsi) return { ...sp, n: m }; }
    return { ...sp, n: sp.podium };
  }
  for (let l = sp.podium; l < byH; l++) { const a = reserved.has(l) ? 0 : ringArea(localPlate(probe, l)); if (used + a > C.fsi) break; used += a; n = l + 1; }
  return { ...sp, n };
}
function coreOffsetDir(arc) { if (!arc) return null; const [a0, a1] = arc; return mod(a0 + mod(a1 - a0, 360) / 2 + 180, 360); }
function signature(r) { const e = []; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; e.push(Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 100) / 100); } e.sort((a, b) => a - b); return Math.round(ringArea(r) * 10) / 10 + "|" + e.join(","); }
function specId(sp) { return fnv(JSON.stringify([sp.typology, sp.width, sp.depth, sp.p, sp.position, sp.rotation, sp.ftf, sp.podium, sp.upf, sp.coreOff, sp.n])); }

function checkCandidate(sp, env, C, arc) {
  const ev = { id: specId(sp), sp, arc: arc || null, feasible: true, viol: [], checks: {}, metrics: {}, plates: {}, cores: {}, cols: {}, units: [], explain: [], evaluated: [] };
  if (sp.podium * sp.ftf >= C.hmax) { ev.viol.push("ENV-HEIGHT-01"); ev.checks["ENV-HEIGHT-01"] = [false, `the ${sp.podium}-floor podium alone reaches ${f2(sp.podium * sp.ftf, 1)} m, at or above the ${C.hmax} m limit`]; ev.feasible = false; return ev; }
  if (sp.n <= sp.podium) { ev.viol.push("ENV-FSI-01"); ev.checks["ENV-FSI-01"] = [false, "no saleable floor fits the FSI area"]; ev.feasible = false; return ev; }
  const R = C.R, offDir = coreOffsetDir(arc), cArea = C.coreFixed + C.corePer * sp.upf, sig = {}, reserved = new Set(C.reserved);
  let fsiUsed = 0, prev = null, outside = 0, worstCant = 0;
  for (let l = 0; l < sp.n; l++) {
    const p = plateAt(sp, l); ev.plates[l] = p;
    if (!contains(env, p)) outside++;
    if (prev) worstCant = Math.max(worstCant, maxOverhang(p, prev)); prev = p;
    if (l >= sp.podium) {
      ev.cores[l] = coreAt(sp, l, cArea, sp.coreOff, offDir);
      if (!reserved.has(l)) fsiUsed += ringArea(p);
      const key = signature(sp.typology === "twisted" ? localPlate({ ...sp, typology: sp.p.base || "square" }, l) : localPlate(sp, l)); sig[key] = (sig[key] || 0) + 1;
    }
  }
  const hard = (id, ok, detail) => { ev.checks[id] = [ok, detail]; if (!ok) ev.viol.push(id); };
  hard("ENV-ENVELOPE-01", outside === 0, outside ? `${outside} floor plate(s) cross the buildable envelope` : "every floor plate is inside the envelope");
  hard("ENV-HEIGHT-01", sp.n * sp.ftf <= C.hmax + 1e-9, `${f2(sp.n * sp.ftf, 1)} m ≤ ${C.hmax} m`);
  hard("ENV-FSI-01", fsiUsed <= C.fsi + 1e-6, `${Math.round(fsiUsed)} ≤ ${Math.round(C.fsi)} m²`);
  hard("GR-CANT-01", worstCant <= R.cant + 1e-9, `max overhang ${f2(worstCant, 2)} m ≤ ${R.cant} m`);
  const tower = []; for (let l = sp.podium; l < sp.n; l++) tower.push(l);
  const probes = [...new Set([tower[0], tower[Math.floor(tower.length / 2)], tower[tower.length - 1]])];
  let rLo = 1, rHi = 0, depth = 0, span = 0, fit = true, minDepth = 1e9;
  for (const l of probes) { const p = ev.plates[l], c = ev.cores[l], r = ringArea(c) / ringArea(p); rLo = Math.min(rLo, r); rHi = Math.max(rHi, r); fit = fit && coreFits(p, c, R.fit); const st = structure(p, c, C.colSpacing); ev.cols[l] = st.cols; depth = Math.max(depth, st.depthP90); minDepth = Math.min(minDepth, st.minDepth); span = Math.max(span, st.maxGap, st.span); }
  hard("GR-CORE-FIT-01", fit, `core inside plate with ${R.fit} m slab margin`);
  hard("GR-CORE-RATIO-01", rLo >= R.coreLo && rHi <= R.coreHi, `core ratio ${f2(rLo, 3)}–${f2(rHi, 3)} (limits ${R.coreLo}–${R.coreHi})`);
  hard("GR-DEPTH-01", depth <= R.depth + 1e-9, `P90 core-to-facade ${f2(depth, 2)} m ≤ ${R.depth} m`);
  hard("GR-SPAN-01", span <= R.span + 1e-9, `max slab span ${f2(span, 2)} m ≤ ${R.span} m`);
  const slender = sp.n * sp.ftf / minWidth(ev.plates[tower[0]]), rep = Math.max(...Object.values(sig)) / tower.length;
  Object.assign(ev.metrics, { height: sp.n * sp.ftf, floors: sp.n, fsiUsed, fsiUtil: fsiUsed / C.fsi, coreRatio: rHi, depth, minDepth, span, overhang: worstCant, slender, rep,
    structural: 0.4 * span / R.span + 0.3 * (1 - rep) + 0.3 * Math.min(slender / 12, 1.5), constructability: rep * Math.max(0, 1 - worstCant / R.cant) });
  ev.checks["GR-SLEND-01"] = [slender <= 8, slender <= 8 ? `slenderness 1:${f2(slender, 1)} ≤ 1:8 (advisory)` : `slenderness 1:${f2(slender, 1)} above 1:8: wind tunnel study and damping likely (advisory, does not reject)`];
  if (slender > 12) ev.explain.push(`Slenderness 1:${f2(slender, 1)} is above 1:12 (GR-SLEND-01): expect wind engineering and damping.`); else if (slender > 8) ev.explain.push(`Slenderness 1:${f2(slender, 1)} is above 1:8 (GR-SLEND-01): wind review advisable.`);
  if (minDepth < 6) ev.explain.push(`Shallowest room zone ${f2(minDepth, 1)} m is under 6 m (GR-DEPTH-02).`);
  ev.feasible = !ev.viol.length; return ev;
}
function evaluateViews(ev, S, C, V) {
  const sp = ev.sp, R = C.R, reserved = new Set(C.reserved), saleable = []; for (let l = sp.podium; l < sp.n; l++) if (!reserved.has(l)) saleable.push(l);
  if (!saleable.length) { ev.viol.push("ENV-FSI-01"); ev.checks["ENV-FSI-01"] = [false, "every tower floor is reserved"]; ev.feasible = false; return ev; }
  const evaluated = [...new Set(saleable.filter((_, i) => i % Math.max(1, C.evalEvery) === 0).concat([saleable[saleable.length - 1]]))].sort((a, b) => a - b);
  const beds = sp.upf === 1 ? C.beds[0] : sp.upf === 2 ? C.beds[1] : C.beds[2];
  const prog = { bedrooms: beds, living: Math.max(C.living, R.frontLR), bed: Math.max(C.bed, R.frontBR), kitchen: 3 };
  const byLevel = {}, viol = new Set(); let privFail = 0; const top = sp.n * sp.ftf, spacing = V.spacing;
  const evalLevel = l => {
    const plate = ev.plates[l], core = ev.cores[l], pp = perimeterPoints(plate, spacing), z = l * sp.ftf + 1.5;
    const obs = pp.pts.map(([x, y], i) => [x + 0.75 * Math.sin(pp.normals[i] * D2R), y + 0.75 * Math.cos(pp.normals[i] * D2R), z]);
    const ap = evalApertures(S, obs, pp.normals, { ring: plate, bb: bounds(plate), top }, V);
    const { units, viol: v } = buildUnits(l, l * sp.ftf, plate, core, pp, spacing, ap, sp.upf, prog, C.split, ev.arc ? coreOffsetDir(ev.arc) : null); v.forEach(x => viol.add(x));
    for (const u of units) for (const r of u.rooms) if (r.room !== "kitchen_service" && r.dMed < R.priv && r.privacy > 0) privFail = Math.max(privFail, R.priv - r.dMed);
    byLevel[l] = units; if (C.keepAp) (ev.apByLevel || (ev.apByLevel = {}))[l] = ap;
  };
  evaluated.forEach(evalLevel);
  // adaptive refinement: where the unit classes change between two sampled floors, evaluate the floor
  // halfway between them, until the change is pinned to adjacent sampled floors
  if (C.refine !== false && C.evalEvery > 1) {
    const sig = l => byLevel[l].map(u => classify(u, R).cls).join(",");
    for (let guard = 0; guard < saleable.length; guard++) {
      evaluated.sort((a, b) => a - b); let added = false;
      for (let i = 0; i + 1 < evaluated.length; i++) {
        const a = evaluated[i], b = evaluated[i + 1], mid = saleable.filter(l => l > a && l < b); if (!mid.length || sig(a) === sig(b)) continue;
        const m = mid[mid.length >> 1]; evalLevel(m); evaluated.push(m); added = true;
      }
      if (!added) break;
    }
    evaluated.sort((a, b) => a - b);
  }
  // facing distance: hard fail only below privHard (NYC: 30 ft between building portions); up to R.priv
  // (London 18-21 m yardstick) it is advisory and the privacy penalty already lowers the flat's class
  const closest = R.priv - privFail, hard = R.privHard ?? 0;
  ev.checks["GR-PRIV-01"] = privFail > 0 && closest < hard ? [false, `a habitable room faces a habitable building only ${f2(closest, 1)} m away (hard limit ${hard} m)`] : [true, privFail > 0 ? `closest facing habitable building ${f2(closest, 1)} m (≥ ${hard} m hard limit; below the ${R.priv} m yardstick, so those rooms carry a privacy penalty)` : `all habitable rooms ≥ ${R.priv} m from habitable neighbours`];
  if (privFail > 0 && closest < hard) viol.add("GR-PRIV-01");
  for (const vv of ["GR-FRONT-LR-01", "GR-FRONT-BR-01", "GR-FRONT-UNIT-01"]) ev.checks[vv] = viol.has(vv) ? [false, "frontage does not fit the room programme"] : [true, `living ${prog.living} m and ${beds} bedrooms × ${prog.bed} m fit on the facade`];
  const units = [];
  for (const l of saleable) {
    const src = Math.max(...evaluated.filter(e => e <= l));
    for (const u of byLevel[src]) { if (l === src) { units.push(u); continue; } units.push({ ...u, id: `L${String(l).padStart(3, "0")}-U${u.id.split("-U")[1]}`, level: l, z: l * sp.ftf, areaScale: ringArea(ev.plates[l]) / ringArea(ev.plates[src]), evaluated: false, inheritFrom: src }); }
  }
  for (const u of units) { const r = classify(u, R); u.cls = r.cls; u.reasons = r.reasons.concat(u.evaluated ? [] : [`view results inherited from level ${u.inheritFrom}`]); u.margin = r.margin; u.premSlack = r.premSlack ?? null; }
  priceUnits(units, saleable[0], C.E);
  for (const u of units) if (u.areaScale && Math.abs(u.areaScale - 1) > 1e-9) { u.carpet *= u.areaScale; u.value *= u.areaScale; }
  const grossAll = Object.values(ev.plates).reduce((s, p) => s + ringArea(p), 0), grossSale = saleable.reduce((s, l) => s + ringArea(ev.plates[l]), 0);
  const gdv = units.reduce((s, u) => s + u.value, 0), rates = units.map(u => u.rate), cnt = { premium: 0, good: 0, neutral: 0, compromised: 0 }; units.forEach(u => cnt[u.cls]++);
  const H = sp.n * sp.ftf, heightF = 1 + 0.04 * (H > 70) + 0.06 * (H > 120) + 0.08 * (H > 200); // taller towers cost more per ft2 (plant, wind, lifts)
  const cost = grossAll * FT2 * C.E.cost * heightF * (1 + 0.15 * ev.metrics.structural), risky = units.filter(u => u.cls === "neutral" || u.cls === "compromised").reduce((s, u) => s + u.value, 0);
  const bedsAll = units.flatMap(u => u.rooms.filter(r => r.room.startsWith("bed"))), living = units.map(u => u.rooms.find(r => r.room === "living")).filter(Boolean), carpet = units.reduce((s, u) => s + u.carpet, 0);
  ev.units = units; ev.evaluated = evaluated; ev.viol = [...new Set(ev.viol.concat([...viol]))].sort(); ev.feasible = !ev.viol.length;
  Object.assign(ev.metrics, { units: units.length, ...cnt, premiumShare: cnt.premium / Math.max(units.length, 1), premiumBeds: bedsAll.filter(b => (b.prize ?? b.water) >= R.vcBR.w_min).length, bedsTotal: bedsAll.length,
    livingView: mean(living.map(r => r.q)), carpet, efficiency: grossSale ? carpet / grossSale : 0, gdv, gdvCr: gdv / 1e7, cost, margin: gdv - cost,
    privacy: 1 - mean(units.map(u => Math.max(...u.rooms.map(r => r.privacy)))), minMargin: Math.min(...units.map(u => u.margin)),
    rateCV: rates.length ? Math.sqrt(mean(rates.map(r => (r - mean(rates)) ** 2))) / mean(rates) : 0, risk: gdv ? risky / gdv : 0, evalLevels: evaluated.length });
  const m = ev.metrics;
  ev.explain.unshift(`${m.units} units: ${m.premium} premium, ${m.good} good, ${m.neutral} neutral, ${m.compromised} compromised.`, `GDV ₹${Math.round(m.gdvCr).toLocaleString("en-IN")} cr on ${Math.round(m.carpet).toLocaleString("en-IN")} m² carpet (efficiency ${f2(m.efficiency, 2)}, FSI used ${f2(100 * m.fsiUtil, 0)}%).`);
  const comp = units.filter(u => u.cls === "compromised"); if (comp.length) { const lo = comp.reduce((a, b) => a.level <= b.level ? a : b); ev.explain.push(`Lowest compromised unit ${lo.id}: ${lo.reasons[0]}.`); }
  const neu = units.filter(u => u.cls === "neutral"); if (neu.length) ev.explain.push(`Neutral units sit on levels ${Math.min(...neu.map(u => u.level))}–${Math.max(...neu.map(u => u.level))}.`);
  return ev;
}
/* ------------------------------------------------------------------ multi-tower sites */
function scaleSpec(sp, k) { const q = { ...sp, width: +(sp.width * k).toFixed(2), depth: +(sp.depth * k).toFixed(2), p: { ...sp.p } }; for (const f of ["wing_len", "wing_w", "chamfer_m", "step_m"]) if (q.p[f] != null) q.p[f] = +(q.p[f] * k).toFixed(2); return q; }
function fitsAt(sp, env) { if (sp.n <= sp.podium) return false; const st = Math.max(1, Math.floor((sp.n - sp.podium) / 12)), lv = [0]; for (let l = sp.podium; l < sp.n; l += st) lv.push(l); lv.push(sp.n - 1); return lv.every(l => contains(env, plateAt(sp, l))); }
/* Place N towers of one spec: shrink in 6 % steps (not below 16 m) until N footprints fit the envelope at
   least C.towerSep apart; towers are spread greedily (max-min spacing), the first at the deepest point. */
function siteLayout(sp0, N, env, C) {
  const Ci = { ...C, fsi: C.fsi / N }, sep = C.towerSep ?? 24, [x0, y0, x1, y1] = bounds(env), step = Math.max(2, Math.sqrt(ringArea(env)) / 40);
  for (let i = 0, k = 1; i <= 20; i++, k *= 0.94) {
    const base = resolveFloors(scaleSpec({ ...sp0, n: 0 }, k), Ci); if (Math.min(base.width, base.depth) < 16 && i > 0) break;
    const cands = []; for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) { if (!pip(x, y, env)) continue; const q = { ...base, position: [+x.toFixed(2), +y.toFixed(2)] }; if (fitsAt(q, env)) cands.push({ q, d: distToBoundary(x, y, env), fp: plateAt(q, q.podium) }); }
    if (cands.length < N) continue;
    cands.sort((a, b) => b.d - a.d); const chosen = [cands[0]];
    while (chosen.length < N) {
      let best = null, bd = -1; for (const c of cands) { if (chosen.includes(c)) continue; const m = Math.min(...chosen.map(o => polyDistance(o.fp, c.fp))); if (m >= sep && m > bd) { bd = m; best = c; } }
      if (!best) break; chosen.push(best);
    }
    if (chosen.length === N) return { sps: chosen.map((c, j) => ({ ...c.q, tower: j, count: N })), note: k < 1 ? `scaled to ${Math.round(k * 100)}% to fit ${N} towers` : "" };
  }
  return null;
}
/* Scene with other towers burned in (they block views and count as habitable neighbours for privacy). */
function withTowers(S, evs) {
  const H = Float32Array.from(S.H), HAB = Uint8Array.from(S.HAB), W = Uint8Array.from(S.W), G = Uint8Array.from(S.G);
  for (const ev of evs) for (const [l, p] of Object.entries(ev.plates)) { const top = (+l + 1) * ev.sp.ftf, [a, b, c, d] = bounds(p);
    for (let i = Math.max(0, Math.floor((b - S.y0) / S.res)); i <= Math.min(S.ny - 1, Math.floor((d - S.y0) / S.res)); i++) for (let j = Math.max(0, Math.floor((a - S.x0) / S.res)); j <= Math.min(S.nx - 1, Math.floor((c - S.x0) / S.res)); j++) {
      if (!pip(S.x0 + (j + 0.5) * S.res, S.y0 + (i + 0.5) * S.res, p)) continue; const k = i * S.nx + j; if (top > H[k]) H[k] = top; HAB[k] = 1; W[k] = 0; G[k] = 0; } }
  return { ...S, H, HAB, W, G };
}
/* Evaluate a whole site: N towers of the same typology; returns one combined result with .towers. */
function evaluateSite(sps, env, C, S, V, arc, onMassing) {
  const N = sps.length, Ci = { ...C, fsi: C.fsi / N }, evs = sps.map(sp => checkCandidate(sp, env, Ci, arc));
  let sepMin = Infinity; for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) for (const l of [evs[i].sp.podium, Math.floor(evs[i].sp.n / 2), evs[i].sp.n - 1]) { const a = evs[i].plates[Math.min(l, evs[i].sp.n - 1)], b = evs[j].plates[Math.min(l, evs[j].sp.n - 1)]; if (a && b) sepMin = Math.min(sepMin, polyDistance(a, b)); }
  if (onMassing) onMassing(evs);
  if (evs.every(e => e.feasible)) evs.forEach((ev, i) => evaluateViews(ev, N > 1 ? withTowers(S, evs.filter((_, j) => j !== i)) : S, Ci, V));
  if (N === 1) { evs[0].towers = [evs[0]]; return evs[0]; }
  const sep = C.towerSep ?? 24, M = {}, sum = k => evs.reduce((a, e) => a + (e.metrics[k] || 0), 0), wmean = (k, w) => evs.reduce((a, e) => a + (e.metrics[k] || 0) * (e.metrics[w] || 0), 0) / Math.max(1e-9, sum(w));
  for (const k of ["units", "premium", "good", "neutral", "compromised", "gdv", "cost", "margin", "carpet", "fsiUsed", "premiumBeds", "bedsTotal"]) M[k] = sum(k);
  Object.assign(M, { gdvCr: M.gdv / 1e7, fsiUtil: M.fsiUsed / C.fsi, premiumShare: M.premium / Math.max(1, M.units), livingView: wmean("livingView", "units"), efficiency: wmean("efficiency", "units"), structural: Math.max(...evs.map(e => e.metrics.structural || 0)),
    slender: Math.max(...evs.map(e => e.metrics.slender || 0)), height: Math.max(...evs.map(e => e.metrics.height || 0)), coreRatio: wmean("coreRatio", "units"), privacy: wmean("privacy", "units"), minMargin: Math.min(...evs.map(e => e.metrics.minMargin ?? 1)), towers: N, towerSep: sepMin });
  const units = []; evs.forEach((e, i) => (e.units || []).forEach(u => units.push({ ...u, id: `T${i + 1}-${u.id}`, tower: i })));
  const rates = units.map(u => u.rate); M.rateCV = rates.length ? Math.sqrt(mean(rates.map(r => (r - mean(rates)) ** 2))) / mean(rates) : 0; M.risk = M.gdv ? units.filter(u => u.cls === "neutral" || u.cls === "compromised").reduce((a, u) => a + u.value, 0) / M.gdv : 0;
  const checks = {}; evs.forEach((e, i) => Object.entries(e.checks).forEach(([id, v]) => { if (!checks[id] || !v[0]) checks[id] = [v[0] && (checks[id] ? checks[id][0] : true), N > 1 ? `tower ${i + 1}: ${v[1]}` : v[1]]; }));
  checks["GR-SEP-01"] = [sepMin >= sep - 1e-6, `towers ${f2(sepMin, 1)} m apart (min ${sep} m)`];
  const viol = [...new Set(evs.flatMap(e => e.viol).concat(sepMin >= sep - 1e-6 ? [] : ["GR-SEP-01"]))].sort();
  const e0 = evs[0];
  return { id: fnv(evs.map(e => e.id).join("|")), sp: { ...e0.sp, count: N }, towers: evs, arc: e0.arc, feasible: !viol.length, viol, checks, metrics: M, plates: e0.plates, cores: e0.cores, cols: e0.cols, units, evaluated: e0.evaluated,
    explain: [`${N} towers, ${M.units} units: ${M.premium} premium, ${M.good} good, ${M.neutral} neutral, ${M.compromised} compromised; closest towers ${f2(sepMin, 1)} m apart.`].concat(...evs.map((e, i) => (e.explain || []).slice(0, 2).map(x => `Tower ${i + 1}: ${x}`))) };
}

const OBJ = [["margin", "max"], ["compromised", "min"], ["premium", "max"], ["livingView", "max"], ["efficiency", "max"], ["structural", "min"]];
function paretoRanks(evs) {
  const n = evs.length, v = evs.map(e => OBJ.map(([k, s]) => (s === "max" ? 1 : -1) * e.metrics[k])), rank = new Array(n).fill(-1);
  const dom = (a, b) => { let ge = true, gt = false; for (let k = 0; k < a.length; k++) { if (a[k] < b[k] - 1e-12) ge = false; if (a[k] > b[k] + 1e-12) gt = true; } return ge && gt; };
  let r = 0; const left = new Set(evs.map((_, i) => i));
  while (left.size) { const L = [...left], front = L.filter(i => !L.some(j => j !== i && dom(v[j], v[i]))); front.forEach(i => { rank[i] = r; left.delete(i); }); r++; }
  evs.forEach((e, i) => e.rank = rank[i]);
}
const presKey = e => [e.rank, e.metrics.compromised === 0 ? 0 : 1, -e.metrics.margin, e.id];
function cmpKey(a, b) { const ka = presKey(a), kb = presKey(b); for (let i = 0; i < ka.length; i++) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1; } return 0; }

G.VT = { D2R, R2D, FT2, mod, signedArea, ringArea, ccw, box, rot, tr, scl, centroid, bounds, pip, segDist, distToBoundary, distPoly, edgesCross, polysIntersect, polyDistance, contains, hull, percentile, median, mean, minWidth, fnv, clipConvex,
  sampleDistances, castRay, landmarkInfo, quality, normWeights, viewSettings, evalApertures, viewCone, premiumArc, siteViewField,
  MODIFIERS, baseShape, tokenPlate, localPlate, plateAt, coreAt, perimeterPoints, structure, maxOverhang, coreFits, splitCuts, unitEnvelopes, mpArea, buildUnits, classify, unitMult, priceUnits,
  resolveFloors, coreOffsetDir, specId, checkCandidate, evaluateViews, paretoRanks, cmpKey, scaleSpec, fitsAt, siteLayout, withTowers, evaluateSite };
})(typeof self !== "undefined" ? self : this);
