"""Smart Audio Assistant: loudness calibration, channel classification, gain with the -6 dB ceiling."""
import numpy as np
import pytest

import synth
from asistent import audio as A

SR = A.SR


def sine(amp, seconds=5.0, f=997.0):
    t = np.arange(int(seconds * SR)) / SR
    return (amp * np.sin(2 * np.pi * f * t)).astype(np.float32)


def test_loudness_calibration():
    s = sine(0.1)                                   # -20 dBFS
    assert A.loudness([s]) == pytest.approx(-23.0, abs=0.1)        # one channel (BS.1770)
    assert A.loudness([s, s]) == pytest.approx(-20.0, abs=0.1)     # same on both sides
    assert A.true_peak(sine(0.5)) == pytest.approx(-6.02, abs=0.05)


@pytest.fixture(scope="module")
def voices():
    s1, s2 = synth.scene(40.0, seed=31)
    rng = np.random.default_rng(3)
    n = int(38 * SR)
    noise = lambda db: rng.standard_normal(n) * 10 ** (db / 20)   # noqa: E731
    return s1[:n] * 0.5, s2[:n] * 0.5, noise


def kind(x):
    return A.classify(np.asarray(x, dtype=np.float32))


def test_two_lavaliers(voices):
    s1, s2, noise = voices
    l = s1 + 0.05 * s2 + noise(-70)
    r = 0.7 * s2 + 0.05 * s1 + noise(-70)
    c = kind([l, r])
    assert (c["kind"], c["action"]) == ("two_mics", "split"), c


def test_movable_lavalier_left_only(voices):
    s1, s2, noise = voices
    c = kind([s1 + s2, np.zeros_like(s1)])
    assert (c["kind"], c["action"]) == ("one_channel", "use_left"), c
    c = kind([noise(-80), s1 + s2])
    assert (c["kind"], c["action"]) == ("one_channel", "use_right"), c


def test_safety_channel(voices):
    s1, s2, _ = voices
    main = s1 + s2
    c = kind([main, 0.25 * main])
    assert (c["kind"], c["action"]) == ("safety", "use_left"), c
    clipped = np.clip(main * 8, -1, 1)               # the main channel clips, the safety does not
    c = kind([clipped, main])
    assert (c["kind"], c["action"]) == ("safety", "use_right"), c


def test_dual_mono_and_phase(voices):
    s1, s2, _ = voices
    m = s1 + s2
    assert kind([m, m])["kind"] == "dual_mono"
    c = kind([m, -m])
    assert c["kind"] == "phase_inverted" and c["action"] in ("use_left", "use_right")


def test_stereo_camera_mic_is_left_alone(voices):
    s1, s2, noise = voices
    m = s1 + s2
    b, a = A.signal.butter(2, [150, 7000], btype="band", fs=SR)
    r = A.signal.lfilter(b, a, np.roll(m, 12)) * 0.9 + noise(-60)   # 0.25 ms apart, a bit different
    c = kind([m + noise(-60), r])
    assert (c["kind"], c["action"]) == ("stereo_mic", "none"), c


def test_silence():
    z = np.zeros(SR * 5, np.float32)
    assert kind([z, z])["kind"] == "silent"


def test_gain_respects_ceiling_and_target(voices):
    s1, s2, _ = voices
    quiet = (s1 + s2) * 0.02                         # very quiet speech
    g = A.gain_for([quiet, quiet], A.TARGET_LUFS, A.PEAK_CEILING)
    assert g["result_peak_db"] <= A.PEAK_CEILING + 0.05
    assert g["gain_db"] > 0
    loud = np.clip((s1 + s2) * 3.5, -0.95, 0.95)
    g = A.gain_for([loud, loud], A.TARGET_LUFS, A.PEAK_CEILING)
    assert g["gain_db"] < 0 and g["result_peak_db"] <= A.PEAK_CEILING + 0.05
    assert g["result_lufs"] <= A.TARGET_LUFS + 0.05


def test_split_outputs_each_get_own_gain(tmp_path, voices):
    s1, s2, noise = voices
    l = (s1 + 0.05 * s2) * 0.3 + noise(-70)          # speaker 1 quiet
    r = (s2 + 0.05 * s1) * 1.0 + noise(-70)          # speaker 2 louder
    path = synth.write_wav(tmp_path / "lav.wav", [l.astype(np.float32), r.astype(np.float32)])
    res = A.analyze_item(path)
    assert res["action"] == "split"
    gains = {o["route"]: o for o in res["outputs"]}
    assert set(gains) == {"LL", "RR"}
    assert gains["LL"]["gain_db"] > gains["RR"]["gain_db"]
    for o in res["outputs"]:
        assert o["result_peak_db"] <= A.PEAK_CEILING + 0.05


def test_range_and_force(tmp_path, voices):
    s1, s2, _ = voices
    path = synth.write_wav(tmp_path / "x.wav", [(s1 + s2).astype(np.float32), np.zeros_like(s1, dtype=np.float32)])
    res = A.analyze_item(path, 5.0, 15.0, force="use_right")
    assert res["action"] == "use_right" and res["outputs"][0]["route"] == "RR"
    x = A.read_range(path, 5.0, 15.0)
    assert abs(x.shape[1] / SR - 10.0) < 0.01


def test_same_voice_from_a_farther_mic_uses_the_close_one(voices):
    s1, s2, noise = voices
    v = s1 + s2
    rng = np.random.default_rng(8)
    n = int(0.4 * SR)
    ir = rng.standard_normal(n) * np.exp(-6.9 * np.arange(n) / n) * 0.05
    ir[int(0.0019 * SR)] = 1.0                     # direct sound 1.9 ms later, then the room
    far = A.signal.fftconvolve(v, ir)[: len(v)] * 0.12 + noise(-50)    # ~8 dB quieter, like the FX3 test take
    c = kind([v + noise(-70), far])
    assert c["evidence"]["corr"] < 0.6, c["evidence"]
    assert (c["kind"], c["action"]) == ("same_voice", "use_left"), c


def test_split_is_refused_when_both_channels_carry_one_sound(tmp_path, voices):
    s1, s2, noise = voices
    v = (s1 + s2).astype(np.float32)
    b, a = A.signal.butter(2, [150, 7000], btype="band", fs=SR)
    stereo = [v, (A.signal.lfilter(b, a, np.roll(v, 12)) * 0.9 + noise(-60)).astype(np.float32)]
    path = synth.write_wav(tmp_path / "cam.wav", stereo)
    res = A.analyze_item(path, force="split")
    assert res["action"] != "split" and len(res["outputs"]) == 1
    assert "двойно" in res["reasons"][0]


def test_split_keeps_the_sum_under_the_ceiling(tmp_path, voices):
    s1, s2, noise = voices
    l = (s1 + 0.3 * s2) + noise(-70)               # lots of bleed: the sum peaks higher than each track
    r = (s2 + 0.3 * s1) + noise(-70)
    path = synth.write_wav(tmp_path / "lav.wav", [l.astype(np.float32), r.astype(np.float32)])
    res = A.analyze_item(path, force="split")
    assert res["action"] == "split"
    g = {o["route"]: o["gain_db"] for o in res["outputs"]}
    x = A.read_range(path)
    mix = x[0] * 10 ** (g["LL"] / 20) + x[1] * 10 ** (g["RR"] / 20)
    assert A.true_peak(mix) <= A.PEAK_CEILING + 0.1


def test_split_refusal_says_why(tmp_path, voices):
    s1, s2, _ = voices
    path = synth.write_wav(tmp_path / "one.wav", [(s1 + s2).astype(np.float32), np.zeros_like(s1, dtype=np.float32)])
    res = A.analyze_item(path, force="split")
    assert res["action"] == "use_left" and "няма звук" in res["reasons"][0]


def phrase_spread(x, fs=SR):
    """Loudness spread between phrases (p90 - p10), measured the same way as the engine."""
    p = A.phrase_plan([x], 0.0, -17.0, 0.0, fs=fs)
    return p["spread_db"]


@pytest.fixture(scope="module")
def uneven(voices):
    s1, s2, noise = voices
    v = (s1 + s2)
    half = len(v) // 2
    env = np.ones(len(v))
    env[half:] = 10 ** (-10 / 20)            # the second half 10 dB quieter (mic moved away)
    return (v * env + noise(-75)).astype(np.float32)


def test_phrase_leveling_evens_out_without_breaking_rules(uneven, voices):
    x = uneven
    base = A.gain_for([x, x], A.TARGET_LUFS, A.PEAK_CEILING)["gain_db"]
    plan = A.phrase_plan([x, x], base, A.TARGET_LUFS, A.PEAK_CEILING)
    assert plan["spread_db"] >= 8
    assert plan["keyframes"]
    y = A.apply_keyframes(x, plan["keyframes"])
    s1, s2, _ = voices
    natural = phrase_spread((s1 + s2).astype(np.float32))     # what this speech varies by on its own
    assert phrase_spread(y) <= natural + 1.5
    assert A.true_peak(y) <= A.PEAK_CEILING + 0.1
    gains = [g for _, g in plan["keyframes"]]
    assert max(gains) - min(gains) <= 2 * A.MAX_DEV + 0.1     # never more than +/-6 dB around the clip level


def test_keyframes_change_only_inside_pauses(uneven):
    x = uneven
    plan = A.phrase_plan([x, x], 0.0, A.TARGET_LUFS, A.PEAK_CEILING)
    act = A._activity(A._frames_db(x.astype(np.float64)))
    keys = plan["keyframes"]
    for (t0, g0), (t1, g1) in zip(keys, keys[1:]):
        if g0 != g1:                                          # a ramp: it must sit in silence
            a, b = int(t0 / 0.02), int(np.ceil(t1 / 0.02))
            assert not act[a:b].any(), (t0, t1)


def test_even_speech_gets_no_keyframes(voices):
    s1, s2, noise = voices
    x = (s1 + s2 + noise(-75)).astype(np.float32)
    plan = A.phrase_plan([x, x], 0.0, A.TARGET_LUFS, A.PEAK_CEILING)
    assert plan["keyframes"] == []


def test_quiet_phrase_in_a_noisy_room_is_not_pumped(voices):
    s1, s2, noise = voices
    v = s1 + s2
    env = np.ones(len(v))
    env[len(v) // 2:] = 10 ** (-12 / 20)
    x = (v * env + noise(-40)).astype(np.float32)             # loud room noise
    base = A.gain_for([x, x], A.TARGET_LUFS, A.PEAK_CEILING)["gain_db"]
    plan = A.phrase_plan([x, x], base, A.TARGET_LUFS, A.PEAK_CEILING)
    top = max((g for _, g in plan["keyframes"]), default=base)
    assert plan["noise_db"] + top <= A.NOISE_MAX + 0.1 or top <= base


def test_analyze_item_suggests_and_returns_keyframes(tmp_path, uneven):
    path = synth.write_wav(tmp_path / "u.wav", [uneven, np.zeros_like(uneven)])
    res = A.analyze_item(path, 3.0, 33.0)
    assert any("Изравни фразите" in r for r in res["reasons"])
    res = A.analyze_item(path, 3.0, 33.0, phrases=True)
    keys = res["outputs"][0]["keyframes"]
    assert keys and keys[0][0] == 3.0                         # media time: starts at the clip's In point


def test_near_silent_clip_is_not_pumped(voices):
    s1, s2, noise = voices
    x = (noise(-62) + 0.002 * (s1 + s2)).astype(np.float32)      # hiss and a whisper far away
    g = A.gain_for([x, x], A.TARGET_LUFS, A.PEAK_CEILING)
    noise_band = float(np.percentile(A._frames_db(x.astype(np.float64)), 10))   # in the speech band
    assert g.get("limited_by_noise") and noise_band + g["gain_db"] <= A.NOISE_MAX + 0.2


def test_split_all_splits_every_stereo_clip_and_keeps_the_sum_under_the_ceiling(tmp_path):
    # the user's workflow (2026-11-03): even identical channels are split on request; the analysis only informs
    import numpy as np
    import synth
    from asistent.audio import analyze_item
    s1, _ = synth.scene(20.0, seed=4)
    x = synth.mic([(s1, 1.0)], 0.0, 15.0, seed=1)
    stereo = synth.write_wav(tmp_path / "same.wav", [x, x])
    r = analyze_item(stereo, force="split_all")
    assert r["action"] == "split" and [o["route"] for o in r["outputs"]] == ["LL", "RR"]
    assert r["reasons"][0].startswith("Разделено на L/L и R/R. За сведение: анализът вижда еднакви канали")
    mix = sum(np.asarray(x, np.float64) * 10 ** (o["gain_db"] / 20) for o in r["outputs"])
    assert 20 * np.log10(np.max(np.abs(mix))) <= -6.0 + 0.6        # true peak vs sample peak margin
    mono = synth.write_wav(tmp_path / "mono.wav", [x])
    assert analyze_item(mono, force="split_all")["action"] == "none"
