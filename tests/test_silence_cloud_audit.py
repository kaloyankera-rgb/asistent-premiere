"""Cut silences' ElevenLabs path after the 2026-11-21 engine audit (0.10.122): what is a ReShape run, a reading shared with the
subtitles, what is remembered, when words are read at all, long clips, retries, progress and a cancelled upload that still
finishes. No test reaches the network: urlopen refuses, transcribe / _post are faked."""
import io
import os
import threading
import time
import unicodedata
import urllib.error

import numpy as np
import pytest

import synth
from asistent import asr, cloudasr, config, learning, recognition as R, roughcut_job, subtitle_job
from asistent.subtitle_job import _cached, _store, _words_key, cache_dir, plan_windows, read_window, window_audio

KEY = "sk_" + "c3" * 20
SCRIBE = [{"word": "Днес", "start": 4.3, "end": 4.7, "p": 0.97}, {"word": "ъъъ", "start": 5.6, "end": 6.1, "p": 0.9}]
RUN = (lambda f, m: None, lambda: False)


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path / "app"))
    monkeypatch.setattr(asr, "backend_installed", lambda: True)
    monkeypatch.setattr(asr, "model_present", lambda *a: True)
    monkeypatch.setattr(learning, "_mounts", lambda: [])
    monkeypatch.setattr(roughcut_job, "_WORDS", {})

    def refuse(*a, **k):
        raise AssertionError("a test tried to reach the network")
    monkeypatch.setattr(cloudasr.urllib.request, "urlopen", refuse)
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    return tmp_path


@pytest.fixture
def calls(monkeypatch):
    seen = {"cloud": 0, "local": 0, "fail": None, "cloud_s": [], "local_s": []}

    def scribe(y, progress=None, cancelled=None, model=cloudasr.MODEL, **kw):
        seen["cloud"] += 1
        seen["cloud_s"].append(len(y) / 16000)
        if seen["fail"]:
            raise cloudasr.CloudError(seen["fail"])
        return [dict(w) for w in SCRIBE]

    def whisper(y, prompt=None, progress=None, cancelled=None, **kw):
        seen["local"] += 1
        seen["local_s"].append(len(y) / 16000)
        return [{"word": "днес", "start": 4.3, "end": 4.7, "p": 0.9}]
    monkeypatch.setattr(cloudasr, "transcribe", scribe)
    monkeypatch.setattr(asr, "transcribe", whisper)
    return seen


def body(home, folder="Clients/GStroy/Video 3", seconds=10.0, **kw):
    a = synth.write_wav(home / "m1.wav", [synth.talker(seconds, 2)])
    out = home / folder
    out.mkdir(parents=True, exist_ok=True)
    lay = [{"kind": k, "track": 0, "path": a, "start": 0.0, "end": seconds, "inPt": 0.0, "name": "m1"} for k in ("video", "audio")]
    return {"items": [{"path": a, "start": 0.0, "end": seconds, "at": 0.0, "name": "m1", "track": 0}], "layout": lay,
            "out_dir": str(out), "name": "t", "fps": 30, "width": 1080, "height": 1920, "mode": "ai", "method": "ai",
            "pacing": "measured", "fillers": True, "preview": True, **kw}


def one_window(b):
    return plan_windows([{"path": b["items"][0]["path"], "start": 0.0, "end": b["items"][0]["end"], "at": 0.0}])[0]


# ------------------------------------------------------------------------------------------------------ 1. ReShape

def test_reshape_marks_are_whole_words_of_a_path_part_in_any_unicode_form():
    yes = ["/Volumes/Production/ReShape/Видео 4", "/Users/x/Re-Shape/v2", "/Users/x/Клиенти/Решейп/2", "/Volumes/Production/Dr.Denkov/Reel 3",
           "/Users/x/ReShapeProject/a", "/Users/x/RESHAPE_2026/a", "/Users/x/reshape-ads/a", "/Users/x/Ре-Шейп/a", "/Users/x/Решейпа/a",
           "/Users/x/DrDenkov/a", "/Users/x/Д-р Денков/a", "/Users/x/Denkov 2/a", "/Users/x/ReShapes/a", "/Users/x/Reshapes/a",
           "/Users/x/Denkovclinic/a", "/Users/x/01_CLIENTS/Мария Денкова/Интервю", "/Users/x/Denkova/a"]      # „Денкова“ counts: the safe side
    no = ["/Volumes/Production/Reshaped Exports/x", "/Users/x/reshoot day", "/Users/x/Reshaper", "/Users/x/Reshapers/a",
          "/Volumes/Production/GStroy/Видео 3", "/Users/x/Re Shot/a", ""]
    for p in yes:
        assert roughcut_job.is_reshape(p), p
        assert roughcut_job.is_reshape(unicodedata.normalize("NFD", p)), "NFD: " + p
    for p in no:
        assert not roughcut_job.is_reshape(p), p
        assert not roughcut_job.is_reshape(unicodedata.normalize("NFD", p)), "NFD: " + p


def test_a_run_is_the_offices_when_its_footage_is_even_if_the_project_is_elsewhere(home, calls):
    cloudasr.save({"key": KEY})
    rs = home / "Production" / "ReShape" / "Видео 9"
    rs.mkdir(parents=True)
    a = synth.write_wav(rs / "m1.wav", [synth.talker(10, 2)])
    b = body(home, "Desktop")
    b["items"][0]["path"] = a
    for it in b["layout"]:
        it["path"] = a
    assert roughcut_job.use_cloud(b["out_dir"]) and not roughcut_job.use_cloud(b["out_dir"], [a])   # the media decide
    res = roughcut_job.run(b, *RUN)
    assert calls["cloud"] == 0 and calls["local"] == 1 and res["speech"]["recognizer"] is None
    # a layout clip alone (the camera) in a ReShape folder is enough too
    b2 = body(home, "Desktop2")
    b2["layout"][0]["path"] = a
    roughcut_job._WORDS.clear()
    roughcut_job.run(b2, *RUN)
    assert calls["cloud"] == 0
    # other footage in other folders: the cloud
    roughcut_job._WORDS.clear()
    roughcut_job.run(body(home, "Desktop3"), *RUN)
    assert calls["cloud"] == 1


def test_the_mount_table_is_asked_once_in_a_few_seconds(monkeypatch):
    n = []

    def mounts():
        n.append(1)
        return [("office", "Production/ReShape/2026/Видео 1", "/Volumes/Видео 1")]
    monkeypatch.setattr(learning, "_mounts", mounts)
    for i in range(20):
        roughcut_job.is_reshape(f"/Volumes/Видео 1/Project/clip{i}.mov")
    assert len(n) == 1 and roughcut_job.is_reshape("/Volumes/Видео 1/Project")
    # a replaced lookup (tests, a changed environment) is never answered from the old one
    monkeypatch.setattr(learning, "_mounts", lambda: [])
    assert not roughcut_job.is_reshape("/Volumes/Видео 1/Project")


# ------------------------------------------------------------------------------------------------------ 2. shared readings

def test_a_cloud_reading_has_no_names_in_its_key_so_cut_silences_reuses_the_subtitles_sound(home, calls):
    cloudasr.save({"key": KEY})
    win = one_window(body(home))
    read_window(win, "GStroy, Георги.", *RUN, R.CLOUD)             # the subtitle run of a client with names
    assert calls["cloud"] == 1
    assert roughcut_job.read_cloud(win, asr.LARGE, *RUN)["cached"] and calls["cloud"] == 1
    # every other profile hears the prompt as it always did: the classic key is byte for byte what it was
    y, k_classic = window_audio(win, "GStroy, Георги.", R.CLASSIC)
    assert k_classic == _words_key(y, "GStroy, Георги.", "") and k_classic != _words_key(y, "", "")
    assert window_audio(win, "GStroy, Георги.")[1] == k_classic
    assert window_audio(win, "GStroy, Георги.", R.STRICT)[1] == k_classic
    assert window_audio(win, "GStroy, Георги.", R.CLOUD)[1] == _words_key(y, "", R.CLOUD.tag)


def test_a_classic_window_is_read_with_its_prompt_and_stored_under_the_prompt_key(home, calls):
    win = one_window(body(home))
    rd = read_window(win, "Решейп, Денков.", *RUN, R.CLASSIC)
    y, key = window_audio(win, "Решейп, Денков.", R.CLASSIC)
    assert rd["key"] == key == _words_key(y, "Решейп, Денков.", "") and _cached(key) and calls == {**calls, "cloud": 0, "local": 1}


def test_old_cached_cloud_readings_get_the_drawn_out_clean_up_again(home, calls):
    cloudasr.save({"key": KEY})
    win = one_window(body(home))
    _, key = window_audio(win, "", R.CLOUD)
    shout = {"word": "О" + "о" * 999 + "!", "start": 1.0, "end": 3.0, "p": 0.8}
    _store(key, {"words": [dict(shout)], "by": R.CLOUD.cloud})              # as 0.10.119 stored it
    rd = roughcut_job.read_cloud(win, asr.LARGE, *RUN)
    assert rd["cached"] and rd["entry"]["words"][0]["word"] == "Оооо!" and calls["cloud"] == 0
    assert _cached(key)["words"][0]["word"] == "Оооо!"                      # and kept cleaned
    _store(key, {"words": [dict(shout)], "by": R.CLOUD.cloud})
    rd = read_window(win, "", *RUN, R.CLOUD)
    assert rd["cached"] and rd["entry"]["words"][0]["word"] == "Оооо!"
    _store(key, {"words": [{"word": "тест", "start": 0.0, "end": 0.5, "p": 0.9}], "by": R.CLOUD.cloud})
    assert read_window(win, "", *RUN, R.CLOUD)["entry"]["words"][0]["word"] == "тест"    # a clean entry is left alone


def test_the_window_sound_is_not_kept_after_the_reading(home, calls):
    cloudasr.save({"key": KEY})
    win = one_window(body(home))
    assert "y" not in roughcut_job.read_cloud(win, asr.LARGE, *RUN) and "y" not in roughcut_job.read_rough(win, asr.LARGE, *RUN)


def test_store_writes_through_a_name_of_its_own(home, monkeypatch):
    seen = []
    real = os.replace
    monkeypatch.setattr(os, "replace", lambda a, b: seen.append(a) or real(a, b))
    _store("k1", {"words": []})
    _store("k1", {"words": []})
    assert len(seen) == 2 and seen[0] != seen[1] and all(s.endswith(".tmp") for s in seen)
    assert [f for f in os.listdir(cache_dir()) if f.endswith(".tmp")] == [] and _cached("k1") == {"words": []}


# ------------------------------------------------------------------------------------------------------ 3. what is remembered

def test_a_degraded_reading_is_not_remembered_but_a_complete_one_is(home, calls, monkeypatch):
    monkeypatch.setattr(asr, "model_present", lambda *a: False)
    cloudasr.save({"key": KEY})
    calls["fail"] = "ElevenLabs could not be reached (no internet?)"
    r1 = roughcut_job.run(body(home), *RUN)
    assert not r1["speech"]["asr"] and calls["cloud"] == 1 and roughcut_job._WORDS == {}
    calls["fail"] = None                                                   # the network is back: the next preview asks again
    r2 = roughcut_job.run({**body(home), "pacing": "calm"}, *RUN)
    assert r2["speech"]["asr"] and calls["cloud"] == 2 and len(roughcut_job._WORDS) == 1
    roughcut_job.run({**body(home), "pacing": "paced"}, *RUN)               # complete: remembered
    assert calls["cloud"] == 2
    # read on this computer after a failure: not remembered either
    monkeypatch.setattr(asr, "model_present", lambda *a: True)
    roughcut_job._WORDS.clear()
    for f in os.listdir(cache_dir()):
        os.remove(os.path.join(cache_dir(), f))
    calls["fail"] = "ElevenLabs is busy (too many requests)"
    roughcut_job.run(body(home), *RUN)
    assert calls["local"] == 1 and roughcut_job._WORDS == {}


def test_changed_footage_is_not_the_same_words(home, calls):
    cloudasr.save({"key": KEY})
    b = body(home)
    roughcut_job.run(b, *RUN)
    roughcut_job.run({**b, "pacing": "calm"}, *RUN)
    assert calls["cloud"] == 1
    st = os.stat(b["items"][0]["path"])
    os.utime(b["items"][0]["path"], ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))      # the editor re-exported the file
    roughcut_job.run({**b, "pacing": "paced"}, *RUN)
    assert len(roughcut_job._WORDS) == 2 and roughcut_job._WORDS_LOCK is not None


def test_the_remembered_words_stay_bounded_under_threads(home, monkeypatch):
    monkeypatch.setattr(roughcut_job, "build_mix", lambda d, p, c: {"segments": [], "audio": None, "origin": 0})
    monkeypatch.setattr(roughcut_job, "_words", lambda *a, **k: ([], {"asr": True}))
    monkeypatch.setattr(roughcut_job, "model", lambda fast=False: asr.LARGE)
    a = synth.write_wav(home / "z.wav", [synth.talker(2, 1)])
    errs = []

    def go(n):
        try:
            roughcut_job._silence_words([{"path": a, "start": float(n), "end": n + 1.0, "at": 0.0}], False, lambda f, m: None, lambda: False)
        except Exception as e:                                             # noqa: BLE001
            errs.append(e)
    ts = [threading.Thread(target=go, args=(n,)) for n in range(30)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errs and len(roughcut_job._WORDS) <= 4


# ------------------------------------------------------------------------------------------------------ 4. words only when used

def test_no_words_are_read_when_nothing_uses_them(home, calls):
    cloudasr.save({"key": KEY})
    res = roughcut_job.run(body(home, mode="offmic", fillers=False), *RUN)        # AI-assisted detection, no hesitations, no takes
    assert calls["cloud"] == 0 and calls["local"] == 0 and res["speech"]["words"] == 0 and not res["speech"]["asr"]
    assert "read no words" in res["speech"]["note"] and res["method"] == "ai"
    res = roughcut_job.run(body(home, mode="offmic", fillers=True), *RUN)         # hesitation sounds on: read
    assert calls["cloud"] == 1 and res["speech"]["asr"]


def test_the_ai_rough_cut_reads_the_words_for_takes_whatever_the_method(home, calls):
    cloudasr.save({"key": KEY})
    res = roughcut_job.run(body(home, mode="ai", method="manual", threshold=-45, fillers=False), *RUN)
    assert calls["cloud"] == 1 and res["speech"]["asr"] and res["speech"]["words"] == 2 and res["method"] == "manual"
    assert res["what"] == "ai"


# ------------------------------------------------------------------------------------------------------ 6. long clips

def test_a_clip_up_to_five_minutes_is_one_request_with_the_subtitles_key(home, calls):
    cloudasr.save({"key": KEY})
    roughcut_job.run(body(home, seconds=200.0), *RUN)
    assert calls["cloud"] == 1 and max(calls["cloud_s"]) >= 199
    win = one_window(body(home, seconds=200.0))                           # the subtitles' window of the same clip: same key
    assert read_window(win, "", *RUN, R.CLOUD)["cached"] and calls["cloud"] == 1


def test_a_longer_clip_is_cut_into_parts_for_the_cloud(home, calls):
    cloudasr.save({"key": KEY})
    res = roughcut_job.run(body(home, seconds=620.0), *RUN)
    assert calls["cloud"] >= 3 and max(calls["cloud_s"]) < 262 and res["speech"]["recognizer"]["windows"] == calls["cloud"]
    assert res["speech"]["recognizer"]["local"] == 0


def test_a_failed_long_window_is_read_here_in_parts_and_the_words_land_in_place(home, calls):
    cloudasr.save({"key": KEY})
    calls["fail"] = "ElevenLabs is busy (too many requests)"
    res = roughcut_job.run(body(home, seconds=200.0), *RUN)
    assert calls["cloud"] == 1 and calls["local"] >= 5 and max(calls["local_s"]) < 50
    rec = res["speech"]["recognizer"]
    assert rec["local"] == 1 and rec["fallback"] == [calls["fail"]] and res["speech"]["asr"]
    assert res["speech"]["words"] >= 5
    win = one_window(body(home, seconds=200.0))
    rd = roughcut_job._read_here_in_parts({**win, "pieces": [{"path": win["path"], "start": 0.0, "end": 200.0, "at": 0.0}]},
                                          asr.LARGE, lambda f, m: None, lambda: False)
    starts = [w["start"] for w in rd["entry"]["words"]]
    assert starts == sorted(starts) and 0.0 <= starts[0] and starts[-1] < 210.0 and len(starts) >= 5     # in order, inside the clip


def test_cloud_readers_are_at_least_four(home, calls, monkeypatch):
    cloudasr.save({"key": KEY})
    seen = []
    real = roughcut_job.ThreadPoolExecutor
    monkeypatch.setattr(roughcut_job, "ThreadPoolExecutor", lambda max_workers=None, **k: seen.append(max_workers) or real(max_workers=max_workers, **k))
    monkeypatch.setattr(asr, "workers", lambda: 2)
    six = [synth.write_wav(home / f"c{i}.wav", [synth.talker(10, i + 1)]) for i in range(6)]
    items = [{"path": a, "start": 0.0, "end": 10.0, "at": 20.0 * i, "name": f"c{i}", "track": i} for i, a in enumerate(six)]
    b = body(home)
    b["items"] = items
    b["layout"] = [{"kind": "audio", "track": i, "path": a, "start": 0.0, "end": 10.0, "inPt": 0.0, "name": "x"} for i, a in enumerate(six)]
    roughcut_job.run(b, *RUN)
    assert 4 in seen and max(seen) == 4


# ------------------------------------------------------------------------------------------------------ 7. cloudasr

def _http(code):
    return urllib.error.HTTPError(cloudasr.URL, code, "x", {}, io.BytesIO(b"{}"))


@pytest.fixture
def post(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", KEY)
    monkeypatch.setattr(cloudasr, "RETRY_WAIT", (0.0, 0.0))
    state = {"n": 0, "script": [], "delay": 0.0, "gate": None}

    def fake(audio, model, k):
        state["n"] += 1
        if state["gate"]:
            state["gate"].wait(10)
        if state["delay"]:
            time.sleep(state["delay"])
        step = state["script"].pop(0) if state["script"] else None
        if isinstance(step, Exception):
            raise step
        return {"transcription_id": "", "words": [{"text": "да", "type": "word", "start": 0.1, "end": 0.3, "logprob": 0.0}]}
    monkeypatch.setattr(cloudasr, "_post", fake)
    return state


Y = (np.sin(np.arange(16000) / 20.0) * 0.5).astype(np.float32)


def test_a_busy_server_a_server_error_or_a_timeout_is_tried_again(post):
    post["script"] = [_http(429), _http(503)]
    assert cloudasr.transcribe(Y)[0]["word"] == "да" and post["n"] == 3
    post["n"], post["script"] = 0, [TimeoutError("slow")]
    assert cloudasr.transcribe(Y) and post["n"] == 2
    post["n"], post["script"] = 0, [urllib.error.URLError(TimeoutError("slow"))]
    assert cloudasr.transcribe(Y) and post["n"] == 2


def test_a_refused_key_or_a_lasting_failure_is_not_retried_forever(post):
    post["script"] = [_http(401)]
    with pytest.raises(cloudasr.CloudError, match="key was refused"):
        cloudasr.transcribe(Y)
    assert post["n"] == 1
    post["n"], post["script"] = 0, [_http(402)]
    with pytest.raises(cloudasr.CloudError, match="no transcription time"):
        cloudasr.transcribe(Y)
    assert post["n"] == 1
    post["n"], post["script"] = 0, [_http(429)] * 5
    with pytest.raises(cloudasr.CloudError, match="busy"):
        cloudasr.transcribe(Y)
    assert post["n"] == 3                                                  # the first and two more
    post["n"], post["script"] = 0, [urllib.error.URLError("no route")]
    with pytest.raises(cloudasr.CloudError, match="could not be reached"):
        cloudasr.transcribe(Y)
    assert post["n"] == 1                                                  # no internet is not a timeout


def test_cancel_ends_the_wait_between_attempts(post, monkeypatch):
    monkeypatch.setattr(cloudasr, "RETRY_WAIT", (30.0, 30.0))
    monkeypatch.setattr(cloudasr, "CANCEL_POLL", 0.05)
    post["script"] = [_http(429)]
    from asistent.asr import Cancelled
    t0 = time.monotonic()
    with pytest.raises(Cancelled):
        cloudasr.transcribe(Y, cancelled=lambda: post["n"] >= 1)
    assert time.monotonic() - t0 < 5 and post["n"] == 1
    time.sleep(0.2)
    assert post["n"] == 1                                                  # and no second attempt after the cancel


def test_progress_is_an_estimate_while_waiting(post, monkeypatch):
    monkeypatch.setattr(cloudasr, "CANCEL_POLL", 0.05)
    post["delay"] = 0.8
    got = []
    cloudasr.transcribe(Y, progress=lambda f, m: got.append(f))
    assert got[0] == 0.0 and got[-1] == 1.0 and len(got) > 3
    mid = got[1:-1]
    assert mid and all(0.0 < f <= 0.95 for f in mid) and mid == sorted(mid)


def test_a_cancelled_upload_that_still_finishes_hands_its_words_to_on_done(post, monkeypatch):
    monkeypatch.setattr(cloudasr, "CANCEL_POLL", 0.05)
    post["gate"] = threading.Event()
    kept = []
    from asistent.asr import Cancelled
    with pytest.raises(Cancelled):
        cloudasr.transcribe(Y, cancelled=lambda: True, on_done=kept.append)
    assert kept == []
    post["gate"].set()
    for _ in range(100):
        if kept:
            break
        time.sleep(0.05)
    assert kept and kept[0][0]["word"] == "да"
    # not cancelled: the caller stores the words itself, on_done is not called a second time
    kept2 = []
    assert cloudasr.transcribe(Y, on_done=kept2.append) and kept2 == []


def test_a_cancelled_window_is_stored_for_the_next_run(home, post, monkeypatch):
    monkeypatch.setattr(cloudasr, "CANCEL_POLL", 0.05)
    win = one_window(body(home))
    post["gate"] = threading.Event()
    from asistent.asr import Cancelled
    with pytest.raises(Cancelled):
        roughcut_job.read_cloud(win, asr.LARGE, lambda f, m: None, lambda: True)
    _, key = window_audio(win, "", R.CLOUD)
    assert _cached(key) is None
    post["gate"].set()
    for _ in range(100):
        if _cached(key):
            break
        time.sleep(0.05)
    assert _cached(key)["by"] == R.CLOUD.cloud and _cached(key)["words"][0]["word"] == "да"


def test_a_long_clip_the_subtitles_already_read_whole_is_not_split_and_not_sent_again(home, calls):
    cloudasr.save({"key": KEY})
    b = body(home, seconds=620.0)
    win = one_window(b)
    read_window(win, "GStroy, Георги.", *RUN, R.CLOUD)             # the subtitle run: one whole-window reading
    assert calls["cloud"] == 1 and calls["cloud_s"][0] > 600
    res = roughcut_job.run(b, *RUN)
    assert calls["cloud"] == 1 and res["speech"]["recognizer"]["windows"] == 1 and res["speech"]["words"] == 2
