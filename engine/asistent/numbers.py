"""Spoken Bulgarian for digit strings, so the aligner can place them (align_worker.py aligns letters, not digits).

Whisper writes „500“ for „петстотин“; a word without letters cannot be aligned, so it kept Whisper's rough time and the
word after it looked late (seen on the C9025 prices: „евро“ after „500“ was 0.3-0.5 s late). The aligner is given the
spoken form of every number and puts the digit string where the number is pronounced.

Colloquial forms are used where speech differs from the written standard („двайсет“, „трийсет“, „шейсет“, „петнайсет“),
because the alignment follows the sound. Whisper's own digit word covers the whole spoken number, so the aligned span
is the first to the last spoken word. Only the alignment sees these words; the caption keeps the digits.
"""
from __future__ import annotations

import re

_UNITS = ["", "един", "два", "три", "четири", "пет", "шест", "седем", "осем", "девет"]
_TEENS = ["десет", "единайсет", "дванайсет", "тринайсет", "четиринайсет", "петнайсет", "шестнайсет", "седемнайсет",
          "осемнайсет", "деветнайсет"]
_TENS = ["", "", "двайсет", "трийсет", "четирийсет", "петдесет", "шейсет", "седемдесет", "осемдесет", "деветдесет"]
_FORMS = {"m": {}, "n": {1: "едно", 2: "две"}, "f": {1: "една", 2: "две"}}           # 1 and 2 by the gender of what is counted
_HUNDREDS = ["", "сто", "двеста", "триста", "четиристотин", "петстотин", "шестстотин", "седемстотин", "осемстотин", "деветстотин"]

NUMBER = re.compile(r"^\d{1,6}$")
DECIMAL = re.compile(r"^(\d{1,6})[,.](\d{1,2})$")
PERCENT = re.compile(r"^(\d{1,6})%$")


def _below_1000(n: int, last_unit: str) -> list[str]:
    """1..999 as spoken words, with „и“ before the last component; `last_unit` is the form of 1 and 2 at the end."""
    parts = []
    h, rest = divmod(n, 100)
    if h:
        parts.append(_HUNDREDS[h])
    if 10 <= rest < 20:
        parts.append(_TEENS[rest - 10])
    else:
        t, u = divmod(rest, 10)
        if t:
            parts.append(_TENS[t])
        if u:
            parts.append(_FORMS[last_unit].get(u, _UNITS[u]))
    if len(parts) > 1:
        parts.insert(len(parts) - 1, "и")
    return parts


def cardinal(n: int, neuter: bool = True) -> str | None:
    """0..999999 as spoken Bulgarian („едно“/„две“ at the end for the neuter nouns that follow prices: евро, левче),
    None above."""
    if n == 0:
        return "нула"
    if n < 0 or n > 999999:
        return None
    th, rest = divmod(n, 1000)
    words: list[str] = []
    if th:
        if th == 1:
            words.append("хиляда")
        else:
            words += _below_1000(th, "f")
            words.append("хиляди")
    if rest:
        tail = _below_1000(rest, "n" if neuter else "m")
        if th and (rest < 100 or rest % 100 == 0) and len(tail) >= 1:
            tail = ["и"] + tail if len(tail) == 1 else tail[:-2] + ["и"] + tail[-2:] if tail[-2] != "и" else tail
        words += tail
    return " ".join(words)


def spoken_form(token: str) -> str | None:
    """„500“ -> „петстотин“, „71“ -> „седемдесет и едно“, „5,79“ -> „пет и седемдесет и девет“, „10%“ -> „десет процента“."""
    t = token.strip(".,?!…:;\"'«»()")
    if NUMBER.match(t):
        return cardinal(int(t))
    m = DECIMAL.match(t)
    if m:
        whole, frac = cardinal(int(m.group(1))), cardinal(int(m.group(2).ljust(2, "0")))
        return f"{whole} и {frac}" if whole and frac else None
    m = PERCENT.match(t)
    if m:
        n = cardinal(int(m.group(1)), neuter=False)
        return f"{n} процента" if n else None
    return None


def spoken_map(words: list[dict]) -> dict:
    """{digit token as the aligner sees it: spoken form} for every number among `words`."""
    out = {}
    for w in words:
        key = str(w.get("word", "")).strip(".,?!…")
        if key not in out:
            form = spoken_form(key)
            if form:
                out[key] = form
    return out
