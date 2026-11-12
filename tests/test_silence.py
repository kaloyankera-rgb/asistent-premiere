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
