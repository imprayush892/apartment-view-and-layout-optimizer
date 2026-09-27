/* Run the deterministic and probabilistic systems (and later the hybrid) for every architect's site.
   node tools/study/optimize.js <modes: det,prob,hyb> [limit] [--workers 4]
   Writes data/study/results/<id>.json (best design per system + the alternatives' metrics). */
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const fs = require("fs"), path = require("path");
const DIR = path.join(__dirname, "..", "..", "data", "study");
const summary = ev => ev && ev.feasible ? { feasible: true, units: ev.metrics.units, premium: ev.metrics.premium, good: ev.metrics.good, neutral: ev.metrics.neutral, compromised: ev.metrics.compromised, premiumShare: +(ev.metrics.premium / Math.max(1, ev.metrics.units)).toFixed(4), livingView: +ev.metrics.livingView.toFixed(4), gdvCr: +ev.metrics.gdvCr.toFixed(1), marginCr: +(ev.metrics.margin / 1e7).toFixed(1), efficiency: +ev.metrics.efficiency.toFixed(4), structural: +(ev.metrics.structural || 0).toFixed(3), height: ev.metrics.height, slender: +(ev.metrics.slender || 0).toFixed(2), fsiUtil: +(ev.metrics.fsiUtil || 0).toFixed(3) } : { feasible: false, viol: ev ? ev.viol : ["NO-FIT"] };
const towersOf = ev => (ev.towers || [ev]).map(t => { const { lib, ...sp } = t.sp; return { ...sp, lib }; });
function pickBest(C, evs, pick) { let ok = evs.filter(e => e && e.feasible); if (!ok.length) return null; C.VT.paretoRanks(ok); ok.sort(C.VT.cmpKey); if (pick) ok = pick(ok); return ok[0]; }
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
  const wv = workerData.modes.includes("hyb3") ? "hybrid_weights_v3.json" : "hybrid_weights_v2.json", hyb2 = fs.existsSync(path.join(DIR, wv)) ? JSON.parse(fs.readFileSync(path.join(DIR, wv), "utf8")) : null;
  const foldsF = path.join(DIR, "appeal_folds.json"), folds = fs.existsSync(foldsF) ? JSON.parse(fs.readFileSync(foldsF, "utf8")).folds : null;
  const appealF = path.join(__dirname, "..", "..", "web", "data", "appeal_model.json"), appeal = fs.existsSync(appealF) ? JSON.parse(fs.readFileSync(appealF, "utf8")) : null;
  for (const a of workerData.archs) {
    const f = path.join(DIR, "results", a.id + ".json"), prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { id: a.id };
    const P = C.prepare(a.site, { evalEvery: 8 }); if (!P) { fs.writeFileSync(f, JSON.stringify({ ...prev, error: "no envelope" })); parentPort.postMessage(1); continue; }
    prev.site = { viewAz: +P.viewAz.toFixed(1), arc: P.field.arc, opening: P.field.opening, envelope_m2: Math.round(C.VT.ringArea(P.env)), ctxH: P.ctxH, pos: P.pos };
    const N0 = a.site.towers || 1, run = (cands0, label, maxEv = 2, pick = null) => { const t = Date.now(); let evs = [], used = [], best = null, N = N0, cands = cands0;
      // if the requested number of towers cannot stand 24 m apart on this plot, fall back to one fewer
      for (; N >= 1 && !best; N--) { evs = []; used = [];
        for (const sp of cands0) { if (evs.length >= maxEv) break; const sps = C.layoutChecked(P, sp, N); if (!sps) continue; evs.push(C.VT.evaluateSite(sps, P.env, P.C, P.S, P.V, P.field.arc)); used.push(sp); }
        best = pickBest(C, evs, pick); if (best) break; }
      cands = used; const towersUsed = best ? (best.towers || [best]).length : 0;
      return { towersAsked: N0, towersUsed, best: best ? { lib: best.sp.lib, towers: towersOf(best), metrics: summary(best), explain: best.explain.slice(0, 3) } : null, alts: evs.map((e, i) => ({ lib: cands[i].lib, rot: cands[i].rotation, ...summary(e) })), secs: (Date.now() - t) / 1000, label }; };
    for (const mode of workerData.modes) {
      if (prev[mode]) continue;
      if (mode === "det") { // deterministic: hand-rule screening of the whole library, then full evaluation of the top 3 distinct bases
        const rots = [0, 45, +(((P.viewAz % 90) + 90) % 90).toFixed(1)], sc = [];
        for (const typ of L) for (const rot of rots) { const sp = C.TOK.toSpec(typ, P.pos, rot, P.viewAz, P.C); sc.push({ sp, s: C.TOK.ruleScore(sp, P.field, P.viewAz) + 0.02 * (sp.n / 80) }); } // fit + hard rules happen lazily down the ranked list (run -> layoutChecked)
        sc.sort((x, y) => y.s - x.s); const pickd = [], bases = {}; for (const c of sc) { const b = c.sp.p.base; if ((bases[b] = (bases[b] || 0) + 1) > 6) continue; pickd.push(c.sp); if (pickd.length === 90) break; } // ranked list, a few per base; run() takes the first 3 feasible
        prev.det = { ...run(pickd, "deterministic"), screened: sc.length };
      }
      if (mode === "prob" || mode === "hyb") { // probabilistic: cross-entropy over tokens scored by the learned model; hybrid adds architect-feedback weights and seeds from det
        const opts = { check: sp => !!C.layoutChecked(P, sp, 1), C: { ...P.C, fsi: P.C.fsi / N0 }, S: P.S, V: P.V, seed: parseInt(a.id.slice(1)) * 7 + (mode === "hyb" ? 99 : 0), pop: 60, iters: 5, top: 20, ctxH: P.ctxH, dense: P.dense, position: P.pos };
        if (mode === "hyb" && hyb) { opts.W = hyb.W; opts.prior = hyb.prior; opts.numPrior = hyb.numPrior; opts.appeal = appeal; opts.towers = N0; P.C.towerSplay = hyb.towerSplay || 0; }
        const gen = C.TOK.generate(model, P.field, P.env, opts.C, opts).map(g => ({ ...g.sp, lib: g.typ.id }));
        if (mode === "hyb" && prev.det && prev.det.best) gen.push({ ...prev.det.best.towers[0], position: P.pos, n: 0, lib: prev.det.best.lib + "+seed" });
        let res = run(gen.map(sp => sp.n === 0 ? C.VT.resolveFloors(sp, P.C) : sp), mode === "hyb" ? "hybrid" : "probabilistic");
        // hybrid: local rotation search around the winner (architects asked to turn plates to the outlook)
        if (mode === "hyb" && hyb && hyb.rotationRefine && res.best) { const b0 = res.best.towers[0], tries = [-12, 12].map(d => ({ ...b0, rotation: +(((b0.rotation + d) % 90 + 90) % 90).toFixed(1), position: P.pos, n: 0, lib: res.best.lib + `+rot${d > 0 ? "+" : ""}${d}` })).map(sp => C.VT.resolveFloors(sp, P.C));
          const alt = run(tries, "hybrid-rot"); if (alt.best) { const cand = [res.best, alt.best].map(x => ({ metrics: { ...x.metrics, gdv: x.metrics.gdvCr * 1e7, margin: x.metrics.marginCr * 1e7, compromised: x.metrics.compromised, premium: x.metrics.premium, livingView: x.metrics.livingView, efficiency: x.metrics.efficiency, structural: x.metrics.structural }, x, id: x.lib, feasible: true }));
            C.VT.paretoRanks(cand); cand.sort(C.VT.cmpKey); if (cand[0].x === alt.best) { res = { ...res, best: alt.best, rotated: true }; } res.alts = res.alts.concat(alt.alts); } }
        prev[mode] = res;
      }
      if ((mode === "hyb2" || mode === "hyb3") && hyb2) { // hybrid v2 (after round 2): evaluate the deterministic and probabilistic winners together with the top generated designs,
        // then among near-equal best trade-offs put first the one architects are predicted to rate highest (cross-fitted: this site's fold never saw its ratings)
        const fm = folds && folds[parseInt(a.id.slice(1)) % 5], am = fm ? { w: fm.w, mean: fm.mean } : appeal;
        const opts = { check: sp => !!C.layoutChecked(P, sp, 1), C: { ...P.C, fsi: P.C.fsi / N0 }, S: P.S, V: P.V, seed: parseInt(a.id.slice(1)) * 7 + 199, pop: 60, iters: 5, top: 20, ctxH: P.ctxH, dense: P.dense, position: P.pos,
          W: hyb2.W, prior: hyb2.prior, numPrior: hyb2.numPrior, appeal: am, towers: N0 };
        P.C.towerSplay = hyb2.towerSplay || 0;
        const seeds = ["det", "prob"].filter(k => prev[k] && prev[k].best).map(k => ({ ...prev[k].best.towers[0], position: P.pos, n: 0, lib: prev[k].best.lib + "+" + k }));
        const gen = C.TOK.generate(model, P.field, P.env, opts.C, opts).map(g => ({ ...g.sp, lib: g.typ.id }));
        const pick = ok => C.TOK.appealPick(ok, am, P.viewAz);
        let res = run(seeds.concat(gen).map(sp => sp.n === 0 ? C.VT.resolveFloors(sp, P.C) : sp), mode === "hyb3" ? "hybrid3" : "hybrid2", seeds.length + 2, pick);
        if (mode === "hyb2" && hyb2.rotationRefine && res.best) { // dropped in hyb3: round 3 showed architects prefer the unrotated plate const b0 = res.best.towers[0], tries = [-12, 12].map(d => ({ ...b0, rotation: +(((b0.rotation + d) % 90 + 90) % 90).toFixed(1), position: P.pos, n: 0, lib: res.best.lib + `+rot${d > 0 ? "+" : ""}${d}` })).map(sp => C.VT.resolveFloors(sp, P.C));
          const alt = run(tries, "hybrid2-rot"); if (alt.best && alt.best.metrics.premium >= res.best.metrics.premium && alt.best.metrics.compromised <= res.best.metrics.compromised && alt.best.metrics.gdvCr >= res.best.metrics.gdvCr * 0.98) { res = { ...res, best: alt.best, rotated: true }; res.alts = res.alts.concat(alt.alts); } }
        res.source = /\+det/.test(res.best && res.best.lib || "") ? "det" : /\+prob/.test(res.best && res.best.lib || "") ? "prob" : "generated";
        prev[mode] = res;
      }
    }
    fs.writeFileSync(f, JSON.stringify(prev)); parentPort.postMessage(1);
  }
}
