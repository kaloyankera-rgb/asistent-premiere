"""Smart Auto Sync on synthetic recordings with a known answer.

Rule checked in every case: a High result is within 1 ms of the truth, and a case that has no
reliable answer never comes back High.
"""
import numpy as np
import pytest
from scipy import signal

import synth
from asistent.sync import sync_clips

TOL = 0.001


@pytest.fixture(scope="session")
def talkers():
    return synth.scene(200.0, seed=3)


def run(*paths):
    return sync_clips(list(paths), reference=0)


def check_high(res, truth):
    clip = res["clips"][1]
    assert clip["confidence"] == "high", clip["reasons"]
    assert abs(clip["offset"] - truth) <= TOL, (clip["offset"], truth)
    return clip


def cam(talkers, start, seconds, **kw):
    s1, s2 = talkers
    return synth.mic([(s1, 1.0), (s2, 0.8)], start, seconds, **kw)


def test_clean_positive_offset(tmp_path, talkers):
    a = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 10.0, 120.0, seed=1)])
    b = synth.write_wav(tmp_path / "b.wav", [cam(talkers, 13.217, 100.0, color=(200, 6000), seed=2)])
    check_high(run(a, b), 3.217)


def test_b_started_first(tmp_path, talkers):
    a = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 20.0, 100.0, seed=1)])
    b = synth.write_wav(tmp_path / "b.wav", [cam(talkers, 12.5, 120.0, seed=2)])
    check_high(run(a, b), -7.5)


def test_extremely_quiet(tmp_path, talkers):
    a = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 10.0, 90.0, seed=1)])
    b = synth.write_wav(tmp_path / "b.wav", [cam(talkers, 14.0, 80.0, gain_db=-50, noise_db=-95, seed=2)],
                        bits16=True)
    check_high(run(a, b), 4.0)


def test_noisy_reference(tmp_path, talkers):
    a = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 10.0, 90.0, noise_db=-16, seed=1)])  # ~0 dB SNR
    b = synth.write_wav(tmp_path / "b.wav", [cam(talkers, 11.75, 80.0, seed=2)])
    check_high(run(a, b), 1.75)


def test_two_lavaliers_left_right(tmp_path, talkers):
    s1, s2 = talkers
    left = synth.mic([(s1, 1.0), (s2, 0.03)], 10.0, 90.0, seed=1, color=(120, 9000))
    right = synth.mic([(s2, 1.0), (s1, 0.03)], 10.0, 90.0, seed=2, color=(120, 9000), gain_db=-12)
    a = synth.write_wav(tmp_path / "lav.wav", [left, right])
    b = synth.write_wav(tmp_path / "cam.wav", [cam(talkers, 15.5, 80.0, color=(300, 5000), noise_db=-40, seed=3)])
    clip = check_high(run(a, b), 5.5)
    assert clip["channels"]


def test_silent_channel_is_ignored(tmp_path, talkers):
    a = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 10.0, 90.0, seed=1), np.zeros(90 * 48000, np.float32)])
    b = synth.write_wav(tmp_path / "b.wav", [cam(talkers, 12.0, 80.0, seed=2)])
    res = run(a, b)
    check_high(res, 2.0)
    found = res["clips"][0]["channels_found"]
    assert any(c["silent"] for c in found)


def test_partial_overlap(tmp_path, talkers):
    a = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 0.0, 90.0, seed=1)])
    b = synth.write_wav(tmp_path / "b.wav", [cam(talkers, 60.0, 90.0, seed=2)])
    check_high(run(a, b), 60.0)


def test_different_sample_rates(tmp_path, talkers):
    a = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 10.0, 90.0, sr=48000, seed=1)], sr=48000)
    b = synth.write_wav(tmp_path / "b.wav", [cam(talkers, 12.3456, 80.0, sr=44100, seed=2)], sr=44100)
    check_high(run(a, b), 2.3456)


def test_drift_is_reported_not_applied(tmp_path):
    s1, s2 = synth.scene(330.0, seed=6)
    a = synth.write_wav(tmp_path / "a.wav", [synth.mic([(s1, 1.0), (s2, 0.8)], 5.0, 320.0, seed=1)])
    b = synth.write_wav(tmp_path / "b.wav", [synth.mic([(s1, 1.0), (s2, 0.8)], 7.0, 315.0, drift_ppm=90, seed=2)])
    clip = run(a, b)["clips"][1]
    # 90 ppm over 5 minutes is ~28 ms: more than half a frame, so it must not be applied on its own
    assert clip["confidence"] != "high", clip
    assert abs(abs(clip["drift_ppm"]) - 90) < 20, clip["drift_ppm"]


def test_no_common_audio_is_refused(tmp_path, talkers):
    other1, other2 = synth.scene(100.0, seed=99)
    a = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 10.0, 90.0, seed=1)])
    b = synth.write_wav(tmp_path / "b.wav", [synth.mic([(other1, 1.0), (other2, 1.0)], 0.0, 90.0, seed=2)])
    assert run(a, b)["clips"][1]["confidence"] == "low"


def test_repeating_sound_is_not_high(tmp_path):
    sr = 48000
    t = np.arange(120 * sr) / sr
    click = ((t % 0.5) < 0.004) * np.sin(2 * np.pi * 1000 * t) * 0.5          # metronome, 120 bpm
    rng = np.random.default_rng(5)
    a = synth.write_wav(tmp_path / "a.wav", [(click + rng.standard_normal(len(t)) * 1e-3).astype(np.float32)])
    b = synth.write_wav(tmp_path / "b.wav", [(np.roll(click, int(1.23 * sr)) + rng.standard_normal(len(t)) * 1e-3)
                                             .astype(np.float32)])
    assert run(a, b)["clips"][1]["confidence"] != "high"


def test_three_cameras(tmp_path, talkers):
    a = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 10.0, 120.0, seed=1)])
    b = synth.write_wav(tmp_path / "b.wav", [cam(talkers, 12.0, 100.0, seed=2)])
    c = synth.write_wav(tmp_path / "c.wav", [cam(talkers, 5.0, 110.0, seed=3, color=(250, 4000))])
    res = run(a, b, c)
    offs = [r["offset"] for r in res["clips"]]
    assert all(r["confidence"] in ("reference", "high") for r in res["clips"])
    assert abs(offs[1] - 2.0) <= TOL and abs(offs[2] + 5.0) <= TOL
    assert min(r["start"] for r in res["clips"]) == 0.0


def test_mp4_with_delayed_audio_stream(tmp_path, talkers):
    wa = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 10.0, 60.0, seed=1)])
    wb = synth.write_wav(tmp_path / "b.wav", [cam(talkers, 13.0, 50.0, seed=2)])
    a = synth.write_mp4(tmp_path / "a.mp4", wa)
    b = synth.write_mp4(tmp_path / "b.mp4", wb, audio_delay=0.2)
    clip = run(a, b)["clips"][1]
    # B's audio starts 0.2 s after its picture, so B's picture starts 0.2 s earlier than its sound says
    assert clip["confidence"] == "high", clip["reasons"]
    assert abs(clip["stream_lead_fix"] + 0.2) < 0.03
    assert abs(clip["offset"] - (3.0 - 0.2)) < 0.03   # AAC priming adds a few ms


def test_vfr_is_flagged(tmp_path, talkers):
    wa = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 10.0, 40.0, seed=1)])
    wb = synth.write_wav(tmp_path / "b.wav", [cam(talkers, 12.0, 30.0, seed=2)])
    a = synth.write_mp4(tmp_path / "a.mp4", wa)
    b = synth.write_mp4(tmp_path / "b.mp4", wb, vfr=True)
    clip = run(a, b)["clips"][1]
    assert any("VFR" in w for w in clip["warnings"]), clip["warnings"]


def test_short_take(tmp_path, talkers):
    a = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 10.0, 12.0, seed=1)])
    b = synth.write_wav(tmp_path / "b.wav", [cam(talkers, 11.1, 8.0, seed=2)])
    check_high(run(a, b), 1.1)


def test_reverberant_room_camera_vs_close_lavalier(tmp_path, talkers):
    s1, s2 = talkers
    rng = np.random.default_rng(11)
    n = int(0.6 * synth.SCENE_SR)                       # RT60 ~ 0.6 s
    ir = rng.standard_normal(n) * np.exp(-6.9 * np.arange(n) / n)
    ir[0] = np.sqrt(np.sum(ir[1:] ** 2))                # direct = reverberant energy (camera ~1.5 m away)
    ir /= np.abs(ir).sum() / 4
    room1 = signal.fftconvolve(s1, ir)[: len(s1)]
    room2 = signal.fftconvolve(s2, ir)[: len(s2)]
    lav = synth.mic([(s1, 1.0), (s2, 0.05)], 10.0, 60.0, seed=1)
    far = synth.mic([(room1, 1.0), (room2, 1.0)], 14.25, 50.0, noise_db=-45, seed=2, color=(200, 6000))
    a = synth.write_wav(tmp_path / "lav.wav", [lav])
    b = synth.write_wav(tmp_path / "far.wav", [far])
    check_high(run(a, b), 4.25)


@pytest.mark.parametrize("seed", [21, 22, 23, 24, 25])
def test_unrelated_recordings_never_high(tmp_path, talkers, seed):
    o1, o2 = synth.scene(70.0, seed=seed)
    a = synth.write_wav(tmp_path / "a.wav", [cam(talkers, 10.0, 60.0, seed=1)])
    b = synth.write_wav(tmp_path / "b.wav", [synth.mic([(o1, 1.0), (o2, 0.9)], 0.0, 60.0, seed=seed + 500)])
    clip = run(a, b)["clips"][1]
    assert clip["confidence"] == "low"
    assert clip["windows_agree"] / clip["windows_total"] < 0.4     # keep a wide margin below High (0.6)
