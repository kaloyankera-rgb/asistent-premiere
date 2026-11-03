"""Dialogue mix for subtitles (Phase 7 M3): the selected audio items as ONE 16 kHz mono signal in sequence time.

The panel sends the eligible audio items as `{"path", "start", "end", "at", "name", "track"}`: media in/out seconds,
the sequence second where the item starts and its audio track. Here every item is read, its channels are reduced to
one using the same classification as Fix audio (a one-sided clip uses its sound side, two microphones are
summed, anything else is averaged) and placed at its sequence time. Source files are only read.

Duplicates: several cameras and microphones hear the same speech. Recognising the noisiest copy gives wrong words
(measured on the Ludi Glavi test: a far camera microphone at -44 dBFS gave „Природа на мен“, the close microphone
of the other camera gave „Примерно на мен“). So items that overlap in time AND follow the same loudness envelope are
duplicates of each other, and the cleanest one is used (speech level over noise floor); only where it covers the same
seconds. The part of a weaker item that the winner does not cover is kept: it is speech nobody else heard.
"""
from __future__ import annotations

from typing import Callable

import numpy as np
from scipy import signal

from . import audio
from .sync import Cancelled

ASR_SR = 16000
_DECIM = audio.SR // ASR_SR          # 48000 -> 16000
ENV_HOP = 160                        # 10 ms envelope frames at 16 kHz
SAME_SPEECH = 0.5                    # envelope correlation from which two overlapping items are the same speech
MIN_OVERLAP = 0.5                    # share of the shorter item that must overlap in time
MAX_LAG_S = 0.25                     # the cameras are synced by audio, but a few frames of difference are normal
SNR_MARGIN_DB = 3.0                  # within this, the lower track wins (stable, predictable)
QUIET_DB = -50.0                     # a speech level below this is penalised: far away or almost silent


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


def _envelope(y: np.ndarray) -> np.ndarray:
    """Linear RMS in 10 ms frames."""
    n = len(y) // ENV_HOP
    if n == 0:
        return np.zeros(0)
    return np.sqrt(np.mean(np.square(y[: n * ENV_HOP].reshape(n, ENV_HOP).astype(np.float64)), axis=1))


def quality(env: np.ndarray) -> dict:
    """Speech level (90th percentile of the frame levels), noise floor (10th) and their difference in dB."""
    if len(env) < 5:
        return {"level_db": -120.0, "floor_db": -120.0, "snr_db": 0.0, "score": -200.0}
    db = 20 * np.log10(env + 1e-6)
    level, floor = float(np.percentile(db, 90)), float(np.percentile(db, 10))
    snr = level - max(floor, level - 70.0)
    score = snr - max(0.0, QUIET_DB - level)               # a very quiet copy loses even when it looks clean
    return {"level_db": round(level, 1), "floor_db": round(floor, 1), "snr_db": round(snr, 1), "score": round(score, 1)}


def same_speech(a: dict, b: dict) -> bool:
    """Do two items that overlap in sequence time follow the same loudness envelope? (Two cameras hearing one
    speaker do; two different people talking at once do not.)"""
    t0, t1 = max(a["at"], b["at"]), min(a["at"] + a["dur"], b["at"] + b["dur"])
    shorter = min(a["dur"], b["dur"])
    if t1 - t0 < MIN_OVERLAP * shorter or t1 - t0 < 0.3:
        return False
    fa, fb = int(round((t0 - a["at"]) * 100)), int(round((t0 - b["at"]) * 100))
    n = int((t1 - t0) * 100)
    lag = int(MAX_LAG_S * 100)
    n = min(n, len(a["env"]) - fa, len(b["env"]) - fb)
    if n < 20:
        return False
    best = 0.0
    for k in range(-lag, lag + 1):
        sa, sb = fa + max(k, 0), fb + max(-k, 0)
        m = min(n - abs(k), len(a["env"]) - sa, len(b["env"]) - sb)
        if m < 20:
            continue
        x, y = a["env"][sa:sa + m], b["env"][sb:sb + m]
        if x.std() < 1e-6 or y.std() < 1e-6:                 # silence has no envelope to compare
            continue
        best = max(best, float(np.corrcoef(x, y)[0, 1]))
    return best >= SAME_SPEECH


def _groups(parts: list[dict]) -> list[list[int]]:
    parent = list(range(len(parts)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(len(parts)):
        for j in range(i + 1, len(parts)):
            if same_speech(parts[i], parts[j]):
                parent[find(i)] = find(j)
    out: dict[int, list[int]] = {}
    for i in range(len(parts)):
        out.setdefault(find(i), []).append(i)
    return list(out.values())


def _winner(parts: list[dict], group: list[int]) -> int:
    """Cleanest item; within SNR_MARGIN_DB of the best, the lowest track (then the earliest item)."""
    top = max(parts[i]["q"]["score"] for i in group)
    close = [i for i in group if parts[i]["q"]["score"] >= top - SNR_MARGIN_DB]
    return min(close, key=lambda i: (parts[i]["track"], parts[i]["at"]))


def build_mix(items: list[dict], progress: Callable[[float, str], None] | None = None,
              cancelled: Callable[[], bool] | None = None) -> dict:
    """-> {"audio": float32 @16 kHz, "origin": sequence second of sample 0, "notes": [...], "duplicates": [...],
    "segments": [{path, name, track, start, end, at}]} (the pieces that are used, in sequence order).

    The buffer starts at the earliest item that is used, not at sequence 0, so a long silent lead-in costs no
    recognition time.
    """
    progress = progress or (lambda f, m: None)
    cancelled = cancelled or (lambda: False)
    parts: list[dict] = []
    notes: list[dict] = []
    for i, it in enumerate(items):
        if cancelled():
            raise Cancelled()
        name = it.get("name") or it["path"]
        progress(i / max(len(items), 1), f"Reading the sound: {name}")
        x = audio.read_range(it["path"], float(it["start"]), float(it["end"]))
        if x.shape[1] == 0:
            notes.append({"name": name, "kind": "empty", "note": "no sound in the selected part"})
            continue
        c = audio.classify(x)
        y = signal.resample_poly(mono_for_asr(x, c), 1, _DECIM).astype(np.float32)
        env = _envelope(y)
        parts.append({"name": name, "path": it["path"], "start": float(it["start"]), "at": float(it["at"]), "y": y, "env": env,
                      "dur": len(y) / ASR_SR,
                      "track": int(it.get("track", 0)), "q": quality(env), "kind": c["kind"], "action": c["action"]})
    if not parts:
        raise ValueError("The selected clips have no sound to recognise.")

    duplicates: list[dict] = []
    keep: list[tuple[float, np.ndarray]] = []            # (sequence start, samples) of everything that is used
    segments: list[dict] = []                            # the same pieces as media ranges, for per-piece recognition

    def segment(p, a, b):                                # samples a..b of part p (speed 1, so media time = item time)
        segments.append({"path": p["path"], "name": p["name"], "track": p["track"],
                         "start": p["start"] + a / ASR_SR, "end": p["start"] + b / ASR_SR, "at": p["at"] + a / ASR_SR})

    for group in _groups(parts):
        win = _winner(parts, group)
        w = parts[win]
        keep.append((w["at"], w["y"]))
        segment(w, 0, len(w["y"]))
        for i in group:
            if i == win:
                continue
            p = parts[i]
            # keep what the winner does not cover: speech that no other microphone heard
            lo, hi = int(round((w["at"] - p["at"]) * ASR_SR)), int(round((w["at"] + w["dur"] - p["at"]) * ASR_SR))
            lo, hi = max(0, min(lo, len(p["y"]))), max(0, min(hi, len(p["y"])))
            rest = 0
            for a, b in ((0, lo), (hi, len(p["y"]))):
                if b - a > ASR_SR * 0.3:
                    keep.append((p["at"] + a / ASR_SR, p["y"][a:b]))
                    segment(p, a, b)
                    rest += b - a
            duplicates.append({"dropped": p["name"], "kept": w["name"], "dropped_snr_db": p["q"]["snr_db"],
                               "kept_snr_db": w["q"]["snr_db"], "dropped_level_db": p["q"]["level_db"],
                               "kept_level_db": w["q"]["level_db"], "kept_rest_seconds": round(rest / ASR_SR, 2)})
    for p in parts:
        notes.append({"name": p["name"], "kind": p["kind"], "action": p["action"], "at": round(p["at"], 3),
                      "seconds": round(p["dur"], 3), **p["q"]})

    origin = min(at for at, _ in keep)
    length = max(int(round((at - origin) * ASR_SR)) + len(y) for at, y in keep)
    buf = np.zeros(length, dtype=np.float32)
    for at, y in keep:
        o = int(round((at - origin) * ASR_SR))
        buf[o:o + len(y)] += y
    np.clip(buf, -1.0, 1.0, out=buf)
    segments.sort(key=lambda sg: sg["at"])
    return {"audio": buf, "origin": origin, "notes": notes, "duplicates": duplicates, "segments": segments}


def read_segment(seg: dict, pad: float) -> tuple[np.ndarray, float]:
    """One piece as 16 kHz mono with up to `pad` seconds of the real media on each side. Whisper reads speech better
    with its surroundings than in a clip cut in the middle of a sentence (measured: „и аз да видим“ and „Приведно на
    мен“ from the joined cuts, „я да видим“ and „Примерно на мен“ from the same pieces with 2 s around them).
    Returns (samples, seconds of lead-in actually available before the piece)."""
    a = max(0.0, seg["start"] - pad)
    x = audio.read_range(seg["path"], a, seg["end"] + pad)
    y = signal.resample_poly(mono_for_asr(x, audio.classify(x)), 1, _DECIM).astype(np.float32)
    return y, seg["start"] - a
