"""The Bulgarian recognition benchmark (engine/asistent/bench): normalization keeps the letters and forms that matter in
Bulgarian; the metrics count the meaning-changing words. Synthetic sentences only. The metric tests need jiwer, which lives
in <app>/venv-bench (requirements-bench.txt): run them with that Python; in the app's venv they are skipped."""
import pytest

from asistent.bench import normalize as N


def test_raw_view_drops_punctuation_and_quotes_but_keeps_bulgarian_letters():
    assert N.raw_tokens("Дай ѝ „това“, моля — йод, ъгъл, пьеса!") == ["дай", "ѝ", "това", "моля", "йод", "ъгъл", "пьеса"]


def test_hyphenated_words_stay_one_word():
    assert N.raw_tokens("по-добре и най-бързо") == ["по-добре", "и", "най-бързо"]


def test_numbers_keep_their_decimal_part():
    assert N.raw_tokens("струва 19,90 лева.") == ["струва", "19,90", "лева"]


def test_normalized_view_writes_digits_as_spoken_and_unifies_numeral_forms():
    assert N.normalized_tokens("25 лева") == N.normalized_tokens("двадесет и пет лева") == ["двайсет", "и", "пет", "лева"]
    assert N.normalized_tokens("20%") == ["двайсет", "процента"]


def test_her_and_and_stay_different():
    assert N.normalized_tokens("ѝ") != N.normalized_tokens("и")


def test_unknown_view_is_an_error():
    with pytest.raises(ValueError):
        N.tokens("а", "stemmed")
