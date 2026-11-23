"""Saved tracks (0.10.152): every finished track of the Tracker page as one JSON file in `<app>/tracks/`, so a track made
earlier (another track since, Premiere or the engine restarted) can be opened again and a picture attached to it later.

The user (2026-11-23): "I tracked a face and after a while I want to add a picture and attach it to the tracker, I can't do
it if I tracked something else afterwards or restarted Premiere".

A record is only data: the clip the track came from (file, track, place, in point, speed), the tracked frames as the engine
measured them (and the panel merged after a fix), the project and sequence it was made in, and one small picture of the
boxed frame for the list. The frame pictures for scrubbing are not stored: `tracker.reopen` makes them again from the file.
Nothing here touches Premiere or the media.
"""
from __future__ import annotations

import base64
import json
import os
import re
import time

from . import config

MAX_BYTES = 8_000_000                   # one record (a 9000-frame track is about 1 MB)
_ID = re.compile(r"^[a-z0-9]{8,32}$")
_STATES = ("sure", "unsure", "lost", "none")


def folder() -> str:
    return os.path.join(config.app_dir(), "tracks")


def _path(tid: str) -> str:
    if not _ID.match(tid or ""):
        raise ValueError("No such saved track.")
    return os.path.join(folder(), f"{tid}.json")


def _poster(tid: str, k0: int) -> str | None:
    """The boxed frame's small picture, from the engine's memory of this track (None after a restart)."""
    from . import tracker
    e = tracker._TRACKS.get(tid)
    if not e:
        return None
    thumbs = e["thumbs"]
    for j in [k0] + [k0 + d * s for d in range(1, 30) for s in (1, -1)]:
        if 0 <= j < len(thumbs) and thumbs[j]:
            return base64.b64encode(thumbs[j]).decode("ascii")
    return None


def save(record: dict) -> dict:
    """Saves (or replaces: the same track after a fix keeps its id) one track. record: {id, name, project, sequence,
    source: {clip: {name, path, track, start, end, inPt, outPt, speed, kind}, fps, step, t0, from, to, at, sequence},
    track: {frames, width, height, k0, total, step, t0, box, range, stopped, thumb}} -> {id, saved}"""
    if not isinstance(record, dict):
        raise ValueError("Nothing to save.")
    tid = str(record.get("id") or "")
    _path(tid)
    src = record.get("source")
    trk = record.get("track")
    if not isinstance(src, dict) or not isinstance(src.get("clip"), dict) or not isinstance(src["clip"].get("path"), str):
        raise ValueError("The track has no clip.")
    if not isinstance(trk, dict) or not isinstance(trk.get("frames"), list) or not trk["frames"]:
        raise ValueError("The track has no frames.")
    if not all(isinstance(f, dict) and f.get("state") in _STATES for f in trk["frames"]):
        raise ValueError("The track's frames are unclear.")
    k0 = int(trk.get("k0") or 0)
    old = None
    if os.path.isfile(_path(tid)):
        try:
            old = get(tid)
        except (OSError, ValueError):
            old = None
    now = time.time()
    out = {"format": 1, "id": tid, "name": str(record.get("name") or src["clip"].get("name") or "Track")[:120],
           "project": str(record.get("project") or ""), "sequence": str(record.get("sequence") or src.get("sequence") or ""),
           "created": (old or {}).get("created") or now, "saved": now, "source": src, "track": trk,
           "poster": _poster(tid, k0) or (old or {}).get("poster")}
    data = json.dumps(out, ensure_ascii=False)
    if len(data.encode("utf-8")) > MAX_BYTES:
        raise ValueError("The track is too large to save.")
    os.makedirs(folder(), exist_ok=True)
    tmp = _path(tid) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(data)
    os.replace(tmp, _path(tid))
    return {"id": tid, "saved": now}


def get(tid: str) -> dict:
    with open(_path(tid), encoding="utf-8") as f:
        rec = json.load(f)
    if not isinstance(rec, dict) or not isinstance(rec.get("track"), dict):
        raise ValueError("That saved track is damaged.")
    return rec


def _summary(rec: dict) -> dict:
    trk = rec.get("track") or {}
    src = rec.get("source") or {}
    clip = src.get("clip") or {}
    counts = {s: 0 for s in _STATES}
    for f in trk.get("frames") or []:
        counts[f.get("state", "none")] = counts.get(f.get("state", "none"), 0) + 1
    return {"id": rec.get("id"), "name": rec.get("name"), "project": rec.get("project") or "", "sequence": rec.get("sequence") or "",
            "created": rec.get("created"), "saved": rec.get("saved"), "clip": clip.get("name") or "", "path": clip.get("path") or "",
            "track": clip.get("track"), "at": src.get("at"), "fps": src.get("fps"), "frames": len(trk.get("frames") or []),
            "counts": counts, "poster": rec.get("poster"), "offline": not os.path.isfile(clip.get("path") or "")}


def listing(project: str = "") -> dict:
    """Every saved track, newest first; `mine` counts those of `project` (the panel shows those first). -> {items, mine}"""
    items = []
    d = folder()
    if os.path.isdir(d):
        for name in os.listdir(d):
            if not name.endswith(".json"):
                continue
            try:
                items.append(_summary(get(name[:-5])))
            except (OSError, ValueError):
                continue
    items.sort(key=lambda x: x.get("saved") or 0, reverse=True)
    same = lambda p: bool(project) and os.path.normcase(os.path.normpath(p or "")) == os.path.normcase(os.path.normpath(project))
    for x in items:
        x["here"] = same(x["project"])
    return {"items": items, "mine": sum(1 for x in items if x["here"])}


def delete(tid: str) -> dict:
    p = _path(tid)
    if os.path.isfile(p):
        os.remove(p)
    return {"id": tid, "deleted": True}
