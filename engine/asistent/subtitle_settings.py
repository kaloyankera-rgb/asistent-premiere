"""The subtitle choice the editor makes once per project: the corrections and names text (corrections.py). Kept in the app folder, keyed by the project file, so the panel shows them again."""
from __future__ import annotations

import json
import os
import threading

from . import config, corrections

_lock = threading.Lock()


def _path() -> str:
    return os.path.join(config.app_dir(), "subtitle_settings.json")


def _key(project: str) -> str:
    return os.path.normcase(project or "")


def _load() -> dict:
    try:
        with open(_path(), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def get(project: str) -> dict:
    with _lock:
        s = _load().get(_key(project)) or {}
    return {"text": s.get("text", "")}


def put(project: str, text: str) -> dict:
    if not project:
        raise ValueError("Липсва проект.")
    if not isinstance(text, str) or len(text) > corrections.MAX_TEXT:
        raise ValueError("Невалиден текст с корекции и термини.")
    with _lock:
        data = _load()
        data[_key(project)] = {"text": text}
        tmp = _path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, _path())
    return {"text": text, "errors": corrections.parse(text)["errors"]}
