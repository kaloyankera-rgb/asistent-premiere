"""Second and third reading of a piece -> which words are certain.

Measured on the Ludi Glavi test (2026-11-01): the same piece read by Whisper with 0.5 s, 2 s, 4 s and 8 s of
surrounding sound gave „неща“ / „нища“ / „неща“ / „нища“ and „днес“ / „днеска“ / „днеска“ / „днеска“; a word cut by the
edit at the end of a piece changed with every reading („десом“, „ти своя“, „ти съм“). Whisper's own probability said
0.68 for the wrong „нища“, so it cannot tell. Disagreement between readings can.

Rules (nothing is ever added or removed, only a word of the main reading is replaced or marked):
- a word is replaced only when more readings agree on the other word than on the main one (two of three) AND the
  Bulgarian dictionary (`known`, lexicon.py) knows the new word but not the old one. Voting alone turned the right
  „градината“ into „градвината“ on the test, so without a dictionary nothing is replaced;
- an unknown word Whisper doubts that is exactly ONE swapped unstressed vowel (е/и, о/у, а/ъ) away from a real word is
  respelled to it (the speaker says „нищá“, the word is „неща“); several candidates or none: it stays and is reported;
- a word the readings disagree on, or that the dictionary does not know while Whisper is unsure of it, gets
  p <= UNSURE_P, which the caption builder reports as uncertain („?“);
- different numbers of words in a disagreeing stretch are not mapped: the main words stay and are marked.
"""
from __future__ import annotations

import difflib
import re
from collections import Counter

UNSURE_P = 0.45            # below subtitles.LOW_P (0.5): reported to the editor
MAJORITY_P = 0.6           # a word changed by majority is not reported, but its probability is not high either
MAX_SPAN = 4               # longest disagreeing stretch that is looked at
SURE_P = 0.8               # an unknown word with at least this probability is left alone (names, brands, slang)

_PUNCT = re.compile(r"^(\W*)(.*?)(\W*)$", re.UNICODE)


def norm(word: str) -> str:
    return re.sub(r"[^\w]", "", word.lower(), flags=re.UNICODE)


def _like(base: str, new: str) -> str:
    """`new` with the punctuation around and the capital letter of `base`."""
    lead, _, tail = _PUNCT.match(base).groups()
    core = _PUNCT.match(new).group(2)
    if core and base[len(lead):len(lead) + 1].isupper():
        core = core[0].upper() + core[1:]
    return lead + core + tail


def _compare(base: list[dict], other: list[dict]) -> tuple[dict[int, dict], set[int]]:
    """{base index: the other reading's word} for one-to-one replacements, and the base indexes of stretches that
    differ but cannot be mapped one to one."""
    tb, to = [norm(w["word"]) for w in base], [norm(w["word"]) for w in other]
    sm = difflib.SequenceMatcher(None, tb, to, autojunk=False)
    mapped: dict[int, dict] = {}
    unmapped: set[int] = set()
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "replace" or i2 - i1 > MAX_SPAN or j2 - j1 > MAX_SPAN:
            continue                                       # equal, or an insertion/deletion at an edge: not a vote
        if i2 - i1 == j2 - j1:
            for k in range(i2 - i1):
                mapped[i1 + k] = other[j1 + k]
        else:
            unmapped.update(range(i1, i2))
    return mapped, unmapped


def merge(base: list[dict], others: list[list[dict]], known=None, respell=None) -> tuple[list[dict], dict]:
    """The main reading `base` with the other readings' votes applied. All word lists are times relative to the same
    point (only the order matters here). `known(word)` -> True / False / None (lexicon.known).
    `respell(word)` -> the real word an unknown word is the by-ear spelling of (lexicon.respell), or None.
    -> (words, {"changed": n, "unsure": n})"""
    out = [dict(w) for w in base]
    if not base:
        return out, {"changed": 0, "unsure": 0}
    known = known or (lambda w: None)
    respell = respell or (lambda w: None)
    runs = len(others) + 1
    votes: list[Counter] = [Counter({norm(w["word"]): 1}) for w in base]
    text: list[dict[str, str]] = [{norm(w["word"]): w["word"]} for w in base]
    disputed: set[int] = set()
    for other in others:
        mapped, unmapped = _compare(base, other)
        disputed |= unmapped
        for i in range(len(base)):
            if i in mapped:
                n = norm(mapped[i]["word"])
                votes[i][n] += 1
                text[i].setdefault(n, mapped[i]["word"])
            elif i not in unmapped:
                votes[i][norm(base[i]["word"])] += 1       # equal, or not looked at: it supports the main reading
    changed = unsure = 0
    for i, w in enumerate(out):
        if w.get("fixed"):
            continue                                       # the editor's correction: not up for a vote
        top, n = votes[i].most_common(1)[0]
        mine = norm(base[i]["word"])
        if (top != mine and n > votes[i][mine] and n * 2 > runs
                and known(text[i][top]) is True and known(base[i]["word"]) is False):
            w["word"] = _like(base[i]["word"], text[i][top])
            w["p"] = min(w.get("p", 1.0), MAJORITY_P)
            changed += 1
        elif known(base[i]["word"]) is False and w.get("p", 1.0) < SURE_P and respell(base[i]["word"]):
            w["word"] = respell(base[i]["word"])                 # „нища“ -> „неща“: the speaker reduces the vowel, the spelling does not
            w["p"] = min(w.get("p", 1.0), MAJORITY_P)
            changed += 1
        elif i in disputed or (len(votes[i]) > 1 and not (top == mine and n * 2 > runs)):
            w["p"] = min(w.get("p", 1.0), UNSURE_P)
            unsure += 1
        elif known(base[i]["word"]) is False and w.get("p", 1.0) < SURE_P:
            w["p"] = min(w.get("p", 1.0), UNSURE_P)             # a word the dictionary does not know and Whisper doubts
            unsure += 1
    return out, {"changed": changed, "unsure": unsure}
