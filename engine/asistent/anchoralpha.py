"""Visible-pixel bounds of a still with transparency, for the Anchor page (0.10.69, Anchor Studio brought into Asistent).

Anchor Studio read the PNG in the panel: the editor had to pick the same file once in a dialog (UXP may only read files the
user chose), and its own decoder held up to 24 megapixels in JavaScript. The engine reads the file directly with OpenCV:
no dialog, any size, and PNG, TIFF and WebP alike (8 or 16 bit, grey + alpha, a palette with transparency).

A pixel counts as visible when its alpha is over 0 and at least `threshold` % (Anchor Studio's rule, so the same cutoff gives
the same bounds: its test image gives (72, 40)-(184, 152) at 50 %). `invert`: Premiere's Invert Alpha on the clip. A file
without an alpha channel is all visible. Results are kept per file, size, change time, threshold and invert.
"""
from __future__ import annotations

import os

import numpy as np

STILLS = (".png", ".tif", ".tiff", ".webp")
_CACHE: dict = {}


def bounds(path: str, threshold: float = 1.0, invert: bool = False) -> dict:
    """-> {"width", "height", "bounds": {x, y, width, height}, "alpha": bool} in source pixels."""
    if not isinstance(path, str) or not os.path.isfile(path):
        raise ValueError("The clip's file is missing (offline media?).")
    if not path.lower().endswith(STILLS):
        raise ValueError("Use alpha works on still images with transparency (PNG, TIFF, WebP).")
    threshold = float(threshold)
    if not 0.0 <= threshold <= 100.0:
        raise ValueError("The opacity cutoff must be between 0 and 100 %.")
    st = os.stat(path)
    key = (path, st.st_size, st.st_mtime_ns, threshold, bool(invert))
    if key in _CACHE:
        return dict(_CACHE[key])
    import cv2
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"{os.path.basename(path)} could not be read as an image.")
    h, w = img.shape[:2]
    alpha = None
    if img.ndim == 3 and img.shape[2] in (2, 4):
        alpha = img[:, :, -1]
    out = {"width": int(w), "height": int(h), "alpha": alpha is not None}
    if alpha is None:
        out["bounds"] = {"x": 0, "y": 0, "width": int(w), "height": int(h)}
    else:
        full = 65535.0 if alpha.dtype == np.uint16 else 255.0
        a = alpha.astype(np.float64) / full
        if invert:
            a = 1.0 - a
        visible = (a > 0) & (a * 100.0 >= threshold - 1e-9)
        rows = np.flatnonzero(visible.any(axis=1))
        cols = np.flatnonzero(visible.any(axis=0))
        if not len(rows):
            raise ValueError(f"{os.path.basename(path)} has no pixel this visible: lower the cutoff.")
        out["bounds"] = {"x": int(cols[0]), "y": int(rows[0]), "width": int(cols[-1] - cols[0] + 1), "height": int(rows[-1] - rows[0] + 1)}
    if len(_CACHE) > 64:
        _CACHE.clear()
    _CACHE[key] = out
    return dict(out)
