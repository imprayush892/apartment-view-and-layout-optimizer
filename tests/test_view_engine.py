import math

import numpy as np
import pytest
from shapely.geometry import box

from viewtower.context.scene import Context, ContextBuilding, Landmark, rasterize
from viewtower.view.engine import RayParams, cast
from viewtower.view.quality import QualityWeights, _arc, directional_quality

P = RayParams(max_distance_m=1500.0)


def scene_with(buildings=(), water=True, landmarks=()):
    ctx = Context(list(buildings), [box(-2000, 200, 2000, 2000)] if water else [], [], list(landmarks))
    return rasterize(ctx, (-1600, -1600, 1600, 1600), 2.0)


def test_open_sea_visible_to_the_north_only():
    sc = scene_with()
    prof = cast(sc, np.array([[0, 0, 11.5]]), np.array([0.0, 180.0]), P)
    assert prof.water[0, 0] == pytest.approx(1.0)          # sea to the north
    assert prof.water[0, 1] == 0.0                          # land to the south
    assert prof.horizon_deg[0, 0] == 0.0 and prof.sky_openness[0, 0] == pytest.approx(1.0)
    assert prof.distance_to_obstruction_m[0, 0] == pytest.approx(1500.0)


def test_wall_blocks_sea_at_low_level_but_not_high():
    wall = ContextBuilding("W", box(-500, 100, 500, 110), 30.0)
    sc = scene_with([wall])
    low = cast(sc, np.array([[0, 0, 11.5]]), np.array([0.0]), P)
    high = cast(sc, np.array([[0, 0, 61.5]]), np.array([0.0]), P)
    assert low.water[0, 0] == 0.0
    assert high.water[0, 0] == pytest.approx(1.0)
    assert low.distance_to_obstruction_m[0, 0] == pytest.approx(100.0, abs=2.5)
    assert low.horizon_deg[0, 0] == pytest.approx(math.degrees(math.atan2(30 - 11.5, 100)), abs=1.0)
    assert low.obstruction_height_m[0, 0] == pytest.approx(30.0)


def test_elevation_dependence_is_monotone_here():
    sc = scene_with([ContextBuilding("W", box(-500, 100, 500, 110), 30.0)])
    zs = [1.5, 26.5, 51.5, 76.5, 101.5]
    obs = np.array([[0, 0, z] for z in zs])
    prof = cast(sc, obs, np.arange(-60, 61, 5.0), P)
    q = directional_quality(prof, QualityWeights()).mean(axis=1)
    assert all(np.diff(q) >= -1e-9)


def test_privacy_penalty_for_close_habitable_building():
    near = ContextBuilding("N", box(-20, 10, 20, 30), 60.0, habitable=True)
    prof = cast(scene_with([near], water=False), np.array([[0, 0, 11.5]]), np.array([0.0]), P)
    assert prof.privacy_penalty[0, 0] == pytest.approx(1 - 10 / 30, abs=0.1)


def test_landmark_visibility():
    lm = Landmark("L", 0.0, -1000.0, 100.0)
    blocker = ContextBuilding("B", box(-30, -520, 30, -500), 150.0)
    free = cast(scene_with(landmarks=[lm]), np.array([[0, 0, 11.5]]), np.array([180.0, 90.0]), P)
    hid = cast(scene_with([blocker], landmarks=[lm]), np.array([[0, 0, 11.5]]), np.array([180.0]), P)
    assert free.landmark[0, 0] == 1.0 and free.landmark[0, 1] == 0.0
    assert hid.landmark[0, 0] == 0.0


def test_premium_arc_wraps_around_north():
    az = np.arange(0, 360, 10.0)
    vals = np.where((az >= 300) | (az <= 40), 1.0, 0.0)
    assert _arc(vals, az, 0.5) == (300.0, 40.0)
