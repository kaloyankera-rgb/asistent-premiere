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
    with _lock:
        _state.update(dict=None, tried=False)


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
        verdicts.append(bool(d.lookup(core)))
    if not verdicts:
        return None
    return all(verdicts)


# Unstressed vowels are reduced in Bulgarian speech: е is heard as и, о as у, а as ъ (and back). Whisper writes what it
# hears („нищá“ for „неща“), so a word the dictionary does not know may be a right word spelled by ear.
_REDUCED = {"е": "и", "и": "е", "о": "у", "у": "о", "а": "ъ", "ъ": "а"}


def respell(word: str) -> str | None:
    """A word the dictionary does not know -> the ONE known word that differs by one swapped vowel of the reduction
    pairs (keeping punctuation and capital letter); None when there is none or more than one (then it stays as heard
    and is reported). Names and brands almost never turn into exactly one real word this way."""
    d = _load()
    if d is None or known(word) is not False:
        return None
    m = re.match(r"^([^\w]*)(.*?)([^\w]*)$", word, flags=re.UNICODE)
    lead, core, tail = m.groups()
    found = set()
    for i, ch in enumerate(core):
        sw = _REDUCED.get(ch.lower())
        if sw:
            v = core[:i] + (sw.upper() if ch.isupper() else sw) + core[i + 1:]
            if d.lookup(v):
                found.add(v)
    return lead + found.pop() + tail if len(found) == 1 else None
