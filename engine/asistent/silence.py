"""Remove silences (0.10.65, the user 2026-11-12: "change the rough cut to remove silences and focus on only removing silences
and dead spaces in selected videos ... accurate and also fast ... keep in mind the multiple POVs").

No speech recognition: where speech is comes from the sound itself, every selected sound clip on its own.

1. Level: each clip's sound in dB per 10 ms (the louder channel, or the one channel its L/L or R/R copy plays). Auto: the
   clip's own noise floor (10th percentile) and voice level (median of what is clearly above the floor) set its threshold,
   as tools/autoedit's cut check does (speech from 9.5 dB over the floor, or 12.8 dB under the voice, whichever is higher),
   with hysteresis: speech starts over the threshold and ends 4 dB under it, so a word's tail is not chopped where it
   dips. A fixed threshold (the editor's dB) is used as it is: under it is silence, nothing else decides.
2. Silero (the VAD faster-whisper ships, already installed), in Auto: a short loud burst it does not hear at all (a bump,
   a click, a door) is not speech, and quiet speech it is sure of (a whisper under the threshold) is. It never takes away a
   loud stretch of speech length: it misses short loud words (measured). Without Silero, the level alone.
3. Every clip's speech counts (multiple POVs): two cameras and a lavalier are one speaker heard three times, two lavaliers
   are two people; either way a moment is kept when anyone is heard. The same cuts go through every selected clip, so the
   cameras stay in sync.
4. A gap in the speech shorter than the minimum silence stays (the rhythm of a sentence); around speech a margin is kept
   (a breath before a word, the decay after it), never reaching over the edge of a clip. Time no selected sound clip
   covers is silence (a camera rolling before anyone speaks, empty timeline between recordings).
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from . import audio, vad
from .speechmap import runs
from .sync import Cancelled

log = logging.getLogger("asistent")
SR = 16000
HOP = 160                      # 10 ms
HOP_S = HOP / SR
# (minimum silence that is cut, margin kept before speech, margin kept after it) in seconds
TEMPO = {"calm": (0.80, 0.20, 0.30), "normal": (0.50, 0.15, 0.22), "tight": (0.30, 0.15, 0.20)}
TEMPO_LABEL = {"calm": "calm", "normal": "normal", "tight": "tight"}
OVER_FLOOR_DB = 9.5            # Auto: speech starts this far over the clip's noise floor ...
UNDER_VOICE_DB = 12.8          # ... or this far under its voice level, whichever is higher (cutcheck.py's 3x and 0.23x)
HYSTERESIS_DB = 6.0            # speech that has started ends this far under the threshold
TAIL_OVER_FLOOR_DB = 3.0       # Auto: a tail / onset Silero hears goes on while the sound is this far over the noise ...
TAIL_S = 0.5                   # ... for up to this long
VAD_NEAR = 0.30                # Auto: a loud stretch is speech where Silero is at least this within VAD_REACH
VAD_REACH = 0.25               # seconds around a frame Silero is looked at (its 32 ms windows lag the level)
VAD_SURE = 0.80                # Silero this sure is speech even under the threshold ...
QUIET_OVER_FLOOR_DB = 6.0      # ... when it is at least this far over the noise floor (not a whisper in the hum) ...
SURE_MIN_DB = -60.0            # ... or over this when the floor itself is loud (music, an air conditioner)
BUMP_S = 0.15                  # Auto: a loud stretch shorter than this that Silero does not hear at all is a bump, not speech (0.30 cut a quick „Така.“ at -34 dB)
SILENT_DB = -90.0              # a frame of digital silence


def clamp_threshold(db) -> float | None:
    """The editor's fixed threshold in dBFS (-80 .. -10), or None for Auto."""
    if db is None or db == "" or db == "auto":
        return None
    v = float(db)
    if not -80.0 <= v <= -10.0:
        raise ValueError("The silence threshold must be between -80 and -10 dB.")
    return v


def level_db(x: np.ndarray, side: str | None = None) -> tuple[np.ndarray, np.ndarray]:
    """(channels, samples) at 16 kHz -> (dB per 10 ms, the channel to give Silero). The louder channel per frame: an empty
    right channel (a camera's second input) or a lavalier on one side does not halve the level."""
    if x.ndim == 1:
        x = x[None, :]
    if side in ("L", "R") and x.shape[0] > 1:
        x = x[:1] if side == "L" else x[1:2]
    n = x.shape[1] // HOP
    if n == 0:
        return np.zeros(0), np.zeros(0, dtype=np.float32)
    frames = x[:, :n * HOP].reshape(x.shape[0], n, HOP).astype(np.float64)
    rms = np.sqrt(np.mean(frames * frames, axis=2))                     # (channels, n)
    db = 20 * np.log10(np.maximum(rms.max(axis=0), 1e-6))
    main = x[int(np.argmax(np.sqrt(np.mean(x.astype(np.float64) ** 2, axis=1))))] if x.shape[0] > 1 else x[0]
    return db, np.asarray(main, dtype=np.float32)


def auto_threshold(db: np.ndarray) -> dict:
    """The clip's noise floor, voice level and speech threshold (dB) from its own level."""
    live = db[db > SILENT_DB]
    if len(live) < 10:
        return {"floor": SILENT_DB, "voice": SILENT_DB, "open": -60.0}
    floor = float(np.percentile(live, 10))
    loud = live[live > floor + 12.0]                                   # 4x the floor's level
    voice = float(np.median(loud)) if len(loud) else floor + 12.0
    return {"floor": floor, "voice": voice, "open": max(floor + OVER_FLOOR_DB, voice - UNDER_VOICE_DB)}


def hysteresis(db: np.ndarray, open_db: float, close_db: float) -> np.ndarray:
    """Runs over close_db that reach open_db somewhere are speech."""
    out = np.zeros(len(db), dtype=bool)
    over_open = db >= open_db
    for a, b in runs(db >= close_db):
        if over_open[a:b].any():
            out[a:b] = True
    return out


def _near(mask: np.ndarray, frames: int) -> np.ndarray:
    """True within `frames` of any True (a dilation)."""
    if frames <= 0 or not mask.any():
        return mask.copy()
    c = np.convolve(mask.astype(np.int32), np.ones(2 * frames + 1, dtype=np.int32), mode="same")
    return c > 0


def item_speech(db: np.ndarray, probs: np.ndarray | None, threshold: float | None) -> tuple[np.ndarray, dict]:
    """One clip's speech per 10 ms -> (mask, its levels)."""
    if threshold is not None:                                          # the editor's dB: the level alone decides
        thr = {"floor": None, "voice": None, "open": threshold}
        return hysteresis(db, threshold, threshold - HYSTERESIS_DB), thr
    thr = auto_threshold(db)
    loud = hysteresis(db, thr["open"], thr["open"] - HYSTERESIS_DB)
    if probs is None:
        return loud, thr
    p = vad.per_frame(probs, len(db))
    heard = _near(p >= VAD_NEAR, int(round(VAD_REACH / HOP_S)))
    speech = loud.copy()
    # Silero misses short loud words (measured 2026-11-12 on NEW TEST: „Има“ at -20 dB, „Какво“ at -28 dB, Silero 0.03-0.6), so it
    # never takes away a loud stretch of speech length; it only takes away a short burst it does not hear at all (a bump, a
    # click, a door), and adds quiet speech it is sure of
    for a, b in runs(loud):
        if (b - a) * HOP_S < BUMP_S and not heard[a:b].any():
            speech[a:b] = False
    # Silero sure of speech: speech over the noise floor, or over SURE_MIN_DB where the "floor" is music or hum (a finished
    # ReShape export: floor -31 dB = its music, the voice's softer syllables under the threshold, Silero 0.9-1.0)
    speech |= (p >= VAD_SURE) & (db >= min(thr["floor"] + QUIET_OVER_FLOOR_DB, SURE_MIN_DB))
    # a word's fading tail and soft onset: while Silero still hears speech and the sound is over the noise, the speech goes
    # on (measured on a quiet lavalier, voice 21 dB over its noise: the end of „взимаме.“ fell under the threshold 0.15 s
    # before the aligned word ended, Silero 0.3-0.4 there)
    tail = (p >= VAD_NEAR) & (db >= thr["floor"] + TAIL_OVER_FLOOR_DB)
    reach = int(round(TAIL_S / HOP_S))
    for a, b in runs(speech.copy()):
        k = b
        while k < len(speech) and k - b < reach and tail[k]:
            k += 1
        speech[b:k] = True
        k = a
        while k > 0 and a - k < reach and tail[k - 1]:
            k -= 1
        speech[k:a] = True
    return speech, thr


def read_item(it: dict, threshold: float | None, cancelled=None) -> dict:
    """One selected sound clip: its speech per 10 ms of its own time."""
    if cancelled and cancelled():
        raise Cancelled()
    x = audio.read_range(it["path"], float(it["start"]), float(it["end"]), sr=SR, cancelled=cancelled)
    db, main = level_db(x, it.get("side"))
    probs = vad.probabilities(main) if threshold is None and len(main) else None
    speech, thr = item_speech(db, probs, threshold)
    return {"speech": speech, "thr": thr, "vad": probs is not None, "n": len(db)}


def detect(items: list[dict], t_start: float, t_end: float, threshold: float | None = None, progress=None, cancelled=None,
           workers: int = 4) -> dict:
    """items: the selected sound clips [{path, start, end (media s), at (sequence s), side?}]; [t_start, t_end): the selection.
    -> {"speech": bool per 10 ms of the selection, "covered": the same where some sound clip is, "items": [...]}"""
    n = max(0, int(np.ceil((t_end - t_start) / HOP_S - 1e-9)))
    speech = np.zeros(n, dtype=bool)
    covered = np.zeros(n, dtype=bool)
    info = []
    done = [0]

    def one(it):
        r = read_item(it, threshold, cancelled)
        done[0] += 1
        if progress:
            progress(done[0] / max(1, len(items)), f"Listening: {it.get('name') or it['path']}")
        return r

    with ThreadPoolExecutor(max_workers=max(1, min(workers, len(items))), thread_name_prefix="silence") as pool:
        results = list(pool.map(one, items))
    for it, r in zip(items, results):
        o = int(round((float(it["at"]) - t_start) / HOP_S))
        k = r["n"]
        lo, hi = max(0, o), min(n, o + k)
        if hi <= lo:
            continue
        speech[lo:hi] |= r["speech"][lo - o:hi - o]
        covered[lo:hi] = True
        thr = r["thr"]
        info.append({"name": it.get("name") or it["path"], "track": it.get("track"), "vad": r["vad"],
                     "speech_s": round(float(r["speech"].sum()) * HOP_S, 2),
                     **{k2: (None if v is None else round(v, 1)) for k2, v in thr.items()}})
    return {"speech": speech, "covered": covered, "items": info}


def cuts(speech: np.ndarray, covered: np.ndarray, t_start: float, tempo: str = "normal") -> list[tuple[float, float]]:
    """The silences to take out, in sequence seconds: speech gaps shorter than the minimum stay, a margin stays around
    speech (only inside a covered stretch: never into time no sound clip covers, which left 1-2 frame gaps at clip edges),
    and what is left of a silence is cut when it is at least the minimum long (or wherever no sound clip is)."""
    min_sil, before, after = TEMPO[tempo]
    keep = speech.copy()
    n = len(keep)
    gap = int(round(min_sil / HOP_S))
    for a, b in runs(~keep):
        if 0 < a and b < n and b - a < gap and covered[a:b].all():
            keep[a:b] = True                                           # a short pause inside speech: the rhythm stays
    pb, pa = int(round(before / HOP_S)), int(round(after / HOP_S))
    padded = keep.copy()
    for a, b in runs(keep):
        padded[max(0, a - pb):a] = True
        padded[b:min(n, b + pa)] = True
    padded &= covered | keep
    out = []
    for a, b in runs(~padded):
        whole = not covered[a:b].any()
        if whole or (b - a) * HOP_S >= min_sil - 1e-9 or a == 0 or b == n:
            out.append((t_start + a * HOP_S, t_start + b * HOP_S))
    return out
