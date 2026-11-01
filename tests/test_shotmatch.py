"""Auto Shot Match on synthetic two-camera footage with a known truth."""
import importlib.util
import os

import numpy as np
import pytest

from asistent import color as C
from asistent import shotmatch as S

_spec = importlib.util.spec_from_file_location("tc", os.path.join(os.path.dirname(__file__), "test_color.py"))
tc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tc)


@pytest.fixture
def cal(tmp_path):
    c = C.Calibration(str(tmp_path / "lumetri.json"))
    c.set_exposure_curve([[0.06, 0.997], [0.22, 0.967], [0.38, 0.911], [0.54, 0.797], [0.7, 0.635], [0.86, 0.405]])
    return c


def camera_b(frames, stops=-0.7, cast=(0.15, 0.05, -0.15)):
    """The same moments seen by a second camera: darker and with its own colour."""
    return [np.clip(f * 2.0 ** np.array(cast) * 2 ** stops, 0, 1) for f in frames]


def ref_of(frames):
    return S.pool([S.anchors(C.encode(f)) for f in frames])


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
    r = S.fit(camera_b(a), ref_of(a), cal, overlap=True)
    v = r["values"]
    assert v["temperature"] == pytest.approx(-15, abs=1.5) and v["tint"] == pytest.approx(3.3, abs=1.0)
    assert 0.7 <= v["exposure"] <= 0.95                                   # 0.7 stop through the shoulder
    for k in ("exposure", "white"):
        assert r["error_after"][k] < r["error_before"][k] / 5


def test_running_again_gives_the_same_values_nothing_accumulates(cal):
    a = [tc.scene(seed=k) for k in range(3)]
    b = camera_b(a)
    first = S.fit(b, ref_of(a), cal, overlap=True)
    again = S.fit(b, ref_of(a), cal, overlap=True, current=first["values"])
    assert again["values"] == first["values"]
    assert again["changed"] == []                                         # a re-run does not touch the clip


def test_too_large_a_difference_is_flagged_and_the_current_value_kept(cal):
    a = [tc.scene(seed=k) for k in range(3)]
    b = camera_b(a, stops=-3.0)
    r = S.fit(b, ref_of(a), cal, overlap=True, current={"exposure": 0.4})
    assert r["values"]["exposure"] == 0.4 and "exposure" not in r["changed"]
    assert any("яркостта" in f and "нарочна" in f for f in r["flags"])


def test_neutrals_and_skin_disagreeing_means_different_light_not_a_white_fix(cal):
    a = [tc.scene(seed=k) for k in range(3)]
    ref = ref_of(a)
    ref = {**ref, "skin": {**ref["skin"], "cast": (ref["skin"]["cast"][0] + 0.4, ref["skin"]["cast"][1])}}
    r = S.fit(camera_b(a), ref, cal, overlap=True, current={"temperature": -3.0, "tint": 2.0})
    assert r["values"]["temperature"] == -3.0 and r["values"]["tint"] == 2.0
    assert any("показват различно" in f for f in r["flags"])


def test_no_skin_and_no_common_moment_leaves_exposure_alone(cal):
    a = [tc.scene(seed=k, wall=False) * np.array([1, 1, 1]) for k in range(3)]
    for f in a:
        f[:] = f[..., [2, 1, 0]]                                          # no skin colours left
    r = S.fit(camera_b(a), ref_of(a), cal, overlap=False)
    assert "exposure" not in r["changed"]
    assert any("яркостта" in f for f in r["flags"])


def test_contrast_only_on_common_moments(cal):
    a = [tc.scene(seed=k) for k in range(3)]
    r = S.fit(camera_b(a, stops=-0.3), ref_of(a), cal, overlap=False)
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


def test_orange_wood_is_not_skin():
    # GStroy regression (2026-11-01): OSB boards (log2 B/R ≈ −2, chroma ≈ 0.76) passed as skin and drove every
    # skin anchor; real skin (≈ −1.2, 0.56) must still count
    h, w = 120, 160
    img = np.full((h, w, 3), 0.5)                                         # a light grey wall (neutral)
    img[:, :80] = np.array([0.55, 0.30, 0.13])                          # wood, half the frame
    img[:40, 100:140] = tc.SKIN                                            # a face
    img *= 1 + 0.05 * np.random.default_rng(0).standard_normal((h, w, 1))  # sensor noise, as in real footage
    a = S.anchors(C.encode(np.clip(img, 0, 1)))
    assert a["skin"] and a["skin"]["area"] == pytest.approx(40 * 40 / (h * w), abs=0.01)
    assert a["skin"]["cast"][0] == pytest.approx(float(np.log2(tc.SKIN[2] / tc.SKIN[0])), abs=0.05)


def test_exposure_from_neutral_surfaces_when_there_is_no_skin(cal):
    a = []
    for k in range(3):
        f = tc.scene(seed=k, wall=True)
        f[..., 0], f[..., 2] = f[..., 2].copy(), f[..., 0].copy()        # no skin colours, the grey wall stays
        a.append(f)
    r = S.fit(camera_b(a, cast=(0, 0, 0)), ref_of(a), cal, overlap=True)
    assert r["basis"].get("exposure") == "белите/сивите повърхности" and "exposure" in r["changed"]
    assert r["error_after"]["exposure"] < r["error_before"]["exposure"] / 3


def test_different_framing_is_not_matched_on_contrast(cal):
    a = [tc.scene(seed=k) for k in range(3)]
    other = [np.clip(f[::-1] * 0 + np.linspace(0.02, 0.9, f.shape[0])[:, None, None], 0, 1) for f in a]  # other content
    r = S.fit(other, ref_of(a), cal, overlap=True)
    assert "contrast" not in r["changed"]
    assert any("контрастът" in f for f in r["flags"])
