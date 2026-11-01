"""The editor's corrections (corrections.py) and the speaker-gender rule (gender.py)."""
from collections import Counter

from asistent import corrections as C
from asistent import gender as G


def W(*ws, t=0.0, d=0.4):
    return [{"word": w, "start": round(t + i * d, 3), "end": round(t + (i + 1) * d, 3), "p": 0.8} for i, w in enumerate(ws)]


def test_parse_splits_corrections_terms_comments_and_reports_bad_lines():
    r = C.parse("# note\nраф => рафт\n\nДжи Строй\nще чакай да бъде десом  =>  трябваше да боядисам\nлошо =>\n=> нищо\n")
    assert r["pairs"] == [("раф", "рафт"), ("ще чакай да бъде десом", "трябваше да боядисам")]
    assert r["terms"] == ["Джи Строй"] and len(r["errors"]) == 2 and "ред 6" in r["errors"][0]


def test_a_correction_replaces_the_heard_words_and_keeps_span_punctuation_and_capital():
    ws = W("само", "една", "стена", "ще", "чакай", "да", "бъде", "десом.")
    out, n = C.apply(ws, [("ще чакай да бъде десом", "трябваше да боядисам")])
    assert [w["word"] for w in out] == ["само", "една", "стена", "трябваше", "да", "боядисам."] and n == [1]
    new = out[3:]
    assert new[0]["start"] == ws[3]["start"] and abs(new[-1]["end"] - ws[-1]["end"]) < 1e-9          # the old span is kept
    assert all(a["end"] <= b["start"] + 1e-9 for a, b in zip(out, out[1:]))
    assert all(w["fixed"] and w["p"] == 1.0 for w in new) and not any(w.get("fixed") for w in out[:3])
    out, _ = C.apply(W("един", "Раф,"), [("раф", "рафт")])
    assert out[1]["word"] == "Рафт,"


def test_matching_ignores_case_and_punctuation_and_can_use_the_spelling_the_editor_sees():
    out, n = C.apply(W("МОГА", "и", "един", "раф."), [("и един раф", "и един рафт")])
    assert [w["word"] for w in out][-3:] == ["и", "един", "рафт."] and n == [1]
    out, n = C.apply(W("сума", "ти", "нища"), [("ти неща", "ти неща!")], lambda w: {"неща"} if w == "нища" else {w})
    assert n == [1]                                                                           # written from what the editor sees


def test_a_correction_does_not_match_twice_or_inside_a_fixed_word_and_reports_zero_when_absent():
    ws = W("раф", "и", "раф")
    out, n = C.apply(ws, [("раф", "рафт")])
    assert [w["word"] for w in out] == ["рафт", "и", "рафт"] and n == [2]
    out2, n2 = C.apply(out, [("рафт", "раф")])                                              # fixed words are final
    assert [w["word"] for w in out2] == ["рафт", "и", "рафт"] and n2 == [0]
    assert C.apply(W("а", "б"), [("в г", "д")])[1] == [0]


def test_the_longest_pattern_wins():
    out, _ = C.apply(W("една", "стена", "е"), [("стена", "стена!"), ("една стена", "само стената")])
    assert [w["word"] for w in out] == ["само", "стената", "е"]


def test_gender_forms_after_the_first_person_auxiliary_only():
    assert G.forms(W("това", "съм", "свършила")) == [(2, "f")]
    assert G.forms(W("вече", "бях", "свършил")) == [(2, "m")]
    assert G.forms(W("съм", "вече", "не", "свършила")) == [(3, "f")]
    assert G.forms(W("той", "е", "свършил")) == []                                             # third person: not the speaker
    assert G.forms(W("съм", "учител")) == []                                                   # a noun, not a participle


def test_gender_auto_needs_clear_evidence_and_explicit_choice_wins():
    assert G.resolve("auto", Counter({"m": 2, "f": 1})) == "m"
    assert G.resolve("auto", Counter({"m": 1, "f": 1})) is None and G.resolve("auto", Counter({"f": 1})) is None
    assert G.resolve("auto", Counter({"f": 3, "m": 1})) == "f"
    assert G.resolve("male", Counter({"f": 5})) == "m" and G.resolve("female", Counter()) == "f"


def test_gender_converts_only_to_a_known_form_and_never_touches_a_correct_one():
    known = lambda w: w.strip(".,") in {"свършил", "свършила", "пил", "пила"}
    out, ch = G.apply(W("съм", "свършила."), "m", known)
    assert out[1]["word"] == "свършил." and ch == [{"at": 0.4, "from": "свършила.", "to": "свършил."}]
    assert G.apply(W("съм", "свършил"), "m", known)[1] == []
    out, ch = G.apply(W("съм", "свършил"), "f", known)
    assert out[1]["word"] == "свършила"
    assert G.apply(W("съм", "свършила"), "m", lambda w: False)[1] == []                       # the other form is not a word
    assert G.apply(W("съм", "свършила"), None, known)[1] == []
