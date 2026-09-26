"""Site boundary, buildable envelope and local coordinate frame.

Local frame: ENU metres — x east, y north, origin at the site anchor. Azimuths are measured
clockwise from true north.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import shapely
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient

EARTH_RADIUS_M = 6_378_137.0


def to_local_frame(poly: Polygon, north_angle_deg: float, origin: tuple[float, float] = (0.0, 0.0)) -> Polygon:
    """Rotate drawing coordinates so +y is true north.

    ``north_angle_deg`` is the azimuth (clockwise from drawing +Y) at which true north points
    in the drawing. A drawing vector at angle beta from +Y then has true azimuth beta - north.
    """
    return affinity.rotate(poly, north_angle_deg, origin=origin)


def latlon_to_local(lat: float, lon: float, anchor: tuple[float, float]) -> tuple[float, float]:
    """Equirectangular projection about ``anchor`` (lat, lon); < 1 cm error over a few km."""
    lat0, lon0 = anchor
    x = math.radians(lon - lon0) * EARTH_RADIUS_M * math.cos(math.radians(lat0))
    y = math.radians(lat - lat0) * EARTH_RADIUS_M
    return x, y


def local_to_latlon(x: float, y: float, anchor: tuple[float, float]) -> tuple[float, float]:
    lat0, lon0 = anchor
    lat = lat0 + math.degrees(y / EARTH_RADIUS_M)
    lon = lon0 + math.degrees(x / (EARTH_RADIUS_M * math.cos(math.radians(lat0))))
    return lat, lon


def envelope_from_setbacks(boundary: Polygon, setbacks_m: list[float]) -> Polygon:
    """Buildable envelope = boundary minus a strip of width ``setbacks_m[i]`` along edge i.

    Edges are numbered in the boundary's exterior vertex order (as uploaded). Each strip is a
    one-sided flat-capped buffer on the interior side of the edge; vertices additionally get a
    disk of radius min(adjacent setbacks) so reflex corners are cleared too. For convex plots this
    equals the exact per-edge inward offset.
    """
    coords = list(boundary.exterior.coords)[:-1]
    n = len(coords)
    if len(setbacks_m) != n:
        raise ValueError(f"need {n} setbacks (one per edge), got {len(setbacks_m)}")
    ccw = orient(boundary, sign=1.0)
    # interior is on the left of each edge when the ring is counter-clockwise
    is_ccw = list(ccw.exterior.coords)[:-1] == coords
    cut = []
    for i in range(n):
        s = float(setbacks_m[i])
        if s <= 0:
            continue
        a, b = coords[i], coords[(i + 1) % n]
        seg = LineString([a, b]) if is_ccw else LineString([b, a])
        cut.append(seg.buffer(s, single_sided=True, cap_style="flat"))
    for i in range(n):
        s = min(float(setbacks_m[i - 1]), float(setbacks_m[i]))
        if s > 0:
            cut.append(Point(coords[i]).buffer(s, quad_segs=16))
    env = boundary.difference(shapely.union_all(cut)) if cut else boundary
    if env.geom_type == "MultiPolygon":
        env = max(env.geoms, key=lambda g: g.area)
    return shapely.set_precision(env, 1e-6) if not env.is_empty else env


@dataclass
class Site:
    boundary: Polygon
    envelope: Polygon
    anchor_latlon: tuple[float, float] | None = None
    north_angle_deg: float = 0.0
    boundary_is_envelope: bool = True
    edge_setbacks_m: list[float] = field(default_factory=list)

    @classmethod
    def build(cls, boundary: Polygon, *, boundary_is_envelope: bool, edge_setbacks_m: list[float] | None = None,
              envelope: Polygon | None = None, anchor_latlon=None, north_angle_deg: float = 0.0) -> "Site":
        if not boundary.is_valid or boundary.area <= 0:
            raise ValueError("site boundary must be a valid polygon with positive area")
        if envelope is None:
            if boundary_is_envelope:
                envelope = boundary
            else:
                envelope = envelope_from_setbacks(boundary, edge_setbacks_m or [0.0] * (len(boundary.exterior.coords) - 1))
        if envelope.is_empty:
            raise ValueError("buildable envelope is empty — setbacks too large for the plot")
        return cls(boundary, envelope, anchor_latlon, north_angle_deg, boundary_is_envelope, list(edge_setbacks_m or []))

    def edges(self) -> list[dict]:
        """Boundary edges for the 'click a side, give its setback' interaction."""
        c = list(self.boundary.exterior.coords)
        out = []
        for i in range(len(c) - 1):
            (x1, y1), (x2, y2) = c[i], c[i + 1]
            az = (math.degrees(math.atan2(x2 - x1, y2 - y1)) + 360) % 360
            out.append({"edge": i, "start": (x1, y1), "end": (x2, y2),
                        "length_m": math.hypot(x2 - x1, y2 - y1), "direction_deg": az})
        return out
