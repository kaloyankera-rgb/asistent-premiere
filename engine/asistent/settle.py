"""When is a file that is being written really finished? Shared by Smart Folder Sync (importer.py) and the export
watcher (exports.py), so both wait the same way:

  * no browser temp file exists next to it, it is not empty;
  * its size and time stopped changing for a while (shorter when it was renamed into place: the writer itself says
    it is complete);
  * it can be opened, and FFprobe can read it (an MP4 is readable only once its index is written at the end).
"""
from __future__ import annotations

import json
import os
import threading
import time

from .media import _run, _tool

# browsers and copy tools write under a temporary name first
TEMP_SUFFIXES = (".crdownload", ".part", ".partial", ".download", ".tmp", ".opdownload", ".!ut", ".aria2", ".filepart")
STABLE_SECONDS = 1.5      # written in some other way: size and time unchanged this long
MOVED_STABLE = 0.3         # renamed from a temp name: the writer itself says it is complete


def is_temp(path: str) -> bool:
    name = os.path.basename(path).lower()
    return name.startswith((".", "~$")) or name.endswith(TEMP_SUFFIXES) or ".download/" in path.lower() + "/"


def temp_sibling(path: str) -> bool:
    """A browser still writing this file (Firefox keeps the final name at 0 bytes next to a .part)."""
    return any(os.path.exists(path + s) for s in TEMP_SUFFIXES)


def probe(path: str) -> dict | None:
    p = _run([_tool("ffprobe"), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path])
    if p.returncode != 0:
        return None
    try:
        return json.loads(p.stdout or b"{}")
    except ValueError:
        return None


def opens(path: str) -> bool:
    """False while the writer still holds it locked (Windows)."""
    try:
        with open(path, "rb") as f:
            f.read(1)
        return True
    except OSError:
        return False


class Settle:
    """Paths seen changing. `ready()` hands back each one once it has stopped changing; whoever asks decides what it is."""

    def __init__(self, stable: float = STABLE_SECONDS, moved_stable: float = MOVED_STABLE):
        self.stable, self.moved_stable = stable, moved_stable
        self.pending: dict[str, dict] = {}         # path -> {size, mtime, since, moved}
        self.lock = threading.Lock()

    def touch(self, path: str, moved: bool = False):
        with self.lock:
            state = self.pending.setdefault(path, {"size": -1, "mtime": -1, "since": time.time(), "moved": False})
            state["moved"] = state["moved"] or moved

    def drop(self, path: str):
        with self.lock:
            self.pending.pop(path, None)

    def __contains__(self, path: str) -> bool:
        return path in self.pending

    def ready(self, now: float | None = None, keep=None) -> list[tuple[str, os.stat_result]]:
        """The paths that stopped changing, as (path, stat); they leave the list. keep(path, st) -> False drops a path."""
        now = now or time.time()
        with self.lock:
            paths = list(self.pending)
        done = []
        for path in paths:
            state = self.pending.get(path)
            if state is None:
                continue
            try:
                st = os.stat(path)
            except OSError:
                self.drop(path)                         # gone (renamed by its writer): the new name comes as an event
                continue
            if keep is not None and not keep(path, st):
                self.drop(path)
                continue
            if temp_sibling(path) or st.st_size == 0 or st.st_size != state["size"] or st.st_mtime != state["mtime"]:
                state.update(size=st.st_size, mtime=st.st_mtime, since=now)
                continue
            if now - state["since"] < (self.moved_stable if state.get("moved") else self.stable):
                continue
            self.drop(path)
            done.append((path, st))
        return done
