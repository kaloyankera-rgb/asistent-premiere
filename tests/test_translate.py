"""The English line (2026-11-04): one English piece per Bulgarian subtitle line, cut from a whole-sentence translation."""
import numpy as np
import pytest

from asistent import translate


def test_sentences_close_on_end_marks():
    assert translate.sentences(["Защо 360", "липосукцията?", "Силуета се", "възприема.", "още"]) == [[0, 1], [2, 3], [4]]


def test_split_gives_every_line_a_piece_in_order():
    words = "Why is 360 liposuction and the shaping".split()
    # attention: the first four words belong to line 0, the rest to line 1
    mass = np.array([[1, 0]] * 4 + [[0, 1]] * 3, dtype=float)
    assert translate.split(mass, words, [False, False], [3, 2]) == [(0, 4), (4, 7)]


def test_split_never_leaves_a_lone_article_line():
    words = "If we make changes in just one area,".split()
    # attention pulls "the"-like words late; the length rule and the dangling rule keep pieces whole
    mass = np.array([[1, 0, 0], [1, 0, 0], [0.4, 0.6, 0], [0, 1, 0], [0, 0.5, 0.5], [0, 0, 1], [0, 0, 1], [0, 0, 1]], dtype=float)
    cuts = translate.split(mass, words, [False, False, True], [3, 1, 4])
    pieces = [" ".join(words[a:b]) for a, b in cuts]
    assert len(pieces) == 3 and all(pieces)
    assert not any(p.split()[-1].lower() in translate.DANGLING for p in pieces[:-1])


def test_split_prefers_the_comma_where_the_bulgarian_line_has_one():
    words = "If we only process the abdominal area, say, but the patient".split()
    mass = np.full((len(words), 2), 0.5)
    cuts = translate.split(mass, words, [True, False], [4, 2])
    assert " ".join(words[cuts[0][0]:cuts[0][1]]).endswith(("area,", "say,"))


@pytest.mark.skipif(not translate.available(), reason="translator not installed")
def test_real_model_gives_one_english_line_per_bulgarian_line():
    lines = ["Защо 360 липосукцията", "е предпочитаният подход", "от повечето хирурзи?", "Пациентът ще хареса", "това, което вижда", "в огледалото."]
    en = translate.english_lines(lines)
    assert len(en) == len(lines) and all(en)
    assert "liposuction" in en[0].lower() and "mirror" in en[-1].lower()


def test_bare_drops_marks_but_keeps_a_question():
    assert translate.bare("Before getting breast augmentation,") == "Before getting breast augmentation"
    assert translate.bare("made you proud of the team?") == "made you proud of the team?"
    assert translate.bare("At RE/SHAPE Clinic, we're there.") == "At RE/SHAPE Clinic we're there"
    assert translate.bare("a 360-degree result, 2.5 cm") == "a 360-degree result 2.5 cm"


def test_the_bigger_translator_is_used_where_it_is_downloaded(tmp_path, monkeypatch):
    from asistent import config
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    small = tmp_path / "models" / translate.SMALL_DIR
    small.mkdir(parents=True)
    (small / "model.bin").write_bytes(b"x")
    assert translate.model_dir() == str(small)
    big = tmp_path / "models" / translate.MODEL_DIR
    big.mkdir(parents=True)
    (big / "model.bin").write_bytes(b"x")
    assert translate.model_dir() == str(big)


@pytest.mark.skipif(not translate.available() or translate.better_available(), reason="the 1.3B translator is not here")
def test_real_model_reads_the_meaning_not_the_word():
    en = " ".join(translate.english_lines(["Това не е проблем,", "който се решава", "просто с отслабване."])).lower()
    assert "weight" in en and "weakening" not in en
