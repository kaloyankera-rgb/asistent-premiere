"""The subtitle choices the editor makes once per project: the corrections and names text (corrections.py) and who speaks
on which microphone track ({"0": "m"|"f"|""}, Captions tab). Kept in the app folder, keyed by the project file, so the panel
shows them again."""
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
    return {"text": s.get("text", ""), "speakers": s.get("speakers", {})}


def put(project: str, text: str) -> dict:
    if not project:
        raise ValueError("The project is missing.")
    if not isinstance(text, str) or len(text) > corrections.MAX_TEXT:
        raise ValueError("Invalid text of corrections and terms.")
    _update(project, text=text)
    return {"text": text, "errors": corrections.parse(text)["errors"]}


SPEAKER = ("m", "f", "")


def put_speakers(project: str, speakers) -> dict:
    """{track index: "m" | "f" | ""} ("" = both or not known: nothing is changed on that track)."""
    if not project:
        raise ValueError("The project is missing.")
    if not isinstance(speakers, dict) or len(speakers) > 64 or not all(
            isinstance(k, str) and k.isdigit() and v in SPEAKER for k, v in speakers.items()):
        raise ValueError("Invalid speakers.")
    _update(project, speakers=dict(speakers))
    return {"speakers": speakers}


def _update(project: str, **fields) -> None:
    with _lock:
        data = _load()
        data[_key(project)] = {**(data.get(_key(project)) or {}), **fields}
        tmp = _path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, _path())
