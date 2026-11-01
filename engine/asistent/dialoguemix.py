"""Dialogue mix for subtitles (Phase 7 M3): the selected audio items as ONE 16 kHz mono signal in sequence time.

The panel decides which items take part (selection, speed, reversed, duplicates) and sends them as
`{"path", "start", "end", "at", "name"}`: media in/out seconds and the sequence second where the item starts.
Here every item is read, its channels are reduced to one using the same classification as „Оправи звука“
(a one-sided clip uses its sound side, two microphones are summed, anything else is averaged) and placed at its
sequence time. Source files are only read.
"""
from __future__ import annotations

from typing import Callable

import numpy as np
from scipy import signal

from . import audio
from .sync import Cancelled

ASR_SR = 16000
_DECIM = audio.SR // ASR_SR          # 48000 -> 16000


def mono_for_asr(x: np.ndarray, c: dict) -> np.ndarray:
    """(channels, samples) + its classification -> one channel. Never a polarity-inverted sum: for an inverted pair
    the classification already chose one side."""
    if x.shape[0] == 1:
        return x[0]
    action = c.get("action")
    if action == "use_left":
        return x[0]
    if action == "use_right":
        return x[1]
    if action == "split":                                    # two independent microphones: both are speech
        return x[0] + x[1]
    return x.mean(axis=0)


def build_mix(items: list[dict], progress: Callable[[float, str], None] | None = None,
              cancelled: Callable[[], bool] | None = None) -> dict:
    """-> {"audio": float32 @16 kHz, "origin": sequence second of sample 0, "notes": [...]}.

    The buffer starts at the earliest item, not at sequence 0, so a long silent lead-in costs no recognition time.
    """
    progress = progress or (lambda f, m: None)
    cancelled = cancelled or (lambda: False)
    parts: list[tuple[float, np.ndarray]] = []
    notes: list[dict] = []
    for i, it in enumerate(items):
        if cancelled():
            raise Cancelled()
        name = it.get("name") or it["path"]
        progress(i / max(len(items), 1), f"Чета звука: {name}")
        x = audio.read_range(it["path"], float(it["start"]), float(it["end"]))
        if x.shape[1] == 0:
            notes.append({"name": name, "kind": "empty", "note": "без звук в избраната част"})
            continue
        c = audio.classify(x)
        y = signal.resample_poly(mono_for_asr(x, c), 1, _DECIM).astype(np.float32)
        parts.append((float(it["at"]), y))
        notes.append({"name": name, "kind": c["kind"], "action": c["action"], "at": round(float(it["at"]), 3),
                      "seconds": round(len(y) / ASR_SR, 3)})
    if not parts:
        raise ValueError("В маркираните клипове няма звук за разпознаване.")
    origin = min(at for at, _ in parts)
    length = max(int(round((at - origin) * ASR_SR)) + len(y) for at, y in parts)
    buf = np.zeros(length, dtype=np.float32)
    for at, y in parts:
        o = int(round((at - origin) * ASR_SR))
        buf[o:o + len(y)] += y
    np.clip(buf, -1.0, 1.0, out=buf)
    return {"audio": buf, "origin": origin, "notes": notes}
