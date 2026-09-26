/* Search worker: hard-rule checks and view evaluation for a batch of candidates. */
importScripts("engine.js", "tokens.js");
let S = null, C = null, V = null, ENV = null, ARC = null;
self.onmessage = e => {
  const m = e.data;
  if (m.type === "init") { S = m.scene; C = m.C; V = VT.viewSettings({ res: S.res, maxD: m.maxD, lmOn: !!(S.landmarks && S.landmarks.length) }); ENV = m.env; ARC = m.arc; self.postMessage({ type: "ready" }); return; }
  if (m.type === "eval") {
    for (const sp of m.specs) {
      // N towers per site: lay them out, then evaluate each with its siblings in the scene
      const N = Math.max(1, C.towers || 1), lay = N > 1 ? VT.siteLayout(sp, N, ENV, C) : { sps: [sp], note: "" };
      if (!lay) { self.postMessage({ type: "massing", sp, plates: {}, feasible: false, viol: ["ENV-ENVELOPE-01"] }); self.postMessage({ type: "result", ev: { id: VT.specId(sp), sp, feasible: false, viol: ["ENV-ENVELOPE-01"], checks: { "ENV-ENVELOPE-01": [false, `${N} towers of this size do not fit the envelope ${C.towerSep ?? 24} m apart`] }, metrics: {}, units: [] } }); continue; }
      // stream the massing first so the 3D view can show it while views are computed
      const ev = VT.evaluateSite(lay.sps, ENV, C, S, V, ARC, evs => self.postMessage({ type: "massing", sp: lay.sps[0], towers: evs.map(e => ({ sp: e.sp, plates: e.plates })), plates: evs[0].plates, feasible: evs.every(e => e.feasible), viol: [...new Set(evs.flatMap(e => e.viol))] }));
      if (lay.note) ev.sp.fitNote = lay.note;
      self.postMessage({ type: "result", ev });
    }
    self.postMessage({ type: "batchDone" });
  }
};
