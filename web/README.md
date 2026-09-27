# Viewtower Studio (web app)

Static, build-free web app: `index.html` + `js/` + `data/`. The same files run as the claude.ai
artifact preview and on any static host (GitHub Pages workflow in `.github/workflows/pages.yml`).

| File | Role |
|---|---|
| `js/engine.js` | JavaScript port of `src/viewtower` (rays, typologies, units, classes, economics, Pareto). No DOM, no libraries — also runs inside Web Workers. |
| `js/worker.js` | Parallel search worker (hard rules → streamed massing → view evaluation). |
| `js/geo.js` | Georeferencing (lat/lon anchor, UTM), OSM parsing (Overpass JSON, GeoJSON, bundled snapshot), sea traced from coastlines, raster scene. |
| `js/view3d.js` | three.js city model, live search massings, view cones, first-person jump-in. |
| `js/app.js` | UI: inputs, envelope, search orchestration, map, options, design detail. |
| `js/extras.js` | Verdict and reliability badges, exports (board pack HTML, units CSV, CAD zip with DXF + OBJ), scenario save/load/share link, economics and sensitivity, building-height uncertainty test, presenter mode, first-person controls, sortable tables. |
| `js/tokens.js` | Typology tokens: 540-typology library, facade-segment features, open ridge model, rule score (deterministic), cross-entropy generator (probabilistic / hybrid), appeal model. See `docs/spec/13_typology_tokens.md`. |
| `data/dadar_osm.json` | OpenStreetMap snapshot (© OpenStreetMap contributors, ODbL) around Shivaji Park, Dadar, fetched 2026-09-26 via Overpass. |
| `data/nyc_lower_osm.json`, `data/nyc_midtown_osm.json`, `data/ldn_city_osm.json`, `data/ldn_canary_osm.json` | OpenStreetMap snapshots (© OpenStreetMap contributors, ODbL) of Lower Manhattan, Midtown, the City of London and Canary Wharf, fetched 2026-09-26 via Overpass (buildings, building parts, water, parks, landmarks). Dense-city profile: the skyline counts as a view. |
| `data/typology_model.json` | Open weights of the facade-segment view model (ridge; 51,898 segments, held-out R² 0.72 for quality). |
| `data/appeal_model.json`, `data/hybrid_weights.json` | Weights learned from the 500-architect image-only study (`docs/spec/14_architect_study.md`). |

**Live data.** On a normal host, "Pin anywhere" fetches buildings, streets, parks, water and
coastline from Overpass (with mirror fallback), geocodes with Nominatim and shows OSM map tiles.
The claude.ai preview blocks outside connections, so there it offers the bundled snapshot and file
upload (Overpass JSON / GeoJSON export) instead.

**Local run.** `cd web && python3 -m http.server` then open http://localhost:8000 (a server is
needed for Web Workers and `fetch`; the page adds its own document skeleton when published as an
artifact, and the Pages workflow adds one for hosting).

**Georeferencing.** Everything is computed in a local metre grid (x east, y north) about a WGS84
anchor. DXF sites are placed either by a reference point (drawing X/Y → lat/lon) plus a true-north
angle, or read directly as UTM easting/northing (zone + hemisphere).

**Height data.** OSM `height`, else `building:levels × 3.2 m`, else a per-type estimate (shown
lighter in 3D and counted in the context summary). In Dadar about 93 % of buildings have estimated
heights. Estimates are calibrated against the tagged buildings nearby (Dadar ×1.33 from 97 tagged),
the verdict shows a reliability badge for the buildings in the sea-view directions, and the Design tab
can re-run the selected tower with estimated heights ×0.75 and ×1.5. Upload better data or set
"Unknown heights" when you know the local norm.

**Exports and sharing.** Board pack (one HTML page with a 3D snapshot, flat mix, economics, height
test and assumptions; print it to PDF), units CSV (with an assumptions header), CAD massing zip (R12
DXF of floor plates, cores and units by class + OBJ massing with context within 600 m), scenario JSON
(inputs, site, results, per-flat features and view feedback) and a share link (`#s=…`) that reopens
the same site, envelope and inputs. `#present` opens presenter mode. In the claude.ai preview files are
offered through the viewer's download prompt; on a normal host they download directly.

**View feedback.** On any view cone, "Looks right / Not right" (+ note) records the predicted sea share
and quality with the location, height and direction. It stays in the browser (localStorage) and is
included in saved scenarios, to calibrate the view model against what people actually see.

**Cities and money.** Each bundled city sets its own currency (₹ crore, $M, £M), a city-typical
FSI and height limit and its view rules (coastal: sea view; dense: skyline view, closer neighbours
tolerated). Prices and costs are placeholders for comparing options, not market figures.

**Search methods.** Hand-set (the original generator), Library (deterministic rule screening of 540
typologies), Generative (probabilistic token generator scored by the open model) and Hybrid (the
generator re-weighted by the architect study and seeded with the library winner). All finish with the
same full ray-cast evaluation. Sites can hold 1–4 towers, at least 24 m apart and splayed so they do
not face each other.

**Headless harness.** `node tools/harness.js '<json>'` runs the same engine in Node for experiments
(see `DEFAULTS` in the file; `returnEvs`, `refine`, `thresholds`, `rates` are supported).
