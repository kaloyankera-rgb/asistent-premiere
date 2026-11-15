"""Hard-case tracker benchmark (0.10.76): small, tiny, blurry, motion-blurred, defocused, low-contrast, partly covered objects and a
look-alike passing close by. Synthetic scenes with a known path; every frame's error against the true centre. Run from the repo root:
    "$HOME/Library/Application Support/Asistent/venv/bin/python" scripts/bench_tracker_hard.py [scene ...]
Per scene: error of sure frames (median / p95 / max), how many frames are sure / unsure / lost, and the two failure counts that
matter: WRONG = a sure or unsure frame more than 2 px (or a quarter of the object) off the truth (a key would be written in the
wrong place), and MISSED = a frame where the object was fully visible but the tracker said lost. Numbers only, no footage."""
import math
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, "engine")
from asistent import tracker as T  # noqa: E402

W, H = 1280, 720


def background(rng, smooth=3.0, lo=30, hi=220):
    bg = cv2.GaussianBlur((rng.random((H * 2, W * 2)) * 255).astype(np.float32), (0, 0), smooth)
    return cv2.normalize(bg, None, lo, hi, cv2.NORM_MINMAX)


def textured(rng, n, sigma=1.0, lo=0, hi=255):
    o = cv2.GaussianBlur((rng.random((n, n)) * 255).astype(np.float32), (0, 0), sigma)
    return cv2.normalize(o, None, lo, hi, cv2.NORM_MINMAX)


def blob(n, sigma):
    """A soft round thing with no inner detail (a ball out of focus, a fingertip): its coverage 0..1 (render mode "soft":
    opaque in the middle, the background showing through only at its soft edge)."""
    o = np.zeros((n, n), np.float32)
    cv2.circle(o, (n // 2, n // 2), n // 3, 1.0, -1, cv2.LINE_AA)
    return cv2.GaussianBlur(o, (0, 0), sigma)


def motion_kernel(vx, vy, shutter=0.5):
    L = math.hypot(vx, vy) * shutter
    if L < 1.0:
        return None
    n = int(math.ceil(L)) | 1
    k = np.zeros((n + 2, n + 2), np.float32)
    c = (n + 1) / 2
    ux, uy = vx / math.hypot(vx, vy), vy / math.hypot(vx, vy)
    for i in range(200):
        t = (i / 199 - 0.5) * L
        x, y = c + ux * t, c + uy * t
        x0, y0 = int(math.floor(x)), int(math.floor(y))
        fx, fy = x - x0, y - y0
        for dx, dy, wgt in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
            if 0 <= y0 + dy < k.shape[0] and 0 <= x0 + dx < k.shape[1]:
                k[y0 + dy, x0 + dx] += wgt
    return k / k.sum()


def render(n, path, obj, bg, rng, noise=3.0, mode="paste", pan=None, blur_obj=None, mblur=False, cover=None, extra=None,
           value=200.0):
    """frames and true centres. path(k) -> (cx, cy). mode "paste": obj pasted (a textured patch with a square mask);
    "soft": obj is a coverage map, the thing has the grey level `value`. cover(k, frame, cx, cy) may hide part of it; extra(k) -> list of (cx, cy) look-alikes."""
    frames, truth = [], []
    on = obj.shape[0]
    for k in range(n):
        cx, cy = path(k)
        px, py = pan(k) if pan else (0, 0)
        f = bg[H // 2 + int(py):H // 2 + int(py) + H, W // 2 + int(px):W // 2 + int(px) + W].copy()
        layer = np.zeros((H, W), np.float32)
        mask = np.zeros((H, W), np.float32)
        places = [(cx, cy)] + (extra(k) if extra else [])
        for (ox, oy) in places:
            M = np.float32([[1, 0, ox - on / 2], [0, 1, oy - on / 2]])
            if mode == "soft":
                cov = cv2.warpAffine(obj, M, (W, H), flags=cv2.INTER_CUBIC)
                layer += cov * value
                mask = np.maximum(mask, cov)
            else:
                layer += cv2.warpAffine(obj, M, (W, H), flags=cv2.INTER_CUBIC)
                mask = np.maximum(mask, cv2.warpAffine(np.ones_like(obj), M, (W, H), flags=cv2.INTER_LINEAR))
        if blur_obj:
            s = blur_obj(k)
            if s > 0.3:
                layer = cv2.GaussianBlur(layer, (0, 0), s)
                mask = cv2.GaussianBlur(mask, (0, 0), s)
        if mblur and k > 0:
            p0 = path(k - 1)
            ker = motion_kernel(cx - p0[0], cy - p0[1])
            if ker is not None:
                layer = cv2.filter2D(layer, -1, ker)
                mask = cv2.filter2D(mask, -1, ker)
        f = f * (1 - mask) + layer
        if cover:
            cover(k, f, cx, cy)
        f = f + rng.normal(0, noise, f.shape)
        frames.append(np.clip(f, 0, 255).astype(np.uint8))
        truth.append((cx, cy))
    return frames, truth


def wander(n, x0, y0, ax, ay, speed=1.0):
    return lambda k: (x0 + ax * math.sin(speed * 2 * math.pi * k / n) + 0.3 * ax * math.sin(speed * 5.1 * math.pi * k / n),
                      y0 + ay * math.sin(speed * 3 * math.pi * k / n + 0.7))


def scenes():
    out = {}
    n = 150
    # A. small textured object, 12 px, moving about 6 px a frame over a panning textured background
    rng = np.random.default_rng(11)
    bg = background(rng)
    out["small12"] = (render(n, wander(n, 640, 360, 300, 150), textured(rng, 12, 0.8), bg, rng, mode="paste",
                             pan=lambda k: (60 * math.sin(k / 40), 30 * math.cos(k / 50))), 12)
    # B. tiny object, 6 px
    rng = np.random.default_rng(12)
    bg = background(rng)
    out["tiny6"] = (render(n, wander(n, 640, 360, 250, 120), textured(rng, 6, 0.6), bg, rng, mode="paste"), 6)
    # C. soft blobs, no inner detail (a fingertip, a ball out of focus), opaque with a soft edge: over a smooth background
    # a little brighter than it, over a busy background with spots of its own size, large and very soft, small
    for key, seed, smooth, n_, sg, val, lo, hi in (("blob", 13, 12, 40, 3.0, 150, 60, 160), ("blob-busy", 31, 4, 24, 2.0, 190, 70, 170),
                                                   ("blob-big", 32, 20, 60, 5.0, 60, 70, 170), ("blob-small", 33, 8, 16, 1.5, 200, 70, 170)):
        rng = np.random.default_rng(seed)
        bg = background(rng, smooth=smooth, lo=lo, hi=hi)
        out[key] = (render(n, wander(n, 640, 360, 300, 160), blob(n_, sg), bg, rng, mode="soft", value=val), int(n_ * 0.66))
    # D. small object moving very fast (up to 65 px a frame, three times its size) with motion blur along its path, its
    # texture like the background's: measured, it matches no better at its true place than the background does nearby, so
    # the right answer is lost / unsure, never a sure frame in the wrong place (an honesty test)
    rng = np.random.default_rng(14)
    bg = background(rng)
    out["fastblur"] = (render(n, wander(n, 640, 360, 420, 200, speed=2.0), textured(rng, 20, 1.0), bg, rng, mode="paste",
                              mblur=True), 20)
    # D2. a small distinct thing (16 px) moving fast (15-35 px a frame) with motion blur: a hand, a ball
    rng = np.random.default_rng(20)
    bg = background(rng, smooth=5, lo=60, hi=190)
    out["fastsmall"] = (render(n, wander(n, 640, 360, 330, 160, speed=1.4), textured(rng, 16, 0.7), bg, rng, mode="paste",
                               mblur=True), 16)
    # E. defocus: the object goes soft (sigma up to 4) and comes back
    rng = np.random.default_rng(15)
    bg = background(rng)
    out["defocus"] = (render(n, wander(n, 640, 360, 250, 120), textured(rng, 24, 1.0), bg, rng, mode="paste",
                             blur_obj=lambda k: 4.0 * max(0.0, math.sin(math.pi * (k - 40) / 70)) if 40 <= k < 110 else 0), 24)
    # F. low contrast: a textured patch only 16 levels deep, noise 4
    rng = np.random.default_rng(16)
    bg = background(rng, smooth=6, lo=100, hi=140)
    out["lowcontrast"] = (render(n, wander(n, 640, 360, 250, 120), textured(rng, 30, 1.2, 112, 128), bg, rng, noise=4,
                                 mode="paste"), 30)

    # G. partly covered: 50 % covered for frames 60-75, fully covered 76-83
    rng = np.random.default_rng(17)
    bg = background(rng)

    def cover(k, f, cx, cy):
        if 60 <= k < 76:
            f[int(cy) - 20:int(cy) + 20, int(cx):int(cx) + 20] = 128
        elif 76 <= k < 84:
            f[int(cy) - 24:int(cy) + 24, int(cx) - 24:int(cx) + 24] = 128
    out["covered"] = (render(n, wander(n, 640, 360, 250, 120), textured(rng, 30, 1.0), bg, rng, mode="paste", cover=cover), 30,
                      set(range(76, 84)))
    # H. a look-alike (the same patch) passes 30-40 px away
    rng = np.random.default_rng(18)
    bg = background(rng)
    p = lambda k: (300 + 4 * k, 360 + 20 * math.sin(k / 15))                 # noqa: E731
    q = lambda k: [(300 + 4 * k + 34 * math.cos(k / 9), 360 + 34 * math.sin(k / 9))]   # noqa: E731
    out["lookalike"] = (render(n, p, textured(rng, 22, 1.0), bg, rng, mode="paste", extra=q), 22)
    # I. normal object (the existing benches' kind), 100 px, for regressions
    rng = np.random.default_rng(19)
    bg = background(rng)
    out["normal100"] = (render(n, wander(n, 640, 360, 300, 150), textured(rng, 100, 1.5), bg, rng, mode="paste",
                               pan=lambda k: (100 * math.sin(k / 30), 40 * math.cos(k / 40))), 100)
    return out


def run(name, frames, truth, size, hidden=frozenset(), k0=None):
    k0 = len(frames) // 3 if k0 is None else k0
    cx, cy = truth[k0]
    hw = size / 2 + 1
    t = time.time()
    res = T.track_frames(iter(frames[k0:]), iter(frames[k0::-1]), (cx - hw, cy - hw, 2 * hw, 2 * hw), k0, len(frames))
    dt = time.time() - t
    tol = max(2.0, size / 4)
    err, wrong, missed = [], 0, 0
    st = ""
    for i, (r, (x, y)) in enumerate(zip(res, truth)):
        st += r["state"][0]
        e = math.hypot(r["x"] - x, r["y"] - y)
        if r["state"] == "sure":
            err.append(e)
        if r["state"] in ("sure", "unsure") and e > tol:
            wrong += 1
        if r["state"] == "lost" and i not in hidden:
            missed += 1
    e = np.array(err) if err else np.array([np.nan])
    print(f"{name:12s} sure {st.count('s'):3d} unsure {st.count('u'):3d} lost {st.count('l'):3d} | sure err med {np.median(e):.3f} "
          f"p95 {np.percentile(e, 95):.3f} max {e.max():.3f} | WRONG {wrong:3d} MISSED {missed:3d} | {1000 * dt / len(frames):.1f} ms/f")
    return {"wrong": wrong, "missed": missed, "med": float(np.median(e)), "max": float(e.max()), "states": st}


if __name__ == "__main__":
    want = set(sys.argv[1:])
    for name, sc in scenes().items():
        if want and name not in want:
            continue
        (frames, truth), size = sc[0], sc[1]
        hidden = sc[2] if len(sc) > 2 else frozenset()
        try:
            run(name, frames, truth, size, hidden)
        except Exception as e:  # noqa: BLE001
            print(f"{name:12s} ERROR {e}")
