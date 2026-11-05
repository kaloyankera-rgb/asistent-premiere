"""Smart White Balance + exposure on synthetic scenes with a known truth."""
import subprocess

import numpy as np
import pytest

from asistent import color as C
from asistent import faces as F


@pytest.fixture(autouse=True)
def synthetic_face(monkeypatch):
    """scene() puts the skin colour in one band (rows 2-3 of 6): that band is the 'face' the detector finds. The
    real detector is tested on real footage (test_real_skin.py); skin is no longer found by colour."""
    def detect(enc):
        h, w = enc.shape[:2]
        rows = np.linspace(0, h, 7).astype(int)
        return [(0, int(rows[2]), w, int(rows[3] - rows[2]), 0.95)]
    monkeypatch.setattr(F, "detect", detect)


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
    assert r["exposure"]["stops"] == under and r["exposure"]["basis"] == "the skin"
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
    assert any("Green" in r for r in green["reasons"])
    mag = C.decide(shot(scene(), gains=(1.1, 0.88, 1.1)))
    assert mag["white"]["fix_tint"] > 0.1 and any("magenta" in r for r in mag["reasons"])


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
    assert r["exposure"]["burn_estimate"] > C.NEW_CLIP and any("clip" in w for w in r["warnings"])


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


def test_pullback_brings_clipping_to_the_limit_and_not_much_further(tmp_path):
    cal = C.Calibration(str(tmp_path / "lumetri.json"))                 # no curve: 1 stop per unit
    rng = np.random.default_rng(3)
    lin = rng.uniform(0.0, 1.0, size=(300, 400, 1)) ** 3 * 0.6 * np.ones(3)   # ~8 % clips at +1
    shot = lambda u: C.encode(lin * 2 ** u)
    before, units = shot(0), 1.0
    over = C.new_clipping(before, shot(units))
    assert over > 0.05                                                    # the case seen on fx31032 (5.6 %)
    back = C.pullback_units(before, shot(units), units, cal)
    assert 0 < back < units
    landed = C.new_clipping(before, shot(units - back))
    assert landed <= C.NEW_CLIP + 0.002                                   # under the limit …
    assert landed >= C.NEW_CLIP - 0.012                                   # … without throwing light away


def test_no_pullback_under_the_limit(tmp_path):
    cal = C.Calibration(str(tmp_path / "lumetri.json"))
    lin = np.linspace(0.01, 0.2, 120000).reshape(300, 400, 1) * np.ones(3)
    assert C.pullback_units(C.encode(lin), C.encode(lin * 2), 1.0, cal) == 0.0


def test_pullback_uses_the_curve_for_bright_pixels(tmp_path):
    flat = C.Calibration(str(tmp_path / "a.json"))
    curved = C.Calibration(str(tmp_path / "b.json"))
    curved.set_exposure_curve([[0.1, 1.0], [0.5, 0.85], [0.7, 0.63], [0.86, 0.4]])
    rng = np.random.default_rng(4)
    lin = rng.uniform(0.0, 1.0, size=(300, 400, 1)) ** 3 * 0.6 * np.ones(3)   # ~8 % clips at +1
    b, a = C.encode(lin), C.encode(lin * 2)
    # highlights move slowly per unit, so taking them back under the limit costs more units
    assert C.pullback_units(b, a, 1.0, curved) > C.pullback_units(b, a, 1.0, flat)


# ---- final clipping verdict (soft tolerance 0.25 points over the 3 % target; verified case C0739: 3.08 %)

@pytest.mark.parametrize("pct, status", [
    (3.00, "ACCEPTED"),
    (3.01, "ACCEPTED_WITH_WARNING"),
    (3.08, "ACCEPTED_WITH_WARNING"),
    (3.25, "ACCEPTED_WITH_WARNING"),
    (3.26, "REVIEW_NEEDED"),
])
def test_clipping_boundaries(pct, status):
    new = pct / 100
    v = C.classify_clipping(new, {"skin": 0.0, "light": 0.0, "detail": new}, exposure_after=0.10)
    assert v["clipping_status"] == status


def test_c0739_message_exactly():
    # 12:40 recheck: 3.08 % newly clipped, skin 0.10 stop from target
    v = C.classify_clipping(0.0308, {"skin": 0.0, "light": 0.0, "detail": 0.0308}, exposure_after=0.10057)
    assert v["clipping_status"] == "ACCEPTED_WITH_WARNING"
    assert v["clipping_message"] == ("Minor highlight clipping remains (3.08%, target ≤3.00%). "
                                     "Skin exposure is preserved. No further correction applied.")
    assert "Skin exposure is preserved" in v["clipping_message"]


def test_skin_preserved_is_claimed_only_when_true():
    v = C.classify_clipping(0.0308, {"skin": 0.0, "detail": 0.0308}, exposure_after=0.45)
    assert v["clipping_status"] == "ACCEPTED_WITH_WARNING"
    assert "Skin exposure is preserved" not in v["clipping_message"]


def test_tolerance_is_configurable():
    r = {"skin": 0.0, "light": 0.0, "detail": 0.0308}
    assert C.classify_clipping(0.0308, r, 0.1, soft_tolerance=0.0)["clipping_status"] == "REVIEW_NEEDED"
    assert C.classify_clipping(0.0340, {**r, "detail": 0.034}, 0.1, soft_tolerance=0.005)["clipping_status"] \
        == "ACCEPTED_WITH_WARNING"


def test_clipping_on_skin_needs_review_even_under_the_target():
    v = C.classify_clipping(0.02, {"skin": 0.05, "light": 0.0, "detail": 0.02}, exposure_after=0.0)
    assert v["clipping_status"] == "REVIEW_NEEDED" and "skin" in v["clipping_message"]


def test_excess_in_lamps_and_windows_is_a_warning_not_a_review():
    # 4 % in all, but 2.5 % of it was near white already (a window): the detail itself is under 3 %
    v = C.classify_clipping(0.04, {"skin": 0.0, "light": 0.025, "detail": 0.015}, exposure_after=0.05)
    assert v["clipping_status"] == "ACCEPTED_WITH_WARNING" and "near white" in v["clipping_message"]
    # the same 4 % in real detail is over the tolerance
    v = C.classify_clipping(0.04, {"skin": 0.0, "light": 0.0, "detail": 0.04}, exposure_after=0.05)
    assert v["clipping_status"] == "REVIEW_NEEDED"


def test_clipping_regions_split_window_from_skin_and_detail(monkeypatch):
    monkeypatch.setattr(F, "detect", lambda enc: [(100, 0, 60, 100, 0.95)])      # the face: the skin patch below
    h, w = 200, 300
    before = np.full((h, w, 3), 0.5)
    before[:, :60] = 0.93                                  # a window, near white already
    before[:100, 100:160] = C.encode(np.array([0.45, 0.28, 0.20]) * 1.2)   # skin, stays under the clip
    before[150:, 200:] = 0.85                              # a pale wall (detail)
    after = np.clip(before * 1.15, 0, 1)                   # everything above ~0.84 burns out
    r = C.clipping_regions(before, after)
    assert r["skin"] == 0.0
    assert r["light"] == pytest.approx(60 * h / (h * w), abs=1e-3)
    assert r["detail"] == pytest.approx(50 * 100 / (h * w), abs=1e-3)
    assert r["light"] + r["detail"] == pytest.approx(C.new_clipping(before, after), abs=1e-3)
    burnt_skin = np.clip(before * 1.4, 0, 1)               # now the skin patch clips too
    assert C.clipping_regions(before, burnt_skin)["skin"] > C.SKIN_CLIP_LIMIT


def test_verdict_never_changes_the_validated_step_back(tmp_path):
    # the classification is reporting only: pullback_units and its 3 % target are untouched
    cal = C.Calibration(str(tmp_path / "lumetri.json"))
    rng = np.random.default_rng(3)
    lin = rng.uniform(0.0, 1.0, size=(300, 400, 1)) ** 3 * 0.6 * np.ones(3)
    shot = lambda u: C.encode(lin * 2 ** u)
    assert C.pullback_units(shot(0), shot(1.0), 1.0, cal) == C.pullback_units(shot(0), shot(1.0), 1.0, cal,
                                                                               limit=C.NEW_CLIP)


def test_warm_near_white_highlights_are_not_burnt_skin(monkeypatch):
    monkeypatch.setattr(F, "detect", lambda enc: [(100, 0, 60, 100, 0.95)])      # the face: the real skin patch
    # C0739 regression: warm pixels at 0.94-0.97 sit in the skin colour box; their clipping is a highlight,
    # and the 3.08 % result must stay ACCEPTED_WITH_WARNING
    h, w = 200, 300
    before = np.full((h, w, 3), 0.45)
    before[:100, 100:160] = C.encode(np.array([0.45, 0.28, 0.20]) * 1.2)       # real skin, stays fine
    warm = np.array([0.955, 0.86, 0.80])                                           # warm near-white glow
    assert C._skin(warm[None, None, :])[0, 0]                                      # it does pass as skin colour
    before[150:, :] = warm
    after = before.copy()
    after[150:, :] = 1.0                                                           # the glow burns out
    r = C.clipping_regions(before, after)
    assert r["skin"] == 0.0 and r["detail"] == 0.0 and r["light"] > 0
    v = C.classify_clipping(0.0308, {**r, "light": 0.0308}, exposure_after=0.10)
    assert v["clipping_status"] == "ACCEPTED_WITH_WARNING"


def test_first_check_before_a_step_back_is_not_a_final_verdict(tmp_path):
    import subprocess as sp
    rng = np.random.default_rng(3)
    lin = rng.uniform(0.0, 1.0, size=(120, 160, 1)) ** 3 * 0.6 * np.ones(3)
    paths = []
    for name, u in (("b", 0.0), ("a", 1.0)):
        raw = (C.encode(lin * 2 ** u) * 65535).astype("<u2")
        p = tmp_path / f"{name}.png"
        sp.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", "160x120", "-i", "-",
                "-frames:v", "1", str(p)], input=raw.tobytes(), check=True)
        paths.append(str(p))
    r = C.check_render(paths[0], paths[1], 1.0, C.Calibration(str(tmp_path / "l.json")))
    assert r["pullback_units"] > 0 and r["clipping_status"] == "STEP_BACK"
    assert "No further correction" not in r["clipping_message"]


# ---- analysis on timeline renders (spec T13/T18): a corrected clip must not get the same correction again

def _png(enc, path):
    import subprocess as sp
    raw = (np.clip(enc, 0, 1) * 65535).astype("<u2")
    h, w = raw.shape[:2]
    sp.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", f"{w}x{h}", "-i", "-",
            "-frames:v", "1", str(path)], input=raw.tobytes(), check=True)
    return str(path)


@pytest.fixture
def frames_dir(tmp_path, monkeypatch):
    from asistent import config
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    (tmp_path / "frames").mkdir()
    return tmp_path / "frames"


def test_rerun_on_a_corrected_clip_suggests_nothing(frames_dir):
    dark = scene() / 2 ** 1.5                                         # needs about +1.5 stops
    raw_tl = [_png(C.encode(dark * (1 + 0.01 * k)), frames_dir / f"raw_{k}.png") for k in range(3)]
    first = C.analyze_items([{"path": "/nowhere/C0001.MP4", "frames": raw_tl}], with_preview=False)["items"][0]
    assert first["measured_on"] == "timeline" and first["exposure"]["stops"] == 1.5
    # the same clip after the correction: the timeline now shows it corrected
    fixed_tl = [_png(C.encode(dark * 2 ** 1.5 * (1 + 0.01 * k)), frames_dir / f"fixed_{k}.png") for k in range(3)]
    again = C.analyze_items([{"path": "/nowhere/C0001.MP4", "frames": fixed_tl}], with_preview=False)["items"][0]
    assert again["measured_on"] == "timeline" and again["exposure"]["stops"] == 0.0
    assert "status" not in again


def test_no_timeline_frames_falls_back_to_the_file_as_review_needed(frames_dir, tmp_path):
    import subprocess as sp
    clip = tmp_path / "C0002.MP4"
    sp.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:d=2", "-c:v", "libx264",
            str(clip)], check=True)
    r = C.analyze_items([{"path": str(clip), "frames": []}], with_preview=False)["items"][0]
    assert r["measured_on"] == "source" and r["status"] == "REVIEW_NEEDED"
    assert r["exposure"]["confidence"] == "low" and r["white"]["confidence"] == "low"
    assert any("not on the timeline" in w for w in r["warnings"])


def test_a_covered_clip_with_nothing_else_on_it_is_measured_on_the_file_for_real(frames_dir, tmp_path):
    """A visible layer over the clip, and the panel says the file shows the same picture (`plain`): the measurement keeps
    its confidence, so it can be applied (the user, 2026-11-05: Auto color did nothing under a safety template)."""
    import subprocess as sp
    clip = tmp_path / "C0706.MP4"
    sp.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:d=2", "-c:v", "libx264",
            str(clip)], check=True)
    plain = C.analyze_items([{"path": str(clip), "frames": [], "plain": True}], with_preview=False)["items"][0]
    review = C.analyze_items([{"path": str(clip), "frames": []}], with_preview=False)["items"][0]
    assert plain["measured_on"] == "source" and plain.get("status") != "REVIEW_NEEDED"
    assert any("Measured on the file" in x for x in plain["reasons"])
    assert (plain["exposure"]["confidence"], plain["white"]["confidence"]) == \
        (C.decide(C.read_frames(str(clip)))["exposure"]["confidence"], C.decide(C.read_frames(str(clip)))["white"]["confidence"])
    assert review["exposure"]["confidence"] == "low"


def test_frames_outside_the_engine_folder_are_ignored(frames_dir, tmp_path):
    import subprocess as sp
    clip = tmp_path / "C0003.MP4"
    sp.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:d=2", "-c:v", "libx264",
            str(clip)], check=True)
    outside = [_png(C.encode(scene()), tmp_path / f"x{k}.png") for k in range(3)]
    r = C.analyze_items([{"path": str(clip), "frames": outside}], with_preview=False)["items"][0]
    assert r["measured_on"] == "source" and r["status"] == "REVIEW_NEEDED"


def test_one_timeline_frame_is_not_enough(frames_dir, tmp_path):
    import subprocess as sp
    clip = tmp_path / "C0004.MP4"
    sp.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:d=2", "-c:v", "libx264",
            str(clip)], check=True)
    one = [_png(C.encode(scene()), frames_dir / "only.png")]
    assert C.analyze_items([{"path": str(clip), "frames": one}], with_preview=False)["items"][0]["measured_on"] == "source"


def test_log_footage_measured_on_the_timeline_is_only_a_suggestion(frames_dir, monkeypatch):
    from asistent import prepare
    monkeypatch.setattr(prepare, "sony_xml", lambda p: {"gamma": "s-log3-cine"})
    tl = [_png(C.encode(scene() / 2), frames_dir / f"log_{k}.png") for k in range(3)]
    r = C.analyze_items([{"path": "/nowhere/C0005.MP4", "frames": tl}], with_preview=False)["items"][0]
    assert r["measured_on"] == "timeline" and r["source_gamma"] == "s-log3-cine"
    assert r["exposure"]["confidence"] == "low" and r["white"]["confidence"] == "low"


def test_timeline_preview_comes_from_the_timeline_frames(frames_dir):
    tl = [_png(C.encode(scene() / 2), frames_dir / f"p_{k}.png") for k in range(3)]
    r = C.analyze_items([{"path": "/nowhere/C0006.MP4", "frames": tl}], with_preview=True)["items"][0]
    assert r["preview"]["before"] and r["preview"]["after"] and r["preview"]["portrait"] is False


def test_final_recheck_gets_a_verdict_never_a_step_back(tmp_path):
    # C0739 12:58 regression: the re-check at 3.08 % was labelled STEP_BACK ("steps back once by 0.05")
    import subprocess as sp
    rng = np.random.default_rng(3)
    lin = rng.uniform(0.0, 1.0, size=(120, 160, 1)) ** 3 * 0.6 * np.ones(3)
    paths = []
    for name, u in (("b", 0.0), ("a", 1.0)):
        raw = (C.encode(lin * 2 ** u) * 65535).astype("<u2")
        p = tmp_path / f"{name}.png"
        sp.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", "160x120", "-i", "-",
                "-frames:v", "1", str(p)], input=raw.tobytes(), check=True)
        paths.append(str(p))
    cal = C.Calibration(str(tmp_path / "l.json"))
    r = C.check_render(paths[0], paths[1], 1.0, cal, final=True)
    assert r["new_clipping"] > C.NEW_CLIP
    assert "pullback_units" not in r and r["clipping_status"] != "STEP_BACK"
    assert "No further correction applied" in r["clipping_message"]


def test_one_failing_clip_never_stops_the_others(frames_dir, monkeypatch):
    good = [_png(C.encode(scene() / 2), frames_dir / f"g_{k}.png") for k in range(3)]
    bad = [_png(C.encode(scene()), frames_dir / f"b_{k}.png") for k in range(3)]
    real = C.decide

    def flaky(frames, gamma=None, source_gamma=None):
        if abs(float(frames[0].mean()) - float(C.encode(scene()).mean())) < 1e-3:
            raise ValueError("boom")                                 # anything unexpected on one clip
        return real(frames, gamma, source_gamma)
    monkeypatch.setattr(C, "decide", flaky)
    res = C.analyze_items([{"path": "/nowhere/BAD.MP4", "frames": bad},
                           {"path": "/nowhere/GOOD.MP4", "frames": good}], with_preview=False)["items"]
    assert "error" in res[0] and "the others go on" in res[0]["error"]
    assert res[1]["measured_on"] == "timeline" and res[1]["exposure"]["stops"] > 0


def test_out_of_range_clip_gets_one_capped_pass_and_says_so():
    r = C.decide([scene() * 0 + C.encode(scene() / 2 ** 3.5)[..., :] for _ in range(3)])   # ~3.5 stops dark
    assert r["exposure"]["stops"] == C.MAX_STOPS                     # what is possible, nothing more
    assert any("out of range" in x for x in r["reasons"])


def test_no_keyframes_in_the_colour_path():
    # one value per parameter across the whole clip (user, 2026-11-01)
    import pathlib
    src = (pathlib.Path(__file__).parent.parent / "panel" / "premiere-color.js").read_text()
    assert "createSetTimeVaryingAction" not in src and "createAddKeyframeAction" not in src


# ---- accept / revert gates (colour plan B5)

def test_gates_white_worse_only_when_outside_neutral_and_further_than_before():
    g = C.gates({"cast_before": (-0.05, 0.02), "cast_after": (0.25, 0.0)}, {"temperature": -10, "tint": 0})
    assert g["white"] == "worse" and g["revert"] == ["white"]
    # fx39024 16:12: −0.094 → +0.096 is within the limits: not worse
    g = C.gates({"cast_before": (-0.094, 0.187), "cast_after": (0.096, -0.042)}, {"temperature": -4.9, "tint": 12.8})
    assert g["white"] == "better" and g["revert"] == []


def test_gates_exposure_overshoot_is_worse_undershoot_is_better():
    assert C.gates({"exposure_before": 0.5, "exposure_after": -0.9}, {"exposure": 1.2})["revert"] == ["exposure"]
    # fx39024 13:34: +2.43 → +0.68 (capped, still dark) is better, never reverted
    assert C.gates({"exposure_before": 2.43, "exposure_after": 0.68}, {"exposure": 2.1})["exposure"] == "better"
    assert C.gates({"exposure_before": 0.1, "exposure_after": 0.05}, {"exposure": 0.1})["exposure"] == "same"


def test_parts_not_applied_are_never_reverted():
    g = C.gates({"cast_before": (0, 0), "cast_after": (0.5, 0.5), "exposure_before": 0, "exposure_after": 3},
                {})
    assert g == {"white": "n/a", "exposure": "n/a", "revert": []}


def test_clipping_alone_never_reverts(tmp_path):
    # a clip that burns gets what is possible (user, 2026-11-01): clipping is not a revert gate. A dark room
    # with a bright window: the exposure fix lands on target while the window burns out.
    lin = scene(window=True) / 2 ** 1.5
    paths = [_png(C.encode(lin), tmp_path / "b.png"), _png(C.encode(lin * 2 ** 1.5), tmp_path / "a.png")]
    r = C.check_render(paths[0], paths[1], 1.5, C.Calibration(str(tmp_path / "l.json")), final=True,
                       applied={"exposure": 1.5})
    assert r["new_clipping"] > C.NEW_CLIP
    assert r["gates"]["exposure"] == "better" and r["gates"]["revert"] == []


def test_wood_in_the_frame_is_not_skin_for_exposure_and_burnt_skin(monkeypatch):
    # GStroy regression (2026-11-01): OSB boards sit in skin's colour; the single-clip Auto color used a colour box
    # and would have exposed for the wood. Without a face there is no skin at all: the mid-tones decide.
    h, w = 120, 160
    img = np.full((h, w, 3), 0.18)
    img[:, :90] = np.array([0.55, 0.30, 0.13]) * 0.5                       # wood, more than half of the frame
    enc = C.encode(np.clip(img, 0, 1))
    monkeypatch.setattr(F, "detect", lambda e: [])
    m = C.measure(enc)
    assert "exp_skin" not in m and "exp_mid" in m
    assert C.clipping_regions(enc, np.clip(enc * 1.3, 0, 1))["skin"] == 0.0
    r = C.decide([enc, enc])
    assert r["exposure"]["basis"] == "the midtones"
    monkeypatch.setattr(F, "detect", lambda e: [(100, 20, 40, 50, 0.9)])    # a face the detector says is there
    wall_face = C.measure(enc)                                              # ...on grey: a false detection
    assert "exp_skin" not in wall_face


def test_identical_frames_after_a_correction_are_not_a_verdict(tmp_path):
    # GStroy 2026-11-01: the same PNG before and after Exposure +2.15 / +4.3 was reported as "2.3 stops under the target"
    # and the next press stacked another +2.15 on it
    lin = scene() * 0.5
    p = _png(C.encode(lin), tmp_path / "same.png")
    r = C.check_render(p, p, 2.15, C.Calibration(str(tmp_path / "l.json")), applied={"exposure": 2.15})
    assert r["render_unchanged"] and r["clipping_status"] == "NOT_VERIFIED"
    assert r["exposure_after"] is None and r["cast_before"] is None
    assert r["gates"]["revert"] == [] and "pullback_units" not in r
    same_but_nothing_applied = C.check_render(p, p, 0.0, C.Calibration(str(tmp_path / "l2.json")), applied={})
    assert not same_but_nothing_applied.get("render_unchanged")
