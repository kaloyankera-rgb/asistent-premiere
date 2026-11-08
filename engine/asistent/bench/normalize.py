"""Text -> word tokens for scoring Bulgarian recognition, in two views.

raw:        lower case, punctuation and quotes removed, everything else as written (digits stay digits).
normalized: raw + digits written out as spoken words (`numbers.spoken_form`) + the standard and colloquial forms of the
            same numeral made one („двадесет“ = „двайсет“), so „25“ and „двайсет и пет“ count as the same words.

Both views keep the letters that change meaning or form in Bulgarian: ъ, ь, й, ѝ (ѝ „her“ is not и „and“), and a hyphen
inside a word („по-добре“ stays one word, it is not „по добре“). Nothing is stemmed and no word is corrected: a wrong ending
is an error, as it is for the viewer.
"""
from __future__ import annotations

import re

from .. import numbers

# punctuation at the edges of a word; quotes anywhere. A hyphen between letters is kept (по-добре), a dash on its own is
# not, and a comma or point between digits is part of the number („19,90“ is not „1990“).
_EDGE = re.compile(r"^[\"„“”«»‚‘’'`()\[\]{}…:;!?.,]+|[\"„“”«»‚‘’'`()\[\]{}…:;!?.,]+$")
_QUOTES = re.compile(r"[\"„“”«»‚‘’`]+")
_LONE_DASH = re.compile(r"(?<!\w)[-–—]+|[-–—]+(?!\w)")
# standard written numerals -> the colloquial form numbers.spoken_form uses (the sound is the same number)
_NUMERAL_FORMS = {
    "единадесет": "единайсет", "дванадесет": "дванайсет", "тринадесет": "тринайсет", "четиринадесет": "четиринайсет",
    "петнадесет": "петнайсет", "шестнадесет": "шестнайсет", "седемнадесет": "седемнайсет", "осемнадесет": "осемнайсет",
    "деветнадесет": "деветнайсет", "двадесет": "двайсет", "тридесет": "трийсет", "четиридесет": "четирийсет",
    "шестдесет": "шейсет",
}


def raw_tokens(text: str) -> list[str]:
    text = _LONE_DASH.sub(" ", str(text).lower())
    return [t for t in (_QUOTES.sub("", _EDGE.sub("", w)) for w in text.split()) if t]


def normalized_tokens(text: str) -> list[str]:
    out = []
    for t in raw_tokens(text):
        spoken = numbers.spoken_form(t) if any(ch.isdigit() for ch in t) else None
        for w in (spoken.split() if spoken else [t]):
            out.append(_NUMERAL_FORMS.get(w, w))
    return out


def tokens(text: str, view: str = "raw") -> list[str]:
    if view == "raw":
        return raw_tokens(text)
    if view == "normalized":
        return normalized_tokens(text)
    raise ValueError(f"unknown view {view!r}")
