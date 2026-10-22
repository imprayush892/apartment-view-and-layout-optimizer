"""Cruciform floor plates with explicit doors, so apartment facing is a property of the plan.

Plan (local frame, x east, y north, hub centred on the origin)::

                 +-----------+
                 |   N_end   |              door on its south wall  -> faces S
          +------+--+-----+--+------+
          | W_N  |sp | core|   E_N   |       E_N door into the stub  -> faces S
          |      |in |-----+--stub---       E_S door into the stub  -> faces N
          | W_S  |e  | core|   E_S   |       W_N, W_S doors on the spine (east wall) -> face E
          +------+--+-----+--+------+
                 |   S_end   |              door on its north wall  -> faces N
                 +-----------+

The hub holds the lift/stair core and an L-shaped lobby: a spine along its west side (reaching
both end flats and both west flats) and a corridor to the east stub. Facing follows the Vastu
convention: the direction you face when you step out of the main door. No arm puts a door on a
west-facing wall, so every variant is 0 % west; dropping the south-facing slots raises N + E.

Variants: X6 (all six), X5 (no E_N), X5b (no N_end), X4 (no E_N, no N_end).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from shapely import affinity
from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union

from viewtower.feasibility.config import FT2_PER_M2

ALL_SLOTS = ("N_end", "S_end", "E_N", "E_S", "W_N", "W_S")
VARIANTS = {
    "X6": ("N_end", "S_end", "E_N", "E_S", "W_N", "W_S"),
    "X5": ("N_end", "S_end", "E_S", "W_N", "W_S"),
    "X5b": ("S_end", "E_N", "E_S", "W_N", "W_S"),
    "X4": ("S_end", "E_S", "W_N", "W_S"),
}
# best slot first: door facing, then outlook (east and north light beat the west sun)
SLOT_ORDER = ("S_end", "E_S", "W_S", "W_N", "N_end", "E_N")
DIRS = ("N", "E", "S", "W")
DIR_VEC = {"N": (0.0, 1.0), "E": (1.0, 0.0), "S": (0.0, -1.0), "W": (-1.0, 0.0)}


def sector(vx: float, vy: float) -> str:
    az = math.degrees(math.atan2(vx, vy)) % 360.0  # clockwise from north
    return DIRS[int(((az + 45.0) % 360.0) // 90.0)]


@dataclass
class Flat:
    slot: str
    unit: str
    area_m2: float
    poly: Polygon
    door: tuple[tuple[float, float], tuple[float, float]]
    door_dir: str
    outlook: str = ""
    exterior_m: dict = field(default_factory=dict)

    @property
    def exposures(self) -> int:
        return sum(1 for v in self.exterior_m.values() if v >= 3.0)


@dataclass
class Plate:
    variant: str
    arm_depth: float
    end_width: float
    flats: list[Flat]
    hub: Polygon
    core: list[Polygon]
    lobby: Polygon
    refuge_slot: str
    footprint: Polygon = None
    area_m2: float = 0.0
    key: str = ""

    def __post_init__(self):
        parts = [f.poly for f in self.flats] + [self.hub, self.lobby]
        self.footprint = unary_union(parts).buffer(0.001, join_style="mitre").buffer(-0.001, join_style="mitre")
        self.area_m2 = sum(f.area_m2 for f in self.flats) + self.hub.area + self.lobby.difference(self.hub).area

    @property
    def k(self) -> int:
        return len(self.flats)

    @property
    def width(self) -> float:
        b = self.footprint.bounds
        return b[2] - b[0]

    @property
    def depth(self) -> float:
        b = self.footprint.bounds
        return b[3] - b[1]

    @property
    def circulation_m2(self) -> float:
        return self.area_m2 - sum(f.area_m2 for f in self.flats)

    @property
    def efficiency(self) -> float:
        return sum(f.area_m2 for f in self.flats) / self.area_m2

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for f in self.flats:
            out[f.unit] = out.get(f.unit, 0) + 1
        return out

    def facing(self) -> dict[str, int]:
        out = {d: 0 for d in DIRS}
        for f in self.flats:
            out[f.door_dir] += 1
        return out

    def refuge_flat(self) -> Flat:
        return next(f for f in self.flats if f.slot == self.refuge_slot)

    def translated(self, dx: float, dy: float) -> Polygon:
        return affinity.translate(self.footprint, dx, dy)


def unit_builtup_m2(cfg: dict) -> dict[str, float]:
    f = float(cfg["units"]["builtup_factor"])
    return {t["id"]: t["carpet_ft2"] / FT2_PER_M2 * f for t in cfg["units"]["types"]}


# 'compact': the two largest units take the end flats and each arm pairs units of similar size,
# which keeps the plate narrow (wing lengths match) at some cost in door facing
COMPACT_ORDER = ("S_end", "N_end", "W_S", "W_N", "E_S", "E_N")


def assign_slots(variant: str, composition: tuple[str, ...], carpet: dict[str, float],
                 strategy: str = "value") -> dict[str, str]:
    """'value': largest units to the best slots (door facing first, then outlook); 'compact': see above."""
    order = COMPACT_ORDER if strategy == "compact" else SLOT_ORDER
    slots = [s for s in order if s in VARIANTS[variant]]
    units = sorted(composition, key=lambda u: (-carpet[u], u))
    return dict(zip(slots, units))


def build_plate(variant: str, assignment: dict[str, str], area: dict[str, float], pcfg: dict,
                arm_depth: float, end_width: float) -> Plate:
    slots = VARIANTS[variant]
    a = float(pcfg["corridor_m"])
    e = float(pcfg["stub_m"])
    core_m2 = float(pcfg["core_m2"][len(slots)] if len(slots) in pcfg["core_m2"] else pcfg["core_m2"][str(len(slots))])
    cr = float(arm_depth)
    dw = cr / 2.0
    cc = a + core_m2 / (cr - a)
    wend = max(float(end_width), cc)
    x0, x1, y0, y1 = -cc / 2, cc / 2, -cr / 2, cr / 2
    hub = box(x0, y0, x1, y1)
    spine = box(x0, y0, x0 + a, y1)
    has_east = any(s in slots for s in ("E_N", "E_S"))
    corridor = box(x0 + a, -a / 2, x1, a / 2) if has_east else Polygon()
    core = [box(x0 + a, a / 2 if has_east else 0.0, x1, y1), box(x0 + a, y0, x1, -a / 2 if has_east else 0.0)]
    if not has_east:
        core = [box(x0 + a, y0, x1, y1)]
    stub = box(x1, -a / 2, x1 + e, a / 2) if has_east else Polygon()
    lobby = unary_union([g for g in (spine, corridor, stub) if not g.is_empty])
    flats: list[Flat] = []
    for s in slots:
        u = assignment[s]
        A = area[u]
        if s == "W_N":
            L = A / dw
            p = box(x0 - L, 0.0, x0, dw)
            door = ((x0, dw / 2 - 0.5), (x0, dw / 2 + 0.5))
            d = "E"
        elif s == "W_S":
            L = A / dw
            p = box(x0 - L, -dw, x0, 0.0)
            door = ((x0, -dw / 2 - 0.5), (x0, -dw / 2 + 0.5))
            d = "E"
        elif s == "E_N":
            L = (A + e * a / 2) / dw
            p = box(x1, 0.0, x1 + L, dw).difference(box(x1, 0.0, x1 + e, a / 2))
            door = ((x1 + e / 2 - 0.5, a / 2), (x1 + e / 2 + 0.5, a / 2))
            d = "S"
        elif s == "E_S":
            L = (A + e * a / 2) / dw
            p = box(x1, -dw, x1 + L, 0.0).difference(box(x1, -a / 2, x1 + e, 0.0))
            door = ((x1 + e / 2 - 0.5, -a / 2), (x1 + e / 2 + 0.5, -a / 2))
            d = "N"
        elif s == "N_end":
            D = A / wend
            p = box(-wend / 2, y1, wend / 2, y1 + D)
            door = ((x0 + a / 2 - 0.5, y1), (x0 + a / 2 + 0.5, y1))
            d = "S"
        else:  # S_end
            D = A / wend
            p = box(-wend / 2, y0 - D, wend / 2, y0)
            door = ((x0 + a / 2 - 0.5, y0), (x0 + a / 2 + 0.5, y0))
            d = "N"
        flats.append(Flat(s, u, round(p.area, 3), p, door, d))
    if not has_east:
        lobby = spine
    refuge = [s for s in SLOT_ORDER if s in slots][-1]
    plate = Plate(variant, cr, wend, flats, hub, core, lobby, refuge)
    _exteriors(plate)
    plate.key = f"{variant}|{cr:g}|{wend:g}|" + ",".join(assignment[s] for s in slots)
    return plate


def _exteriors(plate: Plate) -> None:
    """Exterior facade length per direction for each flat, and its principal outlook."""
    others_all = [f.poly for f in plate.flats] + [plate.hub, plate.lobby]
    for f in plate.flats:
        others = unary_union([g for g in others_all if g is not f.poly]).buffer(0.01)
        ring = list(f.poly.exterior.coords)
        ext = {d: 0.0 for d in DIRS}
        # outward normal of each edge of a CCW ring is (dy, -dx)
        ccw = f.poly.exterior.is_ccw
        for (ax, ay), (bx, by) in zip(ring[:-1], ring[1:]):
            seg = LineString([(ax, ay), (bx, by)])
            free = seg.difference(others).length
            if free < 1e-6:
                continue
            dx, dy = bx - ax, by - ay
            nx, ny = (dy, -dx) if ccw else (-dy, dx)
            ext[sector(nx, ny)] += free
        f.exterior_m = {k: round(v, 2) for k, v in ext.items()}
        f.outlook = max(DIRS, key=lambda k: (ext[k], -DIRS.index(k)))
