"""Show the exported file in Finder / Explorer (exports.py, reveal.py): only finished new exports in watched folders,
a queue shows only its last file, nothing while the setting is off, and showing never takes a path from a request."""
import os
import subprocess
import time

import pytest

from asistent import exports as E
from asistent import reveal
from test_importer import video, wav


@pytest.fixture(autouse=True)
def no_premiere_prefs(monkeypatch):
    """The tests never read this Mac's real Premiere preferences (they would start watching the office drive)."""
    monkeypatch.setattr(E, "prefs_files", lambda: [])


CHECKED = []


@pytest.fixture(autouse=True)
def quick_filecheck(monkeypatch):
    """The after-export check is tested in test_filecheck.py; here it only records what it was asked to check."""
    CHECKED.clear()
    monkeypatch.setattr(E.filecheck, "run", lambda path, expect=None, cancelled=None:
                        CHECKED.append((path, expect)) or {"status": "fine", "summary": "fine", "lines": []})


def wait_checked(w, n=1, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if len(CHECKED) >= n and all((i.get("check") or {}).get("status") not in ("waiting", "running") for i in w.recent()):
            return
        time.sleep(0.02)
    raise AssertionError("the after-export check did not run")


PREFS = """<?xml version="1.0" encoding="UTF-8"?>
<PremiereData Version="3">
<MZ.Prefs.Export.Media.Path>{folder}/
</MZ.Prefs.Export.Media.Path>
<ExportSettings.Info.Vimeo>{{"DoExport":false,"OutPath":"/elsewhere/x_Vimeo.x"}}
</ExportSettings.Info.Vimeo>
<ExportSettings.Info.SaveAsFile>{{"DoExport":true,"OutPath":"{file}","Range":4}}
</ExportSettings.Info.SaveAsFile>
</PremiereData>
"""


def prefs(path, folder, file):
    path.write_text(PREFS.format(folder=folder, file=file), encoding="utf-8")
    t = time.time() + 1                                   # a new stamp even within the same second
    os.utime(path, (t, t))


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(E.config, "app_dir", lambda: str(tmp_path / "appdata"))
    project_dir = tmp_path / "Project"
    project_dir.mkdir()
    settings = E.Settings(str(tmp_path / "exports.json"))
    settings.data.update(enabled=True, project=str(project_dir / "A.prproj"))
    shown = []
    w = E.ExportWatcher(settings, show=shown.append)
    w.since[str(project_dir)] = time.time() - 1          # watching, without the file events (the scan finds files)
    return project_dir, w, shown


def run(w, start, seconds, step=0.5):
    """The checker as if `seconds` passed (no real waiting)."""
    t = start
    while t <= start + seconds:
        w.check(t)
        t += step
    return t


def test_a_finished_export_is_shown_once_after_the_quiet_time(setup):
    folder, w, shown = setup
    out = video(folder / "Video 7.mp4")
    t = time.time()
    run(w, t, E.STABLE + 1)
    assert shown == []                                   # finished, but a queue may still follow
    run(w, t + E.STABLE + 1.5, E.QUIET + 1)
    assert shown == [out]
    run(w, t + 30, 10)
    assert shown == [out]                                # never twice
    assert w.recent()[0]["shown"] and w.recent()[0]["name"] == "Video 7.mp4"


def test_a_queue_shows_only_its_last_export(setup):
    folder, w, shown = setup
    t = time.time()
    video(folder / "a.mp4")
    t = run(w, t, E.STABLE + 1)
    video(folder / "b.mp4")                              # the next job of the queue, 2 s later
    t = run(w, t, 2)
    third = wav(folder / "c.wav", 1)                     # audio-only exports count too
    run(w, t, E.STABLE + E.QUIET + 3)
    assert shown == [third]
    notes = {i["name"]: i for i in w.recent()}
    assert set(notes) == {"a.mp4", "b.mp4", "c.wav"}
    assert not notes["a.mp4"]["shown"] and "queue" in notes["a.mp4"]["note"]


def test_nothing_is_shown_while_another_export_is_still_being_written(setup):
    folder, w, shown = setup
    video(folder / "done.mp4")
    growing = folder / "growing.mp4"
    growing.write_bytes(b"\0" * 1000)
    t = time.time()
    for k in range(30):                                  # 15 s: done.mp4 finished long ago, growing.mp4 keeps growing
        with open(growing, "ab") as f:
            f.write(b"\0" * 1000)
        w.check(t + k * 0.5)
    assert shown == []
    growing.unlink()                                     # cancelled and removed by the encoder
    run(w, t + 15, E.QUIET + 1)
    assert [os.path.basename(p) for p in shown] == ["done.mp4"]


def test_a_cancelled_export_is_never_shown(setup):
    folder, w, shown = setup
    whole = (folder / "x.mp4")
    video(whole)
    data = whole.read_bytes()
    cut = folder / "cancelled.mp4"
    cut.write_bytes(data[: len(data) // 2])              # the index (written last) is missing
    whole.unlink()
    run(w, time.time(), E.STABLE * (E.MAX_TRIES + 2) + E.QUIET)
    assert shown == [] and w.recent() == []


@pytest.mark.parametrize("rel", [
    "Adobe Premiere Pro Video Previews/A.PRV/render.mov", "Adobe Premiere Pro Auto-Save/a.mp4",
    "Media Cache Files/a.mp4", "export.mp4.tmp", ".hidden.mp4", "notes.txt",
])
def test_previews_auto_save_cache_and_temp_files_are_ignored(setup, rel):
    folder, w, shown = setup
    path = folder / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    video(str(path) + ".mov")
    os.rename(str(path) + ".mov", path)
    run(w, time.time(), E.STABLE + E.QUIET + 3)
    assert shown == []


def test_asistents_own_data_folder_is_ignored(setup, tmp_path):
    assert E.ignored(str(tmp_path / "appdata" / "frames" / "a.mp4"))
    assert not E.ignored(str(tmp_path / "Exports" / "a.mp4"))


def test_a_file_older_than_watching_is_not_an_export(setup):
    folder, w, shown = setup
    old = video(folder / "old.mp4")
    os.utime(old, (time.time() - 3600, time.time() - 3600))
    run(w, time.time(), E.STABLE + E.QUIET + 3)
    assert shown == []


def test_off_means_nothing_is_watched_and_events_are_not_counted(tmp_path, monkeypatch):
    monkeypatch.setattr(E.config, "app_dir", lambda: str(tmp_path / "appdata"))
    (tmp_path / "P").mkdir()
    shown = []
    w = E.ExportWatcher(E.Settings(str(tmp_path / "e.json")), show=shown.append)
    st = w.configure(project=str(tmp_path / "P" / "A.prproj"), check=False)          # showing AND checking off
    assert st["enabled"] is False and st["check"] is False and w.observer is None and st["watching"] == []
    path = video(tmp_path / "P" / "a.mp4")
    assert w.done(path)["counted"] is False


def test_settings_folders_project_added_learned(tmp_path):
    s = E.Settings(str(tmp_path / "e.json"))
    (tmp_path / "P").mkdir()
    (tmp_path / "Exports").mkdir()
    project = str(tmp_path / "P" / "A.prproj")
    s.data["project"] = project
    assert s.add(project, str(tmp_path / "Exports"))
    assert not s.add(project, str(tmp_path / "Exports"))          # once
    with pytest.raises(ValueError):
        s.add(project, str(tmp_path / "missing"))
    assert [(f["why"], os.path.basename(f["path"])) for f in s.folders()] == [("added", "Exports")]   # not the project's own
    s.remove(project, str(tmp_path / "Exports"))
    assert E.Settings(str(tmp_path / "e.json")).folders(project) == []


def test_an_event_path_in_a_new_folder_is_learned_and_shown(setup, tmp_path):
    folder, w, shown = setup
    other = tmp_path / "Desktop exports"
    other.mkdir()
    out = video(other / "final.mp4")
    try:
        assert w.done(out, "complete", "panel")["counted"]
        assert str(other) in [f["path"] for f in w.status()["folders"] if f["why"] == "learned"]
        run(w, time.time(), E.QUIET + 3)
        assert shown == [out] and w.recent()[0]["how"] == "event"
    finally:
        w.configure(enabled=False, check=False)
    assert w.observer is None


def test_showing_again_takes_only_a_recorded_id(setup):
    folder, w, shown = setup
    out = video(folder / "a.mp4")
    run(w, time.time(), E.STABLE + E.QUIET + 3)
    item = w.recent()[0]
    w.again(item["id"])
    assert shown == [out, out]
    with pytest.raises(ValueError):
        w.again(out)                                     # a path is not an id
    os.remove(out)
    w.show = reveal.reveal
    with pytest.raises(ValueError, match="not there any more"):
        w.again(item["id"])


def test_reveal_commands(monkeypatch, tmp_path):
    assert reveal.command("/a b/x.mp4", "darwin") == ["open", "-R", "/a b/x.mp4"]
    assert reveal.command("C:/Exports/x y.mp4", "win32") == ["explorer.exe", "/select,", "C:\\Exports\\x y.mp4"]
    with pytest.raises(OSError):
        reveal.command("/x.mp4", "linux")
    calls = []
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **kw: calls.append(cmd))
    monkeypatch.setattr(reveal.sys, "platform", "darwin")
    f = tmp_path / "x.mp4"
    f.write_bytes(b"1")
    reveal.reveal(str(f))
    assert calls == [["open", "-R", str(f)]]
    with pytest.raises(FileNotFoundError):
        reveal.reveal(str(tmp_path / "missing.mp4"))


def test_real_watchdog_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setattr(E.config, "app_dir", lambda: str(tmp_path / "appdata"))
    monkeypatch.setattr(E, "STABLE", 0.5)
    monkeypatch.setattr(E, "QUIET", 0.5)
    monkeypatch.setattr(E, "SCAN_EVERY", 999)            # the file event alone must find it
    project = tmp_path / "P"
    project.mkdir()
    (tmp_path / "Exports").mkdir()
    shown = []
    w = E.ExportWatcher(E.Settings(str(tmp_path / "e.json")), show=shown.append)
    w.configure(project=str(project / "A.prproj"), enabled=True, add=str(tmp_path / "Exports"))
    try:
        out = video(tmp_path / "Exports" / "final.mp4")
        for _ in range(60):
            if shown:
                break
            time.sleep(0.25)
        assert shown == [out]
    finally:
        w.configure(enabled=False, check=False)


def test_premiere_prefs_name_the_export_folder_and_file(tmp_path):
    p = tmp_path / "Adobe Premiere Pro Prefs"
    prefs(p, "/Volumes/Production/Exported Videos/Екопак/Контент план 8", "/Volumes/Production/Exported Videos/Екопак/"
          "Контент план 8/ЕКОПАК КП-8 &amp; Видео 8.mp4")
    got = E.read_prefs(p.read_text(encoding="utf-8"))
    assert got["file"] == "/Volumes/Production/Exported Videos/Екопак/Контент план 8/ЕКОПАК КП-8 & Видео 8.mp4"
    assert got["folders"] == ["/Volumes/Production/Exported Videos/Екопак/Контент план 8"]     # once, Vimeo not
    assert E.read_prefs("<PremiereData/>") == {"file": None, "folders": []}


@pytest.fixture
def office(tmp_path, monkeypatch):
    """The office layout: the project in .../Assets, exports in a separate Exported Videos tree that Premiere names."""
    monkeypatch.setattr(E.config, "app_dir", lambda: str(tmp_path / "appdata"))
    project = tmp_path / "Production" / "Client" / "Video 8" / "Assets"
    exported = tmp_path / "Production" / "Exported Videos" / "Client" / "Plan 8"
    project.mkdir(parents=True)
    exported.mkdir(parents=True)
    pf = tmp_path / "Prefs"
    prefs(pf, exported, exported / "Video 8.mp4")
    settings = E.Settings(str(tmp_path / "exports.json"))
    settings.data.update(enabled=True, project=str(project / "A.prproj"))
    shown = []
    w = E.ExportWatcher(settings, show=shown.append, premiere=E.PremierePrefs(lambda: [str(pf)]))
    w.premiere.read()
    w.observer = object()                                 # watching, without the file events (the scan finds files)
    for f in w.folders():
        w.since[f["path"]] = time.time() - 1
        if f["why"] == "premiere":
            w.flat.add(f["path"])
    w.started = time.time() - 1
    return exported, pf, w, shown


def test_an_export_into_premieres_export_folder_is_shown(office):
    exported, _, w, shown = office
    assert [f["why"] for f in w.status()["folders"]] == ["premiere"]
    out = video(exported / "Video 8.mp4")
    run(w, time.time(), E.STABLE + E.QUIET + 4)
    assert shown == [out]


def test_a_file_event_may_spell_the_folder_differently(office):
    exported, _, w, _ = office
    upper = os.path.join(str(exported).upper(), "Видео 8.mp4")
    assert w._folder(upper) == str(exported)
    assert w._folder(os.path.join(str(exported), "sub", "x.mp4")) is None


def test_only_files_directly_in_premieres_export_folder_count(office):
    exported, _, w, shown = office
    (exported / "Към клиент - компресирано").mkdir()
    video(exported / "Към клиент - компресирано" / "small.mp4")        # a compressed copy made afterwards: not an export
    run(w, time.time(), E.STABLE + E.QUIET + 4)
    assert shown == []


def test_a_file_the_prefs_name_later_is_shown_even_in_a_new_folder(office, tmp_path, monkeypatch):
    _, pf, w, shown = office
    monkeypatch.setattr(w, "refresh", lambda: None)        # no real watching in this test
    elsewhere = tmp_path / "Desktop"
    elsewhere.mkdir()
    out = video(elsewhere / "new place.mp4")
    prefs(pf, elsewhere, out)                              # Premiere rewrote its preferences after the export
    run(w, time.time(), E.LATER + E.STABLE + E.QUIET + 6)
    assert shown == [out] and w.recent()[0]["how"] == "event"
    prefs(pf, elsewhere, out)                              # rewritten again, same file: never twice
    run(w, time.time() + 30, E.LATER + E.STABLE + E.QUIET + 6)
    assert shown == [out]


def test_a_sound_downloaded_into_the_project_folder_is_not_an_export(tmp_path, monkeypatch):
    monkeypatch.setattr(E.config, "app_dir", lambda: str(tmp_path / "appdata"))
    (tmp_path / "Assets").mkdir()
    w = E.ExportWatcher(E.Settings(str(tmp_path / "e.json")))
    w.settings.data.update(enabled=True, project=str(tmp_path / "Assets" / "A.prproj"))
    assert w.folders() == []                              # the ES_*.mp3 in Assets were "shown" in 0.10.3


def test_an_older_file_of_the_same_name_is_not_the_new_export(office, monkeypatch):
    """Premiere wrote its preferences when the export started; the file it named was still the earlier export of the same
    video, about to be replaced (2026-11-05 13:53). Only the new file is shown."""
    exported, pf, w, shown = office
    monkeypatch.setattr(w, "refresh", lambda: None)
    out = exported / "Видео 7.mp4"
    video(out)
    t = time.time()
    os.utime(out, (t - 60, t - 60))                       # the earlier export (after watching started)
    w.started = t - 120
    w.since[str(exported)] = t + 999                      # the folder events do not count it: only the preferences could
    prefs(pf, exported, out)                              # stamped t + 1: the new export starts
    w.check(t)
    assert str(out) not in w.settle and str(out) in w.later
    os.remove(out)                                        # Premiere replaces it
    run(w, t, E.LATER + E.STABLE + E.QUIET + 3)
    assert shown == [] and w.later == {}


def test_a_file_named_after_its_export_ended_is_still_shown(office, monkeypatch):
    """The other order (12:38 export, 12:40 preferences): the named file is older but nothing replaces it."""
    exported, pf, w, shown = office
    monkeypatch.setattr(w, "refresh", lambda: None)
    out = video(exported / "Видео 8.mp4")
    t = time.time()
    os.utime(out, (t - 60, t - 60))
    w.started = t - 120
    w.since[str(exported)] = t + 999
    prefs(pf, exported, out)
    run(w, t, E.LATER + E.STABLE + E.QUIET + 3)
    assert shown == [out]


def test_a_file_the_prefs_name_from_before_watching_is_not_shown(office):
    exported, pf, w, shown = office
    old = video(exported / "old.mp4")
    os.utime(old, (time.time() - 3600, time.time() - 3600))
    prefs(pf, exported, old)
    run(w, time.time(), E.STABLE + E.QUIET + 6)
    assert shown == []


def test_complete_checks_the_mp4_boxes(tmp_path):
    whole = video(tmp_path / "a.mp4")
    assert E.complete(whole)
    with open(whole, "rb") as f:
        data = f.read()
    cut = tmp_path / "cut.mp4"
    cut.write_bytes(data[:-100])
    assert not E.complete(str(cut))
    open_ended = tmp_path / "open.mp4"
    open_ended.write_bytes(b"\0\0\0\x10ftypisom\0\0\0\0" + b"\0\0\0\0mdat" + b"x" * 50)
    assert not E.complete(str(open_ended))
    assert E.complete(str(tmp_path / "x.wav")) is True                 # not a boxed format: FFprobe decides


def test_a_long_export_that_pauses_often_is_still_shown(setup):
    folder, w, shown = setup
    whole = video(folder / "src.mov")
    with open(whole, "rb") as f:
        data = f.read()
    os.remove(whole)
    out = folder / "long.mov"
    t = time.time()
    step = max(1, len(data) // (E.MAX_TRIES + 3))
    for k in range(E.MAX_TRIES + 2):                       # more pauses than MAX_TRIES, each longer than STABLE
        out.write_bytes(data[: step * (k + 1)])
        t = run(w, t, E.STABLE * 2 + 1)
    assert shown == []
    out.write_bytes(data)
    run(w, t, E.STABLE * 2 + E.QUIET + 4)
    assert shown == [str(out)]


def test_the_export_folder_is_watched_once_its_drive_is_mounted(tmp_path, monkeypatch):
    """0.10.7: the engine starts at login, before the office drive is mounted. Nothing was watched until the editor
    switched projects; now the checker keeps running and starts watching the folder as soon as it exists."""
    monkeypatch.setattr(E.config, "app_dir", lambda: str(tmp_path / "appdata"))
    monkeypatch.setattr(E, "STABLE", 0.5)
    monkeypatch.setattr(E, "QUIET", 0.5)
    monkeypatch.setattr(E, "SCAN_EVERY", 0.3)
    exported = tmp_path / "Production" / "Exported Videos" / "Client" / "Plan 8"
    pf = tmp_path / "Prefs"
    prefs(pf, exported, exported / "Video 8.mp4")
    settings = E.Settings(str(tmp_path / "e.json"))
    settings.data.update(enabled=True, project=str(tmp_path / "A.prproj"))
    shown = []
    w = E.ExportWatcher(settings, show=shown.append, premiere=E.PremierePrefs(lambda: [str(pf)]))
    w.refresh()                                            # what the engine does at start
    try:
        assert w.observer is not None and w.watched == {}  # running, nothing to watch yet
        exported.mkdir(parents=True)                       # the drive is mounted
        for _ in range(40):
            if str(exported) in w.watched:
                break
            time.sleep(0.1)
        assert str(exported) in w.watched
        out = video(exported / "Video 8.mp4")
        for _ in range(60):
            if shown:
                break
            time.sleep(0.1)
        assert shown == [out]
    finally:
        w.configure(enabled=False, check=False)
    assert w.observer is None


def _ended(office, monkeypatch, tmp_path):
    """An export into a folder nobody watches yet; Premiere rewrote its preferences only after the export ended."""
    _, pf, w, shown = office
    monkeypatch.setattr(w, "refresh", lambda: None)
    elsewhere = tmp_path / "Exported Videos" / "Other client"
    elsewhere.mkdir(parents=True)
    out = video(elsewhere / "Видео 3.mp4")
    t = time.time()
    os.utime(out, (t - 2, t - 2))
    return pf, w, shown, out, elsewhere, t


def test_premieres_export_event_shows_the_export_at_once(office, monkeypatch, tmp_path):
    """0.10.7: the export-complete event makes the preferences count at once: no LATER, no settling, no quiet wait."""
    pf, w, shown, out, elsewhere, t = _ended(office, monkeypatch, tmp_path)
    prefs(pf, elsewhere, out)                              # stamped after the file
    assert w.done(None, "complete", "panel:RenderCompleteEvent")["hint"]
    end = run(w, time.time(), 1.0, step=0.25)
    assert shown == [out] and w.recent()[0]["how"] == "event"
    run(w, end, 3)                                         # read again while the hint lasts: never twice
    assert shown == [out]


def test_the_event_waits_for_preferences_written_a_moment_later(office, monkeypatch, tmp_path):
    pf, w, shown, out, elsewhere, t = _ended(office, monkeypatch, tmp_path)
    w.done(None, "complete", "panel")
    now = run(w, time.time(), 1.0, step=0.25)
    assert shown == []                                     # the preferences still name the earlier folder
    prefs(pf, elsewhere, out)
    run(w, now, 1.0, step=0.25)
    assert shown == [out]


def test_an_event_with_a_path_is_shown_without_waiting(setup, tmp_path):
    folder, w, shown = setup
    other = tmp_path / "Exports"
    other.mkdir()
    out = video(other / "final.mp4")
    try:
        w.done(out, "complete", "panel")
        run(w, time.time(), 0.5, step=0.25)
        assert shown == [out]
    finally:
        w.configure(enabled=False, check=False)


def _tree(tmp_path):
    root = tmp_path / "Production" / "Exported Videos"
    for client in ("Credissimo", "Beauty Sector", "ReShape"):
        (root / client / "Plan 1").mkdir(parents=True)
    return root


@pytest.mark.skipif(os.name == "nt", reason="no export trees on Windows (share notifications include other computers)")
def test_an_export_tree_is_learned_from_three_clients(tmp_path, monkeypatch):
    monkeypatch.setattr(E.config, "app_dir", lambda: str(tmp_path / "appdata"))
    root = _tree(tmp_path)
    s = E.Settings(str(tmp_path / "e.json"))
    s.data["recent"] = [{"id": "a", "folder": str(root / "Credissimo" / "Plan 1")},
                        {"id": "b", "folder": str(root / "Beauty Sector" / "Plan 1")}]
    assert not s.learn_roots() and s.roots() == []                  # two clients: not yet
    assert s.learn_roots([str(root / "ReShape" / "Plan 1")])        # the third (Premiere's export folder)
    assert s.roots() == [{"path": str(root), "why": "tree"}]
    assert E.Settings(str(tmp_path / "e.json")).data["roots"] == [str(root)]       # kept
    assets = tmp_path / "Production" / "Client" / "Plan 12"
    s.data["recent"] = [{"id": str(k), "folder": str(assets / f"Video {k}" / "Assets")} for k in range(2)]
    assert not s.learn_roots()                                      # two videos' Assets: not a tree


@pytest.mark.skipif(os.name == "nt", reason="no export trees on Windows")
def test_a_new_plan_folder_in_the_tree_is_caught_by_its_file_event(tmp_path, monkeypatch):
    """0.10.7: Premiere's preferences still name the last plan folder; the export goes into a new one. Seen at once
    through the file event; a deeper copy, a sound file and a scan-only find never count."""
    monkeypatch.setattr(E.config, "app_dir", lambda: str(tmp_path / "appdata"))
    monkeypatch.setattr(E, "STABLE", 0.5)
    monkeypatch.setattr(E, "QUIET", 0.5)
    root = _tree(tmp_path)
    s = E.Settings(str(tmp_path / "e.json"))
    s.data.update(enabled=True, project=str(tmp_path / "A.prproj"), roots=[str(root)])
    shown = []
    w = E.ExportWatcher(s, show=shown.append)
    assert w._folder(str(root / "X" / "Plan 2" / "a.mp4")) is None    # not watching yet
    w.refresh()
    try:
        assert str(root) in w.trees and str(root) in w.watched
        assert w._folder(str(root / "X" / "Plan 2" / "a.mp4")) == str(root)
        assert w._folder(str(root / "X" / "Plan 2" / "a.wav")) is None
        assert w._folder(str(root / "X" / "Plan 2" / "compressed" / "a.mp4")) is None
        assert w._folder(str(root / "X" / "a.mp4")) is None
        new = root / "Екопак" / "Контент план 9"
        new.mkdir(parents=True)
        out = video(new / "ЕКОПАК КП-9 - Видео 1.mp4")
        for _ in range(80):
            if shown:
                break
            time.sleep(0.1)
        assert shown == [out]
    finally:
        w.configure(enabled=False, check=False)


def test_the_tree_is_never_scanned(tmp_path, monkeypatch):
    """A file nobody's file event reported (a colleague's export on the shared drive) is not shown."""
    monkeypatch.setattr(E.config, "app_dir", lambda: str(tmp_path / "appdata"))
    root = _tree(tmp_path)
    s = E.Settings(str(tmp_path / "e.json"))
    s.data.update(enabled=True, project=str(tmp_path / "A.prproj"))
    shown = []
    w = E.ExportWatcher(s, show=shown.append)
    w.since[str(root)] = time.time() - 1
    w.trees.add(str(root))
    video(root / "Credissimo" / "Plan 1" / "colleague.mp4")
    run(w, time.time(), E.STABLE + E.QUIET + 4)
    assert shown == []


# ---------------------------------------------------------------- after-export check (0.10.39, TODO I14)

def test_checking_is_on_by_default_and_runs_after_the_export_is_shown(setup):
    folder, w, shown = setup
    assert E.Settings(str(folder / "fresh.json")).data["check"] is True
    out = video(folder / "Video 8.mp4")
    t = time.time()
    run(w, t, E.STABLE + E.QUIET + 3)
    assert shown == [out]
    wait_checked(w)
    assert CHECKED[0][0] == out and w.recent()[0]["check"]["status"] == "fine" and "took" in w.recent()[0]["check"]


def test_with_showing_off_an_export_is_still_checked_but_not_shown(setup):
    folder, w, shown = setup
    w.settings.data["enabled"] = False
    assert w.on()
    out = video(folder / "Video 9.mp4")
    run(w, time.time(), E.STABLE + E.QUIET + 3)
    wait_checked(w)
    assert shown == [] and CHECKED[0][0] == out and not w.recent()[0]["shown"]


def test_the_sequence_from_the_export_event_goes_with_the_check(setup):
    folder, w, shown = setup
    out = video(folder / "Video 10.mp4")
    seq = {"name": "Reel", "width": 1080, "height": 1920, "fps": 30, "duration": 2.0, "junk": "x"}
    assert w.done(out, "complete", "test", seq)["counted"]
    run(w, time.time(), E.QUIET + 2)
    wait_checked(w)
    assert CHECKED[0][1] == {"name": "Reel", "width": 1080, "height": 1920, "fps": 30, "duration": 2.0, "range": None}


def test_checking_off_checks_nothing(setup):
    folder, w, shown = setup
    w.settings.data["check"] = False
    out = video(folder / "Video 11.mp4")
    run(w, time.time(), E.STABLE + E.QUIET + 3)
    assert shown == [out] and CHECKED == [] and "check" not in w.recent()[0]
