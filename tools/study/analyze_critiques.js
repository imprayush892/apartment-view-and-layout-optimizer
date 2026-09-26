/* Analyse an image-only critique round. node tools/study/analyze_critiques.js <journal.jsonl> <systems e.g. det,prob> <out.json>
   Maps blind A/B back to systems, reports preferences, ratings, moves and engine-vs-architect agreement. */
const fs = require("fs"), path = require("path"), DIR = path.join(__dirname, "..", "..", "data", "study");
const [journal, sysArg, outFile] = process.argv.slice(2), systems = sysArg.split(",");
const blind = JSON.parse(fs.readFileSync(path.join(DIR, "blind.json"), "utf8")), archs = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(DIR, "architects.json"), "utf8")).map(a => [a.id, a]));
const WIN1 = fs.existsSync(path.join(DIR, "win1.json")) ? JSON.parse(fs.readFileSync(path.join(DIR, "win1.json"), "utf8")) : {};
const crit = []; for (const l of fs.readFileSync(journal, "utf8").split("\n")) { if (!l.trim()) continue; const e = JSON.parse(l); if (e.type === "result" && e.result && e.result.architects) crit.push(...e.result.architects); }
const seen = new Set(), rows = [];
for (const c of crit) { if (seen.has(c.id) || !archs[c.id]) continue; seen.add(c.id); const order = blind[c.id + ":" + systems.join(",")]; if (!order) continue;
  const r = JSON.parse(fs.readFileSync(path.join(DIR, "results", c.id + ".json"), "utf8")), bySys = {}; order.forEach((s, i) => { bySys[s] = { ...c["AB"[i]], engine: (s === "win1" ? r[WIN1[c.id]] : r[s]) && (s === "win1" ? r[WIN1[c.id]] : r[s]).best ? (s === "win1" ? r[WIN1[c.id]] : r[s]).best.metrics : null }; });
  rows.push({ id: c.id, city: archs[c.id].site.city, influences: archs[c.id].influences, pref: c.preference === "equal" ? "equal" : order["AB".indexOf(c.preference)], reason: c.preference_reason, quote: c.quote, bySys }); }
const mean = v => v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN, K = ["overall", "view_capture", "privacy_overlooking", "massing_silhouette", "proportion", "context_fit", "constructability"];
const S = { architects: rows.length, preference: {}, ratings: {}, byCity: {}, topMoves: {}, agreement: {} };
for (const s of [...systems, "equal"]) S.preference[s] = rows.filter(r => r.pref === s).length;
for (const s of systems) { S.ratings[s] = {}; for (const k of K) S.ratings[s][k] = +mean(rows.map(r => r.bySys[s][k]).filter(Number.isFinite)).toFixed(2); }
for (const city of [...new Set(rows.map(r => r.city))]) { const rs = rows.filter(r => r.city === city); S.byCity[city] = { n: rs.length, ...Object.fromEntries([...systems, "equal"].map(s => [s, rs.filter(r => r.pref === s).length])), ...Object.fromEntries(systems.map(s => [s + "_overall", +mean(rs.map(r => r.bySys[s].overall)).toFixed(2)])) }; }
const mv = {}; for (const r of rows) for (const s of systems) for (const fc of r.bySys[s].floor_changes || []) mv[fc.move] = (mv[fc.move] || 0) + 1; S.topMoves = Object.fromEntries(Object.entries(mv).sort((a, b) => b[1] - a[1]));
// does the engine's view metric agree with what architects see? Spearman between livingView / premiumShare and view_capture
const rank = v => { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = new Array(v.length); o.forEach(([, i], k) => r[i] = k); return r; };
const spear = (x, y) => { const rx = rank(x), ry = rank(y), n = x.length, mx = mean(rx), my = mean(ry); let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (rx[i] - mx) * (ry[i] - my); b += (rx[i] - mx) ** 2; c += (ry[i] - my) ** 2; } return a / Math.sqrt(b * c); };
const pairs = rows.flatMap(r => systems.map(s => r.bySys[s]).filter(d => d.engine && Number.isFinite(d.view_capture)));
for (const k of ["livingView", "premiumShare"]) S.agreement["spearman_" + k + "_vs_view_capture"] = +spear(pairs.map(d => d.engine[k]), pairs.map(d => d.view_capture)).toFixed(3);
S.agreement["spearman_compromisedShare_vs_privacy_overlooking"] = +spear(pairs.map(d => -d.engine.compromised / Math.max(1, d.engine.units)), pairs.map(d => d.privacy_overlooking)).toFixed(3);
// within-site: when the engine says one design has more premium flats, do architects prefer it?
const dec = rows.filter(r => r.pref !== "equal" && r.bySys[systems[0]].engine && r.bySys[systems[1]].engine && r.bySys[systems[0]].engine.premiumShare !== r.bySys[systems[1]].engine.premiumShare);
S.agreement.preferredHasMorePremium = +(dec.filter(r => { const o = systems.find(s => s !== r.pref); return r.bySys[r.pref].engine.premiumShare > r.bySys[o].engine.premiumShare; }).length / Math.max(1, dec.length)).toFixed(3); S.agreement.decisivePairs = dec.length;
fs.writeFileSync(outFile, JSON.stringify({ summary: S, rows }, null, 1)); console.log(JSON.stringify(S, null, 1));
