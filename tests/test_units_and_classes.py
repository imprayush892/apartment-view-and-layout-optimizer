import numpy as np
import pytest
from shapely.geometry import box

from viewtower.evaluation.classify import classify
from viewtower.optimize.pareto import nondominated_ranks, presentation_key
from viewtower.rules.registry import RuleRegistry
from viewtower.typology.structure import perimeter_points
from viewtower.units.subdivide import Room, Unit, build_units, split_cuts
from viewtower.view.quality import ApertureResult


def fake_aperture(n, q):
    q = np.asarray(q, float)
    return ApertureResult(q, q, np.ones(n), np.zeros(n), np.full(n, 500.0), np.zeros(n))


PROGRAM = {"bedrooms": 3, "living_frontage_m": 8.0, "bedroom_frontage_m": 4.0, "kitchen_frontage_m": 3.0}


@pytest.mark.parametrize("n", [1, 2, 4])
def test_equal_area_split_of_square(n):
    plate, core = box(-15, -15, 15, 15), box(-4, -4, 4, 4)
    pts, normals, s = perimeter_points(plate, 1.0)
    units, v = build_units(3, 10.8, plate, core, s, 1.0, fake_aperture(len(s), np.ones(len(s))), n, PROGRAM,
                           mode="equal_area")
    assert not v and len(units) == n
    areas = [u.outline.area for u in units]
    assert sum(areas) == pytest.approx(plate.area - core.area, rel=1e-6)
    assert max(areas) / min(areas) < 1.1


def test_first_cut_at_worst_facade_and_living_on_best():
    plate, core = box(-15, -15, 15, 15), box(-4, -4, 4, 4)
    pts, normals, s = perimeter_points(plate, 1.0)
    q = np.where(normals == 270.0, 0.9, 0.2)          # west face is the view
    q[np.argmax(normals == 90.0)] = 0.0              # worst point on the east face
    cuts = split_cuts(q, s, 120.0, 2)
    assert normals[np.argmin(np.abs(s - cuts[0]))] == 90.0
    units, _ = build_units(0, 0, plate, core, s, 1.0, fake_aperture(len(s), q), 1, PROGRAM)
    assert units[0].room("living").view_score == pytest.approx(0.9)


def test_frontage_violation_reported():
    plate, core = box(-6, -6, 6, 6), box(-2, -2, 2, 2)
    _, _, s = perimeter_points(plate, 1.0)
    prog = dict(PROGRAM, bedrooms=12)
    _, v = build_units(0, 0, plate, core, s, 1.0, fake_aperture(len(s), np.ones(len(s))), 1, prog)
    assert "GR-FRONT-BR-01" in v


def mk_unit(lr_q, lr_w, bed_w, d_obs=500.0, privacy=0.0, horizon=0.0):
    rooms = [Room("living", 8, lr_q, lr_w, 1.0, privacy, d_obs, horizon)] + \
            [Room(f"bed{i + 1}", 4, 0.5, w, 1.0, 0.0, 500.0, 0.0) for i, w in enumerate(bed_w)]
    return Unit("L010-U1", 10, 36.0, box(0, 0, 10, 10), 30, rooms)


def test_view_classes():
    rules = RuleRegistry.load()
    assert classify(mk_unit(0.7, 0.6, [0.5, 0.4, 0.0]), rules)[0] == "premium"
    assert classify(mk_unit(0.7, 0.6, [0.5, 0.0, 0.0]), rules)[0] == "good"          # only 1 bedroom sees water
    assert classify(mk_unit(0.3, 0.0, [0.0]), rules)[0] == "neutral"
    cls, reasons, margin = classify(mk_unit(0.7, 0.6, [0.5, 0.5], d_obs=20.0), rules)
    assert cls == "compromised" and margin < 0 and "d_obs_median" in reasons[0]
    assert classify(mk_unit(0.7, 0.6, [0.5, 0.5], privacy=0.8), rules)[0] == "compromised"


def test_rule_overrides_and_non_configurable():
    r = RuleRegistry.load(overrides={"VC-COMPROMISED": {"d_min": 10.0}})
    assert r.value("VC-COMPROMISED")["d_min"] == 10.0 and r.value("VC-COMPROMISED")["q_lr_min"] == 0.25
    with pytest.raises(ValueError):
        RuleRegistry.load(overrides={"ENV-ENVELOPE-01": 1})


def test_pareto_and_presentation():
    vals = np.array([[10, 0], [8, 0], [12, 3], [12, 0]], float)      # gdv max, compromised min
    ranks = nondominated_ranks(vals, ["max", "min"])
    assert ranks.tolist() == [1, 2, 1, 0]
    prio = [{"metric": "comp", "equals": 0}, {"metric": "gdv", "sense": "max"}]
    keys = sorted([presentation_key({"comp": 3, "gdv": 12}, prio, "a"), presentation_key({"comp": 0, "gdv": 8}, prio, "b")])
    assert keys[0][-1] == "b"
