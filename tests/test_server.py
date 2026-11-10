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
    assert code == 400 and "missing" in data["error"]


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
    code, sent = call("POST", "/dev/command", {"name": "click", "args": {"text": "Auto color"}})
    assert code == 200 and sent["id"]
    code, cmd = call("GET", "/dev/poll?wait=1")                                # the panel picks it up
    assert code == 200 and cmd["name"] == "click" and cmd["args"] == {"text": "Auto color"} and cmd["id"] == sent["id"]
    assert call("GET", "/dev/poll?wait=0")[1] == {}                           # one command is handed out once
    assert call("GET", f"/dev/result?id={sent['id']}&wait=0")[0] == 202       # not answered yet
    assert call("POST", "/dev/result", {"id": sent["id"], "ok": True, "data": {"clicked": "Auto color"}})[0] == 200
    code, res = call("GET", f"/dev/result?id={sent['id']}&wait=1")
    assert code == 200 and res["ok"] and res["data"] == {"clicked": "Auto color"}
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
    assert code == 400 and "Select" in res["error"]
    code, res = call("POST", "/subtitles", {"items": [{"path": "/nope.wav", "start": 0, "end": 1, "at": 0}]})
    assert code == 400 and "missing" in res["error"]


def test_host_channel_places_captions_through_the_host(engine, tmp_path, monkeypatch):
    from asistent import hostbridge
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    srt = tmp_path / "a.srt"
    srt.write_text("1\n00:00:00,000 --> 00:00:01,000\nда\n", encoding="utf-8")
    hostbridge._state.update(seen=0.0, version=None)
    code, data = call("POST", "/captions/place", {"srt": str(srt), "sequence": "Seq"})
    assert code == 400 and "not running" in data["error"]                       # no host has polled: a clear reason
    assert call("GET", "/host/status")[1]["connected"] is False

    got = {}

    def host():                                                               # what host/main.js does
        code, cmd = call("GET", "/host/poll?wait=5", headers={"X-Asistent-Host": "0.9.45"})
        got["cmd"] = cmd
        call("POST", "/host/result", {"id": cmd["id"], "ok": True, "data": {"ok": True, "msg": "ok", "tracks_after": 1}})
    t = threading.Thread(target=host)
    t.start()
    time.sleep(0.3)
    assert call("GET", "/host/status")[1] == {"connected": True, "age": pytest.approx(0, abs=2), "version": "0.9.45"}
    code, res = call("POST", "/captions/place", {"srt": str(srt), "sequence": "Seq", "guid": "8097176a-bd0c", "project": "/p/TEST.prproj"})
    t.join(5)
    assert code == 200 and res["ok"] and res["tracks_after"] == 1
    # the sequence's id goes to the host, which finds the sequence by it (0.10.25)
    assert got["cmd"]["name"] == "captions" and got["cmd"]["args"] == {"srt": str(srt), "sequence": "Seq", "project": "/p/TEST.prproj",
                                                                      "bin": "Subtitles", "guid": "8097176a-bd0c"}


def test_host_place_is_checked_and_eval_needs_the_dev_flag(engine, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    assert call("POST", "/captions/place", {"srt": str(tmp_path / "nope.srt"), "sequence": "S"})[0] == 400
    assert call("POST", "/captions/place", {"srt": "x", "sequence": ""})[0] == 400
    assert call("POST", "/host/command", {"name": "eval", "args": {"code": "1"}})[0] == 404      # no flag file


def test_caption_state_remembers_the_track_per_project_and_sequence(engine, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    q = "project=%2Fp%2FA.prproj&sequence=Seq"
    assert call("GET", f"/captions/state?{q}")[1] == {}
    sig = {"index": 1, "count": 25, "first": 0.0, "last": 23.7, "srt": "/a.srt"}
    assert call("POST", "/captions/record", {"project": "/p/A.prproj", "sequence": "Seq", "signature": sig})[0] == 200
    assert call("GET", f"/captions/state?{q}")[1] == sig
    assert call("GET", "/captions/state?project=%2Fp%2FB.prproj&sequence=Seq")[1] == {}       # another project: nothing
    assert call("POST", "/captions/record", {"project": "/p/A.prproj", "sequence": "Seq", "signature": {"index": "x"}})[0] == 400
    assert call("POST", "/captions/forget", {"project": "/p/A.prproj", "sequence": "Seq"})[0] == 200
    assert call("GET", f"/captions/state?{q}")[1] == {}


def test_subtitle_settings_are_kept_per_project_and_validated(engine, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    q = "project=%2Fp%2FA.prproj"
    assert call("GET", f"/subtitles/settings?{q}")[1] == {"text": "", "speakers": {}}
    code, res = call("POST", "/subtitles/settings", {"project": "/p/A.prproj", "text": "раф => рафт\nлошо =>"})
    assert code == 200 and res["text"].startswith("раф") and len(res["errors"]) == 1
    assert call("GET", f"/subtitles/settings?{q}")[1] == {"text": "раф => рафт\nлошо =>", "speakers": {}}
    assert call("GET", "/subtitles/settings?project=%2Fp%2FB.prproj")[1] == {"text": "", "speakers": {}}
    # who speaks on which track: kept next to the text, which stays
    assert call("POST", "/subtitles/speakers", {"project": "/p/A.prproj", "speakers": {"0": "m", "1": "f"}})[0] == 200
    assert call("GET", f"/subtitles/settings?{q}")[1] == {"text": "раф => рафт\nлошо =>", "speakers": {"0": "m", "1": "f"}}
    assert call("POST", "/subtitles/speakers", {"project": "/p/A.prproj", "speakers": {"0": "male"}})[0] == 400
    # the Learned list: empty for a project outside a client folder; a fix that does not exist cannot be removed
    assert call("GET", f"/subtitles/learned?{q}")[1] == {"client": None, "shared": False, "rules": []}
    assert call("POST", "/subtitles/learned", {"project": "/p/A.prproj", "key": "x=>y", "action": "remove"})[0] == 400
    assert call("POST", "/subtitles/settings", {"project": "", "text": ""})[0] == 400


def test_audio_route_is_validated_before_it_reaches_premiere():
    import pytest
    from asistent import hostbridge
    with pytest.raises(ValueError, match="Unclear"):
        hostbridge.route_audio([{"track": 0, "start": 1.0, "end": 2.0, "route": "fill_left"}], "S", None)
    with pytest.raises(ValueError, match="No clips"):
        hostbridge.route_audio([], "S", None)
    assert "audio_route" in hostbridge.COMMANDS


def test_a_job_cancelled_while_its_last_stage_ignored_it_ends_cancelled_not_done():
    """0.10.6 (BUG-014): the result of work the editor cancelled is never handed to the panel."""
    import threading
    import time as _t
    from asistent.jobs import JobManager
    jm = JobManager(workers=1)
    started = threading.Event()

    def work(job):
        started.set()
        _t.sleep(0.3)                                   # a stage that never looks at job.cancelled
        return {"applied": True}
    job = jm.submit("x", work)
    started.wait(2)
    job.cancel()
    for _ in range(50):
        if job.state not in ("queued", "running"):
            break
        _t.sleep(0.05)
    assert job.state == "cancelled" and job.result is None


def test_ffmpeg_is_stopped_when_the_job_is_cancelled():
    import sys as _sys
    import pytest
    from asistent import media
    t0 = __import__("time").monotonic()
    with pytest.raises(media.Interrupted):
        media._run([_sys.executable, "-c", "import time; time.sleep(30)"], cancelled=lambda: __import__("time").monotonic() - t0 > 0.3)
    assert __import__("time").monotonic() - t0 < 5
    with pytest.raises(media.MediaError, match="did not finish"):
        media._run([_sys.executable, "-c", "import time; time.sleep(30)"], timeout=0.5)


def test_a_host_command_given_up_while_queued_never_runs_and_a_taken_one_is_logged():
    """0.10.6 (ARCH-001): no stale command runs after the editor's retry."""
    from asistent.devbridge import Bridge
    b = Bridge()
    a = b.submit("captions", {"n": 1})
    assert b.wait_result(a, 0.05) is None
    assert b.give_up(a) == "withdrawn"
    assert b.poll(0.05) is None                                   # never handed to Premiere
    c = b.submit("captions", {"n": 2})
    assert b.poll(0.05)["id"] == c
    assert b.give_up(c) == "running"
    b.result(c, True, {"ok": True})                               # the late answer is kept and logged
    assert b.wait_result(c, 0)["ok"]
    d = b.submit("captions", {}, deadline=time.time() - 1)
    assert b.poll(0.05) is None                                   # past its deadline: dropped
    assert d


def test_review_reads_an_asistent_run_and_refuses_other_files(engine, tmp_path):
    folder = tmp_path / "Asistent_subtitles"
    folder.mkdir()
    run = {"captions": [{"start": 0.0, "end": 1.0, "text": "не е 5", "flags": []}], "words": [],
           "review": [{"at": 0.2, "word": "не", "reason": "a word that is too short"}], "edits": {}}
    (folder / "r.json").write_text(json.dumps(run, ensure_ascii=False), encoding="utf-8")
    code, data = call("POST", "/subtitles/review", {"json": str(folder / "r.json")})
    assert code == 200 and data["lines"][0][0]["why"] == "negation" and data["summary"]["lines_to_check"] == 1
    assert call("POST", "/subtitles/review", {"json": str(tmp_path / "r.json")})[0] == 400
