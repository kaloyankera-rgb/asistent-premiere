"""Stash v1 (COCKPIT_PLAN.md A2, 0.10.37): saved animations, one JSON file each in `<app>/stash/`.

Only data (keyframe offsets, values, one sample per frame), so a stash works in every project and survives panel updates.
Each one remembers the client of the project it was saved in (the same naming as colour learning), for the panel's profile
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


def save(stash: dict, project: str = "") -> dict:
    if not isinstance(stash, dict) or not isinstance(stash.get("props"), list) or not stash["props"]:
        raise ValueError("Nothing to save.")
    from .colorlearn import client_of
    sid = uuid.uuid4().hex[:16]
    item = {**stash, "id": sid, "client": stash.get("client") or (client_of(project) if project else ""),
            "created": time.strftime("%Y-%m-%d %H:%M"), "project": os.path.basename(project or "")}
    item["name"] = str(item.get("name") or "Animation")[:80]
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
        items.append({"id": s.get("id"), "name": s.get("name"), "client": s.get("client") or "", "created": s.get("created"),
                      "span": s.get("span"), "props": [p.get("label") for p in s.get("props") or []]})
    items.sort(key=lambda x: x.get("created") or "", reverse=True)
    return {"items": items, "bytes": size}


def delete(sid: str) -> dict:
    try:
        os.remove(_path(sid))
    except FileNotFoundError:
        raise ValueError("No such stash.") from None
    return {"deleted": sid}


def rename(sid: str, name: str) -> dict:
    s = get(sid)
    s["name"] = str(name or s.get("name") or "Animation")[:80]
    with open(_path(sid), "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False)
    return {"id": sid, "name": s["name"]}
