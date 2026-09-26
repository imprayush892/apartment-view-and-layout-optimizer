/* Objective comparison of systems on the architects' sites (engine metrics, not the architects' opinion).
   node tools/study/compare.js det prob */
const fs = require("fs"), path = require("path"), DIR = path.join(__dirname, "..", "..", "data", "study");
const [A, B] = process.argv.slice(2), archs = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(DIR, "architects.json"), "utf8")).map(a => [a.id, a]));
const rows = []; for (const f of fs.readdirSync(path.join(DIR, "results"))) { const r = JSON.parse(fs.readFileSync(path.join(DIR, "results", f), "utf8")); if (r[A] && r[B]) rows.push({ r, a: archs[r.id] }); }
const m = (sys, k) => rows.map(x => x.r[sys].best ? x.r[sys].best.metrics[k] : null);
const both = rows.filter(x => x.r[A].best && x.r[B].best), mean = v => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
const out = { sites: rows.length, [A + "_found"]: rows.filter(x => x.r[A].best).length, [B + "_found"]: rows.filter(x => x.r[B].best).length, both: both.length };
for (const k of ["premiumShare", "livingView", "compromised", "marginCr", "efficiency", "structural"]) { const va = both.map(x => x.r[A].best.metrics[k]), vb = both.map(x => x.r[B].best.metrics[k]); out[k] = { [A]: +mean(va).toFixed(4), [B]: +mean(vb).toFixed(4), [B + "_better_share"]: +(both.filter((x, i) => (k === "compromised" || k === "structural" ? vb[i] < va[i] : vb[i] > va[i])).length / Math.max(1, both.length)).toFixed(3) }; }
const byCity = {}; for (const x of both) { const c = x.a.site.city; (byCity[c] = byCity[c] || { n: 0, dA: 0, dB: 0 }); byCity[c].n++; byCity[c].dA += x.r[A].best.metrics.premiumShare; byCity[c].dB += x.r[B].best.metrics.premiumShare; }
out.premiumShareByCity = Object.fromEntries(Object.entries(byCity).map(([c, v]) => [c, { n: v.n, [A]: +(v.dA / v.n).toFixed(3), [B]: +(v.dB / v.n).toFixed(3) }]));
out.secs = { [A]: +mean(rows.map(x => x.r[A].secs)).toFixed(1), [B]: +mean(rows.map(x => x.r[B].secs)).toFixed(1) };
console.log(JSON.stringify(out, null, 1));
