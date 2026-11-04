"""Bulgarian writing rules (bgnorm.py): only how a said word is written changes. A small word list stands in for the
dictionary, so these run on any computer; the real dictionary is tried at the end when it is installed."""
import pytest

from asistent import bgnorm, lexicon

WORDS = {"знам", "знаех", "може", "аз", "какво", "да", "правя", "добър", "добра", "добро", "добри", "добре", "бърз", "бърза",
         "бързо", "бързи", "нов", "нова", "ново", "нови", "новия", "новият", "начин", "път", "пътя", "пътят", "пъти", "пъта",
         "човек", "човека", "човекът", "проект", "проекта", "проектът", "тук", "това", "е", "от", "вчера", "на", "по",
         "най", "добрият", "вариант", "необходимо", "клиент", "клиента", "клиентът", "не", "го", "видях", "дойде", "ще",
         "кабинет", "кабинета", "кабинетът", "в", "мен", "пълни", "крака", "като", "ден", "деня", "денят", "той"}


def known(w):
    return w.lower() in WORDS


def W(text):
    return [{"word": w, "start": float(i), "end": i + 1.0, "p": 0.9} for i, w in enumerate(text.split())]


def run(text, k=known):
    out, changes = bgnorm.apply(W(text), k)
    return " ".join(w["word"] for w in out), [c["rule"] for c in changes]


@pytest.mark.parametrize("heard, written", [
    ("Аз незнам какво да правя.", "Аз не знам какво да правя."),
    ("незнаех", "не знаех"),
    ("Това е по добре от вчера.", "Това е по-добре от вчера."),
    ("по бърз от мен", "по-бърз от мен"),
    ("Това е най добрият вариант.", "Това е най-добрият вариант."),
    ("като по -пълни крака.", "като по-пълни крака."),             # Whisper's own split (ReShape, 2026-11-04)
    ("Дадох го на човекът вчера.", "Дадох го на човека вчера."),
    ("в кабинетът", "в кабинета"),
    ("Човека е тук.", "Човекът е тук."),
    ("Клиента ще дойде.", "Клиентът ще дойде."),
    ("Това е новия проект.", "Това е новият проект."),
    ("Това е деня", "Това е денят"),
])
def test_writing_rules(heard, written):
    assert run(heard)[0] == written


@pytest.mark.parametrize("text", [
    "Ходим по пътя.",                     # a preposition before a noun
    "по нов начин",                       # „in a new way“: an adjective before its noun is not a comparison
    "Невена дойде.",                      # a name that starts with „Не“
    "необходимо",                         # a real word that starts with „не“
    "Клиента не го видях.",               # a fronted object repeated by „го“ keeps the short article
    "Видях човека.",                      # an object
    "по-добре",
    "Човека, е тук.",                     # a comma between them: not this pattern
])
def test_what_is_right_stays(text):
    assert run(text) == (text, [])


def test_times_are_kept_and_a_split_word_shares_its_span():
    out, _ = bgnorm.apply(W("незнам по добре"), known)
    assert [w["word"] for w in out] == ["не", "знам", "по-добре"]
    assert out[0]["start"] == 0.0 and out[1]["end"] == 1.0 and 0.0 < out[0]["end"] == out[1]["start"] < 1.0
    assert out[2]["start"] == 1.0 and out[2]["end"] == 3.0 and all(w["norm"] for w in out)


def test_a_word_the_editor_fixed_is_never_touched():
    ws = W("на човекът")
    ws[1]["fixed"] = True
    assert bgnorm.apply(ws, known)[0][1]["word"] == "човекът"


def test_without_the_dictionary_only_the_rules_that_need_none_run():
    none = lambda w: None
    assert run("най добрият по -пълни незнам на човекът", none) == ("най-добрият по-пълни незнам на човекът", ["hyphen", "hyphen"])


@pytest.mark.skipif(not lexicon.available(), reason="the Bulgarian dictionary is not installed here")
def test_with_the_real_dictionary():
    lexicon.reset()
    real = lambda t: run(t, lexicon.known)[0]
    assert real("Аз незнам.") == "Аз не знам."
    assert real("Пациента ще дойде.") == "Пациентът ще дойде."
    assert real("Ходим по пътя.") == "Ходим по пътя."
    assert real("необходимо е") == "необходимо е"
