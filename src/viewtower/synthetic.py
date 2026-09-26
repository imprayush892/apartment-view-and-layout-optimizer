"""Synthetic coastal test site — fictitious geometry, no real location or project data.

Loosely mimics the *kind* of situation in the reference brief (sea to the west with a ~120 deg
open arc, a large park to the north, a low-rise coastal band, a few tall neighbours) so the
engine can be exercised end-to-end. Nothing here is derived from a real plot.
"""
from __future__ import annotations

from pathlib import Path

from shapely.geometry import Polygon, box

from viewtower.context.scene import Context, ContextBuilding, Landmark
from viewtower.geometry.dxf_io import write_dxf

BOUNDARY = Polygon([(-35, -28), (36, -30), (38, 31), (-33, 29)])
SEA = Polygon([(-260, -400), (-260, 800), (-600, 3200), (-3200, 3200), (-3200, -1200), (-1200, -900), (-500, -500)])
PARK = box(-80, 90, 180, 330)
LANDMARKS = [Landmark("LM-BRIDGE-PYLON", -1400.0, 1800.0, 126.0, 0.5)]


def _free(poly: Polygon, taken: list[Polygon]) -> bool:
    return not SEA.intersects(poly) and not PARK.intersects(poly) and all(not t.buffer(8).intersects(poly) for t in taken)


def context() -> Context:
    specials = [
        ContextBuilding("B-SLAB-S", box(-30, -75, 40, -50), 48.0),            # close slab to the south
        ContextBuilding("B-TWR-NE", box(90, 40, 125, 75), 110.0),             # tall neighbour NE
        ContextBuilding("B-TWR-SW", box(-200, -230, -170, -200), 130.0),      # tower inside the sea arc
        ContextBuilding("B-FUT-NW", box(-120, 40, -85, 75), 150.0, scenario="future"),
    ]
    taken = [BOUNDARY.buffer(10)] + [b.footprint for b in specials]
    fabric = []
    # coastal low-rise band (15-24 m) between the sea and the plot
    for i, x in enumerate(range(-250, -60, 42)):
        for j, y in enumerate(range(-380, 780, 52)):
            fp = box(x, y, x + 30, y + 40)
            if _free(fp, taken):
                fabric.append(ContextBuilding(f"B-C{i:02d}{j:02d}", fp, 15.0 + 3.0 * ((i * 7 + j * 3) % 4)))
    # urban fabric inland (18-45 m)
    for i, x in enumerate(range(-40, 900, 48)):
        for j, y in enumerate(range(-900, 900, 48)):
            fp = box(x, y, x + 34, y + 34)
            if x < 60 and -60 < y < 90:
                continue
            if _free(fp, taken):
                fabric.append(ContextBuilding(f"B-U{i:02d}{j:02d}", fp, 18.0 + 3.0 * ((i * 5 + j * 11) % 10)))
    return Context(specials + fabric, [SEA], [PARK], list(LANDMARKS))


def write(out_dir: str | Path) -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    ctx = context()
    coords = lambda p: list(p.exterior.coords)[:-1]
    layers = {
        "SITE_BOUNDARY": [{"coords": coords(BOUNDARY)}],
        "WATER_SEA": [{"coords": coords(SEA)}],
        "PARK_GREEN": [{"coords": coords(PARK)}],
        "CONTEXT_EXISTING": [], "CONTEXT_FUTURE": [],
    }
    for b in ctx.buildings:
        layers["CONTEXT_FUTURE" if b.scenario == "future" else "CONTEXT_EXISTING"].append(
            {"coords": coords(b.footprint), "height": b.height_m, "base": b.base_z})
    path = out / "synthetic_coastal_site.dxf"
    write_dxf(path, layers)
    return path
