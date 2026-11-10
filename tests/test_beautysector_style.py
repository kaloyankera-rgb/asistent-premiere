"""The Beauty Sector client's subtitle style (docs/SUBTITLE_STYLES/BEAUTY_SECTOR.md): the shared template, lines cut evenly,
coral keywords suggested on about one chunk in three, brand and product names in Latin capitals."""
import re

from asistent import subtitle_job
from asistent import subtitles as S


def words(text, t=0.0, dur=0.3, gap=0.05):
    out = []
    for tok in text.split():
        out.append({"word": tok, "start": t, "end": t + dur, "p": 0.95})
        t += dur + gap
    return out


def text_of(said, preset="beautysector"):
    return " / ".join(c["text"].replace("\n", " | ") for c in S.build_captions(words(said), preset, 29.97))


def test_the_style_is_offered_to_the_panel():
    assert "beautysector" in subtitle_job.PRESET_NAMES


def test_names_are_written_as_the_subtitles_write_them():
    # Whisper's forms (heard on the client's exports) -> the editors' spelling
    assert "BEAUTY SECTOR" in text_of("с Бюти Сектор, за")
    assert "DOUBLO GOLD" in text_of("лифтинг с Double Gold.")
    for said in ("Значи HiFull лифтингът", "дали HIFO е", "дали HIFU е"):
        assert "HIFU" in text_of(said)
    assert "HIFU ЛИФТИНГ" in text_of("High Flow Lifting с")
    assert "BODY SCULPT" in text_of("BodySculpt може")
    assert "DOCTOR VANDEV" in text_of("в Dr. Vandev")
    t = text_of("свой бюти салон")                                     # not the brand: stays Cyrillic
    assert "БЮТИ" in t and "САЛОН" in t and "BEAUTY" not in t


def test_capitals_and_no_punctuation():
    for c in S.build_captions(words("Искаш ли по-стегната кожа и по-ясен контур, без операция?"), "beautysector", 29.97):
        assert c["text"] == c["text"].upper() and not re.search(r"[.,?!…:;]", c["text"])


def test_a_one_letter_word_never_stands_alone_on_a_line():
    for c in S.build_captions(words("лифтинг с Double Gold"), "beautysector", 29.97):
        assert all(len(line.split()) > 1 or len(line) > 1 for line in c["text"].split("\n"))
    assert S._stacked([[{"word": "с"}], [{"word": "DOUBLO"}], [{"word": "GOLD"}]], S.PRESETS["beautysector"]) != [[{"word": "с"}], [{"word": "DOUBLO"}, {"word": "GOLD"}]]


def test_procedure_words_are_suggested():
    groups = [[[{"word": w}] for w in ws.split()] for ws in ("по-стегната кожа", "и по-ясен", "без операция", "и", "за теб")]
    picked = S._accents(groups, S.PRESETS["beautysector"])
    assert 0 in picked and all(b - a >= 2 for a, b in zip(picked, picked[1:]))
