"""Which caption track Asistent put on which sequence (so a second press does not stack a second copy).

The track items of an SRT do not point back to the file (`getProjectItem()` is null), and Asistent never removes or
mutes tracks on the user's behalf, so the only way to tell its own track from the user's is a signature remembered here:
{index, count, first, last, srt, at}. The panel compares it with what the sequence holds now; a track the user edited
no longer matches and is left alone.
"""
from __future__ import annotations

import json
import logging
import os
import threading

from . import config

log = logging.getLogger("asistent")
_lock = threading.Lock()


def _path() -> str:
    return os.path.join(config.app_dir(), "captions.json")


def _key(project: str, sequence: str) -> str:
    return f"{os.path.normcase(project or '')}|{sequence}"


def _load() -> dict:
    try:
        with open(_path(), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def get(project: str, sequence: str) -> dict | None:
    with _lock:
        return _load().get(_key(project, sequence))


def record(project: str, sequence: str, signature: dict) -> None:
    for k in ("index", "count"):
        if not isinstance(signature.get(k), int):
            raise ValueError("Invalid signature of a subtitle track.")
    with _lock:
        data = _load()
        data[_key(project, sequence)] = signature
        tmp = _path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, _path())


def forget(project: str, sequence: str) -> None:
    with _lock:
        data = _load()
        if data.pop(_key(project, sequence), None) is not None:
            tmp = _path() + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
            os.replace(tmp, _path())
