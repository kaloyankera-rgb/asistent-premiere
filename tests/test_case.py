"""0.10.138: the editor's "Case" (Subtitles row): "upper" shows every caption in capitals, "normal" as the words were written;
none keeps every style exactly as before, and ReShape's protected style never changes. A client's names keep their spelling.
All sentences here are invented for the tests (the repo is public)."""
import copy

import pytest

from asistent import subtitles as S
from test_subtitles import SAMPLE, spoken

TEXTS = (
    SAMPLE,
    "Днес ще ви покажа как работи новият двигател на колата. Струва 8 евро на месец.",
    "GStroy прави ремонти бързо и чисто, а екипът идва на място още същия ден.",
)
CLIENTS = ("gstroy", "credissimo", "ekopak", "beautysector", "aula")


def texts(text, preset, **kw):
    return [c["text"] for c in S.build_captions(spoken(text), preset, 25, **kw)]


@pytest.mark.parametrize("preset", list(S.PRESETS))
def test_no_case_is_the_old_call_and_presets_stay(preset):
    before = copy.deepcopy(S.PRESETS)
    for text in TEXTS:
        assert S.build_captions(spoken(text), preset, 25, case=None) == S.build_captions(spoken(text), preset, 25)
    assert S.PRESETS == before


@pytest.mark.parametrize("case", S.CASES)
@pytest.mark.parametrize("max_words", [None, 2])
def test_reshape_ignores_the_case(case, max_words):
    for text in TEXTS:
        assert S.build_captions(spoken(text), "reshape", 25, max_words=max_words, case=case) == \
            S.build_captions(spoken(text), "reshape", 25, max_words=max_words)


@pytest.mark.parametrize("preset", ["short", "standard"])
def test_all_caps_is_the_same_lines_in_capitals(preset):
    for text in TEXTS:
        assert texts(text, preset, case="upper") == [t.upper() for t in texts(text, preset)]
        assert texts(text, preset, case="normal") == texts(text, preset)          # Auto is already normal


@pytest.mark.parametrize("preset", CLIENTS)
def test_normal_takes_a_client_style_out_of_capitals(preset):
    for text in TEXTS:
        caps, normal = texts(text, preset), texts(text, preset, case="normal")
        assert texts(text, preset, case="upper") == caps                         # the style's own capitals
        assert [t.lower() for t in normal] == [t.lower() for t in caps]          # the same lines, the same cuts
        assert any(t != t.upper() for t in normal)


def test_a_client_name_keeps_its_spelling_in_both_cases():
    for case in S.CASES:
        assert any("GStroy" in t for t in texts(TEXTS[2], "gstroy", case=case))


def test_case_and_max_words_together():
    for c in S.build_captions(spoken(TEXTS[1]), "short", 25, max_words=2, case="upper"):
        assert c["text"] == c["text"].upper()
        assert len(c["words"]) <= 2 or len(S._units(c["words"], counted=True)) == 1
