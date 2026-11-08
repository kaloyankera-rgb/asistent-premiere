"""Captions tab review (engine review.py): what to check per line, read from a finished run, never changing it.
Synthetic runs only."""
import copy
import json

import pytest

from asistent import review


def run(**kw):
    job = {
        "captions": [{"start": 0.0, "end": 1.0, "text": "Цената е 500", "flags": [{"word": "500", "p": 0.4, "at": 0.6}]},
                     {"start": 1.0, "end": 2.0, "text": "не е голяма", "flags": []},
                     {"start": 2.0, "end": 3.0, "text": "в Пловдив днес", "flags": []},
                     {"start": 3.0, "end": 4.0, "text": "подкожна масона тъкан", "flags": []}],
        "words": [{"word": "Цената", "start": 0.1, "end": 0.3, "aligned": True, "align": 0.9},
                  {"word": "е", "start": 0.35, "end": 0.4, "aligned": True, "align": 0.9},
                  {"word": "500", "start": 0.6, "end": 0.9, "aligned": True, "align": 0.9},
                  {"word": "не", "start": 1.1, "end": 1.2, "aligned": True, "align": 0.1},
                  {"word": "е", "start": 1.25, "end": 1.3, "aligned": False},
                  {"word": "голяма", "start": 1.4, "end": 1.8, "aligned": True, "align": 0.9},
                  {"word": "в", "start": 2.1, "end": 2.15, "aligned": True, "align": 0.9},
                  {"word": "Пловдив", "start": 2.2, "end": 2.6, "aligned": True, "align": 0.9},
                  {"word": "днес", "start": 2.7, "end": 2.9, "aligned": True, "align": 0.9}],
        "review": [{"at": 2.2, "word": "Пловдив", "reason": "a word that is too short"},
                   {"at": 1.5, "end": 1.95, "word": "", "reason": "speech without a word (a word may be missing, or it is breathing)"}],
        "edits": {"spelling": [{"from": "масна", "to": "масона"}, {"from": "масна", "to": "масона"}]},
    }
    job.update(kw)
    return job


def test_the_run_is_not_changed():
    job = run()
    before = copy.deepcopy(job)
    review.build(job)
    assert job == before


def test_recognition_and_timing_are_separate_kinds():
    lines = review.build(run())["lines"]
    kinds = {x["kind"] for x in lines[1]}
    assert kinds == {"recognition", "timing"}                 # a word may be missing (words); weak / not aligned (timing)


def test_meaning_changing_words_are_high_and_named():
    lines = review.build(run())["lines"]
    num = next(x for x in lines[0] if x["word"] == "500")
    assert num["severity"] == review.HIGH and num["why"] == "number"
    name = next(x for x in lines[2] if x["word"] == "Пловдив")
    assert name["severity"] == review.HIGH and name["why"] == "name"   # „too short“ alone is medium; a name raises it


def test_a_change_shows_its_original_once_on_the_line_that_shows_it():
    lines = review.build(run())["lines"]
    changes = [x for items in lines for x in items if "from" in x]
    assert changes == [{"kind": "recognition", "severity": review.HIGH, "label": "changed by dictionary repair",
                        "word": "масона", "from": "масна", "to": "масона", "at": 3.0}]


def test_weak_timing_alone_does_not_make_a_line_to_check():
    job = run(review=[], edits={})
    job["captions"][0]["flags"] = []
    s = review.build(job)["summary"]
    assert s["lines_to_check"] == 0 and s["timing"] == 2


def test_no_probability_is_reported_as_accuracy():
    out = json.dumps(review.build(run()), ensure_ascii=False)
    assert "0.4" not in out and "%" not in out


def test_order_puts_meaning_first():
    s = review.build(run())["summary"]
    assert s["order"][:2] == [0, 1] and set(s["order"]) == {0, 1, 2, 3}


def test_only_asistent_runs_are_read(tmp_path):
    with pytest.raises(ValueError):
        review.load(str(tmp_path / "other.json"))
    folder = tmp_path / "Asistent_subtitles"
    folder.mkdir()
    (folder / "a.json").write_text(json.dumps(run()), encoding="utf-8")
    assert review.load(str(folder / "a.json"))["summary"]["lines_to_check"] >= 1


def test_older_bulgarian_reasons_are_understood():
    assert review.classify("не се чува ясно в звука (тих шум)")[0] == "timing"
    assert review.classify("„нов стена“: the endings do not agree (check what was said)")[1] == review.HIGH
