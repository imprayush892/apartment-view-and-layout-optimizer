/* Fit the architect-appeal model: overall rating (1-10) of each rated design ~ visible design features.
   node tools/study/appeal.js data/study/critiques_r1.json [data/study/critiques_r2.json ...] -> web/data/appeal_model.json
   Also writes data/study/appeal_folds.json: five cross-fitted models (fold k is trained without the sites in fold k),
   so the study's hybrid never scores a site's designs with a model that saw that site's ratings. */
const fs = require("fs"), path = require("path"), H = require("../harness.js"), { TOK, VT } = H, DIR = path.join(__dirname, "..", "..", "data", "study");
const WIN1 = fs.existsSync(path.join(DIR, "win1.json")) ? JSON.parse(fs.readFileSync(path.join(DIR, "win1.json"), "utf8")) : {};
const files = process.argv.slice(2), X = [], Y = [], G = [], seen = new Set();
for (const file of files) for (const r of JSON.parse(fs.readFileSync(file, "utf8")).rows) { const res = JSON.parse(fs.readFileSync(path.join(DIR, "results", r.id + ".json"), "utf8"));
  for (const [s, d] of Object.entries(r.bySys)) { const key = s === "win1" ? WIN1[r.id] : s, b = res[key] && res[key].best; if (!b || !Number.isFinite(d.overall)) continue;
    X.push(TOK.appealFeatures(b.towers[0], res.site.viewAz, b.towers.length)); Y.push(d.overall); G.push(r.id); seen.add(`${path.basename(file)}:${s}`); } }
const fold = id => parseInt(id.slice(1)) % 5, lam = 5e-2;
const fit = idx => TOK.ridge(idx.map(i => X[i]), idx.map(i => Y[i]), lam), predW = (w, x) => x.reduce((a, v, i) => a + v * w[i], 0);
const r2 = (w, idx) => { const m = VT.mean(idx.map(i => Y[i])), ss = idx.reduce((a, i) => a + (Y[i] - m) ** 2, 0), se = idx.reduce((a, i) => a + (Y[i] - predW(w, X[i])) ** 2, 0); return 1 - se / ss; };
const all = X.map((_, i) => i), folds = [0, 1, 2, 3, 4].map(k => { const tr = all.filter(i => fold(G[i]) !== k), te = all.filter(i => fold(G[i]) === k), w = fit(tr); return { fold: k, w, mean: VT.mean(tr.map(i => Y[i])), n: tr.length, heldOutR2: +r2(w, te).toFixed(3) }; });
const w = fit(all), cvR2 = +VT.mean(folds.map(f => f.heldOutR2)).toFixed(3);
const model = { features: TOK.APPEAL_FEAT, w, mean: VT.mean(Y), n: X.length, trainR2: +r2(w, all).toFixed(3), heldOutR2: cvR2, heldOut: "mean of 5 site-grouped folds", sources: [...seen], created: new Date().toISOString(),
  note: "Predicts architects' overall rating from visible design features (image-only critiques, rounds 1 and 2). Round 2 includes designs with podium and crown tokens." };
fs.writeFileSync(path.join(__dirname, "..", "..", "web", "data", "appeal_model.json"), JSON.stringify(model, null, 1));
fs.writeFileSync(path.join(DIR, "appeal_folds.json"), JSON.stringify({ features: TOK.APPEAL_FEAT, fold: "parseInt(id.slice(1)) % 5", folds }, null, 1));
console.log(JSON.stringify({ n: model.n, trainR2: model.trainR2, cvHeldOutR2: cvR2, folds: folds.map(f => f.heldOutR2), weights: Object.fromEntries(TOK.APPEAL_FEAT.map((f, i) => [f, +w[i].toFixed(3)])) }, null, 1));
