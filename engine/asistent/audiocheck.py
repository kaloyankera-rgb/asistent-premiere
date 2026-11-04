"""Does a learned fix fit the sound? The safety net under the learned fixes (learning.py), never a proof.

Whisper is made to read the heard words and the fixed words over the same few seconds (`asr.score_texts`); a fix that
fits clearly worse than what was heard is not used there: either it is wrong for this video, or the speaker really said
it the other way (guide §1: what was said is written, a misspoken word is kept).

Measured 2026-11-04 (Phase 0, 26 fixes on the ReShape „Липедемата“ and Ludi Glavi C9025 recordings, the margin is the
fixed text's score minus the heard text's): right fixes +2.0 … -3.0 (мастните, тъкан, лимфният, одеяло, взимаме, 20 евро,
одеялце) and -5.4 / -7.2 (вързвам, одеялцата); wrong ones -24 … -7 for a different word (масоните, Взривяваме, 17 евро,
патика, нормално, тъжност, красива) but only -4 … +2.4 for words that sound alike (над/под, сини/синини, 2 седмици,
огледало). The first real run (ReShape, a fix learned in one project used in the next) scored the right „мастна“ -5.5
and „компрометира“ -6.3 (the editor's own wish, though the doctor says „компроментира“). VETO 8 passes every right fix
seen and stops every different word that sounds different (9 of 17 wrong ones); it does not catch the near-miss, which
is why a learned fix also needs confirmations and the words around it (learning.py).
"""
from __future__ import annotations

from . import asr

VETO = 8.0                   # a learned fix scoring this much below the heard words is not used
PAD = 0.6                    # seconds of sound around the words that are compared
SR = 16000


def margin(y, words: list[dict], i: int, n: int, said: str) -> float:
    """Words of `y` (seconds from its start); words[i:i+n] would become `said` -> fixed score minus heard score, with one
    word of context on each side in both texts."""
    a, b = max(i - 1, 0), min(i + n, len(words) - 1)
    t0 = max(0.0, words[a]["start"] - PAD)
    t1 = min(len(y) / SR, max(words[b]["end"], words[i + n - 1]["end"]) + PAD, t0 + 29.0)
    left = " ".join(w["word"] for w in words[a:i])
    right = " ".join(w["word"] for w in words[i + n:b + 1])
    heard = " ".join(x for x in (left, " ".join(w["word"] for w in words[i:i + n]), right) if x)
    fixed = " ".join(x for x in (left, said, right) if x)
    s_heard, s_fixed = asr.score_texts(y[int(t0 * SR):int(t1 * SR)], [heard, fixed])
    return s_fixed - s_heard


def fits(m: float) -> bool:
    return m >= -VETO
