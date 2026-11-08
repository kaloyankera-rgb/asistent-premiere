"""Play a subtitle passage with the audio around it, on this computer (Captions tab review, 2026-11 improvements).

The editor presses Play on a line: the engine cuts that stretch (with `pad` seconds before and after) from the same
microphone piece the subtitle job recognised (the job JSON's `segments`, the cleanest copy per stretch), and plays it
through the system player (macOS `afplay`, Windows `winsound`). Read only: the media and the job are never changed, and a
new Play stops the one still playing. Nothing leaves the computer.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading

from . import config

PAD = 1.5
MAX_SECONDS = 20.0
_lock = threading.Lock()
_player: dict = {"proc": None}


def _piece(segments: list[dict], a: float, b: float) -> dict | None:
    """The segment that covers most of [a, b] in sequence time."""
    best, cover = None, 0.0
    for s in segments:
        lo, hi = float(s["at"]), float(s["at"]) + float(s["end"]) - float(s["start"])
        c = min(b, hi) - max(a, lo)
        if c > cover and os.path.isfile(str(s.get("path", ""))):
            best, cover = s, c
    return best


def clip_plan(job: dict, at: float, end: float | None = None, pad: float = PAD) -> dict:
    """-> {"path", "source_start", "seconds", "side", "from", "to"} for the passage at [at, end] in sequence seconds."""
    end = at if end is None else end
    a, b = max(0.0, float(at) - pad), float(end) + pad
    seg = _piece(job.get("segments") or [], a, b)
    if seg is None:
        raise ValueError("The media of this line is not available (offline or moved).")
    lo = float(seg["at"])
    hi = lo + float(seg["end"]) - float(seg["start"])
    a, b = max(a, lo), min(b, hi, a + MAX_SECONDS)
    return {"path": seg["path"], "source_start": float(seg["start"]) + (a - lo), "seconds": round(b - a, 3),
            "side": seg.get("side"), "from": round(a, 3), "to": round(b, 3)}


def _wav(plan: dict) -> str:
    folder = os.path.join(config.app_dir(), "cache", "listen")
    os.makedirs(folder, exist_ok=True)
    out = os.path.join(folder, "passage.wav")
    pan = {"L": ["-af", "pan=mono|c0=c0"], "R": ["-af", "pan=mono|c0=c1"]}.get(plan.get("side"), [])
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{plan['source_start']:.3f}", "-t", f"{plan['seconds']:.3f}",
           "-i", plan["path"], "-vn", *pan, "-ar", "48000", "-acodec", "pcm_s16le", out]
    subprocess.run(cmd, check=True, capture_output=True, timeout=30)
    return out


def stop() -> None:
    with _lock:
        proc = _player["proc"]
        _player["proc"] = None
    if proc is not None and proc.poll() is None:
        proc.terminate()
    if sys.platform == "win32":
        import winsound

        winsound.PlaySound(None, 0)


def play(job_path: str, at: float, end: float | None = None, pad: float = PAD) -> dict:
    path = os.path.abspath(job_path)
    if os.path.basename(os.path.dirname(path)) != "Asistent_subtitles" or not path.endswith(".json"):
        raise ValueError("Not an Asistent subtitle run.")
    with open(path, encoding="utf-8") as f:
        job = json.load(f)
    plan = clip_plan(job, float(at), None if end is None else float(end), pad)
    wav = _wav(plan)
    stop()
    if sys.platform == "darwin":
        with _lock:
            _player["proc"] = subprocess.Popen(["afplay", wav], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif sys.platform == "win32":
        import winsound

        winsound.PlaySound(wav, winsound.SND_FILENAME | winsound.SND_ASYNC)
    else:
        raise ValueError("Playing is supported on Mac and Windows.")
    return {"from": plan["from"], "to": plan["to"], "seconds": plan["seconds"]}
