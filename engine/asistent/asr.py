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

_lock = threading.Lock()                   # loading and freeing the model
_state: dict = {"model": None, "device": None, "workers": 1, "last": 0.0, "timer": None}


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
            raise ASRError("The sound for recognition must be 16 kHz mono.")
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


def _parallelism(device: str) -> tuple[int, int]:
    """(readings at the same time, CPU threads for each). One reading cannot use many cores (measured on the M4 Max:
    10 threads were SLOWER than 4), but several readings together can: 4 workers x 2 threads read 68 s of audio in 18 s,
    one reading with 4 threads in 38 s. 0.10.2, cold runs on the M4 Max: 3 x 4 beat 5 x 2 (ReShape, one 91 s window and four
    second opinions: 163 -> 130 s; Beauty Sector, two windows: 74 -> 53 s); the thread count does not change the words
    (2, 4 and 8 threads gave identical readings). A GPU takes one reading at a time."""
    if device != "cpu":
        return 1, 0
    cores = os.cpu_count() or 4
    if cores >= 12:
        return 3, 4                                        # M4 Max: 10 performance cores (+4 efficiency), 3 x 4 threads
    if cores >= 10:
        return 4, 2
    if cores >= 6:
        return 2, 3
    return 1, max(2, cores // 2)


def workers() -> int:
    """How many windows can be read at the same time (the job reads that many in parallel)."""
    return _parallelism(_device()[0])[0]


def _load():
    if not backend_installed():
        raise ASRError("The speech recognition packages (faster-whisper) are missing. They are installed from the panel or with "
                       "setup_mac.sh --subtitles.")
    if not model_present():
        raise ASRError("The recognition model (large-v3, about 3 GB) is not downloaded yet. Download it from the panel.")
    with _lock:
        if _state["model"] is not None:
            return _state["model"]
        from faster_whisper import WhisperModel
        device, compute = _device()
        n, threads = _parallelism(device)
        t0 = time.time()
        try:
            model = WhisperModel(model_dir(), device=device, compute_type=compute, num_workers=n, cpu_threads=threads)
        except Exception:
            if device == "cpu":
                raise
            device, compute = "cpu", "int8"         # no usable CUDA libraries: the processor
            n, threads = _parallelism(device)
            model = WhisperModel(model_dir(), device=device, compute_type=compute, num_workers=n, cpu_threads=threads)
        log.info("whisper large-v3 loaded on %s/%s (%d readings x %d threads) in %.1fs", device, compute, n, threads, time.time() - t0)
        _state.update(model=model, device=device, workers=n)
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
               cancelled: Callable[[], bool] | None = None, language: str = LANGUAGE, beam: int = 5) -> list[dict]:
    """Words with times (seconds from the start of `audio`) and Whisper's probability. Callers may run in parallel up to
    `workers()`; more wait their turn inside the model."""
    progress = progress or (lambda f, m: None)
    cancelled = cancelled or (lambda: False)
    duration = max(len(audio) / 16000.0, 0.001)
    progress(0.0, "Loading the model…")
    model = _load()
    if cancelled():
        raise Cancelled()
    segments, _ = model.transcribe(audio, language=language, word_timestamps=True, vad_filter=False, beam_size=beam,
                                   initial_prompt=prompt or None)
    words: list[dict] = []
    for seg in segments:                                   # a generator: the work happens here, segment by segment
        if cancelled():
            raise Cancelled()
        for w in seg.words or []:
            if w.word.strip():
                words.append({"word": w.word.strip(), "start": round(float(w.start), 3), "end": round(float(w.end), 3),
                              "p": round(float(w.probability), 2)})
        progress(min(seg.end / duration, 1.0), "Recognising the speech…")
    _state["last"] = time.time()
    _schedule_free()
    return words


def score_texts(audio: np.ndarray, texts: list[str], language: str = LANGUAGE) -> list[float]:
    """How well each text fits the same audio (at most 30 s): the sum of the log probabilities Whisper gives its tokens
    when it is made to read that text (CTranslate2 `align`, the call faster-whisper times words with). Only differences
    between texts for the same audio mean anything. Measured 2026-11-04 on 26 fixes (audiocheck.py): Whisper prefers its
    own spelling, so a fix scores a little lower or higher, a wrong word several points lower."""
    from faster_whisper.audio import pad_or_trim
    from faster_whisper.tokenizer import Tokenizer
    model = _load()
    tok = Tokenizer(model.hf_tokenizer, True, task="transcribe", language=language)
    feats = model.feature_extractor(audio.astype(np.float32))
    frames = min(feats.shape[-1], model.feature_extractor.nb_max_frames)
    enc = model.encode(pad_or_trim(feats))
    out = []
    for text in texts:
        res = model.model.align(enc, tok.sot_sequence, [tok.encode(" " + text.strip())], frames // 2)
        out.append(float(np.log(np.maximum(np.asarray(res[0].text_token_probs, dtype=np.float64), 1e-9)).sum()))
    _state["last"] = time.time()
    _schedule_free()
    return out


def download_model(progress: Callable[[float, str], None], cancelled: Callable[[], bool]) -> dict:
    """Download the model into `model_dir()` (resumable: a cancelled or broken download continues next time).
    Only ever called from the user's confirmed panel button; progress follows the bytes on disk."""
    if not backend_installed():
        raise ASRError("The speech recognition packages (faster-whisper) must be installed first.")
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
        progress(min(have / MODEL_BYTES, 0.99), f"Downloading the model: {have / 1e9:.1f} of about {MODEL_BYTES / 1e9:.1f} GB")
        time.sleep(1.0)
    if err:
        raise ASRError(f"The download failed: {err[0]}")
    if not model_present():
        raise ASRError("The download finished, but model files are missing.")
    log.info("whisper model downloaded to %s", d)
    return model_status()
