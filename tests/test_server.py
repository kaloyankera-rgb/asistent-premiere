"""HTTP API: guards, job lifecycle and a real sync job over the wire (engine on a test port)."""
import json
import os
import threading
import time
from http.client import HTTPConnection

import pytest

os.environ["ASISTENT_PORT"] = "47399"

import synth  # noqa: E402
from asistent import config, server  # noqa: E402


@pytest.fixture(scope="module")
def engine():
    config.PORT = 47399
    server._ALLOWED_HOSTS.clear()
    server._ALLOWED_HOSTS.update({f"127.0.0.1:{config.PORT}", f"localhost:{config.PORT}"})
    httpd = server.ThreadingHTTPServer(("127.0.0.1", config.PORT), server.Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield
    httpd.shutdown()
    httpd.server_close()


def call(method, path, body=None, headers=None):
    c = HTTPConnection("127.0.0.1", 47399, timeout=10)
    h = {"X-Asistent": "1", "Content-Type": "application/json"}
    h.update(headers or {})
    c.request(method, path, json.dumps(body) if body is not None else None, h)
    r = c.getresponse()
    try:
        return r.status, json.loads(r.read() or b"{}")
    finally:
        c.close()


def test_status(engine):
    code, data = call("GET", "/status")
    assert code == 200 and data["app"] == "asistent"


def test_rejects_browser_requests(engine):
    assert call("GET", "/status", headers={"X-Asistent": ""})[0] == 403
    assert call("POST", "/sync", {"paths": []}, headers={"Origin": "https://evil.example"})[0] == 403
    assert call("GET", "/status", headers={"Host": "evil.example:47399"})[0] == 403


def test_sync_validation(engine):
    code, data = call("POST", "/sync", {"paths": ["/nope/a.mp4", "/nope/b.mp4"]})
    assert code == 400 and "липсва" in data["error"]


def test_sync_job_end_to_end(engine, tmp_path):
    s1, s2 = synth.scene(60.0, seed=4)
    a = synth.write_wav(tmp_path / "a.wav", [synth.mic([(s1, 1), (s2, .8)], 5, 40, seed=1)])
    b = synth.write_wav(tmp_path / "b.wav", [synth.mic([(s1, 1), (s2, .8)], 8.5, 30, seed=2)])
    code, data = call("POST", "/sync", {"paths": [a, b], "reference": 0})
    assert code == 200
    job = data["job"]
    for _ in range(300):
        code, st = call("GET", f"/jobs/{job}")
        if st["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.1)
    assert st["state"] == "done", st
    clip = st["result"]["clips"][1]
    assert clip["confidence"] == "high" and abs(clip["offset"] - 3.5) < 0.001


def test_cancel(engine, tmp_path):
    s1, s2 = synth.scene(130.0, seed=5)
    a = synth.write_wav(tmp_path / "a.wav", [synth.mic([(s1, 1), (s2, .8)], 0, 120, seed=1)])
    b = synth.write_wav(tmp_path / "b.wav", [synth.mic([(s1, 1), (s2, .8)], 3, 120, seed=2)])
    job = call("POST", "/sync", {"paths": [a, b]})[1]["job"]
    call("POST", f"/jobs/{job}/cancel")
    for _ in range(300):
        st = call("GET", f"/jobs/{job}")[1]
        if st["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.1)
    assert st["state"] == "cancelled"


def test_audio_job(engine, tmp_path):
    s1, s2 = synth.scene(20.0, seed=9)
    import numpy as np
    path = synth.write_wav(tmp_path / "lav.wav", [(s1 + s2)[: 18 * 48000].astype("float32") * 0.3,
                                                  np.zeros(18 * 48000, "float32")])
    assert call("POST", "/audio", {"items": [{"path": path}], "force": "rm -rf"})[0] == 400
    code, data = call("POST", "/audio", {"items": [{"path": path, "start": 2, "end": 12}]})
    assert code == 200
    for _ in range(200):
        st = call("GET", f"/jobs/{data['job']}")[1]
        if st["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.1)
    item = st["result"]["items"][0]
    assert item["action"] == "use_left" and item["outputs"][0]["result_peak_db"] <= -5.95


def test_import_endpoints(engine, tmp_path):
    from asistent import server as S
    from asistent.importer import Store
    S.STORE = Store(str(tmp_path / "import.json"))
    folder = tmp_path / "dl"
    folder.mkdir()
    assert call("GET", "/import/status")[0] == 400
    code, data = call("POST", "/import/bind", {"project": "/p/A.prproj", "folder": str(folder)})
    assert code == 200 and data["enabled"] and data["folder"] == str(folder)
    code, data = call("GET", "/import/status?project=%2Fp%2FA.prproj")
    assert code == 200 and data["enabled"] and data["pending"] == []
    assert call("POST", "/import/bind", {"project": "/p/A.prproj", "folder": str(tmp_path / "nope")})[0] == 400
    code, data = call("POST", "/import/unbind", {"project": "/p/A.prproj"})
    assert code == 200 and not data["enabled"]


def test_dev_bridge_is_off_without_its_flag_and_round_trips_with_it(engine, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    assert call("POST", "/dev/command", {"name": "ping"})[0] == 404           # no flag file: nothing is accepted
    assert call("GET", "/dev/poll?wait=0")[0] == 404
    assert call("POST", "/dev/command", {"name": "ping"}, {"X-Asistent": "0"})[0] == 403   # same guard as the rest
    (tmp_path / "devbridge.enabled").write_text("")
    code, sent = call("POST", "/dev/command", {"name": "click", "args": {"text": "Цвят"}})
    assert code == 200 and sent["id"]
    code, cmd = call("GET", "/dev/poll?wait=1")                                # the panel picks it up
    assert code == 200 and cmd["name"] == "click" and cmd["args"] == {"text": "Цвят"} and cmd["id"] == sent["id"]
    assert call("GET", "/dev/poll?wait=0")[1] == {}                           # one command is handed out once
    assert call("GET", f"/dev/result?id={sent['id']}&wait=0")[0] == 202       # not answered yet
    assert call("POST", "/dev/result", {"id": sent["id"], "ok": True, "data": {"clicked": "Цвят"}})[0] == 200
    code, res = call("GET", f"/dev/result?id={sent['id']}&wait=1")
    assert code == 200 and res["ok"] and res["data"] == {"clicked": "Цвят"}
    assert call("POST", "/dev/command", {"name": ""})[0] == 400                # a name is required


def test_dev_bridge_poll_wakes_up_when_a_command_arrives(engine, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    (tmp_path / "devbridge.enabled").write_text("")
    got = {}
    t = threading.Thread(target=lambda: got.update(r=call("GET", "/dev/poll?wait=5")))
    t.start()
    time.sleep(0.3)
    call("POST", "/dev/command", {"name": "ping"})
    t.join(4)
    assert got["r"][0] == 200 and got["r"][1]["name"] == "ping"


def test_subtitle_model_endpoints(engine, tmp_path, monkeypatch):
    from asistent import asr
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    code, st = call("GET", "/subtitles/model")
    assert code == 200 and st["model"] is False and st["dir"] == str(tmp_path / "models" / "whisper") and st["bytes"] == 0
    assert set(st) >= {"backend", "model", "dir", "bytes", "expected_bytes", "device"}
    d = tmp_path / "models" / "whisper"
    d.mkdir(parents=True)
    for f in asr.MODEL_FILES:
        (d / f).write_bytes(b"x")
    code, res = call("POST", "/subtitles/model/download", {})
    assert code == 200 and res["done"] is True and res["status"]["model"] is True     # nothing to download: no job, no fetch


def test_subtitles_request_is_checked_before_a_job_starts(engine):
    code, res = call("POST", "/subtitles", {"items": []})
    assert code == 400 and "Маркирай" in res["error"]
    code, res = call("POST", "/subtitles", {"items": [{"path": "/nope.wav", "start": 0, "end": 1, "at": 0}]})
    assert code == 400 and "липсва" in res["error"]
