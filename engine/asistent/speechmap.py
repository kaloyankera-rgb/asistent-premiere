"""Speech map (Phase 8 M1): a label for every 10 ms of the dialogue mix.

    WORD    inside a recognised word (padded)
    VOICED  no word, but the energy is above the speech threshold AND Silero hears speech: laughter, a reaction, a
            quiet word Whisper missed, "ъъ". Never cut automatically.
    LOW     something above the noise floor that is neither of the above (breath, room, a click)
    SILENT  no word, energy below the speech threshold, Silero under its low mark: all three signals agree

The energy threshold is cutcheck.py's rule (tools/autoedit, used on real work): the floor is the 5th percentile of the
frame levels (in a recording that is nearly all speech the 10th is already speech), the voice is the median of the
frames at least 4 times above the floor, and speech starts at 23 % of the voice level.
"""
from __future__ import annotations

import numpy as np

from . import vad

SR = 16000
HOP = 160                     # 10 ms
HOP_S = HOP / SR
SILENT, LOW, VOICED, WORD = 0, 1, 2, 3
SPEECH_RATIO = 0.23
WORD_PAD = (0.04, 0.06)       # seconds added before and after a word: Whisper's edges are off by up to 0.3 s
VAD_VOICED = 0.35             # Silero at least this = speech
VAD_SILENT = 0.20             # Silero under this = no speech
MIN_FLOOR = 1e-5              # an all-zero stretch (no item there) must not make the floor 0


def envelope(y: np.ndarray) -> np.ndarray:
    """Linear RMS per 10 ms."""
    n = len(y) // HOP
    if n == 0:
        return np.zeros(0)
    return np.sqrt(np.mean(np.square(y[:n * HOP].reshape(n, HOP).astype(np.float64)), axis=1))


def thresholds(env: np.ndarray) -> dict:
    if not len(env):
        return {"floor": MIN_FLOOR, "voice": MIN_FLOOR, "speech": MIN_FLOOR}
    floor = max(float(np.percentile(env, 5)), MIN_FLOOR)
    loud = env[env > floor * 4]
    voice = float(np.median(loud)) if len(loud) else floor * 4
    return {"floor": floor, "voice": voice, "speech": max(floor * 3, voice * SPEECH_RATIO)}


def coverage(sound: list[tuple[float, float]] | None, origin: float, n: int) -> np.ndarray:
    """Which 10 ms frames some selected sound clip covers (everything when `sound` is None)."""
    cov = np.ones(n, dtype=bool)
    if sound is not None:
        cov[:] = False
        for a, b in sound:
            i0, i1 = int(np.floor((a - origin) / HOP_S + 1e-6)), int(np.ceil((b - origin) / HOP_S - 1e-6))
            cov[max(i0, 0):max(min(i1, n), 0)] = True
    return cov


def build(y: np.ndarray, words: list[dict], origin: float, probs: np.ndarray | None = None,
          sound: list[tuple[float, float]] | None = None) -> dict:
    """y: the mix (16 kHz, first sample at sequence second `origin`); words: [{"start","end"}] in sequence seconds.
    -> {"labels": uint8 per 10 ms, "env", "thr", "vad": bool, "origin"}"""
    env = envelope(y)
    n = len(env)
    # the levels are read from the sound that is there: time with no clip (zeros) must not drag the floor and the voice down
    thr = thresholds(env[coverage(sound, origin, n)] if sound is not None else env)
    if probs is None:
        probs = vad.probabilities(y)
    p = vad.per_frame(probs, n)
    loud = env >= thr["speech"]
    if p is None:                                  # no Silero: the energy alone has to agree with itself
        voiced = loud & (env >= thr["speech"] * 1.5)
        silent = ~loud
    else:
        voiced = loud & (p >= VAD_VOICED)
        silent = (~loud) & (p < VAD_SILENT)
    labels = np.full(n, LOW, dtype=np.uint8)
    labels[silent] = SILENT
    labels[voiced] = VOICED
    for w in words:
        a = int(np.floor((w["start"] - WORD_PAD[0] - origin) / HOP_S))
        b = int(np.ceil((w["end"] + WORD_PAD[1] - origin) / HOP_S))
        a, b = max(a, 0), min(b, n)
        if b > a:
            labels[a:b] = WORD
    if sound is not None:
        # a word's padding must not reach over the edge of its clip: there is nothing there to protect, and it left 1-2
        # frame gaps between clips (the user's 2026-11-03 test)
        labels[~coverage(sound, origin, n)] = SILENT
    return {"labels": labels, "env": env, "thr": thr, "vad": p is not None, "origin": origin}


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, end) of every run of True."""
    if not len(mask):
        return []
    d = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    return list(zip(np.flatnonzero(d == 1).tolist(), np.flatnonzero(d == -1).tolist()))
