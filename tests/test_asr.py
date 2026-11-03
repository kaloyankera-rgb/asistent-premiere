"""Speech recognition wrapper (Phase 7 M2): model handling and the transcribe loop with a fake model. The real model
is exercised in the last test, which is skipped where it is not installed (this Mac, after the user's download)."""
import os
import time
import types
import wave

import numpy as np
import pytest

from asistent import asr, config
from asistent.sync import Cancelled


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    monkeypatch.setitem(asr._state, "model", None)
    return tmp_path


def fake_model(words_by_segment):
    def seg(ws):
        return types.SimpleNamespace(end=ws[-1][2], words=[types.SimpleNamespace(word=w, start=s, end=e, probability=p)
                                                           for w, s, e, p in ws])
    calls = {}

    def transcribe(audio, **kw):
        calls.update(kw)
        return (seg(ws) for ws in words_by_segment), None
    return types.SimpleNamespace(transcribe=transcribe), calls


def test_status_says_what_is_missing(home):
    st = asr.model_status()
    assert st["model"] is False and st["bytes"] == 0 and st["dir"] == str(home / "models" / "whisper")
    d = home / "models" / "whisper"
    d.mkdir(parents=True)
    for f in asr.MODEL_FILES:
        (d / f).write_bytes(b"x" * 10)
    st = asr.model_status()
    assert st["model"] is True and st["bytes"] == 10 * len(asr.MODEL_FILES)


def test_a_missing_model_is_an_error_with_a_message_never_a_download(home, monkeypatch):
    monkeypatch.setattr(asr, "backend_installed", lambda: True)
    with pytest.raises(asr.ASRError, match="not downloaded yet"):
        asr.transcribe(np.zeros(16000, dtype=np.float32))
    assert not (home / "models").exists() or not any((home / "models").rglob("model.bin"))     # nothing fetched


def test_a_missing_backend_is_an_error_with_a_message(home, monkeypatch):
    monkeypatch.setattr(asr, "backend_installed", lambda: False)
    with pytest.raises(asr.ASRError, match="faster-whisper"):
        asr.transcribe(np.zeros(16000, dtype=np.float32))


def test_transcribe_returns_words_in_the_shape_subtitles_takes(home, monkeypatch):
    model, calls = fake_model([[("Здравей", 0.1, 0.6, 0.93), (" свят", 0.7, 1.1, 0.41)], [(" ", 1.2, 1.3, 0.9), ("пак", 1.4, 1.8, 0.8)]])
    monkeypatch.setattr(asr, "_load", lambda: model)
    seen = []
    words = asr.transcribe(np.zeros(32000, dtype=np.float32), prompt="4a1a Racing.", progress=lambda f, m: seen.append(f))
    assert words == [{"word": "Здравей", "start": 0.1, "end": 0.6, "p": 0.93}, {"word": "свят", "start": 0.7, "end": 1.1, "p": 0.41},
                     {"word": "пак", "start": 1.4, "end": 1.8, "p": 0.8}]
    assert calls["language"] == "bg" and calls["word_timestamps"] is True and calls["initial_prompt"] == "4a1a Racing."
    assert seen[-1] == pytest.approx(0.9, abs=0.01) and seen == sorted(seen)               # per segment, never backwards


def test_cancel_stops_at_the_next_segment(home, monkeypatch):
    model, _ = fake_model([[("а", 0, 0.5, 1.0)], [("б", 0.5, 1.0, 1.0)], [("в", 1.0, 1.5, 1.0)]])
    monkeypatch.setattr(asr, "_load", lambda: model)
    n = {"k": 0}

    def cancelled():
        n["k"] += 1
        return n["k"] > 3
    with pytest.raises(Cancelled):
        asr.transcribe(np.zeros(24000, dtype=np.float32), cancelled=cancelled)


def test_read_wav_wants_16k_mono(tmp_path):
    for rate, ch, ok in ((16000, 1, True), (44100, 1, False), (16000, 2, False)):
        p = tmp_path / f"{rate}_{ch}.wav"
        with wave.open(str(p), "wb") as w:
            w.setnchannels(ch)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes((np.zeros(1600 * ch, dtype=np.int16)).tobytes())
        if ok:
            assert asr.read_wav(str(p)).dtype == np.float32
        else:
            with pytest.raises(asr.ASRError):
                asr.read_wav(str(p))


def test_download_needs_the_backend_and_reports_failures(home, monkeypatch):
    monkeypatch.setattr(asr, "backend_installed", lambda: False)
    with pytest.raises(asr.ASRError, match="packages"):
        asr.download_model(lambda f, m: None, lambda: False)


REAL = os.path.expanduser("~/Library/Application Support/Asistent/models/whisper")


@pytest.mark.skipif(not os.path.isfile(os.path.join(REAL, "model.bin")) or not asr.backend_installed(),
                    reason="large-v3 model not downloaded on this machine")
def test_the_real_model_hears_bulgarian(monkeypatch):
    """Spoken Bulgarian from a client clip (read only); logs the speed. Nothing here is a Premiere check."""
    import subprocess
    src = os.path.expanduser("~/Kaloyan/01_CLIENTS/The Pact/GStroy/Media/GStroy brand/9x16/fx3/fx39011.MP4")
    if not os.path.isfile(src):
        pytest.skip("client clip not on this machine")
    wav = os.path.join(os.path.dirname(__file__), "_asr_test.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-t", "20", "-ac", "1", "-ar", "16000", wav], check=True)
    try:
        t0 = time.time()
        words = asr.transcribe(asr.read_wav(wav))
        took = time.time() - t0
    finally:
        os.remove(wav)
    print(f"\nreal ASR: {len(words)} words from 20 s in {took:.1f} s")
    assert len(words) >= 4
    assert any("а" <= c <= "я" for w in words for c in w["word"].lower())             # Cyrillic out
    assert all(type(w["start"]) is float and type(w["p"]) is float for w in words)
    assert all(0 <= w["start"] <= w["end"] <= 21 and 0 <= w["p"] <= 1 for w in words)
