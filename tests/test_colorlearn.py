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


# ---------------------------------------------------------------- 0.10.142 (the colour audit of 2026-11-22)

def test_client_from_the_project_name_when_the_video_folder_is_the_volume():
    p = "/Volumes/Видео 7 - София или малкият град/Assets/Credissimo КП-14 - Видео 7 - София или малкият град.prproj"
    assert colorlearn.client_of(p) == "Credissimo"
    assert colorlearn.client_of("/Volumes/Видео 6/Assets/Pulse Fitness КП-5 - Видео 6 - Защо.prproj") == "Pulse Fitness"
    assert colorlearn.client_in_name("/x/ЕКОПАК КП-8 - Видео 4.prproj") == "ЕКОПАК"
    assert colorlearn.client_in_name("/x/NEW TEST.prproj") is None
    # a local client folder still wins over the name
    assert colorlearn.client_of("/Users/k/Kaloyan/01_CLIENTS/GStroy/Projects/Credissimo КП-1.prproj") == "GStroy"


def test_only_camera_footage_counts():
    assert colorlearn.footage("/Volumes/Видео 3/Кам 1/fx30103.MP4")
    assert colorlearn.footage("/Volumes/Видео 2 - Робот в ресторант/Видео 2 - Робот в ресторант/C0012.MP4")
    assert colorlearn.footage("/Users/k/01_CLIENTS/4a1a Racing/b-roll/C0040.MOV")
    for p in ("/Volumes/Видео 4/Assets/logo.png", "/Users/k/Content Studio/renders/v3.mov",
              "/Users/k/gstroy-cheren-petak/Със SFX/x.mov", "/Users/k/02_RESOURCES/Graphics & Stock/a.mp4",
              "/Users/k/Transitions & Overlays/film/x.mp4", "/Users/k/Downloads/clip.mp4", "/a/b/mockup.psd"):
        assert not colorlearn.footage(p), p


def test_not_footage_is_neither_analysed_nor_recorded(tmp_path, monkeypatch):
    setup(tmp_path, monkeypatch, {"a.MP4": {"exposure": 0, "temperature": 0, "tint": 0, "exposure_confidence": "high",
                                            "white_confidence": "high"}})
    r = colorlearn.record_now("/x/01_CLIENTS/AULA/p.prproj", "S", [
        {"path": "/m/кам1/a.MP4", "start": 0, "end": 1}, {"path": "/m/renders/b.MOV", "start": 0, "end": 1},
        {"path": "/m/кам1/title.png", "start": 0, "end": 1}])
    assert r["recorded"] == 1 and r["skipped"] == 2


def test_every_changed_setting_is_recorded(tmp_path, monkeypatch):
    setup(tmp_path, monkeypatch, {"a.MP4": {"exposure": 0, "temperature": 0, "tint": 0, "exposure_confidence": "high",
                                            "white_confidence": "high"}})
    changed = {"12:Whites": 20, "40:Vibrance": 15}
    r = colorlearn.record_now("/x/01_CLIENTS/AULA/p.prproj", "S", [
        {"path": "/m/кам1/a.MP4", "start": 0, "end": 1, "changed": changed, "layer_changed": [{"3:Look": "x.cube"}]}])
    import json
    with open(r["file"], encoding="utf-8") as f:
        ln = json.loads(f.readline())
    assert ln["format"] == 2 and ln["editor_all"] == changed and ln["layer_all"] == [{"3:Look": "x.cube"}]


def test_report_in_stops_and_the_editors_contrast_and_saturation(tmp_path, monkeypatch):
    import json
    with open(tmp_path / "lumetri.json", "w") as f:
        json.dump({"exposure_curve": [[0.3, 0.9], [0.5, 0.8], [0.7, 0.6]]}, f)
    sure = {"exposure_confidence": "high", "white_confidence": "high", "temperature": 0, "tint": 0}
    setup(tmp_path, monkeypatch, {
        "a.MP4": {"exposure": 0.5, "measured": {"at_luma": 0.5}, **sure},
        "b.MP4": {"exposure": 0.5, "measured": {"at_luma": 0.5}, **sure},
    })
    colorlearn.record_now("/x/01_CLIENTS/AULA/p.prproj", "S", [
        {"path": "/m/кам1/a.MP4", "start": 0, "end": 1, "lumetri": {"exposure": 1.0, "contrast": 15, "saturation": 120}},
        {"path": "/m/кам1/b.MP4", "start": 0, "end": 1, "lumetri": {"exposure": 1.0, "saturation": 100}}])
    cam = colorlearn.report("AULA")["cameras"][0]
    # 1.0 Lumetri unit at luma 0.5 = 0.8 stop, Auto color 0.5 stop -> +0.3 (not +0.5)
    assert cam["exposure"]["median"] == 0.3
    assert cam["contrast"] == {"n": 2, "changed": 1, "median": 15.0}
    assert cam["saturation"] == {"n": 2, "changed": 1, "median": 20.0}


def test_repair_moves_misfiled_lines_once_and_keeps_a_backup(tmp_path, monkeypatch):
    import json
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    monkeypatch.setattr(colorlearn, "_repaired", False)
    d = tmp_path / "learning" / "color"
    d.mkdir(parents=True)
    cred = "/Volumes/Видео 7/Assets/Credissimo КП-14 - Видео 7.prproj"
    with open(d / "Assets.jsonl", "w", encoding="utf-8") as f:
        f.write(json.dumps({"at": "2026-11-12T10:00:00", "client": "Assets", "project": cred, "path": "/m/a.MP4"}) + "\n")
    with open(d / "Credissimo.jsonl", "w", encoding="utf-8") as f:
        f.write(json.dumps({"at": "2026-11-11T10:00:00", "client": "Credissimo", "project": "/x/Credissimo КП-13.prproj",
                            "path": "/m/b.MP4"}) + "\n")
        f.write(json.dumps({"at": "2026-11-13T10:00:00", "client": "Credissimo", "project": "/x/Credissimo КП-13.prproj",
                            "path": "/m/c.MP4"}) + "\n")
    out = colorlearn.repair()
    assert out["moved"] == 1 and not (d / "Assets.jsonl").exists()
    with open(d / "Credissimo.jsonl", encoding="utf-8") as f:
        rows = [json.loads(r) for r in f]
    assert [r["path"] for r in rows] == ["/m/b.MP4", "/m/a.MP4", "/m/c.MP4"]          # time order kept
    assert rows[1]["client"] == "Credissimo"
    backups = list((d / "backup").iterdir())
    assert len(backups) == 1 and (backups[0] / "Assets.jsonl").exists()
    assert colorlearn.repair() == {"moved": 0}                                            # once per engine run


def test_suggestion_keeps_the_measurements(tmp_path, monkeypatch):
    import numpy as np
    from asistent import color
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    frame = np.full((90, 160, 3), 0.3)
    frame[:, :80] = [0.55, 0.5, 0.45]                    # a warm-ish grey half
    monkeypatch.setattr(color, "read_frames", lambda path, start=0.0, end=None: [frame, frame, frame])
    s = colorlearn.suggestion("/m/a.MP4", 0, 1, "rec709")
    m, look = s["measured"], s["look"]
    assert m["y_mid"] is not None and m["frames"] == 3 and "cast_temp" in m and "at_luma" in m
    assert set(look) == {"black", "white", "contrast", "saturation", "clipped"} and look["white"] >= look["black"]


def test_folder_endpoints(engine, tmp_path, monkeypatch):  # noqa: F811 (the Folders page, 0.10.143: lives here for the engine fixture)
    from asistent import reveal
    opened = []
    monkeypatch.setattr(reveal.subprocess, "Popen", lambda cmd, **kw: opened.append(cmd))
    code, data = call("POST", "/folders/exist", {"paths": [str(tmp_path), str(tmp_path / "gone")]})
    assert code == 200 and data["exist"] == [True, False]
    code, data = call("POST", "/folders/open", {"path": str(tmp_path)})
    assert code == 200 and data["ok"] and opened
    code, data = call("POST", "/folders/open", {"path": str(tmp_path / "gone")})
    assert code == 404 and "not there" in data["error"]
