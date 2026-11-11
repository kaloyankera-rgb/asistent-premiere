"""Stash v1 (0.10.37): saved animations as files in <app>/stash/."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
sys.path.insert(0, os.path.dirname(__file__))
from asistent import config, stash  # noqa: E402
from test_server import call, engine  # noqa: E402,F401

ONE = {"format": 1, "name": "C0738 · Position", "span": 1.0,
       "props": [{"label": "Motion › Position", "comp": "AE.ADBE Motion", "param": "Position",
                  "anchors": [{"dt": 0, "v": [0.3, 0.5]}, {"dt": 1, "v": [0.7, 0.5]}], "frames": []}]}


def test_save_list_get_rename_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    r = stash.save(ONE, "/x/01_CLIENTS/GStroy/p.prproj")
    assert r["client"] == "GStroy"
    assert [i["name"] for i in stash.listing()["items"]] == ["C0738 · Position"]
    assert stash.get(r["id"])["props"][0]["anchors"][1]["v"] == [0.7, 0.5]
    stash.rename(r["id"], "Logo slide in")
    assert stash.listing()["items"][0]["name"] == "Logo slide in"
    stash.delete(r["id"])
    assert stash.listing() == {"items": [], "bytes": 0}


def test_bad_ids_and_empty_stashes_are_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    for bad in ("../../etc/passwd", "", "ABC"):
        with pytest.raises(ValueError):
            stash.get(bad)
    with pytest.raises(ValueError):
        stash.save({"props": []})


def test_endpoints(engine, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    code, r = call("POST", "/stash/save", {"stash": ONE, "project": "/x/01_CLIENTS/AULA/p.prproj"})
    assert code == 200 and r["client"] == "AULA"
    assert call("GET", "/stash/list")[1]["items"][0]["id"] == r["id"]
    assert call("GET", f"/stash/get?id={r['id']}")[1]["name"] == "C0738 · Position"
    assert call("GET", "/stash/get?id=nope")[0] == 404
    assert call("POST", "/stash/delete", {"id": r["id"]})[0] == 200


# ---------------------------------------------------------------- Stash clips (0.10.50)
def test_clips_begin_writes_an_empty_sequence_with_enough_tracks(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    b = stash.begin_clips("logo.png: test/1", 29.97, 1080, 1920, 2, 3, 4.0)
    assert b["sequence"].startswith("Stash - logo.png test 1 ") and b["file"].endswith("clips.prproj")
    with open(b["shell"], encoding="utf-8") as f:
        xml = f.read()
    assert "<clipitem" not in xml and "<width>1080</width>" in xml and "<height>1920</height>" in xml
    assert xml.count("<track>") == 2                              # video tracks
    assert xml.count("premiereTrackType") >= 3                     # audio tracks (two per pair: 4 for 3 asked)
    with pytest.raises(ValueError):
        stash.begin_clips("x", 0, 1080, 1920, 1, 0, 1)
    with pytest.raises(ValueError):
        stash.begin_clips("x", 25, 1080, 1920, 0, 0, 1)


def test_clips_save_needs_the_project_file_and_delete_removes_its_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    b = stash.begin_clips("logo", 25, 1920, 1080, 2, 0, 2.0)
    clips = {"kind": "clips", "id": b["id"], "name": "logo + 1", "sequence": b["sequence"], "span": 2.0,
             "items": [{"kind": "video", "track": 1, "start": 0, "end": 2, "label": "V2 logo.png"},
                       {"kind": "video", "track": 0, "start": 0, "end": 2, "label": "V1 bg.mp4"}]}
    with pytest.raises(ValueError):
        stash.save(clips, "/x/01_CLIENTS/GStroy/p.prproj")           # Premiere has not written the project yet
    with open(b["file"], "wb") as f:
        f.write(b"<?xml?>" * 100)
    r = stash.save(clips, "/x/01_CLIENTS/GStroy/p.prproj")
    assert r["id"] == b["id"] and r["client"] == "GStroy"
    got = stash.get(r["id"])
    assert got["file"] == b["file"] and got["kind"] == "clips"
    it = stash.listing()["items"][0]
    assert it["kind"] == "clips" and it["clips"] == ["V2 logo.png", "V1 bg.mp4"]
    assert stash.listing()["bytes"] > 700
    with pytest.raises(ValueError):
        stash.save({**clips, "id": "../../x"})
    stash.delete(r["id"])
    assert not os.path.exists(stash.clips_dir(r["id"]))


def test_clips_endpoints(engine, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    code, b = call("POST", "/stash/clips/begin", {"name": "logo", "fps": 25, "width": 1080, "height": 1920, "video": 2, "audio": 0, "seconds": 3})
    assert code == 200 and os.path.isfile(b["shell"])
    assert call("POST", "/stash/clips/begin", {"name": "x", "fps": 25, "width": 0, "height": 0, "video": 1})[0] == 400
    assert call("POST", "/host/tracks", {"sequence": "s", "video": 0, "audio": 0})[0] == 400
