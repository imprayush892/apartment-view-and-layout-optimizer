# 09 — Multi-Objective Optimisation Formulation

Implementation: `src/viewtower/optimize/`.

## 1. Decision vector
`x = (τ, p_τ, c, ψ, h_f, n_pod, n_f, k, a, δ_core)`

| Symbol | Variable | Domain (config `search_space`) |
|---|---|---|
| τ | typology | categorical (04) |
| p_τ | typology parameters (w, d, wing length, twist, taper, …) | discrete lists |
| c | plate centre position | grid inside envelope (spacing `position_step_m`) or `centroid` |
| ψ | plan rotation | discrete list, deg |
| h_f | floor-to-floor height | list, m |
| n_pod | non-saleable lower floors (podium/stilt/amenity) | list |
| n_f | total floors | `auto` (= max allowed by height and FSI) or list |
| k | units per floor | list (1–4) |
| a | unit area shares | `equal_value` or `equal_area` |
| δ_core | core offset from plate centre, direction away from premium arc | list, m |

## 2. Feasible set
`F = { x : all hard rules hold }` — ENV-FSI-01, ENV-HEIGHT-01, ENV-ENVELOPE-01, GR-DEPTH-01,
GR-FRONT-LR-01, GR-FRONT-BR-01, GR-CORE-RATIO-01, GR-SPAN-01, GR-CANT-01, GR-PRIV-01.
Infeasible candidates are kept in `rejections` with the violated rule ids (explainability).

## 3. Objective vector (never pre-collapsed)
`f(x) = (f₁ … f₁₂)`:

| id | metric | sense |
|---|---|---|
| f₁ `saleable_carpet_m2` | Σ carpet | max |
| f₂ `premium_units` | count premium | max |
| f₃ `premium_bedrooms` | bedrooms with `w ≥ 0.2` | max |
| f₄ `living_view_mean` | mean `q_L` | max |
| f₅ `gdv_inr` | Σ value | max |
| f₆ `compromised_units` | C | min |
| f₇ `core_ratio` | core / plate | min |
| f₈ `structural_complexity` | 0.4·max-span/limit + 0.3·(1−repetition) + 0.3·slenderness/severe | min |
| f₉ `facade_complexity` | vertices per plate & distinct plates / floors | min |
| f₁₀ `efficiency` | carpet / plate gross | max |
| f₁₁ `constructability` | repetition × (1 − overhang/limit) | max |
| f₁₂ `privacy_mean` | 1 − mean P | max |

## 4. Solution procedure (deterministic)
1. **Enumerate** the Cartesian product of the discrete search space in a fixed, sorted order.
   Each candidate id = SHA-1 of its canonical JSON parameters (stable across runs/machines).
2. **Filter** by cheap hard rules first (envelope, height, FSI, depth, core ratio) before running
   the view engine.
3. **Evaluate** survivors (view, units, classes, economics).
4. **Pareto** — non-dominated sorting over a user-selected subset of objectives (default
   `gdv_inr↑, compromised_units↓, premium_units↑, efficiency↑, structural_complexity↓`).
   Rank 0 = Pareto front.
5. **Present** (not optimise) — within the front, sort by the user's ε-constrained priority list,
   default: `compromised_units == 0` first, then `gdv_inr` desc, then candidate id (tie-break).
6. **Refine (optional)** — deterministic pattern search around the best front members on the
   continuous parameters (step halving, fixed order of coordinates), stopping when no improvement
   in the lexicographic priority.

No random seeds are involved anywhere; re-running with the same config produces identical output
(checked by `tests/test_determinism.py`).

## 5. Explainability output
For every front candidate: parameters, all metrics, the hard rules it satisfied with slack, the
unit table with class reasons, and the provenance (config hash, rule registry hash, data-source ids).
