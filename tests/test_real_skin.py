"""Skin on the real GStroy footage (FX3 + FX30): the OSB problem of 0.9.29 and its fix, measured.

Read only; skipped where the footage or OpenCV is missing. Takes C9023 (FX30) and fx39024 (FX3), the pair on which
0.9.29 put wood boards into the skin anchor (16-31 % of the FX30 frames) and proposed Exposure 1.14 / Saturation 85.
Numbers (2026-11-01): face on FX30 ~ 0.09 linear luma, on FX3 ~ 0.03; neutral surfaces say 1.65 stops, faces 1.87.
"""
import os

import numpy as np
import pytest

from asistent import color as C
from asistent import faces as F
from asistent import shotmatch as S

BASE = os.environ.get("ASISTENT_REAL_FOOTAGE",
                      os.path.expanduser("~/Kaloyan/01_CLIENTS/The Pact/GStroy/Media/GStroy brand/9x16"))
FX30, FX3 = os.path.join(BASE, "fx30", "C9023.MP4"), os.path.join(BASE, "fx3", "fx39024.MP4")
OFFSET = 8.857559                                         # FX3 starts this much before FX30 (sync, High)
pytestmark = pytest.mark.skipif(not (os.path.isfile(FX30) and os.path.isfile(FX3)) or not F.available(),
                                reason="real footage or OpenCV not on this machine")


def legacy_skin_area(enc):
    """The 0.9.29 skin mask, kept here only to reproduce the problem: a colour box, no face."""
    lin = C.to_linear(enc, None)
    m = C.measure(enc)
    clipped = np.max(enc, axis=-1) >= 0.97
    t, g = m.get("cast_neutral") or m.get("cast_world") or (0.0, 0.0)
    fixed = C.encode(lin * np.array([2 ** (t / 2 + g / 3), 2 ** (-2 * g / 3), 2 ** (-t / 2 + g / 3)]))
    skin = C._skin(fixed) & ~clipped
    safe = np.maximum(lin, 1e-6)
    tp = np.log2(safe[..., 2] / safe[..., 0])
    ch = (safe.max(axis=-1) - safe.min(axis=-1)) / safe.max(axis=-1)
    return float(np.mean(skin & (tp >= -1.6) & (tp <= -0.6) & (ch >= 0.30) & (ch <= 0.68)))


def frame(path, t):
    return C.read_frames(path, times=[t], n=1, width=2 * S.ANALYSIS_SIDE)[0]


@pytest.fixture(scope="module")
def moments():
    out = {}
    for t in (2.7, 5.41, 8.11, 10.81):
        out[t] = {}
        for cam, path, shift in (("fx30", FX30, 0.0), ("fx3", FX3, OFFSET)):
            big = frame(path, t + shift)
            out[t][cam] = (big, F.detect(big))
    return out


def test_the_osb_problem_is_reproduced_by_the_old_mask_and_gone_with_faces(moments):
    big, faces = moments[8.11]["fx30"]
    old = legacy_skin_area(big)
    new = S.anchors(big, faces)["skin"]
    assert old > 0.08                                                      # wood and wall counted as skin
    assert new is None or new["area"] < old / 4                            # only the face, a few percent at most


def test_faces_are_found_where_there_are_faces_and_not_where_there_are_none(moments):
    assert moments[2.7]["fx30"][1] and moments[2.7]["fx3"][1]
    big, faces = moments[10.81]["fx3"]                                     # nobody in this part of the take
    assert faces == [] and S.anchors(big, faces)["skin"] is None


def test_face_and_neutral_surfaces_agree_on_the_exposure_gap(moments):
    face, neutral = [], []
    for t, cams in moments.items():
        a30, a3 = (S.anchors(cams[c][0], cams[c][1]) for c in ("fx30", "fx3"))
        if a30["skin"] and a3["skin"]:
            face.append(float(np.log2(a30["skin"]["y"] / a3["skin"]["y"])))
        if a30["neutral_y"] and a3["neutral_y"]:
            neutral.append(float(np.log2(a30["neutral_y"] / a3["neutral_y"])))
    assert face and neutral
    # two independent anchors, same moments: they must tell the same story (0.9.29's wood gave 1.14 vs 1.65)
    assert abs(np.median(face) - np.median(neutral)) < 0.6 and np.median(face) > 1.0


def test_shot_match_on_the_real_pair_proposes_the_full_gap_and_leaves_saturation_alone(tmp_path):
    times = [2.7, 5.41, 8.11, 10.81]
    cal = C.Calibration(str(tmp_path / "lumetri.json"))
    cal.set_exposure_curve([[0.06, 0.997], [0.22, 0.967], [0.38, 0.911], [0.54, 0.797], [0.7, 0.635], [0.86, 0.405]])
    items = [{"path": FX30, "camera": "fx30", "times": times, "overlap": True},
             {"path": FX3, "camera": "fx3", "times": [t + OFFSET for t in times], "overlap": True}]
    res = S.run(items, "fx30", cal)
    m = res["clips"][1]
    assert m["basis"].get("exposure") == "лицето" and m["confidence"]["exposure"] == "висока"
    assert m["proposal"]["exposure"] > 1.5                                 # 0.9.29 proposed 1.14 on the wood
    assert m["error_after"]["exposure"] < 0.15 < m["error_before"]["exposure"]
    assert abs(m["proposal"]["saturation"] - 100) <= 20                    # no big saturation move


def legacy_exposure(frames):
    """„Цвят“ before 0.9.33: skin by colour box on the white-fixed view, exposure to the skin target."""
    vals = []
    for enc in frames:
        lin = C.to_linear(enc, None)
        m = C.measure(enc, faces=[])
        t, g = m.get("cast_neutral") or m.get("cast_world") or (0.0, 0.0)
        fixed = C.encode(lin * np.array([2 ** (t / 2 + g / 3), 2 ** (-2 * g / 3), 2 ** (-t / 2 + g / 3)]))
        skin = C._skin(fixed) & ~(np.max(C.encode(lin), axis=-1) >= 0.97)
        if skin.mean() >= 0.01:
            vals.append(C.GAMMA * np.log2(C.SKIN_TARGET / max(float(np.median(C._luma(fixed)[skin])), 1e-4)))
    return float(np.median(vals)) if vals else None


def test_colour_button_no_longer_exposes_for_the_wood():
    # C9023 (FX30, wood boards 20-35 % of the frame): the colour box called the boards skin and asked for +0.5 stop;
    # the face is 1.7 stops under the target (Shot Match measured the same face 1.9 stops darker than the FX3's)
    frames = C.read_frames(FX30, n=6, width=S.ANALYSIS_SIDE)
    old = legacy_exposure(frames)
    r = C.decide(frames)["exposure"]
    assert old is not None and old < 1.0
    assert r["basis"] == "кожата" and r["measured"] > 1.2                       # measured on faces
    assert r["measured"] - old > 0.5
    assert C.decide(frames)["skin_area"] < 0.05                                  # not the 20-35 % of the colour box
