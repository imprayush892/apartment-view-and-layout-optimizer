"""Markdown report: site, unit types, best schemes per scenario and reading, parking levers."""
from __future__ import annotations

from pathlib import Path

from viewtower.feasibility.search import type_dev_pp, unit_table

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


def _room_section(cfg: dict, rooms: dict) -> list[str]:
    """Room schedule per unit type (from its first flat that meets every rule) and the checks."""
    units = {t["id"]: t for t in cfg["units"]["types"]}
    flats = [lay for pr in rooms.values() for lay in pr["flats"].values()]
    ok = [lay for lay in flats if lay["ok"]]
    L = ["## Room layouts", "",
         "Each flat of the leading schemes is laid out room by room on a 0.3 m grid (CP-SAT) under NBC 2016 Part 3 "
         "rules: every habitable room has a window of at least a tenth of its floor area and no point more than "
         "7.5 m from it; every toilet a ventilator on the facade or on a shared ventilation shaft (open to sky, "
         f"{cfg['rooms']['shaft_w_m']} x {cfg['rooms']['shaft_d_m']} m, with mechanical exhaust above 30 m); the "
         "kitchen a window or an exterior utility; every room reached from the foyer through the living, dining or "
         "passage, with attached toilets off their bedroom; bedrooms at least 9.5 / 7.5 m², kitchen 5 m², bath + WC "
         "2.8 m² (net of walls); passages 1.05 m and balconies 1.35 m clear. Vastu placements are preferences, not rules.", "",
         f"**{len(ok)} of {len(flats)} flat layouts meet every rule.**", ""]
    for lay in flats:
        if not lay["ok"]:
            bad = [t for good, t in lay["checks"] if not good] or ["no layout found"]
            L.append(f"- {lay['slot']} {lay['unit']}: " + "; ".join(bad))
    if len(ok) < len(flats):
        L.append("")
    for u, t in units.items():
        lay = next((x for x in ok if x["unit"] == u), None) or next((x for x in flats if x["unit"] == u and x["rooms"]), None)
        if lay is None:
            continue
        nominal = t["carpet_ft2"] / 10.7639
        vastu = ", ".join(k.replace("_", " ") for k, v in lay["vastu"].items() if v)
        L += [f"### {t['label']} ({u}), {lay['slot']} flat: carpet in plan {lay['carpet_m2']:.1f} m² "
              f"({lay['carpet_m2'] * 10.7639:,.0f} ft²) against {nominal:.1f} m² nominal", "",
              "| Room | Net size m | Net m² | Light and air |", "|---|---|---|---|"]
        for r in lay["rooms"]:
            air = ("window onto the balcony" if r.get("through_balcony") else "window") if r["windows"] else \
                "ventilator" if r["vents"] else "balcony door" if r["code"] == "LIV" else \
                "through the utility" if r["code"] == "KIT" else ""
            L.append(f"| {r['label']} | {max(0, r['w'] - 0.15):.2f} × {max(0, r['d'] - 0.15):.2f} | {r['net_m2']:.1f} | {air} |")
        L += ["", f"Vastu: {vastu or 'none of the preferred placements'}.", ""]
    return L


def write_report(path: str | Path, cfg: dict, summary: dict, rooms: dict | None = None) -> Path:
    L = [f"# {cfg.get('project', 'Feasibility')}: massing and unit-mix options", ""]
    base = summary.get("base") or next(iter(summary.values()), {})
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
                      f"tallest {m['max_height']:.1f} m · every unit type within {type_dev_pp(m['mix_counts'], cfg):.1f} pp of its share · doors N {m['facing']['N']}, E {m['facing']['E']}, "
                      f"S {m['facing']['S']}, W {m['facing']['W']} · cars {pk['total_supply']}/{pk['total_demand']} "
                      + (f"(P1 {pk['supply'][0]}/{pk['demand'][0]}, P2 {pk['supply'][1]}/{pk['demand'][1]}) " if pk['demand'][1] else "(one podium) ")
                      + f"· visitor bays {pk['visitor_bays']}/{pk['visitor_need']}", ""]
                n = m["flats"] or 1
                L += ["Mix: " + " · ".join(f"{t['label']} ({t['id']}) {m['mix_counts'].get(t['id'], 0)} = "
                                          f"{m['mix_counts'].get(t['id'], 0) / n * 100:.1f}% (target {t['share'] * 100:.0f}%)"
                                          for t in cfg["units"]["types"]), ""]
                lvls = pk.get("basement_levels") or [[], []]
                if max(len(x) for x in lvls) > 1:
                    used = [g for g in (0, 1) if pk["demand"][g] or pk["supply"][g]]
                    L += ["Cars by level: " + " · ".join(
                        f"P{g + 1} " + ", ".join(f"B{k + 1} {n}" for k, n in enumerate(lvls[g])) + f", GF {pk['gf'][g]}, stilt 1 {pk['s1'][g]}"
                        for g in used) + f". Visitors: {pk.get('visitor_bays_setback', pk['visitor_bays'])} in the setbacks"
                        + (f", {sum(pk.get('visitor_basement', [0, 0]))} in the basement" if sum(pk.get('visitor_basement', [0, 0])) else "")
                        + ". Lower basement needed: " + ", ".join(
                            f"P{g + 1} {pk['lower_needed_m2'][g]:,} m² of {pk['lower_basement_m2'][g]:,.0f} m² built "
                            f"(spare {pk['supply'][g] - pk['demand'][g]} cars)" for g in used) + ".", ""]
                if name == next(iter(summary)):
                    L += _scheme_rows(s, cfg) + [""]
                    lv = m.get("levers")
                    if mode == "target" and lv and lv["shortfall_cars"] > 0:
                        L += [f"Parking gap {lv['shortfall_cars']} cars. Any one closes it: another basement level of about "
                              f"{lv['second_basement_m2']:,} m² ({lv['second_basement_share'] * 100:.0f}% of the basement footprint); "
                              f"{lv['stackers_in_basement']} two-level stackers ({lv['stacker_share_of_basement_bays'] * 100:.0f}% of basement bays); "
                              f"part second stilt of {lv['stilt2_m2']:,} m². Running the basement under the EIA belt, if the EIA allows it, gives up to "
                              f"{lv['basement_under_green_cars']} cars.", ""]
    if rooms:
        L += _room_section(cfg, rooms)
    Path(path).write_text("\n".join(L) + "\n", encoding="utf-8")
    return Path(path)
