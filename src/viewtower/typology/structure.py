"""Core sizing, perimeter column grid, span / depth / overhang checks."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from shapely.geometry import Point, Polygon


def core_area(units_per_floor: int, cfg: dict) -> float:
    """Core = fixed part (stairs, fire/service lift, shafts) + private lift & lobby per unit."""
    if cfg.get("area_m2"):
        return float(cfg["area_m2"])
    return float(cfg.get("fixed_m2", 95.0) + cfg.get("per_unit_m2", 14.0) * units_per_floor)


def perimeter_points(poly: Polygon, spacing: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Points every ~spacing along the exterior (CCW), their outward normal azimuths and arc length s."""
    from shapely.geometry.polygon import orient
    ring = orient(poly, 1.0).exterior
    coords = np.asarray(ring.coords)
    pts, normals, s_vals = [], [], []
    s0 = 0.0
    for a, b in zip(coords[:-1], coords[1:]):
        seg = b - a
        length = float(np.hypot(*seg))
        if length < 1e-9:
            continue
        k = max(1, int(round(length / spacing)))
        t = (np.arange(k) + 0.5) / k
        pts.append(a + np.outer(t, seg))
        # CCW ring: outward normal is the edge direction rotated clockwise (dx, dy) -> (dy, -dx)
        nx, ny = seg[1], -seg[0]
        az = (np.degrees(np.arctan2(nx, ny)) + 360.0) % 360.0
        normals.append(np.full(k, az))
        s_vals.append(s0 + t * length)
        s0 += length
    return np.vstack(pts), np.concatenate(normals), np.concatenate(s_vals)


@dataclass
class StructureReport:
    columns: np.ndarray
    max_perimeter_spacing_m: float
    equivalent_span_m: float       # 2 x max distance from any slab point to its nearest support
    depth_p90_m: float             # 90th percentile facade-to-core distance ("lease depth")
    max_depth_m: float             # includes corner diagonals (information)
    min_depth_m: float

    @property
    def max_span_m(self) -> float:
        return max(self.max_perimeter_spacing_m, self.equivalent_span_m)


def structure(plate: Polygon, core: Polygon, spacing_m: float = 8.0, slab_grid_m: float = 1.0) -> StructureReport:
    """Columns at every vertex and evenly between them at <= spacing_m; slab span proxy.

    Equivalent span: a flat slab point at distance r from its nearest support (column or core wall)
    behaves roughly like mid-span of a 2r span, so span_eq = 2 * max_r.
    """
    import shapely
    from shapely.geometry.polygon import orient
    ring = np.asarray(orient(plate, 1.0).exterior.coords)[:-1]
    n = len(ring)
    cols, gaps = [], []
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        length = float(np.hypot(*(b - a)))
        k = max(1, int(np.ceil(length / spacing_m)))
        for t in np.arange(k) / k:
            cols.append(a + t * (b - a))
        gaps.append(length / k)
    cols = np.asarray(cols)
    fp, _, _ = perimeter_points(plate, 0.5)
    dists = shapely.distance(core, shapely.points(fp))
    minx, miny, maxx, maxy = plate.bounds
    gx, gy = np.meshgrid(np.arange(minx, maxx, slab_grid_m) + slab_grid_m / 2,
                         np.arange(miny, maxy, slab_grid_m) + slab_grid_m / 2)
    inside = shapely.contains_xy(plate, gx, gy) & ~shapely.contains_xy(core, gx, gy)
    sx, sy = gx[inside], gy[inside]
    if len(sx):
        d_col = np.sqrt(((sx[:, None] - cols[None, :, 0]) ** 2 + (sy[:, None] - cols[None, :, 1]) ** 2).min(axis=1))
        d_core = shapely.distance(core, shapely.points(np.column_stack([sx, sy])))
        span = 2.0 * float(np.minimum(d_col, d_core).max())
    else:
        span = 0.0
    return StructureReport(cols, float(max(gaps)), span, float(np.percentile(dists, 90)),
                           float(dists.max()), float(dists.min()))


def max_overhang(upper: Polygon, lower: Polygon) -> float:
    """Largest horizontal distance of the upper plate outside the lower one (cantilever)."""
    if lower.contains(upper):
        return 0.0
    return float(max(lower.distance(Point(x, y)) for x, y in np.asarray(upper.exterior.coords)))
