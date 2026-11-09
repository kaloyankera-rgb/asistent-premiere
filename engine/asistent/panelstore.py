"""The panel's own settings, kept in the engine's app folder (`<app>/panel_store.json`) so a panel update cannot lose them.

The panel used UXP localStorage, which lives with the installed panel: Adobe's installer deletes it with the panel, and every
update removes the old panel (0.10.10; before 0.10.6 too), so the Style choice, the English line switch, the English lines
an editor typed per project and Move off faces' own positions were lost at each update (found 2026-11-09). Keys are the
panel's own ("asistent.…"), values strings; written atomically under one lock.
"""
from __future__ import annotations

import json
import os
import threading

from . import config

MAX_VALUE = 200_000
MAX_TOTAL = 5_000_000
_lock = threading.Lock()


def _path() -> str:
    return os.path.join(config.app_dir(), "panel_store.json")


def _read() -> dict:
    try:
        with open(_path(), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def get_all() -> dict:
    with _lock:
        return _read()


def put(key: str, value: str | None) -> dict:
    if not isinstance(key, str) or not key.startswith("asistent.") or len(key) > 600:
        raise ValueError("Invalid panel setting.")
    if value is not None and (not isinstance(value, str) or len(value) > MAX_VALUE):
        raise ValueError("Invalid panel setting value.")
    with _lock:
        data = _read()
        if value is None:
            data.pop(key, None)
        else:
            data[key] = value
        text = json.dumps(data, ensure_ascii=False, indent=0, sort_keys=True)
        if len(text) > MAX_TOTAL:
            raise ValueError("The panel's settings are too large.")
        tmp = _path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, _path())
    return {"ok": True}
