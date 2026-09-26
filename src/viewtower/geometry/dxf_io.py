"""DXF ingestion and synthetic DXF writing (ezdxf).

Layer conventions (case-insensitive substring match, configurable):
  SITE / BOUNDARY  -> site boundary (closed polyline)
  ENVELOPE         -> buildable envelope (optional)
  CONTEXT / BLDG   -> context buildings; height = entity thickness, base = elevation
  WATER / SEA      -> water polygons
  PARK / GREEN     -> parks / open green
Closed LWPOLYLINE, POLYLINE and bulge arcs are supported (arcs flattened to 5 cm).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import ezdxf
from ezdxf import path as ezpath
from shapely.geometry import Polygon

# $INSUNITS code -> metres per drawing unit
INSUNITS_TO_M = {0: None, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0, 14: 0.1}

DEFAULT_LAYER_MAP = {
    "boundary": ["SITE", "BOUNDARY", "PLOT"],
    "envelope": ["ENVELOPE", "BUILDABLE"],
    "context": ["CONTEXT", "BLDG", "BUILDING"],
    "water": ["WATER", "SEA"],
    "park": ["PARK", "GREEN"],
}


@dataclass
class DxfPolygon:
    layer: str
    polygon: Polygon
    base_z: float = 0.0
    height: float = 0.0


@dataclass
class DxfImport:
    units_to_m: float
    units_source: str
    by_role: dict[str, list[DxfPolygon]] = field(default_factory=dict)
    unassigned: list[DxfPolygon] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def boundary_candidates(self) -> list[DxfPolygon]:
        """Proposed boundaries, most likely first — the user must confirm one."""
        cands = self.by_role.get("boundary", []) or sorted(self.unassigned, key=lambda p: -p.polygon.area)
        return sorted(cands, key=lambda p: -p.polygon.area)


def _role(layer: str, layer_map: dict[str, list[str]]) -> str | None:
    up = layer.upper()
    # envelope before boundary so "BUILDABLE_BOUNDARY" is an envelope
    for role in ("envelope", "boundary", "context", "water", "park"):
        if any(tok in up for tok in layer_map.get(role, [])):
            return role
    return None


def read_dxf(path: str | Path, *, units_to_m: float | None = None,
             layer_map: dict[str, list[str]] | None = None) -> DxfImport:
    doc = ezdxf.readfile(str(path))
    layer_map = layer_map or DEFAULT_LAYER_MAP
    warnings: list[str] = []
    code = int(doc.header.get("$INSUNITS", 0))
    if units_to_m is not None:
        scale, source = units_to_m, "user"
    elif INSUNITS_TO_M.get(code):
        scale, source = INSUNITS_TO_M[code], f"$INSUNITS={code}"
    else:
        scale, source = 1.0, "assumed metres"
        warnings.append("DXF has no $INSUNITS; assuming metres — please confirm units")
    result = DxfImport(scale, source, warnings=warnings)
    for e in doc.modelspace().query("LWPOLYLINE POLYLINE"):
        if not e.is_closed:
            continue
        pts = [(v.x * scale, v.y * scale) for v in ezpath.make_path(e).flattening(0.05 / scale)]
        if len(pts) >= 2 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 3:
            continue
        poly = Polygon(pts)
        if not poly.is_valid or poly.area <= 0:
            result.warnings.append(f"skipped invalid polygon on layer {e.dxf.layer}")
            continue
        elev = e.dxf.elevation if e.dxftype() == "LWPOLYLINE" else e.dxf.elevation.z
        item = DxfPolygon(e.dxf.layer, poly, float(elev) * scale, float(e.dxf.get("thickness", 0.0)) * scale)
        role = _role(e.dxf.layer, layer_map)
        (result.by_role.setdefault(role, []) if role else result.unassigned).append(item)
    return result


def write_dxf(path: str | Path, layers: dict[str, list[dict]]) -> None:
    """Write closed polylines. ``layers`` maps layer -> [{'coords': [...], 'height': h, 'base': z}]."""
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 6  # metres
    msp = doc.modelspace()
    for layer in sorted(layers):
        if layer not in doc.layers:
            doc.layers.add(layer)
        for item in layers[layer]:
            attribs = {"layer": layer, "elevation": float(item.get("base", 0.0)),
                       "thickness": float(item.get("height", 0.0))}
            msp.add_lwpolyline([tuple(map(float, c)) for c in item["coords"]], close=True, dxfattribs=attribs)
    doc.saveas(str(path))
