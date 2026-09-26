"""End-to-end pipeline: config -> site/context -> view field -> search -> report data."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from shapely.geometry import Polygon

from viewtower.config import stable_hash
from viewtower.context.scene import Context, ContextBuilding, Landmark, RasterScene, rasterize
from viewtower.geometry.dxf_io import read_dxf
from viewtower.geometry.site import Site, to_local_frame
from viewtower.optimize.search import SearchResult, evaluate_views, run_search
from viewtower.rules.registry import RuleRegistry
from viewtower.view.engine import RayParams
from viewtower.view.quality import QualityWeights, SiteViewField, site_view_field


@dataclass
class Prepared:
    cfg: dict
    rules: RuleRegistry
    site: Site
    context: Context
    scene: RasterScene
    warnings: list[str]


def load_site_and_context(cfg: dict) -> tuple[Site, Context, list[str]]:
    sc = cfg["site"]
    north = float(sc.get("north_angle_deg", 0.0))
    rot = lambda p: to_local_frame(p, north) if north else p
    imp = read_dxf(sc["dxf"], units_to_m=sc.get("units_to_m"))
    cands = imp.boundary_candidates()
    if not cands:
        raise ValueError("no closed polyline found for the site boundary")
    idx = int(sc.get("boundary_index", 0))
    boundary = rot(cands[idx].polygon)
    env_layer = imp.by_role.get("envelope")
    envelope = rot(env_layer[0].polygon) if env_layer and sc.get("use_envelope_layer", True) else None
    site = Site.build(boundary, boundary_is_envelope=bool(sc.get("boundary_is_envelope", True)),
                      edge_setbacks_m=sc.get("edge_setbacks_m"), envelope=envelope,
                      anchor_latlon=tuple(sc["anchor_latlon"]) if sc.get("anchor_latlon") else None,
                      north_angle_deg=north)
    buildings = []
    for k, item in enumerate(sorted(imp.by_role.get("context", []), key=lambda i: (i.layer, i.polygon.wkt))):
        buildings.append(ContextBuilding(f"{item.layer}-{k:04d}", rot(item.polygon), item.height or
                                         float(cfg["context"].get("default_height_m", 20.0)), item.base_z,
                                         scenario="future" if "FUTURE" in item.layer.upper() else "existing",
                                         height_source="dxf_thickness" if item.height else "assumed"))
    water = [rot(i.polygon) for i in imp.by_role.get("water", [])]
    parks = [rot(i.polygon) for i in imp.by_role.get("park", [])]
    lms = [Landmark(**lm) for lm in cfg["context"].get("landmarks", [])]
    return site, Context(buildings, water, parks, lms), imp.warnings


def prepare(cfg: dict, scenario: str | None = None) -> Prepared:
    rules = RuleRegistry.load(cfg.get("rules_file"), cfg.get("rules"))
    site, ctx, warnings = load_site_and_context(cfg)
    ctx = ctx.for_scenario(scenario or cfg["context"].get("scenario", "existing"))
    r = cfg["view"]["rays"]["max_distance_m"]
    c = site.envelope.centroid
    scene = rasterize(ctx, (c.x - r, c.y - r, c.x + r, c.y + r), cfg["view"]["raster_res_m"])
    return Prepared(cfg, rules, site, ctx, scene, warnings)


def compute_view_field(p: Prepared) -> SiteViewField:
    v = p.cfg["view"]
    return site_view_field(p.scene, p.site.envelope, v["heights_m"], RayParams.from_config(v["rays"]),
                           QualityWeights.from_config(v["weights"]), v.get("field_spacing_m", 10.0),
                           v.get("azimuth_step_deg", 2.0), v.get("premium_arc_threshold", 0.5),
                           p.rules.value("GR-PODIUM-01"), v.get("corridors"))


def run(cfg: dict, progress=None) -> dict:
    p = prepare(cfg)
    field = compute_view_field(p)
    result = run_search(cfg, p.site, p.scene, p.rules, field, progress)
    future = None
    if cfg["context"].get("evaluate_future", True) and result.front:
        pf = prepare(cfg, "future")
        for ev in result.front:
            clone = type(ev)(ev.candidate_id, ev.spec, True, [], dict(ev.checks), dict(ev.metrics),
                             plates=ev.plates, cores=ev.cores, columns=ev.columns)
            evaluate_views(clone, pf.site, pf.scene, cfg, pf.rules, cfg["search"].get("eval_every", 1))
            ev.metrics["compromised_units_future"] = clone.metrics["compromised_units"]
            ev.metrics["premium_units_future"] = clone.metrics["premium_units"]
            ev.metrics["zero_compromise_robust"] = (ev.metrics["compromised_units"] == 0
                                                    and clone.metrics["compromised_units"] == 0)
        future = True
    return {"prepared": p, "view_field": field, "result": result, "future_evaluated": bool(future),
            "run_id": stable_hash({"cfg": cfg, "rules": p.rules.digest()})}
