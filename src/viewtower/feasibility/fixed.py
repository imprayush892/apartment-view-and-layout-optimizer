"""A fixed tower arrangement (e.g. the client's preferred layout): pick each tower's plate and floors
so the unit mix is met within a tolerance, then verify the placement on site.

The arrangement is given in the config (``fixed:``): the number of towers, their order from the
front road to the rear, the side each takes ('E' or 'W') and the podium (phase) of each. For every
candidate plate the tallest copy of the arrangement that fits is measured once; a CP-SAT model then
chooses one plate and a floor count per tower to

* hold every unit type within ``mix_tol_pp`` percentage points of its target share (hard),
* reach the FSI target without passing the cap, within the height ceiling (hard band, then closeness),
* prefer fewer south-facing doors, even heights and balanced phases (soft).

The chosen set is placed with :func:`place_chain`; a set that does not fit is cut from the model
(with any taller variant of it) and the model is solved again.

Two scenarios:

* ``mixed``: every tower carries at least ``min_types_mixed`` unit types;
* ``targeted``: every tower serves one price band, i.e. one unit type or two types adjacent in size,
  so the towers ladder from the smallest flats to the largest.
"""
from __future__ import annotations

import itertools
import math
from concurrent.futures import ProcessPoolExecutor

from viewtower.feasibility.layout import Layout, Tower, place_chain, visitors_and_parking
from viewtower.feasibility.plates import VARIANTS, Plate
from viewtower.feasibility.search import (PlateBook, Scheme, _reduce_for_parking, compositions, metrics,
                                          parking_levers, penalties)
from viewtower.feasibility.site import FeasibilitySite, max_floors, refuge_floors

SEG_ORDER = ("middle", "upper_middle", "luxury")


def candidate_plates(cfg: dict, book: PlateBook, scenario: str) -> list[Plate]:
    fx = cfg["fixed"]
    types = sorted(cfg["units"]["types"], key=lambda t: t["carpet_ft2"])
    units = [t["id"] for t in types]
    out, seen = [], set()
    for v in fx["variants"]:
        k = len(VARIANTS[v])
        if scenario == "mixed":
            comps = compositions(units, k, min(int(cfg["search"]["min_types_mixed"]), k))
        else:
            comps = [(u,) * k for u in units]
            for a, b in zip(units, units[1:]):
                comps += [(a,) * i + (b,) * (k - i) for i in range(1, k)]
        for comp, cr, we, strat in itertools.product(comps, fx["arm_depth_m"], fx["end_width_m"], fx["assignment"]):
            p = book.get(v, tuple(sorted(comp)), float(cr), float(we), strat)
            if p.key not in seen:
                seen.add(p.key)
                out.append(p)
    return out


def best_geometries(plates: list[Plate], fit: dict[str, int], keep: int) -> list[Plate]:
    """Plates with the same units differ only in geometry for the mix model: keep the ``keep`` that
    rise highest in the arrangement (then the smallest footprint) for each variant and unit set."""
    groups: dict = {}
    for p in plates:
        if fit.get(p.key, 0) <= 0:
            continue
        k = (p.variant, tuple(sorted(f.unit for f in p.flats)), p.refuge_flat().unit)
        groups.setdefault(k, []).append(p)
    out = []
    for k in sorted(groups):
        g = sorted(groups[k], key=lambda p: (-fit[p.key], p.width * p.depth, p.key))
        out += g[:keep]
    return out


_W: dict = {}


def _init(cfg: dict) -> None:
    _W["cfg"] = cfg
    _W["site"] = FeasibilitySite.build(cfg)


def _fit_one(plate: Plate) -> int:
    """Tallest floor count at which the arrangement holds copies of ``plate`` (0 if none)."""
    cfg, site = _W["cfg"], _W["site"]
    fx = cfg["fixed"]
    for f in range(max_floors(cfg["building"]), int(fx["min_floors"]) - 1, -1):
        towers = [Tower(f"T{i + 1}", plate, f, podium=g) for i, g in enumerate(fx["podiums"])]
        if place_chain(site, towers, cfg, fx["sides"]) is not None:
            return f
    return 0


def fit_floors(cfg: dict, plates: list[Plate], workers: int | None = None) -> dict[str, int]:
    if workers == 1:
        _init(cfg)
        return {p.key: _fit_one(p) for p in plates}
    with ProcessPoolExecutor(max_workers=workers, initializer=_init, initargs=(cfg,)) as ex:
        return dict(zip((p.key for p in plates), ex.map(_fit_one, plates, chunksize=8)))


def select(cfg: dict, plates: list[Plate], fit: dict[str, int], net: float, nogoods: list, exclude: list,
           time_s: float = 20.0):
    """CP-SAT choice of (plate, floors) per tower; None if infeasible.

    One plate index per tower; plate properties are looked up with element constraints, so the
    model stays small whatever the number of candidate plates."""
    from ortools.sat.python import cp_model

    fx, b = cfg["fixed"], cfg["building"]
    T = len(fx["podiums"])
    fmin, fmax = int(fx["min_floors"]), max_floors(b)
    types = cfg["units"]["types"]
    units = [t["id"] for t in types]
    share = {t["id"]: t["share"] for t in types}
    carpet = {t["id"]: t["carpet_ft2"] for t in types}
    P = [p for p in plates if fit.get(p.key, 0) >= fmin]
    if not P:
        return None
    pos = {p.key: i for i, p in enumerate(P)}
    n = len(P)
    R = [len(refuge_floors(f, b)) for f in range(fmin, fmax + 1)]
    arr = {
        "fit": [min(fit[p.key], fmax) for p in P],
        "area": [int(round(10 * p.area_m2)) for p in P],
        "rarea": [int(round(10 * p.refuge_flat().area_m2)) for p in P],
        "south": [sum(1 for fl in p.flats if fl.door_dir == "S") for p in P],
        "carpet": [int(sum(carpet[fl.unit] for fl in p.flats) / 10) for p in P],
    }
    for u in units:
        arr["c" + u] = [p.counts().get(u, 0) for p in P]
        arr["r" + u] = [1 if p.refuge_flat().unit == u else 0 for p in P]
    m = cp_model.CpModel()
    k = [m.NewIntVar(0, n - 1, f"k{t}") for t in range(T)]
    f = [m.NewIntVar(fmin, fmax, f"f{t}") for t in range(T)]
    r = [m.NewIntVar(0, max(R), f"r{t}") for t in range(T)]

    def look(name, t, lo, hi):
        v = m.NewIntVar(lo, hi, f"{name}{t}")
        m.AddElement(k[t], arr[name], v)
        return v

    def times(a, bvar, hi, name):
        v = m.NewIntVar(0, hi, name)
        m.AddMultiplicationEquality(v, [a, bvar])
        return v

    cnt = {u: [] for u in units}
    area_t, south_t, carpet_t = [], [], []
    for t in range(T):
        idx = m.NewIntVar(0, fmax - fmin, f"i{t}")
        m.Add(idx == f[t] - fmin)
        m.AddElement(idx, R, r[t])
        m.Add(f[t] <= look("fit", t, 0, fmax))
        for u in units:
            per = look("c" + u, t, 0, 6)
            isr = look("r" + u, t, 0, 1)
            cnt[u].append(times(f[t], per, 6 * fmax, f"n{u}{t}") - times(r[t], isr, max(R), f"q{u}{t}"))
        a = look("area", t, 0, max(arr["area"]))
        ra = look("rarea", t, 0, max(arr["rarea"]))
        area_t.append(times(f[t], a, fmax * max(arr["area"]), f"A{t}") - times(r[t], ra, max(R) * max(arr["rarea"]), f"RA{t}"))
        south_t.append(times(f[t], look("south", t, 0, 6), 6 * fmax, f"S{t}"))
        carpet_t.append(times(f[t], look("carpet", t, 0, max(arr["carpet"])), fmax * max(arr["carpet"]), f"C{t}"))
    N_u = {u: sum(cnt[u]) for u in units}
    N = sum(N_u.values())
    tol = int(round(10.0 * float(fx["mix_tol_pp"])))  # per mille
    dev = []
    for u in units:
        S = int(round(1000 * share[u]))
        m.Add(1000 * N_u[u] - S * N <= tol * N)
        m.Add(S * N - 1000 * N_u[u] <= tol * N)
        d = m.NewIntVar(0, 10 ** 6, f"dev{u}")
        m.AddAbsEquality(d, 1000 * N_u[u] - S * N)
        dev.append(d)
    lob, club = float(cfg["fsi"]["gf_lobby_m2_per_core"]), float(cfg["fsi"]["clubhouse_m2"])
    area = sum(area_t) + int(round(10 * (T * lob + club)))
    tgt, cap = float(cfg["fsi"]["target"]), float(cfg["fsi"]["cap"])
    m.Add(area <= int(cap * net * 10))
    m.Add(area >= int((tgt - float(fx["fsi_band"])) * net * 10))
    gap = m.NewIntVar(0, 10 ** 7, "gap")
    m.AddAbsEquality(gap, area - int(tgt * net * 10))
    hi_f, lo_f = m.NewIntVar(fmin, fmax, "hi"), m.NewIntVar(fmin, fmax, "lo")
    m.AddMaxEquality(hi_f, f)
    m.AddMinEquality(lo_f, f)
    ph = [sum(c for t, c in enumerate(carpet_t) if fx["podiums"][t] == g) for g in (0, 1)]
    imb = m.NewIntVar(0, 10 ** 7, "imb")
    m.AddAbsEquality(imb, ph[0] - ph[1])
    for combo, floors in nogoods:  # this plate set does not fit at these floors or taller
        if not all(p.key in pos for p in combo):
            continue
        lits = []
        for t, (p, fl) in enumerate(zip(combo, floors)):
            same, taller = m.NewBoolVar(""), m.NewBoolVar("")
            m.Add(k[t] == pos[p.key]).OnlyEnforceIf(same)
            m.Add(k[t] != pos[p.key]).OnlyEnforceIf(same.Not())
            m.Add(f[t] >= fl).OnlyEnforceIf(taller)
            m.Add(f[t] < fl).OnlyEnforceIf(taller.Not())
            lits += [same, taller]
        m.AddBoolOr([l.Not() for l in lits])
    ex = [tuple(pos[p.key] for p in combo) for combo in exclude if all(p.key in pos for p in combo)]
    if ex:
        m.AddForbiddenAssignments(k, ex)
    w = fx["weights"]
    # units: gap 0.1 m2 (0.01 FSI ~ 1,700), dev per mille x flats (1 pp ~ 10 N), south doors, floors, carpet/10
    m.Minimize(int(w["fsi"]) * gap + int(w["mix"]) * sum(dev) + int(w["south"]) * sum(south_t)
               + int(w["height_spread"]) * (hi_f - lo_f) + int(w["phase"]) * imb)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_s
    solver.parameters.num_search_workers = 4
    st = solver.Solve(m)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    return [P[solver.Value(v)] for v in k], [solver.Value(v) for v in f]


def solve_fixed(cfg: dict, progress=print, workers: int | None = None) -> dict[str, list[Scheme]]:
    fx = cfg["fixed"]
    site = FeasibilitySite.build(cfg)
    net = site.net.area
    book = PlateBook(cfg)
    out = {}
    for scenario in fx["scenarios"]:
        plates = candidate_plates(cfg, book, scenario)
        fit = fit_floors(cfg, plates, workers)
        ok = sum(1 for v in fit.values() if v >= int(fx["min_floors"]))
        plates = best_geometries(plates, fit, int(fx["geometries_per_mix"]))
        progress(f"{scenario}: {ok} candidate plates fit the arrangement; tallest {max(fit.values()) if fit else 0} "
                 f"floors; {len(plates)} kept for selection")
        schemes, nogoods, exclude = [], [], []
        for _ in range(int(fx["max_solves"])):
            pick = select(cfg, plates, fit, net, nogoods, exclude, time_s=float(fx["solve_s"]))
            if pick is None:
                progress(f"{scenario}: no further set meets the mix and FSI bands")
                break
            combo, floors = pick
            towers = [Tower(f"T{i + 1}", p, fl, podium=g, segment=_segment(p, cfg, scenario))
                      for i, (p, fl, g) in enumerate(zip(combo, floors, fx["podiums"]))]
            lay = place_chain(site, towers, cfg, fx["sides"])
            if lay is None:
                nogoods.append((combo, floors))
                progress(f"{scenario}: set {[p.variant for p in combo]} at {floors} floors does not fit; cut")
                continue
            visitors_and_parking(site, lay, cfg)
            m = metrics(towers, lay, cfg, site)
            m["levers"] = parking_levers(m, cfg, site)
            pen = penalties(m, cfg, "target")
            s = Scheme(scenario, "target", towers, lay, m, pen, round(sum(pen.values()), 3),
                       sid=f"{scenario[:3]}-fix-{len(schemes) + 1}")
            schemes.append(s)
            ct = [Tower(t.name, t.plate, t.floors, t.podium, t.segment, t.x, t.y) for t in towers]
            clay = Layout(ct, None, list(lay.raw_podiums), lay.gap_band, raw_podiums=list(lay.raw_podiums),
                          basements=list(lay.basements))
            _reduce_for_parking(site, clay, cfg, net)
            if clay.parking:
                cm = metrics(ct, clay, cfg, site)
                cp = penalties(cm, cfg, "compliant")
                schemes.append(Scheme(scenario, "compliant", ct, clay, cm, cp, round(sum(cp.values()), 3),
                                      sid=f"{scenario[:3]}-fix-{len(schemes)}c"))
            exclude.append(combo)
            progress(f"{scenario}: option {sum(1 for x in schemes if x.mode == 'target')} FSI {m['fsi']:.3f}, "
                     f"{m['flats']} flats, mix within {m['mix_dev_pp']:.1f} pp")
            if sum(1 for x in schemes if x.mode == "target") >= int(fx["options"]):
                break
        out[scenario] = schemes
    return out


def _segment(p: Plate, cfg: dict, scenario: str) -> str:
    if scenario == "mixed":
        return "mixed"
    seg = {t["id"]: t["segment"] for t in cfg["units"]["types"]}
    lab = {t["id"]: t["label"] for t in cfg["units"]["types"]}
    units = sorted(p.counts(), key=lambda u: -p.counts()[u])
    s = {seg[u] for u in units}
    return "/".join(sorted(s, key=SEG_ORDER.index)) + " · " + "+".join(lab[u] for u in units)
