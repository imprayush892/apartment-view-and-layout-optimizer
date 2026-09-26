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
Method: 500 role-played personas in 12 segments (buyers, sales, finance, architects, construction,
designers, data scientists, public, leadership, engineers, planners, marketing), 10 per agent. Each
reviewed a dossier of real screenshots and measured facts, gave 1–5 ratings and NPS, issues with
severity and suggestions, and votes on A/B tests. Round 2 re-tested the **same 80 personas** (panels 1–8)
on the improved version, told their round-1 issues but asked to rate the app as it is.

### Round 1 → round 2 (same 80 personas, paired)
| Measure | Round 1 | Round 2 | Change |
|---|---|---|---|
| Would use (1–5) | 2.51 | 3.08 | +0.57 |
| Usefulness (1–5) | 2.84 | 3.19 | +0.35 |
| Ease (1–5) | 2.45 | 3.38 | +0.93 |
| Trust in results (1–5) | 2.39 | 2.91 | +0.52 |
| Visual quality (1–5) | 3.21 | 3.69 | +0.48 |
| NPS (0–10) | 4.51 | 5.70 | +1.19 |

53 % of personas raised "would use", 1 % lowered it. Blocker-level issues fell from 48 to 9. Of 298
round-1 issues these people had raised, 46 were judged fixed, 136 partly fixed, 116 not fixed.
Largest gains: financial analysts (would use 2.0 → 3.0, NPS 3.2 → 5.5), construction (2.0 → 2.9),
developer leadership (2.8 → 3.8), data scientists (trust 2.0 → 3.1). Smallest: engineers (1.8 → 2.0)
and planners (2.0 → 2.0), who need structural/wind checks and shadow studies.

Remaining blockers after round 2: no cash flow / IRR / NPV (5 finance personas) and no shadow study on
Shivaji Park (3 planners); both were added after round 2 (a simple quarterly cash flow with IRR, NPV
and peak funding, and a tower-only shadow study with shade hours on nearby parks). Frequent majors:
a view cone taken on the landward facade showed 0 % sea next to a "premium" flat (the cone card now says
whose view it is and offers "View from this flat's living room"); the phone's floating buttons covered
the export bar and tabs were clipped (fixed); no per-flat sheet for buyers (added: "Flat sheet for a
buyer"); capped values shown as measurements (now "open (>3 km)"). Not addressed: room-level layouts,
structural system / wind / core sizing by lift count, IFC export, calibrated prices, absorption by
class, construction programme.

### A/B tests
| Test | Result | Decision |
|---|---|---|
| 1. Unit split: equal view value (A) vs equal facade length (B), round 1, 500 personas | A 298, B 78, no preference 124 | keep A |
| 2. View checks: every 4th floor (A) vs every floor (B), round 1 | A 269, B 156 | adaptive: every 4th floor + bisection where classes change (engine test: 30 → 11 wrong of 304 inland flats at 1.1–2.3× time) |
| 3. Pricing: by class (A) vs continuous in view (B), round 2, 80 personas | B 47, A 6, no preference 27 (buyers 15/16 B; sales split 4–4, they like a clean price ladder) | continuous is the default; "By class" stays selectable |
| 4. Premium label: lenient round-1 rules (A) vs calibrated (B), round 2 | B 68, A 4, no preference 8 (sales 4 of 8 prefer A) | calibrated is the default |
