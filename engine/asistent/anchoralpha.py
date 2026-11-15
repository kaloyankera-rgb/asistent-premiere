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


def drawn(before: str, after: str, threshold: int = 2) -> dict:
    """What one clip draws on screen (0.10.91, the Anchor page on a text made in Premiere): `before` is the sequence frame as it
    is, `after` the same moment rendered with that clip hidden for a moment. Premiere tells no script where the letters of a
    native text sit (Source Text reads back null / one character), but two renders of one moment are identical to the bit
    (measured 2026-11-15), so the pixels that differ are exactly what the clip draws, over footage too. -> {"width", "height",
    "hull": [[x, y], ...] pixel centres of the drawn area's convex hull (sequence pixels), "bounds": {x, y, width, height}}."""
    import cv2
    for p in (before, after):
        if not isinstance(p, str) or not os.path.isfile(p):
            raise ValueError("Premiere did not write the frame to measure.")
    a = cv2.imread(before, cv2.IMREAD_UNCHANGED)
    b = cv2.imread(after, cv2.IMREAD_UNCHANGED)
    for p in (before, after):                                 # read once: never kept, also when nothing is found
        try:
            os.remove(p)
        except OSError:
            pass
    if a is None or b is None or a.shape != b.shape:
        raise ValueError("The two measuring frames could not be compared.")
    h, w = a.shape[:2]
    ca = a if a.ndim == 2 else a[:, :, :3]
    cb = b if b.ndim == 2 else b[:, :, :3]
    diff = np.abs(ca.astype(np.int16) - cb.astype(np.int16))
    if diff.ndim == 3:
        diff = diff.max(axis=2)
    if a.ndim == 3 and a.shape[2] == 4:                       # a text over nothing changes only the alpha
        diff = np.maximum(diff, np.abs(a[:, :, 3].astype(np.int16) - b[:, :, 3].astype(np.int16)))
    mask = (diff >= max(1, int(threshold))).astype(np.uint8)
    pts = cv2.findNonZero(mask)
    if pts is None:
        raise ValueError("Nothing of this clip can be seen at that moment (covered, transparent or scaled to 0).")
    hull = cv2.convexHull(pts).reshape(-1, 2)
    x, y, bw, bh = cv2.boundingRect(pts)
    return {"width": int(w), "height": int(h), "hull": [[float(px) + 0.5, float(py) + 0.5] for px, py in hull.tolist()],
            "bounds": {"x": int(x), "y": int(y), "width": int(bw), "height": int(bh)}}


def ready(path: str, seconds: float = 10.0) -> str | None:
    """A PNG Premiere is exporting, as soon as it is complete (0.10.92: the Anchor page's measuring renders). The general wait
    (color._wait_file) wants the same size twice 0.15 s apart, at least 0.3 s per frame; a PNG is complete when it ends with
    its IEND chunk, which is seen within ~20 ms. Also finds Premiere's doubled extension (x.png.png)."""
    import time
    end = time.time() + seconds
    while True:
        for cand in (path, path + ".png"):
            try:
                if os.path.getsize(cand) > 12:
                    with open(cand, "rb") as f:
                        f.seek(-12, os.SEEK_END)
                        if f.read(12)[4:8] == b"IEND":
                            return cand
            except OSError:
                pass
        if time.time() >= end:
            return None
        time.sleep(0.02)
