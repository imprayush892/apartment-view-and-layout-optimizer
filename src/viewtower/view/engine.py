"""Vectorised 2.5-D ray marching over a RasterScene (see docs/spec/07_view_quality.md §2)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from viewtower.context.scene import RasterScene


@dataclass
class RayParams:
    max_distance_m: float = 3000.0
    min_distance_m: float = 1.0
    growth: float = 0.01               # rho: step = max(res/2, rho * d)
    water_ref_deg: float = 1.0         # beta_ref
    distance_ref_m: float = 50.0       # d0 in the distance score
    privacy_distance_m: float = 30.0   # d_priv
    landmark_halfwidth_deg: float = 3.0

    @classmethod
    def from_config(cls, cfg: dict) -> "RayParams":
        keys = cls.__dataclass_fields__.keys()
        return cls(**{k: v for k, v in cfg.items() if k in keys})


def sample_distances(res: float, p: RayParams) -> np.ndarray:
    d = [p.min_distance_m]
    while d[-1] < p.max_distance_m:
        d.append(d[-1] + max(res / 2.0, p.growth * d[-1]))
    return np.asarray(d, dtype=np.float64)


@dataclass
class ViewProfile:
    """Per-observer, per-azimuth view variables; all arrays have shape (N, A)."""
    azimuth_deg: np.ndarray
    horizon_deg: np.ndarray
    distance_to_obstruction_m: np.ndarray
    obstruction_height_m: np.ndarray
    obstruction_habitable: np.ndarray
    sky_openness: np.ndarray
    water: np.ndarray
    green: np.ndarray
    landmark: np.ndarray
    distance_score: np.ndarray
    privacy_penalty: np.ndarray

    def take(self, idx) -> "ViewProfile":
        return ViewProfile(**{k: getattr(self, k)[idx] for k in self.__dataclass_fields__})


def _march(scene: RasterScene, obs: np.ndarray, az_deg: np.ndarray, d: np.ndarray):
    """Return surface height, water, green, habitable samples of shape (N, A, S)."""
    th = np.radians(az_deg)[:, :, None]
    x = obs[:, 0, None, None] + np.sin(th) * d[None, None, :]
    y = obs[:, 1, None, None] + np.cos(th) * d[None, None, :]
    i, j, inside = scene.indices(x, y)
    i = np.where(inside, i, 0)
    j = np.where(inside, j, 0)
    h = np.where(inside, scene.height[i, j], 0.0)
    w = inside & scene.water[i, j]
    g = inside & scene.green[i, j]
    hab = inside & scene.habitable[i, j]
    return h, w, g, hab


def cast(scene: RasterScene, observers: np.ndarray, azimuths_deg: np.ndarray, params: RayParams,
         chunk: int = 64) -> ViewProfile:
    """Cast rays from ``observers`` (N, 3) along ``azimuths_deg`` ((A,) shared or (N, A))."""
    observers = np.asarray(observers, dtype=np.float64).reshape(-1, 3)
    n = len(observers)
    az = np.asarray(azimuths_deg, dtype=np.float64)
    if az.ndim == 1:
        az = np.broadcast_to(az, (n, az.size))
    d = sample_distances(scene.res, params)
    parts = [_cast_chunk(scene, observers[s:s + chunk], az[s:s + chunk], d, params) for s in range(0, n, chunk)]
    fields = ViewProfile.__dataclass_fields__
    return ViewProfile(**{k: np.concatenate([getattr(p, k) for p in parts]) for k in fields})


def _cast_chunk(scene, obs, az, d, p: RayParams) -> ViewProfile:
    z0 = obs[:, 2, None, None]
    h, w, g, hab = _march(scene, obs, az, d)
    e = np.degrees(np.arctan2(h - z0, d[None, None, :]))
    # running horizon from all *previous* samples
    prev = np.maximum.accumulate(e, axis=2)
    horizon_before = np.concatenate([np.full(e.shape[:2] + (1,), -90.0), prev[:, :, :-1]], axis=2)
    visible = e >= horizon_before - 1e-9
    de = np.abs(np.diff(e, axis=2, append=e[:, :, -1:]))
    water_span = np.sum(np.where(w & visible, de, 0.0), axis=2)
    green_span = np.sum(np.where(g & visible, de, 0.0), axis=2)
    horizon = np.maximum(prev[:, :, -1], 0.0)

    blocked = h > z0
    any_block = blocked.any(axis=2)
    first = np.argmax(blocked, axis=2)
    d_obs = np.where(any_block, d[first], p.max_distance_m)
    take = lambda arr: np.take_along_axis(arr, first[:, :, None], axis=2)[:, :, 0]
    obs_h = np.where(any_block, take(h), 0.0)
    obs_hab = any_block & take(hab)

    sky = 1.0 - np.sin(np.radians(horizon))
    dist_score = np.log1p(d_obs / p.distance_ref_m) / np.log1p(p.max_distance_m / p.distance_ref_m)
    privacy = np.where(obs_hab & (d_obs < p.privacy_distance_m), 1.0 - d_obs / p.privacy_distance_m, 0.0)
    landmark = _landmarks(scene, obs, az, p) if scene.landmarks else np.zeros_like(d_obs)
    return ViewProfile(
        azimuth_deg=az % 360.0, horizon_deg=horizon, distance_to_obstruction_m=d_obs,
        obstruction_height_m=obs_h, obstruction_habitable=obs_hab, sky_openness=sky,
        water=np.minimum(1.0, water_span / p.water_ref_deg),
        green=np.minimum(1.0, green_span / p.water_ref_deg),
        landmark=landmark, distance_score=dist_score, privacy_penalty=privacy)


def _landmarks(scene: RasterScene, obs: np.ndarray, az: np.ndarray, p: RayParams) -> np.ndarray:
    out = np.zeros(az.shape)
    for lm in scene.landmarks:
        dx, dy = lm.x - obs[:, 0], lm.y - obs[:, 1]
        dist = np.hypot(dx, dy)
        th = (np.degrees(np.arctan2(dx, dy)) + 360.0) % 360.0
        d = sample_distances(scene.res, RayParams(max_distance_m=float(max(dist.max(), 2.0)), growth=p.growth))
        h, *_ = _march(scene, obs, th[:, None], d)
        e = np.degrees(np.arctan2(h[:, 0, :] - obs[:, 2, None], d[None, :]))
        e = np.where(d[None, :] < dist[:, None] - scene.res, e, -90.0)   # only samples in front of it
        e_top = np.degrees(np.arctan2(lm.z - obs[:, 2], dist))
        vis = e_top >= e.max(axis=1)
        diff = np.abs((az - th[:, None] + 180.0) % 360.0 - 180.0)
        out += np.where(vis[:, None] & (diff <= p.landmark_halfwidth_deg), lm.weight, 0.0)
    return np.minimum(out, 1.0)
