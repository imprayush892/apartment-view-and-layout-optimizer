import ezdxf
import pytest

from viewtower.geometry.dxf_io import read_dxf, write_dxf
from viewtower.synthetic import BOUNDARY


def test_synthetic_roundtrip(synthetic_dxf):
    imp = read_dxf(synthetic_dxf)
    assert imp.units_to_m == 1.0 and imp.units_source == "$INSUNITS=6"
    b = imp.boundary_candidates()[0]
    assert b.polygon.symmetric_difference(BOUNDARY).area < 1e-6
    ctx = imp.by_role["context"]
    assert len(ctx) > 50 and all(c.height > 0 for c in ctx)
    assert any(c.layer == "CONTEXT_FUTURE" for c in ctx)
    assert imp.by_role["water"] and imp.by_role["park"]


def test_millimetre_drawing_scaled(tmp_path):
    p = tmp_path / "mm.dxf"
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 4
    doc.modelspace().add_lwpolyline([(0, 0), (40000, 0), (40000, 30000), (0, 30000)], close=True,
                                    dxfattribs={"layer": "SITE"})
    doc.saveas(p)
    imp = read_dxf(p)
    assert imp.boundary_candidates()[0].polygon.area == pytest.approx(1200.0)


def test_missing_units_warns_and_unassigned_layers_proposed(tmp_path):
    p = tmp_path / "nounits.dxf"
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 0
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (10, 0), (10, 10), (0, 10)], close=True, dxfattribs={"layer": "A"})
    msp.add_lwpolyline([(0, 0), (50, 0), (50, 50), (0, 50)], close=True, dxfattribs={"layer": "B"})
    msp.add_lwpolyline([(0, 0), (5, 0), (5, 5)], close=False)
    doc.saveas(p)
    imp = read_dxf(p)
    assert imp.warnings
    assert [c.layer for c in imp.boundary_candidates()] == ["B", "A"]    # largest first, open ignored


def test_bulge_arcs_are_flattened(tmp_path):
    p = tmp_path / "arc.dxf"
    write_dxf(p, {"SITE": [{"coords": [(0, 0), (10, 0), (10, 10), (0, 10)]}]})
    doc = ezdxf.readfile(p)
    doc.modelspace().add_lwpolyline([(0, 0, 0, 0, -1), (20, 0, 0, 0, 0), (20, -1, 0, 0, 0), (0, -1, 0, 0, 0)], format="xyseb",
                                    close=True, dxfattribs={"layer": "PARK"})
    doc.saveas(p)
    park = read_dxf(p).by_role["park"][0].polygon
    assert park.area > 20 * 1 + 100      # semicircle of radius 10 adds ~157 m2
