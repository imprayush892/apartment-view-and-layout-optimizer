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
`m2_per_car_*`. `parking.basement_levels` adds lower basements (B2, B3 ...) under the same footprint
(`lower_basement_share` for a part level), each less the cores, the ramp it shares with the level
above (taken on both levels) and `lower_basement_services_m2`; the report gives the lower-level area
each phase actually needs and the spare cars. With `basement_split: balance` the phases share the
basement along one straight east-west joint between their towers, placed so both park their own
residents with the most even spare; with `visitors_in_basement`, visitors the setback bays cannot
take park in the basement surplus. Visitor bays (`parking.visitor_ratio`) sit in the gap between podiums and in strips
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
so that prefix fails whatever follows), together with any plates whose footprints cover theirs (plates
share the hub as origin, so a covering plate takes more ground wherever it stands). A version with a few
floors off that still meets the bands is kept as a fallback, and the model is solved again. Options
differ in the unit set of at least one tower. CP-SAT runs interleaved workers on a deterministic-time
budget (`solve_s`), so a config gives the same schemes every run.

Each option also gets a **compliant** scheme: the model is solved again with each podium's flats capped
by the cars its basement, ground and stilt 1 hold (and the visitor bays the setbacks hold), keeping the
mix tolerance. It is found in two ways and the higher FSI is kept: the same plates at the same positions
with fewer floors (the podiums, and so the parking, stay put), and any plates under the caps. Moving
towers moves the podium split and so each phase's parking, so every placed set is also tried with fewer
floors at its own positions, sets that do not park are cut, and a short podium's cap is lowered by its
shortfall every second miss.

## Room layouts (`--rooms`)

With `--rooms`, every flat of the leading schemes (`rooms.schemes` per scenario, in each of
`rooms.modes`) is laid out room by room (`rooms.py`). The flat is mapped to a canonical frame (main
facade first, exterior side facade at the left) and its rooms are axis-aligned rectangles on a 0.3 m
grid that tile it exactly, around the lobby notch and the ventilation shaft. The room programme comes
from the unit label (1, 2, 2.5, 3, 3 Plus, 3 Large, 3.5, 4 BHK) or `units.types[].program`, with target
areas scaled to the flat. CP-SAT holds, as hard rules (after NBC 2016 Part 3):

* light and air: living, bedrooms and study on an exterior wall long enough for a window of a tenth
  of the room's area (1.5 m high), no point more than 7.5 m from it, or lit the same way through the
  balcony (an open verandah under 2.4 m deep, as NBC allows); the kitchen has a window or opens to an
  exterior utility;
* shafts: every toilet has a ventilator on the facade or on the shaft that twin wing flats share
  across their party wall, open to sky and reached from the lobby (`rooms.shaft_w_m` x
  `rooms.shaft_d_m`, 2.4 x 3.4 m by default: NBC asks about 8 m2 with a 2.4 m side above 30 m, with
  mechanical exhaust besides);
* access: the foyer takes the main door; foyer, living, dining and passage form one circulation;
  bedrooms, kitchen, study, pooja and the common toilet open off it, attached toilets and dress off
  their bedroom, the utility off the kitchen, the balcony off the living;
* sizes: net of walls, bedrooms 9.5 / 7.5 m2, kitchen 5 m2, bath + WC 2.8 m2, passages 1.05 m and
  balconies 1.35 m clear; room proportions at most 1 : 2.2.

Soft: each room's target area, a second exposure for living and master bedroom, kitchen windows,
bedrooms off the passage, and the Vastu placements (kitchen south-east, master bedroom south-west,
pooja north-east, no toilet north-east). Each flat is tried with the work budgets in `rooms.solve_s`
until every check passes; a recurring flat is solved once and a mirror twin starts from its sibling.
Results are cached in the output folder. The viewer and the DXF typical floors then show each room
(name, net size), windows, ventilators, inner doors and shafts, and the report gives a room schedule
per unit type, the carpet in plan against the nominal carpet, and every failed check.

## Outputs

* one DXF per leading scheme (metres, true north up): plot, widening, net plot, OSR, EIA belt, driveway,
  basement edge, podiums, visitor bays, setback lines, towers with their floors, enlarged typical
  floors with unit labels and door arrows, and an area statement;
* a self-contained HTML viewer: site plan with draggable towers (live setback, spacing and podium
  checks), 3D massing, floor editing with live FSI / mix / parking / facing, typical floors, charts,
  the options explored and the basis;
* `*_results.json` and a markdown report.

Real project configs and outputs belong in `private/` (git-ignored).
