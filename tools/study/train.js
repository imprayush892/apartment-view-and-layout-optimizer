/* Build the open vector dataset and fit the segment model.
   node tools/study/train.js <sitesPerCity> <typologiesPerSite> [seed]
   Rows -> data/vectors/segments.jsonl.gz ; model -> web/data/typology_model.json */
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const fs = require("fs"), path = require("path"), zlib = require("zlib");
if (isMainThread) {
  const C = require("./common.js"), perCity = +process.argv[2] || 8, perSite = +process.argv[3] || 10, seed = +process.argv[4] || 101, cities = C.available();
  const r = C.TOK.rng(seed), jobs = [];
  for (const k of cities) for (let i = 0; i < perCity; i++) { const s = C.randomSite(k, r); if (s) jobs.push({ id: `train-${k}-${i}`, site: s, seed: seed * 1000 + jobs.length }); }
  console.error(`training sites: ${jobs.length} (${cities.join(", ")}), ${perSite} typologies each`);
  const NW = 4, out = [], stats = []; let done = 0; const t0 = Date.now();
  const ws = Array.from({ length: NW }, (_, w) => new Promise(res => { const wk = new Worker(__filename, { workerData: { jobs: jobs.filter((_, i) => i % NW === w), perSite } }); wk.on("message", m => { if (m.rows) { out.push(...m.rows); stats.push(...m.stats); done++; if (done % 4 === 0) console.error(`${done}/${jobs.length} sites, ${out.length} rows, ${((Date.now() - t0) / 1000).toFixed(0)} s`); } }); wk.on("exit", res); wk.on("error", e => { console.error(e); res(); }); }));
  Promise.all(ws).then(() => {
    const dir = path.join(__dirname, "..", "..", "data", "vectors"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "segments.jsonl.gz"), zlib.gzipSync(out.map(r => JSON.stringify(r)).join("\n")));
    fs.writeFileSync(path.join(dir, "training_evaluations.json"), JSON.stringify(stats, null, 0));
    // hold out 20 % of sites for validation
    const sites = [...new Set(out.map(r => r.site))], test = new Set(sites.filter((_, i) => i % 5 === 0)), tr = out.filter(r => !test.has(r.site)), te = out.filter(r => test.has(r.site));
    const model = C.TOK.train(tr, 1e-3), pred = (x, t) => C.TOK.predict(model, x, t);
    const r2 = t => { const ys = te.map(r => r.y[t]), m = C.VT.mean(ys), ss = ys.reduce((a, y) => a + (y - m) ** 2, 0), se = te.reduce((a, r) => a + (r.y[t] - pred(r.x, t)) ** 2, 0); return ss ? 1 - se / ss : 0; };
    model.heldOutR2 = { q: r2("q"), prize: r2("prize"), priv: r2("priv") }; model.rowsTrain = tr.length; model.rowsTest = te.length; model.sites = sites.length; model.cities = cities; model.created = new Date().toISOString();
    fs.writeFileSync(path.join(__dirname, "..", "..", "web", "data", "typology_model.json"), JSON.stringify(model, null, 1));
    console.log(JSON.stringify({ rows: out.length, evals: stats.length, trainR2: model.r2, heldOutR2: model.heldOutR2, secs: (Date.now() - t0) / 1000 }));
  });
} else {
  const C = require("./common.js"), L = C.TOK.library();
  for (const job of workerData.jobs) {
    const r = C.TOK.rng(job.seed), P = C.prepare(job.site, { keepAp: true }), rows = [], stats = [];
    if (P) for (let k = 0; k < workerData.perSite; k++) {
      const typ = L[Math.floor(r() * L.length)], rot = Math.round(r() * 90), sp = C.TOK.toSpec(typ, P.pos, rot, P.viewAz, P.C);
      const ev = C.evaluate(P, sp); if (!ev) { stats.push({ site: job.id, lib: typ.id, rot, fit: false }); continue; }
      stats.push({ site: job.id, lib: typ.id, rot, fit: true, feasible: ev.feasible, viol: ev.viol, units: ev.metrics.units, premium: ev.metrics.premium, compromised: ev.metrics.compromised, livingView: ev.metrics.livingView, gdvCr: ev.metrics.gdvCr });
      for (const t of ev.towers || [ev]) if (t.apByLevel) rows.push(...C.TOK.rowsFromEval(t, P.S, P.field, P.viewAz, P.dense, job.id, P.V));
    }
    parentPort.postMessage({ rows, stats });
  }
}
