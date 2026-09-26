# 08 — Mathematical Definition of Compromised Inventory

Implementation: `src/viewtower/evaluation/classify.py`. Thresholds: rule ids `VC-*` in
`data/rules/rules.yaml` (commercial, configurable).

## 1. Unit-level inputs
For unit `u` with living room `L` and bedrooms `B₁..B_m`:

| Symbol | Meaning |
|---|---|
| `q_L` | living-room aperture quality (07 §4) |
| `w_L` | living-room water fraction |
| `w_{Bi}` | bedroom `i` water fraction |
| `d̃_L` | median `d_obs(θ)` over the living-room FOV |
| `α̃_L` | median horizon angle over the living-room FOV |
| `P_u` | max aperture-weighted privacy penalty over all habitable rooms of `u` |

## 2. Classes (evaluated in this order)

**Compromised** if any of
- `q_L < q_lr_min` (default 0.25) — poor overall outlook from the main room;
- `d̃_L < d_min` (default 40 m) — living room looks at a nearby obstruction;
- `α̃_L > α_max` (default 30°) — living room outlook dominated by a tall obstruction;
- `P_u > p_max` (default 0.5) — overlooked by habitable windows closer than ≈ `d_priv/2`.

**Premium** if not compromised and
- `w_L ≥ 0.35` and `q_L ≥ 0.55`, and
- `#{i : w_{Bi} ≥ 0.20} ≥ min(n_min, m)` (default `n_min = 2`) — reference brief: sea from
  living **and** bedrooms.

**Good** if not compromised/premium and `q_L ≥ 0.40`.

**Neutral** otherwise.

Each unit records `class_reasons` (the rule ids and the measured values that decided its class),
e.g. `["VC-COMPROMISED:d_obs_median=22.4<40.0"]`.

## 3. "0 % compromised inventory"
`C = #{u : class(u) = compromised}` over all **saleable** units. The commercial objective is
`C = 0`, treated as an **ε-constraint** in ranking (09 §4), *not* as a claim that all units are
equal. Value dispersion is therefore reported explicitly:

- class distribution `(n_premium, n_good, n_neutral, n_compromised)`;
- `rate_cv` = coefficient of variation of ₹/ft² across units;
- `value_spread` = `(P90 − P10)/median` of unit rate;
- `min_margin` = smallest normalised slack of any unit to the compromised thresholds
  (robustness: how close the design is to having a compromised unit);
- `C_future` = compromised count re-evaluated with the **future** obstruction scenario
  (neighbouring plots built out as the user specifies).

A design is reported as "zero-compromise-robust" only if `C = 0` **and** `C_future = 0`.

## 4. Inventory risk
`inventory_risk = (Σ value of neutral + compromised units) / GDV` — the share of revenue that is
in hard-to-sell stock.
