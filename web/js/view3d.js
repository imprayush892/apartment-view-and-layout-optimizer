/* 3D city model, live search massings, view cones and first-person "jump in". Needs THREE + OrbitControls. */
(function (G) {
"use strict";
const { D2R, ccw, centroid, bounds, pip, perimeterPoints, mod } = G.VT;
const COL = { land: "#c9c5bb", sea: "#4f93b3", beach: "#e3d3a4", park: "#8fb77f", road: "#f4f3ef", roadEdge: "#a9a598", plot: "#c7702a", env: "#0d5e78",
  bldg: 0xc9ced1, bldgEst: 0xd9dcdd, ghost: 0x2aa0c4, core: 0x4a5854, podium: 0x9aa3a0, premium: 0x5e3c99, good: 0xa99bd0, neutral: 0xf2b45c, compromised: 0xd4520b,
  raySea: 0x1f6fd1, rayBlock: 0xd24b3a, rayOpen: 0x8a948f };
let T = null;

function init(el) {
  if (T) return T;
  const W = el.clientWidth || 800, H = el.clientHeight || 520;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W, H); renderer.outputEncoding = THREE.sRGBEncoding; el.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xcfe0e8); scene.fog = new THREE.Fog(0xcfe0e8, 2600, 9000);
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.5, 12000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7a7a70, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(-600, 900, 400); scene.add(sun);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 20; controls.maxDistance = 5000;
  T = { el, renderer, scene, camera, controls, groups: {}, designMeshes: [], ctr: [0, 0], mode: "orbit", jump: null, raycaster: new THREE.Raycaster(), listeners: {} };
  new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); T.dirty = true; }).observe(el);
  // render only when something changed (camera, scene, animated ghost, first-person) to spare CPU and battery
  const loop = () => { requestAnimationFrame(loop); let moved = false; if (T.mode === "orbit") moved = controls.update(); else { stepJump(); moved = true; } if (T.groups.ghost) { moved = true; T.groups.ghost.children.forEach(m => { if (m.material) m.material.opacity = 0.28 + 0.14 * Math.sin(performance.now() / 260); }); } if (moved || T.dirty) { T.dirty = false; renderer.render(scene, camera); } };
  loop(); bindPointer(); return T;
}
const W3 = (x, y, z = 0) => new THREE.Vector3(x - T.ctr[0], z, -(y - T.ctr[1]));
function setGroup(name, obj) { if (T) T.dirty = true; if (T.groups[name]) { T.scene.remove(T.groups[name]); dispose(T.groups[name]); } T.groups[name] = obj; if (obj) T.scene.add(obj); }
function dispose(o) { o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); }

/* ---------- context: ground texture + merged buildings */
function setContext(ctx, S, center, site, opts = {}) {
  init(T ? T.el : opts.el); T.ctr = center.slice(); T.ctx = ctx; T.S = S; T.site = site;
  const half = opts.half || 3000;
  setGroup("ground", groundMesh(ctx, S, center, half, site));
  setGroup("buildings", buildingsMesh(ctx, center, half));
  if (!opts.keepCamera) resetView();
}
function groundMesh(ctx, S, center, half, site) {
  const max = Math.min(4096, T.renderer.capabilities.maxTextureSize || 4096), N = max, cv = document.createElement("canvas"); cv.width = cv.height = N;
  const g = cv.getContext("2d"), k = N / (2 * half), X = x => (x - (center[0] - half)) * k, Y = y => ((center[1] + half) - y) * k;
  g.fillStyle = COL.land; g.fillRect(0, 0, N, N);
  if (S) { // water from the raster (includes the flooded sea)
    const j0 = Math.max(0, Math.floor((center[0] - half - S.x0) / S.res)), i0 = Math.max(0, Math.floor((center[1] - half - S.y0) / S.res)), w = Math.min(S.nx - j0, Math.ceil(2 * half / S.res)), h = Math.min(S.ny - i0, Math.ceil(2 * half / S.res));
    const im = document.createElement("canvas"); im.width = w; im.height = h; const ic = im.getContext("2d"), id = ic.createImageData(w, h), sea = hex(COL.sea);
    for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) { const q = (i0 + i) * S.nx + (j0 + j); if (S.W[q]) { const o = ((h - 1 - i) * w + j) * 4; id.data[o] = sea[0]; id.data[o + 1] = sea[1]; id.data[o + 2] = sea[2]; id.data[o + 3] = 255; } }
    ic.putImageData(id, 0, 0); g.imageSmoothingEnabled = true;
    g.drawImage(im, X(S.x0 + j0 * S.res), Y(S.y0 + (i0 + h) * S.res), w * S.res * k, h * S.res * k);
  }
  const fill = (r, c) => { if (r.length < 3) return; g.beginPath(); r.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))); g.closePath(); g.fillStyle = c; g.fill(); };
  (ctx.beach || []).forEach(r => fill(r, COL.beach)); (ctx.parks || []).forEach(r => fill(r, COL.park));
  g.lineCap = "round"; g.lineJoin = "round";
  for (const pass of [0, 1]) for (const r of ctx.roads || []) { if (r.line.length < 2) continue; g.beginPath(); r.line.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))); g.strokeStyle = pass ? COL.road : COL.roadEdge; g.lineWidth = Math.max(1, (r.w + (pass ? 0 : 1.2)) * k); g.stroke(); }
  if (site && site.env && site.env.length) { g.beginPath(); site.env.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))); g.closePath(); g.fillStyle = "rgba(13,94,120,0.22)"; g.fill(); g.strokeStyle = COL.env; g.lineWidth = Math.max(1.5, 0.6 * k); g.stroke(); }
  if (site && site.boundary) { g.beginPath(); site.boundary.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))); g.closePath(); g.setLineDash([6, 4]); g.strokeStyle = COL.plot; g.lineWidth = Math.max(2, 0.8 * k); g.stroke(); g.setLineDash([]); }
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = T.renderer.capabilities.getMaxAnisotropy(); tex.minFilter = THREE.LinearMipmapLinearFilter; tex.encoding = THREE.sRGBEncoding;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * half, 2 * half), new THREE.MeshLambertMaterial({ map: tex }));
  m.rotation.x = -Math.PI / 2; m.position.set(0, -0.05, 0); m.userData.ground = true;
  const grp = new THREE.Group(); grp.add(m);
  // beyond the analysed area: continue the sea if the raster edge is mostly water (coastal sites)
  let edge = 0, wet = 0; if (S) { for (let j = 0; j < S.nx; j += 4) { edge += 2; wet += S.W[j] + S.W[(S.ny - 1) * S.nx + j]; } for (let i = 0; i < S.ny; i += 4) { edge += 2; wet += S.W[i * S.nx] + S.W[i * S.nx + S.nx - 1]; } }
  const far = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshLambertMaterial({ color: edge && wet / edge > 0.25 ? COL.sea : COL.land })); far.rotation.x = -Math.PI / 2; far.position.y = -0.4; grp.add(far);
  return grp;
}
function hex(c) { const v = parseInt(c.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
function buildingsMesh(ctx, center, half) {
  const pos = [], col = [], c0 = new THREE.Color(COL.bldg), c1 = new THREE.Color(COL.bldgEst), cf = new THREE.Color(0xe39150);
  for (const b of ctx.buildings) {
    if (b.excluded) continue; const cc = centroid(b.ring); if (Math.abs(cc[0] - center[0]) > half || Math.abs(cc[1] - center[1]) > half) continue;
    const r = ccw(b.ring), z0 = b.base || 0, z1 = z0 + b.height, base = b.scenario === "future" ? cf : b.hsrc === "estimated" ? c1 : c0;
    const shade = 0.9 + 0.1 * Math.min(1, b.height / 90), cw = base.clone().multiplyScalar(0.86 * shade), cr = base.clone().multiplyScalar(1.02);
    const push = (p, c) => { pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); };
    for (let i = 0; i < r.length; i++) { const a = r[i], q = r[(i + 1) % r.length]; const A0 = W3(a[0], a[1], z0), B0 = W3(q[0], q[1], z0), A1 = W3(a[0], a[1], z1), B1 = W3(q[0], q[1], z1); [A0, B0, B1, A0, B1, A1].forEach(p => push(p, cw)); }
    const tris = THREE.ShapeUtils.triangulateShape(r.map(([x, y]) => new THREE.Vector2(x, y)), []);
    for (const t of tris) for (const idx of t) push(W3(r[idx][0], r[idx][1], z1), cr);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); m.userData.context = true;
  const g = new THREE.Group(); g.add(m); return g;
}
function updateSite(site) { if (!T || !T.ctx) return; T.site = site; setGroup("ground", groundMesh(T.ctx, T.S, T.ctr, 3000, site)); }

/* ---------- massings */
function shapeOf(ring, holes) { const s = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x - T.ctr[0], y - T.ctr[1]))); for (const h of holes || []) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x - T.ctr[0], y - T.ctr[1])))); return s; }
function extrude(shape, h, z, mat) { const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, z, 0); return new THREE.Mesh(g, mat); }
function showGhost(sp, plates, label) {
  const list = Array.isArray(sp) ? sp : [{ sp, plates }]; // one tower or a list of {sp, plates}
  const g = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: COL.ghost, transparent: true, opacity: 0.35, depthWrite: false }), edge = new THREE.LineBasicMaterial({ color: 0x0d5e78, transparent: true, opacity: 0.55 });
  for (const { sp, plates } of list) { const n = sp.n, step = n > 60 ? 2 : 1;
  for (let l = 0; l < n; l += step) { const p = plates[l]; if (!p) continue; const m = extrude(shapeOf(ccw(p)), sp.ftf * step - 0.25, l * sp.ftf, mat); g.add(m); if (l % (4 * step) === 0) { const e = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ccw(p).map(([x, y]) => W3(x, y, l * sp.ftf + 0.05))), edge); g.add(e); } } }
  setGroup("ghost", g); T.ghostLabel = label;
}
function clearGhost() { setGroup("ghost", null); }
function showDesign(ev, opts = {}) {
  clearGhost(); clearCone();
  const g = new THREE.Group(); T.designMeshes = []; T.design = ev;
  const mats = {}; const mat = c => mats[c] || (mats[c] = new THREE.MeshLambertMaterial({ color: c }));
  const slabMat = new THREE.MeshLambertMaterial({ color: 0xf2f2ef });
  (ev.towers || [ev]).forEach((tw, ti) => { const sp = tw.sp, evT = tw;
  for (let l = 0; l < sp.n; l++) { const ev = evT;
    const z = l * sp.ftf, us = ev.units.filter(u => u.level === l), plate = ev.plates[l];
    g.add(extrude(shapeOf(ccw(plate)), 0.3, z, slabMat));
    if (!us.length) { const m = extrude(shapeOf(ccw(plate)), sp.ftf - 0.3, z + 0.3, mat(COL.podium)); m.userData = { level: l, podium: true, tower: ti }; g.add(m); T.designMeshes.push(m); continue; }
    const src = us[0].evaluated ? l : us[0].inheritFrom;
    if (src !== l && (sp.typology === "terraced" || sp.typology === "tapered" || sp.typology === "twisted")) {
      const m = extrude(shapeOf(ccw(plate), [ccw(ev.cores[l])]), sp.ftf - 0.3, z + 0.3, mat(opts.neutral ? 0xe6dccb : COL[us[0].cls])); m.userData = { level: l, tower: ti }; g.add(m); T.designMeshes.push(m);
    } else for (const u of us) {
      const srcU = src === l ? u : ev.units.find(x => x.level === src && x.id.split("-U")[1] === u.id.split("-U")[1]);
      for (const poly of srcU.mp) { const m = extrude(shapeOf(ccw(poly[0]), poly.slice(1).map(ccw)), sp.ftf - 0.3, z + 0.3, mat(opts.neutral ? 0xe6dccb : COL[u.cls])); m.userData = { level: l, unit: u.id, tower: ti }; g.add(m); T.designMeshes.push(m); }
    }
    g.add(extrude(shapeOf(ccw(ev.cores[l])), sp.ftf, z, mat(COL.core)));
  } });
  setGroup("design", g);
  if (opts.frame) frameTower(Math.max(...(ev.towers || [ev]).map(t => t.sp.n * t.sp.ftf)));
}
/* Neutral massing for image-only review: glass floors with slab lines, no class colours or numbers. */
function showMassing(towers, opts = {}) {
  clearGhost(); clearCone(); T.designMeshes = [];
  const g = new THREE.Group(), glass = new THREE.MeshLambertMaterial({ color: opts.color || 0xdfe8ec }), pod = new THREE.MeshLambertMaterial({ color: 0xc9cdca }), slab = new THREE.MeshLambertMaterial({ color: 0x8d9a9e });
  for (const t of towers) for (let l = 0; l < t.sp.n; l++) { const p = t.plates[l]; if (!p) continue; const z = l * t.sp.ftf, s = shapeOf(ccw(p));
    g.add(extrude(s, t.sp.ftf - 0.45, z + 0.45, l < t.sp.podium ? pod : glass)); g.add(extrude(s, 0.45, z, slab)); }
  setGroup("design", g); T.design = null;
}
/* Camera at a site azimuth (degrees, the side the camera stands on), distance and elevation, looking at height tz. */
function camAt(az, dist, elev, tz) { if (!T) return; const a = az * D2R, e = elev * D2R; T.controls.target.set(0, tz, 0); T.camera.position.set(Math.sin(a) * Math.cos(e) * dist, tz + Math.sin(e) * dist, -Math.cos(a) * Math.cos(e) * dist); T.camera.lookAt(0, tz, 0); T.controls.update(); T.dirty = true; }
function clearDesign() { setGroup("design", null); T && (T.designMeshes = []); }

/* ---------- picking + view cones */
function bindPointer() {
  let down = null;
  T.renderer.domElement.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; });
  T.renderer.domElement.addEventListener("pointerup", e => {
    if (!down || T.mode !== "orbit") return; const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]); down = null; if (moved > 5) return;
    const hit = pick(e); if (hit && T.listeners.pick) T.listeners.pick(hit);
  });
}
function pick(e) {
  if (!T.designMeshes.length) return null;
  const r = T.renderer.domElement.getBoundingClientRect(), m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  T.raycaster.setFromCamera(m, T.camera); const hits = T.raycaster.intersectObjects(T.designMeshes, false); if (!hits.length) return null;
  const h = hits[0], n = h.face.normal.clone().transformDirection(h.object.matrixWorld), x = h.point.x + T.ctr[0], y = -h.point.z + T.ctr[1];
  const level = h.object.userData.level, tower = h.object.userData.tower || 0, horizontal = Math.abs(n.y) < 0.5;
  return { level, tower, x, y, az: horizontal ? mod(Math.atan2(n.x, -n.z) / D2R, 360) : null };
}
/* Snap a plan point to the nearest facade sample of a plate: returns observer point + outward normal. */
function snapToFacade(plate, x, y) { const pp = perimeterPoints(plate, 0.5); let bi = 0, bd = Infinity; pp.pts.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; bi = i; } }); return { x: pp.pts[bi][0], y: pp.pts[bi][1], az: pp.normals[bi] }; }
function showCone(o, cone, opts = {}) {
  const g = new THREE.Group(), eye = o.z, maxDraw = opts.maxDraw || 1400, lp = [], lc = [], fp = [], fc = [];
  const O = W3(o.x, o.y, eye), cSea = new THREE.Color(COL.raySea), cBlk = new THREE.Color(COL.rayBlock), cOpen = new THREE.Color(COL.rayOpen);
  const ends = cone.rays.map(r => { const len = r.dObs < opts.maxD - 1 ? Math.min(r.dObs, maxDraw) : r.water > 0.05 ? Math.min(Math.max(r.lastSea, 200), maxDraw) : Math.min(600, maxDraw); const c = r.dObs < opts.maxD - 1 && r.water <= 0.05 ? cBlk : r.water > 0.05 ? cSea : cOpen; return { p: W3(o.x + Math.sin(r.az * D2R) * len, o.y + Math.cos(r.az * D2R) * len, eye), c }; });
  ends.forEach(({ p, c }, i) => { lp.push(O.x, O.y, O.z, p.x, p.y, p.z); lc.push(c.r, c.g, c.b, c.r, c.g, c.b); if (i + 1 < ends.length) { const q = ends[i + 1]; fp.push(O.x, O.y, O.z, p.x, p.y, p.z, q.p.x, q.p.y, q.p.z); for (let k = 0; k < 3; k++) fc.push(c.r, c.g, c.b); } });
  const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute("color", new THREE.Float32BufferAttribute(lc, 3));
  g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })));
  const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3)); fg.setAttribute("color", new THREE.Float32BufferAttribute(fc, 3));
  g.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0xc7702a })); dot.position.copy(O); g.add(dot);
  setGroup("cone", g);
}
function clearCone() { setGroup("cone", null); }

/* ---------- camera modes */
/* Look from the land side towards the sea (the premium arc bisector), slightly off-axis. */
function frameTower(H) {
  // dense cities: look down from higher and further out so neighbouring towers do not fill the frame
  if (T.ctx && T.ctx.profile === "dense") { const az = (T.seaAz ?? 270) * D2R, dist = Math.max(420, H * 2.6), el = 40 * D2R, dx = Math.sin(az), dz = -Math.cos(az), side = 0.35;
    T.controls.target.set(0, H * 0.45, 0); T.camera.position.set((-dx + dz * side) * dist * Math.cos(el), H * 0.45 + dist * Math.sin(el), (-dz - dx * side) * dist * Math.cos(el)); T.camera.fov = 42; T.camera.updateProjectionMatrix(); return; }
  const az = (T.seaAz ?? 270) * D2R, back = Math.max(260, H * 1.9), side = 0.45;
  const dx = Math.sin(az), dz = -Math.cos(az), px = -dz, pz = dx;
  T.controls.target.set(dx * H * 0.35, H * 0.38, dz * H * 0.35);
  T.camera.position.set(-dx * back + px * back * side, H * 0.85 + 60, -dz * back + pz * back * side);
  T.camera.fov = 45; T.camera.updateProjectionMatrix();
}
function setSeaAz(az) { if (T) T.seaAz = az; }
function resetView() { if (!T) return; frameTower(T.design ? T.design.sp.n * T.design.sp.ftf : 90); }
function topView() { T.controls.target.set(0, 0, 0); T.camera.position.set(0, 1300, 1); }
function jumpIn(o, plate, ftf) {
  const inward = 0.9, x = o.x - Math.sin(o.az * D2R) * inward, y = o.y - Math.cos(o.az * D2R) * inward;
  T.saved = { pos: T.camera.position.clone(), target: T.controls.target.clone(), fov: T.camera.fov };
  T.mode = "jump"; T.controls.enabled = false;
  const g = new THREE.Group(), dark = new THREE.MeshLambertMaterial({ color: 0x3b4442, side: THREE.DoubleSide }), rail = new THREE.LineBasicMaterial({ color: 0x222222 });
  const s = shapeOf(ccw(plate)), fl = new THREE.Mesh(new THREE.ShapeGeometry(s), dark); fl.rotation.x = -Math.PI / 2; fl.position.y = o.floorZ + 0.32; g.add(fl);
  const ce = new THREE.Mesh(new THREE.ShapeGeometry(s), dark); ce.rotation.x = -Math.PI / 2; ce.position.y = o.floorZ + ftf - 0.02; g.add(ce);
  const pts = ccw(plate).concat([ccw(plate)[0]]).map(([px, py]) => W3(px, py, o.floorZ + 1.1)); g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), rail));
  setGroup("room", g); if (T.groups.design) T.groups.design.visible = false; if (T.groups.cone) T.groups.cone.visible = false;
  T.jump = { pos: W3(x, y, o.floorZ + 1.6), yaw: o.az, pitch: -4, keys: {}, floorZ: o.floorZ };
  T.camera.fov = 70; T.camera.updateProjectionMatrix();
  const el = T.renderer.domElement; let drag = null;
  T.jump.down = e => { drag = [e.clientX, e.clientY, T.jump.yaw, T.jump.pitch]; el.setPointerCapture(e.pointerId); };
  T.jump.move = e => { if (!drag) return; T.jump.yaw = drag[2] - (e.clientX - drag[0]) * 0.18; T.jump.pitch = Math.max(-80, Math.min(80, drag[3] + (e.clientY - drag[1]) * 0.18)); };
  T.jump.up = () => { drag = null; };
  T.jump.wheel = e => { e.preventDefault(); T.camera.fov = Math.max(20, Math.min(95, T.camera.fov + Math.sign(e.deltaY) * 4)); T.camera.updateProjectionMatrix(); };
  T.jump.kd = e => { T.jump.keys[e.key.toLowerCase()] = true; if (e.key === "Escape") exitJump(); };
  T.jump.ku = e => { T.jump.keys[e.key.toLowerCase()] = false; };
  el.addEventListener("pointerdown", T.jump.down); el.addEventListener("pointermove", T.jump.move); el.addEventListener("pointerup", T.jump.up); el.addEventListener("wheel", T.jump.wheel, { passive: false });
  window.addEventListener("keydown", T.jump.kd); window.addEventListener("keyup", T.jump.ku);
}
function stepJump() {
  const J = T.jump; if (!J) return; const k = J.keys, sp = 0.12, f = new THREE.Vector3(Math.sin(J.yaw * D2R), 0, -Math.cos(J.yaw * D2R)), r = new THREE.Vector3(-f.z, 0, f.x);
  if (k.w || k.arrowup) J.pos.addScaledVector(f, sp); if (k.s || k.arrowdown) J.pos.addScaledVector(f, -sp); if (k.d || k.arrowright) J.pos.addScaledVector(r, sp); if (k.a || k.arrowleft) J.pos.addScaledVector(r, -sp);
  T.camera.position.copy(J.pos);
  if (T.listeners.heading && Math.abs((J.lastYaw ?? 1e9) - J.yaw) > 0.5) { J.lastYaw = J.yaw; T.listeners.heading(mod(J.yaw, 360)); }
  const cp = Math.cos(J.pitch * D2R), dir = new THREE.Vector3(Math.sin(J.yaw * D2R) * cp, Math.sin(J.pitch * D2R), -Math.cos(J.yaw * D2R) * cp);
  T.camera.lookAt(J.pos.clone().add(dir));
}
function exitJump() {
  if (!T || T.mode !== "jump") return; const el = T.renderer.domElement, J = T.jump;
  el.removeEventListener("pointerdown", J.down); el.removeEventListener("pointermove", J.move); el.removeEventListener("pointerup", J.up); el.removeEventListener("wheel", J.wheel);
  window.removeEventListener("keydown", J.kd); window.removeEventListener("keyup", J.ku);
  setGroup("room", null); if (T.groups.design) T.groups.design.visible = true; if (T.groups.cone) T.groups.cone.visible = true;
  T.mode = "orbit"; T.jump = null; T.controls.enabled = true; T.camera.fov = T.saved.fov; T.camera.updateProjectionMatrix(); T.camera.position.copy(T.saved.pos); T.controls.target.copy(T.saved.target);
  T.dirty = true; T.listeners.exitJump && T.listeners.exitJump();
}
function on(name, fn) { if (T) T.listeners[name] = fn; }
/* first-person helpers for on-screen controls: turn to a bearing, hold a step key */
function setYaw(az) { if (T && T.jump) { T.jump.yaw = az; T.jump.pitch = -2; } }
function setKey(k, down) { if (T && T.jump) T.jump.keys[k] = down; }
function turn(d) { if (T && T.jump) T.jump.yaw += d; }
/* PNG of the current 3D view (rendered now so no preserved drawing buffer is needed) */
function snapshot(w = 1200) {
  if (!T) return null; T.renderer.render(T.scene, T.camera); const src = T.renderer.domElement, c = document.createElement("canvas");
  c.width = w; c.height = Math.round(w * src.height / src.width); c.getContext("2d").drawImage(src, 0, 0, c.width, c.height); return c.toDataURL("image/png");
}

G.V3D = { init, setSeaAz, frameTower, setContext, updateSite, showGhost, clearGhost, showDesign, clearDesign, showCone, clearCone, snapToFacade, resetView, topView, jumpIn, exitJump, on, showMassing, camAt, setYaw, setKey, turn, snapshot, COL, get state() { return T; } };
})(window);
