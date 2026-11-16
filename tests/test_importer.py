"""Smart Folder Sync: completion detection, categories, one folder = one project, no duplicates."""
import os
import subprocess
import time

import numpy as np
import pytest

import synth
from asistent import importer as I


def wav(path, seconds, tags=None):
    sr = 48000
    t = np.arange(int(seconds * sr)) / sr
    synth.write_wav(path, [(0.2 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)])
    if tags:
        tmp = str(path) + ".tmp.wav"
        args = sum([["-metadata", f"{k}={v}"] for k, v in tags.items()], [])
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), *args, "-c", "copy", tmp], check=True)
        os.replace(tmp, path)
    return str(path)


def video(path, alpha=False):
    if alpha:
        cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red@0.5:s=64x64:d=1,format=yuva444p10le",
               "-c:v", "prores_ks", "-profile:v", "4444", str(path)]
    else:
        cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=64x64:d=1", "-c:v", "libx264", str(path)]
    subprocess.run(cmd, check=True)
    return str(path)


def png(path):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=32x32", "-frames:v", "1",
                    str(path)], check=True)
    return str(path)


# ---------------------------------------------------------------- categories

def cat(path, root=None):
    return I.classify(path, root, I._probe(path))[0]


def test_categories(tmp_path):
    assert cat(wav(tmp_path / "Whoosh Fast 03.wav", 1.5)) == "SFX"
    assert cat(wav(tmp_path / "ES_Something.wav", 2.0)) == "SFX"                       # short
    assert cat(wav(tmp_path / "Night Drive - Some Artist.wav", 95, {"artist": "X"})) == "MUSIC"
    assert cat(wav(tmp_path / "ambient bed.wav", 30)) == "OTHER"                        # cannot tell
    assert cat(wav(tmp_path / "upbeat music 120bpm.wav", 30)) == "MUSIC"
    assert cat(video(tmp_path / "city_drone.mp4")) == "BROLL"
    assert cat(video(tmp_path / "flare.mov", alpha=True)) == "GRAPHICS"
    assert cat(video(tmp_path / "lower third red.mp4")) == "GRAPHICS"
    assert cat(png(tmp_path / "photo.png")) == "IMAGES"
    assert cat(png(tmp_path / "client logo.png")) == "GRAPHICS"


def test_folder_beats_everything(tmp_path):
    os.makedirs(tmp_path / "SFX")
    assert I.classify(wav(tmp_path / "SFX" / "long thing.wav", 70), str(tmp_path), None)[0] == "SFX"


def test_temp_names():
    for n in ["a.mp4.crdownload", "a.mp3.part", "x.download/a.mp4", ".DS_Store", "~$doc.wav", "a.wav.tmp"]:
        assert I.is_temp("/d/" + n), n
    assert not I.is_temp("/d/a.mp4")


# ---------------------------------------------------------------- watcher

@pytest.fixture
def setup(tmp_path):
    folder = tmp_path / "Downloads"
    folder.mkdir()
    store = I.Store(str(tmp_path / "import.json"))
    store.bind(str(folder), "/projects/A.prproj")
    w = I.Watcher(store)
    return folder, store, w


def settle(w, path=None, rounds=3):
    """Run the checker as if time passed (no real waiting)."""
    if path:
        w.touch(str(path))
    now = time.time()
    for k in range(rounds):
        w.check(now + k * (I.STABLE_SECONDS + 0.1))


def test_chrome_download_is_queued_only_after_rename(setup):
    folder, store, w = setup
    part = folder / "download.wav.crdownload"
    wav(str(part) + ".wav", 2)
    os.rename(str(part) + ".wav", part)
    settle(w, part)
    assert store.queue("/projects/A.prproj") == []
    final = folder / "download.wav"
    os.rename(part, final)
    settle(w, final)
    q = store.queue("/projects/A.prproj")
    assert [i["name"] for i in q] == ["download.wav"] and q[0]["category"] == "SFX"


def test_firefox_placeholder_waits_for_part(setup):
    folder, store, w = setup
    final = folder / "clip.mp4"
    final.write_bytes(b"")                             # Firefox: empty final name ...
    os.rename(video(str(final) + ".tmp.mp4"), str(final) + ".part")   # ... while the data goes into .part
    settle(w, final)
    assert store.queue("/projects/A.prproj") == []
    os.replace(str(final) + ".part", final)
    settle(w, final)
    assert [i["category"] for i in store.queue("/projects/A.prproj")] == ["BROLL"]


def test_growing_file_waits(setup):
    folder, store, w = setup
    path = folder / "big.wav"
    wav(path, 2)
    w.touch(str(path))
    t = time.time()
    w.check(t)
    with open(path, "ab") as f:                         # still being written
        f.write(b"\0" * 1000)
    w.check(t + 3)
    assert store.queue("/projects/A.prproj") == []      # size changed: the clock starts again
    w.check(t + 6)
    assert len(store.queue("/projects/A.prproj")) == 1


def test_no_duplicates_and_restart(setup, tmp_path):
    folder, store, w = setup
    path = wav(folder / "hit.wav", 1)
    settle(w, path)
    settle(w, path)
    assert len(store.queue("/projects/A.prproj")) == 1
    store2 = I.Store(str(tmp_path / "import.json"))     # engine restarted
    w2 = I.Watcher(store2)
    settle(w2, path)
    assert len(store2.queue("/projects/A.prproj")) == 1


def test_files_from_before_switching_on_are_ignored(tmp_path):
    folder = tmp_path / "dl"
    folder.mkdir()
    old = wav(folder / "old.wav", 1)
    os.utime(old, (time.time() - 3600, time.time() - 3600))
    store = I.Store(str(tmp_path / "s.json"))
    store.bind(str(folder), "/p/A.prproj")
    w = I.Watcher(store)
    w.catch_up(str(folder))
    settle(w)
    assert store.queue("/p/A.prproj") == []


def test_one_folder_one_project(setup):
    folder, store, w = setup
    info = store.bind(str(folder), "/projects/B.prproj")     # switched on in another project
    assert info["previous_project"] == "/projects/A.prproj"
    path = wav(folder / "x.wav", 1)
    settle(w, path)
    assert store.queue("/projects/A.prproj") == []
    assert len(store.queue("/projects/B.prproj")) == 1


def test_switched_off_folder_is_not_queued(setup):
    folder, store, w = setup
    store.unbind("/projects/A.prproj")
    settle(w, wav(folder / "y.wav", 1))
    assert store.queue("/projects/A.prproj") == []


def test_result_marks_imported_and_gives_up_after_three_failures(setup):
    folder, store, w = setup
    settle(w, wav(folder / "z.wav", 1))
    item = store.queue("/projects/A.prproj")[0]
    for _ in range(3):
        store.result(item["id"], False, "boom")
    assert store.queue("/projects/A.prproj") == [] and store.recent("/projects/A.prproj")[0]["state"] == "failed"


def test_real_watchdog_end_to_end(tmp_path, monkeypatch):
    folder = tmp_path / "dl"
    folder.mkdir()
    store = I.Store(str(tmp_path / "s.json"))
    store.bind(str(folder), "/p/A.prproj")
    w = I.Watcher(store)
    w.start()
    try:
        tmp = folder / "loop.wav.crdownload"
        os.rename(wav(str(tmp) + ".wav", 3), tmp)
        os.rename(tmp, folder / "loop.wav")
        for _ in range(40):
            if store.queue("/p/A.prproj"):
                break
            time.sleep(0.25)
        assert [i["name"] for i in store.queue("/p/A.prproj")] == ["loop.wav"]
    finally:
        w.stop()


def test_one_project_one_folder(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir()
    b.mkdir()
    store = I.Store(str(tmp_path / "s.json"))
    store.bind(str(a), "/p/A.prproj")
    store.bind(str(b), "/p/A.prproj")                   # the editor picked another folder
    w = I.Watcher(store)
    settle(w, wav(a / "old_folder.wav", 1))
    settle(w, wav(b / "new_folder.wav", 1))
    assert [i["name"] for i in store.queue("/p/A.prproj")] == ["new_folder.wav"]


def test_renamed_download_is_ready_fast(setup):
    folder, store, w = setup
    path = wav(folder / "fast.wav", 1)
    w.touch(str(path), moved=True)
    t = time.time()
    w.check(t)
    w.check(t + I.MOVED_STABLE + 0.05)
    assert len(store.queue("/projects/A.prproj")) == 1


def test_copied_file_still_waits_longer(setup):
    folder, store, w = setup
    path = wav(folder / "copied.wav", 1)
    w.touch(str(path))
    t = time.time()
    w.check(t)
    w.check(t + I.MOVED_STABLE + 0.05)
    assert store.queue("/projects/A.prproj") == []
    w.check(t + I.STABLE_SECONDS + 0.05)
    assert len(store.queue("/projects/A.prproj")) == 1


def test_waiting_request_wakes_up_on_new_file(setup):
    import threading
    folder, store, w = setup
    got = {}

    def waiter():
        t = time.time()
        got["q"] = store.wait_queue("/projects/A.prproj", 5)
        got["after"] = time.time() - t

    th = threading.Thread(target=waiter)
    th.start()
    time.sleep(0.3)
    path = wav(folder / "late.wav", 1)
    w.touch(str(path), moved=True)
    t = time.time()
    w.check(t)
    w.check(t + I.MOVED_STABLE + 0.05)
    th.join(3)
    assert len(got["q"]) == 1 and got["after"] < 2


def test_a_dropped_file_is_refused_with_what_to_drop_instead(tmp_path):
    """0.10.67: a folder dropped on the Auto import row is bound; a file dropped there says to drop its folder."""
    store = I.Store(str(tmp_path / "import.json"))
    folder = tmp_path / "Footage day 2"
    folder.mkdir()
    (folder / "clip.mp4").write_bytes(b"x")
    assert store.bind(str(folder), "/p/a.prproj")["folder"] == str(folder)
    with pytest.raises(ValueError, match="drop the folder it is in"):
        store.bind(str(folder / "clip.mp4"), "/p/a.prproj")


def test_files_deep_inside_a_watched_folder_or_in_a_repository_are_not_downloads(tmp_path):
    """0.10.70: Downloads watched for NEW TEST imported 928 screenshots written deep inside the Content Studio vault (a git
    repository 7 folders down). A download is at most MAX_DEPTH folders below the watched folder and never in a repository."""
    top = str(tmp_path)
    assert I.wanted(os.path.join(top, "clip.mp4"), top)
    assert I.wanted(os.path.join(top, "Footage", "Day 1", "Cam A", "clip.mp4"), top)                 # an unzipped shoot
    assert not I.wanted(os.path.join(top, "a", "b", "c", "d", "clip.mp4"), top)                      # deeper than a download
    repo = tmp_path / "Vault" / "tool"
    (repo / ".git").mkdir(parents=True)
    (repo / "shots").mkdir()
    assert not I.wanted(str(repo / "shots" / "x.png"), top)                                           # inside a repository
    assert not I.wanted(os.path.join(top, "node_modules", "x.png"), top)
    cache = {}
    assert not I.wanted(str(repo / "y.png"), top, cache) and cache                                     # remembered per folder


def test_catch_up_skips_repositories_and_deep_folders(tmp_path):
    store = I.Store(str(tmp_path / "import.json"))
    dl = tmp_path / "Downloads"
    (dl / "shoot" / "day").mkdir(parents=True)
    (dl / "repo" / ".git").mkdir(parents=True)
    store.bind(str(dl), "/p/a.prproj")
    store.data["bindings"][str(dl)]["since"] = 0
    seen = []
    w = I.Watcher(store)
    w.watched[str(dl)] = object()
    w.settle.touch = lambda p, moved=False: seen.append(os.path.relpath(p, dl))
    for rel in ("a.mp4", "shoot/day/b.mov", "repo/c.png", "shoot/day/1/2/deep.mp4"):
        f = dl / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x")
    w.catch_up(str(dl))
    assert sorted(seen) == ["a.mp4", os.path.join("shoot", "day", "b.mov")]


# ---------------------------------------------------------------- 0.10.113: on by default, the project's own folder

def test_a_new_project_watches_its_own_folder_until_switched_off(tmp_path):
    # the user (2026-11-15): Auto import "automatically on", linked to "the folder where the project is saved"
    folder = tmp_path / "Client X"
    folder.mkdir()
    project = folder / "Edit.prproj"
    project.write_text("x")
    store = I.Store(str(tmp_path / "import.json"))
    info = store.auto_bind(str(project))
    assert info and info["folder"] == str(folder)
    assert store.binding_for(str(project))[1]["enabled"]
    assert store.auto_bind(str(project)) is None                  # already watching: nothing changes
    store.unbind(str(project))                                    # the editor switched it off: it stays off
    assert store.auto_bind(str(project)) is None and not store.binding_for(str(project))[1]["enabled"]
    # another project in the same folder takes the folder over; the first one is still off when it is opened again
    other = folder / "Other.prproj"
    other.write_text("x")
    assert store.auto_bind(str(other))["folder"] == str(folder)
    assert store.binding_for(str(project)) is None and store.auto_bind(str(project)) is None
    store.bind(str(folder), str(project))                         # switched on by hand: no longer "off"
    assert not store.switched_off(str(project))
    assert store.auto_bind("") is None and store.auto_bind(str(tmp_path / "missing.prproj")) is None


def test_premieres_and_asistents_working_folders_are_not_downloads(tmp_path):
    top = str(tmp_path)
    for sub in ("Adobe Premiere Pro Video Previews", "Adobe Premiere Pro Auto-Save", "Asistent_roughcut", "Media Cache Files"):
        assert not I.wanted(os.path.join(top, sub, "a.mov"), top), sub
    assert I.wanted(os.path.join(top, "Assets", "SFX", "whoosh.wav"), top)


def test_an_export_into_the_watched_folder_is_not_imported(tmp_path):
    folder = tmp_path / "Client X"
    folder.mkdir()
    store = I.Store(str(tmp_path / "import.json"))
    store.bind(str(folder), "/projects/A.prproj")
    export = str(folder / "EDIT_V1.mp4")
    w = I.Watcher(store, exported=lambda p: p == export)
    settle(w, video(export))
    settle(w, wav(folder / "music.wav", 1, {"artist": "x"}))
    assert [i["name"] for i in store.queue("/projects/A.prproj")] == ["music.wav"]
    skipped = [i for i in store.recent("/projects/A.prproj") if i["state"] == "skipped"]
    assert [i["name"] for i in skipped] == ["EDIT_V1.mp4"] and "export" in skipped[0]["note"]


def test_premieres_recovery_copy_never_gets_a_folder(tmp_path):
    # seen 2026-11-15: while Premiere auto-saves, the open project reads for a moment as its recovery copy
    rec = tmp_path / "Projects" / "Adobe Premiere Pro Auto-Save" / "RecoveryProjects"
    rec.mkdir(parents=True)
    copy = rec / "NEW TEST--8f4f.prproj"
    copy.write_text("x")
    store = I.Store(str(tmp_path / "import.json"))
    assert store.auto_bind(str(copy)) is None
    # a binding an earlier version made for such a copy is dropped when the store loads
    store.bind(str(rec), str(copy))
    assert I.Store(str(tmp_path / "import.json")).binding_for(str(copy)) is None
    import json
    assert not json.loads((tmp_path / "import.json").read_text(encoding="utf-8"))["bindings"]   # and written back to disk
