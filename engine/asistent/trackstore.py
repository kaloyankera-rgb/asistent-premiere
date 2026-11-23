"""Saved tracks (0.10.152): every finished track of the Tracker page as one JSON file in `<app>/tracks/`, so a track made
earlier (another track since, Premiere or the engine restarted) can be opened again and a picture attached to it later.

The user (2026-11-23): "I tracked a face and after a while I want to add a picture and attach it to the tracker, I can't do
it if I tracked something else afterwards or restarted Premiere".

A record is only data: the clip the track came from (file, track, place, in point, speed), the tracked frames as the engine
measured them (and the panel merged after a fix), the project and sequence it was made in, and one small picture of the
boxed frame for the list. The frame pictures for scrubbing are not stored: `tracker.reopen` makes them again from the file.

Each track has a number in its project ("TRACK 3 · fx30-3-9948", 0.10.153) and, when the panel asks, a marker clip: a fully
transparent QuickTime Animation file as long as the tracked clip, named after the track, in `<app>/tracks/markers/<id>/`. The
panel places it above the tracked clip, so the track is seen, labelled and kept in the project; the file's folder is the track's
id, so a selected marker tells the panel which track it is (the user's choice 2026-11-23: "an invisible marker clip").
Nothing here touches Premiere or the media.
"""
from __future__ import annotations

import base64
import fractions
import json
import os
import re
import subprocess
import sys
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
    project = str(record.get("project") or "")
    n = (old or {}).get("n") or _next_number(project)
    stem = os.path.splitext(str(src["clip"].get("name") or "Track"))[0]
    out = {"format": 1, "id": tid, "n": n, "label": (old or {}).get("label") or f"TRACK {n} · {stem}"[:80],
           "marker": (old or {}).get("marker"), "name": str(record.get("name") or src["clip"].get("name") or "Track")[:120],
           "project": project, "sequence": str(record.get("sequence") or src.get("sequence") or ""),
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
    return {"id": tid, "saved": now, "n": n, "label": out["label"], "marker": out["marker"]}


def _same(a: str, b: str) -> bool:
    return bool(a) and os.path.normcase(os.path.normpath(a or "")) == os.path.normcase(os.path.normpath(b or ""))


def _next_number(project: str) -> int:
    """The next track number in this project (1 for the first; numbers are never reused while a higher one is saved)."""
    top = 0
    d = folder()
    if os.path.isdir(d):
        for name in os.listdir(d):
            if name.endswith(".json"):
                try:
                    rec = get(name[:-5])
                except (OSError, ValueError):
                    continue
                if _same(rec.get("project") or "", project) or (not project and not rec.get("project")):
                    top = max(top, int(rec.get("n") or 0))
    return top + 1


def _safe(name: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", " ", name)).strip()[:80] or "TRACK"


def marker_dir() -> str:
    return os.path.join(folder(), "markers")


def marker_id(path: str) -> str | None:
    """The track id of a marker clip's file, or None for any other file."""
    m = re.search(r"[\\/]tracks[\\/]markers[\\/]([a-z0-9]{8,32})[\\/][^\\/]+\.mov$", path or "", re.I)
    return m.group(1) if m else None


def marker(tid: str, seconds: float, fps: float, width: int, height: int) -> dict:
    """The track's marker clip (made once; made again only when the length or frame changed): transparent, `seconds` long at
    the sequence's `fps` and size, no sound. Recorded in the track's file. -> {path, label, made}"""
    from . import media
    rec = get(tid)
    seconds, fps, width, height = float(seconds), float(fps), int(width), int(height)
    if not (0.04 <= seconds <= 4 * 3600) or not (1 <= fps <= 240) or not (16 <= width <= 16384 and 16 <= height <= 16384):
        raise ValueError("The marker clip's length, frame rate or size is unclear.")
    frames = max(1, int(round(seconds * fps)))
    want = {"frames": frames, "fps": round(fps, 4), "width": width, "height": height}
    d = os.path.join(marker_dir(), tid)
    path = os.path.join(d, _safe(rec.get("label") or "TRACK") + ".mov")
    old = rec.get("marker") or {}
    if old.get("path") == path and os.path.isfile(path) and all(old.get(k) == v for k, v in want.items()):
        return {"path": path, "label": rec.get("label"), "made": False}
    os.makedirs(d, exist_ok=True)
    rate = fractions.Fraction(fps).limit_denominator(1001)
    tmp = os.path.join(d, ".making.mov")
    cmd = [media._tool("ffmpeg"), "-v", "error", "-nostdin", "-y", "-f", "lavfi",
           "-i", f"color=c=black@0.0:s={width}x{height}:r={rate.numerator}/{rate.denominator},format=argb",
           "-frames:v", str(frames), "-c:v", "qtrle", "-g", "100000", "-pix_fmt", "argb", "-an", tmp]
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    r = subprocess.run(cmd, capture_output=True, text=True, creationflags=flags, timeout=300)
    if r.returncode or not os.path.isfile(tmp):
        raise ValueError("The marker clip was not made: " + (r.stderr or "FFmpeg failed").strip()[-200:])
    os.replace(tmp, path)
    rec["marker"] = {"path": path, **want}
    data = json.dumps(rec, ensure_ascii=False)
    with open(_path(tid) + ".tmp", "w", encoding="utf-8") as f:
        f.write(data)
    os.replace(_path(tid) + ".tmp", _path(tid))
    return {"path": path, "label": rec.get("label"), "made": True}


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
    return {"id": rec.get("id"), "name": rec.get("name"), "n": rec.get("n"), "label": rec.get("label") or rec.get("name"),
            "marker": bool((rec.get("marker") or {}).get("path")), "project": rec.get("project") or "", "sequence": rec.get("sequence") or "",
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
    for x in items:
        x["here"] = _same(x["project"], project)
    return {"items": items, "mine": sum(1 for x in items if x["here"])}


def delete(tid: str) -> dict:
    """The saved track goes; its marker file stays, so a marker clip still on a timeline does not go offline."""
    p = _path(tid)
    if os.path.isfile(p):
        os.remove(p)
    return {"id": tid, "deleted": True}
