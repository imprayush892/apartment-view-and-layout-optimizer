import json

from viewtower import pipeline
from viewtower.report import build_report


def test_end_to_end_and_determinism(small_cfg):
    out1 = pipeline.run(small_cfg)
    out2 = pipeline.run(small_cfg)
    r1, r2 = build_report(out1, small_cfg), build_report(out2, small_cfg)
    assert json.dumps(r1, sort_keys=True) == json.dumps(r2, sort_keys=True)
    res = out1["result"]
    assert res.evaluations, "expected at least one feasible candidate"
    best = res.evaluations[0]
    m = best.metrics
    assert m["fsi_used_m2"] <= small_cfg["limits"]["max_fsi_area_m2"] + 1e-6
    assert m["height_m"] <= small_cfg["limits"]["max_height_m"]
    assert m["units_total"] == sum(m[f"{c}_units"] for c in ("premium", "good", "neutral", "compromised"))
    assert all(u.class_reasons for u in best.units)
    assert "compromised_units_future" in m
    env = out1["prepared"].site.envelope.buffer(1e-3)
    assert all(env.contains(p) for p in best.plates.values())
    assert r1["rules_used"] and r1["view_field"]["premium_arc_deg"] is not None


def test_rejections_carry_rule_ids(small_cfg):
    cfg = dict(small_cfg, limits={"max_fsi_area_m2": 100.0, "max_height_m": 90})
    out = pipeline.run(cfg)
    assert not out["result"].evaluations
    assert all("ENV-FSI-01" in e.violations for e in out["result"].rejected)
