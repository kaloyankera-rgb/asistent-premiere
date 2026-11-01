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
