"""JSON views of the site, plates and schemes (shared by the HTML viewer and the reports)."""
from __future__ import annotations

from viewtower.feasibility.layout import Tower
from viewtower.feasibility.plates import Plate
from viewtower.feasibility.search import Scheme, unit_table
from viewtower.feasibility.site import FeasibilitySite, building_height, setback_for_height


def rings(geom, nd: int = 3) -> list[list[list[float]]]:
    """Exterior rings of a (multi)polygon as [[x, y], ...] lists, last point not repeated."""
    if geom is None or geom.is_empty:
        return []
    out = []
    for p in getattr(geom, "geoms", [geom]):
        if p.geom_type != "Polygon" or p.is_empty:
            continue
        out.append([[round(x, nd), round(y, nd)] for x, y in list(p.exterior.coords)[:-1]])
    return out


def site_json(site: FeasibilitySite, cfg: dict) -> dict:
    sb = cfg["setbacks"]
    b = cfg["building"]
    env = {}
    for floors in range(int(b["min_floors"]) - 6, 30):
        h = building_height(floors, b)
        if h > float(b["max_height_m"]) + 3 * float(b["floor_to_floor_m"]):
            break
        s = setback_for_height(h, sb)
        if f"{s:g}" not in env:
            env[f"{s:g}"] = rings(site.tower_envelope(h))
    return {
        "summary": site.summary(),
        "gross": rings(site.gross), "widening": rings(site.widening), "net": rings(site.net),
        "osr": rings(site.osr), "green": rings(site.green), "driveway": rings(site.driveway),
        "podium_env": rings(site.podium_env), "basement_env": rings(site.basement_env),
        "widening_line": [[round(x, 2), round(y, 2)] for x, y in site.widening_line.coords],
        "envelopes": env,
        "front_road": cfg["site"].get("front_road"), "rear_road": cfg["site"].get("rear_road"),
    }


def plate_json(p: Plate, rooms: dict | None = None) -> dict:
    """A plate in its local frame; ``rooms`` is its room layout (:func:`rooms.layout_plate`), if any."""
    return {
        "key": p.key, "variant": p.variant, "arm_depth": p.arm_depth, "end_width": p.end_width,
        "width": round(p.width, 2), "depth": round(p.depth, 2), "area_m2": round(p.area_m2, 2),
        "circulation_m2": round(p.circulation_m2, 2), "efficiency": round(p.efficiency, 4),
        "refuge_slot": p.refuge_slot,
        "footprint": rings(p.footprint), "hub": rings(p.hub), "core": [r for c in p.core for r in rings(c)],
        "lobby": rings(p.lobby),
        "flats": [{"slot": f.slot, "unit": f.unit, "area_m2": round(f.area_m2, 2), "poly": rings(f.poly)[0],
                   "door": [[round(x, 2), round(y, 2)] for x, y in f.door], "door_dir": f.door_dir,
                   "outlook": f.outlook, "exterior_m": f.exterior_m} for f in p.flats],
        "rooms": rooms,
    }


def tower_json(t: Tower, cfg: dict) -> dict:
    b = cfg["building"]
    h = t.height(b)
    return {
        "name": t.name, "podium": t.podium, "segment": t.segment, "floors": t.floors,
        "x": round(t.x, 3), "y": round(t.y, 3), "height": h,
        "setback": setback_for_height(h, cfg["setbacks"]), "refuges": t.refuges(b),
        "plate": t.plate.key, "flats_by_type": t.flats_by_type(b), "flats": t.n_flats(b),
        "fsi_m2": round(t.fsi_m2(b, float(cfg["fsi"]["gf_lobby_m2_per_core"])), 1),
        "slenderness": round(t.slenderness(b), 2),
    }


def scheme_json(s: Scheme, cfg: dict, label: str = "", rooms: dict | None = None) -> dict:
    lay = s.layout
    return {
        "id": s.sid, "label": label, "scenario": s.scenario, "mode": s.mode, "score": s.score,
        "penalties": s.penalties, "metrics": s.metrics, "sensitivity": s.sensitivity,
        "towers": [tower_json(t, cfg) for t in s.towers],
        "plates": {t.plate.key: plate_json(t.plate, (rooms or {}).get(t.plate.key)) for t in s.towers},
        "layout": {"y_split": round(lay.y_split, 2) if lay.y_split is not None else None, "podiums": [rings(p) for p in lay.podiums],
                   "gap_band": rings(lay.gap_band), "visitor_strips": [r for v in lay.visitor_strips for r in rings(v)],
                   "visitor_bays": lay.visitor_bays},
    }


def basis_json(cfg: dict) -> dict:
    keep = ("fsi", "building", "setbacks", "access", "parking", "eia", "osr", "facing")
    return {"project": cfg.get("project", ""), "units": unit_table(cfg), **{k: cfg[k] for k in keep},
            "loading": cfg["units"]["loading"], "builtup_factor": cfg["units"]["builtup_factor"]}
