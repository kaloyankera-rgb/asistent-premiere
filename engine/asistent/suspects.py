"""Places in a transcript that need a person's ear (docs/BULGARIAN_TRANSCRIPTION_GUIDE.md §5, §11): reported, never
rewritten. A guess would invent words; the guide's rule is „mark it as suspicious and re-listen“.

- a month name inside a stretch about prices („Само 2 септември“ for „Само 20 евро“): Whisper's language model likes
  dates; a date that follows a date preposition („на 2 септември“) is left alone;
- a long word squeezed into a few milliseconds: the aligner found no room for it, so it is probably not what was said.
"""
from __future__ import annotations

import re

from .consensus import norm

MONTHS = {"януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"}
MONEY = {"евро", "евра", "лв", "лева", "лев", "долара", "долар", "цента", "цент", "стотинки", "стотинка", "паунда", "цена", "цената",
         "цени", "струва", "струват", "скъпо", "евтино", "платих", "платя", "плащам", "купувам", "купя", "взимаме", "взимам"}
DATE_WORDS = {"на", "от", "до", "през", "в", "във", "около", "преди", "след", "всеки", "всяка"}
SENTENCE_END = re.compile(r"[.!?…]$")
MIN_WORD_SECONDS = 0.06                # a word of 4+ letters spoken in less than this is not a word


def find(words: list[dict]) -> list[dict]:
    """-> [{"i": index in `words`, "word", "at", "reason"}]"""
    out: list[dict] = []
    # sentences as index ranges
    ranges, a = [], 0
    for i, w in enumerate(words):
        if SENTENCE_END.search(str(w["word"]).strip().rstrip('"»“)')) or i == len(words) - 1:
            ranges.append((a, i))
            a = i + 1
    money = [any(norm(words[j]["word"]) in MONEY for j in range(a, b + 1)) for a, b in ranges]
    for k, (a, b) in enumerate(ranges):
        about_money = any(money[max(0, k - 2):k + 2])
        for i in range(a, b + 1):
            core = norm(words[i]["word"])
            if core in MONTHS and about_money:
                day = i > 0 and re.fullmatch(r"\d{1,2}", norm(words[i - 1]["word"]) or "x")
                before = norm(words[i - 2]["word"]) if i > 1 else ""
                if day and before in DATE_WORDS:
                    continue                                                         # „на 2 септември“: a date
                out.append({"i": i, "word": words[i]["word"], "at": words[i]["start"], "reason": "a month in a talk about prices"})
            elif len(core) >= 4 and words[i]["end"] - words[i]["start"] < MIN_WORD_SECONDS and not words[i].get("fixed"):
                out.append({"i": i, "word": words[i]["word"], "at": words[i]["start"], "reason": "a word that is too short"})
    return out
