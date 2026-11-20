"""Recognition profiles: everything the /subtitles job does between the sound and the words, chosen once per run.

Why (the 2026-11-20 audit): the only switch used to be `strict = preset != "reshape"`, threaded through the job, and every
accuracy fix was tuned on one recording because nothing was measured. Now a run has ONE profile, and a new way of
recognising is a new profile that `scripts/bench_subtitles.py` scores against the editors' finished videos before any
editor gets it. Numbers below: wrong or missing reference words on the 15 tuning videos (2237 words) / the 13 held-back
ones (1934 words); docs/BENCHMARK.md has the tables.

  CLASSIC  the ReShape style, exactly as it has been (the user: "leave ReShape out, it is perfect how it is"). Frozen: its
           fields, its cache keys and its result keys are pinned by tests/test_recognition_profiles.py and by the golden run
           (scripts/reshape_golden.py). Nothing below may change what a CLASSIC run does. Always on this computer.
  STRICT   every other style as shipped in 0.10.95-0.10.118 (315 / 335): the stricter dictionary repair, and a doubtful
           piece read again alone and louder, the reading that fits the sound best kept. What a run gets when ElevenLabs is
           not set up, switched off or not reachable.
  CLOUD    every style but ReShape's when the editor saved an ElevenLabs key (cloudasr.py; the user's decision 2026-11-21):
           each window is read by Scribe v3 (138 / 227 for its own words, about 0.16 s per second of sound), then the same
           text layers run on this computer. One reading: a second one would be a second upload.
  NEXT     the local path still being measured, not a default: full precision (asr.LARGE_FULL, 285 / 326), the dictionary's
           careful steps and by-ear repair (281 / 323 together), and a doubtful piece read again alone where a reading with
           fewer words cannot win ("alone": 279 against 284 for one reading, tuning videos as short clips; without that rule
           302, the swaps then win by leaving words out). Its held-back runs are not finished.
           Tried and not kept: a Bulgarian fine-tune of the model (367), reading in parts of 20 s (341) and of 30 s (302 as
           one clip, 315 as short clips; with full precision 302 against 284, though 2.8x faster), no carry-over between
           stretches (316), voice detection (315), no temperature retries (315, they never fired), the level evened out
           (313, with more invented lines), a wider search (306, 1.4x the time).
           Differences under about 15 words between two READINGS are noise here: moving the cuts alone changes that much.

`for_preset` gives CLASSIC to ReShape; to everything else CLOUD when cloudasr.available(), else DEFAULT. For development
only, the environment variable ASISTENT_RECOGNITION picks a profile for the non-ReShape styles, optionally with fields to
try: `next`, `cloud` or `next:{"second": "none", "level": -20}` (never read for ReShape).
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import logging
import os
from dataclasses import dataclass

import numpy as np

from . import cloudasr

log = logging.getLogger("asistent")
SR = 16000


@dataclass(frozen=True)
class Profile:
    name: str
    strict: bool = True                # lexicon.repair: the syllable rule and „карао“ -> „карал“ (0.10.94)
    # a piece that holds a doubtful word: "doubts" = read again alone, the reading with fewer doubtful words wins;
    # "sound" = also read louder, the reading that fits the sound best wins, else fewer doubts (0.10.95);
    # "sound_only" = as "sound" without the fewer-doubts rule; "alone" = as "sound" without the louder reading of the
    # whole window (it won 1 swap of 60 on the tuning videos and costs a whole reading), and a reading with fewer words
    # than the first never wins; "none" = the first reading stands
    second: str = "sound"
    # the dictionary's repair of a word it does not know (lexicon.py): "steps" = as shipped; "careful" = a repair by any
    # letter, or by two vowels, only to a word the recording itself says; "ear" = the nearest real word by ear
    repair: str = "steps"
    level: float | None = None         # the speech level every window is brought to before recognition (dBFS); None = as recorded
    highpass: float | None = None      # rumble under this many Hz taken out before recognition; None = as recorded
    decode: tuple = ()                 # ((option, value), ...) passed to faster-whisper's transcribe
    full: bool = False                 # the model read with 32-bit numbers on the processor (asr.LARGE_FULL), not 8-bit
    hotwords: bool = False             # the names also as hotwords (they reach every 30 s stretch, the prompt only the first)
    part: float | None = None          # a piece longer than this is read in parts cut at its quietest moments (seconds)
    log: bool = False                  # the fuller edits log (new keys in the result JSON)
    cloud: str = ""                    # the ElevenLabs model that reads each window instead of Whisper (cloudasr.py); "" = this computer

    @property
    def tag(self) -> str:
        """What goes into a reading's cache key: empty for profiles that hear and decode as Asistent always has, so their
        keys are today's keys; otherwise a mark of everything that can change what Whisper returns for the same sound."""
        hearing = (self.level, self.highpass, self.decode, self.hotwords, self.full)
        if self.cloud:
            hearing += (self.cloud,)                           # appended, so the local profiles' keys stay what they were
        if hearing == (None, None, (), False, False):
            return ""
        return hashlib.sha1(json.dumps(hearing, sort_keys=True).encode("utf-8")).hexdigest()[:12]

    def options(self, prompt: str = "") -> dict | None:
        """The extra transcribe options of this profile (None = the call exactly as it has always been)."""
        out = dict(self.decode)
        if self.hotwords and prompt:
            out["hotwords"] = prompt
        return out or None


CLASSIC = Profile("classic", strict=False, second="doubts")
STRICT = Profile("strict")
NEXT = dataclasses.replace(STRICT, name="next", second="alone", repair="careful+ear", full=True, log=True)
CLOUD = Profile("cloud", second="none", repair="none", log=True, cloud=cloudasr.MODEL)
PROFILES = {p.name: p for p in (CLASSIC, STRICT, NEXT, CLOUD)}
DEFAULT = STRICT           # on this computer, every style but ReShape's (NEXT replaces it once its held-back runs say so)
_SECOND = ("doubts", "sound", "sound_only", "alone", "none")
_REPAIR = ("steps", "careful", "ear", "steps+ear", "careful+ear", "none")


def local(prof: Profile) -> Profile:
    """The profile a window gets on this computer when its cloud reading failed."""
    return DEFAULT if prof.cloud else prof


def for_preset(preset: str) -> Profile:
    if preset == "reshape":
        return CLASSIC
    asked = os.environ.get("ASISTENT_RECOGNITION", "").strip()
    if not asked:
        return CLOUD if cloudasr.available() else DEFAULT
    name, _, fields = asked.partition(":")
    prof = PROFILES.get(name.strip())
    if prof is None or prof is CLASSIC:
        log.warning("recognition: unknown profile %r in ASISTENT_RECOGNITION, using %s", name, DEFAULT.name)
        return DEFAULT
    if fields.strip():
        try:
            given = json.loads(fields)
            if "decode" in given:
                given["decode"] = tuple(sorted((str(k), tuple(v) if isinstance(v, list) else v) for k, v in dict(given["decode"]).items()))
            prof = dataclasses.replace(prof, **given)
            if prof.second not in _SECOND or prof.repair not in _REPAIR:
                raise ValueError(f"second must be one of {_SECOND}, repair one of {_REPAIR}")
        except (ValueError, TypeError) as e:
            log.warning("recognition: bad fields in ASISTENT_RECOGNITION (%s), using %s as it is", e, prof.name)
            prof = PROFILES[name.strip()]
    return prof


def prepare(y: np.ndarray, prof: Profile) -> np.ndarray:
    """What Whisper is given for a window: the sound as recorded unless the profile evens it out first.

    Whisper's answer moves with the input level alone (0.10.95: the same window 3 dB louder or quieter gave a right or a
    wrong line; 2026-11-08: a lavalier at -57 dB RMS gave „500 млн.“ for „500 евро“, the same passage brought to a normal
    level gave „евро“ every time). `level` brings the speech of every window to one level: the gain that puts the loud
    tenth of its 20 ms frames (the vowels) at `level` dBFS, never more than 40 dB up or 12 dB down. What would pass full
    scale is cut off there: at these levels that is a click or a bump, not the voice, and one click must not keep a quiet
    voice quiet. `highpass` first takes out the rumble, which would be raised too.
    Only what is recognised changes: the words are still aligned and checked on the sound as recorded."""
    if prof.level is None and prof.highpass is None:
        return y
    z = np.asarray(y, dtype=np.float64)
    if prof.highpass:
        from scipy.signal import butter, sosfiltfilt
        if len(z) > 64:
            z = sosfiltfilt(butter(2, float(prof.highpass), btype="highpass", fs=SR, output="sos"), z)
    if prof.level is not None:
        n = int(0.02 * SR)
        frames = z[:len(z) // n * n].reshape(-1, n)
        rms = np.sqrt(np.mean(frames ** 2, axis=1)) if len(frames) else np.zeros(0)
        voiced = rms[rms > 1e-5]                               # the silence put between the pieces is not sound
        if len(voiced):
            loud = 20.0 * np.log10(float(np.percentile(voiced, 90)))
            gain = 10.0 ** (float(np.clip(prof.level - loud, -12.0, 40.0)) / 20.0)
            z = np.clip(z * gain, -0.99, 0.99)
    return z.astype(np.float32)
