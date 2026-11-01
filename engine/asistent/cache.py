"""Decoded audio kept on disk, so the same clips are not decoded again on the next run.

Key: path + size + modification time + analysis rate, so a changed or replaced file is decoded anew.
Lives in the engine's own folder (never next to the media); the oldest entries go above 2 GB.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Callable

import numpy as np

from . import config
from .media import Channel, MediaInfo

VERSION = 1
LIMIT = 2 * 1024 ** 3
log = logging.getLogger("asistent")


def cache_dir() -> str:
    d = os.environ.get("ASISTENT_CACHE_DIR") or os.path.join(config.app_dir(), "cache", "audio")
    os.makedirs(d, exist_ok=True)
    return d


def _key(info: MediaInfo, sr: int) -> str:
    st = os.stat(info.path)
    raw = f"{VERSION}|{os.path.abspath(info.path)}|{st.st_size}|{st.st_mtime_ns}|{sr}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def channels(info: MediaInfo, sr: int, loader: Callable[[MediaInfo, int], list[Channel]]) -> list[Channel]:
    path = os.path.join(cache_dir(), _key(info, sr) + ".npz")
    if os.path.isfile(path):
        try:
            with np.load(path, allow_pickle=False) as z:
                meta = json.loads(str(z["meta"]))
                out = [Channel(m["label"], m["stream"], m["channel"], z[f"c{i}"], m["rms_db"], m["peak_db"],
                               m["silent"], m["duplicate_of"]) for i, m in enumerate(meta)]
            os.utime(path)                      # recently used: pruned last
            return out
        except Exception:                       # unreadable entry: decode again
            log.warning("cache entry %s unreadable, decoding again", os.path.basename(path))
    chans = loader(info, sr)
    meta = [{"label": c.label, "stream": c.stream, "channel": c.channel, "rms_db": c.rms_db, "peak_db": c.peak_db,
             "silent": c.silent, "duplicate_of": c.duplicate_of} for c in chans]
    tmp = path + ".tmp.npz"
    try:
        np.savez(tmp, meta=json.dumps(meta), **{f"c{i}": c.data for i, c in enumerate(chans)})
        os.replace(tmp, path)
        _prune()
    except OSError as e:
        log.warning("audio cache write failed: %s", e)
        if os.path.exists(tmp):
            os.remove(tmp)
    return chans


def _prune():
    d = cache_dir()
    files = [os.path.join(d, f) for f in os.listdir(d) if f.endswith(".npz") and ".tmp" not in f]
    stats = sorted((os.stat(f).st_mtime, os.stat(f).st_size, f) for f in files)
    total = sum(s for _, s, _ in stats)
    if total <= LIMIT:
        return
    for _, size, f in stats:                  # oldest first, down to three quarters of the limit
        if total <= LIMIT * 0.75:
            break
        os.remove(f)
        total -= size
