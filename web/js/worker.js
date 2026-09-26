/* Search worker: hard-rule checks and view evaluation for a batch of candidates. */
importScripts("engine.js");
let S = null, C = null, V = null, ENV = null, ARC = null;
self.onmessage = e => {
  const m = e.data;
  if (m.type === "init") { S = m.scene; C = m.C; V = VT.viewSettings({ res: S.res, maxD: m.maxD, lmOn: !!(S.landmarks && S.landmarks.length) }); ENV = m.env; ARC = m.arc; self.postMessage({ type: "ready" }); return; }
  if (m.type === "eval") {
    for (const sp of m.specs) {
      const ev = VT.checkCandidate(sp, ENV, C, ARC);
      // stream the massing first so the 3D view can show it while views are computed
      self.postMessage({ type: "massing", id: ev.id, sp, plates: ev.plates, feasible: ev.feasible, viol: ev.viol });
      if (ev.feasible) VT.evaluateViews(ev, S, C, V);
      self.postMessage({ type: "result", ev });
    }
    self.postMessage({ type: "batchDone" });
  }
};
