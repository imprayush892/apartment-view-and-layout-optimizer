"""Unit pricing, GDV and cost (all multipliers are commercial inputs; defaults are synthetic)."""
from __future__ import annotations

import numpy as np

FT2_PER_M2 = 10.7639


def unit_rate(unit, first_saleable_level: int, eco: dict) -> float:
    rate = eco["base_rate_inr_per_ft2"]
    rate *= 1.0 + eco.get("floor_rise_pct", 0.5) / 100.0 * (unit.level - first_saleable_level)
    rate *= eco["view_class_multiplier"][unit.view_class]
    carpet_ft2 = unit.carpet_m2 * FT2_PER_M2
    for band in eco.get("size_bands", []):          # [{'min_ft2', 'max_ft2', 'multiplier'}]
        if band["min_ft2"] <= carpet_ft2 < band["max_ft2"]:
            rate *= band["multiplier"]
            break
    return rate


def price_units(units, first_saleable_level: int, eco: dict) -> None:
    for u in units:
        u.carpet_m2 = u.outline.area * eco.get("carpet_factor", 0.88)
        u.rate_inr_per_ft2 = unit_rate(u, first_saleable_level, eco)
        u.value_inr = u.rate_inr_per_ft2 * u.carpet_m2 * FT2_PER_M2


def summary(units, gross_area_m2: float, eco: dict, complexity: float) -> dict:
    gdv = float(sum(u.value_inr for u in units))
    rates = np.array([u.rate_inr_per_ft2 for u in units]) if units else np.zeros(1)
    cost = gross_area_m2 * FT2_PER_M2 * eco["construction_cost_inr_per_ft2"] * (1.0 + complexity)
    risky = sum(u.value_inr for u in units if u.view_class in ("neutral", "compromised"))
    p10, p50, p90 = np.percentile(rates, [10, 50, 90])
    return {
        "gdv_inr": gdv,
        "gdv_cr": gdv / 1e7,
        "construction_cost_inr": cost,
        "margin_before_land_inr": gdv - cost,
        "revenue_per_unit_mean_inr": gdv / max(len(units), 1),
        "rate_cv": float(rates.std() / rates.mean()) if rates.mean() else 0.0,
        "value_spread": float((p90 - p10) / p50) if p50 else 0.0,
        "inventory_risk": risky / gdv if gdv else 0.0,
    }
