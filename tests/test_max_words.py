"""0.10.138: the editor's "Max words" (Subtitles row): a hard cap of 1-4 words a caption for every style but ReShape's; only a
counted number phrase („за 8 евро“) goes out whole as one unit. No cap keeps every style exactly as before, and ReShape's
protected style never changes (tests/test_reshape_baseline.py, scripts/reshape_golden.py).
All sentences here are invented for the tests (the repo is public)."""
import copy
import re

import pytest

from asistent import subtitles as S
from test_subtitles import SAMPLE, spoken

CAPPED = ("short", "gstroy", "credissimo", "ekopak", "beautysector", "aula", "standard")
TEXTS = (
    SAMPLE,
    "Днес ще ви покажа как работи новият двигател на колата, който може да изглежда сложен, но всъщност е много прост.",
    "Струва 8 евро на месец и има гаранция 3 години. Зарядното дава 220 волта за 48 часа без прекъсване.",
    "Платформата на Формула 1 е за хора, които искат да карат или за състезателни отбори със собствени коли.",
)


def units_of(c):
    return S._units(c["words"], counted=True)


@pytest.mark.parametrize("preset", CAPPED)
@pytest.mark.parametrize("n", [1, 2, 3, 4])
def test_no_caption_goes_over_the_cap_unless_it_is_one_unit(preset, n):
    for text in TEXTS:
        for c in S.build_captions(spoken(text), preset, 25, max_words=n):
            assert len(c["words"]) <= n or len(units_of(c)) == 1, (preset, n, c["text"])


@pytest.mark.parametrize("fps", [25, 29.97])
@pytest.mark.parametrize("preset", CAPPED)
@pytest.mark.parametrize("n", [1, 2, 3, 4])
def test_words_and_times_stay_and_nothing_flashes(preset, n, fps):
    for text in TEXTS:
        ws = spoken(text)
        caps = S.build_captions(ws, preset, fps, max_words=n)
        plain = S.build_captions(ws, preset, fps)
        flat = [(w["start"], w["end"]) for c in caps for w in c["words"]]
        assert flat == [(w["start"], w["end"]) for c in plain for w in c["words"]]    # the same words, in order
        assert flat == sorted(flat)
        starts = [c["start"] for c in caps]
        assert all(b > a for a, b in zip(starts, starts[1:]))
        assert all(c["end"] > c["start"] for c in caps)


def test_one_word_keeps_a_number_with_what_it_counts():
    caps = S.build_captions(spoken("Струва 8 евро на месец."), "short", 25, max_words=1)
    with8 = [c for c in caps if any(w["word"] == "8" for w in c["words"])]
    assert len(with8) == 1 and "8 евро" in with8[0]["text"] and len(units_of(with8[0])) == 1
    assert all(len(c["words"]) == 1 for c in caps if c is not with8[0])


@pytest.mark.parametrize("preset", ["short", "gstroy", "credissimo"])
def test_two_words_do_not_end_on_a_function_word(preset):
    text = "Новият двигател работи тихо. Колата тръгва веднага, спирачките държат добре."
    for c in S.build_captions(spoken(text), preset, 25, max_words=2):
        assert S._word_core(c["words"][-1]) not in S.NON_FINAL, c["text"]


@pytest.mark.parametrize("n", [1, 2, 3, 4])
def test_reshape_never_changes(n):
    for text in TEXTS:
        ws = spoken(text)
        assert S.build_captions(ws, "reshape", 25, max_words=n) == S.build_captions(ws, "reshape", 25)
    assert S.with_max_words(S.PRESETS["reshape"], n) is S.PRESETS["reshape"]


def test_no_cap_is_the_old_call_and_the_presets_stay():
    before = copy.deepcopy(S.PRESETS)
    for preset in S.PRESETS:
        for text in TEXTS:
            ws = spoken(text)
            assert S.build_captions(ws, preset, 25, max_words=None) == S.build_captions(ws, preset, 25)
        for n in (1, 2, 3, 4):
            S.build_captions(spoken(TEXTS[1]), preset, 25, max_words=n)
    assert S.PRESETS == before


def test_standard_with_a_cap_goes_through_the_phrase_cutter():
    caps = S.build_captions(spoken(TEXTS[1]), "standard", 25, max_words=3)
    assert caps and all(len(c["words"]) <= 3 or len(units_of(c)) == 1 for c in caps)
    assert len(caps) > len(S.build_captions(spoken(TEXTS[1]), "standard", 25))
    assert not any(re.search(r"[.?!…]", c["text"][:-1]) for c in caps)               # no sentence end inside a caption
