# 07 — Mathematical Definition of View Quality

Implementation: `src/viewtower/view/engine.py` (rays) and `src/viewtower/view/quality.py` (scores).
All defaults live in `configs/default.yaml → view:`.

## 1. Scene representation (2.5-D)
The context is rasterised on a regular grid of resolution `r` (default 2–4 m):

- `H(x, y)` — surface height above site datum (terrain + buildings, existing or future scenario);
- `M_water(x, y)`, `M_green(x, y)` — boolean masks of water and parks;
- `M_hab(x, y)` — cells belonging to habitable buildings (privacy).

The candidate tower's own plate is burned into `H` (as a prism to the tower top) so that wings
of Y/T/cross plans occlude each other (`GR-REENTRANT-01`).
Cells outside the raster are treated as `H = 0`, not water (conservative).

## 2. Ray profile
Observer `o = (x₀, y₀, z₀)`, eye at floor level + 1.5 m, 0.75 m outside the facade.
For azimuth `θ` (clockwise from north), direction `u(θ) = (sin θ, cos θ)`. Samples at distances

`d₀ = 1 m,  d_{k+1} = d_k + max(r/2, ρ·d_k)` up to `R` (default `R = 3000 m`, `ρ = 0.01`).

Elevation angle of the surface at sample `k`: `e_k = atan2(H(p_k) − z₀, d_k)`.
Running horizon: `h_k = max_{j<k} e_j` (with `h₀ = −90°`). Sample `k` is **visible** iff `e_k ≥ h_k`.

Per-azimuth variables:

| Variable | Definition |
|---|---|
| `horizon_angle` α(θ) | `max(0, max_k e_k)` |
| `distance_to_obstruction` d_obs(θ) | `min{ d_k : H(p_k) > z₀ }`, else `R` |
| `obstruction_height` | `H` at that sample |
| `sky_openness` S(θ) | `1 − sin α(θ)` (fraction of the vertical sky half-plane open above the horizon line) |
| `water_visibility` W(θ) | `min(1, Δβ_water(θ) / β_ref)` with `Δβ_water = Σ_k 1[water_k ∧ visible_k]·|e_k − e_{k+1}|` — the visible **depression-angle span** subtended by water; `β_ref` default 1.0° |
| `green_visibility` G(θ) | same as W with `M_green` |
| `landmark_visibility` L(θ) | `Σ_j w_j·1[landmark j visible]` for landmarks within ±`δ` (default 3°) of θ; a landmark is visible if its top's elevation angle ≥ running horizon at its distance |
| `corridor` C(θ) | user-marked view corridors: `w_c` if θ ∈ [θ₁, θ₂] and d_obs(θ) ≥ `corridor_min_distance` |
| `distance_score` D(θ) | `ln(1 + d_obs/d₀)/ln(1 + R/d₀)`, `d₀ = 50 m` |
| `privacy_penalty` P(θ) | `1 − d_obs/d_priv` if the first obstruction is habitable and `d_obs < d_priv` (default 30 m), else 0 |

Why depression-angle span for water: it is continuous, grows with height and proximity, is 0 when
the sea is hidden, and saturates once a meaningful band of sea is visible (β_ref). It also makes
elevation-dependence explicit: the same azimuth scores differently at 0, 25, 50, 75, 100 m.

## 3. Directional quality
`Q(θ) = clamp( w_W·W + w_D·D + w_S·S + w_G·G + w_L·L + w_C·C − w_P·P , 0, 1 )`

Default weights (commercial, configurable): `w_W = 0.45, w_D = 0.20, w_S = 0.15, w_G = 0.10,
w_L = 0.10, w_C = 0.0, w_P = 0.30`. Positive weights are normalised to sum to 1.

Every component is stored separately, so a design's score can always be decomposed
("living room is good because W = 0.9 over 70° of its FOV").

## 4. Aperture / room quality
A facade point with outward normal azimuth `n` sees azimuths within `|θ − n| ≤ φ` (default
`φ = 75°`). Directional contributions are weighted by the cosine of the incidence angle
(foreshortening of the window opening):

`A(n) = ∫ Q(θ)·cos(θ−n) dθ / ∫ cos(θ−n) dθ`, over `|θ − n| ≤ φ`.

Likewise `water_fraction = ∫ W·cos / ∫ cos`, `sky_fraction`, etc.
*Planned (not applied in v0.1):* perimeter structure and balcony slabs reduce the aperture, `A_eff = A·(1 − column_occlusion)` (GR-EXO-01) and a sill occlusion angle (GR-BALC-01).

A **room**'s score is the mean of `A` over observers sampled along its assigned frontage
(spacing `observer_spacing_m`, default 3 m).

## 5. Site-level view field (before massing)
For each analysis height `z ∈ view.heights` (default 0, 25, 50, 75, 100 m) and each grid point
inside the envelope (spacing default 10 m), compute the full 360° profile. Outputs:

- **view rose** per height — mean and max of each variable by azimuth;
- **premium arc** — maximal contiguous azimuth interval where mean `W(θ) ≥ 0.5` at the top
  analysis height (inferred view directions; the user can override by marking corridors);
- **opening height** — lowest analysed `z` at which the premium arc's mean `W` exceeds
  `GR-PODIUM-01` (suggests where residences should start).

## 6. Seasonal / time effects (v0: reported, not scored)
Monsoon haze is modelled optionally as `R_eff = min(R, visibility_km·1000)`. Solar exposure of
the premium (often west-facing, for Mumbai) facade is reported via azimuth only.
