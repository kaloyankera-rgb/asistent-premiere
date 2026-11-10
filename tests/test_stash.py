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
