import math
from pathlib import Path

import ezdxf
import pytest
from shapely.ops import unary_union

from viewtower.feasibility import config as fconfig
from viewtower.feasibility.layout import Tower, facing_overlap, place, visitors_and_parking
from viewtower.feasibility.plates import VARIANTS, assign_slots, build_plate, unit_builtup_m2
from viewtower.feasibility.search import PlateBook, fsi_of, mix_dev_pp, mix_of, optimise_floors, search
from viewtower.feasibility.site import FeasibilitySite, max_floors, refuge_floors, setback_for_height

EXAMPLE = Path(__file__).resolve().parents[1] / "configs" / "feasibility_example.yaml"


@pytest.fixture(scope="module")
def cfg():
    return fconfig.load(EXAMPLE)


@pytest.fixture(scope="module")
def site(cfg):
    return FeasibilitySite.build(cfg)


def test_setback_bands_follow_the_height_table(cfg):
    sb = cfg["setbacks"]
    table = [(30, 7), (30.1, 8), (36, 8), (42, 9), (48, 10), (54, 11), (60, 12), (66, 13), (72, 14), (72.1, 15), (76, 15)]
    for h, s in table:
        assert setback_for_height(h, sb) == s, h


def test_refuge_and_height_ceiling(cfg):
    b = cfg["building"]
    assert refuge_floors(18, b) == [7, 12, 17]
    assert refuge_floors(21, b) == [7, 12, 17]
    assert refuge_floors(22, b) == [7, 12, 17, 22]
    assert refuge_floors(5, b) == []
    assert max_floors(b) == 22  # 6.6 + 22 x 3.1 = 74.8 m <= 76 m


def test_site_rings(cfg, site):
    s = site.summary()
    assert s["widening_m2"] == pytest.approx(100 * 3.0, rel=1e-6)
    assert s["net_m2"] == pytest.approx(100 * 167, rel=1e-6)
    assert s["osr_ratio"] == pytest.approx(0.10, abs=1e-3)
    assert s["osr_narrowest_width_m"] >= cfg["osr"]["min_width_m"] - 1e-6
    assert s["green_ratio"] == pytest.approx(cfg["eia"]["green_ratio"], abs=1e-3)
    # green belt, driveway and podium do not overlap; basement stays out of the belt
    assert site.green.intersection(site.podium_env).area < 1e-6
    assert site.driveway.intersection(site.podium_env).area < 1e-6
    assert site.basement_env.intersection(site.green).area < 1e-6
    assert site.osr.intersection(site.podium_env).area < 1e-6


@pytest.mark.parametrize("variant", sorted(VARIANTS))
def test_plates_have_no_west_doors_and_exact_areas(cfg, variant):
    book = PlateBook(cfg)
    units = [t["id"] for t in cfg["units"]["types"]]
    comp = tuple((units * 3)[: len(VARIANTS[variant])])
    p = book.get(variant, comp, 21.0, 11.5)
    area = unit_builtup_m2(cfg)
    assert p.facing()["W"] == 0
    for f in p.flats:
        assert f.area_m2 == pytest.approx(area[f.unit], abs=1e-3)
        assert not f.poly.intersects(p.hub.buffer(-0.01))
    polys = [f.poly for f in p.flats]
    for i in range(len(polys)):
        for j in range(i + 1, len(polys)):
            assert polys[i].intersection(polys[j]).area < 1e-6
    assert p.footprint.geom_type == "Polygon" and p.footprint.is_valid
    assert p.area_m2 == pytest.approx(unary_union(polys + [p.hub, p.lobby]).area, rel=1e-6)


def test_facing_counts_per_variant(cfg):
    book = PlateBook(cfg)
    expect = {"X6": {"N": 2, "E": 2, "S": 2, "W": 0}, "X5": {"N": 2, "E": 2, "S": 1, "W": 0},
              "X5b": {"N": 2, "E": 2, "S": 1, "W": 0}, "X4": {"N": 2, "E": 2, "S": 0, "W": 0}}
    for v, fac in expect.items():
        assert book.get(v, ("U2",) * len(VARIANTS[v]), 19.0, 11.5).facing() == fac


def test_largest_units_take_the_best_slots(cfg):
    carpet = {t["id"]: t["carpet_ft2"] for t in cfg["units"]["types"]}
    asg = assign_slots("X6", ("U1", "U1", "U2", "U3", "U4", "U4"), carpet)
    assert asg["S_end"] == "U4" and asg["E_N"] == "U1"


def test_facing_overlap_measures_parallel_facades():
    from shapely.geometry import box
    a, b = box(0, 0, 10, 10), box(2, 14, 12, 24)
    assert facing_overlap(a, b, 14.0) == pytest.approx(8.0)
    assert facing_overlap(a, b, 3.0) == 0.0


def test_placement_respects_setbacks_spacing_and_podiums(cfg, site):
    book = PlateBook(cfg)
    p = book.get("X5b", ("U2",) * 5, 21.0, 11.5)
    towers = [Tower(f"T{i + 1}", p, 18, podium=0 if i < 2 else 1) for i in range(4)]
    lay = place(site, towers, cfg)
    assert lay is not None
    b = cfg["building"]
    for t in towers:
        assert site.tower_envelope(t.height(b)).buffer(1e-6).contains(t.footprint())
        assert lay.podiums[t.podium].buffer(1e-6).contains(t.footprint())
    for i in range(4):
        for j in range(i + 1, 4):
            d = towers[i].footprint().distance(towers[j].footprint())
            need = cfg["setbacks"]["same_podium_gap_m"] if towers[i].podium == towers[j].podium else \
                setback_for_height(max(towers[i].height(b), towers[j].height(b)), cfg["setbacks"])
            assert d >= need - 1e-6
    visitors_and_parking(site, lay, cfg)
    pk = lay.parking
    assert pk["demand"] == [math.ceil(1.9 * n - 1e-9) for n in pk["flats"]]
    assert all(s > 0 for s in pk["supply"])


def test_floor_optimiser_hits_the_target_without_breaking_the_cap(cfg, site):
    book = PlateBook(cfg)
    towers = [Tower(f"T{i}", book.get("X6", ("U1", "U2", "U2", "U3", "U4", "U4"), 21.0, 11.5), 0) for i in range(4)]
    optimise_floors(towers, cfg, site.net.area, max_floors(cfg["building"]))
    f = fsi_of(towers, cfg, site.net.area)
    assert f <= cfg["fsi"]["cap"] + 1e-9
    assert mix_dev_pp(mix_of(towers, cfg), cfg) < 15


def test_quick_search_is_deterministic_and_exports(cfg, tmp_path):
    small = fconfig.load(EXAMPLE, {"fsi": {"target": 3.0, "cap": 3.1},
                                   "search": {"towers": [4], "scenarios": ["mixed"], "prefilter_keep": 6, "per_family": 1,
                                              "groupings_per_set": 1}, "plates": {"variants": ["X5b", "X4"],
                                                                                   "arm_depth_m": [21.0], "end_width_m": [11.5]}})
    r1 = search(small, workers=1)["mixed"]
    r2 = search(small, workers=1)["mixed"]
    assert [(s.mode, s.metrics["fsi"], s.metrics["flats"]) for s in r1] == [(s.mode, s.metrics["fsi"], s.metrics["flats"]) for s in r2]
    assert r1, "the example plot should hold four towers"
    from viewtower.feasibility.export import scheme_json, site_json
    from viewtower.feasibility.export_dxf import write_scheme_dxf
    from viewtower.feasibility.export_html import write_viewer
    site = FeasibilitySite.build(small)
    dxf = write_scheme_dxf(tmp_path / "s.dxf", r1[0], site, small, "test")
    doc = ezdxf.readfile(dxf)
    assert len(doc.audit().errors) == 0
    layers = {e.dxf.layer for e in doc.modelspace()}
    assert {"A-EIA-GREEN", "A-OSR", "A-TOWER", "A-DOOR"} <= layers
    html = write_viewer(tmp_path / "v.html", {"title": "t", "subtitle": "s", "basis": {}, "notes": [],
                                              "variants": {"base": {"label": "b", "site": site_json(site, small),
                                                                    "schemes": {"mixed": {"target": [scheme_json(r1[0], small)]}},
                                                                    "scatter": []}}})
    text = Path(html).read_text()
    assert "__DATA__" not in text and "const DATA = {" in text
