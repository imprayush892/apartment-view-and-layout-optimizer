"""View classes and compromised inventory (docs/spec/08_compromised_inventory.md)."""
from __future__ import annotations

from viewtower.rules.registry import RuleRegistry
from viewtower.units.subdivide import Unit

CLASSES = ("premium", "good", "neutral", "compromised")


def classify(unit: Unit, rules: RuleRegistry) -> tuple[str, list[str], float]:
    """Return (class, reasons, margin). ``margin`` = smallest normalised slack to any compromised
    threshold (negative => compromised); used to report robustness."""
    comp = rules.value("VC-COMPROMISED")
    lr = unit.room("living")
    if lr is None:
        return "compromised", ["VC-COMPROMISED:no living-room frontage"], -1.0
    privacy = max(r.privacy for r in unit.rooms if r.room != "kitchen_service") if unit.rooms else 0.0
    checks = [
        ("view_score", lr.view_score, comp["q_lr_min"], +1),
        ("d_obs_median", lr.d_obs_median, comp["d_min"], +1),
        ("horizon_median", lr.horizon_median, comp["alpha_max"], -1),
        ("privacy", privacy, comp["p_max"], -1),
    ]
    reasons, margins = [], []
    for name, val, thr, sense in checks:
        slack = (val - thr) / max(abs(thr), 1e-9) * sense
        margins.append(slack)
        if slack < 0:
            op = "<" if sense > 0 else ">"
            reasons.append(f"VC-COMPROMISED:{name}={val:.3g}{op}{thr}")
    margin = min(margins)
    if reasons:
        return "compromised", reasons, margin
    prem, bp = rules.value("VC-LR-PREMIUM"), rules.value("VC-BR-PREMIUM")
    beds = unit.bedrooms
    n_need = min(bp["n_min"], len(beds))
    n_ok = sum(b.water_fraction >= bp["w_min"] for b in beds)
    if lr.water_fraction >= prem["w_min"] and lr.view_score >= prem["q_min"] and n_ok >= n_need:
        return "premium", [f"VC-LR-PREMIUM:water={lr.water_fraction:.2f},q={lr.view_score:.2f}",
                           f"VC-BR-PREMIUM:{n_ok}/{len(beds)} bedrooms with water"], margin
    good = rules.value("VC-GOOD")
    if lr.view_score >= good["q_min"]:
        why = []
        if lr.water_fraction < prem["w_min"]:
            why.append(f"living water {lr.water_fraction:.2f}<{prem['w_min']}")
        if lr.view_score < prem["q_min"]:
            why.append(f"living q {lr.view_score:.2f}<{prem['q_min']}")
        if n_ok < n_need:
            why.append(f"{n_ok}/{n_need} bedrooms with water")
        return "good", ["VC-GOOD:not premium because " + "; ".join(why)], margin
    return "neutral", [f"VC-GOOD:living q {lr.view_score:.2f}<{good['q_min']}"], margin
