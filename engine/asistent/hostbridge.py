"""Channel to the Asistent host: the invisible CEP extension inside Premiere (host/), which runs ExtendScript.

Why it exists: the UXP panel can import an .srt but cannot put it on a caption track (probed on Premiere 26.0.2:
`Sequence` has no `createCaptionTrack`, `createOverwriteItemAction`/`createInsertProjectItemAction` do nothing for
captions). ExtendScript has `Sequence.createCaptionTrack`. The host long-polls `GET /host/poll`, runs the command and
posts `POST /host/result`; the engine side (`place_captions`) submits a command and waits for the answer.

Unlike the test bridge this one is always on, but it only carries the fixed commands below. `eval` is forwarded only
while the developer's `devbridge.enabled` flag exists, and host.jsx refuses it outside TEST.prproj.
"""
from __future__ import annotations

import os
import time

from . import config, devbridge

HOST = devbridge.Bridge()
COMMANDS = ("ping", "probe", "captions", "audio_route", "eval")
SEEN_WITHIN = 45.0             # the host polls every <= 20 s; older than this it is not running
_state = {"seen": 0.0, "version": None}


def touch(version: str | None = None) -> None:
    _state["seen"] = time.time()
    if version:
        _state["version"] = version


def status() -> dict:
    age = time.time() - _state["seen"] if _state["seen"] else None
    return {"connected": age is not None and age < SEEN_WITHIN, "age": None if age is None else round(age, 1),
            "version": _state["version"]}


NOT_RUNNING = ("The Asistent helper in Premiere is not running. Close and reopen Premiere once "
               "(it is installed with scripts/install_host_mac.sh).")


def run(name: str, args: dict | None = None, wait: float = 60.0) -> dict:
    """One command to the host -> its answer {ok, msg, ...}; raises ValueError with a Bulgarian message."""
    if name not in COMMANDS:
        raise ValueError("Unknown command to Premiere.")
    if name == "eval" and not devbridge.enabled():
        raise ValueError("The test bridge is off.")
    if not status()["connected"]:
        raise ValueError(NOT_RUNNING)
    cid = HOST.submit(name, args or {})
    res = HOST.wait_result(cid, wait)
    if res is None:
        raise ValueError("Premiere did not answer in time (is it busy?). Try again.")
    data = res["data"] if isinstance(res["data"], dict) else {"ok": res["ok"], "msg": str(res["data"])}
    return data


def place_captions(srt: str, sequence: str, project: str | None, bin_name: str = "Subtitles") -> dict:
    """Put the SRT on a caption track of the active sequence (times in the file are sequence times)."""
    if not os.path.isfile(srt):
        raise ValueError("The subtitle file is missing: " + srt)
    return run("captions", {"srt": srt, "sequence": sequence, "project": project, "bin": bin_name})


ROUTES = ("split", "split_rl", "use_left", "use_right")


def route_audio(items: list, sequence: str, project: str | None) -> dict:
    """L/L and R/R through the clips' own channels (host.jsx `as_audio_route`): items [{track, start, end, route}]."""
    clean = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict) or it.get("route") not in ROUTES:
            raise ValueError("Unclear what to do with the clip.")
        clean.append({"track": int(it["track"]), "start": float(it["start"]), "end": float(it["end"]), "route": it["route"]})
    if not clean:
        raise ValueError("No clips to split.")
    return run("audio_route", {"items": clean, "sequence": sequence, "project": project}, wait=120.0)


def ensure_log_dir() -> None:
    os.makedirs(os.path.join(config.app_dir(), "logs"), exist_ok=True)
