"""Saved tracks (0.10.152): every finished track kept in <app>/tracks/ and opened again after a restart."""
import os
import shutil
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
sys.path.insert(0, os.path.dirname(__file__))
from asistent import config, trackstore, tracker as T  # noqa: E402
from test_server import call, engine  # noqa: E402,F401
from test_tracker import W, H, _moving_file  # noqa: E402


def _record(tid="abc123def456", path="/x/C0001.MP4", project="/p/A.prproj", n=5):
    frames = [{"t": i / 30, "x": 10 + i, "y": 20, "s": 1, "a": 0, "c": 0.9, "state": "sure" if i else "lost"} for i in range(n)]
    return {"id": tid, "name": "C0001 · 3.20 s", "project": project, "sequence": "MAIN",
            "source": {"clip": {"name": "C0001.MP4", "path": path, "track": 0, "start": 3.0, "end": 9.0, "inPt": 0, "outPt": 6,
                                "speed": 1, "kind": "video"}, "fps": 30, "step": 1 / 30, "t0": 0.1, "from": 0, "to": 6, "at": 3.2,
                       "sequence": "MAIN"},
            "track": {"frames": frames, "width": 1920, "height": 1080, "k0": 2, "total": n, "step": 1 / 30, "id": tid}}


def test_save_list_get_replace_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    r = trackstore.save(_record())
    first = trackstore.get(r["id"])["created"]
    trackstore.save(_record(project="/p/B.prproj", tid="bbb123def456"))
    lst = trackstore.listing("/p/A.prproj")
    assert [x["id"] for x in lst["items"]] == ["bbb123def456", "abc123def456"]          # newest first
    assert lst["mine"] == 1 and [x["here"] for x in lst["items"]] == [False, True]
    mine = lst["items"][1]
    assert mine["counts"] == {"sure": 4, "unsure": 0, "lost": 1, "none": 0} and mine["frames"] == 5 and mine["offline"]
    # the same track again after a fix replaces the file and keeps when it was made
    rec = _record(n=8)
    trackstore.save(rec)
    again = trackstore.get("abc123def456")
    assert len(again["track"]["frames"]) == 8 and again["created"] == first
    trackstore.delete("abc123def456")
    assert [x["id"] for x in trackstore.listing()["items"]] == ["bbb123def456"]


def test_bad_ids_and_empty_tracks_are_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    for bad in ("../../etc/passwd", "", "ABC"):
        with pytest.raises(ValueError):
            trackstore.get(bad)
    rec = _record()
    rec["track"]["frames"] = []
    with pytest.raises(ValueError):
        trackstore.save(rec)
    rec = _record()
    rec["track"]["frames"][0]["state"] = "maybe"
    with pytest.raises(ValueError):
        trackstore.save(rec)
    with pytest.raises(ValueError):
        trackstore.save({"id": "abc123def456", "track": {"frames": [{"state": "sure"}]}})


def test_endpoints_save_list_get_delete(engine, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    code, r = call("POST", "/tracker/saved/save", {"track": _record()})
    assert code == 200 and r["id"] == "abc123def456"
    code, lst = call("GET", "/tracker/saved?project=/p/A.prproj")
    assert code == 200 and lst["mine"] == 1
    code, rec = call("POST", "/tracker/saved/get", {"id": "abc123def456"})
    assert code == 200 and rec["source"]["clip"]["path"] == "/x/C0001.MP4" and "poster" not in rec
    assert call("POST", "/tracker/saved/get", {"id": "0000000000ff"})[0] == 400
    assert call("POST", "/tracker/saved/delete", {"id": "abc123def456"})[0] == 200
    assert call("GET", "/tracker/saved")[1]["items"] == []


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs FFmpeg")
def test_a_saved_track_reopens_with_its_pictures_after_a_restart(tmp_path, monkeypatch):
    """The user (2026-11-23): track a face, later attach a picture to it, after another track or a Premiere restart."""
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    path, step = _moving_file(tmp_path)
    k0 = 40
    box = [(100 + 7 * k0 - 35) / W, (270 - 35) / H, 70 / W, 70 / H]
    res = T.track(path, 0, 90 * step, step, k0 * step, box, rng=[30, 55])
    rec = _record(tid=res["id"], path=path)
    rec["track"] = res
    trackstore.save(rec)
    assert trackstore.listing()["items"][0]["poster"]                       # the boxed frame's picture for the list
    T._TRACKS.clear()                                                       # the engine restarted: the pictures are gone
    with pytest.raises(ValueError):
        T.thumbs(res["id"], 0, 10)
    out = T.reopen(res["id"], path, res["frames"], res["k0"])
    assert out["id"] == res["id"] and (out["from"], out["to"]) == (30, 56) and out["preview"]["jpeg"]
    got = T.thumbs(res["id"], 0, 90)["items"]
    assert all(got[i] for i in range(30, 56)) and not any(got[i] for i in list(range(30)) + list(range(56, 90)))


def test_tracks_are_numbered_per_project_and_keep_their_number(tmp_path, monkeypatch):
    """0.10.153: "TRACK 1 · C0001", "TRACK 2 · …" per project; a fix of the same track keeps its number and label."""
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    a = trackstore.save(_record(tid="aaa111aaa111"))
    b = trackstore.save(_record(tid="bbb222bbb222"))
    c = trackstore.save(_record(tid="ccc333ccc333", project="/p/B.prproj"))
    assert (a["n"], b["n"], c["n"]) == (1, 2, 1)
    assert a["label"] == "TRACK 1 · C0001"
    again = trackstore.save(_record(tid="aaa111aaa111", n=9))
    assert again["n"] == 1 and again["label"] == "TRACK 1 · C0001"
    trackstore.delete("bbb222bbb222")
    assert trackstore.save(_record(tid="ddd444ddd444"))["n"] == 2                   # the highest left is 1


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs FFmpeg")
def test_the_marker_clip_is_transparent_as_long_as_asked_and_made_once(engine, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    trackstore.save(_record())
    code, m = call("POST", "/tracker/marker", {"id": "abc123def456", "seconds": 6.006, "fps": 30000 / 1001, "width": 1080, "height": 1920})
    assert code == 200 and m["made"] and os.path.basename(m["path"]) == "TRACK 1 · C0001.mov"
    assert trackstore.marker_id(m["path"]) == "abc123def456"
    assert trackstore.marker_id("/Volumes/x/C0001.MOV") is None
    from asistent import media
    import json as _json
    import subprocess
    out = subprocess.run([media._tool("ffprobe"), "-v", "error", "-count_frames", "-show_entries",
                          "stream=codec_name,pix_fmt,width,height,nb_read_frames,r_frame_rate", "-of", "json", m["path"]],
                         capture_output=True, text=True, check=True)
    st = _json.loads(out.stdout)["streams"]
    assert len(st) == 1                                                            # picture only, no sound
    assert (st[0]["codec_name"], st[0]["pix_fmt"], st[0]["width"], st[0]["height"], st[0]["r_frame_rate"]) == ("qtrle", "argb", 1080, 1920, "30000/1001")
    assert int(st[0]["nb_read_frames"]) == 180
    alpha = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-i", m["path"], "-vf",
                            "alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-", "-f", "null", "-"],
                           capture_output=True, text=True, check=True).stdout
    assert "YMAX=" in alpha and all(line.endswith("=0") for line in alpha.split() if "YMAX=" in line)
    assert os.path.getsize(m["path"]) < 200_000
    again = call("POST", "/tracker/marker", {"id": "abc123def456", "seconds": 6.006, "fps": 30000 / 1001, "width": 1080, "height": 1920})[1]
    assert not again["made"] and again["path"] == m["path"]
    assert trackstore.listing()["items"][0]["marker"]
    assert call("POST", "/tracker/marker", {"id": "abc123def456", "seconds": 0, "fps": 30, "width": 10, "height": 10})[0] == 400
    trackstore.delete("abc123def456")
    assert os.path.isfile(m["path"])                                               # a placed marker never goes offline
