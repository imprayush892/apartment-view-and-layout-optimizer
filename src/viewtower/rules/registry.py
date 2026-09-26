"""Rule registry: every threshold used by the engine is looked up here by rule id."""
from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

DEFAULT_RULES_PATH = Path(__file__).resolve().parents[3] / "data" / "rules" / "rules.yaml"


@dataclass
class RuleRegistry:
    rules: dict[str, dict[str, Any]]
    used: set[str] = field(default_factory=set)

    @classmethod
    def load(cls, path: str | Path | None = None, overrides: dict[str, Any] | None = None) -> "RuleRegistry":
        with open(path or DEFAULT_RULES_PATH, encoding="utf-8") as fh:
            items = yaml.safe_load(fh)
        rules = {r["id"]: r for r in items}
        for rid, value in (overrides or {}).items():
            if rid not in rules:
                raise KeyError(f"override for unknown rule {rid!r}")
            if not rules[rid].get("configurable", False):
                raise ValueError(f"rule {rid!r} is not configurable")
            default = rules[rid].get("default")
            if isinstance(default, dict) and isinstance(value, dict):
                merged = copy.deepcopy(default)
                merged.update(value)
                value = merged
            rules[rid] = {**rules[rid], "default": value}
        return cls(rules)

    def value(self, rule_id: str) -> Any:
        self.used.add(rule_id)
        return self.rules[rule_id]["default"]

    def meta(self, rule_id: str) -> dict[str, Any]:
        return self.rules[rule_id]

    def digest(self) -> str:
        blob = json.dumps(self.rules, sort_keys=True, default=str).encode()
        return hashlib.sha1(blob).hexdigest()
