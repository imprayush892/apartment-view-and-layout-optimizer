"""Configuration loading and canonical hashing."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import yaml

DEFAULT_CONFIG = Path(__file__).resolve().parents[2] / "configs" / "default.yaml"


def deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for key, val in override.items():
        if isinstance(val, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], val)
        else:
            out[key] = copy.deepcopy(val)
    return out


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    """Load default.yaml, then deep-merge the given config over it.

    Relative paths inside the config (``site.dxf``, ``site.context``) are resolved
    against the config file's directory.
    """
    with open(DEFAULT_CONFIG, encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh)
    if path is not None:
        path = Path(path)
        with open(path, encoding="utf-8") as fh:
            cfg = deep_merge(cfg, yaml.safe_load(fh) or {})
        for key in ("dxf", "context"):
            val = cfg.get("site", {}).get(key)
            if val and not Path(val).is_absolute():
                cfg["site"][key] = str((path.parent / val).resolve())
    return cfg


def canonical(obj: Any) -> Any:
    """Round floats so hashes are stable across platforms."""
    if isinstance(obj, float):
        return round(obj, 6)
    if isinstance(obj, dict):
        return {str(k): canonical(v) for k, v in sorted(obj.items(), key=lambda kv: str(kv[0]))}
    if isinstance(obj, (list, tuple)):
        return [canonical(v) for v in obj]
    return obj


def stable_hash(obj: Any, n: int = 12) -> str:
    blob = json.dumps(canonical(obj), sort_keys=True, default=str).encode()
    return hashlib.sha1(blob).hexdigest()[:n]
