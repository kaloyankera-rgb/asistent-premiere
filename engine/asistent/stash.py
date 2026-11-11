"""Stash (COCKPIT_PLAN.md A2): saved animations (v1, 0.10.37) and saved clips (v2, 0.10.50), one JSON file each in
`<app>/stash/`.

An animation is only data (keyframe offsets, values, one sample per frame), so it works in every project and survives panel
updates. A clips stash (a logo on V2 over its background on V1, with every effect and keyframe) is a small Premiere project
in `<app>/stash/clips/<id>/`: the panel copies the selected clips into an empty sequence made from `shell.xml` (written here),
the host saves that sequence with `Sequence.exportAsProject`, and Apply imports it and copies its clips to the playhead.
Each stash remembers the client of the project it was saved in (the same naming as colour learning), for the panel's profile
list. Nothing here touches Premiere.
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid

from . import config

MAX_BYTES = 2_000_000
_ID = re.compile(r"^[a-z0-9]{8,32}$")


def folder() -> str:
    return os.path.join(config.app_dir(), "stash")


def _path(sid: str) -> str:
    if not _ID.match(sid or ""):
        raise ValueError("No such stash.")
    return os.path.join(folder(), f"{sid}.json")


def clips_dir(sid: str) -> str:
    _path(sid)                                                  # checks the id
    return os.path.join(folder(), "clips", sid)


def begin_clips(name: str, fps: float, width: int, height: int, video: int, audio: int, seconds: float) -> dict:
    """A new clips stash: its id, folder and the empty sequence to copy the clips into (shell.xml: the source sequence's
    size and rate, `video` video tracks, at least `audio` audio tracks). -> {id, shell, file, sequence}"""
    from . import xmeml
    fps = float(fps)
    width, height, video, audio = int(width), int(height), int(video), int(audio)
    if not (1 <= fps <= 240) or not (16 <= width <= 16384) or not (16 <= height <= 16384):
        raise ValueError("The sequence's size or frame rate is unclear.")
    if not (1 <= video <= 99) or not (0 <= audio <= 99):
        raise ValueError("Too many tracks to stash.")
    sid = uuid.uuid4().hex[:16]
    d = clips_dir(sid)
    os.makedirs(d, exist_ok=True)
    label = re.sub(r"\s+", " ", re.sub(r"[\\/:*?\"<>|]+", " ", str(name or "Clips"))).strip()[:60] or "Clips"
    seq = "Stash - %s %s" % (label, sid[:6])
    frames = max(1, int(round(float(seconds) * fps)))
    # the shell writer makes a video track per piece track and two audio tracks per piece audio track (L and R exploded)
    pieces = [{"kind": "video", "track": t, "start": 0, "end": frames, "item": 0, "path": "", "src_in": 0, "src_out": 0}
              for t in range(video)]
    pieces += [{"kind": "audio", "track": t, "start": 0, "end": frames, "item": 0, "path": "", "src_in": 0, "src_out": 0}
               for t in range((audio + 1) // 2)]
    shell = os.path.join(d, "shell.xml")
    xmeml.write(shell, seq, fps, width, height, pieces, shell=True)
    return {"id": sid, "shell": shell, "file": os.path.join(d, "clips.prproj"), "sequence": seq}


def save(stash: dict, project: str = "") -> dict:
    if not isinstance(stash, dict):
        raise ValueError("Nothing to save.")
    clips = stash.get("kind") == "clips"
    if clips:
        if not isinstance(stash.get("items"), list) or not stash["items"]:
            raise ValueError("Nothing to save.")
        sid = str(stash.get("id") or "")
        f = os.path.join(clips_dir(sid), "clips.prproj")
        if not os.path.isfile(f) or os.path.getsize(f) == 0:
            raise ValueError("Premiere did not write the stash's project file.")
        stash = {**stash, "file": f}
    elif not isinstance(stash.get("props"), list) or not stash["props"]:
        raise ValueError("Nothing to save.")
    from .colorlearn import client_of
    sid = stash["id"] if clips else uuid.uuid4().hex[:16]
    item = {**stash, "id": sid, "client": stash.get("client") or (client_of(project) if project else ""),
            "created": time.strftime("%Y-%m-%d %H:%M"), "project": os.path.basename(project or "")}
    item["name"] = str(item.get("name") or ("Clips" if clips else "Animation"))[:80]
    data = json.dumps(item, ensure_ascii=False)
    if len(data.encode("utf-8")) > MAX_BYTES:
        raise ValueError("That animation is too large to keep.")
    os.makedirs(folder(), exist_ok=True)
    tmp = _path(sid) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(data)
    os.replace(tmp, _path(sid))
    return {"id": sid, "name": item["name"], "client": item["client"]}


def get(sid: str) -> dict:
    try:
        with open(_path(sid), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        raise ValueError("No such stash.") from None


def listing() -> dict:
    items, size = [], 0
    try:
        names = sorted(os.listdir(folder()))
    except OSError:
        names = []
    for n in names:
        if not n.endswith(".json"):
            continue
        p = os.path.join(folder(), n)
        try:
            size += os.path.getsize(p)
            with open(p, encoding="utf-8") as f:
                s = json.load(f)
        except (OSError, ValueError):
            continue
        if s.get("kind") == "clips":
            size += _tree_size(clips_dir(s.get("id") or ""))
        items.append({"id": s.get("id"), "name": s.get("name"), "client": s.get("client") or "", "created": s.get("created"),
                      "span": s.get("span"), "kind": s.get("kind") or "animation",
                      "props": [p.get("label") for p in s.get("props") or []],
                      "clips": [c.get("label") for c in s.get("items") or []]})
    items.sort(key=lambda x: x.get("created") or "", reverse=True)
    return {"items": items, "bytes": size}


def _tree_size(d: str) -> int:
    total = 0
    for base, _dirs, files in os.walk(d):
        for n in files:
            try:
                total += os.path.getsize(os.path.join(base, n))
            except OSError:
                pass
    return total


def delete(sid: str) -> dict:
    try:
        os.remove(_path(sid))
    except FileNotFoundError:
        raise ValueError("No such stash.") from None
    import shutil
    shutil.rmtree(clips_dir(sid), ignore_errors=True)          # a clips stash's project file (Asistent's own folder)
    return {"deleted": sid}


def rename(sid: str, name: str) -> dict:
    s = get(sid)
    s["name"] = str(name or s.get("name") or "Animation")[:80]
    with open(_path(sid), "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False)
    return {"id": sid, "name": s["name"]}
