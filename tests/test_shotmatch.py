"""Auto Shot Match on synthetic two-camera footage with a known truth."""
import importlib.util
import os

import numpy as np
import pytest

from asistent import color as C
from asistent import faces as F
from asistent import shotmatch as S

_spec = importlib.util.spec_from_file_location("tc", os.path.join(os.path.dirname(__file__), "test_color.py"))
tc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tc)


# tc.scene() puts the face (the skin patch) in rows 40-60 of a 120 x 160 frame
FACE = [(0, 40, 160, 20, 0.95)]


@pytest.fixture(autouse=True)
def detector(monkeypatch):
    """The synthetic scenes have one 'face', where the skin patch is; the real detector is tested apart."""
    monkeypatch.setattr(F, "detect", lambda enc: list(FACE))
    monkeypatch.setattr(F, "available", lambda: True)


@pytest.fixture
def cal(tmp_path):
    c = C.Calibration(str(tmp_path / "lumetri.json"))
    c.set_exposure_curve([[0.06, 0.997], [0.22, 0.967], [0.38, 0.911], [0.54, 0.797], [0.7, 0.635], [0.86, 0.405]])
    return c


def camera_b(frames, stops=-0.7, cast=(0.15, 0.05, -0.15)):
    """The same moments seen by a second camera: darker and with its own colour."""
    return [np.clip(f * 2.0 ** np.array(cast) * 2 ** stops, 0, 1) for f in frames]


def ref_of(frames):
    return S.pool([S.anchors(C.encode(f), FACE) for f in frames])


def test_models_reproduce_the_probe(cal):
    lin = tc.scene()
    for k, units, axis, want in (("temperature", 50, 0, -1.0), ("tint", 50, 1, -0.75)):
        a, b = S.simulate(lin, {k: units}, cal), lin
        assert C._cast(a.reshape(-1, 3).sum(0))[axis] - C._cast(b.reshape(-1, 3).sum(0))[axis] == pytest.approx(want, abs=0.03)
    sat = S.simulate(lin, {"saturation": 150}, cal)
    y0, y1 = C._luma(lin)[..., None], C._luma(sat)[..., None]
    big = np.abs(lin - y0) > 0.02
    assert float(np.median(((sat - y1)[big]) / ((lin - y0)[big]))) == pytest.approx(1.465, abs=0.03)


def test_fit_recovers_a_darker_warmer_camera(cal):
    a = [tc.scene(seed=k) for k in range(3)]
    r = S.fit(camera_b(a), ref_of(a), cal, overlap=True, faces=[FACE] * 3)
    v = r["values"]
    assert v["temperature"] == pytest.approx(-15, abs=1.5) and v["tint"] == pytest.approx(3.3, abs=1.0)
    assert 0.7 <= v["exposure"] <= 0.95                                   # 0.7 stop through the shoulder
    for k in ("exposure", "white"):
        assert r["error_after"][k] < r["error_before"][k] / 5


def test_running_again_gives_the_same_values_nothing_accumulates(cal):
    a = [tc.scene(seed=k) for k in range(3)]
    b = camera_b(a)
    first = S.fit(b, ref_of(a), cal, overlap=True, faces=[FACE] * 3)
    again = S.fit(b, ref_of(a), cal, overlap=True, current=first["values"], faces=[FACE] * 3)
    assert again["values"] == first["values"]
    assert again["changed"] == []                                         # a re-run does not touch the clip


def test_too_large_a_difference_is_flagged_and_the_current_value_kept(cal):
    a = [tc.scene(seed=k) for k in range(3)]
    b = camera_b(a, stops=-3.0)
    r = S.fit(b, ref_of(a), cal, overlap=True, current={"exposure": 0.4}, faces=[FACE] * 3)
    assert r["values"]["exposure"] == 0.4 and "exposure" not in r["changed"]
    assert any("яркостта" in f and "нарочна" in f for f in r["flags"])


def test_white_is_decided_per_axis_when_neutrals_and_face_disagree_on_one(cal):
    # GStroy fx39028 (2026-11-01): the grey surfaces jump between frames on Temperature but both anchors say the
    # FX3 is greener (Tint); all-or-nothing left the green in. The agreeing axis is fitted, the other left alone.
    a = [tc.scene(seed=k) for k in range(3)]
    ref = ref_of(a)
    ref = {**ref, "skin": {**ref["skin"], "cast": (ref["skin"]["cast"][0] + 0.4, ref["skin"]["cast"][1])}}
    r = S.fit(camera_b(a), ref, cal, overlap=True, current={"temperature": -3.0, "tint": 2.0}, faces=[FACE] * 3)
    assert r["values"]["temperature"] == -3.0                               # disagreeing axis: kept as it was
    assert r["values"]["tint"] == pytest.approx(3.3, abs=1.0)               # agreeing axis: fitted
    assert any("температурата" in f and "показват различно" in f for f in r["flags"])
    assert not any("нюансът" in f for f in r["flags"])


def test_both_white_axes_disagreeing_means_different_light_not_a_white_fix(cal):
    a = [tc.scene(seed=k) for k in range(3)]
    ref = ref_of(a)
    ref = {**ref, "skin": {**ref["skin"], "cast": (ref["skin"]["cast"][0] + 0.4, ref["skin"]["cast"][1] + 0.4)}}
    r = S.fit(camera_b(a), ref, cal, overlap=True, current={"temperature": -3.0, "tint": 2.0}, faces=[FACE] * 3)
    assert r["values"]["temperature"] == -3.0 and r["values"]["tint"] == 2.0
    assert "white" not in r["basis"] and len([f for f in r["flags"] if "показват различно" in f]) == 2


def test_no_skin_and_no_common_moment_leaves_exposure_alone(cal):
    a = [tc.scene(seed=k, wall=False) * np.array([1, 1, 1]) for k in range(3)]
    for f in a:
        f[:] = f[..., [2, 1, 0]]                                          # no skin colours left
    r = S.fit(camera_b(a), ref_of(a), cal, overlap=False, faces=[FACE] * 3)
    assert "exposure" not in r["changed"]
    assert any("яркостта" in f for f in r["flags"])


def test_contrast_only_on_common_moments(cal):
    a = [tc.scene(seed=k) for k in range(3)]
    r = S.fit(camera_b(a, stops=-0.3), ref_of(a), cal, overlap=False, faces=[FACE] * 3)
    assert "contrast" not in r["basis"]


def _run_with(monkeypatch, frames_by_path, gammas=None, **kw):
    from asistent import prepare
    monkeypatch.setattr(prepare, "sony_xml", lambda p: {"gamma": (gammas or {}).get(p)})
    monkeypatch.setattr(C, "read_frames", lambda p, **k: [C.encode(f) for f in frames_by_path[p]])
    return kw


def test_run_picks_the_reliable_camera_and_honours_a_chosen_one(cal, monkeypatch):
    a = [tc.scene(seed=k) for k in range(3)]
    burnt = [np.clip(f * 6, 0, 1) for f in a]                             # camera B: overexposed, clipping
    _run_with(monkeypatch, {"/A/c1.MP4": a, "/B/f1.MP4": burnt})
    items = [{"path": "/A/c1.MP4", "camera": "A", "overlap": True}, {"path": "/B/f1.MP4", "camera": "B", "overlap": True}]
    res = S.run(items, None, cal)
    assert res["reference"] == "A" and res["scores"]["A"] > res["scores"]["B"]
    assert [c["role"] for c in res["clips"]] == ["reference", "match"]
    chosen = S.run(items, "B", cal)
    assert chosen["reference"] == "B" and chosen["clips"][0]["role"] == "match"


def test_run_skips_log_footage_and_flags_a_manual_grade(cal, monkeypatch):
    a = [tc.scene(seed=k) for k in range(3)]
    _run_with(monkeypatch, {"/A/c1.MP4": a, "/B/f1.MP4": camera_b(a), "/B/f2.MP4": camera_b(a)},
              gammas={"/B/f2.MP4": "s-log3-cine"})
    items = [{"path": "/A/c1.MP4", "camera": "A", "overlap": True},
             {"path": "/B/f1.MP4", "camera": "B", "overlap": True, "lumetri": "manual"},
             {"path": "/B/f2.MP4", "camera": "B", "overlap": True}]
    res = S.run(items, "A", cal)
    assert any("ръчна" in f for f in res["clips"][1]["flags"])
    assert res["clips"][2]["role"] == "skipped" and any("s-log3" in f.lower() for f in res["clips"][2]["flags"])


def test_one_camera_is_not_enough(cal, monkeypatch):
    a = [tc.scene(seed=k) for k in range(2)]
    _run_with(monkeypatch, {"/A/1.MP4": a, "/A/2.MP4": a})
    with pytest.raises(ValueError):
        S.run([{"path": "/A/1.MP4", "camera": "A"}, {"path": "/A/2.MP4", "camera": "A"}], None, cal)


def test_render_check_says_worse_when_the_match_moved_away(tmp_path):
    a = tc.scene()
    ref = ref_of([a])
    before = tc._png(C.encode(a * 2 ** -0.3), tmp_path / "b.png")        # close to the reference
    after = tc._png(C.encode(a * 2 ** 0.6), tmp_path / "a.png")          # overshot
    r = S.check(before, after, ref)
    assert r["verdict"]["exposure"] == "worse" and "exposure" in r["revert"]
    better = S.check(after, before, ref)
    assert better["verdict"]["exposure"] == "better" and better["revert"] == []


def _wood_and_face():
    h, w = 120, 160
    img = np.full((h, w, 3), 0.5)                                         # a light grey wall (neutral)
    img[:, :80] = np.array([0.55, 0.30, 0.13])                          # wood, half the frame
    img[:40, 100:140] = tc.SKIN                                            # a face
    img *= 1 + 0.05 * np.random.default_rng(0).standard_normal((h, w, 1))  # sensor noise, as in real footage
    return C.encode(np.clip(img, 0, 1))


def test_orange_wood_is_not_skin():
    # GStroy regression (2026-11-01): OSB boards (log2 B/R ≈ −2, chroma ≈ 0.76) passed as skin in a colour box,
    # 0.9.29 too (16-31 % of the reference frames); skin now exists only inside a detected face
    enc = _wood_and_face()
    assert S.anchors(enc)["skin"] is None and S.anchors(enc, [])["skin"] is None   # no face, no skin anchor
    a = S.anchors(enc, [(95, 5, 50, 35, 0.9)])                              # the detector found the face
    assert a["skin"] and a["skin"]["area"] < 40 * 40 / (120 * 160)         # a part of the face, not the wood
    assert a["skin"]["cast"][0] == pytest.approx(float(np.log2(tc.SKIN[2] / tc.SKIN[0])), abs=0.05)
    assert a["skin"]["y"] == pytest.approx(float(C._luma(tc.SKIN)), rel=0.1)


def test_a_false_face_on_a_wall_is_ignored_and_background_people_do_not_count():
    enc = _wood_and_face()
    assert S.anchors(enc, [(100, 70, 40, 40, 0.9)])["skin"] is None        # a "face" on the grey wall: no skin tone
    both = S.anchors(enc, [(95, 5, 50, 35, 0.9), (110, 70, 8, 8, 0.8)])     # plus a tiny one on the wall
    assert both["skin"]["cast"][0] == pytest.approx(float(np.log2(tc.SKIN[2] / tc.SKIN[0])), abs=0.05)


def test_without_a_detector_no_skin_is_measured_and_it_is_said(cal, monkeypatch):
    monkeypatch.setattr(F, "available", lambda: False)
    monkeypatch.setattr(F, "detect", lambda enc: [])
    a = [tc.scene(seed=k) for k in range(3)]
    _run_with(monkeypatch, {"/A/c1.MP4": a, "/B/f1.MP4": camera_b(a)})
    res = S.run([{"path": "/A/c1.MP4", "camera": "A", "overlap": True},
                 {"path": "/B/f1.MP4", "camera": "B", "overlap": True}], "A", cal)
    assert any("лица" in n for n in res["notes"])
    m = res["clips"][1]
    assert "saturation" not in m["changed"] and m["basis"].get("exposure") != "лицето"
    assert any("наситеността" in f for f in m["flags"])


def test_faces_are_found_on_a_big_frame_and_scaled_to_the_analysis_size(monkeypatch):
    big = np.full((960, 540, 3), 0.4)                                        # what read_frames gives at 2 x 480
    seen = []
    monkeypatch.setattr(C, "read_frames", lambda p, **k: seen.append(k) or [big, big])
    monkeypatch.setattr(F, "detect", lambda enc: [(100, 200, 80, 100, 0.9)])
    frames, faces = S._frames_and_faces("/A/c1.MP4", [1.0, 2.0])
    assert seen[0]["width"] == 960 and frames[0].shape == (480, 270, 3)
    assert faces[0] == [(50, 100, 40, 50, 0.9)]


def test_area_shrink_keeps_the_average():
    f = np.random.default_rng(1).random((96, 54, 3))
    g = S._shrink(f, 48, 27)
    assert g.shape == (48, 27, 3) and float(g.mean()) == pytest.approx(float(f.mean()), abs=1e-9)
    assert g[0, 0] == pytest.approx(f[:2, :2].mean(axis=(0, 1)))


@pytest.mark.skipif(importlib.util.find_spec("cv2") is None, reason="OpenCV not installed")
def test_the_real_detector_loads_and_sees_no_face_in_noise(monkeypatch):
    monkeypatch.undo()                                                       # the autouse stub off
    assert F.available()
    assert F.detect(np.random.default_rng(0).random((480, 270, 3))) == []
    assert F.detect(np.full((480, 270, 3), 0.5)) == []


def test_exposure_from_neutral_surfaces_when_there_is_no_skin(cal):
    a = []
    for k in range(3):
        f = tc.scene(seed=k, wall=True)
        f[..., 0], f[..., 2] = f[..., 2].copy(), f[..., 0].copy()        # no skin colours, the grey wall stays
        a.append(f)
    r = S.fit(camera_b(a, cast=(0, 0, 0)), ref_of(a), cal, overlap=True, faces=[FACE] * 3)
    assert r["basis"].get("exposure") == "белите/сивите повърхности" and "exposure" in r["changed"]
    assert r["error_after"]["exposure"] < r["error_before"]["exposure"] / 3


def test_different_framing_is_not_matched_on_contrast(cal):
    a = [tc.scene(seed=k) for k in range(3)]
    other = [np.clip(f[::-1] * 0 + np.linspace(0.02, 0.9, f.shape[0])[:, None, None], 0, 1) for f in a]  # other content
    r = S.fit(other, ref_of(a), cal, overlap=True, faces=[FACE] * 3)
    assert "contrast" not in r["changed"]
    assert any("контрастът" in f for f in r["flags"])


def test_check_compares_only_on_anchors_every_frame_has(tmp_path, monkeypatch):
    a = tc.scene()
    ref = ref_of([a])
    before = tc._png(C.encode(a * 2 ** -0.3), tmp_path / "b.png")
    after = tc._png(C.encode(a * 2 ** 0.6), tmp_path / "a.png")
    seen = iter([list(FACE), []])                                          # a face in the before frame, none after
    monkeypatch.setattr(F, "detect", lambda enc: next(seen))
    r = S.check(before, after, ref)
    assert r["reliable"].get("exposure") == "neutral"                      # not the face: the after frame has none
    assert r["skipped"].get("saturation") and r["verdict"]["saturation"] == "unknown"
    assert "saturation" not in r["revert"]


def test_check_never_reports_an_improvement_it_could_not_measure(tmp_path, monkeypatch):
    flat = np.full((120, 160, 3), 0.3)                                      # no face, no neutrals worth the name
    ref = ref_of([tc.scene()])
    ref = {**ref, "skin": None, "neutral": None, "neutral_y": None}
    p1, p2 = tc._png(C.encode(flat), tmp_path / "1.png"), tc._png(C.encode(flat * 2), tmp_path / "2.png")
    monkeypatch.setattr(F, "detect", lambda enc: [])
    r = S.check(p1, p2, ref)
    assert r["reliable"] == {} and r["revert"] == []
    assert "нито едно измерване не е надеждно" in r["summary"]
    assert all(v == "unknown" for v in r["verdict"].values())


def test_check_reports_what_was_reliable_and_what_was_skipped(tmp_path):
    a = tc.scene()
    ref = ref_of([a])
    before = tc._png(C.encode(a * 2 ** -0.5), tmp_path / "b.png")
    after = tc._png(C.encode(a), tmp_path / "a.png")
    r = S.check(before, after, ref)
    assert r["reliable"]["exposure"] == "face" and r["verdict"]["exposure"] == "better"
    assert any(l.startswith("яркостта: лице") for l in r["report"])
    assert any(l.startswith("контрастът: не е проверено") or l.startswith("контрастът: ") for l in r["report"])


def test_confidence_follows_the_anchor(cal):
    a = [tc.scene(seed=k) for k in range(3)]
    r = S.fit(camera_b(a), ref_of(a), cal, overlap=True, faces=[FACE] * 3)
    assert r["confidence"]["exposure"] == "висока"                           # a face
    noface = S.fit(camera_b(a), ref_of(a), cal, overlap=True, faces=[[]] * 3)
    assert noface["confidence"].get("exposure") == "средна" and "saturation" not in noface["confidence"]


def test_check_refuses_to_judge_when_before_and_after_frames_are_the_same(tmp_path):
    a = tc.scene()
    ref = ref_of([a])
    same = tc._png(C.encode(a * 2 ** -0.4), tmp_path / "s.png")
    r = S.check(same, same, ref)
    assert r["reliable"] == {} and r["revert"] == [] and all(v == "unknown" for v in r["verdict"].values())
    assert "същият като преди" in r["summary"]
