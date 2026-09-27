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

## 5. Round 2: hybrid vs the round-1 winner (456 architects, blind)
Each architect saw the hybrid next to the **round-1 winner** for their own site: whichever of the
deterministic and probabilistic designs they themselves had preferred (`win1.json`). The round-1 winner
is chosen with hindsight, using that architect's round-1 vote, so it is a demanding baseline. Labels were
randomised (hybrid shown as A 241 times, B 239 times).

| | Round-1 winner | Hybrid | Equal |
|---|---|---|---|
| Preferred | 205 | 198 | 53 |
| Overall rating (1–10) | 5.97 | 5.99 | |
| View capture | 6.02 | 5.97 | |
| Privacy / overlooking | 6.16 | 6.13 | |
| Massing / silhouette | 5.86 | **6.08** | |
| Proportion | **6.74** | 6.49 | |
| Context fit | 5.82 | 5.88 | |
| Constructability | **7.46** | 7.10 | |

**By city (preferred winner–hybrid–equal):** Dadar 35–38–11; Lower Manhattan 45–44–6; Midtown 47–38–9;
City of London 41–41–11; Canary Wharf 37–37–16.

**Reading.** The hybrid, with no hindsight, matched the best-of-both chosen with hindsight. It won on
massing and silhouette, and lost on proportion and constructability. Written reasons repeat these
points: "B is prettier but stunted"; "A is honest and buildable, B is noise". Engine–architect agreement
was again weak: Spearman 0.23 for view metrics vs view capture, 0.48 for compromised share vs
privacy. The preferred design had more premium flats in 55.5 % of 337 decisive pairs.

**Three faults found from round 2, fixed in hybrid v2:**
1. The constructability → complexity-weight update in `feedback_to_weights.js` sat inside a code
   comment and never ran. The complexity weight is now 0.22, up from 0.05.
2. The hybrid fully evaluated only its first two feasible candidates. The deterministic seed was
   appended last, so it was rarely evaluated.
3. "Taller" requests (87 in round 2, 90 in round 1) had no effect on the weights, and the appeal model
   had no height feature.

## 6. Hybrid v2
- **Candidates:** per site, the deterministic winner, the probabilistic winner and the two best designs
  generated under the round-1 + round-2 weights (`hybrid_weights_v2.json`, 1,824 critiqued designs) are
  all evaluated in full.
- **Ranking:** the usual engine ranking, then a **near-tie rule** (`TOK.appealPick`). Among best
  trade-offs within 5 % of the top option on sales value, 10 % on premium flats and +5 % of flats
  compromised, the one the appeal model rates highest goes first. The appeal model is refitted on both
  rounds with a height feature: n = 1,824, cross-validated R² 0.16. In the study it is **cross-fitted**:
  sites are split into 5 folds, and each site is scored by the model trained without its fold.
- **Rotation:** the ±12° rotation search is kept only when the rotated design is no worse on premium,
  compromised or value (within 2 %).
- **App:** the "Best of both, tuned by architects" mode does the same. The two best library designs and
  the two best plain generated designs compete with the tuned ones. The verdict says when the near-tie
  rule changed the order.

## 7. Round 3: hybrid v2 vs the round-1 winner (456 architects, blind)
Labels were randomised: hybrid v2 was A 250 times, B 231 times, balanced by a 32-bit hash per comparison.

| | Round-1 winner | Hybrid v2 | Equal |
|---|---|---|---|
| Preferred | **206** | 129 | 121 |
| Overall rating | **6.06** | 5.88 | |
| Privacy / overlooking | **6.16** | 5.89 | |
| Massing / silhouette | **6.04** | 5.82 | |
| Constructability | 7.34 | 7.38 | |

Hybrid v2 lost. On the engine's own metrics it had been better than the round-1 winner: premium share
0.532 vs 0.511, compromised 17.8 % vs 19.6 %, value +10 %. The breakdown shows why:

| Hybrid v2 showed… | Sites | Winner–hybrid–equal |
|---|---|---|
| exactly the round-1 winner (control) | 68 | 0–2–66 |
| the design this architect **rejected** in round 1 (engine preferred it) | 180 | 120–50–10 |
| the round-1 winner rotated ±12° | 138 | 56–42–40 |
| a **newly generated** design | 70 | 30–**35**–5 |

- **Control.** The identical pairs were rated equal 66 times out of 68, so the panels are consistent.
- **Engine vs taste.** Where the engine picked the design the architect had already rejected, it lost
  again, 120 to 50. The engine's view and value metrics predict which of two designs an architect
  prefers only **53 %** of the time: premium share 52.9 %, value 53.6 %, over 401 round-1 pairs. The
  cross-fitted **appeal model predicts it 70 %** of the time (79 % when confident), and 61 % on the
  closer round-3 pairs.
- **Rotation.** The ±12° rotation step made designs worse in the architects' eyes.
- **New designs.** Newly generated designs beat even the hindsight-chosen winner.

## 8. Hybrid v3
- **Appeal rule widened (`TOK.appealPick`).** Among feasible options within 15 % of the engine's top
  option on sales value, within 30 points on premium share and at most 10 % of flats more compromised,
  the one with the highest predicted appeal goes first. Offline on round-1 pairs, this raises agreement
  with the architect's own pick from about 50 % to 63 % at a cost of 1.7 % in value, with premium share
  unchanged (tolerance sweep: 5 % → 57.5 %, 10 % → 61.6 %, 15 % → 63.4 %, 25 % → 64.5 %).
- **Rotation step dropped.**
- **Retrained:** weights and appeal model on all 2,736 critiqued designs from three rounds
  (`hybrid_weights_v3.json`; appeal cross-validated R² 0.13).
- **App:** "Best of both" uses the v3 rule. When the rule changes the order, the design detail says so
  and gives the 70 % / 53 % evidence.

## 9. Round 4: hybrid v3 vs the round-1 winner (456 architects, blind)
Hybrid v3's designs were newly generated at 181 sites, taken from the deterministic system at 139 and
from the probabilistic system at 136. At 161 sites it picked exactly the design the architect had
preferred in round 1. On engine metrics it matches the round-1 winner: premium share 0.513 vs 0.511,
compromised 19.0 % vs 19.6 %, value +7 %.

| | Round-1 winner | Hybrid v3 | Equal |
|---|---|---|---|
| Preferred | 148 | 141 | 167 |
| Overall rating | 5.85 | **5.90** | |
| View capture | 5.86 | **5.93** | |
| Massing / silhouette | 5.79 | **6.04** | |
| Privacy / overlooking | **6.05** | 5.89 | |
| Proportion | **6.70** | 6.54 | |
| Constructability | **7.43** | 6.93 | |

| Hybrid v3 showed… | Sites | Winner–hybrid–equal |
|---|---|---|
| exactly the round-1 winner (control) | 161 | 1–3–157 |
| a **newly generated** design | 181 | 75–**102**–4 |
| the design this architect rejected in round 1 | 112 | 72–34–6 |

**By city (winner–hybrid–equal):** Lower Manhattan 26–33–36; Canary Wharf 28–33–29;
City of London 33–29–31; Midtown 30–25–39; Dadar 31–21–32.

## 10. What the four rounds show
| Round | Comparison | Preferred | Overall rating |
|---|---|---|---|
| 1 | deterministic vs probabilistic | 239 – 162 (55 equal) | 5.85 vs 5.58 |
| 2 | round-1 winner vs hybrid v1 | 205 – 198 (53 equal) | 5.97 vs 5.99 |
| 3 | round-1 winner vs hybrid v2 | 206 – 129 (121 equal) | 6.06 vs 5.88 |
| 4 | round-1 winner vs hybrid v3 | 148 – 141 (167 equal) | 5.85 vs **5.90** |

- **The baseline is demanding.** The round-1 winner is each architect's own preferred design from
  round 1, chosen with hindsight. The hybrid has no access to that choice.
- **Where the hybrid now stands.** Hybrid v3 ties this baseline on preference, rates slightly higher
  overall, and wins on massing and view capture.
- **Where the gain is.** The new designs it invents beat the hindsight winner 102 to 75 (58 % of
  decisive votes).
- **Its remaining loss is a selection effect.** It sometimes shows an architect the design that same
  architect already rejected. In real use there is no earlier rejection, and the choice goes to the
  architect.
- **Main lesson.** The engine's view and value numbers barely predict which design an architect
  prefers: about 53 % pairwise, and Spearman 0.2–0.3 against view-capture ratings. A simple model of
  visible form predicts it about 70 % of the time.
- **What the app does with this.** It measures views with the engine, enforces the hard rules with the
  engine, and uses architect appeal to choose among designs that are nearly equal on the numbers. It
  explains every such choice.
- **Remaining weakness: constructability.** Hybrid designs rated 6.93 vs 7.43, because invented towers
  twist and shift more. The complexity weight rose from 0.05 to 0.23 across the rounds. A stronger
  simplicity prior is the next step.

All critiques: `data/study/critiques_r1.json` to `critiques_r4.json`. The architects are AI-simulated
personas, and the results are a structured design review, not market research.
