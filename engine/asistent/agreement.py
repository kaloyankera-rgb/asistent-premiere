"""First-person past forms that carry the speaker's gender („съм свършил“ / „съм свършила“), detected so they can be CHECKED,
never converted (docs/BULGARIAN_TRANSCRIPTION_GUIDE.md §2). Both speakers are in most edits and there is no per-speaker
information, so a form is never rewritten; when two readings of the audio disagree on the gender of the same form, the
word is flagged for review.

Scope: an l-participle (…ал …ял …ил …ъл; feminine …ала …яла …ила …ъла) after „съм“/„бях“ with up to two small words
between („съм вече свършила“). „учител“ (noun) and third person („той е свършил“) are not matched."""
from __future__ import annotations

from .consensus import norm

AUX = {"съм", "бях"}
BETWEEN = {"вече", "не", "още", "току-що", "току", "що", "пак", "все", "почти"}
VOWELS = "аяиъ"


def _masc(t: str) -> bool:
    return len(t) > 3 and t.endswith("л") and t[-2] in VOWELS


def _fem(t: str) -> bool:
    return len(t) > 4 and t.endswith("ла") and t[-3] in VOWELS


def _after_aux(tokens: list[str], i: int) -> bool:
    for back in (1, 2, 3):
        if i - back < 0:
            return False
        if tokens[i - back] in AUX:
            return True
        if tokens[i - back] not in BETWEEN:
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


def disputed(words: list[dict], other: list[dict], within: float = 0.6) -> list[int]:
    """Indexes in `words` of agreement forms whose gender differs from a form in `other` at about the same time."""
    mine, theirs = forms(words), forms(other)
    out = []
    for i, g in mine:
        for j, h in theirs:
            if h != g and abs(words[i]["start"] - other[j]["start"]) <= within:
                out.append(i)
                break
    return out
