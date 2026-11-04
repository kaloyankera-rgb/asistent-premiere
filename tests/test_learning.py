"""Learning from the editors' fixes (learning.py): the client's folder, one event per project, when a fix reaches whom,
reverts, the outbox; and in the subtitles job, that a learned fix is used only where the sound allows it."""
import json
import os

import pytest

from asistent import asr, audiocheck, config, learning, lexicon
import test_subtitle_job as T


@pytest.fixture
def office(tmp_path, monkeypatch):
    """Production/<client>/<client> Subtitle Learning on a fake server, and this computer's app folder."""
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path / "app"))
    monkeypatch.setattr(learning, "_mounts", lambda: [])
    monkeypatch.setattr(lexicon, "known", lambda w: None if any(c.isascii() and c.isalpha() for c in w) else w.lower() != "решейп")
    learning.reset()
    root = tmp_path / "Production"
    for client in ("ReShape", "Masterhaus", "4a1a"):
        (root / client / f"{client} Subtitle Learning").mkdir(parents=True)
    return root


def project(root, client, name):
    p = root / client / "Контент план" / name / f"{name}.prproj"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("")
    return str(p)


def as_computer(monkeypatch, cid):
    monkeypatch.setattr(learning, "computer", lambda: {"id": cid, "name": "PC-" + cid})


def fix(proj, heard, said, left="", right="", terms=(), english=None):
    plan = learning.plan_for(proj, [(heard, said)])
    learning.record(plan, [{"heard": heard, "said": said, "left": left, "right": right, "example": f"{left} {heard} {right}"}],
                    terms, english, background=False)


def keys(proj, pairs=()):
    learning.reset()
    return {r.key for r in learning.plan_for(proj, pairs).rules}


def test_the_client_folder_is_found_from_the_project_and_names_the_client(office):
    p = project(office, "ReShape", "Видео 1")
    assert learning.find_folder(p) == ("ReShape", str(office / "ReShape" / "ReShape Subtitle Learning"))
    elsewhere = office.parent / "local" / "x.prproj"
    elsewhere.parent.mkdir()
    assert learning.find_folder(str(elsewhere)) is None


def test_a_deep_folder_mounted_as_its_own_volume_still_finds_the_client(office, monkeypatch):
    p = project(office, "ReShape", "Видео 1")
    deep = os.path.dirname(p)
    monkeypatch.setattr(learning, "_mounts", lambda: [("fileserver", "Production/ReShape/Контент план/Видео 1", "/Volumes/Видео 1"),
                                                      ("fileserver", "Production", str(office))])
    seen = learning._alternatives("/Volumes/Видео 1/Видео 1.prproj")
    assert seen[1] == os.path.join(deep, "Видео 1.prproj")


def test_a_word_fix_reaches_its_own_computer_at_once_and_everyone_after_two_projects(office, monkeypatch):
    p1, p2, p3 = (project(office, "ReShape", f"Видео {i}") for i in (1, 2, 3))
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(p1, "при", "по", left="като")
    k = learning.rule_key("при", "по")
    assert k in keys(p2)                                           # the computer that made it
    as_computer(monkeypatch, "bbbbbbbbbbbb")
    assert k not in keys(p3)                                       # another editor: not yet
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(p2, "при", "по", left="като")
    as_computer(monkeypatch, "bbbbbbbbbbbb")
    assert k in keys(p3)                                           # two projects: everyone in the client


def test_rebuilding_the_same_project_does_not_count_twice(office, monkeypatch):
    p1, p2 = project(office, "ReShape", "Видео 1"), project(office, "ReShape", "Видео 2")
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    for _ in range(3):
        fix(p1, "при", "по", left="като")
    with open(next((office / "ReShape" / "ReShape Subtitle Learning" / "events").glob("*.jsonl")), encoding="utf-8") as f:
        assert len(f.readlines()) == 1
    as_computer(monkeypatch, "bbbbbbbbbbbb")
    assert learning.rule_key("при", "по") not in keys(p2)


def test_a_name_reaches_the_whole_client_from_the_first_fix_and_goes_into_the_prompt(office, monkeypatch):
    p1, p2 = project(office, "ReShape", "Видео 1"), project(office, "ReShape", "Видео 2")
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(p1, "Решейп", "ReShape", terms=["д-р Денков"])
    as_computer(monkeypatch, "bbbbbbbbbbbb")
    learning.reset()
    plan = learning.plan_for(p2)
    assert [r.said for r in plan.rules] == ["ReShape"] and plan.rules[0].free
    assert set(plan.terms) == {"д-р Денков", "ReShape"}


def test_another_client_gets_a_fix_only_after_three_projects_by_two_computers(office, monkeypatch):
    r = [project(office, "ReShape", f"Видео {i}") for i in (1, 2, 3)]
    other = project(office, "Masterhaus", "Видео 9")
    k = learning.rule_key("одяло", "одеяло")
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(r[0], "одяло", "одеяло")
    fix(r[1], "одяло", "одеяло")
    assert k not in keys(other)
    as_computer(monkeypatch, "bbbbbbbbbbbb")
    fix(r[2], "одяло", "одеяло")
    assert k in keys(other)


def test_typing_the_original_back_undoes_a_learned_fix_for_everyone_and_is_not_learned_backwards(office, monkeypatch):
    p = [project(office, "ReShape", f"Видео {i}") for i in (1, 2, 3, 4)]
    k = learning.rule_key("при", "по")
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(p[0], "при", "по", left="като")
    fix(p[1], "при", "по", left="като")
    as_computer(monkeypatch, "bbbbbbbbbbbb")
    assert k in keys(p[2])
    assert k not in keys(p[2], [("по", "при")])                    # the editor's own line wins in that run
    fix(p[2], "по", "при", left="като")                           # the editor typed the original back
    assert k not in keys(p[3]) and learning.rule_key("по", "при") not in keys(p[3])
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    assert k not in keys(p[3])                                     # not even on the computer that made it


def test_the_editors_own_line_that_undoes_a_learned_fix_keeps_it_out_of_that_run(office, monkeypatch):
    p1, p2 = project(office, "ReShape", "Видео 1"), project(office, "ReShape", "Видео 2")
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(p1, "при", "по", left="като")
    assert learning.rule_key("при", "по") not in keys(p2, [("по", "при")])


def test_remove_and_restore(office, monkeypatch):
    p1, p2 = project(office, "ReShape", "Видео 1"), project(office, "ReShape", "Видео 2")
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(p1, "Решейп", "ReShape")
    folder = learning.find_folder(p1)[1]
    ev = {"v": 1, "id": "r1", "t": 9e12, "computer": "aaaaaaaaaaaa", "project": "x", "kind": "remove", "heard": "Решейп", "said": "ReShape"}
    learning._append(folder, [ev])
    assert not keys(p2)
    learning._append(folder, [{**ev, "id": "r2", "t": 9.1e12, "kind": "restore"}])
    assert keys(p2) == {learning.rule_key("Решейп", "ReShape")}


def test_a_single_dictionary_word_needs_the_words_it_was_fixed_between(office, monkeypatch):
    p1, p2 = project(office, "ReShape", "Видео 1"), project(office, "ReShape", "Видео 2")
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(p1, "при", "по", left="като", right="пълни")
    plan = learning.plan_for(p2)
    ws = T_words("като при пълни при него")
    assert plan.context_ok(ws, 1, 1, 0) and not plan.context_ok(ws, 3, 1, 0)


def T_words(text):
    return [{"word": w, "start": i * 0.4, "end": (i + 1) * 0.4, "p": 0.9} for i, w in enumerate(text.split())]


def test_english_lines_are_shared_within_the_client(office, monkeypatch):
    p1, p2 = project(office, "ReShape", "Видео 1"), project(office, "ReShape", "Видео 2")
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(p1, "Решейп", "ReShape", english={"външно липедема": "On the outside, lipedema"})
    learning.reset()
    assert learning.plan_for(p2).english == {"външно липедема": "On the outside, lipedema"}


def test_a_project_outside_a_client_folder_learns_on_this_computer_only(office, monkeypatch, tmp_path):
    lone = tmp_path / "desk" / "a.prproj"
    lone.parent.mkdir()
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(str(lone), "Решейп", "ReShape")
    assert (tmp_path / "app" / "learning" / "local" / "events" / "aaaaaaaaaaaa.jsonl").is_file()
    assert not list((office / "ReShape" / "ReShape Subtitle Learning").glob("events/*"))


def test_a_write_that_fails_waits_in_the_outbox_and_goes_later(office, monkeypatch):
    p1, p2 = project(office, "ReShape", "Видео 1"), project(office, "ReShape", "Видео 2")
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    real = learning._append
    monkeypatch.setattr(learning, "_append", lambda folder, events: False)
    fix(p1, "Решейп", "ReShape")
    assert os.path.isfile(learning._outbox())
    monkeypatch.setattr(learning, "_append", real)
    assert keys(p2) == {learning.rule_key("Решейп", "ReShape")}   # sent when the next run read the folder
    assert not os.path.isfile(learning._outbox())


def test_a_broken_line_from_a_dropped_connection_is_skipped(office, monkeypatch):
    p1, p2 = project(office, "ReShape", "Видео 1"), project(office, "ReShape", "Видео 2")
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(p1, "Решейп", "ReShape")
    path = next((office / "ReShape" / "ReShape Subtitle Learning" / "events").glob("*.jsonl"))
    with open(path, "a", encoding="utf-8") as f:
        f.write('{"v": 1, "kind": "fix", "heard": "cut')
    assert keys(p2) == {learning.rule_key("Решейп", "ReShape")}


# ---------------------------------------------------------------- in the subtitles job

@pytest.fixture
def job(office, tmp_path, monkeypatch):
    monkeypatch.setattr(asr, "backend_installed", lambda: True)
    monkeypatch.setattr(asr, "model_present", lambda: True)
    monkeypatch.setattr(T.align, "unheard", lambda y, ws, sr=16000: ([dict(w) for w in ws], []))
    monkeypatch.setattr(T.align, "available", lambda: False)
    monkeypatch.setattr(T.align, "trim_silence", lambda y, ws, sr=16000: ([dict(w) for w in ws], 0))
    words = [{"word": "Здравейте", "start": 0.5, "end": 1.0, "p": 0.95}, {"word": "от", "start": 1.0, "end": 1.3, "p": 0.9},
             {"word": "Решейп", "start": 1.3, "end": 1.9, "p": 0.6}, {"word": "днес", "start": 2.4, "end": 2.8, "p": 0.9}]
    prompts = []
    monkeypatch.setattr(asr, "transcribe", lambda audio, prompt, *a, **k: prompts.append(prompt) or [dict(w) for w in words])
    return {"prompts": prompts}


def run_in(office, home, name, monkeypatch, **kw):
    proj = project(office, "ReShape", name)
    b = T.body(home, project=proj, **kw)
    res = T.subtitle_job.run(b, lambda f, m: None, lambda: False)
    learning.wait()
    return res


def test_a_fix_typed_in_one_project_is_used_in_the_next_one_when_the_sound_allows(office, job, tmp_path, monkeypatch):
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    checks = []
    monkeypatch.setattr(audiocheck, "margin", lambda y, ws, i, n, said: checks.append(said) or -1.0)
    first = run_in(office, tmp_path, "Видео 1", monkeypatch, text="Решейп => ReShape")
    assert "ReShape" in first["captions"][0]["text"] + first["captions"][-1]["text"] and not checks
    learning.reset()
    second = run_in(office, tmp_path, "Видео 2", monkeypatch)
    text = " ".join(c["text"] for c in second["captions"])
    assert "ReShape" in text and "Решейп" not in text and checks == ["ReShape"]
    assert second["learning"]["client"] == "ReShape" and second["learning"]["used"][0]["said"] == "ReShape"
    assert job["prompts"][-1].endswith("ReShape.")                # the learned name helps Whisper too
    with open(second["json"], encoding="utf-8") as f:
        assert json.load(f)["edits"]["learned"][0]["margin"] == -1.0


def test_a_learned_fix_the_sound_speaks_against_is_not_used(office, job, tmp_path, monkeypatch):
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    monkeypatch.setattr(audiocheck, "margin", lambda y, ws, i, n, said: -9.0)
    run_in(office, tmp_path, "Видео 1", monkeypatch, text="Решейп => ReShape")
    learning.reset()
    second = run_in(office, tmp_path, "Видео 2", monkeypatch)
    assert "Решейп" in " ".join(c["text"] for c in second["captions"])
    assert second["learning"]["vetoed"] and not second["learning"]["used"]


def test_without_a_project_nothing_is_learned(office, job, tmp_path, monkeypatch):
    res = T.subtitle_job.run(T.body(tmp_path, text="Решейп => ReShape"), lambda f, m: None, lambda: False)
    assert res["learning"] is None


def test_the_sound_check_compares_the_heard_and_the_fixed_words_with_one_word_around_them(monkeypatch):
    import numpy as np
    seen = []
    monkeypatch.setattr(asr, "score_texts", lambda y, texts: seen.append((len(y), texts)) or [-10.0, -12.5])
    ws = T_words("При липедема масните клетки не")
    m = audiocheck.margin(np.zeros(16000 * 5, dtype=np.float32), ws, 2, 1, "мастните")
    assert m == -2.5 and audiocheck.fits(m) and not audiocheck.fits(-audiocheck.VETO - 0.1)
    n, texts = seen[0]
    assert texts == ["липедема масните клетки", "липедема мастните клетки"]
    assert n == int((ws[3]["end"] + audiocheck.PAD) * 16000)                   # from 0 (not before the audio) to the word after


def test_a_correction_written_from_the_captions_matches_any_repair_the_dictionary_may_show(monkeypatch):
    monkeypatch.setattr(lexicon, "repair", lambda w, *a: None)
    monkeypatch.setattr(lexicon, "candidates", lambda w: ["месната", "мастната"] if w == "масната" else [])
    assert {"масната", "месната", "мастната"} <= T.subtitle_job._variants("масната")


def test_the_learned_list_shows_each_fix_and_remove_and_restore_reach_everyone(office, monkeypatch):
    p1, p2 = project(office, "ReShape", "Видео 1"), project(office, "ReShape", "Видео 2")
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(p1, "Решейп", "ReShape")
    fix(p1, "при", "по", left="като")
    learning.reset()
    lst = learning.listing(p2)
    assert lst["client"] == "ReShape" and lst["shared"] is True
    row = {r["said"]: r for r in lst["rules"]}["ReShape"]
    assert row["active"] and row["projects"] == 1 and not row["removed"]
    as_computer(monkeypatch, "bbbbbbbbbbbb")                     # another editor removes it: gone for everyone
    after = learning.set_removed(p2, row["key"], True)
    assert {r["said"]: r for r in after["rules"]}["ReShape"]["removed"]
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    assert row["key"] not in keys(p2)
    learning.set_removed(p2, row["key"], False)
    assert row["key"] in keys(p2)
    with pytest.raises(ValueError):
        learning.set_removed(p2, "nothing=>here", True)


def test_every_use_is_counted_once_per_project_for_the_measurement(office, job, tmp_path, monkeypatch):
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    monkeypatch.setattr(audiocheck, "margin", lambda y, ws, i, n, said: -1.0)
    run_in(office, tmp_path, "Видео 1", monkeypatch, text="Решейп => ReShape")
    for _ in range(2):
        learning.reset()
        run_in(office, tmp_path, "Видео 2", monkeypatch)
    learning.reset()
    rule = {r["said"]: r for r in learning.listing(project(office, "ReShape", "Видео 3"))["rules"]}["ReShape"]
    assert rule["used"] == 1


def test_the_measurement_report_counts_uses_and_reverts(office, monkeypatch, capsys):
    import importlib.util
    spec = importlib.util.spec_from_file_location("measure", os.path.join(os.path.dirname(__file__), "..", "scripts", "measure_learning.py"))
    measure = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(measure)
    p1 = project(office, "ReShape", "Видео 1")
    as_computer(monkeypatch, "aaaaaaaaaaaa")
    fix(p1, "Решейп", "ReShape")
    assert measure.report(p1) == 0
    out = capsys.readouterr().out
    assert "ReShape: 1 learned fixes" in out and "No learned fix has been used yet." in out
