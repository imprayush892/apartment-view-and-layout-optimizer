# 12 — Validation, Data-Science Review and User Testing (v0.2)

This records how v0.2 of the web engine was checked: eight data-science experiments on the engine
(synthetic personas were **not** used for any numeric result here), two rounds of role-played persona
usability testing, and A/B tests. Persona feedback is an **AI-simulated usability study** built from
real screenshots and measured facts. It is a structured design review, not a survey of real users, and
the same caveat applies to every number in §6.

All engine numbers come from `tools/harness.js` on the bundled Dadar OpenStreetMap snapshot (1,471
buildings, 93 % with estimated heights) and an illustrative 64 × 52 m plot that is **not** the project
site.

## 1. Is the app actually finding a view? (view-engine validation)
- Rays were checked against independently computed geometry; the ray engine was correct. The failure
  was the **sea mask**: the old flood fill leaked through clipped coastline ends and then dropped the
  whole sea, so on some plots the app saw no sea at all. v0.2 classifies every cell by the side of the
  nearest coastline segment (100 % agreement with the reference wherever the coastline is complete).
- "Sea view opens at 0 m" on the seafront plot is geometrically true but rests on a ~0.6° sliver seen
  over the promenade; street clutter is not modelled. Treat ground-level sea views as fragile.
- The old water term saturated at 1° of visible sea, so a thin distant strip scored like a seafront
  view. v0.2 uses a 5° reference band.
- Ponds and tanks counted as sea. v0.2 counts inland water ≥ 0.5 ha as open space only.

After the fixes, premium share falls off with distance from the shore as expected (square and Y towers,
2–3 units/floor): seafront 75 %, ~300 m inland 49 %, ~600 m 24 %, ~900 m 10 %.

## 2. Sensitivity to the uncertain inputs
- **Building heights.** Estimated heights (type defaults, 12–18 m) are calibrated to the 97 tagged
  buildings nearby (×1.33). The app runs a per-design test with estimated heights ×0.75 and ×1.5 and
  reports flats that change class. On the seafront plot the result does not depend on heights (only
  4 buildings stand in the sea directions); inland, 85 % of the 198 buildings in the sea directions are
  estimated and the badge says "low reliability".
- **Data coverage.** The snapshot has buildings only ~1 km around the anchor while rays run 3 km, so
  beyond that the city looks empty. The verdict shows "Buildings loaded to about N m from the plot";
  live fetches now default to 1.5 km. Obstruction-based compromised rules rarely bind on this data
  (see the "zero compromised is easy on this site" badge).

## 3. Classification and price calibration
- Compromised was effectively "living-room view < 0.25" (the distance, skyline and privacy rules never
  fired). v0.2 tightens them (obstruction < 100 m at the 25th percentile, skyline > 10°, privacy > 0.35
  from neighbours only). On this data they still add few units; that is a data-coverage limit (§2).
- Premium thresholds were re-set so premium share tracks distance to the sea (§1). Values:
  08 §2.
- Price: with 4 class steps, 24 % of unit pairs with almost the same view (Δq < 0.02) fell in different
  classes (mean 3.6 % price jump). The continuous multiplier `0.655 + 0.69 q` (0.80–1.20) cuts that to
  0.4 %. The multipliers are **not** calibrated to transactions (§5).

## 4. Robustness audit (bugs found and fixed)
| Finding | Fix |
|---|---|
| Setback envelope threw inside polygon-clipping on ordinary plots (e.g. an 80 m square) and the app silently kept the old envelope | ring cleaning, corner discs only at reflex corners, error shown and envelope cleared; 300 random + 9 edge-case plots pass |
| The tower counted as its own "habitable neighbour" (privacy rule rejected Y/cross shapes by rotation) | own footprint is an obstruction, not a neighbour |
| Equal-value split made sliver units (4 units/floor almost always infeasible) | minimum facade per unit; room frontage allows 10 % under the nominal width |
| Split started at the lowest-quality point, so tiny view changes moved unit boundaries | split starts at the landward facade |
| Tapered towers under-used FSI (73–92 %) | floor count searched directly (88–99 %) |
| Terraces turned with the tower rotation | terraces face the entered site direction |
| Worker errors were shown as complete results; the fallback could leave "Stop search" stuck | errors reported, button reset |
| No input validation (floor-to-floor 0 gave a 0 m tower) | inputs checked before the search |
| Stale design after changing setbacks; slow data loads could overwrite newer ones | cleared on envelope change; latest load wins |
| Harness 8× slower than the browser (node:vm context) | runs in this context |
| Podium above the height limit reported as an FSI failure | reports ENV-HEIGHT-01 |

## 5. Growing the dataset
What would most improve the results, in order:
1. **Heights**: fuse survey > OSM height > OSM levels > Google Open Buildings 2.5D (India, CC BY 4.0)
   > Overture > GHSL 100 m built-height; keep the source and an uncertainty per building.
2. **Coverage**: buildings to at least 3 km (all buildings ≥ 45 m to 5 km); store the coverage radius.
3. **Ground truth for views**: the view cone now has "Looks right / Not right" + note; each record keeps
   the location, eye height, direction and predicted sea share / quality. Saved scenarios include these
   records and per-flat features (`q`, sea share, obstruction, horizon, margin, class, multiplier), plus
   the engine version hash and data summary, so they can be pooled and used as labels.
4. **Prices**: a within-building hedonic regression of registered ₹/ft² on floor and view (IGR
   Maharashtra registrations with MahaRERA carpet areas) to set the view multiplier and floor rise.
5. **Future obstructions**: map `building=construction` and MahaRERA registrations (floors) to the
   future scenario.
6. **Landmarks** (Sea Link pylons, Siddhivinayak …) from OSM/Wikidata, or re-normalise the weights
   when there are none.
7. **Active labelling**: ask for labels first on flats within 0.1 of a class threshold.

## 6. Persona usability testing and A/B tests
See the section appended after round 2 below.
