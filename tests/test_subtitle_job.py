"""Phase 7 M3: the dialogue mix puts items at their sequence time, and the /subtitles job turns fake Whisper words into
an SRT (sequence times, cache, errors). Whisper itself is faked here; the real model is exercised in test_asr.py."""
import json
import os

import numpy as np
import pytest

import synth
from asistent import asr, config, dialoguemix, subtitle_job


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path / "app"))
    monkeypatch.setattr(asr, "backend_installed", lambda: True)
    monkeypatch.setattr(asr, "model_present", lambda: True)
    return tmp_path


def clip(tmp_path, name, seconds, seed):
    return synth.write_wav(tmp_path / name, [synth.talker(seconds, seed)])


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0.0


def test_items_land_at_their_sequence_time_and_the_buffer_starts_at_the_first_item(home):
    a = clip(home, "a.wav", 6, 1)
    b = clip(home, "b.wav", 4, 2)
    mix = dialoguemix.build_mix([
        {"path": a, "start": 1.0, "end": 5.0, "at": 2.0, "name": "A"},      # sequence 2..6
        {"path": b, "start": 0.0, "end": 3.0, "at": 10.0, "name": "B"},     # sequence 10..13
    ])
    x = mix["audio"]
    assert mix["origin"] == 2.0 and x.dtype == np.float32
    assert abs(len(x) / 16000 - 11.0) < 0.02                              # 2 .. 13 s
    sr = dialoguemix.ASR_SR
    assert rms(x[0:4 * sr]) > 0.01                                       # A: sequence 2..6
    assert rms(x[int(4.2 * sr):int(7.8 * sr)]) < 1e-4                    # the gap 6.2..9.8 stays silent
    assert rms(x[8 * sr:11 * sr]) > 0.01                                 # B: sequence 10..13
    assert [n["name"] for n in mix["notes"]] == ["A", "B"]


def test_overlapping_items_are_added_and_never_exceed_full_scale(home):
    a = clip(home, "a.wav", 3, 1)
    mix = dialoguemix.build_mix([{"path": a, "start": 0, "end": 3, "at": 0, "name": "1"},
                                 {"path": a, "start": 0, "end": 3, "at": 0, "name": "2"}])
    assert float(np.max(np.abs(mix["audio"]))) <= 1.0


def test_stereo_with_sound_on_one_side_uses_that_side(home):
    s = synth.talker(3, 5)
    p = synth.write_wav(home / "lav.wav", [s, np.zeros_like(s)])             # L only: a movable lavalier
    mix = dialoguemix.build_mix([{"path": p, "start": 0, "end": 3, "at": 0, "name": "lav"}])
    assert mix["notes"][0]["kind"] == "one_channel"
    assert rms(mix["audio"]) > 0.035                                        # averaging with the silent side would halve it (~0.022)


def test_a_cancel_stops_before_reading(home):
    from asistent.sync import Cancelled
    a = clip(home, "a.wav", 2, 1)
    with pytest.raises(Cancelled):
        dialoguemix.build_mix([{"path": a, "start": 0, "end": 2, "at": 0}], cancelled=lambda: True)


def body(home, items=None, **kw):
    a = clip(home, "a.wav", 4, 1)
    out = home / "project"
    out.mkdir(exist_ok=True)
    return {"items": items or [{"path": a, "start": 0.0, "end": 4.0, "at": 3.0, "name": "A"}], "out_dir": str(out),
            "name": "Моята секвенция", "fps": 25, "width": 1080, "height": 1920, **kw}


WORDS = [{"word": "Здравейте", "start": 0.5, "end": 1.0, "p": 0.95}, {"word": "приятели", "start": 1.0, "end": 1.6, "p": 0.3},
         {"word": "днес", "start": 2.4, "end": 2.8, "p": 0.9}]


def test_the_job_writes_an_srt_in_sequence_time_and_reports_flags(home, monkeypatch):
    calls = []
    monkeypatch.setattr(asr, "transcribe", lambda audio, prompt, progress, cancelled: calls.append(prompt) or [dict(w) for w in WORDS])
    res = subtitle_job.run(body(home, terms=["4a1a", "Sim Racing"]), lambda f, m: None, lambda: False)
    assert calls == ["4a1a, Sim Racing."]                                    # the user's terms are the Whisper prompt
    assert res["preset"] == "short" and res["counts"]["words"] == 3 and res["counts"]["flagged"] == 1
    first = res["captions"][0]
    assert abs(first["start"] - 3.5) < 0.05                                  # 0.5 s in the mix + origin 3.0
    with open(res["srt"], encoding="utf-8") as f:
        srt = f.read()
    assert srt.startswith("﻿1\n00:00:03,5") and "Здравейте" in srt and "приятели" in srt
    assert os.path.dirname(res["srt"]).endswith("Asistent_subtitles")
    with open(res["json"], encoding="utf-8") as f:
        data = json.load(f)
    assert data["words"][0]["start"] == 3.5 and data["origin"] == 3.0


def test_the_same_audio_is_not_recognised_twice_but_rules_apply_again(home, monkeypatch):
    n = []
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: n.append(1) or [dict(w) for w in WORDS])
    b = body(home)
    first = subtitle_job.run(b, lambda f, m: None, lambda: False)
    second = subtitle_job.run({**b, "preset": "standard", "width": 1920, "height": 1080}, lambda f, m: None, lambda: False)
    assert len(n) == 1 and second["cached"] is True and first["cached"] is False
    assert second["preset"] == "standard"


def test_a_new_prompt_means_new_recognition(home, monkeypatch):
    n = []
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: n.append(1) or [dict(w) for w in WORDS])
    b = body(home)
    subtitle_job.run(b, lambda f, m: None, lambda: False)
    subtitle_job.run({**b, "terms": ["Мерцедес"]}, lambda f, m: None, lambda: False)
    assert len(n) == 2


def test_auto_preset_follows_the_sequence_shape(home, monkeypatch):
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: [dict(w) for w in WORDS])
    assert subtitle_job.run(body(home, width=1920, height=1080), lambda f, m: None, lambda: False)["preset"] == "standard"
    assert subtitle_job.run(body(home, width=None, height=None), lambda f, m: None, lambda: False)["preset"] == "short"


def test_skipped_clips_are_passed_through_for_the_review(home, monkeypatch):
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: [dict(w) for w in WORDS])
    res = subtitle_job.run(body(home, skipped=["B (дублира A1)"]), lambda f, m: None, lambda: False)
    assert res["skipped"] == ["B (дублира A1)"]


@pytest.mark.parametrize("change, message", [
    ({"items": []}, "Маркирай"),
    ({"out_dir": "/nonexistent/folder"}, "Папката на проекта"),
    ({"preset": "huge"}, "Невалиден вид"),
    ({"fps": 0}, "Невалидна стойност"),
])
def test_bad_requests_say_what_is_wrong(home, change, message):
    with pytest.raises(ValueError, match=message):
        subtitle_job.validate({**body(home), **change})


def test_a_missing_file_is_named(home):
    with pytest.raises(ValueError, match="липсва.*nope.wav"):
        subtitle_job.validate(body(home, items=[{"path": "/x/nope.wav", "start": 0, "end": 1, "at": 0}]))


def test_missing_backend_or_model_is_an_instruction_not_a_crash(home, monkeypatch):
    monkeypatch.setattr(asr, "model_present", lambda: False)
    with pytest.raises(ValueError, match="Свали модела"):
        subtitle_job.validate(body(home))
    monkeypatch.setattr(asr, "backend_installed", lambda: False)
    with pytest.raises(ValueError, match="faster-whisper"):
        subtitle_job.validate(body(home))


def test_cancelled_recognition_writes_nothing(home, monkeypatch):
    from asistent.sync import Cancelled

    def boom(audio, prompt, progress, cancelled):
        raise Cancelled()
    monkeypatch.setattr(asr, "transcribe", boom)
    b = body(home)
    with pytest.raises(Cancelled):
        subtitle_job.run(b, lambda f, m: None, lambda: False)
    assert not os.path.exists(os.path.join(b["out_dir"], "Asistent_subtitles"))
