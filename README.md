# apartment-view-and-layout-optimizer (`viewtower`)

A deterministic, explainable engine for **view-optimised residential tower massing and apartment
layout**. It behaves like a computational architect:

**Context → Rules → Geometry → Evaluation → Optimisation → Explainable design**

Every generated option can be traced to the rule ids, user limits, assumptions and data that
produced it. No black-box optimisation and no randomness: the same inputs give byte-identical output.

> **Reference case (conceptual only):** a greenfield residential tower at Dadar–Shivaji Park,
> Mumbai. Every apartment is independently saleable, with sea views from living rooms and bedrooms,
> private lifts, and an open sea arc of about 120°. **No confidential project data, drawings or pricing
> are in this repository.** All development uses a synthetic site (`data/synthetic/`).

> **Scope decision:** statutory regulations (DCPR 2034, NBC, CRZ, heritage, airport) are **not**
> modelled. You supply **total consumable FSI area**, **maximum height** and the **buildable envelope**.
> After a DXF upload the tool asks *"Is this the buildable envelope?"*. If you answer no, you
> click (or list) each side and enter its setback. See [06_development_envelope](docs/spec/06_development_envelope.md).

## Quick start

```bash
pip install -e ".[dev]"
viewtower make-synthetic data/synthetic                 # fictitious coastal test site (DXF)
viewtower inspect-dxf data/synthetic/synthetic_coastal_site.dxf   # boundary + envelope confirmation
viewtower site-view configs/synthetic_coastal.yaml      # multi-height view field before massing
viewtower run configs/synthetic_coastal.yaml --out out  # search → report.json, units_best.csv, plan SVGs
pytest
```

Results on the synthetic site, reproducible with the commands above:

- The site view field infers a **premium sea arc of 226°–348° (122°)**. The mean water view is
  about 0 at ground level and 0.09 at 25 m, and it opens at **50 m**. From this the engine suggests
  starting residences above a podium (rule `GR-PODIUM-01`).
- 96 candidates across 11 typologies are evaluated in about 4 minutes, with 52 on the Pareto front.
  The top options have **0 compromised units** in both the existing and the future-neighbour
  scenarios. About 85–90 % of units are premium. The remaining "neutral" units are the lowest
  podium-adjacent floors, which is itself an explainable result.
- Economics use **synthetic placeholder rates**. The GDV figures only compare options against each
  other; they are not market estimates.

## How it works

```
DXF / map pin ─► normalised geometry ─► "is this the buildable envelope?" ─► context (DXF/GIS)
   ─► 2.5-D raster scene ─► multi-height view field (0/25/50/75/100 m) ─► premium arc
   ─► typology generators ─► plates, core, columns ─► units (equal-view split) ─► rooms on facade
   ─► per-facade ray casting ─► view classes (premium/good/neutral/compromised) ─► ₹ economics
   ─► hard-rule filter (with reasons) ─► Pareto front ─► ε-constrained presentation ─► report
```

* **View quality** is a continuous directional field `Q(θ, z)` built from water depression-angle span,
  distance to obstruction, sky openness, green, landmarks and user corridors, minus a privacy
  penalty. Room scores are cosine-weighted over the window's field of view.
  [07_view_quality](docs/spec/07_view_quality.md)
* **Compromised inventory** has explicit, configurable thresholds. Every unit gets a class and the
  reasons for it, along with robustness margins and a future-scenario re-check.
  [08_compromised_inventory](docs/spec/08_compromised_inventory.md)
* **Optimisation** enumerates candidates deterministically, filters them with hard rules, ranks them
  by non-dominated sorting over separate objectives, and only then presents a preference order.
  [09_optimization_formulation](docs/spec/09_optimization_formulation.md)

## Specification (produced before implementation)

| # | Deliverable | Where |
|---|---|---|
| 1 | Requirements matrix | [docs/spec/01_requirements_matrix.md](docs/spec/01_requirements_matrix.md) |
| 2 | Data dictionary | [docs/spec/02_data_dictionary.md](docs/spec/02_data_dictionary.md) |
| 3 | Public datasets / source registry | [data/registry/data_sources.yaml](data/registry/data_sources.yaml) |
| 4 | Precedent-study framework + dataset | [docs/spec/03_precedent_framework.md](docs/spec/03_precedent_framework.md), [data/precedents/](data/precedents/) |
| 5 | Typology taxonomy | [docs/spec/04_typology_taxonomy.md](docs/spec/04_typology_taxonomy.md) |
| 6 | Geometric rules | [docs/spec/05_geometric_rules.md](docs/spec/05_geometric_rules.md), [data/rules/rules.yaml](data/rules/rules.yaml) |
| 7 | Development limits (replaces regulatory rules, per scope decision) | [docs/spec/06_development_envelope.md](docs/spec/06_development_envelope.md) |
| 8 | View-quality maths | [docs/spec/07_view_quality.md](docs/spec/07_view_quality.md) |
| 9 | Compromised-inventory maths | [docs/spec/08_compromised_inventory.md](docs/spec/08_compromised_inventory.md) |
| 10 | Multi-objective formulation | [docs/spec/09_optimization_formulation.md](docs/spec/09_optimization_formulation.md) |
| 11 | Software architecture | [docs/spec/10_architecture.md](docs/spec/10_architecture.md) |
| 12 | Phased roadmap | [docs/spec/11_roadmap.md](docs/spec/11_roadmap.md) |
| 13 | Repository structure | below |

## Repository structure

```
configs/            default.yaml (all defaults), synthetic_coastal.yaml (example), template_project.yaml
data/
  precedents/       schema.json + precedents.yaml (15 buildings, facts only, unknowns null)
  registry/         data_sources.yaml (source, URL, access date, licence, reliability, transformation)
  rules/            rules.yaml — single source of truth for every threshold (hard/soft/commercial)
  synthetic/        synthetic_coastal_site.dxf (fictitious)
docs/spec/          01–11 specification documents
src/viewtower/
  geometry/         dxf_io.py (DXF in/out, units, layers), site.py (envelope, setbacks, frames)
  context/          scene.py (context model → 2.5-D raster)
  view/             engine.py (vectorised ray marching), quality.py (Q(θ), apertures, view field)
  typology/         generators.py (15 typologies/modifiers), structure.py (core, columns, spans)
  units/            subdivide.py (unit envelopes, room frontage assignment)
  evaluation/       classify.py (view classes + reasons), economics.py (rates, GDV, risk)
  optimize/         search.py (enumerate/filter/evaluate), pareto.py
  pipeline.py, report.py, synthetic.py, cli.py
tests/              geometry, DXF, typology exactness, ray-engine analytic cases, classes, determinism
```

## Status and limitations (v0.1)

* Implemented: Phases 1–5 core and the Phase 7 tests (see [roadmap](docs/spec/11_roadmap.md)).
* Not yet implemented: web UI (map pin, boundary editing, edge-click setbacks, corridor marking,
  3-D viewer), the OSM/Overture context fetch for location mode, room-level internal walls and
  duplexes, and terrain from a DEM.
* The view engine is 2.5-D (extruded footprints on a raster, 4 m by default). Balcony and mullion
  occlusion are simple factors.
* Levels between evaluated floors (`eval_every`) inherit results from the floor below. Set
  `eval_every: 1` for final runs.
* Rule defaults marked `confidence: low` in `rules.yaml` are engineering assumptions. The design team
  must confirm them.
* Precedent geometry is only as good as the public data. `reproduction_confidence` says when a
  building cannot be reproduced. The parameterised generators themselves are exact (tested by IoU).

## Data and confidentiality

Never commit real project drawings, prices or credentials. `private/` and `*.confidential.*` are
git-ignored. Every external dataset must be registered in `data/registry/data_sources.yaml`.
