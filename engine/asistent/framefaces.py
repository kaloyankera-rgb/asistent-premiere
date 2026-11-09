"""Faces and subtitle text in frames the panel exported from the sequence (Move off faces, 2026-11 improvements).

Numbers only: the frames are measured, never shown. Only files in the engine's own frames folder are read (the panel exports
them there), and they are deleted after measuring, like the colour checks' frames.

Where a subtitle graphic's letters are is not something Premiere tells a script (docs/NATIVE_GRAPHICS.md), and an upgraded
caption keeps its text near the bottom whatever its Position says (NEW TEST 2026-11-09: estimated 0.65, drawn 0.89). So the
frame is read with the Mac's text recognition (ocr.py) and each graphic's own words, taken from the subtitle files Asistent
wrote (a line with the same start and end), find its line in the frame: its measured centre is returned.
"""
from __future__ import annotations

import difflib
import glob
import os
import re

from . import color, faces, ocr

SAME_TIME = 0.06          # a graphic and an SRT line with the same start and end (within this) are the same line
MIN_MATCH = 0.5           # how alike the recognised text and the line's words must be
_TIME = re.compile(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)")


def _secs(h, m, s, ms):
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def srt_lines(project: str, newest: int = 40) -> list[dict]:
    """The lines of the SRT files in the project's Asistent_subtitles folder, newest files first: {start, end, text, en}."""
    folder = os.path.join(os.path.dirname(os.path.abspath(project)), "Asistent_subtitles") if project else ""
    if not folder or not os.path.isdir(folder):
        return []
    files = sorted(glob.glob(os.path.join(folder, "*.srt")), key=os.path.getmtime, reverse=True)[:newest]
    out = []
    for path in files:
        try:
            with open(path, encoding="utf-8-sig") as f:
                blocks = f.read().split("\n\n")
        except OSError:
            continue
        for b in blocks:
            rows = [r for r in b.strip().splitlines() if r.strip()]
            m = next((_TIME.search(r) for r in rows if _TIME.search(r)), None)
            if not m:
                continue
            g = m.groups()
            text = " ".join(rows[[i for i, r in enumerate(rows) if _TIME.search(r)][0] + 1:])
            out.append({"start": _secs(*g[:4]), "end": _secs(*g[4:]), "text": text, "en": path.endswith(".en.srt")})
    return out


def _norm(text: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", str(text).lower()).split())


def text_of(lines: list[dict], start: float, end: float, en: bool = False) -> str | None:
    """The words of the Bulgarian (or English) line shown exactly from `start` to `end` (the newest file that has it)."""
    for ln in lines:
        if ln["en"] == en and abs(ln["start"] - start) <= SAME_TIME and abs(ln["end"] - end) <= SAME_TIME:
            return ln["text"]
    return None


def find_line(boxes: list[dict], words: str) -> dict | None:
    """The recognised text box (or two next to each other on one row) that reads like `words`."""
    want = _norm(words)
    if not want:
        return None
    best, score = None, MIN_MATCH
    for b in boxes:
        r = difflib.SequenceMatcher(None, _norm(b.get("text", "")), want).ratio()
        if r > score:
            best, score = b, r
    return best


def measure(frames: list, project: str = "", graphics: list | None = None) -> list[dict]:
    """frames [{path, t} | path] -> per frame {"faces": [{x, y, w, h, score}], "text": {graphic id: {"bg": y, "en": y}}} as
    fractions of the frame, or {"error"}. graphics [{id, start, end}]: the selected subtitle graphics, so each frame knows
    whose words to look for. A Bulgarian line and its English line have the same times, so for each graphic both centres
    found are returned and the panel tells the pair apart (the English one is the lower)."""
    items = [f if isinstance(f, dict) else {"path": f} for f in (frames if isinstance(frames, list) else [])]
    lines = srt_lines(project) if graphics else []
    words = {}
    for g in graphics or []:
        pair = {k: text_of(lines, float(g["start"]), float(g["end"]), en=(k == "en")) for k in ("bg", "en")}
        if any(pair.values()):
            words[g["id"]] = pair
    out, hits = [], []
    for it in items:
        p = it.get("path")
        if not isinstance(p, str) or not color._in_frames_dir(p):
            out.append({"error": "not a frame Asistent exported"})
            hits.append(None)
            continue
        hit = color._wait_file(p, 6.0)
        if not hit:
            out.append({"error": "the frame was not written"})
            hits.append(None)
            continue
        try:
            img = color.read_image(hit)
            h, w = img.shape[:2]
            found = faces.detect(img)
            out.append({"faces": [{"x": round(x / w, 4), "y": round(y / h, 4), "w": round(bw / w, 4), "h": round(bh / h, 4),
                                   "score": round(sc, 3)} for x, y, bw, bh, sc in found], "text": {}})
            hits.append(hit)
        except Exception as e:                                   # noqa: BLE001  (one bad frame does not stop the others)
            out.append({"error": str(e)})
            hits.append(None)
    readable = [h for h in hits if h]
    if words and readable:
        boxes = dict(zip(readable, ocr.read(readable)))
        for it, hit, res in zip(items, hits, out):
            if not hit or "text" not in res:
                continue
            t = it.get("t")
            for g in graphics or []:
                if g["id"] in words and t is not None and float(g["start"]) <= t < float(g["end"]):
                    found = {}
                    for k, text in words[g["id"]].items():
                        b = find_line(boxes.get(hit, []), text) if text else None
                        if b:
                            found[k] = round(b["y"] + b["h"] / 2, 4)
                    if found:
                        res["text"][str(g["id"])] = found
    for hit in hits:
        if hit:
            try:
                os.remove(hit)
            except OSError:
                pass
    return out
