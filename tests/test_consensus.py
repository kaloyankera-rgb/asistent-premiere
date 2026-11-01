"""Three readings of one piece -> which words are certain (consensus.py, lexicon.py). Words are only replaced or marked."""
import pytest

from asistent import config, consensus, lexicon

WORDS = {"сума", "ти", "неща", "съм", "свършила", "свършил", "днеска", "днес", "градината", "бъде", "да", "едно", "две"}


def known(w):
    c = consensus.norm(w)
    return c in WORDS if c else None


def W(*ws, p=0.9):
    return [{"word": w, "start": i * 0.5, "end": i * 0.5 + 0.4, "p": p} for i, w in enumerate(ws)]


def test_a_word_two_of_three_readings_and_the_dictionary_agree_on_replaces_the_main_one():
    base = W("сума", "ти", "нища", "съм", p=0.68)
    out, info = consensus.merge(base, [W("сума", "ти", "неща", "съм"), W("сума", "ти", "неща", "съм")], known)
    assert [w["word"] for w in out] == ["сума", "ти", "неща", "съм"]
    assert info["changed"] == 1 and info["unsure"] == 0 and out[2]["p"] == consensus.MAJORITY_P
    assert out[2]["start"] == base[2]["start"]                                       # times stay the main reading's


def test_without_a_dictionary_nothing_is_replaced_only_marked():
    """Voting alone made „градината“ into „градвината“ on the real clip."""
    base = W("за", "градината")
    out, info = consensus.merge(base, [W("за", "градвината"), W("за", "градвината")])
    assert [w["word"] for w in out] == ["за", "градината"] and info["changed"] == 0 and info["unsure"] == 1
    assert out[1]["p"] <= consensus.UNSURE_P


def test_a_right_word_is_never_replaced_by_a_wrong_one_even_when_outvoted():
    out, info = consensus.merge(W("за", "градината"), [W("за", "градвината"), W("за", "градвината")], known)
    assert out[1]["word"] == "градината" and info["changed"] == 0
    out, info = consensus.merge(W("свършила"), [W("свършил"), W("свършил")], known)   # both fine words: the editor decides
    assert out[0]["word"] == "свършила" and out[0]["p"] <= consensus.UNSURE_P


def test_a_lone_dissent_changes_nothing_and_is_not_reported():
    out, info = consensus.merge(W("свършила", "днеска."), [W("свършила", "днес."), W("свършила", "днеска.")], known)
    assert [w["word"] for w in out] == ["свършила", "днеска."] and info["changed"] == 0 and info["unsure"] == 0


def test_a_tie_or_three_different_words_is_marked_uncertain_and_not_guessed():
    out, info = consensus.merge(W("бъде", "десом."), [W("бъде", "ти"), W("бъде", "своя.")], known)
    assert out[1]["word"] == "десом." and out[1]["p"] <= consensus.UNSURE_P and info["unsure"] == 1
    out, info = consensus.merge(W("нища"), [W("неща")], known)                        # one extra reading: 1 against 1
    assert out[0]["word"] == "нища" and out[0]["p"] <= consensus.UNSURE_P


def test_an_unknown_word_whisper_doubts_is_marked_but_a_confident_one_is_left_alone():
    out, info = consensus.merge([{"word": "десом.", "start": 0, "end": 1, "p": 0.6}, {"word": "Джи", "start": 1, "end": 2, "p": 0.95}], [], known)
    assert out[0]["p"] <= consensus.UNSURE_P and out[1]["p"] == 0.95 and info["unsure"] == 1


def test_words_are_never_added_or_removed():
    base = W("едно", "две", "да")
    out, _ = consensus.merge(base, [W("едно", "х", "две", "да", "г"), W("едно", "да")], known)
    assert [w["word"] for w in out] == ["едно", "две", "да"]


def test_a_stretch_with_a_different_number_of_words_is_marked_not_mapped():
    out, info = consensus.merge(W("да", "бъде", "десом."), [W("да", "бъде", "ти", "своя."), W("да", "бъде", "ти", "съм.")], known)
    assert [w["word"] for w in out] == ["да", "бъде", "десом."] and out[2]["p"] <= consensus.UNSURE_P


def test_punctuation_and_capital_letter_of_the_main_word_are_kept():
    out, _ = consensus.merge(W("Нища,", p=0.6), [W("неща"), W("неща")], known)
    assert out[0]["word"] == "Неща,"


def test_no_other_readings_is_the_main_reading_untouched():
    base = W("едно", "две")
    out, info = consensus.merge(base, [], known)
    assert out == base and info == {"changed": 0, "unsure": 0, "changes": []}


def test_lexicon_is_quiet_without_its_files_and_never_judges_latin_or_digits(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    lexicon.reset()
    assert lexicon.available() is False and lexicon.known("думичка") is None


def test_lexicon_with_the_real_dictionary_if_installed():
    spylls = pytest.importorskip("spylls")                                         # noqa: F841
    if not lexicon.available():
        pytest.skip("bg_BG dictionary not installed (scripts/setup_mac.sh --subtitles)")
    lexicon.reset()
    assert lexicon.known("неща") is True and lexicon.known("нища") is False and lexicon.known("градината,") is True
    assert lexicon.known("G-Stroy") is None and lexicon.known("25") is None


def test_an_unknown_word_that_is_one_reduced_vowel_from_a_real_word_is_respelled():
    """The speaker says „нищá“ (unstressed е heard as и); the word is „неща“. Only when exactly one real word results."""
    table = {"нища": "неща", "Нища,": "Неща,"}
    respell = lambda w, doubt=True: table.get(w)
    out, info = consensus.merge(W("сума", "ти", "нища", "съм", p=0.68), [], known, respell)
    assert out[2]["word"] == "неща" and info == {"changed": 1, "unsure": 0, "changes": [{"from": "нища", "to": "неща"}]}
    assert out[2]["p"] == consensus.MAJORITY_P
    out, _ = consensus.merge(W("Нища,", p=0.6), [], known, respell)
    assert out[0]["word"] == "Неща,"
    out, info = consensus.merge(W("десом.", p=0.41), [], known, respell)               # no candidate: stays, reported
    assert out[0]["word"] == "десом." and out[0]["p"] <= consensus.UNSURE_P and info["unsure"] == 1
    out, _ = consensus.merge(W("нища", p=0.95), [], known, respell)                     # a unique real word fits: repaired at any p
    assert out[0]["word"] == "неща"


def test_respell_with_the_real_dictionary_if_installed():
    pytest.importorskip("spylls")
    if not lexicon.available():
        pytest.skip("bg_BG dictionary not installed")
    lexicon.reset()
    assert lexicon.respell("нища") == "неща" and lexicon.respell("Нища,") == "Неща,"
    assert lexicon.respell("неща") is None and lexicon.respell("десом.") is None and lexicon.respell("G-Stroy") is None


def test_repair_with_the_real_dictionary_the_words_from_the_c9025_recording():
    pytest.importorskip("spylls")
    if not lexicon.available():
        pytest.skip("bg_BG dictionary not installed")
    lexicon.reset()
    assert lexicon.repair("одяло") == "одеяло"                      # one vowel dropped in speech
    assert lexicon.repair("Одяло,") == "Одеяло,"
    assert lexicon.repair("одялце!") == "одеялце!"                  # a diminutive the dictionary lacks, accepted by its stem
    assert lexicon.repair("одялоце") == "одеялце"                   # two vowel edits
    assert lexicon.repair("нища") == "неща"
    assert lexicon.repair("градвината") == "градината"              # one letter beats two vowel edits
    assert lexicon.repair("одялоците") is None and lexicon.repair("десом.") is None      # nothing fits: left, reported
    assert lexicon.repair("раф") is None and lexicon.repair("Джи") is None               # short words, names: untouched
    assert lexicon.known("евро") is True and lexicon.known("одеялце") is True


def test_a_tie_between_real_words_is_broken_only_by_a_word_the_recording_says_elsewhere():
    pytest.importorskip("spylls")
    if not lexicon.available():
        pytest.skip("bg_BG dictionary not installed")
    lexicon.reset()
    assert lexicon.repair("Взиваме") is None                        # seven neighbours: no guess
    assert lexicon.repair("Взиваме", True, frozenset({"взимаме"})) == "Взимаме"
    assert lexicon.repair("Взиваме", True, frozenset({"взимаме", "вливаме"})) is None     # two preferred: still no guess
    assert lexicon.repair("Взиваме", False, frozenset({"взимаме"})) is None                # a word Whisper is sure of: no wide repair
