"""Silero VAD (Phase 8): the probability that each 32 ms of a 16 kHz signal is speech.

The ONNX model (MIT, about 2 MB) ships inside faster-whisper, which Asistent already installs for the subtitles, and
runs on onnxruntime, which comes with it: nothing new is downloaded. The rough cut uses it only as a VETO on cutting
(speechmap.py): a stretch is never cut while Silero hears speech in it. Without the model the rough cut still works
from the words and the energy, and says so.
"""
from __future__ import annotations

import logging

import numpy as np

log = logging.getLogger("asistent")
CHUNK = 512                       # samples per probability at 16 kHz (32 ms)
_model = None
_failed = False


def _load():
    global _model, _failed
    if _model is None and not _failed:
        try:
            from faster_whisper.vad import get_vad_model
            _model = get_vad_model()
        except Exception as e:               # no faster-whisper / onnxruntime / asset
            _failed = True
            log.warning("vad: Silero not available (%s); the rough cut uses words and energy only", e)
    return _model


def available() -> bool:
    return _load() is not None


def probabilities(y: np.ndarray) -> np.ndarray | None:
    """One value in 0..1 per 32 ms, or None when Silero is not available."""
    model = _load()
    if model is None or len(y) == 0:
        return None
    n = -(-len(y) // CHUNK) * CHUNK
    padded = np.zeros(n, dtype=np.float32)
    padded[:len(y)] = y
    return np.asarray(model(padded), dtype=np.float32).reshape(-1)


def per_frame(prob: np.ndarray | None, frames: int, hop_s: float = 0.01) -> np.ndarray | None:
    """The 32 ms probabilities on the speech map's grid (one value per `hop_s`, the chunk that contains it)."""
    if prob is None:
        return None
    idx = np.minimum((np.arange(frames) * hop_s * 16000 / CHUNK).astype(int), len(prob) - 1)
    return prob[idx]
