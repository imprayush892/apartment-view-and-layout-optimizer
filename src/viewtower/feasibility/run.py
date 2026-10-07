"""Project driver: base reading plus sensitivity readings -> DXF, HTML viewer, JSON and a report.

Each reading's search results are cached in the output folder (keyed by a hash of its config), so an
interrupted run resumes where it stopped and a change of config reruns only what it affects."""
from __future__ import annotations

import json
import pickle
from pathlib import Path

from viewtower.config import deep_merge, stable_hash
from viewtower.feasibility import config as fconfig
from viewtower.feasibility.export import basis_json, scheme_json, site_json
from viewtower.feasibility.export_dxf import write_scheme_dxf
from viewtower.feasibility.export_html import write_viewer
from viewtower.feasibility.report import write_report
from viewtower.feasibility.search import ranked, search
from viewtower.feasibility.site import FeasibilitySite

QUICK = {"search": {"towers": [4, 5], "prefilter_keep": 60, "per_family": 1, "groupings_per_set": 1}}


def label_for(s) -> str:
    m = s.metrics
    pk = m.get("parking", {})
    margin = pk.get("total_supply", 0) - pk.get("total_demand", 0)
    variants = "/".join(sorted({t.plate.variant for t in s.towers}))
    fl = sorted(t.floors for t in s.towers)
    return (f"{len(s.towers)} towers {variants} · {fl[0]}–{fl[-1]} F · FSI {m['fsi']:.3f} · {m['flats']} flats · "
            f"cars {'+' if margin >= 0 else ''}{margin}")


def scatter_point(s, link: str | None) -> dict:
    m = s.metrics
    pk = m["parking"]
    short_vis = max(0, pk["visitor_need"] - pk["visitor_bays"])
    return {"scenario": s.scenario, "mode": s.mode, "fsi": m["fsi"], "flats": m["flats"], "towers": len(s.towers),
            "margin": pk["total_supply"] - pk["total_demand"] - short_vis,
            "mix_dev": m["mix_dev_pp"], "ne": m["facing_share"]["N"] + m["facing_share"]["E"], "max_h": m["max_height"],
            "link": link}


def run_project(cfg_path: str | Path, out_dir: str | Path, readings: list[str] | None = None, quick: bool = False,
                workers: int | None = None, progress=print) -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    base = fconfig.load(cfg_path, QUICK if quick else None)
    defs = [("base", "Base reading", {})]
    for k, v in (base.get("readings") or {}).items():
        if readings is None or k in readings:
            defs.append((k, v["label"], v["override"]))
    top_n = int(base["search"]["top_n"])
    variants, summary, files = {}, {}, []
    for name, label, ov in defs:
        cfg = fconfig.load(cfg_path, deep_merge(ov, QUICK) if quick else ov)
        site = FeasibilitySite.build(cfg)
        progress(f"== reading '{name}': {label}")
        cache = out / f".cache_{name}_{stable_hash(cfg)}.pkl"
        if cache.exists():
            res = pickle.loads(cache.read_bytes())
            progress(f"{name}: reusing {cache.name}")
        else:
            res = search(cfg, progress=progress, workers=workers)
            cache.write_bytes(pickle.dumps(res))
        vjson = {"label": label, "site": site_json(site, cfg), "schemes": {}, "scatter": []}
        summary[name] = {"label": label, "site": site.summary(), "best": {}}
        for sc, schemes in res.items():
            vjson["schemes"][sc] = {}
            links = {}
            for mode in ("target", "compliant"):
                top = ranked(schemes, mode, top_n)
                vjson["schemes"][sc][mode] = [scheme_json(s, cfg, label_for(s)) for s in top]
                for i, s in enumerate(top):
                    links[s.sid] = f"{sc}|{mode}|{i}"
                if top:
                    summary[name]["best"].setdefault(sc, {})[mode] = top
                    if name == "base":
                        for i, s in enumerate(top[:2]):
                            fn = out / f"{cfg.get('slug', 'scheme')}_{sc}_{mode}_{i + 1}.dxf"
                            write_scheme_dxf(fn, s, site, cfg, f"{cfg.get('project', '')} · {sc} · {mode} · option {i + 1}: {label_for(s)}")
                            files.append(fn)
            vjson["scatter"] += [scatter_point(s, links.get(s.sid)) for s in schemes]
        variants[name] = vjson
    data = {"title": f"{base.get('project', 'Feasibility')} · massing and unit-mix options",
            "subtitle": _subtitle(base), "basis": basis_json(base), "variants": variants, "notes": notes(base)}
    files.append(write_viewer(out / f"{base.get('slug', 'scheme')}_viewer.html", data))
    (out / f"{base.get('slug', 'scheme')}_results.json").write_text(json.dumps(data, indent=1, default=str), encoding="utf-8")
    files.append(out / f"{base.get('slug', 'scheme')}_results.json")
    files.append(write_report(out / f"{base.get('slug', 'scheme')}_report.md", base, summary))
    return {"files": [str(f) for f in files], "summary": summary}


def _subtitle(cfg: dict) -> str:
    f, b, p = cfg["fsi"], cfg["building"], cfg["parking"]
    return (f"FSI target {f['target']} (cap {f['cap']}) on the net plot · towers ≤ {b['max_height_m']:g} m · "
            f"{p['ratio']} cars a flat in basement + ground + stilt 1 · EIA green {cfg['eia']['green_ratio'] * 100:.0f}% · two podiums")


def notes(cfg: dict) -> list[str]:
    u, f, b, s, p, e = cfg["units"], cfg["fsi"], cfg["building"], cfg["setbacks"], cfg["parking"], cfg["eia"]
    return [
        f"Effective carpet includes balconies. Saleable super built-up = {u['loading']} × carpet (40% loading). "
        f"FSI built-up of a flat = {u['builtup_factor']} × carpet (walls).",
        "FSI counts flats (habitable rooms and balconies), lobbies, staircases and lift cores on every residential floor, "
        f"{f['gf_lobby_m2_per_core']} m² of ground-floor entrance lobby per core and the {f['clubhouse_m2']:g} m² clubhouse. "
        "Car parking, ramps and services do not count.",
        f"Facing follows the door: the direction you face when you step out of the main door. Plates are drawn true north up; "
        "no plate puts a door on a west-facing wall.",
        f"Height = {b['podium_height_m']} m podium (ground + stilt 1) + floors × {b['floor_to_floor_m']} m. "
        f"Setback {s['base_m']:g} m up to {s['base_height_m']:g} m, +{s['step_m']:g} m for every {s['step_height_m']:g} m above, all round; "
        "the front is measured from the road-widening line.",
        f"Refuge: the first floor above each of {b['refuge_thresholds_m']} m gives one flat (the least valued slot) to refuge, outside FSI.",
        f"EIA green belt: {e['green_ratio'] * 100:.0f}% of the net plot as a strip along the plot boundary, on natural ground: "
        "no parking, no driveway and (in the base reading) no basement under it. The OSR is gifted and not counted.",
        f"Towers on one podium are read as one block: at least {s['same_podium_gap_m']:g} m apart and facades closer than the "
        f"setback may face each other for {s['facing_overlap_max_m']:g} m at most. Towers on different podiums keep the full setback.",
        f"Parking: {p['ratio']} cars a flat in one basement, the ground floor and stilt 1, each phase parking its own flats; "
        f"{p['m2_per_car_basement']:g} m² a car in the basement and {p['m2_per_car_podium']:g} m² on the podium after cores, ramps and services. "
        f"Visitor bays ({p['visitor_ratio'] * 100:.0f}% of resident cars) sit between the fire driveway and the podium and in the gap between podiums.",
        "Each podium is one phase; phase 1 is at the front road and carries the clubhouse on part of stilt 1.",
    ]
