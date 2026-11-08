"""Faces in frames the panel exported from the sequence, as fractions of the frame (Move off faces, 2026-11 improvements).

Numbers only: the frames are measured, never shown. Only files in the engine's own frames folder are read (the panel
exports them there), and they are deleted after measuring, like the colour checks' frames.
"""
from __future__ import annotations

import os

from . import color, faces


def measure(paths: list) -> list[dict]:
    """[path] -> [{"faces": [{x, y, w, h, score}] as fractions of width/height, best first} | {"error"}] in the same order."""
    out = []
    for p in paths if isinstance(paths, list) else []:
        if not isinstance(p, str) or not color._in_frames_dir(p):
            out.append({"error": "not a frame Asistent exported"})
            continue
        hit = color._wait_file(p, 6.0)
        if not hit:
            out.append({"error": "the frame was not written"})
            continue
        try:
            img = color.read_image(hit)
            h, w = img.shape[:2]
            found = faces.detect(img)
            out.append({"faces": [{"x": round(x / w, 4), "y": round(y / h, 4), "w": round(bw / w, 4), "h": round(bh / h, 4),
                                   "score": round(sc, 3)} for x, y, bw, bh, sc in found]})
        except Exception as e:                                   # noqa: BLE001  (one bad frame does not stop the others)
            out.append({"error": str(e)})
        finally:
            try:
                os.remove(hit)
            except OSError:
                pass
    return out
