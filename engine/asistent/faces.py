"""Faces in a frame, so skin is measured on faces and nowhere else.

Colour alone cannot find skin in a workshop or a shop: beige OSB boards, plywood and pale walls sit in the same
hue and saturation as a face (GStroy, 2026-11-01: face and wood both log2 B/R ≈ −2.05, chroma 0.76 on the FX3),
and a white-balance move pushes more of them into any "skin" box. A detector looks at shape instead.

Detector: YuNet (OpenCV Zoo, `face_detection_yunet_2023mar.onnx`, MIT, 233 KB, bundled in `models/`) run by
OpenCV's FaceDetectorYN on the CPU. Without OpenCV or the model file `available()` is False and Shot Match
measures no skin at all (it falls back to neutral surfaces) instead of guessing from colour.
"""
from __future__ import annotations

import logging
import os
import threading

import numpy as np

log = logging.getLogger("asistent.faces")

MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "face_detection_yunet_2023mar.onnx")
MIN_SCORE = 0.7          # YuNet confidence; the faces seen on the GStroy footage score 0.88-0.93
MIN_SIDE = 960           # faces are small in wide shots (18 px on a 480 px frame): smaller frames are enlarged

_lock = threading.Lock()      # one detector, jobs run in threads
_state: dict = {"det": None, "tried": False, "cv2": None}


def _load():
    if _state["tried"]:
        return _state["det"]
    _state["tried"] = True
    try:
        import cv2
        try:
            cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)     # DNN backend notices fill launchd.err
        except Exception:
            pass
        if not os.path.isfile(MODEL):
            raise FileNotFoundError(MODEL)
        _state["det"] = cv2.FaceDetectorYN.create(MODEL, "", (320, 320), 0.6, 0.3, 50)
        _state["cv2"] = cv2
        log.info("face detector ready (YuNet, OpenCV %s)", cv2.__version__)
    except Exception as e:             # no OpenCV, no model, an unsupported build: say it once, measure no skin
        log.warning("face detector not available: %s", e)
    return _state["det"]


def available() -> bool:
    with _lock:
        return _load() is not None


def detect(enc: np.ndarray) -> list[tuple[int, int, int, int, float]]:
    """Faces in an encoded R'G'B' frame as (x, y, w, h, score) in the frame's own pixels, best first."""
    with _lock:
        det = _load()
        if det is None:
            return []
        cv2 = _state["cv2"]
        h, w = enc.shape[:2]
        k = max(1.0, MIN_SIDE / max(h, w))
        bgr = (np.clip(enc, 0, 1)[..., ::-1] * 255 + 0.5).astype(np.uint8)
        if k > 1.0:
            bgr = cv2.resize(bgr, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
        bgr = np.ascontiguousarray(bgr)
        det.setInputSize((bgr.shape[1], bgr.shape[0]))
        _, found = det.detect(bgr)
    if found is None:
        return []
    out = [(int(round(r[0] / k)), int(round(r[1] / k)), int(round(r[2] / k)), int(round(r[3] / k)), float(r[14]))
           for r in found if r[14] >= MIN_SCORE and r[2] > 0 and r[3] > 0]
    return sorted(out, key=lambda b: -b[4])


# ---------------------------------------------------------------- skin inside faces

# Skin = pixels inside a detected face (central part of the box, outliers dropped). The colour is only a sanity
# check of the face, very loose on purpose: the cameras are exactly what is being matched, and the GStroy FX3/FX30
# faces measured log2 B/R −2.3…−2.96 and chroma 0.80–0.87 (strongly warm; a −2.7/0.85 limit threw real faces
# out). Only a grey, blue or green "face" (a false detection on a wall) must fail. Linear Rec.709.
FACE_T = (-4.0, -0.3)
FACE_CHROMA = (0.20, 0.97)
FACE_INNER = (0.20, 0.80, 0.25, 0.90)     # x0, x1, y0, y1 of the box that counts (eyes, hair, beard and ears out)
FACE_MIN_PX = 30
FACE_RELATIVE = 0.25                      # faces under this share of the biggest face's area are background people


def skin_mask(enc: np.ndarray, lin: np.ndarray, boxes) -> np.ndarray:
    """Mask of the skin of the detected faces: the central part of each box, without clipped or dark pixels and
    without the outliers of the face (eyes, brows, hair, beard); a face whose colour is no skin at all is a
    false detection and counts for nothing. `enc`: the frame as it looks (Rec.709 encoded), `lin`: linear."""
    h, w = enc.shape[:2]
    mask = np.zeros((h, w), bool)
    boxes = [b for b in (boxes or []) if b[2] > 0 and b[3] > 0]
    if not boxes:
        return mask
    biggest = max(b[2] * b[3] for b in boxes)
    y_enc = enc[..., 0] * 0.2126 + enc[..., 1] * 0.7152 + enc[..., 2] * 0.0722
    safe = np.maximum(lin, 1e-6)
    t_px = np.log2(safe[..., 2] / safe[..., 0])
    chroma_px = (safe.max(axis=-1) - safe.min(axis=-1)) / safe.max(axis=-1)
    usable = (np.max(enc, axis=-1) < 0.97) & (y_enc > 0.04)
    for b in boxes:
        x, y, bw, bh = b[:4]
        if bw * bh < FACE_RELATIVE * biggest:
            continue
        x0, x1 = max(int(x + FACE_INNER[0] * bw), 0), min(int(round(x + FACE_INNER[1] * bw)), w)
        y0, y1 = max(int(y + FACE_INNER[2] * bh), 0), min(int(round(y + FACE_INNER[3] * bh)), h)
        if x1 - x0 < 3 or y1 - y0 < 3:
            continue
        ok = np.zeros((h, w), bool)
        ok[y0:y1, x0:x1] = True
        ok &= usable
        ys, xs = np.nonzero(ok)
        if len(ys) < FACE_MIN_PX:
            continue
        t, yl = t_px[ys, xs], y_enc[ys, xs]
        keep = (np.abs(t - np.median(t)) <= 0.45) & (yl >= np.percentile(yl, 10)) & (yl <= np.percentile(yl, 90))
        if keep.sum() < FACE_MIN_PX:
            continue
        ys, xs = ys[keep], xs[keep]
        if not (FACE_T[0] <= float(np.median(t_px[ys, xs])) <= FACE_T[1]
                and FACE_CHROMA[0] <= float(np.median(chroma_px[ys, xs])) <= FACE_CHROMA[1]):
            continue
        mask[ys, xs] = True
    return mask
