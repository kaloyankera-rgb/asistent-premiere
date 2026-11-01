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


def test_probe_measures_units_and_fills_the_table(tmp_path, monkeypatch):
    import subprocess as sp
    monkeypatch.setenv("HOME", str(tmp_path))                 # calibration file goes to a temp app dir
    from asistent import config
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))

    def png(enc, name):
        raw = (np.clip(enc, 0, 1) * 65535).astype("<u2")
        h, w = raw.shape[:2]
        path = tmp_path / name
        sp.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", f"{w}x{h}", "-i", "-",
                "-frames:v", "1", str(path)], input=raw.tobytes(), check=True)
        return str(path)

    lin = scene()
    base = png(C.encode(lin), "base.png")
    frames = [
        {"param": "exposure", "from": 0, "to": 1, "path": png(C.encode(lin * 2), "e.png")},
        {"param": "temperature", "from": 0, "to": 50, "path": png(C.encode(lin * np.array([1.2, 1, 0.83])), "t.png")},
        {"param": "tint", "from": 0, "to": 50, "path": png(C.encode(lin * np.array([1, 0.85, 1])), "g.png")},
        {"param": "contrast", "missing": True},
        {"param": "saturation", "from": 100, "to": 150, "path": png(C.encode(lin), "s.png")},
    ]
    res = C.probe_measure({"baseline": base, "source": base}, frames)
    t = res["table"]
    assert t["exposure"] == "SUPPORTED" and t["white_balance"] == "SUPPORTED"
    assert t["contrast"] == "BLOCKED" and t["saturation"] == "BLOCKED"
    assert res["units"]["exposure_stops_per_unit"] == pytest.approx(1.0, abs=0.05)
    assert res["units"]["temperature_units_per_log2"] < 0                # warmer picture = lower B/R
    assert res["identity"] == {"stops": 0.0, "temp": 0.0, "tint": 0.0}
    assert all(abs(r - 1.0) < 0.05 for _, r in res["units"]["exposure_curve"])   # a plain doubling: 1 stop/unit
    assert C.Calibration().data["exposure_curve"] == res["units"]["exposure_curve"]


def test_upright_clip_keeps_its_proportions(tmp_path):
    land = tmp_path / "land.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:d=1", "-c:v", "libx264",
                    str(land)], check=True)
    up = tmp_path / "upright.mp4"                                   # how a camera held upright stores it
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-display_rotation", "90", "-i", str(land), "-c", "copy", str(up)],
                   check=True)
    f = C.read_frames(str(up), n=1, width=320)[0]
    assert f.shape[:2] == (320, 180)                                 # portrait, not squeezed into 16:9
    assert C.read_frames(str(land), n=1, width=320)[0].shape[:2] == (180, 320)


def test_exported_frame_found_under_either_name(tmp_path):
    # the panel asks Premiere for "x.png" (the name must carry the format); 26.0.2 may save it as "x.png.png"
    asked = tmp_path / "before_0.png"
    assert C._wait_file(str(asked), 0.3) is None
    (tmp_path / "before_0.png.png").write_bytes(b"\x89PNG")
    assert C._wait_file(str(asked), 0.3) == str(asked) + ".png"
    asked.write_bytes(b"\x89PNG")
    assert C._wait_file(str(asked), 0.3) == str(asked)


def test_probe_with_identical_frames_is_unverified_and_learns_nothing(tmp_path, monkeypatch):
    # 26.0.2 queued every export and rendered them all after the values were restored: seven equal frames
    import subprocess as sp
    from asistent import config
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    raw = (np.clip(C.encode(scene()), 0, 1) * 65535).astype("<u2")
    h, w = raw.shape[:2]
    paths = []
    for name in ("base", "e", "t", "g"):
        p = tmp_path / f"{name}.png"
        sp.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", f"{w}x{h}", "-i", "-",
                "-frames:v", "1", str(p)], input=raw.tobytes(), check=True)
        paths.append(str(p))
    frames = [{"param": "exposure", "from": 0, "to": 1, "path": paths[1]},
              {"param": "temperature", "from": 0, "to": 50, "path": paths[2]},
              {"param": "tint", "from": 0, "to": 50, "path": paths[3]}]
    res = C.probe_measure({"baseline": paths[0]}, frames)
    assert "error" in res and set(res["table"].values()) == {"UNVERIFIED"} and res["units"] == {}
    assert not (tmp_path / "lumetri.json").exists()


def test_frame_wait_returns_only_a_finished_file(tmp_path):
    p = tmp_path / "x.png"
    p.write_bytes(b"\x89PNG" * 10)
    assert C._wait_file(str(p), 1.0) == str(p)                      # same size on two looks


def test_old_frames_pruned(tmp_path):
    import os
    import time
    old, new = tmp_path / "old.png.png", tmp_path / "new.png"
    old.write_bytes(b"1")
    new.write_bytes(b"1")
    t = time.time() - 2 * 24 * 3600
    os.utime(old, (t, t))
    assert C.prune_frames(str(tmp_path)) == 1
    assert new.exists() and not old.exists()


def test_exposure_units_follow_the_probe_curve(tmp_path):
    cal = C.Calibration(str(tmp_path / "lumetri.json"))
    assert cal.exposure_units(1.0, 0.6) == 1.0                       # no curve yet: 1 unit = 1 stop
    # the curve measured on C0737 (2026-11-01): full stop in the shadows, shoulder towards the highlights
    assert cal.set_exposure_curve([[0.06, 1.0], [0.15, 0.99], [0.35, 0.92], [0.55, 0.79], [0.65, 0.68], [0.75, 0.57]])
    assert cal.exposure_units(1.0, 0.1) == pytest.approx(1.0, abs=0.05)
    assert cal.exposure_units(0.5, 0.65) == pytest.approx(0.75, abs=0.05)   # skin needs more units than stops
    assert cal.exposure_units(-1.0, 0.65) == -1.0                    # darkening never measured: unchanged
    assert cal.exposure_units(2.0, 0.95) <= 2 * C.MAX_STOPS          # never runs away at the bright end
    again = C.Calibration(str(tmp_path / "lumetri.json"))            # kept on disk
    assert again.exposure_units(0.5, 0.65) == cal.exposure_units(0.5, 0.65)


def test_exposure_curve_reads_a_shoulder():
    rng = np.random.default_rng(1)
    lin = rng.uniform(0.002, 0.6, size=(200, 300, 1)) * np.ones(3)
    # a +1 stop gain with a soft shoulder above 0.25 linear, like Lumetri's Exposure
    up = lin * 2
    shoulder = np.where(up > 0.25, 0.25 + (up - 0.25) / (1 + (up - 0.25) * 2), up)
    curve = C.exposure_curve(C.encode(lin), C.encode(shoulder), 1.0)
    rates = dict(curve)
    assert min(rates.values()) < 0.8 and max(rates.values()) > 0.95
    ys = sorted(rates)
    assert rates[ys[0]] > rates[ys[-1]]                               # darker pixels move further


def test_probe_values_win_over_render_check_learning(tmp_path):
    cal = C.Calibration(str(tmp_path / "lumetri.json"))
    assert cal.learn("temp", 40.0, -0.475)                              # a render check (biased: −84)
    assert not cal.from_probe("temp")
    assert cal.set_probe("temp", 50.0, -1.0)                            # the probe: −50, exact
    assert cal.from_probe("temp") and cal.k("temp") == -50.0
    assert cal.sliders(0.5, 0)["temperature"] == -25.0
    assert C.Calibration(str(tmp_path / "lumetri.json")).k("temp") == -50.0
    assert not cal.set_probe("tint", 50.0, 0.001)                       # nothing moved: not stored
