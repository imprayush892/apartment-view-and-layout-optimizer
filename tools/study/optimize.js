/* Run the deterministic and probabilistic systems (and later the hybrid) for every architect's site.
   node tools/study/optimize.js <modes: det,prob,hyb> [limit] [--workers 4]
   Writes data/study/results/<id>.json (best design per system + the alternatives' metrics). */
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const fs = require("fs"), path = require("path");
const DIR = path.join(__dirname, "..", "..", "data", "study");
const summary = ev => ev && ev.feasible ? { feasible: true, units: ev.metrics.units, premium: ev.metrics.premium, good: ev.metrics.good, neutral: ev.metrics.neutral, compromised: ev.metrics.compromised, premiumShare: +(ev.metrics.premium / Math.max(1, ev.metrics.units)).toFixed(4), livingView: +ev.metrics.livingView.toFixed(4), gdvCr: +ev.metrics.gdvCr.toFixed(1), marginCr: +(ev.metrics.margin / 1e7).toFixed(1), efficiency: +ev.metrics.efficiency.toFixed(4), structural: +(ev.metrics.structural || 0).toFixed(3), height: ev.metrics.height, slender: +(ev.metrics.slender || 0).toFixed(2), fsiUtil: +(ev.metrics.fsiUtil || 0).toFixed(3) } : { feasible: false, viol: ev ? ev.viol : ["NO-FIT"] };
const towersOf = ev => (ev.towers || [ev]).map(t => { const { lib, ...sp } = t.sp; return { ...sp, lib }; });
function pickBest(C, evs) { const ok = evs.filter(e => e && e.feasible); if (!ok.length) return null; C.VT.paretoRanks(ok); ok.sort(C.VT.cmpKey); return ok[0]; }
if (isMainThread) {
  const modes = (process.argv[2] || "det,prob").split(","), limit = +process.argv[3] || 1e9, NW = 4;
  const archs = JSON.parse(fs.readFileSync(path.join(DIR, "architects.json"), "utf8")).slice(0, limit); fs.mkdirSync(path.join(DIR, "results"), { recursive: true });
  const todo = archs.filter(a => { const f = path.join(DIR, "results", a.id + ".json"); if (!fs.existsSync(f)) return true; const r = JSON.parse(fs.readFileSync(f, "utf8")); return modes.some(m => !r[m]); });
  console.error(`${todo.length} of ${archs.length} architects to run (${modes.join(", ")})`); let done = 0; const t0 = Date.now();
  const ws = Array.from({ length: NW }, (_, w) => new Promise(res => { const wk = new Worker(__filename, { workerData: { archs: todo.filter((_, i) => i % NW === w), modes } }); wk.on("message", m => { done++; if (done % 10 === 0 || done === todo.length) console.error(`${done}/${todo.length} · ${((Date.now() - t0) / 60000).toFixed(1)} min`); }); wk.on("exit", res); wk.on("error", e => { console.error(e); res(); }); }));
  Promise.all(ws).then(() => console.error("done", ((Date.now() - t0) / 60000).toFixed(1), "min"));
} else {
  const C = require("./common.js"), L = C.TOK.library(), model = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "web", "data", "typology_model.json"), "utf8"));
  const hyb = fs.existsSync(path.join(DIR, "hybrid_weights.json")) ? JSON.parse(fs.readFileSync(path.join(DIR, "hybrid_weights.json"), "utf8")) : null;
  for (const a of workerData.archs) {
    const f = path.join(DIR, "results", a.id + ".json"), prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { id: a.id };
    const P = C.prepare(a.site, { evalEvery: 6 }); if (!P) { fs.writeFileSync(f, JSON.stringify({ ...prev, error: "no envelope" })); parentPort.postMessage(1); continue; }
    prev.site = { viewAz: +P.viewAz.toFixed(1), arc: P.field.arc, opening: P.field.opening, envelope_m2: Math.round(C.VT.ringArea(P.env)), ctxH: P.ctxH, pos: P.pos };
    const N = a.site.towers || 1, run = (cands, label) => { const t = Date.now(), evs = [], used = [];
      for (const sp of cands) { if (evs.length >= 3) break; const sps = C.layoutChecked(P, sp, N); if (!sps) continue; evs.push(C.VT.evaluateSite(sps, P.env, P.C, P.S, P.V, P.field.arc)); used.push(sp); }
      const best = pickBest(C, evs); cands = used;
      return { best: best ? { lib: best.sp.lib, towers: towersOf(best), metrics: summary(best), explain: best.explain.slice(0, 3) } : null, alts: evs.map((e, i) => ({ lib: cands[i].lib, rot: cands[i].rotation, ...summary(e) })), secs: (Date.now() - t) / 1000, label }; };
    for (const mode of workerData.modes) {
      if (prev[mode]) continue;
      if (mode === "det") { // deterministic: hand-rule screening of the whole library, then full evaluation of the top 3 distinct bases
        const rots = [0, 45, +(((P.viewAz % 90) + 90) % 90).toFixed(1)], sc = [];
        for (const typ of L) for (const rot of rots) { const sp = C.fit(C.TOK.toSpec(typ, P.pos, rot, P.viewAz, P.C), P.env, P.C); if (!sp) continue; sc.push({ sp, s: C.TOK.ruleScore(sp, P.field, P.viewAz) + 0.02 * (sp.n / 80) }); }
        sc.sort((x, y) => y.s - x.s); const pickd = [], bases = {}; for (const c of sc) { const b = c.sp.p.base; if ((bases[b] = (bases[b] || 0) + 1) > 6) continue; pickd.push(c.sp); if (pickd.length === 90) break; } // ranked list, a few per base; run() takes the first 3 feasible
        prev.det = { ...run(pickd, "deterministic"), screened: sc.length };
      }
      if (mode === "prob" || mode === "hyb") { // probabilistic: cross-entropy over tokens scored by the learned model; hybrid adds architect-feedback weights and seeds from det
        const opts = { check: sp => !!C.layoutChecked(P, sp, 1), C: { ...P.C, fsi: P.C.fsi / N }, S: P.S, V: P.V, seed: parseInt(a.id.slice(1)) * 7 + (mode === "hyb" ? 99 : 0), pop: 60, iters: 5, top: 20, ctxH: P.ctxH, dense: P.dense, position: P.pos };
        if (mode === "hyb" && hyb) { opts.W = hyb.W; opts.prior = hyb.prior; opts.numPrior = hyb.numPrior; }
        const gen = C.TOK.generate(model, P.field, P.env, opts.C, opts).map(g => ({ ...g.sp, lib: g.typ.id }));
        if (mode === "hyb" && prev.det && prev.det.best) gen.push({ ...prev.det.best.towers[0], position: P.pos, n: 0, lib: prev.det.best.lib + "+refit" });
        prev[mode] = run(gen.map(sp => sp.n === 0 ? C.VT.resolveFloors(sp, P.C) : sp), mode === "hyb" ? "hybrid" : "probabilistic");
      }
    }
    fs.writeFileSync(f, JSON.stringify(prev)); parentPort.postMessage(1);
  }
}
