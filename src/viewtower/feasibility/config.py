"""Feasibility config: defaults from configs/feasibility_default.yaml, project file merged over."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from viewtower.config import deep_merge

DEFAULTS = Path(__file__).resolve().parents[3] / "configs" / "feasibility_default.yaml"

FT2_PER_M2 = 10.7639


def load(path: str | Path | None = None, override: dict | None = None) -> dict[str, Any]:
    with open(DEFAULTS, encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh)
    if path is not None:
        with open(path, encoding="utf-8") as fh:
            cfg = deep_merge(cfg, yaml.safe_load(fh) or {})
    if override:
        cfg = deep_merge(cfg, override)
    _validate(cfg)
    return cfg


def _validate(cfg: dict) -> None:
    if len(cfg["site"]["plot"]) < 3:
        raise ValueError("site.plot needs at least three vertices")
    types = cfg["units"]["types"]
    if not types:
        raise ValueError("units.types is empty")
    total = sum(t["share"] for t in types)
    if abs(total - 1.0) > 1e-6:
        raise ValueError(f"units.types shares sum to {total}, not 1")
    if cfg["fsi"]["target"] > cfg["fsi"]["cap"]:
        raise ValueError("fsi.target is above fsi.cap")
