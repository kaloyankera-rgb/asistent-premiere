"""The `/subtitles` job (Phase 7 M3): pieces of dialogue -> Whisper words (one reading per stretch of a source file,
with plenty of real context) -> alignment to the sound -> captions -> SRT + JSON on disk.

Nothing is sent to Premiere here: the result lists what was made and the panel decides what to show. Words are cached
per reading (audio + prompt), so changing a preset or the frame rate re-breaks the lines without running Whisper again.

Why not the joined mix of the cut pieces (measured 2026-11-01, Ludi Glavi): Whisper read the four cut pieces joined into
one signal as „и аз да видим“ and „Приведно на мен“; read with the real media around them it gave „я да видим“.
Why 4 s of context and merged windows (measured 2026-11-02, C9025, 8 pieces from 5 files, 49.6 s of speech): with 2 s of
context two pieces read „2 септември“ for „20 евро“, and 3 readings per piece fed Whisper 252 s of audio (5.1 times the
speech; 225 s on the Mac). One reading of each stretch of a file with 4 s around the pieces, the windows of pieces that
lie close together merged, feeds it 91 s and every price and word of that list is right. 6 s was worse on the Ludi Glavi
clip („Превърна мен“ for „Примерно на мен“: too much of the other takes), 2 s too little for the prices.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

import numpy as np

from . import (agreement, align, asr, audiocheck, bgnorm, cloudasr, config, consensus, corrections, dialoguemix, english, learning, lexicon,
               recognition, subtitle_settings, subtitles, suspects, translate)
from .dialoguemix import ASR_SR, build_mix, read_segment
from .sync import Cancelled

log = logging.getLogger("asistent")
CACHE_VERSION = 2
PAD = 4.0                  # seconds of real media around each piece, for Whisper's context
MAX_WINDOW = 120.0         # a merged window is not grown past this many seconds
SECOND_BEAM = 2            # a cheaper decode for the second opinion (beam 5 for the main reading)
SECOND_PAD = 2.0           # the second opinion on a doubtful piece: that piece alone with this much context
# 0.10.95 (the user, 2026-11-15, Lokali: "It needs to recognize fast talking ... other subtitle generators get them right").
# Whisper on fast speech sits on a knife edge: the same window read 3 dB louder or quieter gave „Карал ли си някога реална
# кола? ... А карал ли си на симулатор?“ or „Кара ли с ... кара ли с асимулатор?“ (3 of 6 levels each), and the second
# opinion had the right line, but the dictionary had already turned „асимулатор“ into the real „асимилатор“, so both
# readings looked equally sure and the first stayed. Whisper's own score of each reading's text over the piece's sound told
# them apart (-12.0 against -2.3). In every style but ReShape's (frozen, scripts/reshape_golden.py) a doubtful piece is
# also read LOUDER, and the reading whose text fits the sound best is kept.
LOUDER = 2.0               # the third reading: the window at this gain (+6 dB)
SOUND_MARGIN = 2.0         # another reading replaces the first when Whisper scores its text at least this much higher ...
SOUND_MAX_S = 29.5         # ... over the piece's sound (the score reads at most 30 s; a longer piece keeps the doubt rule)
MIN_OVERLAP = 0.4          # a word belongs to the piece when this much of it lies inside the piece
EDGE = 0.05                # seconds: a word this close to a clip's edge and not clearly heard is a scrap the cut left
PRESET_NAMES = ("auto", "short", "standard", "reshape", "gstroy", "credissimo", "ekopak", "beautysector", "aula")
MAX_CHECKS = 24            # learned fixes checked against the sound in one run (about 9 s each on the Mac's processor)


def cache_dir() -> str:
    d = os.path.join(config.app_dir(), "cache", "subtitles")
    os.makedirs(d, exist_ok=True)
    return d


def _num(v, what: str, lo: float = 0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"Invalid value: {what}.")
    if not f >= lo:
        raise ValueError(f"Invalid value: {what}.")
    return f


def validate(body: dict) -> dict:
    """Request body -> clean parameters, or ValueError with a message for the editor."""
    items = body.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("Select at least one audio clip with speech in the timeline.")
    clean = []
    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get("path"), str):
            raise ValueError("Invalid clip in the request.")
        if not os.path.isfile(it["path"]):
            raise ValueError("The file is missing (offline media?): " + os.path.basename(it["path"]))
        start, end = _num(it.get("start"), "start"), _num(it.get("end"), "end")
        if end <= start:
            raise ValueError("Invalid clip in the request.")
        clean.append({"path": it["path"], "start": start, "end": end, "at": _num(it.get("at"), "position"),
                      "name": str(it.get("name") or os.path.basename(it["path"])),
                      "track": int(_num(it.get("track", 0), "track")),
                      **({"side": it["side"]} if it.get("side") in ("L", "R") else {})})
    preset = body.get("preset", "auto")
    if preset not in PRESET_NAMES:
        raise ValueError("Invalid subtitle style.")
    # the editor's Max words (0.10.138): absent = the style's own size; 1-4 = a hard cap; never for ReShape (protected)
    max_words = body.get("max_words")
    if max_words is not None and (isinstance(max_words, bool) or not isinstance(max_words, int) or not 1 <= max_words <= 4):
        raise ValueError("Invalid maximum words per line.")
    # the editor's Case (0.10.138): absent = the style's own; "normal" or "upper"; never for ReShape (protected)
    case = body.get("case")
    if case is not None and case not in subtitles.CASES:
        raise ValueError("Invalid letter case.")
    # the editor's Line break (0.10.139): true = up to 5 words, the last 1-2 on a second line in `colour` (#RRGGBB, written
    # into the SRT); absent = the style's own lines; never for ReShape (protected)
    line_break = body.get("line_break", False)
    if not isinstance(line_break, bool):
        raise ValueError("Invalid line break choice.")
    colour = body.get("colour")
    if colour is not None and (not isinstance(colour, str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", colour)):
        raise ValueError("Invalid colour: use #RRGGBB.")
    if preset == "reshape":
        max_words = case = None
        line_break = False
    if not line_break:
        colour = None
    out_dir = body.get("out_dir")
    if not isinstance(out_dir, str) or not os.path.isdir(out_dir):
        raise ValueError("The project folder was not found: save the project and try again.")
    terms = body.get("terms") or []
    if not isinstance(terms, list) or not all(isinstance(t, str) for t in terms):
        raise ValueError("Invalid list of names and terms.")
    skipped = body.get("skipped") or []
    if not isinstance(skipped, list) or not all(isinstance(s, str) for s in skipped):
        raise ValueError("Invalid list of skipped clips.")
    if not asr.backend_installed():
        raise ValueError("The speech recognition packages (faster-whisper) are not installed: run scripts/setup_mac.sh --subtitles.")
    if not asr.model_present():
        raise ValueError("The speech recognition model is not downloaded yet: press Download the model in SUBTITLES.")
    text = body.get("text") or ""
    if not isinstance(text, str) or len(text) > corrections.MAX_TEXT:
        raise ValueError("Invalid text of corrections and terms.")
    spoken = body.get("spoken") or {}
    if not isinstance(spoken, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in spoken.items()):
        raise ValueError("Invalid pronunciation dictionary.")
    return {"items": clean, "spoken": spoken, "preset": preset, "fps": _num(25.0 if body.get("fps") is None else body.get("fps"), "frames per second", 1.0),
            "width": body.get("width"), "height": body.get("height"), "out_dir": out_dir,
            "name": str(body.get("name") or "sequence"), "terms": terms, "skipped": skipped, "text": text,
            "english": bool(body.get("english")), "english_fixed": _english_fixed(body.get("english_fixed")),
            "english_words": _english_words(body.get("english_words")),
            "english_words_off": _english_words(body.get("english_words_off")),
            "project": body.get("project") if isinstance(body.get("project"), str) else "", "max_words": max_words, "case": case,
            "line_break": line_break, "colour": colour.upper() if colour else None}


def line_key(text: str) -> str:
    """A Bulgarian line as the key of the editor's own English for it (case and line breaks do not matter)."""
    return " ".join(str(text).split()).lower()


def _english_fixed(raw) -> dict:
    """The English lines the editor typed in the Captions tab: {Bulgarian line: English}; used as they are."""
    if raw is None:
        return {}
    if not isinstance(raw, dict) or len(raw) > 5000 or not all(isinstance(k, str) and isinstance(v, str) and len(v) < 500
                                                               for k, v in raw.items()):
        raise ValueError("Invalid English corrections.")
    return {line_key(k): " ".join(v.split()) for k, v in raw.items() if v.strip()}


def merge_english_words(learned: dict, local: dict, off: dict) -> dict:
    """The client's learned English word fixes, this project's own on top, minus the fixes the editor took back here
    (`off`: {as corrected: the original}; 0.10.6, BUG-013)."""
    out = {**learned, **local}
    for corrected, original in off.items():
        key = " ".join(original.lower().split())
        if out.get(key, "").lower() == corrected.lower() and key not in local:
            del out[key]
    return out


def _english_words(raw) -> dict:
    """The words the editor changed in English lines: {as translated: as written} („adipose“ -> „fat“)."""
    if raw is None:
        return {}
    if not isinstance(raw, dict) or len(raw) > 500 or not all(isinstance(k, str) and isinstance(v, str) and 0 < len(k) < 100
                                                              and len(v) < 100 for k, v in raw.items()):
        raise ValueError("Invalid English word corrections.")
    return {" ".join(k.lower().split()): " ".join(v.split()) for k, v in raw.items() if k.strip() and v.strip()}


def _words_key(audio, prompt: str, tag: str = "") -> str:
    """The cache key of one reading. `tag` (recognition.Profile.tag) is empty for the profiles that hear and decode as
    Asistent always has, and then the key is exactly what it was: a ReShape reading keeps its key, and a profile that
    evens out the level or decodes differently never gets (or leaves) a reading made another way."""
    h = hashlib.sha1()
    h.update(f"{CACHE_VERSION}|{asr.MODEL_REPO}|{asr.LANGUAGE}|{ASR_SR}|{prompt}|".encode("utf-8"))
    if tag:
        h.update(f"{tag}|".encode("utf-8"))
    h.update(audio.tobytes())
    return h.hexdigest()


def _heard(y, prompt: str, prof, progress, cancelled, **kw) -> list[dict]:
    """One Whisper reading of `y` as the profile hears and decodes it (no profile: the call exactly as before 0.10.119)."""
    options = prof.options(prompt) if prof else None
    if options:
        kw["options"] = options
    if prof is not None and prof.full and asr.full_precision() != asr.LARGE:
        kw["model"] = asr.full_precision()
    return asr.transcribe(recognition.prepare(y, prof) if prof else y, prompt or None, progress, cancelled, **kw)


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
    # 0.10.122: a name of its own per write: two threads storing the same key (a cancelled cloud reading that finishes
    # while the next run stores it too) must not write into one ".tmp" file
    tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex[:8]}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(entry, f, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError as e:
        log.warning("subtitle cache write failed: %s", e)
        try:
            os.remove(tmp)
        except OSError:
            pass


def _inside(w: dict, lo: float, hi: float) -> bool:
    """Is the word (times relative to the padded piece) part of the piece [lo, hi]?"""
    d = w["end"] - w["start"]
    if d <= 1e-6:
        return lo <= w["start"] < hi
    return (min(w["end"], hi) - max(w["start"], lo)) / d >= MIN_OVERLAP


def _variants(word: str) -> set:
    """The spellings a correction line may use for a heard word: as written, and as the engine may show it (every real
    word it may be repaired to: the recording's vocabulary picks one, seen „масната“ shown as „месната“)."""
    # both rule sets (0.10.94: the strict one, and the one ReShape keeps): a correction line that matched before still matches
    return ({consensus.norm(word)} | {consensus.norm(lexicon.repair(word, strict=s) or word) for s in (True, False)}
            | {consensus.norm(c) for s in (True, False) for c in lexicon.candidates(word, s)})


def _text_key(words: list[dict]) -> str:
    return hashlib.sha1((f"{align.REVISION}\x1f" + "\x1f".join(w["word"] for w in words)).encode("utf-8")).hexdigest()


def plan_windows(segments: list[dict], pad: float = PAD, max_window: float = MAX_WINDOW) -> list[dict]:
    """Pieces -> the stretches of media to read: `pad` seconds around each piece, and the windows of pieces of the same
    file that overlap merged into one, so a stretch of speech is never recognised twice.
    -> [{"path", "a", "b" (media seconds), "pieces": [piece, ...]}]"""
    wins: list[dict] = []
    for sg in sorted(segments, key=lambda s: (s["path"], s["start"])):
        a, b = max(0.0, sg["start"] - pad), sg["end"] + pad
        w = wins[-1] if wins else None
        if w and w["path"] == sg["path"] and a <= w["b"] and b - w["a"] <= max_window:
            w["b"] = max(w["b"], b)
            w["pieces"].append(sg)
        else:
            wins.append({"path": sg["path"], "a": a, "b": b, "pieces": [sg]})
    return wins


def silence_between(y: np.ndarray, win: dict) -> np.ndarray:
    """The media between the pieces of a window, which the editor cut out, as silence (5 ms ramps). Whisper and the aligner then
    hear what the viewer hears: a retake 1.5 s before a clip took the clip's own „Затова“ (ReShape, 2026-11-04). The context
    before the first and after the last piece stays: silencing it too lost „Когато“ at a clip start on the same recording."""
    pieces = sorted(win["pieces"], key=lambda s: s["start"])
    at = lambda t: min(len(y), max(0, int(round((t - win["a"]) * ASR_SR))))
    keep = np.zeros(len(y), dtype=np.float32)
    keep[:at(pieces[0]["start"])] = 1.0
    keep[at(pieces[-1]["end"]):] = 1.0
    for sg in pieces:
        keep[at(sg["start"]):at(sg["end"])] = 1.0
    if keep.all():
        return y
    ramp = int(0.005 * ASR_SR)
    keep = np.convolve(np.pad(keep, ramp, mode="edge"), np.ones(2 * ramp + 1, dtype=np.float32) / (2 * ramp + 1), mode="valid")
    return (y * keep).astype(np.float32)


def window_audio(win: dict, prompt: str, prof=None) -> tuple[np.ndarray, str]:
    """What a window's reading hears (as recorded) and the cache key of that reading."""
    y, _ = read_segment({"path": win["path"], "start": win["a"], "end": win["b"]}, 0.0)
    y = silence_between(y, win)
    # 0.10.122: ElevenLabs is never sent the names prompt, so a cloud reading's key must not hold it either: the same sound
    # is one reading for every client's names and for Cut silences (empty prompt). Every other profile: as it always was.
    if prof is not None and prof.cloud:
        prompt = ""
    return y, _words_key(y, prompt, prof.tag if prof else "")


def read_window(win: dict, prompt: str, progress, cancelled, prof=None) -> dict:
    """One reading of a window (cached by its audio + prompt + the profile's tag) -> {"y", "key", "entry", "cached"}, and
    "fallback": the reason, when a cloud profile's window had to be read on this computer instead (0.10.119)."""
    y, key = window_audio(win, prompt, prof)
    entry = _cached(key) or {}
    cached = "words" in entry
    if cached and prof is not None and prof.cloud and entry.get("by"):
        # 0.10.122: a reading stored by 0.10.119-0.10.121 may hold a shout written out in 1000 letters: shorten it now
        words, changed = cloudasr.tidy(entry["words"])
        if changed:
            entry = {**entry, "words": words}
            _store(key, entry)
    if not cached and prof is not None and prof.cloud:
        try:
            # only the sound goes: no prompt, no names, no file name (cloudasr.py says what leaves the computer and why);
            # a cancelled upload that still finishes is stored for the next run (on_done)
            entry = {"words": cloudasr.transcribe(y, progress, cancelled, prof.cloud,
                                                  on_done=lambda ws, k=key, m=prof.cloud: _store(k, {"words": ws, "by": m})), "by": prof.cloud}
        except cloudasr.CloudError as e:
            log.warning("subtitles: %s; this window is recognised on this computer", e)
            return {**read_window(win, prompt, progress, cancelled, recognition.local(prof)), "fallback": str(e)}
        _store(key, entry)
    elif not cached:
        entry = {"words": _heard(y, prompt, prof, progress, cancelled)}
        _store(key, entry)
    return {"y": y, "key": key, "entry": entry, "cached": cached}


def vocabulary(readings: list[dict], extra=()) -> frozenset:
    """Real words the recording says confidently (any window): the tie-break when a mis-heard word has several
    neighbours in the dictionary („Взиваме“ -> „взимаме“, which the speaker says all through the recording)."""
    out = set(consensus.norm(w) for w in extra)
    for r in readings:
        for w in r["entry"]["words"]:
            if w.get("p", 0) >= 0.8 and lexicon.known(w["word"]) is True:
                out.add(consensus.norm(w["word"]))
    return frozenset(out)


def _doubts(words: list[dict]) -> int:
    """How doubtful a reading of a piece is: words the dictionary does not know and cannot repair (names and slang are
    short or capitalised mid-sentence less often than mis-hearings are long), counted twice, and words Whisper is
    unsure of."""
    n = 0
    for w in words:
        core = consensus.norm(w["word"])
        if len(core) >= 4 and lexicon.known(w["word"]) is False:
            n += 2
        elif w.get("p", 1.0) < 0.5 and not w.get("fixed"):
            n += 1
    return n


def _clamp(words: list[dict], dur: float) -> list[dict]:
    """Words of a piece (seconds from its start) -> never outside it: a clip that begins in the middle of a word has
    only the rest of that word in the sequence, so the word cannot start before the clip (seen: „Ах,“ 0.6 s before it)."""
    out = []
    for w in words:
        a = min(max(w["start"], 0.0), dur)
        out.append(dict(w, start=a, end=min(max(w["end"], a), dur)))
    return out


def _raw_doubt(words: list[dict]) -> bool:
    """Doubt in what Whisper heard, before the dictionary repairs it (0.10.95): a word the dictionary does not know. A low
    probability alone is not asked about (most pieces have one: every job would read everything three times)."""
    return _unknown(words) > 0


def _louder_reading(win: dict, y, prompt: str, spoken: dict, pairs, progress, cancelled, learned=None, names=(), prof=None) -> list[dict]:
    """The window read again LOUDER (0.10.95) -> its words, aligned on the window's own sound, in window seconds."""
    z = np.clip(y * LOUDER, -1.0, 1.0).astype(np.float32)
    key = _words_key(z, prompt, prof.tag if prof else "")
    entry = _cached(key) or {}
    if "words" not in entry:
        entry = {"words": _heard(z, prompt, prof, progress, cancelled)}
        _store(key, entry)
    words, _ = _aligned(y, entry["words"], entry, key, spoken, pairs, learned, names)
    return words


def _best_by_sound(y, lo: float, hi: float, texts: list[str], prof=None) -> int:
    """Which reading of a piece fits its sound best (0.10.95): Whisper scores each text over the piece's sound; another
    reading replaces the first (index 0) only when it scores SOUND_MARGIN higher in all AND per token (a reading is not
    better for leaving words out). The first when the texts are the same, a text is empty, the piece is too long to score,
    or the check fails."""
    a, b = max(0.0, lo - 0.3), hi + 0.3
    if b - a > SOUND_MAX_S or len(set(texts)) == 1 or not texts[0].strip():
        return 0
    try:
        kw = {"kind": asr.full_precision()} if prof is not None and prof.full and asr.full_precision() != asr.LARGE else {}
        scores = asr.score_texts(y[int(a * ASR_SR):int(b * ASR_SR)], [t if t.strip() else "…" for t in texts], counts=True, **kw)
    except Exception as e:                                 # noqa: BLE001 - no check: the first reading stays
        log.warning("subtitles: sound check of the readings failed: %s", e)
        return 0
    best = 0
    for k in range(1, len(texts)):
        s, n = scores[k]
        bs, bn = scores[best]
        if texts[k].strip() and s >= bs + SOUND_MARGIN and s / n > bs / bn:
            best = k
    return best


def _unknown(words: list[dict]) -> int:
    """Words the dictionary does not know and could not repair: the reason to ask for a second opinion."""
    return sum(1 for w in words if len(consensus.norm(w["word"])) >= 4 and lexicon.known(w["word"]) is False)


class Learned:
    """The learned fixes of one run (learning.Plan) and what happened to them: the editor's own lines are noted with
    the words around them (to be learned after the run), a learned fix is used only where the sound does not speak
    against it (audiocheck.py), at most MAX_CHECKS checks per run."""

    def __init__(self, plan):
        self.plan = plan
        self.contexts: list[dict] = []
        self.used: list[dict] = []
        self.vetoed: list[dict] = []
        self.checks = 0
        self.lock = threading.Lock()

    def saw(self, pair, words, i, n) -> bool:
        left = consensus.norm(words[i - 1]["word"]) if i > 0 else ""
        right = consensus.norm(words[i + n]["word"]) if i + n < len(words) else ""
        example = " ".join(w["word"] for w in words[max(0, i - 3):i + n + 3])
        with self.lock:
            self.contexts.append({"heard": pair[0], "said": pair[1], "left": left, "right": right, "example": example})
        return True

    def prefetch(self, y, entry, key, words) -> None:
        """The sound checks `accept` will ask for in these words, all at the same time (about 10 s each on the Mac's processor,
        one after another before 0.10.2). Stored where `accept` looks first, so what it decides does not change."""
        checks = entry.setdefault("checks", {})
        todo = []

        def found(ws, i, n, k):
            rule = self.plan.rules[k]
            mark = f"{round(ws[i]['start'], 2)}|{rule.key}"
            if mark not in checks and self.plan.context_ok(ws, i, n, k) and all(t[0] != mark for t in todo):
                todo.append((mark, i, n, rule.said))
            return False
        corrections.apply(words, self.plan.pairs, _variants, found)
        with self.lock:
            todo = todo[:max(0, MAX_CHECKS - self.checks)]
            self.checks += len(todo)
        if not todo:
            return

        def one(t):
            try:
                return round(audiocheck.margin(y, words, t[1], t[2], t[3]), 2)
            except Exception as e:                             # noqa: BLE001 - no check, no learned fix
                log.warning("learning: sound check failed: %s", e)
                return None
        with ThreadPoolExecutor(max_workers=max(1, min(asr.workers(), len(todo)))) as pool:
            margins = list(pool.map(one, todo))
        for (mark, *_), m in zip(todo, margins):
            if m is not None:
                checks[mark] = m
        _store(key, entry)

    def accept(self, y, entry, key, words, i, n, k) -> bool:
        rule = self.plan.rules[k]
        if not self.plan.context_ok(words, i, n, k):
            return False
        mark = f"{round(words[i]['start'], 2)}|{rule.key}"
        checks = entry.setdefault("checks", {})
        m = checks.get(mark)
        if m is None:
            with self.lock:
                if self.checks >= MAX_CHECKS:
                    return False
                self.checks += 1
            try:
                m = round(audiocheck.margin(y, words, i, n, rule.said), 2)
            except Exception as e:                             # noqa: BLE001 - no check, no learned fix
                log.warning("learning: sound check failed: %s", e)
                return False
            checks[mark] = m
            _store(key, entry)
        heard = " ".join(w["word"] for w in words[i:i + n])
        with self.lock:
            (self.used if audiocheck.fits(m) else self.vetoed).append({"heard": heard, "said": rule.said, "margin": m, "key": rule.key})
        return audiocheck.fits(m)


def _aligned(y, entry_words: list[dict], entry: dict, key: str, spoken: dict, pairs, learned=None, names=()) -> tuple[list[dict], dict]:
    """Writing rules, the editor's corrections, learned fixes, then alignment (cached per corrected text), then out of
    silence, then English words written in English -> (words, info). The writing rules come first: the editor writes
    corrections from what the captions show. English comes after the aligner: the Cyrillic spelling is what was heard, so it
    is what the sound is matched to, and the dictionary checks after this leave Latin words alone."""
    info = {"aligned": 0, "weak": 0}
    words, info["norms"] = bgnorm.apply(entry_words)
    saw = (lambda ws, i, n, k: learned.saw(pairs[k], ws, i, n)) if learned else None
    words, info["applied"] = corrections.apply(words, pairs, _variants, saw)
    if learned and learned.plan.pairs:
        learned.prefetch(y, entry, key, words)
        words, _ = corrections.apply(words, learned.plan.pairs, _variants,
                                     lambda ws, i, n, k: learned.accept(y, entry, key, ws, i, n, k))
    if align.available():
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
    words, info["trimmed"] = align.trim_silence(y, words)           # a word is not spoken in silence
    words, info["unheard"] = align.unheard(y, words)                # and a word with no speech under it is only marked
    info["gaps"] = align.uncovered_speech(y, words)                 # speech-like sound that has no word
    words, info["english"] = english.apply(words, names)            # „бюти сектор“ -> "Beauty Sector" (english.py)
    return words, info


def _second_opinion(sg: dict, prompt: str, spoken: dict, pairs, progress, cancelled, learned=None, names=(), prof=None) -> list[dict]:
    """The piece alone with SECOND_PAD seconds of context -> its words, in seconds from the start of the piece."""
    seg = {"path": sg["path"], "start": sg["start"], "end": sg["end"]}
    y, lead = read_segment(seg, SECOND_PAD)
    key = _words_key(y, prompt, prof.tag if prof else "")
    entry = _cached(key) or {}
    if "words" not in entry:
        entry = {"words": _heard(y, prompt, prof, progress, cancelled, beam=SECOND_BEAM)}
        _store(key, entry)
    words, _ = _aligned(y, entry["words"], entry, key, spoken, pairs, learned, names)
    dur = sg["end"] - sg["start"]
    return _clamp([dict(w, start=w["start"] - lead, end=w["end"] - lead) for w in words if _inside(w, lead, lead + dur)], dur)


def _speaker_forms(checked: list[dict], gender: str, y, lo: float, entry: dict, key: str) -> tuple[list[dict], list, list]:
    """A piece's words (seconds from the piece) and the gender of the person on its track -> (words, changes, doubts).
    A first-person form of the other gender is changed unless Whisper finds the changed word clearly worse for the sound
    (audiocheck.VETO); then it stays as heard and is listed for the editor (guide §2.3)."""
    changes, doubts = [], []
    out = [dict(w) for w in checked]
    for i, g in agreement.speaker_forms(out):
        if g == gender or out[i].get("fixed"):
            continue
        new = agreement.to_gender(out[i]["word"], gender)
        if not new:
            continue
        mark = f"g|{round(out[i]['start'] + lo, 2)}|{out[i]['word']}|{gender}"
        checks = entry.setdefault("checks", {})
        m = checks.get(mark)
        if m is None:
            shifted = [dict(w, start=w["start"] + lo, end=w["end"] + lo) for w in out]
            try:
                m = round(audiocheck.margin(y, shifted, i, 1, new), 2)
            except Exception as e:                             # noqa: BLE001 - no check: keep what was heard, mark it
                log.warning("speaker forms: sound check failed: %s", e)
                m = -999.0
            checks[mark] = m
            _store(key, entry)
        if audiocheck.fits(m):
            changes.append({"from": out[i]["word"], "to": new, "margin": m})
            out[i] = dict(out[i], word=new, speaker=True)
        else:
            doubts.append((i, f"the speaker on this track is set as a {'man' if gender == 'm' else 'woman'}, but the other form is heard"))
    return out, changes, doubts


def window_words(win: dict, read: dict, spoken: dict, pairs=(), vocab=frozenset(), prompt="", progress=None, cancelled=None,
                 learned=None, speakers=None, names=(), strict=True, prof=None) -> tuple[list[dict], dict]:
    """Words of every piece in a window, in SEQUENCE seconds, plus {"cached", "aligned", "weak", "align_error"?, "changed",
    "unsure", "changes", "applied", "trimmed", "second": [(sequence second, "A"|"B")]}.

    The editor's corrections replace the heard words BEFORE the alignment, so the new words get the times of the sound;
    the words are aligned, taken out of silence, and each piece keeps the words that lie inside it; consensus.merge then
    checks them against the dictionary (spelling by ear) and marks what stays doubtful. A piece that still holds
    unknown words gets a second opinion (that piece alone, narrow context); the reading with fewer doubts is kept."""
    progress = progress or (lambda f, m: None)
    cancelled = cancelled or (lambda: False)
    y, key, entry = read["y"], read["key"], read["entry"]
    words, info = _aligned(y, entry["words"], entry, key, spoken, pairs, learned, names)
    info["cached"] = read["cached"]
    # strict (0.10.94): the dictionary's syllable rule and „карао“ -> „карал“ in every style but ReShape's (lexicon.py)
    repair = lambda w, doubt=True: lexicon.repair(w, doubt, vocab, strict)
    if prof is not None and prof.repair == "careful":
        repair = lambda w, doubt=True: lexicon.repair(w, doubt, vocab, strict, careful=True)
    elif prof is not None and prof.repair == "ear":
        repair = lambda w, doubt=True: lexicon.repair_by_ear(w, doubt, vocab)
    elif prof is not None and prof.repair == "steps+ear":       # the shipped steps; where they do not choose, the nearest by ear
        repair = lambda w, doubt=True: lexicon.repair(w, doubt, vocab, strict) or lexicon.repair_by_ear(w, doubt, vocab)
    elif prof is not None and prof.repair == "none":            # the words stand as read; an unknown word is only marked
        repair = lambda w, doubt=True: None
    elif prof is not None and prof.repair == "careful+ear":
        repair = lambda w, doubt=True: lexicon.repair(w, doubt, vocab, strict, careful=True) or lexicon.repair_by_ear(w, doubt, vocab)
    # what a doubtful piece gets (recognition.Profile.second). No profile: as before 0.10.119, by `strict` alone
    mode = prof.second if prof is not None else ("sound" if strict else "doubts")
    sound = mode in ("sound", "sound_only", "alone")
    swaps: list = []
    out: list[dict] = []
    changed = unsure = 0
    changes: list[dict] = []
    second: list = []
    disputes: list = []
    verbatim: list = []
    speaker_changes: list = []
    # the pieces that still hold unknown words get a second opinion; those readings are independent, so they run at the same
    # time (asr.workers() at once) instead of one after another: 96 s -> about 30 s on a 6-piece ReShape window, same words
    first = {}
    raw = {}
    for k, sg in enumerate(win["pieces"]):
        lo = sg["start"] - win["a"]
        hi = lo + (sg["end"] - sg["start"])
        mine = _clamp([dict(w, start=w["start"] - lo, end=w["end"] - lo) for w in words if _inside(w, lo, hi)], hi - lo)
        first[k] = consensus.merge(mine, [], lexicon.known, repair)
        raw[k] = mine
    need = [] if mode == "none" else [k for k, (checked, _) in first.items() if _unknown(checked) or agreement.forms(checked)
                                      or (sound and _raw_doubt(raw[k]))]   # 0.10.95: a doubt the dictionary repaired away still counts
    alts = {}
    louder = None
    if need:
        again = mode in ("sound", "sound_only")                # the whole window once more, louder ("alone": only the pieces)
        with ThreadPoolExecutor(max_workers=max(1, min(asr.workers(), len(need) + (1 if again else 0)))) as pool:
            futures = {k: pool.submit(_second_opinion, win["pieces"][k], prompt, spoken, pairs, progress, cancelled, learned, names, prof)
                       for k in need}
            loud = pool.submit(_louder_reading, win, y, prompt, spoken, pairs, progress, cancelled, learned, names, prof) if again else None
            for k, f in futures.items():
                alts[k] = f.result()
            louder = loud.result() if loud else None
    for k, sg in enumerate(win["pieces"]):
        lo = sg["start"] - win["a"]
        hi = lo + (sg["end"] - sg["start"])
        for a, b in info["gaps"]:                                  # voiced sound without a word, inside this piece
            a, b = max(a, lo), min(b, hi)
            if b - a >= 0.4:
                disputes.append({"at": round(sg["at"] + a - lo, 2), "end": round(sg["at"] + b - lo, 2), "word": "",
                                 "reason": "speech without a word (a word may be missing, or it is breathing)"})
        verbatim += [{"word": w["word"], "start": round(sg["at"] + w["start"] - lo, 3), "end": round(sg["at"] + w["end"] - lo, 3), "p": w.get("p")}
                     for w in entry["words"] if _inside(w, lo, hi)]                    # what Whisper wrote, untouched
        checked, votes = first[k]
        gender = (speakers or {}).get(str(sg.get("track", "")))           # who speaks on this piece's track, if set
        before = checked
        if k in alts and sound:
            # 0.10.95: the reading whose text fits the piece's sound best (the first, the second opinion, the louder one)
            options = [(raw[k], checked, votes), (alts[k], *consensus.merge(alts[k], [], lexicon.known, repair))]
            if louder is not None:
                lw = _clamp([dict(w, start=w["start"] - lo, end=w["end"] - lo) for w in louder if _inside(w, lo, hi)], hi - lo)
                options.append((lw, *consensus.merge(lw, [], lexicon.known, repair)))
            pick = _best_by_sound(y, lo, hi, [" ".join(w["word"] for w in o[0]) for o in options], prof)
            if pick == 0 and mode in ("sound", "alone") and _doubts(options[1][1]) < _doubts(checked):
                pick = 1                                       # the sound did not decide: the doubt rule, as before
            if pick and mode == "alone" and len(options[pick][0]) < len(raw[k]):
                # a reading with fewer words does not win: measured 2026-11-20, without this rule the second readings broke
                # 33 words and fixed 27 (most of the broken ones simply left out), with it 10 and 19
                pick = 0
            second.append((round(sg["at"], 1), "ABC"[pick]))
            other = options[1 if pick == 0 else 0][1]
            checked, votes = options[pick][1], options[pick][2]
        elif k in alts:
            alt_checked, alt_votes = consensus.merge(alts[k], [], lexicon.known, repair)
            better = _doubts(alt_checked) < _doubts(checked)
            second.append((round(sg["at"], 1), "B" if better else "A"))
            other = checked if better else alt_checked
            if better:
                checked, votes = alt_checked, alt_votes
            for i in ([] if gender in ("m", "f") else agreement.disputed(checked, other)):
                # the two readings hear different genders and nobody said who speaks here: say so, change nothing
                checked[i]["p"] = min(checked[i].get("p", 1.0), consensus.UNSURE_P)
                votes["unsure"] += 1
                disputes.append({"at": round(sg["at"] + checked[i]["start"], 2), "word": checked[i]["word"], "reason": "male or female form: the readings differ"})
        if prof is not None and prof.log and checked is not before:
            # another reading replaced this piece's words: both texts, so the change can be traced (the 2026-11-20 audit found
            # these swaps were most of the difference between what Whisper first wrote and the captions, and none was listed)
            swaps.append({"at": round(sg["at"], 2), "pick": second[-1][1], "from": " ".join(w["word"] for w in before),
                          "to": " ".join(w["word"] for w in checked)})
        if gender in ("m", "f"):
            checked, said, doubts = _speaker_forms(checked, gender, y, lo, entry, key)
            speaker_changes += said
            for i, reason in doubts:
                checked[i]["p"] = min(checked[i].get("p", 1.0), consensus.UNSURE_P)
                votes["unsure"] += 1
                disputes.append({"at": round(sg["at"] + checked[i]["start"], 2), "word": checked[i]["word"], "reason": reason})
        kept = []
        for w in checked:
            if w.get("unheard") and (w["start"] <= EDGE or w["end"] >= hi - lo - EDGE):
                # the clip's edge cuts a word that was not heard clearly: a scrap of the next sentence („На“ at the end of the
                # ReShape video), not a line to show
                disputes.append({"at": round(sg["at"] + w["start"], 2), "word": w["word"], "reason": "cut off by the edge of the clip: left out"})
                continue
            if w.get("unheard"):
                w["p"] = min(w.get("p", 1.0), consensus.UNSURE_P)
                votes["unsure"] += 1
                disputes.append({"at": round(sg["at"] + w["start"], 2), "word": w["word"], "reason": "not clearly audible (quiet noise)"})
            kept.append(w)
        checked = kept
        changed += votes["changed"]
        unsure += votes["unsure"]
        changes += votes["changes"]
        out += [dict(w, start=round(sg["at"] + w["start"], 3), end=round(sg["at"] + w["end"], 3)) for w in checked]
    info.update(changed=changed, unsure=unsure, changes=changes, second=second, disputes=disputes, verbatim=verbatim,
                speaker=speaker_changes, swaps=swaps)
    return out, info


def _same_word(a: dict, b: dict) -> bool:
    return a["word"] == b["word"] and abs(a["start"] - b["start"]) < 0.15


def _file_stem(name: str) -> str:
    stem = re.sub(r"[^\w\-. ()]", "_", name, flags=re.UNICODE).strip(" .") or "subtitles"
    return f"{stem[:60]} {time.strftime('%Y-%m-%d %H-%M-%S')}"


def _warm_translator() -> None:
    try:
        translate._load()
    except Exception as e:                                 # noqa: BLE001 - the English step reports its own error later
        log.warning("translator preload failed: %s", e)


def run(body: dict, progress: Callable[[float, str], None], cancelled: Callable[[], bool]) -> dict:
    p = validate(body)
    t0 = time.time()
    prof = recognition.for_preset(p["preset"])            # how this run hears and reads: ReShape's frozen way, or the others'
    if p["english"] and translate.available():            # the translator loads while Whisper reads (it is needed at the end)
        threading.Thread(target=_warm_translator, name="translator-load", daemon=True).start()
    mix = build_mix(p["items"], lambda f, m: progress(0.1 * f, m), cancelled)
    segments = mix["segments"]
    parsed = corrections.parse(p["text"])
    learned = None
    if p["project"]:
        try:                                               # learning never stops the subtitles
            learned = Learned(learning.plan_for(p["project"], parsed["pairs"]))
        except Exception as e:                             # noqa: BLE001
            log.warning("learning: not available for this run: %s", e)
    names = p["terms"] + parsed["terms"] + (learned.plan.terms if learned else [])
    prompt = subtitles.initial_prompt(names)
    # who speaks on which microphone track: the project's own choice, else the client's last one (Captions tab)
    speakers = {**(learned.plan.speakers if learned else {}), **subtitle_settings.get(p["project"]).get("speakers", {})} if p["project"] else {}
    if prof.part:
        # a long piece read in parts cut at its quietest moments: the readers work side by side, and a mistake is not carried
        # through two minutes of speech (the rough cut has read this way since 0.10.25; imported here: it imports this module)
        from .roughcut_job import split_long
        wins = plan_windows(split_long(segments, part=prof.part), max_window=prof.part + 2 * PAD)
    else:
        wins = plan_windows(segments)
    total = sum(w["b"] - w["a"] for w in wins) or 1.0
    words: list[dict] = []
    cached = True
    aligned = weak = changed = unsure = 0
    changes: list[dict] = []
    second: list = []
    disputes: list = []
    verbatim: list = []
    applied = [0] * len(parsed["pairs"])
    align_error = None
    norms: list = []
    english_words: list = []
    speaker_changes: list = []
    t_asr = time.time()
    shares = [(w["b"] - w["a"]) / total for w in wins]
    frac = [0.0] * len(wins)

    def read_one(i: int) -> dict:
        def on_progress(f, m):
            frac[i] = f
            progress(0.1 + 0.75 * sum(a * b for a, b in zip(frac, shares)), m)
        return read_window(wins[i], prompt, on_progress, cancelled, prof)
    # pass 1: Whisper reads every window once, several at the same time (one reading cannot use many cores, see asr.py)
    order = sorted(range(len(wins)), key=lambda i: -(wins[i]["b"] - wins[i]["a"]))        # the longest first: no long tail
    reads: list = [None] * len(wins)
    with ThreadPoolExecutor(max_workers=max(1, min(asr.workers(), len(wins)))) as pool:
        futures = {i: pool.submit(read_one, i) for i in order}
        try:
            for i, f in futures.items():
                reads[i] = f.result()
        except BaseException:
            for f in futures.values():
                f.cancel()
            raise
    cached = all(r["cached"] for r in reads)
    vocab = vocabulary(reads, [t for _, b in parsed["pairs"] for t in b.split()])
    def finish_one(i: int):
        # a window ElevenLabs could not read was read here: it gets this computer's whole profile, second readings included
        wp = recognition.local(prof) if reads[i].get("fallback") else prof
        return window_words(wins[i], reads[i], p["spoken"], parsed["pairs"], vocab, prompt, lambda f, m: None, cancelled, learned,
                            speakers, names, wp.strict, wp)
    progress(0.86, "Aligning the words to the sound…")
    with ThreadPoolExecutor(max_workers=max(1, min(asr.workers(), len(wins)))) as pool:   # pass 2: corrections, alignment, spelling
        futures = [pool.submit(finish_one, i) for i in range(len(wins))]
        try:
            results = [f.result() for f in futures]
        except BaseException:
            for f in futures:
                f.cancel()
            raise
    swaps: list = []
    for ws, info in results:
        swaps += info["swaps"]
        second += info["second"]
        disputes += info["disputes"]
        verbatim += info["verbatim"]
        words += ws
        aligned += info["aligned"]
        weak += info["weak"]
        changed += info["changed"]
        unsure += info["unsure"]
        changes += info["changes"]
        applied = [a + b for a, b in zip(applied, info["applied"])]
        norms += info["norms"]
        english_words += info["english"]
        speaker_changes += info["speaker"]
        align_error = align_error or info.get("align_error")
    asr_s = time.time() - t_asr
    words.sort(key=lambda w: (w["start"], w["end"]))
    unique: list[dict] = []
    seam: list = []
    for w in words:                                        # pieces that touch can both claim a word at the seam
        if not any(_same_word(w, u) for u in unique[-3:]):
            unique.append(w)
        else:
            seam.append({"at": w["start"], "word": w["word"]})
    words, tidy = subtitles.tidy_words(unique)
    found = suspects.find(words)                           # reported and marked "?", never rewritten (guide §5)
    found += [{"i": i, "word": words[i]["word"], "at": words[i]["start"], "reason": r} for i, r in agreement.mismatches(words)]
    for f in found:
        words[f["i"]]["p"] = min(words[f["i"]].get("p", 1.0), consensus.UNSURE_P)
    review = sorted(disputes + [{"at": round(f["at"], 2), "word": f["word"], "reason": f["reason"]} for f in found], key=lambda r: r["at"])
    progress(0.96, "Arranging the lines…")

    preset = subtitles.preset_for(p["width"], p["height"]) if p["preset"] == "auto" else p["preset"]
    # every clip start is an edit: a line does not appear before the cut it belongs to
    captions = subtitles.build_captions(words, preset, p["fps"], cuts={it["at"] for it in p["items"]}, max_words=p["max_words"],
                                       case=p["case"], line_break=p["line_break"])

    folder = os.path.join(p["out_dir"], "Asistent_subtitles")
    os.makedirs(folder, exist_ok=True)
    stem = os.path.join(folder, _file_stem(p["name"]))
    subtitles.write_srt(captions, stem + ".srt", colour=p["colour"])      # the Line break's bottom line in its colour
    # the English line (the user's reference style): one per Bulgarian line, the same times, translated sentence by sentence
    english, english_note = None, None
    if p["english"]:
        if translate.available():
            progress(0.97, "Translating into English…")
            # from the words as spoken, with their punctuation: a "bare" preset shows none, but the sentences are found by it
            # the editors' word fixes for this client, then this project's own (plain words first: translate.PLAIN)
            en_words = merge_english_words(learned.plan.english_words if learned else {}, p["english_words"], p["english_words_off"])
            english = translate.english_lines([" ".join(w["word"] for w in c["words"]) for c in captions], en_words)
            if subtitles.PRESETS[preset].get("bare"):
                english = [translate.bare(e) for e in english]
            # the editor's own English (Captions tab) wins wherever its Bulgarian line is still the same; then what the
            # client's editors typed for the same line in other projects
            fixed = {**(learned.plan.english if learned else {}), **p["english_fixed"]}
            english = [fixed.get(line_key(c["text"]), e) for c, e in zip(captions, english)]
            if p["case"] == "upper":                       # the editor's ALL CAPS: the English line too, after its fixes
                english = [e.upper() for e in english]
            empty = sum(1 for e in english if not e.strip()) if p["max_words"] else 0
            if empty:                                      # a few words a line: the English has fewer words than lines
                english_note = (f"{empty} English {'line is' if empty == 1 else 'lines are'} empty: with this few words per line "
                                "the English cannot follow line by line.")
            subtitles.write_srt([{**c, "text": e} for c, e in zip(captions, english)], stem + ".en.srt")
        else:
            english_note = "The English line needs the translator (models/nllb-600m-int8 and the sentencepiece package): see README."
    flagged = sum(len(c["flags"]) for c in captions)
    timing = "aligned" if aligned else "whisper"
    if learned:                                            # second opinions finish in any order: the report is the same every run
        for lst in (learned.used, learned.vetoed):
            lst.sort(key=lambda u: (u["key"], u["heard"], u["margin"]))
    result = {
        "srt": stem + ".srt", "json": stem + ".json", "preset": preset, "fps": subtitles.exact_fps(p["fps"]),
        "captions": [{"start": c["start"], "end": c["end"], "text": c["text"], "flags": c["flags"],
                      **({"en": english[i]} if english else {}), **({"accent": c["accent"]} if "accent" in c else {})}
                     for i, c in enumerate(captions)],
        "srt_en": stem + ".en.srt" if english else None, "english_note": english_note,
        "english_learned": dict(learned.plan.english_words) if learned else {},      # so the panel can take one back (0.10.6)
        "counts": {"captions": len(captions), "words": len(words), "flagged": flagged, "pieces": len(segments)},
        "timing": {"method": timing, "aligned": aligned, "weak": weak, "error": align_error},
        "corrections": [{"heard": a, "said": b, "applied": n} for (a, b), n in zip(parsed["pairs"], applied)],
        "correction_errors": parsed["errors"],
        "review": review,
        "readings": {"windows": len(wins), "seconds": round(sum(w["b"] - w["a"] for w in wins), 1), "changed": changed, "changes": changes, "second_opinions": second, "commas": tidy["commas"], "joined": tidy["joined"], "unsure": unsure, "dictionary": lexicon.available()},
        "tracks": sorted({int(sg.get("track", 0)) for sg in segments}), "speakers": speakers,
        "learning": ({"client": learned.plan.client, "shared": learned.plan.client is not None, "rules": len(learned.plan.rules),
                      "used": learned.used, "vetoed": learned.vetoed} if learned else None),
        "notes": mix["notes"], "duplicates": mix["duplicates"], "skipped": p["skipped"],
        "origin": round(mix["origin"], 3), "mix_seconds": round(len(mix["audio"]) / ASR_SR, 1), "asr_seconds": round(asr_s, 1), "cached": cached,
    }
    if prof.cloud:
        # who read the words, for the panel's result line: a new key, only in a run that asked ElevenLabs (the ReShape
        # run's JSON keeps exactly the keys it has). "fallback": why some or all windows were read on this computer
        reasons = sorted({r["fallback"] for r in reads if r.get("fallback")})
        result["recognizer"] = {"name": cloudasr.NAME, "windows": len(wins), "local": sum(1 for r in reads if r.get("fallback")),
                                "fallback": reasons}
    if p["max_words"]:
        # the editor's Max words, for the panel's result line: a new key, only when a cap was asked (ReShape and default
        # runs keep exactly the keys they have)
        result["max_words"] = p["max_words"]
    if p["case"]:
        result["case"] = p["case"]                         # the editor's Case, likewise only when one was asked
    if p["line_break"]:
        result["line_break"] = True                        # the editor's Line break and its colour, likewise
        if p["colour"]:
            result["colour"] = p["colour"]
    with open(stem + ".json", "w", encoding="utf-8") as f:
        # the verbatim layer (what Whisper wrote) is never edited; every change to it is listed in `edits`
        edits = {"corrections": result["corrections"], "writing": norms, "english": english_words, "speaker_forms": speaker_changes, "spelling": changes, "commas": tidy["commas"],
                 "joined_tokens": tidy["joined"], "second_opinions": second, "review": review,
                 "learned": learned.used if learned else [], "learned_refused": learned.vetoed if learned else []}
        extra = {}
        if prof.log:
            # new keys, written only by a profile that asks for them: the ReShape run's JSON is compared whole with its
            # baseline (scripts/reshape_golden.py) and must keep exactly the keys it has
            edits["swapped_pieces"] = sorted(swaps, key=lambda s: s["at"])     # a piece whose words another reading replaced
            edits["seam_duplicates"] = seam                                     # a word two touching pieces both claimed: one kept
            extra["profile"] = prof.name
        json.dump({**result, **extra, "words": words, "verbatim": sorted(verbatim, key=lambda w: w["start"]), "edits": edits,
                   "items": p["items"], "segments": segments}, f, ensure_ascii=False, indent=1)
    log.info("subtitles: %d captions, %d words (%d flagged) from %d pieces in %d windows (%.0f s of audio read), timing %s "
             "(%d aligned, %d weak%s), asr+align %.1f s%s, total %.1f s, preset %s -> %s", len(captions), len(words), flagged,
             len(segments), len(wins), sum(w["b"] - w["a"] for w in wins), timing,
             aligned, weak, f", {align_error}" if align_error else "", asr_s, " (cached)" if cached else "",
             time.time() - t0, preset, stem + ".srt")
    if learned:                                            # in the background: the editor does not wait for the server
        learning.record(learned.plan, learned.contexts, parsed["terms"], p["english_fixed"], used=learned.used,
                        english_words=p["english_words"], english_words_off=p["english_words_off"])
        log.info("learning: %s, %d learned fixes active, %d used, %d refused by the sound", learned.plan.client or "this computer",
                 len(learned.plan.rules), len(learned.used), len(learned.vetoed))
    progress(1.0, "Done")
    return result
