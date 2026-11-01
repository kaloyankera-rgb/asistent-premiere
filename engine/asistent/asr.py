"""Speech recognition for subtitles (Phase 7, M2): faster-whisper large-v3, local, Bulgarian.

Adapted from tools/autoedit/asr.py (same author). Differences that matter here:
- the model lives in `<app_dir>/models/whisper` and is loaded from that folder only: a missing model is an error
  with a Bulgarian message, never a silent download (the user approves the ~3 GB download; `download_model` is a
  job started from a panel button);
- the audio comes in as a 16 kHz mono float array (PyAV breaks faster-whisper's own decoder on this install);
- progress and cancellation are per segment; one model in memory, freed after IDLE_SECONDS without use;
- the words come back as `{"word", "start", "end", "p"}`, the shape `subtitles.build_captions` takes.
Mac: CPU int8 (CTranslate2 has no Metal backend). Windows with an NVIDIA GPU: CUDA float16, CPU int8 as fallback.
"""
from __future__ import annotations

import glob
import importlib.util
import logging
import os
import threading
import time
import wave
from typing import Callable

import numpy as np

from . import config
from .media import MediaError
from .sync import Cancelled

log = logging.getLogger("asistent")

MODEL_REPO = "Systran/faster-whisper-large-v3"                  # MIT; the CTranslate2 conversion of OpenAI's large-v3
MODEL_FILES = ("config.json", "preprocessor_config.json", "tokenizer.json", "vocabulary.json", "model.bin")
MODEL_BYTES = 3_100_000_000                                      # about 3.1 GB, for the progress bar and the confirm text
IDLE_SECONDS = 600
LANGUAGE = "bg"

_lock = threading.Lock()
_state: dict = {"model": None, "device": None, "last": 0.0, "timer": None}


class ASRError(MediaError):
    """A problem the user can act on (no backend, no model): shown as the job's message."""


def model_dir() -> str:
    return os.path.join(config.app_dir(), "models", "whisper")


def backend_installed() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


def model_present() -> bool:
    d = model_dir()
    return all(os.path.isfile(os.path.join(d, f)) for f in MODEL_FILES)


def model_status() -> dict:
    """What the panel shows before it offers the install: backend, model, size on disk, where, what it would run on."""
    d = model_dir()
    size = sum(os.path.getsize(p) for p in glob.glob(os.path.join(d, "**", "*"), recursive=True) if os.path.isfile(p))
    return {"backend": backend_installed(), "model": model_present(), "dir": d, "bytes": size,
            "expected_bytes": MODEL_BYTES, "device": _device()[0] if backend_installed() else None}


def read_wav(path: str) -> np.ndarray:
    """16 kHz mono wav from ffmpeg -> float32 in -1..1."""
    with wave.open(path, "rb") as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1:
            raise ASRError("Звукът за разпознаване трябва да е 16 kHz, моно.")
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def _cuda_dlls() -> None:
    # cuBLAS and cuDNN come from the pip packages nvidia-cublas-cu12 / nvidia-cudnn-cu12; Windows looks in PATH
    try:
        import nvidia
    except ImportError:
        return
    for d in glob.glob(os.path.join(os.path.dirname(nvidia.__path__[0]), "nvidia", "*", "bin")):
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(d)
        os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]


def _device() -> tuple[str, str]:
    """(device, compute type): CUDA float16 when CTranslate2 sees a GPU, otherwise the CPU in int8."""
    try:
        _cuda_dlls()
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def _load():
    if not backend_installed():
        raise ASRError("Липсват пакетите за разпознаване на реч (faster-whisper). Инсталират се от панела или със "
                       "setup_mac.sh --subtitles.")
    if not model_present():
        raise ASRError("Моделът за разпознаване (large-v3, около 3 GB) още не е свален. Свали го от панела.")
    if _state["model"] is not None:
        return _state["model"]
    from faster_whisper import WhisperModel
    device, compute = _device()
    t0 = time.time()
    try:
        model = WhisperModel(model_dir(), device=device, compute_type=compute)
    except Exception:
        if device == "cpu":
            raise
        device, compute = "cpu", "int8"             # no usable CUDA libraries: the processor
        model = WhisperModel(model_dir(), device=device, compute_type=compute)
    log.info("whisper large-v3 loaded on %s/%s in %.1fs", device, compute, time.time() - t0)
    _state.update(model=model, device=device)
    return model


def _schedule_free() -> None:
    def free():
        with _lock:
            if _state["model"] is not None and time.time() - _state["last"] >= IDLE_SECONDS - 1:
                _state.update(model=None, device=None)
                log.info("whisper model freed after %d s idle", IDLE_SECONDS)
    if _state["timer"]:
        _state["timer"].cancel()
    _state["timer"] = threading.Timer(IDLE_SECONDS, free)
    _state["timer"].daemon = True
    _state["timer"].start()


def transcribe(audio: np.ndarray, prompt: str | None = None, progress: Callable[[float, str], None] | None = None,
               cancelled: Callable[[], bool] | None = None, language: str = LANGUAGE) -> list[dict]:
    """Words with times (seconds from the start of `audio`) and Whisper's probability. One transcription at a time
    (a second caller waits): the model is big and the CPU is shared with the editor."""
    progress = progress or (lambda f, m: None)
    cancelled = cancelled or (lambda: False)
    duration = max(len(audio) / 16000.0, 0.001)
    with _lock:
        progress(0.0, "Зареждам модела…")
        model = _load()
        if cancelled():
            raise Cancelled()
        segments, _ = model.transcribe(audio, language=language, word_timestamps=True, vad_filter=False, beam_size=5,
                                       initial_prompt=prompt or None)
        words: list[dict] = []
        for seg in segments:                                   # a generator: the work happens here, segment by segment
            if cancelled():
                raise Cancelled()
            for w in seg.words or []:
                if w.word.strip():
                    words.append({"word": w.word.strip(), "start": round(float(w.start), 3), "end": round(float(w.end), 3),
                                  "p": round(float(w.probability), 2)})
            progress(min(seg.end / duration, 1.0), "Разпознавам речта…")
        _state["last"] = time.time()
        _schedule_free()
    return words


def download_model(progress: Callable[[float, str], None], cancelled: Callable[[], bool]) -> dict:
    """Download the model into `model_dir()` (resumable: a cancelled or broken download continues next time).
    Only ever called from the user's confirmed panel button; progress follows the bytes on disk."""
    if not backend_installed():
        raise ASRError("Първо трябва да са инсталирани пакетите за разпознаване на реч (faster-whisper).")
    from huggingface_hub import snapshot_download
    d = model_dir()
    os.makedirs(d, exist_ok=True)
    err: list[BaseException] = []

    def run():
        try:
            snapshot_download(MODEL_REPO, local_dir=d, allow_patterns=list(MODEL_FILES))
        except BaseException as e:                              # noqa: BLE001 - reported to the job below
            err.append(e)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    while t.is_alive():
        if cancelled():
            raise Cancelled()                                   # the part file stays and resumes later
        have = model_status()["bytes"]
        progress(min(have / MODEL_BYTES, 0.99), f"Свалям модела: {have / 1e9:.1f} от около {MODEL_BYTES / 1e9:.1f} GB")
        time.sleep(1.0)
    if err:
        raise ASRError(f"Свалянето не стана: {err[0]}")
    if not model_present():
        raise ASRError("Свалянето приключи, но липсват файлове на модела.")
    log.info("whisper model downloaded to %s", d)
    return model_status()
