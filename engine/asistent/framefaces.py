"""Faces and subtitle text in frames the panel exported from the sequence (Move off faces, 2026-11 improvements).

Numbers only: the frames are measured, never shown. Only files in the engine's own frames folder are read (the panel exports
them there), and they are deleted after measuring, like the colour checks' frames.

Where a subtitle graphic's letters are is not something Premiere tells a script (docs/NATIVE_GRAPHICS.md), and an upgraded
caption keeps its text near the bottom whatever its Position says (NEW TEST 2026-11-09: estimated 0.65, drawn 0.89). So the
frame is read with the Mac's text recognition (ocr.py) and each graphic's own words, taken from the subtitle files Asistent
wrote (a line with the same start and end), find its line in the frame: its measured centre is returned.

Lane placement (2026-11-22) needs more of the same frame, additively (the old keys are unchanged): per graphic the box of its own
line (`boxes`: top, bottom, x, w), the other text on screen that is not its own words (`other`, with the recognition's
confidence), and the rows of its SRT block (`lines`: a chunk of two lines is centred lower than one of one line). A two-line
chunk is recognised as two boxes; find_line joins vertically adjacent boxes when the two together read like the line's words.
"""
from __future__ import annotations

import difflib
import glob
import json
import logging
import os
import re

from . import color, faces, ocr

log = logging.getLogger("asistent.framefaces")
SAME_TIME = 0.06          # a graphic and an SRT line with the same start and end (within this) are the same line
MIN_MATCH = 0.5           # how alike the recognised text and the line's words must be
_TAG = re.compile(r"</?[A-Za-z][^>]*>")        # <font color="#RRGGBB"> on the Line break's bottom line
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
            rows = [_TAG.sub("", r).strip() for r in rows[[i for i, r in enumerate(rows) if _TIME.search(r)][0] + 1:]]
            rows = [r for r in rows if r]
            out.append({"start": _secs(*g[:4]), "end": _secs(*g[4:]), "text": " ".join(rows), "rows": rows,
                        "en": path.endswith(".en.srt")})
    return out


def _norm(text: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", str(text).lower()).split())


def _line_at(lines: list[dict], start: float, end: float, en: bool) -> dict | None:
    for ln in lines:
        if ln["en"] == en and abs(ln["start"] - start) <= SAME_TIME and abs(ln["end"] - end) <= SAME_TIME:
            return ln
    return None


def text_of(lines: list[dict], start: float, end: float, en: bool = False) -> str | None:
    """The words of the Bulgarian (or English) line shown exactly from `start` to `end` (the newest file that has it)."""
    ln = _line_at(lines, start, end, en)
    return ln["text"] if ln else None


def rows_of(lines: list[dict], start: float, end: float, en: bool = False) -> list[str] | None:
    """The rows (lines of text, tags stripped) of that SRT block: one for a plain caption, two for a two-line chunk."""
    ln = _line_at(lines, start, end, en)
    return list(ln["rows"]) if ln else None


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return min(a1, b1) - max(a0, b0)


def _adjacent(a: dict, b: dict) -> bool:
    """`b` is the row right under `a` (a two-line chunk): the rows overlap sideways and the gap is less than a row's height."""
    tall = max(a["h"], b["h"])
    gap = b["y"] - (a["y"] + a["h"])
    if gap < -0.25 * tall or gap > tall:
        return False
    return _overlap(a["x"], a["x"] + a["w"], b["x"], b["x"] + b["w"]) >= 0.3 * min(a["w"], b["w"])


def _join(a: dict, b: dict) -> dict:
    x0, y0 = min(a["x"], b["x"]), min(a["y"], b["y"])
    x1, y1 = max(a["x"] + a["w"], b["x"] + b["w"]), max(a["y"] + a["h"], b["y"] + b["h"])
    conf = [c for c in (a.get("confidence"), b.get("confidence")) if c is not None]
    out = {"text": f'{a.get("text", "")} {b.get("text", "")}', "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0,
           "parts": [a, b]}
    if conf:
        out["confidence"] = min(conf)
    return out


def find_line(boxes: list[dict], words: str) -> dict | None:
    """The recognised text box that reads like `words`; or two boxes, one right under the other (a two-line chunk), joined
    into one block ({text, x, y, w, h, confidence, parts: the two boxes}) when together they read more like the words than
    any box alone."""
    want = _norm(words)
    if not want:
        return None
    best, score = None, MIN_MATCH
    for b in boxes:
        r = difflib.SequenceMatcher(None, _norm(b.get("text", "")), want).ratio()
        if r > score:
            best, score = b, r
    rows = sorted(boxes, key=lambda b: b.get("y", 0))
    for i, a in enumerate(rows):
        for b in rows[i + 1:]:
            if b.get("y", 0) - a.get("y", 0) > 2 * max(a.get("h", 0), b.get("h", 0)):
                break
            if not _adjacent(a, b):
                continue
            r = difflib.SequenceMatcher(None, _norm(f'{a.get("text", "")} {b.get("text", "")}'), want).ratio()
            if r > score:
                best, score = _join(a, b), r
    return best


def _looks_own(text: str, wants: list[str]) -> bool:
    """Is this recognised text a piece of the line's own words that find_line did not claim (a half row, a misread)? Then it is
    not 'other text': it must never push the line away from itself."""
    tokens = _norm(text).split()
    if not tokens:
        return False
    pool = [t for w in wants for t in _norm(w).split()]
    if pool and all(any(difflib.SequenceMatcher(None, t, p).ratio() >= 0.8 for p in pool) for t in tokens):
        return True
    return any(difflib.SequenceMatcher(None, _norm(text), _norm(w)).ratio() >= 0.45 for w in wants)


def run_info(project: str) -> dict:
    """The newest subtitle run's JSON in the project's Asistent_subtitles folder -> {"preset": its style ("" when none),
    "media": the clips it read}. Move off faces picks the client's lane from it (the panel's Style may have been changed since)."""
    folder = os.path.join(os.path.dirname(os.path.abspath(project)), "Asistent_subtitles") if project else ""
    if not folder or not os.path.isdir(folder):
        return {"preset": "", "media": []}
    files = sorted((f for f in glob.glob(os.path.join(folder, "*.json")) if not f.endswith(".en.json")), key=os.path.getmtime, reverse=True)
    for path in files[:5]:
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(d, dict) and isinstance(d.get("preset"), str):
            media = [it["path"] for it in d.get("items") or [] if isinstance(it, dict) and isinstance(it.get("path"), str)]
            return {"preset": d["preset"], "media": media}
    return {"preset": "", "media": []}


def discard(frames) -> None:
    """Delete exported frames (only files in the engine's own frames folder), whatever happened to them: the panel exports
    them for one measurement and never needs them again."""
    for f in frames if isinstance(frames, list) else []:
        p = f.get("path") if isinstance(f, dict) else f
        if not isinstance(p, str):
            continue
        try:
            if not color._in_frames_dir(p):
                continue
        except OSError:
            continue
        for cand in (p, p + ".png"):
            try:
                os.remove(cand)
            except OSError:
                pass


def rows_for(project: str, graphics) -> dict:
    """The rows of the SRT block of every graphic asked about -> {graphic id (str): {"bg": [rows], "en": [rows]}}: known from the
    SRT files alone, so the panel knows a two-line chunk also where no frame was measured."""
    items = [g for g in (graphics if isinstance(graphics, list) else []) if isinstance(g, dict) and "start" in g and "end" in g and "id" in g]
    if not items:
        return {}
    lines = srt_lines(project)
    out = {}
    for g in items:
        try:
            pair = {k: rows_of(lines, float(g["start"]), float(g["end"]), en=(k == "en")) for k in ("bg", "en")}
        except (TypeError, ValueError):
            continue
        pair = {k: v for k, v in pair.items() if v}
        if pair:
            out[str(g["id"])] = pair
    return out


def measure(frames: list, project: str = "", graphics: list | None = None) -> list[dict]:
    """The measurement of `_measure`; the exported frames are deleted on every path, also when something in it raises."""
    try:
        return _measure(frames, project, graphics)
    finally:
        discard(frames)


def _measure(frames: list, project: str = "", graphics: list | None = None) -> list[dict]:
    """frames [{path, t} | path] -> per frame {"faces": [{x, y, w, h, score}], "text": {graphic id: {"bg": y, "en": y}}} as
    fractions of the frame, or {"error"}. graphics [{id, start, end}]: the selected subtitle graphics, so each frame knows
    whose words to look for. A Bulgarian line and its English line have the same times, so for each graphic both centres
    found are returned and the panel tells the pair apart (the English one is the lower)."""
    items = [f if isinstance(f, dict) else {"path": f} for f in (frames if isinstance(frames, list) else [])]
    lines = srt_lines(project) if graphics else []
    words, rows = {}, {}
    for g in graphics or []:
        pair = {k: text_of(lines, float(g["start"]), float(g["end"]), en=(k == "en")) for k in ("bg", "en")}
        if any(pair.values()):
            words[g["id"]] = pair
            rows[g["id"]] = {k: rows_of(lines, float(g["start"]), float(g["end"]), en=(k == "en")) or [] for k in ("bg", "en") if pair[k]}
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
        try:
            boxes = dict(zip(readable, ocr.read(readable)))
        except Exception as e:                                   # noqa: BLE001  (no text for this press, never a failed press)
            log.warning("framefaces: text recognition failed (%s): faces only", e)
            boxes = {}
        for it, hit, res in zip(items, hits, out):
            if not hit or "text" not in res:
                continue
            t = it.get("t")
            seen = boxes.get(hit, [])
            active = [g for g in graphics or [] if t is not None and float(g["start"]) <= t < float(g["end"])]
            res["boxes"], res["other"], res["lines"] = {}, [], {}
            claimed, wants, unknown, missing = [], [], False, False
            for g in active:
                if g["id"] not in words:
                    unknown = True                       # a line whose words are not known: its text cannot be told from other text
                    continue
                found = {}
                for k, text in words[g["id"]].items():
                    b = find_line(seen, text) if text else None
                    if text:
                        wants.append(text)
                    if b:
                        found[k] = round(b["y"] + b["h"] / 2, 4)
                        res["boxes"].setdefault(str(g["id"]), {})[k] = {"top": round(b["y"], 4), "bottom": round(b["y"] + b["h"], 4),
                                                                       "x": round(b["x"], 4), "w": round(b["w"], 4)}
                        claimed.extend(b.get("parts") or [b])
                    elif k == "bg" and text:
                        missing = True
                if found:
                    res["text"][str(g["id"])] = found
                res["lines"][str(g["id"])] = rows[g["id"]]
            if active and not unknown and not missing:
                res["other"] = [{"text": str(b.get("text", ""))[:40], "x": round(b["x"], 4), "y": round(b["y"], 4), "w": round(b["w"], 4),
                                 "h": round(b["h"], 4), "confidence": round(float(b.get("confidence", 1.0)), 3)}
                                for b in seen if not any(b is c for c in claimed) and not _looks_own(b.get("text", ""), wants)]
    return out
