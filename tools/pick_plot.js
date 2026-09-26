/* Pick an illustrative test plot for a city snapshot: the footprint of an existing low building
   (2,000-4,500 m2, < 30 m) with the most open sea/skyline outlook at 100 m. Usage: node tools/pick_plot.js <key> */
const H = require("./harness.js"), { VT, GEO } = H, fs = require("fs"), path = require("path");
const key = process.argv[2], d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "data", key + "_osm.json"), "utf8"));
const ctx = GEO.fromCompact(d, d.anchor, {});
const cands = ctx.buildings.filter(b => b.base === 0 && b.height > 0 && b.height < 30 && b.hsrc !== "estimated").map(b => ({ b, a: VT.ringArea(b.ring), c: VT.centroid(b.ring) })).filter(o => o.a > 2000 && o.a < 4500 && Math.hypot(...o.c) < 900 && o.b.ring.length <= 12);
console.error(key, "candidates", cands.length);
const S = GEO.buildScene(ctx, [0, 0], 3000, 4), V = VT.viewSettings({ res: 4 }), tmp = {};
const scored = cands.slice(0, 400).map(o => { let s = 0; for (let az = 0; az < 360; az += 10) { VT.castRay(S, o.c[0], o.c[1], 100, az, V.D, V.P, null, tmp); s += tmp.prize; } return { ...o, s: s / 36 }; }).sort((a, b) => b.s - a.s);
const top = scored.slice(0, 5).map(o => ({ area: Math.round(o.a), h: o.b.height, prize100: +o.s.toFixed(3), centre: o.c.map(v => +v.toFixed(1)), ring: o.b.ring.map(p => p.map(v => +v.toFixed(1))) }));
console.log(JSON.stringify(top));
