"""0.9.97 (the user, 2026-11-04): lines keep phrases whole (an adjective with its noun, „може да“), and a line
never appears before the cut it belongs to. The phrase rules need the Bulgarian dictionary; the cut rule does not."""
import pytest

from asistent import agreement, lexicon
from asistent import subtitles as S
from test_subtitles import words

need_dict = pytest.mark.skipif(not lexicon.available(), reason="the Bulgarian dictionary is not installed here")


def texts(text, preset="reshape", **kw):
    return [c["text"] for c in S.build_captions(words(text, **kw), preset, 25)]


# ---------------------------------------------------------------- cuts

def test_a_line_does_not_appear_before_its_cut():
    # „натрупвания.“ ends at 1.0, the next clip starts at 1.2 and its first word at 1.25: the ReShape lead (0.18 s) would show
    # the next line at 1.07, over the end of the previous shot
    ws = words("натрупвания.", t=0.4, dur=0.6) + words("Това е промяна.", t=1.25)
    caps = S.build_captions(ws, "reshape", 25, cuts={0.0, 1.2})
    assert caps[1]["start"] == pytest.approx(1.2) and caps[0]["end"] == pytest.approx(1.2)
    free = S.build_captions(ws, "reshape", 25)
    assert free[1]["start"] < 1.2                       # without the cut the lead stays as the client's style has it


def test_a_word_the_aligner_put_just_before_the_cut_still_belongs_after_it():
    ws = words("първо.", t=0.0, dur=0.5) + words("Второ нещо.", t=1.95)
    caps = S.build_captions(ws, "reshape", 25, cuts={2.0})
    assert caps[1]["start"] == pytest.approx(2.0)


def test_the_lead_stays_inside_one_clip():
    ws = words("Това е промяна.", t=2.0)
    assert S.build_captions(ws, "reshape", 25, cuts={0.0})[0]["start"] == pytest.approx(2.0 - 0.16, abs=0.03)


# ---------------------------------------------------------------- phrases

@need_dict
@pytest.mark.parametrize("a, n, together", [
    ("хронично", "заболяване", True), ("мастните", "клетки", True), ("по-пълни", "крака", True), ("правилна", "диагностика", True),
    ("лимфната", "система", True), ("характерни", "натрупвания", True), ("съединителната", "тъкан", True),
    ("често", "изглежда", False), ("самата", "мастна", False), ("свършил", "днеска", False), ("тегло.", "Това", False),
])
def test_an_adjective_and_its_noun_are_found(a, n, together):
    assert agreement.bond(a, n) is together


@need_dict
def test_an_adjective_stays_with_its_noun():
    assert "хронично заболяване" in texts("Това е хронично заболяване на тъканта.")
    assert "Задържането на течности" in texts("Задържането на течности увеличава обема.")


@need_dict
def test_may_and_its_da_stay_together():
    lines = texts("Симптоми, които може да изглеждат малки, но всъщност могат да повлияят.", preset="short")
    assert "може да изглеждат" in lines and not any(t.split()[-1] in ("може", "да") for t in lines)


def test_without_the_dictionary_nothing_is_bonded(monkeypatch):
    monkeypatch.setattr(lexicon, "known", lambda w: None)
    assert agreement.bond("хронично", "заболяване") is False


@need_dict
@pytest.mark.parametrize("a, n, together", [
    ("патологично", "променени", True), ("наднормено", "тегло", True), ("бързо", "отиде", False), ("просто", "като", False),
])
def test_an_adverb_stays_with_the_word_it_describes(a, n, together):
    assert agreement.bond(a, n) is together


# ---------------------------------------------------------------- what Whisper hears (0.9.98)

def test_the_media_cut_out_between_clips_is_silent_and_the_rest_untouched():
    import numpy as np
    from asistent import subtitle_job as J
    sr = J.ASR_SR
    y = np.ones(10 * sr, dtype=np.float32)
    win = {"a": 0.0, "pieces": [{"start": 1.0, "end": 3.0}, {"start": 6.0, "end": 8.0}]}
    out = J.silence_between(y, win)
    assert out[int(4.5 * sr)] == 0.0                                     # the retake between the clips
    assert out[int(0.5 * sr)] == 1.0 and out[int(9.5 * sr)] == 1.0       # context before the first and after the last clip
    assert out[int(2.0 * sr)] == 1.0 and out[int(7.0 * sr)] == 1.0
    assert out[0] == 1.0 and out[-1] == 1.0
    one = {"a": 0.0, "pieces": [{"start": 1.0, "end": 3.0}]}
    assert J.silence_between(y, one) is y
