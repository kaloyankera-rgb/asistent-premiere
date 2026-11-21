"""Cut silences' words by ElevenLabs (roughcut_job.read_cloud / use_cloud, 0.10.121): AI-assisted detection reads through
Scribe when a key is saved and the switch is on, never in a ReShape project; a window ElevenLabs cannot read is read on
this computer; a reading is shared with the subtitles. No test reaches the network: urlopen refuses, transcribe is faked."""
import os

import pytest

import synth
from asistent import asr, cloudasr, config, learning, recognition as R, roughcut_job
from asistent.subtitle_job import _cached, _store, cache_dir, plan_windows, window_audio

KEY = "sk_" + "b2" * 20
SCRIBE = [{"word": "Днес", "start": 4.3, "end": 4.7, "p": 0.97}, {"word": "ъъъ", "start": 5.6, "end": 6.1, "p": 0.9},
          {"word": "започваме", "start": 6.9, "end": 7.6, "p": 0.95}]


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
    """Fake readers: what was sent to ElevenLabs and what was read here."""
    seen = {"cloud": 0, "local": 0, "fail": None}

    def scribe(y, progress=None, cancelled=None, model=cloudasr.MODEL):
        seen["cloud"] += 1
        if seen["fail"]:
            raise cloudasr.CloudError(seen["fail"])
        return [dict(w) for w in SCRIBE]

    def whisper(y, prompt=None, progress=None, cancelled=None, **kw):
        seen["local"] += 1
        return [{"word": "днес", "start": 4.3, "end": 4.7, "p": 0.9}]
    monkeypatch.setattr(cloudasr, "transcribe", scribe)
    monkeypatch.setattr(asr, "transcribe", whisper)
    return seen


def body(home, folder="Clients/GStroy/Video 3"):
    a = synth.write_wav(home / "m1.wav", [synth.talker(10, 2)])
    out = home / folder
    out.mkdir(parents=True, exist_ok=True)
    lay = [{"kind": k, "track": 0, "path": a, "start": 0.0, "end": 10.0, "inPt": 0.0, "name": "m1"} for k in ("video", "audio")]
    return {"items": [{"path": a, "start": 0.0, "end": 10.0, "at": 0.0, "name": "m1", "track": 0}], "layout": lay,
            "out_dir": str(out), "name": "тест", "fps": 30, "width": 1080, "height": 1920, "mode": "ai", "method": "ai",
            "pacing": "measured", "fillers": True, "preview": True}


RUN = (lambda f, m: None, lambda: False)


def test_reshape_is_known_by_its_folder_also_behind_a_deeper_mount(monkeypatch):
    for path in ("/Volumes/Production/ReShape/Видео 4", "/Users/x/01_CLIENTS/The Pact/Re-Shape/v2",
                 "/Users/x/Клиенти/Решейп/2", "/Volumes/Production/Dr.Denkov/Reel 3"):
        assert roughcut_job.is_reshape(path), path
    for path in ("/Volumes/Production/GStroy/Видео 3", "/Users/x/01_CLIENTS/4a1a Racing", "", "/Users/x/reshoot day"):
        assert not roughcut_job.is_reshape(path), path
    # Finder mounted Production/ReShape/2026/Видео 1 as its own volume: the folder name alone does not say ReShape
    monkeypatch.setattr(learning, "_mounts", lambda: [("office", "Production/ReShape/2026/Видео 1", "/Volumes/Видео 1")])
    assert roughcut_job.is_reshape("/Volumes/Видео 1/Project") and not roughcut_job.is_reshape("/Volumes/Видео 2/Project")


def test_ai_words_come_from_elevenlabs_when_a_key_is_saved(home, calls):
    cloudasr.save({"key": KEY})
    res = roughcut_job.run(body(home), *RUN)
    assert calls == {"cloud": 1, "local": 0, "fail": None}
    sp = res["speech"]
    assert sp["asr"] and sp["words"] == 3
    assert sp["recognizer"] == {"name": cloudasr.NAME, "windows": 1, "local": 0, "missed": 0, "fallback": []}
    assert res["by_kind"].get("filler", 0) >= 0                    # the plan ran with Scribe's words (a hesitation among them)
    # a changed setting reads nothing again (remembered words), and neither does a new engine (the cache on disk)
    roughcut_job.run({**body(home), "pacing": "calm"}, *RUN)
    roughcut_job._WORDS.clear()
    again = roughcut_job.run(body(home), *RUN)
    assert calls["cloud"] == 1 and again["speech"]["recognizer"]["windows"] == 1


def test_no_key_switch_off_or_reshape_reads_on_this_computer(home, calls):
    res = roughcut_job.run(body(home), *RUN)                       # no key
    assert calls["cloud"] == 0 and calls["local"] == 1 and res["speech"]["recognizer"] is None
    cloudasr.save({"key": KEY})
    cloudasr.save({"enabled": False})                              # the switch
    roughcut_job._WORDS.clear()
    roughcut_job.run(body(home, "Clients/GStroy/Video 4"), *RUN)
    assert calls["cloud"] == 0
    cloudasr.save({"enabled": True})
    roughcut_job._WORDS.clear()
    res = roughcut_job.run(body(home, "Production/ReShape/Видео 9"), *RUN)
    assert calls["cloud"] == 0 and res["speech"]["recognizer"] is None and res["speech"]["asr"]


def test_auto_detection_never_sends_anything(home, calls):
    cloudasr.save({"key": KEY})
    res = roughcut_job.run({**body(home), "mode": "offmic", "method": "auto", "fillers": False}, *RUN)
    assert calls["cloud"] == 0 and calls["local"] == 0 and res["speech"]["words"] == 0


def test_a_window_elevenlabs_cannot_read_is_read_here_and_the_result_says_why(home, calls):
    cloudasr.save({"key": KEY})
    calls["fail"] = "ElevenLabs could not be reached (no internet?)"
    res = roughcut_job.run(body(home), *RUN)
    assert calls["cloud"] == 1 and calls["local"] == 1
    rec = res["speech"]["recognizer"]
    assert rec["local"] == 1 and rec["missed"] == 0 and rec["fallback"] == [calls["fail"]] and res["speech"]["asr"]


def test_without_a_model_here_a_failed_window_has_no_words_and_says_so(home, calls, monkeypatch):
    monkeypatch.setattr(asr, "model_present", lambda *a: False)
    cloudasr.save({"key": KEY})
    calls["fail"] = "the ElevenLabs account has no transcription time left this month"
    res = roughcut_job.run(body(home), *RUN)
    assert calls["local"] == 0 and not res["speech"]["asr"] and res["speech"]["recognizer"]["missed"] == 1
    assert "ElevenLabs could not read" in res["speech"]["note"]


def test_the_reading_is_the_subtitles_own(home, calls):
    """Same sound, same request, same key: a window the subtitles sent is not sent again, and the other way round."""
    cloudasr.save({"key": KEY})
    b = body(home)
    win = plan_windows([{"path": b["items"][0]["path"], "start": 0.0, "end": 10.0, "at": 0.0}])[0]
    _, key = window_audio(win, "", R.CLOUD)
    _store(key, {"words": [dict(w) for w in SCRIBE], "by": R.CLOUD.cloud})        # as subtitle_job.read_window stores it
    assert roughcut_job.read_cloud(win, asr.LARGE, *RUN)["cached"] and calls["cloud"] == 0
    os.remove(os.path.join(cache_dir(), key + ".json"))
    rd = roughcut_job.read_cloud(win, asr.LARGE, *RUN)                            # Cut silences first: the subtitles find it
    assert not rd["cached"] and calls["cloud"] == 1 and _cached(key)["by"] == R.CLOUD.cloud
