# 14 — The Architect Study: 500 Sites, Image-Only Critiques and the Hybrid

All data is in `data/study/`: architects, per-site results, blind assignments, critiques, weights and
engine A/B results. The tooling is in `tools/study/`.

The architects are **AI role-played personas**. Each has a role, firm, home city, two influences from
the research list, two priorities and a temperament. They reviewed rendered images only. This is a
structured, reproducible design review, not a survey of real practitioners.

## 1. Set-up
- **500 architects.** Each one "drew" a random polygon site of 3–8 corners on a real block in one of
  five OpenStreetMap contexts, 100 per context:
  - Dadar (Mumbai);
  - Lower Manhattan;
  - Midtown Manhattan;
  - the City of London;
  - Canary Wharf.

  Each architect asked for 1–4 towers. City-typical limits applied: FSI 4–15 × plot area, height
  120–320 m.
- **Two systems per site**, each evaluating its top 2 feasible candidates in full:
  - **Deterministic:** rule screening of the 540-typology library at 3 rotations.
  - **Probabilistic:** a cross-entropy token generator scored by the learned segment model.
- **Fallback.** When the requested number of towers could not stand 24 m apart, one fewer was used,
  and the architect was told.
- **No design.** 9 sites had no buildable area after setbacks. A few more had no feasible design from
  one system. That leaves **456 architects with both designs**.
- **Renders.** Every design was rendered in its real OSM context as one image:
  - two aerial views of a neutral warm-toned massing;
  - a strip of five floor plates labelled only with floor number and height.

  No scores, prices or unit counts appear. Design A/B labels were randomised per architect: the
  deterministic design was A 240 times and B 239 times.

## 2. Round 1: deterministic vs probabilistic (456 architects, blind)
| | Deterministic | Probabilistic | Equal |
|---|---|---|---|
| Preferred | **239** | 162 | 55 |
| Overall rating (1–10) | **5.85** | 5.58 | |
| View capture | 5.88 | 5.58 | |
| Privacy / overlooking | 5.97 | 5.71 | |
| Massing / silhouette | 5.80 | 5.51 | |
| Proportion | 6.51 | 6.38 | |
| Context fit | 5.72 | 5.70 | |
| Constructability | 7.37 | **7.54** | |

**By city (preferred det–prob–equal):**

| City | Det | Prob | Equal |
|---|---|---|---|
| Dadar | 48 | 25 | 11 |
| Lower Manhattan | 43 | 39 | 13 |
| Midtown | 44 | 40 | 10 |
| City of London | 59 | 29 | 5 |
| Canary Wharf | 45 | 29 | 16 |

**Engine metrics on the same designs (all sites):** premium share 0.51 (det) vs 0.50 (prob), living
view 0.58 vs 0.58. The systems are at parity on measured views. The architects preferred the
deterministic designs, mostly on massing and proportion.

**Engine vs architects.** They only partly agree:
- Spearman correlation between the engine's living-room view score and the architects' view-capture
  rating is 0.28; between premium share and view capture, 0.26.
- Engine compromised share vs the architects' privacy rating: 0.51.
- Where the engine sees a difference, the architects preferred the design with more premium flats in
  55.5 % of 339 decisive pairs.

The engine measures the view; architects judge the whole form (base, crown, proportion) as well.

**Moves the architects asked for** (floor-by-floor changes, fixed vocabulary):

| Move | Count |
|---|---|
| Corner gardens / cut-outs | 246 |
| Rotate plate to the outlook | 221 |
| Podium / base changes | 207 |
| Terraces toward the outlook | 167 |
| Crown / top articulation | 164 |
| Splay or offset to avoid facing | 155 |
| Taper more | 127 |
| Chamfer or round corners | 108 |
| Stagger / cantilever | 90 |
| Taller | 90 |
| Twist more | 83 |
| Twist less, simplify, more slender | fewer requests |

## 3. From critiques to the hybrid
1. **New tokens** (engine, `tokenPlate`):
   - base: a podium to the street wall;
   - crown: the top floors narrow, and may turn.
2. **Splay:** towers on a multi-tower site turn ±15° so they do not face each other (`siteLayout`,
   kept only if they still fit 24 m apart).
3. **Rotation search:** ±12° around the winner, fully evaluated.
4. **Appeal model** (`web/data/appeal_model.json`): ridge regression of the architects' overall
   rating on visible features (tokens, slenderness, aspect, towers, base type). 912 rated designs,
   held-out R² 0.18. Twists, shifts, terraces, corner cut-outs, curved or chamfered and winged plans
   rate higher; more towers rate lower. Podium and crown did not exist in round 1, so their weights
   come from the requested moves instead.
5. **Generator priors and objective** (`web/data/hybrid_weights.json`,
   `tools/study/feedback_to_weights.js`):
   - Each requested move votes for or against a token family, weighted by how unhappy the architect
     was with that design (10 − overall).
   - The votes shift the categorical priors: terraces toward the view 0.60, corner gardens 0.62,
     street podium 0.62, crowns 0.80.
   - Low privacy and low constructability ratings raise the privacy and complexity weights.
   - The appeal term is weighted 0.3.
   - The deterministic winner seeds the hybrid.

## 4. Engine A/B tests (measured, 120 NYC/London designs re-evaluated)
| Test | A | B |
|---|---|---|
| E1 skyline counts as a view (A) vs sea only (B) | premium 43 %, living view 0.56 | premium 14 %, living view 0.38 |
| E2 dense-city rules (A) vs Mumbai rules (B) | 27 % compromised, 26 designs with none | 55 % compromised, 4 designs with none |
| E3 facing distance advisory (A) vs hard 18 m (B) | 0 rejected | 10 of 120 rejected (median closest facing distance 49 m) |

A is the new default in all three.

## 5. Round 2: hybrid vs the round-1 winner (420 architects, blind)
Each architect saw the hybrid next to the **round-1 winner** for their own site: whichever of the
deterministic and probabilistic designs they themselves had preferred (`win1.json`). The round-1 winner
is chosen with hindsight, using that architect's round-1 vote, so it is a demanding baseline. Labels were
randomised (hybrid shown as A 241 times, B 239 times). 36 architects' panel results were incomplete.

| | Round-1 winner | Hybrid | Equal |
|---|---|---|---|
| Preferred | 187 | 185 | 48 |
| Overall rating (1–10) | 5.96 | 6.00 | |
| View capture | 6.01 | 5.98 | |
| Privacy / overlooking | 6.14 | 6.12 | |
| Massing / silhouette | 5.85 | **6.09** | |
| Proportion | **6.74** | 6.52 | |
| Context fit | 5.81 | 5.90 | |
| Constructability | **7.48** | 7.12 | |

**By city (preferred winner–hybrid–equal):** Dadar 32–34–10; Lower Manhattan 41–41–6; Midtown 41–37–8;
City of London 38–40–11; Canary Wharf 35–33–13.

**Reading.** The hybrid, with no hindsight, matched the best-of-both chosen with hindsight. It won on
massing and silhouette, and lost on proportion and constructability. Written reasons repeat these
points: "B is prettier but stunted"; "A is honest and buildable, B is noise". Engine–architect agreement
was again weak: Spearman 0.21–0.22 for view metrics vs view capture, 0.47 for compromised share vs
privacy. The preferred design had more premium flats in 55 % of 309 decisive pairs.

**Three faults found from round 2, fixed in hybrid v2:**
1. The constructability → complexity-weight update in `feedback_to_weights.js` sat inside a code
   comment and never ran. The complexity weight is now 0.21, up from 0.05.
2. The hybrid fully evaluated only its first two feasible candidates. The deterministic seed was
   appended last, so it was rarely evaluated.
3. "Taller" requests (83 in round 2, 90 in round 1) had no effect on the weights, and the appeal model
   had no height feature.

## 6. Hybrid v2
- **Candidates:** per site, the deterministic winner, the probabilistic winner and the two best designs
  generated under the round-1 + round-2 weights (`hybrid_weights_v2.json`, 1,752 critiqued designs) are
  all evaluated in full.
- **Ranking:** the usual engine ranking, then a **near-tie rule** (`TOK.appealPick`). Among best
  trade-offs within 5 % of the top option on sales value, 10 % on premium flats and +5 % of flats
  compromised, the one the appeal model rates highest goes first. The appeal model is refitted on both
  rounds with a height feature: n = 1,752, cross-validated R² 0.165. In the study it is **cross-fitted**:
  sites are split into 5 folds, and each site is scored by the model trained without its fold.
- **Rotation:** the ±12° rotation search is kept only when the rotated design is no worse on premium,
  compromised or value (within 2 %).
- **App:** the "Best of both, tuned by architects" mode does the same. The two best library designs and
  the two best plain generated designs compete with the tuned ones. The verdict says when the near-tie
  rule changed the order.

## 7. Round 3: hybrid v2 vs the round-1 winner
Appended when round 3 completes.
