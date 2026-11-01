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

from . import config

log = logging.getLogger("asistent")
REVISION = 2             # bump when the placement of aligned/weak words changes: cached alignments are redone (recognition is kept)
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


def _fix(words: list[dict], res: list[dict]) -> tuple[list[dict], int]:
    """Apply the aligner's answer: weak or letter-less words keep Whisper's time; the order stays monotonic."""
    out, weak = [], 0
    for w, r in zip(words, res):
        v = dict(w)
        if r["start"] is None or r["align"] < WEAK:
            weak += 1
            v["aligned"] = False
        else:
            v.update(start=r["start"], end=max(r["end"], r["start"]), aligned=True, align=r["align"])
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
        return words, {"error": "подравняването не е инсталирано"}
    worker = os.path.join(os.path.dirname(os.path.abspath(__file__)), "align_worker.py")
    with tempfile.TemporaryDirectory(prefix="asistent-align-") as d:
        np.save(os.path.join(d, "audio.npy"), audio.astype(np.float32))
        with open(os.path.join(d, "words.json"), "w", encoding="utf-8") as f:
            json.dump([{"text": w["word"], "start": w["start"], "end": w["end"]} for w in words], f, ensure_ascii=False)
        with open(os.path.join(d, "spoken.json"), "w", encoding="utf-8") as f:
            json.dump(spoken or {}, f, ensure_ascii=False)
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
