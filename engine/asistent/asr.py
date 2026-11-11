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

from . import config, pins
from .media import MediaError
from .sync import Cancelled

log = logging.getLogger("asistent")

MODEL_REPO = "Systran/faster-whisper-large-v3"                  # MIT; the CTranslate2 conversion of OpenAI's large-v3
MODEL_FILES = ("config.json", "preprocessor_config.json", "tokenizer.json", "vocabulary.json", "model.bin")
MODEL_BYTES = 3_100_000_000                                      # about 3.1 GB, for the progress bar and the confirm text
# 0.10.40 (the user's choice 2026-11-11): large-v3-turbo for the ROUGH CUT only. Its words decide where speech is and which
# takes repeat; they are never shown and never stored where the subtitles read (roughcut_job keeps them under their own cache
# key). Same engine and files, 4 decoder layers instead of 32. Subtitles always use large-v3.
LARGE = "large-v3"
TURBO = "turbo"
MODELS = {
    LARGE: {"repo": MODEL_REPO, "folder": "whisper", "bytes": MODEL_BYTES, "label": "large-v3, about 3 GB"},
    TURBO: {"repo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo", "folder": "whisper-turbo", "bytes": 1_622_000_000,
            "label": "large-v3-turbo, about 1.6 GB"},                # MIT; faster-whisper's own "turbo" name points here
}
IDLE_SECONDS = 600
LANGUAGE = "bg"

_lock = threading.Lock()                   # loading and freeing the model
_state: dict = {"model": None, "device": None, "workers": 1, "last": 0.0, "timer": None}       # large-v3 (subtitles)
_states: dict = {LARGE: _state, TURBO: {"model": None, "device": None, "workers": 1, "last": 0.0, "timer": None}}


class ASRError(MediaError):
    """A problem the user can act on (no backend, no model): shown as the job's message."""


def model_dir(kind: str = LARGE) -> str:
    return os.path.join(config.app_dir(), "models", MODELS[kind]["folder"])


def backend_installed() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


def model_present(kind: str = LARGE) -> bool:
    d = model_dir(kind)
    return all(os.path.isfile(os.path.join(d, f)) for f in MODEL_FILES)


def model_status(kind: str = LARGE) -> dict:
    """What the panel shows before it offers the install: backend, model, size on disk, where, what it would run on."""
    d = model_dir(kind)
    size = sum(os.path.getsize(p) for p in glob.glob(os.path.join(d, "**", "*"), recursive=True) if os.path.isfile(p))
    return {"backend": backend_installed(), "model": model_present(kind), "dir": d, "bytes": size,
            "expected_bytes": MODELS[kind]["bytes"], "device": _device()[0] if backend_installed() else None}


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


CANCEL_POLL = 0.2          # s: how often a waiting reading looks at the Cancel request
# The rough cut's compression-ratio limit (0.10.45). Whisper takes a stretch whose text compresses more than 2.4 for a
# hallucination loop and reads it again at rising temperatures, up to six times. A repeated take IS repeated text: on the
# Pulse Fitness takes (2026-11-11) the limit fired on every clip with a retake (ratio 2.5-2.7) and the stretch was read six
# times, ending with the most random reading (95 -> 31 s, 51 -> 19 s for one 60 s clip; the same words or better). Real
# loops ("Благодаря. Благодаря. ...") compress far above 3.
ROUGH_COMPRESSION = 3.0


def _load(kind: str = LARGE):
    if not backend_installed():
        raise ASRError("The speech recognition packages (faster-whisper) are missing. They are installed from the panel or with "
                       "setup_mac.sh --subtitles.")
    if not model_present(kind):
        raise ASRError(f"The recognition model ({MODELS[kind]['label']}) is not downloaded yet. Download it from the panel.")
    st = _states[kind]
    with _lock:
        if st["model"] is not None:
            return st["model"]
        from faster_whisper import WhisperModel
        device, compute = _device()
        n, threads = _parallelism(device)
        t0 = time.time()
        try:
            model = WhisperModel(model_dir(kind), device=device, compute_type=compute, num_workers=n, cpu_threads=threads)
        except Exception:
            if device == "cpu":
                raise
            device, compute = "cpu", "int8"         # no usable CUDA libraries: the processor
            n, threads = _parallelism(device)
            model = WhisperModel(model_dir(kind), device=device, compute_type=compute, num_workers=n, cpu_threads=threads)
        log.info("whisper %s loaded on %s/%s (%d readings x %d threads) in %.1fs", MODELS[kind]["label"].split(",")[0], device,
                 compute, n, threads, time.time() - t0)
        st.update(model=model, device=device, workers=n)
        return model


def _schedule_free(kind: str = LARGE) -> None:
    st = _states[kind]

    def free():
        with _lock:
            if st["model"] is not None and time.time() - st["last"] >= IDLE_SECONDS - 1:
                st.update(model=None, device=None)
                log.info("whisper model %s freed after %d s idle", kind, IDLE_SECONDS)
    if st["timer"]:
        st["timer"].cancel()
    st["timer"] = threading.Timer(IDLE_SECONDS, free)
    st["timer"].daemon = True
    st["timer"].start()


def transcribe(audio: np.ndarray, prompt: str | None = None, progress: Callable[[float, str], None] | None = None,
               cancelled: Callable[[], bool] | None = None, language: str = LANGUAGE, beam: int = 5,
               model: str = LARGE, compression: float | None = None) -> list[dict]:
    """Words with times (seconds from the start of `audio`) and Whisper's probability. Callers may run in parallel up to
    `workers()`; more wait their turn inside the model. `model`: LARGE (subtitles, the default) or TURBO (rough cut only).
    `compression`: Whisper's compression-ratio limit (None = faster-whisper's 2.4, the subtitles' setting); the rough cut
    passes ROUGH_COMPRESSION (0.10.45)."""
    kind = model
    progress = progress or (lambda f, m: None)
    cancelled = cancelled or (lambda: False)
    duration = max(len(audio) / 16000.0, 0.001)
    progress(0.0, "Loading the model…")
    model = _load() if kind == LARGE else _load(kind)      # large-v3: the call exactly as before 0.10.40
    if cancelled():
        raise Cancelled()
    extra = {} if compression is None else {"compression_ratio_threshold": compression}
    box: dict = {}

    def read():
        try:
            segments, _ = model.transcribe(audio, language=language, word_timestamps=True, vad_filter=False, beam_size=beam,
                                           initial_prompt=prompt or None, **extra)
            words: list[dict] = []
            for seg in segments:                           # a generator: the work happens here, segment by segment
                if cancelled():
                    raise Cancelled()
                for w in seg.words or []:
                    if w.word.strip():
                        words.append({"word": w.word.strip(), "start": round(float(w.start), 3), "end": round(float(w.end), 3),
                                      "p": round(float(w.probability), 2)})
                progress(min(seg.end / duration, 1.0), "Recognising the speech…")
            box["words"] = words
        except BaseException as e:                         # noqa: BLE001 - handed to the caller as it is
            box["error"] = e
        finally:
            _states[kind]["last"] = time.time()
            _schedule_free(kind)

    # 0.10.45 (the user: "Cancelling doesn't work or is super slow"): one 30 s stretch of Whisper cannot be interrupted, and
    # with its temperature retries it took up to 132 s (Pulse Fitness). The reading runs in its own thread and the caller
    # waits in short steps: Cancel returns at once, and the reading stops by itself at its next stretch.
    t = threading.Thread(target=read, name="asr-read", daemon=True)
    t.start()
    while t.is_alive():
        t.join(CANCEL_POLL)
        if t.is_alive() and cancelled():
            raise Cancelled()
    if "error" in box:
        raise box["error"]
    return box["words"]


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


def download_model(progress: Callable[[float, str], None], cancelled: Callable[[], bool], kind: str = LARGE) -> dict:
    """Download the model into `model_dir()` (resumable: a cancelled or broken download continues next time).
    Only ever called from the user's confirmed panel button; progress follows the bytes on disk."""
    if not backend_installed():
        raise ASRError("The speech recognition packages (faster-whisper) must be installed first.")
    from huggingface_hub import snapshot_download
    revision, hashes = (pins.WHISPER_REVISION, pins.WHISPER_SHA256) if kind == LARGE else (pins.TURBO_REVISION, pins.TURBO_SHA256)
    expected = MODELS[kind]["bytes"]
    d = model_dir(kind)
    os.makedirs(d, exist_ok=True)
    err: list[BaseException] = []

    def run():
        try:
            snapshot_download(MODELS[kind]["repo"], local_dir=d, allow_patterns=list(MODEL_FILES), revision=revision)   # one commit
        except BaseException as e:                              # noqa: BLE001 - reported to the job below
            err.append(e)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    while t.is_alive():
        if cancelled():
            raise Cancelled()                                   # the part file stays and resumes later
        have = model_status(kind)["bytes"]
        progress(min(have / expected, 0.99), f"Downloading the model: {have / 1e9:.1f} of about {expected / 1e9:.1f} GB")
        time.sleep(1.0)
    if err:
        raise ASRError(f"The download failed: {err[0]}")
    if not model_present(kind):
        raise ASRError("The download finished, but model files are missing.")
    bad = pins.verify(d, hashes)                                # 0.10.6: exactly the files Asistent was tested with
    if bad:
        raise ASRError(f"The downloaded model does not match its checksum ({', '.join(bad)}): press Download again.")
    log.info("whisper model %s downloaded to %s", kind, d)
    return model_status(kind)
