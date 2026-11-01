"""The `/subtitles` job (Phase 7 M3): dialogue mix -> Whisper words -> captions -> SRT + JSON on disk.

Nothing is sent to Premiere here: the result lists what was made and the panel decides what to show. Whisper's words
are cached by mix + prompt, so changing a preset or the frame rate re-breaks the lines without running Whisper again.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from typing import Callable

from . import asr, config, subtitles
from .dialoguemix import ASR_SR, build_mix
from .sync import Cancelled

log = logging.getLogger("asistent")
CACHE_VERSION = 1
PRESET_NAMES = ("auto", "short", "standard")


def cache_dir() -> str:
    d = os.path.join(config.app_dir(), "cache", "subtitles")
    os.makedirs(d, exist_ok=True)
    return d


def _num(v, what: str, lo: float = 0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"Невалидна стойност: {what}.")
    if not f >= lo:
        raise ValueError(f"Невалидна стойност: {what}.")
    return f


def validate(body: dict) -> dict:
    """Request body -> clean parameters, or ValueError with a message for the editor."""
    items = body.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("Маркирай в таймлайна поне един аудио клип с говор.")
    clean = []
    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get("path"), str):
            raise ValueError("Невалиден клип в заявката.")
        if not os.path.isfile(it["path"]):
            raise ValueError("Файлът липсва (офлайн медия?): " + os.path.basename(it["path"]))
        start, end = _num(it.get("start"), "начало"), _num(it.get("end"), "край")
        if end <= start:
            raise ValueError("Невалиден клип в заявката.")
        clean.append({"path": it["path"], "start": start, "end": end, "at": _num(it.get("at"), "позиция"),
                      "name": str(it.get("name") or os.path.basename(it["path"])),
                      "track": int(_num(it.get("track", 0), "писта"))})
    preset = body.get("preset", "auto")
    if preset not in PRESET_NAMES:
        raise ValueError("Невалиден вид субтитри.")
    out_dir = body.get("out_dir")
    if not isinstance(out_dir, str) or not os.path.isdir(out_dir):
        raise ValueError("Папката на проекта не е намерена: запази проекта и опитай пак.")
    terms = body.get("terms") or []
    if not isinstance(terms, list) or not all(isinstance(t, str) for t in terms):
        raise ValueError("Невалиден списък с имена и термини.")
    skipped = body.get("skipped") or []
    if not isinstance(skipped, list) or not all(isinstance(s, str) for s in skipped):
        raise ValueError("Невалиден списък с пропуснати клипове.")
    if not asr.backend_installed():
        raise ValueError("Пакетите за разпознаване на реч (faster-whisper) не са инсталирани: пусни scripts/setup_mac.sh --subtitles.")
    if not asr.model_present():
        raise ValueError("Моделът за разпознаване на реч още не е свален: натисни „Свали модела“ в раздел СУБТИТРИ.")
    return {"items": clean, "preset": preset, "fps": _num(25.0 if body.get("fps") is None else body.get("fps"), "кадри в секунда", 1.0),
            "width": body.get("width"), "height": body.get("height"), "out_dir": out_dir,
            "name": str(body.get("name") or "секвенция"), "terms": terms, "skipped": skipped}


def _words_key(audio, prompt: str) -> str:
    h = hashlib.sha1()
    h.update(f"{CACHE_VERSION}|{asr.MODEL_REPO}|{asr.LANGUAGE}|{ASR_SR}|{prompt}|".encode("utf-8"))
    h.update(audio.tobytes())
    return h.hexdigest()


def _cached_words(key: str):
    path = os.path.join(cache_dir(), key + ".json")
    if os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)["words"]
        except (OSError, ValueError, KeyError):
            log.warning("subtitle cache entry %s unreadable, recognising again", key[:8])
    return None


def _store_words(key: str, words: list) -> None:
    path = os.path.join(cache_dir(), key + ".json")
    try:
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump({"words": words}, f, ensure_ascii=False)
        os.replace(path + ".tmp", path)
    except OSError as e:
        log.warning("subtitle cache write failed: %s", e)


def _file_stem(name: str) -> str:
    stem = re.sub(r"[^\w\-. ()]", "_", name, flags=re.UNICODE).strip(" .") or "субтитри"
    return f"{stem[:60]} {time.strftime('%Y-%m-%d %H-%M-%S')}"


def run(body: dict, progress: Callable[[float, str], None], cancelled: Callable[[], bool]) -> dict:
    p = validate(body)
    t0 = time.time()
    mix = build_mix(p["items"], lambda f, m: progress(0.15 * f, m), cancelled)
    audio, origin = mix["audio"], mix["origin"]
    prompt = subtitles.initial_prompt(p["terms"])
    key = _words_key(audio, prompt)
    words = _cached_words(key)
    cached = words is not None
    t_asr = time.time()
    if not cached:
        words = asr.transcribe(audio, prompt or None, lambda f, m: progress(0.15 + 0.8 * f, m), cancelled)
        if cancelled():
            raise Cancelled()
        _store_words(key, words)
    else:
        progress(0.95, "Речта е разпозната от преди: подреждам редовете…")
    asr_s = time.time() - t_asr

    sequence_words = [dict(w, start=w["start"] + origin, end=w["end"] + origin) for w in words]
    preset = subtitles.preset_for(p["width"], p["height"]) if p["preset"] == "auto" else p["preset"]
    captions = subtitles.build_captions(sequence_words, preset, p["fps"])

    folder = os.path.join(p["out_dir"], "Asistent_subtitles")
    os.makedirs(folder, exist_ok=True)
    stem = os.path.join(folder, _file_stem(p["name"]))
    subtitles.write_srt(captions, stem + ".srt")
    flagged = sum(len(c["flags"]) for c in captions)
    result = {
        "srt": stem + ".srt", "json": stem + ".json", "preset": preset, "fps": subtitles.exact_fps(p["fps"]),
        "captions": [{"start": c["start"], "end": c["end"], "text": c["text"], "flags": c["flags"]} for c in captions],
        "counts": {"captions": len(captions), "words": len(sequence_words), "flagged": flagged},
        "notes": mix["notes"], "duplicates": mix["duplicates"], "skipped": p["skipped"], "origin": round(origin, 3),
        "mix_seconds": round(len(audio) / ASR_SR, 1), "asr_seconds": round(asr_s, 1), "cached": cached,
    }
    with open(stem + ".json", "w", encoding="utf-8") as f:
        json.dump({**result, "words": sequence_words, "items": p["items"]}, f, ensure_ascii=False, indent=1)
    log.info("subtitles: %d captions, %d words (%d flagged), mix %.1f s, asr %.1f s%s, total %.1f s, preset %s -> %s",
             len(captions), len(sequence_words), flagged, result["mix_seconds"], asr_s, " (cached)" if cached else "",
             time.time() - t0, preset, stem + ".srt")
    progress(1.0, "Готово")
    return result
