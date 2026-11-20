"""The dictionary's repair by ear (lexicon.repair_by_ear, 0.10.119): the nearest real word by how words are mis-heard.
A small made-up dictionary stands in for Hunspell; the cases are the kinds seen on the editors' finished videos."""
import pytest

from asistent import lexicon

WORDS = {"разумно", "безумно", "бранша", "бранца", "инкубация", "препоръчват", "мотивираш", "градината", "хоби", "боклуци",
         "карал", "кара", "тоалетна", "неща", "нищо"}


@pytest.fixture(autouse=True)
def small_dictionary(monkeypatch):
    monkeypatch.setattr(lexicon, "_load", lambda: object())
    monkeypatch.setattr(lexicon, "_lookup", lambda d, core: core.lower() in WORDS)
    lexicon.reset_cache()
    yield
    lexicon.reset_cache()


def test_a_mis_heard_vowel_wins_over_another_consonant():
    assert lexicon.repair_by_ear("резумно") == "разумно"            # „безумно“ is also one letter away: another word


def test_two_words_equally_close_by_ear_are_not_chosen_between():
    assert lexicon.repair_by_ear("бранча") is None                   # „бранша“ and „бранца“


def test_a_word_one_far_consonant_away_is_never_taken():
    assert lexicon.repair_by_ear("интубация") is None                # a term the dictionary lacks, not „инкубация“


def test_two_mis_heard_vowels_are_repaired_together():
    assert lexicon.repair_by_ear("припоричват") == "препоръчват"


def test_a_voiced_consonant_heard_voiceless_is_the_same_word():
    assert lexicon.repair_by_ear("поклуци") == "боклуци"


def test_a_letter_said_twice_is_one_letter():
    assert lexicon.repair_by_ear("хобби") == "хоби"


def test_the_l_said_as_a_vowel_is_written_back_before_a_shorter_word_is_taken():
    assert lexicon.repair_by_ear("карао") == "карал"                 # not „кара“


def test_a_word_whisper_is_sure_of_moves_by_a_vowel_only():
    assert lexicon.repair_by_ear("мотивираеш", doubt=True) == "мотивираш"     # a vowel too many
    assert lexicon.repair_by_ear("мотивираеш", doubt=False) is None
    assert lexicon.repair_by_ear("туалетна", doubt=False) == "тоалетна"


def test_a_dropped_consonant_is_put_back_only_for_a_word_the_recording_says():
    assert lexicon.repair_by_ear("градвината") is None
    assert lexicon.repair_by_ear("градвината", prefer=frozenset({"градината"})) == "градината"


def test_a_short_word_with_two_near_neighbours_stays_as_heard():
    assert lexicon.repair_by_ear("нища") is None                     # „неща“ and „нищо“: the shipped steps decide this one


def test_capital_and_punctuation_are_kept_and_real_words_untouched():
    assert lexicon.repair_by_ear("„Резумно,") == "„Разумно,"
    assert lexicon.repair_by_ear("разумно") is None and lexicon.repair_by_ear("iPhone") is None and lexicon.repair_by_ear("дум") is None
