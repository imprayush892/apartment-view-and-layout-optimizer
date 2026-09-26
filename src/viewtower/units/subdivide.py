"""Apartment envelopes and room frontage assignment (docs/spec/05_geometric_rules.md §3)."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import shapely
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient


@dataclass
class Room:
    room: str
    frontage_m: float
    view_score: float
    water_fraction: float
    sky_fraction: float
    privacy: float
    d_obs_median: float
    horizon_median: float
    observer_idx: list[int] = field(default_factory=list)
    points: list[tuple[float, float]] = field(default_factory=list)   # facade points of the frontage


@dataclass
class Unit:
    unit_id: str
    level: int
    z: float
    outline: Polygon
    frontage_m: float
    rooms: list[Room]
    carpet_m2: float = 0.0
    view_class: str = ""
    class_reasons: list[str] = field(default_factory=list)
    rate_inr_per_ft2: float = 0.0
    value_inr: float = 0.0

    def room(self, name: str) -> Room | None:
        return next((r for r in self.rooms if r.room == name), None)

    @property
    def bedrooms(self) -> list[Room]:
        return [r for r in self.rooms if r.room.startswith("bed")]


def _point_at(ring: np.ndarray, cum: np.ndarray, s: float) -> tuple[float, float]:
    k = int(np.searchsorted(cum, s, side="right") - 1)
    k = min(max(k, 0), len(ring) - 2)
    seg = cum[k + 1] - cum[k]
    t = 0.0 if seg <= 0 else (s - cum[k]) / seg
    return tuple(ring[k] + t * (ring[k + 1] - ring[k]))


def _path(ring: np.ndarray, cum: np.ndarray, s0: float, s1: float) -> list[tuple[float, float]]:
    """Perimeter polyline from arc length s0 to s1 (s1 may exceed the perimeter -> wraps)."""
    per = cum[-1]
    verts = []
    for k in range(len(ring) - 1):
        for wrap in (0.0, per, 2 * per):
            sv = cum[k] + wrap
            if s0 < sv < s1:
                verts.append((sv, tuple(ring[k])))
    verts.sort()
    return [_point_at(ring, cum, s0 % per)] + [p for _, p in verts] + [_point_at(ring, cum, s1 % per)]


def split_cuts(scores: np.ndarray, s: np.ndarray, perimeter: float, n: int, mode: str = "equal_value",
               shares: list[float] | None = None) -> list[float]:
    """Cut positions (arc length) so each unit gets its share of view-weighted (or plain) frontage.

    The first cut is placed at the lowest-scoring observer so units are never split mid-premium-arc.
    """
    if n == 1:
        return [float(s[int(np.argmin(scores))])]
    shares = np.asarray(shares or [1.0 / n] * n, dtype=float)
    shares = shares / shares.sum()
    start_i = int(np.argmin(scores))
    order = np.r_[start_i:len(s), 0:start_i]
    s_ord = (s[order] - s[start_i]) % perimeter
    w = np.maximum(scores[order], 1e-3) if mode == "equal_value" else np.ones(len(order))
    cum = np.cumsum(w) / w.sum()
    cuts = [0.0]
    for target in np.cumsum(shares)[:-1]:
        k = int(np.searchsorted(cum, target))
        cuts.append(float(s_ord[min(k, len(s_ord) - 1)]))
    base = float(s[start_i])
    return [(base + c) % perimeter for c in cuts]


def unit_envelopes(plate: Polygon, core: Polygon, cuts: list[float]) -> list[tuple[Polygon, float, float]]:
    """(polygon, s_start, s_end) per unit: wedge from core centre along the perimeter between cuts."""
    ring = np.asarray(orient(plate, 1.0).exterior.coords)
    cum = np.r_[0.0, np.cumsum(np.hypot(*np.diff(ring, axis=0).T))]
    per = cum[-1]
    usable = plate.difference(core)
    c = core.centroid
    if len(cuts) == 1:
        return [(usable, cuts[0], cuts[0] + per)]
    cs = sorted(cuts)
    out = []
    for i, a in enumerate(cs):
        b = cs[(i + 1) % len(cs)] + (per if i == len(cs) - 1 else 0.0)
        poly = Polygon([(c.x, c.y)] + _path(ring, cum, a, b))
        if not poly.is_valid:
            poly = shapely.make_valid(poly)
        piece = usable.intersection(poly)
        if piece.geom_type != "Polygon":
            polys = [g for g in getattr(piece, "geoms", []) if g.geom_type == "Polygon"]
            piece = max(polys, key=lambda g: g.area) if polys else Polygon()
        out.append((piece, a, b))
    return out


def _in_range(s: np.ndarray, a: float, b: float, per: float) -> np.ndarray:
    return ((s - a) % per) < (b - a)


def assign_rooms(obs_idx: np.ndarray, spacing: float, ap, program: dict) -> tuple[list[Room], list[str]]:
    """Greedy frontage assignment along the unit's observers (ordered along the facade).

    Living takes the best contiguous window, then bedrooms in descending score, kitchen/service
    whatever is left. Returns rooms and violated rule ids.
    """
    q = ap.quality[obs_idx]
    free = np.ones(len(obs_idx), bool)
    rooms, violations = [], []
    wanted = [("living", program["living_frontage_m"])] + \
             [(f"bed{i + 1}", program["bedroom_frontage_m"]) for i in range(program["bedrooms"])]
    for name, need in wanted:
        k = max(1, int(np.ceil(need / spacing - 1e-9)))
        best, best_j = -1.0, None
        for j in range(0, len(obs_idx) - k + 1):
            if free[j:j + k].all():
                m = float(q[j:j + k].mean())
                if m > best + 1e-12:
                    best, best_j = m, j
        if best_j is None:
            violations.append("GR-FRONT-LR-01" if name == "living" else "GR-FRONT-BR-01")
            continue
        free[best_j:best_j + k] = False
        sel = obs_idx[best_j:best_j + k]
        rooms.append(Room(name, k * spacing, float(ap.quality[sel].mean()), float(ap.water_fraction[sel].mean()),
                          float(ap.sky_fraction[sel].mean()), float(ap.privacy[sel].max()),
                          float(np.median(ap.d_obs_median[sel])), float(np.median(ap.horizon_median[sel])),
                          sel.tolist()))
    rest = obs_idx[free]
    if len(rest):
        rooms.append(Room("kitchen_service", len(rest) * spacing, float(ap.quality[rest].mean()),
                          float(ap.water_fraction[rest].mean()), float(ap.sky_fraction[rest].mean()),
                          float(ap.privacy[rest].max()), float(np.median(ap.d_obs_median[rest])),
                          float(np.median(ap.horizon_median[rest])), rest.tolist()))
    elif program.get("kitchen_frontage_m", 0) > 0:
        violations.append("GR-FRONT-UNIT-01")
    return rooms, violations


def build_units(level: int, z: float, plate: Polygon, core: Polygon, s: np.ndarray, spacing: float, ap,
                n_units: int, program: dict, mode: str = "equal_value",
                pts: np.ndarray | None = None) -> tuple[list[Unit], list[str]]:
    ring = orient(plate, 1.0).exterior
    per = ring.length
    cuts = split_cuts(ap.quality, s, per, n_units, mode)
    envs = unit_envelopes(plate, core, cuts)
    units, violations = [], []
    for u, (poly, a, b) in enumerate(envs):
        mask = _in_range(s, a, b, per) if n_units > 1 else np.ones(len(s), bool)
        idx = np.flatnonzero(mask)
        # order observers along the facade starting at the unit's first cut
        idx = idx[np.argsort((s[idx] - a) % per, kind="stable")]
        rooms, v = assign_rooms(idx, spacing, ap, program)
        if pts is not None:
            for r in rooms:
                r.points = [tuple(map(float, pts[i])) for i in r.observer_idx]
        violations += v
        units.append(Unit(f"L{level:03d}-U{u + 1}", level, z, poly, len(idx) * spacing, rooms))
    return units, sorted(set(violations))
