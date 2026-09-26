"""Candidate enumeration, hard-rule filtering, evaluation and ranking (docs/spec/09)."""
from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from shapely.geometry import Polygon

from viewtower.config import stable_hash
from viewtower.context.scene import RasterScene
from viewtower.evaluation import economics
from viewtower.evaluation.classify import CLASSES, classify
from viewtower.geometry.site import Site
from viewtower.optimize.pareto import nondominated_ranks, presentation_key
from viewtower.rules.registry import RuleRegistry
from viewtower.typology import generators as gen
from viewtower.typology.structure import core_area, max_overhang, perimeter_points, structure
from viewtower.units.subdivide import Unit, build_units
from viewtower.view.engine import RayParams
from viewtower.view.quality import QualityWeights, SiteViewField, evaluate_apertures


# ----------------------------------------------------------------------------- enumeration
def _grid(values) -> list:
    return list(values) if isinstance(values, (list, tuple)) else [values]


def _positions(site: Site, spec_pos) -> list[tuple[float, float]]:
    c = site.envelope.centroid
    if spec_pos in (None, "centroid"):
        return [(round(c.x, 3), round(c.y, 3))]
    step = float(spec_pos["grid_step_m"])
    reach = int(spec_pos.get("steps", 2))
    return [(round(c.x + i * step, 3), round(c.y + j * step, 3))
            for i in range(-reach, reach + 1) for j in range(-reach, reach + 1)]


def enumerate_specs(cfg: dict, site: Site) -> list[gen.TowerSpec]:
    s = cfg["search"]
    specs = []
    for fam in s["typologies"]:
        params = fam.get("params", {})
        pkeys = sorted(params)
        pgrid = list(itertools.product(*[_grid(params[k]) for k in pkeys])) or [()]
        widths = _grid(fam["width"])
        depths = _grid(fam.get("depth", [None]))
        for w, d, pv, rot, pos, ftf, pod, upf in itertools.product(
                widths, depths, pgrid, _grid(fam.get("rotation_deg", s["rotation_deg"])),
                _positions(site, s.get("position")), _grid(s["floor_to_floor_m"]),
                _grid(fam.get("podium_floors", s["podium_floors"])),
                _grid(fam.get("units_per_floor", s["units_per_floor"]))):
            specs.append(gen.TowerSpec(fam["typology"], float(w), float(d if d is not None else w),
                                       gen.freeze(dict(zip(pkeys, pv))), pos, float(rot), float(ftf),
                                       n_floors=0, podium_floors=int(pod), units_per_floor=int(upf)))
    return specs


def resolve_floors(spec: gen.TowerSpec, cfg: dict) -> gen.TowerSpec:
    """n_floors = 'auto': as many floors as max height and consumable FSI allow."""
    lim = cfg["limits"]
    by_height = int(math.floor(lim["max_height_m"] / spec.floor_to_floor_m + 1e-9))
    requested = cfg["search"].get("n_floors", "auto")
    cap = by_height if requested == "auto" else min(by_height, int(requested))
    reserved = set(cfg["limits"].get("reserved_levels", []))
    used, n = 0.0, spec.podium_floors
    probe = gen.TowerSpec(**{**spec.__dict__, "n_floors": cap})
    for level in range(spec.podium_floors, cap):
        area = 0.0 if level in reserved else gen.local_plate(probe, level).area
        if used + area > lim["max_fsi_area_m2"]:
            break
        used += area
        n = level + 1
    return gen.TowerSpec(**{**spec.__dict__, "n_floors": n})


# ----------------------------------------------------------------------------- evaluation
@dataclass
class Evaluation:
    candidate_id: str
    spec: gen.TowerSpec
    feasible: bool
    violations: list[str] = field(default_factory=list)
    checks: dict[str, Any] = field(default_factory=dict)
    metrics: dict[str, float] = field(default_factory=dict)
    units: list[Unit] = field(default_factory=list)
    plates: dict[int, Polygon] = field(default_factory=dict)
    cores: dict[int, Polygon] = field(default_factory=dict)
    columns: dict[int, np.ndarray] = field(default_factory=dict)
    rank: int | None = None
    explanation: list[str] = field(default_factory=list)
    evaluated_levels: list[int] = field(default_factory=list)


def _signature(poly: Polygon) -> tuple:
    c = np.asarray(poly.exterior.coords)
    edges = np.round(np.hypot(*np.diff(c, axis=0).T), 2)
    return (round(poly.area, 1), tuple(sorted(edges.tolist())))


def _core_offset_dir(view_field: SiteViewField | None) -> float | None:
    if view_field is None or view_field.premium_arc is None:
        return None
    a0, a1 = view_field.premium_arc
    span = (a1 - a0) % 360
    return (a0 + span / 2 + 180.0) % 360.0          # away from the premium arc


def check_candidate(spec: gen.TowerSpec, site: Site, cfg: dict, rules: RuleRegistry,
                    view_field: SiteViewField | None, core_offset_m: float = 0.0) -> Evaluation:
    """Cheap hard-rule checks (no view computation)."""
    cid = stable_hash({**spec.to_dict(), "core_offset_m": core_offset_m})
    ev = Evaluation(cid, spec, True)
    lim = cfg["limits"]
    if spec.n_floors <= spec.podium_floors:
        ev.violations.append("ENV-FSI-01")
        ev.checks["ENV-FSI-01"] = "no saleable floor fits the FSI area"
        ev.feasible = False
        return ev
    reserved = set(lim.get("reserved_levels", []))
    env = site.envelope.buffer(1e-3)
    off_dir = _core_offset_dir(view_field)
    c_area = core_area(spec.units_per_floor, cfg["core"])
    sig_counts: dict[tuple, int] = {}
    fsi_used, prev = 0.0, None
    worst_env, worst_cant = 0.0, 0.0
    for level in range(spec.n_floors):
        p = gen.plate(spec, level)
        ev.plates[level] = p
        if not env.contains(p):
            worst_env = max(worst_env, p.difference(site.envelope).area)
        if prev is not None:
            worst_cant = max(worst_cant, max_overhang(p, prev))
        prev = p
        if level >= spec.podium_floors:
            ev.cores[level] = gen.core(spec, level, c_area, core_offset_m, off_dir)
            if level not in reserved:
                fsi_used += p.area
            sig = _signature(gen.local_plate(spec, level) if spec.typology != "twisted" else
                             gen.local_plate(gen.TowerSpec(**{**spec.__dict__, "typology": spec.p.get("base", "square")}), level))
            sig_counts[sig] = sig_counts.get(sig, 0) + 1

    def hard(rule_id: str, ok: bool, detail: str):
        ev.checks[rule_id] = detail
        if not ok:
            ev.violations.append(rule_id)

    hard("ENV-ENVELOPE-01", worst_env <= 1e-6, f"area outside envelope {worst_env:.2f} m2")
    hard("ENV-HEIGHT-01", spec.height_m <= lim["max_height_m"] + 1e-9, f"{spec.height_m:.1f} <= {lim['max_height_m']}")
    hard("ENV-FSI-01", fsi_used <= lim["max_fsi_area_m2"] + 1e-6, f"{fsi_used:.0f} <= {lim['max_fsi_area_m2']}")
    hard("GR-CANT-01", worst_cant <= rules.value("GR-CANT-01") + 1e-9, f"max overhang {worst_cant:.2f} m")

    tower = [l for l in range(spec.podium_floors, spec.n_floors)]
    probe_levels = sorted({tower[0], tower[len(tower) // 2], tower[-1]})
    ratio_lim, fit = rules.value("GR-CORE-RATIO-01"), rules.value("GR-CORE-FIT-01")
    worst = {"ratio_lo": 1.0, "ratio_hi": 0.0, "depth": 0.0, "span": 0.0, "fit": True, "min_depth": 1e9}
    for level in probe_levels:
        p, c = ev.plates[level], ev.cores[level]
        r = c.area / p.area
        worst["ratio_lo"], worst["ratio_hi"] = min(worst["ratio_lo"], r), max(worst["ratio_hi"], r)
        worst["fit"] &= p.buffer(-fit).contains(c)
        st = structure(p, c, cfg["structure"]["perimeter_spacing_m"])
        ev.columns[level] = st.columns
        worst["depth"] = max(worst["depth"], st.depth_p90_m)
        worst["min_depth"] = min(worst["min_depth"], st.min_depth_m)
        worst["span"] = max(worst["span"], st.max_span_m)
    hard("GR-CORE-FIT-01", worst["fit"], f"core inside plate with {fit} m margin")
    hard("GR-CORE-RATIO-01", ratio_lim["lo"] <= worst["ratio_lo"] and worst["ratio_hi"] <= ratio_lim["hi"],
         f"core ratio {worst['ratio_lo']:.3f}-{worst['ratio_hi']:.3f}")
    hard("GR-DEPTH-01", worst["depth"] <= rules.value("GR-DEPTH-01") + 1e-9, f"P90 core-to-facade {worst['depth']:.2f} m")
    hard("GR-SPAN-01", worst["span"] <= rules.value("GR-SPAN-01") + 1e-9, f"max span {worst['span']:.2f} m")

    base_w = _min_width(ev.plates[tower[0]])
    sl = rules.value("GR-SLEND-01")
    slender = spec.height_m / base_w
    repetition = max(sig_counts.values()) / len(tower)
    ev.metrics.update({
        "height_m": spec.height_m, "n_floors": spec.n_floors, "saleable_floors": len([l for l in tower if l not in reserved]),
        "fsi_used_m2": fsi_used, "fsi_utilisation": fsi_used / lim["max_fsi_area_m2"],
        "core_ratio": worst["ratio_hi"], "max_depth_m": worst["depth"], "min_depth_m": worst["min_depth"],
        "max_span_m": worst["span"], "max_overhang_m": worst_cant, "slenderness": slender,
        "slenderness_flag": "severe" if slender > sl["severe"] else "warn" if slender > sl["warn"] else "ok",
        "repetition": repetition,
        "structural_complexity": 0.4 * worst["span"] / rules.value("GR-SPAN-01") + 0.3 * (1 - repetition)
                                 + 0.3 * min(slender / sl["severe"], 1.5),
        "facade_complexity": 0.5 * min(1.0, (len(ev.plates[tower[0]].exterior.coords) - 5) / 60.0) + 0.5 * (1 - repetition),
        "constructability": repetition * max(0.0, 1.0 - worst_cant / rules.value("GR-CANT-01")),
    })
    if spec.typology == "twisted" and spec.p.get("twist_per_floor_deg", 0) > rules.value("GR-TWIST-01"):
        ev.explanation.append("GR-TWIST-01 (soft): twist per floor above guideline")
    if worst["min_depth"] < rules.value("GR-DEPTH-02"):
        ev.explanation.append(f"GR-DEPTH-02 (soft): shallowest room zone {worst['min_depth']:.1f} m")
    ev.feasible = not ev.violations
    return ev


def _min_width(poly: Polygon) -> float:
    rect = np.asarray(poly.minimum_rotated_rectangle.exterior.coords)
    e = np.hypot(*np.diff(rect, axis=0).T)
    return float(e[:2].min())


def program_for(units_per_floor: int, cfg: dict, rules: RuleRegistry) -> dict:
    prog = dict(cfg["program"]["default"])
    prog.update(cfg["program"].get("by_units_per_floor", {}).get(units_per_floor, {}))
    prog["living_frontage_m"] = max(prog["living_frontage_m"], rules.value("GR-FRONT-LR-01"))
    prog["bedroom_frontage_m"] = max(prog["bedroom_frontage_m"], rules.value("GR-FRONT-BR-01"))
    return prog


def evaluate_views(ev: Evaluation, site: Site, scene: RasterScene, cfg: dict, rules: RuleRegistry,
                   eval_every: int = 1) -> Evaluation:
    """Expensive part: per-level facade view analysis, units, classes, economics."""
    spec = ev.spec
    vcfg = cfg["view"]
    params = RayParams.from_config(vcfg["rays"])
    weights = QualityWeights.from_config(vcfg["weights"])
    spacing = vcfg.get("observer_spacing_m", 2.0)
    reserved = set(cfg["limits"].get("reserved_levels", []))
    saleable = [l for l in range(spec.podium_floors, spec.n_floors) if l not in reserved]
    evaluated = sorted(set(saleable[::max(1, eval_every)]) | {saleable[-1]})
    program = program_for(spec.units_per_floor, cfg, rules)
    priv_min = rules.value("GR-PRIV-01")
    top_z = spec.height_m
    units: list[Unit] = []
    by_level: dict[int, list[Unit]] = {}
    violations: set[str] = set()
    priv_fail = 0.0
    for level in evaluated:
        plate, core = ev.plates[level], ev.cores[level]
        own = scene.with_prism(plate.buffer(-0.75 * scene.res, join_style="mitre"), top_z)
        pts, normals, s = perimeter_points(plate, spacing)
        a = np.radians(normals)
        obs = np.column_stack([pts[:, 0] + 0.75 * np.sin(a), pts[:, 1] + 0.75 * np.cos(a),
                               np.full(len(pts), spec.level_z(level) + vcfg.get("eye_height_m", 1.5))])
        ap = evaluate_apertures(own, obs, normals, params, weights, vcfg)
        lu, v = build_units(level, spec.level_z(level), plate, core, s, spacing, ap, spec.units_per_floor,
                            program, cfg["program"].get("split", "equal_value"), pts)
        violations |= set(v)
        # privacy hard rule: habitable rooms facing a habitable obstruction closer than GR-PRIV-01
        for u in lu:
            for r in u.rooms:
                if r.room != "kitchen_service" and r.d_obs_median < priv_min and r.privacy > 0:
                    priv_fail = max(priv_fail, priv_min - r.d_obs_median)
        by_level[level] = lu
    if priv_fail > 0:
        violations.add("GR-PRIV-01")
        ev.checks["GR-PRIV-01"] = f"habitable room faces habitable building {priv_fail:.1f} m closer than {priv_min} m"
    else:
        ev.checks["GR-PRIV-01"] = f"all habitable rooms >= {priv_min} m from habitable obstructions"
    # inherit results for non-evaluated levels from the nearest evaluated level below
    for level in saleable:
        src = max(l for l in evaluated if l <= level)
        for u in by_level[src]:
            if level == src:
                units.append(u)
                continue
            scale = (ev.plates.get(level) or gen.plate(spec, level)).area / ev.plates[src].area
            clone = Unit(f"L{level:03d}-U{u.unit_id.split('-U')[1]}", level, spec.level_z(level),
                         u.outline, u.frontage_m, u.rooms)
            clone.outline = u.outline if abs(scale - 1) < 1e-9 else _scaled(u.outline, scale)
            clone.class_reasons = [f"inherited view results from level {src}"]
            units.append(clone)
    for u in units:
        cls, reasons, margin = classify(u, rules)
        u.view_class = cls
        u.class_reasons = reasons + u.class_reasons
        u.__dict__["margin"] = margin
    economics.price_units(units, saleable[0], cfg["economics"])
    gross_all = sum(p.area for p in ev.plates.values())
    eco = economics.summary(units, gross_all, cfg["economics"],
                            cfg["economics"].get("complexity_cost_factor", 0.15) * ev.metrics["structural_complexity"])
    counts = {c: sum(u.view_class == c for u in units) for c in CLASSES}
    bp = rules.value("VC-BR-PREMIUM")
    beds = [b for u in units for b in u.bedrooms]
    living = [u.room("living").view_score for u in units if u.room("living")]
    carpet = sum(u.carpet_m2 for u in units)
    gross_sale = sum(ev.plates[l].area for l in saleable)
    ev.units = units
    ev.evaluated_levels = evaluated
    ev.violations = sorted(set(ev.violations) | violations)
    ev.feasible = not ev.violations
    ev.metrics.update({
        "units_total": len(units), **{f"{c}_units": n for c, n in counts.items()},
        "premium_share": counts["premium"] / max(len(units), 1),
        "premium_bedrooms": sum(b.water_fraction >= bp["w_min"] for b in beds), "bedrooms_total": len(beds),
        "living_view_mean": float(np.mean(living)) if living else 0.0,
        "saleable_carpet_m2": carpet, "efficiency": carpet / gross_sale if gross_sale else 0.0,
        "privacy_mean": 1.0 - float(np.mean([max(r.privacy for r in u.rooms) for u in units])) if units else 0.0,
        "min_margin": float(min(u.__dict__["margin"] for u in units)) if units else 0.0,
        "evaluated_levels": len(evaluated), **eco,
    })
    ev.explanation += _explain(ev)
    return ev


def _scaled(poly: Polygon, factor: float) -> Polygon:
    from shapely import affinity
    s = math.sqrt(factor)
    return affinity.scale(poly, s, s, origin=poly.centroid)


def _explain(ev: Evaluation) -> list[str]:
    m = ev.metrics
    out = [f"{m['units_total']} units: {m['premium_units']} premium, {m['good_units']} good, "
           f"{m['neutral_units']} neutral, {m['compromised_units']} compromised",
           f"GDV ₹{m['gdv_cr']:.0f} cr on {m['saleable_carpet_m2']:.0f} m² carpet "
           f"(efficiency {m['efficiency']:.2f}, FSI used {m['fsi_utilisation']:.0%})"]
    comp = [u for u in ev.units if u.view_class == "compromised"]
    if comp:
        lo = min(comp, key=lambda u: u.level)
        out.append(f"lowest compromised unit {lo.unit_id}: {'; '.join(lo.class_reasons[:2])}")
    return out


# ----------------------------------------------------------------------------- driver
@dataclass
class SearchResult:
    evaluations: list[Evaluation]
    rejected: list[Evaluation]
    front: list[Evaluation]


def run_search(cfg: dict, site: Site, scene: RasterScene, rules: RuleRegistry,
               view_field: SiteViewField | None, progress=None) -> SearchResult:
    specs = [resolve_floors(s, cfg) for s in enumerate_specs(cfg, site)]
    offsets = _grid(cfg["search"].get("core_offset_m", [0.0]))
    evaluated, rejected = [], []
    todo = []
    for spec in specs:
        for off in offsets:
            ev = check_candidate(spec, site, cfg, rules, view_field, float(off))
            (todo if ev.feasible else rejected).append(ev)
    # de-duplicate identical candidates (e.g. rotations of a square) deterministically
    seen, unique = set(), []
    for ev in sorted(todo, key=lambda e: e.candidate_id):
        if ev.candidate_id not in seen:
            seen.add(ev.candidate_id)
            unique.append(ev)
    for i, ev in enumerate(unique):
        if progress:
            progress(i + 1, len(unique), ev)
        evaluate_views(ev, site, scene, cfg, rules, cfg["search"].get("eval_every", 1))
        (evaluated if ev.feasible else rejected).append(ev)
    objs = cfg["ranking"]["pareto_objectives"]
    if evaluated:
        vals = np.array([[e.metrics[o["metric"]] for o in objs] for e in evaluated], dtype=float)
        ranks = nondominated_ranks(vals, [o["sense"] for o in objs])
        for e, r in zip(evaluated, ranks):
            e.rank = int(r)
    prio = cfg["ranking"]["priority"]
    evaluated.sort(key=lambda e: (e.rank,) + presentation_key(e.metrics, prio, e.candidate_id))
    front = [e for e in evaluated if e.rank == 0]
    rejected.sort(key=lambda e: e.candidate_id)
    return SearchResult(evaluated, rejected, front)
