"""Site model for feasibility: plot, road widening, OSR, EIA green belt, access ring, envelopes.

Rings from the boundary inwards: EIA green belt (natural ground, no parking, no basement) ->
fire-tender driveway -> podium. Towers stand on the podium and keep the height-banded setback
from the plot boundary (the front measured from the road-widening line).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from shapely import affinity
from shapely.geometry import LineString, Polygon, box

MITRE = dict(join_style="mitre", mitre_limit=10.0)
BIG = 1.0e4


# ---------------------------------------------------------------- height rules
def setback_for_height(h: float, rules: dict) -> float:
    """Height-banded all-round setback: base up to base_height, then +step per step_height."""
    if h <= rules["base_height_m"] + 1e-9:
        return float(rules["base_m"])
    steps = math.ceil((h - rules["base_height_m"]) / rules["step_height_m"] - 1e-9)
    return float(rules["base_m"] + steps * rules["step_m"])


def building_height(floors: int, b: dict) -> float:
    return round(b["podium_height_m"] + floors * b["floor_to_floor_m"], 3)


def max_floors(b: dict) -> int:
    return int(math.floor((b["max_height_m"] - b["podium_height_m"]) / b["floor_to_floor_m"] + 1e-9))


def refuge_floors(floors: int, b: dict) -> list[int]:
    """First residential floor whose level is above each threshold (NBC-style refuge)."""
    key = (floors, b["podium_height_m"], b["floor_to_floor_m"], tuple(b["refuge_thresholds_m"]))
    if key not in _REFUGE:
        out = []
        for t in b["refuge_thresholds_m"]:
            for n in range(1, floors + 1):
                level = b["podium_height_m"] + (n - 1) * b["floor_to_floor_m"]
                if level > t:
                    if n not in out:
                        out.append(n)
                    break
        _REFUGE[key] = out
    return list(_REFUGE[key])


_REFUGE: dict = {}


# ---------------------------------------------------------------- helpers
def _inward_halfplane(poly: Polygon, p0, p1, offset: float) -> Polygon:
    """Half-plane on the polygon's interior side of edge p0-p1, starting ``offset`` inside it."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux  # left normal
    c = poly.centroid
    if (c.x - p0[0]) * nx + (c.y - p0[1]) * ny < 0:
        nx, ny = -nx, -ny
    ox, oy = p0[0] + nx * offset, p0[1] + ny * offset
    a = (ox - ux * BIG, oy - uy * BIG)
    b = (ox + ux * BIG, oy + uy * BIG)
    return Polygon([a, b, (b[0] + nx * BIG, b[1] + ny * BIG), (a[0] + nx * BIG, a[1] + ny * BIG)])


def _largest(geom) -> Polygon:
    if geom.is_empty:
        return Polygon()
    if geom.geom_type == "Polygon":
        return geom
    polys = [g for g in getattr(geom, "geoms", []) if g.geom_type == "Polygon"]
    return max(polys, key=lambda g: g.area) if polys else Polygon()


def _bisect(fn, lo: float, hi: float, target: float, it: int = 60) -> float:
    """fn increasing in x; returns x with fn(x) ~= target."""
    for _ in range(it):
        mid = 0.5 * (lo + hi)
        if fn(mid) < target:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


# ---------------------------------------------------------------- site
@dataclass
class FeasibilitySite:
    cfg: dict
    gross: Polygon
    net: Polygon
    widening: Polygon
    widening_line: LineString
    osr: Polygon
    osr_info: dict
    developable: Polygon
    green: Polygon
    green_width_m: float
    driveway: Polygon
    podium_env: Polygon
    basement_env: Polygon
    _env_cache: dict = field(default_factory=dict, repr=False)

    @classmethod
    def build(cls, cfg: dict) -> "FeasibilitySite":
        s = cfg["site"]
        pts = [tuple(map(float, c)) for c in s["plot"]]
        if s.get("plot_area_m2"):
            k = math.sqrt(float(s["plot_area_m2"]) / Polygon(pts).area)
            pts = [(x * k, y * k) for x, y in pts]
        gross = Polygon(pts)
        i = int(s["front_edge"])
        p0, p1 = pts[i], pts[(i + 1) % len(pts)]
        w = float(s.get("road_widening_m") or 0.0)
        if w > 0:
            net = _largest(gross.intersection(_inward_halfplane(gross, p0, p1, w)))
            widening = _largest(gross.difference(net))
        else:
            net, widening = gross, Polygon()
        widening_line = _offset_chord(gross, p0, p1, w)

        osr, osr_info = _make_osr(cfg, net, pts)
        developable = _largest(net.difference(osr))
        green_w, green, inner_green = _make_green(cfg, net, developable, osr)
        drive_w = float(cfg["access"]["driveway_m"])
        podium_env = _largest(inner_green.buffer(-drive_w, **MITRE))
        driveway = _largest(inner_green.difference(podium_env))
        basement = developable if cfg["eia"].get("basement_under") else inner_green
        return cls(cfg, gross, net, widening, widening_line, osr, osr_info, developable, green, green_w,
                   driveway, podium_env, basement)

    # -------------------------------------------------------------- envelopes
    def tower_setback(self, h: float) -> float:
        return setback_for_height(h, self.cfg["setbacks"])

    def tower_envelope(self, h: float) -> Polygon:
        """Where a tower of height ``h`` may stand (inside its setback and on the podium)."""
        s = self.tower_setback(h)
        key = (s, self.cfg["eia"]["mode"], self.cfg["setbacks"]["osr_gap"])
        if key not in self._env_cache:
            if self.cfg["eia"]["mode"] == "additional":
                env = self.net.buffer(-(self.green_width_m + s), **MITRE)
            else:
                env = self.net.buffer(-s, **MITRE)
            if self.cfg["setbacks"]["osr_gap"] == "setback" and not self.osr.is_empty:
                env = env.difference(self.osr.buffer(s, **MITRE))
            self._env_cache[key] = _largest(env.intersection(self.podium_env))
        return self._env_cache[key]

    def summary(self) -> dict:
        net = self.net.area
        return {
            "gross_m2": round(self.gross.area, 1),
            "widening_m2": round(self.widening.area, 1),
            "net_m2": round(net, 1),
            "osr_m2": round(self.osr.area, 1),
            "osr_ratio": round(self.osr.area / net, 4),
            **{f"osr_{k}": v for k, v in self.osr_info.items()},
            "green_m2": round(self.green.area, 1),
            "green_ratio": round(self.green.area / net, 4),
            "green_width_m": round(self.green_width_m, 2),
            "driveway_m2": round(self.driveway.area, 1),
            "podium_envelope_m2": round(self.podium_env.area, 1),
            "basement_envelope_m2": round(self.basement_env.area, 1),
        }


def _offset_chord(poly: Polygon, p0, p1, offset: float) -> LineString:
    """The edge p0-p1 moved ``offset`` into the polygon, clipped to it (the road-widening line)."""
    hp = _inward_halfplane(poly, p0, p1, offset)
    a, b = list(hp.exterior.coords)[:2]
    chord = LineString([a, b]).intersection(poly)
    if chord.geom_type == "MultiLineString":
        chord = max(chord.geoms, key=lambda g: g.length)
    return chord if chord.geom_type == "LineString" else LineString([p0, p1])


def _make_osr(cfg: dict, net: Polygon, pts: list) -> tuple[Polygon, dict]:
    o = cfg["osr"]
    target = float(o["area_ratio"]) * net.area
    if o.get("polygon"):
        poly = _largest(Polygon(o["polygon"]).intersection(net))
        return poly, {"mode": "given"}
    if o.get("anchor_vertex") is None or target <= 0:
        return Polygon(), {"mode": "none"}
    v = int(o["anchor_vertex"])
    pv = pts[v]
    pp = pts[v - 1]
    theta = math.atan2(abs(pv[0] - pp[0]), abs(pv[1] - pp[1]))  # previous edge vs vertical
    x0 = pv[0] - float(o["min_width_m"]) / math.cos(theta)
    ylo = net.bounds[1] - 1.0
    area = lambda y0: net.intersection(box(x0, ylo, BIG, y0)).area  # noqa: E731
    y0 = _bisect(area, ylo, net.bounds[3] + 1.0, target)
    poly = _largest(net.intersection(box(x0, ylo, BIG, y0)))
    width_low = (pv[0] - x0) * math.cos(theta)
    return poly, {"mode": "anchored", "x0_m": round(x0, 2), "y0_m": round(y0, 2),
                  "narrowest_width_m": round(width_low, 2)}


def _make_green(cfg: dict, net: Polygon, developable: Polygon, osr: Polygon) -> tuple[float, Polygon, Polygon]:
    """EIA belt of width w along the plot boundary (and along the OSR edge if ``along_osr``).

    Returns (w, belt, developable land inside the belt)."""
    e = cfg["eia"]
    target = float(e["green_ratio"]) * net.area
    if e.get("osr_counts"):
        target = max(0.0, target - osr.area)
    if target <= 0:
        return 0.0, Polygon(), developable

    def inner(w):
        if e.get("along_osr"):
            return developable.buffer(-w, **MITRE)
        return developable.intersection(net.buffer(-w, **MITRE))

    w = _bisect(lambda w: developable.area - inner(w).area, 0.0, 40.0, target)
    keep = _largest(inner(w))
    return w, developable.difference(keep), keep
