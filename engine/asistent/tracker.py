"""Motion tracker (COCKPIT_PLAN.md A3, 0.10.51): follows a region the editor boxed on one frame through the clip, forwards and
backwards, so a text or a logo can be attached to a moving thing as in After Effects.

How one step works (frame k-1 -> k), in working pixels (the file shown upright, long side at most WORK):
1. Feature points inside the region are followed with pyramidal Lucas-Kanade optical flow and checked backwards (a point whose
   way back misses by more than FB_MAX px is dropped). A similarity transform (move, scale, rotation) is fitted to the rest
   with RANSAC: that predicts where the region went and how it turned and grew.
2. The prediction is corrected against the REFERENCE: the region as boxed on the first frame. The current frame is warped
   back into the reference's position, size and angle and the reference is matched in it (normalised correlation, peak
   refined to a fraction of a pixel). Matching against the first frame (not the previous one) is what keeps the track from
   drifting over hundreds of frames. Scale and angle are refined the same way (best of a small grid, parabola between).
   When the object changes look (light, turn) and the reference no longer fits, a second template taken on a recent sure
   frame takes over; while neither fits, the flow alone carries the track and the frame is marked unsure.
3. Confidence per frame = the match score (0..1). Below LOST the frame is marked lost; the track keeps the last motion and looks
   for the object again in a wider area each frame, so it picks it up again when it comes back.

Output per timeline frame: the region's centre in FILE pixels (shown upright), its scale and angle against the first frame,
and the confidence. Nothing is smoothed (After Effects does not smooth a track either); the panel maps it through the clip's
Motion and writes the keys. Footage is processed as numbers only.
"""
from __future__ import annotations

import logging
import math
import os
import subprocess
import sys
import time

import numpy as np

from .media import MediaError, _tool, probe

log = logging.getLogger("asistent")

WORK = 1920              # working size: long side in pixels (a 4K file is tracked at half size: 0.1 px here = 0.2 px there)
FB_MAX = 0.8             # px: a flow point whose way back misses by more is not trusted
SURE = 0.80              # match score of a sure frame
UNSURE = 0.60            # below: the frame is unsure (yellow)
LOST = 0.45              # below: lost (red), the flow alone is not trusted either
MAX_FRAMES = 9000        # 5 minutes at 30 fps
ADAPT_EVERY = 4          # frames between two takes of the adapting template
CHUNK = 48               # frames decoded at a time when tracking backwards


from .sync import Cancelled  # noqa: E402  (the job runner treats it as a cancel, not an error)


# ---------------------------------------------------------------- decoding

def display_size(path: str) -> tuple[int, int]:
    from .color import _display_size
    return _display_size(path, probe(path))


def work_size(w: int, h: int, work: int = WORK) -> tuple[int, int, float]:
    k = min(1.0, work / max(w, h))
    ww, hh = int(round(w * k / 2) * 2), int(round(h * k / 2) * 2)
    return ww, hh, ww / w


def decode(path: str, start: float, step: float, count: int, size: tuple[int, int], cancelled=None, colour: bool = False):
    """`count` grey frames at media times start + i*step (the frame Premiere shows there), at `size` (w, h), upright.
    A generator: frames are read from FFmpeg as they come (memory stays small). colour (0.10.55): (grey, I420 bytes) pairs
    instead, from one decode (the panel's colour pictures of every tracked frame come from the same frames)."""
    w, h = size
    info = probe(path)
    rate = info.fps if getattr(info, "fps", None) else None
    # half a source frame early, so the frame AT `start` is the first one kept even when its time stamp rounds below it
    lead = 0.5 / rate if rate else 0.004
    ss = max(0.0, start - lead)
    vf = f"fps=fps={1.0 / step:.6f}:start_time={start - ss:.6f}:round=near,scale={w}:{h}:flags=bicubic,format={'yuv420p' if colour else 'gray'}"
    cmd = [_tool("ffmpeg"), "-v", "error", "-nostdin", "-ss", f"{ss:.6f}", "-i", path, "-an", "-sn", "-vf", vf,
           "-frames:v", str(count), "-f", "rawvideo", "-"]
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, creationflags=flags)
    n = w * h * 3 // 2 if colour else w * h
    got = 0
    try:
        while got < count:
            if cancelled and cancelled():
                raise Cancelled()
            buf = p.stdout.read(n)
            if not buf or len(buf) < n:
                break
            got += 1
            arr = np.frombuffer(buf, dtype=np.uint8)
            if colour:
                yield arr[: w * h].reshape(h, w), arr
            else:
                yield arr.reshape(h, w)
    finally:
        p.kill()
        p.communicate()


def preview(path: str, t: float, width: int = 640) -> dict:
    """One frame of the file at media time t, upright, as a JPEG for the panel (the editor boxes the object on it)."""
    import base64
    dw, dh = display_size(path)
    if dw >= dh:
        w, h = width, int(round(width * dh / dw / 2) * 2)
    else:
        w, h = int(round(width * dw / dh / 2) * 2), width
    info = probe(path)
    lead = 0.5 / info.fps if getattr(info, "fps", None) else 0.004
    p = subprocess.run([_tool("ffmpeg"), "-v", "error", "-nostdin", "-ss", f"{max(0.0, t - lead):.6f}", "-i", path, "-frames:v", "1",
                        "-vf", f"scale={w}:{h}:flags=area", "-q:v", "3", "-f", "mjpeg", "-"],
                       capture_output=True, timeout=60)
    if p.returncode != 0 or not p.stdout:
        raise MediaError(f"Cannot read a frame of {os.path.basename(path)} at {t:.2f} s.")
    return {"jpeg": base64.b64encode(p.stdout).decode("ascii"), "width": dw, "height": dh, "w": w, "h": h}


# ---------------------------------------------------------------- one step of the track

def _cv():
    import cv2
    return cv2


def _peak(res):
    """Location of the maximum of a match map with a parabola through its neighbours: (x, y, score)."""
    cv2 = _cv()
    _, score, _, (x, y) = cv2.minMaxLoc(res)
    dx = dy = 0.0
    if 0 < x < res.shape[1] - 1:
        a, b, c = res[y, x - 1], res[y, x], res[y, x + 1]
        d = a - 2 * b + c
        if d < 0:
            dx = 0.5 * (a - c) / d
    if 0 < y < res.shape[0] - 1:
        a, b, c = res[y - 1, x], res[y, x], res[y + 1, x]
        d = a - 2 * b + c
        if d < 0:
            dy = 0.5 * (a - c) / d
    return x + max(-0.5, min(0.5, dx)), y + max(-0.5, min(0.5, dy)), float(score)


def _parabola(xs, ys):
    """Vertex of the parabola through three equally spaced points (falls back to the best one)."""
    (x0, x1, x2), (y0, y1, y2) = xs, ys
    d = y0 - 2 * y1 + y2
    if d >= 0:
        return xs[int(np.argmax(ys))]
    off = 0.5 * (y0 - y2) / d
    return x1 + max(-1.0, min(1.0, off)) * (x2 - x1)


class RegionTracker:
    """Follows one region. Coordinates are working pixels; angle in degrees (clockwise on screen), scale against the first
    frame."""

    def __init__(self, frame: np.ndarray, box: tuple[float, float, float, float]):
        cv2 = _cv()
        x, y, w, h = box
        H, W = frame.shape
        if w < 8 or h < 8:
            raise ValueError("The box is too small: draw it around the object (at least a few pixels each way).")
        if x + w <= 0 or y + h <= 0 or x >= W or y >= H:
            raise ValueError("The box is outside the picture.")
        self.cx, self.cy = x + w / 2.0, y + h / 2.0
        self.bw, self.bh = float(w), float(h)
        # matched on the inner 80 % of the box: an editor's box usually holds a little background at its edges, which moves
        # differently (a camera pan) and pulled the match off
        self.w, self.h = max(8.0, round(0.8 * w)), max(8.0, round(0.8 * h))
        self.s, self.a = 1.0, 0.0
        self.vx = self.vy = 0.0                         # motion of the last step (carries the track through a lost frame)
        self.ref = self._patch(frame, self.cx, self.cy, 1.0, 0.0, self.w, self.h)
        self.alt = None                                 # a template from a recent sure frame (when the look changes)
        self.alt_age = 0
        self.prev = frame
        self.pts = self._features(frame)
        self.lost_for = 0
        self.cv2 = cv2

    # a w x h patch of `frame` around (cx, cy), turned by -a and scaled by 1/s (so it looks like the reference)
    def _patch(self, frame, cx, cy, s, a, w, h):
        cv2 = _cv()
        r = math.radians(a)
        c, n = math.cos(r) * s, math.sin(r) * s
        # patch (u, v) -> frame: centre + R(a)·s·(u - w/2, v - h/2)
        M = np.array([[c, -n, cx - c * w / 2 + n * h / 2], [n, c, cy - n * w / 2 - c * h / 2]], dtype=np.float64)
        return cv2.warpAffine(frame, M, (int(round(w)), int(round(h))), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                              borderMode=cv2.BORDER_REPLICATE).astype(np.float32)

    def _features(self, frame):
        cv2 = _cv()
        H, W = frame.shape
        mask = np.zeros_like(frame)
        r = math.radians(self.a)
        hw, hh = 0.9 * self.bw * self.s / 2, 0.9 * self.bh * self.s / 2
        corners = np.array([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]])
        rot = np.array([[math.cos(r), -math.sin(r)], [math.sin(r), math.cos(r)]])
        poly = (corners @ rot.T + [self.cx, self.cy]).astype(np.int32)
        cv2.fillConvexPoly(mask, poly, 255)
        pts = cv2.goodFeaturesToTrack(frame, maxCorners=120, qualityLevel=0.005, minDistance=3, mask=mask, blockSize=5)
        return pts.reshape(-1, 2).astype(np.float32) if pts is not None else np.zeros((0, 2), np.float32)

    def _flow(self, frame):
        """-> (cx, cy, s, a, inliers, points in this frame) predicted by the points, or None. The points start from where the
        last motion would put them (fast moves stay inside the flow's reach)."""
        cv2 = self.cv2
        if len(self.pts) < 3:
            return None
        lk = dict(winSize=(21, 21), maxLevel=4, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))
        p0 = self.pts.reshape(-1, 1, 2)
        guess = (p0 + np.array([self.vx, self.vy], np.float32)).astype(np.float32)
        p1, st, _ = cv2.calcOpticalFlowPyrLK(self.prev, frame, p0, guess, flags=cv2.OPTFLOW_USE_INITIAL_FLOW, **lk)
        if p1 is None:
            return None
        pb, st2, _ = cv2.calcOpticalFlowPyrLK(frame, self.prev, p1, p0.copy(), flags=cv2.OPTFLOW_USE_INITIAL_FLOW, **lk)
        fb = np.linalg.norm((pb - p0).reshape(-1, 2), axis=1)
        good = (st.reshape(-1) == 1) & (st2.reshape(-1) == 1) & (fb < FB_MAX)
        a, b = p0.reshape(-1, 2)[good], p1.reshape(-1, 2)[good]
        if len(a) < 3:
            return None
        M, inl = cv2.estimateAffinePartial2D(a, b, method=cv2.RANSAC, ransacReprojThreshold=1.0, maxIters=2000, confidence=0.995)
        if M is None:
            return None
        keep = inl.reshape(-1).astype(bool) if inl is not None else np.ones(len(a), bool)
        sc = math.hypot(M[0, 0], M[1, 0])
        an = math.degrees(math.atan2(M[1, 0], M[0, 0]))
        cx = M[0, 0] * self.cx + M[0, 1] * self.cy + M[0, 2]
        cy = M[1, 0] * self.cx + M[1, 1] * self.cy + M[1, 2]
        return cx, cy, self.s * sc, self.a + an, int(keep.sum()), b[keep]

    def _match(self, frame, tmpl, cx, cy, s, a, radius):
        """Best place of `tmpl` near (cx, cy) with the frame seen at scale s and angle a. -> (cx, cy, score)"""
        cv2 = self.cv2
        pad = int(math.ceil(radius))
        area = self._patch(frame, cx, cy, s, a, self.w + 2 * pad, self.h + 2 * pad)
        res = cv2.matchTemplate(area, tmpl, cv2.TM_CCOEFF_NORMED)
        px, py, score = _peak(res)
        du, dv = px - (area.shape[1] - tmpl.shape[1]) / 2.0, py - (area.shape[0] - tmpl.shape[0]) / 2.0
        r = math.radians(a)
        return cx + s * (math.cos(r) * du - math.sin(r) * dv), cy + s * (math.sin(r) * du + math.cos(r) * dv), score

    def _wide(self, frame, tmpl, cx, cy, s, a, radius):
        """The same search over a wide area, coarse first (a quarter of the size or less), then exact around the best place."""
        cv2 = self.cv2
        pad = int(math.ceil(radius))
        area = self._patch(frame, cx, cy, s, a, self.w + 2 * pad, self.h + 2 * pad)
        f = min(1.0, max(0.2, 24.0 / min(self.w, self.h)))
        small_a = cv2.resize(area, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
        small_t = cv2.resize(tmpl, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
        if small_t.shape[0] < 4 or small_t.shape[1] < 4 or small_a.shape[0] <= small_t.shape[0] or small_a.shape[1] <= small_t.shape[1]:
            return self._match(frame, tmpl, cx, cy, s, a, radius)
        res = cv2.matchTemplate(small_a, small_t, cv2.TM_CCOEFF_NORMED)
        px, py, _ = _peak(res)
        du = px / f - (area.shape[1] - tmpl.shape[1]) / 2.0
        dv = py / f - (area.shape[0] - tmpl.shape[0]) / 2.0
        r = math.radians(a)
        gx = cx + s * (math.cos(r) * du - math.sin(r) * dv)
        gy = cy + s * (math.sin(r) * du + math.cos(r) * dv)
        return self._match(frame, tmpl, gx, gy, s, a, 2.0 / f + 2)

    def _score(self, frame, tmpl, cx, cy, s, a):
        area = self._patch(frame, cx, cy, s, a, self.w, self.h)
        return float(self.cv2.matchTemplate(area, tmpl, self.cv2.TM_CCOEFF_NORMED)[0, 0])

    def step(self, frame: np.ndarray) -> dict:
        lost_before = self.lost_for > 0
        flow = None if lost_before else self._flow(frame)
        # where the object may be: where the points say, where the last motion would put it, where it was; seen at the
        # points' scale and angle or at the last frame's (a few bad points must not spoil every guess)
        guesses = []
        poses = [(self.s, self.a)]
        if flow:
            guesses.append((flow[0], flow[1]))
            fs, fa = min(4.0, max(0.25, flow[2])), flow[3]
            if abs(fs - self.s) > 1e-4 or abs(fa - self.a) > 0.01:
                poses.insert(0, (fs, fa))
        guesses += [(self.cx + self.vx, self.cy + self.vy), (self.cx, self.cy)]
        base = max(6.0, 0.15 * max(self.w, self.h) * self.s)
        templates = [(n, t) for n, t in (("ref", self.ref), ("alt", self.alt)) if t is not None]
        best = None

        def consider(name, tmpl, got, pose):
            nonlocal best
            if best is None or got[2] > best[3] + (0.03 if name == "alt" else 0):
                best = (name, got[0], got[1], got[2], tmpl, pose)

        for gx, gy in guesses if not lost_before else []:
            for ps, pa in poses:
                for name, tmpl in templates:
                    consider(name, tmpl, self._match(frame, tmpl, gx, gy, ps, pa, base), (ps, pa))
        # not sure near the guesses (a sudden turn, a jump, a lost object): search wide, coarse to fine
        if best is None or best[3] < SURE:
            speed = math.hypot(self.vx, self.vy)
            wide = min(max(frame.shape) / 2.0, 1.2 * max(self.w, self.h) * self.s + 2 * speed + base * (1 + 2 * self.lost_for))
            for ps, pa in poses:
                for name, tmpl in templates:
                    consider(name, tmpl, self._wide(frame, tmpl, self.cx, self.cy, ps, pa, wide), (ps, pa))
        s, a = best[5]
        name, mx, my, score, tmpl, _ = best
        if score >= LOST:
            cx, cy = mx, my
            # scale and angle (the pose that matched best) refined against the template (best of a small grid and the vertex between, a few rounds so a wrong start is pulled back)
            for _ in range(3):
                ds, da = 0.012 * s, 0.6
                ss = [s - ds, s, s + ds]
                s2 = float(_parabola(ss, [self._score(frame, tmpl, cx, cy, v, a) for v in ss]))
                aa = [a - da, a, a + da]
                a2 = float(_parabola(aa, [self._score(frame, tmpl, cx, cy, s2, v) for v in aa]))
                moved = abs(s2 - s) > 0.002 * s or abs(a2 - a) > 0.1
                s, a = s2, a2
                cx, cy, score = self._match(frame, tmpl, cx, cy, s, a, 2.0)
                if not moved:
                    break
        conf = max(0.0, min(1.0, score))
        # a frame whose picture does not match is lost, whatever the flow says (the flow alone can follow the background)
        state = "lost" if conf < LOST else "sure" if conf >= SURE else "unsure"
        if state == "lost":
            self.lost_for += 1
            self.vx, self.vy = 0.8 * self.vx, 0.8 * self.vy       # drift to a stop; never invent a path
            cx, cy, s, a = self.cx + self.vx, self.cy + self.vy, self.s, self.a
        else:
            self.lost_for = 0
            self.vx, self.vy = cx - self.cx, cy - self.cy
        self.cx, self.cy, self.s, self.a = cx, cy, s, a
        # the object changes look (turns away, light): a second template follows it, After Effects' "adapt feature" with a
        # guard. It is taken again every few frames while the match is sure and the reference fits less than very well, or
        # while unsure when the points moved exactly with the match (two independent measures agree within 1.5 px).
        agree = bool(flow) and flow[4] >= 20 and math.hypot(flow[0] - cx, flow[1] - cy) < 1.5
        if ((state == "sure" and conf < 0.95) or (state == "unsure" and agree)) and (self.alt is None or self.alt_age >= ADAPT_EVERY):
            self.alt, self.alt_age = self._patch(frame, cx, cy, s, a, self.w, self.h), 0
        self.alt_age += 1
        self.prev = frame
        if state == "lost":
            self.pts = np.zeros((0, 2), np.float32)
        elif flow and flow[4] >= 30 and math.hypot(flow[0] - cx, flow[1] - cy) < 2.0 and self.alt_age % 10:
            self.pts = flow[5].astype(np.float32)                   # the points that moved with the object, in this frame
        else:
            self.pts = self._features(frame)                        # fresh points inside the region where it really is
        return {"x": cx, "y": cy, "s": s, "a": a, "c": conf, "state": state}


# ---------------------------------------------------------------- the whole track

def track_frames(frames_fwd, frames_back, box, k0: int, total: int, progress=None, cancelled=None, hook=None) -> list[dict | None]:
    """frames_fwd: frames k0, k0+1, ... ; frames_back: frames k0, k0-1, ... (both start with the boxed frame). A frame may be
    a (grey, extra) pair: hook(k, extra, result) is then called for it (the panel's pictures, 0.10.55).
    -> one entry per frame index 0..total-1 (None where no frame came)."""
    out: list[dict | None] = [None] * total
    done = 0

    def run(frames, sign):
        nonlocal done
        tr = None
        for i, f in enumerate(frames):
            if cancelled and cancelled():
                raise Cancelled()
            k = k0 + sign * i
            if k < 0 or k >= total:
                break
            extra = None
            if isinstance(f, tuple):
                f, extra = f
            if tr is None:
                tr = RegionTracker(f, box)
                out[k] = {"x": tr.cx, "y": tr.cy, "s": 1.0, "a": 0.0, "c": 1.0, "state": "sure"}
            else:
                out[k] = tr.step(f)
            if hook and extra is not None:
                hook(k, extra, out[k])
            done += 1
            if progress and done % 5 == 0:
                progress(done / max(1, total))

    run(frames_fwd, 1)
    if k0 > 0:
        run(frames_back, -1)
    return out


def _backwards(path, t_from, step, k0, size, cancelled, colour=False):
    """Frames k0, k0-1, ..., 0 (decoded forwards in chunks, handed out in reverse)."""
    end = k0
    while end >= 0:
        start = max(0, end - CHUNK + 1)
        chunk = list(decode(path, t_from + start * step, step, end - start + 1, size, cancelled, colour))
        for f in reversed(chunk):
            yield f
        end = start - 1


# ---------------------------------------------------------------- pictures for the panel (0.10.55)
# Every tracked frame as a small colour JPEG, so the panel can scrub, step and play the track with the box drawn on it, and
# show the frame being tracked live. Kept in memory for the last few tracks (a 300-frame clip is about 5 MB).
THUMB = 480                     # long side
KEEP_TRACKS = 4
_TRACKS: dict = {}


def _thumb(i420: np.ndarray, size: tuple[int, int], out: tuple[int, int]) -> bytes:
    cv2 = _cv()
    w, h = size
    tw, th = out
    y = i420[: w * h].reshape(h, w)
    u = i420[w * h: w * h + (w // 2) * (h // 2)].reshape(h // 2, w // 2)
    v = i420[w * h + (w // 2) * (h // 2):].reshape(h // 2, w // 2)
    ys = cv2.resize(y, (tw, th), interpolation=cv2.INTER_AREA)
    us = cv2.resize(u, (tw // 2, th // 2), interpolation=cv2.INTER_AREA)
    vs = cv2.resize(v, (tw // 2, th // 2), interpolation=cv2.INTER_AREA)
    bgr = cv2.cvtColor(np.concatenate([ys.reshape(-1), us.reshape(-1), vs.reshape(-1)]).reshape(th * 3 // 2, tw), cv2.COLOR_YUV2BGR_I420)
    ok, jpg = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 72])
    return jpg.tobytes() if ok else b""


def _store(tid: str, total: int, size: tuple[int, int]) -> dict:
    import uuid
    if tid and tid in _TRACKS:
        return _TRACKS[tid]
    tid = tid or uuid.uuid4().hex[:12]
    w, h = size
    k = THUMB / max(w, h)
    entry = {"id": tid, "thumbs": [None] * total, "size": (max(2, int(round(w * k / 2)) * 2), max(2, int(round(h * k / 2)) * 2)),
             "used": time.time()}
    _TRACKS[tid] = entry
    for old in sorted(_TRACKS.values(), key=lambda e: e["used"])[:-KEEP_TRACKS]:
        _TRACKS.pop(old["id"], None)
    return entry


def thumbs(tid: str, first: int, count: int) -> dict:
    """Pictures `first`.. of a track (base64 JPEG, null where none). -> {items, from, size}"""
    import base64
    e = _TRACKS.get(tid or "")
    if not e:
        raise ValueError("That track's pictures are gone (the engine restarted): track again.")
    e["used"] = time.time()
    first = max(0, int(first))
    items = [base64.b64encode(b).decode("ascii") if b else None for b in e["thumbs"][first:first + max(1, min(int(count), 120))]]
    return {"items": items, "from": first, "size": list(e["size"]), "total": len(e["thumbs"])}


def track(path: str, t_from: float, t_to: float, step: float, t0: float, box: list, progress=None, cancelled=None,
          live=None, into: dict | None = None) -> dict:
    """Track the region `box` [x, y, w, h] (fractions of the upright picture) boxed at media time t0, over the media range
    [t_from, t_to) in steps of `step` (one timeline frame). -> {frames: [{t, x, y, s, a, c, state}], width, height, k0}
    x, y in file pixels (upright)."""
    if not os.path.isfile(path):
        raise ValueError("The file is missing (offline media?): " + os.path.basename(path))
    step = float(step)
    if not (0.0005 <= step <= 1.0):
        raise ValueError("The frame step is unclear.")
    t_from, t_to, t0 = float(t_from), float(t_to), float(t0)
    info = probe(path)
    if not info.has_video:
        raise ValueError(os.path.basename(path) + " has no picture.")
    if info.duration:
        t_to = min(t_to, info.duration)
    total = int(math.floor((t_to - t_from) / step + 1e-6))
    if total < 2:
        raise ValueError("The clip is too short to track.")
    if total > MAX_FRAMES:
        raise ValueError(f"The clip is {total} frames long: the tracker takes up to {MAX_FRAMES} (trim it or track a part).")
    k0 = int(round((t0 - t_from) / step))
    if not (0 <= k0 < total):
        raise ValueError("Park the playhead over the clip to track.")
    dw, dh = display_size(path)
    ww, wh, k = work_size(dw, dh)
    bx, by, bw, bh = (float(v) for v in box)
    if not (0 <= bx < 1 and 0 <= by < 1 and 0 < bw <= 1 and 0 < bh <= 1):
        raise ValueError("Draw the box on the picture.")
    wbox = (bx * ww, by * wh, bw * ww, bh * wh)
    t_start = time.time()
    # pictures go into this track's store, or (a re-track of a part) into an earlier track's at an offset
    offset = int(into["offset"]) if into and into.get("id") in _TRACKS else 0
    store = _TRACKS[into["id"]] if offset or (into and into.get("id") in _TRACKS) else _store("", total, (ww, wh))
    store["used"] = time.time()
    tsize = store["size"]
    last_live = [0.0]

    def hook(k, i420, r):
        j = k + offset
        if 0 <= j < len(store["thumbs"]):
            store["thumbs"][j] = _thumb(i420, (ww, wh), tsize)
            if live and time.time() - last_live[0] > 0.2:
                import base64
                last_live[0] = time.time()
                live({"k": j, "jpeg": base64.b64encode(store["thumbs"][j]).decode("ascii"),
                      "x": round(r["x"] / k_, 2), "y": round(r["y"] / k_, 2), "s": r["s"], "a": r["a"], "state": r["state"]})

    k_ = k
    fwd = decode(path, t_from + k0 * step, step, total - k0, (ww, wh), cancelled, colour=True)
    back = _backwards(path, t_from, step, k0, (ww, wh), cancelled, colour=True) if k0 > 0 else iter(())
    raw = track_frames(fwd, back, wbox, k0, total, progress, cancelled, hook)
    frames = []
    for i, r in enumerate(raw):
        if r is None:
            continue
        frames.append({"t": round(t_from + i * step, 6), "x": round(r["x"] / k, 3), "y": round(r["y"] / k, 3),
                       "s": round(r["s"], 5), "a": round(r["a"], 4), "c": round(r["c"], 3), "state": r["state"]})
    states = [f["state"] for f in frames]
    log.info("tracker %s: %d frames (%d sure, %d unsure, %d lost) of %d, box %s at %.3f, work %dx%d, %.1f s",
             os.path.basename(path), len(frames), states.count("sure"), states.count("unsure"), states.count("lost"), total,
             [round(v, 3) for v in box], t0, ww, wh, time.time() - t_start)
    return {"frames": frames, "width": dw, "height": dh, "k0": k0, "total": total, "step": step, "t0": t0, "id": store["id"],
            "offset": offset, "box": [round(bx * dw, 2), round(by * dh, 2), round(bw * dw, 2), round(bh * dh, 2)],
            "thumb": list(tsize)}
