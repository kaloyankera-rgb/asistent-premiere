"""Is this a Bulgarian word? (Hunspell bg_BG through the pure-Python `spylls`; optional.)

Whisper's probability does not tell a wrong word from a right one („нища“ had 0.68, „градината“ 0.68), and voting between
readings alone can turn a right word into a wrong one („градвината“, seen on the Ludi Glavi test). A dictionary can:
a word is replaced only by a word the dictionary knows, and only when it does not know the word being replaced.

Not found is not wrong: names, brands and slang are missing from any dictionary, so an unknown word is only reported
(„?“) when Whisper is unsure of it too. Latin letters and digits are never judged. Without the dictionary or `spylls`
everything is „unknown“ (None) and no word is replaced.

The dictionary (LibreOffice `dictionaries/bg_BG`, GPL v2, by Radostin Radnev et al.) is downloaded into
`<app>/models/lexicon/` by `scripts/setup_mac.sh --subtitles`; it is not part of the repository.
"""
from __future__ import annotations

import importlib.util
from functools import lru_cache
import logging
import os
import re
import threading

from . import config

log = logging.getLogger("asistent")
_lock = threading.Lock()
_state: dict = {"dict": None, "tried": False}
_CYR = re.compile(r"[а-яА-ЯёЁѝЍ]")


def dict_base() -> str:
    return os.path.join(config.app_dir(), "models", "lexicon", "bg_BG")


def available() -> bool:
    return importlib.util.find_spec("spylls") is not None and os.path.isfile(dict_base() + ".dic") and os.path.isfile(dict_base() + ".aff")


def _load():
    with _lock:
        if not _state["tried"]:
            _state["tried"] = True
            if available():
                try:
                    from spylls.hunspell import Dictionary
                    _state["dict"] = Dictionary.from_files(dict_base())
                except Exception as e:                             # noqa: BLE001 - the dictionary is a convenience
                    log.warning("bulgarian dictionary not loaded: %s", e)
        return _state["dict"]


def reset() -> None:
    """Forget the loaded dictionary (tests, or after the files were installed)."""
    _candidates.cache_clear()
    with _lock:
        _state.update(dict=None, tried=False)


# Words that a general dictionary lacks but speech is full of.
EXTRA_WORDS = {"евро", "евроцент", "евроцента", "евроцентове", "цент", "цента", "центове"}
# Regular neuter diminutives (одеяло -> одеялце, одеялцето, одеялца, одеялцата): the dictionary lacks most of them. A
# word is accepted when its stem plus an ending of the base word is a dictionary word.
_DIMINUTIVE = ("цето", "цата", "це", "ца")
_BASE_ENDINGS = ("о", "е")


def _lookup(d, core: str) -> bool:
    c = core.lower()
    if c in EXTRA_WORDS or d.lookup(core) or d.lookup(c):
        return True
    for suf in _DIMINUTIVE:
        if c.endswith(suf) and len(c) > len(suf) + 3:
            stem = c[: -len(suf)]
            if any(d.lookup(stem + e) for e in _BASE_ENDINGS):
                return True
    return False


def known(word: str) -> bool | None:
    """True / False for a Bulgarian word; None when it cannot be judged (no dictionary, Latin letters, digits)."""
    d = _load()
    if d is None:
        return None
    parts = [p for p in re.split(r"[\s\-–]+", word) if p]
    verdicts = []
    for p in parts:
        core = re.sub(r"^\W+|\W+$", "", p, flags=re.UNICODE)
        if not core or not _CYR.search(core) or re.search(r"[A-Za-z0-9]", core):
            continue
        verdicts.append(_lookup(d, core))
    if not verdicts:
        return None
    return all(verdicts)


# Spoken Bulgarian reduces unstressed vowels (е is heard as и, о as у, а as ъ), drops a vowel next to я („одеяло“ is
# said „одяло“) and swallows endings; Whisper writes what it hears. A word the dictionary does not know is repaired to
# the real word it is the by-ear spelling of, trying the edits in this order and stopping at the first step that gives
# exactly one dictionary word (two candidates at a step: nothing is changed, the word is reported instead):
#   1. one reduced vowel swapped (нища -> неща)            2. one vowel added or dropped (одяло -> одеяло)
#   3. one letter of any kind (взиваме -> взимаме)          4. two vowel edits (одялоце -> одеялце)
# One edit always beats two. Steps 3-4 need longer words, and step 3 only for a word Whisper itself doubts (`doubt`): a
# name must not turn into a neighbouring word.
_REDUCED = {"е": "и", "и": "е", "о": "у", "у": "о", "а": "ъ", "ъ": "а"}
_VOWELS = "аеиоуъ"
_LETTERS = "абвгдежзийклмнопрстуфхцчшщъьюя"
_MIN_LEN = {1: 3, 2: 4, 3: 6, 4: 5}


def _swap(w):
    return {w[:i] + _REDUCED[c] + w[i + 1:] for i, c in enumerate(w) if c in _REDUCED}


def _vowel_edit(w):
    out = {w[:i] + v + w[i:] for i in range(len(w) + 1) for v in _VOWELS}
    out |= {w[:i] + w[i + 1:] for i, c in enumerate(w) if c in _VOWELS}
    return out


def _any_edit(w):
    out = {w[:i] + c + w[i + 1:] for i in range(len(w)) for c in _LETTERS}
    out |= {w[:i] + c + w[i:] for i in range(len(w) + 1) for c in _LETTERS}
    out |= {w[:i] + w[i + 1:] for i in range(len(w))}
    return out


@lru_cache(maxsize=4096)
def _candidates(word: str, doubt: bool) -> tuple:
    """-> (lead, tail, capital, [(step, [real words])...] in the order they are tried) for an unknown word, else None."""
    d = _load()
    if d is None or known(word) is not False:
        return None
    m = re.match(r"^([^\w]*)(.*?)([^\w]*)$", word, flags=re.UNICODE)
    lead, core, tail = m.groups()
    low = core.lower()
    if not re.fullmatch(r"[а-яъь]+", low):
        return None
    step1, step2 = _swap(low), _vowel_edit(low)
    tiers = [(1, step1), (2, step2)]
    if doubt:
        tiers.append((3, _any_edit(low) - step1 - step2))
    tiers.append((4, {b for a in step1 | step2 for b in (_swap(a) | _vowel_edit(a))} - step1 - step2))
    out = []
    for n, cands in tiers:
        if len(low) < _MIN_LEN[n]:
            continue
        found = sorted(c for c in cands if c != low and _lookup(d, c))
        if found:
            out.append((n, found))
            break                                            # the smallest edit that gives a real word decides
    return (lead, tail, core[:1].isupper(), tuple(out))


def repair(word: str, doubt: bool = True, prefer=frozenset()) -> str | None:
    """A word the dictionary does not know -> the ONE real word it is the by-ear spelling of (punctuation and capital
    letter kept), or None. `doubt`: Whisper is unsure of the word (allows step 3). `prefer`: words heard (confidently,
    and real) elsewhere in the same recording: when several real words fit at the smallest edit, exactly one of them
    in `prefer` decides („Взиваме“ has seven neighbours; the speaker says „взимаме“ all through the recording)."""
    c = _candidates(word, doubt)
    if not c or not c[3]:
        return None
    lead, tail, cap, ((n, found),) = c
    if len(found) > 1:
        found = [f for f in found if f in prefer]
        if len(found) != 1:
            return None                                      # several real words fit: do not choose
    new = found[0]
    if cap:
        new = new[:1].upper() + new[1:]
    return lead + new + tail


def reset_cache() -> None:
    _candidates.cache_clear()


respell = repair                                             # the first version of this function (one swapped vowel)
