/* 500 seeded architect personas, each with a randomly drawn site polygon and a tower count.
   node tools/study/architects.js [n] [seed] -> data/study/architects.json */
const C = require("./common.js"), fs = require("fs"), path = require("path");
const n = +process.argv[2] || 500, seed = +process.argv[3] || 2026, r = C.TOK.rng(seed), pick = a => a[Math.floor(r() * a.length)];
const ROLES = ["design principal", "senior associate", "project architect", "junior architect", "design director", "tall-buildings specialist", "residential architect", "urban designer-architect", "facade architect", "academic and practising architect"];
const FIRMS = ["large international practice", "mid-size local practice", "boutique design studio", "developer in-house team", "tall-building specialist firm", "housing-focused practice", "architecture school studio"];
const HOME = ["Mumbai", "Delhi", "Ahmedabad", "Bengaluru", "New York", "London", "Copenhagen", "Rotterdam", "Singapore", "Dubai", "Hong Kong", "Chicago", "Toronto", "Sydney", "Tokyo"];
const INFL = ["BIG / Bjarke Ingels", "Zaha Hadid Architects", "B.V. Doshi", "Charles Correa", "Sanjay Puri", "Studio Gang", "SOM", "KPF", "Foster + Partners", "Herzog & de Meuron", "Rafael Viñoly", "SHoP", "Moshe Safdie", "MVRDV", "Heatherwick Studio", "Hafeez Contractor", "Renzo Piano", "Jean Nouvel", "MAD Architects", "Rahul Mehrotra"];
const PRI = ["view equity for every flat", "privacy from neighbours", "sculptural identity on the skyline", "constructability and repetition", "climate response and shading", "street and public realm", "plan efficiency", "slenderness and proportion", "outdoor space per flat", "relationship to heritage and context"];
const TEMP = ["exacting and blunt", "generous but precise", "pragmatic", "idealistic", "commercially minded", "contextualist", "form-driven", "evidence-driven"];
const cities = C.available(), out = [];
for (let i = 0; out.length < n && i < n * 4; i++) {
  const city = cities[out.length % cities.length], site = C.randomSite(city, r); if (!site) continue;
  const maxT = Math.max(1, Math.min(4, Math.floor(site.area / 2200))), towers = 1 + Math.floor(r() * maxT); // what the plot can plausibly hold
  const infl = [pick(INFL)]; let b = pick(INFL); while (b === infl[0]) b = pick(INFL); infl.push(b);
  const pri = [pick(PRI)]; let q = pick(PRI); while (q === pri[0]) q = pick(PRI); pri.push(q);
  out.push({ id: `A${String(out.length + 1).padStart(3, "0")}`, role: pick(ROLES), firm: pick(FIRMS), home: pick(HOME), years: 3 + Math.floor(r() * 35), influences: infl, priorities: pri, temperament: pick(TEMP), site: { ...site, towers } });
}
const dir = path.join(__dirname, "..", "..", "data", "study"); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "architects.json"), JSON.stringify(out, null, 0));
const byCity = {}; out.forEach(a => byCity[a.site.city] = (byCity[a.site.city] || 0) + 1);
console.log(out.length, "architects", JSON.stringify(byCity), "towers", JSON.stringify(out.reduce((m, a) => (m[a.site.towers] = (m[a.site.towers] || 0) + 1, m), {})));
