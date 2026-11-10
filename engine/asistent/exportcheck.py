"""Pre-export check (TODO I12, 0.10.35): how loud each audio clip of the sequence peaks, in the part of its file the clip uses.

Read only: nothing is written, nothing is changed. The panel adds the clip's own Volume (the highest it reaches) and decides
what to report; the rule is the user's: the main microphone never peaks above -6 dBFS. Measured per clip on the file, so a
track fader, Audio Gain, effects and two clips sounding at once are not included: the panel says so.
"""
from __future__ import annotations

import logging
import os

import numpy as np

from . import audio as AUDIO
from .media import MediaError

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
