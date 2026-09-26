"""Context model and its 2.5-D raster representation used by the view engine."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import shapely
from shapely.geometry import Polygon


@dataclass
class ContextBuilding:
    id: str
    footprint: Polygon
    height_m: float
    base_z: float = 0.0
    scenario: str = "existing"          # existing | future
    habitable: bool = True
    height_source: str = "survey"


@dataclass
class Landmark:
    id: str
    x: float
    y: float
    z: float
    weight: float = 1.0


@dataclass
class Context:
    buildings: list[ContextBuilding] = field(default_factory=list)
    water: list[Polygon] = field(default_factory=list)
    parks: list[Polygon] = field(default_factory=list)
    landmarks: list[Landmark] = field(default_factory=list)

    def for_scenario(self, scenario: str) -> "Context":
        """'existing' -> existing only; 'future' -> existing + future buildings."""
        keep = {"existing"} if scenario == "existing" else {"existing", "future"}
        return Context([b for b in self.buildings if b.scenario in keep], self.water, self.parks, self.landmarks)


@dataclass
class RasterScene:
    """Regular grid; cell (i, j) centre = (x0 + (j + .5) r, y0 + (i + .5) r)."""
    x0: float
    y0: float
    res: float
    height: np.ndarray       # float32, surface height above datum
    water: np.ndarray        # bool
    green: np.ndarray        # bool
    habitable: np.ndarray    # bool
    landmarks: list[Landmark] = field(default_factory=list)

    @property
    def shape(self) -> tuple[int, int]:
        return self.height.shape

    def cell_centres(self):
        ny, nx = self.shape
        xs = self.x0 + (np.arange(nx) + 0.5) * self.res
        ys = self.y0 + (np.arange(ny) + 0.5) * self.res
        return xs, ys

    def indices(self, x: np.ndarray, y: np.ndarray):
        j = np.floor((x - self.x0) / self.res).astype(np.int64)
        i = np.floor((y - self.y0) / self.res).astype(np.int64)
        ny, nx = self.shape
        inside = (i >= 0) & (i < ny) & (j >= 0) & (j < nx)
        return i, j, inside

    def with_prism(self, polygon: Polygon, top_z: float, habitable: bool = True) -> "RasterScene":
        """Copy of the scene with an extruded polygon burned in (candidate's own massing)."""
        h = self.height.copy()
        hab = self.habitable.copy() if habitable else self.habitable
        _burn(polygon, top_z, self, h, hab if habitable else None)
        return RasterScene(self.x0, self.y0, self.res, h, self.water, self.green, hab, self.landmarks)


def _window(poly: Polygon, scene: RasterScene):
    minx, miny, maxx, maxy = poly.bounds
    ny, nx = scene.shape
    j0 = max(0, int(np.floor((minx - scene.x0) / scene.res)))
    j1 = min(nx, int(np.ceil((maxx - scene.x0) / scene.res)) + 1)
    i0 = max(0, int(np.floor((miny - scene.y0) / scene.res)))
    i1 = min(ny, int(np.ceil((maxy - scene.y0) / scene.res)) + 1)
    if i0 >= i1 or j0 >= j1:
        return None
    xs = scene.x0 + (np.arange(j0, j1) + 0.5) * scene.res
    ys = scene.y0 + (np.arange(i0, i1) + 0.5) * scene.res
    gx, gy = np.meshgrid(xs, ys)
    mask = shapely.contains_xy(poly, gx, gy)
    return (slice(i0, i1), slice(j0, j1)), mask


def _burn(poly: Polygon, top_z: float, scene: RasterScene, height: np.ndarray, habitable: np.ndarray | None):
    w = _window(poly, scene)
    if w is None:
        return
    sl, mask = w
    block = height[sl]
    block[mask] = np.maximum(block[mask], top_z)
    if habitable is not None:
        habitable[sl][mask] = True


def rasterize(context: Context, bounds: tuple[float, float, float, float], res: float) -> RasterScene:
    minx, miny, maxx, maxy = bounds
    nx = int(np.ceil((maxx - minx) / res))
    ny = int(np.ceil((maxy - miny) / res))
    scene = RasterScene(minx, miny, res,
                        np.zeros((ny, nx), np.float32), np.zeros((ny, nx), bool),
                        np.zeros((ny, nx), bool), np.zeros((ny, nx), bool), list(context.landmarks))
    for masks, polys in ((scene.water, context.water), (scene.green, context.parks)):
        for poly in polys:
            w = _window(poly, scene)
            if w is not None:
                masks[w[0]] |= w[1]
    for b in sorted(context.buildings, key=lambda b: b.id):
        _burn(b.footprint, b.base_z + b.height_m, scene, scene.height,
              scene.habitable if b.habitable else None)
    # a building standing in water hides the water under it
    scene.water &= scene.height <= 0
    scene.green &= scene.height <= 0
    return scene
