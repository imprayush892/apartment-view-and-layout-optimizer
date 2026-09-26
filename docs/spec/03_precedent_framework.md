# 03 — Precedent-Study Framework

Goal: infer **reusable geometric and planning rules**, not copy buildings.
Dataset: `data/precedents/precedents.yaml`, schema `data/precedents/schema.json`.

## 1. Selection criteria
A building enters the dataset if it is residential-led **and** at least one of:
view-driven orientation, slenderness (H/B ≥ 8), rotation/twist, terracing, low units per floor
for view reasons, or a published statement that geometry was shaped by views.
Coverage targets: Mumbai, other Indian cities (Ahmedabad), New York, Miami, Dubai, Singapore,
Hong Kong, London, Paris, others (e.g. Chicago).

## 2. Extraction protocol (per building)
1. Collect ≥ 2 independent public sources (architect/engineer page + CTBUH/Wikipedia/press).
2. Record only stated facts; numeric values need a source in `field_sources`.
3. Unknown fields stay `null`. Estimated values are allowed **only** in `reproducible_parameters`
   and must be marked `"~"` with a note.
4. Fill the qualitative fields (view strategy, why geometry helps, remaining compromises).
5. Map each insight to a rule id in `data/rules/rules.yaml` (create a new rule if needed, with
   confidence and source).
6. Set `reproduction_confidence`:
   - **high** — plate dimensions, floors, heights, core and rotation all public → the generator can
     reproduce the parameterised geometry to ≥ 99 % IoU.
   - **medium** — the generative idea is fully specified (e.g. Cayan: identical plates, 1.2°/floor),
     but plate dimensions are estimated.
   - **low** — typology known, dimensions unknown.
   - **not_reproducible** — insufficient public geometry.

## 3. Current dataset (v0, 15 buildings)

| ID | Building | City | Typology | Key rule(s) extracted | Repro. |
|---|---|---|---|---|---|
| P-NYC-432PARK | 432 Park Ave | New York | square, slender | GR-SLEND-01, GR-CORNER-01 | medium |
| P-NYC-111W57 | 111 W 57th | New York | slender, terraced | GR-SLEND-01, GR-TERRACE-01 | low |
| P-MUM-WORLDONE | World One | Mumbai | cloverleaf, tiered | GR-TIER-01, GR-LOBE-01 | low |
| P-MUM-ALTAMOUNT | Lodha Altamount | Mumbai | slender, 1 unit/floor | GR-UNITS-01 | n/r |
| P-MUM-360WEST | Three Sixty West | Mumbai | podium + tower | GR-PODIUM-01 | n/r |
| P-DXB-CAYAN | Cayan Tower | Dubai | twisted | GR-TWIST-01, GR-REPEAT-01 | medium |
| P-DXB-BURJ | Burj Khalifa | Dubai | Y, spiral setbacks | GR-WING-01, GR-REENTRANT-01 | low |
| P-MIA-1000MUSEUM | One Thousand Museum | Miami | square, exoskeleton | GR-EXO-01, GR-UNITS-01 | low |
| P-HK-OPUS | Opus | Hong Kong | 1 unit/floor | GR-UNITS-01 | n/r |
| P-SG-INTERLACE | The Interlace | Singapore | stacked blocks | GR-PRIV-01 | n/r |
| P-SG-KEPPEL | Reflections at Keppel Bay | Singapore | curved | GR-GAP-01 | n/r |
| P-SG-WALLICH | Wallich Residence | Singapore | residences on top | GR-PODIUM-01 | n/r |
| P-LDN-ONEHYDEPARK | One Hyde Park | London | pavilions, external cores | GR-CORE-EXT-01 | n/r |
| P-PAR-TRIANGLE | Tour Triangle | Paris | triangular, terraced | GR-TERRACE-01 | low |
| P-CHI-AQUA | Aqua | Chicago | undulating slab edges | GR-BALC-01, GR-GAP-01 | n/r |

**Research gap:** Ahmedabad — no view-driven tower with enough public geometry was found in this
pass. Next step: search architect portfolios and project RERA filings (Gujarat RERA publishes
approved plans for registered projects) for floor plates.

## 4. Cross-precedent rule synthesis
1. **View is allocated either horizontally or vertically.** When the premium arc is narrower than
   the facade length a floor needs, successful projects reduce units per floor (Altamount,
   Opus, 1000 Museum, 111 W 57th) rather than accept compromised units → `GR-UNITS-01`.
2. **Small plate + central core** (432 Park, Cayan) gives every unit ≥ 2 orientations; cost is
   slenderness and core ratio → `GR-SLEND-01`, `GR-CORE-RATIO-01`.
3. **Rotate the plate, not the rooms** (Cayan, Interlace): rotation redistributes the premium
   direction while keeping layouts repetitive → `GR-TWIST-01`, `GR-REPEAT-01`.
4. **Wings/lobes** add facade per area and give each wing its own sector, but create re-entrant
   overlooking → `GR-WING-01`, `GR-REENTRANT-01`.
5. **Lift residences above context** with non-view programme below (Wallich, 360 West) → `GR-PODIUM-01`.
6. **Terraces face the view** (111 W 57th, Triangle) → `GR-TERRACE-01`.
7. **Cheap per-floor variation lives in the slab edge** (Aqua) → `GR-BALC-01`.
