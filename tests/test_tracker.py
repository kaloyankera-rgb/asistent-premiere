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
    """0.10.76: a box down to 2 pixels is taken (small objects); under that, or outside the picture, it is refused."""
    frames, _ = _scene(n=3)
    T.RegionTracker(frames[0], (10, 10, 3, 3))
    with pytest.raises(ValueError):
        T.RegionTracker(frames[0], (10, 10, 1.5, 1.5))
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


def _moving_file(tmp_path, n=90):
    fps = 30000 / 1001
    bg, rng = _bg(9)
    obj = _obj(rng, 80)
    path = str(tmp_path / "move.mp4")
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-r", "30000/1001",
                          "-i", "-", "-c:v", "libx264", "-crf", "8", "-pix_fmt", "yuv420p", "-g", "15", path], stdin=subprocess.PIPE)
    for k in range(n):
        p.stdin.write(_frame(bg, obj, rng, k, 100 + 7 * k, 270).tobytes())
    p.stdin.close()
    assert p.wait() == 0
    return path, 1 / fps


def test_a_range_tracks_only_its_frames_and_the_rest_come_back_untracked(tmp_path):
    """0.10.63 (the user: "choose until when we want to track"): only frames 30-55 are tracked; every frame of the clip comes
    back, the others as "none" with no measurement of their own."""
    path, step = _moving_file(tmp_path)
    k0 = 40
    box = [(100 + 7 * k0 - 35) / W, (270 - 35) / H, 70 / W, 70 / H]
    res = T.track(path, 0, 90 * step, step, k0 * step, box, rng=[30, 55])
    fr = res["frames"]
    assert len(fr) == 90 and res["range"] == [30, 55] and res["k0"] == k0 and not res["stopped"]
    tracked = [i for i, f in enumerate(fr) if f["state"] != "none"]
    assert tracked == list(range(30, 56))
    assert max(abs(fr[i]["x"] - (100 + 7 * i)) for i in tracked) < 0.5
    assert fr[10]["state"] == "none" and fr[10]["x"] == fr[30]["x"] and fr[80]["x"] == fr[55]["x"]
    with pytest.raises(ValueError, match="outside the range"):
        T.track(path, 0, 90 * step, step, 70 * step, box, rng=[30, 55])


def test_stop_keeps_the_frames_tracked_so_far(tmp_path):
    """Stop (0.10.63): the job ends at once with what it has, forwards from the boxed frame; backwards is not started."""
    path, step = _moving_file(tmp_path)
    k0 = 20
    box = [(100 + 7 * k0 - 35) / W, (270 - 35) / H, 70 / W, 70 / H]
    seen = []
    res = T.track(path, 0, 90 * step, step, k0 * step, box, progress=lambda f: seen.append(f),
                  stopping=lambda: len(seen) >= 3)          # progress comes every 5 frames: stop after about 15
    fr = res["frames"]
    tracked = [i for i, f in enumerate(fr) if f["state"] != "none"]
    assert res["stopped"] and tracked and tracked[0] == k0 and 10 <= len(tracked) <= 20
    assert tracked == list(range(k0, k0 + len(tracked)))
    assert max(abs(fr[i]["x"] - (100 + 7 * i)) for i in tracked) < 0.5


def test_a_stopped_job_finishes_with_its_result(engine, tmp_path):  # noqa: F811
    path, step = _moving_file(tmp_path, n=300)
    k0 = 5
    box = [(100 + 7 * k0 - 35) / W, (270 - 35) / H, 70 / W, 70 / H]
    code, started = call("POST", "/tracker/track", {"path": path, "from": 0, "to": 120 * step, "step": step, "t0": k0 * step, "box": box})
    assert code == 200
    import time as _t
    for _ in range(100):
        code, j = call("GET", f"/jobs/{started['job']}")
        if j.get("progress", 0) > 0.05 or j["state"] != "running":
            break
        _t.sleep(0.05)
    code, _ = call("POST", f"/jobs/{started['job']}/stop", {})
    assert code == 200
    for _ in range(200):
        code, j = call("GET", f"/jobs/{started['job']}")
        if j["state"] in ("done", "error", "cancelled"):
            break
        _t.sleep(0.05)
    assert j["state"] == "done", j
    assert len(j["result"]["frames"]) == 120 and any(f["state"] == "none" for f in j["result"]["frames"])


# ---------------------------------------------------------------- 0.10.76: small, blurry, low-detail, fast, look-alikes
# The user (2026-11-14): "accurately track small, blurry, low-detail and fast-moving objects ... When reliable tracking is
# impossible, clearly identify uncertainty instead of generating inaccurate keyframes." Every frame is checked against the
# true centre; a frame marked sure or unsure more than `tol` px off would put a key in the wrong place.

def _hard(n, path, obj, seed, smooth=3.0, lo=30, hi=220, noise=3.0, soft_value=None, blur=None, mblur=False, cover=None, extra=None):
    rng = np.random.default_rng(seed)
    bg = cv2.normalize(cv2.GaussianBlur((rng.random((H * 2, W * 2)) * 255).astype(np.float32), (0, 0), smooth), None, lo, hi, cv2.NORM_MINMAX)
    o = obj(rng)
    on = o.shape[0]
    frames, truth = [], []
    for k in range(n):
        cx, cy = path(k)
        f = bg[H // 2:H // 2 + H, W // 2:W // 2 + W].copy()
        layer, mask = np.zeros((H, W), np.float32), np.zeros((H, W), np.float32)
        for ox, oy in [(cx, cy)] + (extra(k) if extra else []):
            M = np.float32([[1, 0, ox - on / 2], [0, 1, oy - on / 2]])
            if soft_value is not None:
                cov = cv2.warpAffine(o, M, (W, H), flags=cv2.INTER_CUBIC)
                layer, mask = layer + cov * soft_value, np.maximum(mask, cov)
            else:
                layer += cv2.warpAffine(o, M, (W, H), flags=cv2.INTER_CUBIC)
                mask = np.maximum(mask, cv2.warpAffine(np.ones_like(o), M, (W, H)))
        if blur and blur(k) > 0.3:
            layer, mask = cv2.GaussianBlur(layer, (0, 0), blur(k)), cv2.GaussianBlur(mask, (0, 0), blur(k))
        if mblur and k:
            ker = T._motion_kernel(0.5 * (cx - path(k - 1)[0]), 0.5 * (cy - path(k - 1)[1]))
            if ker is not None:
                layer, mask = cv2.filter2D(layer, -1, ker), cv2.filter2D(mask, -1, ker)
        f = f * (1 - mask) + layer
        if cover:
            cover(k, f, cx, cy)
        frames.append(np.clip(f + rng.normal(0, noise, f.shape), 0, 255).astype(np.uint8))
        truth.append((cx, cy))
    return frames, truth


def _texture(n, sigma=1.0, lo=0, hi=255):
    return lambda rng: cv2.normalize(cv2.GaussianBlur((rng.random((n, n)) * 255).astype(np.float32), (0, 0), sigma), None, lo, hi, cv2.NORM_MINMAX)


def _wander(n, x0=480, y0=270, ax=260, ay=110, speed=1.0):
    return lambda k: (x0 + ax * math.sin(speed * 2 * math.pi * k / n) + 0.3 * ax * math.sin(speed * 5.1 * math.pi * k / n),
                      y0 + ay * math.sin(speed * 3 * math.pi * k / n + 0.7))


def _check(frames, truth, size, k0=None):
    k0 = len(frames) // 3 if k0 is None else k0
    cx, cy = truth[k0]
    hw = size / 2 + 1
    out = T.track_frames(iter(frames[k0:]), iter(frames[k0::-1]), (cx - hw, cy - hw, 2 * hw, 2 * hw), k0, len(frames))
    err = [math.hypot(r["x"] - x, r["y"] - y) for r, (x, y) in zip(out, truth)]
    return out, err, "".join(r["state"][0] for r in out)


def _wrong(out, err, tol):
    return sum(1 for r, e in zip(out, err) if r["state"] in ("sure", "unsure") and e > tol)


def test_a_tiny_object_six_pixels_across_to_a_tenth_of_a_pixel():
    frames, truth = _hard(90, _wander(90), _texture(6, 0.6), 12)
    out, err, st = _check(frames, truth, 6)
    assert st.count("s") == 90
    assert float(np.median(err)) < 0.08 and max(err) < 0.2


def test_a_soft_blob_with_no_inner_detail_is_followed_without_jumps():
    """A fingertip, a ball out of focus: opaque, round, a soft edge, no texture of its own."""
    def blob(rng, n=40):
        o = np.zeros((n, n), np.float32)
        cv2.circle(o, (n // 2, n // 2), n // 3, 1.0, -1, cv2.LINE_AA)
        return cv2.GaussianBlur(o, (0, 0), 3.0)
    frames, truth = _hard(90, _wander(90), blob, 13, smooth=12, lo=60, hi=160, soft_value=150)
    out, err, st = _check(frames, truth, 26)
    assert "l" not in st and _wrong(out, err, 4.0) == 0
    assert float(np.median([e for r, e in zip(out, err) if r["state"] == "sure"])) < 1.2


def test_a_small_fast_object_with_motion_blur():
    """16 px, 15-35 px a frame, smeared along its path: no frame keyed in the wrong place, nearly all followed."""
    frames, truth = _hard(120, _wander(120, ax=280, ay=100, speed=1.2), _texture(16, 0.7), 20, smooth=5, lo=60, hi=190, mblur=True)
    sp = [math.hypot(truth[k][0] - truth[k - 1][0], truth[k][1] - truth[k - 1][1]) for k in range(1, len(truth))]
    assert 30 <= max(sp) <= 36
    out, err, st = _check(frames, truth, 16)
    assert _wrong(out, err, 4.0) <= 2
    assert st.count("s") >= 95
    assert max(e for r, e in zip(out, err) if r["state"] == "sure") < 4.0


def test_out_of_focus_and_back():
    """Its texture blurred away (sigma up to 4 px on a 24 px thing) while moving up to 28 px a frame: where it cannot be
    measured it says unsure or lost, never a sure frame off, and it is picked up again when sharp. The old tracker (0.10.75)
    marked all 100 frames sure here, 49 of them more than 2 px off (up to 444 px)."""
    frames, truth = _hard(100, _wander(100), _texture(24, 1.0), 15,
                          blur=lambda k: 4.0 * max(0.0, math.sin(math.pi * (k - 30) / 50)) if 30 <= k < 80 else 0)
    out, err, st = _check(frames, truth, 24)
    assert max(e for r, e in zip(out, err) if r["state"] == "sure") < 1.0
    assert _wrong(out, err, 2.0) <= 3
    assert st.count("l") <= 20 and "l" not in st[:30] and "l" not in st[85:]


def test_low_contrast_in_noise():
    """16 grey levels deep in noise 4: the match score is judged against what that noise allows."""
    frames, truth = _hard(90, _wander(90), _texture(30, 1.2, 112, 128), 16, smooth=6, lo=100, hi=140, noise=4)
    out, err, st = _check(frames, truth, 30)
    assert "l" not in st and st.count("s") >= 80 and max(err) < 1.5


def test_a_look_alike_passing_close_is_never_taken_for_the_object():
    p = lambda k: (200 + 4 * k, 270 + 20 * math.sin(k / 15))                                  # noqa: E731
    q = lambda k: [(200 + 4 * k + 34 * math.cos(k / 9), 270 + 34 * math.sin(k / 9))]          # noqa: E731
    frames, truth = _hard(120, p, _texture(22, 1.0), 18, extra=q)
    out, err, st = _check(frames, truth, 22)
    assert _wrong(out, err, 5.5) == 0
    assert st.count("s") >= 90


def test_partly_then_fully_covered_lost_exactly_while_hidden():
    def cover(k, f, cx, cy):
        if 50 <= k < 62:
            f[int(cy) - 20:int(cy) + 20, int(cx):int(cx) + 20] = 128
        elif 62 <= k < 70:
            f[int(cy) - 24:int(cy) + 24, int(cx) - 24:int(cx) + 24] = 128
    frames, truth = _hard(110, _wander(110), _texture(30, 1.0), 17, cover=cover)
    out, err, st = _check(frames, truth, 30, k0=20)
    assert st[62:70] == "l" * 8 and "l" not in st[:62] and "l" not in st[72:]
    assert _wrong(out, err, 7.5) == 0
    # a lost frame reports the last place measured (no invented path in the panel; no key is written for it)
    assert all((out[k]["x"], out[k]["y"]) == (out[61]["x"], out[61]["y"]) for k in range(62, 70))


def test_when_nothing_tells_it_apart_it_says_so():
    """An honesty test: a 20 px patch whose texture is like the background's, moving up to 3 times its size a frame with
    motion blur. Measured, it matches no better at its true place than the background does nearby; the old tracker
    marked 144 of 150 such frames sure, hundreds of pixels off. Now: lost or unsure, and the few sure frames on it."""
    frames, truth = _hard(120, _wander(120, ax=330, ay=150, speed=2.0), _texture(20, 1.0), 14, mblur=True)
    out, err, st = _check(frames, truth, 20)
    assert sum(1 for r, e in zip(out, err) if r["state"] == "sure" and e > 7.0) == 0
    assert _wrong(out, err, 7.0) <= 8


def test_scale_and_angle_are_kept_for_an_object_that_shows_neither():
    """A round soft thing matches as well turned or grown: its scale and angle stay 1 and 0 instead of wandering."""
    def blob(rng, n=40):
        o = np.zeros((n, n), np.float32)
        cv2.circle(o, (n // 2, n // 2), n // 3, 1.0, -1, cv2.LINE_AA)
        return cv2.GaussianBlur(o, (0, 0), 3.0)
    frames, truth = _hard(40, _wander(40), blob, 13, smooth=12, lo=60, hi=160, soft_value=150)
    tr = T.RegionTracker(frames[0], (truth[0][0] - 14, truth[0][1] - 14, 28, 28))
    assert tr.fix_a
    rs = [tr.step(f) for f in frames[1:]]
    assert all(r["a"] == 0.0 for r in rs)


def test_a_small_box_is_tracked_on_the_files_own_pixels():
    """4K: halved for a normal box, full size for a small one (a 1 % box is 38 px there, 19 at half size)."""
    assert T.work_for_box(3840, 2160, 0.05, 0.05)[2] == 0.5
    ww, wh, k = T.work_for_box(3840, 2160, 0.01, 0.01)
    assert (ww, wh, k) == (3840, 2160, 1.0)
    assert T.work_for_box(1920, 1080, 0.01, 0.01)[2] == 1.0
    w2, h2, k2 = T.work_for_box(3840, 2160, 0.04, 0.04)          # 43 px at half size: a little more than half
    assert 0.5 < k2 < 1.0 and min(0.04 * w2, 0.04 * h2) >= T.MIN_SIDE - 1


# ---------------------------------------------------------------- colour (0.10.77)
# The user's basketball (screen recording 2026-11-15): the grey template took the dark shorts for the orange ball and called
# it sure. These scenes come in colour (grey + I420, as the engine decodes them); a "twin" disc as bright as the ball but grey
# is identical to it on brightness alone.

def _colour_scene(n=150, seed=3, twin=True, light=None, mblur=True):
    cw, ch = 640, 480
    rng = np.random.default_rng(seed)
    bg = cv2.GaussianBlur((rng.random((ch, cw, 3)) * 255).astype(np.float32), (0, 0), 4)
    bg = cv2.normalize(bg, None, 70, 170, cv2.NORM_MINMAX)
    bg[150:330, 220:420] = (30, 30, 34)                                  # a dark area the ball crosses (the shorts)

    def disc(colour):
        size = 43
        img = np.zeros((size, size, 3), np.float32)
        img[:] = colour
        cv2.line(img, (21, 3), (21, 39), (20, 20, 20), 2, cv2.LINE_AA)   # seams
        cv2.ellipse(img, (21, 21), (9, 18), 0, 0, 360, (20, 20, 20), 2, cv2.LINE_AA)
        mask = np.zeros((size, size), np.float32)
        cv2.circle(mask, (21, 21), 18, 1.0, -1, cv2.LINE_AA)
        return img, mask

    orange = (40, 110, 205)
    grey = float(cv2.cvtColor(np.uint8([[orange]]), cv2.COLOR_BGR2GRAY)[0, 0])
    ball, twin_disc = disc(orange), disc((grey, grey, grey))

    def path(k):                                                         # a dribble: up and down fast, side to side
        return 320 + 120 * math.sin(2 * math.pi * k / 75), 240 + 150 * abs(math.sin(2 * math.pi * k / 30)) - 75

    def put(f, obj, cx, cy, kern=None, gain=1.0):
        img, mask = obj
        M = np.float32([[1, 0, cx - img.shape[1] / 2], [0, 1, cy - img.shape[0] / 2]])
        o, m = cv2.warpAffine(img, M, (cw, ch)), cv2.warpAffine(mask, M, (cw, ch))
        if kern is not None:
            o, m = cv2.filter2D(o, -1, kern), cv2.filter2D(m, -1, kern)
        return f * (1 - m[..., None]) + o * gain * m[..., None]

    frames, truth = [], []
    for k in range(n):
        cx, cy = path(k)
        kern = None
        if mblur and k:
            px, py = path(k - 1)
            kern = T._motion_kernel(0.5 * (cx - px), 0.5 * (cy - py))
        f = bg.copy()
        if twin:
            f = put(f, twin_disc, 470, 330)
        f = put(f, ball, cx, cy, None if kern is None else kern.astype(np.float32), 1.0 if light is None else light(k))
        f = np.clip(f + rng.normal(0, 3, f.shape), 0, 255).astype(np.uint8)
        i420 = cv2.cvtColor(f, cv2.COLOR_BGR2YUV_I420).reshape(-1)
        frames.append((i420[:cw * ch].reshape(ch, cw), i420))
        truth.append((cx, cy))
    return frames, truth


def _colour_run(frames, truth, colour=True):
    x, y = truth[0]
    fw = [fc if colour else fc[0] for fc in frames]
    out = T.track_frames(iter(fw), iter(fw[:1]), (x - 20, y - 20, 40, 40), 0, len(frames))
    wrong = sum(1 for r, (tx, ty) in zip(out, truth) if r["state"] != "lost" and math.hypot(r["x"] - tx, r["y"] - ty) > 10)
    return wrong, "".join(r["state"][0] for r in out)


def test_colour_tells_the_ball_from_a_grey_twin_and_a_dark_area():
    """A fast dribbled orange ball (motion blur) crossing a dark area, a grey disc as bright as it nearby: on brightness alone
    the tracker is wrong on most frames or lost (measured over six scenes: 99-130 of 150 wrong, or 101 lost), with its colours
    on none of them and never lost."""
    for seed in (1, 4):
        frames, truth = _colour_scene(seed=seed)
        wrong, st = _colour_run(frames, truth)
        assert wrong == 0
        assert st.count("l") <= 3 and st.count("s") >= 100
    wrong_grey, st_grey = _colour_run(frames, truth, colour=False)
    assert wrong_grey + st_grey.count("l") >= 50


def test_colour_follows_the_object_into_shade():
    """The ball darkens to half its brightness over the clip: its colours are learnt on, so it is not lost."""
    frames, truth = _colour_scene(twin=False, light=lambda k: 1.0 - 0.5 * k / 150, mblur=False)
    wrong, st = _colour_run(frames, truth)
    assert wrong == 0 and st.count("l") == 0 and st.count("s") >= 140


def test_colour_is_used_only_when_it_sets_the_object_apart():
    """Grey frames: no colour model. A patch of the background itself: none either (its colours tell it from nothing)."""
    frames, truth = _colour_scene(n=2, twin=False)
    x, y = truth[0]
    assert T.RegionTracker(frames[0][0], (x - 20, y - 20, 40, 40)).col is None
    assert T.RegionTracker(frames[0][0], (x - 20, y - 20, 40, 40), colour=frames[0][1]).col is not None
    assert T.RegionTracker(frames[0][0], (60, 380, 40, 40), colour=frames[0][1]).col is None
