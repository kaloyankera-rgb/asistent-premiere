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
import gc
import logging
import os
import re
import threading
import warnings

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
                    # spylls 0.1.7 never closes the .aff/.dic it reads; collect them here, where their
                    # ResourceWarning is expected, instead of at a random later moment (it failed whichever
                    # test was running then under -W error)
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore", ResourceWarning)
                        _state["dict"] = Dictionary.from_files(dict_base())
                        gc.collect()
                except Exception as e:                             # noqa: BLE001 - the dictionary is a convenience
                    log.warning("bulgarian dictionary not loaded: %s", e)
        return _state["dict"]


def reset() -> None:
    """Forget the loaded dictionary (tests, or after the files were installed)."""
    _candidates.cache_clear()
    _by_ear.cache_clear()
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
#
# 0.10.94 (the user, 2026-11-15: "the transcribing of the Bulgarian talking is very inaccurate"; the 4a1a "Lokali" run):
# a repair never adds or drops a syllable, except the one vowel swallowed next to я / ю that step 2 was made for
# (одяло -> одеяло). Measured on all 16 repairs in the 30 earlier runs on this Mac: every one that changed the number of
# syllables was a different word („съседание“ -> „съседни“, said „състезание“; „Карао“ -> „Кара“, said „карал“; „тямо“ ->
# „тям“; „тавила“ -> „отавила“) and every right one kept it (гледаш, посока, градината, одеялце, видяло). Whisper's sound
# check (audiocheck.margin) could not tell them apart (right +2.4 … -15, wrong +8.8 … -19.9), so it is not used here.
# Step 0 is the colloquial -л said as a vowel („карао“, „карау“ for „карал“, the same word written as Bulgarian writes it,
# guide §1.3): tried before everything else, so the dictionary cannot turn it into a shorter word. The ReShape style keeps
# the rules from before (strict=False): the user, 2026-11-15, "leave ReShape as it is" (its golden run stays byte-identical).
_REDUCED = {"е": "и", "и": "е", "о": "у", "у": "о", "а": "ъ", "ъ": "а"}
_VOWELS = "аеиоуъ"
_SYLLABLE = set("аеиоуъюя")
_NEAR = set("яю")
_LETTERS = "абвгдежзийклмнопрстуфхцчшщъьюя"
_MIN_LEN = {0: 4, 1: 3, 2: 4, 3: 6, 4: 5}


def _syllables(w):
    return sum(c in _SYLLABLE for c in w)


def _swap(w):
    return {w[:i] + _REDUCED[c] + w[i + 1:] for i, c in enumerate(w) if c in _REDUCED}


def _vowel_edit(w):
    out = {w[:i] + v + w[i:] for i in range(len(w) + 1) for v in _VOWELS}
    out |= {w[:i] + w[i + 1:] for i, c in enumerate(w) if c in _VOWELS}
    return out


def _vowel_edit_near(w):
    """One vowel added or dropped right next to я / ю (the reduction step 2 repairs), nowhere else."""
    near = lambda i: (i > 0 and w[i - 1] in _NEAR) or (i < len(w) and w[i] in _NEAR)
    out = {w[:i] + v + w[i:] for i in range(len(w) + 1) if near(i) for v in _VOWELS}
    out |= {w[:i] + w[i + 1:] for i, c in enumerate(w)
            if c in _VOWELS and ((i > 0 and w[i - 1] in _NEAR) or (i + 1 < len(w) and w[i + 1] in _NEAR))}
    return out


def _vocalised_l(w):
    """„карао“ / „карау“ -> {"карал"}: the -л at the end said as о / у after a vowel."""
    return {w[:-1] + "л"} if len(w) >= 3 and w[-1] in "оу" and w[-2] in _SYLLABLE else set()


def _any_edit(w):
    out = {w[:i] + c + w[i + 1:] for i in range(len(w)) for c in _LETTERS}
    out |= {w[:i] + c + w[i:] for i in range(len(w) + 1) for c in _LETTERS}
    out |= {w[:i] + w[i + 1:] for i in range(len(w))}
    return out


@lru_cache(maxsize=4096)
def _candidates(word: str, doubt: bool, strict: bool = True) -> tuple:
    """-> (lead, tail, capital, [(step, [real words])...] in the order they are tried) for an unknown word, else None.
    `strict` (0.10.94): the syllable rule and step 0 above; False = the rules before 0.10.94, kept for the ReShape style."""
    d = _load()
    if d is None or known(word) is not False:
        return None
    m = re.match(r"^([^\w]*)(.*?)([^\w]*)$", word, flags=re.UNICODE)
    lead, core, tail = m.groups()
    low = core.lower()
    if not re.fullmatch(r"[а-яъь]+", low):
        return None
    step1, step2 = _swap(low), _vowel_edit(low)
    tiers = [(0, _vocalised_l(low))] if strict else []
    tiers += [(1, step1), (2, step2)]
    if doubt:
        tiers.append((3, _any_edit(low) - step1 - step2))
    tiers.append((4, {b for a in step1 | step2 for b in (_swap(a) | _vowel_edit(a))} - step1 - step2))
    out = []
    for n, cands in tiers:
        if len(low) < _MIN_LEN[n]:
            continue
        found = sorted(c for c in cands if c != low and _lookup(d, c))
        if found:
            if strict and n:
                # the step and its ties are decided exactly as before, then a word with a syllable more or less is dropped:
                # the rule only ever takes a repair away, never makes a looser step reach a word a tie used to protect
                near = _vowel_edit_near(low) | {b for a in step1 | _vowel_edit_near(low) for b in (_swap(a) | _vowel_edit_near(a))}
                found = [c for c in found if _syllables(c) == _syllables(low) or c in near]
            out.append((n, found))
            break                                            # the smallest edit that gives a real word decides
    return (lead, tail, core[:1].isupper(), tuple(out))


def repair(word: str, doubt: bool = True, prefer=frozenset(), strict: bool = True, careful: bool = False) -> str | None:
    """A word the dictionary does not know -> the ONE real word it is the by-ear spelling of (punctuation and capital
    letter kept), or None. `doubt`: Whisper is unsure of the word (allows step 3). `prefer`: words heard (confidently,
    and real) elsewhere in the same recording: when several real words fit at the smallest edit, exactly one of them
    in `prefer` decides („Взиваме“ has seven neighbours; the speaker says „взимаме“ all through the recording).
    `careful` (0.10.119, a recognition profile's choice, never the ReShape style's): steps 3 and 4 are not by-ear
    spellings, they swap a letter for any other, and a correct word the dictionary lacks then turns into its nearest
    neighbour („интубация“ -> „инкубация“, „асимулатор“ -> „асимилатор“). With `careful` those steps repair only to a
    word the recording itself says (`prefer`); otherwise the heard word stays and is marked for the editor."""
    c = _candidates(word, doubt, strict)
    if not c or not c[3] or not c[3][0][1]:
        return None
    lead, tail, cap, ((n, found),) = c
    if careful and n >= 3:
        found = [f for f in found if f in prefer]
        if len(found) != 1:
            return None
    if len(found) > 1:
        found = [f for f in found if f in prefer]
        if len(found) != 1:
            return None                                      # several real words fit: do not choose
    new = found[0]
    if cap:
        new = new[:1].upper() + new[1:]
    return lead + new + tail


# ---------------------------------------------------------------- repair by ear (0.10.119, a recognition profile's choice)
# The steps above stop at the first step that finds a real word and refuse to choose between two: „резумно“ stays as
# heard because „разумно“ and „безумно“ are both one letter away, and „изобратил“ because of „изобретил“ / „изобразил“.
# Measured on the editors' finished videos (2026-11-20, scripts/bench_subtitles.py): 35 of 200 wrong words in the final
# text were such non-words, the mistakes a viewer sees first. But the two neighbours are not equally likely by ear: a
# mis-heard VOWEL is the ordinary case (е for а in „резумно“), a different consonant (р for б) is another word. So every
# real word one edit away, and every one two vowels away, gets a cost by how far it is BY EAR, and the cheapest is taken
# when it is cheap enough and clearly cheaper than the next:
#   a reduced vowel (е/и, о/у, а/ъ) 0.4 · another vowel 0.6 · a voiced/voiceless pair (б/п, д/т, г/к, з/с, ж/ш, в/ф) 0.5 ·
#   a close consonant (ч/ш, ц/с, ц/т, ч/ц, щ/ш, м/н, й/и) 0.8 · any other consonant 1.6 · a letter said twice 0.3 ·
#   a vowel added or dropped 0.9 · a consonant added or dropped 1.2
# A word the recording itself says elsewhere (`prefer`) is 0.5 cheaper. A word Whisper is sure of (`doubt` False) or a
# short one may only move by a vowel: a name the dictionary lacks must not become its neighbour („интубация“ / „инкубация“
# costs 1.6 and is never taken).
EAR_LIMIT = 1.0            # the most a repair may cost
EAR_SURE = 0.6             # ... when Whisper is sure of the word, or the word has 4-5 letters
EAR_MARGIN = 0.25          # the next real word must cost at least this much more
_EAR_VOWELS = "аеиоуъ"
_VOICED = {frozenset(p) for p in ("бп", "дт", "гк", "зс", "жш", "вф")}
_CLOSE = {frozenset(p) for p in ("чш", "цс", "цт", "чц", "щш", "мн", "йи")}


def _ear_sub(a: str, b: str) -> float:
    if a in _EAR_VOWELS and b in _EAR_VOWELS:
        return 0.4 if _REDUCED.get(a) == b else 0.6
    pair = frozenset((a, b))
    return 0.5 if pair in _VOICED else 0.8 if pair in _CLOSE else 1.6


@lru_cache(maxsize=4096)
def _by_ear(low: str) -> tuple:
    """A lower-case unknown word -> ((cost, real word), ...) cheapest first: one edit of any kind, or two vowels."""
    d = _load()
    found: dict[str, float] = {}

    def offer(c: str, cost: float) -> None:
        if c != low and cost < found.get(c, 9.0) and cost <= EAR_LIMIT + 0.5 and _lookup(d, c):
            found[c] = cost
    if len(low) >= 3 and low[-1] in "оу" and low[-2] in _SYLLABLE:
        offer(low[:-1] + "л", 0.2)                              # „карао“: the -л said as a vowel (step 0 above)
    for i, ch in enumerate(low):
        for c in _LETTERS:
            if c != ch:
                offer(low[:i] + c + low[i + 1:], _ear_sub(ch, c))
        twice = (i > 0 and low[i - 1] == ch) or (i + 1 < len(low) and low[i + 1] == ch)
        offer(low[:i] + low[i + 1:], 0.3 if twice else 0.9 if ch in _EAR_VOWELS else 1.2)
    for i in range(len(low) + 1):
        for c in _LETTERS:
            offer(low[:i] + c + low[i:], 0.9 if c in _EAR_VOWELS else 1.2)
    spots = [i for i, ch in enumerate(low) if ch in _EAR_VOWELS]
    for a in range(len(spots)):
        for b in range(a + 1, len(spots)):
            i, j = spots[a], spots[b]
            for x in _EAR_VOWELS:
                for y in _EAR_VOWELS:
                    if x != low[i] and y != low[j]:
                        offer(low[:i] + x + low[i + 1:j] + y + low[j + 1:], _ear_sub(low[i], x) + _ear_sub(low[j], y))
    return tuple(sorted((cost, c) for c, cost in found.items()))


def repair_by_ear(word: str, doubt: bool = True, prefer=frozenset()) -> str | None:
    """A word the dictionary does not know -> the real word it most likely is by ear (punctuation and capital kept), or
    None when no real word is close enough or two are about equally close."""
    d = _load()
    if d is None or known(word) is not False:
        return None
    lead, core, tail = re.match(r"^([^\w]*)(.*?)([^\w]*)$", word, flags=re.UNICODE).groups()
    low = core.lower()
    if len(low) < 4 or not re.fullmatch(r"[а-яъь]+", low):
        return None
    ranked = sorted((max(0.1, cost - 0.5) if c in prefer else cost, c) for cost, c in _by_ear(low))
    if not ranked:
        return None
    limit = EAR_LIMIT if doubt and len(low) >= 6 else EAR_SURE
    cost, new = ranked[0]
    if cost > limit or (len(ranked) > 1 and ranked[1][0] - cost < EAR_MARGIN):
        return None
    if core[:1].isupper():
        new = new[:1].upper() + new[1:]
    return lead + new + tail


def candidates(word: str, strict: bool = True) -> list[str]:
    """Every real word an unknown word may be the by-ear spelling of, at the smallest edit (`repair` picks one of them only
    when it is the only one or the recording says it elsewhere)."""
    c = _candidates(word, True, strict)
    if not c or not c[3]:
        return []
    lead, tail, cap, ((n, found),) = c
    return [lead + (f[:1].upper() + f[1:] if cap else f) + tail for f in found]


def reset_cache() -> None:
    _candidates.cache_clear()
    _by_ear.cache_clear()


respell = repair                                             # the first version of this function (one swapped vowel)
