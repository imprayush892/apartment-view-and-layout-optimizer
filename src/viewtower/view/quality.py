"""Directional quality Q(theta), aperture integrals and the site-level view field."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from shapely.geometry import Polygon

from viewtower.context.scene import RasterScene
from viewtower.view.engine import RayParams, ViewProfile, cast

COMPONENTS = ("water", "distance_score", "sky_openness", "green", "landmark", "corridor")


@dataclass
class QualityWeights:
    water: float = 0.45
    distance_score: float = 0.20
    sky_openness: float = 0.15
    green: float = 0.10
    landmark: float = 0.10
    corridor: float = 0.0
    privacy_penalty: float = 0.30

    @classmethod
    def from_config(cls, cfg: dict) -> "QualityWeights":
        return cls(**{k: float(v) for k, v in cfg.items() if k in cls.__dataclass_fields__})

    def normalised(self) -> dict[str, float]:
        tot = sum(getattr(self, c) for c in COMPONENTS) or 1.0
        return {c: getattr(self, c) / tot for c in COMPONENTS}


def corridor_term(profile: ViewProfile, corridors: list[dict]) -> np.ndarray:
    """User-marked view corridors: [{'from_deg', 'to_deg', 'weight', 'min_distance_m'}]."""
    out = np.zeros_like(profile.azimuth_deg)
    for c in corridors or []:
        a0, a1 = c["from_deg"] % 360, c["to_deg"] % 360
        az = profile.azimuth_deg
        inside = (az >= a0) & (az <= a1) if a0 <= a1 else (az >= a0) | (az <= a1)
        far = profile.distance_to_obstruction_m >= c.get("min_distance_m", 100.0)
        out = np.maximum(out, np.where(inside & far, float(c.get("weight", 1.0)), 0.0))
    return out


def directional_quality(profile: ViewProfile, weights: QualityWeights, corridors=None) -> np.ndarray:
    w = weights.normalised()
    q = (w["water"] * profile.water + w["distance_score"] * profile.distance_score
         + w["sky_openness"] * profile.sky_openness + w["green"] * profile.green
         + w["landmark"] * profile.landmark + w["corridor"] * corridor_term(profile, corridors)
         - weights.privacy_penalty * profile.privacy_penalty)
    return np.clip(q, 0.0, 1.0)


def fov_offsets(half_angle_deg: float, step_deg: float) -> tuple[np.ndarray, np.ndarray]:
    off = np.arange(-half_angle_deg, half_angle_deg + 1e-9, step_deg)
    return off, np.cos(np.radians(off))


@dataclass
class ApertureResult:
    """Aperture-weighted scores per observer (N,) + medians used for classification."""
    quality: np.ndarray
    water_fraction: np.ndarray
    sky_fraction: np.ndarray
    privacy: np.ndarray
    d_obs_median: np.ndarray
    horizon_median: np.ndarray


def evaluate_apertures(scene: RasterScene, observers: np.ndarray, normals_deg: np.ndarray, params: RayParams,
                       weights: QualityWeights, view_cfg: dict) -> ApertureResult:
    off, cosw = fov_offsets(view_cfg.get("fov_half_angle_deg", 75.0), view_cfg.get("azimuth_step_deg", 2.0))
    az = (np.asarray(normals_deg)[:, None] + off[None, :]) % 360.0
    prof = cast(scene, observers, az, params)
    q = directional_quality(prof, weights, view_cfg.get("corridors"))
    wsum = cosw.sum()
    agg = lambda a: (a * cosw[None, :]).sum(axis=1) / wsum
    return ApertureResult(agg(q), agg(prof.water), agg(prof.sky_openness), agg(prof.privacy_penalty),
                          np.median(prof.distance_to_obstruction_m, axis=1), np.median(prof.horizon_deg, axis=1))


@dataclass
class SiteViewField:
    heights: list[float]
    azimuths: np.ndarray
    rose_mean: dict[float, dict[str, np.ndarray]]
    premium_arc: tuple[float, float] | None
    opening_height_m: float | None
    points: np.ndarray


def _arc(values: np.ndarray, az: np.ndarray, threshold: float) -> tuple[float, float] | None:
    """Longest contiguous (circular) run of azimuths with values >= threshold."""
    ok = values >= threshold
    if not ok.any():
        return None
    if ok.all():
        return (0.0, 360.0)
    n = len(ok)
    start = int(np.argmin(ok))            # begin scanning just after a False
    best, cur, best_end = 0, 0, 0
    for k in range(1, n + 1):
        idx = (start + k) % n
        cur = cur + 1 if ok[idx] else 0
        if cur > best:
            best, best_end = cur, idx
    step = az[1] - az[0]
    a1 = az[best_end]
    a0 = (a1 - (best - 1) * step) % 360
    return (float(a0), float(a1))


def site_view_field(scene: RasterScene, envelope: Polygon, heights: list[float], params: RayParams,
                    weights: QualityWeights, spacing_m: float = 10.0, az_step: float = 2.0,
                    arc_threshold: float = 0.5, opening_threshold: float = 0.5, corridors=None) -> SiteViewField:
    import shapely
    minx, miny, maxx, maxy = envelope.bounds
    xs = np.arange(minx + spacing_m / 2, maxx, spacing_m)
    ys = np.arange(miny + spacing_m / 2, maxy, spacing_m)
    gx, gy = np.meshgrid(xs, ys)
    inside = shapely.contains_xy(envelope, gx, gy)
    pts = np.column_stack([gx[inside], gy[inside]])
    if len(pts) == 0:
        c = envelope.representative_point()
        pts = np.array([[c.x, c.y]])
    az = np.arange(0.0, 360.0, az_step)
    rose: dict[float, dict[str, np.ndarray]] = {}
    for z in heights:
        obs = np.column_stack([pts, np.full(len(pts), z + 1.5)])
        prof = cast(scene, obs, az, params)
        q = directional_quality(prof, weights, corridors)
        rose[z] = {"quality": q.mean(0), "water": prof.water.mean(0), "sky_openness": prof.sky_openness.mean(0),
                   "distance_score": prof.distance_score.mean(0), "green": prof.green.mean(0),
                   "horizon_deg": prof.horizon_deg.mean(0), "quality_max": q.max(0)}
    top = max(heights)
    arc = _arc(rose[top]["water"], az, arc_threshold)
    opening = None
    if arc is not None:
        a0, a1 = arc
        sel = ((az >= a0) & (az <= a1)) if a0 <= a1 else ((az >= a0) | (az <= a1))
        for z in sorted(heights):
            if rose[z]["water"][sel].mean() >= opening_threshold:
                opening = z
                break
    return SiteViewField(list(heights), az, rose, arc, opening, pts)
