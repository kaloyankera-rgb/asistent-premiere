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


# ---- duplicates: several microphones hear the same speech, the cleanest one is recognised

def two_mics_one_voice(home, seconds=10.0):
    voice = synth.talker(seconds + 2, 11)
    clean = synth.write_wav(home / "clean.wav", [synth.mic([(voice, 1.0)], 0, seconds, gain_db=0, noise_db=-75, seed=1)])
    far = synth.write_wav(home / "far.wav", [synth.mic([(voice, 1.0)], 0, seconds, gain_db=-30, noise_db=-58, seed=2)])
    return clean, far


def test_the_cleanest_copy_of_the_same_speech_is_recognised_not_the_one_on_the_lowest_track(home):
    clean, far = two_mics_one_voice(home)
    mix = dialoguemix.build_mix([
        {"path": far, "start": 0, "end": 10, "at": 0, "name": "far", "track": 0},       # lowest track, but noisy and quiet
        {"path": clean, "start": 0, "end": 10, "at": 0, "name": "clean", "track": 1},
    ])
    assert [d["kept"] for d in mix["duplicates"]] == ["clean"] and mix["duplicates"][0]["dropped"] == "far"
    assert mix["duplicates"][0]["kept_snr_db"] > mix["duplicates"][0]["dropped_snr_db"] + 10
    assert mix["duplicates"][0]["kept_rest_seconds"] == 0
    assert rms(mix["audio"]) > 0.03                                    # the clean copy, not a sum with the weak one


def test_equally_clean_copies_keep_the_lowest_track(home):
    clean, _ = two_mics_one_voice(home)
    mix = dialoguemix.build_mix([
        {"path": clean, "start": 0, "end": 10, "at": 0, "name": "second", "track": 3},
        {"path": clean, "start": 0, "end": 10, "at": 0, "name": "first", "track": 1},
    ])
    assert [d["kept"] for d in mix["duplicates"]] == ["first"]


def test_what_the_winner_does_not_cover_is_kept_from_the_weaker_copy(home):
    voice = synth.talker(14, 11)
    clean = synth.write_wav(home / "c.wav", [synth.mic([(voice, 1.0)], 0, 6, gain_db=0, noise_db=-75, seed=1)])      # 0..6
    far = synth.write_wav(home / "f.wav", [synth.mic([(voice, 1.0)], 0, 10, gain_db=-30, noise_db=-58, seed=2)])     # 0..10
    mix = dialoguemix.build_mix([{"path": far, "start": 0, "end": 10, "at": 0, "name": "far", "track": 0},
                                 {"path": clean, "start": 0, "end": 6, "at": 0, "name": "clean", "track": 1}])
    d = mix["duplicates"][0]
    assert d["kept"] == "clean" and abs(d["kept_rest_seconds"] - 4.0) < 0.05
    assert abs(len(mix["audio"]) / 16000 - 10.0) < 0.05                # the last 4 s still exist, from the weaker copy


def test_two_different_people_talking_at_once_are_not_duplicates(home):
    s1, s2 = synth.scene(12, 3)
    a = synth.write_wav(home / "a.wav", [synth.mic([(s1, 1.0)], 0, 10, noise_db=-75, seed=1)])
    b = synth.write_wav(home / "b.wav", [synth.mic([(s2, 1.0)], 0, 10, noise_db=-75, seed=2)])
    mix = dialoguemix.build_mix([{"path": a, "start": 0, "end": 10, "at": 0, "name": "A", "track": 0},
                                 {"path": b, "start": 0, "end": 10, "at": 0, "name": "B", "track": 1}])
    assert mix["duplicates"] == []


def test_items_that_do_not_overlap_in_time_are_never_duplicates(home):
    clean, far = two_mics_one_voice(home)
    mix = dialoguemix.build_mix([{"path": clean, "start": 0, "end": 4, "at": 0, "name": "x", "track": 0},
                                 {"path": far, "start": 6, "end": 10, "at": 6, "name": "y", "track": 1}])
    assert mix["duplicates"] == []


def test_the_job_reports_duplicates_and_keeps_the_items_for_reproduction(home, monkeypatch):
    clean, far = two_mics_one_voice(home)
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: [dict(w) for w in WORDS])
    b = body(home, items=[{"path": far, "start": 0.0, "end": 10.0, "at": 0.0, "name": "far", "track": 0},
                          {"path": clean, "start": 0.0, "end": 10.0, "at": 0.0, "name": "clean", "track": 1}])
    res = subtitle_job.run(b, lambda f, m: None, lambda: False)
    assert res["duplicates"][0]["kept"] == "clean"
    with open(res["json"], encoding="utf-8") as f:
        assert [i["name"] for i in json.load(f)["items"]] == ["far", "clean"]
