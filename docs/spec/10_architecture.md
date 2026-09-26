# 10 — Software Architecture

## Pipeline
```
DXF / map pin ─► normalised geometry ─► envelope confirmation ─► context (GIS or synthetic)
      │                                                              │
      │                                              2.5-D raster scene (H, water, green, habitable)
      ▼                                                              ▼
  config + rules.yaml ─────────────► site view field (multi-height) ─► premium arc / opening height
                                                                     ▼
                         typology generators ─► plates, core, grid ─► units & rooms
                                                                     ▼
                              view evaluation per facade ─► classification ─► economics
                                                                     ▼
                                   hard-rule filter ─► Pareto sort ─► explainable report (JSON)
                                                                     ▼
                                                        viewer (Three.js) / CLI summary
```

## Minimum practical stack

| Layer | Choice | Why | Deliberately not used (yet) |
|---|---|---|---|
| Language | Python 3.11 | geometry + numeric ecosystem | – |
| 2-D geometry | **Shapely 2** | robust polygons, vectorised predicates | GeoPandas (only needed for GIS import, Phase 1b) |
| Numerics / rays | **NumPy** | raster ray-marching is vectorised and deterministic | PyVista / Open3D / trimesh — 2.5-D raster is sufficient for towers; true 3-D meshes are a later option for complex facades |
| DXF | **ezdxf** | pure Python, reads LWPOLYLINE/POLYLINE/HATCH, `$INSUNITS` | GDAL/OGR DXF driver (heavier install) |
| Config | **PyYAML** | human-editable configs & rule registry | – |
| CRS | local ENU (equirectangular about anchor) in v0; **pyproj** in Phase 1b | Mumbai-scale sites (< 5 km) → < 1 cm error | PostGIS — file-based until multi-user |
| GIS import (1b) | Overpass/OSM + Overture GeoParquet via `requests`/`pyarrow` | open data | – |
| API (Phase 6) | FastAPI | thin wrapper over the same functions | – |
| UI (Phase 6) | React + MapLibre GL (map pin, boundary edit, edge-click setbacks) + Three.js (massing, view-ray heatmaps) | web-native, no licence cost | Next.js SSR not needed initially |
| Optimisation | own deterministic enumeration + Pareto sort (NumPy) | explainable, reproducible | pymoo / NSGA-II (stochastic) — possible later with fixed seeds, reported separately |
| Tests | pytest | – | – |

## Package layout (`src/viewtower`)

| Module | Responsibility |
|---|---|
| `config.py` | load YAML config, merge rule overrides, canonical hash |
| `rules/registry.py` | load `rules.yaml`, lookup by id, record rule use |
| `geometry/dxf_io.py` | DXF read (layers, units, closed polylines) + synthetic DXF writer |
| `geometry/site.py` | Site, envelope from per-edge setbacks, north rotation, lat/lon anchor |
| `context/scene.py` | context buildings/water/parks/landmarks → raster scene |
| `view/engine.py` | ray-marching per observer × azimuth (vectorised) |
| `view/quality.py` | Q(θ), aperture integrals, site view field, premium arc |
| `typology/generators.py` | plate generators & modifiers |
| `typology/structure.py` | core sizing/placement, column grid, span |
| `units/subdivide.py` | unit wedges, room frontage assignment |
| `evaluation/classify.py` | view classes and reasons |
| `evaluation/economics.py` | rates, GDV, costs |
| `evaluation/metrics.py` | candidate metrics vector |
| `optimize/search.py` | enumeration, filtering, evaluation, provenance |
| `optimize/pareto.py` | non-dominated sorting, presentation order |
| `cli.py` | `viewtower run|site-view|make-synthetic` |

## Determinism contract
- no randomness; all iteration orders sorted; floats rounded to 1e-6 in hashes and outputs;
- candidate id = SHA-1 of canonical parameter JSON; run id = SHA-1(config + rules + data files).
