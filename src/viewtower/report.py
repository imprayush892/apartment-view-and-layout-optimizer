"""Explainable outputs: report.json, units.csv, plan SVGs."""
from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np

from viewtower import __version__
from viewtower.config import canonical

CLASS_COLOURS = {"premium": "#1b7f5b", "good": "#6fbf73", "neutral": "#d9c36a", "compromised": "#c8553d"}
ROOM_COLOURS = {"living": "#1f4e9e", "bed": "#2aa4c8", "kitchen_service": "#9a9a9a"}


def typical_level(ev) -> int:
    """Middle evaluated saleable level (falls back to the first tower level)."""
    lv = ev.evaluated_levels or sorted(ev.cores)
    return lv[len(lv) // 2]


def _poly(p):
    return [list(map(float, c)) for c in p.exterior.coords] if p is not None and not p.is_empty else []


def _unit_row(u) -> dict:
    lr = u.room("living")
    return {"unit_id": u.unit_id, "level": u.level, "z_m": round(u.z, 2), "class": u.view_class,
            "carpet_m2": round(u.carpet_m2, 1), "carpet_ft2": round(u.carpet_m2 * 10.7639),
            "rate_inr_per_ft2": round(u.rate_inr_per_ft2), "value_cr": round(u.value_inr / 1e7, 3),
            "living_q": round(lr.view_score, 3) if lr else None,
            "living_water": round(lr.water_fraction, 3) if lr else None,
            "living_d_obs_m": round(lr.d_obs_median, 1) if lr else None,
            "bedrooms_with_water": sum(b.water_fraction >= 0.2 for b in u.bedrooms),
            "bedrooms": len(u.bedrooms), "reasons": " | ".join(u.class_reasons)}


def build_report(out: dict, cfg: dict, top_n: int = 10) -> dict:
    p, field, res = out["prepared"], out["view_field"], out["result"]
    rose = {str(z): {k: np.round(v, 4).tolist() for k, v in r.items()} for z, r in field.rose_mean.items()}
    cand = []
    for ev in res.evaluations[:top_n]:
        typical = typical_level(ev)
        cand.append({
            "candidate_id": ev.candidate_id, "pareto_rank": ev.rank, "spec": ev.spec.to_dict(),
            "metrics": canonical(ev.metrics), "hard_rule_checks": ev.checks, "explanation": ev.explanation,
            "typical_plate": _poly(ev.plates[typical]), "typical_core": _poly(ev.cores[typical]),
            "units_typical_level": [dict(_unit_row(u), outline=_poly(u.outline)) for u in ev.units if u.level == typical],
        })
    return {
        "tool": f"viewtower {__version__}", "run_id": out["run_id"], "rules_digest": p.rules.digest(),
        "rules_used": sorted(p.rules.used), "warnings": p.warnings,
        "inputs": {"limits": cfg["limits"], "site": {k: v for k, v in cfg["site"].items() if k != "dxf"},
                   "envelope_area_m2": round(p.site.envelope.area, 2), "boundary": _poly(p.site.boundary),
                   "envelope": _poly(p.site.envelope), "edges": p.site.edges()},
        "view_field": {"heights_m": field.heights, "azimuth_deg": field.azimuths.tolist(), "rose_mean": rose,
                       "premium_arc_deg": field.premium_arc, "opening_height_m": field.opening_height_m,
                       "n_points": len(field.points)},
        "search": {"evaluated": len(res.evaluations), "rejected": len(res.rejected), "front": len(res.front),
                   "future_scenario_evaluated": out["future_evaluated"]},
        "candidates": cand,
        "rejections": [{"candidate_id": e.candidate_id, "spec": e.spec.to_dict(), "violations": e.violations,
                        "checks": {k: e.checks.get(k) for k in e.violations}} for e in res.rejected],
    }


def _runs(points, gap: float):
    """Split a frontage into contiguous runs (observers further apart than ``gap`` start a new run)."""
    runs, cur = [], []
    for p in points:
        if cur and np.hypot(p[0] - cur[-1][0], p[1] - cur[-1][1]) > gap:
            runs.append(cur)
            cur = []
        cur.append(p)
    return runs + ([cur] if cur else [])


def plan_svg(ev, site, level: int | None = None, size: int = 640, spacing: float = 2.0) -> str:
    gap = 1.8 * spacing
    level = level if level is not None else typical_level(ev)
    plate, core = ev.plates[level], ev.cores[level]
    minx, miny, maxx, maxy = site.boundary.union(plate).bounds
    pad = 6.0
    sc = size / max(maxx - minx + 2 * pad, maxy - miny + 2 * pad)
    tx = lambda x: (x - minx + pad) * sc
    ty = lambda y: size - (y - miny + pad) * sc
    path = lambda poly: "M " + " L ".join(f"{tx(x):.1f},{ty(y):.1f}" for x, y in poly.exterior.coords) + " Z"
    el = [f'<rect width="{size}" height="{size}" fill="#ffffff"/>',
          f'<path d="{path(site.boundary)}" fill="none" stroke="#999" stroke-dasharray="4 3"/>',
          f'<path d="{path(site.envelope)}" fill="#f3f3f3" stroke="#bbb"/>']
    for u in (u for u in ev.units if u.level == level):
        if u.outline.is_empty:
            continue
        c = u.outline.representative_point()
        el.append(f'<path d="{path(u.outline)}" fill="{CLASS_COLOURS.get(u.view_class, "#ccc")}" '
                  f'fill-opacity="0.75" stroke="#333"><title>{u.unit_id} {u.view_class}</title></path>')
        el.append(f'<text x="{tx(c.x):.1f}" y="{ty(c.y):.1f}" font-size="11" text-anchor="middle" '
                  f'font-family="sans-serif">{u.unit_id.split("-")[1]} {u.view_class}</text>')
        for r in u.rooms:
            col = ROOM_COLOURS["bed"] if r.room.startswith("bed") else ROOM_COLOURS.get(r.room, "#999")
            for run in _runs(r.points, gap):
                pl = " ".join(f"{tx(x):.1f},{ty(y):.1f}" for x, y in run)
                el.append(f'<polyline points="{pl}" fill="none" stroke="{col}" stroke-width="7" '
                          f'stroke-linecap="round"><title>{u.unit_id} {r.room} q={r.view_score:.2f} '
                          f'water={r.water_fraction:.2f}</title></polyline>')
    el.append(f'<path d="{path(core)}" fill="#555" stroke="#222"/>')
    for x, y in ev.columns.get(level, []):
        el.append(f'<rect x="{tx(x) - 3:.1f}" y="{ty(y) - 3:.1f}" width="6" height="6" fill="#111"/>')
    el.append(f'<text x="10" y="18" font-size="12" font-family="sans-serif">{ev.spec.typology} · level {level} · '
              f'{ev.candidate_id} · north ↑</text>')
    el.append(f'<text x="10" y="{size - 10}" font-size="11" font-family="sans-serif">facade: '
              f'<tspan fill="{ROOM_COLOURS["living"]}">■ living</tspan> <tspan fill="{ROOM_COLOURS["bed"]}">■ bedrooms</tspan> '
              f'<tspan fill="{ROOM_COLOURS["kitchen_service"]}">■ kitchen/service</tspan> · fill = unit view class</text>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">' \
           + "".join(el) + "</svg>"


def write_outputs(out: dict, cfg: dict, out_dir: str | Path) -> Path:
    d = Path(out_dir)
    d.mkdir(parents=True, exist_ok=True)
    rep = build_report(out, cfg, cfg.get("report", {}).get("top_n", 10))
    (d / "report.json").write_text(json.dumps(rep, indent=1, ensure_ascii=False))
    res = out["result"]
    if res.evaluations:
        best = res.evaluations[0]
        with open(d / "units_best.csv", "w", newline="", encoding="utf-8") as fh:
            rows = [_unit_row(u) for u in best.units]
            w = csv.DictWriter(fh, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
        for i, ev in enumerate(res.evaluations[:cfg.get("report", {}).get("svg_n", 3)]):
            (d / f"plan_{i + 1}_{ev.candidate_id}.svg").write_text(
                plan_svg(ev, out["prepared"].site, spacing=cfg["view"].get("observer_spacing_m", 2.0)))
    return d
