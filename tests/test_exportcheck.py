"""Pre-export check (TODO I12, 0.10.35): each clip's peak in the range it uses; read only."""
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
sys.path.insert(0, os.path.dirname(__file__))
import synth  # noqa: E402
from asistent import exportcheck  # noqa: E402
from test_server import call, engine  # noqa: E402,F401


def tone(seconds, amp, sr=48000):
    t = np.arange(int(seconds * sr)) / sr
    return (amp * np.sin(2 * np.pi * 440 * t)).astype("float32")


def test_peak_only_in_the_used_range_and_per_channel(tmp_path):
    # 0-2 s quiet (-20 dBFS), 2-4 s loud (-3 dBFS) on the left; the right channel silent
    left = np.concatenate([tone(2, 0.1), tone(2, 0.708)])
    path = synth.write_wav(tmp_path / "mic.wav", [left, np.zeros_like(left)])
    res = exportcheck.peaks([{"path": path, "start": 0.2, "end": 1.8}, {"path": path, "start": 2.2, "end": 3.8}])["items"]
    assert abs(res[0]["peak_db"][0] + 20) < 0.3 and res[0]["peak_db"][1] < -100
    assert abs(res[1]["peak_db"][0] + 3) < 0.3


def test_same_range_measured_once_and_a_missing_file_is_reported_not_raised(tmp_path, monkeypatch):
    path = synth.write_wav(tmp_path / "a.wav", [tone(1, 0.5)])
    calls = []
    real = exportcheck.AUDIO.read_range
    monkeypatch.setattr(exportcheck.AUDIO, "read_range", lambda *a, **k: calls.append(a) or real(*a, **k))
    res = exportcheck.peaks([{"path": path, "start": 0, "end": 1}, {"path": path, "start": 0, "end": 1},
                             {"path": str(tmp_path / "gone.wav"), "start": 0, "end": 1}])["items"]
    assert len(calls) == 2 and res[0]["peak_db"] == res[1]["peak_db"]
    assert res[2]["peak_db"] is None and res[2]["error"]


def test_endpoint_runs_a_job(engine, tmp_path):  # noqa: F811
    path = synth.write_wav(tmp_path / "b.wav", [tone(1, 0.9)])
    assert call("POST", "/export/peaks", {"items": [{"start": 0}]})[0] == 400
    code, data = call("POST", "/export/peaks", {"items": [{"path": path, "start": 0, "end": 1}]})
    assert code == 200
    for _ in range(100):
        st = call("GET", f"/jobs/{data['job']}")[1]
        if st["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.1)
    assert st["state"] == "done" and st["result"]["items"][0]["peak_db"][0] > -1.5
