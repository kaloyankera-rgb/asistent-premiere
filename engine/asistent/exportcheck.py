"""Pre-export check (TODO I12, 0.10.35): how loud each audio clip of the sequence peaks, in the part of its file the clip uses.

Read only: nothing is written, nothing is changed. The panel adds the clip's own Volume (the highest it reaches) and decides
what to report; the rule is the user's: the main microphone never peaks above -6 dBFS. Measured per clip on the file, so a
track fader, Audio Gain, effects and two clips sounding at once are not included: the panel says so.
"""
from __future__ import annotations

import logging
import os

import numpy as np

from concurrent.futures import ThreadPoolExecutor

from . import audio as AUDIO
from .media import MediaError
from .settle import probe

log = logging.getLogger("asistent")
MAX_ITEMS = 2000


def peaks(items: list[dict], progress=lambda f, m: None, cancelled=lambda: False) -> dict:
    """items: [{path, start, end}] (media seconds) -> {"items": [{path, start, end, peak_db: [per channel] | None, error?}]}.
    The same file range is measured once (a camera's L and R copies use the same range)."""
    if len(items) > MAX_ITEMS:
        raise ValueError(f"Too many audio clips ({len(items)}) for one check (at most {MAX_ITEMS}).")
    seen: dict[tuple, dict] = {}
    out = []
    for n, it in enumerate(items):
        if cancelled():
            raise InterruptedError("cancelled")
        path, start, end = it.get("path"), float(it.get("start") or 0.0), it.get("end")
        end = float(end) if end is not None else None
        key = (path, round(start, 3), None if end is None else round(end, 3))
        if key not in seen:
            progress(n / max(1, len(items)), f"Measuring {os.path.basename(path or '')}")
            res: dict = {"path": path, "start": start, "end": end, "peak_db": None}
            try:
                x = AUDIO.read_range(path, start, end, cancelled=cancelled)
                res["peak_db"] = [round(AUDIO.true_peak(np.asarray(ch)), 2) for ch in x]
            except (MediaError, OSError, ValueError) as e:
                res["error"] = str(e)
            seen[key] = res
        out.append({**seen[key], "path": path, "start": start, "end": end})
    log.info("export check: %d clips, %d file ranges measured", len(items), len(seen))
    return {"items": out}


# 0.10.44 (the user, 2026-11-11: "I often make the mistake for the B-Rolls to not be fully scaled"): the frame of each video or
# photo file, so the panel can work out which part of the sequence frame a clip's picture covers.
ALPHA = ("yuva", "rgba", "argb", "bgra", "abgr", "gbrap", "ya8", "ya16", "pal8")


def frames(paths: list[str]) -> dict:
    """paths -> {"items": [{path, width, height, rotation, alpha, still} | {path, error}]}; FFprobe only, read only."""
    if len(paths) > MAX_ITEMS:
        raise ValueError(f"Too many clips ({len(paths)}) for one check (at most {MAX_ITEMS}).")

    def one(path: str) -> dict:
        info = probe(path) if path and os.path.isfile(path) else None
        v = next((s for s in (info or {}).get("streams") or [] if s.get("codec_type") == "video"), None)
        if not v:
            return {"path": path, "error": "no picture in the file" if info else "the file could not be read"}
        rot = 0
        for sd in v.get("side_data_list") or []:
            if sd.get("rotation") is not None:
                rot = int(round(float(sd["rotation"]))) % 360
        if not rot and (v.get("tags") or {}).get("rotate"):
            rot = int(round(float(v["tags"]["rotate"]))) % 360
        pix = str(v.get("pix_fmt") or "")
        frames_n = str(v.get("nb_frames") or "")
        still = (v.get("codec_name") in ("mjpeg", "png", "tiff", "webp", "bmp", "heif", "hevc") and frames_n in ("", "1")
                 and not (info.get("format") or {}).get("duration"))
        return {"path": path, "width": int(v.get("width") or 0), "height": int(v.get("height") or 0), "rotation": rot,
                "alpha": pix.startswith(ALPHA) or (pix.endswith("a") and pix.startswith(("yuv", "gbr"))), "pix_fmt": pix,
                "still": bool(still)}

    unique = list(dict.fromkeys(p for p in paths if isinstance(p, str)))
    with ThreadPoolExecutor(max_workers=6) as pool:
        got = dict(zip(unique, pool.map(one, unique)))
    log.info("export check: frames of %d files", len(unique))
    return {"items": [got[p] for p in unique]}
