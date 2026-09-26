import pytest
from shapely.geometry import Polygon, box

from viewtower.geometry.site import Site, envelope_from_setbacks, latlon_to_local, local_to_latlon, to_local_frame


def test_rectangle_setbacks_exact():
    b = box(0, 0, 60, 40)                      # edges: E, N, W, S (shapely box vertex order)
    env = envelope_from_setbacks(b, [9, 6, 6, 12])
    assert env.equals_exact(box(6, 12, 51, 34), 1e-6) or abs(env.symmetric_difference(box(6, 12, 51, 34)).area) < 1e-6


def test_triangle_uniform_setback_matches_inradius_scaling():
    t = Polygon([(0, 0), (100, 0), (50, 30)])
    env = envelope_from_setbacks(t, [5, 5, 5])
    r = 2 * t.area / t.length
    assert env.area == pytest.approx(t.area * ((r - 5) / r) ** 2, rel=1e-6)


def test_setback_count_validated():
    with pytest.raises(ValueError):
        envelope_from_setbacks(box(0, 0, 10, 10), [1, 2])


def test_empty_envelope_rejected():
    with pytest.raises(ValueError):
        Site.build(box(0, 0, 10, 10), boundary_is_envelope=False, edge_setbacks_m=[6, 6, 6, 6])


def test_edges_for_click_to_set_setback():
    site = Site.build(box(0, 0, 60, 40), boundary_is_envelope=True)
    edges = site.edges()
    assert [e["edge"] for e in edges] == [0, 1, 2, 3]
    assert sum(e["length_m"] for e in edges) == pytest.approx(200)


def test_north_rotation_and_latlon_roundtrip():
    # true north drawn along drawing +X  ->  drawing +X must map to local +Y (north)
    p = to_local_frame(box(0, 0, 10, 0.001), 90)
    assert p.bounds[3] == pytest.approx(10, abs=1e-6)
    x, y = latlon_to_local(19.03, 72.84, (19.02, 72.83))
    assert local_to_latlon(x, y, (19.02, 72.83)) == pytest.approx((19.03, 72.84), abs=1e-9)
