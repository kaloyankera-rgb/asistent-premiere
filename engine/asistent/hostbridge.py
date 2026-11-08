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
COMMANDS = ("ping", "probe", "captions", "graphics", "audio_route", "eval")
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
               "(it is installed by scripts/setup_mac.sh or setup_win.ps1).")


def run(name: str, args: dict | None = None, wait: float = 60.0) -> dict:
    """One command to the host -> its answer {ok, msg, ...}; raises ValueError with the message for the editor."""
    if name not in COMMANDS:
        raise ValueError("Unknown command to Premiere.")
    if name == "eval" and not devbridge.enabled():
        raise ValueError("The test bridge is off.")
    if not status()["connected"]:
        raise ValueError(NOT_RUNNING)
    cid = HOST.submit(name, args or {}, deadline=time.time() + wait)
    res = HOST.wait_result(cid, wait)
    if res is None:
        # 0.10.6 (ARCH-001): a command left in the queue used to run later, after the editor's retry
        state = HOST.give_up(cid)
        if state == "done":
            res = HOST.wait_result(cid, 0)
        elif state == "withdrawn":
            raise ValueError("Premiere did not take the command in time (is it busy?). Nothing was done: try again.")
        else:
            raise ValueError("Premiere did not answer in time. It may still finish the last command: check the timeline "
                             "before you press again.")
    data = res["data"] if isinstance(res["data"], dict) else {"ok": res["ok"], "msg": str(res["data"])}
    return data


def place_captions(srt: str, sequence: str, project: str | None, bin_name: str = "Subtitles") -> dict:
    """Put the SRT on a caption track of the active sequence (times in the file are sequence times)."""
    if not os.path.isfile(srt):
        raise ValueError("The subtitle file is missing: " + srt)
    return run("captions", {"srt": srt, "sequence": sequence, "project": project, "bin": bin_name})


# Subtitles as text graphics (the user's choice 2026-11-04): Asistent's own After Effects templates, one per subtitle
# preset, built once by scripts/caption_template.sh into <app>/templates (After Effects writes "<name>.mogrt/<name>.mogrt").
TEMPLATES = {"short": ("Asistent Subtitle 9x16", 1080, 1920), "standard": ("Asistent Subtitle 16x9", 1920, 1080)}


def template_path(preset: str) -> str | None:
    name = TEMPLATES.get(preset, TEMPLATES["standard"])[0]
    folder = os.path.join(config.app_dir(), "templates")
    for path in (os.path.join(folder, name + ".mogrt", name + ".mogrt"), os.path.join(folder, name + ".mogrt")):
        if os.path.isfile(path):
            return path
    return None


def build_templates() -> str | None:
    """After Effects builds both templates (about a minute, it opens After Effects); -> an error text or None."""
    import subprocess
    script = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "scripts", "caption_template.sh")
    try:
        p = subprocess.run(["/bin/bash", script], capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired) as e:
        return f"After Effects did not build the subtitle template: {e}"
    if p.returncode != 0 or '"ok":true' not in p.stdout:
        return "After Effects did not build the subtitle template: " + (p.stderr.strip() or p.stdout.strip())[:300]
    return None


def place_graphics(captions: list, preset: str, sequence: str, project: str | None) -> dict:
    """Every subtitle line as a text graphic on a new video track (host.jsx `as_graphics`)."""
    lines = []
    for c in captions if isinstance(captions, list) else []:
        if not isinstance(c, dict) or not isinstance(c.get("text"), str):
            raise ValueError("Invalid subtitle line.")
        start, end = float(c["start"]), float(c["end"])
        if end <= start:
            raise ValueError("Invalid subtitle line.")
        lines.append({"start": start, "end": end, "text": c["text"]})
    if not lines:
        raise ValueError("No subtitle lines to place.")
    path = template_path(preset)
    if not path:
        err = build_templates()
        path = template_path(preset)
        if not path:
            raise ValueError(err or "The subtitle template is missing.")
    name, w, h = TEMPLATES.get(preset, TEMPLATES["standard"])
    return run("graphics", {"captions": lines, "template": path, "width": w, "height": h, "sequence": sequence,
                            "project": project, "track_name": "Asistent subtitles"}, wait=60.0 + 1.5 * len(lines))


ROUTES = ("split", "split_rl", "use_left", "use_right", "label")   # "label": only an earlier copy's label (host.jsx)


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
