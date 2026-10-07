"""Unit-mix allocation and scheme search for two scenarios.

segregated: every tower serves one market segment (middle, upper-middle, luxury); its plate holds
            only that segment's unit types.
mixed:      every tower carries several unit types (at least ``min_types_mixed``); two plate
            compositions alternate along the chain so both phases get the full range.

For each tower set the floors are chosen to meet the FSI target (never above the cap, never above
the height ceiling) while holding the unit mix to its target shares. The set is then placed on
the site on two podiums and its parking counted. Two results come out of every placed set:

target:    floors as chosen for the FSI target; any car-parking shortfall is reported.
compliant: floors taken off, one at a time and mix-aware, until each phase parks its own flats at
           the required ratio. This is the scheme that meets every rule.

Scores are penalties (lower is better); every component is reported with the scheme.
"""
from __future__ import annotations

import copy
import itertools
import math
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field

from viewtower.feasibility.config import FT2_PER_M2
from viewtower.feasibility.layout import Layout, Tower, place, spacing_report, visitors_and_parking
from viewtower.feasibility.plates import DIRS, VARIANTS, Plate, assign_slots, build_plate, unit_builtup_m2
from viewtower.feasibility.site import FeasibilitySite, max_floors

SEGMENTS = ("middle", "upper_middle", "luxury")


@dataclass
class Scheme:
    scenario: str
    mode: str
    towers: list[Tower]
    layout: Layout
    metrics: dict
    penalties: dict
    score: float
    sid: str = ""
    sensitivity: dict = field(default_factory=dict)


# ------------------------------------------------------------------ units and compositions
def unit_table(cfg: dict) -> list[dict]:
    load = float(cfg["units"]["loading"])
    bu = unit_builtup_m2(cfg)
    out = []
    for t in cfg["units"]["types"]:
        out.append({**t, "carpet_m2": round(t["carpet_ft2"] / FT2_PER_M2, 2),
                    "builtup_m2": round(bu[t["id"]], 2),
                    "sbu_ft2": round(t["carpet_ft2"] * load, 1)})
    return out


def compositions(units: list[str], k: int, min_distinct: int = 1) -> list[tuple[str, ...]]:
    return [c for c in itertools.combinations_with_replacement(sorted(units), k) if len(set(c)) >= min_distinct]


class PlateBook:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.area = unit_builtup_m2(cfg)
        self.carpet = {t["id"]: t["carpet_ft2"] for t in cfg["units"]["types"]}
        self._c: dict = {}

    def get(self, variant: str, comp: tuple[str, ...], cr: float, wend: float) -> Plate:
        key = (variant, comp, cr, wend)
        if key not in self._c:
            asg = assign_slots(variant, comp, self.carpet)
            self._c[key] = build_plate(variant, asg, self.area, self.cfg["plates"], cr, wend)
        return self._c[key]


# ------------------------------------------------------------------ metrics
def mix_of(towers: list[Tower], cfg: dict) -> dict[str, int]:
    b = cfg["building"]
    out = {t["id"]: 0 for t in cfg["units"]["types"]}
    for tw in towers:
        for u, n in tw.flats_by_type(b).items():
            out[u] += n
    return out


def mix_dev_pp(counts: dict[str, int], cfg: dict) -> float:
    n = sum(counts.values())
    if n == 0:
        return 100.0
    return 50.0 * sum(abs(counts[t["id"]] / n - t["share"]) for t in cfg["units"]["types"])


def fsi_of(towers: list[Tower], cfg: dict, net: float) -> float:
    b = cfg["building"]
    lob = float(cfg["fsi"]["gf_lobby_m2_per_core"])
    return (sum(t.fsi_m2(b, lob) for t in towers) + float(cfg["fsi"]["clubhouse_m2"])) / net


def _floor_objective(towers: list[Tower], cfg: dict, net: float) -> float:
    w = cfg["search"]["weights"]
    f = fsi_of(towers, cfg, net)
    if f > float(cfg["fsi"]["cap"]) + 1e-9:
        return 1e6 + f
    b = cfg["building"]
    hs = [t.height(b) for t in towers]
    return (w["fsi_per_0_01"] * abs(f - float(cfg["fsi"]["target"])) / 0.01
            + w["mix_per_pp"] * mix_dev_pp(mix_of(towers, cfg), cfg)
            + w["height_spread_per_10m"] * (max(hs) - min(hs)) / 10.0)


def optimise_floors(towers: list[Tower], cfg: dict, net: float, fmax: int) -> float:
    """Uniform start nearest the target, then single and paired +-1 moves until no gain."""
    fmin = int(cfg["building"]["min_floors"])
    best_f, best_j = fmin, None
    for f in range(fmin, fmax + 1):
        for t in towers:
            t.floors = f
        j = _floor_objective(towers, cfg, net)
        if best_j is None or j < best_j:
            best_f, best_j = f, j
    for t in towers:
        t.floors = best_f
    j = best_j
    improved = True
    while improved:
        improved = False
        moves = [(i, d) for i in range(len(towers)) for d in (1, -1)]
        moves += [((i, k), 0) for i in range(len(towers)) for k in range(len(towers)) if i != k]
        for mv, d in moves:
            if d:
                i = mv
                nf = towers[i].floors + d
                if not fmin <= nf <= fmax:
                    continue
                towers[i].floors = nf
                jj = _floor_objective(towers, cfg, net)
                if jj < j - 1e-9:
                    j, improved = jj, True
                else:
                    towers[i].floors -= d
            else:
                i, k = mv
                if towers[i].floors + 1 > fmax or towers[k].floors - 1 < fmin:
                    continue
                towers[i].floors += 1
                towers[k].floors -= 1
                jj = _floor_objective(towers, cfg, net)
                if jj < j - 1e-9:
                    j, improved = jj, True
                else:
                    towers[i].floors -= 1
                    towers[k].floors += 1
    return j


def metrics(towers: list[Tower], lay: Layout | None, cfg: dict, site: FeasibilitySite) -> dict:
    b = cfg["building"]
    net = site.net.area
    lob = float(cfg["fsi"]["gf_lobby_m2_per_core"])
    load = float(cfg["units"]["loading"])
    carpet_ft2 = {t["id"]: t["carpet_ft2"] for t in cfg["units"]["types"]}
    counts = mix_of(towers, cfg)
    n = sum(counts.values())
    carpet = sum(carpet_ft2[u] * c for u, c in counts.items())
    fsi_m2 = sum(t.fsi_m2(b, lob) for t in towers) + float(cfg["fsi"]["clubhouse_m2"])
    facing = {d: 0 for d in DIRS}
    outlook = {d: 0 for d in DIRS}
    for t in towers:
        for d, c in t.facing(b).items():
            facing[d] += c
        ref = t.plate.refuge_flat()
        for f in t.plate.flats:
            outlook[f.outlook] += t.floors - (len(t.refuges(b)) if f is ref else 0)
    hs = [t.height(b) for t in towers]
    sl = [t.slenderness(b) for t in towers]
    per_phase = []
    for g in (0, 1):
        tw = [t for t in towers if t.podium == g]
        c = mix_of(tw, cfg)
        cp = sum(carpet_ft2[u] * k for u, k in c.items())
        per_phase.append({"towers": [t.name for t in tw], "flats": sum(c.values()), "carpet_ft2": round(cp),
                          "sbu_ft2": round(cp * load), "mix": c})
    sale = [p["sbu_ft2"] for p in per_phase]
    m = {
        "fsi": round(fsi_m2 / net, 4), "fsi_m2": round(fsi_m2, 1),
        "flats": n, "mix_counts": counts,
        "mix_shares": {u: round(c / n, 4) if n else 0 for u, c in counts.items()},
        "mix_dev_pp": round(mix_dev_pp(counts, cfg), 2),
        "carpet_ft2": round(carpet), "sbu_ft2": round(carpet * load),
        "avg_carpet_ft2": round(carpet / n, 1) if n else 0, "avg_sbu_ft2": round(carpet * load / n, 1) if n else 0,
        "saleable_deck_basis_ft2": round(1.06 * fsi_m2 * FT2_PER_M2),
        "sbu_over_fsi": round(carpet * load / (fsi_m2 * FT2_PER_M2), 3),
        "carpet_over_fsi": round(carpet / (fsi_m2 * FT2_PER_M2), 3),
        "facing": facing, "facing_share": {d: round(v / n, 4) if n else 0 for d, v in facing.items()},
        "outlook": outlook,
        "heights": hs, "max_height": max(hs), "min_height": min(hs),
        "slenderness": [round(s, 2) for s in sl],
        "phases": per_phase,
        "phase_imbalance": round(abs(sale[0] - sale[1]) / max(1, sum(sale)), 4),
        "cores": len(towers),
        "efficiency": round(sum(sum(f.area_m2 for f in t.plate.flats) * t.floors for t in towers)
                            / sum(t.plate.area_m2 * t.floors for t in towers), 4),
        "coverage": round(sum(t.plate.footprint.area for t in towers) / net, 4),
    }
    if lay is not None:
        m["parking"] = copy.deepcopy(lay.parking)
        m["spacing"] = spacing_report(lay, cfg)
    return m


def penalties(m: dict, cfg: dict, mode: str) -> dict:
    w = cfg["search"]["weights"]
    fs = m["facing_share"]
    sl = m["slenderness"]
    mean = sum(sl) / len(sl)
    std = math.sqrt(sum((s - mean) ** 2 for s in sl) / len(sl))
    p = {
        "fsi": w["fsi_per_0_01"] * abs(m["fsi"] - float(cfg["fsi"]["target"])) / 0.01,
        "mix": w["mix_per_pp"] * m["mix_dev_pp"],
        "facing": w["facing_ne_gap"] * (1.0 - fs["N"] - fs["E"]) + w["facing_west"] * fs["W"],
        "slenderness": w["slender_std"] * std + w["slender_low"] * sum(max(0.0, w["slender_min"] - s) for s in sl),
        "height_spread": w["height_spread_per_10m"] * (m["max_height"] - m["min_height"]) / 10.0,
        "phasing": w["phase_imbalance"] * m["phase_imbalance"],
        "towers": w["per_extra_tower"] * max(0, m["cores"] - 4),
        "efficiency": w["efficiency"] * max(0.0, 0.82 - m["efficiency"]),
    }
    pk = m.get("parking")
    if pk:
        short = sum(max(0, d - s) for d, s in zip(pk["demand"], pk["supply"]))
        vis_short = max(0, pk["visitor_need"] - pk["visitor_bays"])
        p["parking_short"] = 0.25 * short + 0.1 * vis_short
        thin = min((s - d) / max(1, d) for d, s in zip(pk["demand"], pk["supply"]))
        p["parking_thin"] = w["parking_thin"] if (mode == "target" and 0 <= thin < 0.02) else 0.0
    return {k: round(v, 3) for k, v in p.items()}


# ------------------------------------------------------------------ tower sets
def _segment_units(cfg: dict) -> dict[str, list[str]]:
    out = {s: [] for s in SEGMENTS}
    for t in cfg["units"]["types"]:
        out.setdefault(t["segment"], []).append(t["id"])
    return out


def _segment_comps(cfg: dict, seg: str, k: int) -> list[tuple[str, ...]]:
    units = _segment_units(cfg)[seg]
    share = {t["id"]: t["share"] for t in cfg["units"]["types"]}
    tot = sum(share[u] for u in units)
    out = []
    for c in compositions(units, k):
        dev = sum(abs(c.count(u) / k - share[u] / tot) for u in units) / 2
        if dev <= 0.25 + 1e-9:
            out.append((dev, c))
    out.sort()
    return [c for _, c in out[:3]]


def segregated_sets(cfg: dict, book: PlateBook):
    pc = cfg["plates"]
    for T in cfg["search"]["towers"]:
        for n_m in range(1, T - 1):
            for n_u in range(1, T - n_m):
                n_l = T - n_m - n_u
                if n_l < 1:
                    continue
                for cr in pc["arm_depth_m"]:
                    for we in pc["end_width_m"]:
                        for vm, vu, vl in itertools.product(pc["variants"], repeat=3):
                            for cm in _segment_comps(cfg, "middle", len(VARIANTS[vm])):
                                for cu in _segment_comps(cfg, "upper_middle", len(VARIANTS[vu])):
                                    for cl in _segment_comps(cfg, "luxury", len(VARIANTS[vl])):
                                        spec = ([("middle", vm, cm)] * n_m + [("upper_middle", vu, cu)] * n_u
                                                + [("luxury", vl, cl)] * n_l)
                                        yield [(seg, book.get(v, c, cr, we)) for seg, v, c in spec]


def mixed_sets(cfg: dict, book: PlateBook):
    """Two plate compositions alternate along the chain; they may use different plate variants."""
    pc = cfg["plates"]
    units = [t["id"] for t in cfg["units"]["types"]]
    share = {t["id"]: t["share"] for t in cfg["units"]["types"]}
    min_d = int(cfg["search"]["min_types_mixed"])
    options = [(v, c) for v in pc["variants"] for c in compositions(units, len(VARIANTS[v]), min(min_d, len(VARIANTS[v])))]
    by_pair: dict = {}
    for (vp, p), (vq, q) in itertools.combinations_with_replacement(options, 2):
        k = len(p) + len(q)
        dev = sum(abs((p.count(u) + q.count(u)) / k - share[u]) for u in units) / 2
        by_pair.setdefault(tuple(sorted((vp, vq))), []).append((dev, vp, p, vq, q))
    for key in sorted(by_pair):
        for _, vp, p, vq, q in sorted(by_pair[key])[:8]:
            for T in cfg["search"]["towers"]:
                for cr in pc["arm_depth_m"]:
                    for we in pc["end_width_m"]:
                        yield [("mixed", book.get(vp, p, cr, we) if i % 2 == 0 else book.get(vq, q, cr, we))
                               for i in range(T)]


# ------------------------------------------------------------------ groupings (which towers on podium A)
def groupings(spec: list[tuple[str, Plate]], cfg: dict, n_keep: int):
    T = len(spec)
    sizes = sorted({T // 2, T - T // 2})
    carpet = {t["id"]: t["carpet_ft2"] for t in cfg["units"]["types"]}
    seen = set()
    out = []
    for na in sizes:
        for idx in itertools.combinations(range(T), na):
            a = [spec[i] for i in idx]
            bgrp = [spec[i] for i in range(T) if i not in idx]
            sig = (tuple(sorted(p.key for _, p in a)), tuple(sorted(p.key for _, p in bgrp)))
            if sig in seen:
                continue
            seen.add(sig)
            sa = sum(sum(carpet[f.unit] for f in p.flats) for _, p in a)
            sb = sum(sum(carpet[f.unit] for f in p.flats) for _, p in bgrp)
            imb = abs(sa - sb) / (sa + sb)
            segs_a = len({s for s, _ in a})
            # podium A (front, wide zone): widest first; podium B packs from the rear: narrowest first
            a.sort(key=lambda sp: (-sp[1].width, sp[1].key))
            bgrp.sort(key=lambda sp: (sp[1].width, sp[1].key))
            out.append((imb - 0.05 * segs_a, a, bgrp))
    out.sort(key=lambda r: r[0])
    return [(a, bgrp) for _, a, bgrp in out[:n_keep]]


# ------------------------------------------------------------------ evaluation of one set
def _make_towers(a, bgrp) -> list[Tower]:
    ts = []
    for i, (seg, p) in enumerate(a):
        ts.append(Tower(f"T{i + 1}", p, 0, podium=0, segment=seg))
    for i, (seg, p) in enumerate(bgrp):
        ts.append(Tower(f"T{len(a) + i + 1}", p, 0, podium=1, segment=seg))
    return ts


def _floors_in_order(a, bgrp, oa, ob, floors):
    """Floors chosen for (a, bgrp) re-listed for the reordered (oa, ob); identical plates keep theirs."""
    fa, fb = list(floors[:len(a)]), list(floors[len(a):])
    def remap(orig, new, fl):
        pool = list(zip([id(x) for x in orig], fl))
        out = []
        for x in new:
            k = next(i for i, (pid, _) in enumerate(pool) if pid == id(x))
            out.append(pool.pop(k)[1])
        return out
    return remap(a, oa, fa) + remap(bgrp, ob, fb)


_WORKER: dict = {}


def _init_worker(cfg: dict) -> None:
    _WORKER["cfg"] = cfg
    _WORKER["site"] = FeasibilitySite.build(cfg)


def evaluate_set(args):
    """Place one tower set (with its podium grouping) and return target + compliant schemes."""
    scenario, a, bgrp = args
    cfg, site = _WORKER["cfg"], _WORKER["site"]
    net = site.net.area
    b = cfg["building"]
    out = []
    top = max_floors(b)
    for cap in range(top, int(b["min_floors"]) + 3, -1):
        towers = _make_towers(a, bgrp)
        optimise_floors(towers, cfg, net, cap)
        if fsi_of(towers, cfg, net) < float(cfg["fsi"]["target"]) - float(cfg["search"]["fsi_floor_gap"]):
            break
        floors = [t.floors for t in towers]
        lay = None
        orders = ((a, bgrp), (a[::-1], bgrp), (a, bgrp[::-1]), (a[::-1], bgrp[::-1]))
        for oa, ob in orders[: (4 if cap > top - int(cfg["search"]["reorder_caps"]) else 1)]:
            towers = _make_towers(oa, ob)
            for t, f in zip(towers, _floors_in_order(a, bgrp, oa, ob, floors)):
                t.floors = f
            lay = place(site, towers, cfg)
            if lay is not None:
                break
        if lay is None:
            continue
        visitors_and_parking(site, lay, cfg)
        m = metrics(towers, lay, cfg, site)
        m["levers"] = parking_levers(m, cfg, site)
        pen = penalties(m, cfg, "target")
        out.append(Scheme(scenario, "target", towers, lay, m, pen, round(sum(pen.values()), 3)))
        # compliant: take floors off until each phase parks itself
        ct = [Tower(t.name, t.plate, t.floors, t.podium, t.segment, t.x, t.y) for t in towers]
        clay = Layout(ct, lay.y_split, list(lay.raw_podiums), lay.gap_band, raw_podiums=list(lay.raw_podiums))
        _reduce_for_parking(site, clay, cfg, net)
        if clay.parking:
            cm = metrics(ct, clay, cfg, site)
            cpen = penalties(cm, cfg, "compliant")
            out.append(Scheme(scenario, "compliant", ct, clay, cm, cpen, round(sum(cpen.values()), 3)))
        break
    return out


def _reduce_for_parking(site: FeasibilitySite, lay: Layout, cfg: dict, net: float) -> None:
    b = cfg["building"]
    fmin = int(b["min_floors"])
    for _ in range(200):
        visitors_and_parking(site, lay, cfg)
        pk = lay.parking
        short = [g for g in (0, 1) if pk["demand"][g] > pk["supply"][g]]
        if not short and pk["visitor_bays"] >= pk["visitor_need"]:
            return
        g = short[0] if short else max((0, 1), key=lambda g: pk["demand"][g])
        cands = [t for t in lay.towers if t.podium == g and t.floors > fmin]
        if not cands:
            lay.parking = {}
            return
        best, bj = None, None
        for t in cands:
            t.floors -= 1
            j = mix_dev_pp(mix_of(lay.towers, cfg), cfg) * 1.5 + 0.2 * (max(x.height(b) for x in lay.towers)
                                                                     - min(x.height(b) for x in lay.towers))
            t.floors += 1
            if bj is None or j < bj:
                best, bj = t, j
        best.floors -= 1
    lay.parking = {}


# ------------------------------------------------------------------ driver
def search(cfg: dict, progress=None, workers: int | None = None) -> dict[str, list[Scheme]]:
    site = FeasibilitySite.build(cfg)
    net = site.net.area
    book = PlateBook(cfg)
    fmax = max_floors(cfg["building"])
    results: dict[str, list[Scheme]] = {}
    for scenario in cfg["search"]["scenarios"]:
        gen = segregated_sets(cfg, book) if scenario == "segregated" else mixed_sets(cfg, book)
        # 1) floors for the FSI target, pre-placement score
        pre = []
        seen = set()
        for spec in gen:
            sig = tuple(sorted(p.key + "|" + s for s, p in spec))
            if sig in seen:
                continue
            seen.add(sig)
            towers = [Tower(f"T{i + 1}", p, 0, segment=s) for i, (s, p) in enumerate(spec)]
            j = optimise_floors(towers, cfg, net, fmax)
            if j >= 1e6:
                continue
            m = metrics(towers, None, cfg, site)
            if m["mix_dev_pp"] > float(cfg["search"]["max_mix_dev_pp"]):
                continue
            pen = penalties(m, cfg, "pre")
            fam = (len(spec), tuple(sorted(p.variant for _, p in spec)), spec[0][1].arm_depth, spec[0][1].end_width)
            pre.append((sum(pen.values()), sig, spec, fam))
        keep = _stratified(pre, int(cfg["search"]["prefilter_keep"]), int(cfg["search"]["per_family"]))
        jobs = []
        for _, _, spec, _ in keep:
            for a, bgrp in groupings(spec, cfg, int(cfg["search"]["groupings_per_set"])):
                jobs.append((scenario, a, bgrp))
        if progress:
            progress(f"{scenario}: {len(pre)} tower sets meet the mix filter; placing {len(jobs)} groupings")
        schemes: list[Scheme] = []
        if workers == 1:
            _init_worker(cfg)
            for jb in jobs:
                schemes.extend(evaluate_set(jb))
        else:
            with ProcessPoolExecutor(max_workers=workers, initializer=_init_worker, initargs=(cfg,)) as ex:
                for res in ex.map(evaluate_set, jobs, chunksize=4):
                    schemes.extend(res)
        for i, s in enumerate(schemes):
            s.sid = f"{scenario[:3]}-{s.mode[:3]}-{i:04d}"
        results[scenario] = schemes
        if progress:
            ok = sum(1 for s in schemes if s.mode == "target")
            progress(f"{scenario}: {ok} groupings placed on the site")
    return results


def _stratified(pre: list, keep: int, per_family: int) -> list:
    """Best few of every plate family (tower count, variants, arm depth, end width), then the rest by score."""
    pre = sorted(pre, key=lambda r: (r[0], r[1]))
    taken, count, rest = [], {}, []
    for r in pre:
        if count.get(r[3], 0) < per_family:
            count[r[3]] = count.get(r[3], 0) + 1
            taken.append(r)
        else:
            rest.append(r)
    out = taken + rest
    return sorted(out[:max(keep, len(taken))], key=lambda r: (r[0], r[1]))


def parking_levers(m: dict, cfg: dict, site: FeasibilitySite) -> dict:
    """Ways to close a car-parking shortfall, each sized on its own."""
    pk = m.get("parking") or {}
    short = sum(max(0, d - s) for d, s in zip(pk.get("demand", []), pk.get("supply", [])))
    short += max(0, pk.get("visitor_need", 0) - pk.get("visitor_bays", 0))
    p = cfg["parking"]
    bay_b = float(p["m2_per_car_basement"])
    bay_p = float(p["m2_per_car_podium"])
    under_green = int(site.green.area * 0.9 // bay_b)
    return {
        "shortfall_cars": short,
        "second_basement_m2": round(short * bay_b + (float(p["ramp_basement_m2"]) if short else 0)),
        "second_basement_share": round((short * bay_b) / site.basement_env.area, 3) if short else 0.0,
        "stackers_in_basement": short,
        "stacker_share_of_basement_bays": round(short / max(1, sum(pk.get("basement", [0]))), 3),
        "stilt2_m2": round(short * bay_p),
        "basement_under_green_cars": under_green,
        "visitor_cost_cars": int(pk.get("visitor_need", 0) * 2 * 2.5 * float(cfg["access"]["visitor_bay_d_m"]) // bay_p),
    }


def ranked(schemes: list[Scheme], mode: str, n: int) -> list[Scheme]:
    """Best ``n`` of one mode, deduplicated on (plates, floors)."""
    pool = sorted((s for s in schemes if s.mode == mode), key=lambda s: (s.score, s.sid))
    out, seen = [], set()
    for s in pool:
        sig = tuple(sorted((t.plate.key, t.floors, t.podium) for t in s.towers))
        if sig in seen:
            continue
        seen.add(sig)
        out.append(s)
        if len(out) >= n:
            break
    return out
