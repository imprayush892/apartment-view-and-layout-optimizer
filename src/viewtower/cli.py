"""Command-line interface: make-synthetic | inspect-dxf | site-view | run."""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np


def _inspect(args) -> int:
    from viewtower.geometry.dxf_io import read_dxf
    from viewtower.geometry.site import Site, envelope_from_setbacks
    imp = read_dxf(args.dxf, units_to_m=args.units_to_m)
    print(f"units: 1 drawing unit = {imp.units_to_m} m ({imp.units_source})")
    for w in imp.warnings:
        print("WARNING:", w)
    cands = imp.boundary_candidates()
    if not cands:
        print("No closed polylines found.")
        return 1
    for i, c in enumerate(cands[:5]):
        print(f"[{i}] layer={c.layer} area={c.polygon.area:.1f} m2 vertices={len(c.polygon.exterior.coords) - 1}")
    site = Site.build(cands[0].polygon, boundary_is_envelope=True)
    print("\nProposed boundary [0] edges:")
    for e in site.edges():
        print(f"  E{e['edge']}: length {e['length_m']:.1f} m, runs toward {e['direction_deg']:.0f} deg")
    interactive = sys.stdin.isatty() and not args.no_prompt
    if not interactive:
        print("\nIs this the buildable envelope? If yes set `site.boundary_is_envelope: true`;"
              " otherwise set `site.boundary_is_envelope: false` and `site.edge_setbacks_m` (one value per edge above).")
        return 0
    ans = input("\nIs this the buildable envelope? [y/n] ").strip().lower()
    setbacks = None
    if ans.startswith("n"):
        setbacks = []
        for e in site.edges():
            v = input(f"  setback for E{e['edge']} ({e['length_m']:.1f} m edge) [m, default 0]: ").strip()
            setbacks.append(float(v) if v else 0.0)
        env = envelope_from_setbacks(site.boundary, setbacks)
        print(f"Envelope area {env.area:.1f} m2 (boundary {site.boundary.area:.1f} m2)")
    print("\nAdd to your config:\nsite:\n  dxf: " + args.dxf +
          f"\n  boundary_is_envelope: {str(setbacks is None).lower()}" +
          (f"\n  edge_setbacks_m: {setbacks}" if setbacks else ""))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="viewtower")
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("make-synthetic", help="write the synthetic coastal test site DXF")
    m.add_argument("out_dir")
    i = sub.add_parser("inspect-dxf", help="parse a DXF, propose the boundary, confirm envelope/setbacks")
    i.add_argument("dxf")
    i.add_argument("--units-to-m", type=float, default=None)
    i.add_argument("--no-prompt", action="store_true")
    s = sub.add_parser("site-view", help="multi-height view field of the site (before massing)")
    s.add_argument("config")
    r = sub.add_parser("run", help="full search; writes report.json, units_best.csv and plan SVGs")
    r.add_argument("config")
    r.add_argument("--out", default="out")
    args = ap.parse_args(argv)

    if args.cmd == "make-synthetic":
        from viewtower.synthetic import write
        print(write(args.out_dir))
        return 0
    if args.cmd == "inspect-dxf":
        return _inspect(args)

    from viewtower.config import load_config
    cfg = load_config(args.config)
    lim = cfg["limits"]
    if not lim.get("max_fsi_area_m2") or not lim.get("max_height_m"):
        print("limits.max_fsi_area_m2 and limits.max_height_m are required user inputs", file=sys.stderr)
        return 2
    eco = cfg["economics"]
    if args.cmd == "run" and (not eco.get("base_rate_inr_per_ft2") or not eco.get("construction_cost_inr_per_ft2")):
        print("economics.base_rate_inr_per_ft2 and economics.construction_cost_inr_per_ft2 must be set", file=sys.stderr)
        return 2
    from viewtower import pipeline
    if args.cmd == "site-view":
        p = pipeline.prepare(cfg)
        f = pipeline.compute_view_field(p)
        print(f"envelope area {p.site.envelope.area:.0f} m2, {len(f.points)} sample points")
        print(f"premium arc (water >= threshold at {max(f.heights)} m): {f.premium_arc}")
        print(f"view opening height: {f.opening_height_m} m")
        for z in f.heights:
            r = f.rose_mean[z]
            best = f.azimuths[int(np.argmax(r['quality']))]
            print(f"  z={z:>5} m  mean Q={r['quality'].mean():.3f}  mean water={r['water'].mean():.3f}"
                  f"  best azimuth={best:.0f} deg")
        return 0
    from viewtower.report import write_outputs

    def progress(k, n, ev):
        print(f"\r  evaluating {k}/{n} {ev.spec.typology:<12}", end="", file=sys.stderr, flush=True)

    out = pipeline.run(cfg, progress)
    print(file=sys.stderr)
    d = write_outputs(out, cfg, args.out)
    res = out["result"]
    print(f"run {out['run_id']}: {len(res.evaluations)} feasible, {len(res.rejected)} rejected, "
          f"{len(res.front)} on the Pareto front -> {d}")
    for ev in res.evaluations[:5]:
        m = ev.metrics
        print(f"  [{ev.rank}] {ev.candidate_id} {ev.spec.typology:<11} rot={ev.spec.rotation_deg:>4.0f} "
              f"upf={ev.spec.units_per_floor} floors={ev.spec.n_floors} GDV=₹{m['gdv_cr']:.0f}cr "
              f"prem={m['premium_units']} comp={m['compromised_units']} eff={m['efficiency']:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
