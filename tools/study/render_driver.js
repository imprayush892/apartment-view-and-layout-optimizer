/* Render every architect's designs to images (blind labels). Needs playwright-core (NODE_PATH) and the
   local site served at http://localhost:8765 with render.html, js/, data/ and lib/.
   node tools/study/render_driver.js <systems e.g. det,prob> <outDir> [limit] */
const { chromium } = require("playwright-core"), fs = require("fs"), path = require("path");
const DIR = path.join(__dirname, "..", "..", "data", "study"), systems = (process.argv[2] || "det,prob").split(","), OUT = process.argv[3], limit = +process.argv[4] || 1e9, shard = process.argv[5] ? process.argv[5].split("/").map(Number) : [0, 1];
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } }); p.on("pageerror", e => console.error("pageerror", e.message));
  await p.goto("http://localhost:8765/render.html"); await p.waitForFunction(() => window.READY);
  const archs = JSON.parse(fs.readFileSync(path.join(DIR, "architects.json"), "utf8")).slice(0, limit).filter((_, i) => i % shard[1] === shard[0]).sort((a, c) => a.site.city < c.site.city ? -1 : 1);
  const WIN1 = fs.existsSync(path.join(DIR, "win1.json")) ? JSON.parse(fs.readFileSync(path.join(DIR, "win1.json"), "utf8")) : {};
  const blind = fs.existsSync(path.join(DIR, "blind.json")) ? JSON.parse(fs.readFileSync(path.join(DIR, "blind.json"), "utf8")) : {};
  let n = 0; const t0 = Date.now();
  for (const a of archs) {
    const f = path.join(DIR, "results", a.id + ".json"); if (!fs.existsSync(f)) continue; const res = JSON.parse(fs.readFileSync(f, "utf8"));
    const sysRes = s => s === "win1" ? res[WIN1[a.id]] : res[s], avail = systems.filter(s => sysRes(s) && sysRes(s).best); if (!avail.length) continue;
    // blind order: stable pseudo-random per architect
    const key = a.id + ":" + systems.join(","); if (!blind[key]) { const h = ([...key].reduce((x, c) => Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261) >>> 7) & 1; blind[key] = h ? systems.slice().reverse() : systems.slice(); }
    await p.evaluate(c => R.load(c), a.site.city);
    for (const s of avail) {
      const out = path.join(OUT, `${a.id}_${s}.jpg`); if (fs.existsSync(out)) continue;
      const label = "Design " + "ABC"[blind[key].indexOf(s)];
      const url = await p.evaluate(async ({ a, towers, viewAz, label }) => { const env = GEO.envelopeFromSetbacks(a.site.ring, a.site.setbacks, polygonClipping); return R.render({ ring: a.site.ring, env, towers, viewAz, label }); }, { a, towers: sysRes(s).best.towers, viewAz: res.site.viewAz, label });
      fs.writeFileSync(out, Buffer.from(url.split(",")[1], "base64")); n++;
    }
    if (n % 20 === 0) console.error(`${n} renders, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
  fs.writeFileSync(path.join(DIR, shard[1] > 1 ? `blind_${shard[0]}.json` : "blind.json"), JSON.stringify(blind));
  console.error("rendered", n, "in", ((Date.now() - t0) / 60000).toFixed(1), "min"); await b.close();
})();
