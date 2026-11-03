"""docs/BULGARIAN_TRANSCRIPTION_GUIDE.md §10: the documented SRT errors as regression tests.

None of them is fixed by a table of replacements: each row goes through the general mechanism (dictionary repair,
suspect spans, corrections that re-time, punctuation rules) and the rows the guide calls „verify“ must NOT be changed
by the pipeline on its own - they are reported. Real recordings (Ludi Glavi, C9025) are checked separately, see
PROJECT_STATUS.md; the audio is not in the repository."""
import pytest

from asistent import agreement, consensus, corrections, lexicon, subtitles, suspects

spylls = pytest.importorskip("spylls")


@pytest.fixture(autouse=True, scope="module")
def dictionary():
    if not lexicon.available():
        pytest.skip("bg_BG dictionary not installed (scripts/setup_mac.sh --subtitles)")
    lexicon.reset()


def W(*tokens, p=0.9, step=0.4):
    return [{"word": t, "start": round(i * step, 2), "end": round(i * step + 0.35, 2), "p": p} for i, t in enumerate(tokens)]


def run(words, vocab=frozenset()):
    return consensus.merge(words, [], lexicon.known, lambda w, doubt=True: lexicon.repair(w, doubt, vocab))


def texts(words):
    return [w["word"] for w in words]


# ---- newer clip (C9025) -------------------------------------------------------------------------------------------

def test_одяло_is_spelled_одеяло_and_the_change_is_logged():                    # 00:13.580, 00:18.051
    out, info = run(W("Ако", "това", "одяло", "струва", "Как", "така", "за", "одяло?"))
    assert texts(out)[2] == "одеяло" and texts(out)[7] == "одеяло?"
    assert info["changes"] == [{"from": "одяло", "to": "одеяло"}, {"from": "одяло?", "to": "одеяло?"}]


def test_одялоце_becomes_the_diminutive_одеялце():                             # 00:25.192
    out, _ = run(W("меко", "одялоце!"))
    assert texts(out) == ["меко", "одеялце!"]


def test_одялоците_has_no_confident_repair_so_it_stays_and_is_marked():       # 00:30.430
    out, info = run(W("за", "одялоците?", p=0.99))
    assert texts(out)[1] == "одялоците?" and out[1]["p"] <= consensus.UNSURE_P and info["changed"] == 0


def test_a_month_in_a_conversation_about_prices_is_flagged_not_rewritten():     # 00:20.320
    words = W("Как", "така", "500", "евро", "за", "одеяло?", "Само", "2", "септември", "взимаме", "го.")
    found = suspects.find(words)
    assert [(f["word"], f["reason"]) for f in found] == [("септември", "a month in a talk about prices")]
    assert texts(words)[8] == "септември"                                        # the finder never edits
    assert suspects.find(W("Срещата", "е", "на", "2", "септември", "и", "струва", "50", "евро.")) == []     # a real date after „на“


def test_го_взима_is_not_changed_to_взимаме_without_evidence():               # 00:28.395
    for form in ("взима", "взимам", "взимаме"):
        assert lexicon.known(form) is True and lexicon.repair(form) is None   # all real words: nothing for the dictionary to repair
    out, info = run(W("Ако", "струва", "под", "500", "евро,", "го", "взима."))
    assert texts(out)[-1] == "взима." and info["changed"] == 0


def test_Взиваме_is_repaired_only_with_a_neighbour_the_recording_says_elsewhere():        # 00:33.400
    out, _ = run(W("Взиваме", "го.", p=0.6))
    assert texts(out)[0] == "Взиваме" and out[0]["p"] <= consensus.UNSURE_P                # alone: seven neighbours, no guess
    out, info = run(W("Взиваме", "го.", p=0.6), vocab=frozenset({"взимаме"}))
    assert texts(out)[0] == "Взимаме" and info["changes"] == [{"from": "Взиваме", "to": "Взимаме"}]


def test_the_decimal_comma_is_attached_to_the_number():                        # 00:41.842
    out, info = subtitles.tidy_words([{"word": "Само", "start": 0, "end": 0.2}, {"word": "5", "start": 0.2, "end": 0.4},
                                      {"word": ",79,", "start": 0.4, "end": 0.9}, {"word": "ама", "start": 1.0, "end": 1.2}])
    assert texts(out) == ["Само", "5,79,", "ама"] and info["joined"] == 1


def test_a_comma_is_not_invented_after_А_уж_or_Примерно_на_мен():              # guide §6
    for sent in (["А", "уж", "само", "една", "стена", "трябваше", "да", "боядисам."], ["Примерно", "на", "мен", "ми", "трябва", "ето", "това."]):
        out, info = subtitles.tidy_words(W(*sent))
        assert texts(out) == sent and info["commas"] == []


# ---- older clip (Ludi Glavi) -----------------------------------------------------------------------------------------

def test_раф_is_left_alone_and_рафт_comes_only_from_a_correction_line():       # 00:07.891
    out, _ = run(W("мога", "и", "един", "раф", "да", "направя.", p=0.89))
    assert texts(out)[3] == "раф"                                                 # the guide says „probably рафт; verify“
    fixed, counts = corrections.apply(W("мога", "и", "един", "раф", "да", "направя."), [("раф", "рафт")])
    assert texts(fixed)[3] == "рафт" and counts == [1] and fixed[3]["fixed"] is True


def test_нища_is_spelled_неща_by_the_unstressed_vowel_rule():                  # 00:18.969
    out, info = run(W("сума", "ти", "нища", "съм", p=0.68))
    assert texts(out)[2] == "неща" and info["changes"] == [{"from": "нища", "to": "неща"}]


def test_ще_чакай_and_десом_are_not_substituted_they_are_marked():             # 00:22.506, 00:22.890
    out, info = run(W("една", "стена", "ще", "чакай", "да", "бъде", "десом.", p=0.7))
    assert texts(out) == ["една", "стена", "ще", "чакай", "да", "бъде", "десом."]       # no word is replaced on a hunch
    assert out[6]["p"] <= consensus.UNSURE_P                                          # the non-word is flagged for a re-listen


def test_the_confirmed_ground_truth_is_applied_by_a_correction_that_realigns():  # 00:22.890, user confirmed
    heard = W("само", "една", "стена", "ще", "чакай", "да", "бъде", "десом.")
    fixed, counts = corrections.apply(heard, [("ще чакай да бъде десом", "трябваше да боядисам")])
    assert texts(fixed) == ["само", "една", "стена", "трябваше", "да", "боядисам."] and counts == [1]
    assert all(w.get("fixed") for w in fixed[3:]) and not any(w.get("fixed") for w in fixed[:3])          # these are what the aligner re-times
    assert fixed[3]["start"] == heard[3]["start"] and abs(fixed[-1]["end"] - heard[-1]["end"]) < 1e-9


# ---- guide §2: grammatical gender is checked, never converted ---------------------------------------------------------

def test_first_person_forms_are_found_and_a_gender_disagreement_between_readings_is_flagged_not_converted():
    a = W("това", "съм", "свършила", "днеска.")
    b = W("това", "съм", "свършил", "днеска.")
    assert agreement.forms(a) == [(2, "f")] and agreement.forms(b) == [(2, "m")]
    assert agreement.disputed(a, b) == [2] and agreement.disputed(a, a) == []
    assert texts(a)[2] == "свършила"                                                  # nothing was converted
    assert agreement.forms(W("тя", "е", "направила", "това")) == []                      # third person: not the speaker (guide §2.1)
    assert agreement.forms(W("Купих", "лампа")) == [] and agreement.forms(W("съм", "учител")) == []
