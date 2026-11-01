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
