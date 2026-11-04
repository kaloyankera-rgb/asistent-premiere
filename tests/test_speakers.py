"""Phases 5-6 of the Smart Subtitle Correction plan (0.9.96): who speaks on a track decides the first-person forms
(changed unless the sound clearly says the other one), and an adjective that disagrees with its noun is only marked.
A small word list stands in for the dictionary."""
import pytest

from asistent import agreement, audiocheck, learning, subtitle_settings
import test_learning as L
import test_subtitle_job as T

WORDS = {"направил", "направила", "отишъл", "отишла", "доволен", "доволна", "доволно", "доволни", "готов", "готова", "готово",
         "готови", "казал", "казала", "нов", "нова", "ново", "нови", "стена", "телефон", "телефона", "рафтове", "това", "аз",
         "съм", "бях", "му", "там", "от", "резултата", "два", "как", "така", "кака", "како", "каки", "дете", "малко", "добро",
         "утро", "голяма", "голям", "голямо", "големи", "част", "имам", "е", "и"}


def known(w):
    return w.lower() in WORDS


def W(text, t=0.0):
    return [{"word": w, "start": t + i * 0.4, "end": t + (i + 1) * 0.4, "p": 0.9} for i, w in enumerate(text.split())]


@pytest.mark.parametrize("text, found", [
    ("Аз съм направила това.", [(2, "f")]),
    ("Бях доволен от резултата.", [(1, "m")]),
    ("Аз съм готова.", [(2, "f")]),
    ("Казала съм му.", [(0, "f")]),
    ("тя е направила това", []),                       # third person: not the speaker (guide §2.1)
])
def test_the_speakers_own_forms_are_found(text, found):
    assert agreement.speaker_forms(W(text), known) == found


@pytest.mark.parametrize("word, gender, new", [
    ("направила", "m", "направил"), ("направил", "f", "направила"), ("отишла", "m", "отишъл"), ("отишъл", "f", "отишла"),
    ("доволен", "f", "доволна"), ("доволна", "m", "доволен"), ("Готова.", "m", "Готов."),
])
def test_a_form_turns_into_the_other_gender_only_into_a_real_word(word, gender, new):
    assert agreement.to_gender(word, gender, known) == new


def test_without_the_dictionary_only_regular_participles_change():
    none = lambda w: None
    assert agreement.to_gender("направила", "m", none) == "направил"
    assert agreement.to_gender("отишла", "m", none) is None              # „отишл“ is not sure without the dictionary
    assert agreement.to_gender("доволна", "m", none) is None


@pytest.mark.parametrize("text, marked", [
    ("Това е нов стена.", [2]), ("Имам нова телефон.", [1]),
    ("Нова стена.", []), ("два нови телефона", []), ("добро утро", []), ("голяма част", []), ("малко дете", []),
    ("Купих нови рафтове.", []), ("как така", []), ("нов, стена", []),
])
def test_an_adjective_that_disagrees_with_its_noun_is_marked(text, marked):
    assert [i for i, _ in agreement.mismatches(W(text), known)] == marked


# ---------------------------------------------------------------- in the subtitles job

def test_a_track_set_to_a_man_gets_the_mans_forms_unless_the_sound_says_otherwise(L_office, tmp_path, monkeypatch):
    office, job = L_office
    proj = L.project(office, "ReShape", "Видео 1")
    monkeypatch.setattr(agreement, "_known", lambda: known)
    job["words"][:] = [dict(w) for w in W("Аз съм направила това.", 0.5)]
    subtitle_settings.put_speakers(proj, {"0": "m"})
    monkeypatch.setattr(audiocheck, "margin", lambda y, ws, i, n, said: -1.0)
    res = T.subtitle_job.run(T.body(tmp_path, project=proj), lambda f, m: None, lambda: False)
    learning.wait()
    assert "направил " in " ".join(c["text"] for c in res["captions"]) + " " and res["speakers"] == {"0": "m"}
    assert res["tracks"] == [0]
    monkeypatch.setattr(audiocheck, "margin", lambda y, ws, i, n, said: -20.0)       # the sound clearly says „направила“
    subtitle_settings.put_speakers(proj, {"0": "f"})
    job["words"][:] = [dict(w) for w in W("Аз съм направил това.", 0.5)]
    res = T.subtitle_job.run(T.body(tmp_path, project=proj, terms=["x"]), lambda f, m: None, lambda: False)
    assert "направил" in " ".join(c["text"] for c in res["captions"])
    assert any("set as a woman" in r["reason"] for r in res["review"])


def test_a_track_that_is_not_set_is_never_changed(L_office, tmp_path, monkeypatch):
    office, job = L_office
    proj = L.project(office, "ReShape", "Видео 2")
    monkeypatch.setattr(agreement, "_known", lambda: known)
    job["words"][:] = [dict(w) for w in W("Аз съм направила това.", 0.5)]
    res = T.subtitle_job.run(T.body(tmp_path, project=proj), lambda f, m: None, lambda: False)
    assert "направила" in " ".join(c["text"] for c in res["captions"])


def test_the_clients_last_speakers_are_the_default_of_its_next_project(L_office, tmp_path, monkeypatch):
    office, _ = L_office
    p1, p2 = L.project(office, "ReShape", "Видео 1"), L.project(office, "ReShape", "Видео 2")
    L.as_computer(monkeypatch, "aaaaaaaaaaaa")
    learning.record_speakers(p1, {"0": "m", "1": "f"})
    learning.reset()
    assert learning.plan_for(p2).speakers == {"0": "m", "1": "f"}


@pytest.fixture
def L_office(tmp_path, monkeypatch):
    """The office of test_learning (no dictionary), and a fake Whisper whose words each test sets."""
    from asistent import asr, config, lexicon
    monkeypatch.setattr(learning, "_mounts", lambda: [])
    (tmp_path / "app").mkdir()
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path / "app"))
    monkeypatch.setattr(lexicon, "known", lambda w: None)
    learning.reset()
    office = tmp_path / "Production"
    (office / "ReShape" / "ReShape Subtitle Learning").mkdir(parents=True)
    monkeypatch.setattr(asr, "backend_installed", lambda: True)
    monkeypatch.setattr(asr, "model_present", lambda: True)
    monkeypatch.setattr(T.align, "unheard", lambda y, ws, sr=16000: ([dict(w) for w in ws], []))
    monkeypatch.setattr(T.align, "available", lambda: False)
    monkeypatch.setattr(T.align, "trim_silence", lambda y, ws, sr=16000: ([dict(w) for w in ws], 0))
    words = []
    monkeypatch.setattr(asr, "transcribe", lambda audio, prompt, *a, **k: [dict(w) for w in words])
    return office, {"words": words}
