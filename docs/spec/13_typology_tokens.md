# 13 — Typology Tokens, the Open Vector Dataset and the Probabilistic Generator

Implementation: `web/js/engine.js` (`tokenPlate`), `web/js/tokens.js` (library, features, model,
generator), `tools/study/*` (dataset, study). Research basis: `docs/research/architects_geometry.md`
(48 geometry tokens from BIG, Zaha Hadid Architects, B.V. Doshi, Charles Correa, Sanjay Puri, Studio
Gang, SOM, KPF, Foster, Herzog & de Meuron, Viñoly, SHoP, Safdie, MVRDV, Heatherwick, MAD …).

## 1. Why tokens
A typology is not pasted onto a site. It is decomposed into **tokens**: a base plate plus per-floor
moves. Each move is measured by what it does to the view of every facade segment on every floor.
New towers are then composed from the moves that work on this site, at this height, facing this way.

## 2. Token grammar (per floor `l`, `t = (l − podium)/(n − 1 − podium)`)
| Token | Parameters | Plate at floor l | Precedent |
|---|---|---|---|
| base | square, rectangular, chamfered, curved (superellipse), diamond, triangular, Y, cross, T; width, depth | the base polygon | 432 Park, Kanchanjunga, Aqua … |
| twist | rate °/floor; mode linear, band (every B floors), ease (S-curve) | rotate by rate·k, rate·B·⌊k/B⌋, or total·(3t²−2t³) | Cayan 1.2°/floor, Absolute 1–8°/floor |
| taper | top scale; mode linear, frustum (alternating, period P), bulge | scale 1+(top−1)·t, triangle wave, 1+(top−1)·sin(πt) | Shard, Vista Tower frustums, 30 St Mary Axe |
| shift | amplitude m; mode stagger (±A/2 every P floors), lean (A·t), wave (A·sin), pixel (random ±A per band); direction toward/away from the view | translate the plate | 56 Leonard, Vancouver House, Aqua slab edges |
| terrace | every E floors, step m, direction | clip the plate back by step·⌊k/E⌋ on the given side | Mountain Dwellings, Habitat 67, 111 W 57th |
| cut | every E floors (2 floors each), size m | cut a corner (rotating by band): double-height gardens | Kanchanjunga (Correa), Waves sky gardens (Puri) |
| podium | none, street | floors below the podium follow the buildable envelope (street wall) instead of the tower plate | added after round 1 (207 architects asked for base changes) |
| crown | none, crown, crown_turn; floors, scale, rotation | the top F floors shrink to the given scale and may turn | added after round 1 (164 requests for top articulation) |

The core stays on the tower axis (it turns with a linear twist, as in Cayan). The existing hard rules
bound the moves: overhang per floor ≤ 3 m, core fit with slab margin, depth, span, envelope.

**Library:** 9 bases × 2 sizes × 29 token sets + 4 plain/twist sets at a third size = **540
typologies**, each named with its precedent (`TOK.library()`).

## 3. Deconstruction: facade segments and the vector dataset
Every evaluated floor is split into facade segments (≤ 12 m, normals within 20°). Each segment gets a
feature vector `x` (`TOK.FEAT`):
- **Site view field** in the segment's direction and at its height: prize view (sea or skyline) and
  quality, bilinear from the site rose.
- **Orientation:** cosine to the site's view direction.
- **Height:** height ratio and height above the local context.
- **Geometry:** segment length, overhang over the floor below, curvature, corner.
- **Tower tokens:** twist rate, taper, shift amplitude and direction, terrace step and direction,
  cut, aspect.
- **City profile.**
- **One probe ray out of the facade:** nearness, whether it hits a habitable building, prize view.

Each segment also has measured outcomes `y` from full ray casting: view quality, prize share and
privacy.

`tools/study/train.js` builds the dataset from random training sites × random library typologies ×
random rotations. It writes `data/vectors/segments.jsonl.gz` (one row per segment) and
`data/vectors/training_evaluations.json`.

## 4. Open weights
Ridge regression per outcome (`TOK.train`) gives interpretable weights for every feature. That shows
*why* a part of a typology works, for example the weight on `prize × cos(to view)` against `overhang`
or `terrace_to_view`.

The weights are published in `web/data/typology_model.json`, with train and held-out R², row counts
and the cities used. Privacy is nearly always 0 at tower heights in this data, so its model has little
signal and is reported by mean error rather than R².

## 5. Three systems
- **Deterministic** (`library` mode): score every library typology at 3 rotations with a fixed hand
  rule. The rule is facade length × (0.6 · prize + 0.4 · quality) of the view field in each facade's
  direction and height. Walk down the ranked list, keeping those that fit and pass the hard rules;
  evaluate the top K in full. No learning and no randomness.
- **Probabilistic** (`generative` mode):
  - The generator draws token genomes from a distribution: categorical for base and modes,
    Gaussian for size, aspect, rates, amplitudes and rotation.
  - Each genome is scored by the learned model: predicted quality plus the share of facade
    predicted above the premium line, minus predicted privacy and a small complexity term.
  - The distribution is refitted to the top 15 % (cross-entropy method), 5 iterations × 60
    samples, seeded.
  - The best K distinct genomes that pass the hard rules are evaluated in full.
- **Hybrid** (`hybrid` mode): the probabilistic generator with its objective weights and token priors
  adjusted from the architects' image-only critiques (`web/data/hybrid_weights.json`, §6), seeded
  with the deterministic winner.

All three finish with the same full ray-cast evaluation and the same ranking (best trade-offs, then
zero compromised, then value after construction cost).

## 6. Feedback loop (architect study)
See `docs/spec/14_architect_study.md` for the study, the A/B results and how critiques became
weights.
