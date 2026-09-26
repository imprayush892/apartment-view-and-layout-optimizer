/* Build the panels file for an image-only critique round.
   node tools/study/build_panels.js <renderDir> <systems e.g. det,prob> <out.json> [nPanels=50] */
const fs = require("fs"), path = require("path"), DIR = path.join(__dirname, "..", "..", "data", "study");
const [renderDir, sysArg, out] = process.argv.slice(2), NP = +process.argv[5] || 50, systems = sysArg.split(",");
const archs = JSON.parse(fs.readFileSync(path.join(DIR, "architects.json"), "utf8")), blind = JSON.parse(fs.readFileSync(path.join(DIR, "blind.json"), "utf8"));
const CITY = { dadar: "Dadar, Mumbai (Arabian Sea to the west, Shivaji Park)", nyc_lower: "Lower Manhattan, New York (harbour and rivers, dense towers)", nyc_midtown: "Midtown Manhattan, New York (dense grid, supertall skyline)", ldn_city: "City of London (irregular medieval street pattern, the Thames to the south)", ldn_canary: "Canary Wharf, London (tower cluster, docks and the Thames around it)" };
const towerNote = a => { const r = JSON.parse(fs.readFileSync(path.join(DIR, "results", a.id + ".json"), "utf8")), n = systems.map(s => r[s] && r[s].towersUsed).filter(Boolean); return n.some(v => v < a.site.towers) ? ` Only ${[...new Set(n)].join(" or ")} tower(s) could stand at least 24 m apart on this plot, so the designs show that many.` : ""; };
const rows = [];
for (const a of archs) {
  const key = a.id + ":" + systems.join(","), order = blind[key]; if (!order) continue;
  const imgs = {}; order.forEach((s, i) => { const f = path.join(renderDir, `${a.id}_${s}.jpg`); if (fs.existsSync(f)) imgs["ABC"[i]] = f; });
  if (Object.keys(imgs).length < 2) continue;
  rows.push({ id: a.id, persona: { role: a.role, firm: a.firm, home: a.home, years: a.years, influences: a.influences, priorities: a.priorities, temperament: a.temperament },
    brief: `Site drawn in ${CITY[a.site.city]}; about ${Math.round(a.site.area)} m²; asked for ${a.site.towers} tower${a.site.towers > 1 ? "s" : ""}; height allowed about ${a.site.hmax} m.` + towerNote(a), images: imgs });
}
const panels = Array.from({ length: NP }, () => []); rows.forEach((r, i) => panels[i % NP].push(r));
fs.writeFileSync(out, JSON.stringify(panels.filter(p => p.length), null, 1));
console.log(rows.length, "architects in", panels.filter(p => p.length).length, "panels");
