"""Speaker gender for the first-person past forms („съм свършил“ / „съм свършила“).

Whisper often cannot hear the final „а“ of such a participle and picks a form. The editor can say who speaks (Мъж /
Жена); „Авто“ decides only from what the speech itself shows: the first-person participles heard in ALL readings of
ALL pieces, and only when one gender has at least twice as many votes as the other (and at least two votes). Pitch
was tried and rejected: on the Ludi Glavi clips the estimate for one speaker ranged 150-258 Hz within one clip.

Scope, deliberately narrow: an l-participle (…ал/…ил/…ъл, feminine …ала/…ила/…ъла) right after „съм“/„бях“ (up to two
small words between, „съм вече свършила“). The other form must be a word of the Bulgarian dictionary. A word in the
form the speaker's gender wants is never touched.
"""
from __future__ import annotations

import re
from collections import Counter

from .consensus import norm

AUX = {"съм", "бях"}
BETWEEN = {"вече", "не", "още", "току-що", "току", "що", "пак", "все", "почти"}
VOWELS = "аяиъ"                      # l-participle endings: …ал …ял …ил …ъл (not …ел/…ол: „учител“ is a noun)
SETTINGS = ("auto", "male", "female")


def _masc(core: str) -> bool:
    return len(core) > 3 and core.endswith("л") and core[-2] in VOWELS


def _fem(core: str) -> bool:
    return len(core) > 4 and core.endswith("ла") and core[-3] in VOWELS


def _after_aux(tokens: list[str], i: int) -> bool:
    for back in (1, 2, 3):
        if i - back < 0:
            return False
        t = tokens[i - back]
        if t in AUX:
            return True
        if t not in BETWEEN:
            return False
    return False


def forms(words: list[dict]) -> list[tuple[int, str]]:
    """[(index, "m"|"f")] of the first-person participles in a word list."""
    toks = [norm(w["word"]) for w in words]
    out = []
    for i, t in enumerate(toks):
        if _after_aux(toks, i):
            if _fem(t):
                out.append((i, "f"))
            elif _masc(t):
                out.append((i, "m"))
    return out


def evidence(readings: list[list[dict]]) -> Counter:
    c: Counter = Counter()
    for ws in readings:
        for _, g in forms(ws):
            c[g] += 1
    return c


def resolve(setting: str, votes: Counter) -> str | None:
    """"m" / "f" / None (leave the forms as heard)."""
    if setting == "male":
        return "m"
    if setting == "female":
        return "f"
    m, f = votes.get("m", 0), votes.get("f", 0)
    if m + f >= 2 and m >= 2 * f and m > f:
        return "m"
    if m + f >= 2 and f >= 2 * m and f > m:
        return "f"
    return None


def apply(words: list[dict], gender: str | None, known) -> tuple[list[dict], list[dict]]:
    """-> (words, [{"at", "from", "to"}]). `known(word) -> bool|None` (lexicon.known); the converted form must be True."""
    out = [dict(w) for w in words]
    changed = []
    if gender not in ("m", "f"):
        return out, changed
    for i, g in forms(words):
        if g == gender:
            continue
        w = words[i]["word"]
        m = re.match(r"^([^\w]*)(.*?)([^\w]*)$", w, flags=re.UNICODE)
        lead, core, tail = m.groups()
        new = core[:-1] if g == "f" else core + "а"
        if known(new) is True:
            out[i]["word"] = lead + new + tail
            changed.append({"at": words[i]["start"], "from": w, "to": out[i]["word"]})
    return out, changed
