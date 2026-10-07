"""A fixed tower arrangement (e.g. the client's preferred layout): pick each tower's plate and floors
so the unit mix is met within a tolerance, then verify the placement on site.

The arrangement is given in the config (``fixed:``): the number of towers, their order from the
front road to the rear, the side each takes ('E' or 'W') and the podium (phase) of each. For every
candidate plate the tallest copy of the arrangement that fits is measured once (four copies of the
plate), then, per position, how tall the plate rises with the smallest plate in the other positions
(an optimistic bound). A CP-SAT model then chooses one plate and a floor count per tower to

* hold every unit type within ``mix_tol_pp`` percentage points of its target share (hard),
* reach the FSI target without passing the cap, within the height ceiling (hard band, then closeness),
* prefer fewer south-facing doors, even heights and balanced phases (soft).

The chosen set is placed with :func:`place_chain`. A set that does not fit is first repaired by
taking a few floors off (still within the mix and FSI bands); failing that, the towers up to the one
that could not be placed are cut from the model (with any taller variant of them) and the model is
solved again, so the optimistic bounds are only ever an upper limit.

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
from viewtower.feasibility.search import (PlateBook, Scheme, compositions, fsi_of, metrics, mix_of,
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


def best_geometries(plates: list[Plate], fit: dict, keep: int) -> list[Plate]:
    """Plates with the same units differ only in geometry for the mix model: keep the ``keep`` that
    rise highest in the arrangement (then the smallest footprint) for each variant and unit set.

    ``fit`` maps a plate key to its floors, or to a list of floors per position."""
    def rise(p):
        v = fit.get(p.key, 0)
        return sum(v) if isinstance(v, (list, tuple)) else v

    groups: dict = {}
    for p in plates:
        if rise(p) <= 0:
            continue
        k = (p.variant, tuple(sorted(f.unit for f in p.flats)), p.refuge_flat().unit)
        groups.setdefault(k, []).append(p)
    out = []
    for k in sorted(groups):
        g = sorted(groups[k], key=lambda p: (-rise(p), p.width * p.depth, p.key))
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


def _fit_slot(job: tuple) -> int:
    """Tallest floor count above ``lo`` at which ``plate`` holds position ``slot`` while ``ref``
    takes every other position at the same height (``lo`` if none)."""
    plate, slot, ref, lo = job
    cfg, site = _W["cfg"], _W["site"]
    fx = cfg["fixed"]
    for f in range(max_floors(cfg["building"]), max(lo, int(fx["min_floors"]) - 1), -1):
        towers = [Tower(f"T{i + 1}", plate if i == slot else ref, f, podium=g) for i, g in enumerate(fx["podiums"])]
        if place_chain(site, towers, cfg, fx["sides"]) is not None:
            return f
    return lo


def _pool_map(cfg: dict, fn, jobs: list, workers: int | None) -> list:
    if workers == 1:
        _init(cfg)
        return [fn(j) for j in jobs]
    with ProcessPoolExecutor(max_workers=workers, initializer=_init, initargs=(cfg,)) as ex:
        return list(ex.map(fn, jobs, chunksize=4))


def fit_floors(cfg: dict, plates: list[Plate], workers: int | None = None) -> dict[str, int]:
    """Tallest floors of the arrangement built from four copies of each plate."""
    return dict(zip((p.key for p in plates), _pool_map(cfg, _fit_one, plates, workers)))


def fit_positions(cfg: dict, plates: list[Plate], fit: dict[str, int], workers: int | None = None) -> dict[str, list[int]]:
    """Per position, the tallest floors of each plate with the smallest fitting plate elsewhere.

    Never below the four-copy fit; positions where the four-copy fit already reaches the height
    ceiling are not probed again."""
    fx, fmax = cfg["fixed"], max_floors(cfg["building"])
    ok = [p for p in plates if fit.get(p.key, 0) >= int(fx["min_floors"])]
    if not ok:
        return {p.key: [fit.get(p.key, 0)] * len(fx["podiums"]) for p in plates}
    ref = min(ok, key=lambda p: (p.width * p.depth, -fit[p.key], p.key))
    jobs, idx = [], []
    for p in plates:
        if fit.get(p.key, 0) >= fmax:
            continue
        for t in range(len(fx["podiums"])):
            jobs.append((p, t, ref, fit.get(p.key, 0)))
            idx.append((p.key, t))
    out = {p.key: [fit.get(p.key, 0)] * len(fx["podiums"]) for p in plates}
    for (key, t), f in zip(idx, _pool_map(cfg, _fit_slot, jobs, workers)):
        out[key][t] = max(out[key][t], f)
    return out


_COVER: dict = {}


def _covers(q: Plate, p: Plate) -> bool:
    """True if plate ``q``'s footprint contains plate ``p``'s (both centred on the hub)."""
    key = (q.key, p.key)
    if key not in _COVER:
        _COVER[key] = q.key == p.key or q.footprint.buffer(1e-6).contains(p.footprint)
    return _COVER[key]


def unit_set(p: Plate) -> tuple:
    return tuple(sorted(f.unit for f in p.flats))


def select(cfg: dict, plates: list[Plate], fit: dict, net: float, nogoods: list, exclude: list,
           time_s: float = 20.0, info: dict | None = None, combo: list[Plate] | None = None,
           flat_caps: list[int] | None = None, fmin: int | None = None):
    """CP-SAT choice of (plate, floors) per tower; None if infeasible.

    ``fit`` maps a plate key to its tallest floors, or to a list of them per position. ``exclude``
    lists the per-tower unit sets (:func:`unit_set`) already reported, in any tower order. ``fmin``
    overrides ``fixed.min_floors``. ``combo`` fixes the plates;
    ``flat_caps`` caps the flats on each podium (the parking it holds) and drops the lower FSI
    band, so the model then reaches as close to the target as the parking allows.

    One plate index per tower; plate properties are looked up with element constraints, so the
    model stays small whatever the number of candidate plates. ``info`` (a dict) receives the solver
    status."""
    from ortools.sat.python import cp_model

    fx, b = cfg["fixed"], cfg["building"]
    T = len(fx["podiums"])
    fmin, fmax = int(fx["min_floors"] if fmin is None else fmin), max_floors(b)
    types = cfg["units"]["types"]
    units = [t["id"] for t in types]
    share = {t["id"]: t["share"] for t in types}
    carpet = {t["id"]: t["carpet_ft2"] for t in types}
    slot_fit = {p.key: (list(v) if isinstance(v, (list, tuple)) else [v] * T)
                for p in plates for v in [fit.get(p.key, 0)]}
    P = [p for p in plates if max(slot_fit[p.key]) >= fmin]
    if not P:
        return None
    pos = {p.key: i for i, p in enumerate(P)}
    if combo is not None and not all(p.key in pos for p in combo):
        return None
    sigs = sorted({unit_set(p) for p in P})
    sid = {g: i for i, g in enumerate(sigs)}
    n = len(P)
    R = [len(refuge_floors(f, b)) for f in range(fmin, fmax + 1)]
    arr = {
        "area": [int(round(10 * p.area_m2)) for p in P],
        "rarea": [int(round(10 * p.refuge_flat().area_m2)) for p in P],
        "south": [sum(1 for fl in p.flats if fl.door_dir == "S") for p in P],
        "carpet": [int(sum(carpet[fl.unit] for fl in p.flats) / 10) for p in P],
        "nfl": [len(p.flats) for p in P],
        "sig": [sid[unit_set(p)] for p in P],
    }
    for t in range(T):
        arr[f"fit{t}"] = [min(slot_fit[p.key][t], fmax) for p in P]
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
    area_t, south_t, carpet_t, flats_t = [], [], [], []
    for t in range(T):
        if combo is not None:
            m.Add(k[t] == pos[combo[t].key])
        idx = m.NewIntVar(0, fmax - fmin, f"i{t}")
        m.Add(idx == f[t] - fmin)
        m.AddElement(idx, R, r[t])
        m.Add(f[t] <= look(f"fit{t}", t, 0, fmax))
        for u in units:
            per = look("c" + u, t, 0, 6)
            isr = look("r" + u, t, 0, 1)
            cnt[u].append(times(f[t], per, 6 * fmax, f"n{u}{t}") - times(r[t], isr, max(R), f"q{u}{t}"))
        a = look("area", t, 0, max(arr["area"]))
        ra = look("rarea", t, 0, max(arr["rarea"]))
        area_t.append(times(f[t], a, fmax * max(arr["area"]), f"A{t}") - times(r[t], ra, max(R) * max(arr["rarea"]), f"RA{t}"))
        south_t.append(times(f[t], look("south", t, 0, 6), 6 * fmax, f"S{t}"))
        flats_t.append(times(f[t], look("nfl", t, 0, 6), 6 * fmax, f"F{t}") - r[t])
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
    if flat_caps is None:
        m.Add(area >= int((tgt - float(fx["fsi_band"])) * net * 10))
    else:
        for g, c in enumerate(flat_caps):
            m.Add(sum(x for t, x in enumerate(flats_t) if fx["podiums"][t] == g) <= c)
    gap = m.NewIntVar(0, 10 ** 7, "gap")
    m.AddAbsEquality(gap, area - int(tgt * net * 10))
    hi_f, lo_f = m.NewIntVar(fmin, fmax, "hi"), m.NewIntVar(fmin, fmax, "lo")
    m.AddMaxEquality(hi_f, f)
    m.AddMinEquality(lo_f, f)
    ph = [sum(c for t, c in enumerate(carpet_t) if fx["podiums"][t] == g) for g in (0, 1)]
    imb = m.NewIntVar(0, 10 ** 7, "imb")
    m.AddAbsEquality(imb, ph[0] - ph[1])
    # These front towers do not fit at these floors or taller, nor with plates that cover each
    # failed plate's footprint (plates share the hub as origin, so such a plate takes more ground
    # wherever it stands).
    for ng, ng_floors in nogoods:
        terms = []
        for t, (p, fl) in enumerate(zip(ng, ng_floors)):
            cover = [1 if _covers(q, p) else 0 for q in P]
            if not any(cover):
                break
            inside = m.NewIntVar(0, 1, "")
            m.AddElement(k[t], cover, inside)
            taller = m.NewBoolVar("")
            m.Add(f[t] >= fl).OnlyEnforceIf(taller)
            m.Add(f[t] < fl).OnlyEnforceIf(taller.Not())
            terms += [inside, taller]
        else:
            m.Add(sum(terms) <= len(terms) - 1)
    ex = sorted({q for e in exclude if all(g in sid for g in e)
                 for q in itertools.permutations(sid[g] for g in e)})
    if ex:
        m.AddForbiddenAssignments([look("sig", t, 0, len(sigs) - 1) for t in range(T)], ex)
    w = fx["weights"]
    # units: gap 0.1 m2 (0.01 FSI ~ 1,700), dev per mille x flats (1 pp ~ 10 N), south doors, floors, carpet/10
    m.Minimize(int(w["fsi"]) * gap + int(w["mix"]) * sum(dev) + int(w["south"]) * sum(south_t)
               + int(w["height_spread"]) * (hi_f - lo_f) + int(w["phase"]) * imb)
    solver = cp_model.CpSolver()  # interleaved workers on a deterministic-time budget: same answer every run
    solver.parameters.num_search_workers = 4
    solver.parameters.interleave_search = True
    solver.parameters.max_deterministic_time = time_s
    solver.parameters.max_time_in_seconds = 6 * time_s  # guard only
    st = solver.Solve(m)
    if info is not None:
        info["status"] = solver.StatusName(st)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    return [P[solver.Value(v)] for v in k], [solver.Value(v) for v in f]


def solve_fixed(cfg: dict, progress=print, workers: int | None = None) -> dict[str, list[Scheme]]:
    fx = cfg["fixed"]
    site = FeasibilitySite.build(cfg)
    net = site.net.area
    book = PlateBook(cfg)
    return {sc: _solve_scenario(cfg, site, net, book, sc, progress, workers) for sc in fx["scenarios"]}


def _solve_scenario(cfg: dict, site: FeasibilitySite, net: float, book: PlateBook, scenario: str, progress,
                    workers: int | None) -> list[Scheme]:
    fx = cfg["fixed"]
    plates = candidate_plates(cfg, book, scenario)
    fit4 = fit_floors(cfg, plates, workers)
    fit = fit_positions(cfg, plates, fit4, workers)
    ok = sum(1 for v in fit.values() if max(v) >= int(fx["min_floors"]))
    plates = best_geometries(plates, fit, int(fx["geometries_per_mix"]))
    progress(f"{scenario}: {ok} of {len(fit)} candidate plates fit the arrangement; tallest "
             f"{max((max(v) for v in fit.values()), default=0)} floors; {len(plates)} kept for selection")
    schemes, nogoods, exclude, pool, seen = [], [], [], [], set()

    def report(towers, lay):
        visitors_and_parking(site, lay, cfg)
        m = metrics(towers, lay, cfg, site)
        m["levers"] = parking_levers(m, cfg, site)
        pen = penalties(m, cfg, "target")
        schemes.append(Scheme(scenario, "target", towers, lay, m, pen, round(sum(pen.values()), 3),
                              sid=f"{scenario[:3]}-fix-{len(schemes) + 1}"))
        progress(f"{scenario}: option {sum(1 for x in schemes if x.mode == 'target')} FSI {m['fsi']:.3f}, "
                 f"{m['flats']} flats, every type within {type_dev_pp(m['mix_counts'], cfg):.2f} pp")
        comp = _compliant(site, cfg, net, plates, fit, towers, lay, nogoods, scenario)
        if comp is not None and tuple((t.plate.key, t.floors) for t in comp[0]) not in seen:
            ct, clay = comp
            seen.add(tuple((t.plate.key, t.floors) for t in ct))
            cm = metrics(ct, clay, cfg, site)
            cp = penalties(cm, cfg, "compliant")
            schemes.append(Scheme(scenario, "compliant", ct, clay, cm, cp, round(sum(cp.values()), 3),
                                  sid=f"{scenario[:3]}-fix-{len(schemes)}c"))
            progress(f"{scenario}: parking-compliant variant FSI {cm['fsi']:.3f}, {cm['flats']} flats, "
                     f"every type within {type_dev_pp(cm['mix_counts'], cfg):.2f} pp")
        exclude.append(tuple(sorted(unit_set(t.plate) for t in towers)))

    def enough():
        return sum(1 for x in schemes if x.mode == "target") >= int(fx["options"])

    for _ in range(int(fx["max_solves"])):
        info: dict = {}
        pick = select(cfg, plates, fit, net, nogoods, exclude, time_s=float(fx["solve_s"]), info=info)
        if pick is None:
            why = ("no further set meets the mix and FSI bands" if info.get("status") == "INFEASIBLE"
                   else f"no set found within {fx['solve_s']} s")
            progress(f"{scenario}: {why}")
            break
        combo, floors = pick
        towers = [Tower(f"T{i + 1}", p, fl, podium=g, segment=_segment(p, cfg, scenario))
                  for i, (p, fl, g) in enumerate(zip(combo, floors, fx["podiums"]))]
        failed: list = []
        lay = place_chain(site, towers, cfg, fx["sides"], failed)
        if lay is None:
            n = failed[0] + 1 if failed else len(combo)
            nogoods.append((combo[:n], floors[:n]))
            fixed_up = _repair(site, cfg, net, towers, n)
            if fixed_up is not None:  # a fallback; the solver may still find a closer set
                pool.append(fixed_up)
            progress(f"{scenario}: towers 1-{n} {[p.variant for p in combo[:n]]} at {floors[:n]} floors "
                     f"do not fit; cut" + (f" ({[t.floors for t in fixed_up[0]]} floors do)" if fixed_up else ""))
            continue
        report(towers, lay)
        if enough():
            break
    tgt = float(cfg["fsi"]["target"])
    for towers, lay in sorted(pool, key=lambda c: abs(fsi_of(c[0], cfg, net) - tgt)):
        if enough():
            break
        if tuple(sorted(unit_set(t.plate) for t in towers)) not in exclude:
            report(towers, lay)
    return schemes


def _compliant(site: FeasibilitySite, cfg: dict, net: float, plates: list[Plate], fit: dict, towers: list[Tower],
               lay: Layout, nogoods: list, scenario: str, rounds: int = 8):
    """The scheme closest to the FSI target whose residents park within each phase's basement, GF and
    stilt 1 (and whose visitors fit the setback bays), keeping the unit mix in tolerance.

    First the same plates and positions with fewer floors. Then, since parking goes by the flat and
    larger flats on the tighter podium can carry more FSI, any plates with each podium's flats capped
    by its parking: moving the towers moves the podium split and so the parking, so each placed set
    is also tried with fewer floors at its own positions, and the cap of a podium left short is
    lowered by its shortfall for the next round. The highest FSI is kept. Returns (towers, layout)
    or None."""
    fx, ratio = cfg["fixed"], float(cfg["parking"]["ratio"])
    best = None

    def consider(got):
        nonlocal best
        if got is not None and (best is None or fsi_of(got[0], cfg, net) > fsi_of(best[0], cfg, net) + 1e-9):
            best = got

    consider(_fewer_floors(site, cfg, net, plates, fit, towers, lay, nogoods))
    caps = _parking_caps(lay.parking, cfg)
    cuts = list(nogoods)
    for r in range(rounds):
        pick = select(cfg, plates, fit, net, cuts, [], time_s=float(fx["solve_s"]), flat_caps=caps,
                      fmin=int(cfg["building"]["min_floors"]))
        if pick is None:
            break
        combo, floors = pick
        if best is not None and fsi_of([Tower("", p, f) for p, f in zip(combo, floors)], cfg, net) <= \
                fsi_of(best[0], cfg, net) + 1e-9:
            break  # caps only tighten, so no later round can do better
        ct = [Tower(f"T{i + 1}", p, f, podium=g, segment=_segment(p, cfg, scenario))
              for i, (p, f, g) in enumerate(zip(combo, floors, fx["podiums"]))]
        failed: list = []
        cl = place_chain(site, ct, cfg, fx["sides"], failed)
        if cl is None:
            n = failed[0] + 1 if failed else len(combo)
            cuts.append((combo[:n], floors[:n]))
            continue
        visitors_and_parking(site, cl, cfg)
        if _parks(cl.parking):
            consider((ct, cl))
            break
        consider(_fewer_floors(site, cfg, net, plates, fit, ct, cl, cuts))
        cuts.append((combo, floors))  # does not park at these floors (nor taller)
        if r % 2 == 1:  # every second miss, lower the cap of a podium left short by its shortfall
            short = [d - s_ for d, s_ in zip(cl.parking["demand"], cl.parking["supply"])]
            caps = [c - max(1, math.ceil(x / ratio)) if x > 0 else c for c, x in zip(caps, short)]
            caps = [min(c, v) for c, v in zip(caps, _parking_caps(cl.parking, cfg, flats_only=True))]
    return best


def _parks(pk: dict) -> bool:
    return all(d <= s for d, s in zip(pk["demand"], pk["supply"])) and pk["visitor_bays"] >= pk["visitor_need"]


def _parking_caps(pk: dict, cfg: dict, flats_only: bool = False) -> list[int]:
    """Flats each podium can park: residents by its own supply, visitors by the setback bays (shared
    in proportion to the flats); with ``flats_only`` just the visitor limit."""
    ratio, vr = float(cfg["parking"]["ratio"]), float(cfg["parking"]["visitor_ratio"])
    caps = [10 ** 6 if flats_only else int(s / ratio + 1e-9) for s in pk["supply"]]
    if vr > 0 and pk["visitor_bays"] < pk["visitor_need"]:
        k = pk["visitor_bays"] / pk["visitor_need"]
        caps = [min(c, int(n * k)) for c, n in zip(caps, pk["flats"])]
    return caps


def _fewer_floors(site, cfg, net, plates, fit, towers, lay, nogoods, rounds: int = 3):
    """The same plates at the same positions with fewer floors, so the podiums and their parking stay
    as they are; each podium's flats capped by its parking."""
    caps = _parking_caps(lay.parking, cfg)
    for _ in range(rounds):
        pick = select(cfg, plates, fit, net, nogoods, [], time_s=float(cfg["fixed"]["solve_s"]),
                      combo=[t.plate for t in towers], flat_caps=caps, fmin=int(cfg["building"]["min_floors"]))
        if pick is None:
            return None
        ct = [Tower(t.name, t.plate, f, t.podium, t.segment, t.x, t.y) for t, f in zip(towers, pick[1])]
        cl = Layout(ct, None, list(lay.raw_podiums), lay.gap_band, raw_podiums=list(lay.raw_podiums),
                    basements=list(lay.basements))
        visitors_and_parking(site, cl, cfg)
        if _parks(cl.parking):
            return ct, cl
        caps = [min(c, v) - (1 if d > s_ else 0) for c, v, d, s_ in
                zip(caps, _parking_caps(cl.parking, cfg), cl.parking["demand"], cl.parking["supply"])]
    return None


def _repair(site: FeasibilitySite, cfg: dict, net: float, towers: list[Tower], n_fail: int, tries: int = 24):
    """Take up to three floors off each tower, at least one off the towers up to the one that could
    not be placed, keeping every unit type within the tolerance and the FSI in its band; the
    variants closest to the FSI target are placed first. Returns (towers, layout) or None."""
    fx = cfg["fixed"]
    fmin, tol = int(fx["min_floors"]), float(fx["mix_tol_pp"])
    tgt, cap, band = float(cfg["fsi"]["target"]), float(cfg["fsi"]["cap"]), float(fx["fsi_band"])
    floors = [t.floors for t in towers]
    cands = []
    for d in itertools.product(range(4), repeat=len(towers)):
        if not any(d[:n_fail]):
            continue
        fl = [f - x for f, x in zip(floors, d)]
        if min(fl) < fmin:
            continue
        ts = [Tower(t.name, t.plate, f, t.podium, t.segment) for t, f in zip(towers, fl)]
        if type_dev_pp(mix_of(ts, cfg), cfg) > tol + 1e-9:
            continue
        fsi = fsi_of(ts, cfg, net)
        if tgt - band - 1e-9 <= fsi <= cap + 1e-9:
            cands.append((abs(fsi - tgt), sum(d), max(fl) - min(fl), fl, ts))
    cands.sort(key=lambda c: c[:3])
    for *_, ts in cands[:tries]:
        lay = place_chain(site, ts, cfg, fx["sides"])
        if lay is not None:
            return ts, lay
    return None


def type_dev_pp(counts: dict[str, int], cfg: dict) -> float:
    """Largest gap between a unit type's share of the flats and its target share, in points."""
    n = sum(counts.values()) or 1
    return max(100.0 * abs(counts.get(t["id"], 0) / n - t["share"]) for t in cfg["units"]["types"])


def _segment(p: Plate, cfg: dict, scenario: str) -> str:
    if scenario == "mixed":
        return "mixed"
    seg = {t["id"]: t["segment"] for t in cfg["units"]["types"]}
    lab = {t["id"]: t["label"] for t in cfg["units"]["types"]}
    units = sorted(p.counts(), key=lambda u: -p.counts()[u])
    s = {seg[u] for u in units}
    return "/".join(sorted(s, key=SEG_ORDER.index)) + " · " + "+".join(lab[u] for u in units)
