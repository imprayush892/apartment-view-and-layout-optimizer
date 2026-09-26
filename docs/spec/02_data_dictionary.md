# 02 — Data Dictionary

All lengths in **metres**, areas in **m²** internally (ft² only at the economic reporting layer,
1 m² = 10.7639 ft²), angles in **degrees**, azimuths measured **clockwise from true north**
(0° = N, 90° = E, 180° = S, 270° = W). Local frame is ENU: `x` = east, `y` = north, `z` = up
above site datum (ground level at site origin). Every derived quantity carries a
`provenance` record: `{source_id, method, assumption_ids, confidence}`.

## Core entities

### Site
| Field | Type | Unit | Description |
|---|---|---|---|
| `site_id` | str | – | Stable identifier |
| `boundary` | Polygon | m (local) | Plot boundary in local ENU frame |
| `anchor_latlon` | (float, float) | deg | WGS84 lat/lon of local origin |
| `crs_epsg` | int | – | Projected CRS used for GIS import (e.g. 32643) |
| `north_angle_deg` | float | deg | Rotation from drawing +Y to true north (clockwise positive) |
| `datum_amsl_m` | float | m | Ground level above mean sea level at origin |
| `boundary_is_envelope` | bool | – | Answer to "Is this the buildable envelope?" |
| `edge_setbacks_m` | list[float] | m | One per boundary edge (only when `boundary_is_envelope` is false) |
| `envelope` | Polygon | m | Buildable envelope (given, or boundary offset inward per edge) |

### DevelopmentLimits (user-supplied; no statutory rules are modelled)
| Field | Type | Unit | Description |
|---|---|---|---|
| `max_fsi_area_m2` | float | m² | Total consumable FSI / built-up area |
| `max_height_m` | float | m | Maximum building height |
| `reserved_levels` | list[int] | – | Optional non-saleable floors |

### ContextBuilding
| Field | Type | Unit | Description |
|---|---|---|---|
| `id` | str | – | |
| `footprint` | Polygon | m | |
| `base_z` | float | m | Base above site datum |
| `height_m` | float | m | Height above base |
| `height_source` | enum | – | `survey` / `osm_height` / `osm_levels_x3` / `overture` / `assumed` |
| `scenario` | enum | – | `existing` / `future` |
| `is_habitable` | bool | – | Used for privacy scoring |

### WaterBody / Landmark
| Field | Type | Unit | Description |
|---|---|---|---|
| `polygon` | Polygon | m | Water extent (sea, lake, river) |
| `kind` | enum | – | `sea`, `lake`, `river`, `park` (parks treated as low open "green view") |
| `landmark.position` | (x, y, z) | m | Landmark reference point (top) |
| `landmark.weight` | float | – | Commercial importance 0–1 |

### ViewSample (per observer, per azimuth)
| Field | Type | Unit | Definition |
|---|---|---|---|
| `azimuth_deg` | float | deg | θ |
| `horizon_angle_deg` | float | deg | α_h(θ) = max_k atan((h_k − z)/d_k), 0 if none above eye |
| `distance_to_obstruction_m` | float | m | d_obs(θ): first d where terrain/building height > z (∞ → `r_max`) |
| `obstruction_height_m` | float | m | Height of that first obstruction |
| `sky_openness` | float | 0–1 | 1 − sin(max(α_h, 0)) |
| `water_visibility` | float | 0–1 | Visible water depression-angle span ÷ reference span (see 07) |
| `green_visibility` | float | 0–1 | Same as water for `park` polygons |
| `landmark_visibility` | float | 0–1 | Σ weights of landmarks visible in this azimuth bin |
| `privacy_penalty` | float | 0–1 | Proximity of habitable facade within d_priv |
| `distance_score` | float | 0–1 | log-scaled d_obs |
| `quality` | float | 0–1 | Q(θ) — weighted combination (07 §3) |

### Observer
| Field | Type | Unit | Description |
|---|---|---|---|
| `position` | (x, y, z) | m | Eye point (floor level + 1.5 m) offset 0.75 m outside facade |
| `normal_deg` | float | deg | Facade outward normal azimuth |
| `fov_deg` | float | deg | Half-angle horizontal field of view (default 75) |

### Candidate (massing)
| Field | Type | Unit | Description |
|---|---|---|---|
| `candidate_id` | str | – | Deterministic hash of parameters |
| `typology` | enum | – | See 04_typology_taxonomy |
| `params` | dict | – | Typology parameters |
| `position` | (x, y) | m | Plate centroid |
| `rotation_deg` | float | deg | Plan rotation (clockwise from north) |
| `floor_to_floor_m` | float | m | |
| `n_floors` | int | – | Total floors (podium + tower) |
| `podium_floors` | int | – | |

### FloorPlate / Core / Grid
| Field | Type | Unit | Description |
|---|---|---|---|
| `level` | int | – | Floor index (0 = ground) |
| `z` | float | m | Finished floor level |
| `outline` | Polygon | m | Slab edge |
| `core` | Polygon | m | Core outline |
| `columns` | list[Point] | m | Column centres |
| `is_reserved` | bool | – | User-reserved non-saleable level |
| `lease_depth_max_m` | float | m | Max core-to-facade distance |

### Unit
| Field | Type | Unit | Description |
|---|---|---|---|
| `unit_id` | str | – | `L{level}-U{index}` |
| `outline` | Polygon | m | Apartment envelope |
| `carpet_m2` | float | m² | Envelope − walls (wall factor configurable) |
| `facade_segments` | list[FacadeSegment] | – | Exterior edges with normal and view score |
| `rooms` | list[RoomAssignment] | – | Room type → facade segment (frontage) allocation |
| `view_class` | enum | – | premium / good / neutral / compromised |
| `class_reasons` | list[str] | – | Rule IDs that determined the class |
| `rate_inr_per_ft2` | float | ₹/ft² | |
| `value_inr` | float | ₹ | |

### RoomAssignment
| Field | Type | Unit | Description |
|---|---|---|---|
| `room` | enum | – | `living`, `bed1..n`, `kitchen`, `service` |
| `frontage_m` | float | m | Assigned facade length |
| `view_score` | float | 0–1 | Aperture-weighted Q (07 §4) |
| `water_fraction` | float | 0–1 | Share of FOV with water visible |

### Metrics (per candidate)
See `09_optimization_formulation.md` — each is a named float with units and sense.

### Rule
| Field | Type | Description |
|---|---|---|
| `id` | str | e.g. `GR-FRONT-01` |
| `kind` | enum | `hard`, `soft`, `commercial` |
| `definition` | str | Plain-language |
| `inputs` | list[str] | Variable names |
| `formula` | str | Expression / logic |
| `source` | str | Registry ID or citation |
| `confidence` | enum | `high` / `medium` / `low` |
| `configurable` | bool | |
| `default` | any | |
