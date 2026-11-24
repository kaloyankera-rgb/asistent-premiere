"""The subtitle edit log (TODO SAL Step 1, 0.10.155): the journal, and the export-time comparison of Asistent's placed captions
with the caption lines of the saved project. Synthetic run JSON and a fake `prcaptions.read`; everything is written into a
temp folder."""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
from asistent import captionstate, config, editlog, learning, prcaptions  # noqa: E402

PROJECT = "/p/Some Client/NEW.prproj"
GUID = "8097176a-bd0c"
FPS = 25.0


@pytest.fixture(autouse=True)
def app(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path / "app"))
    monkeypatch.setattr(learning, "find_folder", lambda project: None)       # outside a client folder: the journal is "local"
    monkeypatch.setattr(captionstate, "get", lambda project, key: None)
    return tmp_path


def make_run(tmp_path, spec, preset="gstroy", **extra):
    """spec: [(word, start, end)] in groups per caption: [[(w, s, e), ...], ...] -> the run JSON next to a fake .srt path."""
    words, captions = [], []
    for group in spec:
        for w, s, e in group:
            words.append({"word": w, "start": s, "end": e, "p": 0.9})
        captions.append({"start": group[0][1], "end": group[-1][2], "text": " ".join(w for w, _, _ in group), "flags": []})
    folder = tmp_path / "Asistent_subtitles"
    folder.mkdir(exist_ok=True)
    srt = str(folder / "run.srt")
    with open(str(folder / "run.json"), "w", encoding="utf-8") as f:
        json.dump({"preset": preset, "fps": FPS, "captions": captions, "words": words, **extra}, f, ensure_ascii=False)
    return srt


def premiere(monkeypatch, srt, lines, *, record=True, tracks=None, english=None):
    """The saved project as prcaptions.read gives it, and the record Asistent kept for the sequence."""
    seqs = [{"guid": GUID, "name": "Seq", "tracks": tracks or [{"index": 0, "lines": [
        {"start": s, "end": e, "text": t} for s, e, t in lines]}]}]
    monkeypatch.setattr(prcaptions, "read", lambda project: seqs)
    sig = {"index": 0, "count": len(lines), "srt": srt, **({"english": {"index": english, "count": 2}} if english is not None else {})}
    monkeypatch.setattr(captionstate, "get", lambda project, key: sig if record and key == "guid:" + GUID else None)


def one(project=PROJECT):
    recs = editlog.compare(project)
    assert len(recs) == 1
    return recs[0]


W = [("Здравей", 0.00, 0.40), ("свят.", 0.45, 0.90), ("Днес", 1.50, 1.80), ("правим", 1.85, 2.20)]


def test_a_split_at_a_sentence_end_says_what_the_engine_saw(app, monkeypatch):
    srt = make_run(app, [W])                                                   # one caption: "Здравей свят. Днес правим"
    premiere(monkeypatch, srt, [(0.0, 0.9, "Здравей свят."), (1.5, 2.2, "Днес правим")])
    r = one()
    assert r["status"] == "ok" and r["counts"] == {"split": 1} and r["preset"] == "gstroy"
    (sp,) = r["splits"]
    assert sp["caption"] == 0 and sp["lines"] == 2
    (cut,) = sp["cuts"]
    assert cut["k"] == 2 and cut["word"] == 2 and cut["punct"] == "." and cut["cause"] == "sentence_end"
    assert cut["gap"] == pytest.approx(0.6) and cut["strength"] == 1.0
    assert r["fixes"] == [] and r["words_changed"] == 0


def test_a_split_with_no_punctuation_and_the_other_causes(app, monkeypatch):
    spec = [[("правим", 0.00, 0.30), ("видео", 0.32, 0.60),            # 0.02 s: one breath, no mark
             ("за", 0.80, 0.90),                                      # 0.20 s after "видео": a pause
             ("всички,", 0.92, 1.30), ("хора", 1.32, 1.60)]]          # a comma before "хора"
    srt = make_run(app, spec)
    premiere(monkeypatch, srt, [(0.0, 0.6, "правим видео"), (0.8, 0.9, "за"), (0.92, 1.3, "всички,"), (1.32, 1.6, "хора")])
    cuts = one()["splits"][0]["cuts"]
    assert [c["cause"] for c in cuts] == ["pause", "none", "comma"]
    assert cuts[1]["gap"] == pytest.approx(0.02) and cuts[1]["punct"] == "" and cuts[1]["strength"] == 0.0
    # a cut after the second word of the caption: no pause, no mark -> "none" (the plan's no-punctuation case)
    srt = make_run(app, [spec[0][:2] + [("за", 0.62, 0.72), ("всички", 0.74, 1.0)]])
    premiere(monkeypatch, srt, [(0.0, 0.6, "правим видео"), (0.62, 1.0, "за всички")])
    (cut,) = one()["splits"][0]["cuts"]
    assert cut["cause"] == "none" and cut["gap"] == pytest.approx(0.02) and cut["strength"] == 0.0


def test_two_captions_made_one_line_is_a_merge(app, monkeypatch):
    srt = make_run(app, [W[:2], W[2:]])
    premiere(monkeypatch, srt, [(0.0, 2.2, "Здравей свят. Днес правим")])
    r = one()
    assert r["counts"] == {"merge": 1} and r["merges"] == [{"captions": [0, 1], "line": 0}]


def test_a_deleted_line_is_counted_with_its_words(app, monkeypatch):
    srt = make_run(app, [W[:2], W[2:]])
    premiere(monkeypatch, srt, [(0.0, 0.9, "Здравей свят.")])
    r = one()
    assert r["counts"]["deleted"] == 1 and r["counts"]["delete"] == 1          # the line, and its two words as a deletion
    assert r["deleted"] == [{"caption": 1, "start": 1.5, "end": 2.2, "words": 2}]
    assert r["fixes"] == []


def test_a_line_moved_by_more_than_a_frame_is_a_retime(app, monkeypatch):
    srt = make_run(app, [W[:2], W[2:]])
    premiere(monkeypatch, srt, [(0.03, 0.9, "Здравей свят."), (1.7, 2.3, "Днес правим")])      # 0.03 s < one frame at 25 fps
    r = one()
    assert r["counts"] == {"retime": 1}
    assert r["retimes"] == [{"caption": 1, "start": pytest.approx(0.2), "end": pytest.approx(0.1)}]


def test_a_one_word_fix_is_a_pair_with_its_neighbours(app, monkeypatch):
    srt = make_run(app, [W])
    premiere(monkeypatch, srt, [(0.0, 0.9, "Здравей свят."), (1.5, 2.2, "Днес правят")])
    r = one()
    assert r["counts"] == {"split": 1, "fix": 1}
    assert r["fixes"] == [{"heard": "правим", "said": "правят", "heard_raw": "правим", "said_raw": "правят", "said_caps": False, "left": "днес", "right": "", "example": "Здравей свят. Днес правим", "caption": 0}]


def test_a_case_or_punctuation_change_is_not_a_fix(app, monkeypatch):
    srt = make_run(app, [W[:2]])
    premiere(monkeypatch, srt, [(0.0, 0.9, "ЗДРАВЕЙ, СВЯТ")])
    r = one()
    assert r["counts"] == {} and r["fixes"] == [] and r["words_changed"] == 0


def test_a_rewritten_sentence_is_counted_never_a_fix(app, monkeypatch):
    words = [(f"дума{i}", i * 0.5, i * 0.5 + 0.4) for i in range(12)]
    srt = make_run(app, [words[0:4], words[4:8], words[8:12]])
    premiere(monkeypatch, srt, [(0.0, 1.9, "дума0 дума1 дума2 дума3"), (2.0, 3.9, "дума4 дума5 дума6 дума7"),
                                (4.0, 5.9, "добре дошли приятели показваме нещо съвсем различно от всичко")])
    r = one()
    assert r["fixes"] == []                                                     # nothing for the learning to take
    assert r["counts"] == {"rewrite": 1}                                        # 4 words became 9: one rewrite, counted only
    assert r["words_changed"] >= 3


def test_a_sequence_without_a_record_is_skipped(app, monkeypatch):
    srt = make_run(app, [W])
    premiere(monkeypatch, srt, [(0.0, 2.2, "Здравей свят. Днес правим")], record=False)
    assert editlog.compare(PROJECT) == []
    assert editlog.compare_now(PROJECT)["sequences"] == 0
    assert editlog.read("local") == []                                          # nothing journalled for a sequence that is not ours


def test_a_missing_run_file_and_a_replaced_track_are_reported_not_raised(app, monkeypatch):
    premiere(monkeypatch, str(app / "gone" / "run.srt"), [(0.0, 1.0, "x")])
    assert one()["status"] == "no_run"
    srt = make_run(app, [W])
    premiere(monkeypatch, srt, [(40.0, 41.0, "съвсем друго")])                  # nothing near the run's times
    assert one()["status"] == "no_track"


def test_the_bulgarian_track_is_taken_when_an_english_track_covers_the_same_times(app, monkeypatch):
    srt = make_run(app, [W])
    en = {"index": 0, "lines": [{"start": 0.0, "end": 0.9, "text": "Hello world."}, {"start": 1.5, "end": 2.2, "text": "Today we make"}]}
    bg = {"index": 1, "lines": [{"start": 0.0, "end": 0.9, "text": "Здравей свят."}, {"start": 1.5, "end": 2.2, "text": "Днес правим"}]}
    premiere(monkeypatch, srt, [], tracks=[en, bg])
    r = one()
    assert r["track"] == 1 and r["counts"] == {"split": 1} and r["fixes"] == []


def test_the_english_track_never_wins_after_a_bulgarian_line_is_deleted_or_moved(app, monkeypatch):
    spec = [W[:2], W[2:], [("видео", 3.0, 3.4), ("за", 3.45, 3.6)]]
    srt = make_run(app, spec)
    en = {"index": 0, "lines": [{"start": 0.0, "end": 0.9, "text": "Hello world."}, {"start": 1.5, "end": 2.2, "text": "Today we make"},
                                {"start": 3.0, "end": 3.6, "text": "video for"}]}
    # the last Bulgarian line deleted and one moved: the English track (untouched) now covers more of the run's time
    bg = {"index": 1, "lines": [{"start": 0.0, "end": 0.9, "text": "Здравей свят."}, {"start": 1.6, "end": 2.3, "text": "Днес правим"}]}
    # the record's English index is a UXP track number, not prcaptions' position in a track group: it may point at the Bulgarian
    # track, at the English one, or at nothing, and nothing changes
    for english in (None, 0, 1, 7):
        premiere(monkeypatch, srt, [], tracks=[en, bg], english=english)
        r = one()
        assert r["track"] == 1 and r["counts"] == {"retime": 1, "deleted": 1, "delete": 1}, english
        assert r["fixes"] == []                                                  # nothing English leaks in as a "fix"
    premiere(monkeypatch, srt, [], tracks=[bg, en], english=0)                   # the other order, the same answer
    assert one()["track"] == 1


def test_only_an_english_track_is_no_track_never_fix_pairs(app, monkeypatch):
    srt = make_run(app, [W])
    en = {"index": 0, "lines": [{"start": 0.0, "end": 0.9, "text": "Hello world."}, {"start": 1.5, "end": 2.2, "text": "Today we make"}]}
    for english in (None, 0):
        premiere(monkeypatch, srt, [], tracks=[en], english=english)
        r = one()
        assert r["status"] == "no_track" and "fixes" not in r and "counts" not in r
    # a Bulgarian track the editor rewrote almost whole is below the floor too: reported, not compared
    rewritten = {"index": 0, "lines": [{"start": 0.0, "end": 0.9, "text": "Добре дошли приятели"}, {"start": 1.5, "end": 2.2, "text": "показваме нещо"}]}
    premiere(monkeypatch, srt, [], tracks=[rewritten])
    assert one()["status"] == "no_track"


def test_a_heavily_edited_bulgarian_track_still_passes_the_likeness_floor(app, monkeypatch):
    words = [(f"дума{i}", i * 0.5, i * 0.5 + 0.4) for i in range(20)]
    srt = make_run(app, [words[i:i + 4] for i in range(0, 20, 4)])               # 5 captions of 4 words
    lines = [(g[0][1], g[-1][2], " ".join(w for w, _, _ in g)) for g in (words[0:4], words[4:8], words[8:12])]   # 40 % deleted
    premiere(monkeypatch, srt, [(s, e, t) for s, e, t in lines])
    assert one()["status"] == "ok" and editlog.LIKENESS_FLOOR < 0.6


def test_a_fix_keeps_the_real_spelling_and_whether_the_line_is_in_capitals(app, monkeypatch):
    srt = make_run(app, [W])
    premiere(monkeypatch, srt, [(0.0, 0.9, "ЗДРАВЕЙ СВЯТ."), (1.5, 2.2, "ДНЕС ПРАВЯТ")])
    (fx,) = one()["fixes"]
    assert (fx["heard"], fx["said"]) == ("правим", "правят")
    assert (fx["heard_raw"], fx["said_raw"], fx["said_caps"]) == ("правим", "ПРАВЯТ", True)
    premiere(monkeypatch, srt, [(0.0, 0.9, "Здравей свят."), (1.5, 2.2, "Днес Правят")])
    (fx,) = one()["fixes"]
    assert (fx["said_raw"], fx["said_caps"]) == ("Правят", False)


def test_the_summary_keeps_an_earlier_good_comparison_when_a_later_one_found_no_track(app):
    editlog.log_event(PROJECT, GUID, "compare", {"status": "ok", "counts": {"split": 2}, "fixes": [], "splits": []})
    editlog.log_event(PROJECT, GUID, "compare", {"status": "no_track"})
    s = editlog.summary(PROJECT)
    assert s["compared"] == 1 and s["counts"] == {"split": 2}


def test_a_compare_equal_to_the_newest_one_adds_nothing_and_saved_is_kept(app, monkeypatch):
    srt = make_run(app, [W])
    premiere(monkeypatch, srt, [(0.0, 0.9, "Здравей свят."), (1.5, 2.2, "Днес правим")])
    assert editlog.compare_now(PROJECT, True) == {"client": "local", "sequences": 1, "written": 1, "unchanged": 0}
    for saved in (True, False, "skipped", None):                                  # nothing changed: `saved` is not a finding
        assert editlog.compare_now(PROJECT, saved)["unchanged"] == 1
    assert len([e for e in editlog.read("local") if e["kind"] == "compare"]) == 1  # an unsaved compare never follows a saved one
    premiere(monkeypatch, srt, [(0.0, 2.2, "Здравей свят. Днес правим")])
    assert editlog.compare_now(PROJECT, False)["written"] == 1                    # a real change
    assert [e["data"]["saved"] for e in editlog.read("local") if e["kind"] == "compare"] == [True, False]
    assert editlog.queue_compare(PROJECT, "skipped")["queued"] == 1 and editlog.queue_compare(PROJECT, "x")["queued"] == 1
    editlog.wait()


def test_the_record_check_reads_captions_json_read_only(app):
    assert editlog.has_record(PROJECT) is False and editlog.has_record("") is False
    d = app / "app"
    d.mkdir(parents=True, exist_ok=True)
    (d / "captions.json").write_text(json.dumps({os.path.normcase(PROJECT) + "|guid:" + GUID: {"index": 0, "count": 1},
                                                  "/p/Other.prproj|Seq name": {"index": 0, "count": 1}}), encoding="utf-8")
    assert editlog.has_record(PROJECT) is True
    assert editlog.has_record("/p/Other.prproj") is False                          # an old record under a name is not a guid record
    assert editlog.has_record("/p/Third.prproj") is False


def test_a_malformed_typed_is_no_pairs_and_never_an_error():
    for bad in ({"pairs": 5}, {"pairs": "x"}, {"pairs": [1, None, {"heard": "a"}]}, [], "x", None, {"pairs": None, "lines": "n"}):
        assert editlog.apply_data(bad) is None
    assert editlog.apply_data({"pairs": [{"heard": "a", "said": "б"}, 7], "lines": "n", "english": True}) == {
        "pairs": [{"heard": "a", "said": "б"}], "lines": 0, "english": 0}


def test_a_second_compare_is_appended_and_the_newest_wins(app, monkeypatch):
    srt = make_run(app, [W])
    premiere(monkeypatch, srt, [(0.0, 0.9, "Здравей свят."), (1.5, 2.2, "Днес правим")])
    editlog.log_event(PROJECT, GUID, "placed", {"lines": 1})
    assert editlog.compare_now(PROJECT)["written"] == 1
    premiere(monkeypatch, srt, [(0.0, 2.2, "Здравей свят. Днес правим")])
    editlog.compare_now(PROJECT)
    events = [e for e in editlog.read("local") if e["kind"] == "compare"]
    assert len(events) == 2                                                     # the journal keeps both
    (newest,) = editlog.newest_compares(PROJECT).values()
    assert newest["data"]["counts"] == {} and newest["t"] == max(e["t"] for e in events)
    assert events[0]["data"]["counts"] == {"split": 1}
    assert events[0]["data"]["minutes_since_placed"] is not None                # the time between placing and the export
    assert newest["project"] == learning.project_id(PROJECT) and newest["sequence"] == GUID


def test_every_kind_is_written_once_per_action_and_an_unknown_one_is_refused(app):
    for kind in editlog.KINDS:
        assert editlog.log_event(PROJECT, GUID, kind, {"n": 1}) is not None
    events = editlog.read("local")
    assert [e["kind"] for e in events] == list(editlog.KINDS)
    ev = events[0]
    assert set(ev) == {"v", "id", "t", "computer", "name", "project", "sequence", "client", "kind", "data"}
    assert ev["client"] == "local" and ev["computer"] == learning.computer()["id"]
    assert PROJECT not in json.dumps(events)                                    # the project's id, never its path
    with pytest.raises(ValueError):
        editlog.log_event(PROJECT, GUID, "something_else", {})
    assert len(editlog.read("local")) == len(editlog.KINDS)
    with pytest.raises(ValueError):                                             # the panel posts only its own kinds
        editlog.post_event(PROJECT, GUID, "run", {})
    assert editlog.post_event(PROJECT, GUID, "move_off_faces", {"moved": 3}) == {"logged": True}
    with pytest.raises(ValueError):
        editlog.post_event(PROJECT, GUID, "placed", {"x": "y" * 30000})


def test_a_write_error_is_logged_and_never_raised(app, monkeypatch):
    blocker = app / "app" / "learning"
    blocker.mkdir(parents=True)
    (blocker / "subtitles").write_text("not a folder", encoding="utf-8")        # the journal's folder cannot be made
    assert editlog.log_event(PROJECT, GUID, "run", {"status": "done"}) is None
    editlog.log_run({"preset": "auto", "project": PROJECT, "name": "S"}, {"preset": "gstroy"})   # no exception either
    assert editlog.post_event(PROJECT, GUID, "placed", {}) == {"logged": False}
    assert editlog.read("local") == []


def test_the_run_event_holds_the_settings_as_chosen_and_what_came_out(app):
    body = {"preset": "auto", "max_words": 3, "case": "upper", "line_break": True, "colour": "#ffcc00", "english": True,
            "again": True, "project": PROJECT, "name": "Seq", "guid": GUID, "text": "раф => рафт\nГ-н Иванов",
            "items": [{"start": 0, "end": 10.5}, {"start": 20, "end": 24}]}
    result = {"preset": "credissimo", "counts": {"captions": 40, "words": 120, "flagged": 2}, "timing": {"method": "aligned", "aligned": 110, "weak": 3},
              "asr_seconds": 12.5, "cached": False, "review": [{}, {}, {}], "readings": {"seconds": 14.3},
              "learning": {"rules": 4, "used": [{}, {}], "vetoed": [{}]}, "corrections": [{"heard": "раф", "said": "рафт", "applied": 2}],
              "recognizer": {"name": "ElevenLabs Scribe v3", "local": 0}}
    editlog.log_run(body, result)
    editlog.log_run({**body, "again": False}, status="failed", reason="Unexpected error: boom")
    first, second = editlog.read("local")
    d = first["data"]
    assert first["sequence"] == GUID and d["status"] == "done" and d["again"] is True
    assert d["settings"] == {"preset": "auto", "resolved": "credissimo", "max_words": 3, "case": "upper", "line_break": True,
                             "colour": "#FFCC00", "english": True}
    assert d["clips"] == 2 and d["clip_seconds"] == 14.5 and d["speech_seconds"] == 14.3 and d["captions"] == 40
    assert d["review"] == 3 and d["learned"] == {"used": 2, "refused": 1, "rules": 4} and d["typed"]["pairs"] == 1
    assert d["corrections"] == [{"heard": "раф", "said": "рафт", "applied": 2}] and d["recognizer"].startswith("ElevenLabs")
    assert second["data"]["status"] == "failed" and second["data"]["reason"] == "Unexpected error: boom" and "captions" not in second["data"]
    # ReShape ignores Max words, Case and Line break: the log says what ran
    editlog.log_run({**body, "preset": "reshape"})
    assert editlog.read("local")[-1]["data"]["settings"]["max_words"] is None
    assert editlog.read("local")[-1]["data"]["settings"]["line_break"] is False


def test_the_summary_counts_the_last_run_of_a_sequence_and_the_fixes_in_distinct_videos(app, monkeypatch):
    def run(preset, project=PROJECT, seq=GUID):
        editlog.log_run({"preset": preset, "project": project, "name": seq, "guid": seq, "max_words": 2})
    run("gstroy")
    run("aula")                                                                 # the same sequence tried again: only this one counts
    run("aula", project="/p/Some Client/OTHER.prproj", seq="B")
    fix = {"heard": "правим", "said": "правят", "left": "", "right": "", "example": "x", "caption": 0}
    for proj, seq in ((PROJECT, GUID), (PROJECT, GUID), ("/p/Some Client/OTHER.prproj", "B")):      # the same video compared twice
        editlog.log_event(proj, seq, "compare", {"status": "ok", "counts": {"split": 1, "fix": 1}, "fixes": [fix],
                                                   "splits": [{"caption": 0, "lines": 2, "cuts": [{"cause": "sentence_end"}, {"cause": "none"}]}]})
    s = editlog.summary(PROJECT)
    assert s["runs"] == 2 and s["settings"]["preset"] == {"aula": 2} and s["settings"]["max_words"] == {"2": 2}
    assert s["compared"] == 2 and s["counts"] == {"split": 2, "fix": 2}
    assert s["splits"] == {"sentence_end": 2, "none": 2}
    (row,) = s["fixes"]
    assert row["heard"] == "правим" and row["said"] == "правят" and row["count"] == 2 and row["videos"] == 2
    assert s["events"]["run"] == 3 and s["events"]["compare"] == 3


def test_queue_returns_at_once_and_the_worker_writes(app, monkeypatch):
    srt = make_run(app, [W])
    premiere(monkeypatch, srt, [(0.0, 0.9, "Здравей свят."), (1.5, 2.2, "Днес правим")])
    assert editlog.queue_compare(PROJECT)["queued"] == 1
    editlog.wait()
    assert editlog.status()["pending"] == 0 and editlog.status()["last"]["written"] == 1
    assert [e["kind"] for e in editlog.read("local")] == ["compare"]
    with pytest.raises(ValueError):
        editlog.queue_compare("")


def test_nothing_is_written_outside_the_app_folder(app, monkeypatch):
    seen = []
    real_open = open

    def watching(path, mode="r", *a, **k):
        if isinstance(path, str) and any(m in mode for m in "wax") and not path.startswith(str(app)):
            seen.append(path)
        return real_open(path, mode, *a, **k)
    monkeypatch.setattr("builtins.open", watching)
    editlog.log_event(PROJECT, GUID, "run", {})
    assert seen == []
