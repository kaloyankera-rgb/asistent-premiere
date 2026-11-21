"""Recognition by ElevenLabs (engine/asistent/cloudasr.py, 0.10.119). No test reaches the network: urlopen is replaced."""
import io
import json
import os
import urllib.error
import wave

import numpy as np
import pytest

from asistent import asr, cloudasr, recognition as R, subtitle_job
from test_recognition_profiles import RUN, WORDS, body, home, saved  # noqa: F401 - `home` is a fixture


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*a, **k):
        raise AssertionError("a test tried to reach the network")
    monkeypatch.setattr(cloudasr.urllib.request, "urlopen", refuse)
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("ASISTENT_RECOGNITION", raising=False)


KEY = "sk_" + "a1" * 20


def test_no_key_means_this_computer_and_a_saved_key_means_elevenlabs_but_never_for_reshape(home):
    assert not cloudasr.available() and R.for_preset("auto") is R.DEFAULT
    cloudasr.save({"key": KEY})
    assert cloudasr.available()
    for preset in ("auto", "short", "gstroy", "credissimo", "ekopak", "beautysector", "aula"):
        assert R.for_preset(preset) is R.CLOUD
    assert R.for_preset("reshape") is R.CLASSIC
    cloudasr.save({"enabled": False})                           # the switch: the key stays, nothing is sent
    assert not cloudasr.available() and R.for_preset("auto") is R.DEFAULT
    cloudasr.save({"enabled": True})
    cloudasr.save({"key": ""})
    assert not cloudasr.available() and cloudasr.status() == {"key": False, "ends": "", "enabled": True, "on": False, "name": cloudasr.NAME}


def test_the_key_stays_in_the_engine(home):
    st = cloudasr.save({"key": "  " + KEY + "\n"})
    assert st["key"] and st["ends"] == KEY[-4:] and KEY not in json.dumps(st)
    path = os.path.join(cloudasr.config.app_dir(), "elevenlabs.key")
    with open(path, encoding="utf-8") as f:
        assert f.read() == KEY and (os.stat(path).st_mode & 0o777) == 0o600
    for bad in ("short", "has a space in the middle of it 1234567890"):
        with pytest.raises(ValueError):
            cloudasr.save({"key": bad})
    assert cloudasr.key() == KEY                                # a refused key replaces nothing


def test_scribes_answer_becomes_words_like_whispers():
    data = {"words": [{"text": "Здравейте,", "type": "word", "start": 0.5, "end": 1.0, "logprob": -0.105},
                      {"text": " ", "type": "spacing", "start": 1.0, "end": 1.1, "logprob": 0.0},
                      {"text": "(смях)", "type": "audio_event", "start": 1.1, "end": 1.5, "logprob": -1.0},
                      {"text": "приятели.", "type": "word", "start": 1.5, "end": 2.1234, "logprob": None},
                      {"text": "без", "type": "word", "start": None, "end": None, "logprob": -0.1}]}
    assert cloudasr.words_of(data) == [{"word": "Здравейте,", "start": 0.5, "end": 1.0, "p": 0.9},
                                       {"word": "приятели.", "start": 1.5, "end": 2.123, "p": 1.0}]


def test_a_shout_written_out_letter_by_letter_is_cut_short_and_never_reaches_the_dictionarys_search():
    """2026-11-21, the user's first run in Premiere: Scribe wrote „Ооо…“ with 1000 letters and the engine froze for minutes."""
    import time
    from asistent import lexicon
    data = {"words": [{"text": "О" + "о" * 999 + "!", "type": "word", "start": 0.0, "end": 3.0, "logprob": -0.2}]}
    assert cloudasr.words_of(data)[0]["word"] == "Оооо!"                       # the capital and three of the letter
    t = time.time()
    assert lexicon._candidates("о" * 300, True, True) is None and lexicon._candidates("о" * 300, True, False) is None
    assert time.time() - t < 1.0


def test_what_is_sent_is_the_sound_alone(home, monkeypatch):
    cloudasr.save({"key": KEY})
    sent = []

    class Answer(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake(req, timeout=None):
        sent.append(req)
        if req.get_method() == "DELETE":
            return Answer(b"{}")
        return Answer(json.dumps({"transcription_id": "t1", "words": [{"text": "да", "type": "word", "start": 0.1, "end": 0.3, "logprob": 0.0}]}).encode())
    monkeypatch.setattr(cloudasr.urllib.request, "urlopen", fake)
    y = (np.sin(np.arange(16000) / 20.0) * 0.5).astype(np.float32)
    assert cloudasr.transcribe(y) == [{"word": "да", "start": 0.1, "end": 0.3, "p": 1.0}]
    post, delete = sent
    assert post.full_url == cloudasr.URL and post.get_header("Xi-api-key") == KEY
    form = post.data
    for field in (b'name="model_id"\r\n\r\nscribe_v3', b'name="language_code"\r\n\r\nbul', b'name="timestamps_granularity"\r\n\r\nword',
                  b'name="diarize"\r\n\r\nfalse', b'filename="window.wav"'):
        assert field in form
    assert form.count(b"Content-Disposition") == 6               # five settings and the sound: no prompt, no names, no paths
    with wave.open(io.BytesIO(form[form.index(b"RIFF"):])) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()) == (16000, 1, 2, 16000)
    # the transcript is deleted at ElevenLabs as soon as the words are back (it keeps uploads by default)
    assert delete.get_method() == "DELETE" and delete.full_url == cloudasr.URL + "/transcripts/t1"


def test_a_refusal_becomes_a_reason_for_the_editor_without_the_key(home, monkeypatch):
    cloudasr.save({"key": KEY})
    y = np.zeros(16000, dtype=np.float32)

    def refused(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 401, "no", {}, io.BytesIO(json.dumps({"detail": {"status": "invalid_api_key", "message": KEY}}).encode()))
    monkeypatch.setattr(cloudasr.urllib.request, "urlopen", refused)
    with pytest.raises(cloudasr.CloudError) as e:
        cloudasr.transcribe(y)
    assert "key was refused" in str(e.value) and KEY not in str(e.value)

    def offline(req, timeout=None):
        raise urllib.error.URLError("no route")
    monkeypatch.setattr(cloudasr.urllib.request, "urlopen", offline)
    with pytest.raises(cloudasr.CloudError, match="could not be reached"):
        cloudasr.transcribe(y)
    cloudasr.save({"key": ""})
    with pytest.raises(cloudasr.CloudError, match="no ElevenLabs key"):
        cloudasr.transcribe(y)


def test_a_run_with_a_key_is_read_by_elevenlabs_and_a_reshape_run_never_is(home, monkeypatch):
    cloudasr.save({"key": KEY})
    heard = []
    monkeypatch.setattr(cloudasr, "transcribe", lambda y, progress, cancelled, model, **kw: heard.append(model) or [dict(w) for w in WORDS])
    local = []
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: local.append(1) or [dict(w) for w in WORDS])
    res = subtitle_job.run(body(home), *RUN)
    assert heard == ["scribe_v3"] and local == []
    assert res["recognizer"] == {"name": cloudasr.NAME, "windows": 1, "local": 0, "fallback": []}
    assert saved(res)["profile"] == "cloud" and res["readings"]["second_opinions"] == []
    res = subtitle_job.run(body(home, preset="reshape"), *RUN)
    assert heard == ["scribe_v3"] and local == [1] and "recognizer" not in res        # nothing of ReShape's leaves the computer


def test_when_elevenlabs_fails_the_window_is_read_here_and_the_result_says_so(home, monkeypatch):
    cloudasr.save({"key": KEY})

    def down(y, progress, cancelled, model, **kw):
        raise cloudasr.CloudError("ElevenLabs could not be reached (no internet?)")
    monkeypatch.setattr(cloudasr, "transcribe", down)
    local = []
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: local.append(1) or [dict(w) for w in WORDS])
    res = subtitle_job.run(body(home), *RUN)
    assert local and res["counts"]["words"] == len(WORDS)
    assert res["recognizer"] == {"name": cloudasr.NAME, "windows": 1, "local": 1, "fallback": ["ElevenLabs could not be reached (no internet?)"]}
    # the local reading was not stored as ElevenLabs': the next run asks again
    asked = []
    monkeypatch.setattr(cloudasr, "transcribe", lambda y, progress, cancelled, model, **kw: asked.append(1) or [dict(w) for w in WORDS])
    res = subtitle_job.run(body(home), *RUN)
    assert asked == [1] and res["recognizer"]["local"] == 0
