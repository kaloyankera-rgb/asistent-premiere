"""Word-level timing for subtitles: Whisper words -> times of the actual pronunciation (optional step).

The alignment runs in a separate Python environment (`<app>/venv-align`, torch + torchaudio, about 0.9 GB) with the
MMS_FA weights (about 1.2 GB in `<app>/models/torch`), installed only on the user's request by
`scripts/setup_mac.sh --align`. Without them, or when anything fails, the words keep Whisper's times and the job says
so: subtitles never fail because of the alignment.
"""
from __future__ import annotations

import glob
import json
import logging
import os
import subprocess
import sys
import tempfile

import numpy as np

from . import config, numbers

log = logging.getLogger("asistent")
REVISION = 4             # bump when the placement of aligned/weak words changes: cached alignments are redone (recognition is kept)
MIN_SECONDS_PER_CHAR = 0.02   # a CTC frame is 20 ms
WEAK = 0.3            # an alignment score below this is not trusted: the word keeps Whisper's time
TIMEOUT = 600


def python_path() -> str:
    env = os.environ.get("ASISTENT_ALIGN_PYTHON")
    if env:
        return env
    sub = os.path.join("Scripts", "python.exe") if sys.platform == "win32" else os.path.join("bin", "python")
    return os.path.join(config.app_dir(), "venv-align", sub)


def torch_home() -> str:
    return os.environ.get("ASISTENT_ALIGN_HOME") or os.path.join(config.app_dir(), "models", "torch")


def available() -> bool:
    return os.path.isfile(python_path()) and bool(glob.glob(os.path.join(torch_home(), "hub", "checkpoints", "*.pt")))


def status() -> dict:
    return {"available": available(), "python": python_path(), "weights": torch_home()}


def _squeezed(r: dict) -> bool:
    """Did the aligner find no room for the word? A word needs at least a frame (20 ms) for most of its letters; a word
    squeezed into less is not where it was said (the corrected „трябваше“: 8 letters in 0.10 s)."""
    chars = r.get("chars")
    return bool(chars) and (r["end"] - r["start"]) < MIN_SECONDS_PER_CHAR * chars


def _fix(words: list[dict], res: list[dict]) -> tuple[list[dict], int]:
    """Apply the aligner's answer. A word keeps the aligner's time unless it has no letters to align or was squeezed
    into too little time while scoring low; those keep Whisper's time (then fitted between their aligned neighbours).
    The aligner's confidence is NOT a reason to distrust a time: measured on the C9025 prices, words scored under 0.1
    (every number) were within 80 ms of the sound 57 % of the time, Whisper's own times 7 %."""
    out, weak = [], 0
    for w, r in zip(words, res):
        v = dict(w)
        if r["start"] is None or (r["align"] < WEAK and _squeezed(r)):
            weak += 1
            v["aligned"] = False
        else:
            v.update(start=r["start"], end=max(r["end"], r["start"]), aligned=True)
        if r["start"] is not None:
            v["align"] = r["align"]
        out.append(v)
    for i in range(1, len(out)):                            # never earlier than the word before it
        if out[i]["start"] < out[i - 1]["start"]:
            out[i]["start"] = out[i - 1]["start"]
            out[i]["end"] = max(out[i]["end"], out[i]["start"])
    # A weak word is fitted between its well-aligned neighbours: it never starts before the aligned word before it ends
    # or ends after the aligned word after it starts (seen: a corrected „трябваше“ that the aligner could not find
    # started 80 ms inside „стена“).
    for i, w in enumerate(out):
        if w["aligned"]:
            continue
        if i and out[i - 1]["aligned"]:
            w["start"] = max(w["start"], out[i - 1]["end"])
        if i + 1 < len(out) and out[i + 1]["aligned"]:
            w["start"] = min(w["start"], out[i + 1]["start"])
            w["end"] = min(w["end"], out[i + 1]["start"])
        w["end"] = max(w["end"], w["start"])
    return out, weak


def align_words(audio: np.ndarray, words: list[dict], spoken: dict | None = None) -> tuple[list[dict], dict]:
    """words: [{"word", "start", "end", "p"}] relative to `audio` (16 kHz mono). Returns (words, info) with
    info = {"aligned": n, "weak": n} or {"error": text}; the words are the input ones when nothing could be done."""
    if not words:
        return words, {"aligned": 0, "weak": 0}
    if not available():
        return words, {"error": "the aligner is not installed"}
    worker = os.path.join(os.path.dirname(os.path.abspath(__file__)), "align_worker.py")
    with tempfile.TemporaryDirectory(prefix="asistent-align-") as d:
        np.save(os.path.join(d, "audio.npy"), audio.astype(np.float32))
        with open(os.path.join(d, "words.json"), "w", encoding="utf-8") as f:
            json.dump([{"text": w["word"], "start": w["start"], "end": w["end"]} for w in words], f, ensure_ascii=False)
        with open(os.path.join(d, "spoken.json"), "w", encoding="utf-8") as f:
            json.dump({**numbers.spoken_map(words), **(spoken or {})}, f, ensure_ascii=False)     # the editor's entries win
        env = dict(os.environ, TORCH_HOME=torch_home(), PYTHONNOUSERSITE="1")
        try:
            p = subprocess.run([python_path(), "-I", worker, d], capture_output=True, timeout=TIMEOUT, env=env)
            if p.returncode != 0:
                raise RuntimeError(p.stderr.decode(errors="replace").strip().splitlines()[-1][:200])
            with open(os.path.join(d, "out.json"), encoding="utf-8") as f:
                res = json.load(f)
        except Exception as e:                              # noqa: BLE001 - any failure falls back to Whisper's times
            log.warning("alignment failed, Whisper times kept: %s", e)
            return words, {"error": str(e)[:200]}
    fixed, weak = _fix(words, res)
    return fixed, {"aligned": len(fixed) - weak, "weak": weak}


QUIET_AT = 0.40           # "essentially silent": below this share of the way from the noise floor (10th percentile)
VOICED_AT = 0.60          # "the voice is there": above this share, up to the speech level (90th percentile)


def trim_silence(y: np.ndarray, words: list[dict], sr: int = 16000) -> tuple[list[dict], int]:
    """Times of words (seconds in `y`) -> times with the edges moved out of silence, and how many edges moved.

    A word cannot be spoken in silence. If the first 150 ms of a word are all essentially silent (below 40 % of the way
    from the noise floor to the speech level) its start moves to the first frame where the voice is (above 60 %), within
    0.5 s; the same for the last 100 ms and the end. The thresholds follow the recording, because a quiet microphone
    has a smaller gap. Seen on the real clip: the aligner put „Ей,“ at 11.52 s, the voice starts at 11.78 s (-57 dB
    before it, -24 dB after). Words in continuous speech and soft consonants are not touched: they are not silent."""
    hop = sr // 100
    n = len(y) // hop
    out = [dict(w) for w in words]
    if n < 20:
        return out, 0
    env = np.sqrt(np.mean(np.square(y[: n * hop].astype(np.float64)).reshape(n, hop), axis=1))
    db = 20 * np.log10(env + 1e-6)
    level, floor = float(np.percentile(db, 90)), float(np.percentile(db, 10))
    if level - floor < 20:                                  # no clear speech/silence contrast to judge by
        return out, 0
    quiet, voiced = floor + QUIET_AT * (level - floor), floor + VOICED_AT * (level - floor)
    moved = 0
    for i, w in enumerate(out):
        a, b = int(round(w["start"] * 100)), int(round(w["end"] * 100))
        if a < 0 or b > n or b - a < 8:
            continue
        if db[a:min(a + 15, b)].max() < quiet:
            k = next((j for j in range(a, min(a + 50, b - 4)) if db[j] > voiced and db[j + 1] > voiced), None)
            if k is not None and k - a >= 5 and (i == 0 or k / 100 >= out[i - 1]["start"]):
                w["start"] = round(k / 100, 3)
                moved += 1
        a = int(round(w["start"] * 100))
        if b - a >= 8 and db[max(b - 10, a):b].max() < quiet:
            k = next((j for j in range(b - 1, max(a + 3, b - 50), -1) if db[j] > voiced and db[j - 1] > voiced), None)
            if k is not None and b - (k + 1) >= 10:
                w["end"] = round((k + 1) / 100, 3)
                moved += 1
    return out, moved


def speech_frames(y: np.ndarray, sr: int = 16000, share: float = 0.5) -> np.ndarray:
    """Boolean per 10 ms frame: loud enough (above `share` of the way from the noise floor to the speech level) AND
    speech-like (spectral centroid under 1800 Hz; noise, hiss and breath sit higher). Empty for too little audio."""
    hop, n = sr // 100, len(y) // (sr // 100)
    if n < 20:
        return np.zeros(0, bool)
    x = y[: n * hop].astype(np.float64)
    db = 20 * np.log10(np.sqrt(np.mean(x.reshape(n, hop) ** 2, axis=1)) + 1e-6)
    level, floor = float(np.percentile(db, 90)), float(np.percentile(db, 10))
    if level - floor < 20:
        return np.zeros(0, bool)
    pad = np.concatenate([np.zeros(hop), x, np.zeros(2 * hop)])
    frames = np.stack([pad[i * hop: i * hop + 3 * hop] for i in range(n)]) * np.hanning(3 * hop)
    power = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    freqs = np.fft.rfftfreq(3 * hop, 1 / sr)
    centroid = (power * freqs).sum(axis=1) / (power.sum(axis=1) + 1e-12)
    return (db > floor + share * (level - floor)) & (centroid < 1800)


MIN_SPEECH_FRAMES = 5       # 50 ms of speech-like sound under a word, or it is not clearly heard
MIN_SPEECH_SHARE = 0.15     # and, under a long span, at least this share of it (a word is mostly speech; "Така." was 8 %)
MAX_SECONDS_PER_CHAR = 0.12


def unheard(y: np.ndarray, words: list[dict], sr: int = 16000) -> tuple[list[dict], list[int]]:
    """-> (words, indexes of the words with no clear speech under them). Such a word keeps its text (deleting it would be
    a guess too) but its length is limited to what its letters can take (the aligner cannot refuse a word: „Така.“ was
    stretched over 1.3 s of breath); the caller marks it for review (guide §7: hallucination in a quiet interval)."""
    mask = speech_frames(y, sr)
    out = [dict(w) for w in words]
    bad = []
    if not len(mask):
        return out, bad
    for i, w in enumerate(out):
        a, b = max(0, int(w["start"] * 100)), min(len(mask), int(round(w["end"] * 100)) + 1)
        letters = sum(c.isalpha() for c in w["word"])
        heard = int(mask[a:b].sum()) if b > a else 0
        if letters >= 2 and b > a and (heard < MIN_SPEECH_FRAMES or (b - a >= 40 and heard < MIN_SPEECH_SHARE * (b - a))):
            bad.append(i)
            w["unheard"] = True
            w["end"] = min(w["end"], w["start"] + max(0.2, MAX_SECONDS_PER_CHAR * letters))
    return out, bad


def uncovered_speech(y: np.ndarray, words: list[dict], min_seconds: float = 0.4, margin: float = 0.15, sr: int = 16000) -> list[tuple[float, float]]:
    """Stretches of speech-like sound of at least `min_seconds` that no word covers (within `margin` of a word) ->
    [(start, end)] in seconds of `y`. A word Whisper never wrote, or a breath or hum: the guide asks for the first and
    last seconds of every piece to be checked (docs/BULGARIAN_TRANSCRIPTION_GUIDE.md §1, §7), so these are reported."""
    mask = speech_frames(y, sr, share=0.35)                 # permissive: a false alarm costs a listen, a silent miss a mistake
    if not len(mask):
        return []
    covered = np.zeros(len(mask), bool)
    for w in words:
        covered[max(0, int((w["start"] - margin) * 100)):max(0, int((w["end"] + margin) * 100) + 1)] = True
    free = mask & ~covered
    out, i = [], 0
    while i < len(free):
        if free[i]:
            j = i
            while j < len(free) and free[j]:
                j += 1
            if (j - i) / 100 >= min_seconds:
                out.append((round(i / 100, 2), round(j / 100, 2)))
            i = j
        else:
            i += 1
    return out
