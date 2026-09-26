# 05 — Geometric & Planning Rules

The machine-readable registry is `data/rules/rules.yaml`. This page explains how the rules are
used and lists the ones still to be extracted.

## 1. Rule classes
- **Hard** — feasibility filter. A candidate violating any hard rule is rejected and the output
  lists the violated rule ids (`rejections.json`).
- **Soft** — reported as metrics/penalties; never silently folded into a single score.
- **Commercial** — thresholds and multipliers for view classes and pricing.

Each rule has: `definition`, `inputs`, `formula`, `source`, `confidence`, `configurable`, `default`.

## 2. Rules in v0

| ID | Kind | Summary | Default | Confidence |
|---|---|---|---|---|
| ENV-FSI-01 | hard | Σ saleable plate area ≤ user FSI area | user | high |
| ENV-HEIGHT-01 | hard | height ≤ user max | user | high |
| ENV-ENVELOPE-01 | hard | plates inside buildable envelope | – | high |
| GR-DEPTH-01 | hard | core-to-facade ≤ 13.5 m | 13.5 | medium |
| GR-DEPTH-02 | soft | core-to-facade ≥ 6 m | 6.0 | medium |
| GR-FRONT-LR-01 | hard | living frontage ≥ 6 m | 6.0 | low |
| GR-FRONT-BR-01 | hard | bedroom frontage ≥ 3.6 m | 3.6 | low |
| GR-CORE-RATIO-01 | hard | 8 % ≤ core/plate ≤ 35 % | – | low |
| GR-SPAN-01 | hard | span ≤ 12 m | 12 | medium |
| GR-CANT-01 | hard | overhang ≤ 3 m | 3 | low |
| GR-SLEND-01 | soft | H/B warn 8, severe 12 | – | medium |
| GR-TWIST-01 | soft | twist ≤ 1.5°/floor | 1.5 | high (Cayan 1.2) |
| GR-WING-01 | soft | wing separation ≥ 90° | 90 | medium |
| GR-PRIV-01 | hard | facing distance ≥ 18 m | 18 | low |
| GR-PODIUM-01 | soft | residences start where water view opens | 0.5 | medium |
| GR-UNITS-01 | commercial | units/floor bounded by premium frontage | – | medium |
| VC-* | commercial | view-class thresholds (see 08) | – | n/a |

## 3. Unit subdivision rule (deterministic)
1. Compute facade view score `S(s)` along the plate perimeter parameter `s ∈ [0, P)` at the
   evaluation height (07 §4).
2. Rotate the perimeter start so that `s = 0` is the **lowest-score** point (units split in the
   worst place, never through the middle of the premium arc).
3. For `n` units with target shares `a_i` (Σ = 1), place cut points so each unit receives a
   share of **view-weighted frontage** `∫ S(s) ds` equal to `a_i` (equal-value split) —
   configurable alternative `equal_area`.
4. Each unit polygon = (plate − core) ∩ wedge from core centroid through its two cut points.
5. Within a unit, rooms are assigned to facade frontage greedily: living room takes the best
   contiguous `GR-FRONT-LR-01` window, then bedrooms by descending score, kitchen/service the rest.

## 4. Rules still to extract (open)
- Minimum window angle toward premium view (needs a survey of luxury Mumbai floor plans).
- Maximum number of units sharing a compromised view on one floor (commercial input).
- Balcony depth vs. downward sea visibility (GR-BALC-01 default is 0 until validated).
- Precedent-derived core ratios by height band (needs dimensioned plans).
