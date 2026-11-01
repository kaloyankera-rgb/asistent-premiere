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
