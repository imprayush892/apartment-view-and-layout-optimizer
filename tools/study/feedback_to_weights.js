/* Turn the architects' image-only critiques into hybrid-generator weights.
   node tools/study/feedback_to_weights.js <critiques.json> -> data/study/hybrid_weights.json (+ web/data copy)
   critiques.json: [{ id, A:{...}, B:{...}, preference, ... }] with blind A/B mapped back to systems via blind.json.
   Rules (documented in docs/spec/14):
   - every floor change suggested for a design counts as a vote for (+) or against (-) a token family,
     weighted by how far that design's overall rating is from 10 (the less satisfied, the stronger);
   - token-family votes shift the generator's categorical priors (clipped to [0.03, 0.8] then renormalised)
     and its numeric priors (size, rate, amplitude, step);
   - privacy and constructability ratings shift the objective weights (privacy penalty, complexity). */
const fs = require("fs"), path = require("path"), DIR = path.join(__dirname, "..", "..", "data", "study");
const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).rows; // output of analyze_critiques.js (blind labels already mapped to systems)
const MOVE = { // move -> [category, value, sign] or numeric nudges
  terrace_toward_outlook: [["terrace", "view", +1]], terrace_away: [["terrace", "none", +1]], twist_more: [["twist", "linear", +1], ["twist", "ease", +0.5], ["num", "rate", +0.15]], twist_less_or_remove: [["twist", "none", +1], ["num", "rate", -0.15]],
  taper_more: [["taper", "linear", +1], ["num", "top", -0.03]], taper_less: [["taper", "none", +1], ["num", "top", +0.03]], stagger_or_cantilever: [["shift", "stagger", +1], ["shift", "pixel", +0.5]], remove_stagger: [["shift", "none", +1]],
  lean_toward_outlook: [["shift", "lean", +1]], corner_gardens_or_cutouts: [["cut", "cut", +1]], rotate_plate_to_outlook: [["num", "rot", -1]], chamfer_or_round_corners: [["base", "chamfered", +0.6], ["base", "curved", +0.6]],
  more_slender: [["num", "size", -0.6]], less_slender_or_wider: [["num", "size", +0.6]], splay_or_offset_to_avoid_facing: [["base", "y_shaped", +0.4], ["base", "triangular", +0.3], ["W", "priv", +0.02]],
  podium_or_base_changes: [["podium", "street", +1]], crown_or_top_articulation: [["crown", "crown", +0.6], ["crown", "crown_turn", +0.6]], spread_towers_apart: [["splay", 1]], fewer_towers: [["W", "complexity", +0.005]],
  simplify_for_constructability: [["W", "complexity", +0.01], ["twist", "none", +0.5], ["shift", "none", +0.5]], add_variety_between_floors: [["shift", "pixel", +0.6], ["taper", "frustum", +0.5], ["W", "complexity", -0.01]],
};
const CATS = { base: ["square", "rectangular", "chamfered", "curved", "diamond", "triangular", "y_shaped", "cross", "t_shaped"], twist: ["none", "linear", "band", "ease"], taper: ["none", "linear", "frustum", "bulge"], shift: ["none", "stagger", "lean", "wave", "pixel"], terrace: ["none", "view"], cut: ["none", "cut"], podium: ["none", "street"], crown: ["none", "crown", "crown_turn"] };
const votes = {}; for (const [k, vs] of Object.entries(CATS)) { votes[k] = {}; vs.forEach(v => votes[k][v] = 0); }
const num = { size: 0, rate: 0, top: 0, rot: 0 }, W = { q: 1, prize: 0.6, priv: 0.4, complexity: 0.05, appeal: 0.3 }; let n = 0, privLow = 0, consLow = 0, splay = 0, splayN = 0;
const counts = {};
for (const r of rows) for (const [sys, d] of Object.entries(r.bySys)) {
  if (!d || !Number.isFinite(d.overall)) continue; n++;
  const w = Math.max(0.1, (10 - d.overall) / 10);
  if (d.privacy_overlooking <= 4) privLow++; if (d.constructability <= 4) consLow++;
  for (const fc of d.floor_changes || []) { counts[fc.move] = (counts[fc.move] || 0) + 1; for (const [cat, val, sg] of MOVE[fc.move] || []) {
    if (cat === "splay") { splay += w; splayN++; } else if (cat === "num") num[val] += sg * w; else if (cat === "W") W[val] = +(W[val] + sg * w).toFixed(4); else votes[cat][val] += sg * w; } }
}
const prior = {}; for (const [k, vs] of Object.entries(CATS)) { const base = 1 / vs.length, tot = Object.values(votes[k]).reduce((a, b) => a + Math.abs(b), 0) || 1; const raw = vs.map(v => Math.min(0.8, Math.max(0.03, base * (1 + 2 * votes[k][v] / tot)))); const s = raw.reduce((a, b) => a + b, 0); prior[k] = {}; vs.forEach((v, i) => prior[k][v] = +(raw[i] / s).toFixed(4)); }
const scale = x => Math.max(-1, Math.min(1, x / Math.max(1, n / 4)));
const numPrior = { size: [+(28 - 4 * scale(-num.size)).toFixed(2), 5], rate: [+Math.max(0.3, 1.2 + 0.8 * scale(num.rate)).toFixed(2), 0.8], top: [+(0.85 + 0.1 * scale(num.top)).toFixed(3), 0.12], rot: [0, +Math.max(8, 30 - 20 * scale(-num.rot)).toFixed(1)] };
W.priv = +Math.min(0.7, W.priv + 0.4 * privLow / Math.max(1, n)).toFixed(3); // capped: the privacy predictor has little signal
W.complexity = +Math.max(0.01, Math.min(0.3, W.complexity + 0.2 * consLow / Math.max(1, n))).toFixed(3);
const towerSplay = splayN + (counts.splay_or_offset_to_avoid_facing || 0) > n * 0.1 ? 15 : 0; // enough architects asked towers not to face each other
const out = { created: new Date().toISOString(), designsCritiqued: n, moveCounts: counts, prior, numPrior, W, towerSplay, rotationRefine: (counts.rotate_plate_to_outlook || 0) > n * 0.1, notes: "Derived from architects' image-only critiques; see docs/spec/14_architect_study.md" };
fs.writeFileSync(path.join(DIR, "hybrid_weights.json"), JSON.stringify(out, null, 1)); fs.writeFileSync(path.join(__dirname, "..", "..", "web", "data", "hybrid_weights.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
