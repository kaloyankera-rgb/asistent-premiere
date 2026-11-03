"""Smart Audio Assistant: what is on the L and R channels of a clip, how to route them, how loud to make it.

Routing is only ever done with Premiere's own "Fill Left with Right" / "Fill Right with Left" effects,
so channels are never summed (no phase cancellation) and the source file is never touched.

Kinds (per clip, measured on the part used in the timeline):
  one_channel     only one channel carries sound (movable lavalier, unplugged input) -> use that side
  dual_mono       both channels identical -> nothing to route
  safety          same signal, one channel quieter (safety track) -> use the louder unless it clips
  phase_inverted  same signal, opposite polarity -> use one side, never both
  stereo_mic      a stereo/camera microphone -> leave as is
  same_voice      one voice on both, the second mic farther away (it never leads) -> use the leading side
  two_mics        two independent microphones (two lavaliers, one per person) -> split into L/L and R/R
  uncertain       none of the above for sure -> ask the editor

Loudness: ITU-R BS.1770 / EBU R128 integrated loudness of what will actually play. Gain moves it towards
the target, but the (4x oversampled) peak never goes above the ceiling (-6 dBFS by default): no
compression, no limiting.
"""
from __future__ import annotations

import os
import subprocess
import sys

import numpy as np
from scipy import signal

from .media import MediaError, _run, _tool, probe

SR = 48000
TARGET_LUFS = -17.0
PEAK_CEILING = -6.0
MAX_GAIN = 30.0
NOISE_MAX = -55.0      # dBFS: a boost may not lift the room noise above this


# ---------------------------------------------------------------- reading

def read_range(path: str, start: float = 0.0, end: float | None = None, sr: int = SR) -> np.ndarray:
    """First audio stream, all channels, float32 (channels, samples), only [start, end) of the media."""
    info = probe(path)
    if not info.audio:
        raise MediaError(f"{os.path.basename(path)} няма звук.")
    ch = info.audio[0].channels
    cmd = [_tool("ffmpeg"), "-v", "error", "-nostdin"]
    if start > 0:
        cmd += ["-ss", f"{start:.6f}"]
    cmd += ["-i", path, "-map", "0:a:0"]
    if end is not None and end > start:
        cmd += ["-t", f"{end - start:.6f}"]
    cmd += ["-ar", str(sr), "-ac", str(ch), "-f", "f32le", "-"]
    p = _run(cmd)
    if p.returncode != 0:
        raise MediaError(f"FFmpeg не може да прочете звука на {os.path.basename(path)}: "
                         f"{p.stderr.decode(errors='replace').strip()[:200]}")
    x = np.frombuffer(p.stdout, dtype=np.float32)
    n = len(x) // ch
    return x[: n * ch].reshape(n, ch).T.copy()


# ---------------------------------------------------------------- measurements

def _db(v: float) -> float:
    return float(20 * np.log10(max(v, 1e-12)))


def _k_filter(fs: int):
    """BS.1770 K-weighting as two biquads (high shelf + high pass), for any sample rate."""
    # stage 1: high shelf
    f0, g, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = np.tan(np.pi * f0 / fs)
    vh = 10 ** (g / 20)
    vb = vh ** 0.4996667741545416
    a0 = 1 + k / q + k * k
    b1 = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    a1 = [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    # stage 2: high pass
    f0, q = 38.13547087602444, 0.5003270373238773
    k = np.tan(np.pi * f0 / fs)
    a0 = 1 + k / q + k * k
    b2 = [1, -2, 1]
    a2 = [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    return (b1, a1), (b2, a2)


def loudness(channels: list[np.ndarray], fs: int = SR) -> float:
    """Integrated loudness (LUFS) of the channels as they play (L and R weight 1)."""
    (b1, a1), (b2, a2) = _k_filter(fs)
    zs = []
    block, step = int(0.4 * fs), int(0.1 * fs)
    for x in channels:
        y = signal.lfilter(b2, a2, signal.lfilter(b1, a1, x.astype(np.float64)))
        if len(y) < block:
            zs.append(np.array([np.mean(y ** 2)]) if len(y) else np.array([0.0]))
            continue
        idx = np.arange(0, len(y) - block + 1, step)
        c = np.concatenate([[0.0], np.cumsum(y ** 2)])
        zs.append((c[idx + block] - c[idx]) / block)
    n = min(len(z) for z in zs)
    z = sum(zz[:n] for zz in zs)
    lk = -0.691 + 10 * np.log10(z + 1e-20)
    z = z[lk > -70]                                         # absolute gate
    if not len(z):
        return -70.0
    rel = -0.691 + 10 * np.log10(np.mean(z)) - 10           # relative gate
    z = z[-0.691 + 10 * np.log10(z) > rel]
    return float(-0.691 + 10 * np.log10(np.mean(z))) if len(z) else -70.0


def true_peak(x: np.ndarray) -> float:
    """Peak in dBFS after 4x oversampling (close to a true-peak meter)."""
    if not len(x):
        return -120.0
    return _db(float(np.max(np.abs(signal.resample_poly(x.astype(np.float64), 4, 1)))))


_SOS = signal.butter(4, [100, 4000], btype="band", fs=SR, output="sos")


def _frames_db(x: np.ndarray, hop: int = int(0.02 * SR)) -> np.ndarray:
    y = signal.sosfilt(_SOS, x.astype(np.float64))
    n = len(y) // hop
    if n == 0:
        return np.array([-120.0])
    e = np.mean(y[: n * hop].reshape(n, hop) ** 2, axis=1)
    return 10 * np.log10(e + 1e-14)


def _activity(f_db: np.ndarray) -> np.ndarray:
    floor = np.percentile(f_db, 10)
    return (f_db > floor + 10) & (f_db > -65)


def _corr(l: np.ndarray, r: np.ndarray, max_lag_ms: float = 10.0) -> tuple[float, float]:
    """Strongest normalised correlation within +/- max_lag (sign kept), and its lag in ms."""
    a = signal.resample_poly(signal.sosfilt(_SOS, l.astype(np.float64)), 1, 3)   # 16 kHz
    b = signal.resample_poly(signal.sosfilt(_SOS, r.astype(np.float64)), 1, 3)
    den = np.sqrt(np.dot(a, a) * np.dot(b, b))
    if den <= 0:
        return 0.0, 0.0
    m = int(max_lag_ms * 16)
    best, lag = 0.0, 0
    for k in range(-m, m + 1):
        v = np.dot(a[max(0, k): len(a) + min(0, k)], b[max(0, -k): len(b) - max(0, k)]) / den
        if abs(v) > abs(best):
            best, lag = v, k
    return float(best), lag / 16.0


def _channel_stats(x: np.ndarray, f_db: np.ndarray, act: np.ndarray) -> dict:
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    speech_db = float(10 * np.log10(np.mean(10 ** (f_db[act] / 10)) + 1e-14)) if act.any() else -120.0
    return {
        "speech_db": round(speech_db, 1),
        "peak_db": round(_db(peak), 1),
        "clipped": float(np.mean(np.abs(x) >= 0.999)) if len(x) else 0.0,
        "active": round(float(np.mean(act)), 3),
        "silent": peak < 10 ** (-90 / 20),
    }


# ---------------------------------------------------------------- decisions

def classify(x: np.ndarray) -> dict:
    """x: (channels, samples). Returns kind, confidence, the proposed action and the evidence."""
    if x.shape[0] == 1:
        return {"kind": "mono", "confidence": "high", "action": "none", "evidence": {},
                "reasons": ["Клипът е моно: няма какво да се разпределя."]}
    l, r = x[0], x[1]
    fl, fr = _frames_db(l), _frames_db(r)
    al, ar = _activity(fl), _activity(fr)
    sl, sr_ = _channel_stats(l, fl, al), _channel_stats(r, fr, ar)
    corr, lag = _corr(l, r)
    diff = sl["speech_db"] - sr_["speech_db"]
    both = al | ar
    dom_l = float(np.mean((fl - fr)[both] >= 10)) if both.any() else 0.0
    dom_r = float(np.mean((fr - fl)[both] >= 10)) if both.any() else 0.0
    ev = {"L": sl, "R": sr_, "corr": round(corr, 3), "lag_ms": round(lag, 2), "level_diff_db": round(diff, 1),
          "dominant_L": round(dom_l, 3), "dominant_R": round(dom_r, 3)}
    louder = "use_left" if diff >= 0 else "use_right"
    side = lambda a: "ляв" if a == "use_left" else "десен"   # noqa: E731

    def out(kind, conf, action, *reasons):
        return {"kind": kind, "confidence": conf, "action": action, "evidence": ev, "reasons": list(reasons)}

    if not (al.any() or ar.any()):
        return out("silent", "high", "none", "В клипа няма говор: нищо не е пипано.")
    if sl["silent"] or sr_["silent"] or abs(diff) >= 30:
        act = "use_right" if (sl["silent"] or diff <= -30) else "use_left"
        return out("one_channel", "high", act,
                   f"Звук има само в {side(act)}ия канал (другият е с {abs(diff):.0f} dB по-тих или празен).")
    if corr >= 0.98 and abs(diff) < 1:
        return out("dual_mono", "high", "none", "Двата канала са еднакви: звукът вече е в центъра.")
    if corr <= -0.9:
        return out("phase_inverted", "high", louder,
                   "Каналите са еднакви, но с обърната фаза: ползва се само единият, иначе се изличават.")
    if corr >= 0.9 and abs(diff) >= 3:
        main, other = (sl, sr_) if diff > 0 else (sr_, sl)
        act = louder
        if main["clipped"] > 1e-4 and other["clipped"] <= 1e-5:
            act = "use_right" if louder == "use_left" else "use_left"
            return out("safety", "high", act, f"Единият канал е копие за безопасност с {abs(diff):.0f} dB "
                       f"по-ниско ниво; основният клипира, затова се ползва копието ({side(act)}ия).")
        return out("safety", "high", act, f"Единият канал е копие за безопасност с {abs(diff):.0f} dB по-ниско "
                   f"ниво: ползва се основният ({side(act)}ия).")
    if corr >= 0.6:
        return out("stereo_mic", "medium", "none",
                   "Прилича на стерео микрофон (камера): оставен е както е.")
    lead = max(dom_l, dom_r)
    if lead >= 0.2 and min(dom_l, dom_r) <= 0.1:
        act = "use_left" if dom_l > dom_r else "use_right"
        return out("same_voice", "high", act,
                   f"Двата канала чуват един и същ глас: {side(act)}ият води в {lead:.0%} от говора, другият почти "
                   f"никога (същият глас от по-далеч, {abs(lag):.1f} ms по-късно). Ползва се само {side(act)}ият, "
                   "иначе се чува двойно.")
    # two people, each with their own mic: both channels carry speech and each one leads a real share
    if corr < 0.5 and dom_l >= 0.15 and dom_r >= 0.15 and sl["active"] >= 0.15 and sr_["active"] >= 0.15:
        return out("two_mics", "high", "split",
                   f"Два отделни микрофона: ляв води в {dom_l:.0%}, десен в {dom_r:.0%} от говора. "
                   "Разделят се на две моно писти (L/L и R/R).")
    return out("uncertain", "low", "ask",
               "Не съм сигурен дали това са два микрофона или един: избери ръчно (Раздели L/R, Само L, Само R).")


def outputs_for(x: np.ndarray, action: str) -> list[tuple[str, list[np.ndarray]]]:
    """What will play after routing: (route, channels) per resulting clip."""
    if x.shape[0] == 1:
        return [("as_is", [x[0], x[0]])]
    l, r = x[0], x[1]
    return {
        "use_left": [("LL", [l, l])],
        "use_right": [("RR", [r, r])],
        "split": [("LL", [l, l]), ("RR", [r, r])],
    }.get(action, [("as_is", [l, r])])


def gain_for(chs: list[np.ndarray], target: float, ceiling: float) -> dict:
    lufs = loudness(chs)
    peak = max(true_peak(c) for c in chs)
    if lufs <= -69:
        return {"lufs": None, "peak_db": round(peak, 1), "gain_db": 0.0, "limited_by_peak": False,
                "note": "Няма говор за измерване: силата не е пипана."}
    want = target - lufs
    room = ceiling - peak
    # a boost may not lift the room noise above NOISE_MAX (near-silent clips would only get louder hiss)
    noise_db = float(np.percentile(_frames_db(np.mean([c.astype(np.float64) for c in chs], axis=0)), 10))
    noise_room = NOISE_MAX - noise_db
    gain = float(np.clip(min(want, room), -MAX_GAIN, MAX_GAIN))
    by_noise = gain > 0 and gain > noise_room
    if by_noise:
        gain = max(0.0, noise_room)
    res = {"lufs": round(lufs, 1), "peak_db": round(peak, 1), "gain_db": round(gain, 1),
           "limited_by_peak": room < want, "result_lufs": round(lufs + gain, 1),
           "result_peak_db": round(peak + gain, 1)}
    if by_noise:
        res["note"] = (f"Вдигнато само с {gain:+.1f} dB: повече би вдигнало шума на стаята над {NOISE_MAX:.0f} dBFS "
                       f"(шумът е {noise_db:.0f} dBFS).")
        res["limited_by_noise"] = True
    elif room < want:
        res["note"] = (f"Вдигнато само с {gain:+.1f} dB, за да не мине пикът {ceiling:.0f} dB; до {target:.0f} LUFS "
                       f"липсват {want - room:.1f} dB (за повече трябва компресия, не е приложена).")
    return res


# ---------------------------------------------------------------- phrase leveling

PHRASE_GAP = 0.35      # s of quiet that ends a phrase
PHRASE_MIN = 0.4       # shorter bits follow their neighbour's level
DEADBAND = 4.0         # dB: natural phrase-to-phrase dynamics; only what goes beyond it is corrected
MAX_DEV = 6.0          # dB: never move a phrase more than this away from the clip level
MIN_STEP = 1.0         # dB: smaller corrections are inaudible and only add keyframes
RAMP = 0.2             # s: level changes glide inside the pause between phrases


def _phrases(act: np.ndarray, hop_s: float) -> list[tuple[int, int]]:
    regions, i, n = [], 0, len(act)
    while i < n:
        if act[i]:
            j = i
            while j < n and act[j]:
                j += 1
            regions.append([i, j])
            i = j
        else:
            i += 1
    merged = []
    for r in regions:
        if merged and (r[0] - merged[-1][1]) * hop_s < PHRASE_GAP:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [tuple(r) for r in merged]


def phrase_plan(chs: list[np.ndarray], base: float, target: float, ceiling: float, offset: float = 0.0,
                fs: int = SR) -> dict:
    """Level differences between phrases and the Volume keyframes that even them out.

    Keyframes are [(media time s, gain dB)], gain = clip level + this phrase's correction. Empty when
    nothing needs correcting.
    """
    hop = int(0.02 * fs)
    mono = np.mean([c.astype(np.float64) for c in chs], axis=0)
    f_db = _frames_db(mono, hop)
    act = _activity(f_db)
    noise_db = float(np.percentile(f_db, 10))
    (b1, a1), (b2, a2) = _k_filter(fs)
    kp = None
    for c in chs:
        y = signal.lfilter(b2, a2, signal.lfilter(b1, a1, c.astype(np.float64)))
        n = len(y) // hop
        p = np.mean(y[: n * hop].reshape(n, hop) ** 2, axis=1)
        kp = p if kp is None else kp[: len(p)] + p[: len(kp)]
    m = min(len(kp), len(act))
    kp, act = kp[:m], act[:m]
    hop_s = hop / fs
    regions = _phrases(act, hop_s)
    phrases = []
    for a, b in regions:
        sel = act[a:b]
        lufs = -0.691 + 10 * np.log10(np.mean(kp[a:b][sel]) + 1e-20)
        peak = max(true_peak(c[a * hop: b * hop]) for c in chs)
        phrases.append({"start": a * hop_s, "end": b * hop_s, "lufs": float(lufs), "peak": float(peak)})
    long = [p for p in phrases if p["end"] - p["start"] >= PHRASE_MIN]
    spread = float(np.percentile([p["lufs"] for p in long], 90) - np.percentile([p["lufs"] for p in long], 10)) \
        if len(long) >= 3 else 0.0

    # each phrase moves towards the clip's own loudness; the clip level itself is the base gain's job
    clip_lufs = loudness(chs, fs)
    prev = 0.0
    for p in phrases:
        if p["end"] - p["start"] < PHRASE_MIN:
            p["dev"] = prev
            continue
        diff = clip_lufs - p["lufs"]
        # only the part beyond natural dynamics: a phrase 10 dB down comes up 6 dB, one 3 dB down stays
        dev = float(np.sign(diff) * max(0.0, abs(diff) - DEADBAND))
        dev = float(np.clip(dev, -MAX_DEV, MAX_DEV))
        if abs(dev) < MIN_STEP:
            dev = 0.0
        dev = min(dev, ceiling - (p["peak"] + base))                      # peak ceiling
        if dev > 0:
            dev = min(dev, max(0.0, NOISE_MAX - (noise_db + base)))       # do not lift the room noise
        p["dev"] = round(dev, 1)
        prev = p["dev"]

    keys = []
    if any(p["dev"] for p in phrases):
        keys.append((offset, round(base + phrases[0]["dev"], 1)))
        for p, q in zip(phrases, phrases[1:]):
            if p["dev"] == q["dev"]:
                continue
            gap = q["start"] - p["end"]
            mid = (p["end"] + q["start"]) / 2
            r = min(RAMP, 0.8 * gap)
            keys.append((round(offset + mid - r / 2, 3), round(base + p["dev"], 1)))
            keys.append((round(offset + mid + r / 2, 3), round(base + q["dev"], 1)))
    return {"spread_db": round(spread, 1), "phrases": len(long), "keyframes": keys,
            "moved": sum(1 for p in phrases if p["dev"]),
            "noise_db": round(noise_db, 1)}


def apply_keyframes(x: np.ndarray, keys: list[tuple[float, float]], offset: float = 0.0, fs: int = SR) -> np.ndarray:
    """The gain curve of the keyframes (linear interpolation in dB) applied to a signal: for checks."""
    t = offset + np.arange(len(x)) / fs
    kt = np.array([k[0] for k in keys])
    kv = np.array([k[1] for k in keys])
    return x * 10 ** (np.interp(t, kt, kv) / 20)


_KINDS = {"same_voice": "един глас от два микрофона", "one_channel": "звук само в единия канал", "dual_mono": "еднакви канали",
          "safety": "копие за безопасност", "phase_inverted": "обърната фаза", "stereo_mic": "стерео микрофон",
          "two_mics": "два микрофона", "uncertain": "несигурно", "silent": "без говор", "mono": "моно"}


def analyze_item(path: str, start: float = 0.0, end: float | None = None, force: str | None = None,
                 target: float = TARGET_LUFS, ceiling: float = PEAK_CEILING, phrases: bool = False) -> dict:
    x = read_range(path, start, end)
    c = classify(x)
    # "split_all": the user's own workflow (2026-11-03): every stereo clip becomes L/L + R/R, whatever the analysis
    # thinks (their reference clip C0737 measures as one voice on two mics, and they split it by hand). The analysis
    # is then only information, and the levels of the two tracks are set so their sum stays under the ceiling.
    if force == "split_all":
        if x.shape[0] >= 2:
            if c["kind"] != "two_mics":
                # the analysis' own reasons are worded as its decision ("оставен е както е"): only say what it saw
                c["reasons"] = [f"Разделено на L/L и R/R. За сведение: анализът вижда {_KINDS.get(c['kind'], c['kind'])}."]
            force = "split"
        else:
            force = None
        split_all = True
    else:
        split_all = False
    action = force or c["action"]
    # splitting is only for two independent microphones: one sound on two tracks plays twice
    refused = force == "split" and not split_all and c["kind"] not in ("two_mics", "uncertain")
    if refused:
        action = c["action"] if c["action"] in ("use_left", "use_right") else "none"
    if force and not refused and not split_all:
        chosen = {"use_left": "Само L", "use_right": "Само R", "split": "Раздели L/R", "none": "Само сила"}
        auto = {"use_left": "Само L", "use_right": "Само R", "split": "Раздели L/R", "none": "без разпределяне",
                "ask": "да пита"}.get(c["action"], c["action"])
        kinds = _KINDS
        lines = [f"Избрано ръчно: {chosen.get(force, force)}."]
        if force != c["action"]:
            lines.append(f"За сведение: анализът вижда {kinds.get(c['kind'], c['kind'])} и сам би избрал {auto}.")
        c["reasons"] = lines
    if refused:
        why = ("в единия канал няма звук" if c["kind"] in ("one_channel", "silent")
               else "двата канала носят един и същ звук и на две писти ще се чува двойно")
        c["reasons"] = [f"Не е разделено: {why}."] + c["reasons"]
    ev = c.get("evidence") or {}
    clipped = [k for k in ("L", "R") if ev.get(k, {}).get("clipped", 0) > 1e-4]
    if clipped:
        c["reasons"].append(f"Записът е клипирал ({' и '.join(clipped)}): по-ниска сила не поправя изкривяването.")
    outs = []
    if action != "ask":
        for route, chs in outputs_for(x, action):
            g = gain_for(chs, target, ceiling)
            g["route"] = route
            outs.append(g)
    if action == "split" and len(outs) == 2 and all(o["lufs"] is not None for o in outs):
        # the two tracks play together: their sum must stay under the ceiling as well
        mix = x[0] * 10 ** (outs[0]["gain_db"] / 20) + x[1] * 10 ** (outs[1]["gain_db"] / 20)
        over = true_peak(mix) - ceiling
        if over > 0:
            for o in outs:
                o["gain_db"] = round(o["gain_db"] - over, 1)
                o["result_lufs"] = round(o["result_lufs"] - over, 1)
                o["result_peak_db"] = round(o["result_peak_db"] - over, 1)
                o["limited_by_peak"] = True
            c["reasons"].append(f"Двете писти заедно минаваха {ceiling:.0f} dB: и двете са свалени с {over:.1f} dB.")
    # phrase leveling: always measured (to suggest it), keyframes only when asked for
    for (route, chs), o in zip(outputs_for(x, action) if action != "ask" else [], outs):
        if o["lufs"] is None:
            continue
        plan = phrase_plan(chs, o["gain_db"], target, ceiling, start)
        o["spread_db"] = plan["spread_db"]
        if phrases:
            o["keyframes"] = plan["keyframes"]
            o["phrases_moved"] = plan["moved"]
    if phrases and action == "split" and len(outs) == 2 and all(o.get("keyframes") for o in outs):
        mix = sum(apply_keyframes(ch, o["keyframes"], start) for ch, o in zip(x[:2], outs))
        over = true_peak(mix) - ceiling
        if over > 0:
            for o in outs:
                o["keyframes"] = [(t, round(g - over, 1)) for t, g in o["keyframes"]]
    if not phrases:
        spread = max((o.get("spread_db", 0) for o in outs), default=0)
        if spread >= 6:
            c["reasons"].append(f"Силата между фразите варира с {spread:.0f} dB: пробвай „Изравни фразите“.")
    return {"path": path, "name": os.path.basename(path), "start": start, "end": end,
            **c, "action": action, "auto_action": c["action"], "outputs": outs}



def analyze_items(items: list[dict], force: str | None = None, target: float = TARGET_LUFS,
                  ceiling: float = PEAK_CEILING, progress=None, cancel=None, phrases: bool = False) -> dict:
    """Many timeline clips at once (threads: FFmpeg and NumPy release the GIL)."""
    from concurrent.futures import ThreadPoolExecutor
    from .sync import Cancelled
    progress = progress or (lambda f, m: None)
    done = [0]

    def one(it):
        if cancel and cancel():
            raise Cancelled()
        try:
            r = analyze_item(it["path"], float(it.get("start") or 0.0),
                             float(it["end"]) if it.get("end") is not None else None,
                             it.get("force") or force, target, ceiling, phrases)
        except MediaError as e:
            r = {"path": it["path"], "name": os.path.basename(it["path"]), "error": str(e), "outputs": []}
        done[0] += 1
        progress(done[0] / len(items), f"Слушам {done[0]} от {len(items)}")
        return r

    with ThreadPoolExecutor(max_workers=max(2, min(8, (os.cpu_count() or 4) - 2))) as pool:
        results = list(pool.map(one, items))
    return {"items": results, "target_lufs": target, "ceiling_db": ceiling}


if __name__ == "__main__":
    import json
    print(json.dumps(analyze_item(sys.argv[1], *(float(v) for v in sys.argv[2:4])), ensure_ascii=False, indent=1))
