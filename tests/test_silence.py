"""Remove silences (0.10.65, silence.py): speech from each clip's own level (+ Silero), shared silences cut from every clip."""
import os

import numpy as np
import pytest

import synth
from asistent import config, roughcut_job, silence as SI

SR = 16000


def db_frames(spec, hop=SI.HOP):
    """[(seconds, dB)] -> a level per 10 ms (what level_db gives)."""
    return np.concatenate([np.full(int(round(s / SI.HOP_S)), d, dtype=np.float64) for s, d in spec])


def test_auto_threshold_sits_between_the_noise_and_the_voice():
    db = db_frames([(4, -70), (4, -25), (2, -70)])
    thr = SI.auto_threshold(db)
    assert -71 < thr["floor"] < -69 and -26 < thr["voice"] < -24
    assert thr["open"] == pytest.approx(max(-70 + SI.OVER_FLOOR_DB, -25 - SI.UNDER_VOICE_DB), abs=0.5)


def test_hysteresis_keeps_a_word_whose_tail_dips_under_the_threshold():
    db = db_frames([(0.5, -70), (0.3, -30), (0.2, -42), (0.5, -70)])          # threshold -38: the tail at -42 stays
    sp = SI.hysteresis(db, -38, -38 - SI.HYSTERESIS_DB)
    assert sp[50:100].all() and not sp[:50].any() and not sp[100:].any()
    assert not SI.hysteresis(db_frames([(1, -42)]), -38, -44).any()          # never over the threshold: not speech


def test_a_fixed_threshold_is_the_level_alone():
    db = db_frames([(1, -60), (1, -40), (1, -60)])
    sp, thr = SI.item_speech(db, None, -45.0)
    assert thr["open"] == -45.0 and sp[100:200].all() and not sp[:100].any()
    with pytest.raises(ValueError):
        SI.clamp_threshold(-5)
    assert SI.clamp_threshold("auto") is None and SI.clamp_threshold(-40) == -40.0


def test_silero_drops_a_short_bump_but_never_a_word_length_sound():
    db = db_frames([(1, -70), (0.08, -25), (1, -70), (0.4, -25), (1, -70)])
    probs = np.zeros(int(len(db) * SI.HOP_S * SR / 512) + 1, dtype=np.float32)      # Silero hears nothing anywhere
    sp, _ = SI.item_speech(db, probs, None)
    assert not sp[100:108].any()                                             # 80 ms click: not speech
    assert sp[208:248].all()                                                 # 0.4 s loud: kept although Silero missed it


def test_silero_keeps_quiet_speech_it_is_sure_of_and_a_fading_tail():
    db = db_frames([(1, -70), (0.5, -30), (0.3, -58), (1, -70)])          # floor -70: the tail is under the threshold (-57.2 - 6)
    p_frames = np.concatenate([np.zeros(100), np.full(80, 0.9), np.zeros(100)])
    probs = p_frames[(np.arange(int(len(db) * SI.HOP_S * SR / 512) + 1) * 512 / SR / SI.HOP_S).astype(int).clip(0, len(p_frames) - 1)]
    sp, _ = SI.item_speech(db, probs.astype(np.float32), None)
    assert sp[100:180].all() and not sp[190:].any()


def test_cuts_keep_short_pauses_and_a_margin_around_speech():
    n = 1200                                                                 # 12 s
    speech = np.zeros(n, bool)
    speech[100:300] = True                                                   # 1-3 s
    speech[330:500] = True                                                   # a 0.3 s pause: stays
    speech[800:1000] = True                                                  # a 3 s pause: cut, margins kept
    cov = np.ones(n, bool)
    cuts = SI.cuts(speech, cov, 0.0, "normal")
    min_sil, before, after = SI.TEMPO["normal"]
    assert cuts[0] == pytest.approx((0.0, 1.0 - before), abs=0.011)          # the lead-in, up to the margin
    assert cuts[1] == pytest.approx((5.0 + after, 8.0 - before), abs=0.011)
    assert cuts[2] == pytest.approx((10.0 + after, 12.0), abs=0.011)          # the tail
    assert not any(a < 3.3 and b > 3.0 for a, b in cuts)                     # the short pause is not touched


def test_time_no_sound_clip_covers_is_cut_whole_and_margins_never_reach_into_it():
    n = 600
    speech = np.zeros(n, bool)
    speech[0:200] = True
    speech[400:600] = True
    cov = np.ones(n, bool)
    cov[200:400] = False                                                     # 2-4 s: no sound clip at all (an empty timeline)
    cuts = SI.cuts(speech, cov, 0.0, "calm")
    assert cuts == [pytest.approx((2.0, 4.0), abs=0.011)]


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path / "app"))
    return tmp_path


def _two_speakers(home):
    """Mic 1 hears only speaker A (sound 0.2-2.07 s and 8.2-10.0 s), mic 2 only speaker B (4.2-5.23 s; synth.talker stops
    before its length); 12 s, a quiet hum between."""
    a = synth.talker(3.0, 3, sr=SR)
    b = synth.talker(2.0, 5, f0=210.0, sr=SR)
    rng = np.random.default_rng(1)
    m1 = (rng.standard_normal(12 * SR) * 0.0005).astype(np.float32)
    m2 = (rng.standard_normal(12 * SR) * 0.0005).astype(np.float32)
    m1[:3 * SR] += a
    m1[8 * SR:10 * SR] += a[:2 * SR]
    m2[4 * SR:6 * SR] += b
    w1 = synth.write_wav(home / "m1.wav", [np.repeat(m1, 3)], sr=48000)
    w2 = synth.write_wav(home / "m2.wav", [np.repeat(m2, 3)], sr=48000)
    return synth.write_mp4(home / "cam1.mp4", w1), synth.write_mp4(home / "cam2.mp4", w2)


def test_every_microphone_counts_two_speakers_on_two_mics(home):
    p1, p2 = _two_speakers(home)
    items = [{"path": p1, "start": 0.0, "end": 12.0, "at": 0.0, "name": "m1"}, {"path": p2, "start": 0.0, "end": 12.0, "at": 0.0, "name": "m2"}]
    det = SI.detect(items, 0.0, 12.0)
    cuts = SI.cuts(det["speech"], det["covered"], 0.0, "normal")
    spoken = [(0.2, 2.07), (4.2, 5.23), (8.2, 9.98)]
    for a, b in spoken:
        assert not any(x < b and y > a for x, y in cuts), (a, b, cuts)          # nobody is cut
    gaps = [(2.5, 3.9), (5.6, 7.9), (10.4, 11.9)]
    for a, b in gaps:
        assert any(x <= a and b <= y for x, y in cuts), (a, b, cuts)           # the shared silences are


def test_the_job_cuts_the_same_silences_from_every_clip(home):
    p1, p2 = _two_speakers(home)
    lay = []
    for tr, p in enumerate((p1, p2)):
        for kind in ("video", "audio"):
            lay.append({"kind": kind, "track": tr, "path": p, "start": 0.0, "end": 12.0, "inPt": 0.0, "name": os.path.basename(p)})
    body = {"items": [{"path": p1, "start": 0.0, "end": 12.0, "at": 0.0, "name": "m1", "track": 0},
                      {"path": p2, "start": 0.0, "end": 12.0, "at": 0.0, "name": "m2", "track": 1}],
            "layout": lay, "out_dir": str(home), "name": "тест", "fps": 30, "width": 1080, "height": 1920, "mode": "silence", "tempo": "normal"}
    res = roughcut_job.run(body, lambda f, m: None, lambda: False)
    assert res["mode"] == "silence" and res["name"] == "NO SILENCE – тест v1" and res["takes"] == []
    assert res["counts"]["cuts"] >= 3 and 5.0 < res["after_s"] < 9.0
    assert len(res["speech"]["listened"]) == 2 and os.path.isfile(res["xml"]) and os.path.isfile(res["shell"])
    k = res["counts"]["kept_ranges"]
    assert res["check"]["video"] in ({"1": k, "2": k}, {1: k, 2: k})          # both cameras get the same cuts
    fixed = roughcut_job.run({**body, "threshold": -50}, lambda f, m: None, lambda: False)
    assert fixed["threshold"] == -50.0 and fixed["name"].endswith(" v2")
    with pytest.raises(ValueError, match="threshold"):
        roughcut_job.validate({**body, "threshold": -100})


def _speech_mask(spec):
    """[(seconds, speech?)] -> a speech mask per 10 ms."""
    return np.concatenate([np.full(int(round(s / SI.HOP_S)), v, dtype=bool) for s, v in spec])


def test_quieter_voices_are_cut_and_the_main_voice_with_its_short_answers_stays():
    # 0.10.95, measured on the user's labels (Lokali v10): host -22 dB kept, a guest's „Да.“ 6 dB under kept,
    # people talking further away 9-14 dB under cut
    spec = [(1, -60), (4, -22), (1, -60), (0.6, -28), (1, -60), (5, -31), (1, -60), (4, -36), (1, -60), (3, -22), (1, -60)]
    db = db_frames(spec)
    speech = _speech_mask([(s, d > -50) for s, d in spec])
    out, main, dropped = SI.drop_quiet(db, speech)
    assert main == pytest.approx(-22, abs=0.5)
    at = lambda t: int(round(t / SI.HOP_S))
    assert out[at(1):at(5)].all() and out[at(6):at(6.6)].all()            # the host and the short answer
    assert not out[at(7.6):at(12.6)].any() and not out[at(13.6):at(17.6)].any()   # the voices further away
    assert out[at(18.6):at(21.6)].all()
    assert dropped == pytest.approx(9.0, abs=0.05)


def test_one_speaker_who_says_a_line_softer_keeps_it():
    # Masterhaus C0728: a real line 6.6 dB under the loudest one stays
    spec = [(1, -60), (4, -14), (1, -60), (4, -20.6), (1, -60), (3, -15), (1, -60)]
    db = db_frames(spec)
    speech = _speech_mask([(s, d > -50) for s, d in spec])
    out, _, dropped = SI.drop_quiet(db, speech)
    assert (out == speech).all() and dropped == 0.0


def test_a_short_shout_does_not_set_the_main_voice():
    spec = [(1, -60), (0.5, -8), (1, -60), (8, -24), (1, -60)]                # a 0.5 s laugh 16 dB over the voice
    db = db_frames(spec)
    speech = _speech_mask([(s, d > -50) for s, d in spec])
    out, main, _ = SI.drop_quiet(db, speech)
    assert main == pytest.approx(-24, abs=0.5) and out[int(2.5 / SI.HOP_S):int(10.5 / SI.HOP_S)].all()


def test_a_fixed_threshold_never_drops_quieter_voices(monkeypatch):
    spec = [(4, -22), (1, -60), (4, -36), (1, -60)]
    db = db_frames(spec)
    monkeypatch.setattr(SI.audio, "read_range", lambda *a, **k: np.zeros((1, 10 * SR), dtype=np.float32))
    monkeypatch.setattr(SI, "level_db", lambda x, side=None: (db, np.zeros(10 * SR, dtype=np.float32)))
    r = SI.read_item({"path": "x", "start": 0, "end": 10}, -45.0)
    assert r["speech"][int(5.5 / SI.HOP_S):int(8.5 / SI.HOP_S)].all() and r["quiet_s"] == 0.0 and r["main"] is None
    monkeypatch.setattr(SI.vad, "probabilities", lambda main: None)
    r = SI.read_item({"path": "x", "start": 0, "end": 10}, None)
    assert not r["speech"][int(5.5 / SI.HOP_S):int(8.5 / SI.HOP_S)].any() and r["quiet_s"] > 3
    r = SI.read_item({"path": "x", "start": 0, "end": 10}, None, quiet=False)
    assert r["speech"][int(5.5 / SI.HOP_S):int(8.5 / SI.HOP_S)].all()


# ---------------------------------------------------------------- 0.10.96: settings, modes, methods, the plan, the preview
def _labels(spec):
    """[(seconds, label)] -> a detect() result over one covered stretch."""
    lab = np.concatenate([np.full(int(round(s / SI.HOP_S)), v, dtype=np.uint8) for s, v in spec])
    return {"labels": lab, "covered": np.ones(len(lab), bool), "under": np.where(lab == SI.SPEECH, 0, 9).astype(np.float32)}


def test_settings_are_checked_and_an_older_request_means_what_it_meant():
    s = SI.settings({"mode": "offmic", "method": "auto", "pacing": "paced"})
    assert (s["min_silence"], s["before"], s["after"]) == (0.65, 0.15, 0.20) and s["sensitivity"] == 3 and s["action"] == "remove"
    assert SI.settings({"tempo": "normal"})["mode"] == "offmic"              # 0.10.95: Auto cut the quieter voices
    assert SI.settings({"tempo": "tight", "quiet": False})["mode"] == "silence"
    assert SI.settings({"threshold": -40})["method"] == "manual"
    assert SI.settings({"mode": "ai", "method": "auto", "pacing": "calm"})["method"] == "ai"     # takes need the words
    c = SI.settings({"method": "auto", "pacing": "custom", "min_silence": 0.4, "before": 0.05, "after": 0.1, "min_speech": 0.3})
    assert (c["min_silence"], c["min_speech"], c["before"], c["after"]) == (0.4, 0.3, 0.05, 0.1)
    assert SI.settings({"method": "auto", "pacing": "calm", "fillers": True})["fillers"] is False    # no words, no fillers
    assert SI.settings({"method": "ai", "pacing": "calm", "fillers": True})["fillers"] is True
    assert SI.settings({"method": "auto", "pacing": "paced", "short": True, "short_max": 2.0})["short_max"] == 0.65
    for bad in ({"method": "manual", "pacing": "calm"}, {"method": "auto", "pacing": "fast"}, {"method": "x", "pacing": "calm"},
                {"method": "auto", "pacing": "custom", "min_silence": 0.01}, {"method": "auto", "pacing": "calm", "sensitivity": 9},
                {"method": "auto", "pacing": "calm", "action": "delete"}, {"method": "auto", "pacing": "calm", "listen": ["a"]}):
        with pytest.raises(ValueError):
            SI.settings(bad)


def test_the_pacing_presets_cut_what_calm_normal_and_tight_cut_before():
    rng = np.random.default_rng(3)
    speech = np.zeros(6000, bool)
    at = 0
    while at < 5900:                                                         # speech and pauses of every length
        at += int(rng.integers(5, 220))
        n = int(rng.integers(10, 300))
        speech[at:at + n] = True
        at += n
    cov = np.ones(6000, bool)
    cov[2000:2300] = False

    def old(tempo):                                                          # the 0.10.65-0.10.95 rule, word for word
        min_sil, before, after = SI.TEMPO[tempo]
        keep = speech.copy()
        n = len(keep)
        gap = int(round(min_sil / SI.HOP_S))
        for a, b in SI.runs(~keep):
            if 0 < a and b < n and b - a < gap and cov[a:b].all():
                keep[a:b] = True
        pb, pa = int(round(before / SI.HOP_S)), int(round(after / SI.HOP_S))
        padded = keep.copy()
        for a, b in SI.runs(keep):
            padded[max(0, a - pb):a] = True
            padded[b:min(n, b + pa)] = True
        padded &= cov | keep
        return [(a * SI.HOP_S, b * SI.HOP_S) for a, b in SI.runs(~padded)
                if not cov[a:b].any() or (b - a) * SI.HOP_S >= min_sil - 1e-9 or a == 0 or b == n]

    det = {"labels": np.where(speech, SI.SPEECH, SI.SIL).astype(np.uint8), "covered": cov, "under": np.zeros(6000, np.float32)}
    for tempo, pacing in (("calm", "calm"), ("normal", "measured"), ("tight", "paced")):
        new = SI.plan(det, SI.settings({"method": "auto", "pacing": pacing}), 0.0)["cuts"]
        want = [c for c in old(tempo)]
        got = [c for c in new if not any(abs(c[0] - w[0]) < 0.011 and abs(c[1] - w[1]) < 0.011 for w in want)]
        # the only difference allowed: a silence that reaches into time no clip covers, shorter than the old minimum
        assert all(not cov[int(a / SI.HOP_S):int(b / SI.HOP_S)].all() for a, b in got), (tempo, got)
        assert all(any(abs(c[0] - w[0]) < 0.011 and abs(c[1] - w[1]) < 0.011 for c in new) for w in want), tempo


def _item(db, s, probs=None):
    return SI.label_item(db, probs, s)


def _silero(db, over=-50.0):
    """Silero sure of speech wherever the level is over `over` (one value per 32 ms)."""
    idx = (np.arange(int(len(db) * SI.HOP_S * SR / 512) + 1) * 512 / SR / SI.HOP_S).astype(int).clip(0, len(db) - 1)
    return (db[idx] > over).astype(np.float32)


def test_mode_silences_keeps_every_voice_and_off_mic_cuts_or_flags_them():
    # the host -22 dB, a voice 14 dB under (goes), one 7 dB under (near the line: kept, flagged), a short answer 5 dB under
    spec = [(1, -60), (5, -22), (1, -60), (4, -36), (1, -60), (3, -29), (1, -60), (0.6, -27), (1, -60), (3, -22), (1, -60)]
    db = db_frames(spec)
    at = lambda t: int(round(t / SI.HOP_S))
    one = _item(db, SI.settings({"mode": "silence", "method": "auto", "pacing": "measured"}), _silero(db))
    assert (one["labels"][at(7.2):at(10.8)] == SI.SPEECH).all() and one["off_s"] == 0 and one["flag_s"] == 0
    two = _item(db, SI.settings({"mode": "offmic", "method": "auto", "pacing": "measured"}), _silero(db))
    assert (two["labels"][at(7.2):at(10.8)] == SI.OFF).all()                 # 14 dB under: away from the microphone
    assert (two["labels"][at(12.2):at(14.8)] == SI.FLAG).all()               # 7 dB under: not sure, kept
    assert (two["labels"][at(16.1):at(16.5)] == SI.SPEECH).all() and two["main"] == pytest.approx(-22, abs=0.5)
    careful = _item(db, SI.settings({"mode": "offmic", "method": "auto", "pacing": "measured", "sensitivity": 1}), _silero(db))
    assert (careful["labels"][at(7.2):at(10.8)] == SI.OFF).all() and (careful["labels"][at(12.2):at(14.8)] == SI.SPEECH).all()
    hard = _item(db, SI.settings({"mode": "offmic", "method": "auto", "pacing": "measured", "sensitivity": 5}), _silero(db))
    assert (hard["labels"][at(12.2):at(14.8)] == SI.OFF).all() and (hard["labels"][at(16.1):at(16.5)] == SI.FLAG).all()
    det = {"labels": two["labels"], "under": two["under"], "covered": np.ones(len(db), bool)}
    pl = SI.plan(det, SI.settings({"mode": "offmic", "method": "auto", "pacing": "measured"}), 0.0)
    off = [r for r in pl["regions"] if r["kind"] == "offmic"]
    assert [(r["cut"], r["flag"]) for r in off] == [(True, False), (False, True)]
    assert "14 dB under" in off[0]["text"] and "not sure" in off[1]["text"]
    assert any(a <= 7.5 and b >= 10.5 for a, b in pl["cuts"]) and not any(a < 14.5 and b > 12.5 for a, b in pl["cuts"])


def test_manual_db_is_the_level_alone_and_predictable():
    spec = [(1, -60), (4, -12), (1, -60), (4, -30), (1, -60), (0.08, -10), (1, -60), (3, -13), (1, -60)]
    db = db_frames(spec)
    at = lambda t: int(round(t / SI.HOP_S))
    probs = np.ones(int(len(db) * SI.HOP_S * SR / 512) + 1, dtype=np.float32)      # Silero: speech everywhere
    for mode in ("silence", "offmic"):
        r = _item(db, SI.settings({"mode": mode, "method": "manual", "threshold": -25, "pacing": "measured"}), probs)
        assert (r["labels"][at(1.1):at(4.9)] == SI.SPEECH).all() and (r["labels"][at(12.2):at(14.9)] == SI.SPEECH).all()
        assert (r["labels"][at(6.2):at(9.8)] == SI.OFF).all()                # speech, and under the dB: it goes, shown as a voice
        assert not (r["labels"][at(11.0):at(11.1)] == SI.SPEECH).any()       # 80 ms over the threshold: under the minimum speech
        assert r["thr"]["open"] == -25.0
    # a quiet conversation with one loud laugh in it: careful keeps what reaches the threshold, aggressive wants it to last
    laugh = db_frames([(1, -60), (2, -32), (0.2, -23), (2, -32), (1, -60)])
    keep = lambda sens: SI.manual_speech(laugh, -25.0, sens)
    assert keep(1)[at(3.0):at(3.2)].all() and not keep(5).any()
    assert not keep(1)[at(1.2):at(2.8)].any()                                # 7 dB under: not held open by the 6 dB hysteresis
    det = {"labels": _item(db, SI.settings({"method": "manual", "threshold": -25, "pacing": "measured"}), probs)["labels"],
           "under": np.zeros(len(db), np.float32), "covered": np.ones(len(db), bool)}
    pl = SI.plan(det, SI.settings({"method": "manual", "threshold": -25, "pacing": "measured"}), 0.0)
    assert any(r["kind"] == "below" and r["start"] < 6.5 and r["end"] > 9.5 for r in pl["regions"])
    assert SI.suggest_threshold([-22.3, -30.1, None]) == -38.0 and SI.suggest_threshold([None]) is None


def test_short_pauses_are_trimmed_but_one_with_a_breath_stays():
    S, L, Z = SI.SPEECH, SI.LOW, SI.SIL
    det = _labels([(1, S), (0.35, Z), (1, S), (0.10, Z), (0.20, L), (0.10, Z), (1, S), (0.12, Z), (1, S), (2, Z), (1, S)])
    off = SI.plan(det, SI.settings({"method": "auto", "pacing": "measured"}), 0.0)
    assert [r["kind"] for r in off["regions"]] == ["silence"]               # only the 2 s pause
    on = SI.plan(det, SI.settings({"method": "auto", "pacing": "measured", "short": True}), 0.0)
    short = [r for r in on["regions"] if r["kind"] == "short"]
    assert len(short) == 1                                                   # not the one with the breath, not the 0.12 s one
    assert short[0]["start"] == pytest.approx(1.0 + SI.SHORT_AFTER, abs=0.011) and short[0]["end"] == pytest.approx(1.35 - SI.SHORT_BEFORE, abs=0.011)
    assert SI.settings({"method": "auto", "pacing": "energetic"})["short"] is True


def test_hesitation_sounds_go_only_as_a_stretch_of_their_own():
    S, Z = SI.SPEECH, SI.SIL
    det = _labels([(1, Z), (2, S), (0.3, Z), (0.5, S), (0.3, Z), (2, S), (1, Z), (1.5, S), (1, Z)])
    words = [{"word": " Значи", "start": 1.1, "end": 2.9}, {"word": " ъъъ,", "start": 3.35, "end": 3.75}, {"word": " почваме", "start": 4.2, "end": 6.0},
             {"word": " ъъ", "start": 7.1, "end": 7.3}, {"word": " добре.", "start": 7.3, "end": 8.4}]
    s = SI.settings({"method": "ai", "pacing": "measured", "fillers": True})
    pl = SI.plan(det, s, 0.0, words)
    fill = [r for r in pl["regions"] if r["kind"] == "filler"]
    assert len(fill) == 1 and fill[0]["start"] == pytest.approx(3.3, abs=0.011) and fill[0]["end"] == pytest.approx(3.8, abs=0.011)
    assert any(a <= 3.3 and b >= 3.8 for a, b in pl["cuts"])                 # the whole sound, no margin left inside it
    assert not any(a < 8.4 and b > 7.0 for a, b in pl["cuts"])               # „ъъ добре“ in one breath: left alone
    assert not [r for r in SI.plan(det, SI.settings({"method": "ai", "pacing": "measured"}), 0.0, words)["regions"] if r["kind"] == "filler"]
    assert "ами" not in SI.HESITATIONS and "така" not in SI.HESITATIONS      # words stay


def _group(takes, cut, rec=-1, safe=True):
    return {"kind": "exact", "kind_label": "repeated take", "safe": safe, "lost": [], "whole": False, "cut": cut,
            "recommended": rec % len(takes), "takes": [{"start": a, "end": b, "text": "Добър ден на всички", "n_words": 4, "ends": True} for a, b in takes]}


def test_a_repeated_take_goes_as_a_whole_stretch_and_only_when_the_winner_stays():
    S, Z, O = SI.SPEECH, SI.SIL, SI.OFF
    det = _labels([(1, Z), (3, S), (0.4, Z), (2, S), (0.4, Z), (2, S), (1, Z)])       # speech 1-4, 4.4-6.4 (take 1), 6.8-8.8 (take 2)
    s = SI.settings({"mode": "ai", "method": "ai", "pacing": "measured"})
    # Whisper puts the first take 0.5 s early, inside the sentence before it: that sentence is not cut into
    pl = SI.plan(det, s, 0.0, [], [_group([(3.9, 6.4), (6.8, 8.8)], [(3.9, 6.8)])])
    take = [r for r in pl["regions"] if r["kind"] == "take"]
    assert len(take) == 1 and take[0]["cut"] and take[0]["start"] == pytest.approx(4.4, abs=0.011) and take[0]["end"] == pytest.approx(6.4, abs=0.011)
    assert not any(a < 4.0 and b > 1.0 for a, b in pl["cuts"]) and not any(a < 8.8 and b > 6.8 for a, b in pl["cuts"])
    # said differently: nothing goes, the takes are listed for the editor
    g = _group([(4.4, 6.4), (6.8, 8.8)], [], safe=False)
    pl = SI.plan(det, s, 0.0, [], [g])
    listed = [r for r in pl["regions"] if r["kind"] == "take"]
    assert len(listed) == 1 and not listed[0]["cut"] and listed[0]["flag"] and "said differently" in listed[0]["text"] and g["listed"]
    # the take that would stay is a voice away from the microphone: the speaker's own line is not replaced by it
    det2 = _labels([(1, Z), (3, S), (0.4, Z), (2, S), (0.4, Z), (2, O), (1, Z)])
    g = _group([(4.4, 6.4), (6.8, 8.8)], [(4.4, 6.8)])
    pl = SI.plan(det2, SI.settings({"mode": "ai", "method": "ai", "pacing": "measured"}), 0.0, [], [g])
    assert not g["applied"] and not [r for r in pl["regions"] if r["kind"] == "take"]


def test_the_editor_can_take_a_region_back_and_cut_a_flagged_one():
    S, Z, O, F = SI.SPEECH, SI.SIL, SI.OFF, SI.FLAG
    det = _labels([(1, S), (2, Z), (2, O), (2, Z), (2, S), (1.5, Z), (2, F), (1.5, Z), (1, S)])
    base = SI.settings({"mode": "offmic", "method": "auto", "pacing": "measured"})
    pl = SI.plan(det, base, 0.0)
    kinds = [(r["kind"], r["cut"], r["flag"]) for r in pl["regions"]]
    assert ("offmic", True, False) in kinds and ("offmic", False, True) in kinds
    off = next(r for r in pl["regions"] if r["kind"] == "offmic" and r["cut"])
    flag = next(r for r in pl["regions"] if r["flag"])
    assert any(a <= 3.5 and b >= 4.5 for a, b in pl["cuts"]) and not any(a < 12.4 and b > 10.6 for a, b in pl["cuts"])
    s2 = SI.settings({"mode": "offmic", "method": "auto", "pacing": "measured",
                      "overrides": [{"start": off["start"], "end": off["end"], "cut": False}, {"start": flag["start"], "end": flag["end"], "cut": True}]})
    pl2 = SI.plan(det, s2, 0.0)
    assert not any(a < off["end"] - 0.02 and b > off["start"] + 0.02 for a, b in pl2["cuts"])     # taken back: it stays
    assert any(a <= flag["start"] + 0.011 and b >= flag["end"] - 0.011 for a, b in pl2["cuts"])   # the flagged voice goes
    assert sum(1 for r in pl2["regions"] if r.get("by") == "you") == 2


def test_a_clip_is_measured_once_and_the_waveform_is_the_loudest_of_every_50_ms(home, monkeypatch):
    p1, _ = _two_speakers(home)
    it = {"path": p1, "start": 0.0, "end": 12.0, "at": 0.0, "name": "m1"}
    SI._MEASURED.clear()
    first = SI.measure(it)
    def read_again(*a, **k):
        raise RuntimeError("read again")
    monkeypatch.setattr(SI.audio, "read_range", read_again)
    assert SI.measure(it) is first                                           # the same clip: nothing read again
    with pytest.raises(RuntimeError, match="read again"):
        SI.measure({**it, "end": 11.0})                                      # another range is another measurement
    env = SI.envelope(np.array([-60, -30, -60, -60, -60, -50, -90, -90, -90, -90, -10], dtype=np.float32))
    assert env == [-30, -50]


def _job_body(home, **extra):
    p1, p2 = _two_speakers(home)
    lay = []
    for tr, p in enumerate((p1, p2)):
        for kind in ("video", "audio"):
            lay.append({"kind": kind, "track": tr, "path": p, "start": 0.0, "end": 12.0, "inPt": 0.0, "name": os.path.basename(p)})
    return {"items": [{"path": p1, "start": 0.0, "end": 12.0, "at": 0.0, "name": "m1", "track": 0},
                      {"path": p2, "start": 0.0, "end": 12.0, "at": 0.0, "name": "m2", "track": 1}],
            "layout": lay, "out_dir": str(home), "name": "тест", "fps": 30, "width": 1080, "height": 1920,
            "mode": "silence", "method": "auto", "pacing": "measured", "action": "remove", **extra}


def test_the_preview_plans_without_writing_and_the_cut_follows_the_review(home):
    body = _job_body(home)
    pv = roughcut_job.run({**body, "preview": True}, lambda f, m: None, lambda: False)
    assert pv["preview"] and not os.path.exists(os.path.join(str(home), "Asistent_roughcut"))        # nothing written
    assert pv["t_start"] == 0.0 and pv["t_end"] == 12.0 and len(pv["env"]["db"]) == 240 and pv["tracks"] == [0, 1]
    sil = [r for r in pv["regions"] if r["cut"]]
    assert len(sil) >= 3 and all(r["kind"] == "silence" for r in sil) and pv["saved_s"] > 3
    assert pv["suggest_db"] is not None and -80 <= pv["suggest_db"] <= -10
    mid = next(r for r in sil if r["start"] > 5 and r["end"] < 8.5)          # the silence after speaker B: the editor keeps it
    cut = roughcut_job.run({**body, "overrides": [{"start": mid["start"], "end": mid["end"], "cut": False}]}, lambda f, m: None, lambda: False)
    assert cut["restored"] == 1 and cut["counts"]["cuts"] == len(pv["cuts"]) - 1
    assert cut["after_s"] == pytest.approx(pv["before_s"] - pv["saved_s"] + (mid["end"] - mid["start"]), abs=0.1)
    # only microphone 2 is listened to: speaker A (heard on microphone 1 alone) is silence now
    only = roughcut_job.run({**body, "preview": True, "listen": [1]}, lambda f, m: None, lambda: False)
    assert only["saved_s"] > pv["saved_s"] + 2 and len(only["speech"]["listened"]) == 1
    with pytest.raises(ValueError, match="at least one audio track"):
        roughcut_job.validate({**body, "listen": [7]})


def test_the_three_actions_that_move_nothing(home):
    body = _job_body(home)
    rm = roughcut_job.run(body, lambda f, m: None, lambda: False)
    k = rm["counts"]["kept_ranges"]
    assert rm["after_s"] < rm["before_s"] - 3
    gaps = roughcut_job.run({**body, "action": "gaps"}, lambda f, m: None, lambda: False)
    assert gaps["after_s"] == gaps["before_s"] and len(gaps["pieces"]) == len(rm["pieces"]) and gaps["flashes_dropped"] == rm["flashes_dropped"]
    for a, b in zip(sorted(gaps["pieces"], key=lambda p: (p["item"], p["start"])), sorted(rm["pieces"], key=lambda p: (p["item"], p["start"]))):
        assert (a["src_in"], a["src_out"]) == (b["src_in"], b["src_out"]) and a["start"] == a["src_in"]      # the same pieces, where they were
    split = roughcut_job.run({**body, "action": "split"}, lambda f, m: None, lambda: False)
    one = sorted((p for p in split["pieces"] if p["item"] == 0), key=lambda p: p["start"])
    assert len(one) == k + split["counts"]["cuts"] and one[0]["start"] == 0 and one[-1]["end"] == 360
    assert all(x["end"] == y["start"] for x, y in zip(one, one[1:]))         # cut apart, nothing missing
    mute = roughcut_job.run({**body, "action": "mute"}, lambda f, m: None, lambda: False)
    video = [p for p in mute["pieces"] if p["kind"] == "video"]
    audio = [p for p in mute["pieces"] if p["kind"] == "audio" and p["track"] == 0]
    assert len(video) == 2 and all(p["start"] == 0 and p["end"] == 360 for p in video)                       # the picture whole
    assert len(audio) == k and mute["after_s"] == mute["before_s"]                                          # the sound only where kept


def test_a_clip_of_a_few_frames_is_labelled_whatever_the_method():
    # 0.10.96, the user's first run: In to Out left 30 ms of the next clip, shorter than Manual dB's averaging window
    for n in (0, 1, 3, 9):
        db = np.full(n, -20.0)
        for sens in (1, 3, 5):
            r = SI.label_item(db, None, SI.settings({"method": "manual", "threshold": -24, "pacing": "measured", "sensitivity": sens}))
            assert len(r["labels"]) == n
        assert len(SI.label_item(db, None, SI.settings({"mode": "offmic", "method": "auto", "pacing": "measured"}))["labels"]) == n
        assert len(SI.smooth_db(db, 0.4)) == n
