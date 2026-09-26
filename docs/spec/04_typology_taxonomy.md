# 04 — Typology Taxonomy

Each typology is a pure function `plate(level, params) -> Polygon` in a local frame centred on
the tower origin, then rotated by `rotation_deg` (clockwise from north) and translated to
`position`. All generators are deterministic; identical parameters → byte-identical geometry.
Implementation: `src/viewtower/typology/generators.py`.

| Typology | Parameters (besides width `w`, depth `d`) | Plate definition | Core default | Precedents |
|---|---|---|---|---|
| `rectangular` | – | axis-aligned `w × d` | central rectangle | generic |
| `square` | – | `w × w` | central square | 432 Park |
| `slender` | – | rectangle intended for `d ≤ 22 m` (floor-through units); not enforced | central | 111 W 57th |
| `rotated` | `rotation_deg` | rectangle rotated | central | Interlace |
| `diamond` | – | square rotated 45° in local frame (corners to cardinal axes) | central | – |
| `triangular` | `chamfer_m` | isosceles triangle of base `w`, height `d`, corners chamfered | central (centroid) | Tour Triangle |
| `chamfered` | `chamfer_m` | rectangle with 45° corner cuts | central | – |
| `y_shaped` | `wing_len`, `wing_w`(=d), `wing_angle=120°` | union of 3 wing rectangles about a hub | hexagonal hub core | Burj Khalifa |
| `t_shaped` | `wing_len`, `wing_w` | union of 3 wings at 0°, 90°, 270° | hub | – |
| `cross` | `wing_len`, `wing_w` | union of 4 wings at 90° | hub | World One (cloverleaf approx.) |
| `curved` | `exponent n` | superellipse `|x/a|ⁿ + |y/b|ⁿ = 1` (n=2 ellipse, n→∞ rectangle) | central | Keppel Bay, Opus |
| `terraced` | `step_every`, `step_m`, `step_side_deg` | rectangle whose edge on `step_side` retreats `step_m` every `step_every` floors | central, fixed | 111 W 57th |
| `tapered` | `top_scale` | base shape scaled linearly from 1 → `top_scale` | fixed | – |
| `twisted` | `twist_per_floor_deg` | base shape rotated `level × twist` about core centre | fixed cylinder/square | Cayan |
| `podium_tower` | `podium_floors`, `podium_w`, `podium_d` | podium rectangle below, any tower typology above | tower core | Three Sixty West, Wallich |

Composite rule: `twisted`, `tapered` and `terraced` are **modifiers** that can wrap any base
shape (`base: square|rectangular|curved|...`).

## Per-typology generation steps
1. Parameters validated (ranges in `configs/*.yaml` → `search_space`).
2. Plate per level.
3. Core placed (`core.center_offset` allows offset cores per GR-CORE-EXT-01); core size from
   `core.area_m2` or `lifts × lift_module + stairs × stair_module + shafts`.
4. Structural grid: perimeter columns every `grid.perimeter_spacing_m` along plate boundary,
   core walls; span = max distance from any column to nearest core/column support.
5. Apartment envelopes: plate − core split by rays from core centre (see 05 §Units).
6. Apertures: facade segments of habitable rooms (living, bedrooms) receive windows; kitchen/
   service take the lowest-scoring remaining frontage.
7–10. View, efficiency, economics: evaluation modules.

## Reproduction accuracy
Geometric reproduction is measured as IoU between the generated plate and a reference polygon.
For fully parameterised typologies the generator is exact (IoU = 1 − numerical tolerance, tested
in `tests/test_typology.py`). For real buildings, accuracy is **bounded by the public data**: see
`reproduction_confidence` in the precedent dataset. We do not claim 99 % for buildings whose
plate dimensions are not public.
