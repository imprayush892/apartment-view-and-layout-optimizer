"""Parametric floor-plate generators (docs/spec/04_typology_taxonomy.md).

Local frame before placement: origin = core centre, +y = the tower's "front" axis. Placement rotates
the plate clockwise by ``rotation_deg`` (so front faces that azimuth) and translates to ``position``.
All functions are pure and deterministic.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import shapely
from shapely import affinity
from shapely.geometry import MultiPoint, Polygon, box

BASE_TYPOLOGIES = ("rectangular", "square", "slender", "rotated", "diamond", "triangular", "chamfered",
                   "y_shaped", "t_shaped", "cross", "curved")
MODIFIER_TYPOLOGIES = ("terraced", "tapered", "twisted", "podium_tower")
TYPOLOGIES = BASE_TYPOLOGIES + MODIFIER_TYPOLOGIES


def _rect(w: float, d: float) -> Polygon:
    return box(-w / 2, -d / 2, w / 2, d / 2)


def _chamfer(poly: Polygon, c: float) -> Polygon:
    """Cut every convex corner by ``c`` metres along both edges."""
    if c <= 0:
        return poly
    pts = np.asarray(poly.exterior.coords)[:-1]
    out = []
    n = len(pts)
    for i in range(n):
        p, a, b = pts[i], pts[i - 1], pts[(i + 1) % n]
        va, vb = a - p, b - p
        la, lb = np.linalg.norm(va), np.linalg.norm(vb)
        cc = min(c, 0.45 * la, 0.45 * lb)
        out += [tuple(p + va / la * cc), tuple(p + vb / lb * cc)]
    return Polygon(out)


def _wings(angles_deg: list[float], wing_len: float, wing_w: float) -> Polygon:
    """Union of wings (length measured from the centre) at the given math angles + a hub."""
    parts, hub_pts = [], []
    for a in angles_deg:
        r = box(0.0, -wing_w / 2, wing_len, wing_w / 2)
        parts.append(affinity.rotate(r, a, origin=(0, 0)))
        hub_pts += [affinity.rotate(shapely.Point(0, s * wing_w / 2), a, origin=(0, 0)) for s in (-1, 1)]
    hub = MultiPoint(hub_pts).convex_hull
    return shapely.union_all(parts + [hub]).normalize()


def _superellipse(a: float, b: float, n: float, k: int = 96) -> Polygon:
    t = np.linspace(0, 2 * np.pi, k, endpoint=False)
    c, s = np.cos(t), np.sin(t)
    x = a * np.sign(c) * np.abs(c) ** (2.0 / n)
    y = b * np.sign(s) * np.abs(s) ** (2.0 / n)
    return Polygon(np.column_stack([x, y]))


def base_shape(typology: str, w: float, d: float, p: dict[str, Any]) -> Polygon:
    if typology in ("rectangular", "slender", "rotated"):
        return _rect(w, d)
    if typology == "square":
        return _rect(w, w)
    if typology == "diamond":
        return affinity.rotate(_rect(w / math.sqrt(2), w / math.sqrt(2)), 45, origin=(0, 0))
    if typology == "chamfered":
        return _chamfer(_rect(w, d), p.get("chamfer_m", 3.0))
    if typology == "triangular":
        # apex toward +y; centroid moved to origin so the core sits at the centroid
        tri = Polygon([(-w / 2, -d / 3), (w / 2, -d / 3), (0, 2 * d / 3)])
        return _chamfer(tri, p.get("chamfer_m", 3.0))
    if typology == "y_shaped":
        a = p.get("wing_angle_deg", 120.0)
        return _wings([90.0, 90.0 + a, 90.0 - a], p.get("wing_len", w / 2), p.get("wing_w", d))
    if typology == "t_shaped":
        return _wings([0.0, 180.0, 90.0], p.get("wing_len", w / 2), p.get("wing_w", d))
    if typology == "cross":
        return _wings([0.0, 90.0, 180.0, 270.0], p.get("wing_len", w / 2), p.get("wing_w", d))
    if typology == "curved":
        return _superellipse(w / 2, d / 2, p.get("exponent", 2.5))
    raise ValueError(f"unknown base typology {typology!r}")


@dataclass(frozen=True)
class TowerSpec:
    typology: str
    width: float
    depth: float
    params: tuple = ()                    # sorted (key, value) pairs -> hashable
    position: tuple[float, float] = (0.0, 0.0)
    rotation_deg: float = 0.0
    floor_to_floor_m: float = 3.6
    n_floors: int = 40
    podium_floors: int = 0
    units_per_floor: int = 2

    @property
    def p(self) -> dict[str, Any]:
        return {k: (dict(v) if isinstance(v, tuple) and v and isinstance(v[0], tuple) else v) for k, v in self.params}

    @property
    def height_m(self) -> float:
        return self.n_floors * self.floor_to_floor_m

    def level_z(self, level: int) -> float:
        return level * self.floor_to_floor_m

    def tower_levels(self) -> range:
        return range(self.podium_floors, self.n_floors)

    def to_dict(self) -> dict[str, Any]:
        return {"typology": self.typology, "width": self.width, "depth": self.depth, "params": self.p,
                "position": list(self.position), "rotation_deg": self.rotation_deg,
                "floor_to_floor_m": self.floor_to_floor_m, "n_floors": self.n_floors,
                "podium_floors": self.podium_floors, "units_per_floor": self.units_per_floor}


def freeze(d: dict[str, Any]) -> tuple:
    return tuple(sorted((k, freeze(v) if isinstance(v, dict) else v) for k, v in d.items()))


def _place(poly: Polygon, spec: TowerSpec) -> Polygon:
    poly = affinity.rotate(poly, -spec.rotation_deg, origin=(0, 0))   # clockwise
    return affinity.translate(poly, *spec.position)


def local_plate(spec: TowerSpec, level: int) -> Polygon:
    """Plate in the tower's local frame (before rotation/translation)."""
    p = spec.p
    if spec.typology == "podium_tower" and level < spec.podium_floors:
        return _rect(p.get("podium_w", spec.width * 1.6), p.get("podium_d", spec.depth * 1.6))
    base = p.get("base", "square") if spec.typology in MODIFIER_TYPOLOGIES else spec.typology
    poly = base_shape(base, spec.width, spec.depth, p)
    first = spec.podium_floors
    top = max(spec.n_floors - 1, first + 1)
    t = (level - first) / (top - first) if level >= first else 0.0
    if spec.typology == "tapered":
        s = 1.0 + (p.get("top_scale", 0.7) - 1.0) * t
        poly = affinity.scale(poly, s, s, origin=(0, 0))
    if spec.typology == "terraced":
        every, step = int(p.get("step_every", 6)), p.get("step_m", 3.0)
        retreat = step * ((level - first) // every) if level >= first else 0.0
        side = math.radians(p.get("step_side_deg", 0.0))     # local azimuth of the stepped face
        u = np.array([math.sin(side), math.cos(side)])
        proj = np.asarray(poly.exterior.coords) @ u
        lo, hi = proj.min(), proj.max()
        retreat = min(retreat, p.get("max_retreat_m", 0.25 * (hi - lo)))
        cut = max(hi - retreat, lo + p.get("min_depth_m", 12.0))
        big = 1e4
        half = Polygon([(-big, -big), (big, -big), (big, 0), (-big, 0)])   # y <= 0
        half = affinity.translate(half, 0, cut)
        half = affinity.rotate(half, -math.degrees(side), origin=(0, 0))
        poly = poly.intersection(half)
    if spec.typology == "twisted":
        poly = affinity.rotate(poly, -p.get("twist_per_floor_deg", 1.2) * max(level - first, 0), origin=(0, 0))
    return shapely.set_precision(poly, 1e-6)


def plate(spec: TowerSpec, level: int) -> Polygon:
    return _place(local_plate(spec, level), spec)


def core(spec: TowerSpec, level: int, area_m2: float, offset_m: float = 0.0,
         offset_dir_deg: float | None = None, max_aspect: float = 2.0) -> Polygon:
    """Rectangular core centred on the tower axis (optionally offset, e.g. away from the premium arc).

    The core's aspect follows the plate's width/depth ratio (clamped to ``max_aspect``) so elongated
    plates get elongated cores. ``offset_dir_deg`` is a true azimuth applied after placement.
    """
    if spec.typology in ("rectangular", "slender", "rotated", "chamfered", "curved") or \
            (spec.typology in MODIFIER_TYPOLOGIES and spec.p.get("base") in ("rectangular", "chamfered", "curved")):
        aspect = min(max(spec.width / spec.depth, 1.0 / max_aspect), max_aspect)
    else:
        aspect = 1.0
    base = spec.p.get("base") if spec.typology in MODIFIER_TYPOLOGIES else spec.typology
    if base in ("y_shaped", "t_shaped"):
        # regular hexagon with vertices pointing along the wings (hub-shaped core)
        r = math.sqrt(2.0 * area_m2 / (3.0 * math.sqrt(3.0)))
        loc = Polygon([(r * math.cos(math.radians(90 + 60 * k)), r * math.sin(math.radians(90 + 60 * k)))
                       for k in range(6)])
    elif base in ("cross", "diamond"):
        # square rotated so its corners point into the wings / plate corners
        side = math.sqrt(area_m2)
        loc = affinity.rotate(_rect(side, side), 45 if base == "cross" else 0, origin=(0, 0))
        if base == "diamond":
            loc = affinity.rotate(loc, 45, origin=(0, 0))
    else:
        cw = math.sqrt(area_m2 * aspect)
        loc = _rect(cw, area_m2 / cw)
    if spec.typology == "twisted":
        loc = affinity.rotate(loc, -spec.p.get("twist_per_floor_deg", 1.2) * max(level - spec.podium_floors, 0),
                              origin=(0, 0))
    placed = _place(loc, spec)
    if offset_m and offset_dir_deg is not None:
        a = math.radians(offset_dir_deg)
        placed = affinity.translate(placed, offset_m * math.sin(a), offset_m * math.cos(a))
    return placed


def iou(a: Polygon, b: Polygon) -> float:
    inter = a.intersection(b).area
    return inter / (a.area + b.area - inter) if inter > 0 else 0.0
