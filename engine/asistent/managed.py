"""Which Lumetri corrections Asistent wrote itself (managed correction ownership, colour plan B6).

After every write the panel sends a snapshot of the whole Lumetri (every parameter, as text); a sha1 of it is
kept per clip (media path + source in/out). Before touching an existing Lumetri the panel asks whether its
current snapshot is one of those: only then may Asistent update it. Any manual change, to any parameter,
changes the snapshot, and the Lumetri counts as the user's grade again (never touched).

A cut or a trim changes a clip's in/out, so a snapshot is also Asistent's when it was written on another piece of the same
media file (the user, 2026-11-05: Match POVs' Lumetri on fx31028 36.0-50.6 counted as a hand grade after the clip was cut).
The file is matched by name, since one drive can be mounted under two paths; the snapshot is every Lumetri parameter, so a
hand change still makes it the user's.
"""
from __future__ import annotations

import hashlib
import json
import ntpath
import os
import threading
import time

KEEP = 6                       # snapshots per clip: first write, step-back, later updates


def _sha(snapshot: str) -> str:
    return hashlib.sha1(snapshot.encode("utf-8")).hexdigest()


def _media(key: str) -> str:
    """"/Volumes/x/кам2/fx31028.MP4|36.036|50.550" -> "fx31028.mp4" (Mac or Windows path)."""
    return ntpath.basename(key.rsplit("|", 2)[0]).lower()


class ManagedStore:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()

    def _load(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _save(self, data: dict) -> None:
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, self.path)

    def owned(self, key: str, snapshot: str) -> bool:
        if not key or not snapshot:
            return False
        h = _sha(snapshot)
        with self._lock:
            data = self._load()
        if h in ((data.get(key) or {}).get("hashes") or []):
            return True
        name = _media(key)
        return any(h in (rec.get("hashes") or []) for k, rec in data.items() if _media(k) == name)

    def record(self, key: str, snapshot: str, values: dict | None = None) -> None:
        if not key or not snapshot:
            raise ValueError("A key or Lumetri snapshot is missing.")
        with self._lock:
            data = self._load()
            rec = data.get(key) or {"hashes": []}
            h = _sha(snapshot)
            rec["hashes"] = [x for x in rec["hashes"] if x != h][-(KEEP - 1):] + [h]
            rec["values"] = values or {}
            rec["at"] = time.time()
            data[key] = rec
            self._save(data)
