"""Motion tracker (COCKPIT_PLAN.md A3, 0.10.51; small, blurry, low-detail and fast objects 0.10.76): follows a region the editor
boxed on one frame through the clip, forwards and backwards, so a text or a logo can be attached to a moving thing as in After
Effects.

How one step works (frame k-1 -> k), in working pixels (the file shown upright; a 4K file is halved only for a box that stays
MIN_SIDE px or more across, a smaller box is tracked on the file's own pixels):
1. A guess: feature points seeded on the object where it surely was are followed with pyramidal Lucas-Kanade optical flow
   (checked backwards) on a crop around it, and a similarity (move, scale, turn) is fitted with RANSAC. The flow is only a
   guess and a witness; it never carries a frame by itself (it can follow the background).
2. The measurement: the REFERENCE (the region as boxed) and an adapting template (a recent sure look) are matched (normalised
   correlation, sub-pixel peak) over the whole area the object can have reached: around where its last motion puts it, as
   far as its speed, the flow's guess and 1.5 object sizes allow. Every place is weighed by its distance from that
   prediction (a capped cost: a clearly better match farther away still wins). Matching against the boxed look keeps the
   track from drifting over hundreds of frames. Scale and angle are refined on the template, only those the object shows.
3. Judging it: the match score is set against what the picture's noise allows and against how well the background around
   the object already matched it on the boxed frame (a sure frame must match clearly better than any background did). The
   second-best place is kept: nearly as good means ambiguous (a look-alike, a smooth slope a soft template fits anywhere),
   which is never sure. A place far from the prediction, or where a look-alike seen earlier is expected, is taken only when
   sure and alone; otherwise the place the motion allows (as unsure) or nothing (lost). Several frames in a row with only
   weak evidence (blur-only, ambiguous, fallen back) end as lost rather than drifting.
4. Hard pictures: a small object is matched magnified (up to 2x, cubic); a smooth one (a ball out of focus, a fingertip) on
   the picture with the slow shading taken out, and with the whole box when its outline is all the detail it has; a blurred
   frame with the template smeared along the motion or blurred like the frame (at most unsure on that alone); the adapting
   template is renewed only from sharp, sure frames that look like the last look.
5. Lost: the search goes on around the last place seen, wider by the object's usual speed each frame, with the boxed look and
   a few sure looks kept; it is picked up again only on a sure match that stands alone.

Output per timeline frame: the region's centre in FILE pixels (shown upright), its scale and angle against the first frame,
and the confidence (sure / unsure / lost). Nothing is smoothed (After Effects does not smooth a track either); the panel maps
it through the clip's Motion and writes the keys, none on lost frames. Footage is processed as numbers only.
Accuracy and the hard cases: docs/TRACKER.md, scripts/bench_tracker.py and scripts/bench_tracker_hard.py.
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
MIN_SIDE = 48            # working pixels: a smaller box is tracked on more of the file's own pixels (up to all of them)
FB_MAX = 0.8             # px: a flow point whose way back misses by more is not trusted
SURE = 0.80              # match score of a sure frame (raised for a cluttered picture, see SURE_MAX)
LOST = 0.45              # below: lost (red), no key
MAX_FRAMES = 9000        # 5 minutes at 30 fps
MAX_CLIP_FRAMES = 4 * MAX_FRAMES   # 0.10.63: a longer clip is tracked a range at a time (its frame list stays under ~3 MB)
ADAPT_EVERY = 4          # frames between two takes of the adapting template
CHUNK = 48               # frames decoded at a time when tracking backwards
# ---- 0.10.76: the template
INNER = 0.8              # the share of the box matched (the editor's box holds a little background at its edges)
EDGE_RATIO = 0.4         # the inner part holding less than this share of the box's edges: the whole box is matched
SMALL = 32               # template pixels: a smaller object is matched magnified (cubic) to measure a fraction of a pixel
MAG_MAX = 2.0            # at most this magnification (4x measured less precise: interpolation, not detail)
SMOOTH = 0.30            # an object with less than this share of fine detail is matched with the shading taken out
HP_WIDTH = 0.5           # that high-pass's width against the object's size
POSE_SHOWN = 0.2         # under this share of its edges across (along) the radius an object shows no turn (size)
POSE_MIN = 0.03          # a template that matches this nearly as well turned 4 degrees / 6 % bigger shows no angle / scale
# ---- the search and the motion
SEARCH_PX = 360          # a search area larger than this (pixels) is matched coarse first, then exact
MOTION_PEN = 0.05        # score taken off a place per (distance from the predicted place / how far it may be) squared
PEN_CAP = 0.15           # never more: a clearly better match farther away still wins
COAST = 10               # lost frames the search goes on along the last motion before slowing down
# ---- judging a match
CEIL_MIN = 0.4           # the noise never lowers what a perfect match can score below this
SURE_MAX = 0.95          # the sure threshold is raised above how well the background matched, up to this
CLUTTER_GAP = 0.08       # by this much
SECOND_R = 0.6           # the chosen peak's hill: this share of the template's size (the second place is outside it)
AMBIG = 0.04             # a second place within this of the chosen one (after the motion weighing): ambiguous
ALONE = 0.15             # a match this much better than the second place stands alone
FLOW_AGREE_N = 6         # flow points that must move with the match for the flow to count as agreeing
AMB_RUN = 3              # more ambiguous frames in a row (drifting from the prediction) than this: lost
WEAK_RUN = 3             # more frames in a row with only weak evidence than this: lost
# ---- keeping looks
ALT_CHAIN = 0.7          # a new adapting template must match the last one at least this well
ALT_SHARP = 0.7          # and be at least this sharp against the boxed look (no blurred looks kept)
BANK = 8                 # sure looks of the object kept to find it again
REACQ = 4                # after picking it up again, sure frames before the adapting template may be renewed
# ---- 0.10.77: the object's colours (the user's basketball: the grey template took the dark shorts for the orange ball)
COL_LEAD = 0.25          # the object's colours must stand out from its surroundings by this (likelihood) to be used
COL_KEEP = 0.4           # a place must keep this share of the object's lead over its surroundings to be the object
COL_ALONE = 0.75         # colour confirms a place when no other spot in the area searched comes within this share of it
COL_PEN = 0.25           # score taken off a place per missing share of the object's colours (and again of its spot)
UNSURE_POSE = 0.01       # an unsure frame changes the size by at most 1 % and the angle by 1 degree (0.5 % / 2 % measured worse)
COL_LEARN = 0.1          # how fast the surroundings' colours are learnt on sure frames (the object moves over new ground)


from .sync import Cancelled  # noqa: E402  (the job runner treats it as a cancel, not an error)


# ---------------------------------------------------------------- decoding

def display_size(path: str) -> tuple[int, int]:
    from .color import _display_size
    return _display_size(path, probe(path))


def work_size(w: int, h: int, work: int = WORK) -> tuple[int, int, float]:
    k = min(1.0, work / max(w, h))
    ww, hh = int(round(w * k / 2) * 2), int(round(h * k / 2) * 2)
    return ww, hh, ww / w


def work_for_box(w: int, h: int, bw: float, bh: float) -> tuple[int, int, float]:
    """The working size for a box of bw x bh (fractions of the picture), 0.10.76: a 4K file is halved (WORK) only when
    the box stays MIN_SIDE pixels or more across at that size; a smaller box is tracked on more of the file's own pixels,
    up to all of them."""
    ww, wh, k = work_size(w, h)
    side = min(bw * ww, bh * wh)
    if k < 1.0 and side < MIN_SIDE:
        ww, wh, k = work_size(w, h, work=int(math.ceil(max(w, h) * min(1.0, k * MIN_SIDE / max(side, 1e-6)))))
    return ww, wh, k


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


def _noise(frame) -> float:
    """The picture's noise (standard deviation in grey levels), from the median response of a Laplacian-like kernel that
    ignores smooth shading (Immerkaer): textures raise it a little, the median keeps edges out."""
    cv2 = _cv()
    k = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], np.float32)
    r = cv2.filter2D(frame.astype(np.float32), -1, k)
    return float(np.median(np.abs(r[1:-1, 1:-1]))) / (0.6745 * 6.0)


def _grad(p):
    cv2 = _cv()
    g = cv2.GaussianBlur(p, (0, 0), 1.0)                  # the noise's own edges left out
    return cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)


def _edges(p) -> float:
    """How much edge a patch holds (gradient energy)."""
    gx, gy = _grad(p)
    return float((gx * gx + gy * gy).sum())


def _pose_shown(p) -> tuple[float, float]:
    """How much a patch shows a turn and a change of size: the share of its edges' energy (weighted by the distance from the
    middle, on the round middle part) that runs across the radius (a turn moves it) and along it (a change of size moves it).
    A textured thing: about half each; a round plain thing: almost all along the radius, nothing for a turn."""
    h, w = p.shape
    gx, gy = _grad(p)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    x, y = xx - (w - 1) / 2.0, yy - (h - 1) / 2.0
    r2 = x * x + y * y
    disc = r2 <= (0.5 * min(w, h)) ** 2
    tot = float((r2 * (gx * gx + gy * gy))[disc].sum())
    if tot <= 1e-9:
        return 0.0, 0.0
    gt, gr = x * gy - y * gx, x * gx + y * gy
    return float((gt * gt)[disc].sum()) / tot, float((gr * gr)[disc].sum()) / tot


def _sharpness(p) -> float:
    """How sharp a patch is: its gradient energy against its contrast (a blur lowers it, a brightness change does not)."""
    cv2 = _cv()
    gx = cv2.Sobel(p, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(p, cv2.CV_32F, 0, 1, ksize=3)
    v = float(p.var())
    return float((gx * gx + gy * gy).mean()) / v if v > 1e-6 else 0.0


def _motion_kernel(dx: float, dy: float):
    """A line kernel along (dx, dy) as long as that vector (motion blur during the exposure), or None when shorter than 1.5."""
    L = math.hypot(dx, dy)
    if L < 1.5:
        return None
    n = int(math.ceil(L)) | 1
    k = np.zeros((n + 2, n + 2), np.float32)
    c = (n + 1) / 2.0
    ux, uy = dx / L, dy / L
    for i in range(64):
        t = (i / 63.0 - 0.5) * L
        x, y = c + ux * t, c + uy * t
        x0, y0 = int(math.floor(x)), int(math.floor(y))
        fx, fy = x - x0, y - y0
        for ddx, ddy, wgt in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
            if 0 <= y0 + ddy < k.shape[0] and 0 <= x0 + ddx < k.shape[1]:
                k[y0 + ddy, x0 + ddx] += wgt
    return k / k.sum()


def _gauss_kernel(sigma: float):
    cv2 = _cv()
    g = cv2.getGaussianKernel(int(2 * math.ceil(3 * sigma) + 1), sigma).astype(np.float32)
    return g @ g.T


_YB = 4                  # brightness bits of a colour bin: 16 steps (8 lost the ball against the court more often)


def _planes(grey, colour):
    """The half-size planes the colour model reads: Y, and U and V when the frame came in colour (I420 bytes)."""
    cv2 = _cv()
    H, W = grey.shape
    y = cv2.resize(grey, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
    if colour is None or len(colour) < W * H * 3 // 2:
        return (y,)
    n, q = W * H, (W // 2) * (H // 2)
    return (y, colour[n:n + q].reshape(H // 2, W // 2), colour[n + q:n + 2 * q].reshape(H // 2, W // 2))


def _bins(planes, x0, y0, x1, y1):
    """Each pixel's colour bin in a crop of the planes: Y 8 x U 16 x V 16 (brightness coarser: light changes)."""
    y, u, v = (p[y0:y1, x0:x1].astype(np.int32) for p in planes)
    return (y >> (8 - _YB)) * 256 + (u >> 4) * 16 + (v >> 4)


def _hist(bins, weights, n):
    from scipy.ndimage import gaussian_filter
    h = np.bincount(bins.reshape(-1), weights=weights.reshape(-1).astype(np.float64), minlength=n)[:n]
    h = gaussian_filter(h.reshape((n // 256, 16, 16)), 0.8, mode="nearest").reshape(-1)
    return h / max(1e-9, h.sum())


class RegionTracker:
    """Follows one region. Coordinates are working pixels; angle in degrees (clockwise on screen), scale against the first
    frame.

    0.10.76 (the user: "accurately track small, blurry, low-detail and fast-moving objects ... When reliable tracking is
    impossible, clearly identify uncertainty instead of generating inaccurate keyframes"): see the module's description,
    steps 2-5. Each rule there came from a measured failure in scripts/bench_tracker_hard.py or tests/test_tracker.py
    (docs/TRACKER.md lists them)."""

    def __init__(self, frame: np.ndarray, box: tuple[float, float, float, float], colour=None):
        cv2 = _cv()
        self.cv2 = cv2
        x, y, w, h = box
        H, W = frame.shape
        if w < 2 or h < 2:
            raise ValueError("The box is too small: draw it around the object (at least 2 pixels each way; zoom in to draw it).")
        if x + w <= 0 or y + h <= 0 or x >= W or y >= H:
            raise ValueError("The box is outside the picture.")
        self.cx, self.cy = x + w / 2.0, y + h / 2.0
        self.bw, self.bh = float(w), float(h)
        # matched on the inner 80 % of the box: an editor's box usually holds a little background at its edges, which moves
        # differently (a camera pan) and pulled the match off (measured 0.10.76: also the most precise for small boxes). A box
        # drawn tight around a plain thing (a ball, a fingertip) has its only detail, the outline, in that outer ring: then
        # the whole box is matched.
        iw, ih = max(2.0, INNER * w), max(2.0, INNER * h)
        self.m = 1.0
        full = self._patch(frame, self.cx, self.cy, 1.0, 0.0, max(3, int(round(w))), max(3, int(round(h))), m=1.0)
        inner = self._patch(frame, self.cx, self.cy, 1.0, 0.0, max(3, int(round(iw))), max(3, int(round(ih))), m=1.0)
        if _edges(inner) < EDGE_RATIO * _edges(full):
            iw, ih = max(2.0, float(w)), max(2.0, float(h))
        # magnification: a template smaller than SMALL pixels is sampled finer (cubic), so the match peak has room to show
        # a fraction of a pixel
        self.m = min(MAG_MAX, max(1.0, SMALL / min(iw, ih)))
        self.w, self.h = max(4, int(round(iw * self.m))), max(4, int(round(ih * self.m)))
        self.interp = cv2.INTER_CUBIC if self.m > 1.01 else cv2.INTER_LINEAR
        self.size = max(iw, ih)                          # the object's size in frame pixels (at scale 1)
        self.s, self.a = 1.0, 0.0
        self.vx = self.vy = 0.0                          # motion of the last step
        self.vsx = self.vsy = 0.0                        # motion of the last sure step (the smear of a blurred frame)
        self.amb_run = 0                                 # ambiguous frames in a row
        self.vtyp = 0.0                                  # the object's usual speed lately (sure frames): how far a lost one can go
        self.lost_r = 0.0                                # the lost search's radius so far
        self.weak_run = 0                                # frames in a row with only weak evidence (blur-only, fallback, ambiguous)
        self.vu = max(6.0, 0.75 * max(w, h))             # how unsure that motion is (px): wide at the start (nothing known)
        # a smooth thing (a soft blob, a fingertip, a ball out of focus) has little fine detail of its own, and the slow
        # shading of the background inside the box pulls its match off: it is matched on the picture with that shading
        # taken out (a high-pass as wide as about half the object)
        self.hp = None
        n0 = self._patch(frame, self.cx, self.cy, 1.0, 0.0, max(3, int(round(iw))), max(3, int(round(ih))), m=1.0)
        fine = n0 - cv2.GaussianBlur(n0, (0, 0), max(1.0, self.size / 6.0))
        if n0.var() > 1e-6 and fine.var() / n0.var() < SMOOTH:
            self.hp = max(2.0, HP_WIDTH * self.size)
        raw, frame = frame, self._prep(frame)
        self.ref = self._patch(frame, self.cx, self.cy, 1.0, 0.0, self.w, self.h)
        self.ref_sharp = _sharpness(self.ref)
        # what a perfect match can score in this picture: the noise lowers it (two noisy copies of the same thing)
        native = self._patch(frame, self.cx, self.cy, 1.0, 0.0, max(3, int(round(iw))), max(3, int(round(ih))), m=1.0)
        var, n = float(native.var()), _noise(raw)
        self.ceiling = max(CEIL_MIN, min(1.0, (var - n * n) / var)) if var > 1e-6 else CEIL_MIN
        # scale and angle are measured only when the object shows them, and a guess there drags the position off: a round
        # thing's edges all run around its middle (turning it changes nothing: its edges' share across the radius is small);
        # a tiny one matches as well turned 4 degrees or 6 % bigger
        turn, grow = _pose_shown(self.ref)
        self.fix_a = turn < POSE_SHOWN or 1.0 - self._score(frame, self.ref, self.cx, self.cy, 1.0, 4.0) < POSE_MIN
        self.fix_s = grow < POSE_SHOWN or 1.0 - self._score(frame, self.ref, self.cx, self.cy, 1.06, 0.0) < POSE_MIN
        # how well the background around it already matches the object (a smooth slope, a look-alike): a sure frame must
        # match clearly better than that
        self.others = []                                 # look-alikes seen near the object: {x, y, vx, vy, seen}
        self.cap = PEN_CAP
        self._areas = {}
        ring = self._search(frame, self.ref, self.cx, self.cy, 1.0, 0.0, min(max(H, W) / 2.0, max(4.0 * self.size, 100.0)),
                            (self.cx, self.cy), 1e6)
        self.clutter = max(0.0, ring["sraw"]) / self.ceiling
        self.sure_t = max(SURE, min(SURE_MAX, self.clutter + CLUTTER_GAP))
        if ring["sxy"] and ring["sraw"] >= 0.6 * self.ceiling:
            self.others.append({"x": ring["sxy"][0], "y": ring["sxy"][1], "vx": 0.0, "vy": 0.0, "seen": 0})
        self.sure_run = 1
        self.gx, self.gy = self.cx, self.cy              # the last place measured before a loss
        self.alt = None                                  # a template from a recent sure frame (when the look changes)
        self.alt_age = 0
        self.bank = []                                   # sure looks kept to find the object again after it was lost
        self.prev = raw
        self.pts = self._features(raw)
        self.lost_for = 0
        self.col = None
        self._colour_model(_planes(raw, colour))

    # ------------------------------------------------------------ sampling
    def _patch(self, frame, cx, cy, s, a, w, h, m=None):
        """A w x h patch of `frame` around (cx, cy) turned by -a and scaled by 1/s, sampled m times finer than the frame
        (so it lines up with the reference)."""
        cv2 = self.cv2
        q = s / (self.m if m is None else m)             # frame pixels per patch pixel
        r = math.radians(a)
        c, n = math.cos(r) * q, math.sin(r) * q
        # patch (u, v) -> frame: centre + R(a)·q·(u - w/2, v - h/2)
        M = np.array([[c, -n, cx - c * w / 2 + n * h / 2], [n, c, cy - n * w / 2 - c * h / 2]], dtype=np.float64)
        flags = (self.interp if m is None else cv2.INTER_LINEAR) | cv2.WARP_INVERSE_MAP
        return cv2.warpAffine(frame, M, (int(round(w)), int(round(h))), flags=flags, borderMode=cv2.BORDER_REPLICATE).astype(np.float32)

    def _to_frame(self, cx, cy, s, a, du, dv):
        """A shift (du, dv) in template pixels at pose (s, a) -> frame point."""
        q = s / self.m
        r = math.radians(a)
        return cx + q * (math.cos(r) * du - math.sin(r) * dv), cy + q * (math.sin(r) * du + math.cos(r) * dv)

    # ------------------------------------------------------------ flow (a guess only)
    def _roi(self, frame, extra):
        H, W = frame.shape
        r = int(1.5 * max(self.bw, self.bh) * self.s + extra + 40)
        x0, y0 = max(0, int(self.cx - r)), max(0, int(self.cy - r))
        return x0, y0, min(W, int(self.cx + r) + 1), min(H, int(self.cy + r) + 1)

    def _features(self, frame):
        cv2 = self.cv2
        x0, y0, x1, y1 = self._roi(frame, 0)
        crop = frame[y0:y1, x0:x1]
        mask = np.zeros_like(crop)
        r = math.radians(self.a)
        hw, hh = 0.9 * self.bw * self.s / 2, 0.9 * self.bh * self.s / 2
        corners = np.array([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]])
        rot = np.array([[math.cos(r), -math.sin(r)], [math.sin(r), math.cos(r)]])
        poly = (corners @ rot.T + [self.cx - x0, self.cy - y0]).astype(np.int32)
        pts = None
        if crop.size:
            cv2.fillConvexPoly(mask, poly, 255)
        if crop.size and mask.any():
            pts = cv2.goodFeaturesToTrack(crop, maxCorners=120, qualityLevel=0.005, minDistance=3, mask=mask, blockSize=5)
        pts = pts.reshape(-1, 2).astype(np.float32) + [x0, y0] if pts is not None else np.zeros((0, 2), np.float32)
        if len(pts) < 6:                                  # little detail (small, soft): a grid over the box as well
            g = [(u, v) for u in (-0.3, 0, 0.3) for v in (-0.3, 0, 0.3)]
            extra = np.array([[self.cx + u * self.bw * self.s, self.cy + v * self.bh * self.s] for u, v in g], np.float32)
            pts = np.vstack([pts, extra]).astype(np.float32)
        return pts

    def _flow(self, frame):
        """-> (cx, cy, s, a, inliers, points in this frame) predicted by the points, or None. Worked on a crop around the
        object (the same result, far less work on a 4K frame); the points start from where the last motion would put them."""
        cv2 = self.cv2
        if len(self.pts) < 3:
            return None
        x0, y0, x1, y1 = self._roi(frame, 3 * math.hypot(self.vx, self.vy))
        a_img, b_img = self.prev[y0:y1, x0:x1], frame[y0:y1, x0:x1]
        if a_img.shape[0] < 8 or a_img.shape[1] < 8:
            return None
        lk = dict(winSize=(21, 21), maxLevel=4, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))
        off = np.array([x0, y0], np.float32)
        p0 = (self.pts - off).reshape(-1, 1, 2).astype(np.float32)
        guess = (p0 + np.array([self.vx, self.vy], np.float32)).astype(np.float32)
        p1, st, _ = cv2.calcOpticalFlowPyrLK(a_img, b_img, p0, guess, flags=cv2.OPTFLOW_USE_INITIAL_FLOW, **lk)
        if p1 is None:
            return None
        pb, st2, _ = cv2.calcOpticalFlowPyrLK(b_img, a_img, p1, p0.copy(), flags=cv2.OPTFLOW_USE_INITIAL_FLOW, **lk)
        fb = np.linalg.norm((pb - p0).reshape(-1, 2), axis=1)
        good = (st.reshape(-1) == 1) & (st2.reshape(-1) == 1) & (fb < FB_MAX)
        a, b = p0.reshape(-1, 2)[good] + off, p1.reshape(-1, 2)[good] + off
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

    # ------------------------------------------------------------ matching
    def _match(self, frame, tmpl, cx, cy, s, a, radius, blur=None):
        """Best place of `tmpl` near (cx, cy) (radius in template pixels) with the frame seen at scale s and angle a.
        blur: (target "t" or "a", kernel): the template or the area blurred first. -> (cx, cy, score)"""
        cv2 = self.cv2
        pad = int(math.ceil(radius))
        area = self._patch(frame, cx, cy, s, a, self.w + 2 * pad, self.h + 2 * pad)
        if blur is not None:
            if blur[0] == "t":
                tmpl = cv2.filter2D(tmpl, -1, blur[1], borderType=cv2.BORDER_REPLICATE)
            else:
                area = cv2.filter2D(area, -1, blur[1], borderType=cv2.BORDER_REPLICATE)
        res = cv2.matchTemplate(area, tmpl, cv2.TM_CCOEFF_NORMED)
        px, py, score = _peak(res)
        du, dv = px - (area.shape[1] - tmpl.shape[1]) / 2.0, py - (area.shape[0] - tmpl.shape[0]) / 2.0
        x, y = self._to_frame(cx, cy, s, a, du, dv)
        return x, y, score

    def _search(self, frame, tmpl, gx, gy, s, a, radius, pred, sig, near_r=None):
        """Every place of `tmpl` within `radius` frame pixels of (gx, gy), each weighed by its distance from the predicted
        place `pred` (sig: how far the object may be from it). Coarse first when the area is large, then exact.
        -> {x, y, raw, pen, second, sxy, sraw, near}: the chosen place, its match score, its weighed score; the best weighed
        score of any other place (outside the chosen peak's hill), where that is and its match score (the ambiguity test,
        look-alikes); near: the best place within near_r of the prediction (x, y, score), or None."""
        cv2 = self.cv2
        q = s / self.m
        pad = int(math.ceil(radius / q))
        # the area (and its coarse copy) is the same for every template tried at this place and pose: made once a frame
        key = (id(frame), round(gx, 3), round(gy, 3), round(s, 6), round(a, 4), pad)
        if key not in self._areas:
            area = self._patch(frame, gx, gy, s, a, self.w + 2 * pad, self.h + 2 * pad)
            f = min(1.0, SEARCH_PX / max(area.shape))
            f = max(f, min(1.0, 6.0 / min(self.w, self.h)))   # never coarser than about 6 pixels across the template
            a_s = cv2.resize(area, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1.0 else area
            self._areas[key] = (area, f, a_s)
        area, f, a_s = self._areas[key]
        t_s = cv2.resize(tmpl, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1.0 else tmpl
        if a_s.shape[0] < t_s.shape[0] or a_s.shape[1] < t_s.shape[1] or t_s.shape[0] < 3 or t_s.shape[1] < 3:
            x, y, sc = self._match(frame, tmpl, gx, gy, s, a, pad)
            return {"x": x, "y": y, "raw": sc, "pen": sc - self._pen(x, y, pred, sig), "second": -2.0, "sxy": None, "sraw": -1.0,
                    "near": (x, y, sc)}
        res = cv2.matchTemplate(a_s, t_s, cv2.TM_CCOEFF_NORMED)
        res = np.nan_to_num(res, nan=0.0, posinf=0.0, neginf=0.0)
        # each cell's place in the frame and its distance from the prediction
        jj, ii = np.meshgrid(np.arange(res.shape[1], dtype=np.float32), np.arange(res.shape[0], dtype=np.float32))
        du = jj / f - (area.shape[1] - tmpl.shape[1]) / 2.0
        dv = ii / f - (area.shape[0] - tmpl.shape[0]) / 2.0
        r = math.radians(a)
        fx = gx + q * (math.cos(r) * du - math.sin(r) * dv)
        fy = gy + q * (math.sin(r) * du + math.cos(r) * dv)
        d2 = (fx - pred[0]) ** 2 + (fy - pred[1]) ** 2
        weighed = res - np.minimum(self.cap, MOTION_PEN * d2 / (sig * sig))
        i, j = np.unravel_index(int(np.argmax(weighed)), weighed.shape)
        # the second place: the best outside the chosen peak's own hill
        rs = max(1.5, SECOND_R * min(t_s.shape))
        hill = (ii - i) ** 2 + (jj - j) ** 2 <= rs * rs
        other = np.where(hill, -2.0, weighed)
        k2 = int(np.argmax(other))
        second = float(other.flat[k2])
        sxy = (float(fx.flat[k2]), float(fy.flat[k2])) if second > -2.0 else None
        sraw = float(res.flat[k2]) if second > -2.0 else -1.0

        def exact(i, j):
            if f < 1.0:
                return self._match(frame, tmpl, float(fx[i, j]), float(fy[i, j]), s, a, 1.0 / f + 2)
            px, py, sc = self._peak_at(res, i, j)
            x, y = self._to_frame(gx, gy, s, a, px - (area.shape[1] - tmpl.shape[1]) / 2.0, py - (area.shape[0] - tmpl.shape[0]) / 2.0)
            return x, y, sc

        x, y, sc = exact(i, j)
        near = None
        if near_r is not None:
            inside = d2 <= near_r * near_r
            if inside.any():
                cand = np.where(inside, res, -2.0)
                ni, nj = np.unravel_index(int(np.argmax(cand)), cand.shape)
                near = (x, y, sc) if (ni, nj) == (i, j) else exact(ni, nj)
        return {"x": x, "y": y, "raw": sc, "pen": sc - self._pen(x, y, pred, sig), "second": second, "sxy": sxy, "sraw": sraw,
                "near": near}

    @staticmethod
    def _peak_at(res, i, j):
        """Sub-pixel place of the cell (i, j) of a match map (parabola through its neighbours): (x, y, score)."""
        dx = dy = 0.0
        if 0 < j < res.shape[1] - 1:
            a, b, c = res[i, j - 1], res[i, j], res[i, j + 1]
            d = a - 2 * b + c
            if d < 0:
                dx = 0.5 * (a - c) / d
        if 0 < i < res.shape[0] - 1:
            a, b, c = res[i - 1, j], res[i, j], res[i + 1, j]
            d = a - 2 * b + c
            if d < 0:
                dy = 0.5 * (a - c) / d
        return j + max(-0.5, min(0.5, dx)), i + max(-0.5, min(0.5, dy)), float(res[i, j])

    def _pen(self, x, y, pred, sig):
        return min(self.cap, MOTION_PEN * ((x - pred[0]) ** 2 + (y - pred[1]) ** 2) / (sig * sig))

    def _score(self, frame, tmpl, cx, cy, s, a):
        area = self._patch(frame, cx, cy, s, a, self.w, self.h)
        return float(self.cv2.matchTemplate(area, tmpl, self.cv2.TM_CCOEFF_NORMED)[0, 0])

    def _smear(self, part):
        """The motion blur of `part` of the last frame's motion, as a kernel in template pixels (None when under 1.5 px)."""
        q = self.s / self.m
        r = math.radians(-self.a)
        L = math.hypot(self.vsx, self.vsy) * part
        cap = min(1.0, 1.5 * self.size * self.s / L) if L > 0 else 1.0     # never longer than about the object itself
        vx, vy = self.vsx / q * part * cap, self.vsy / q * part * cap
        return _motion_kernel(math.cos(r) * vx - math.sin(r) * vy, math.sin(r) * vx + math.cos(r) * vy)

    def _deblur(self, frame, tmpl, cx, cy, s, a, raw):
        """A blurred frame (motion, focus) matched with the template blurred the same way, or a template boxed on a
        blurred frame matched with the frame blurred: -> (x, y, score) of the best, or None when none is clearly better."""
        q = s / self.m
        r = math.radians(-a)
        vx, vy = self.vx / q, self.vy / q                  # the motion in template pixels, turned into the template's frame
        mx, my = math.cos(r) * vx - math.sin(r) * vy, math.sin(r) * vx + math.cos(r) * vy
        kernels = []
        for part in (0.5, 1.0):
            k = _motion_kernel(mx * part, my * part)
            if k is not None:
                kernels.append(("t", k))
        for sg in (1.0, 2.0, 3.5):
            kernels.append(("t", _gauss_kernel(sg * self.m)))
            kernels.append(("a", _gauss_kernel(sg * self.m)))
        best = None
        for b in kernels:
            got = self._match(frame, tmpl, cx, cy, s, a, 2.0 * self.m + 2, blur=b)
            if best is None or got[2] > best[2]:
                best = got
        return best if best and best[2] > raw + 0.03 else None

    # ------------------------------------------------------------ one frame
    def _prep(self, frame):
        """The picture the templates are matched on: as it is, or (a smooth object) with the slow shading taken out."""
        if self.hp is None:
            return frame
        cv2 = self.cv2
        H, W = frame.shape
        f = frame.astype(np.float32)
        k = max(1, int(self.hp // 4))                      # blurred small and scaled back: the same, far quicker
        small = cv2.resize(f, (max(1, W // k), max(1, H // k)), interpolation=cv2.INTER_AREA) if k > 1 else f
        low = cv2.GaussianBlur(small, (0, 0), self.hp / k)
        if k > 1:
            low = cv2.resize(low, (W, H), interpolation=cv2.INTER_LINEAR)
        return f - low + 128.0

    def step(self, frame: np.ndarray, colour=None) -> dict:
        lost_before = self.lost_for > 0
        flow = None if lost_before else self._flow(frame)
        # the colours are used while they still set the object apart from what is around it now
        planes = _planes(frame, colour) if self.col is not None and self.col["c0"] - self.col["cb"] >= 0.6 * COL_LEAD else None
        raw, frame = frame, self._prep(frame)
        self._areas = {}
        # the longer it is lost, the less the old motion says where it is: a far place costs less and less
        self.cap = PEN_CAP * max(0.2, 1.0 - self.lost_for / 10.0)
        speed = math.hypot(self.vx, self.vy)
        pred = (self.cx + self.vx, self.cy + self.vy)
        # how far the object may be from the prediction: its speed (it can turn), how unsure the motion is, its size
        sig = 1.5 + 0.25 * speed + self.vu + 0.03 * self.size * self.s + self.lost_for * (1.5 + 0.15 * speed)
        base = max(4.0, 0.15 * self.size * self.s)
        poses = [(self.s, self.a)]
        if flow:
            fs = self.s if self.fix_s else min(self.s * 1.15, max(self.s / 1.15, flow[2]))
            fa = self.a if self.fix_a else self.a + max(-15.0, min(15.0, flow[3] - self.a))
            if abs(fs - self.s) > 1e-4 or abs(fa - self.a) > 0.01:
                poses.insert(0, (fs, fa))
        templates = [(n, t) for n, t in (("ref", self.ref), ("alt", self.alt)) if t is not None]
        # the area searched: as far as the object can have gone, as far as the flow's guess, and 1.5 sizes around it (a
        # look-alike that close is seen, so it is known before it can be mistaken for the object)
        reach = max(3.0 * sig, speed + base, 1.5 * self.size * self.s)
        if flow:
            reach = max(reach, math.hypot(flow[0] - pred[0], flow[1] - pred[1]) + base)
        reach = min(reach, max(4.0 * self.size * self.s, 80.0))
        near_r = 2.0 * sig + 1.0
        for o in self.others:                            # where the look-alikes seen lately should be now
            o["px"], o["py"] = o["x"] + o["vx"], o["y"] + o["vy"]
        best = None
        window = None                                     # the colour spots of the wide search's area

        def consider(name, tmpl, got, pose):
            nonlocal best
            if planes is not None:
                # 0.10.77: a place is weighed by how much of the object's colours and spot it holds as well (the grey template
                # alone took an arm for a blurred ball); one with hardly any of its colours is not the object, nor a rival
                ps_, pa_ = pose
                fit = self._colour_fit(planes, got["x"], got["y"], ps_, pa_)
                if fit is None:
                    return
                got = dict(got, pen=got["pen"] - fit)
                if got["sxy"]:
                    sf = self._colour_fit(planes, got["sxy"][0], got["sxy"][1], ps_, pa_)
                    got = dict(got, second=-2.0, sxy=None, sraw=-1.0) if sf is None else dict(got, second=got["second"] - sf)
                nb = got.get("near")
                if nb and self._colour_fit(planes, nb[0], nb[1], ps_, pa_) is None:
                    got = dict(got, near=None)
            if best is None or got["pen"] > best[0]["pen"] + (0.03 if name.startswith("alt") else 0):
                best = (got, name, tmpl, pose)

        if not lost_before:
            for ps, pa in poses:
                for name, tmpl in templates:
                    consider(name, tmpl, self._search(frame, tmpl, pred[0], pred[1], ps, pa, reach, pred, sig, near_r), (ps, pa))
        # not sure, moving fast: the camera smears it along its motion (half the way of a frame at a usual shutter), so the
        # templates are tried smeared the same way
        mk = self._smear(0.5) if not lost_before and best and best[0]["raw"] / self.ceiling < self.sure_t else None
        if mk is not None:
            for name, tmpl in list(templates):
                sm = self.cv2.filter2D(tmpl, -1, mk, borderType=self.cv2.BORDER_REPLICATE)
                templates.append((name + "~", sm))
                for ps, pa in poses:
                    consider(name + "~", sm, self._search(frame, sm, pred[0], pred[1], ps, pa, reach, pred, sig, near_r), (ps, pa))
        # not sure near the prediction (a sudden turn, a jump, a lost object): search wide, coarse to fine; after a loss the
        # kept looks of the object are tried as well
        if best is None or best[0]["raw"] / self.ceiling < self.sure_t:
            # lost: around the last place it was seen, as far as it can have gone since (its speed every frame)
            ox, oy = (self.gx, self.gy) if lost_before else (self.cx, self.cy)
            wide = 1.2 * self.size * self.s + 3 * self.vu + (2 * max(speed, self.vtyp) + base) * (1 + self.lost_for)
            if lost_before:                               # never narrower than the frame before: it can only have gone further
                wide = max(wide, math.hypot(self.cx - ox, self.cy - oy) + reach, self.lost_r)
                self.lost_r = wide
            Hf, Wf = frame.shape                          # no further than the picture's farthest corner
            corner = max(math.hypot(ox - u, oy - v) for u in (0, Wf) for v in (0, Hf))
            wide = min(corner, max(wide, reach))
            more = templates + ([("bank", t) for t in self.bank] if lost_before else [])
            for ps, pa in poses:
                for name, tmpl in more:
                    consider(name, tmpl, self._search(frame, tmpl, ox, oy, ps, pa, wide, pred, sig,
                                                      None if lost_before else near_r), (ps, pa))
            if planes is not None:
                # and every spot with the object's colours in that area, matched close (a fast ball the motion lost)
                peaks, win_second = self._colour_peaks(planes, ox, oy, wide, self.s)
                window = (peaks, win_second)
                for px, py, _v in peaks[:4]:
                    for ps, pa in poses[-1:]:
                        for name, tmpl in templates:
                            consider(name, tmpl, self._search(frame, tmpl, px, py, ps, pa, max(8.0, 0.6 * self.size * ps), pred,
                                                              sig, None), (ps, pa))
        if best is None:                                  # nothing with the object's colours matched at all
            best = ({"x": self.cx, "y": self.cy, "raw": -1.0, "pen": -1.0, "second": -2.0, "sxy": None, "sraw": -1.0,
                     "near": None}, "none", self.ref, (self.s, self.a))
        got, name, tmpl, (s, a) = best
        cx, cy, score = got["x"], got["y"], got["raw"]
        refined = False
        if score >= LOST * self.ceiling * 0.8:
            # scale and angle refined before it is judged (after a loss the object has turned and grown a little)
            cx, cy, s, a, score = self._refine(frame, tmpl, cx, cy, s, a)
            refined = True
        ambiguous = got["second"] > got["pen"] - AMBIG and got["second"] > LOST
        # a place far from the prediction, or where a look-alike is expected, is taken only when sure and unambiguous; else
        # the place the motion allows (when it matches at all, as unsure) or nothing (lost): never a jump on a guess
        d_pred = math.hypot(cx - pred[0], cy - pred[1])
        far = d_pred > 3.0 * sig + 2.0
        near_other = any(math.hypot(cx - o["px"], cy - o["py"]) < max(3.0, 0.5 * self.size * self.s)
                         and (d_pred > 1.5 * sig or (lost_before and d_pred > 0.5 * math.hypot(cx - o["px"], cy - o["py"])))
                         for o in self.others)
        weak = score / self.ceiling < self.sure_t or ambiguous
        if lost_before:
            # picked up again only on the boxed look (or a sure look kept), clearly sure and clearly alone: after a loss
            # the motion no longer tells it apart, so the picture must
            weak = weak or not (name == "ref" or name == "bank") or got["pen"] - got["second"] < ALONE
        fallback = forced = False
        # the object's colours, alone in the area around this place, are evidence of their own (a blurred fast ball)
        col_conf = False
        if planes is not None and name != "none" and score >= LOST * self.ceiling * 0.8:
            # alone among the spots of the whole area searched (after a loss, a jump), or of the motion's reach
            peaks, second_v = window if window is not None and (lost_before or far) else \
                self._colour_peaks(planes, cx, cy, max(reach, 2.0 * self.size * s), s)
            col_conf = bool(peaks) and math.hypot(peaks[0][0] - cx, peaks[0][1] - cy) < 0.5 * self.size * s \
                and second_v < COL_ALONE * peaks[0][2]
        held = False
        # with the colours known, a jump or a pick-up after a loss must land on a spot of the object's colours and size
        spot_bad = planes is not None and name != "none" and (far or lost_before) \
            and self._blob_at(planes, cx, cy, s) < 0.5 * self.col["blob0"]
        if name == "none" or spot_bad:
            forced = True
        elif col_conf and not near_other and ((far or lost_before) and weak) and score >= LOST * self.ceiling:
            held = True                                   # taken, as unsure: the colour says it is the object
        elif near_other or ((far or lost_before) and weak) or (ambiguous and d_pred > sig):
            nb = got.get("near")
            if not lost_before and nb and nb[2] / self.ceiling >= LOST and math.hypot(nb[0] - cx, nb[1] - cy) > 1.0:
                cx, cy, score = nb
                s, a = best[3]
                fallback = True
                refined = False
            else:
                forced = True
        if score >= LOST and not forced and not refined:
            cx, cy, s, a, score = self._refine(frame, tmpl, cx, cy, s, a)
        blurred = smeared = name.endswith("~")            # matched with the template smeared along the motion
        soft = False                                      # matched only once both were blurred (focus): never sure on that
        if not forced and not lost_before and LOST * self.ceiling * 0.8 <= score < self.sure_t * self.ceiling:
            db = self._deblur(frame, tmpl, cx, cy, s, a, score)
            if db and math.hypot(db[0] - cx, db[1] - cy) < 2.0 * max(1.0, s / self.m) + 2:
                cx, cy, score = db
                blurred = soft = True
        conf = max(0.0, min(1.0, score / self.ceiling))
        H, W = frame.shape
        if not (0 <= cx < W and 0 <= cy < H):
            forced = True                                 # its centre is out of the picture: nothing to measure
        col_bad = planes is not None and not forced and not self._colour_ok(planes, cx, cy, s, a)
        if col_bad:
            forced = True                                 # refined or fallen back onto a place without its colours
        if ambiguous and not forced and d_pred > 0.5 * sig + 1.0:
            self.amb_run += 1                             # ambiguous and drifting from where the motion says
        elif not ambiguous:
            self.amb_run = 0
        if self.amb_run > AMB_RUN:
            forced = True                                 # ambiguous too long: the track can no longer tell it apart
        # the points' motion landing on the same place, or a match clearly alone within the motion's reach, is evidence of its
        # own: a blur-only or fallen-back match with either is not weak (an ambiguous one stays weak)
        flow_ok = bool(flow) and flow[4] >= FLOW_AGREE_N and math.hypot(flow[0] - cx, flow[1] - cy) < max(1.5, 0.1 * self.size * self.s)
        reachable = math.hypot(cx - pred[0], cy - pred[1]) <= 2.0 * sig       # within what the motion allows
        alone = got["pen"] - got["second"] >= ALONE                           # clearly better than any other place
        weak = ambiguous or ((soft or smeared or fallback) and not flow_ok and not (reachable and alone))
        if col_conf and not ambiguous:
            weak = False
        if forced:
            self.weak_run = 0
        elif weak:
            self.weak_run += 1
        elif conf >= self.sure_t and not soft:
            self.weak_run = 0
        else:
            self.weak_run = max(0, self.weak_run - 1)                         # one fair frame does not clear a weak run
        if self.weak_run > WEAK_RUN:
            forced = True                                 # only weak evidence for too long: say lost, search on, take a clear match
        state = "lost" if forced or conf < LOST else "sure" if conf >= self.sure_t else "unsure"
        # a smeared template is an easy match: sure only when clearly alone where the motion allows
        if state != "lost" and (ambiguous or fallback or soft or held or (smeared and not (reachable and alone))):
            state = "unsure"
        if state == "sure" and lost_before and planes is not None:
            state = "unsure"                              # found again: sure from the next frame that agrees (0.10.77)
        if state == "sure" and planes is not None:
            # sure only where the box holds nearly all of the object's colours and spot as well: the grey template alone was
            # sure on the player's shorts as the ball crossed in front of them (the user's clip, 0.10.77)
            fit = self._colour_fit(planes, cx, cy, s, a)
            if fit is None or fit > 0.5 * COL_PEN:
                state = "unsure"
        if state == "unsure":
            conf = min(conf, SURE - 0.01)
            # its size and turn follow an unsure frame only slowly (UNSURE_POSE: 1 % and a degree a frame): a blurred or partly
            # hidden object matched smaller or turned walked the box down to 0.72 of the ball within ten frames (the user's
            # clip, 0.10.77); a slow zoom is still followed
            s = self.s * min(1.0 + UNSURE_POSE, max(1.0 / (1.0 + UNSURE_POSE), s / self.s))
            a = self.a + min(100 * UNSURE_POSE, max(-100 * UNSURE_POSE, a - self.a))
        elif state == "lost":
            conf = min(conf, LOST - 0.01)
        # the last frame's decision, for the benchmarks and for reading a bad stretch (not sent to the panel)
        self.why = {"at": (round(float(cx), 1), round(float(cy), 1)), "tmpl": name, "raw": round(float(got["raw"]), 3), "pen": round(float(got["pen"]), 3),
                    "second": round(float(got["second"]), 3), "ambiguous": bool(ambiguous), "far": bool(far),
                    "other": bool(near_other), "fallback": fallback, "blurred": blurred, "sig": round(sig, 1),
                    "reach": round(reach, 1), "colour": (bool(col_conf), bool(col_bad), bool(held), bool(spot_bad)), "flow": None if not flow else (round(float(flow[0] - cx), 1),
                                                                          round(float(flow[1] - cy), 1), int(flow[4]))}
        if state == "lost":
            if self.lost_for == 0:
                self.gx, self.gy = self.cx, self.cy               # the last place measured, for the motion across the gap
                if self.sure_run == 0 and (self.vsx or self.vsy):
                    self.vx, self.vy = self.vsx, self.vsy         # after unsure frames, go on with the last sure motion
            self.lost_for += 1
            self.sure_run = 0
            # where to look next: on along the last motion for a few frames (an object passing behind something comes out
            # where it was heading), then slowing to a stop. Only a search place: a lost frame gets no key.
            keep = 1.0 if self.lost_for <= COAST else 0.8
            self.vx, self.vy = keep * self.vx, keep * self.vy
            cx, cy, s, a = self.cx + self.vx, self.cy + self.vy, self.s, self.a
        else:
            nvx, nvy = cx - self.cx, cy - self.cy
            dv = math.hypot(nvx - self.vx, nvy - self.vy)
            if lost_before:                                       # the motion across a gap: its average
                self.vu = max(self.vu, 0.5 * self.size)
                gap = self.lost_for + 1
                nvx, nvy = (cx - self.gx) / gap, (cy - self.gy) / gap
            elif state == "sure":
                self.vu = max(0.5, 0.6 * self.vu + 0.4 * dv)
                self.vsx, self.vsy = nvx, nvy
                self.vtyp = max(math.hypot(nvx, nvy), 0.98 * self.vtyp)
            elif ambiguous:                                       # an ambiguous frame does not change the motion
                self.vu = max(self.vu, 0.5 * dv)
                nvx, nvy = self.vx, self.vy
            else:                                                 # an unsure frame moves the prediction only half way
                self.vu = max(self.vu, 0.5 * self.vu + 0.5 * dv)
                nvx, nvy = 0.5 * (self.vx + nvx), 0.5 * (self.vy + nvy)
            self.sure_run = (-REACQ if lost_before else self.sure_run + 1) if state == "sure" else 0
            self.lost_for = 0
            self.lost_r = 0.0
            self.vx, self.vy = nvx, nvy
        self.cx, self.cy, self.s, self.a = cx, cy, s, a
        self._others(got, cx, cy, score, state)
        if planes is not None and state == "sure":
            self._colour_learn(planes, cx, cy, s, a)
        # the object changes look (turns away, light): a second template follows it, After Effects' "adapt feature" with a
        # guard. It is taken again every few frames while the match is sure (two sure frames running, near the prediction,
        # like the last look) and the reference fits less than very well, or while unsure when the
        # points moved exactly with the match (two independent measures agree within 1.5 px); never on an ambiguous,
        # blur-matched or fallen-back frame.
        agree = bool(flow) and flow[4] >= 20 and math.hypot(flow[0] - cx, flow[1] - cy) < 1.5
        take = (state == "sure" and conf < 0.95 and self.sure_run >= 2 and d_pred < 2.0 * sig) or (state == "unsure" and agree)
        if take and not ambiguous and not blurred and not fallback and (self.alt is None or self.alt_age >= ADAPT_EVERY):
            new = self._patch(frame, cx, cy, s, a, self.w, self.h)
            # a look changes gradually: the new one must resemble the last (or the boxed one), so it cannot jump to the
            # background
            last = self.alt if self.alt is not None else self.ref
            # and it is the object's look, not a passing blur (motion, focus): taken only about as sharp as the boxed look
            if (float(self.cv2.matchTemplate(new, last, self.cv2.TM_CCOEFF_NORMED)[0, 0]) >= ALT_CHAIN
                    and _sharpness(new) >= ALT_SHARP * self.ref_sharp):
                if self.alt is not None and state == "sure":
                    self._keep(self.alt)
                self.alt, self.alt_age = new, 0
        self.alt_age += 1
        self.prev = raw
        if state == "lost":
            self.pts = np.zeros((0, 2), np.float32)
        elif state == "unsure":
            # points are seeded only where the object surely is, so the flow stays a witness of its own: on an unsure frame
            # they go on with what they followed (none left: no flow until a sure frame)
            self.pts = flow[5].astype(np.float32) if flow else np.zeros((0, 2), np.float32)
        elif flow and flow[4] >= 30 and math.hypot(flow[0] - cx, flow[1] - cy) < 2.0 and self.alt_age % 10:
            self.pts = flow[5].astype(np.float32)                   # the points that moved with the object, in this frame
        else:
            self.pts = self._features(raw)                        # fresh points inside the region where it really is
        if state == "lost":
            # a lost frame reports the last place it was measured, never the search's guess (no key is written for it, and
            # the panel's path must not show a way it never took)
            return {"x": float(self.gx), "y": float(self.gy), "s": float(s), "a": float(a), "c": float(conf), "state": state}
        return {"x": float(cx), "y": float(cy), "s": float(s), "a": float(a), "c": float(conf), "state": state}

    def _others(self, got, cx, cy, score, state):
        """Look-alikes near the object: the second place of the search when it matches nearly as well, followed frame to
        frame (place and motion) so a jump onto one is recognised. Forgotten after 15 frames unseen."""
        for o in self.others:
            o["x"], o["y"], o["seen"] = o["px"], o["py"], o["seen"] + 1
        sxy = got.get("sxy")
        if state != "lost" and sxy and got["sraw"] >= max(0.6 * self.ceiling, 0.75 * score) \
                and math.hypot(sxy[0] - cx, sxy[1] - cy) > 0.5 * self.size * self.s:
            near = [o for o in self.others if math.hypot(o["px"] - sxy[0], o["py"] - sxy[1]) < 0.5 * self.size * self.s + 4.0]
            if near:
                o = min(near, key=lambda o: math.hypot(o["px"] - sxy[0], o["py"] - sxy[1]))
                o["vx"], o["vy"] = sxy[0] - (o["px"] - o["vx"]), sxy[1] - (o["py"] - o["vy"])
                o["x"], o["y"], o["seen"] = sxy[0], sxy[1], 0
            else:
                self.others.append({"x": sxy[0], "y": sxy[1], "vx": self.vx, "vy": self.vy, "seen": 0})
        self.others = [o for o in self.others if o["seen"] <= 15][-6:]

    # ------------------------------------------------------------ colour (0.10.77)
    # The template is matched on grey with its contrast normalised, which makes a plain thing (a ball) look like anything
    # with the same shading: the user's orange basketball was followed onto the player's dark shorts and called sure. Its
    # colours tell them apart. A likelihood per colour bin, the object's colours (inside the ellipse in the box) against
    # its surroundings' (a ring around the box, learnt on as the object moves over new ground), used only when the object
    # stands out by COL_LEAD: a place keeping less than half of the object's lead is never the object (the template's choice is
    # refused), and where the template cannot follow (fast, blurred) the spots with the object's colour are searched too.
    def _ellipse(self, planes, cx, cy, s, a, grow=1.0):
        """The pixels inside the object's ellipse (the box's inscribed one) at a pose: (bins, mask) of the crop, or None."""
        H, W = planes[0].shape
        rx, ry = 0.5 * 0.45 * self.bw * s * grow, 0.5 * 0.45 * self.bh * s * grow     # half size planes
        r = max(rx, ry) + 2
        x0, y0, x1, y1 = int(max(0, cx / 2 - r)), int(max(0, cy / 2 - r)), int(min(W, cx / 2 + r + 1)), int(min(H, cy / 2 + r + 1))
        if x1 - x0 < 1 or y1 - y0 < 1:
            return None
        mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
        self.cv2.ellipse(mask, (int(round((cx / 2 - x0) * 16)), int(round((cy / 2 - y0) * 16))),
                         (max(1, int(round(rx * 16))), max(1, int(round(ry * 16)))), a, 0, 360, 1, -1, self.cv2.LINE_8, 4)
        if not mask.any():
            i, j = int(cy / 2) - y0, int(cx / 2) - x0
            if not (0 <= i < mask.shape[0] and 0 <= j < mask.shape[1]):
                return None
            mask[i, j] = 1
        return _bins(planes, x0, y0, x1, y1), mask

    def _ring(self, planes, cx, cy, s):
        """The surroundings: a ring from 1.4 to 2.6 box sizes around the place (bins, mask), or None."""
        H, W = planes[0].shape
        hw, hh = 0.5 * self.bw * s / 2, 0.5 * self.bh * s / 2
        x0, y0 = int(max(0, cx / 2 - 2.6 * hw)), int(max(0, cy / 2 - 2.6 * hh))
        x1, y1 = int(min(W, cx / 2 + 2.6 * hw + 1)), int(min(H, cy / 2 + 2.6 * hh + 1))
        if x1 - x0 < 2 or y1 - y0 < 2:
            return None
        jj, ii = np.meshgrid(np.arange(x0, x1), np.arange(y0, y1))
        mask = (np.abs(jj - cx / 2) > 1.4 * hw) | (np.abs(ii - cy / 2) > 1.4 * hh)
        return (_bins(planes, x0, y0, x1, y1), mask) if mask.any() else None

    def _colour_model(self, planes):
        if len(planes) < 3:
            return                                        # grey footage: brightness alone changes with the light, not used
        e, g = self._ellipse(planes, self.cx, self.cy, 1.0, 0.0), self._ring(planes, self.cx, self.cy, 1.0)
        if e is None or g is None:
            return
        n = (1 << _YB) * 256
        # the surroundings: the ring around it and the whole picture outside the box alike (a court the colour of the ball,
        # far from the box, is still background the ball will cross)
        H, W = planes[0].shape
        allb = _bins(planes, 0, 0, W, H)
        rest = np.ones((H, W), bool)
        rest[int(max(0, (self.cy - self.bh / 2) / 2)):int((self.cy + self.bh / 2) / 2) + 1,
             int(max(0, (self.cx - self.bw / 2) / 2)):int((self.cx + self.bw / 2) / 2) + 1] = False
        po, pb = _hist(e[0], e[1], n), 0.5 * _hist(g[0], g[1], n) + 0.5 * _hist(allb, rest, n)
        col = {"n": n, "po": po, "pb": pb, "obj": e[0][e[1] > 0]}
        self._colour_table(col)
        col["cb"] = float(col["table"][g[0][g[1]]].mean())
        if col["c0"] - col["cb"] >= COL_LEAD:
            self.col = col
            col["blob0"] = 1.0                            # (for the first measure)
            col["blob0"] = max(0.05, self._blob_at(planes, self.cx, self.cy, 1.0))

    def _colour_table(self, col):
        # a colour never seen around the object is not therefore the object's: it counts as background seen as often as a
        # typical object colour half as often (the user's clip: the court, never in the ring, scored above the ball itself)
        prior = 0.5 * float((col["po"] ** 2).sum())
        col["table"] = (col["po"] / (col["po"] + col["pb"] + prior)).astype(np.float32)
        col["c0"] = float(col["table"][col["obj"]].mean())       # what the object itself scores now

    def _colour_at(self, planes, cx, cy, s, a):
        e = self._ellipse(planes, cx, cy, s, a)
        if e is None:
            return 0.0
        return float(self.col["table"][e[0][e[1] > 0]].mean())

    def _colour_ok(self, planes, x, y, s, a):
        """The place holds the object's colours (or, smeared by motion, is still a spot of them its size)."""
        if self.col is None or planes is None:
            return True
        return self._colour_at(planes, x, y, s, a) >= self._col_floor() or self._blob_at(planes, x, y, s) >= 0.5 * self.col["blob0"]

    def _colour_fit(self, planes, x, y, s, a):
        """What a place lacks of the object's colours and spot, as score to take off (0 for the object as boxed), or None
        when it holds hardly any of its colours."""
        c0, cb = self.col["c0"], self.col["cb"]
        cf = (self._colour_at(planes, x, y, s, a) - cb) / max(1e-6, c0 - cb)
        bf = self._blob_at(planes, x, y, s) / max(1e-6, self.col["blob0"])
        if cf < 0.5 * COL_KEEP and bf < 0.25:
            return None
        return COL_PEN * (max(0.0, 1.0 - cf) + max(0.0, 1.0 - bf))

    def _col_floor(self):
        return self.col["cb"] + COL_KEEP * (self.col["c0"] - self.col["cb"])

    def _blobs(self, planes, ox, oy, radius, s):
        """The object's colours as a spot of its size: a centre-surround map (the mean likelihood over the object's middle
        minus that over about twice its size) around (ox, oy). Skin or a court of the same colour as a ball is no spot of the
        ball's size; the ball is. -> (map, x0, y0) in half-size pixels, or None."""
        cv2 = self.cv2
        H, W = planes[0].shape
        r = radius / 2 + 1.2 * max(self.bw, self.bh) * s / 2 + 2
        x0, y0, x1, y1 = int(max(0, ox / 2 - r)), int(max(0, oy / 2 - r)), int(min(W, ox / 2 + r + 1)), int(min(H, oy / 2 + r + 1))
        if x1 - x0 < 3 or y1 - y0 < 3:
            return None
        lk = self.col["table"][_bins(planes, x0, y0, x1, y1)]
        kin = (max(1, int(round(0.32 * self.bw * s))), max(1, int(round(0.32 * self.bh * s))))      # the middle ~60 %
        kout = (max(3, int(round(1.0 * self.bw * s))), max(3, int(round(1.0 * self.bh * s))))      # twice its size
        cs = cv2.blur(lk, kin, borderType=cv2.BORDER_REFLECT) - cv2.blur(lk, kout, borderType=cv2.BORDER_REFLECT)
        return cs, x0, y0

    def _blob_at(self, planes, cx, cy, s):
        b = self._blobs(planes, cx, cy, 0.0, s)
        if b is None:
            return 0.0
        cs, x0, y0 = b
        i, j = int(round(cy / 2)) - y0, int(round(cx / 2)) - x0
        if not (0 <= i < cs.shape[0] and 0 <= j < cs.shape[1]):
            return 0.0
        return float(cs[max(0, i - 1):i + 2, max(0, j - 1):j + 2].max())

    def _colour_peaks(self, planes, ox, oy, radius, s):
        """Spots of the object's colours and size within `radius` of (ox, oy): [(x, y, value)] best first (frame pixels,
        value the centre-surround), and the best value of any place apart from the first spot."""
        cv2 = self.cv2
        b = self._blobs(planes, ox, oy, radius, s)
        if b is None:
            return [], 0.0
        cs, x0, y0 = b
        side = max(3, int(round(0.5 * max(self.bw, self.bh) * s)) | 1)
        top = cv2.dilate(cs, np.ones((side, side), np.uint8))
        least = 0.5 * self.col["blob0"]
        jj, ii = np.meshgrid(np.arange(cs.shape[1]) * 2.0 + x0 * 2.0 + 1.0, np.arange(cs.shape[0]) * 2.0 + y0 * 2.0 + 1.0)
        inside = np.hypot(jj - ox, ii - oy) <= radius + 2.0
        ys, xs = np.nonzero((cs >= top - 1e-6) & (cs >= least) & inside)
        peaks = sorted(((float(cs[i, j]), float(jj[i, j]), float(ii[i, j])) for i, j in zip(ys, xs)), reverse=True)
        out = []
        for v, x, y in peaks:                                  # one per spot
            if all(math.hypot(x - p[0], y - p[1]) > 0.5 * self.size * s for p in out):
                out.append((x, y, v))
            if len(out) >= 6:
                break
        if not out:
            return [], float(cs[inside].max()) if inside.any() else 0.0
        far = inside & (np.hypot(jj - out[0][0], ii - out[0][1]) > 0.8 * self.size * s)
        return out, float(cs[far].max()) if far.any() else 0.0

    def _colour_learn(self, planes, cx, cy, s, a):
        """A sure frame: the surroundings' colours learnt on, and the object's slowly (light changes on it)."""
        g, e = self._ring(planes, cx, cy, s), self._ellipse(planes, cx, cy, s, a)
        if g is None or e is None:
            return
        col = self.col
        col["pb"] = (1 - COL_LEARN) * col["pb"] + COL_LEARN * _hist(g[0], g[1], col["n"])
        col["po"] = (1 - 0.5 * COL_LEARN) * col["po"] + 0.5 * COL_LEARN * _hist(e[0], e[1], col["n"])
        col["obj"] = np.concatenate([col["obj"][-4000:], e[0][e[1] > 0]])
        self._colour_table(col)
        col["cb"] = float(col["table"][g[0][g[1]]].mean())

    def _refine(self, frame, tmpl, cx, cy, s, a):
        """Scale and angle (the pose that matched best) refined against the template, only those the object shows: best
        of a small grid and the vertex between, a few rounds so a wrong start is pulled back. -> (cx, cy, s, a, score)"""
        score = None
        for _ in range(3):
            s2, a2 = s, a
            if not self.fix_s:
                ds = 0.012 * s
                ss = [s - ds, s, s + ds]
                s2 = float(_parabola(ss, [self._score(frame, tmpl, cx, cy, v, a) for v in ss]))
            if not self.fix_a:
                da = 0.6
                aa = [a - da, a, a + da]
                a2 = float(_parabola(aa, [self._score(frame, tmpl, cx, cy, s2, v) for v in aa]))
            moved = abs(s2 - s) > 0.002 * s or abs(a2 - a) > 0.1
            s, a = s2, a2
            cx, cy, score = self._match(frame, tmpl, cx, cy, s, a, 2.0 * self.m)
            if not moved:
                break
        return float(cx), float(cy), float(s), float(a), float(score)

    def _keep(self, tmpl):
        """Keeps a sure look of the object for finding it again (only one unlike the ones kept; the oldest goes)."""
        cv2 = self.cv2
        for t in [self.ref] + self.bank:
            if float(cv2.matchTemplate(tmpl, t, cv2.TM_CCOEFF_NORMED)[0, 0]) > 0.9:
                return
        self.bank.append(tmpl)
        if len(self.bank) > BANK:
            self.bank.pop(0)


# ---------------------------------------------------------------- the whole track

def track_frames(frames_fwd, frames_back, box, k0: int, total: int, progress=None, cancelled=None, hook=None,
                 lo: int = 0, hi: int | None = None, stopping=None) -> list[dict | None]:
    """frames_fwd: frames k0, k0+1, ... ; frames_back: frames k0, k0-1, ... (both start with the boxed frame). A frame may be
    a (grey, extra) pair: hook(k, extra, result) is then called for it (the panel's pictures, 0.10.55).
    lo / hi: the frames to track (0.10.63, the editor's range); stopping(): finish now, keeping what is done (Stop).
    -> one entry per frame index 0..total-1 (None where no frame came)."""
    out: list[dict | None] = [None] * total
    hi = total - 1 if hi is None else hi
    span = max(1, hi - lo + 1)
    done = 0
    stopped = [False]

    def run(frames, sign):
        nonlocal done
        tr = None
        for i, f in enumerate(frames):
            if cancelled and cancelled():
                raise Cancelled()
            if stopping and stopping():
                stopped[0] = True
                return
            k = k0 + sign * i
            if k < lo or k > hi:
                break
            extra = None
            if isinstance(f, tuple):
                f, extra = f
            if tr is None:
                tr = RegionTracker(f, box, colour=extra)
                out[k] = {"x": tr.cx, "y": tr.cy, "s": 1.0, "a": 0.0, "c": 1.0, "state": "sure"}
            else:
                out[k] = tr.step(f, colour=extra)
            if hook and extra is not None:
                hook(k, extra, out[k])
            done += 1
            if progress and done % 5 == 0:
                progress(done / span)

    run(frames_fwd, 1)
    if k0 > lo and not stopped[0]:
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
          live=None, into: dict | None = None, rng=None, stopping=None) -> dict:
    """Track the region `box` [x, y, w, h] (fractions of the upright picture) boxed at media time t0, over the media range
    [t_from, t_to) in steps of `step` (one timeline frame). -> {frames: [{t, x, y, s, a, c, state}], width, height, k0}
    x, y in file pixels (upright).
    rng: [first, last] frame indexes of that range to track (0.10.63, the editor's range; default all of it); stopping():
    finish now, keeping what is done (the panel's Stop). Every frame of the range [t_from, t_to) comes back: one not tracked
    has state "none" (no key is written for it) and the position of the nearest tracked frame, so the panel can show the
    whole clip and track more of it later ("into")."""
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
    if total > MAX_CLIP_FRAMES:
        raise ValueError(f"The clip is {total} frames long: the tracker works on clips up to {MAX_CLIP_FRAMES} (trim it).")
    lo, hi = 0, total - 1
    if rng is not None:
        lo, hi = max(0, int(rng[0])), min(total - 1, int(rng[1]))
        if hi < lo:
            raise ValueError("The range to track is empty: move its handles apart.")
    if hi - lo + 1 > MAX_FRAMES:
        raise ValueError(f"The range is {hi - lo + 1} frames long: the tracker takes up to {MAX_FRAMES} at a time (make it shorter).")
    k0 = int(round((t0 - t_from) / step))
    if not (0 <= k0 < total):
        raise ValueError("Park the playhead over the clip to track.")
    if not (lo <= k0 <= hi):
        raise ValueError("The boxed frame is outside the range to track: move a handle past it or box another frame.")
    dw, dh = display_size(path)
    bx, by, bw, bh = (float(v) for v in box)
    if not (0 <= bx < 1 and 0 <= by < 1 and 0 < bw <= 1 and 0 < bh <= 1):
        raise ValueError("Draw the box on the picture.")
    ww, wh, k = work_for_box(dw, dh, bw, bh)
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
    fwd = decode(path, t_from + k0 * step, step, hi - k0 + 1, (ww, wh), cancelled, colour=True)
    back = _backwards(path, t_from + lo * step, step, k0 - lo, (ww, wh), cancelled, colour=True) if k0 > lo else iter(())
    raw = track_frames(fwd, back, wbox, k0, total, progress, cancelled, hook, lo=lo, hi=hi, stopping=stopping)
    frames = untracked_filled(raw, t_from, step, k)
    states = [f["state"] for f in frames]
    stopped = bool(stopping and stopping())
    log.info("tracker %s: %d frames tracked (%d sure, %d unsure, %d lost) of %d, range %d-%d%s, box %s at %.3f, work %dx%d, %.1f s",
             os.path.basename(path), total - states.count("none"), states.count("sure"), states.count("unsure"), states.count("lost"),
             total, lo, hi, ", stopped" if stopped else "", [round(v, 3) for v in box], t0, ww, wh, time.time() - t_start)
    return {"frames": frames, "width": dw, "height": dh, "k0": k0, "total": total, "step": step, "t0": t0, "id": store["id"],
            "offset": offset, "box": [round(bx * dw, 2), round(by * dh, 2), round(bw * dw, 2), round(bh * dh, 2)],
            "thumb": list(tsize), "range": [lo, hi], "stopped": stopped}


def untracked_filled(raw: list, t_from: float, step: float, k: float) -> list[dict]:
    """One entry per frame: a tracked one as measured (file pixels), one not tracked as state "none" with the nearest tracked
    frame's position, scale and angle (so a drawing or a sum never meets an empty value; no key is written for it)."""
    idx = [i for i, r in enumerate(raw) if r is not None]
    out = []
    for i, r in enumerate(raw):
        if r is None:
            near = raw[min(idx, key=lambda j: abs(j - i))] if idx else {"x": 0.0, "y": 0.0, "s": 1.0, "a": 0.0}
            out.append({"t": round(t_from + i * step, 6), "x": round(near["x"] / k, 3), "y": round(near["y"] / k, 3),
                        "s": round(near["s"], 5), "a": round(near["a"], 4), "c": 0.0, "state": "none"})
        else:
            out.append({"t": round(t_from + i * step, 6), "x": round(r["x"] / k, 3), "y": round(r["y"] / k, 3),
                        "s": round(r["s"], 5), "a": round(r["a"], 4), "c": round(r["c"], 3), "state": r["state"]})
    return out
