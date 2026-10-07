"""Towers on two podiums: placement, podium split, visitor bays in the setbacks, car parking.

Placement is a deterministic raster search. Podium A (phase 1) packs from the front road,
podium B (phase 2) from the rear; each tower takes the position closest to its end of the site
that keeps it inside its height setback and on the podium, keeps the required clear distance to
towers already placed (block setback across podiums, ``same_podium_gap_m`` on one podium) and
keeps facades on one podium that face each other closer than the setback to
``facing_overlap_max_m`` of overlap. Podiums are then split by a driveway plus a strip of visitor
bays, and each tower group is spread towards the split where the rules allow.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import shapely
from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from viewtower.feasibility.plates import Plate
from viewtower.feasibility.site import (FeasibilitySite, building_height, refuge_floors,
                                        setback_for_height)
from viewtower.feasibility.config import FT2_PER_M2


@dataclass
class Tower:
    name: str
    plate: Plate
    floors: int
    podium: int = 0
    segment: str = ""
    x: float = 0.0
    y: float = 0.0

    # ---- vertical
    def height(self, b: dict) -> float:
        return building_height(self.floors, b)

    def refuges(self, b: dict) -> list[int]:
        return refuge_floors(self.floors, b)

    # ---- areas and counts
    def flats_by_type(self, b: dict) -> dict[str, int]:
        c = {u: n * self.floors for u, n in self.plate.counts().items()}
        c[self.plate.refuge_flat().unit] -= len(self.refuges(b))
        return c

    def n_flats(self, b: dict) -> int:
        return sum(self.flats_by_type(b).values())

    def fsi_m2(self, b: dict, gf_lobby: float) -> float:
        return self.floors * self.plate.area_m2 - len(self.refuges(b)) * self.plate.refuge_flat().area_m2 + gf_lobby

    def footprint(self) -> Polygon:
        return self.plate.translated(self.x, self.y)

    def slenderness(self, b: dict) -> float:
        return self.height(b) / min(self.plate.width, self.plate.depth)

    def facing(self, b: dict) -> dict[str, int]:
        f = {d: n * self.floors for d, n in self.plate.facing().items()}
        f[self.plate.refuge_flat().door_dir] -= len(self.refuges(b))
        return f


@dataclass
class Layout:
    towers: list[Tower]
    y_split: float
    podiums: list[Polygon]
    gap_band: Polygon
    raw_podiums: list[Polygon] = field(default_factory=list)  # before visitor strips are cut out
    basements: list[Polygon] = field(default_factory=list)    # per phase; empty: split the basement at y_split
    visitor_strips: list[Polygon] = field(default_factory=list)
    visitor_bays: int = 0
    parking: dict = field(default_factory=dict)
    min_spacing: dict = field(default_factory=dict)
    ok: bool = True
    notes: list[str] = field(default_factory=list)


# ------------------------------------------------------------------ geometry helpers
def _edges(poly: Polygon):
    """Exterior edges with outward unit normals (axis-aligned plates)."""
    ring = list(poly.exterior.coords)
    ccw = poly.exterior.is_ccw
    out = []
    for (ax, ay), (bx, by) in zip(ring[:-1], ring[1:]):
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        if L < 1e-6:
            continue
        nx, ny = (dy / L, -dx / L) if ccw else (-dy / L, dx / L)
        out.append((ax, ay, bx, by, nx, ny))
    return out


def facing_overlap(a: Polygon, b: Polygon, within: float) -> float:
    """Longest run of facades of ``a`` and ``b`` that face each other closer than ``within``."""
    worst = 0.0
    for ax, ay, bx, by, nx, ny in _edges(a):
        for cx, cy, dx_, dy_, mx, my in _edges(b):
            if abs(nx + mx) > 1e-6 or abs(ny + my) > 1e-6:
                continue
            d = (cx - ax) * nx + (cy - ay) * ny  # distance in front of edge a
            if d <= 1e-6 or d >= within:
                continue
            tx, ty = -ny, nx  # along-edge axis
            a0, a1 = sorted((ax * tx + ay * ty, bx * tx + by * ty))
            b0, b1 = sorted((cx * tx + cy * ty, dx_ * tx + dy_ * ty))
            worst = max(worst, min(a1, b1) - max(a0, b0))
    return worst


class _Grid:
    def __init__(self, bounds, res: float):
        self.r = res
        self.x0 = math.floor(bounds[0] / res) * res
        self.y0 = math.floor(bounds[1] / res) * res
        self.nx = int(math.ceil((bounds[2] - self.x0) / res)) + 1
        self.ny = int(math.ceil((bounds[3] - self.y0) / res)) + 1
        xs = self.x0 + (np.arange(self.nx) + 0.5) * res
        ys = self.y0 + (np.arange(self.ny) + 0.5) * res
        self.cx, self.cy = np.meshgrid(xs, ys)

    def mask(self, region) -> np.ndarray:
        """Cells lying wholly inside ``region``."""
        if region.is_empty:
            return np.zeros((self.ny, self.nx), bool)
        inner = region.buffer(-self.r * 0.7072, join_style="mitre")
        if inner.is_empty:
            return np.zeros((self.ny, self.nx), bool)
        return shapely.contains_xy(inner, self.cx, self.cy)

    def feasible(self, m: np.ndarray, boxes) -> np.ndarray:
        """Translations (on grid nodes) for which every box of the footprint covers only free cells.

        Result[i, j] is the translation (x0 + j r, y0 + i r)."""
        S = np.zeros((self.ny + 1, self.nx + 1), np.int32)
        S[1:, 1:] = np.cumsum(np.cumsum(m.astype(np.int32), 0), 1)
        ok = np.ones((self.ny, self.nx), bool)
        for (bx0, by0, bx1, by1) in boxes:
            j0 = int(math.floor(bx0 / self.r + 1e-9))
            j1 = int(math.ceil(bx1 / self.r - 1e-9))
            i0 = int(math.floor(by0 / self.r + 1e-9))
            i1 = int(math.ceil(by1 / self.r - 1e-9))
            need = (j1 - j0) * (i1 - i0)
            res = np.zeros((self.ny, self.nx), bool)
            # translation index (i, j) uses cells [i+i0, i+i1) x [j+j0, j+j1)
            ilo, ihi = max(0, -i0), min(self.ny, self.ny - i1 + 1)
            jlo, jhi = max(0, -j0), min(self.nx, self.nx - j1 + 1)
            if ihi <= ilo or jhi <= jlo:
                return np.zeros((self.ny, self.nx), bool)
            I = np.arange(ilo, ihi)[:, None]
            J = np.arange(jlo, jhi)[None, :]
            tot = (S[I + i1, J + j1] - S[I + i0, J + j1] - S[I + i1, J + j0] + S[I + i0, J + j0])
            res[ilo:ihi, jlo:jhi] = tot == need
            ok &= res
            if not ok.any():
                break
        return ok


def plate_boxes(plate: Plate):
    parts = [f.poly for f in plate.flats] + [plate.hub, plate.lobby]
    out = []
    for g in parts:
        for p in getattr(g, "geoms", [g]):
            out.append(p.bounds)
    return out


# ------------------------------------------------------------------ placement
def place(site: FeasibilitySite, towers: list[Tower], cfg: dict) -> Layout | None:
    b = cfg["building"]
    sb = cfg["setbacks"]
    gap = float(cfg["access"]["driveway_m"]) + float(cfg["access"]["visitor_bay_d_m"])
    res = float(cfg["search"]["raster_m"])
    grid = _Grid(site.podium_env.bounds, res)
    placed: list[Tower] = []
    group_a = [t for t in towers if t.podium == 0]
    group_b = [t for t in towers if t.podium == 1]
    order = [(t, +1) for t in group_a] + [(t, -1) for t in group_b]

    for t, sense in order:
        h = t.height(b)
        region = site.tower_envelope(h)
        forbid = []
        for p in placed:
            d = (float(sb["same_podium_gap_m"]) if p.podium == t.podium
                 else setback_for_height(max(h, p.height(b)), sb))
            forbid.append(p.footprint().buffer(d - 1e-6, join_style="mitre"))
        if sense < 0 and group_a:
            ymin_a = min(p.footprint().bounds[1] for p in placed if p.podium == 0)
            region = region.intersection(box(-1e4, -1e4, 1e4, ymin_a - gap))
        if forbid:
            region = region.difference(unary_union(forbid))
        m = grid.mask(region)
        ok = grid.feasible(m, plate_boxes(t.plate))
        if not ok.any():
            return None
        ii, jj = np.nonzero(ok)
        prev = [p for p in placed if p.podium == t.podium]
        last = prev[-1].footprint().centroid if prev else None
        # closest to this podium's end of the site, then furthest across from the previous tower
        key_y = -ii if sense > 0 else ii
        if last is not None:
            px = grid.x0 + jj * res + t.plate.footprint.centroid.x
            key_x = -np.abs(px - last.x)
        else:
            key_x = -(grid.x0 + jj * res) if sense > 0 else (grid.x0 + jj * res)
        idx = np.lexsort((key_x, key_y))
        chosen = None
        for k in idx[:4000]:
            x = grid.x0 + jj[k] * res
            y = grid.y0 + ii[k] * res
            fp = affinity.translate(t.plate.footprint, x, y)
            bad = False
            for p in prev:
                s = setback_for_height(max(h, p.height(b)), sb)
                if fp.distance(p.footprint()) < s and facing_overlap(fp, p.footprint(), s) > float(sb["facing_overlap_max_m"]) + 1e-6:
                    bad = True
                    break
            if not bad:
                chosen = (x, y)
                break
        if chosen is None:
            return None
        t.x, t.y = chosen
        placed.append(t)

    lay = _podiums(site, towers, cfg, gap)
    if lay is not None:
        _spread(site, lay, cfg)
        lay = _podiums(site, towers, cfg, gap)
    return lay


def _check(site: FeasibilitySite, t: Tower, others: list[Tower], cfg: dict, split: float | None, gap: float) -> bool:
    b = cfg["building"]
    sb = cfg["setbacks"]
    fp = t.footprint()
    h = t.height(b)
    if not site.tower_envelope(h).buffer(1e-6).contains(fp):
        return False
    for p in others:
        same = p.podium == t.podium
        d = float(sb["same_podium_gap_m"]) if same else setback_for_height(max(h, p.height(b)), sb)
        dist = fp.distance(p.footprint())
        if dist < d - 1e-6:
            return False
        if same:
            s = setback_for_height(max(h, p.height(b)), sb)
            if dist < s and facing_overlap(fp, p.footprint(), s) > float(sb["facing_overlap_max_m"]) + 1e-6:
                return False
    if split is not None:
        lo, hi = fp.bounds[1], fp.bounds[3]
        if t.podium == 0 and lo < split + gap / 2 - 1e-6:
            return False
        if t.podium == 1 and hi > split - gap / 2 + 1e-6:
            return False
    return True


def _spread(site: FeasibilitySite, lay: Layout, cfg: dict) -> None:
    """Move each group towards the podium split in equal steps, keeping every rule."""
    gap = float(cfg["access"]["driveway_m"]) + float(cfg["access"]["visitor_bay_d_m"])
    for g, sense in ((0, -1), (1, +1)):
        grp = [t for t in lay.towers if t.podium == g]
        if len(grp) < 2:
            continue
        # order from the site end towards the split
        grp.sort(key=lambda t: -t.y if g == 0 else t.y)
        inner = grp[-1].footprint().bounds
        room = (inner[1] - (lay.y_split + gap / 2)) if g == 0 else ((lay.y_split - gap / 2) - inner[3])
        if room <= 0.5:
            continue
        n = len(grp)
        for frac in (1.0, 0.75, 0.5, 0.25):
            moved = []
            okall = True
            for k, t in enumerate(grp):
                dy = sense * room * frac * k / (n - 1)
                t.y += dy
                moved.append((t, dy))
            for t in grp:
                others = [o for o in lay.towers if o is not t]
                if not _check(site, t, others, cfg, lay.y_split, gap):
                    okall = False
                    break
            if okall:
                break
            for t, dy in moved:
                t.y -= dy


def _podiums(site: FeasibilitySite, towers: list[Tower], cfg: dict, gap: float) -> Layout | None:
    fa = [t.footprint() for t in towers if t.podium == 0]
    fb = [t.footprint() for t in towers if t.podium == 1]
    env = site.podium_env
    if fa and fb:
        ymin_a = min(f.bounds[1] for f in fa)
        ymax_b = max(f.bounds[3] for f in fb)
        if ymin_a - ymax_b < gap - 1e-6:
            return None
        split = 0.5 * (ymin_a + ymax_b)
        pa = env.intersection(box(-1e4, split + gap / 2, 1e4, 1e4))
        pb = env.intersection(box(-1e4, -1e4, 1e4, split - gap / 2))
        band = env.intersection(box(-1e4, split - gap / 2, 1e4, split + gap / 2))
        podiums = [pa, pb]
    else:
        split = env.bounds[1] - gap
        podiums = [env, Polygon()]
        band = Polygon()
    return Layout(towers, split, podiums, band, raw_podiums=list(podiums))


# ------------------------------------------------------------------ chain placement (fixed tower count)
def place_chain(site: FeasibilitySite, towers: list[Tower], cfg: dict, hints: list[str] | None = None) -> Layout | None:
    """Place towers as one front-to-rear chain in the given order (a fixed arrangement).

    Each tower takes the frontmost position its rules allow; ``hints`` ('E' or 'W' per tower) picks
    the side, so the chain zig-zags as drawn. ``tower.podium`` sets the spacing rule (block setback
    across podiums, ``same_podium_gap_m`` and the facing-overlap limit on one podium). The chain is
    then spread over the leftover length and the podiums are split by distance, leaving a driveway
    and visitor-bay band between them wherever they meet."""
    b = cfg["building"]
    sb = cfg["setbacks"]
    res = float(cfg["search"]["raster_m"])
    gap = float(cfg["access"]["driveway_m"]) + float(cfg["access"]["visitor_bay_d_m"])
    hints = hints or ["E" if i % 2 == 0 else "W" for i in range(len(towers))]
    grid = _Grid(site.podium_env.bounds, res)
    placed: list[Tower] = []
    for t, hint in zip(towers, hints):
        h = t.height(b)
        region = site.tower_envelope(h)
        forbid = [p.footprint().buffer(_gap(t, p, cfg) - 1e-6, join_style="mitre") for p in placed]
        if forbid:
            region = region.difference(unary_union(forbid))
        ok = grid.feasible(grid.mask(region), plate_boxes(t.plate))
        if not ok.any():
            return None
        ii, jj = np.nonzero(ok)
        xs = grid.x0 + jj * res
        idx = np.lexsort((-xs if hint == "E" else xs, -ii))
        chosen = None
        for k in idx[:4000]:
            x, y = grid.x0 + jj[k] * res, grid.y0 + ii[k] * res
            fp = affinity.translate(t.plate.footprint, x, y)
            if all(not _overlap_breach(fp, p, t, cfg) for p in placed if p.podium == t.podium):
                chosen = (x, y)
                break
        if chosen is None:
            return None
        t.x, t.y = chosen
        placed.append(t)
    _spread_chain(site, towers, cfg)
    lay = _podiums_free(site, towers, cfg, gap)
    return lay


def _gap(t: Tower, p: Tower, cfg: dict) -> float:
    b, sb = cfg["building"], cfg["setbacks"]
    if p.podium == t.podium:
        return float(sb["same_podium_gap_m"])
    return setback_for_height(max(t.height(b), p.height(b)), sb)


def _overlap_breach(fp: Polygon, p: Tower, t: Tower, cfg: dict) -> bool:
    b, sb = cfg["building"], cfg["setbacks"]
    s = setback_for_height(max(t.height(b), p.height(b)), sb)
    return fp.distance(p.footprint()) < s and facing_overlap(fp, p.footprint(), s) > float(sb["facing_overlap_max_m"]) + 1e-6


def _valid(site: FeasibilitySite, t: Tower, others: list[Tower], cfg: dict) -> bool:
    fp = t.footprint()
    if not site.tower_envelope(t.height(cfg["building"])).buffer(1e-6).contains(fp):
        return False
    for p in others:
        if fp.distance(p.footprint()) < _gap(t, p, cfg) - 1e-6:
            return False
        if p.podium == t.podium and _overlap_breach(fp, p, t, cfg):
            return False
    return True


def _spread_chain(site: FeasibilitySite, towers: list[Tower], cfg: dict) -> None:
    """Share the leftover length at the rear of the site between the gaps of the chain."""
    n = len(towers)
    if n < 2:
        return
    last = towers[-1]
    room = 0.0
    for step in (8.0, 4.0, 2.0, 1.0, 0.5):  # how far the rear tower can still move back
        while True:
            last.y -= step
            if _valid(site, last, towers[:-1], cfg):
                room += step
            else:
                last.y += step
                break
    last.y += room
    for frac in (1.0, 0.75, 0.5, 0.25):
        shifts = [room * frac * k / (n - 1) for k in range(n)]
        for t, d in zip(towers, shifts):
            t.y -= d
        if all(_valid(site, t, [o for o in towers if o is not t], cfg) for t in towers):
            return
        for t, d in zip(towers, shifts):
            t.y += d


def _cells_union(mask: np.ndarray, grid: "_Grid"):
    boxes = []
    r = grid.r
    for i in range(mask.shape[0]):
        row = mask[i]
        if not row.any():
            continue
        j = 0
        while j < len(row):
            if row[j]:
                k = j
                while k < len(row) and row[k]:
                    k += 1
                boxes.append(box(grid.x0 + j * r, grid.y0 + i * r, grid.x0 + k * r, grid.y0 + (i + 1) * r))
                j = k
            else:
                j += 1
    return unary_union(boxes) if boxes else Polygon()


def _podiums_free(site: FeasibilitySite, towers: list[Tower], cfg: dict, gap: float) -> Layout:
    """Podium of each phase = the podium envelope closer to its own towers, less a band of width
    ``gap`` (driveway + visitor bays) wherever the two meet; the basement splits on the same line."""
    import shapely
    grid = _Grid(site.podium_env.bounds, 0.5)
    env = site.podium_env
    fa = unary_union([t.footprint() for t in towers if t.podium == 0])
    fb = unary_union([t.footprint() for t in towers if t.podium == 1])
    pts = shapely.points(grid.cx, grid.cy)
    if fb.is_empty:
        podiums, band = [env, Polygon()], Polygon()
        basements = [site.basement_env, Polygon()]
    else:
        da, db = shapely.distance(pts, fa), shapely.distance(pts, fb)
        inside = shapely.contains_xy(env.buffer(0.5), grid.cx, grid.cy)
        ua = _cells_union(inside & (db - da >= gap), grid).buffer(0.01)
        ub = _cells_union(inside & (da - db >= gap), grid).buffer(0.01)
        pa = env.intersection(ua).union(fa.intersection(env))
        pb = env.intersection(ub).difference(pa).union(fb.intersection(env))
        band = env.difference(pa).difference(pb)
        band = unary_union([g for g in getattr(band, "geoms", [band]) if g.area > 5.0]) if not band.is_empty else band
        podiums = [pa, pb]
        near_a = _cells_union(shapely.contains_xy(site.basement_env.buffer(0.5), grid.cx, grid.cy) & (da <= db), grid)
        basements = [site.basement_env.intersection(near_a), site.basement_env.difference(near_a)]
    return Layout(towers, None, podiums, band, raw_podiums=list(podiums), basements=basements)


# ------------------------------------------------------------------ visitors and parking
def visitors_and_parking(site: FeasibilitySite, lay: Layout, cfg: dict) -> None:
    pk = cfg["parking"]
    acc = cfg["access"]
    b = cfg["building"]
    bw, bd, clear = float(acc["visitor_bay_w_m"]), float(acc["visitor_bay_d_m"]), float(acc["bay_end_clear_m"])
    flats = [sum(t.n_flats(b) for t in lay.towers if t.podium == g) for g in (0, 1)]
    demand = [math.ceil(float(pk["ratio"]) * n - 1e-9) for n in flats]
    v_need = math.ceil(float(pk["visitor_ratio"]) * sum(demand) - 1e-9)
    strips: list[Polygon] = []
    bays = 0
    # 1) the bay strip alongside the driveway between the podiums
    if not lay.gap_band.is_empty:
        drive = float(acc["driveway_m"])
        if lay.y_split is not None:
            lo = lay.y_split - (drive + bd) / 2 + drive  # driveway in the lower part of the band, bays above it
            strip = site.podium_env.intersection(box(-1e4, lo, 1e4, lo + bd))
        else:  # bays along the phase-1 side of the band
            strip = lay.gap_band.intersection((lay.raw_podiums or lay.podiums)[0].buffer(bd, join_style="mitre"))
        n = _bays_in(strip, bw, clear, bd)
        if n:
            strips.append(strip)
            bays += n
    # 2) strips cut from the podium edge, longest straight runs first, clear of towers
    towers_fp = unary_union([t.footprint().buffer(1.0, join_style="mitre") for t in lay.towers])
    podiums = list(lay.raw_podiums or lay.podiums)
    if bays < v_need:
        cands = []
        for g, pod in enumerate(podiums):
            for part in getattr(pod, "geoms", [pod]):
                if part.is_empty:
                    continue
                for ax, ay, bx, by, nx, ny in _edges(part):
                    L = math.hypot(bx - ax, by - ay)
                    if L < 2 * clear + bw:
                        continue
                    # strip inside the podium along this edge
                    ix, iy = -nx * bd, -ny * bd
                    s = Polygon([(ax, ay), (bx, by), (bx + ix, by + iy), (ax + ix, ay + iy)])
                    s = s.difference(towers_fp)
                    s = max(getattr(s, "geoms", [s]), key=lambda q: q.area) if not s.is_empty else s
                    if s.is_empty:
                        continue
                    n = _bays_in(s, bw, clear, bd)
                    if n:
                        cands.append((n, g, s))
        cands.sort(key=lambda c: (-c[0], c[1]))
        for n, g, s in cands:
            if bays >= v_need:
                break
            if any(s.intersection(o).area > 1.0 for o in strips):
                continue
            strips.append(s)
            podiums[g] = podiums[g].difference(s)
            bays += n
    lay.podiums = podiums
    lay.visitor_strips = strips
    lay.visitor_bays = bays

    # 3) cars: basement + GF + stilt 1 per phase
    if lay.basements:
        bases = list(lay.basements)
    else:
        bases = [site.basement_env.intersection(box(-1e4, lay.y_split, 1e4, 1e4)),
                 site.basement_env.intersection(box(-1e4, -1e4, 1e4, lay.y_split))]
    club = float(cfg["fsi"]["clubhouse_m2"])
    out = {"demand": demand, "flats": flats, "visitor_need": v_need, "visitor_bays": bays}
    for key in ("basement", "gf", "s1", "supply"):
        out[key] = [0, 0]
    for g in (0, 1):
        tw = [t for t in lay.towers if t.podium == g]
        hubs = sum(t.plate.hub.area + t.plate.lobby.difference(t.plate.hub).area for t in tw)
        base = bases[g].area
        b_use = base - hubs - float(pk["basement_services_m2"]) / 2 - float(pk["basement_services_per_tower_m2"]) * len(tw) \
            - (float(pk["ramp_basement_m2"]) if tw else 0)
        pod = podiums[g].area
        gf_use = pod - hubs - float(cfg["fsi"]["gf_lobby_m2_per_core"]) * len(tw) - (float(pk["ramp_gf_m2"]) if tw else 0)
        s1_use = pod - hubs - (club if g == 0 else 0.0) - (float(pk["ramp_s1_m2"]) if tw else 0)
        nb = max(0, int(b_use // float(pk["m2_per_car_basement"])))
        ng = max(0, int(gf_use // float(pk["m2_per_car_podium"])))
        ns = max(0, int(s1_use // float(pk["m2_per_car_podium"])))
        out["basement"][g], out["gf"][g], out["s1"][g] = nb, ng, ns
        out["supply"][g] = nb + ng + ns
        out.setdefault("areas", []).append({"basement_m2": round(base, 1), "podium_m2": round(pod, 1)})
    out["total_demand"] = sum(demand)
    out["total_supply"] = sum(out["supply"])
    out["margin"] = out["total_supply"] - out["total_demand"]
    lay.parking = out


def _bays_in(strip, bw: float, clear: float, depth: float | None = None) -> int:
    """Perpendicular bays along a strip: its length (area / depth, or its long side) less end clearances."""
    if strip.is_empty:
        return 0
    if depth:
        L = strip.area / depth
    else:
        mrr = strip.minimum_rotated_rectangle
        xs = list(mrr.exterior.coords)
        L = max(math.dist(xs[0], xs[1]), math.dist(xs[1], xs[2]))
    return max(0, int((L - 2 * clear) // bw))


def spacing_report(lay: Layout, cfg: dict) -> dict:
    b = cfg["building"]
    sb = cfg["setbacks"]
    out = {"same": None, "cross": None, "max_overlap": 0.0}
    ts = lay.towers
    for i in range(len(ts)):
        for j in range(i + 1, len(ts)):
            d = ts[i].footprint().distance(ts[j].footprint())
            k = "same" if ts[i].podium == ts[j].podium else "cross"
            out[k] = d if out[k] is None else min(out[k], d)
            if k == "same":
                s = setback_for_height(max(ts[i].height(b), ts[j].height(b)), sb)
                if d < s:
                    out["max_overlap"] = max(out["max_overlap"], facing_overlap(ts[i].footprint(), ts[j].footprint(), s))
    return {k: (round(v, 2) if v is not None else None) for k, v in out.items()}
