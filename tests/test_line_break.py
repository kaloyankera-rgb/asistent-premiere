"""0.10.139: the editor's "Line break" (Subtitles row), as the clients' Submagic videos do it: up to 5 words a caption,
1-3 words one line, 4-5 words two lines with up to 3 on top and the last 1-2 below, the bottom line in the client's colour
(written into the .srt as <font color>). False keeps every style exactly as before; ReShape's protected style never changes.
All sentences here are invented for the tests (the repo is public)."""
import copy

import pytest

from asistent import subtitles as S
from test_subtitles import spoken
from test_case import TEXTS

MORE = TEXTS + (
    "Добре я да видим какво ще трябва примерно на мен ми трябва ето това я почакай мога и един раф да направя.",
    "Всеки ден идват нови клиенти които искат ремонт на банята и кухнята още същата седмица без много чакане.",
)


def caps(text, preset="short", **kw):
    return S.build_captions(spoken(text), preset, 25, line_break=True, **kw)


@pytest.mark.parametrize("preset", list(S.PRESETS))
def test_no_line_break_is_the_old_call_and_presets_stay(preset):
    before = copy.deepcopy(S.PRESETS)
    for text in MORE:
        assert S.build_captions(spoken(text), preset, 25, line_break=False) == S.build_captions(spoken(text), preset, 25)
    assert S.PRESETS == before


@pytest.mark.parametrize("max_words", [None, 2])
def test_reshape_ignores_the_line_break(max_words):
    for text in MORE:
        assert S.build_captions(spoken(text), "reshape", 25, max_words=max_words, line_break=True) == \
            S.build_captions(spoken(text), "reshape", 25, max_words=max_words)


@pytest.mark.parametrize("preset", ["short", "standard", "gstroy", "credissimo", "ekopak", "beautysector", "aula"])
def test_up_to_three_words_on_top_and_one_or_two_below(preset):
    seen_two = False
    for text in MORE:
        for c in caps(text, preset):
            lines = c["text"].split("\n")
            n = len(c["words"])
            assert n <= S.LINE_BREAK_WORDS or len(S._units(c["words"], counted=True)) == 1
            if n <= S.LINE_BREAK_TOP:
                assert len(lines) == 1 and "accent_line" not in c
            if len(lines) == 2:
                seen_two = True
                top, bottom = lines[0].split(), lines[1].split()
                assert c["accent_line"] is True and c["accent"] == lines[1]
                assert 1 <= len(bottom) <= 2 or len(S._units(c["words"], counted=True)) <= 2
                assert len(top) <= S.LINE_BREAK_TOP or len(S._units(c["words"], counted=True)) <= 2
            assert len(lines) <= 2
    assert seen_two                                            # the texts do make two-line captions


def test_max_words_still_caps_with_a_line_break():
    for text in MORE:
        for c in caps(text, "short", max_words=4):
            assert len(c["words"]) <= 4 or len(S._units(c["words"], counted=True)) == 1


def test_the_client_keyword_suggestions_give_way_to_the_bottom_line():
    for text in MORE:
        for c in caps(text, "gstroy"):
            assert ("accent" in c) == ("\n" in c["text"])


def test_case_and_names_still_apply():
    for c in caps(TEXTS[2], "gstroy"):
        assert c["text"].replace("GStroy", "") == c["text"].replace("GStroy", "").upper()
    assert any("GStroy" in c["text"] for c in caps(TEXTS[2], "gstroy"))
    assert any(t != t.upper() for t in (c["text"] for c in caps(MORE[3], "gstroy", case="normal")))


def test_a_top_line_does_not_end_on_a_little_word_when_another_cut_fits():
    w = spoken("я да видим как")                                   # 4 words: „Я ДА ВИДИМ / КАК“ (3 + 1)
    lines = S._broken([[x] for x in w])
    assert [len(l) for l in lines] == [3, 1]
    w = spoken("много хубаво да видим")
    lines = S._broken([[x] for x in w])
    assert S._word_core(lines[0][-1]) not in S.NON_FINAL          # „МНОГО ХУБАВО / ДА ВИДИМ“, not „… ДА / ВИДИМ“


def test_srt_colours_only_the_bottom_line(tmp_path):
    cs = [c for text in MORE for c in caps(text, "gstroy")]
    two = [c for c in cs if c.get("accent_line")]
    assert two
    path = tmp_path / "a.srt"
    S.write_srt(cs, str(path), colour="#94D000")
    body = path.read_text(encoding="utf-8-sig")
    assert body.count('<font color="#94D000">') == len(two)
    for c in two:
        top, bottom = c["text"].split("\n")
        assert f'{top}\n<font color="#94D000">{bottom}</font>\n' in body
    plain = tmp_path / "b.srt"
    S.write_srt(cs, str(plain))                                    # no colour: exactly the old file
    assert "<font" not in plain.read_text(encoding="utf-8-sig")


def test_no_colour_without_the_line_break(tmp_path):
    cs = S.build_captions(spoken(MORE[3]), "gstroy", 25)           # GStroy's own stacked lines stay plain
    path = tmp_path / "a.srt"
    S.write_srt(cs, str(path), colour="#94D000")
    assert "<font" not in path.read_text(encoding="utf-8-sig")
