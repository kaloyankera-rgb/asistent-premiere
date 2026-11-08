"""Phase 7 M3: the dialogue mix puts items at their sequence time, and the /subtitles job turns fake Whisper words into
an SRT (sequence times, cache, errors). Whisper itself is faked here; the real model is exercised in test_asr.py."""
import json
import os

import numpy as np
import pytest

import synth
from asistent.consensus import norm as consensus_norm
from asistent import align, asr, config, dialoguemix, subtitle_job


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path / "app"))
    monkeypatch.setattr(asr, "backend_installed", lambda: True)
    monkeypatch.setattr(asr, "model_present", lambda: True)
    return tmp_path


REAL_UNHEARD = align.unheard
REAL_TRIM = align.trim_silence


@pytest.fixture(autouse=True)
def words_need_no_sound(monkeypatch):
    """The fake Whisper words of these tests are not tied to the synthetic audio; the real check has its own test."""
    monkeypatch.setattr(align, "unheard", lambda y, ws, sr=16000: ([dict(w) for w in ws], []))
    monkeypatch.setattr(align, "available", lambda: False)             # tests that need the aligner switch it on themselves
    monkeypatch.setattr(align, "trim_silence", lambda y, ws, sr=16000: ([dict(w) for w in ws], 0))


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
    monkeypatch.setattr(asr, "transcribe", lambda audio, prompt, progress, cancelled, **k: calls.append(prompt) or [dict(w) for w in WORDS])
    res = subtitle_job.run(body(home, terms=["4a1a", "Sim Racing"]), lambda f, m: None, lambda: False)
    assert calls == ["4a1a, Sim Racing."]                                    # the user's terms are the Whisper prompt
    assert res["preset"] == "short" and res["counts"]["words"] == 3 and res["counts"]["flagged"] == 1
    first = res["captions"][0]
    assert abs(first["start"] - 3.5) < 0.05                                  # 0.5 s in the mix + origin 3.0
    with open(res["srt"], encoding="utf-8") as f:
        srt = f.read()
    assert srt.startswith("﻿1\n00:00:03,") and "Здравейте" in srt and "приятели" in srt
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
    ({"items": []}, "Select"),
    ({"out_dir": "/nonexistent/folder"}, "project folder"),
    ({"preset": "huge"}, "Invalid subtitle style"),
    ({"fps": 0}, "Invalid value"),
])
def test_bad_requests_say_what_is_wrong(home, change, message):
    with pytest.raises(ValueError, match=message):
        subtitle_job.validate({**body(home), **change})


def test_a_missing_file_is_named(home):
    with pytest.raises(ValueError, match="missing.*nope.wav"):
        subtitle_job.validate(body(home, items=[{"path": "/x/nope.wav", "start": 0, "end": 1, "at": 0}]))


def test_missing_backend_or_model_is_an_instruction_not_a_crash(home, monkeypatch):
    monkeypatch.setattr(asr, "model_present", lambda: False)
    with pytest.raises(ValueError, match="Download the model"):
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


# ---- per piece with context, and the optional alignment

def two_pieces(home):
    voice = synth.talker(30, 21)
    f = synth.write_wav(home / "long.wav", [synth.mic([(voice, 1.0)], 0, 30, noise_db=-75, seed=1)])
    return f, [{"path": f, "start": 4.0, "end": 8.0, "at": 0.0, "name": "one", "track": 0},
               {"path": f, "start": 14.0, "end": 18.0, "at": 4.0, "name": "two", "track": 0}]


def test_pieces_of_one_file_that_lie_close_share_one_reading_with_context_around_them(home, monkeypatch):
    """Two pieces at media 4-8 s and 14-18 s: with 4 s of context their windows overlap, so Whisper reads 0-22 s once."""
    f, its = two_pieces(home)
    seen = []

    def fake(audio, prompt, progress, cancelled, **k):
        seen.append(len(audio) / 16000)
        return [{"word": "едно", "start": 5.0, "end": 5.5, "p": 0.9}, {"word": "извън", "start": 11.0, "end": 11.5, "p": 0.9},
                {"word": "две", "start": 15.0, "end": 15.5, "p": 0.9}]
    monkeypatch.setattr(asr, "transcribe", fake)
    res = subtitle_job.run(body(home, items=its), lambda f, m: None, lambda: False)
    assert len(seen) == 1 and abs(seen[0] - 22.0) < 0.05                          # 4-4 .. 18+4, once
    assert res["counts"]["pieces"] == 2 and res["readings"]["windows"] == 1
    with open(res["json"], encoding="utf-8") as fh:
        assert [(w["word"], round(w["start"], 1)) for w in json.load(fh)["words"]] == [("едно", 1.0), ("две", 5.0)]   # the cut-out "извън" is dropped


def test_windows_are_planned_per_file_and_far_pieces_are_read_apart():
    seg = lambda path, a, b: {"path": path, "start": a, "end": b, "at": 0.0}
    w = subtitle_job.plan_windows([seg("x", 4, 8), seg("x", 14, 18), seg("x", 60, 64), seg("y", 4, 8)])
    assert [(x["path"], x["a"], x["b"], len(x["pieces"])) for x in w] == [("x", 0.0, 22.0, 2), ("x", 56.0, 68.0, 1), ("y", 0.0, 12.0, 1)]
    long = [seg("x", 0, 100), seg("x", 110, 200)]                                   # never one reading of more than MAX_WINDOW
    assert len(subtitle_job.plan_windows(long)) == 2


def test_words_in_the_context_outside_the_piece_are_dropped(home, monkeypatch):
    f, its = two_pieces(home)
    words = [{"word": "преди", "start": 2.2, "end": 2.8, "p": 0.9}, {"word": "вътре", "start": 6.0, "end": 6.5, "p": 0.9},
             {"word": "след", "start": 10.0, "end": 10.6, "p": 0.9}]
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: [dict(w) for w in words])
    res = subtitle_job.run(body(home, items=its[:1]), lambda f, m: None, lambda: False)
    with open(res["json"], encoding="utf-8") as fh:
        assert [w["word"] for w in json.load(fh)["words"]] == ["вътре"]


def test_a_word_cut_in_half_by_the_piece_edge_stays_when_most_of_it_is_inside():
    w = {"start": 1.9, "end": 2.5}                               # lead 2.0: 0.5 of 0.6 s inside
    assert subtitle_job._inside(w, 2.0, 6.0) and not subtitle_job._inside({"start": 1.0, "end": 2.2}, 2.0, 6.0)


def test_the_aligner_moves_the_words_to_when_they_are_said(home, monkeypatch):
    f, its = two_pieces(home)
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: [{"word": "дума", "start": 5.0, "end": 5.5, "p": 0.9}])
    monkeypatch.setattr(align, "available", lambda: True)
    monkeypatch.setattr(align, "align_words", lambda y, ws, sp=None: ([dict(w, start=w["start"] + 0.3, end=w["end"] + 0.1,
                                                                            aligned=True) for w in ws], {"aligned": 1, "weak": 0}))
    res = subtitle_job.run(body(home, items=its[:1]), lambda f, m: None, lambda: False)
    assert res["timing"]["method"] == "aligned" and res["timing"]["aligned"] == 1
    assert abs(res["captions"][0]["start"] - 1.3) < 0.05          # 5.0 + 0.3 - 4.0 (the piece starts at media 4 s)


def test_a_failed_alignment_keeps_whisper_times_and_says_so(home, monkeypatch):
    f, its = two_pieces(home)
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: [{"word": "дума", "start": 5.0, "end": 5.5, "p": 0.9}])
    monkeypatch.setattr(align, "available", lambda: True)
    monkeypatch.setattr(align, "align_words", lambda y, ws, sp=None: (ws, {"error": "torch missing"}))
    res = subtitle_job.run(body(home, items=its[:1]), lambda f, m: None, lambda: False)
    assert res["timing"] == {"method": "whisper", "aligned": 0, "weak": 0, "error": "torch missing"}
    assert abs(res["captions"][0]["start"] - 1.0) < 0.05


def test_the_cache_keeps_recognition_and_alignment_apart(home, monkeypatch):
    f, its = two_pieces(home)
    n = {"asr": 0, "align": 0}

    def fake_asr(*a, **k):
        n["asr"] += 1
        return [{"word": "дума", "start": 5.0, "end": 5.5, "p": 0.9}]

    def fake_align(y, ws, sp=None):
        n["align"] += 1
        return [dict(w, aligned=True) for w in ws], {"aligned": 1, "weak": 0}
    monkeypatch.setattr(asr, "transcribe", fake_asr)
    b = body(home, items=its[:1])
    subtitle_job.run(b, lambda f, m: None, lambda: False)                      # no aligner: recognition cached
    monkeypatch.setattr(align, "available", lambda: True)
    monkeypatch.setattr(align, "align_words", fake_align)
    subtitle_job.run(b, lambda f, m: None, lambda: False)                      # aligner appears: no second recognition
    subtitle_job.run(b, lambda f, m: None, lambda: False)                      # and the alignment is cached too
    assert n == {"asr": 1, "align": 1}


def test_align_wrapper_without_the_optional_install_is_a_quiet_fallback(home, monkeypatch):
    monkeypatch.delenv("ASISTENT_ALIGN_PYTHON", raising=False)
    ws = [{"word": "а", "start": 0.0, "end": 0.2, "p": 1.0}]
    out, info = align.align_words(__import__("numpy").zeros(16000, "float32"), ws)
    assert out == ws and "not installed" in info["error"] and align.status()["available"] is False


def test_weak_and_letterless_words_keep_whisper_times_and_order_stays_monotonic():
    ws = [{"word": "един", "start": 1.0, "end": 1.4}, {"word": "25", "start": 1.4, "end": 1.9}, {"word": "две", "start": 2.0, "end": 2.2}]
    res = [{"start": 1.2, "end": 1.5, "align": 0.9}, {"start": None, "end": None, "align": 0.0}, {"start": 1.1, "end": 2.4, "align": 0.8}]
    out, weak = align._fix(ws, res)
    assert weak == 1 and out[1]["start"] == 1.4 and out[1]["aligned"] is False
    assert [w["start"] for w in out] == sorted(w["start"] for w in out) and out[2]["start"] >= out[1]["start"]


def test_a_weak_word_is_fitted_between_its_aligned_neighbours_and_never_overlaps_them():
    """Seen on the real clip: a corrected word the aligner could not find started 80 ms inside the word before it."""
    ws = [{"word": "стена", "start": 8.0, "end": 8.3}, {"word": "трябваше", "start": 8.1, "end": 8.9},
          {"word": "да", "start": 8.9, "end": 9.0}]
    res = [{"start": 8.38, "end": 8.62, "align": 0.9}, {"start": None, "end": None, "align": 0.0}, {"start": 8.94, "end": 8.98, "align": 0.8}]
    out, weak = align._fix(ws, res)
    assert weak == 1 and out[1]["aligned"] is False
    assert out[1]["start"] == 8.62 and out[1]["end"] == 8.9                         # starts where „стена“ ends, ends before „да“
    assert all(a["end"] <= b["start"] + 1e-9 for a, b in zip(out, out[1:]))


def test_the_job_applies_corrections_before_alignment_and_leaves_every_form_as_heard(home, monkeypatch):
    """Corrections go into the aligner (new words get their time from the sound); no word is rewritten otherwise (both speakers are in one edit)."""
    f, its = two_pieces(home)
    heard = [{"word": "един", "start": 4.5, "end": 4.8, "p": 0.9}, {"word": "раф", "start": 4.8, "end": 5.1, "p": 0.89},
             {"word": "съм", "start": 5.3, "end": 5.5, "p": 0.9}, {"word": "свършила.", "start": 5.5, "end": 6.0, "p": 0.9}]   # the piece starts at media 4 s
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: [dict(w) for w in heard])
    monkeypatch.setattr(subtitle_job.lexicon, "known", lambda w: w.strip(".,") in {"един", "рафт", "съм", "свършил", "свършила"})
    seen = {}

    def fake_align(y, ws, sp=None):
        seen["words"] = [w["word"] for w in ws]
        return [dict(w, aligned=True, align=0.9, start=w["start"] + 0.01, end=w["end"] + 0.01) for w in ws], {"aligned": len(ws), "weak": 0}
    monkeypatch.setattr(align, "available", lambda: True)
    monkeypatch.setattr(align, "align_words", fake_align)
    b = dict(body(home, items=its[:1]), text="раф => рафт\nабсолютно друго => нещо")
    res = subtitle_job.run(b, lambda f, m: None, lambda: False)
    text = " ".join(c["text"].replace("\n", " ") for c in res["captions"])
    assert seen["words"] == ["един", "рафт", "съм", "свършила."]                      # the aligner got the corrected words
    assert "рафт" in text and "свършила" in text and "свършил " not in text + " "          # the form is kept as heard
    assert res["corrections"] == [{"heard": "раф", "said": "рафт", "applied": 1}, {"heard": "абсолютно друго", "said": "нещо", "applied": 0}]
    assert "gender" not in res


def _voice_after_silence():
    """16 kHz audio: 0-1.0 s silence (-70 dB), voice 1.0-2.0 s (loud), silence 2.0-3.0 s."""
    sr = 16000
    t = np.arange(3 * sr) / sr
    y = (np.random.default_rng(3).standard_normal(3 * sr) * 3e-4).astype(np.float32)
    v = (0.2 * np.sin(2 * np.pi * 150 * t) * ((t >= 1.0) & (t < 2.0))).astype(np.float32)
    return y + v


def test_a_word_is_not_spoken_in_silence_its_edges_move_to_where_the_voice_is():
    y = _voice_after_silence()
    out, moved = REAL_TRIM(y, [{"word": "Ей,", "start": 0.6, "end": 2.4}])
    assert moved == 2 and abs(out[0]["start"] - 1.0) < 0.03 and abs(out[0]["end"] - 2.0) < 0.03


def test_words_with_voice_in_them_are_left_alone_and_the_input_is_not_changed():
    y = _voice_after_silence()
    ws = [{"word": "а", "start": 1.0, "end": 1.5}, {"word": "б", "start": 1.45, "end": 2.0}, {"word": "в", "start": 0.9, "end": 1.4}]
    out, moved = REAL_TRIM(y, ws)
    assert moved == 0 and out == ws and out is not ws
    assert REAL_TRIM(y[:100], ws)[1] == 0                                  # too short to judge


def test_a_correct_word_that_starts_a_little_early_in_a_quiet_lead_in_is_not_moved_far():
    y = _voice_after_silence()
    out, _ = REAL_TRIM(y, [{"word": "ето", "start": 0.93, "end": 1.6}])      # 70 ms early: under the 150 ms silence test? no, head is voiced
    assert out[0]["start"] >= 0.93 and out[0]["start"] <= 1.03


def _w(word, a, b, p=0.9):
    return {"word": word, "start": a, "end": b, "p": p}


def test_a_piece_with_an_unrepairable_unknown_word_gets_a_second_opinion_and_the_better_reading_wins(home, monkeypatch):
    """C9025: the wide reading heard „е одял, Острова“; the narrow one heard „одяло струва“. Fewer unknown words wins."""
    f, its = two_pieces(home)
    known = {"ако", "това", "е", "острова", "под", "одяло", "струва", "евро"}
    monkeypatch.setattr(subtitle_job.lexicon, "known", lambda w: True if consensus_norm(w) in known else (False if consensus_norm(w) else None))
    monkeypatch.setattr(subtitle_job.lexicon, "repair", lambda w, doubt=True, prefer=frozenset(): None)
    calls = []

    def fake(audio, prompt, progress, cancelled, **k):
        calls.append((len(audio) / 16000, k.get("beam")))
        if len(audio) / 16000 > 10:                                                 # the wide window (12 s); the narrow one is 8 s
            return [_w("Ако", 4.2, 4.4), _w("това", 4.5, 4.7), _w("е", 4.8, 4.9), _w("одял,", 5.0, 5.4, 0.45), _w("Острова,", 5.5, 6.0)]
        return [_w("Ако", 2.2, 2.4), _w("това", 2.5, 2.7), _w("одяло", 2.8, 3.2), _w("струва", 3.3, 3.7)]     # 2 s of context first
    monkeypatch.setattr(asr, "transcribe", fake)
    res = subtitle_job.run(body(home, items=its[:1]), lambda f, m: None, lambda: False)
    text = " ".join(c["text"].replace("\n", " ") for c in res["captions"])
    assert "одяло струва" in text and "одял," not in text and res["readings"]["second_opinions"] == [(0.0, "B")]
    assert calls[0][1] is None and calls[1][1] == subtitle_job.SECOND_BEAM          # the second opinion uses the cheaper decode


def test_a_second_opinion_that_is_no_better_changes_nothing_and_clean_pieces_ask_for_none(home, monkeypatch):
    f, its = two_pieces(home)
    monkeypatch.setattr(subtitle_job.lexicon, "known", lambda w: False if consensus_norm(w) == "десом" else (True if consensus_norm(w) else None))
    monkeypatch.setattr(subtitle_job.lexicon, "repair", lambda w, doubt=True, prefer=frozenset(): None)
    n = []
    def same_words(audio, *a, **k):
        n.append(len(audio))
        off = 0.0 if len(audio) / 16000 > 10 else -2.0                       # the narrow window starts 2 s into the media
        return [_w("да", 5.0 + off, 5.2 + off), _w("десом.", 5.3 + off, 5.8 + off)]
    monkeypatch.setattr(asr, "transcribe", same_words)
    res = subtitle_job.run(body(home, items=its[:1]), lambda f, m: None, lambda: False)
    assert res["readings"]["second_opinions"] == [(0.0, "A")] and len(n) == 2
    monkeypatch.setattr(subtitle_job.lexicon, "known", lambda w: True)
    n.clear()
    subtitle_job.run(body(home, items=its[:1], terms=["друго"]), lambda f, m: None, lambda: False)
    assert len(n) == 1                                                                # nothing doubtful: one reading only


def test_windows_are_read_in_parallel_and_still_belong_to_the_right_pieces(home, monkeypatch):
    voice = synth.talker(30, 22)
    f = synth.write_wav(home / "far.wav", [synth.mic([(voice, 1.0)], 0, 30, noise_db=-75, seed=2)])
    its = [{"path": f, "start": 2.0, "end": 4.0, "at": 0.0, "name": "a", "track": 0},
           {"path": f, "start": 27.0, "end": 29.0, "at": 10.0, "name": "b", "track": 0}]        # far apart: two windows
    import threading
    live, peak = [], [0]
    lock = threading.Lock()

    def fake(audio, prompt, progress, cancelled, **k):
        import time as _t
        with lock:
            live.append(1)
            peak[0] = max(peak[0], len(live))
        _t.sleep(0.2)
        with lock:
            live.pop()
        first = len(audio) / 16000 < 12                                                    # the window of piece a is shorter (starts at 0)
        return [_w("първо" if first else "второ", 2.5 if first else 3.0, 3.0 if first else 3.5)]
    monkeypatch.setattr(asr, "transcribe", fake)
    monkeypatch.setattr(asr, "workers", lambda: 4)
    res = subtitle_job.run(body(home, items=its), lambda f, m: None, lambda: False)
    assert res["readings"]["windows"] == 2 and peak[0] == 2
    with open(res["json"], encoding="utf-8") as fh:
        assert [(w["word"], round(w["start"], 1)) for w in json.load(fh)["words"]][0][0] == "първо"


def test_a_low_score_alone_does_not_make_a_time_untrusted_but_a_squeezed_word_does():
    """C9025 prices: „500“ scored 0.01 yet sat on the sound; the corrected „трябваше“ (8 letters) got 0.10 s."""
    ws = [{"word": "под", "start": 5.0, "end": 5.2}, {"word": "500", "start": 5.2, "end": 5.5}, {"word": "трябваше", "start": 5.9, "end": 6.4},
          {"word": "да", "start": 6.4, "end": 6.6}]
    res = [{"start": 5.1, "end": 5.3, "align": 0.8, "chars": 3}, {"start": 5.4, "end": 5.9, "align": 0.01, "chars": 9},
           {"start": 6.0, "end": 6.1, "align": 0.0, "chars": 8}, {"start": 6.45, "end": 6.6, "align": 0.7, "chars": 2}]
    out, weak = align._fix(ws, res)
    assert out[1]["aligned"] is True and (out[1]["start"], out[1]["end"]) == (5.4, 5.9) and out[1]["align"] == 0.01      # low score, enough room
    assert out[2]["aligned"] is False and weak == 1                                                                   # squeezed: not trusted
    assert all(a["end"] <= b["start"] + 1e-9 for a, b in zip(out, out[1:]))


def test_a_word_cut_by_the_start_of_the_clip_does_not_appear_before_the_clip(home, monkeypatch):
    f, its = two_pieces(home)                                   # piece: media 4-8 s at sequence 0
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: [_w("Ах,", 3.6, 4.4), _w("хубаво", 4.8, 5.4), _w("край", 7.7, 8.1)])
    monkeypatch.setattr(subtitle_job.lexicon, "known", lambda w: True)
    res = subtitle_job.run(body(home, items=its[:1]), lambda f, m: None, lambda: False)
    with open(res["json"], encoding="utf-8") as fh:
        ws = json.load(fh)["words"]
    assert [w["word"] for w in ws] == ["Ах,", "хубаво", "край"]
    assert ws[0]["start"] == 0.0 and all(0.0 <= w["start"] <= w["end"] <= 4.0 for w in ws)                  # nothing outside the clip (0..4 s)


def _speech_then_breath():
    """16 kHz: 0-1 s a loud low voice, 1-3 s hiss at -45 dB (noise: high centroid), then 3-4 s a loud low voice again."""
    sr = 16000
    t = np.arange(4 * sr) / sr
    rng = np.random.default_rng(5)
    y = (rng.standard_normal(4 * sr) * 1e-4).astype(np.float32)
    voice = 0.2 * np.sin(2 * np.pi * 140 * t) * (((t >= 0) & (t < 1)) | ((t >= 3) & (t < 4)))
    hiss = 0.006 * np.diff(rng.standard_normal(4 * sr + 1)) * ((t >= 1) & (t < 3))
    return (y + voice + hiss).astype(np.float32)


def test_a_word_with_only_noise_under_it_is_marked_unheard_and_cannot_be_stretched_over_the_noise():
    y = _speech_then_breath()
    ws = [{"word": "количката", "start": 0.1, "end": 0.9}, {"word": "Така.", "start": 1.0, "end": 2.9}, {"word": "после", "start": 3.1, "end": 3.8}]
    out, bad = REAL_UNHEARD(y, ws)
    assert bad == [1] and out[1]["unheard"] is True and out[1]["end"] <= 1.0 + 0.5 and "unheard" not in out[0] and "unheard" not in out[2]
    assert out[1]["word"] == "Така."                                                # the text is kept: deleting it would be a guess too
    assert REAL_UNHEARD(y[:100], ws)[1] == []                                      # too little audio to judge


def test_a_long_span_with_only_a_sliver_of_speech_under_it_is_also_unheard():
    """„Така.“ on C9025: the span began inside the tail of the word before it (11 speech-like frames of 134)."""
    y = _speech_then_breath()
    ws = [{"word": "Така.", "start": 0.9, "end": 2.9}]                    # 10 speech-like frames (0.9-1.0 s) of 200
    out, bad = REAL_UNHEARD(y, ws)
    assert bad == [0] and out[0]["end"] <= 0.9 + 0.12 * 4 + 1e-9


def test_voiced_sound_that_no_word_covers_is_reported_with_its_time():
    y = _speech_then_breath()                                      # voice 0-1 s, hiss 1-3 s, voice 3-4 s
    ws = [{"word": "после", "start": 3.1, "end": 3.8}]
    assert align.uncovered_speech(y, ws) == [(0.0, 1.0)] or align.uncovered_speech(y, ws)[0][0] <= 0.05
    assert align.uncovered_speech(y, [{"word": "а", "start": 0.0, "end": 1.0}, *ws]) == []             # covered by words: nothing to report
    assert align.uncovered_speech(y, ws, min_seconds=2.0) == []                                           # shorter than the limit


def test_english_typed_in_the_captions_tab_is_keyed_by_its_bulgarian_line():
    from asistent import subtitle_job as J
    fixed = J._english_fixed({"Външно  липедема": "On the outside, lipedema ", "празно": "  "})
    assert fixed == {"външно липедема": "On the outside, lipedema"}          # empty lines are not kept
    assert J.line_key("Външно\nЛипедема") == "външно липедема"
    assert J._english_fixed(None) == {}
    with pytest.raises(ValueError):
        J._english_fixed({"a": 1})


def test_an_asistent_side_copy_is_heard_only_on_its_own_channel(home):
    """0.10.6 (BUG-008): an L/L copy plays only the left microphone; the right one's speech must not be recognised."""
    left, right = synth.talker(3, 5), synth.talker(3, 9)
    p = synth.write_wav(home / "two.wav", [left, right])
    both = dialoguemix.build_mix([{"path": p, "start": 0, "end": 3, "at": 0, "name": "two"}])
    only = dialoguemix.build_mix([{"path": p, "start": 0, "end": 3, "at": 0, "name": "two L 0.00-3.00", "side": "L"}])
    seg = only["segments"][0]
    assert seg["side"] == "L" and seg["action"]
    y, _ = dialoguemix.read_segment(seg, 0.0)
    from scipy import signal
    want = signal.resample_poly(left, 1, dialoguemix._DECIM).astype(np.float32)
    n = min(len(y), len(want), len(only["audio"]))
    assert np.allclose(y[:n], want[:n], atol=1e-3)                         # the ASR window: the left channel only
    assert np.allclose(only["audio"][:n], want[:n], atol=1e-3)              # the mix: the left channel only
    assert not np.allclose(both["audio"][:n], want[:n], atol=1e-3)          # without the side: the file's other mic too


def test_the_asr_window_keeps_the_channels_the_mix_chose(home, monkeypatch):
    s = synth.talker(3, 5)
    p = synth.write_wav(home / "lav.wav", [s, np.zeros_like(s)])
    mix = dialoguemix.build_mix([{"path": p, "start": 0, "end": 3, "at": 0, "name": "lav"}])
    called = []
    monkeypatch.setattr(dialoguemix.audio, "classify", lambda x: called.append(1) or {"action": "as_is"})
    dialoguemix.read_segment(mix["segments"][0], 1.0)
    assert called == []                                                      # not classified again on the padded piece


def test_long_items_are_read_fewer_at_a_time():
    """0.10.6 (PERF-001): an hour-long item is decoded alone, short ones side by side."""
    short = [{"start": 0, "end": 30}] * 10
    hour = [{"start": 0, "end": 3600}] * 4
    assert dialoguemix.readers_for(short) == dialoguemix.READERS
    assert dialoguemix.readers_for(hour) == 1


def test_the_alignment_pool_reports_a_worker_error_and_keeps_going(tmp_path, monkeypatch):
    """0.10.6 (PERF-002): the persistent worker answers per window; a failing window is an error (Whisper times kept by
    align_words), never a hang. Here the worker runs in this Python, which has no torch: every window fails cleanly."""
    import sys as _sys
    monkeypatch.setattr(align, "python_path", lambda: _sys.executable)
    pool = align._Pool()
    d = tmp_path / "w"
    d.mkdir()
    np.save(d / "audio.npy", np.zeros(16000, np.float32))
    (d / "words.json").write_text('[{"text": "да", "start": 0.1, "end": 0.3}]', encoding="utf-8")
    (d / "spoken.json").write_text("{}", encoding="utf-8")
    for _ in range(2):                                   # the same worker answers again after an error
        with pytest.raises(RuntimeError):
            pool.run(str(d), 60)
    pool.close()
