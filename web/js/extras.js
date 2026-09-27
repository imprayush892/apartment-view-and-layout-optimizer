/* Viewtower Studio — features added after the round-1 persona study:
   plain-language verdict + data-reliability badges, "best for" badges, sortable tables, economics with
   sensitivity, building-height uncertainty test, exports (units CSV, CAD zip with DXF + OBJ, HTML board
   pack), scenario save / load / share link, presenter mode and first-person controls.
   Needs app.js to expose window.VTApp. */
(function () {
"use strict";
const A = () => window.VTApp, $ = id => document.getElementById(id);
const fmt = (v, d = 2) => Number.isFinite(v) ? v.toFixed(d) : "–", fmtInt = v => Number.isFinite(v) ? Math.round(v).toLocaleString("en-IN") : "–";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const CLS = ["premium", "good", "neutral", "compromised"];
/* what the "prize" view is on this site: sea (coastline), river/water, or the city skyline */
function viewKind() { const st = A().st, f = st.field; if (!f || !f.rose) return "sea or skyline"; const top = f.heights[f.heights.length - 1], r = f.rose[top], w = VT.mean(Array.from(r.water)), k = VT.mean(Array.from(r.skyline || [])); const coast = st.ctx && st.ctx.coast && st.ctx.coast.length;
  if (w > 1.5 * k) return coast ? "sea" : "river"; if (k > 1.5 * w) return "skyline"; return coast ? "sea and skyline" : "river and skyline"; }
const CLS_TXT = { premium: "strong sea or skyline view", good: "good view", neutral: "ordinary view", compromised: "compromised view" };

/* ---------------------------------------------------------------- file saving */
let dlP = null;
function downloadsNS() { if (!dlP) dlP = (window.claude && typeof window.claude.use === "function") ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null); return dlP; }
async function saveFile(name, data, note) {
  const d = await downloadsNS();
  if (d) {
    try { await d.save({ filename: name, data }); return status(`${name} saved.`); }
    catch (e) { if (e && e.code === "declined") return status("Save cancelled."); if (e && e.code === "rate_limited") return status("A save prompt is already open.", true); if (e && !["unavailable", "not_granted", "capability_disabled", "capability_removed"].includes(e.code)) return status(`Could not save ${name} (${e.code || e}).`, true); }
  }
  const blob = data instanceof Blob ? data : new Blob([data]), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  status(`${name} downloaded${note ? " · " + note : ""}.`);
}
function status(msg, warn) { const el = $("exportInfo"); if (el) { el.textContent = msg; el.className = warn ? "status warnline" : "status"; } }

/* ---------------------------------------------------------------- zip (store only) */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; // extras.js may load after the app has already booted
if (window.VTApp && window.VTApp.st.booted) { window.VTX.init(); if (window.VTApp.st.ready) window.VTX.boot(); }
})();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) { // files: [{name, text}]
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: "application/zip" });
}

/* ---------------------------------------------------------------- plain-language verdict + reliability */
function reliability() {
  const a = A(), st = a.st; if (!st.ctx || !st.center) return null;
  const c = st.center, arc = st.field && st.field.arc, inArc = az => !arc || (arc[0] === 0 && arc[1] === 360) || VT.mod(az - arc[0], 360) <= VT.mod(arc[1] - arc[0], 360);
  let n = 0, est = 0, far = 0; const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of st.ctx.buildings) {
    const [x, y] = VT.centroid(b.ring), d = Math.hypot(x - c[0], y - c[1]); bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); far = Math.max(far, d);
    if (b.excluded || d > 1000 || d < 5) continue; const az = VT.mod(Math.atan2(x - c[0], y - c[1]) * VT.R2D, 360); if (!inArc(az)) continue; n++; if (b.hsrc === "estimated") est++;
  }
  const reach = st.ctx.buildings.length ? Math.max(0, Math.min(c[0] - bb[0], bb[2] - c[0], c[1] - bb[1], bb[3] - c[1])) : 0, share = n ? est / n : 1;
  const level = n < 15 ? "high" : share > 0.8 ? "low" : share > 0.4 ? "medium" : "high", cal = st.ctx.heightCalib;
  return { n, est, share, level, reach, cal };
}
function verdictHTML() {
  const a = A(), st = a.st, best = st.results && st.results[0], r = reliability(), badges = [];
  if (r) {
    badges.push(r.n < 15 ? `<span class="badge high" title="Almost nothing stands between the plot and its main view within 1 km, so uncertain building heights matter little">Height data: little in the way · only ${r.n} buildings in the main view directions</span>` : `<span class="badge ${r.level}" title="Share of buildings inside the main view directions within 1 km whose height is estimated rather than mapped">Height data: ${r.level} reliability · ${fmt(100 * r.share, 0)}% of ${r.n} buildings in the main view directions estimated${r.cal && r.cal.scale !== 1 ? ` (calibrated ×${r.cal.scale})` : ""}</span>`);
    if (r.reach < 900) badges.push(`<span class="badge medium" title="Buildings farther than this are not in the loaded data, so distant obstructions are not modelled">Buildings loaded to about ${fmtInt(r.reach)} m from the plot</span>`);
  }
  badges.push(`<span class="badge medium" title="Rates are placeholders for comparing options, not market figures; enter local rates in step 6">Placeholder rates: values are for comparison only</span>`);
  if (!best) return `<div class="verdict"><p><b>Set the site and press Run search.</b> Results appear here in plain words.</p><div class="row">${badges.join("")}</div></div>`;
  const m = best.metrics, sp = best.sp, ht = best.heightTest;
  const vk = viewKind(), words = CLS.filter(k => m[k]).map(k => `<b>${m[k]}</b> ${k === "premium" ? `strong ${vk} view` : CLS_TXT[k]}`).join(", ");
  const tws = best.towers || [best], nT = tws.length, what = nT > 1 ? `${nT} towers × ${sp.n} floors (${fmt(m.height, 0)} m), ${sp.upf} flat${sp.upf > 1 ? "s" : ""} per floor each` : `${sp.upf} flat${sp.upf > 1 ? "s" : ""} per floor, ${sp.n} floors (${fmt(m.height, 0)} m)`;
  // where the view opens: lowest floor from which most flats are premium
  let opens = null; { const lv = {}; for (const u of best.units) { (lv[u.level] = lv[u.level] || [0, 0])[0] += u.cls === "premium" ? 1 : 0; lv[u.level][1]++; } const L = Object.keys(lv).map(Number).sort((x, y) => x - y); for (const l of L) if (L.filter(q => q >= l).every(q => lv[q][0] / lv[q][1] >= 0.5)) { opens = l; break; } }
  const canyon = m.compromised && opens != null && opens > sp.podium ? ` Floors below ${opens} (about ${fmt(opens * sp.ftf, 0)} m) mostly look into nearby buildings; from floor ${opens} most flats get a strong ${vk} view.` : "";
  const meta = st.lastRun ? `<p class="hint" style="margin:0">${esc(st.lastRun)}</p>` : "";
  const lim = st.C || {}; if (best && lim.hmax && best.metrics.height < 0.7 * lim.hmax && (best.metrics.fsiUtil || 0) > 0.95) badges.push(`<span class="badge medium" title="The consumable FSI area runs out before the height limit; raise it (step 4) to go taller where the views are">FSI limits the tower to ${fmtInt(best.metrics.height)} m of the ${fmtInt(lim.hmax)} m allowed</span>`);
  if (best && best.metrics.units && best.metrics.compromised === best.metrics.units) badges.push(`<span class="badge low" title="At this height every flat looks into nearby buildings; a taller or relocated tower may escape">Every flat is compromised at this height</span>`);
  const all = st.results, minMargin = Math.min(...all.map(e => e.metrics.minMargin)), noneComp = all.every(e => e.metrics.compromised === 0);
  if (noneComp && minMargin > 0.2) badges.push(`<span class="badge medium" title="Every flat in every option clears the compromised thresholds by a wide margin, so this goal does not separate the options here; compare premium flats and value instead">Zero compromised is easy on this site</span>`);
  let whyBest = ""; if (m.units && m.compromised / m.units > 0.4 && m.compromised < m.units) { const sh = e => e.metrics.compromised / Math.max(1, e.metrics.units), lo = all.reduce((a, b) => sh(b) < sh(a) ? b : a);
    whyBest = lo === best ? `Every option tested has at least ${fmt(100 * sh(lo), 0)}% of flats compromised on this site, and this one has the fewest.` : `Why still best: option #${all.indexOf(lo) + 1} has fewer compromised flats (${fmt(100 * sh(lo), 0)}%) but ${lo.metrics.premium < m.premium ? "fewer strong-view flats" : "lower value"}; see the Options tab. A taller podium or a different spot on the plot may help.`; }
  const pct = k => m.units ? Math.round(100 * m[k] / m.units) : 0, NAME = { premium: `strong ${vk} view`, good: "good view", neutral: "ordinary view", compromised: "compromised" };
  const stats = CLS.filter(k => m[k]).map(k => `<div class="vstat ${k}"><b>${m[k]}</b><span>${NAME[k]}</span><i>${pct(k)}%</i></div>`).join("") + `<div class="vstat val"><b>${MB(m.gdv)}</b><span>sales value</span><i>placeholder rates</i></div>`;
  const adv = Object.entries(best.checks || {}).filter(([id, v]) => !v[0] && !(best.viol || []).includes(id)).map(([id, v]) => `<span class="badge medium" title="Advisory rule: shown for information, it does not reject the design, but it carries cost or programme risk">Check · ${esc(v[1].replace(/^tower \d+: /, "").replace(/\s*\(advisory[^)]*\)/, ""))}</span>`);
  const towerTbl = nT > 1 ? `<table class="vtowers"><thead><tr><th>Tower</th><th>Flats</th><th>Strong view</th><th>Compromised</th></tr></thead><tbody>${tws.map((t, i) => `<tr><td>T${i + 1}</td><td>${t.metrics.units}</td><td>${t.metrics.premium}</td><td>${t.metrics.compromised}</td></tr>`).join("")}</tbody></table>` : "";
  const why = [canyon.trim(), m.compromised ? "" : "No compromised flats.", whyBest, ht ? `If the estimated building heights are off (×0.75 to ×1.5), ${ht.robust} flats keep a strong view in every case and the value ranges ${MB(ht.gdv[0] * 1e7)}–${MB(ht.gdv[1] * 1e7)}.` : "", best.appealPick ? "Put first over an almost equal option because architects are predicted to rate its form higher." : ""].filter(Boolean).join(" ");
  return `<div class="verdict"><div class="vhead"><span class="eyebrow">Best trade-off</span><h2>${esc(a.label(sp))}</h2><p class="vsub">${what} · ${m.units} flats</p></div>
    <div class="vstats">${stats}</div>${why ? `<p>${why}</p>` : ""}${towerTbl}${meta}<div class="row">${adv.join("")}${badges.join("")}</div></div>`;
}

/* ---------------------------------------------------------------- "best for" badges */
function bestFor(results) {
  const out = new Map(); if (!results || results.length < 2) return out;
  const add = (e, t) => { if (!out.has(e.id)) out.set(e.id, []); out.get(e.id).push(t); };
  const pick = (f, dir = 1) => results.reduce((a, b) => (f(b) - f(a)) * dir > 1e-9 ? b : a);
  add(pick(e => e.metrics.gdv), "highest value");
  add(pick(e => e.metrics.premium - 1000 * e.metrics.compromised), "most premium flats");
  add(pick(e => e.metrics.efficiency), "most efficient");
  add(pick(e => e.metrics.structural, -1), "simplest structure");
  add(pick(e => e.metrics.livingView), "best living-room views");
  return out;
}

/* ---------------------------------------------------------------- sortable tables */
function bindSort() {
  document.addEventListener("click", e => {
    const th = e.target.closest("table.sortable thead th"); if (!th) return;
    const table = th.closest("table"), tb = table.tBodies[0]; if (!tb) return; const i = [...th.parentNode.children].indexOf(th);
    const dir = th.getAttribute("aria-sort") === "ascending" ? -1 : 1; th.parentNode.querySelectorAll("th").forEach(h => h.removeAttribute("aria-sort")); th.setAttribute("aria-sort", dir > 0 ? "ascending" : "descending");
    const val = tr => { const t = (tr.children[i] ? tr.children[i].textContent : "").trim(), n = parseFloat(t.replace(/[₹$£,%\s]|1:/g, "")); return Number.isFinite(n) && /^[-\d₹$£.,%\s1:]+/.test(t) ? n : t.toLowerCase(); };
    [...tb.rows].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir; }).forEach(r => tb.appendChild(r));
  });
}

/* ---------------------------------------------------------------- economics */
function econ(ev) {
  const land = (+$("xLand").value || 0) * MON.big, soft = (+$("xSoft").value || 0) / 100, sales = (+$("xSales").value || 0) / 100, target = (+$("xTarget").value || 0) / 100;
  const m = ev.metrics, build = m.cost, calc = (pk, ck) => { const gdv = m.gdv * pk, c = build * ck, total = land + c * (1 + soft) + gdv * sales; return { gdv, build: c, soft: c * soft, sales: gdv * sales, land, total, profit: gdv - total, margin: gdv ? (gdv - total) / gdv : 0 }; };
  const base = calc(1, 1), residual = m.gdv * (1 - target - sales) - build * (1 + soft);
  return { base, calc, residual, land };
}
/* Quarterly cash flow: land at quarter 0, construction + soft costs spread evenly over the build,
   sales at a steady absorption rate from launch, collections linked to construction progress
   (construction-linked plan) and the balance at completion. Deliberately simple and labelled as such. */
function cashflow(ev) {
  const m = ev.metrics, e = econ(ev).base, months = +$("xMonths").value || Math.round(24 + 0.6 * ev.sp.n), Q = Math.max(1, Math.ceil(months / 3));
  const absorb = Math.max(0.5, +$("xAbs").value || 6) / 100, disc = (+$("xDisc").value || 12) / 100, dq = Math.pow(1 + disc, 0.25) - 1, sales = (+$("xSales").value || 0) / 100;
  const flows = [], build = (e.build + e.soft) / Q; let sold = 0, collected = 0, t = 0;
  while (t <= Q || sold < m.gdv - 1) {
    let f = t === 0 ? -e.land : 0; if (t >= 1 && t <= Q) f -= build;
    if (t >= 1) { const s = Math.min(m.gdv - sold, absorb * m.gdv); sold += s; f -= s * sales; }
    const prog = Math.min(1, t / Q), c = sold * prog; f += c - collected; collected = c; flows.push(f); t++; if (t > 80) break;
  }
  const npvAt = r => flows.reduce((a, f, i) => a + f / Math.pow(1 + r, i), 0);
  let irr = null, lo = -0.9, hi = 1.0; if (npvAt(lo) * npvAt(hi) < 0) { for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (npvAt(lo) * npvAt(mid) <= 0) hi = mid; else lo = mid; } irr = Math.pow(1 + (lo + hi) / 2, 4) - 1; }
  let cum = 0, peak = 0; for (const f of flows) { cum += f; peak = Math.min(peak, cum); }
  return { months, Q, absorb, disc, flows, npv: npvAt(dq), irr, peak: -peak, sellout: Math.ceil(1 / absorb) };
}
function renderEcon() {
  const ev = A().st.sel, box = $("econOut"); if (!box) return;
  if (!ev) { box.innerHTML = `<p class="hint">Pick an option to see its economics.</p>`; return; }
  const { base, calc, residual, land } = econ(ev), cr = v => MB(v);
  const rows = [["Sales value (GDV)", cr(base.gdv)], ["Construction (incl. structure premium)", cr(base.build)], ["Soft costs", cr(base.soft)], ["Sales & marketing", cr(base.sales)], ["Land", land ? cr(base.land) : "not entered"], ["Total cost", cr(base.total)], ["Profit", cr(base.profit)], ["Margin on GDV", `${fmt(100 * base.margin, 1)}%`], ["Residual land value at target margin", cr(residual)]];
  const P = [-0.2, -0.1, 0, 0.1, 0.2], Cc = [-0.1, 0, 0.1];
  box.innerHTML = `<div class="tablewrap"><table><tbody>${rows.map(([a, b]) => `<tr><td>${a}</td><td class="n">${b}</td></tr>`).join("")}</tbody></table></div>
    <p class="hint">Margin on GDV if sale prices (columns) and construction cost (rows) move:</p>
    <div class="tablewrap"><table class="sens"><thead><tr><th>Cost \\ price</th>${P.map(p => `<th class="n">${p > 0 ? "+" : ""}${p * 100}%</th>`).join("")}</tr></thead><tbody>${Cc.map(c => `<tr><td>${c > 0 ? "+" : ""}${c * 100}%</td>${P.map(p => { const r = calc(1 + p, 1 + c); return `<td class="n ${r.margin < 0 ? "neg" : ""}">${fmt(100 * r.margin, 1)}%</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
    ${land ? "" : `<p class="warnline">Enter a land cost to see a real margin; until then, profit excludes land.</p>`}
    ${(() => { const c = cashflow(ev), W = 360, H = 90, mx = Math.max(...c.flows.map(Math.abs)) || 1; let cum = 0; const cm = c.flows.map(f => (cum += f)), cmx = Math.max(...cm.map(Math.abs)) || 1;
      return `<h3 style="font-size:14px">Cash flow (simple, quarterly)</h3>
      <div class="tablewrap"><table><tbody><tr><td>Build period / sell-out</td><td class="n">${c.months} months / ${c.sellout} quarters at ${fmt(100 * c.absorb, 1)}% per quarter</td></tr>
      <tr><td>Project IRR (unlevered, annual)</td><td class="n">${c.irr == null ? "n/a" : fmt(100 * c.irr, 1) + "%"}</td></tr><tr><td>NPV at ${fmt(100 * c.disc, 0)}%</td><td class="n">${MB(c.npv)}</td></tr><tr><td>Peak funding need</td><td class="n">${MB(c.peak)}</td></tr></tbody></table></div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Quarterly and cumulative cash flow"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line)"/>${c.flows.map((f, i) => { const w = W / c.flows.length, h = Math.abs(f) / mx * (H / 2 - 4); return `<rect x="${(i * w + 1).toFixed(1)}" y="${(f >= 0 ? H / 2 - h : H / 2).toFixed(1)}" width="${Math.max(1, w - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${f >= 0 ? "var(--premium)" : "var(--compromised)"}" opacity=".75"/>`; }).join("")}<polyline fill="none" stroke="var(--ink)" stroke-width="1.5" points="${cm.map((v, i) => `${((i + 0.5) * W / cm.length).toFixed(1)},${(H / 2 - v / cmx * (H / 2 - 4)).toFixed(1)}`).join(" ")}"/></svg>
      <p class="hint">Bars: quarterly net cash (orange out, purple in); line: cumulative. Land at quarter 0, construction and soft costs spread evenly, sales at a steady rate from launch, collections linked to construction progress with the balance at completion. No debt, tax, GST, approvals phasing or price escalation.</p>`; })()}`;
}

/* ---------------------------------------------------------------- building-height uncertainty */
async function heightTest() {
  const a = A(), st = a.st, ev = st.sel, out = $("htOut"); if (!ev || !st.C) return; if (st.running) { out.textContent = "Wait for the search to finish."; return; }
  const btn = $("btnHeight"); btn.disabled = true; out.innerHTML = "Rebuilding the city with lower and higher building heights…";
  const scales = [0.75, 1.5], runs = [];
  try {
    for (const k of scales) {
      const saved = st.ctx.buildings.map(b => b.height); st.ctx.buildings.forEach(b => { if (b.hsrc === "estimated") b.height *= k; });
      const S = GEO.buildScene(st.ctx, st.center, a.SCENE_HALF, a.RES, { plot: st.boundary }); st.ctx.buildings.forEach((b, i) => b.height = saved[i]);
      runs.push(new Promise((res, rej) => {
        const w = new Worker("js/worker.js"); let got = null;
        w.onerror = e => { w.terminate(); rej(e.message || "worker error"); };
        w.onmessage = e => { const m = e.data; if (m.type === "ready") w.postMessage({ type: "eval", specs: [ev.sp] }); else if (m.type === "result") got = m.ev; else if (m.type === "batchDone") { w.terminate(); res(got); } };
        w.postMessage({ type: "init", scene: { x0: S.x0, y0: S.y0, res: S.res, nx: S.nx, ny: S.ny, H: S.H, W: S.W, G: S.G, HAB: S.HAB, landmarks: st.ctx.landmarks || [] }, C: st.C, env: st.env, arc: st.field && st.field.arc, maxD: 3000 });
      }));
      out.innerHTML = `Evaluating the tower with estimated heights ×${scales.slice(0, runs.length).join(" and ×")}…`;
    }
    const [lo, hi] = await Promise.all(runs), all = [lo, ev, hi], byId = e => new Map(e.units.map(u => [u.id, u.cls]));
    const maps = all.map(byId); let robust = 0, sens = 0; const lv = [];
    for (const u of ev.units) { const c = maps.map(m => m.get(u.id)); if (c.every(x => x === "premium")) robust++; if (new Set(c).size > 1) { sens++; lv.push(u.level); } }
    ev.heightTest = { robust, sens, gdv: [Math.min(...all.map(e => e.metrics.gdvCr)), Math.max(...all.map(e => e.metrics.gdvCr))], rows: all.map((e, i) => ({ k: [0.75, 1, 1.5][i], ...CLS.reduce((o, c) => (o[c] = e.metrics[c], o), {}), gdv: e.metrics.gdvCr })) };
    renderHeightTest(); A().renderKPIs();
  } catch (e) { out.innerHTML = `<span class="warnline">The height test failed: ${esc(e)}</span>`; }
  btn.disabled = false;
}
function renderHeightTest() {
  const ev = A().st.sel, out = $("htOut"); if (!out) return; if (!ev) { out.innerHTML = ""; return; }
  const h = ev.heightTest; if (!h) { out.innerHTML = `<p class="hint">Most building heights in OpenStreetMap are estimated. This re-runs the selected tower with estimated heights 25 % lower and 50 % higher and shows which flats keep their class.</p>`; return; }
  out.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Estimated heights</th>${CLS.map(c => `<th class="n">${c}</th>`).join("")}<th class="n">GDV ${MU()}</th></tr></thead><tbody>${h.rows.map(r => `<tr><td>×${r.k}${r.k === 1 ? " (as loaded)" : ""}</td>${CLS.map(c => `<td class="n">${r[c]}</td>`).join("")}<td class="n">${fmtInt(r.gdv * 1e7 / MON.big)}</td></tr>`).join("")}</tbody></table></div>
    <p><b>${h.robust}</b> flats are premium in all three cases; <b>${h.sens}</b> change class depending on the heights (${h.sens ? "these are the ones to verify on site" : "the result does not depend on the uncertain heights"}).</p>`;
}

/* ---------------------------------------------------------------- shadow study (tower only) */
function sunPos(latDeg, day, hour) { // solar time; declination by Cooper's formula; azimuth from north, clockwise
  const D = Math.PI / 180, dec = 23.44 * Math.sin(D * 360 / 365 * (284 + day)) * D, H = (hour - 12) * 15 * D, lat = latDeg * D;
  const alt = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) / D + 180;
  return { alt: alt / D, az: VT.mod(az, 360) };
}
function towerShadows(ev, sun) { // one convex hull per band of floors: footprint swept from its base to its top
  if (sun.alt <= 2) return null; const sp = ev.sp, t = 1 / Math.tan(sun.alt * Math.PI / 180), dx = -Math.sin(sun.az * Math.PI / 180) * t, dy = -Math.cos(sun.az * Math.PI / 180) * t, out = [];
  const levels = Object.keys(ev.plates).map(Number).sort((a, b) => a - b), step = Math.max(1, Math.round(levels.length / 12));
  for (let i = 0; i < levels.length; i += step) { const l = levels[i], top = Math.min(sp.n, l + step) * sp.ftf, bot = l * sp.ftf, p = ev.plates[l]; out.push(VT.hull(p.map(([x, y]) => [x + dx * bot, y + dy * bot]).concat(p.map(([x, y]) => [x + dx * top, y + dy * top])))); }
  return out;
}
const DATES = [["21 Mar (equinox)", 80], ["21 Jun (monsoon solstice)", 172], ["21 Dec (winter solstice)", 355]];
function renderShadow() {
  const box = $("shadowOut"); if (!box) return; const a = A(), st = a.st, ev = st.sel;
  if (!ev) { box.innerHTML = `<p class="hint">Pick an option to see its shadows.</p>`; return; }
  const lat = st.anchor ? st.anchor[0] : 19.03, di = +$("shDate").value || 0, day = DATES[di][1], c = st.center;
  const parks = (st.ctx.parks || []).filter(p => VT.ringArea(p) > 2000 && Math.hypot(...VT.centroid(p).map((v, i) => v - c[i])) < 900);
  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17], sh = hours.map(h => ({ h, sun: sunPos(lat, day, h) })).map(o => ({ ...o, polys: towerShadows(ev, o.sun) }));
  const rows = parks.map(p => { const [x0, y0, x1, y1] = VT.bounds(p), pts = []; for (let y = y0 + 4; y < y1; y += 8) for (let x = x0 + 4; x < x1; x += 8) if (VT.pip(x, y, p)) pts.push([x, y]);
    const hrs = pts.map(([x, y]) => sh.filter(o => o.polys && o.polys.some(q => VT.pip(x, y, q))).length), shaded2 = hrs.filter(h => h >= 2).length / Math.max(1, pts.length);
    return { area: VT.ringArea(p), dist: Math.hypot(...VT.centroid(p).map((v, i) => v - c[i])), mean: hrs.reduce((s, v) => s + v, 0) / Math.max(1, hrs.length), max: Math.max(0, ...hrs), shaded2 }; }).sort((x, y) => y.area - x.area).slice(0, 4);
  const view = [c[0] - 450, c[1] - 450, 900], k = view[2] / 360, P = r => "M" + r.map(([x, y]) => `${(x).toFixed(1)},${(-y).toFixed(1)}`).join("L") + "Z";
  const col = h => h < 10 ? "#3b6fb6" : h < 14 ? "#6b4fa0" : "#c0632b";
  box.innerHTML = `<svg viewBox="${view[0]} ${-view[1] - view[2]} ${view[2]} ${view[2]}" style="width:100%;max-width:420px;height:auto;background:var(--surface);border:1px solid var(--line);border-radius:6px" role="img" aria-label="Tower shadows at 9:00, 12:00 and 15:00">
    ${parks.length ? (st.ctx.parks || []).map(p => `<path d="${P(p)}" fill="var(--park)" stroke="none"/>`).join("") : ""}
    ${sh.filter(o => [9, 12, 15].includes(o.h) && o.polys).map(o => o.polys.map(q => `<path d="${P(q)}" fill="${col(o.h)}" fill-opacity=".28" stroke="${col(o.h)}" stroke-width="${k}"/>`).join("")).join("")}
    <path d="${P(ev.plates[ev.sp.podium] || ev.plates[0])}" fill="var(--ink)"/><text x="${view[0] + 8 * k}" y="${-view[1] - view[2] + 16 * k}" font-size="${10 * k}">9:00 blue · 12:00 purple · 15:00 orange · N up</text></svg>
    <div class="tablewrap"><table><thead><tr><th>Park / open space</th><th class="n">Area m²</th><th class="n">Distance m</th><th class="n">Mean shade h</th><th class="n">Max shade h</th><th class="n">Area ≥ 2 h shade</th></tr></thead><tbody>${rows.map(r => `<tr><td>park</td><td class="n">${fmtInt(r.area)}</td><td class="n">${fmtInt(r.dist)}</td><td class="n">${fmt(r.mean, 1)}</td><td class="n">${r.max}</td><td class="n">${fmt(100 * r.shaded2, 0)}%</td></tr>`).join("") || `<tr><td class="muted" colspan="6">No mapped park larger than 0.2 ha within 900 m.</td></tr>`}</tbody></table></div>
    <p class="hint">Only the new tower's shadow, 8:00–17:00 solar time in 1-hour steps, on ${DATES[di][0]}. Existing buildings' own shadows are not subtracted, so this is the most the tower could add. Shadows use the convex hull of each band of floors (slightly generous for Y and cross shapes).</p>`;
}

/* ---------------------------------------------------------------- flat sheet (one flat, for a buyer) */
function flatSheetHTML() {
  const a = A(), st = a.st, c = st.cone, ev = st.sel; if (!c || !ev) return null;
  const unit = ev.units.find(u => u.level === c.level && u.mp.some(p => VT.pip(c.x - 0.4 * Math.sin(c.az * Math.PI / 180), c.y - 0.4 * Math.cos(c.az * Math.PI / 180), p[0])));
  if (!unit) return null; const lr = unit.rooms.find(r => r.room === "living"), beds = unit.rooms.filter(r => r.room.startsWith("bed")), C = st.C;
  const cs = getComputedStyle(document.documentElement), chart = $("coneChart").outerHTML.replace(/var\(--([a-z0-9-]+)\)/g, (_, k) => cs.getPropertyValue("--" + k).trim() || "#888"), img = V3D.snapshot(1200);
  const words = { premium: "Strong sea view from the living room and most bedrooms", good: "Good open view; sea partly or not from every room", neutral: "Ordinary view", compromised: "Limited view: see the reasons below" }[unit.cls];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flat ${esc(unit.id)} · ${esc(st.siteName)}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#15201e;max-width:760px;margin:0 auto;padding:22px 16px;line-height:1.45}h1{font-size:22px;margin:0}img,svg{max-width:100%;border-radius:8px}.k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:14px 0}.k div{border:1px solid #c9d1ce;border-radius:8px;padding:8px 10px}.k span{display:block;font-size:11px;text-transform:uppercase;color:#72807c}.k b{font-size:17px}.note{font-size:12px;color:#4a5854}</style></head><body>
<h1>Flat ${esc(unit.id.split("-")[1])} · floor ${unit.level} · about ${fmt(unit.z + 1.6, 0)} m eye height</h1><p class="note">${esc(st.siteName)} · ${esc(a.label(ev.sp))} tower, ${ev.sp.n} floors · prepared ${new Date().toISOString().slice(0, 10)}</p>
<p><b>${words}.</b></p>
<div class="k">${[["Carpet area", `${fmtInt(unit.carpet * VT.FT2)} ft²`], ["Bedrooms", beds.length], ["Bedrooms with sea view", `${beds.filter(b => b.water >= C.R.vcBR.w_min).length} of ${beds.length}`], ["Living-room sea view", lr ? `${fmt(100 * Math.min(1, lr.water), 0)}% of a full sea view` : "–"], ["Indicative price*", `${MB(unit.value, 2)}`], ["Indicative rate*", `${MR(unit.rate)}`]].map(([x, y]) => `<div><span>${x}</span><b>${y}</b></div>`).join("")}</div>
${img ? `<img src="${img}" alt="3D view from the tower with the view cone">` : ""}
<p>${esc($("coneTitle").textContent)}. ${esc($("coneSectors").textContent)}</p>
<p class="note">Sea visibility from this facade point, floor by floor (blue), and overall view quality (dashed):</p>${chart}
<p class="note">* Indicative only: placeholder rates for comparing options, not a price offer. Views are computed from OpenStreetMap buildings (many heights estimated) and do not include trees, signage or future buildings unless stated.</p>
</body></html>`;
}
/* ---------------------------------------------------------------- exports */
function assumptionsLines() {
  const a = A(), st = a.st, C = st.C || a.readConfig(), r = reliability();
  return [`Viewtower Studio export, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, `Site: ${st.siteName}${st.anchor ? `; anchor ${st.anchor[0].toFixed(6)}, ${st.anchor[1].toFixed(6)} (WGS84); local grid x east, y north, metres` : "; synthetic, not georeferenced"}`,
    `Limits: consumable FSI ${C.fsi} m2, max height ${C.hmax} m. Statutory rules are not modelled.`, `Rates are placeholders: base ${MON.code} ${C.E.rate}/ft2 carpet, ${C.E.pricing === "continuous" ? "continuous view multiplier 0.655 + 0.69 x living view within 0.80-1.20 (compromised 0.75)" : "class multipliers " + JSON.stringify(C.E.mult)}, floor rise ${C.E.rise}%/floor.`,
    `Classes: compromised if living view < ${C.R.vcComp.q_lr_min}, obstruction < ${C.R.vcComp.d_min} m, horizon > ${C.R.vcComp.alpha_max} deg or privacy > ${C.R.vcComp.p_max}; premium if living sea >= ${C.R.vcLR.w_min}, view >= ${C.R.vcLR.q_min} and >= ${Math.round(100 * C.R.vcBR.share)}% of bedrooms sea >= ${C.R.vcBR.w_min}.`,
    r ? `Height data: ${r.level} reliability (${Math.round(100 * r.share)}% of buildings in the main view directions within 1 km have estimated heights${r.cal && r.cal.scale !== 1 ? `, calibrated x${r.cal.scale} from ${r.cal.tagged} tagged buildings` : ""}).` : "", `Context: ${(st.dataNote || "").replace(/<[^>]+>/g, "")}`].filter(Boolean);
}
const csvCell = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function unitsCSV(ev) {
  const C = A().st.C, head = ["unit", "level", "floor_height_m", "class", "carpet_m2", "carpet_ft2", "rate_per_ft2 (" + MON.code + ")", "value (" + MON.code + " " + MON.bigL + ")", "price_multiplier", "living_view", "living_sea", "living_obstruction_m", "bedrooms_with_sea", "bedrooms", "view_checked_on_this_floor", "why"];
  const rows = ev.units.map(u => { const lr = u.rooms.find(r => r.room === "living"), beds = u.rooms.filter(r => r.room.startsWith("bed")); return [u.id, u.level, fmt(u.z, 1), u.cls, fmt(u.carpet, 1), Math.round(u.carpet * VT.FT2), Math.round(u.rate), fmt(u.value / MON.big, 3), fmt(u.mult, 3), lr ? fmt(lr.q, 3) : "", lr ? fmt(lr.water, 3) : "", lr ? (lr.dMed >= 2999 ? ">3000" : Math.round(lr.dMed)) : "", beds.filter(b => b.water >= C.R.vcBR.w_min).length, beds.length, u.evaluated === false ? "no" : "yes", u.reasons.join(" | ")]; });
  return assumptionsLines().map(l => "# " + l).join("\n") + "\n" + [head, ...rows].map(r => r.map(csvCell).join(",")).join("\n") + "\n";
}
function massingDXF(ev) {
  const st = A().st, L = [], add = (...kv) => { for (let i = 0; i < kv.length; i += 2) L.push(String(kv[i]), String(kv[i + 1])); };
  const poly = (ring, layer, z) => { add(0, "POLYLINE", 8, layer, 66, 1, 70, 1, 10, 0, 20, 0, 30, fmt(z, 3)); for (const [x, y] of ring) add(0, "VERTEX", 8, layer, 10, fmt(x, 3), 20, fmt(y, 3), 30, fmt(z, 3)); add(0, "SEQEND", 8, layer); };
  add(999, `Viewtower Studio massing. Local metres, x east, y north${st.anchor ? `, origin at ${st.anchor[0].toFixed(6)}, ${st.anchor[1].toFixed(6)}` : ""}.`);
  add(0, "SECTION", 2, "ENTITIES");
  poly(st.boundary, "SITE_BOUNDARY", 0); poly(st.env, "BUILDABLE_ENVELOPE", 0);
  for (const [l, p] of Object.entries(ev.plates)) { const z = +l * ev.sp.ftf; poly(p, "FLOOR_PLATES", z); if (ev.cores[l]) poly(ev.cores[l], "CORES", z); }
  for (const u of ev.units) if (u.evaluated !== false) for (const mp of u.mp) poly(mp[0], "UNITS_" + u.cls.toUpperCase(), u.z);
  add(0, "ENDSEC", 0, "EOF"); return L.join("\n") + "\n";
}
function massingOBJ(ev) {
  const st = A().st, c = st.center, v = [], f = []; let n = 0;
  const prism = (ring, z0, z1, name) => {
    const r = VT.ccw(ring), k = r.length; f.push(`o ${name}`);
    for (const z of [z0, z1]) for (const [x, y] of r) v.push(`v ${fmt(x - c[0], 3)} ${fmt(z, 3)} ${fmt(-(y - c[1]), 3)}`);
    const b = n + 1; f.push("f " + r.map((_, i) => b + k - 1 - i).join(" ")); f.push("f " + r.map((_, i) => b + k + i).join(" "));
    for (let i = 0; i < k; i++) { const j = (i + 1) % k; f.push(`f ${b + i} ${b + j} ${b + k + j} ${b + k + i}`); } n += 2 * k;
  };
  for (const [l, p] of Object.entries(ev.plates)) prism(p, +l * ev.sp.ftf, (+l + 1) * ev.sp.ftf - 0.3, `floor_${l}`);
  for (const b of st.ctx.buildings) { if (b.excluded) continue; const [x, y] = VT.centroid(b.ring); if (Math.hypot(x - c[0], y - c[1]) > 600) continue; prism(b.ring, b.base, b.base + b.height, `context_${b.id}${b.hsrc === "estimated" ? "_est" : ""}`); }
  return `# Viewtower Studio massing + OpenStreetMap context within 600 m (ODbL). Y up, metres, origin at the site centre.\n${v.join("\n")}\n${f.join("\n")}\n`;
}
function boardPackHTML(ev) {
  const a = A(), st = a.st, m = ev.metrics, sp = ev.sp, img = V3D.snapshot(1400), cs = getComputedStyle(document.documentElement), col = k => cs.getPropertyValue("--" + k).trim();
  const plan = $("plan") ? $("plan").outerHTML.replace(/var\(--([a-z0-9-]+)\)/g, (_, k) => col(k) || "#888") : "";
  const top = (st.results || []).slice(0, 6), bf = bestFor(st.results), e = econ(ev).base, ht = ev.heightTest;
  const mix = CLS.map(c => `<tr><td>${c}</td><td class="n">${m[c]}</td><td class="n">${fmt(100 * m[c] / Math.max(1, m.units), 0)}%</td><td class="n">${fmtInt(ev.units.filter(u => u.cls === c).reduce((s, u) => s + u.value, 0) / MON.big)}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Board pack · ${esc(a.label(sp))} · ${esc(st.siteName)}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#15201e;max-width:1000px;margin:0 auto;padding:24px 16px;line-height:1.45}h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:26px 0 8px;border-bottom:1px solid #c9d1ce;padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:5px 8px;border-bottom:1px solid #e3e8e6;text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}img{max-width:100%;border-radius:8px;border:1px solid #c9d1ce}
.k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.k div{border:1px solid #c9d1ce;border-radius:8px;padding:8px 10px}.k span{display:block;font-size:11px;text-transform:uppercase;color:#72807c}.k b{font-size:18px}
.note{font-size:12px;color:#4a5854}svg{max-width:520px;width:100%;height:auto}@media print{h2{break-after:avoid}img,svg{break-inside:avoid}}</style></head><body>
<h1>${esc(a.label(sp))} · ${sp.upf} flat${sp.upf > 1 ? "s" : ""}/floor · ${sp.n} floors (${fmt(m.height, 0)} m)</h1><p class="note">${esc(st.siteName)} · generated ${new Date().toISOString().slice(0, 10)} by Viewtower Studio · option ${ev.id}</p>
${verdictHTML().replace(/<span class="badge[^"]*"[^>]*>/g, "<span style=\"display:inline-block;margin:2px 6px 2px 0;padding:2px 8px;border-radius:99px;background:#e3e8e6;font-size:12px\">")}
<div class="k">${[["Sales value", `${MB(m.gdv)}`], ["Flats", m.units], ["Strong view", `${m.premium} (${fmt(100 * m.premiumShare, 0)}%)`], ["Compromised", m.compromised], ["Carpet", `${fmtInt(m.carpet)} m²`], ["Efficiency", fmt(m.efficiency, 2)], ["Margin (excl. land if not entered)", `${fmt(100 * e.margin, 1)}%`], ["Slenderness", `1:${fmt(m.slender, 1)}`]].map(([x, y]) => `<div><span>${x}</span><b>${y}</b></div>`).join("")}</div>
${img ? `<h2>3D view</h2><img src="${img}" alt="3D view of the selected tower in its OpenStreetMap context">` : ""}
<h2>Flat mix by view class</h2><table><thead><tr><th>Class</th><th class="n">Flats</th><th class="n">Share</th><th class="n">Value ${MU()}</th></tr></thead><tbody>${mix}</tbody></table>
${ht ? `<h2>Building-height uncertainty</h2><table><thead><tr><th>Estimated heights</th>${CLS.map(c => `<th class="n">${c}</th>`).join("")}<th class="n">GDV ${MU()}</th></tr></thead><tbody>${ht.rows.map(r => `<tr><td>×${r.k}</td>${CLS.map(c => `<td class="n">${r[c]}</td>`).join("")}<td class="n">${fmtInt(r.gdv * 1e7 / MON.big)}</td></tr>`).join("")}</tbody></table><p class="note">${ht.robust} flats are premium in all three cases; ${ht.sens} change class.</p>` : ""}
${plan ? `<h2>Typical floor (level ${st.level})</h2>${plan}` : ""}
<h2>Options compared</h2><table><thead><tr><th>Option</th><th class="n">Floors</th><th class="n">GDV ${MU()}</th><th class="n">Strong view</th><th class="n">Compromised</th><th class="n">Efficiency</th><th>Best for</th></tr></thead><tbody>${top.map(o => `<tr${o === ev ? ' style="background:#d3e6ec"' : ""}><td>${esc(a.label(o.sp))}, ${o.sp.upf}/floor, rot ${o.sp.rotation}°</td><td class="n">${o.sp.n}</td><td class="n">${fmtInt(o.metrics.gdv / MON.big)}</td><td class="n">${o.metrics.premium}</td><td class="n">${o.metrics.compromised}</td><td class="n">${fmt(o.metrics.efficiency, 2)}</td><td>${(bf.get(o.id) || []).join(", ")}</td></tr>`).join("")}</tbody></table>
<h2>Why this result</h2><ul>${ev.explain.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
<h2>Assumptions and data</h2><ul class="note">${assumptionsLines().map(l => `<li>${esc(l)}</li>`).join("")}</ul>
</body></html>`;
}

/* ---------------------------------------------------------------- scenario save / load / share */
function scenario() {
  const a = A(), st = a.st, inputs = {};
  document.querySelectorAll("aside.controls input, aside.controls select").forEach(el => { if (!el.id || el.type === "file") return; inputs[el.id] = el.type === "checkbox" ? el.checked : el.value; });
  return { app: "viewtower-studio", version: 1, src: st.src, anchor: st.anchor, siteName: st.siteName, boundary: st.boundary, setbacks: st.setbacks, isEnv: st.isEnv, inputs };
}
async function applyScenario(s) {
  const a = A(), st = a.st; if (!s || s.app !== "viewtower-studio") throw new Error("not a Viewtower Studio scenario");
  for (const [id, v] of Object.entries(s.inputs || {})) { const el = $(id); if (!el) continue; if (el.type === "checkbox") el.checked = !!v; else el.value = v; }
  if (s.src === "upload") { status("This scenario used an uploaded context file: load the same file, then the boundary is restored.", true); $("src").value = "dadar"; await a.changeSource("dadar"); }
  else { $("src").value = s.src; await a.changeSource(s.src); if (s.src === "live") await a.loadLive(); }
  if (s.boundary && s.boundary.length >= 3) { a.setBoundary(s.boundary, s.siteName || "Saved plot", s.setbacks, "scenario"); st.isEnv = !!s.isEnv; a.pressEnv(); a.recomputeEnv(); }
  status("Scenario loaded. Press Run search.");
}
function b64(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64(s) { return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))); }
async function shareLink() {
  const url = location.href.split("#")[0] + "#s=" + b64(JSON.stringify(scenario()));
  try { await navigator.clipboard.writeText(url); status("Share link copied. Anyone opening it gets the same site, envelope and inputs."); }
  catch (e) { status("Copy blocked by the browser. Link: " + url.slice(0, 80) + "…", true); }
}

/* ---------------------------------------------------------------- presenter mode + jump controls */
function setPresent(on) { document.body.classList.toggle("present", on); $("btnPresent").textContent = on ? "Exit presentation" : "Present"; $("btnPresent").setAttribute("aria-pressed", String(on)); if (on) A().setTab("t-3d"); window.dispatchEvent(new Event("resize")); }
function bindJump() {
  const hold = (btn, key) => { const on = e => { e.preventDefault(); V3D.setKey(key, true); }, off = () => V3D.setKey(key, false); btn.addEventListener("pointerdown", on); ["pointerup", "pointerleave", "pointercancel"].forEach(t => btn.addEventListener(t, off)); };
  document.querySelectorAll("[data-jkey]").forEach(b => hold(b, b.dataset.jkey));
  document.querySelectorAll("[data-jturn]").forEach(b => b.addEventListener("click", () => V3D.turn(+b.dataset.jturn)));
  $("jumpSea").addEventListener("click", () => { const f = A().st.field; if (f && f.arc) V3D.setYaw(VT.mod(f.arc[0] + VT.mod(f.arc[1] - f.arc[0], 360) / 2, 360)); });
  V3D.on("heading", az => { $("jumpHeading").textContent = `${Math.round(az)}° ${A().compass(az)}`; $("jumpNeedle").style.transform = `rotate(${-az}deg)`; });
}

/* ---------------------------------------------------------------- wiring */
let init = function () {
  bindSort(); bindJump(); downloadsNS();
  $("btnPresent").addEventListener("click", () => setPresent(!document.body.classList.contains("present")));
  $("hudClose").addEventListener("click", () => $("stage").classList.add("nohint"));
  const need = () => { const ev = A().st.sel; if (!ev) status("Run a search and pick an option first.", true); return ev; };
  $("xCSV").addEventListener("click", () => { const ev = need(); if (ev) saveFile(`units_${ev.id}.csv`, unitsCSV(ev)); });
  $("xCAD").addEventListener("click", () => { const ev = need(); if (ev) saveFile(`massing_${ev.id}.zip`, zip([{ name: `massing_${ev.id}.dxf`, text: massingDXF(ev) }, { name: `massing_${ev.id}.obj`, text: massingOBJ(ev) }, { name: "README.txt", text: assumptionsLines().join("\n") + "\n\nmassing.dxf: R12 polylines per floor plate, core and unit (layers by class) at floor elevation.\nmassing.obj: tower floors + context buildings within 600 m (Y up, origin at the site centre).\n" }]), "DXF + OBJ inside"); });
  $("xBoard").addEventListener("click", () => { const ev = need(); if (ev) saveFile(`board_pack_${ev.id}.html`, boardPackHTML(ev), "open it in a browser and print to PDF"); });
  $("xJSON").addEventListener("click", () => saveFile(`scenario_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ ...scenario(), results: JSON.parse(A().resultsJSON()) }, null, 1)));
  $("xLink").addEventListener("click", shareLink);
  $("xLoad").addEventListener("change", e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = async () => { try { await applyScenario(JSON.parse(String(r.result))); } catch (err) { status(`Could not load ${f.name}: ${err.message || err}`, true); } }; r.readAsText(f); e.target.value = ""; });
  ["xLand", "xSoft", "xSales", "xTarget"].forEach(id => $(id).addEventListener("input", renderEcon));
  $("btnHeight").addEventListener("click", heightTest);
  ["xMonths", "xAbs", "xDisc"].forEach(id => $(id).addEventListener("input", renderEcon));
  $("shDate").addEventListener("change", renderShadow);
  $("xFlat").addEventListener("click", () => { const h = flatSheetHTML(); if (!h) { status("Click a flat on the tower first.", true); return; } const c = A().st.cone; saveFile(`flat_L${c.level}_${A().st.sel.id}.html`, h, "open it in a browser, print or share"); });
  document.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", () => preset(b.dataset.preset)));
};
async function boot() { // after the app has loaded its default site
  if (/(^|[#&])present\b/.test(location.hash)) setPresent(true);
  const m = location.hash.match(/[#&]s=([^&]+)/); if (m) { try { await applyScenario(JSON.parse(unb64(m[1]))); } catch (e) { status("The shared link could not be read.", true); } }
}
const PRESETS = { quick: { typos: ["square", "y_shaped"], rots: "0", upf: "2" }, standard: { typos: ["square", "chamfered", "twisted", "y_shaped"], rots: "0, 30", upf: "1, 2" }, thorough: { typos: null, rots: "0, 30, 60", upf: "1, 2, 3" } };
function preset(k) {
  const p = PRESETS[k], T = A().TYPOS; T.forEach((t, i) => { const el = $(`ty-${i}`); if (el) el.checked = !p.typos || p.typos.includes(t.key); });
  $("rots").value = p.rots; $("upf").value = p.upf; document.querySelectorAll("[data-preset]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.preset === k)));
  const n = A().countSpecs(); $("presetInfo").textContent = `${n} option${n === 1 ? "" : "s"} to test${n > 40 ? " · this can take a few minutes" : ""}.`;
}
let inited = false; const init0 = init; init = function () { if (inited) return; inited = true; init0(); };
window.VTX = { init, boot, verdictHTML, bestFor, renderEcon, renderShadow, cashflow, sunPos, flatSheetHTML, renderHeightTest, reliability, unitsCSV, massingDXF, massingOBJ, boardPackHTML, scenario, applyScenario, zip };
// extras.js may load after the app has already booted
if (window.VTApp && window.VTApp.st.booted) { window.VTX.init(); if (window.VTApp.st.ready) window.VTX.boot(); }
})();
