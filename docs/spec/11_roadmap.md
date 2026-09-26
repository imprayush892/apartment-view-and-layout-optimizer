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
- ⬜ 1b: location mode — OSM/Overture context fetch around a map pin (buildings, coastline, parks)
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

## Phase 5 — Economic model
- ✅ Carpet area, class multipliers, floor rise, size bands, GDV, cost, inventory risk
- ⬜ Calibrate with user-supplied (non-confidential) comparables

## Phase 6 — User interface
- ⬜ FastAPI service; React + MapLibre (pin, boundary edit, edge-click setbacks, view-corridor
  marking, height controls); Three.js massing + view heatmaps; metrics tables

## Phase 7 — Validation
- ✅ Tests: generator exactness (IoU), envelope, DXF round-trip, ray engine against analytic
  cases, classification, determinism
- ⬜ Compare generated typologies with precedents where public geometry allows (Cayan twist, 432 Park)
- ⬜ Edge cases: concave envelopes, envelopes smaller than min plate, no-water sites
