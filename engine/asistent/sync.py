"""Smart Auto Sync: find where each camera starts on the reference camera's clock.

Pipeline per clip pair (reference A, other B):
  1. every audio channel separately (silent and dual-mono channels skipped) plus a mono mix;
  2. band-pass 150-4000 Hz, so rumble and hiss carry no weight;
  3. coarse candidates over the full length from two signals: GCC-PHAT (whitened, level-independent)
     and an onset envelope (robust when the two microphones sound very different);
  4. every candidate is checked in 3-10 separate windows across the overlap, each window searching
     the best channel pair on its own at 16 kHz with sub-sample peak interpolation;
  5. a line is fitted through the window offsets: agreement gives the confidence, the slope the drift.

Offsets follow one convention everywhere: `offset` is the time on A's timeline where B's first frame
sits (negative = B started first). Only High results are applied without asking.
"""
from __future__ import annotations

import os
import re
import threading
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from scipy import fft as sfft
from scipy import signal

from . import cache
from .media import Channel, MediaInfo, load_channels, probe

SR = 16000                 # fine analysis rate (0.0625 ms per sample before interpolation)
COARSE_DECIM = 2           # coarse search at 8 kHz
ENV_HOP = 40               # 5 ms envelope frames at 8 kHz
BAND = (150.0, 4000.0)
PHAT_BETA = 0.8            # partial whitening: sharper peaks than plain correlation, less noise than full PHAT
MAX_CHANNELS = 3           # per clip, loudest first; a mono mix is added on top
MAX_CANDIDATES = 5
CLUSTER_TOL = 0.02         # s, coarse candidates closer than this are the same candidate
# Two cameras a metre or two apart hear each source over different paths (1 ms = 34 cm), so real
# windows scatter by a few ms around the true offset. 5 ms stays under half a frame at 60p.
AGREE_TOL = 0.005          # s, a window agrees when it is within this of the fitted line
MAX_DRIFT = 100e-6         # camera clocks drift tens of ppm; anything steeper is not drift
DRIFT_MIN_SPAN = 60.0      # s, a drift slope is only fitted across windows this far apart
EMPTY_CHANNEL_DB = 40.0    # a channel this far under the loudest one of the clip carries only noise
WIN_Z_MIN = 6.0            # window peak height above the rest of its search range, in std
PEAK_EXCL = 0.005          # s around a peak that belong to it (drift and reverb widen the peak)
MIN_HIGH_WINDOWS = 3
HIGH_FRACTION = 0.7        # of the informative windows
HIGH_COVERAGE = 0.6        # of ALL windows checked: chance lines up 3 of 10 windows, a real sync nearly all
HIGH_RATIO = 1.3           # median peak / second peak of the agreeing windows

# Scattered agreement (2026-11-03, false negatives on Masterhaus fx31030/C0730 and fx31036/C0740: every
# window found a strong peak, but they spread over 11-17 ms, because two POVs metres apart hear each
# speaker over a different path difference). Such a pair is High when nearly ALL windows are strong and
# lie in one band this wide; the offset is the band's median, so it is off by at most half the band
# (under half a frame at 50p). A chance match cannot fill 80 % of the windows with strong peaks in 20 ms
# out of the 200 ms searched. groups.py also checks such a pair against the cameras' clocks.
LOOSE_BAND = 0.020         # s, full width of the band
LOOSE_MIN_WINDOWS = 4
LOOSE_SHARE = 0.8          # of ALL windows checked, and of the informative ones

QUICK_WINDOWS = 4          # quick look: this many windows on the best two candidates before the full check
QUICK_CANDIDATES = 2
FFT_WORKERS = -1           # default: all cores; groups.py runs many pairs side by side with 1 each
_fft = threading.local()   # 0.10.6: per thread, so a many-clip job no longer changes the setting for a job running beside it


def fft_workers() -> int:
    return getattr(_fft, "workers", FFT_WORKERS)


def set_fft_workers(n: int) -> None:
    """For the calling thread only (a pool's initializer)."""
    _fft.workers = n

ProgressFn = Callable[[float, str], None]


class Cancelled(Exception):
    pass


@dataclass
class Clip:
    info: MediaInfo
    channels: list[Channel]            # usable channels at SR, band-passed, plus "mix"
    coarse: list[np.ndarray] = field(default_factory=list)   # same channels at 8 kHz
    env: list[np.ndarray] = field(default_factory=list)      # onset envelope at 200 Hz
    all_channels: list[Channel] = field(default_factory=list)

    @property
    def name(self) -> str:
        return os.path.basename(self.info.path)

    @property
    def length(self) -> float:
        return len(self.channels[0].data) / SR if self.channels else 0.0


# ---------------------------------------------------------------- signal helpers

_SOS = {}


def _band(x: np.ndarray, sr: int) -> np.ndarray:
    key = sr
    if key not in _SOS:
        hi = min(BAND[1], 0.45 * sr)
        _SOS[key] = signal.butter(4, [BAND[0], hi], btype="band", fs=sr, output="sos")
    # same causal filter on both signals: identical group delay, so lags are unbiased
    return signal.sosfilt(_SOS[key], x).astype(np.float32)


def _envelope(x8k: np.ndarray) -> np.ndarray:
    n = len(x8k) // ENV_HOP
    if n < 2:
        return np.zeros(1, np.float32)
    e = np.sqrt(np.mean(x8k[: n * ENV_HOP].astype(np.float64).reshape(n, ENV_HOP) ** 2, axis=1))
    le = np.log(e + 1e-7)
    on = np.maximum(np.diff(le, prepend=le[0]), 0.0)
    on -= on.mean()
    return (on / (np.std(on) + 1e-12)).astype(np.float32)


def _xcorr(a: np.ndarray, b: np.ndarray, beta: float) -> tuple[np.ndarray, int]:
    """r[k] = sum a[n] b[n-k] for k in [-(len(b)-1), len(a)-1]; returns (r, index of k=0)."""
    n = _fft_len(len(a), len(b))
    return _xcorr_spec(_spec(a, n), _spec(b, n), n, len(a), len(b), beta)


# A signal is correlated with every channel of the other clip: its spectrum is computed once per length and
# reused (2026-11-03, speed; the same numbers as before, so every offset is bit-identical).
def _fft_len(la: int, lb: int) -> int:
    return sfft.next_fast_len(la + lb - 1, real=True)


def _spec(x: np.ndarray, n: int) -> np.ndarray:
    return sfft.rfft(x, n, workers=fft_workers())


def _xcorr_spec(A: np.ndarray, B: np.ndarray, n: int, la: int, lb: int, beta: float) -> tuple[np.ndarray, int]:
    """_xcorr from the two spectra (_spec at the same n); la, lb: the signals' lengths."""
    R = A * np.conj(B)
    if beta > 0:
        mag = np.abs(R)
        R = R / (mag ** beta + 1e-9 * (mag.max() + 1e-30))
    r = sfft.irfft(R, n, workers=fft_workers())
    r = np.concatenate([r[n - (lb - 1):], r[: la]]) if lb > 1 else r[: la]
    return r, lb - 1


def _taper(x: np.ndarray, sr: float, ramp: float) -> np.ndarray:
    """Fade both ends: hard cut edges correlate with each other and fake a peak where they line up."""
    n = len(x)
    if n < 4:
        return x
    alpha = min(1.0, 2 * ramp * sr / n)
    return (x * signal.windows.tukey(n, alpha)).astype(np.float32)


def _parabolic(y: np.ndarray, i: int) -> float:
    if 0 < i < len(y) - 1:
        a, b, c = y[i - 1], y[i], y[i + 1]
        den = a - 2 * b + c
        if den != 0:
            return i + 0.5 * (a - c) / den
    return float(i)


def _peak_stats(r: np.ndarray, excl: int) -> tuple[int, float, float]:
    """(index of |peak|, peak/second-peak ratio, z-score of the peak)."""
    m = np.abs(r)
    i = int(np.argmax(m))
    peak = m[i]
    rest = m.copy()
    rest[max(0, i - excl): i + excl + 1] = 0
    second = rest.max() if len(rest) else 0.0
    z = (peak - m.mean()) / (m.std() + 1e-12)
    return i, float(peak / (second + 1e-12)), float(z)


# ---------------------------------------------------------------- loading

def load_clip(path: str) -> Clip:
    info = probe(path)
    if not info.audio:
        return Clip(info, [], all_channels=[])
    chans = cache.channels(info, SR, load_channels)
    usable = [c for c in chans if not c.silent and not c.duplicate_of]
    usable.sort(key=lambda c: c.rms_db, reverse=True)
    if usable:   # an unplugged input next to a live one would only add hiss to the mix
        usable = [c for c in usable if c.rms_db >= usable[0].rms_db - EMPTY_CHANNEL_DB]
    usable = usable[:MAX_CHANNELS]
    prepared: list[Channel] = []
    for c in usable:
        prepared.append(Channel(c.label, c.stream, c.channel, _band(c.data, SR), c.rms_db, c.peak_db))
    if len(prepared) > 1:
        # temporary normalisation: each channel to unit RMS before mixing, so a quiet safety
        # channel or a low lavalier is not buried under the loud one
        mix = sum(c.data / (np.sqrt(np.mean(c.data.astype(np.float64) ** 2)) + 1e-12) for c in prepared)
        prepared.append(Channel("mix", -1, -1, np.asarray(mix, np.float32), 0.0, 0.0))
    clip = Clip(info, prepared, all_channels=chans)
    for c in prepared:
        x8 = signal.resample_poly(c.data, 1, COARSE_DECIM).astype(np.float32)
        clip.coarse.append(_taper(x8, SR / COARSE_DECIM, 1.0))
        clip.env.append(_taper(_envelope(x8), SR / COARSE_DECIM / ENV_HOP, 1.0))
    return clip


# ---------------------------------------------------------------- coarse candidates

@dataclass
class Candidate:
    offset: float
    score: float
    methods: set = field(default_factory=set)


def _min_overlap(a: Clip, b: Clip) -> float:
    return min(10.0, 0.6 * min(a.length, b.length))


def _coarse(a: Clip, b: Clip, check: Callable[[], None]) -> list[Candidate]:
    cands: list[Candidate] = []
    min_ov = _min_overlap(a, b)
    csr = SR / COARSE_DECIM
    esr = csr / ENV_HOP

    def add(offset: float, score: float, method: str):
        for c in cands:
            if abs(c.offset - offset) < CLUSTER_TOL:
                c.score += score
                c.methods.add(method)
                return
        cands.append(Candidate(offset, score, {method}))

    def scan(r: np.ndarray, zero: int, rate: float, method: str, la: float, lb: float):
        lags = (np.arange(len(r)) - zero) / rate
        ov = np.minimum(la, lags + lb) - np.maximum(0.0, lags)
        r = np.where(ov >= min_ov, r, 0.0)
        excl = max(1, int(0.05 * rate))
        work = np.abs(r)
        for rank in range(3):
            i, ratio, z = _peak_stats(work, excl)
            if work[i] <= 0:
                break
            if rank == 0 or ratio > 1.05:
                add(float(lags[i]), max(0.0, ratio - 1.0) * (1.0 if rank == 0 else 0.5), method)
            work[max(0, i - excl): i + excl + 1] = 0

    la, lb = a.length, b.length
    # all channels of a clip have one length, so one FFT size serves every channel pair
    nc = _fft_len(len(a.coarse[0]), len(b.coarse[0]))
    ne = _fft_len(len(a.env[0]), len(b.env[0]))
    spec_a = [(_spec(x, nc), _spec(e, ne)) for x, e in zip(a.coarse, a.env)]
    spec_b = [(_spec(x, nc), _spec(e, ne)) for x, e in zip(b.coarse, b.env)]
    for ia, ca in enumerate(a.channels):
        for ib, cb in enumerate(b.channels):
            check()
            r, zero = _xcorr_spec(spec_a[ia][0], spec_b[ib][0], nc, len(a.coarse[ia]), len(b.coarse[ib]), PHAT_BETA)
            scan(r, zero, csr, f"GCC-PHAT {ca.label}×{cb.label}", la, lb)
            r, zero = _xcorr_spec(spec_a[ia][1], spec_b[ib][1], ne, len(a.env[ia]), len(b.env[ib]), 0.0)
            scan(r, zero, esr, f"envelope {ca.label}×{cb.label}", la, lb)
    cands.sort(key=lambda c: c.score, reverse=True)
    return cands[:MAX_CANDIDATES]


# ---------------------------------------------------------------- window validation

@dataclass
class Window:
    t: float          # window centre on A's clock
    offset: float
    ratio: float
    z: float
    pair: str


@dataclass
class Validation:
    offset: float
    windows: list[Window]
    total: int
    inliers: list[Window]
    slope: float
    resid_ms: float
    overlap: tuple[float, float]

    @property
    def informative(self) -> list[Window]:
        return [w for w in self.windows if w.z >= WIN_Z_MIN]


def _window_offset(a: Clip, b: Clip, d0: float, t0: float, w: float, search: float) -> Window | None:
    best: Window | None = None
    ia0, ia1 = int(t0 * SR), int((t0 + w) * SR)
    tb0 = max(0.0, t0 - d0 - search)
    tb1 = min(b.length, t0 - d0 + w + search)
    ib0, ib1 = int(tb0 * SR), int(tb1 * SR)
    if ia1 - ia0 < SR or ib1 - ib0 < 0.5 * (ia1 - ia0):
        return None
    tb0 = ib0 / SR
    ramp = min(0.25, 0.1 * w)
    la, lb = ia1 - ia0, ib1 - ib0
    n = _fft_len(la, lb)

    def spectra(chans, i0, i1):            # silent stretches are skipped, as before
        out = []
        for c in chans:
            x = c.data[i0:i1]
            out.append((c, _spec(_taper(x, SR, ramp), n) if np.any(x) else None))
        return out

    sb_all = spectra(b.channels, ib0, ib1)
    for ca, SA in spectra(a.channels, ia0, ia1):
        if SA is None:
            continue
        for cb, SB in sb_all:
            if SB is None:
                continue
            r, zero = _xcorr_spec(SA, SB, n, la, lb, PHAT_BETA)
            # d = t0 - tb0 + k/SR, keep k so that d stays within d0 +/- search
            k0 = int(np.floor((d0 - search - t0 + tb0) * SR))
            k1 = int(np.ceil((d0 + search - t0 + tb0) * SR))
            lo, hi = max(k0 + zero, 0), min(k1 + zero + 1, len(r))
            if hi - lo < 8:
                continue
            seg = r[lo:hi]
            i, ratio, z = _peak_stats(seg, int(PEAK_EXCL * SR))
            if i < 0.002 * SR or i > len(seg) - 1 - 0.002 * SR:
                continue              # a peak on the edge of the search range is not a match
            k = _parabolic(np.abs(seg), i) + lo - zero
            d = t0 - tb0 + k / SR
            cand = Window(t0 + w / 2, d, ratio, z, f"{ca.label}×{cb.label}")
            if best is None or (cand.ratio, cand.z) > (best.ratio, best.z):
                best = cand
    return best


def _fit(windows: list[Window]) -> tuple[list[Window], float, float]:
    """Robust line through window offsets: (inliers, intercept-at-t=0, slope).

    Short recordings get a flat line only: over a minute, real drift stays under a millisecond, and a
    free slope would let unrelated windows line up by chance.
    """
    if not windows:
        return [], 0.0, 0.0
    t = np.array([w.t for w in windows])
    o = np.array([w.offset for w in windows])
    models = [(float(np.median(o)), 0.0)] + [(float(x), 0.0) for x in o]
    for i in range(len(windows)):
        for j in range(i + 1, len(windows)):
            if t[j] - t[i] >= DRIFT_MIN_SPAN:
                s = (o[j] - o[i]) / (t[j] - t[i])
                if abs(s) <= MAX_DRIFT:
                    models.append((o[i] - s * t[i], s))
    best = None
    for c, s in models:
        mask = np.abs(o - (c + s * t)) <= AGREE_TOL
        key = (int(mask.sum()), -abs(s))
        if best is None or key > best[0]:
            best = (key, mask)
    mask = best[1]
    ti, oi = t[mask], o[mask]
    if mask.sum() >= 3 and np.ptp(ti) >= DRIFT_MIN_SPAN:
        s, c = np.polyfit(ti, oi, 1)
        if abs(s) > MAX_DRIFT:
            s, c = 0.0, float(np.median(oi))
    else:
        s, c = 0.0, float(np.median(oi))
    mask = np.abs(o - (c + s * t)) <= AGREE_TOL
    return [w for w, m in zip(windows, mask) if m], float(c), float(s)


def _band_cluster(windows: list[Window]) -> list[Window]:
    """The largest set of informative windows whose offsets fit in LOOSE_BAND (ties: the narrowest)."""
    good = sorted((w for w in windows if w.z >= WIN_Z_MIN), key=lambda w: w.offset)
    best: list[Window] = []
    j = 0
    for i in range(len(good)):
        j = max(j, i)
        while j + 1 < len(good) and good[j + 1].offset - good[i].offset <= LOOSE_BAND:
            j += 1
        cur = good[i:j + 1]
        if len(cur) > len(best) or (len(cur) == len(best) and cur and
                                    cur[-1].offset - cur[0].offset < best[-1].offset - best[0].offset):
            best = cur
    return best


def _drifting(windows: list[Window]) -> bool:
    """Is the spread of these windows a clock drift (a straight line in time) rather than acoustic scatter
    (speakers at different places, no order in time)? Only measurable across DRIFT_MIN_SPAN."""
    t = np.array([w.t for w in windows])
    o = np.array([w.offset for w in windows])
    if len(t) < 3 or np.ptp(t) < DRIFT_MIN_SPAN or np.std(o) < 1e-6:
        return False
    return float(np.corrcoef(t, o)[0, 1]) ** 2 >= 0.7


def _validate(a: Clip, b: Clip, d0: float, check: Callable[[], None], max_windows: int | None = None,
              memo: dict | None = None) -> Validation:
    os_, oe = max(0.0, d0), min(a.length, d0 + b.length)
    ov = oe - os_
    if ov <= 1.0:
        return Validation(d0, [], 0, [], 0.0, 0.0, (os_, oe))
    # windows never overlap: overlapping ones share sound, and a chance match would count twice
    w = float(np.clip(ov / 8, 2.5, 20.0)) if ov >= 3.5 else ov * 0.8
    n = int(np.clip(ov // w, 1, 10))
    search = 0.1 + MAX_DRIFT * ov
    starts = np.linspace(os_, oe - w, n) if n > 1 else np.array([os_ + (ov - w) / 2])
    if max_windows and n > max_windows:
        starts = starts[np.round(np.linspace(0, n - 1, max_windows)).astype(int)]
        n = max_windows
    wins = []
    for t0 in starts:
        check()
        key = (d0, float(t0), w, search)
        if memo is not None and key in memo:
            win = memo[key]
        else:
            win = _window_offset(a, b, d0, float(t0), w, search)
            if memo is not None:
                memo[key] = win
        if win:
            wins.append(win)
    good = [x for x in wins if x.z >= WIN_Z_MIN]
    inl, c, s = _fit(good)
    mid = (os_ + oe) / 2
    offset = c + s * mid if inl else d0
    resid = float(np.sqrt(np.mean([(x.offset - (c + s * x.t)) ** 2 for x in inl]))) * 1000 if inl else 0.0
    return Validation(offset, wins, n, inl, s if len(inl) >= 3 else 0.0, resid, (os_, oe))


# ---------------------------------------------------------------- timecode (approximate only)

_TC = re.compile(r"^(\d{1,2})[:;.](\d{2})[:;.](\d{2})[:;.](\d{2,3})$")


def _tc_seconds(tc: str | None, fps: float | None) -> float | None:
    if not tc or not fps:
        return None
    m = _TC.match(tc.strip())
    if not m:
        return None
    h, mi, s, f = (int(x) for x in m.groups())
    return h * 3600 + mi * 60 + s + f / round(fps)


# ---------------------------------------------------------------- pair analysis

def analyze_pair(a: Clip, b: Clip, check: Callable[[], None] = lambda: None, quick: bool = False) -> dict:
    """quick: first look at the two best candidates in a few windows and stop early when none of them
    holds (most pairs in a whole-day selection are takes that were never recorded together)."""
    res: dict = {"path": b.info.path, "name": b.name, "reasons": [], "warnings": []}
    fps = a.info.fps or b.info.fps or 30.0
    half_frame = 0.5 / fps
    tc_a = _tc_seconds(a.info.timecode, a.info.fps)
    tc_b = _tc_seconds(b.info.timecode, b.info.fps)
    tc_offset = (tc_b - tc_a) if tc_a is not None and tc_b is not None else None
    # record-run timecode (Sony default) only counts while recording, so across cameras it is often
    # hours apart; a value that cannot put the clips side by side is not a shared clock: ignore it
    if tc_offset is not None and not (-b.info.duration - 5 < tc_offset < a.info.duration + 5):
        tc_offset = None
    res["timecode_offset"] = tc_offset

    if not a.channels or not b.channels:
        who = a.name if not a.channels else b.name
        res.update(confidence="low", offset=None)
        res["reasons"].append(f"{who}: no usable sound (missing or completely silent).")
        if tc_offset is not None:
            res["approx_offset"] = tc_offset
            res["reasons"].append("There is timecode, but it is only a guide: check by hand.")
        return res

    cands = _coarse(a, b, check)
    memo: dict = {}                         # windows of the quick look are not measured twice
    # a candidate survives the quick look when two windows agree, tightly or within the scatter band
    if quick and all(max(len(v.inliers), len(_band_cluster(v.windows))) < 2
                     for v in (_validate(a, b, c.offset, check, QUICK_WINDOWS, memo) for c in cands[:QUICK_CANDIDATES])):
        res.update(confidence="low", offset=None, quick_reject=True)
        res["reasons"].append("Found no shared sound that is confirmed in several stretches.")
        return res
    vals = [(_validate(a, b, c.offset, check, memo=memo), c) for c in cands]
    vals.sort(key=lambda vc: (len(vc[0].inliers), np.mean([w.ratio for w in vc[0].inliers]) if vc[0].inliers else 0),
              reverse=True)
    best, cand = vals[0]
    runner = next((v for v, c in vals[1:] if abs(v.offset - best.offset) > CLUSTER_TOL), None)

    info_w = best.informative
    n_in = len(best.inliers)
    frac = n_in / len(info_w) if info_w else 0.0
    ov = best.overlap[1] - best.overlap[0]
    drift_total = abs(best.slope) * ov
    lead_fix = a.info.audio_lead - b.info.audio_lead
    offset = best.offset + lead_fix

    pairs = {}
    for w in best.inliers:
        pairs[w.pair] = pairs.get(w.pair, 0) + 1
    res.update(
        offset=round(offset, 6),
        offset_audio=round(best.offset, 6),
        stream_lead_fix=round(lead_fix, 6),
        overlap=[round(best.overlap[0], 3), round(best.overlap[1], 3)],
        windows_total=best.total,
        windows_informative=len(info_w),
        windows_agree=n_in,
        residual_ms=round(best.resid_ms, 3),
        drift_ppm=round(best.slope * 1e6, 1),
        drift_ms=round(drift_total * 1000, 2),
        channels=max(pairs, key=pairs.get) if pairs else None,
        method=sorted(cand.methods)[0] if cand.methods else None,
        peak_ratio=round(float(np.median([w.ratio for w in best.inliers])), 2) if best.inliers else 0.0,
    )

    ambiguous = runner is not None and len(runner.inliers) >= MIN_HIGH_WINDOWS and \
        len(runner.inliers) >= 0.6 * n_in
    min_ov = _min_overlap(a, b)

    coverage = n_in / max(best.total, 1)
    strong = res["peak_ratio"] >= HIGH_RATIO
    if n_in >= MIN_HIGH_WINDOWS and frac >= HIGH_FRACTION and coverage >= HIGH_COVERAGE and strong \
            and not ambiguous and ov >= min_ov and drift_total <= half_frame:
        conf = "high"
        res["reasons"].append(f"{n_in} of {len(info_w)} independent stretches give the same offset "
                              f"(difference under {AGREE_TOL * 1000:.0f} ms).")
    elif n_in >= MIN_HIGH_WINDOWS and frac >= 0.5 and coverage >= 0.4:
        conf = "medium"
        if drift_total > half_frame:
            res["reasons"].append(f"The sound drifts {drift_total * 1000:.0f} ms over the length of the recording "
                                  f"(drift {best.slope * 1e6:.0f} ppm): the sync is right only at the start.")
        if ambiguous:
            res["reasons"].append("There is a second possible offset (repeating sound): check by ear.")
        if n_in < MIN_HIGH_WINDOWS or frac < HIGH_FRACTION or coverage < HIGH_COVERAGE:
            res["reasons"].append(f"Only {n_in} of {best.total} stretches confirm the offset.")
        if not strong:
            res["reasons"].append("The match is weak (the shared sound is quiet or very different).")
        if ov < min_ov:
            res["reasons"].append(f"The shared part is short ({ov:.1f} s).")
    else:
        conf = "low"
        res["reasons"].append("Found no shared sound that is confirmed in several stretches.")
        if tc_offset is not None:
            res["approx_offset"] = tc_offset
            res["reasons"].append("There is timecode, but it is only a guide: check by hand.")
    if conf != "high" and drift_total <= half_frame:
        band = _band_cluster(best.windows)
        nb = len(band)
        if nb >= LOOSE_MIN_WINDOWS and nb >= LOOSE_SHARE * best.total and nb >= LOOSE_SHARE * len(info_w) \
                and float(np.median([w.ratio for w in band])) >= HIGH_RATIO and not ambiguous and ov >= min_ov \
                and not _drifting(band):
            spread = band[-1].offset - band[0].offset
            mid_off = float(np.median([w.offset for w in band]))
            conf = "high"
            res.pop("approx_offset", None)
            res.update(offset=round(mid_off + lead_fix, 6), offset_audio=round(mid_off, 6), windows_agree=nb,
                       residual_ms=round(float(np.std([w.offset for w in band])) * 1000, 3), drift_ppm=0.0, drift_ms=0.0,
                       peak_ratio=round(float(np.median([w.ratio for w in band])), 2), loose=True,
                       spread_ms=round(spread * 1000, 1))
            res["reasons"] = [f"{nb} of {best.total} stretches give the same offset within "
                              f"{spread * 1000:.0f} ms (the speakers are at different distances from the two cameras)."]
            res["warnings"].append(f"The stretches differ by up to {spread * 1000:.0f} ms: the sync is "
                                   f"right to ±{spread * 500:.0f} ms.")
    res["confidence"] = conf
    res["ambiguous"] = bool(ambiguous)
    if ambiguous:
        # the other possible offset, so the camera clocks can tell which of the two it is (groups._clock_check, 0.10.45)
        res["runner_offset"] = round(runner.offset + lead_fix, 6)
    res["drifting"] = bool(drift_total > half_frame)

    if drift_total > 0.001 and conf == "high":
        res["warnings"].append(f"Small drift: {drift_total * 1000:.1f} ms over the whole recording.")
    if tc_offset is not None and conf != "low":
        if abs(tc_offset - offset) < 1.0:
            res["reasons"].append("The timecode confirms the offset.")
        else:
            res["warnings"].append("The timecode does not agree with the sound; using the sound (the timecode is probably not shared).")
    for clip in (a, b):
        if clip.info.vfr:
            res["warnings"].append(f"{clip.name} has a variable frame rate (VFR): Premiere may drift "
                                   f"later in the clip.")
    if abs(lead_fix) > 0.0005:
        res["warnings"].append(f"Sound and picture in the container do not start together "
                               f"(correction {lead_fix * 1000:+.1f} ms).")
    return res


# ---------------------------------------------------------------- multi-clip entry point

def sync_clips(paths: list[str], reference: int | None = None,
               progress: ProgressFn | None = None, cancel: Callable[[], bool] | None = None) -> dict:
    if len(paths) < 2:
        raise ValueError("Choose at least two clips.")
    progress = progress or (lambda f, m: None)

    def check():
        if cancel and cancel():
            raise Cancelled()

    clips: list[Clip] = []
    for i, p in enumerate(paths):
        check()
        progress(0.05 + 0.4 * i / len(paths), f"Reading the sound: {os.path.basename(p)}")
        clips.append(load_clip(p))

    if reference is None:
        reference = max(range(len(clips)), key=lambda i: clips[i].length)
    ref = clips[reference]
    out: list[dict | None] = [None] * len(clips)
    out[reference] = {"path": ref.info.path, "name": ref.name, "offset": 0.0, "confidence": "reference",
                      "reasons": [], "warnings": []}
    others = [i for i in range(len(clips)) if i != reference]
    for n, i in enumerate(others):
        progress(0.45 + 0.5 * n / len(others), f"Finding the offset: {clips[i].name}")
        out[i] = analyze_pair(ref, clips[i], check)

    # chain through an already synced camera when the direct match failed
    for i in others:
        if out[i]["confidence"] != "low":
            continue
        for j in others:
            if j == i or out[j]["confidence"] != "high":
                continue
            check()
            via = analyze_pair(clips[j], clips[i], check)
            if via["confidence"] == "high":
                via["offset"] = round(out[j]["offset"] + via["offset"], 6)
                via["confidence"] = "medium"
                via["reasons"].insert(0, f"Synced through {clips[j].name} (no direct shared sound "
                                         f"with {ref.name}).")
                out[i] = via
                break

    applied = [r for r in out if r and r.get("offset") is not None]
    first = min(r["offset"] for r in applied)
    for r in out:
        r["start"] = round(r["offset"] - first, 6) if r.get("offset") is not None else None
        r["fps"] = None
    for r, c in zip(out, clips):
        r["fps"] = c.info.fps
        r["duration"] = c.info.duration
        r["channels_found"] = [{"label": ch.label, "rms_db": round(ch.rms_db, 1), "silent": ch.silent,
                                "duplicate_of": ch.duplicate_of} for ch in c.all_channels]
    worst = "high"
    for r in out:
        if r["confidence"] == "low":
            worst = "low"
        elif r["confidence"] == "medium" and worst == "high":
            worst = "medium"
    progress(1.0, "Done")
    return {"reference": reference, "confidence": worst, "clips": out}


if __name__ == "__main__":
    import json
    import sys
    print(json.dumps(sync_clips(sys.argv[1:], progress=lambda f, m: print(f"{f:4.0%} {m}", file=sys.stderr)),
                     ensure_ascii=False, indent=1))
