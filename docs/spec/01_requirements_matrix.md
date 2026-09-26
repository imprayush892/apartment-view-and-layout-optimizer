# 01 — Requirements Matrix

Status legend — **H** = hard constraint (a candidate that violates it is rejected),
**O** = optimisation objective (reported as a separate metric), **C** = commercial
preference (weights/thresholds a developer can change), **I** = information/input only.

Source legend — **PUB** public dataset, **USR** user-supplied,
**PREC** inferred from precedent study, **ASM** engineering assumption (must be confirmed
by a licensed professional before use on a real project).

Every row has an ID (`R-<group>-<nn>`). Code, configs and outputs refer to these IDs so that
every generated design is traceable to the requirement that shaped it.

> **Scope decision.** Statutory regulations (DCPR 2034, NBC, CRZ, heritage, airport) are *out of
> scope*. The user supplies consumable FSI area, maximum height and the buildable envelope.
>
> **Reference case.** Dadar–Shivaji Park, Mumbai — greenfield residential tower, independently
> saleable apartments, sea views from living rooms and bedrooms, private lifts, ≈120° open sea arc,
> GDV ≈ ₹859 cr. Used only as a conceptual benchmark. **No project drawings, plot data, pricing
> or other confidential information are used or stored in this repository.** All development
> uses synthetic sites (see `data/synthetic/`).

---

## 1. Site data

| ID | Item | Type | Format / unit | Source | Status | Notes |
|---|---|---|---|---|---|---|
| R-SITE-01 | Site boundary | Polygon | DXF closed polyline / GeoJSON; metres | USR | H | Must be closed, non-self-intersecting, area > 0. User confirms after parsing. |
| R-SITE-02 | Existing buildings (context) | Polygons + height | GeoJSON / DXF + `height_m` | PUB (OSM, Overture, Google Open Buildings), USR survey | I→H (obstruction) | Height often missing in public data → estimated from `building:levels × 3.0 m` and flagged `estimated`. |
| R-SITE-03 | Future/approved buildings | Polygons + height | as above | USR, municipal approvals (if public) | I | Modelled as a separate "future" layer; view scored for both present and future scenarios. |
| R-SITE-04 | Roads | Lines | GeoJSON | PUB (OSM) | I | Context only (view foreground, privacy distance). No road-width-based rules. |
| R-SITE-05 | Adjacent plots | Polygons + assumed future height | GeoJSON | USR | I | Optional: user draws likely future neighbour massing to test view robustness. |
| R-SITE-06 | Topography | DEM raster | GeoTIFF, m AMSL | PUB (Copernicus GLO-30, FABDEM), USR survey | I | Mumbai island city is near-flat; terrain matters for hilly sites (Malabar Hill). |
| R-SITE-07 | Water bodies / coastline | Polygons | GeoJSON | PUB (OSM `natural=coastline`, `natural=water`) | I | Coastline polygons are needed for water-view scoring. |
| R-SITE-08 | North direction | Angle (deg) | Degrees, clockwise from +Y to true north | USR / DXF | H | DXF drawings are often not north-up; `north_angle_deg` rotates the local frame. |
| R-SITE-09 | Site coordinates | lat/lon (WGS84) + local CRS | EPSG:4326 / EPSG:32643 (UTM 43N for Mumbai) | USR | H | Anchor point for local ENU frame. |
| R-SITE-10 | **Buildable envelope** | Polygon | DXF / drawn | USR | H | Preferred input. After upload the tool asks: *"Is this the buildable envelope?"* |
| R-SITE-11 | Per-edge setbacks | Distance per boundary edge | m | USR | H | Only if the uploaded outline is **not** the buildable envelope: user clicks each side and enters its setback; envelope = inward offset per edge. |

## 2. Environmental / view data

| ID | Item | Variable(s) | Source | Status |
|---|---|---|---|---|
| R-VIEW-01 | Sea / water views | `water_visibility(θ, z)` | Coastline + context DSM | O |
| R-VIEW-02 | Skyline views | `skyline_visibility(θ, z)` — fraction of rays reaching far (> 1 km) built mass above horizon | Context DSM | O |
| R-VIEW-03 | Landmark views | `landmark_visibility(k, z)` — boolean + angular size per landmark `k` | USR list of landmark points + heights (e.g. park, sea link, temple) | O |
| R-VIEW-04 | Open-sky directions | `sky_openness(θ, z) = 1 − sin α_h(θ)` | DSM | O |
| R-VIEW-05 | Existing / future obstruction geometry | 2.5-D prisms / DSM | R-SITE-02/03/05 | H (physics) |
| R-VIEW-06 | View corridors | Azimuth intervals `[θ₁, θ₂]` with weights | USR marking or inferred (see 07_view_quality §5) | C |
| R-VIEW-07 | View distance | `d_obs(θ, z)` first distance to an obstruction above eye level | computed | O |
| R-VIEW-08 | View angle | Horizontal FOV of an aperture (default ±75° from facade normal) | ASM | C |
| R-VIEW-09 | Elevation-dependent visibility | Evaluate at `z ∈ {0, 25, 50, 75, 100} m` (configurable) + every floor for final design | config | I |
| R-VIEW-10 | Seasonal / time effects | Monsoon haze (visibility distance cap), sun path/glare on the west (sea) facade | IMD climatology, solar geometry | O (secondary) |
| R-VIEW-11 | Privacy | Facing distance to other habitable windows | computed | O / H (min facing distance) |

## 3. Development envelope (user-supplied — no statutory modelling)

This tool deliberately does **not** encode DCPR 2034, NBC, CRZ, heritage, airport or any other
statutory rules. Those are complex, site-specific and change often; getting them wrong would
produce unrealistic or financially unviable results. The design team resolves them outside the
tool and passes in the outcome as three numbers/shapes:

| ID | Input | Unit | Source | Status | Notes |
|---|---|---|---|---|---|
| R-ENV-01 | **Total consumable FSI area** (max built-up area) | m² (or ft²) | USR | H | Hard cap on Σ floor-plate gross area of saleable floors. Candidates may use less; utilisation is reported. |
| R-ENV-02 | **Maximum height** | m above ground | USR | H | No default cap — towers of 150 m+ are expected. |
| R-ENV-03 | **Buildable envelope** | Polygon | USR (R-SITE-10/11) | H | Tower footprint (every floor plate) must lie inside it. |
| R-ENV-04 | Non-saleable floors (optional) | list of levels / every-n rule | USR | H | E.g. amenity, services or any floors the team wants to reserve. Default: none. |
| R-ENV-05 | Podium (optional) | floors, footprint | USR | I | Parking/amenity podium; excluded from view scoring below `podium_top_m`. |

Anything else a team needs (parking count, fire stairs, refuge levels) is expressed through the
core-size inputs (R-PROG-10/11) and R-ENV-04, i.e. as design inputs, not as coded regulations.

## 4. Residential programme

| ID | Item | Default (configurable) | Source | Status |
|---|---|---|---|---|
| R-PROG-01 | Units per floor | 1–4 (reference case: independently saleable, private lift ⇒ typically 1–2) | PREC / C | C |
| R-PROG-02 | Unit carpet ranges | 3 BHK 1,400–2,000 ft²; 4 BHK 2,000–3,200 ft²; full floor 3,000–6,000 ft² | ASM / market listings | C |
| R-PROG-03 | Bedrooms | 3–5; min 2 with premium view (see compromised definition) | C | O |
| R-PROG-04 | Living / dining | Min frontage 6.0 m; depth ≤ 9 m | PREC (luxury plans) / ASM | H (min) / O |
| R-PROG-05 | Kitchen | Min 7.5 m² on an external facade (may face non-premium facade) | ASM | C |
| R-PROG-06 | Bathrooms | 1 per bedroom + powder; may be internal with mechanical ventilation | ASM | C |
| R-PROG-07 | Balconies / decks | Depth & share user-set; placed on premium arc | USR, PREC | O |
| R-PROG-08 | Service areas | Utility, staff room, service entry adjacent to service lift | PREC | C |
| R-PROG-09 | Circulation | Private lift lobby per unit; common corridor minimised | PREC | O |
| R-PROG-10 | Core | User-set core size (or computed from lift/stair counts × module areas) | USR / ASM | H |
| R-PROG-11 | Lift count | Private lift per unit (≥1 per unit) + 1 service/fire lift per core; check by traffic analysis (CIBSE Guide D) | ASM | H |
| R-PROG-12 | Lobby | Ground entrance lobby; private lift lobby on each floor | PREC | C |

## 5. Structural requirements

| ID | Item | Default | Source | Status |
|---|---|---|---|---|
| R-STR-01 | Structural grid | 7.5–9.0 m typical; perimeter column spacing 4.5–9 m | ASM / PREC | O |
| R-STR-02 | Column size | Pre-size by tributary area × floors (see `typology/structure.py`) | ASM | I |
| R-STR-03 | Shear walls / core | Central RC core, core-to-plate area ≥ 12–20 % for tall slender towers | PREC (432 Park, Cayan) | H (min) |
| R-STR-04 | Core-to-facade depth | 8–13.5 m clear span (lease depth) | PREC | H (max) |
| R-STR-05 | Span limit | Flat slab / PT ≤ 12 m without transfer | ASM | H |
| R-STR-06 | Transfer structures | Penalised; allowed at podium/tower junction | ASM | O (minimise) |
| R-STR-07 | Cantilever limit | ≤ 3.0 m RC / ≤ 4.5 m PT balconies | ASM | H |
| R-STR-08 | Slab system | PT flat slab (default) | ASM | I |
| R-STR-09 | Wind | Slenderness H/B ≤ 8 without auxiliary damping; >8 flagged; >12 needs wind-tunnel + damper | PREC (432 Park 1:15 with TMDs; 111 W 57th 1:24) | H (flag) / O |
| R-STR-10 | Seismic / regularity | Penalise plan irregularity (re-entrant corners, mass eccentricity) | ASM | O |
| R-STR-11 | Constructability | Floor-plate repetition, column continuity (no raking columns unless twisted typology) | PREC (Cayan: identical plates) | O |

## 6. Facade requirements

| ID | Item | Default | Status |
|---|---|---|---|
| R-FAC-01 | Window locations | Apertures on facade segments assigned to habitable rooms | O |
| R-FAC-02 | Window-to-wall ratio | 0.40–0.80 (user-set) | C / O |
| R-FAC-03 | Balcony geometry | Depth 1.5–3.0 m; balcony slab reduces downward view angle — modelled as a per-aperture `sill_occlusion_deg` | O |
| R-FAC-04 | Shading | West (sea) facade: fins/overhangs trade glare vs. view | O |
| R-FAC-05 | Structural expression | Perimeter columns block view: `column_occlusion = Σ col_width / facade_length` | O (minimise) |
| R-FAC-06 | View obstruction by facade elements | Mullion spacing ≥ 1.5 m on premium arc | C |
| R-FAC-07 | Privacy | Min facing distance between habitable windows (default 18 m; configurable) | H/O |
| R-FAC-08 | Solar exposure | West facade solar gain penalty; reported not optimised in v1 | I |

## 7. Economic variables

| ID | Variable | Definition | Status |
|---|---|---|---|
| R-ECO-01 | Saleable (RERA carpet) area | Σ unit carpet area | O |
| R-ECO-02 | Built-up area | Gross floor-plate area counted against R-ENV-01 | I |
| R-ECO-03 | Efficiency | carpet ÷ gross floor-plate area | O |
| R-ECO-04 | Base rate | ₹/ft² carpet (user input; *no* default for the reference case — synthetic default only) | C |
| R-ECO-05 | View premium | Multiplier per view class (premium/good/neutral/compromised) | C |
| R-ECO-06 | Floor-rise premium | ₹/ft² per floor or % per floor | C |
| R-ECO-07 | Orientation premium | Multiplier by dominant living-room azimuth | C |
| R-ECO-08 | Unit-size premium/discount | Multiplier by carpet band | C |
| R-ECO-09 | Construction cost | ₹/ft² BUA, with height and typology complexity factors | C |
| R-ECO-10 | Core efficiency | core area ÷ floor-plate area | O |
| R-ECO-11 | GDV | Σ units carpet × rate × multipliers | O |
| R-ECO-12 | Revenue per floor / per unit | derived | O |
| R-ECO-13 | Inventory risk | Share of GDV in compromised or neutral units; absorption-time proxy | O |

## 8. Optimisation objectives vs. hard constraints

**Hard constraints (feasibility filter — binary):** R-SITE-01/08/09/10/11, R-ENV-01…04,
R-PROG-10/11, R-STR-03/04/05/07, minimum facing distance (R-FAC-07).

**Objectives (each reported separately, never pre-collapsed):**

| ID | Objective | Sense |
|---|---|---|
| OBJ-01 | Saleable (carpet) area | max |
| OBJ-02 | Units with premium view (count & %) | max |
| OBJ-03 | Bedrooms with desirable view (count & %) | max |
| OBJ-04 | Mean living-room view quality | max |
| OBJ-05 | Estimated GDV | max |
| OBJ-06 | Compromised units (count) | min (target 0) |
| OBJ-07 | Circulation area ratio | min |
| OBJ-08 | Structural complexity index | min |
| OBJ-09 | Facade complexity index | min |
| OBJ-10 | Planning efficiency (carpet / GFA) | max |
| OBJ-11 | Constructability index | max |
| OBJ-12 | Privacy score | max |

**Commercial preferences:** view-class multipliers, target unit mix, minimum premium share,
acceptable compromised count (default 0), weightings used only *after* Pareto filtering for
ranking presentation.
