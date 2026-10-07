"""Markdown report: site, unit types, best schemes per scenario and reading, parking levers."""
from __future__ import annotations

from pathlib import Path

from viewtower.feasibility.search import unit_table

SCEN = {"segregated": "A · segregated towers (middle / upper-middle / luxury)", "mixed": "B · mixed towers",
        "targeted": "A · targeted towers (one price band each)"}
MODE = {"target": "floors set for the FSI target", "compliant": "every rule met, parking included"}


def _scheme_rows(s, cfg) -> list[str]:
    b = cfg["building"]
    rows = ["| Tower | Phase | Segment | Plate | W × D m | Floors | Height m | Setback m | Flats | Flats by type | H / width |",
            "|---|---|---|---|---|---|---|---|---|---|---|"]
    for t in s.towers:
        fb = ", ".join(f"{u}×{n}" for u, n in t.flats_by_type(b).items() if n)
        rows.append(f"| {t.name} | P{t.podium + 1} | {t.segment} | {t.plate.variant} | {t.plate.width:.1f} × {t.plate.depth:.1f} | "
                    f"{t.floors} | {t.height(b):.1f} | {_sb(t, cfg):.0f} | {t.n_flats(b)} | {fb} | "
                    f"{t.slenderness(b):.2f} |")
    return rows


def _sb(t, cfg):
    from viewtower.feasibility.site import setback_for_height
    return setback_for_height(t.height(cfg["building"]), cfg["setbacks"])


def write_report(path: str | Path, cfg: dict, summary: dict) -> Path:
    L = [f"# {cfg.get('project', 'Feasibility')}: massing and unit-mix options", ""]
    base = summary.get("base", {})
    st = base.get("site", {})
    L += ["## Site", "",
          f"- Gross plot {st.get('gross_m2', 0):,.0f} m²; road widening {st.get('widening_m2', 0):,.0f} m² "
          f"({cfg['site'].get('road_widening_m')} m); net plot (FSI basis) {st.get('net_m2', 0):,.0f} m².",
          f"- OSR {st.get('osr_m2', 0):,.0f} m² ({st.get('osr_ratio', 0) * 100:.1f}%), {st.get('osr_narrowest_width_m', '–')} m at the road.",
          f"- EIA green belt {st.get('green_m2', 0):,.0f} m² ({st.get('green_ratio', 0) * 100:.1f}%), {st.get('green_width_m', 0)} m all round.",
          f"- Fire driveway ring {st.get('driveway_m2', 0):,.0f} m²; podium envelope {st.get('podium_envelope_m2', 0):,.0f} m² a level; "
          f"basement envelope {st.get('basement_envelope_m2', 0):,.0f} m².", ""]
    L += ["## Unit types", "", "| Type | Unit | Carpet ft² | SBU ft² | Built-up m² | Share | Segment |", "|---|---|---|---|---|---|---|"]
    for u in unit_table(cfg):
        L.append(f"| {u['id']} | {u['label']} | {u['carpet_ft2']:,} | {u['sbu_ft2']:,.0f} | {u['builtup_m2']:.1f} | {u['share'] * 100:.0f}% | {u['segment']} |")
    L.append("")
    for name, rd in summary.items():
        L += [f"## Reading: {rd['label']}", ""]
        for sc, modes in rd["best"].items():
            for mode, top in modes.items():
                s = top[0]
                m = s.metrics
                pk = m["parking"]
                L += [f"### {SCEN.get(sc, sc)}, {MODE.get(mode, mode)}", "",
                      f"FSI **{m['fsi']:.3f}** ({m['fsi_m2']:,.0f} m²) · {m['flats']} flats · SBU {m['sbu_ft2'] / 1e5:.2f} lakh ft² · "
                      f"tallest {m['max_height']:.1f} m · mix within {m['mix_dev_pp']:.1f} pp · doors N {m['facing']['N']}, E {m['facing']['E']}, "
                      f"S {m['facing']['S']}, W {m['facing']['W']} · cars {pk['total_supply']}/{pk['total_demand']} "
                      f"(P1 {pk['supply'][0]}/{pk['demand'][0]}, P2 {pk['supply'][1]}/{pk['demand'][1]}) · visitor bays {pk['visitor_bays']}/{pk['visitor_need']}", ""]
                n = m["flats"] or 1
                L += ["Mix: " + " · ".join(f"{t['label']} ({t['id']}) {m['mix_counts'].get(t['id'], 0)} = "
                                          f"{m['mix_counts'].get(t['id'], 0) / n * 100:.1f}% (target {t['share'] * 100:.0f}%)"
                                          for t in cfg["units"]["types"]), ""]
                if name == next(iter(summary)):
                    L += _scheme_rows(s, cfg) + [""]
                    lv = m.get("levers")
                    if mode == "target" and lv and lv["shortfall_cars"] > 0:
                        L += [f"Parking gap {lv['shortfall_cars']} cars. Any one closes it: a second basement of about "
                              f"{lv['second_basement_m2']:,} m² ({lv['second_basement_share'] * 100:.0f}% of the basement footprint); "
                              f"{lv['stackers_in_basement']} two-level stackers ({lv['stacker_share_of_basement_bays'] * 100:.0f}% of basement bays); "
                              f"part second stilt of {lv['stilt2_m2']:,} m². Running the basement under the EIA belt, if the EIA allows it, gives up to "
                              f"{lv['basement_under_green_cars']} cars.", ""]
    Path(path).write_text("\n".join(L) + "\n", encoding="utf-8")
    return Path(path)
