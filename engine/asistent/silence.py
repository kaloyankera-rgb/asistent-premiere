"""Remove silences (0.10.65, the user 2026-11-12: "change the rough cut to remove silences and focus on only removing silences
and dead spaces in selected videos ... accurate and also fast ... keep in mind the multiple POVs").

No speech recognition: where speech is comes from the sound itself, every selected sound clip on its own.

1. Level: each clip's sound in dB per 10 ms (the louder channel, or the one channel its L/L or R/R copy plays). Auto: the
   clip's own noise floor (10th percentile) and voice level (median of what is clearly above the floor) set its threshold,
   as tools/autoedit's cut check does (speech from 9.5 dB over the floor, or 12.8 dB under the voice, whichever is higher),
   with hysteresis: speech starts over the threshold and ends 6 dB under it (HYSTERESIS_DB), so a word's tail is not chopped where it
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
5. Quieter voices (0.10.95, Auto only, on unless the editor keeps them): a phrase clearly under the clip's main voice is
   someone further from the microphone (people talking in the background, a conversation across the room) and is cut
   like a silence. See QUIET_UNDER_DB.

0.10.96 (the user, 2026-11-15: "improve Cut Silences based on AutoCut"): the measuring and the deciding are apart.
`measure` reads one sound clip once (level per 10 ms, Silero) and remembers it; `label_item` and `plan` decide from that with
the editor's settings (`settings`), so a preview after a changed setting costs milliseconds. Three things can go:
dead space (mode "silence"), also voices away from the microphone ("offmic"), also repeated takes ("ai", with the words
roughcut_job reads). How speech is found is the method: "auto" (each microphone's own levels + Silero), "manual" (the
editor's dB alone: what stays under it goes, speech or not), "ai" (auto + the recognised words, for hesitation sounds and
takes). Everything that would go is a region the editor can take back, and what is unsure is kept and flagged.
"""
from __future__ import annotations

import logging
import os
import threading
from collections import OrderedDict
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
# 0.10.95 (the user, 2026-11-15, Lokali: "in the red labeled part you can hear the dB is a bit lower than when the host is
# asking him the questions ... it needs to recognize when there is full silence to cut it and when its lower dB to also cut
# it"). Measured on the pieces the user labelled in "NO SILENCE – Lokali v10" (IMG_9422): every phrase labelled good
# (green) was 0.0-0.2 dB under the main voice, every one labelled bad (red) 7.2-22 dB under, the guest's short answers
# („Не.“, „Да.“) 3-6 dB under. On a single speaker (Masterhaus C0728) a real line („Ах! Само в 50 евро! Взимаме.“) was 6.6 dB
# under and the camera's noise taken for speech 17-30 dB; the ReShape export and Ludi Glavi IMG_5421 had nothing over 6.
QUIET_UNDER_DB = 8.0           # Auto: a phrase this far under the clip's main voice is a voice further away: cut
PHRASE_GAP_S = 0.5             # speech with gaps shorter than this is one phrase (one phrase is kept or cut whole)
MAIN_SHARE = 0.10              # the main voice: the level the loudest phrases reach that make up this share of the speech ...
MAIN_MIN_S = 3.0               # ... and at least this many seconds (one shout or laugh does not set it)

# ---- 0.10.96: settings
SIL, LOW, OFF, FLAG, SPEECH = 0, 1, 2, 3, 4      # one 10 ms of one clip: nothing, a breath or a rustle, a voice away from the
#                                                  microphone (goes), one that may be (stays, flagged), speech
MODES = ("silence", "offmic", "ai")
METHODS = ("auto", "manual", "ai")
ACTIONS = ("remove", "gaps", "split", "mute")
# Pacing: the shortest pause that is cut, the shortest sound that counts as speech, what stays before and after speech (s).
# "min_silence" is the whole pause, margins included: Calm, Measured and Paced cut exactly what Calm, Normal and Tight cut
# before 0.10.96 (0.8, 0.5, 0.3 s left over after the margins).
PACING = {
    "calm": {"min_silence": 1.30, "min_speech": 0.15, "before": 0.20, "after": 0.30, "short": False},
    "measured": {"min_silence": 0.87, "min_speech": 0.15, "before": 0.15, "after": 0.22, "short": False},
    "paced": {"min_silence": 0.65, "min_speech": 0.15, "before": 0.15, "after": 0.20, "short": False},
    "energetic": {"min_silence": 0.40, "min_speech": 0.15, "before": 0.10, "after": 0.14, "short": True},
}
PACING_ALIAS = {"normal": "measured", "tight": "paced"}
PACING_LABEL = {"calm": "calm", "measured": "measured", "paced": "paced", "energetic": "energetic", "custom": "custom"}
# Sensitivity 1 (careful) .. 5 (aggressive). Auto: how far under the main voice a phrase goes (3 = QUIET_UNDER_DB, measured).
UNDER_DB = {1: 12.0, 2: 10.0, 3: QUIET_UNDER_DB, 4: 6.5, 5: 5.0}
FLAG_BAND_DB = 2.0             # a phrase this close above the line is kept and flagged (Lokali: a red phrase 7.2 dB under,
#                                Masterhaus: a real line 6.6 dB under: the level cannot tell them apart)
# Manual: (seconds the level is averaged over, how far under the threshold speech that has started ends). 1 is the level
# as it is, 5 wants the sound to stay over the threshold for a while (one loud laugh in a quiet conversation does not count)
MANUAL = {1: (0.01, 6.0), 2: (0.05, 6.0), 3: (0.10, 6.0), 4: (0.25, 4.0), 5: (0.40, 2.0)}
HEARD = 0.50                   # Manual: Silero this sure under the threshold is shown as a voice, not as silence (it goes either way)
LOW_OVER_DB = 8.0              # a breath, a rustle: this far over the noise floor without being speech
SHORT_AFTER, SHORT_BEFORE = 0.07, 0.05   # Remove short pauses: what stays of one, after the word before it and before the next
SHORT_MIN, SHORT_MAX = 0.25, 0.50
BREATH_S = 0.12                # a short pause that holds a breath this long (not the tail of the word before it) is left alone
BREATH_AFTER = 0.06
MIN_REGION_S = 0.30            # a piece of plain silence shorter than this between two cut voices belongs to them
ENV_HOP_S = 0.05               # the preview's waveform: the loudest 10 ms of every 50
# hesitation sounds (Remove filler words): only sounds that are no word; „ами“, „така“, „значи“ are words and stay
HESITATIONS = {"ъ", "ъъ", "ъъъ", "ъъъъ", "ъм", "ъмм", "ъх", "ъхъ", "ам", "амм", "ем", "емм", "ее", "еее", "ееее", "аа", "ааа", "аааа",
               "м", "мм", "ммм", "мммм", "хм", "хмм", "хъм", "uh", "uhh", "um", "umm", "uhm", "er", "erm", "eh", "ah", "hm", "hmm", "mm", "mmm"}
FILLER_MAX_S = 2.0             # a stretch of speech longer than this is not one hesitation sound
ISLAND_GAP_S = 0.08            # speech with gaps shorter than this is one stretch (for fillers)
WORD_MIN_S = 0.25              # word guard: a word is at least this long when its recognised times say less (Scribe: 7 % have start == end)


def _f(v, what: str, lo: float, hi: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"Invalid value: {what}.")
    if not lo <= x <= hi:
        raise ValueError(f"{what[0].upper() + what[1:]} must be between {lo:g} and {hi:g}.")
    return x


def settings(body: dict | None = None) -> dict:
    """The editor's choices, checked and filled in. body: {mode, method, threshold, pacing | tempo, min_silence, min_speech,
    before, after, sensitivity, short, short_min, short_max, fillers, action, listen, overrides}; an older body
    ({tempo, threshold, quiet}) means what it meant: quieter voices cut in Auto unless quiet is false."""
    b = dict(body or {})
    mode = b.get("mode") or "silence"
    old = "method" not in b and "pacing" not in b and "action" not in b      # a 0.10.65-0.10.95 request
    thr = clamp_threshold(b.get("threshold"))
    if old:
        mode = "offmic" if b.get("quiet", True) is not False and thr is None else "silence"
    if mode not in MODES:
        raise ValueError("Invalid mode.")
    method = b.get("method") or ("manual" if thr is not None else "auto")
    if method not in METHODS:
        raise ValueError("Invalid detection method.")
    if mode == "ai" and method == "auto":
        method = "ai"                                                  # repeated takes need the words
    if method == "manual" and thr is None:
        raise ValueError("Manual dB needs a threshold between -80 and -10 dB.")
    if method != "manual":
        thr = None
    pacing = b.get("pacing") or b.get("tempo") or "measured"
    pacing = PACING_ALIAS.get(pacing, pacing)
    if pacing not in PACING and pacing != "custom":
        raise ValueError("Invalid pacing.")
    base = dict(PACING["measured" if pacing == "custom" else pacing])
    if pacing == "custom":
        for k, what, lo, hi in (("min_silence", "the minimum silence", 0.1, 10.0), ("min_speech", "the minimum speech", 0.0, 2.0),
                                ("before", "the padding before speech", 0.0, 1.0), ("after", "the padding after speech", 0.0, 1.0)):
            if b.get(k) is not None and b.get(k) != "":
                base[k] = _f(b[k], what, lo, hi)
    short = base["short"] if b.get("short") is None else bool(b["short"])
    short_min = SHORT_MIN if b.get("short_min") in (None, "") else _f(b["short_min"], "the shortest pause", 0.1, 2.0)
    short_max = SHORT_MAX if b.get("short_max") in (None, "") else _f(b["short_max"], "the longest short pause", 0.1, 3.0)
    short_max = min(short_max, base["min_silence"])                  # a longer pause is the pacing's to cut
    if short_max < short_min:
        short_min = short_max
    sens = 3 if b.get("sensitivity") in (None, "") else int(_f(b["sensitivity"], "the sensitivity", 1, 5))
    action = b.get("action") or "remove"
    if action not in ACTIONS:
        raise ValueError("Invalid action.")
    listen = b.get("listen")
    if listen is not None:
        if not isinstance(listen, list) or not all(isinstance(t, int) and not isinstance(t, bool) and t >= 0 for t in listen):
            raise ValueError("Invalid list of tracks to listen to.")
        listen = sorted(set(listen))
    ov = []
    for o in b.get("overrides") or []:
        if not isinstance(o, dict):
            raise ValueError("Invalid review choice in the request.")
        a, e = _f(o.get("start"), "a review choice", 0.0, 1e7), _f(o.get("end"), "a review choice", 0.0, 1e7)
        if e > a:
            ov.append({"start": a, "end": e, "cut": bool(o.get("cut"))})
    return {"mode": mode, "method": method, "threshold": thr, "pacing": pacing, "min_silence": base["min_silence"],
            "min_speech": base["min_speech"], "before": base["before"], "after": base["after"], "sensitivity": sens,
            "short": short, "short_min": short_min, "short_max": short_max,
            "fillers": bool(b.get("fillers")) and (method == "ai" or mode == "ai"), "action": action, "listen": listen, "overrides": ov}


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


POOL_SPREAD_DB = 6.0           # ranges of one file whose own levels differ by more than this are not pooled (another gain, another scene)
POOL_MIN_S = 1.0               # a range shorter than this does not count in that comparison (its own statistics mean nothing)


def pooled_levels(dbs: list[np.ndarray]) -> dict | None:
    """Several ranges of ONE file and channel -> the noise floor, voice level and threshold of all of them together (0.10.122).
    A clip that was already cut down to its speech has no pauses left, so its own 10th percentile is speech and its threshold
    sits too high (audit 2026-11-21); the ranges of the same recording share one floor. None when the ranges' own levels (the
    90th percentile of what is not digital silence) differ by more than POOL_SPREAD_DB: then each is judged on its own, as
    before."""
    if len(dbs) < 2:
        return None
    top = []
    for d in dbs:
        live = d[d > SILENT_DB]
        if len(live) * HOP_S >= POOL_MIN_S:
            top.append(float(np.percentile(live, 90)))
    if top and max(top) - min(top) > POOL_SPREAD_DB:
        return None
    return auto_threshold(np.concatenate(dbs))


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


def item_speech(db: np.ndarray, probs: np.ndarray | None, threshold: float | None, min_speech: float = BUMP_S,
                levels: dict | None = None, gate: bool = True, unsure: np.ndarray | None = None) -> tuple[np.ndarray, dict]:
    """One clip's speech per 10 ms -> (mask, its levels). levels: the floor / voice / threshold to use in Auto instead of the
    clip's own (`pooled_levels`: one recording cut into short clips is judged as one). gate: the very-quiet-clip rule below
    (off when this is the only microphone listened to). unsure: a bool array the caller owns, set where the gate dropped a
    stretch Silero half hears (HEARD..VAD_SURE): not speech, but the plan keeps it and flags it."""
    if threshold is not None:                                          # the editor's dB: the level alone decides
        thr = {"floor": None, "voice": None, "open": threshold}
        return hysteresis(db, threshold, threshold - HYSTERESIS_DB), thr
    thr = levels or auto_threshold(db)
    loud = hysteresis(db, thr["open"], thr["open"] - HYSTERESIS_DB)
    if probs is None:
        return loud, thr
    p = vad.per_frame(probs, len(db))
    heard = _near(p >= VAD_NEAR, int(round(VAD_REACH / HOP_S)))
    speech = loud.copy()
    # Silero misses short loud words (measured 2026-11-12 on NEW TEST: „Има“ at -20 dB, „Какво“ at -28 dB, Silero 0.03-0.6), so it
    # never takes away a loud stretch of speech length; it only takes away a short burst it does not hear at all (a bump, a
    # click, a door), and adds quiet speech it is sure of. "Short" is the editor's minimum speech (0.15 s unless Custom).
    quiet_clip = gate and thr["open"] < SURE_MIN_DB
    if quiet_clip:
        # A threshold this low means the clip's "voice" sits under SURE_MIN_DB: a dead input (Fornetti fx30-3-0403, R: floor
        # -88.6 dB, threshold -79: 28 s of hiss counted as speech and blocked every cut through the union of the clips, TODO SIL)
        # or a very quiet lavalier (about -57 dB RMS). The level cannot tell them apart, Silero can: a stretch of sound counts
        # when Silero is sure (VAD_SURE) somewhere in it or within its reach; where it only half hears (HEARD..VAD_SURE: it
        # gives 0.03-0.6 on short loud words) the stretch is not speech but is kept and flagged; under HEARD it is not speech.
        # Whole stretches, never single frames, so a quiet lavalier word keeps its soft syllables. Without Silero (probs is None,
        # returned above) the level decides, the safe side for a real quiet voice. Never applied when this is the only
        # microphone listened to (gate): there is no union to protect from its hiss, and the editor's cut follows the one voice.
        reach_f = int(round(VAD_REACH / HOP_S))
        sure, maybe = _near(p >= VAD_SURE, reach_f), _near(p >= HEARD, reach_f)
        for a, b in runs(loud):
            if not sure[a:b].any():
                speech[a:b] = False
                if unsure is not None and maybe[a:b].any():
                    unsure[a:b] = True
    else:
        for a, b in runs(loud):
            if (b - a) * HOP_S < min_speech and not heard[a:b].any():
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


def smooth_db(db: np.ndarray, seconds: float) -> np.ndarray:
    """The level averaged (as power) over `seconds` around each 10 ms: a short-term loudness, not a peak."""
    k = int(round(seconds / HOP_S))
    if k <= 1 or not len(db):
        return db
    # a clip shorter than the window (a few frames at the edge of In to Out): "same" would give the window's length back
    # (0.10.96 first run: "operands could not be broadcast together with shapes (3,) (10,)")
    k = min(k, len(db))
    power = np.convolve(10.0 ** (db / 10.0), np.ones(k) / k, mode="same")[:len(db)]
    return 10.0 * np.log10(np.maximum(power, 1e-12))


def manual_speech(db: np.ndarray, threshold: float, sensitivity: int = 3, min_speech: float = BUMP_S) -> np.ndarray:
    """Manual dB: what reaches the editor's threshold is kept, what stays under it goes, speech or not. Nothing else
    decides (no Silero, no main voice), so the same number always gives the same cut. Sensitivity only sets how long the
    level is averaged and how soon speech that started ends; a sound over the threshold shorter than the minimum speech
    does not count."""
    win, hyst = MANUAL[sensitivity]
    lv = smooth_db(db, win)
    out = hysteresis(lv, threshold, threshold - hyst)
    for a, b in runs(out):
        # counted on the level as it is: averaging makes a click look longer than it was
        if float((db[a:b] >= threshold - hyst).sum()) * HOP_S < min_speech:
            out[a:b] = False
    return out


def suggest_threshold(mains: list[float | None]) -> float | None:
    """Manual dB's starting point from the dialogue itself: QUIET_UNDER_DB under the quietest microphone's main voice (the
    line Auto draws), whole dB. Measured on the Lokali interview (main voice -22 dB): -30 dB cuts 1.2 s of the host's
    softest syllables and leaves 9.7 s of the talk across the room; -28 cuts 2.3 s and leaves 3.1 s, -32 cuts none and
    leaves 24.5 s. One number cannot do what Auto's per-phrase rule does; the editor moves it in the preview."""
    live = [m for m in mains if m is not None]
    if not live:
        return None
    return float(max(-80.0, min(-10.0, round(min(live) - QUIET_UNDER_DB))))


def phrases(db: np.ndarray, speech: np.ndarray) -> list[tuple[int, int, float]]:
    """Speech joined over gaps shorter than PHRASE_GAP_S -> [(first frame, end frame, loudness)]; the loudness of a phrase is
    the 90th percentile of its speech frames (a phrase is as loud as its stressed syllables, not its pauses or tails)."""
    joined = speech.copy()
    n = len(joined)
    gap = int(round(PHRASE_GAP_S / HOP_S))
    for a, b in runs(~joined):
        if 0 < a and b < n and b - a < gap:
            joined[a:b] = True
    return [(a, b, float(np.percentile(db[a:b][speech[a:b]], 90))) for a, b in runs(joined) if speech[a:b].any()]


def main_voice(ph: list[tuple[int, int, float]]) -> float | None:
    """The clip's main voice level: what its loudest phrases reach, counting down until they make up MAIN_SHARE of the speech
    (at least MAIN_MIN_S); None without speech."""
    if not ph:
        return None
    total = sum(b - a for a, b, _ in ph)
    need = max(MAIN_MIN_S / HOP_S, MAIN_SHARE * total)
    acc = 0
    for a, b, level in sorted(ph, key=lambda t: -t[2]):
        acc += b - a
        if acc >= need:
            return level
    return min(level for _, _, level in ph)


def drop_quiet(db: np.ndarray, speech: np.ndarray) -> tuple[np.ndarray, float | None, float]:
    """Speech without the phrases more than QUIET_UNDER_DB under the main voice -> (mask, main voice dB, seconds dropped)."""
    ph = phrases(db, speech)
    main = main_voice(ph)
    out = speech.copy()
    dropped = 0
    if main is None:
        return out, None, 0.0
    for a, b, level in ph:
        if level < main - QUIET_UNDER_DB:
            dropped += int(out[a:b].sum())
            out[a:b] = False
    return out, main, dropped * HOP_S


# ---------------------------------------------------------------- measuring (once per clip) and labelling (per setting)
_MEASURED: OrderedDict = OrderedDict()
_MEASURED_MAX = 64
_LOCK = threading.Lock()


def _key(it: dict):
    try:
        st = os.stat(it["path"])
    except (OSError, TypeError, ValueError):
        return None
    return (it["path"], st.st_mtime_ns, st.st_size, round(float(it["start"]), 4), round(float(it["end"]), 4), it.get("side"))


def measure(it: dict, cancelled=None) -> dict:
    """One sound clip, read once: {"db": level per 10 ms, "probs": Silero or None}. Remembered by file, range and channel,
    so the preview and the cut after it, or a second preview with other settings, do not read or listen again."""
    if cancelled and cancelled():
        raise Cancelled()
    key = _key(it)
    if key is not None:
        with _LOCK:
            if key in _MEASURED:
                _MEASURED.move_to_end(key)
                return _MEASURED[key]
    x = audio.read_range(it["path"], float(it["start"]), float(it["end"]), sr=SR, cancelled=cancelled)
    db, main = level_db(x, it.get("side"))
    m = {"db": db, "probs": vad.probabilities(main) if len(main) else None}
    if key is not None:
        with _LOCK:
            _MEASURED[key] = m
            while len(_MEASURED) > _MEASURED_MAX:
                _MEASURED.popitem(last=False)
    return m


def label_item(db: np.ndarray, probs: np.ndarray | None, s: dict, pool: dict | None = None, gate: bool = True) -> dict:
    """One clip's 10 ms frames labelled SIL / LOW / OFF / FLAG / SPEECH by the settings ->
    {"labels", "under" (dB under the main voice, for OFF and FLAG frames), "thr", "main", "off_s", "flag_s", "vad"}.
    pool: {"levels": pooled_levels(...), "main": the main voice of all the ranges of the same file} (detect), else the clip's own.
    gate: see item_speech (detect turns it off for a single microphone)."""
    n = len(db)
    own = pool["levels"] if pool else None
    levels = own or auto_threshold(db)
    pooled_main = pool.get("main") if pool else None
    under = np.zeros(n, dtype=np.float32)
    labels = np.zeros(n, dtype=np.uint8)
    main, used_vad = None, False
    if s["method"] == "manual":
        speech = manual_speech(db, s["threshold"], s["sensitivity"], s["min_speech"])
        thr = {"floor": round(levels["floor"], 1), "voice": None, "open": s["threshold"]}
        labels[db >= levels["floor"] + LOW_OVER_DB] = LOW
        if probs is not None:                                          # shown apart in the preview; it goes either way
            p = vad.per_frame(probs, n)
            labels[(p >= HEARD) & (db >= levels["floor"] + QUIET_OVER_FLOOR_DB) & ~speech] = OFF
        labels[speech] = SPEECH
        auto_speech, _ = item_speech(db, probs, None, s["min_speech"], own, gate)   # the main voice as Auto hears it: the suggestion's base
        main = pooled_main if pooled_main is not None else main_voice(phrases(db, auto_speech))
    else:
        unsure = np.zeros(n, dtype=bool)
        speech, thr = item_speech(db, probs, None, s["min_speech"], own, gate, unsure)
        used_vad = probs is not None
        labels[db >= levels["floor"] + LOW_OVER_DB] = LOW
        labels[speech] = SPEECH
        ph = phrases(db, speech)
        main = pooled_main if pooled_main is not None else main_voice(ph)
        if s["mode"] != "silence" and main is not None:
            line = UNDER_DB[s["sensitivity"]]
            for a, b, level in ph:
                u = main - level
                if u > line - FLAG_BAND_DB:
                    part = speech[a:b]
                    labels[a:b][part] = OFF if u > line else FLAG
                    under[a:b][part] = u
        labels[unsure & ~speech] = FLAG                                # a very quiet clip, a stretch Silero half hears: kept, flagged
    return {"labels": labels, "under": under, "thr": thr, "main": main, "vad": used_vad,
            "off_s": float((labels == OFF).sum()) * HOP_S, "flag_s": float((labels == FLAG).sum()) * HOP_S,
            "speech_s": float((labels >= FLAG).sum()) * HOP_S}


def pools_for(items: list[dict], measured: list[dict], s: dict) -> list[dict | None]:
    """For every selected clip: the pool of its file's other selected ranges on the same channel ({"levels", "main"}), or None
    when it is alone, the ranges' levels differ (pooled_levels) or the editor's choices are not Auto's (a fixed dB has no
    levels to pool). A single whole clip is judged exactly as before."""
    out: list[dict | None] = [None] * len(items)
    groups: dict = {}
    for k, it in enumerate(items):
        groups.setdefault((it.get("path"), it.get("side")), []).append(k)
    for ks in groups.values():
        if len(ks) < 2:
            continue
        lv = pooled_levels([measured[k]["db"] for k in ks])
        if lv is None:
            continue
        ph = []
        for k in ks:
            sp, _ = item_speech(measured[k]["db"], measured[k]["probs"], None, s["min_speech"], lv)
            ph += phrases(measured[k]["db"], sp)
        main = main_voice(ph)
        for k in ks:
            out[k] = {"levels": lv, "main": main}
    return out


def read_item(it: dict, threshold: float | None, cancelled=None, quiet: bool = True) -> dict:
    """One selected sound clip: its speech per 10 ms of its own time (the 0.10.65-0.10.95 call, kept: the level alone for a
    fixed dB, else Auto, with the quieter voices cut unless `quiet` is off)."""
    m = measure(it, cancelled)
    db, probs = m["db"], m["probs"]
    if threshold is not None:
        speech, thr = item_speech(db, None, threshold)
        return {"speech": speech, "thr": thr, "vad": False, "n": len(db), "main": None, "quiet_s": 0.0}
    speech, thr = item_speech(db, probs, None)
    main, quiet_s = None, 0.0
    if quiet:
        speech, main, quiet_s = drop_quiet(db, speech)
    return {"speech": speech, "thr": thr, "vad": probs is not None, "n": len(db), "main": main, "quiet_s": quiet_s}


def detect(items: list[dict], t_start: float, t_end: float, threshold: float | None = None, progress=None, cancelled=None,
           workers: int = 4, quiet: bool = True, s: dict | None = None) -> dict:
    """items: the selected sound clips [{path, start, end (media s), at (sequence s), side?}]; [t_start, t_end): the selection.
    s: settings(); without it the older arguments mean what they meant (a fixed dB is the level alone, Auto cuts the quieter
    voices unless `quiet` is off).
    -> {"speech": bool per 10 ms of the selection (what is kept), "labels": the same as SIL..SPEECH, "under", "covered",
        "env" (dB, the loudest clip), "items": [...]}"""
    legacy = s is None
    if legacy:
        s = settings({"threshold": threshold, "quiet": quiet})
    n = max(0, int(np.ceil((t_end - t_start) / HOP_S - 1e-9)))
    labels = np.zeros(n, dtype=np.uint8)
    under = np.zeros(n, dtype=np.float32)
    env = np.full(n, SILENT_DB, dtype=np.float32)
    covered = np.zeros(n, dtype=bool)
    info = []
    done = [0]
    n_sources = len({(it.get("path"), it.get("side")) for it in items})   # the quiet-clip rule guards a UNION of microphones

    def listen(it):
        m = measure(it, cancelled)
        done[0] += 1
        if progress:
            progress(done[0] / max(1, len(items)), f"Listening: {it.get('name') or it['path']}")
        return m

    def one(arg):
        m, pool = arg
        gate = n_sources > 1
        if legacy and threshold is not None:                           # as before 0.10.96: no averaging, no minimum speech
            sp, thr = item_speech(m["db"], None, threshold)
            r = {"labels": np.where(sp, SPEECH, SIL).astype(np.uint8), "under": np.zeros(len(sp), dtype=np.float32), "thr": thr,
                 "main": None, "vad": False, "off_s": 0.0, "flag_s": 0.0, "speech_s": float(sp.sum()) * HOP_S}
        else:
            r = label_item(m["db"], m["probs"], s, pool, gate)
            if pool:
                # Pooling may only ever keep MORE (reviewer 2026-11-21): what the clip's own statistics keep stays kept, whatever the
                # shared floor, voice and main voice say. Per frame the stronger label wins (SIL < LOW < OFF < FLAG < SPEECH).
                r0 = label_item(m["db"], m["probs"], s, None, gate)
                better = (r0["labels"] > r["labels"]) | ((r0["labels"] == r["labels"]) & (r0["under"] < r["under"]))
                r["labels"][better] = r0["labels"][better]
                r["under"][better] = r0["under"][better]
                r["off_s"] = float((r["labels"] == OFF).sum()) * HOP_S
                r["flag_s"] = float((r["labels"] == FLAG).sum()) * HOP_S
                r["speech_s"] = float((r["labels"] >= FLAG).sum()) * HOP_S
            if legacy:                                                 # 0.10.95 had no flagged band: what is flagged stayed
                r["labels"][r["labels"] == FLAG] = SPEECH
        r["db"] = m["db"]
        return r

    with ThreadPoolExecutor(max_workers=max(1, min(workers, len(items))), thread_name_prefix="silence") as pool:
        measured = list(pool.map(listen, items))
        # the ranges of one file (a recording already cut into short clips) share their noise floor, voice and main voice
        pools = [None] * len(items) if legacy and threshold is not None else pools_for(items, measured, s)
        results = list(pool.map(one, zip(measured, pools)))
    for it, r in zip(items, results):
        o = int(round((float(it["at"]) - t_start) / HOP_S))
        k = len(r["labels"])
        lo, hi = max(0, o), min(n, o + k)
        if hi <= lo:
            continue
        mine, mu = r["labels"][lo - o:hi - o], r["under"][lo - o:hi - o]
        cur, cu = labels[lo:hi], under[lo:hi]
        better = (mine > cur) | ((mine == cur) & (mu < cu))
        cu[better] = mu[better]
        cur[better] = mine[better]
        env[lo:hi] = np.maximum(env[lo:hi], r["db"][lo - o:hi - o])
        covered[lo:hi] = True
        thr = r["thr"]
        info.append({"name": it.get("name") or it["path"], "track": it.get("track"), "vad": r["vad"],
                     "speech_s": round(r["speech_s"], 2),
                     "main": None if r.get("main") is None else round(r["main"], 1), "quiet_s": round(r["off_s"], 2),
                     "flag_s": round(r["flag_s"], 2),
                     **{k2: (None if v is None else round(v, 1)) for k2, v in thr.items()}})
    return {"speech": labels >= FLAG, "labels": labels, "under": under, "covered": covered, "env": env, "items": info}


# ---------------------------------------------------------------- the plan: what goes, as regions the editor can take back
def _frame(t: float, t_start: float, n: int) -> int:
    return min(max(int(round((t - t_start) / HOP_S)), 0), n)


def _islands(keep: np.ndarray, gap_s: float = ISLAND_GAP_S) -> list[tuple[int, int]]:
    joined = keep.copy()
    gap = int(round(gap_s / HOP_S))
    for a, b in runs(~joined):
        if 0 < a and b < len(joined) and b - a < gap:
            joined[a:b] = True
    return runs(joined)


def _norm(word: str) -> str:
    return "".join(ch for ch in word.lower() if ch.isalpha())


def filler_mask(keep: np.ndarray, words: list[dict], t_start: float) -> np.ndarray:
    """The stretches of speech that hold nothing but hesitation sounds („ъъъ“, „ъм“, "um"). A whole stretch between two
    pauses, never a part of one: Whisper's word times are off by up to 0.3 s, so a sound glued to a word is left alone."""
    n = len(keep)
    out = np.zeros(n, dtype=bool)
    mids = [((w["start"] + w["end"]) / 2, _norm(w["word"])) for w in words]
    for a, b in _islands(keep):
        if (b - a) * HOP_S > FILLER_MAX_S:
            continue
        ta, tb = t_start + a * HOP_S - 0.05, t_start + b * HOP_S + 0.05
        inside = [w for t, w in mids if ta <= t < tb and w]
        if inside and all(w in HESITATIONS for w in inside):
            out[a:b] = True
    return out


def take_masks(groups: list[dict], keep: np.ndarray, t_start: float) -> tuple[np.ndarray, list[dict]]:
    """Repeated takes (takes.find) -> (frames that go, the groups that are only listed). A losing take goes as whole
    stretches of speech: each stretch between two pauses that lies mostly inside Whisper's times for it, from where its
    sound starts to where it ends. Whisper's times can be off by more than a second where two
    people talk (Lokali: a "take" 1.6 s early, inside the host's sentence), so a stretch that only touches the take is
    never cut into; a take that is no stretch of its own (said again without a pause) is listed for the editor instead."""
    n = len(keep)
    mask = np.zeros(n, dtype=bool)
    listed = []
    isl = _islands(keep)
    def kept_share(a: float, b: float) -> float:
        fa, fb = _frame(a, t_start, n), _frame(b, t_start, n)
        return float(keep[fa:fb].mean()) if fb > fa else 0.0

    for g in groups:
        best = g["takes"][g["recommended"]]
        got = 0
        g["applied"], g["cut_s"] = False, 0.0
        # the take that would stay must itself stay: where it is a voice away from the microphone (it goes anyway), the
        # "repeat" is the people across the room echoing the speaker, and the speaker's own line is not theirs to replace
        if kept_share(best["start"], best["end"]) < 0.5:
            continue
        for a, b in g.get("cut") or []:
            fa, fb = _frame(a, t_start, n), _frame(b, t_start, n)
            mine = [(x, y) for x, y in isl if min(y, fb) - max(x, fa) > 0.5 * (y - x)]
            if not mine:
                continue
            lo, hi = mine[0][0], mine[-1][1]                             # the pauses around it are the pacing's (plan, step 2)
            if (hi - lo) * HOP_S >= 0.25:
                mask[lo:hi] = True
                got += hi - lo
        g["applied"] = got > 0
        g["cut_s"] = round(got * HOP_S, 2)
        if not got:
            others = [t for k, t in enumerate(g["takes"]) if k != g["recommended"] and kept_share(t["start"], t["end"]) >= 0.5]
            if others:
                why = ("said again far apart: check it by hand" if g.get("far") else
                       "a short phrase said again: check it by hand" if g.get("short") else
                       "said differently" if not g["safe"] else "said again without a pause: cut it by hand" if g.get("cut")
                       else "the last one is not complete")
                g["listed"] = True
                listed.append({"start": min(t["start"] for t in others), "end": max(t["end"] for t in others),
                               "text": f"{g['kind_label']} ×{len(g['takes'])}, {why}; the best is \"{best['text'][:60]}\""})
    return mask, listed


def _merge_spans(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def guard_words(code: np.ndarray, words: list[dict], t_start: float, s: dict, kinds: tuple[int, int]) -> list[tuple[int, int]]:
    """Recognised words are a second witness against a cut (0.10.122, audit 2026-11-21): the level said "silence" or "short
    pause" where a word was read (a quiet word, a soft onset). Only ever keeps MORE, never cuts: `code` is changed in place
    (frames of the given kinds put back to 0) and the spans kept for a word that lies mostly inside a cut are returned as
    frame ranges, for the plan to show them flagged.
    - A cut that covers a word's START keeps from `before` seconds ahead of the start to the word's end plus `after` (a
      word is at least WORD_MIN_S long: starts are the reliable edge, ends are not). The rest of that cut stays a cut unless
      it is shorter than MIN_REGION_S.
    - A word lying more than half inside a cut (starts before it or in it) is kept and flagged, whole as far as the cut goes."""
    n = len(code)
    ok = np.isin(code, kinds)
    pb, pa, need = int(round(s["before"] / HOP_S)), int(round(s["after"] / HOP_S)), int(round(MIN_REGION_S / HOP_S))
    flags: list[tuple[int, int]] = []
    for w in words:
        norm = _norm(w.get("word") or "")
        if not norm or norm in HESITATIONS:                            # a hesitation sound is no word: it is not guarded
            continue
        try:
            ws, we = float(w["start"]), float(w["end"])
        except (KeyError, TypeError, ValueError):
            continue
        f0 = int(round((ws - t_start) / HOP_S))
        f1 = max(int(round((we - t_start) / HOP_S)), f0)
        lo, hi = max(f0, 0), min(f1, n)
        if 0 <= f0 < n and ok[f0]:
            ra = f0
            while ra > 0 and ok[ra - 1]:
                ra -= 1
            rb = f0
            while rb < n and ok[rb]:
                rb += 1
            k0, k1 = max(ra, f0 - pb), min(rb, max(f1, f0 + int(round(WORD_MIN_S / HOP_S))) + pa)
            mostly = f1 > f0 and ok[lo:hi].sum() > 0.5 * (f1 - f0)
            code[k0:k1] = 0
            ok[k0:k1] = False
            for a, b in ((ra, k0), (k1, rb)):                          # what is left of the cut: a sliver stays too
                if 0 < b - a < need:
                    code[a:b] = 0
                    ok[a:b] = False
            if mostly:
                flags.append((k0, k1))
        elif f1 > f0 and hi > lo and ok[lo:hi].sum() > 0.5 * (f1 - f0):    # starts before the cut, mostly inside it
            idx = np.nonzero(ok[lo:hi])[0] + lo
            a, b = int(idx[0]), int(idx[-1]) + 1
            code[a:b][ok[a:b]] = 0
            ok[a:b] = False
            flags.append((a, b))
    return flags


KIND_TEXT = {"silence": "silence", "nosound": "no sound clip here", "offmic": "a voice away from the microphone",
             "below": "under your dB", "short": "short pause", "filler": "hesitation sound", "take": "repeated take"}


def plan(det: dict, s: dict, t_start: float, words: list[dict] | None = None, groups: list[dict] | None = None) -> dict:
    """What goes -> {"regions": [{start, end (sequence s), kind, cut, flag, text}], "cuts": [(start, end)]}. Every region
    is one decision the editor can turn around (s["overrides"]); "cuts" are the regions that go, joined."""
    labels, covered, under = det["labels"], det["covered"], det["under"]
    n = len(labels)
    keep = labels >= FLAG
    manual = s["method"] == "manual"
    code = np.zeros(n, dtype=np.uint8)                                 # per frame: 0 stays, else index into KINDS
    KINDS = ["", "silence", "nosound", "offmic", "below", "short", "filler", "take"]
    K = {k: i for i, k in enumerate(KINDS)}
    hard = np.zeros(n, dtype=bool)                                     # speech that goes: no margin is kept inside it
    if words and s["fillers"]:
        fm = filler_mask(keep, words, t_start)
        hard |= fm
        code[fm] = K["filler"]
    listed = []
    if groups:
        tm, listed = take_masks(groups, keep & ~hard, t_start)
        code[tm & (code == 0)] = K["take"]
        hard |= tm
    speech = keep & ~hard
    # 1. a pause shorter than the minimum stays (the rhythm of a sentence); it is remembered for Remove short pauses
    joined = speech.copy()
    gap = int(round(s["min_silence"] / HOP_S - 1e-9))
    pauses = []
    for a, b in runs(~joined):
        if 0 < a and b < n and b - a < gap and covered[a:b].all() and not hard[a:b].any():
            joined[a:b] = True
            pauses.append((a, b))
    # 2. the margin around speech, never over the edge of a clip and never into speech that goes
    pb, pa = int(round(s["before"] / HOP_S)), int(round(s["after"] / HOP_S))
    padded = joined.copy()
    for a, b in runs(joined):
        padded[max(0, a - pb):a] = True
        padded[b:min(n, b + pa)] = True
    padded &= (covered | joined) & ~hard
    gone = ~padded
    # 3. what kind each frame that goes is
    plain = gone & (code == 0)
    code[plain] = K["silence"]
    code[plain & ~covered] = K["nosound"]
    voice = gone & (labels == OFF)
    if voice.any():
        # a voice that goes takes the pauses inside it and the slivers of silence around it along (one region, not confetti)
        wide = voice.copy()
        for a, b in runs(~wide):
            if 0 < a and b < n and (b - a) * HOP_S < max(PHRASE_GAP_S, MIN_REGION_S):
                wide[a:b] = True
        code[wide & gone & ((code == K["silence"]) | (code == K["nosound"]))] = K["below" if manual else "offmic"]
    # 4. Remove short pauses: a pause the pacing leaves alone, trimmed to SHORT_AFTER + SHORT_BEFORE; one with a breath in it stays
    if s["short"]:
        lo_f, hi_f = int(round(s["short_min"] / HOP_S)), int(round(s["short_max"] / HOP_S))
        ka, kb = int(round(SHORT_AFTER / HOP_S)), int(round(SHORT_BEFORE / HOP_S))
        skip = int(round(BREATH_AFTER / HOP_S))
        for a, b in pauses:
            if not lo_f <= b - a <= hi_f or b - a - ka - kb < 2:
                continue
            breath = any((y - x) * HOP_S >= BREATH_S for x, y in runs(labels[a + skip:b] == LOW))
            if not breath:
                code[a + ka:b - kb] = K["short"]
    # 4b. the recognised words as a second witness (AI modes, words given): a cut never swallows a word's start. Manual dB is the
    # level alone in every mode (DECISIONS 2026-11-15): there the editor's line decides, words or not
    word_spans: list[tuple[int, int]] = []
    if words and not manual:
        word_spans = guard_words(code, words, t_start, s, (K["silence"], K["short"]))
    # 5. regions
    regions = []
    for i, kind in enumerate(KINDS):
        if not i:
            continue
        for a, b in runs(code == i):
            r = {"start": round(t_start + a * HOP_S, 3), "end": round(t_start + b * HOP_S, 3), "kind": kind, "cut": True, "flag": False,
                 "text": KIND_TEXT[kind]}
            if kind == "offmic":
                u = under[a:b][labels[a:b] == OFF]
                if len(u):
                    r["text"] = f"a voice {float(np.median(u)):.0f} dB under the main voice"
            regions.append(r)
    # what is unsure is kept and flagged: a voice near the line, a group of takes that is not a plain repeat
    flagged = labels == FLAG
    if flagged.any():
        for a, b in _islands(flagged, PHRASE_GAP_S):
            u = under[a:b][labels[a:b] == FLAG]
            med = float(np.median(u))
            regions.append({"start": round(t_start + a * HOP_S, 3), "end": round(t_start + b * HOP_S, 3), "kind": "offmic", "cut": False,
                            "flag": True, "text": (f"a voice {med:.0f} dB under the main voice: kept, not sure" if med > 0
                                                   else "a very quiet sound that may be a voice: kept, not sure")})
    for a, b in _merge_spans(word_spans):
        regions.append({"start": round(t_start + a * HOP_S, 3), "end": round(t_start + b * HOP_S, 3), "kind": "silence", "cut": False,
                        "flag": True, "text": "a word was heard here: kept, not sure"})
    for x in listed:
        regions.append({"start": round(x["start"], 3), "end": round(x["end"], 3), "kind": "take", "cut": False, "flag": True, "text": x["text"] + ": kept"})
    regions.sort(key=lambda r: (r["start"], r["end"]))
    # 6. the editor's own choices: a region mostly inside a choice follows it
    for o in s.get("overrides") or []:
        for r in regions:
            inside = min(r["end"], o["end"]) - max(r["start"], o["start"])
            if inside > 0.5 * (r["end"] - r["start"]) and r["cut"] != o["cut"]:
                r["cut"] = o["cut"]
                r["by"] = "you"
    cuts = []
    for r in regions:
        if not r["cut"]:
            continue
        if cuts and r["start"] <= cuts[-1][1] + 1e-6:
            cuts[-1] = (cuts[-1][0], max(cuts[-1][1], r["end"]))
        else:
            cuts.append((r["start"], r["end"]))
    return {"regions": regions, "cuts": cuts, "groups": groups or []}


def envelope(env: np.ndarray) -> list[int]:
    """The preview's waveform: the loudest 10 ms of every ENV_HOP_S, whole dB (-90 .. 0)."""
    k = int(round(ENV_HOP_S / HOP_S))
    n = (len(env) // k) * k
    if not n:
        return []
    return [int(v) for v in np.clip(np.round(env[:n].reshape(-1, k).max(axis=1)), SILENT_DB, 0.0)]


def cuts(speech: np.ndarray, covered: np.ndarray, t_start: float, tempo: str = "normal") -> list[tuple[float, float]]:
    """The silences to take out, in sequence seconds (the 0.10.65 call, kept): speech gaps shorter than the minimum stay, a
    margin stays around speech (only inside a covered stretch: never into time no sound clip covers, which left 1-2 frame gaps
    at clip edges), and what is left of a silence is cut when it is at least the minimum long (or wherever no sound clip is)."""
    min_sil, before, after = TEMPO[tempo]
    s = settings({"method": "auto", "pacing": "custom", "min_silence": min_sil + before + after, "before": before, "after": after, "short": False})
    det = {"labels": np.where(speech, SPEECH, SIL).astype(np.uint8), "covered": covered, "under": np.zeros(len(speech), dtype=np.float32)}
    return plan(det, s, t_start)["cuts"]
