"""Self-contained interactive viewer: the template in viewer.html with the run's data embedded."""
from __future__ import annotations

import json
from pathlib import Path

TEMPLATE = Path(__file__).with_name("viewer.html")


def write_viewer(path: str | Path, data: dict) -> Path:
    html = TEMPLATE.read_text(encoding="utf-8")
    blob = json.dumps(data, separators=(",", ":"), default=_default).replace("</", "<\\/")
    title = data.get("title", "Feasibility options").replace("<", "&lt;")
    html = html.replace("__TITLE__", title).replace("__DATA__", blob)
    Path(path).write_text(html, encoding="utf-8")
    return Path(path)


def _default(o):
    if hasattr(o, "item"):
        return o.item()
    raise TypeError(f"not JSON serialisable: {type(o)}")
