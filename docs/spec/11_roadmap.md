# 11 — Phased Implementation Roadmap

Status: ✅ done in this repository (v0.1) · 🟡 partial · ⬜ not started

## Phase 0 — Research
- ✅ Requirements matrix (01), data dictionary (02), data-source registry, precedent framework (03)
- ✅ Precedent dataset v0 (15 buildings; facts only, unknowns null)
- ✅ Scope decision: statutory rules out of scope; user supplies FSI area, max height, envelope (06)
- ⬜ Ahmedabad precedents (gap), dimensioned luxury floor-plan survey (Mumbai) for frontage rules
- ⬜ Validate `low`-confidence rule defaults with the design team

## Phase 1 — Geometry
- ✅ DXF ingestion (closed polylines by layer, `$INSUNITS` scaling), synthetic DXF writer
- ✅ Envelope from per-edge setbacks; north rotation; local ENU frame
- ✅ 1b: location mode — live Overpass fetch around a map pin / geocoded place (hosted web app); bundled Dadar snapshot + file upload in the artifact preview
- ✅ Georeferencing: WGS84 anchor + local ENU grid; DXF by reference point + true north, or UTM zone/hemisphere
- 🟡 Boundary confirmation + per-edge setbacks: interactive CLI prompt (`viewtower inspect-dxf`) and config; click-a-side UI in Phase 6

## Phase 2 — View engine
- ✅ Raster 2.5-D scene; vectorised ray marching; per-azimuth variables
- ✅ Multi-height site view field, view rose, inferred premium arc, opening height
- 🟡 Landmarks & user corridors (implemented; UI marking pending)
- ✅ Future-scenario re-check of the Pareto front (`compromised_units_future`)
- ⬜ Terrain from DEM; balcony/column aperture occlusion (GR-BALC-01, GR-EXO-01)

## Phase 3 — Typology engine
- ✅ Generators: rectangular, square, slender, rotated, diamond, triangular, chamfered, Y, T, cross,
  curved (superellipse), terraced, tapered, twisted, podium + tower
- ✅ Core placement (+ offset away from premium arc), perimeter column grid, span check
- ✅ Unit wedges (equal-value / equal-area) and room frontage assignment
- ⬜ Room-level polygons (internal walls), duplex units, private-lift lobbies geometry

## Phase 4 — Optimisation
- ✅ Deterministic enumeration, hard-rule filter with reasons, Pareto sort, presentation order
- ⬜ Deterministic pattern-search refinement
- ✅ Ranking on value minus construction cost (height-band cost factors); adaptive view-check refinement

## Phase 5 — Economic model
- ✅ Carpet area, class multipliers, floor rise, size bands, GDV, cost, inventory risk
- ✅ Continuous view-price multiplier; economics card (land, soft, sales costs, margin, residual land value, sensitivity)
- ⬜ Calibrate with user-supplied (non-confidential) comparables / registrations (hedonic regression, 12 §5)
- ⬜ Absorption / sales-velocity and NPV; continuous size-price elasticity

## Phase 6 — User interface
- ✅ Static web app `web/` (no build step): map pin + place search, DXF upload with georeferencing, draw-on-plan, edge-click setbacks, 3D OSM city model, parallel Web-Worker search with live massings, click-a-floor view cones + floor-by-floor sea chart, first-person jump-in, ranked options, floor plans, unit tables
- ✅ GitHub Pages workflow
- ✅ Exports: board pack HTML, units CSV, CAD zip (DXF + OBJ), scenario JSON, share link; presenter mode; phone layout; plain-language verdict and reliability badges
- ⬜ View-corridor marking UI, landmark picking, per-option comparison view, IFC/GLB export, sun/shadow study

## Phase 7 — Validation
- ✅ Tests: generator exactness (IoU), envelope, DXF round-trip, ray engine against analytic
  cases, classification, determinism
- ⬜ Compare generated typologies with precedents where public geometry allows (Cayan twist, 432 Park)
- ✅ Robustness audit (fuzzed 728 geometry candidates, invalid inputs, concave plots) and fixes, see 12 §4
- ✅ Two rounds of persona usability testing with A/B tests, see 12 §6
- ⬜ Ground-truth view photos / buyer labels at known points (view feedback capture is in place)
- ⬜ Height fusion (Google Open Buildings 2.5D, Overture, GHSL) and building coverage to 3 km
