"""Bulgarian writing rules for the subtitles: how a word that WAS said is written, never which word was said.

The user's decision (2026-11-04, the Smart Subtitle Correction plan): these are spelling conventions, so they are applied
without asking, like the punctuation rules of `subtitles.tidy_words`. Each rule only changes the written form of words
that are there; nothing is added, dropped or replaced by another word (guide §1). Every rule that needs to know whether
a form is a real word asks the Bulgarian dictionary (`lexicon.known`); without the dictionary only the rules that need
none run. A word the editor fixed (`fixed`) is never touched.

1. „по -пълни“ (Whisper's own split), „най добрият“ -> „по-пълни“, „най-добрият“: „най“ never stands alone.
2. „по добре“, „по бързо от“ -> „по-добре“, „по-бързо от“: only a word of an adjective family (добър/добра/добро/добри
   are all words) that is an adverb (-о/-е) or is followed by a comparison („от“, „и“, the end): „по нов начин“ (in a
   new way) is right as it is and stays.
3. „незнам“ -> „не знам“: the joined form is not a word, the verb is.
4. The full and the short article of masculine words (sounds the same, written by the word's role):
   a. after a preposition the short one: „на човекът“ -> „на човека“;
   b. the subject at the start of a sentence, before „е/беше/не/ще…“, the full one: „Човека е тук“ -> „Човекът е тук“
      (not when a pronoun repeats an object: „Човека не го видях“);
   c. after „това е“, „той е“…: „Това е новия проект“ -> „Това е новият проект“.
"""
from __future__ import annotations

import re

from . import lexicon

PREPOSITIONS = {"на", "в", "във", "с", "със", "за", "от", "до", "при", "по", "към", "пред", "след", "през", "без", "под",
                "над", "между", "у", "срещу", "около", "покрай", "чрез", "заради", "въпреки"}
SUBJECT_NEXT = {"е", "беше", "бе", "не", "ще", "вече", "винаги", "също", "много", "просто"}
OBJECT_CLITICS = {"го", "му", "я", "ѝ", "й", "ги", "им"}
PREDICATE_SUBJECTS = {"това", "този", "той", "то", "ето", "тук", "там", "онзи", "онова"}
LINKS = {"е", "беше", "бе"}
COMPARISON_NEXT = {"от", "и", "а", "но", "или", "отколкото"}
NOT_AFTER_NAI = {"и", "а", "но", "да", "не", "се", "си", "ще", "е", "са", "на", "в", "за", "от", "че", "ли", "го", "му"}
_PARTS = re.compile(r"^([^\w]*)(.*?)([^\w]*)$", re.UNICODE)
_CYR_WORD = re.compile(r"[а-яѝ]+")
_SENTENCE_END = re.compile(r"[.!?…]+[\"»“)]*$")


def _split(word: str) -> tuple[str, str, str]:
    return _PARTS.match(word).groups()


def _low(word: str) -> str:
    return _split(word)[1].lower()


def _gradable(core: str, known) -> bool:
    """Is `core` a form of an adjective (or its adverb): are the feminine, neuter and plural forms all words?"""
    stems = set()
    for end in ("ият", "ия", "ата", "ото", "ите", "а", "о", "и", "е", ""):
        if core.endswith(end) and len(core) - len(end) >= 2:
            s = core[: len(core) - len(end)]
            stems.add(s)
            if len(s) >= 4 and s[-2] in "еъ" and s[-1] not in "аеиоуъюя" and s[-3] not in "аеиоуъюя":
                stems.add(s[:-2] + s[-1])                  # добър -> добр-а, интересен -> интересн-а
    return any(all(known(s + e) is True for e in ("а", "о", "и")) for s in stems)


def _short_of(core: str, known) -> str | None:
    """A masculine word with the full article -> its short form, when both are words („човекът“ -> „човека“)."""
    for full, short in (("ът", "а"), ("ят", "я")):
        if core.endswith(full) and len(core) >= 5:
            s = core[:-2] + short
            if known(s) is True and known(core[:-2]) is True:
                return s
    return None


def _full_of(core: str, known) -> str | None:
    """The short form of a masculine word -> the full one („човека“ -> „човекът“, „новия“ -> „новият“)."""
    for short, full in (("а", "ът"), ("я", "ят")):
        if core.endswith(short) and len(core) >= 4:
            f = core[:-1] + full
            if known(f) is True and known(core[:-1]) is True:
                return f
    return None


def _like(old: str, core: str) -> str:
    """`core` with the punctuation and the capital letter of the word it replaces."""
    lead, oc, tail = _split(old)
    if oc[:1].isupper():
        core = core[:1].upper() + core[1:]
    return lead + core + tail


def _join(a: dict, b: dict, text: str) -> dict:
    return {**a, "word": text, "end": b["end"], "p": min(a.get("p", 1.0), b.get("p", 1.0)), "norm": True}


def _sentence_start(words: list[dict], i: int) -> bool:
    return i == 0 or bool(_SENTENCE_END.search(words[i - 1]["word"]))


def apply(words: list[dict], known=None) -> tuple[list[dict], list[dict]]:
    """Words (any time unit) -> (words with the writing rules applied, [{"from", "to", "rule"}])."""
    known = known or lexicon.known
    have_dict = known("и") is not None
    out = [dict(w) for w in words]
    changes: list[dict] = []

    def free(*ix):
        return all(0 <= j < len(out) and not out[j].get("fixed") for j in ix)

    # 1 and 2: „по“ / „най“ joined to the next word
    i = 0
    while i < len(out) - 1:
        a, b = out[i], out[i + 1]
        la, (lead_b, cb, tail_b) = _low(a["word"]), _split(b["word"])
        joined = None
        if free(i, i + 1) and la in ("по", "най") and not _split(a["word"])[2]:
            if lead_b == "-" and _CYR_WORD.fullmatch(cb.lower() or "-"):
                joined, rule = ("по" if la == "по" else "най"), "hyphen"
            elif la == "най" and not lead_b and _CYR_WORD.fullmatch(cb) and cb not in NOT_AFTER_NAI:
                joined, rule = "най", "hyphen"
            elif la == "по" and have_dict and not lead_b and _CYR_WORD.fullmatch(cb) and _gradable(cb, known):
                nxt = _low(out[i + 2]["word"]) if i + 2 < len(out) else ""
                if cb[-1] in "ое" or tail_b or not nxt or nxt in COMPARISON_NEXT:
                    joined, rule = "по", "hyphen"
        if joined:
            text = _split(a["word"])[0] + _split(a["word"])[1] + "-" + cb + tail_b
            changes.append({"from": f"{a['word']} {b['word']}", "to": text, "rule": rule})
            out[i:i + 2] = [_join(a, b, text)]
        i += 1
    if not have_dict:
        return out, changes

    # 3: „не“ written apart from the verb
    i = 0
    while i < len(out):
        lead, core, tail = _split(out[i]["word"])
        low = core.lower()
        if (free(i) and low.startswith("не") and len(low) >= 5 and _CYR_WORD.fullmatch(low) and core[1:] == core[1:].lower()
                and known(low) is False and known(low[2:]) is True):
            w = out[i]
            mid = w["start"] + (w["end"] - w["start"]) * 2 / len(low)
            first = lead + core[:2]
            changes.append({"from": w["word"], "to": f"{first} {low[2:]}{tail}", "rule": "ne"})
            out[i:i + 1] = [{**w, "word": first, "end": round(mid, 3), "norm": True},
                            {**w, "word": low[2:] + tail, "start": round(mid, 3), "norm": True}]
            i += 2
            continue
        i += 1

    # 4: the article of masculine words
    for i, w in enumerate(out):
        if not free(i):
            continue
        core = _split(w["word"])[1]
        low = core.lower()
        prev = _low(out[i - 1]["word"]) if i > 0 else ""
        prev_open = i > 0 and not _split(out[i - 1]["word"])[2]          # no comma or full stop between them
        new = None
        if prev in PREPOSITIONS and prev_open:
            new, rule = _short_of(low, known), "article-short"
        elif _sentence_start(out, i) and i + 1 < len(out) and not _split(w["word"])[2]:
            after = [_low(x["word"]) for x in out[i + 1:i + 3]]
            if after[0] in SUBJECT_NEXT and not OBJECT_CLITICS & set(after):
                new, rule = _full_of(low, known), "article-full"
        elif i >= 2 and prev in LINKS and prev_open and _low(out[i - 2]["word"]) in PREDICATE_SUBJECTS and not _split(out[i - 2]["word"])[2]:
            new, rule = _full_of(low, known), "article-full"
        if new and new != low:
            text = _like(w["word"], new)
            changes.append({"from": w["word"], "to": text, "rule": rule})
            out[i] = {**w, "word": text, "norm": True}
    return out, changes
