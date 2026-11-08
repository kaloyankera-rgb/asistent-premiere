"""The ReShape preset is protected (the user, 2026-11-08): its settings and its output on fixed inputs must stay exactly as
they were at the tag backup/pre-improvements-2026-11-08 while other features are added.

The inputs are synthetic Bulgarian sentences written for this test (no client speech: the repo is public). The expected
captions in fixtures/reshape_baseline.json were produced once by the baseline code; a failure here means the ReShape
path changed. Never regenerate the fixture to make a failure go away: find what changed. The full-job comparison on the
client's own recording is scripts/reshape_golden.py (private, outside the repo)."""
import io
import json
import os

import pytest

from asistent import lexicon
from asistent import subtitles as S
from asistent import translate
from test_subtitles import words

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "reshape_baseline.json")
need_dict = pytest.mark.skipif(not lexicon.available(), reason="the Bulgarian dictionary is not installed here")

# Each case: text with |pauses, word duration, low-probability words, cuts (sequence seconds).
CASES = {
    "plain": ("Днес ще ви покажа как се прави добро кафе у дома без скъпа машина.", {}),
    "pauses": ("Първо загрейте водата. |0.6 После сложете две лъжици кафе |0.4 и изчакайте четири минути.", {}),
    "numbers": ("Цената е 25 лева, а с отстъпка става 19 лева и 90 стотинки за 3 месеца.", {}),
    "question_li": ("Знаете ли защо това работи? |0.5 Можем да го проверим заедно още сега.", {}),
    "enclitics": ("Ще ви кажа нещо, което колегите ми не знаят и благодаря ви за търпението.", {}),
    "adjective_noun": ("Това е хронично заболяване, но новата процедура дава видим резултат за кратко време.", {}),
    "modal": ("Не трябва да чакате, защото може да изглежда сложно, но всеки може да започне.", {}),
    "long_word": ("Задържането на течности е честа причина за подуване на краката вечер.", {}),
    "names": ("В Beauty Sector работим с Мария Иванова от София всеки вторник.", {}),
    "low_p": ("Тази стъпка е важна, иначе гелчето няма да попие добре.", {"lowp": {"гелчето": 0.3, "попие": 0.41}}),
    "cuts": ("Това е първият кадър. |0.3 А това е вторият кадър след монтажа.", {"cuts": [0.0, 1.9]}),
    "fast": ("Бързо говорене без никакви паузи между думите прави редовете по-къси.", {"dur": 0.18, "gap": 0.02}),
}
FPS = (25.0, 29.97, 30.0)


def _words(text, opts):
    return words(text, t=0.5, dur=opts.get("dur", 0.3), gap=opts.get("gap", 0.05), lowp=opts.get("lowp"))


def _srt(caps):
    buf = io.StringIO()
    for n, c in enumerate(caps, 1):
        buf.write("%d\n%s --> %s\n%s\n\n" % (n, S._srt_time(c["start"]), S._srt_time(c["end"]), c["text"]))
    return buf.getvalue()


def snapshot():
    """-> {case@fps: {"srt", "flags"}} from the code as it is now (how the fixture was made at the baseline)."""
    out = {}
    for name, (text, opts) in CASES.items():
        for fps in FPS:
            caps = S.build_captions(_words(text, opts), "reshape", fps, cuts=opts.get("cuts", ()))
            out[f"{name}@{fps}"] = {"srt": _srt(caps), "flags": [[f["word"], f["p"]] for c in caps for f in c["flags"]]}
    return out


def _fixture():
    with open(FIXTURE, encoding="utf-8") as f:
        return json.load(f)


def test_the_reshape_preset_settings_are_unchanged():
    assert S.PRESETS["reshape"] == {"max_words": 3, "max_chars": 14, "soft_chars": 16, "lines": 1, "line_chars": 25,
                                    "min_s": 0.4, "max_s": 2.5, "phrases": True, "lead": 0.18, "bare": True}


def test_the_shared_timing_and_phrase_constants_are_unchanged():
    fx = _fixture()["constants"]
    assert {k: getattr(S, k) for k in fx["timing"]} == fx["timing"]
    assert S.PHRASE_COST == fx["phrase_cost"]
    for name, members in fx["word_sets"].items():
        assert sorted(getattr(S, name)) == members, name


@need_dict
@pytest.mark.parametrize("key", sorted(f"{n}@{f}" for n in CASES for f in FPS))
def test_reshape_captions_are_byte_identical_to_the_baseline(key):
    want = _fixture()["captions"][key]
    got = snapshot()[key]
    assert got["srt"] == want["srt"]
    assert got["flags"] == want["flags"]


def test_the_english_bare_style_is_unchanged():
    for text, want in _fixture()["bare"].items():
        assert translate.bare(text) == want
