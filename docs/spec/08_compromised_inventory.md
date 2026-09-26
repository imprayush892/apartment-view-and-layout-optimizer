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

Defaults below are the **web engine v0.2** values (`web/js/engine.js`, calibrated on Dadar test plots,
see 12 §3). The Python reference package still uses the v0.1 values in brackets.

**Compromised** if any of
- `q_L < q_lr_min` (default 0.25) — poor overall outlook from the main room;
- `d̃_L < d_min` (default 100 m [40]) — living room looks at a nearby obstruction (`d̃_L` is the 25th percentile over the FOV [median]);
- `α̃_L > α_max` (default 10° [30°]) — living room outlook dominated by a tall skyline (`α̃_L` is the 75th percentile [median]);
- `P_u > p_max` (default 0.35 [0.5]) — overlooked by habitable windows of *neighbouring* buildings
  (the tower's own wings are not neighbours for this rule).

**Premium** if not compromised and
- `w_L ≥ 0.45` [0.35] and `q_L ≥ 0.60` [0.55], with the sea reference band `β_ref = 5°` [1°] (07), and
- at least half the bedrooms have `w_{Bi} ≥ 0.30` [2 bedrooms with `w ≥ 0.20`] — reference brief: sea
  from living **and** bedrooms.

**Good** if not compromised/premium and `q_L ≥ 0.40`. (Optional, off by default: also good when the
nearest obstruction is ≥ 500 m and the horizon < 2°, i.e. a long open outlook without sea. It is off
because rays beyond the loaded building data look falsely open.)

**Neutral** otherwise.

Resulting premium share for the same towers (square and Y, 2–3 units/floor) on Dadar plots:
seafront 75 % (v0.1: 100 %), ~300 m inland 49 % (52 %), ~600 m 24 % (34 %), ~900 m 10 % (17 %).

### Price multiplier
Web default is **continuous** in living-room quality: `m = clip(0.655 + 0.69·q_L, 0.80, 1.20)`, with
compromised units at 0.75 (line through the class medians of `q_L` against 0.90 / 1.00 / 1.15). With the
class step (1.15 / 1.00 / 0.90 / 0.75), 24 % of unit pairs whose `q_L` differs by < 0.02 land in different
classes (mean price jump 3.6 % vs 0.4 % continuous). The class remains the label; pricing follows the view.

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

The app shows a badge "zero compromised is easy on this site" when every option has 0 compromised
units and the smallest `min_margin` exceeds 0.2: the ε-constraint is then not binding and options
should be compared on premium share and value.

## 4. Inventory risk
`inventory_risk = (Σ value of neutral + compromised units) / GDV` — the share of revenue that is
in hard-to-sell stock.
