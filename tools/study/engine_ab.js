/* Engine A/B tests on the study's designs (measured, no opinions):
   E1 skyline as a view (base) vs sea-only; E2 dense-city rules vs the coastal (Mumbai) rules;
   E3 facing distance advisory (base) vs the old hard 18 m rule. node tools/study/engine_ab.js [n=120] */
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const fs = require("fs"), path = require("path"), DIR = path.join(__dirname, "..", "..", "data", "study");
if (isMainThread) {
  const n = +process.argv[2] || 120, archs = JSON.parse(fs.readFileSync(path.join(DIR, "architects.json"), "utf8")).filter(a => a.site.city !== "dadar");
  const jobs = []; for (const a of archs) { const f = path.join(DIR, "results", a.id + ".json"); if (!fs.existsSync(f)) continue; const r = JSON.parse(fs.readFileSync(f, "utf8")); if (r.det && r.det.best) jobs.push({ a, towers: r.det.best.towers }); if (jobs.length >= n) break; }
  const out = []; let done = 0;
  Promise.all(Array.from({ length: 4 }, (_, w) => new Promise(res => { const wk = new Worker(__filename, { workerData: jobs.filter((_, i) => i % 4 === w) }); wk.on("message", m => { out.push(m); done++; }); wk.on("exit", res); wk.on("error", e => { console.error(e); res(); }); }))).then(() => {
    const mean = v => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length), g = (k, f) => mean(out.map(o => f(o[k])));
    const S = { designs: out.length,
      E1_skyline: { premiumShare_base: g("base", m => m.premium / m.units), premiumShare_seaOnly: g("seaOnly", m => m.premium / m.units), livingView_base: g("base", m => m.livingView), livingView_seaOnly: g("seaOnly", m => m.livingView) },
      E2_rules: { compromisedShare_dense: g("base", m => m.compromised / m.units), compromisedShare_coastal: g("coastal", m => m.compromised / m.units), designsWithZeroCompromised_dense: out.filter(o => o.base.compromised === 0).length, designsWithZeroCompromised_coastal: out.filter(o => o.coastal.compromised === 0).length },
      E3_privacy: { rejectedUnderHard18m: out.filter(o => o.base.closest < 18).length, rejectedAdvisory: 0, medianClosestFacing_m: out.map(o => o.base.closest).sort((a, b) => a - b)[out.length >> 1] } };
    fs.writeFileSync(path.join(DIR, "engine_ab.json"), JSON.stringify({ summary: S, rows: out }, null, 1)); console.log(JSON.stringify(S, null, 1));
  });
} else {
  const C = require("./common.js");
  for (const { a, towers } of workerData) {
    const run = (mod) => { const P = C.prepare(a.site, { evalEvery: 8 }); if (!P) return null; mod(P); const ev = C.VT.evaluateSite(towers.map(t => ({ ...t })), P.env, P.C, P.S, P.V, P.field.arc);
      if (!ev.feasible && !ev.metrics.units) return null; let closest = 1e9; for (const t of ev.towers || [ev]) for (const u of t.units) for (const r of u.rooms) if (r.room !== "kitchen_service" && r.privacy > 0) closest = Math.min(closest, r.dMed);
      return { units: ev.metrics.units, premium: ev.metrics.premium, compromised: ev.metrics.compromised, livingView: ev.metrics.livingView, closest: closest === 1e9 ? 999 : closest }; };
    const base = run(() => {}), seaOnly = run(P => { P.V.P.skyW = 0; }), coastal = run(P => { Object.assign(P.C.R.vcComp, { d_min: 100, alpha_max: 10, h_near: undefined }); });
    if (base && seaOnly && coastal) parentPort.postMessage({ id: a.id, city: a.site.city, base, seaOnly, coastal });
  }
}
