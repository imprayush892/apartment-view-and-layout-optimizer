# 15 — UX Study: Four Rounds of 50 Designers, with A/B Tests

Each round, 50 UI/UX designers reviewed the app from real screenshots only. They are AI role-played
personas (5 panels × 10), varied by specialism, seniority and home market. In each round they:
- rated the new version 1–5 on clarity, ease, visual quality, trust and mobile;
- gave overall 1–10 scores to the previous release and the versions in the round;
- listed issues with a severity and a fix;
- voted on three UI A/B tests.

Every issue list was worked through before the next round. Raw results are in `data/study/`:
`ux_review.json`, `ux_review_final.json`, `ux_review_r3.json` and `ux_review_r4.json`.

## Overall scores (1–10, same panel rating every version it saw)
| Round | Previous release | Earlier version in round | New version | Gap vs previous release |
|---|---|---|---|---|
| 1 | 6.24 | — | 6.26 | +0.02 |
| 2 | 5.82 | first draft 5.50 | 6.46 | +0.64 |
| 3 | 5.42 | round-2 version 5.68 | 7.00 | +1.58 |
| 4 | 4.90 | round-3 version 6.60 | **7.34** | **+2.44** |

The previous release's score drifts downward from panel to panel as the comparison set gets stronger,
so the within-panel gap is the measure that matters. In round 4, all 50 designers scored the new
version above the previous release, and 31 of 50 scored it above the round-3 version. Asked whether it
is a real upgrade over the previous release, 17 said "yes, clearly" and 33 "somewhat"; none said "no".

Round-4 ratings of the new version (1–5): clarity 3.92, ease 3.68, visual 3.84, trust 3.84, mobile 3.0.
Mobile is the weakest area.

## A/B tests (A = older variant, B = newer variant)
| Round | Test | A | B | No preference | Adopted |
|---|---|---|---|---|---|
| 1 | Search method: dropdown vs described cards | 0 | 50 | 0 | B |
| 1 | 3D coloured by view class vs neutral massing | 42 | 4 | 4 | A, plus a legend |
| 1 | Technical vs plain design wording | 0 | 48 | 2 | B |
| 2 | Technical vs plain design names | 0 | 50 | 0 | B |
| 2 | Floating phone pills vs reordered phone page | 0 | 50 | 0 | B |
| 2 | Options table only vs value/compromised chart | 0 | 46 | 4 | B |
| 3 | Verdict paragraph vs structured verdict (headline, counts, tower table) | 0 | 50 | 0 | B |
| 3 | Red ✗ for an advisory rule vs amber "advisory" | 0 | 50 | 0 | B |
| 3 | Chart from 0 % vs fitted chart with currency axis | 0 | 49 | 1 | B |
| 4 | Close grey first view vs overview with the plot marked | 0 | 50 | 0 | B |
| 4 | KPIs and exports above the 3D vs verdict → 3D → numbers | 0 | 50 | 0 | B |
| 4 | Red "% compromised" pill vs "why still best" explanation | 0 | 50 | 0 | B |

## What changed, round by round
1. **Round 1 → 2**
   - City currency ($, £, ₹).
   - Plain design wording.
   - Method cards.
   - Per-tower verdict.
   - Options chart.
   - Per-tower rule checks.
   - Folding setback list with "same setback on every side".
   - Sticky Run button.
   - Phone order.
   - 3D legend.
2. **Round 2 → 3**
   - Structured verdict: headline, colour-coded counts, one line, tower table.
   - Advisory rules shown as advisory.
   - Fitted chart with a currency axis and filled vs hollow dots.
   - One vocabulary: strong view / good / ordinary / compromised, flats.
   - KPIs show the site and the limits used.
   - Scrolling tab row on phone.
   - Camera that picks an unobstructed direction, with T1/T2 labels.
   - Card depth and tabular numbers.
3. **Round 3 → 4**
   - Overview camera before a run, from the sunlit, unobstructed side, with the plot marked.
   - Legend cleared when the site changes.
   - "Why still best" explanation.
   - Advisory "Check" badge.
   - Larger pill text.
   - Verdict → 3D → numbers → exports on every screen.
   - Tab fade on phone.
4. **After round 4**
   - The "why still best" callout names the alternative.
   - Orange plot marker, which does not blend with water.
   - Darker badge text.
   - Phone legend clear of the attribution.
   - Chart labels offset from the dots.

## Test-harness note
Headless Chromium in the test container could not reach Google Fonts, so rounds 1–2 screenshots show
fallback fonts. From round 3 on, the fonts were served locally for screenshots. The published app loads
them from Google Fonts. The round-3 panel was told this.

## Still open
- Mobile: a long input form after the results.
- The left input column stays full length after a run.
- Some facts repeat across the verdict, KPIs and the Design tab.
- Strong and good views are told apart by purple lightness only.
- The flat grey city has no ambient occlusion.
- Placeholder prices are shown prominently.
- Water moiré in the software renderer used for screenshots.
