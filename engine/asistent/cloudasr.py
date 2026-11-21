"""Speech recognition by ElevenLabs Scribe (0.10.119): the one part of Asistent that sends anything off the computer.

Why (the user's decision, 2026-11-21, after the subtitle audit): on the office's own finished videos large-v3 leaves about
13-17 % of the editors' words wrong and no local setting moved that far, because the words are already wrong in Whisper's
first reading. Scribe v3 on the same sound: 365 wrong words of 4171 against 650 (shipped) and 604 (the best local profile),
in about a twentieth of the time (docs/BENCHMARK.md). So every style but ReShape's may read through Scribe.

What leaves the computer, and when:
- only the SOUND of the windows being subtitled (16 kHz mono, the pieces the editor selected, silence between them), never
  picture, file names, project names, the names prompt or the editor's corrections; since 0.10.121 also the same windows of
  Cut silences' dialogue mix for its AI-assisted words (roughcut_job.read_cloud; the user, 2026-11-21);
- only when the editor saved a key AND left the switch on (`status()`); never for the ReShape style (recognition.py) or a
  ReShape project's Cut silences (roughcut_job.is_reshape), never for anything else;
- ElevenLabs keeps uploads by default (its no-retention mode is for enterprise plans), so every transcript is deleted there
  as soon as its words are back (`forget`, best effort: a failure is logged, the words are still used).
When ElevenLabs cannot be reached or refuses, the caller reads the window on this computer instead and says so in the result.

The key lives in `<app>/elevenlabs.key` (never in the repo, never in a log, never sent back to the panel) or in
ELEVENLABS_API_KEY (development). Plain urllib: no new package.
"""
from __future__ import annotations

import io
import json
import logging
import math
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.request
import uuid
import wave
from typing import Callable

import numpy as np

from . import config

log = logging.getLogger("asistent")
URL = "https://api.elevenlabs.io/v1/speech-to-text"
MODEL = "scribe_v3"
NAME = "ElevenLabs Scribe v3"
LANGUAGE = "bul"
SR = 16000
# s of waiting on the connection for one request (a socket timeout, not a total). A window is up to about five minutes of sound
# (roughcut_job.CLOUD_MAX; the subtitles' windows are merged up to two minutes, one long clip is one window) and ElevenLabs
# answers in about 0.16 s per second of sound with the upload, so this leaves several times that.
TIMEOUT = 300
CANCEL_POLL = 0.2
SECONDS_PER_SECOND = 0.16  # the measured time per second of sound, for the progress shown while waiting
RETRY_WAIT = (2.0, 6.0)    # s before the second and the third attempt after a 429, a 5xx or a timeout (0.10.122)


class CloudError(RuntimeError):
    """ElevenLabs gave no words (no key, no network, refused, quota): the caller falls back to this computer."""


def _key_path() -> str:
    return os.path.join(config.app_dir(), "elevenlabs.key")


def _settings_path() -> str:
    return os.path.join(config.app_dir(), "cloud.json")


def key() -> str:
    k = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if k:
        return k
    try:
        with open(_key_path(), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def enabled() -> bool:
    try:
        with open(_settings_path(), encoding="utf-8") as f:
            return bool(json.load(f).get("enabled", True))
    except (OSError, ValueError):
        return True                                        # a saved key with no switch file: on (saving the key was the yes)


def available() -> bool:
    """Scribe is used for this run: a key is saved and the switch is on."""
    return bool(key()) and enabled()


def status() -> dict:
    """What the panel shows. The key itself never leaves the engine: only whether there is one and how it ends."""
    k = key()
    return {"key": bool(k), "ends": k[-4:] if len(k) >= 12 else "", "enabled": enabled(), "on": bool(k) and enabled(), "name": NAME}


def save(body: dict) -> dict:
    """{"key"?: str ("" removes it), "enabled"?: bool} -> status()."""
    os.makedirs(os.path.dirname(_key_path()), exist_ok=True)
    if "key" in body:
        k = str(body.get("key") or "").strip()
        if k and (len(k) < 20 or any(c.isspace() for c in k)):
            raise ValueError("That does not look like an ElevenLabs API key.")
        if k:
            fd = os.open(_key_path(), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(k)
        elif os.path.exists(_key_path()):
            os.remove(_key_path())
    if "enabled" in body:
        with open(_settings_path(), "w", encoding="utf-8") as f:
            json.dump({"enabled": bool(body["enabled"])}, f)
    return status()


def _wav(audio: np.ndarray) -> bytes:
    pcm = (np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0) * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def _multipart(fields: dict, name: str, data: bytes) -> tuple[bytes, str]:
    edge = "asistent" + uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f'--{edge}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8"))
    out.write(f'--{edge}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: audio/wav\r\n\r\n'.encode("utf-8"))
    out.write(data)
    out.write(f"\r\n--{edge}--\r\n".encode("utf-8"))
    return out.getvalue(), f"multipart/form-data; boundary={edge}"


def _reason(e: Exception) -> str:
    """A short reason an editor can act on; never the key, never the request."""
    if isinstance(e, urllib.error.HTTPError):
        try:
            detail = json.loads(e.read().decode("utf-8", "replace")).get("detail")
        except Exception:                                  # noqa: BLE001
            detail = None
        status = detail.get("status") if isinstance(detail, dict) else None
        if e.code == 401 or status in ("invalid_api_key", "missing_permissions"):
            return "the ElevenLabs key was refused (check it in Settings; it needs Speech to Text access)"
        if status == "quota_exceeded" or e.code == 402:
            return "the ElevenLabs account has no transcription time left this month"
        if e.code == 429:
            return "ElevenLabs is busy (too many requests)"
        return f"ElevenLabs answered {e.code}" + (f" ({status})" if status else "")
    if isinstance(e, (urllib.error.URLError, TimeoutError, OSError)):
        return "ElevenLabs could not be reached (no internet?)"
    return "ElevenLabs gave no usable answer"


def _post(audio: np.ndarray, model: str, k: str) -> dict:
    body, kind = _multipart({"model_id": model, "language_code": LANGUAGE, "timestamps_granularity": "word",
                             "tag_audio_events": "false", "diarize": "false"}, "window.wav", _wav(audio))
    req = urllib.request.Request(URL, data=body, method="POST", headers={"xi-api-key": k, "Content-Type": kind, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def forget(transcription_id: str, k: str | None = None) -> bool:
    """Delete one transcript at ElevenLabs (it keeps uploads by default). Best effort: False when it could not."""
    k = k or key()
    if not transcription_id or not k:
        return False
    try:
        req = urllib.request.Request(f"{URL}/transcripts/{transcription_id}", method="DELETE", headers={"xi-api-key": k})
        with urllib.request.urlopen(req, timeout=30):
            return True
    except Exception as e:                                 # noqa: BLE001 - the words are already here; say it once in the log
        log.warning("cloud: the transcript could not be deleted at ElevenLabs: %s", _reason(e))
        return False


_DRAWN_OUT = re.compile(r"(.)\1{3,}")


def tidy(words: list[dict]) -> tuple[list[dict], bool]:
    """A stored reading's words with the drawn-out clean-up of `words_of` applied again -> (words, anything changed). The
    0.10.119-0.10.121 readings in the cache still hold shouts written out in 1000 letters."""
    out, changed = [], False
    for w in words:
        text = _DRAWN_OUT.sub(lambda m: m.group(1) * 3, str(w.get("word") or ""))
        if text != w.get("word"):
            w, changed = {**w, "word": text}, True
        out.append(w)
    return out, changed


def words_of(data: dict) -> list[dict]:
    """Scribe's answer -> the words as asr.transcribe gives them ({"word", "start", "end", "p"}). A shout Scribe writes
    out letter by letter („Оооооо…“, 1000 letters on a racing clip, 2026-11-21) is cut to three of the letter: nobody
    reads the rest, and such a "word" froze the dictionary."""
    out = []
    for w in data.get("words") or []:
        text = _DRAWN_OUT.sub(lambda m: m.group(1) * 3, str(w.get("text") or "").strip())
        if w.get("type") != "word" or not text or w.get("start") is None or w.get("end") is None:
            continue
        lp = w.get("logprob")
        p = math.exp(min(0.0, float(lp))) if isinstance(lp, (int, float)) else 1.0
        out.append({"word": text, "start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3), "p": round(p, 2)})
    return out


def _retryable(e: Exception) -> bool:
    """A refusal that may be gone in a few seconds: too many requests, a server error, a timeout."""
    if isinstance(e, urllib.error.HTTPError):
        return e.code == 429 or e.code >= 500
    if isinstance(e, (TimeoutError, socket.timeout)):
        return True
    return isinstance(e, urllib.error.URLError) and isinstance(e.reason, (TimeoutError, socket.timeout))


def transcribe(audio: np.ndarray, progress: Callable[[float, str], None] | None = None,
               cancelled: Callable[[], bool] | None = None, model: str = MODEL,
               on_done: Callable[[list[dict]], None] | None = None) -> list[dict]:
    """Words with times (seconds from the start of `audio`) from Scribe, shaped like asr.transcribe's. Raises CloudError
    with a reason for the editor when there are none; raises asr.Cancelled when the editor cancels (the request is left
    to finish on its own thread, its transcript is still deleted, and `on_done(words)` is called from that thread when the
    words do arrive, so the caller can keep them: the minutes were paid for).

    A 429, a 5xx or a timeout is tried again up to twice (RETRY_WAIT), waiting in a way Cancel can end. While it waits,
    `progress` gets an estimate from the time per second of sound instead of 0 and then 1 (0.10.122)."""
    from .asr import Cancelled

    progress = progress or (lambda f, m: None)
    cancelled = cancelled or (lambda: False)
    k = key()
    if not k:
        raise CloudError("no ElevenLabs key is saved")
    if len(audio) < SR // 10:
        return []
    progress(0.0, "Sending the sound to ElevenLabs…")
    box: dict = {}
    lock = threading.Lock()
    stop = threading.Event()                              # set when the editor cancelled: no more attempts

    def work():
        for attempt in range(len(RETRY_WAIT) + 1):
            try:
                data = _post(audio, model, k)
                words = words_of(data)
                forget(str(data.get("transcription_id") or ""), k)
            except Exception as e:                        # noqa: BLE001 - one reason for the caller
                if attempt < len(RETRY_WAIT) and _retryable(e):
                    log.warning("cloud: %s; trying again in %.0f s", _reason(e), RETRY_WAIT[attempt])
                    if stop.wait(RETRY_WAIT[attempt]):
                        return
                    continue
                with lock:
                    box["error"] = _reason(e)
                return
            with lock:
                box["words"] = words
                abandoned = box.get("abandoned", False)
            if abandoned and on_done:
                try:
                    on_done(words)
                except Exception:                         # noqa: BLE001 - keeping the words is a bonus
                    log.warning("cloud: the words of a cancelled reading could not be kept", exc_info=True)
            return

    t = threading.Thread(target=work, name="cloud-read", daemon=True)
    t.start()
    started, shown = time.monotonic(), 0.0
    expect = max(4.0, SECONDS_PER_SECOND * len(audio) / SR)
    while t.is_alive():
        t.join(CANCEL_POLL)
        if not t.is_alive():
            break
        if cancelled():
            with lock:
                if "words" not in box and "error" not in box:
                    box["abandoned"] = True
                    stop.set()
                    raise Cancelled()
        frac = min(0.95, (time.monotonic() - started) / expect)
        if frac - shown >= 0.01:
            shown = frac
            progress(frac, "Recognising the speech…")
    if "error" in box:
        raise CloudError(box["error"])
    progress(1.0, "Recognising the speech…")
    return box["words"]
