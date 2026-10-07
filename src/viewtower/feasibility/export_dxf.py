"""DXF drawings (ezdxf): site plan with every regulatory ring, towers with their typical floors,
enlarged typical floor plates and an area statement. Metres, true north up."""
from __future__ import annotations

from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment
from shapely.geometry import Polygon

from viewtower.feasibility.config import FT2_PER_M2
from viewtower.feasibility.export import rings
from viewtower.feasibility.search import Scheme, unit_table
from viewtower.feasibility.site import FeasibilitySite, setback_for_height

# layer -> (ACI colour, linetype)
LAYERS = {
    "A-PLOT-GROSS": (7, "CONTINUOUS"), "A-ROAD-WIDENING": (1, "CONTINUOUS"), "A-PLOT-NET": (7, "DASHED"),
    "A-OSR": (3, "CONTINUOUS"), "A-EIA-GREEN": (82, "CONTINUOUS"), "A-DRIVEWAY": (8, "CONTINUOUS"),
    "A-VISITOR-PARKING": (5, "CONTINUOUS"), "A-PODIUM-P1": (30, "CONTINUOUS"), "A-PODIUM-P2": (40, "CONTINUOUS"),
    "A-BASEMENT": (9, "DASHED"), "A-SETBACK": (1, "DASHED"), "A-TOWER": (7, "CONTINUOUS"),
    "A-CORE": (250, "CONTINUOUS"), "A-LOBBY": (9, "CONTINUOUS"), "A-DOOR": (6, "CONTINUOUS"),
    "A-TEXT": (7, "CONTINUOUS"), "A-TABLE": (7, "CONTINUOUS"), "A-NORTH": (7, "CONTINUOUS"),
}
UNIT_ACI = {"U1": 41, "U2": 51, "U3": 131, "U4": 171, "U5": 211}
HATCH = {"A-ROAD-WIDENING": ("ANSI31", 1, 1.0), "A-OSR": ("SOLID", 3, None), "A-EIA-GREEN": ("SOLID", 82, None),
         "A-VISITOR-PARKING": ("SOLID", 5, None)}


def _doc():
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 6
    for name, (aci, lt) in LAYERS.items():
        doc.layers.add(name, color=aci, linetype=lt)
    for u, aci in UNIT_ACI.items():
        doc.layers.add(f"A-UNIT-{u}", color=aci)
    return doc


def _poly(msp, geom, layer, dx=0.0, dy=0.0, hatch=False, elevation=0.0, thickness=0.0):
    for r in rings(geom, 3):
        pts = [(x + dx, y + dy) for x, y in r]
        msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": layer, "elevation": elevation, "thickness": thickness})
        if hatch and layer in HATCH:
            pat, col, scale = HATCH[layer]
            h = msp.add_hatch(color=col, dxfattribs={"layer": layer})
            if pat != "SOLID":
                h.set_pattern_fill(pat, scale=scale)
            h.paths.add_polyline_path(pts, is_closed=True)
            if pat == "SOLID":
                h.dxf.transparency = 0x02000000 | 160  # ~63 % transparent


def _text(msp, s, x, y, h=1.2, layer="A-TEXT", align=TextEntityAlignment.MIDDLE_CENTER, rot=0.0):
    t = msp.add_text(s, height=h, dxfattribs={"layer": layer, "rotation": rot})
    t.set_placement((x, y), align=align)
    return t


def _plate(msp, plate, dx, dy, detail=True, unit_label=None, text_h=0.9):
    for f in plate.flats:
        _poly(msp, f.poly, f"A-UNIT-{f.unit}", dx, dy)
        (a, b) = f.door
        msp.add_line((a[0] + dx, a[1] + dy), (b[0] + dx, b[1] + dy), dxfattribs={"layer": "A-DOOR", "lineweight": 50})
        if detail:
            c = f.poly.representative_point()
            lines = unit_label(f) if unit_label else [f.unit]
            for i, s in enumerate(lines):
                _text(msp, s, c.x + dx, c.y + dy + (len(lines) / 2 - i - 0.5) * text_h * 1.5, text_h)
            # facing arrow: from the door towards the facing direction
            mx, my = (a[0] + b[0]) / 2 + dx, (a[1] + b[1]) / 2 + dy
            vx, vy = {"N": (0, 1), "E": (1, 0), "S": (0, -1), "W": (-1, 0)}[f.door_dir]
            msp.add_line((mx, my), (mx + 1.6 * vx, my + 1.6 * vy), dxfattribs={"layer": "A-DOOR"})
            msp.add_solid([(mx + 2.2 * vx, my + 2.2 * vy), (mx + 1.4 * vx - 0.5 * vy, my + 1.4 * vy + 0.5 * vx),
                           (mx + 1.4 * vx + 0.5 * vy, my + 1.4 * vy - 0.5 * vx)], dxfattribs={"layer": "A-DOOR"})
    for c in plate.core:
        _poly(msp, c, "A-CORE", dx, dy)
        if detail:
            cc = c.representative_point()
            _text(msp, "CORE", cc.x + dx, cc.y + dy, text_h * 0.8, "A-CORE")
    _poly(msp, plate.lobby, "A-LOBBY", dx, dy)
    _poly(msp, plate.footprint, "A-TOWER", dx, dy)


def write_scheme_dxf(path: str | Path, scheme: Scheme, site: FeasibilitySite, cfg: dict, title: str = "") -> Path:
    doc = _doc()
    msp = doc.modelspace()
    b = cfg["building"]
    units = {u["id"]: u for u in unit_table(cfg)}

    # ---------------- site plan (model space origin = site origin)
    _poly(msp, site.gross, "A-PLOT-GROSS")
    _poly(msp, site.widening, "A-ROAD-WIDENING", hatch=True)
    _poly(msp, site.net, "A-PLOT-NET")
    _poly(msp, site.osr, "A-OSR", hatch=True)
    _poly(msp, site.green, "A-EIA-GREEN", hatch=True)
    _poly(msp, site.driveway, "A-DRIVEWAY")
    _poly(msp, site.basement_env, "A-BASEMENT")
    for g, pod in enumerate(scheme.layout.podiums):
        _poly(msp, pod, f"A-PODIUM-P{g + 1}", thickness=float(b["podium_height_m"]))
    for v in scheme.layout.visitor_strips:
        _poly(msp, v, "A-VISITOR-PARKING", hatch=True)
    seen_sb = set()
    for t in scheme.towers:
        s = setback_for_height(t.height(b), cfg["setbacks"])
        if s not in seen_sb:
            seen_sb.add(s)
            _poly(msp, site.tower_envelope(t.height(b)), "A-SETBACK")
    for t in scheme.towers:
        _plate(msp, t.plate, t.x, t.y, detail=False)
        c = t.footprint().centroid
        _text(msp, t.name, c.x, c.y + 2.0, 3.0)
        _text(msp, f"{t.plate.variant} {t.floors}F {t.height(b):.1f} m", c.x, c.y - 2.0, 1.6)
        _text(msp, f"setback {setback_for_height(t.height(b), cfg['setbacks']):.0f} m | P{t.podium + 1}",
              c.x, c.y - 4.2, 1.3)
    gb = site.gross.bounds
    # labels, north arrow, scale bar
    osr_c = site.osr.representative_point() if not site.osr.is_empty else None
    if osr_c:
        _text(msp, f"OSR {site.osr.area:,.0f} m2", osr_c.x, osr_c.y, 2.0, rot=90)
    fr = site.widening_line.interpolate(0.5, normalized=True)
    _text(msp, f"{cfg['site'].get('front_road') or 'Road'} (road-widening line)", fr.x, fr.y + 6, 2.2)
    if cfg["site"].get("rear_road"):
        _text(msp, cfg["site"]["rear_road"], (gb[0] + gb[2]) / 2 - 15, gb[1] - 6, 2.2)
    nx, ny = gb[2] + 12, gb[3] - 10
    msp.add_lwpolyline([(nx - 2.5, ny - 4), (nx, ny + 4), (nx + 2.5, ny - 4), (nx, ny - 2)], close=True,
                       dxfattribs={"layer": "A-NORTH"})
    _text(msp, "N", nx, ny + 6.5, 3.0, "A-NORTH")
    sx, sy = gb[0], gb[1] - 16
    for i in range(5):
        msp.add_lwpolyline([(sx + i * 10, sy), (sx + (i + 1) * 10, sy), (sx + (i + 1) * 10, sy + 1), (sx + i * 10, sy + 1)],
                           close=True, dxfattribs={"layer": "A-TEXT"})
        _text(msp, f"{i * 10}", sx + i * 10, sy - 2, 1.2)
    _text(msp, "50 m", sx + 50, sy - 2, 1.2)
    _text(msp, title or f"{scheme.scenario} / {scheme.mode}", gb[0], gb[3] + 22, 3.0, align=TextEntityAlignment.LEFT)

    # ---------------- typical floor plates, enlarged copies to the right of the site
    def label(f):
        u = units[f.unit]
        return [f"{f.unit} {u['label']}", f"carpet {u['carpet_ft2']:,} ft2", f"SBU {u['sbu_ft2']:,.0f} ft2",
                f"door faces {f.door_dir}"]

    ox = gb[2] + 40
    plates = []
    for t in scheme.towers:
        if t.plate.key not in [p.key for p in plates]:
            plates.append(t.plate)
    oy = gb[3] - 10
    for p in plates:
        fb = p.footprint.bounds
        dx, dy = ox - fb[0], oy - fb[3]
        _plate(msp, p, dx, dy, detail=True, unit_label=label, text_h=0.7)
        towers = ", ".join(t.name for t in scheme.towers if t.plate.key == p.key)
        _text(msp, f"Typical floor {p.variant} ({towers})", ox, oy + 3, 1.8, align=TextEntityAlignment.LEFT)
        fac = p.facing()
        _text(msp, f"{p.width:.1f} x {p.depth:.1f} m | plate {p.area_m2:,.0f} m2 | core+lobby {p.circulation_m2:,.0f} m2"
                   f" | doors N{fac['N']} E{fac['E']} S{fac['S']} W{fac['W']}",
              ox, oy + 0.8, 1.1, align=TextEntityAlignment.LEFT)
        oy -= (fb[3] - fb[1]) + 14

    # ---------------- area statement
    m = scheme.metrics
    pk = m.get("parking", {})
    lines = [
        f"{title}",
        f"Net plot (FSI basis) {site.net.area:,.0f} m2 | FSI {m['fsi']:.3f} = {m['fsi_m2']:,.0f} m2 (cap {cfg['fsi']['cap']})",
        f"Flats {m['flats']} | carpet {m['carpet_ft2']:,} ft2 | SBU (x{cfg['units']['loading']}) {m['sbu_ft2']:,} ft2",
        "Mix: " + "  ".join(f"{u} {m['mix_counts'][u]} ({m['mix_shares'][u] * 100:.1f}%)" for u in m["mix_counts"]),
        f"Door facing: N {m['facing']['N']}  E {m['facing']['E']}  S {m['facing']['S']}  W {m['facing']['W']}",
        f"Cars: demand {pk.get('demand')} supply {pk.get('supply')} (basement {pk.get('basement')} GF {pk.get('gf')}"
        f" stilt-1 {pk.get('s1')}) | visitor bays {pk.get('visitor_bays')}/{pk.get('visitor_need')}",
        f"EIA green {site.green.area:,.0f} m2 ({site.green.area / site.net.area * 100:.1f}%, {site.green_width_m:.2f} m belt)"
        f" | OSR {site.osr.area:,.0f} m2 | road widening {site.widening.area:,.0f} m2",
    ]
    for t in scheme.towers:
        fb = t.flats_by_type(b)
        lines.append(f"{t.name} P{t.podium + 1} {t.segment}: {t.plate.variant} {t.floors}F {t.height(b):.1f} m, "
                     f"{t.n_flats(b)} flats ({', '.join(f'{u}x{n}' for u, n in fb.items() if n)}), refuge floors {t.refuges(b)}")
    mt = msp.add_mtext("\\P".join(lines), dxfattribs={"layer": "A-TABLE", "char_height": 1.4})
    mt.set_location((gb[0], gb[1] - 26))
    doc.saveas(str(path))
    return Path(path)
