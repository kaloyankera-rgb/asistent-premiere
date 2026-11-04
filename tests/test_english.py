"""English words a Bulgarian speaker says are written in English (english.py; the user, 2026-11-04: „Бюти сектор“ = "Beauty
Sector", „спей/с“ = "Space"). Bulgarian words, loans spelled the Bulgarian way and mis-heard Bulgarian words stay."""
import pytest

from asistent import english, lexicon

need_dict = pytest.mark.skipif(not lexicon.available(), reason="the Bulgarian dictionary is not installed here")


def said(text, names=()):
    ws = [{"word": w, "start": float(i), "end": i + 0.5, "p": 0.9} for i, w in enumerate(text.split())]
    out, changes = english.apply(ws, names)
    return " ".join(w["word"] for w in out), out, changes


def test_the_index_ships_with_asistent():
    assert english.available()


@need_dict
@pytest.mark.parametrize("heard, written", [
    ("Ние сме бюти сектор.", "Ние сме Beauty Sector."),                       # the user's example, without any name given
    ("На Варна бюти спей се срещнахме", "На Варна Beauty Space срещнахме"),     # „спей се“: Whisper split the final s
    ("проведохме уоркшоп и представихме", "проведохме workshop и представихме"),
    ("Изпратете ни имейл, окей?", "Изпратете ни email, okay?"),
])
def test_english_words_are_written_in_english(heard, written):
    assert said(heard)[0] == written


@need_dict
@pytest.mark.parametrize("text", [
    "Имах дискомфорт в крака.",          # a Bulgarian loan spelled the Bulgarian way
    "Това е работ на екипа.",            # „работа“ with its ending swallowed: mis-heard Bulgarian
    "Ново прес на щанда.",               # „преса“
    "това е много важно за кожата на лицето",
    "Задържането на течности увеличава обема.",
])
def test_bulgarian_stays_bulgarian(text):
    assert said(text)[0] == text


def test_the_editors_own_name_is_written_exactly_as_given():
    text, _, changes = said("Ние сме бюти сектор.", ["Beauty Sector"])
    assert text == "Ние сме Beauty Sector."
    assert changes == [{"from": "бюти сектор.", "to": "Beauty Sector.", "at": 2.0}]


def test_joined_words_keep_the_times_of_the_sound():
    _, out, _ = said("бюти спей се срещнахме")
    assert [(w["word"], w["start"], w["end"]) for w in out[:2]] == [("Beauty", 0.0, 0.5), ("Space", 1.0, 2.5)]
    assert all(w.get("english") for w in out[:2]) and not out[2].get("english")


def test_latin_words_are_left_alone_by_the_bulgarian_checks():
    assert lexicon.known("Beauty") is None                  # not judged, never "repaired" into a Bulgarian word


def test_an_english_name_stays_on_one_line():
    from asistent import subtitles as S
    t, ws = 0.0, []
    for w in "Варна, запознахме ли се? Ние сме бюти сектор. На Варна бюти спей се срещнахме с хора".split():
        ws.append({"word": w, "start": t, "end": t + 0.3, "p": 0.9})
        t += 0.35
    words, _ = S.tidy_words(english.apply(ws)[0])
    lines = [c["text"] for c in S.build_captions(words, "short", 25)]
    assert any("Beauty Sector." in x for x in lines) and "Beauty Space" in lines
