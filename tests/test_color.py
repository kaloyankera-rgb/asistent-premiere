"""Smart White Balance + exposure on synthetic scenes with a known truth."""
import subprocess

import numpy as np
import pytest

from asistent import color as C


def skin_k():
    """Scale of the skin colour so that well exposed skin reads 0.62 encoded luma."""
    base = np.array([0.45, 0.28, 0.20])
    lo, hi = 0.01, 3.0
    for _ in range(60):
        k = (lo + hi) / 2
        y = C._luma(C.encode(base * k)[None, None, :])[0, 0]
        lo, hi = (k, hi) if y < C.SKIN_TARGET else (lo, k)
    return base * k


SKIN = skin_k()


def scene(seed=0, wall=True, window=False, h=120, w=160):
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 3))
    rows = np.linspace(0, h, 7).astype(int)
    patches = []
    if wall:
        patches += [np.array([0.30, 0.30, 0.30]), np.array([0.65, 0.65, 0.65])]       # grey wall, white paper
    else:
        patches += [np.array([0.35, 0.20, 0.08]), np.array([0.30, 0.18, 0.10])]       # warm wood, no neutrals
    patches += [SKIN, np.array([0.05, 0.20, 0.04]), np.array([0.20, 0.05, 0.25]), np.array([0.02, 0.02, 0.02])]
    for i, p in enumerate(patches):
        img[rows[i]:rows[i + 1]] = p
    img *= 1 + 0.05 * rng.standard_normal((h, w, 1))
    if window:
        img[: h // 3, : w // 2] = 1.0                                                 # bright window at the edge of clipping
    return np.clip(img, 0, None)


def shot(lin, gains=(1, 1, 1), stops=0.0, n=5):
    """The camera got it wrong by `gains` and `stops`: what it recorded (encoded)."""
    out = []
    for i in range(n):
        f = lin * np.array(gains) * 2 ** stops * (1 + 0.01 * i)
        out.append(C.encode(f))
    return out


def test_correct_footage_is_left_alone():
    r = C.decide(shot(scene()))
    assert r["exposure"]["stops"] == 0
    assert r["white"]["balanced"] and r["white"]["confidence"] == "high"


@pytest.mark.parametrize("under", [0.5, 1.0, 1.5, 2.0])
def test_underexposure_found_in_half_stops(under):
    r = C.decide(shot(scene(), stops=-under))
    assert r["exposure"]["stops"] == under and r["exposure"]["basis"] == "кожата"
    assert r["exposure"]["confidence"] == "high"


def test_warm_and_cool_casts():
    warm = C.decide(shot(scene(), gains=(1.25, 1.0, 0.8)))
    assert warm["white"]["fix_temp"] == pytest.approx(np.log2(1.25 / 0.8), abs=0.06)
    assert warm["white"]["confidence"] == "high"
    cool = C.decide(shot(scene(), gains=(0.82, 1.0, 1.2)))
    assert cool["white"]["fix_temp"] == pytest.approx(-np.log2(1.2 / 0.82), abs=0.06)


def test_green_and_magenta_casts():
    green = C.decide(shot(scene(), gains=(1.0, 1.18, 1.0)))
    assert green["white"]["fix_tint"] == pytest.approx(-np.log2(1.18), abs=0.04)
    assert any("Зелен" in r for r in green["reasons"])
    mag = C.decide(shot(scene(), gains=(1.1, 0.88, 1.1)))
    assert mag["white"]["fix_tint"] > 0.1 and any("магента" in r for r in mag["reasons"])


def test_correction_actually_neutralises_the_wall():
    lin = scene()
    r = C.decide(shot(lin, gains=(1.2, 1.1, 0.8)))
    wall = lin[5, 5] * np.array([1.2, 1.1, 0.8]) * np.array(r["white"]["gains"])
    assert np.ptp(np.log2(wall)) < 0.06                      # R, G and B of the grey wall equal again


def test_coloured_objects_do_not_fake_a_cast():
    lin = scene()
    lin[60:, :] = np.array([0.05, 0.25, 0.04])               # half the picture is a green plant wall
    r = C.decide(shot(lin))
    assert r["white"]["balanced"]


def test_warm_room_without_neutrals_is_not_touched():
    r = C.decide(shot(scene(wall=False), gains=(1.2, 1.0, 0.75)))
    assert r["white"]["confidence"] == "low"


def test_highlights_are_flagged_for_a_render_check():
    r = C.decide(shot(scene(window=True), stops=-2.0))
    assert r["exposure"]["stops"] == 2.0
    assert r["exposure"]["burn_estimate"] > C.NEW_CLIP and any("изгор" in w for w in r["warnings"])


def test_new_clipping_measure():
    lin = scene(window=True)
    before = C.encode(lin * 0.25)
    after = C.encode(lin)
    assert C.new_clipping(before, after) > 0.1
    assert C.new_clipping(before, before) == 0.0


def test_slog3_is_measured_after_conversion():
    lin = scene()
    sg = lin @ np.linalg.inv(C.SG3C_TO_709).T                  # Rec.709 linear -> S-Gamut3.Cine linear

    def slog3(x):                                              # Sony S-Log3 encoding (the inverse of slog3_to_linear)
        x = np.asarray(x, dtype=np.float64)
        return np.where(x >= 0.01125000,
                        (420.0 + np.log10((np.maximum(x, 1e-9) + 0.01) / (0.18 + 0.01)) * 261.5) / 1023.0,
                        (x * (171.2102946929 - 95.0) / 0.01125000 + 95.0) / 1023.0)

    # what ffmpeg hands over: legal-range code values stretched to full range
    frames = [(slog3(sg * (1 + 0.01 * i)) * 1023.0 - 64) / (940 - 64) for i in range(4)]
    assert np.allclose(C.slog3_to_linear(slog3(np.array([0.18, 0.5, 0.01]))), [0.18, 0.5, 0.01], atol=1e-6)
    r = C.decide(frames, "s-log3-cine")
    assert r["exposure"]["stops"] == 0 and r["white"]["balanced"]
    assert r["white"]["confidence"] != "high" and any("S-Log3".lower() in w.lower() or "log" in w for w in r["warnings"])
    flat = C.decide(frames, None)                               # read as if it were Rec.709: wrongly dark
    assert flat["exposure"]["measured"] != r["exposure"]["measured"]


def test_from_a_real_file(tmp_path):
    frames = shot(scene(), gains=(1.25, 1.0, 0.8), stops=-1.0, n=1)
    raw = (np.clip(frames[0], 0, 1) * 65535).astype("<u2")
    h, w = raw.shape[:2]
    out = tmp_path / "clip.mov"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", f"{w}x{h}", "-r", "25",
                    "-i", "-", "-t", "2", "-vf", "loop=49:1:0,scale=out_color_matrix=bt709:out_range=tv,format=yuv422p10le",
                    "-c:v", "prores_ks", "-profile:v", "3", "-color_primaries", "bt709", "-color_trc", "bt709",
                    "-colorspace", "bt709", str(out)], input=raw.tobytes(), check=True)
    r = C.analyze_clip(str(out))
    assert r["exposure"]["stops"] == 1.0
    assert r["white"]["fix_temp"] == pytest.approx(np.log2(1.25 / 0.8), abs=0.1)


def test_calibration_learns_and_converts(tmp_path):
    cal = C.Calibration(str(tmp_path / "lumetri.json"))
    assert not cal.learnt("temp")
    first = cal.sliders(0.5, -0.2)
    assert first["temperature"] == pytest.approx(0.5 * C.Calibration.GUESS["temp"])
    assert cal.learn("temp", 30.0, 0.25)                    # 30 units moved the cast by 0.25 log2
    assert not cal.learn("tint", 2.0, 0.3)                  # too small to trust
    again = C.Calibration(str(tmp_path / "lumetri.json"))  # remembered
    assert again.k("temp") == pytest.approx(120.0) and again.sliders(0.5, 0)["temperature"] == pytest.approx(60.0)


def test_preview_and_items(tmp_path):
    frames = shot(scene(), gains=(1.25, 1.0, 0.8), stops=-1.0, n=3)
    r = C.decide(frames)
    pv = C.preview(frames, None, r)
    assert len(pv["before"]) > 100 and len(pv["after"]) > 100 and pv["before"] != pv["after"]
