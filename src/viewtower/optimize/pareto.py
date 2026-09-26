"""Deterministic non-dominated sorting and presentation order."""
from __future__ import annotations

import numpy as np


def nondominated_ranks(values: np.ndarray, senses: list[str]) -> np.ndarray:
    """values (n, m); senses 'max'/'min' per column. Returns rank per row (0 = Pareto front)."""
    n = len(values)
    if n == 0:
        return np.zeros(0, int)
    v = values * np.array([1.0 if s == "max" else -1.0 for s in senses])[None, :]
    ge = (v[:, None, :] >= v[None, :, :] - 1e-12).all(axis=2)
    gt = (v[:, None, :] > v[None, :, :] + 1e-12).any(axis=2)
    dom = ge & gt                                   # dom[i, j]: i dominates j
    ranks = np.full(n, -1)
    remaining = np.ones(n, bool)
    r = 0
    while remaining.any():
        dominated = (dom[remaining][:, remaining]).any(axis=0)
        idx = np.flatnonzero(remaining)[~dominated]
        ranks[idx] = r
        remaining[idx] = False
        r += 1
    return ranks


def presentation_key(metrics: dict, priority: list[dict], candidate_id: str):
    """Lexicographic key from [{'metric', 'sense', 'equals'?}] — ties broken by candidate id."""
    key = []
    for p in priority:
        val = metrics.get(p["metric"], 0.0)
        if "equals" in p:
            key.append(0 if val == p["equals"] else 1)
        else:
            key.append(-val if p.get("sense", "max") == "max" else val)
    return tuple(key) + (candidate_id,)
