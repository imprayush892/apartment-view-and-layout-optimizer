/* Fit the architect-appeal model: overall rating (1-10) of each rated design ~ visible design features.
   node tools/study/appeal.js data/study/critiques_r1.json -> web/data/appeal_model.json */
const fs = require("fs"), path = require("path"), H = require("../harness.js"), { TOK, VT } = H, DIR = path.join(__dirname, "..", "..", "data", "study");
const crit = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).rows, X = [], Y = [], G = [];
for (const r of crit) { const res = JSON.parse(fs.readFileSync(path.join(DIR, "results", r.id + ".json"), "utf8"));
  for (const [s, d] of Object.entries(r.bySys)) { const b = res[s] && res[s].best; if (!b || !Number.isFinite(d.overall)) continue; X.push(TOK.appealFeatures(b.towers[0], res.site.viewAz, b.towers.length)); Y.push(d.overall); G.push(r.id); } }
const ids = [...new Set(G)], test = new Set(ids.filter((_, i) => i % 5 === 0)), tr = X.map((_, i) => i).filter(i => !test.has(G[i])), te = X.map((_, i) => i).filter(i => test.has(G[i]));
const w = TOK.ridge(tr.map(i => X[i]), tr.map(i => Y[i]), 5e-2), pred = x => x.reduce((a, v, i) => a + v * w[i], 0);
const r2 = idx => { const m = VT.mean(idx.map(i => Y[i])), ss = idx.reduce((a, i) => a + (Y[i] - m) ** 2, 0), se = idx.reduce((a, i) => a + (Y[i] - pred(X[i])) ** 2, 0); return 1 - se / ss; };
const model = { features: TOK.APPEAL_FEAT, w, mean: VT.mean(Y), n: X.length, trainR2: +r2(tr).toFixed(3), heldOutR2: +r2(te).toFixed(3), created: new Date().toISOString(), note: "Predicts architects' overall rating from visible design features (round-1 image-only critiques). Podium and crown did not exist in round 1, so their weights are 0 here; the hybrid takes them from the requested moves instead." };
fs.writeFileSync(path.join(__dirname, "..", "..", "web", "data", "appeal_model.json"), JSON.stringify(model, null, 1));
console.log(JSON.stringify({ n: model.n, trainR2: model.trainR2, heldOutR2: model.heldOutR2, weights: Object.fromEntries(TOK.APPEAL_FEAT.map((f, i) => [f, +w[i].toFixed(3)])) }, null, 1));
