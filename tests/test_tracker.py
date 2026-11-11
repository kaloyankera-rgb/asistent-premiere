"""Motion tracker (0.10.51): accuracy on synthetic footage with a known path, lost frames, and frame timing through FFmpeg."""
import math
import os
import shutil
import subprocess
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
cv2 = pytest.importorskip("cv2")
from asistent import tracker as T  # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
from test_server import call, engine  # noqa: E402,F401

W, H = 960, 540


def _bg(seed):
    rng = np.random.default_rng(seed)
    bg = cv2.GaussianBlur((rng.random((H * 2, W * 2)) * 255).astype(np.float32), (0, 0), 3)
    return cv2.normalize(bg, None, 30, 220, cv2.NORM_MINMAX), rng


def _obj(rng, size=100):
    o = cv2.GaussianBlur((rng.random((size, size)) * 255).astype(np.float32), (0, 0), 1.5)
    return cv2.normalize(o, None, 0, 255, cv2.NORM_MINMAX)


def _frame(bg, obj, rng, k, cx, cy, s=1.0, a=0.0, pan=(0, 0), hide=False):
    n = obj.shape[0]
    f = bg[H // 2 + pan[1]:H // 2 + pan[1] + H, W // 2 + pan[0]:W // 2 + pan[0] + W].copy()
    M = cv2.getRotationMatrix2D((n / 2, n / 2), -a, s)
    M[0, 2] += cx - n / 2
    M[1, 2] += cy - n / 2
    m = cv2.warpAffine(np.ones((n, n), np.float32), M, (W, H))
    f = f * (1 - m) + cv2.warpAffine(obj, M, (W, H)) * m
    if hide:
        f[int(cy) - 90:int(cy) + 90, int(cx) - 90:int(cx) + 90] = 128
    return np.clip(f + rng.normal(0, 3, f.shape), 0, 255).astype(np.uint8)


def _path(k, n):
    t = k / n
    return (200 + 500 * t + 40 * math.sin(6 * math.pi * t), 270 + 110 * math.sin(4 * math.pi * t),
            1 + 0.4 * t, 30 * t, (int(150 * math.sin(2 * math.pi * t)), int(60 * math.cos(2 * math.pi * t))))


def _scene(n=120, hide=None, seed=1):
    bg, rng = _bg(seed)
    obj = _obj(rng)
    frames, truth = [], []
    for k in range(n):
        cx, cy, s, a, pan = _path(k, n)
        frames.append(_frame(bg, obj, rng, k, cx, cy, s, a, pan, hide=hide and hide[0] <= k < hide[1]))
        truth.append((cx, cy, s, a))
    return frames, truth


def _run(frames, truth, k0):
    cx, cy, s0, _ = truth[k0]
    hw = 45 * s0
    return T.track_frames(iter(frames[k0:]), iter(frames[k0::-1]), (cx - hw, cy - hw, 2 * hw, 2 * hw), k0, len(frames))


def test_follows_a_moving_growing_turning_object_to_a_tenth_of_a_pixel_both_ways():
    frames, truth = _scene()
    k0 = 40
    out = _run(frames, truth, k0)
    s0, a0 = truth[k0][2], truth[k0][3]
    err = [math.hypot(r["x"] - x, r["y"] - y) for r, (x, y, _, _) in zip(out, truth)]
    assert all(r["state"] == "sure" for r in out)
    assert max(err) < 0.15 and float(np.median(err)) < 0.05
    assert max(abs(r["s"] * s0 - s) / s for r, (_, _, s, _) in zip(out, truth)) < 0.005
    assert max(abs(r["a"] + a0 - a) for r, (_, _, _, a) in zip(out, truth)) < 0.2
    assert out[k0]["c"] == 1.0 and out[0] is not None and out[-1] is not None


def test_a_hidden_object_is_marked_lost_and_picked_up_again():
    frames, truth = _scene(hide=(70, 80))
    out = _run(frames, truth, 20)
    states = "".join(r["state"][0] for r in out)
    assert states[70:80] == "l" * 10
    assert "l" not in states[:70] and "l" not in states[82:]
    err = [math.hypot(r["x"] - x, r["y"] - y) for r, (x, y, _, _) in zip(out[82:], truth[82:])]
    assert max(err) < 0.2


def test_fast_moves_and_sudden_turns():
    bg, rng = _bg(5)
    obj = _obj(rng)
    frames, truth = [], []
    for k in range(80):
        cx = 150 + 40 * (k % 16) if (k // 16) % 2 == 0 else 150 + 40 * (16 - k % 16)
        cy = 270 + 25 * math.sin(k / 3)
        frames.append(_frame(bg, obj, rng, k, cx, cy))
        truth.append((cx, cy, 1, 0))
    out = _run(frames, truth, 0)
    assert all(r["state"] != "lost" for r in out)
    assert max(math.hypot(r["x"] - x, r["y"] - y) for r, (x, y, _, _) in zip(out, truth)) < 0.2


def test_an_object_turning_away_in_depth_stays_within_two_pixels():
    """A flat object turning 55 degrees away from the camera (perspective, which a move/scale/turn cannot fit): the adapting
    template keeps it, the error measured at the object's real centre (where the perspective puts it)."""
    bg, rng = _bg(7)
    obj = _obj(rng, 160)
    src = np.float32([[0, 0], [160, 0], [160, 160], [0, 160]])
    frames, truth = [], []
    for k in range(120):
        t = k / 120
        cx, cy = 300 + 300 * t, 270 + 40 * math.sin(5 * t)
        tilt = math.radians(55 * t)
        hw, d = 80 * math.cos(tilt), 40 * math.sin(tilt)
        dst = np.float32([[cx - hw, cy - 80 - d * 0.3], [cx + hw, cy - 80 + d * 0.3], [cx + hw, cy + 80 - d * 0.3], [cx - hw, cy + 80 + d * 0.3]])
        M = cv2.getPerspectiveTransform(src, dst)
        f = bg[H // 2:H // 2 + H, W // 2:W // 2 + W]
        m = cv2.warpPerspective(np.ones_like(obj), M, (W, H))
        f = f * (1 - m) + cv2.warpPerspective(obj, M, (W, H)) * m
        frames.append(np.clip(f + rng.normal(0, 3, f.shape), 0, 255).astype(np.uint8))
        truth.append(cv2.perspectiveTransform(np.float32([[[80, 80]]]), M)[0, 0])
    out = T.track_frames(iter(frames), iter([frames[0]]), (230, 200, 140, 140), 0, len(frames))
    assert all(r["state"] != "lost" for r in out)
    assert max(math.hypot(r["x"] - x, r["y"] - y) for r, (x, y) in zip(out, truth)) < 2.0


def test_bad_boxes_are_refused():
    frames, _ = _scene(n=3)
    with pytest.raises(ValueError):
        T.RegionTracker(frames[0], (10, 10, 3, 3))
    with pytest.raises(ValueError):
        T.RegionTracker(frames[0], (W + 5, 10, 50, 50))


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs FFmpeg")
def test_the_frame_at_each_time_is_the_one_premiere_shows(tmp_path):
    """A 29.97 fps file whose object sits at x = 100 + 7*frame: tracked from the middle, every timeline frame's x must be
    that frame's, so keys land on the right frame (no frame early or late), forwards and backwards."""
    n, fps = 90, 30000 / 1001
    bg, rng = _bg(9)
    obj = _obj(rng, 80)
    path = str(tmp_path / "move.mp4")
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-r", "30000/1001",
                          "-i", "-", "-c:v", "libx264", "-crf", "8", "-pix_fmt", "yuv420p", "-g", "15", path], stdin=subprocess.PIPE)
    for k in range(n):
        p.stdin.write(_frame(bg, obj, rng, k, 100 + 7 * k, 270).tobytes())
    p.stdin.close()
    assert p.wait() == 0
    step = 1 / fps
    k0 = 50
    res = T.track(path, 10 * step, 80 * step, step, (10 + k0) * step, [(100 + 7 * (10 + k0) - 35) / W, (270 - 35) / H, 70 / W, 70 / H])
    xs = [f["x"] for f in res["frames"]]
    assert len(xs) == 70 and res["k0"] == k0
    assert max(abs(x - (100 + 7 * (10 + i))) for i, x in enumerate(xs)) < 0.5
    assert res["width"] == W and res["height"] == H
    pv = T.preview(path, (10 + k0) * step, 320)
    assert pv["w"] == 320 and pv["width"] == W and len(pv["jpeg"]) > 100



def test_endpoints_refuse_bad_input(engine):  # noqa: F811
    assert call("POST", "/tracker/frame", {"path": "/nope/x.mp4", "t": 1})[0] == 400
    assert call("POST", "/tracker/track", {"path": "/nope/x.mp4", "box": [0.1]})[0] == 400
