"""The editor's corrections and vocabulary for the subtitles (the „text correction pass“ of the 4a1a workflow).

One text box, one line each (`#` starts a comment):
    раф => рафт                                       a correction: these words are heard wrong, this is what is said
    само една стена ще чакай да бъде десом => само една стена трябваше да боядисам
    Джи Строй                                          a name or term (no `=>`): goes into Whisper's prompt

A correction replaces the heard words BEFORE the alignment, so the new words are placed where they are pronounced
(forced alignment of the corrected text against the audio); copying text over old timestamps would leave the phrase
at the time of the wrong words. Matching ignores case and punctuation, and also matches the spelling the engine itself
would show (the by-ear respelling), so a line can be written from what the editor sees in the captions.
"""
from __future__ import annotations

import re

from .consensus import norm

MAX_TEXT = 20000


def parse(text: str) -> dict:
    """-> {"terms": [str], "pairs": [(heard, said)], "errors": [str]}"""
    terms: list[str] = []
    pairs: list[tuple[str, str]] = []
    errors: list[str] = []
    for n, raw in enumerate((text or "")[:MAX_TEXT].splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=>" in line:
            src, dst = (p.strip() for p in line.split("=>", 1))
            if not norm(src).strip() or not dst or "=>" in dst:
                errors.append(f"line {n}: \"{line}\" - must be \"heard => said\", both sides non-empty")
            else:
                pairs.append((src, dst))
        else:
            terms.append(line)
    return {"terms": terms, "pairs": pairs, "errors": errors}


def _tail(word: str) -> str:
    m = re.search(r"[^\w]+$", word, flags=re.UNICODE)
    return m.group(0) if m else ""


def apply(words: list[dict], pairs: list[tuple[str, str]], variants=None) -> tuple[list[dict], list[int]]:
    """Words (times in any unit) -> (words with the corrections applied, how many times each pair matched).

    `variants(word) -> set of normalised spellings` lets a line match the spelling the editor sees as well as the one
    Whisper wrote. A replaced stretch keeps its start and end, its words share the span by length (a placeholder: the
    aligner places them), carry p = 1 and `fixed: True`, the punctuation after the last old word, and a capital
    letter if the first old word had one."""
    counts = [0] * len(pairs)
    if not pairs or not words:
        return [dict(w) for w in words], counts
    variants = variants or (lambda w: {norm(w)})
    forms = [variants(w["word"]) | {norm(w["word"])} for w in words]
    order = sorted(range(len(pairs)), key=lambda k: -len(norm(pairs[k][0]).split() or [""]))
    toks = {k: [norm(t) for t in pairs[k][0].split() if norm(t)] for k in range(len(pairs))}
    out: list[dict] = []
    i = 0
    while i < len(words):
        hit = None
        if not words[i].get("fixed"):
            for k in order:
                t = toks[k]
                if t and i + len(t) <= len(words) and all(t[j] in forms[i + j] and not words[i + j].get("fixed") for j in range(len(t))):
                    hit = (k, len(t))
                    break
        if not hit:
            out.append(dict(words[i]))
            i += 1
            continue
        k, n = hit
        first, last = words[i], words[i + n - 1]
        new = pairs[k][1].split()
        total = sum(len(norm(x)) or 1 for x in new)
        t0, t1, at = first["start"], last["end"], first["start"]
        for j, x in enumerate(new):
            share = (t1 - t0) * (len(norm(x)) or 1) / total
            text = x
            if j == 0 and first["word"][:1].isupper() and text[:1].islower():
                text = text[:1].upper() + text[1:]
            if j == len(new) - 1 and not _tail(text):
                text += _tail(last["word"])
            out.append({"word": text, "start": round(at, 3), "end": round(at + share, 3), "p": 1.0, "fixed": True})
            at += share
        counts[k] += 1
        i += n
    return out, counts
