"""The `/subtitles` job (Phase 7 M3): pieces of dialogue -> Whisper words (per piece, with context) -> optional
alignment to the sound -> captions -> SRT + JSON on disk.

Nothing is sent to Premiere here: the result lists what was made and the panel decides what to show. Words are cached
per piece (audio + prompt), so changing a preset or the frame rate re-breaks the lines without running Whisper again.

Why per piece and not one joined mix (measured 2026-11-01 on the Ludi Glavi test): Whisper read the four cut pieces
joined into one signal as „и аз да видим“ and „Приведно на мен“; the same pieces transcribed one by one, each with 2 s
of the real media around it, gave „я да видим“ and „Примерно на мен“.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from typing import Callable

from . import align, asr, config, consensus, corrections, dialoguemix, lexicon, subtitles
from .dialoguemix import ASR_SR, build_mix, read_segment
from .sync import Cancelled

log = logging.getLogger("asistent")
CACHE_VERSION = 2
PAD = 2.0                  # seconds of real media around each piece, for Whisper's context (the main reading)
EXTRA_PADS = (0.7, 4.0)    # two more readings with less and more surrounding sound: they vote on words (consensus.py)
MIN_OVERLAP = 0.4          # a word belongs to the piece when this much of it lies inside the piece
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
    text = body.get("text") or ""
    if not isinstance(text, str) or len(text) > corrections.MAX_TEXT:
        raise ValueError("Невалиден текст с корекции и термини.")
    spoken = body.get("spoken") or {}
    if not isinstance(spoken, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in spoken.items()):
        raise ValueError("Невалиден речник за произношение.")
    return {"items": clean, "spoken": spoken, "preset": preset, "fps": _num(25.0 if body.get("fps") is None else body.get("fps"), "кадри в секунда", 1.0),
            "width": body.get("width"), "height": body.get("height"), "out_dir": out_dir,
            "name": str(body.get("name") or "секвенция"), "terms": terms, "skipped": skipped, "text": text}


def _words_key(audio, prompt: str) -> str:
    h = hashlib.sha1()
    h.update(f"{CACHE_VERSION}|{asr.MODEL_REPO}|{asr.LANGUAGE}|{ASR_SR}|{prompt}|".encode("utf-8"))
    h.update(audio.tobytes())
    return h.hexdigest()


def _cached(key: str):
    path = os.path.join(cache_dir(), key + ".json")
    if os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            log.warning("subtitle cache entry %s unreadable, recognising again", key[:8])
    return None


def _store(key: str, entry: dict) -> None:
    path = os.path.join(cache_dir(), key + ".json")
    try:
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(entry, f, ensure_ascii=False)
        os.replace(path + ".tmp", path)
    except OSError as e:
        log.warning("subtitle cache write failed: %s", e)


def _inside(w: dict, lo: float, hi: float) -> bool:
    """Is the word (times relative to the padded piece) part of the piece [lo, hi]?"""
    d = w["end"] - w["start"]
    if d <= 1e-6:
        return lo <= w["start"] < hi
    return (min(w["end"], hi) - max(w["start"], lo)) / d >= MIN_OVERLAP


def _variants(word: str) -> set:
    """The spellings a correction line may use for a heard word: as written, and as the engine would show it."""
    return {consensus.norm(word), consensus.norm(lexicon.respell(word) or word)}


def _text_key(words: list[dict]) -> str:
    return hashlib.sha1((f"{align.REVISION}\x1f" + "\x1f".join(w["word"] for w in words)).encode("utf-8")).hexdigest()


def _reading(seg: dict, pad: float, prompt: str, spoken: dict, align_it: bool, pairs, progress, cancelled) -> tuple[list[dict], float, dict]:
    """One reading of the piece with `pad` seconds of real media around it -> (words in seconds from the start of the
    padded audio, lead-in actually available, {"cached", "aligned", "weak", "applied", "align_error"?}).
    The editor's corrections replace the heard words BEFORE the alignment, so the new words get the times of the sound."""
    y, lead = read_segment(seg, pad)
    key = _words_key(y, prompt)
    entry = _cached(key) or {}
    cached = "words" in entry
    if not cached:
        entry = {"words": asr.transcribe(y, prompt or None, progress, cancelled)}
        _store(key, entry)
    info = {"cached": cached, "aligned": 0, "weak": 0}
    words, info["applied"] = corrections.apply(entry["words"], pairs, _variants)
    if align_it and align.available():
        h = _text_key(words)
        if entry.get("aligned_for") != h:
            entry["aligned"], entry["align_info"] = align.align_words(y, words, spoken)
            entry["aligned_for"] = h
            if "error" not in entry["align_info"]:
                _store(key, entry)
        words, info_a = entry["aligned"], entry["align_info"]
        info.update({k: v for k, v in info_a.items() if k in ("aligned", "weak")})
        if "error" in info_a:
            info["align_error"] = info_a["error"]
    if align_it:                                            # the main reading only: a word is not spoken in silence
        words, info["trimmed"] = align.trim_silence(y, words)
    return words, lead, info


def piece_words(seg: dict, prompt: str, spoken: dict, progress, cancelled, pairs=()) -> tuple[list[dict], dict]:
    """Words of one piece in SEQUENCE seconds, plus {"cached", "aligned", "weak", "align_error"?, "changed", "unsure", "applied"}.

    The main reading (PAD seconds around the piece) is aligned to the sound and gives the words and their times; the
    EXTRA_PADS readings only vote (consensus.py): a word they outvote is replaced, a word nobody agrees on is marked."""
    dur = seg["end"] - seg["start"]
    n = 1 + len(EXTRA_PADS)

    def step(k):
        return lambda f, m: progress((k + f) / n, m)
    words, lead, info = _reading(seg, PAD, prompt, spoken, True, pairs, step(0), cancelled)
    mine = [dict(w, start=w["start"] - lead, end=w["end"] - lead) for w in words if _inside(w, lead, lead + dur)]
    others = []
    for k, pad in enumerate(EXTRA_PADS, 1):
        ws, ld, inf = _reading(seg, pad, prompt, spoken, False, pairs, step(k), cancelled)
        info["cached"] = info["cached"] and inf["cached"]
        others.append([dict(w, start=w["start"] - ld, end=w["end"] - ld) for w in ws if _inside(w, ld, ld + dur)])
    mine, votes = consensus.merge(mine, others, lexicon.known, lexicon.respell)
    info.update(votes)
    return [dict(w, start=round(seg["at"] + w["start"], 3), end=round(seg["at"] + w["end"], 3)) for w in mine], info


def _same_word(a: dict, b: dict) -> bool:
    return a["word"] == b["word"] and abs(a["start"] - b["start"]) < 0.15


def _file_stem(name: str) -> str:
    stem = re.sub(r"[^\w\-. ()]", "_", name, flags=re.UNICODE).strip(" .") or "субтитри"
    return f"{stem[:60]} {time.strftime('%Y-%m-%d %H-%M-%S')}"


def run(body: dict, progress: Callable[[float, str], None], cancelled: Callable[[], bool]) -> dict:
    p = validate(body)
    t0 = time.time()
    mix = build_mix(p["items"], lambda f, m: progress(0.1 * f, m), cancelled)
    segments = mix["segments"]
    parsed = corrections.parse(p["text"])
    prompt = subtitles.initial_prompt(p["terms"] + parsed["terms"])
    total = sum(sg["end"] - sg["start"] for sg in segments) or 1.0
    done = 0.0
    words: list[dict] = []
    cached = True
    aligned = weak = changed = unsure = 0
    applied = [0] * len(parsed["pairs"])
    align_error = None
    t_asr = time.time()
    for n, sg in enumerate(segments):
        if cancelled():
            raise Cancelled()
        share = (sg["end"] - sg["start"]) / total
        base = 0.1 + 0.85 * done
        ws, info = piece_words(sg, prompt, p["spoken"], lambda f, m, b=base, sh=share: progress(b + 0.85 * sh * f, m), cancelled, parsed["pairs"])
        words += ws
        cached = cached and info["cached"]
        aligned += info["aligned"]
        weak += info["weak"]
        changed += info["changed"]
        unsure += info["unsure"]
        applied = [a + b for a, b in zip(applied, info["applied"])]
        align_error = align_error or info.get("align_error")
        done += share
    asr_s = time.time() - t_asr
    words.sort(key=lambda w: (w["start"], w["end"]))
    unique: list[dict] = []
    for w in words:                                        # pieces that touch can both claim a word at the seam
        if not any(_same_word(w, u) for u in unique[-3:]):
            unique.append(w)
    words = unique
    progress(0.96, "Подреждам редовете…")

    preset = subtitles.preset_for(p["width"], p["height"]) if p["preset"] == "auto" else p["preset"]
    captions = subtitles.build_captions(words, preset, p["fps"])

    folder = os.path.join(p["out_dir"], "Asistent_subtitles")
    os.makedirs(folder, exist_ok=True)
    stem = os.path.join(folder, _file_stem(p["name"]))
    subtitles.write_srt(captions, stem + ".srt")
    flagged = sum(len(c["flags"]) for c in captions)
    timing = "aligned" if aligned else "whisper"
    result = {
        "srt": stem + ".srt", "json": stem + ".json", "preset": preset, "fps": subtitles.exact_fps(p["fps"]),
        "captions": [{"start": c["start"], "end": c["end"], "text": c["text"], "flags": c["flags"]} for c in captions],
        "counts": {"captions": len(captions), "words": len(words), "flagged": flagged, "pieces": len(segments)},
        "timing": {"method": timing, "aligned": aligned, "weak": weak, "error": align_error},
        "corrections": [{"heard": a, "said": b, "applied": n} for (a, b), n in zip(parsed["pairs"], applied)],
        "correction_errors": parsed["errors"],
        "readings": {"count": 1 + len(EXTRA_PADS), "changed": changed, "unsure": unsure, "dictionary": lexicon.available()},
        "notes": mix["notes"], "duplicates": mix["duplicates"], "skipped": p["skipped"],
        "origin": round(mix["origin"], 3), "mix_seconds": round(len(mix["audio"]) / ASR_SR, 1), "asr_seconds": round(asr_s, 1), "cached": cached,
    }
    with open(stem + ".json", "w", encoding="utf-8") as f:
        json.dump({**result, "words": words, "items": p["items"], "segments": segments}, f, ensure_ascii=False, indent=1)
    log.info("subtitles: %d captions, %d words (%d flagged) from %d pieces, timing %s (%d aligned, %d weak%s), "
             "asr+align %.1f s%s, total %.1f s, preset %s -> %s", len(captions), len(words), flagged, len(segments), timing,
             aligned, weak, f", {align_error}" if align_error else "", asr_s, " (cached)" if cached else "",
             time.time() - t0, preset, stem + ".srt")
    progress(1.0, "Готово")
    return result
