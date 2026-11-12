"""The Anchor page's Use alpha (0.10.69): visible-pixel bounds read by the engine (Anchor Studio read them in the panel)."""
import os
import struct
import zlib

import numpy as np
import pytest

from asistent import anchoralpha as A

cv2 = pytest.importorskip("cv2")
REF = os.path.join(os.path.dirname(__file__), "fixtures", "anchor-alpha-test.png")


def test_anchor_studios_own_test_image_gives_its_documented_bounds():
    # Anchor Studio's README: cutoff 50 -> top left (72, 40), bottom right (184, 152); cutoff 1 takes the faint shadow (200, 168)
    r = A.bounds(REF, 50)
    b = r["bounds"]
    assert r["alpha"] and (r["width"], r["height"]) == (256, 192)
    assert (b["x"], b["y"], b["x"] + b["width"], b["y"] + b["height"]) == (72, 40, 184, 152)
    b1 = A.bounds(REF, 1)["bounds"]
    assert (b1["x"] + b1["width"], b1["y"] + b1["height"]) == (200, 168)


def test_invert_opaque_and_sixteen_bit(tmp_path):
    img = np.zeros((40, 60, 4), np.uint8)
    img[10:20, 5:15, 3] = 255
    p = str(tmp_path / "a.png")
    cv2.imwrite(p, img)
    assert A.bounds(p)["bounds"] == {"x": 5, "y": 10, "width": 10, "height": 10}
    assert A.bounds(p, invert=True)["bounds"] == {"x": 0, "y": 0, "width": 60, "height": 40}
    opaque = str(tmp_path / "o.png")
    cv2.imwrite(opaque, np.full((30, 50, 3), 128, np.uint8))
    r = A.bounds(opaque, 50)
    assert not r["alpha"] and r["bounds"] == {"x": 0, "y": 0, "width": 50, "height": 30}
    deep = np.zeros((20, 20, 4), np.uint16)
    deep[3:7, 4:9, 3] = 65535
    d = str(tmp_path / "d.png")
    cv2.imwrite(d, deep)
    assert A.bounds(d)["bounds"] == {"x": 4, "y": 3, "width": 5, "height": 4}


def _png(path, w, h, ctype, depth, rows, plte=None, trns=None):
    def chunk(t, data):
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + r for r in rows)
    body = chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, depth, ctype, 0, 0, 0))
    if plte:
        body += chunk(b"PLTE", plte)
    if trns:
        body += chunk(b"tRNS", trns)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + body + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    return str(path)


def test_a_palette_with_transparency_and_grey_with_alpha(tmp_path):
    # palette: index 0 transparent, 1 opaque red; the red block at x 2-4, y 1-2
    rows = [bytes([1 if (2 <= x <= 4 and 1 <= y <= 2) else 0 for x in range(8)]) for y in range(5)]
    p = _png(tmp_path / "pal.png", 8, 5, 3, 8, rows, plte=b"\x00\x00\x00\xff\x00\x00", trns=b"\x00")
    assert A.bounds(p)["bounds"] == {"x": 2, "y": 1, "width": 3, "height": 2}
    # grey + alpha: alpha 128 (50 %) at x 1, y 3; 255 at x 5, y 0
    rows = [bytes(sum(([200, 255 if (x, y) == (5, 0) else 128 if (x, y) == (1, 3) else 0] for x in range(7)), [])) for y in range(4)]
    g = _png(tmp_path / "ga.png", 7, 4, 4, 8, rows)
    assert A.bounds(g, 1)["bounds"] == {"x": 1, "y": 0, "width": 5, "height": 4}
    assert A.bounds(g, 60)["bounds"] == {"x": 5, "y": 0, "width": 1, "height": 1}


def test_what_it_refuses(tmp_path):
    with pytest.raises(ValueError, match="missing"):
        A.bounds(str(tmp_path / "x.png"))
    j = tmp_path / "x.jpg"
    j.write_bytes(b"x")
    with pytest.raises(ValueError, match="still images"):
        A.bounds(str(j))
    empty = np.zeros((10, 10, 4), np.uint8)
    e = str(tmp_path / "e.png")
    cv2.imwrite(e, empty)
    with pytest.raises(ValueError, match="no pixel this visible"):
        A.bounds(e)
    with pytest.raises(ValueError, match="cutoff"):
        A.bounds(REF, 101)
