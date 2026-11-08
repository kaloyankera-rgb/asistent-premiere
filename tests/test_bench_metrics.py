"""Benchmark metrics (engine/asistent/bench/metrics.py) on synthetic sentences. Needs jiwer from <app>/venv-bench
(requirements-bench.txt): run with that Python; skipped in the app's venv.
  PYTHONPATH=engine:tests "<app>/venv-bench/bin/python" -m pytest tests/test_bench_metrics.py tests/test_bench.py -q"""
import pytest

jiwer = pytest.importorskip("jiwer")
from asistent.bench import metrics as M  # noqa: E402


def test_identical_texts_score_zero():
    s = M.score("Не струва 25 лева.", "не струва двайсет и пет лева")
    assert s["normalized"]["wer"] == 0 and s["meaning"]["numbers"]["errors"] == 0


def test_a_dropped_negation_is_a_meaning_error():
    s = M.score("Това не е вярно.", "това е вярно")
    assert s["meaning"]["negations"] == {"in_reference": 1, "errors": 1, "examples": ["не"]}


def test_an_inserted_negation_is_reported():
    s = M.score("Това е вярно.", "това не е вярно")
    assert s["meaning"]["inserted_negations"] == ["не"]


def test_a_wrong_number_is_a_number_error():
    s = M.score("Струва 25 лева.", "струва 35 лева")
    assert s["meaning"]["numbers"]["errors"] == 1          # „двайсет и пет“ -> „трийсет и пет“: one wrong word
    assert "двайсет" in s["meaning"]["numbers"]["examples"]


def test_names_are_capitalised_words_not_starting_a_sentence():
    assert M.name_tokens("Днес Мария дойде. Утре идва Петър от София.") == {"мария", "петър", "софия"}
    assert M.name_tokens("Днес е хубаво.", extra=["Beauty Sector"]) == {"beauty", "sector"}


def test_a_dropped_passage_is_three_or_more_words_in_a_row():
    s = M.score("Първо едно две три четири след това край.", "първо след това край")
    assert s["omissions"]["dropped_passages"] == ["едно две три четири"]


def test_timing_compares_only_matching_words():
    t = M.timing([{"word": "а", "start": 0.0}, {"word": "б", "start": 1.0}, {"word": "в", "start": 2.0}],
                 [{"word": "а", "start": 0.04}, {"word": "х", "start": 1.0}, {"word": "в", "start": 2.1}])
    assert t["matched"] == 2 and t["within_80ms"] == 0.5
