# Viewtower Studio (web app)

Static, build-free web app: `index.html` + `js/` + `data/`. The same files run as the claude.ai
artifact preview and on any static host (GitHub Pages workflow in `.github/workflows/pages.yml`).

| File | Role |
|---|---|
| `js/engine.js` | JavaScript port of `src/viewtower` (rays, typologies, units, classes, economics, Pareto). No DOM, no libraries — also runs inside Web Workers. |
| `js/worker.js` | Parallel search worker (hard rules → streamed massing → view evaluation). |
| `js/geo.js` | Georeferencing (lat/lon anchor, UTM), OSM parsing (Overpass JSON, GeoJSON, bundled snapshot), sea traced from coastlines, raster scene. |
| `js/view3d.js` | three.js city model, live search massings, view cones, first-person jump-in. |
| `js/app.js` | UI. |
| `data/dadar_osm.json` | OpenStreetMap snapshot (© OpenStreetMap contributors, ODbL) around Shivaji Park, Dadar, fetched 2026-09-26 via Overpass. |

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
heights — upload better data or set "Unknown heights" when you know the local norm.
