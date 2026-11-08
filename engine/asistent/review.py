"""What the editor should check in a finished subtitle run, line by line (2026-11 improvements, Captions tab review).

Reads the job's own JSON (written by subtitle_job, never changed here) and returns, for every caption line, the reasons to
look at it: what was uncertain, what was changed and from what, and whether the doubt is about the WORDS (recognition) or
about WHEN they are shown (timing). Nothing here changes a word, a time or a line: the ReShape path and every other preset
stay exactly as they are; this only explains them.

Rules (the user's prompt, 2026-11-08):
- recognition and timing doubts are separate kinds;
- raw model probabilities are never shown as accuracy percentages: a low-probability word is "the recognition was unsure";
- readings of the same model that agree are not independent confirmation, so agreement is never reported as "verified";
- meaning-changing words come first: numbers and prices, negations, names, words that may be missing, gender forms, endings
  that disagree.
"""
from __future__ import annotations

import json
import os
import re

from .bench.metrics import NEGATIONS, is_number

HIGH, MEDIUM, LOW = 3, 2, 1
WEAK_ALIGN = 0.3              # align.WEAK: below this the aligner's place for a word is not trusted
_SENTENCE_END = re.compile(r"[.!?…]$")
_CORE = re.compile(r"^[\"„“«(]+|[\"»”)\.,!?…:;]+$")

# review reasons the job writes (subtitle_job, suspects, agreement), by their start: (kind, severity, short label)
_REASONS = [
    ("speech without a word", ("recognition", HIGH, "a word may be missing here")),
    ("male or female form", ("recognition", HIGH, "male or female form: the readings differ")),
    ("the speaker on this track is set as", ("recognition", HIGH, "the other gender form is heard")),
    ("a month in a talk about prices", ("recognition", HIGH, "a month among prices: maybe a number")),
    ("a word that is too short", ("recognition", MEDIUM, "a very short word: maybe misheard")),
    ("not clearly audible", ("timing", MEDIUM, "not clearly heard where it is placed")),
    ("cut off by the edge of the clip", ("recognition", LOW, "cut off at the clip edge: left out")),
    # older runs wrote the reasons in Bulgarian
    ("не се чува ясно", ("timing", MEDIUM, "not clearly heard where it is placed")),
    ("форма за мъж или жена", ("recognition", HIGH, "male or female form: the readings differ")),
]


def _core(word: str) -> str:
    return _CORE.sub("", str(word))


def classify(reason: str) -> tuple[str, int, str]:
    """A review reason of the job -> (kind, severity, short label). Unknown reasons are recognition, medium, as written."""
    r = str(reason)
    if "the endings do not agree" in r:
        return "recognition", HIGH, "adjective and noun endings disagree"
    for start, out in _REASONS:
        if r.startswith(start):
            return out
    return "recognition", MEDIUM, r


def meaning_word(word: str, names: set[str]) -> str | None:
    """Why a word matters for meaning, or None: a number or price, a negation, a name."""
    w = _core(word).lower()
    if not w:
        return None
    if is_number(w):
        return "number"
    if w in NEGATIONS:
        return "negation"
    if w in names:
        return "name"
    return None


def _names(words: list[dict]) -> set[str]:
    """Capitalised words that do not start a sentence (lower case)."""
    out, start = set(), True
    for w in words:
        core = _core(w.get("word", ""))
        if core and core[0].isupper() and not start and not core.isupper():
            out.add(core.lower())
        start = bool(_SENTENCE_END.search(str(w.get("word", ""))))
    return out


def _line_of(captions: list[dict], t: float) -> int | None:
    """Index of the caption shown at sequence time t (the one starting last at or before t, if t is inside it or its tail)."""
    best = None
    for i, c in enumerate(captions):
        if c["start"] - 0.25 <= t < c["end"] + 0.05:
            best = i
    return best


def build(job: dict) -> dict:
    """The job's JSON -> {"lines": [[item, ...] per caption], "summary": {...}}. item: {"kind", "severity", "label",
    "word", "at", "end"?, "from"?, "to"?, "why"?}"""
    captions = job.get("captions") or []
    words = job.get("words") or []
    names = _names(words)
    lines: list[list[dict]] = [[] for _ in captions]

    def add(t, item):
        i = _line_of(captions, t)
        if i is not None:
            lines[i].append(item)

    for r in job.get("review") or []:
        kind, sev, label = classify(r.get("reason", ""))
        why = meaning_word(r.get("word", ""), names)
        if why and sev < HIGH and kind == "recognition":
            sev = HIGH
        item = {"kind": kind, "severity": sev, "label": label, "word": r.get("word", ""), "at": r.get("at", 0.0)}
        if r.get("end") is not None:
            item["end"] = r["end"]
        if why:
            item["why"] = why
        add(item["at"], item)
    for c_i, c in enumerate(captions):                 # words the recognition was unsure of (p below 0.5): not a percentage
        for f in c.get("flags") or []:
            if any(x["kind"] == "recognition" and x["word"] == f["word"] and abs(x["at"] - f["at"]) < 0.05 for x in lines[c_i]):
                continue
            why = meaning_word(f["word"], names)
            item = {"kind": "recognition", "severity": HIGH if why else MEDIUM, "label": "the recognition was unsure of this word",
                    "word": f["word"], "at": f["at"]}
            if why:
                item["why"] = why
            lines[c_i].append(item)
    for w in words:                                    # timing: a word the aligner could not place, or placed with a weak score
        if w.get("unheard"):
            continue                                   # already listed as "not clearly heard"
        if w.get("aligned") is False:
            add(w["start"], {"kind": "timing", "severity": LOW, "label": "time from the recognition only (not aligned)",
                             "word": w["word"], "at": w["start"]})
        elif isinstance(w.get("align"), (int, float)) and w["align"] < WEAK_ALIGN:
            # low, not medium: on real runs most such words sit right (measured on 19 Ludi Glavi runs: 14 of 17 lines would
            # have been "to check"); they are shown on the line but do not make it one to check
            add(w["start"], {"kind": "timing", "severity": LOW, "label": "the aligner was unsure where this word is",
                             "word": w["word"], "at": w["start"]})
    edits = job.get("edits") or {}
    changes = [("dictionary repair", s.get("from"), s.get("to")) for s in edits.get("spelling") or []]
    changes += [("your correction", c.get("heard"), c.get("said")) for c in edits.get("corrections") or [] if c.get("applied")]
    changes += [("learned fix", u.get("heard"), u.get("said") or u.get("to")) for u in edits.get("learned") or []]
    changes += [("speaker form", s.get("from"), s.get("to")) for s in edits.get("speaker_forms") or [] if isinstance(s, dict)]
    seen = set()
    for label, old, new in changes:                    # what was changed, with the original: placed on the line that shows it
        if not old or not new or (label, old, new) in seen:
            continue
        seen.add((label, old, new))
        target = _core(new).lower()
        for c_i, c in enumerate(captions):
            if target and target in [_core(t).lower() for t in str(c.get("text", "")).split()]:
                lines[c_i].append({"kind": "recognition", "severity": HIGH if label != "your correction" else LOW,
                                   "label": f"changed by {label}", "word": new, "from": old, "to": new, "at": c["start"]})
    for items in lines:
        items.sort(key=lambda x: (-x["severity"], x["at"]))
    flagged = [i for i, items in enumerate(lines) if any(x["severity"] >= MEDIUM for x in items)]
    summary = {
        "lines_to_check": len(flagged),
        "meaning": sum(1 for items in lines for x in items if x["severity"] == HIGH),
        "recognition": sum(1 for items in lines for x in items if x["kind"] == "recognition"),
        "timing": sum(1 for items in lines for x in items if x["kind"] == "timing"),
        "order": sorted(flagged, key=lambda i: (-max(x["severity"] for x in lines[i]), captions[i]["start"])),
        "note": "Same-model readings that agree are not an independent check; unsure means the recognition said so, not a measured accuracy.",
    }
    return {"lines": lines, "summary": summary}


def load(path: str) -> dict:
    """The job JSON at `path` -> build(). Only files Asistent wrote (…/Asistent_subtitles/*.json) are read."""
    path = os.path.abspath(path)
    if os.path.basename(os.path.dirname(path)) != "Asistent_subtitles" or not path.endswith(".json"):
        raise ValueError("Not an Asistent subtitle run.")
    with open(path, encoding="utf-8") as f:
        return build(json.load(f))
