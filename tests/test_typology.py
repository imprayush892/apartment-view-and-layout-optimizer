import math

import pytest
from shapely import affinity
from shapely.geometry import Polygon, box

from viewtower.typology import generators as g
from viewtower.typology.structure import core_area, structure


def spec(t, w=30.0, d=24.0, n=40, **p):
    return g.TowerSpec(t, w, d, g.freeze(p), n_floors=n)


@pytest.mark.parametrize("t", g.TYPOLOGIES)
def test_every_typology_generates_valid_plates(t):
    s = spec(t, podium_w=50.0, podium_d=40.0) if t == "podium_tower" else spec(t)
    s = g.TowerSpec(**{**s.__dict__, "podium_floors": 4 if t == "podium_tower" else 0})
    for level in (0, 10, 39):
        p = g.plate(s, level)
        assert p.is_valid and p.area > 100


def test_exact_reproduction_of_parameterised_shapes():
    # IoU against independently constructed reference geometry (should be 1 to numerical tolerance)
    assert g.iou(g.plate(spec("rectangular"), 0), box(-15, -12, 15, 12)) == pytest.approx(1.0, abs=1e-9)
    assert g.iou(g.plate(spec("square", 28.3), 0), box(-14.15, -14.15, 14.15, 14.15)) == pytest.approx(1.0, abs=1e-9)
    ref = Polygon([(0, 20), (20, 0), (0, -20), (-20, 0)])
    assert g.iou(g.plate(spec("diamond", 40), 0), ref) == pytest.approx(1.0, abs=1e-9)
    tri = g.plate(spec("triangular", 30, 26, chamfer_m=0.0), 0)
    assert g.iou(tri, Polygon([(-15, -26 / 3), (15, -26 / 3), (0, 52 / 3)])) == pytest.approx(1.0, abs=1e-6)  # 1e-6 m grid


def test_rotation_is_clockwise_from_north():
    s = g.TowerSpec("rectangular", 40, 10, rotation_deg=90, n_floors=1)
    minx, miny, maxx, maxy = g.plate(s, 0).bounds
    assert maxx - minx == pytest.approx(10) and maxy - miny == pytest.approx(40)


def test_cayan_like_twist_reproduction():
    # Cayan Tower (public facts): identical plates rotated 1.2 deg per floor, ~90 deg over 75 floors
    s = spec("twisted", 30, 30, n=76, base="square", twist_per_floor_deg=1.2)
    base, top = g.plate(s, 0), g.plate(s, 75)
    assert top.area == pytest.approx(base.area)
    assert g.iou(top, affinity.rotate(base, -90.0, origin=(0, 0))) == pytest.approx(1.0, abs=1e-9)


def test_taper_and_terrace():
    t = spec("tapered", 30, 30, n=41, base="square", top_scale=0.5)
    assert g.plate(t, 40).area == pytest.approx(g.plate(t, 0).area * 0.25, rel=1e-6)
    tr = spec("terraced", 30, 30, n=40, base="square", step_every=10, step_m=3.0, step_side_deg=270)
    assert g.plate(tr, 10).bounds[0] == pytest.approx(-12.0)       # west face retreated 3 m
    assert g.plate(tr, 9).bounds[0] == pytest.approx(-15.0)


def test_y_plan_has_three_wings_at_120_degrees():
    from shapely.geometry import Point
    y = g.plate(spec("y_shaped", 36, 16, wing_len=18.0), 0)
    at = lambda az, r: Point(r * math.sin(math.radians(az)), r * math.cos(math.radians(az)))
    assert all(y.contains(at(az, 17.0)) for az in (0, 120, 240))          # wing axes
    assert not any(y.contains(at(az, 17.0)) for az in (60, 180, 300))     # between wings
    assert len(y.interiors) == 0


def test_core_and_structure():
    s = spec("square", 28, 28, n=40)
    a = core_area(2, {"fixed_m2": 60, "per_unit_m2": 12})
    c = g.core(s, 5, a)
    assert c.area == pytest.approx(84)
    st = structure(g.plate(s, 5), c, 8.0)
    assert st.max_perimeter_spacing_m <= 8.0 + 1e-9
    assert 0 < st.equivalent_span_m < 20
    assert st.min_depth_m == pytest.approx(14 - math.sqrt(84) / 2, abs=0.3)
