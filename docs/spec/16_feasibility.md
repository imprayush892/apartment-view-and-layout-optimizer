# 16 — FSI feasibility: cruciform towers, unit mix, parking, phasing

`viewtower feasibility <config> --out <dir>` answers a different question from the view engine:
**how many flats of which sizes fit a plot, in which towers, at what heights, within the FSI,
the height ceiling, the setbacks and the car parking, with every main door facing the right way.**
Unlike the view engine (see [06](06_development_envelope.md)), this module applies setback, refuge
and parking rules itself, as configurable inputs with defaults in
[`configs/feasibility_default.yaml`](../../configs/feasibility_default.yaml). Every rule is a number in
that file. Nothing is hard-coded to one authority.

## Site rings

From the plot boundary inwards:

| Ring | Rule (default) | Effect |
|---|---|---|
| Road widening | strip of `site.road_widening_m` along the front edge | removed before FSI is counted; the front setback is measured from the new line |
| OSR | `osr.area_ratio` of the net plot, at least `osr.min_width_m` wide, anchored at a corner on a road | gifted; not developable |
| EIA green belt | `eia.green_ratio` of the net plot as a strip of width *w* along the plot boundary (solved by bisection) | natural ground: no parking, no driveway, no basement (unless `eia.basement_under`) |
| Fire driveway | `access.driveway_m` all round, inside the belt and along the OSR | no parking |
| Podium | what is left | ground floor + stilt 1: parking, clubhouse, lobbies |

Tower setback by height: `base_m` up to `base_height_m`, then `+step_m` for every `step_height_m`
(7 m to 30 m, +1 m every 6 m: 15 m at 72–76 m). `eia.mode: additional` measures the tower setback
from the inner edge of the green belt instead of the boundary. `setbacks.osr_gap: setback` keeps the
full height setback from the OSR.

## Cruciform plates and door facing

A plate is a hub (lift and stair core + an L-shaped lobby) with up to six flats: an end flat on the
north and south arms, and a pair of wing flats on the east and west arms. The facing of a flat is the
direction you face when you step out of its main door (the Vastu convention). Doors are placed on
walls that really meet the lobby, with no foyer tricks:

| Slot | Door on | Faces |
|---|---|---|
| S_end | its north wall, into the spine | N |
| E_S | its north wall, into the east stub | N |
| W_N, W_S | their east wall, into the spine | E |
| N_end | its south wall, into the spine | S |
| E_N | its south wall, into the east stub | S |

No slot has a west-facing door. Variants: **X6** (all six: N2 E2 S2), **X5** (no E_N: N2 E2 S1),
**X5b** (no N_end: N2 E2 S1) and **X4** (neither: N2 E2). Flats are rectangles sized to their
built-up area (`units.builtup_factor` × carpet); the wing depth is half the arm depth and the end-flat
width is a parameter, so a plate's footprint follows its unit mix. The largest units take the best
slots (north/east doors, three-sided outlook); the refuge flat is the least valued slot.

## FSI, saleable and refuge

FSI area = Σ towers (floors × plate area − refuge flats) + ground-floor entrance lobbies + clubhouse.
Plate area counts flats (rooms and balconies), the lobby and the core (stairs, lifts, shafts) on every
residential floor. Parking does not count. Saleable = `units.loading` × carpet. Height = podium +
floors × floor-to-floor. A refuge floor is the first floor above each of `building.refuge_thresholds_m`.

## Search

Two scenarios:

* **segregated**: each tower serves one segment (by `segment` on the unit types); its plate holds only
  that segment's types.
* **mixed**: each tower holds at least `search.min_types_mixed` types; two compositions (which may
  use different plate variants) alternate along the chain so that both phases get the full range.

For every tower set, floors are chosen by a deterministic local search (uniform start, then single
and paired ±1 moves) to meet the FSI target without passing the cap or the height ceiling while holding
the unit mix to its target shares. Sets are then placed on two podiums by a raster search
(0.5 m): phase 1 packs from the front road, phase 2 from the rear. Each tower takes the position nearest
its end of the site that keeps it inside its height setback and on the podium. It must keep the block
setback from towers on the other podium, and `same_podium_gap_m` on its own podium, where facades
closer than the setback may face each other for at most `facing_overlap_max_m`. The podiums are split by a driveway plus a
strip of visitor bays; groups are then spread towards the split.

Parking per phase = basement + ground + stilt 1, after cores, ramps, services and the clubhouse, at
`m2_per_car_*`. Visitor bays (`parking.visitor_ratio`) sit in the gap between podiums and in strips
between the fire driveway and the podium, never in the EIA belt.

Every placed set yields two schemes:

* **target**: floors as chosen for the FSI target; any car-parking shortfall is reported, with what
  closes it (second basement area, stackers, basement under the belt, part second stilt);
* **compliant**: floors taken off one at a time (mix-aware) until each phase parks its own flats.

Schemes are ranked by a sum of named penalties (FSI gap, mix deviation, facing, slenderness spread,
height spread, phase imbalance, extra towers, plate efficiency, parking), all reported with the scheme.
Sensitivity readings (`readings:`) rerun the search with config overrides.

## Fixed arrangement (`--fixed`)

When the client has fixed the tower arrangement, `viewtower feasibility <config> --fixed` keeps it and
chooses only each tower's plate and floors. The `fixed:` section gives the towers from the front road
to the rear, the side each takes (`sides`, E or W) and its podium (`podiums`). The towers are placed as
one chain in that order (each takes the frontmost position its rules allow on its side), spread over the
leftover length, and the podiums are split by distance with a driveway and visitor-bay band where they
meet.

Two scenarios:

* **mixed**: every tower carries at least `search.min_types_mixed` unit types;
* **targeted**: every tower serves one price band: one unit type, or two types adjacent in size.

Candidate plates come from `fixed.variants`, `arm_depth_m`, `end_width_m` and `assignment`. For each
plate the tallest arrangement of four copies that fits is measured, then per position the tallest the
plate rises with the smallest plate elsewhere (an optimistic bound). A CP-SAT model picks one plate and
a floor count per tower:

* hard: every unit type within `mix_tol_pp` points of its share; FSI between target − `fsi_band` and
  the cap; floors between `min_floors` and the height ceiling, and no taller than the position allows;
* soft: closeness to the FSI target, mix deviation, south doors, height spread and phase balance
  (`fixed.weights`).

The chosen set is placed. If it does not fit, the towers up to the one that could not be placed are cut
from the model at those floors and taller (the chain places each tower against the ones before it only,
so that prefix fails whatever follows), a version with a few floors off that still meets the bands is
kept as a fallback, and the model is solved again. Options differ in the unit set of at least one tower.

Each option also gets a **compliant** scheme: the model is solved again with each podium's flats capped
by the cars its basement, ground and stilt 1 hold (and the visitor bays the setbacks hold), keeping the
mix tolerance; the same plates and positions with fewer floors when the mix allows, otherwise any
plates, placed anew.

## Outputs

* one DXF per leading scheme (metres, true north up): plot, widening, net plot, OSR, EIA belt, driveway,
  basement edge, podiums, visitor bays, setback lines, towers with their floors, enlarged typical
  floors with unit labels and door arrows, and an area statement;
* a self-contained HTML viewer: site plan with draggable towers (live setback, spacing and podium
  checks), 3D massing, floor editing with live FSI / mix / parking / facing, typical floors, charts,
  the options explored and the basis;
* `*_results.json` and a markdown report.

Real project configs and outputs belong in `private/` (git-ignored).
