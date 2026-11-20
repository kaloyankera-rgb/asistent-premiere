"""Which text layer broke or fixed a word (development only, scripts/bench_subtitles.py).

A subtitle run has two word lists: `verbatim`, what Whisper wrote in its first reading, and `words`, the final text after
the dictionary repair, the reading swaps, the writing rules and the rest. Both are scored against a reference, and every
reference word that is right in one and wrong in the other is counted as broken (right -> wrong) or fixed (wrong -> right)
and given the layer that did it, from the run's own `edits` log.

The reference here is usually the subtitles the editors burned into the finished video, read by the Mac's text recognition:
capitals, no punctuation, names in Latin letters. So both sides are folded harder than `normalize.py` does:
- й / ѝ -> и, ь -> ъ, ё -> е (the letters text recognition loses in capitals), a hyphen splits a word;
- a word with Latin letters is one placeholder on either side and never counted: the editors write IPHONE-А where the
  speaker says „айфона“, which is a choice of writing, not a recognition mistake.
No jiwer: the alignment is a plain edit distance, so this runs (and is tested) in the app's own venv.
"""
from __future__ import annotations

import re

from .normalize import normalized_tokens

LATIN = "<lat>"
_FOLD = str.maketrans({"ё": "е", "ѝ": "и", "й": "и", "ь": "ъ"})
_HAS_LATIN = re.compile(r"[a-z]")
INVENTED = 3               # this many inserted words in a row: a line that was not said (or music with words)
_EDIT = 100000             # one edit, far above any count of equal words: fewest edits first, then most matches
KINDS = (("repair", "spelling"), ("writing", "writing"), ("english", "english"), ("learned", "learned"),
         ("speaker", "speaker_forms"), ("correction", "corrections"))


def tokens(text: str) -> list[str]:
    """Text -> folded word tokens; Latin words collapse into one LATIN placeholder."""
    out: list[str] = []
    for t in normalized_tokens(text):
        if _HAS_LATIN.search(t):
            if not out or out[-1] != LATIN:
                out.append(LATIN)
            continue
        out += [p for p in t.translate(_FOLD).split("-") if p]
    return out


_LOOKALIKE = str.maketrans("ABCEHKMOPTXYabcehkmoptxy", "АВСЕНКМОРТХУавсенкмортху")
_ONLY_LOOKALIKE = re.compile(r"[ABCEHKMOPTXYabcehkmoptxy]+")
_CYRILLIC = re.compile(r"[а-яА-ЯёЁѝЍ]")
_LETTERS = re.compile(r"[^\W\d_]+")


def unlatin(text: str, known=None) -> str:
    """Text read off a frame -> the same text with Cyrillic words that were read in look-alike Latin capitals put back
    („XPAHATA“ -> „ХРАНАТА“, „КAКВО“ -> „КАКВО“). A word mixing both alphabets is always put back; a word of look-alike
    letters only is put back when `known` (lexicon.known) says the Cyrillic reading is a real word, so „TOP“ and „HBO“
    stay names. Used on the reference side only: what Asistent writes in Latin letters, it meant."""
    def fix(m):
        w = m.group(0)
        latin = "".join(c for c in w if c.isascii())
        if not latin or not _ONLY_LOOKALIKE.fullmatch(latin):
            return w
        back = w.translate(_LOOKALIKE)
        if _CYRILLIC.search(w) or (known is not None and known(back.lower()) is True):
            return back
        return w
    return _LETTERS.sub(fix, text)


_NOT_SPEECH = re.compile(r"[_/\\]|\.(?:jpe?g|png|mov|mp4|com|bg)\b|\d{5,}|^\W*$", re.IGNORECASE)
_SYMBOLS = re.compile(r"[^\w\s\-.,!?%:;]", re.UNICODE)


def reference(text: str, known=None) -> str:
    """The subtitles read off the frames -> the text to score against: what is on screen but was not said is taken out (a
    file name, a date, a long number of an id, a token of symbols only), the marks text recognition adds to words are
    removed (® • * →), and Cyrillic read in look-alike Latin letters is put back (`unlatin`)."""
    out = []
    for tok in text.split():
        if _NOT_SPEECH.search(tok):
            continue
        tok = _SYMBOLS.sub("", tok)
        if tok:
            out.append(tok)
    return unlatin(" ".join(out), known)


def word_tokens(words: list[dict]) -> tuple[list[str], list[float]]:
    """Run words ({"word", "start"}) -> (tokens, the start time of the word each token came from)."""
    toks: list[str] = []
    times: list[float] = []
    for w in words:
        for t in tokens(w["word"]):
            if t == LATIN and toks and toks[-1] == LATIN:
                continue
            toks.append(t)
            times.append(float(w.get("start", 0.0)))
    return toks, times


def align(ref: list[str], hyp: list[str]) -> list[tuple[str, int | None, int | None]]:
    """Edit-distance alignment -> [(op, ref index | None, hyp index | None)], op in equal / sub / del / ins.
    Among the alignments with the fewest edits, the one with the most equal words: „б а“ against „а б“ is one word
    kept and one moved, not two wrong words (which word counts as right decides what is called broken or fixed)."""
    n, m = len(ref), len(hyp)
    E = _EDIT
    step = lambda i, j: -1 if ref[i - 1] == hyp[j - 1] else E      # an equal word costs no edit and is one more match
    cost = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        cost[i][0] = i * E
    for j in range(1, m + 1):
        cost[0][j] = j * E
    for i in range(1, n + 1):
        row, up, r = cost[i], cost[i - 1], ref[i - 1]
        for j in range(1, m + 1):
            row[j] = min(up[j - 1] + (-1 if r == hyp[j - 1] else E), up[j] + E, row[j - 1] + E)
    ops = []
    i, j = n, m
    while i or j:
        if i and j and cost[i][j] == cost[i - 1][j - 1] + step(i, j):
            ops.append(("equal" if ref[i - 1] == hyp[j - 1] else "sub", i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i and cost[i][j] == cost[i - 1][j] + E:
            ops.append(("del", i - 1, None))
            i -= 1
        else:
            ops.append(("ins", None, j - 1))
            j -= 1
    return ops[::-1]


def _counted(op, r, h, ref, hyp) -> bool:
    return not ((r is not None and ref[r] == LATIN) or (h is not None and hyp[h] == LATIN))


def tally(ops, ref: list[str], hyp: list[str]) -> dict:
    """-> {"words", "sub", "del", "ins", "wer", "invented": [inserted runs of INVENTED+ words]}; Latin words left out."""
    c = {"sub": 0, "del": 0, "ins": 0}
    invented, run = [], []
    for op, r, h in ops:
        if op == "ins" and hyp[h] != LATIN:
            run.append(hyp[h])
        else:
            if len(run) >= INVENTED:
                invented.append(" ".join(run))
            run = []
        if op != "equal" and _counted(op, r, h, ref, hyp):
            c[op] += 1
    if len(run) >= INVENTED:
        invented.append(" ".join(run))
    n = sum(1 for t in ref if t != LATIN)
    return {"words": n, **c, "wer": round((c["sub"] + c["del"] + c["ins"]) / n, 4) if n else 0.0, "invented": invented}


def causes(edits: dict, segments: list[dict]):
    """The run's `edits` and pieces -> cause(first token, final token, time) -> the layer's name.

    A logged edit whose `from` holds the first reading's word and whose `to` holds the final one names its layer; otherwise a
    word inside a piece whose second opinion or louder reading was taken ("B" / "C") is a `swap`; the rest is `unlogged`."""
    pairs = []
    for kind, key in KINDS:
        for e in (edits or {}).get(key) or []:
            if isinstance(e, dict):
                frm, to = e.get("from", e.get("heard", "")), e.get("to", e.get("said", ""))
                pairs.append((kind, set(tokens(str(frm))), set(tokens(str(to)))))
    swapped = []
    for at, pick in (edits or {}).get("second_opinions") or []:
        if pick != "A":
            swapped += [(sg["at"], sg["at"] + sg["end"] - sg["start"]) for sg in segments if round(sg["at"], 1) == at]

    def cause(first: str, final: str, at: float) -> str:
        for kind, frm, to in pairs:
            if first and first in frm and (not final or final in to) and first != final:
                return kind
        if any(a - 0.05 <= at <= b + 0.05 for a, b in swapped):
            return "swap"
        return "unlogged"
    return cause


def compare(ref_text: str, verbatim: list[dict], words: list[dict], edits: dict | None = None,
            segments: list[dict] | None = None) -> dict:
    """One run against its reference -> {"words", "first", "final", "broken", "fixed"}.

    first / final: `tally` of the first reading and of the final text. broken / fixed: [{"ref", "first", "final", "cause"}]
    for every reference word right in one and wrong in the other ("" = the word is missing on that side)."""
    ref = tokens(ref_text)
    first, t_first = word_tokens(verbatim)
    final, t_final = word_tokens(words)
    ops_a, ops_b = align(ref, first), align(ref, final)
    at_a = {r: (op, h) for op, r, h in ops_a if r is not None}
    at_b = {r: (op, h) for op, r, h in ops_b if r is not None}
    cause = causes(edits or {}, segments or [])
    broken, fixed = [], []
    for r, tok in enumerate(ref):
        if tok == LATIN:
            continue
        (op_a, ha), (op_b, hb) = at_a[r], at_b[r]
        if (op_a == "equal") == (op_b == "equal"):
            continue
        a = first[ha] if ha is not None else ""
        b = final[hb] if hb is not None else ""
        if LATIN in (a, b):
            continue
        at = t_first[ha] if ha is not None else (t_final[hb] if hb is not None else 0.0)
        row = {"ref": tok, "first": a, "final": b, "cause": cause(a, b, at)}
        if row["cause"] == "english":
            continue                   # „бюти сектор“ written "Beauty Sector": the same words in another alphabet, not a mistake
        (broken if op_a == "equal" else fixed).append(row)
    ta, tb = tally(ops_a, ref, first), tally(ops_b, ref, final)
    return {"words": ta["words"], "first": ta, "final": tb, "broken": broken, "fixed": fixed}
