"""Room layouts inside each flat of a cruciform plate, solved as a constraint problem (OR-tools CP-SAT).

Every flat is mapped to a local frame: ``u`` along its main facade (``u = 0`` at its exterior side
facade, the arm tip), ``v`` from the main facade inwards. Rooms are axis-aligned rectangles on a
0.3 m planning grid that tile the flat exactly (around a lobby notch or a shared shaft). The rules
are hard constraints, after NBC 2016 Part 3 and common Indian apartment practice:

* light and air: living, bedrooms and study touch an exterior wall for a window of at least a tenth
  of the floor area, and no part of the room is more than 7.5 m from it; or they take their light
  through the balcony (an open verandah under 2.4 m deep, which NBC allows) on the same terms; the
  kitchen opens to an exterior utility (or has its own window);
* shafts: every toilet has a ventilator on an exterior wall or on a ventilation shaft; twin wing
  flats share one shaft (open to sky, reached from the common lobby) across their party wall. Its
  size is ``rooms.shaft_w_m`` x ``rooms.shaft_d_m``: NBC asks about 8 m2 with a 2.4 m side for
  buildings over 30 m, with mechanical exhaust besides;
* access: the foyer takes the main door; living, dining, foyer and passage form one connected
  circulation; every bedroom, kitchen, study, pooja and common toilet opens off it; attached toilets
  and dress open off their bedroom; the utility opens off the kitchen; the balcony off the living;
* minimum sizes (net of walls: bedrooms 9.5 / 7.5 m2, kitchen 5 m2, bath + WC 2.8 m2) and
  proportions per room.

Vastu placements (kitchen south-east, master bedroom south-west, pooja north-east, no toilet in the
north-east) are soft preferences in the objective, as is matching each room's target area.
Solves are deterministic (interleaved workers on a work budget); twin flats (mirror images in the
canonical frame) start from each other's solution.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, replace

from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union

from viewtower.feasibility.plates import Plate

GRID = 0.3  # planning grid (m); the flat is trimmed to whole modules, the trim joins the outer wall

# kind -> rules. ext: 'hab' (window), 'vent' (exterior or shaft ventilator), 'bal', 'ext' (open to air), None
KINDS = {
    "FOY": dict(label="Foyer", ext=None, minw=1.2),
    "LIV": dict(label="Living", ext="hab", minw=3.3),
    "DIN": dict(label="Dining", ext=None, minw=2.4),
    "KIT": dict(label="Kitchen", ext=None, minw=2.1),
    "UTL": dict(label="Utility", ext="ext", minw=1.1),
    "BAL": dict(label="Balcony", ext="bal", minw=1.5),
    "MBR": dict(label="Master bed", ext="hab", minw=3.0),
    "BR2": dict(label="Bedroom 2", ext="hab", minw=2.9),
    "BR3": dict(label="Bedroom 3", ext="hab", minw=2.8),
    "BR4": dict(label="Bedroom 4", ext="hab", minw=2.8),
    "STD": dict(label="Study", ext="hab", minw=2.3),
    "MT": dict(label="Toilet", ext="vent", minw=1.4),
    "T2": dict(label="Toilet", ext="vent", minw=1.4),
    "T3": dict(label="Toilet", ext="vent", minw=1.4),
    "T4": dict(label="Toilet", ext="vent", minw=1.4),
    "CT": dict(label="Common toilet", ext="vent", minw=1.4),
    "PWD": dict(label="Powder", ext="vent", minw=1.1),
    "DRS": dict(label="Dress", ext=None, minw=1.4),
    "POJ": dict(label="Pooja", ext=None, minw=1.1),
    "PAS": dict(label="Passage", ext=None, minw=1.2),
}
CIRC = ("FOY", "LIV", "DIN", "PAS")

# net carpet targets (m2) per unit type; scaled to the flat's actual area
PROGRAMS = {
    "1BHK": dict(FOY=2.5, LIV=15.0, DIN=5.0, KIT=6.0, UTL=2.2, BAL=3.6, MBR=11.0, MT=3.4, PAS=3.0),
    "2BHK": dict(FOY=2.8, LIV=16.0, DIN=7.5, KIT=6.5, UTL=2.4, BAL=4.2, MBR=11.5, MT=3.5, BR2=10.0, CT=3.2, PAS=5.0),
    "2.5BHK": dict(FOY=3.0, LIV=17.0, DIN=8.5, KIT=7.0, UTL=2.6, BAL=4.8, MBR=12.0, MT=3.6, BR2=10.5, CT=3.3, STD=6.5, PAS=5.5),
    "3BHK": dict(FOY=3.2, LIV=18.0, DIN=9.0, KIT=7.5, UTL=2.8, BAL=5.0, MBR=12.5, MT=3.8, BR2=11.0, T2=3.4, BR3=10.0,
                 CT=3.3, PAS=6.0),
    "3BHK+": dict(FOY=3.5, LIV=20.0, DIN=10.0, KIT=8.0, UTL=3.0, BAL=6.0, MBR=13.5, MT=4.0, BR2=12.0, T2=3.6, BR3=11.0,
                  CT=3.5, POJ=1.8, PAS=6.5),
    "3BHK-L": dict(FOY=4.0, LIV=22.0, DIN=11.0, KIT=8.5, UTL=3.2, BAL=7.0, MBR=14.5, DRS=3.0, MT=4.5, BR2=13.0, T2=3.8,
                   BR3=12.0, T3=3.6, POJ=2.0, PAS=7.0),
    "3.5BHK": dict(FOY=4.0, LIV=23.0, DIN=11.5, KIT=9.0, UTL=3.5, BAL=7.5, MBR=15.0, DRS=3.2, MT=4.6, BR2=13.0, T2=3.8,
                   BR3=12.0, T3=3.6, STD=8.5, PWD=2.0, POJ=2.0, PAS=7.5),
    "4BHK": dict(FOY=4.5, LIV=25.0, DIN=12.5, KIT=10.0, UTL=4.0, BAL=8.0, MBR=16.0, DRS=3.5, MT=5.0, BR2=13.5, T2=4.0,
                 BR3=12.5, T3=3.8, BR4=12.0, T4=3.8, PWD=2.0, POJ=2.0, PAS=8.5),
}
# who opens off whom: room -> (rooms it may open onto, min shared wall m)
ACCESS = {
    "KIT": (("DIN", "FOY", "PAS"), 0.9), "UTL": (("KIT",), 0.9), "BAL": (("LIV",), 1.8),
    "MBR": (CIRC, 0.9), "BR2": (CIRC, 0.9), "BR3": (CIRC, 0.9), "BR4": (CIRC, 0.9), "STD": (CIRC, 0.9),
    "MT": (("MBR", "DRS"), 0.8), "T2": (("BR2",), 0.8), "T3": (("BR3",), 0.8), "T4": (("BR4",), 0.8),
    "DRS": (("MBR",), 0.9),
    "CT": (("PAS", "DIN", "FOY"), 0.8), "PWD": (("FOY", "PAS", "DIN"), 0.8), "POJ": (("DIN", "LIV", "FOY", "PAS"), 0.8),
}


def program_for(label: str) -> str:
    """Room programme for a unit label such as '2.5 BHK' or '3 BHK Large' (``units.types[].program``
    overrides it)."""
    lab = label.upper().replace(" ", "")
    m = re.search(r"(\d(?:\.5)?)BHK", lab)
    n = float(m.group(1)) if m else 3.0
    if n >= 4:
        return "4BHK"
    if n == 3.5:
        return "3.5BHK"
    if n == 3:
        if "LARGE" in lab or lab.endswith("BHKL"):
            return "3BHK-L"
        return "3BHK+" if ("PLUS" in lab or lab.endswith("+")) else "3BHK"
    return {2.5: "2.5BHK", 2.0: "2BHK"}.get(n, "1BHK")


# ------------------------------------------------------------------ frames
@dataclass
class FlatFrame:
    slot: str
    unit: str
    W: float
    D: float
    ext: dict            # side -> list of (a, b) exterior intervals along that side
    entry: tuple         # (side or 'notch', a, b, level) ; level = v of a notch edge
    notch: tuple | None  # (u0, v0, u1, v1)
    shaft: tuple | None  # (u0, v0, u1, v1)
    origin: tuple        # (xmin, ymin, xmax, ymax) of the flat in plate coords
    front: str           # 'N' | 'S'
    left: str            # 'W' | 'E'

    def to_plate(self, u: float, v: float) -> tuple[float, float]:
        xmin, ymin, xmax, ymax = self.origin
        x = xmin + u if self.left == "W" else xmax - u
        y = ymax - v if self.front == "N" else ymin + v
        return x, y

    def to_canon(self, x: float, y: float) -> tuple[float, float]:
        xmin, ymin, xmax, ymax = self.origin
        u = x - xmin if self.left == "W" else xmax - x
        v = ymax - y if self.front == "N" else y - ymin
        return u, v

    def absolute(self, side: str) -> str:
        """Compass direction of a frame side."""
        return {"front": self.front, "back": "S" if self.front == "N" else "N",
                "left": self.left, "right": "E" if self.left == "W" else "W"}[side]


def shaft_rects(plate: Plate, rcfg: dict) -> list[Polygon]:
    """One ventilation shaft across the party wall of each pair of twin wing flats, against the lobby."""
    rc = rcfg or {}
    sw, sd = float(rc.get("shaft_w_m", 2.4)), float(rc.get("shaft_d_m", 3.4))
    slots = {f.slot for f in plate.flats}
    hb = plate.hub.bounds
    out = []
    if {"W_N", "W_S"} <= slots:
        out.append(box(hb[0] - sw, -sd / 2, hb[0], sd / 2))
    if {"E_N", "E_S"} <= slots:
        stub = plate.lobby.bounds[2]
        out.append(box(stub, -sd / 2, stub + sw, sd / 2))
    return out


def frames(plate: Plate, rcfg: dict) -> list[FlatFrame]:
    shafts = shaft_rects(plate, rcfg)
    parts = [f.poly for f in plate.flats] + [plate.hub, plate.lobby]
    out = []
    for f in plate.flats:
        xmin, ymin, xmax, ymax = f.poly.bounds
        front = "N" if f.slot.endswith("_N") or f.slot == "N_end" else "S"
        left = "E" if f.slot.startswith("E_") else "W"
        fr = FlatFrame(f.slot, f.unit, xmax - xmin, ymax - ymin, {}, (), None, None, (xmin, ymin, xmax, ymax), front, left)
        others = unary_union([p for p in parts if p is not f.poly] + shafts).buffer(0.02)
        sides = {"front": ((0, 0), (fr.W, 0)), "back": ((0, fr.D), (fr.W, fr.D)),
                 "left": ((0, 0), (0, fr.D)), "right": ((fr.W, 0), (fr.W, fr.D))}
        for side, (a, b) in sides.items():
            seg = LineString([fr.to_plate(*a), fr.to_plate(*b)])
            free = seg.difference(others)
            ivs = []
            for g in getattr(free, "geoms", [free]):
                if g.is_empty or g.length < 0.6:
                    continue
                pts = [fr.to_canon(*c) for c in g.coords]
                k = 0 if side in ("front", "back") else 1
                ivs.append((min(p[k] for p in pts), max(p[k] for p in pts)))
            fr.ext[side] = sorted(ivs)
        hole = box(xmin, ymin, xmax, ymax).difference(f.poly)
        if hole.area > 0.01:
            fr.notch = _canon_rect(fr, hole.bounds)
        for s in shafts:
            if s.intersection(box(xmin, ymin, xmax, ymax)).area > 0.01:
                fr.shaft = _canon_rect(fr, s.intersection(box(xmin, ymin, xmax, ymax)).bounds)
        (dx0, dy0), (dx1, dy1) = f.door
        a, b = fr.to_canon(dx0, dy0), fr.to_canon(dx1, dy1)
        if abs(a[0] - b[0]) < 1e-6:  # vertical door: on left/right side
            side = "right" if abs(a[0] - fr.W) < 1e-3 else ("left" if abs(a[0]) < 1e-3 else "notch_v")
            fr.entry = (side, min(a[1], b[1]), max(a[1], b[1]), a[0])
        else:
            side = "back" if abs(a[1] - fr.D) < 1e-3 else ("front" if abs(a[1]) < 1e-3 else "notch")
            fr.entry = (side, min(a[0], b[0]), max(a[0], b[0]), a[1])
        out.append(fr)
    return out


def _canon_rect(fr: FlatFrame, b) -> tuple:
    p0, p1 = fr.to_canon(b[0], b[1]), fr.to_canon(b[2], b[3])
    return (min(p0[0], p1[0]), min(p0[1], p1[1]), max(p0[0], p1[0]), max(p0[1], p1[1]))


# ------------------------------------------------------------------ solution containers
@dataclass
class Room:
    code: str
    label: str
    rect: tuple  # canonical (u0, v0, u1, v1) metres
    windows: list = field(default_factory=list)   # canonical segments ((u,v),(u,v))
    vents: list = field(default_factory=list)
    through_balcony: bool = False                 # its window opens onto the balcony, not the outside

    @property
    def area(self) -> float:
        return (self.rect[2] - self.rect[0]) * (self.rect[3] - self.rect[1])


@dataclass
class FlatLayout:
    frame: FlatFrame
    program: str
    rooms: list[Room]
    doors: list = field(default_factory=list)      # (room_a, room_b, ((u,v),(u,v)), width)
    checks: list = field(default_factory=list)     # (ok, text)
    vastu: dict = field(default_factory=dict)
    status: str = ""

    def room(self, code: str) -> Room | None:
        return next((r for r in self.rooms if r.code == code), None)


# ------------------------------------------------------------------ solver
def _iv(a: float) -> int:
    return int(round(a / GRID))


def _fl(a: float) -> int:
    return int(a / GRID + 1e-6)


def solve_flat(fr: FlatFrame, unit_label: str, rcfg: dict | None = None, time_s: float = 20.0,
               workers: int = 4, seed: int = 0, hint: FlatLayout | None = None) -> FlatLayout:
    from ortools.sat.python import cp_model

    rcfg = rcfg or {}
    prog_name = unit_label if unit_label in PROGRAMS else program_for(unit_label)
    targets = dict((rcfg.get("programs") or {}).get(prog_name) or PROGRAMS[prog_name])
    Wi, Di = _fl(fr.W), _fl(fr.D)
    Wt, Dt = Wi * GRID, Di * GRID
    snap = lambda r: tuple(_iv(t) * GRID for t in r) if r else None
    fr = replace(fr, W=Wt, D=Dt, notch=snap(fr.notch), shaft=snap(fr.shaft),
                 ext={sd: [(_iv(a) * GRID, min(_iv(b) * GRID, Wt if sd in ("front", "back") else Dt))
                           for a, b in ivs if min(b, Wt if sd in ("front", "back") else Dt) - a > 0.6]
                      for sd, ivs in fr.ext.items()})
    fixed = [r for r in (fr.notch, fr.shaft) if r]
    free_area = Wi * Di - sum((_iv(r[2]) - _iv(r[0])) * (_iv(r[3]) - _iv(r[1])) for r in fixed)
    G2 = 1.0 / (GRID * GRID)
    scale = free_area / G2 / sum(targets.values())
    tgt = {k: v * scale for k, v in targets.items()}
    codes = list(tgt)
    m = cp_model.CpModel()
    X, Y, Wv, Hv, A, xi, yi = {}, {}, {}, {}, {}, {}, {}
    for c in codes:
        k = KINDS[c]
        mw = _iv(k["minw"])
        X[c] = m.NewIntVar(0, Wi, f"x{c}")
        Y[c] = m.NewIntVar(0, Di, f"y{c}")
        Wv[c] = m.NewIntVar(mw, Wi, f"w{c}")
        Hv[c] = m.NewIntVar(mw, Di, f"h{c}")
        lo = int(min(tgt[c] * 0.70, max(tgt[c] * 0.55, 1.0)) * G2)
        hi = int(tgt[c] * {"PAS": 1.6, "DIN": 1.6, "FOY": 1.5}.get(c, 1.45) * G2) + 1
        A[c] = m.NewIntVar(lo, hi, f"a{c}")
        m.AddMultiplicationEquality(A[c], [Wv[c], Hv[c]])
        m.Add(X[c] + Wv[c] <= Wi)
        m.Add(Y[c] + Hv[c] <= Di)
        xe = m.NewIntVar(0, Wi, f"xe{c}")
        ye = m.NewIntVar(0, Di, f"ye{c}")
        m.Add(xe == X[c] + Wv[c])
        m.Add(ye == Y[c] + Hv[c])
        xi[c] = m.NewIntervalVar(X[c], Wv[c], xe, f"xi{c}")
        yi[c] = m.NewIntervalVar(Y[c], Hv[c], ye, f"yi{c}")
        if c not in ("PAS", "BAL", "UTL"):
            m.Add(Wv[c] * 10 <= 22 * Hv[c])
            m.Add(Hv[c] * 10 <= 22 * Wv[c])
        if c in NBC_MIN:  # net of a half wall all round: (w - WALL)(h - WALL) >= min, linear in A, w, h
            m.Add(100 * A[c] - int(round(100 * WALL / GRID)) * (Wv[c] + Hv[c])
                  >= int(round(100 * (NBC_MIN[c] - WALL * WALL) * G2)) + 1)
    fx, fy = [], []
    for r in fixed:
        u0, v0, u1, v1 = (_iv(t) for t in r)
        fx.append(m.NewFixedSizeIntervalVar(u0, u1 - u0, "fx"))
        fy.append(m.NewFixedSizeIntervalVar(v0, v1 - v0, "fy"))
    m.AddNoOverlap2D([xi[c] for c in codes] + fx, [yi[c] for c in codes] + fy)
    m.Add(sum(A[c] for c in codes) == free_area)

    def overlap_ge(a0, a1, b0, b1, L):
        """Linear conditions for [a0,a1] and [b0,b1] to overlap by at least L (to be enforced together)."""
        return [a1 - b0 >= L, b1 - a0 >= L, a1 - a0 >= L, b1 - b0 >= L]

    def touch_side(c, side, iv, L, by_area=False):
        """Bool: room c lies on frame side ``side`` and covers at least L of the interval iv; with
        ``by_area`` also enough of it for a window of a tenth of the room's area (1.5 m high, set
        0.15 m in from each end): length >= area / 15 + 0.3 m."""
        b = m.NewBoolVar(f"t{c}{side}{iv}")
        s0, s1 = _iv(iv[0]), _iv(iv[1])
        if side == "front":
            m.Add(Y[c] == 0).OnlyEnforceIf(b)
            cons = overlap_ge(X[c], X[c] + Wv[c], s0, s1, L)
        elif side == "back":
            m.Add(Y[c] + Hv[c] == Di).OnlyEnforceIf(b)
            cons = overlap_ge(X[c], X[c] + Wv[c], s0, s1, L)
        elif side == "left":
            m.Add(X[c] == 0).OnlyEnforceIf(b)
            cons = overlap_ge(Y[c], Y[c] + Hv[c], s0, s1, L)
        else:
            m.Add(X[c] + Wv[c] == Wi).OnlyEnforceIf(b)
            cons = overlap_ge(Y[c], Y[c] + Hv[c], s0, s1, L)
        for k in cons:
            if not isinstance(k, bool):
                m.Add(k).OnlyEnforceIf(b)
        if by_area:  # 15000 x overlap >= 1000 G x A + 4500 / G  (overlap and A in grid units)
            a0, a1 = (X[c], X[c] + Wv[c]) if side in ("front", "back") else (Y[c], Y[c] + Hv[c])
            rhs = int(round(1000 * GRID)) * A[c] + int(round(4500 / GRID))
            for e in (a1 - s0, s1 - a0, a1 - a0):
                m.Add(15000 * e >= rhs).OnlyEnforceIf(b)
            m.Add(15000 * (s1 - s0) >= rhs).OnlyEnforceIf(b)
        return b

    def exterior_any(c, L, by_area=False):
        bs = []
        for side, ivs in fr.ext.items():
            for iv in ivs:
                if iv[1] - iv[0] >= L * GRID:
                    bs.append((side, touch_side(c, side, iv, L, by_area)))
        return bs

    def touch_rect(c, r, L):
        """Bool: room c shares a wall of at least L with the fixed rect r."""
        u0, v0, u1, v1 = (_iv(t) for t in r)
        opts = []
        for kind in range(4):
            b = m.NewBoolVar(f"r{c}{kind}")
            if kind == 0:
                m.Add(X[c] + Wv[c] == u0).OnlyEnforceIf(b)
                cons = overlap_ge(Y[c], Y[c] + Hv[c], v0, v1, L)
            elif kind == 1:
                m.Add(X[c] == u1).OnlyEnforceIf(b)
                cons = overlap_ge(Y[c], Y[c] + Hv[c], v0, v1, L)
            elif kind == 2:
                m.Add(Y[c] + Hv[c] == v0).OnlyEnforceIf(b)
                cons = overlap_ge(X[c], X[c] + Wv[c], u0, u1, L)
            else:
                m.Add(Y[c] == v1).OnlyEnforceIf(b)
                cons = overlap_ge(X[c], X[c] + Wv[c], u0, u1, L)
            for k in cons:
                if not isinstance(k, bool):
                    m.Add(k).OnlyEnforceIf(b)
            opts.append(b)
        return opts

    adj_cache = {}

    def adjacent(a, b, L):
        key = (a, b, L)
        if key in adj_cache:
            return adj_cache[key]
        opts = []
        for kind in range(4):
            v = m.NewBoolVar(f"j{a}{b}{kind}")
            if kind == 0:
                m.Add(X[a] + Wv[a] == X[b]).OnlyEnforceIf(v)
                cons = overlap_ge(Y[a], Y[a] + Hv[a], Y[b], Y[b] + Hv[b], L)
            elif kind == 1:
                m.Add(X[b] + Wv[b] == X[a]).OnlyEnforceIf(v)
                cons = overlap_ge(Y[a], Y[a] + Hv[a], Y[b], Y[b] + Hv[b], L)
            elif kind == 2:
                m.Add(Y[a] + Hv[a] == Y[b]).OnlyEnforceIf(v)
                cons = overlap_ge(X[a], X[a] + Wv[a], X[b], X[b] + Wv[b], L)
            else:
                m.Add(Y[b] + Hv[b] == Y[a]).OnlyEnforceIf(v)
                cons = overlap_ge(X[a], X[a] + Wv[a], X[b], X[b] + Wv[b], L)
            for k in cons:
                m.Add(k).OnlyEnforceIf(v)
            opts.append(v)
        any_ = m.NewBoolVar(f"J{a}{b}")
        m.AddBoolOr(opts).OnlyEnforceIf(any_)
        for v in opts:
            m.AddImplication(v, any_)
        adj_cache[key] = any_
        return any_

    def lit_via_balcony(c):
        """Bool: habitable room c takes its light and air through the balcony (an open verandah
        under 2.4 m deep): a shared wall long enough for an opening of a tenth of its area, and no
        point more than 7.5 m from that wall."""
        opts = []
        rhs = int(round(1000 * GRID)) * A[c] + int(round(4500 / GRID))
        for kind in range(4):
            v = m.NewBoolVar(f"lb{c}{kind}")
            if kind in (0, 1):  # side by side: the shared wall runs along v
                m.Add((X[c] + Wv[c] if kind == 0 else X["BAL"] + Wv["BAL"]) == (X["BAL"] if kind == 0 else X[c])).OnlyEnforceIf(v)
                a0, a1, b0, b1 = Y[c], Y[c] + Hv[c], Y["BAL"], Y["BAL"] + Hv["BAL"]
                m.Add(Wv[c] <= _fl(7.5)).OnlyEnforceIf(v)
            else:  # one above the other: the shared wall runs along u
                m.Add((Y[c] + Hv[c] if kind == 2 else Y["BAL"] + Hv["BAL"]) == (Y["BAL"] if kind == 2 else Y[c])).OnlyEnforceIf(v)
                a0, a1, b0, b1 = X[c], X[c] + Wv[c], X["BAL"], X["BAL"] + Wv["BAL"]
                m.Add(Hv[c] <= _fl(7.5)).OnlyEnforceIf(v)
            for e in (a1 - b0, b1 - a0, a1 - a0, b1 - b0):
                m.Add(15000 * e >= rhs).OnlyEnforceIf(v)
            opts.append(v)
        any_ = m.NewBoolVar(f"LB{c}")
        m.AddBoolOr(opts).OnlyEnforceIf(any_)
        for v in opts:
            m.AddImplication(v, any_)
        return any_

    bonus = []  # (weight, bool) to maximise
    # ---- light and air
    ext_flags = {}
    for c in codes:
        rule = KINDS[c]["ext"]
        if rule == "hab":
            L = _iv(max(1.2, tgt[c] / 15.0 + 0.3))
            flags = exterior_any(c, L, by_area=True)
            ext_flags[c] = flags
            for side, b in flags:  # depth from the window <= 7.5 m
                if side in ("front", "back"):
                    m.Add(Hv[c] <= _fl(7.5)).OnlyEnforceIf(b)
                else:
                    m.Add(Wv[c] <= _fl(7.5)).OnlyEnforceIf(b)
            if "BAL" in codes:  # an own window, or light through the balcony
                m.AddBoolOr([b for _, b in flags] + [lit_via_balcony(c)])
                for _, b in flags:
                    bonus.append((30 if c == "LIV" else 20, b))
            else:
                m.AddBoolOr([b for _, b in flags])
            if c in ("MBR", "LIV"):  # two exposures: cross ventilation
                two = m.NewBoolVar(f"two{c}")
                m.Add(sum(b for _, b in flags) >= 2).OnlyEnforceIf(two)
                bonus.append((25, two))
        elif rule == "vent":
            opts = [b for _, b in exterior_any(c, _iv(0.6))]
            if fr.shaft:
                opts += touch_rect(c, fr.shaft, _iv(0.6))
            m.AddBoolOr(opts)
        elif rule == "ext":
            m.AddBoolOr([b for _, b in exterior_any(c, _iv(1.1))])
        elif rule == "bal":
            fl = [b for side, b in exterior_any(c, _iv(2.0)) if side == "front"]
            m.AddBoolOr(fl)
            m.Add(Hv[c] <= _fl(2.0))
    if "KIT" in codes:
        kflags = [b for _, b in exterior_any("KIT", _iv(1.0))]
        for b in kflags:
            bonus.append((15, b))
        m.Add(adjacent("KIT", "UTL", _iv(1.0)) == 1)
    # ---- access
    side, e0, e1, lvl = fr.entry
    E0, E1, LV = _iv(e0), _iv(e1), _iv(lvl)
    if side == "right":
        m.Add(X["FOY"] + Wv["FOY"] == Wi)
        m.Add(Y["FOY"] <= E0)
        m.Add(Y["FOY"] + Hv["FOY"] >= E1)
    elif side == "back":
        m.Add(Y["FOY"] + Hv["FOY"] == Di)
        m.Add(X["FOY"] <= E0)
        m.Add(X["FOY"] + Wv["FOY"] >= E1)
    elif side == "notch":
        m.Add(Y["FOY"] + Hv["FOY"] == LV)
        m.Add(X["FOY"] <= E0)
        m.Add(X["FOY"] + Wv["FOY"] >= E1)
    else:
        raise ValueError(f"unsupported entry side {side}")
    one = _iv(1.0)
    m.AddBoolOr([adjacent("FOY", c, one) for c in ("LIV", "DIN", "PAS") if c in codes])
    m.Add(adjacent("LIV", "DIN", _iv(2.0)) == 1)
    m.AddBoolOr([adjacent(a, b, one) for a in ("LIV", "DIN") for b in ("FOY", "PAS") if b in codes])
    if "PAS" in codes:
        m.AddBoolOr([adjacent("PAS", c, one) for c in ("FOY", "DIN", "LIV")])
    for c, (parents, L) in ACCESS.items():
        if c not in codes:
            continue
        ps = [p for p in parents if p in codes]
        m.AddBoolOr([adjacent(c, p, _iv(L)) for p in ps])
    for c in ("MBR", "BR2", "BR3", "BR4", "STD"):  # bedrooms off the passage or foyer rather than the living
        if c in codes:
            bonus.append((8, adjacent(c, "PAS", _iv(0.9)) if "PAS" in codes else adjacent(c, "FOY", _iv(0.9))))
    # ---- Vastu (soft): compass quadrants of the flat
    def quadrant(c, q):
        ns, ew = q[0], q[1]
        b = m.NewBoolVar(f"q{c}{q}")
        cu = 2 * X[c] + Wv[c]   # 2 x centre (u)
        cv = 2 * Y[c] + Hv[c]
        for d in (ns, ew):
            # side of the frame facing d, and whether the room centre lies in that half
            if fr.absolute("front") == d:
                m.Add(cv <= Di).OnlyEnforceIf(b)
            elif fr.absolute("back") == d:
                m.Add(cv >= Di).OnlyEnforceIf(b)
            elif fr.absolute("left") == d:
                m.Add(cu <= Wi).OnlyEnforceIf(b)
            else:
                m.Add(cu >= Wi).OnlyEnforceIf(b)
        return b
    vastu = {}
    if "KIT" in codes:
        vastu["kitchen_SE"] = quadrant("KIT", "SE")
        bonus.append((12, vastu["kitchen_SE"]))
    vastu["master_SW"] = quadrant("MBR", "SW")
    bonus.append((12, vastu["master_SW"]))
    if "POJ" in codes:
        vastu["pooja_NE"] = quadrant("POJ", "NE")
        bonus.append((8, vastu["pooja_NE"]))
    for c in ("MT", "T2", "T3", "T4", "CT", "PWD"):
        if c in codes:
            ne = quadrant(c, "NE")
            vastu[f"{c}_not_NE"] = ne
            bonus.append((-6, ne))
    # ---- objective: area match first, then the bonuses
    devs = []
    for c in codes:
        d = m.NewIntVar(0, Wi * Di, f"d{c}")
        t = int(tgt[c] * G2)
        m.AddAbsEquality(d, A[c] - t)
        wgt = 1 if c in ("PAS", "DIN", "FOY") else 2
        devs.append(wgt * d)
    m.Minimize(sum(devs) - 40 * sum(w * b for w, b in bonus))
    if hint is not None:  # a solved twin (same canonical frame): start from its rooms
        for r in hint.rooms:
            if r.code in X:
                u0, v0, u1, v1 = (_iv(t) for t in r.rect)
                m.AddHint(X[r.code], u0); m.AddHint(Y[r.code], v0)
                m.AddHint(Wv[r.code], u1 - u0); m.AddHint(Hv[r.code], v1 - v0)
    solver = cp_model.CpSolver()  # deterministic: interleaved workers on a work budget
    solver.parameters.num_search_workers = int(workers)
    solver.parameters.interleave_search = True
    solver.parameters.max_deterministic_time = float(time_s)
    solver.parameters.max_time_in_seconds = 6 * float(time_s)
    solver.parameters.random_seed = int(seed)
    st = solver.Solve(m)
    lay = FlatLayout(fr, prog_name, [], status=solver.StatusName(st))
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return lay
    for c in codes:
        u0, v0 = solver.Value(X[c]) * GRID, solver.Value(Y[c]) * GRID
        lay.rooms.append(Room(c, KINDS[c]["label"], (u0, v0, u0 + solver.Value(Wv[c]) * GRID,
                                                      v0 + solver.Value(Hv[c]) * GRID)))
    lay.vastu = {k: bool(solver.Value(v)) if not k.endswith("_not_NE") else not solver.Value(v) for k, v in vastu.items()}
    _finish(lay)
    return lay


# ------------------------------------------------------------------ doors, windows, checks
WALL = 0.15          # internal wall allowance for net (carpet) dimensions
WIN_H = 1.5          # window height (sill 0.9 m to lintel 2.4 m)
DOOR_W = {"main": 1.05, "MBR": 0.9, "BR2": 0.9, "BR3": 0.9, "STD": 0.9, "KIT": 0.9, "UTL": 0.8, "BAL": 1.5,
          "MT": 0.75, "T2": 0.75, "T3": 0.75, "CT": 0.75, "PWD": 0.75, "DRS": 0.9, "POJ": 0.8}
OPEN = {frozenset(p) for p in (("LIV", "DIN"), ("FOY", "PAS"), ("DIN", "PAS"), ("FOY", "DIN"), ("LIV", "FOY"),
                                ("LIV", "PAS"))}
NBC_MIN = {"MBR": 9.5, "BR2": 7.5, "BR3": 7.5, "BR4": 7.5, "STD": 7.5, "LIV": 9.5, "KIT": 5.0, "MT": 2.8, "T2": 2.8,
           "T3": 2.8, "T4": 2.8, "CT": 2.8, "PWD": 1.1}


def shared_wall(a: tuple, b: tuple):
    """Shared boundary segment of two touching rectangles, or None."""
    (a0, a1, a2, a3), (b0, b1, b2, b3) = a, b
    e = 1e-6
    if abs(a2 - b0) < e or abs(b2 - a0) < e:
        u = a2 if abs(a2 - b0) < e else a0
        lo, hi = max(a1, b1), min(a3, b3)
        return ((u, lo), (u, hi)) if hi - lo > e else None
    if abs(a3 - b1) < e or abs(b3 - a1) < e:
        v = a3 if abs(a3 - b1) < e else a1
        lo, hi = max(a0, b0), min(a2, b2)
        return ((lo, v), (hi, v)) if hi - lo > e else None
    return None


def _seg_len(s) -> float:
    return abs(s[1][0] - s[0][0]) + abs(s[1][1] - s[0][1])


def _sub(s, width: float, at: str = "centre"):
    (x0, y0), (x1, y1) = s
    L = _seg_len(s)
    w = min(width, L)
    t0 = (L - w) / 2 if at == "centre" else min(0.15, L - w)
    f0, f1 = t0 / L, (t0 + w) / L
    return ((x0 + (x1 - x0) * f0, y0 + (y1 - y0) * f0), (x0 + (x1 - x0) * f1, y0 + (y1 - y0) * f1))


def exterior_contacts(fr: FlatFrame, rect: tuple) -> list:
    """(side, segment) where a room rectangle lies on the flat's exterior."""
    u0, v0, u1, v1 = rect
    out = []
    for side, ivs in fr.ext.items():
        for a, b in ivs:
            if side == "front" and abs(v0) < 1e-6:
                lo, hi = max(u0, a), min(u1, b)
                seg = ((lo, 0.0), (hi, 0.0))
            elif side == "back" and abs(v1 - fr.D) < 1e-3:
                lo, hi = max(u0, a), min(u1, b)
                seg = ((lo, fr.D), (hi, fr.D))
            elif side == "left" and abs(u0) < 1e-6:
                lo, hi = max(v0, a), min(v1, b)
                seg = ((0.0, lo), (0.0, hi))
            elif side == "right" and abs(u1 - fr.W) < 1e-3:
                lo, hi = max(v0, a), min(v1, b)
                seg = ((fr.W, lo), (fr.W, hi))
            else:
                continue
            if hi - lo > 0.3:
                out.append((side, seg))
    return out


def _finish(lay: FlatLayout) -> None:
    fr = lay.frame
    rooms = {r.code: r for r in lay.rooms}
    net = {c: max(0.0, (r.rect[2] - r.rect[0] - WALL)) * max(0.0, (r.rect[3] - r.rect[1] - WALL)) for c, r in rooms.items()}
    # windows and ventilators
    for c, r in rooms.items():
        ext = exterior_contacts(fr, r.rect)
        rule = KINDS[c]["ext"]
        if rule in ("hab", "ext", "bal") or c == "KIT":
            need = max(1.0, net[c] / 10.0 / WIN_H * 1.15)
            for side, seg in sorted(ext, key=lambda t: -_seg_len(t[1])):
                L = _seg_len(seg)
                if c in ("BAL", "UTL"):
                    r.windows.append(seg)  # open railing
                elif L >= 0.9 - 1e-6:
                    r.windows.append(_sub(seg, min(L - 0.3, max(need, min(2.4, L - 0.3)))))
            if rule == "hab" and c != "LIV" and not r.windows and "BAL" in rooms:  # onto the balcony
                s = shared_wall(r.rect, rooms["BAL"].rect)
                if s and _seg_len(s) >= 0.9 - 1e-6:
                    L = _seg_len(s)
                    r.windows.append(_sub(s, min(L - 0.3, max(need, min(2.4, L - 0.3)))))
                    r.through_balcony = True
        if rule == "vent":
            for side, seg in ext:
                r.vents.append(_sub(seg, 0.6))
                break
            if not r.vents and fr.shaft:
                s = shared_wall(r.rect, fr.shaft)
                if s and _seg_len(s) >= 0.6 - 1e-6:
                    r.vents.append(_sub(s, 0.6))
    # doors and openings
    side, e0, e1, lvl = fr.entry
    if side == "right":
        main = ((fr.W, e0), (fr.W, e1))
    elif side == "back":
        main = ((e0, fr.D), (e1, fr.D))
    else:
        main = ((e0, lvl), (e1, lvl))
    lay.doors.append(("ENTRY", "FOY", main, DOOR_W["main"]))
    graph = {c: set() for c in rooms}
    for a in rooms:
        for b in rooms:
            if a < b and frozenset((a, b)) in OPEN:
                s = shared_wall(rooms[a].rect, rooms[b].rect)
                if s and _seg_len(s) >= 0.9 - 1e-6:
                    lay.doors.append((a, b, s, 0.0))  # open: no wall
                    graph[a].add(b); graph[b].add(a)
    for c, (parents, L) in ACCESS.items():
        if c not in rooms:
            continue
        best = None
        for p in parents:
            if p in rooms:
                s = shared_wall(rooms[c].rect, rooms[p].rect)
                if s and _seg_len(s) >= L - 1e-6 and (best is None or (p in ("PAS", "FOY")) > (best[0] in ("PAS", "FOY"))):
                    best = (p, s)
        if best:
            w = DOOR_W.get(c, 0.9)
            lay.doors.append((c, best[0], _sub(best[1], w, "centre" if c == "BAL" else "end"), w))
            graph[c].add(best[0]); graph[best[0]].add(c)
    if "LIV" in rooms and not any({d[0], d[1]} == {"LIV", "BAL"} for d in lay.doors) and "BAL" in rooms:
        s = shared_wall(rooms["LIV"].rect, rooms["BAL"].rect)
        if s:
            lay.doors.append(("BAL", "LIV", _sub(s, 1.5), 1.5))
            graph["BAL"].add("LIV"); graph["LIV"].add("BAL")
    # reachability from the foyer
    seen, todo = {"FOY"}, ["FOY"]
    while todo:
        c = todo.pop()
        for d in graph[c]:
            if d not in seen:
                seen.add(d)
                todo.append(d)
    # checks
    C = lay.checks
    for c, r in rooms.items():
        rule = KINDS[c]["ext"]
        if c in NBC_MIN:
            C.append((net[c] >= NBC_MIN[c] - 1e-6, f"{r.label} {net[c]:.1f} m² net (min {NBC_MIN[c]})"))
        if rule == "hab":
            win = sum(_seg_len(s) for s in r.windows) * WIN_H
            if c == "LIV" and not r.windows and "BAL" in rooms:
                bal = shared_wall(r.rect, rooms["BAL"].rect)
                win = (_seg_len(bal) - 0.3) * 2.1 if bal else 0.0
                C.append((win >= net[c] / 10, f"Living lit through the balcony door ({win:.1f} m² ≥ {net[c] / 10:.1f})"))
            else:
                via = " onto the balcony" if r.through_balcony else ""
                C.append((win >= net[c] / 10, f"{r.label} window{via} {win:.1f} m² ≥ 1/10 of floor ({net[c] / 10:.1f})"))
            depth = min((r.rect[3] - r.rect[1]) if s[0][1] == s[1][1] else (r.rect[2] - r.rect[0]) for s in r.windows) \
                if r.windows else 0.0
            if r.windows:
                C.append((depth <= 7.5, f"{r.label} no point over 7.5 m from the window ({depth:.1f} m)"))
        if rule == "vent":
            C.append((bool(r.vents), f"{r.label} ventilator on {'the exterior' if exterior_contacts(fr, r.rect) else 'the shaft'}"
                      if r.vents else f"{r.label} has no ventilator"))
        if c not in seen:
            C.append((False, f"{r.label} cannot be reached from the entrance"))
    if "KIT" in rooms:
        kit_win = bool(rooms["KIT"].windows)
        C.append((kit_win or "UTL" in seen, "Kitchen " + ("has its own window" if kit_win else "ventilates through the utility")))
    dirs = {fr.absolute(side) for r in lay.rooms for side, _ in exterior_contacts(fr, r.rect) if r.windows or r.vents}
    C.append((len(dirs) >= 2, f"Cross ventilation: openings face {', '.join(sorted(dirs))}"))
    C.append((len(seen) == len(rooms), "Every room reachable from the entrance without passing through a bedroom"))
    lay.carpet_m2 = sum(net.values())


# ------------------------------------------------------------------ plates
def unit_programs(cfg: dict) -> dict[str, str]:
    """Room programme of each unit type: ``units.types[].program``, or one read from its label."""
    return {t["id"]: t.get("program") or program_for(t["label"]) for t in cfg["units"]["types"]}


def _twin_key(fr: FlatFrame, prog: str) -> tuple:
    """The flat in its canonical frame: twins in mirror image share it."""
    def r(t):
        return None if t is None else tuple(round(x, 2) for x in t)
    return (prog, round(fr.W, 2), round(fr.D, 2), tuple((k, tuple(r(iv) for iv in v)) for k, v in sorted(fr.ext.items())),
            (fr.entry[0], *(round(x, 2) for x in fr.entry[1:])), r(fr.notch), r(fr.shaft))


def layout_plate(plate: Plate, cfg: dict, cache: dict | None = None, progress=None) -> dict:
    """Room layouts of every flat of ``plate`` as JSON in plate coordinates (see :func:`layout_json`).

    ``cache`` maps a flat's canonical frame, programme and orientation to its layout, so a flat that
    recurs in another plate is solved once; a twin in mirror image starts from its sibling. Each flat
    is tried with the budgets in ``rooms.solve_s`` until every check passes."""
    rc = cfg.get("rooms") or {}
    progs = unit_programs(cfg)
    cache = {} if cache is None else cache
    out = {"shafts": [[[round(x, 3), round(y, 3)] for x, y in s.exterior.coords] for s in shaft_rects(plate, rc)],
           "flats": {}}
    for fr in frames(plate, rc):
        prog = progs[fr.unit]
        twin = _twin_key(fr, prog)
        key = (*twin, fr.front, fr.left)
        if key not in cache:
            hint = next((v for k, v in cache.items() if k[:-2] == twin and v.rooms), None)
            lay = None
            for t in rc.get("solve_s", [10, 30, 90]):
                lay = solve_flat(fr, prog, rc, time_s=float(t), hint=hint)
                if lay.rooms and all(ok for ok, _ in lay.checks):
                    break
                hint = lay if lay.rooms else hint
            cache[key] = lay
            if progress:
                bad = sum(1 for ok, _ in lay.checks if not ok)
                progress(f"rooms: {plate.variant} {fr.slot} {fr.unit} ({prog}) {lay.status.lower()}"
                         + (f", {bad} checks fail" if bad else ("" if lay.rooms else ", no layout")))
        out["flats"][fr.slot] = layout_json(cache[key], fr)
    return out


def layout_json(lay: FlatLayout, fr: FlatFrame) -> dict:
    """A flat layout in plate coordinates: rooms (ring, centre-line and net size), windows,
    ventilators, doors, checks and Vastu placements."""
    def pt(u, v):
        return [round(c, 3) for c in fr.to_plate(u, v)]

    def seg(s):
        return [pt(*s[0]), pt(*s[1])]

    rooms = []
    for r in lay.rooms:
        u0, v0, u1, v1 = r.rect
        w, d = u1 - u0, v1 - v0
        rooms.append({"code": r.code, "label": r.label, "poly": [pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)],
                      "w": round(w, 2), "d": round(d, 2), "net_m2": round(max(0, w - WALL) * max(0, d - WALL), 2),
                      "windows": [seg(s) for s in r.windows], "vents": [seg(s) for s in r.vents],
                      "through_balcony": r.through_balcony})
    return {"status": lay.status, "unit": fr.unit, "slot": fr.slot, "program": lay.program, "rooms": rooms,
            "doors": [{"a": a, "b": b, "seg": seg(s), "width": w} for a, b, s, w in lay.doors],
            "checks": [[bool(ok), t] for ok, t in lay.checks], "vastu": dict(lay.vastu),
            "ok": bool(lay.rooms) and all(ok for ok, _ in lay.checks),
            "carpet_m2": round(getattr(lay, "carpet_m2", 0.0), 2)}
