"""0.10.61 (the user, 2026-11-12): captions follow the speaker's delivery. A cut goes where the speaker ends a phrase (a sentence
end, a comma Whisper heard, a pause), never one word early: the last word of a phrase said straight on is not left alone in
the next caption, the word count is a target, and the two-line client styles may go over their usual size to keep a phrase
whole. ReShape's protected style keeps the classic rules (tests/test_reshape_baseline.py).
All sentences here are invented for the tests (the repo is public)."""
import re

import pytest

from asistent import lexicon
from asistent import subtitles as S
from test_subtitles import spoken, words

need_dict = pytest.mark.skipif(not lexicon.available(), reason="the Bulgarian dictionary is not installed here")
DELIVERY_STYLES = ("short", "gstroy", "credissimo", "ekopak", "beautysector", "aula")


def caps(text, preset, timed=spoken):
    return S.build_captions(timed(text), preset, 25)


def chunks(text, preset, timed=spoken):
    return [c["text"].replace("\n", " ") for c in caps(text, preset, timed)]


def leftovers(cs):
    """Captions of one word said straight on from the caption before (no comma, no pause) with a phrase end after it."""
    out = []
    for a, b, c in zip(cs, cs[1:], cs[2:]):
        w, prev = b["words"], a["words"][-1]
        if len(w) == 1 and not re.search(r"[.,?!…]$", prev["word"]) and w[0]["start"] - prev["end"] < 0.12 \
                and (re.search(r"[.,?!…]$", w[0]["word"]) or c["words"][0]["start"] - w[0]["end"] >= 0.2):
            out.append(b["text"])
    return out


def test_the_styles_with_delivery_and_reshape_without():
    for name in DELIVERY_STYLES:
        assert S.PRESETS[name].get("delivery") is True, name
    assert "delivery" not in S.PRESETS["reshape"] and "delivery" not in S.PRESETS["standard"]


def test_delivery_strength_comes_from_punctuation_and_pauses():
    ws = words("първо, второ трето. |0.4 четвърто пето", dur=0.3, gap=0.0)
    st = S._delivery(ws)
    by = {w["word"]: st[id(w)] for w in ws}
    assert by["трето."] == 1.0 and by["пето"] == 1.0                     # a sentence end, the last word
    assert by["първо,"] == pytest.approx(S.DELIVERY["comma"])            # a comma: a heard phrase end
    assert by["второ"] == 0.0                                            # said straight on
    ws = words("едно |0.2 две |0.4 три", dur=0.3, gap=0.0)
    st = S._delivery(ws)
    assert 0.6 < st[id(ws[0])] < 0.8 and st[id(ws[1])] == 1.0            # 0.2 s is a short breath, 0.4 s a clear end


@need_dict
@pytest.mark.parametrize("preset", ["gstroy", "beautysector", "aula"])
def test_the_last_word_of_a_phrase_is_not_left_for_the_next_caption(preset):
    # the classic rules split these after the second word: the phrase was wider than the style's usual 17-18 characters
    for text in ("Лампите се закрепват със съвместим адаптер. После идва следващата стъпка.",
                 "Касата се затваря с последната ключалка. Така е сигурно.",
                 "Котлите вървят с ниско напрежение. Затова пестят ток."):
        cs = caps(text, preset)
        assert not leftovers(cs), (preset, [c["text"] for c in cs])
        for c in cs:
            assert all(len(line) <= S.PRESETS[preset]["line_max"] for line in c["text"].split("\n")), c["text"]


@need_dict
def test_short_words_that_lean_on_the_verb_end_the_caption_with_it():
    for preset in DELIVERY_STYLES:
        got = chunks("Готова ли си да започнеш отначало?", preset)
        assert got[0].lower().strip("?") == "готова ли си", (preset, got)
        got = chunks("Подреждаме ги спрямо стаята, после боядисваме.", preset)
        assert got[0].lower() == "подреждаме ги", (preset, got)


@need_dict
def test_a_verb_keeps_its_da_and_the_word_after_it_when_they_fit():
    for preset in ("short", "gstroy"):
        got = chunks("Симптоми, които може да изглеждат малки, но всъщност могат да повлияят.", preset)
        assert any("може да изглеждат" in t.lower() for t in got), (preset, got)
        assert not any(t.lower().split()[-1].strip(",.") in ("може", "да") for t in got), got


@need_dict
def test_a_number_keeps_what_it_counts():
    for preset in ("gstroy", "credissimo", "short"):
        for c in caps("Лампите работят с напрежение 220 волта и още 3 месеца гаранция.", preset):
            t = c["text"].lower()
            assert not re.search(r"\b220$", t.split("\n")[0]) and not t.startswith("волта"), (preset, c["text"])
            assert not t.endswith("3") and not t.startswith("месеца"), (preset, c["text"])


@need_dict
def test_a_comma_is_still_a_place_to_cut_and_no_caption_crosses_a_sentence_end():
    for preset in DELIVERY_STYLES:
        got = chunks("Почваш едно, почваш второ, почваш трето и накрая сума ти неща.", preset)
        assert [t.lower().strip(",") for t in got[:3]] == ["почваш едно", "почваш второ", "почваш трето"], (preset, got)
        for c in caps("Имаш идея? Добре, да видим какво ще трябва. Примерно на мен ми трябва ето това.", preset):
            assert not re.search(r"[.?!…]", " ".join(w["word"] for w in c["words"][:-1])), c["text"]


@need_dict
def test_words_and_times_are_never_changed_by_the_cutting():
    text = ("Ако е под 700 евро, я взимаме. Лампите се закрепват със съвместим адаптер и работят с напрежение 220 волта. "
            "Готова ли си да започнеш, или искаш да почакаме още малко?")
    ws = spoken(text)
    for preset in DELIVERY_STYLES:
        cs = S.build_captions(ws, preset, 29.97)
        said = [(w["word"], w["start"], w["end"]) for c in cs for w in c["words"]]
        assert said == [(w["word"], w["start"], w["end"]) for w in ws], preset
        for a, b in zip(cs, cs[1:]):
            assert a["end"] <= b["start"] + 1e-9 and b["start"] < b["words"][0]["end"]


@need_dict
def test_two_to_four_words_stay_the_usual_size():
    text = ("Днес ще ви покажа как се прави добро кафе у дома без скъпа машина. Първо загрейте водата, после сложете "
            "две лъжици кафе и изчакайте четири минути. Накрая налейте и опитайте.")
    for preset in DELIVERY_STYLES:
        n = [len(c["words"]) for c in caps(text, preset)]
        assert max(n) <= max(4, S.PRESETS[preset]["max_words"] + 1), (preset, n)
        assert 1.9 <= sum(n) / len(n) <= 3.2, (preset, n)
