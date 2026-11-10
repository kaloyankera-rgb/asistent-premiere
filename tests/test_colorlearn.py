"""Colour learning at export (TODO EL1, 0.10.36): read only, local records, the per-camera report."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
from asistent import colorlearn, config  # noqa: E402


def setup(tmp_path, monkeypatch, sugg):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    monkeypatch.setattr(colorlearn, "_camera", lambda p: ("FX3 (кам1)" if "кам1" in p else "кам2", "s-log3" if "кам1" in p else None))
    monkeypatch.setattr(colorlearn, "suggestion", lambda path, s, e, g: dict(sugg[os.path.basename(path)]))


def test_client_from_the_path():
    assert colorlearn.client_of("/Users/k/Kaloyan/01_CLIENTS/Ludi Glavi/Projects/NEW TEST.prproj") == "Ludi Glavi"
    assert colorlearn.client_of("/Volumes/Production/RoboHubPro/Видеа/x.prproj") == "RoboHubPro"


def test_record_and_report(tmp_path, monkeypatch):
    sure = {"exposure_confidence": "high", "white_confidence": "medium"}
    setup(tmp_path, monkeypatch, {
        "a.MP4": {"exposure": 1.0, "temperature": 10, "tint": 0, **sure},
        "b.MP4": {"exposure": 0.5, "temperature": -5, "tint": 2, **sure},
        "c.MP4": {"exposure": 2.0, "temperature": 0, "tint": 0, "exposure_confidence": "low", "white_confidence": "low"},
    })
    proj = "/x/01_CLIENTS/GStroy/p.prproj"
    clips = [
        {"path": "/m/кам1/a.MP4", "start": 0, "end": 5, "lumetri": {"exposure": 1.5, "temperature": 20, "tint": 0}},
        {"path": "/m/кам1/a.MP4", "start": 0, "end": 5, "lumetri": {"exposure": 9}},           # the same range twice: once
        {"path": "/m/кам1/b.MP4", "start": 1, "end": 4, "lumetri": None, "layer": {"exposure": 1.0, "temperature": 0, "tint": 0}},
        {"path": "/m/кам2/c.MP4", "start": 0, "end": 3, "lumetri": {"exposure": 0.3}, "owned": True},
    ]
    r = colorlearn.record_now(proj, "SEQ", clips)
    assert r["client"] == "GStroy" and r["recorded"] == 3 and r["file"].endswith("GStroy.jsonl")
    rep = colorlearn.report("GStroy")["cameras"]
    fx3 = next(c for c in rep if c["camera"].startswith("FX3"))
    # a: editor 1.5 vs 1.0 -> +0.5; b: layer 1.0 vs 0.5 -> +0.5; temperature +10 and +5 -> 7.5; tint 0 and -2 -> -1
    assert fx3["clips"] == 2 and fx3["layer"] == 1
    assert fx3["exposure"] == {"n": 2, "median": 0.5}
    assert fx3["temperature"]["median"] == 7.5 and fx3["tint"]["median"] == -1.0
    k2 = next(c for c in rep if c["camera"] == "кам2")
    assert k2["kept"] == 1 and k2["exposure"]["n"] == 0                       # Asistent unsure: not compared
    # a re-export of the same clip replaces its line
    colorlearn.record_now(proj, "SEQ", [{"path": "/m/кам1/a.MP4", "start": 0, "end": 5, "lumetri": {"exposure": 1.0, "temperature": 10, "tint": 0}}])
    fx3 = next(c for c in colorlearn.report("GStroy")["cameras"] if c["camera"].startswith("FX3"))
    assert fx3["clips"] == 2 and fx3["exposure"]["median"] == 0.25


def test_a_file_that_cannot_be_read_is_recorded_without_a_suggestion(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    r = colorlearn.record_now("/x/01_CLIENTS/AULA/p.prproj", "S", [{"path": str(tmp_path / "gone.MP4"), "start": 0, "end": 1}])
    assert r["recorded"] == 1
    import json
    with open(r["file"], encoding="utf-8") as f:
        ln = json.loads(f.readline())
    assert ln["asistent"] is None and ln["error"]


def test_queue_returns_at_once_and_the_worker_records(tmp_path, monkeypatch):
    setup(tmp_path, monkeypatch, {"a.MP4": {"exposure": 0, "temperature": 0, "tint": 0, "exposure_confidence": "high", "white_confidence": "high"}})
    out = colorlearn.queue_export("/x/01_CLIENTS/Pulse/p.prproj", "S", [{"path": "/m/кам1/a.MP4", "start": 0, "end": 1}])
    assert out == {"queued": 1, "client": "Pulse"}
    import time
    for _ in range(100):
        if colorlearn.status()["pending"] == 0 and (colorlearn.status()["last"] or {}).get("client") == "Pulse":
            break
        time.sleep(0.05)
    assert colorlearn.status()["last"]["recorded"] == 1



from test_server import call, engine  # noqa: E402,F401


def test_report_endpoint(engine, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    code, data = call("GET", "/colorlearn/report?project=/x/01_CLIENTS/AULA/p.prproj")
    assert code == 200 and data["client"] == "AULA" and data["cameras"] == [] and "pending" in data
