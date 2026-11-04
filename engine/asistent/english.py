"""English words a Bulgarian speaker says, written in English (the user, 2026-11-04: „Бюти сектор“ = "Beauty Sector",
„спей/с“ = "Space"). Whisper, reading Bulgarian, spells them in Cyrillic.

A writing rule like bgnorm.py: the same said word, only written another way; the times stay (it runs after the aligner) and
every change is listed in the edits. models/english_bg.json.gz (scripts/build_english_index.py) holds how a Bulgarian
writes each common English word from its pronunciation. A word is written in English when:
  * the editor's own name says so: a Latin name in the names box („Beauty Sector“) matched by how it sounds; or
  * it is not a Bulgarian word (dictionary), not one with its ending swallowed („работ“ is „работа“), has 4 letters or
    more, and is the usual Cyrillic spelling of a common English word („бюти“, „уоркшоп“, „спейс“; a Bulgarian loan
    spelled the Bulgarian way, „дискомфорт“, is not);
  * or it follows such a word and is also English by sound („бюти сектор“ -> "Beauty Sector").
Whisper sometimes splits a final s off as „се“ („спей се“ = "space"): a 1-2 letter „с…“ after the word may complete it.
Two or more English words in a row are a name and get capitals („Beauty Sector“); one word keeps the case it had.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import threading

from . import lexicon

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "english_bg.json.gz")
MIN_LETTERS = 4
_lock = threading.Lock()
_data: dict | None = None
CYR = re.compile(r"[а-яѝ]+")
ENDINGS = ("а", "я", "и", "е", "о", "у", "ът", "та", "те", "ти", "то")


def _load() -> dict:
    global _data
    with _lock:
        if _data is None:
            try:
                with gzip.open(PATH, "rt", encoding="utf-8") as f:
                    raw = json.load(f)
            except (OSError, ValueError):
                raw = {"strict": {}, "loose": {}}
            loose = {**raw["loose"], **raw["strict"]}
            sounds: dict[str, set] = {}
            for cyr, en in loose.items():
                sounds.setdefault(en, set()).add(cyr)
            _data = {"strict": raw["strict"], "loose": loose, "sounds": sounds}
        return _data


def available() -> bool:
    return bool(_load()["strict"])


def _split(word: str) -> tuple[str, str, str]:
    """„(Бюти,“ -> ("(", "Бюти", ",")."""
    m = re.match(r"^(\W*)(.*?)(\W*)$", word, flags=re.UNICODE)
    return m.group(1), m.group(2), m.group(3)


def _near_bulgarian(t: str) -> bool:
    """A Bulgarian word with its ending swallowed („работ“ = „работа“, „прес“ = „преса“): mis-heard Bulgarian, not English.
    (Any one-letter change was too wide: short words always have a Bulgarian neighbour, „бюти“ ~ „бити“.)"""
    return any(lexicon.known(t + e) for e in ENDINGS)


def _english_alone(t: str) -> str | None:
    if len(t) < MIN_LETTERS or not CYR.fullmatch(t) or lexicon.known(t) is not False:
        return None
    en = _load()["strict"].get(t)
    return en if en and not _near_bulgarian(t) else None


def _cased(en: str, like: str, title: bool) -> str:
    return en[:1].upper() + en[1:] if title or like[:1].isupper() else en


def _terms(names) -> list[list[str]]:
    """The editor's Latin names, as word lists („Beauty Sector“ -> ["Beauty", "Sector"])."""
    out = []
    for n in names or ():
        ws = str(n).split()
        if ws and all(re.fullmatch(r"[A-Za-z][A-Za-z'&.-]*", w) for w in ws):
            out.append(ws)
    return sorted(out, key=len, reverse=True)


def _sounds_like(cyr: str, en: str) -> bool:
    spellings = _load()["sounds"].get(en.lower())
    return bool(spellings) and cyr in spellings


def apply(words: list[dict], names=()) -> tuple[list[dict], list[dict]]:
    """Words ({"word", "start", "end", ...}) -> (words with English words written in English, [{"from", "to", "at"}])."""
    if not words or not available():
        return [dict(w) for w in words], []
    cores = [_split(w["word"]) for w in words]
    low = [c[1].lower() for c in cores]
    terms = _terms(names)
    out: list[dict] = []
    changes: list[dict] = []
    i = 0

    def merged(a: int, b: int, text: str) -> dict:
        """words[a:b] become one word `text` (start of the first, end of the last, punctuation around them kept)."""
        w = dict(words[a], word=cores[a][0] + text + cores[b - 1][2], end=words[b - 1]["end"], english=True)
        changes.append({"from": " ".join(x["word"] for x in words[a:b]), "to": w["word"], "at": words[a]["start"]})
        return w

    def tail_s(k: int, cyr: str) -> bool:
        """„спей се“: the next short „с…“ word is the English word's final s."""
        return k + 1 < len(words) and re.fullmatch(r"с[еи]?", low[k + 1] or "") is not None and not cores[k][2]

    while i < len(words):
        # 1. the editor's own names, matched by sound
        hit = None
        for t in terms:
            k, ok = i, True
            for en in t:
                if k >= len(words):
                    ok = False
                    break
                if _sounds_like(low[k], en):
                    k += 1
                elif tail_s(k, low[k]) and _sounds_like(low[k] + "с", en):
                    k += 2
                else:
                    ok = False
                    break
            if ok and k > i:
                hit = (k, " ".join(t))
                break
        if hit:
            out.append(merged(i, hit[0], hit[1]))
            i = hit[0]
            continue
        # 2. a common English word, then the English words right after it
        span, run = i, []
        while span < len(words):
            t = low[span]
            en, step = (_english_alone(t), 1) if not run else (_load()["loose"].get(t) if len(t) >= 3 else None, 1)
            if not en and tail_s(span, t):
                en, step = ((_english_alone(t + "с") if not run else _load()["loose"].get(t + "с")), 2)
            if not en or (run and cores[span - 1][2] not in ("", "-")):
                break                                         # punctuation ends a name
            run.append((span, span + step, en))
            span += step
        if not run:
            out.append(dict(words[i]))
            i += 1
            continue
        title = len(run) > 1
        for a, b, en in run:
            out.append(merged(a, b, _cased(en, cores[a][1], title)))
        i = span
    return out, changes
