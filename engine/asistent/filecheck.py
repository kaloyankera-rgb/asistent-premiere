"""After-export check of the exported FILE (TODO I14, the user 2026-11-11: "checking if everything is alright after the video
is done, black bars etc"). Runs by itself on every export the export watcher finds (the user's choice: automatic), read
only, local FFmpeg only.

One FFmpeg pass at low priority (two threads, `nice` on the Mac, so Premiere stays responsive while the editor works) at a
small working size measures:
  * black bars (cropdetect per frame: a run of frames whose picture is smaller than the frame), black frames
    (blackdetect, one frame or more), frozen picture (freezedetect, a second or more of identical frames);
  * sound: true peak and integrated loudness (ebur128, BS.1770), each channel's level (astats: one channel silent, the whole
    sound silent, samples at full scale), silence at the very start and the end (silencedetect);
plus FFprobe's numbers (size, frame rate, codec, bit rate, colour tags) and, when the panel sent them at the export event,
the sequence's own size, frame rate and length to compare with.

Levels: "ok" measured and fine, "info" a number to know (loudness is ALWAYS info: the user's choice, -14 LUFS shown only as
the usual platform level), "check" something to look at, with where. Nothing here is ever an error the editor must fix: a
still end card freezes on purpose, a fade to black is black on purpose. The words say what was measured and where.
"""
from __future__ import annotations

import logging
import math
import os
import re
import shutil
import sys

from .media import _run, _tool

log = logging.getLogger("asistent")

WORK = 640                 # the long side of the working picture (bars are measured in proportion, 2 % ≈ 13 px)
BAR = 0.02                 # a bar is at least 2 % of the frame on one side
BAR_MIN = 0.3              # seconds of bars before they count (one dark frame at a cut is not a bar)
BLACK_MIN = 1 / 30         # blackdetect: one frame at 30 fps
FREEZE_MIN = 1.0           # freezedetect: a second of identical frames
SILENT_START = 0.5         # silence this long at the start is reported (a reel's first half second is its hook)
SILENT_END = 1.0
TRUE_PEAK_MAX = -1.0       # dBFS: above it the platforms' encoders may distort
FULL_SCALE = -0.05         # dBFS sample peak: the sound reached full scale (clipped)
ONE_CHANNEL = 30.0         # dB: a channel this much quieter than the other is "no sound on that side"
SILENT_DB = -60.0          # dBFS RMS: no sound at all
LUFS_TARGET = -14.0        # information only (the user, 2026-11-11)
HDR = ("arib-std-b67", "smpte2084")


def _num(text):
    try:
        v = float(text)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else (-math.inf if v < 0 else None)


def _rate(text):
    if not text or text in ("0/0", "0"):
        return None
    if "/" in text:
        a, b = text.split("/", 1)
        a, b = _num(a), _num(b)
        return a / b if a and b else None
    return _num(text)


def facts(info: dict) -> dict:
    """The numbers the report needs from FFprobe's JSON."""
    streams = info.get("streams") or []
    v = next((s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")),
             None)
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    fmt = info.get("format") or {}
    out = {"duration": _num(fmt.get("duration")) or 0.0, "size": int(_num(fmt.get("size")) or 0),
           "bitrate": _num(fmt.get("bit_rate")), "audio_streams": len(audio), "video": None, "audio": None}
    if v:
        out["video"] = {"width": int(v.get("width") or 0), "height": int(v.get("height") or 0),
                        "fps": _rate(v.get("r_frame_rate")) or _rate(v.get("avg_frame_rate")),
                        "codec": v.get("codec_name") or "?", "pix_fmt": v.get("pix_fmt") or "",
                        "bitrate": _num(v.get("bit_rate")), "transfer": v.get("color_transfer") or "",
                        "primaries": v.get("color_primaries") or ""}
    if audio:
        a = audio[0]
        out["audio"] = {"channels": int(a.get("channels") or 0), "rate": int(_num(a.get("sample_rate")) or 0),
                        "codec": a.get("codec_name") or "?"}
    return out


def work_size(width: int, height: int) -> tuple[int, int]:
    long = max(width, height, 1)
    k = min(1.0, WORK / long)
    even = lambda x: max(2, int(round(x * k / 2)) * 2)      # noqa: E731
    return even(width), even(height)


def command(path: str, f: dict) -> list[str]:
    cmd = [_tool("ffmpeg"), "-hide_banner", "-nostats", "-threads", "2", "-i", path]
    vf = af = None
    if f["video"]:
        w, h = work_size(f["video"]["width"], f["video"]["height"])
        vf = (f"scale={w}:{h},blackdetect=d={BLACK_MIN:.4f}:pix_th=0.10,freezedetect=n=-60dB:d={FREEZE_MIN},"
              "cropdetect=limit=16:round=2:reset=1")
        cmd += ["-map", "0:v:0"]
    if f["audio"]:
        af = f"astats=metadata=0,ebur128=peak=true:framelog=quiet,silencedetect=n=-50dB:d={SILENT_START}"
        cmd += ["-map", "0:a:0"]
    if vf:
        cmd += ["-vf", vf]
    if af:
        cmd += ["-af", af]
    cmd += ["-f", "null", "-"]
    if sys.platform != "win32" and shutil.which("nice"):
        cmd = [shutil.which("nice"), "-n", "10"] + cmd
    return cmd


# ---------------------------------------------------------------- parsing FFmpeg's log (pure)

def _ranges(starts_ends: list[tuple[float, float | None]], end: float) -> list[list[float]]:
    return [[s, e if e is not None else end] for s, e in starts_ends]


def parse(text: str, duration: float, work: tuple[int, int] | None) -> dict:
    """FFmpeg's stderr -> {black, freeze, bars, silence, loudness, true_peak, channels: [{peak, rms}]}."""
    out = {"black": [], "freeze": [], "bars": [], "silence": [], "loudness": None, "lra": None, "true_peak": None,
           "channels": [], "overall_rms": None}
    for m in re.finditer(r"black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)", text):
        out["black"].append([float(m.group(1)), float(m.group(2))])

    fr, open_ = [], None
    for m in re.finditer(r"freezedetect\.freeze_(start|end):\s*([\d.]+)", text):
        if m.group(1) == "start":
            open_ = float(m.group(2))
        elif open_ is not None:
            fr.append((open_, float(m.group(2))))
            open_ = None
    if open_ is not None:
        fr.append((open_, None))
    out["freeze"] = _ranges(fr, duration)

    si, open_ = [], None
    for m in re.finditer(r"silence_(start|end):\s*(-?[\d.]+)", text):
        if m.group(1) == "start":
            open_ = max(0.0, float(m.group(2)))
        elif open_ is not None:
            si.append((open_, float(m.group(2))))
            open_ = None
    if open_ is not None:
        si.append((open_, None))
    out["silence"] = _ranges(si, duration)

    summary = text[text.rfind("Summary:"):] if "Summary:" in text else ""
    m = re.search(r"I:\s*(-?[\d.]+|-inf)\s*LUFS", summary)
    out["loudness"] = _num(m.group(1)) if m else None
    m = re.search(r"LRA:\s*(-?[\d.]+)\s*LU", summary)
    out["lra"] = _num(m.group(1)) if m else None
    m = re.search(r"True peak:\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS", summary, re.S)
    out["true_peak"] = _num(m.group(1)) if m else None

    # astats: "Channel: N" blocks, then "Overall"
    block = None
    for line in text.splitlines():
        if "Parsed_astats" not in line:
            continue
        body = line.split("]", 1)[-1].strip()
        if body.startswith("Channel:"):
            block = {"peak": None, "rms": None}
            out["channels"].append(block)
        elif body.startswith("Overall"):
            block = "overall"
        elif body.startswith("Peak level dB:") and isinstance(block, dict):
            block["peak"] = _num(body.split(":", 1)[1])
        elif body.startswith("RMS level dB:"):
            v = _num(body.split(":", 1)[1])
            if isinstance(block, dict):
                block["rms"] = v
            elif block == "overall":
                out["overall_rms"] = v

    if work:
        out["bars"] = bars(text, work, out["black"])
    return out


def bars(text: str, work: tuple[int, int], black: list[list[float]]) -> list[dict]:
    """Runs of frames whose picture is smaller than the frame: [{start, end, sides: top/bottom|left/right|all}]."""
    W, H = work
    frames = []
    for m in re.finditer(r"x1:(-?\d+) x2:(-?\d+) y1:(-?\d+) y2:(-?\d+) w:(-?\d+) h:(-?\d+).*?t:([\d.]+)", text):
        x1, x2, y1, y2, w, h = (int(m.group(i)) for i in range(1, 7))
        t = float(m.group(7))
        if w <= 0 or h <= 0 or any(b[0] - 0.01 <= t <= b[1] + 0.01 for b in black):
            frames.append((t, None))                  # a black frame: no picture to measure, it is reported as black
            continue
        top, bottom, left, right = y1 / H, (H - 1 - y2) / H, x1 / W, (W - 1 - x2) / W
        tb = top >= BAR or bottom >= BAR
        lr = left >= BAR or right >= BAR
        frames.append((t, "all" if tb and lr else "top/bottom" if tb else "left/right" if lr else ""))
    runs, cur = [], None
    step = (frames[1][0] - frames[0][0]) if len(frames) > 1 else 1 / 30
    for t, side in frames:
        if side is None:
            continue
        if side and cur and cur["sides"] == side and t - cur["end"] <= max(0.2, 2 * step):
            cur["end"] = t + step
        elif side:
            cur = {"start": t, "end": t + step, "sides": side}
            runs.append(cur)
        else:
            cur = None
    return [r for r in runs if r["end"] - r["start"] >= BAR_MIN]


# ---------------------------------------------------------------- the report (pure)

def fps_text(fps) -> str:
    return f"{fps:.2f}".rstrip("0").rstrip(".") if fps else "?"


def clock(t: float) -> str:
    t = max(0.0, t)
    return f"{int(t // 60)}:{t % 60:04.1f}"


def span(a: float, b: float) -> str:
    return f"{clock(a)}-{clock(b)}"


def report(f: dict, m: dict | None, expect: dict | None = None) -> dict:
    """{status: fine|look, summary, lines: [{level: ok|info|check, text}]}."""
    lines = []
    add = lambda level, text: lines.append({"level": level, "text": text})   # noqa: E731
    v, a, dur = f["video"], f["audio"], f["duration"]
    mb = f["size"] / 1e6
    add("ok", f"The file is complete: {clock(dur)}, {mb:.1f} MB.")

    if v:
        rate = fps_text(v["fps"])
        br = v["bitrate"] or f["bitrate"]
        add("info", f"{v['width']}x{v['height']}, {rate} fps, {v['codec'].upper()}" + (f", {br / 1e6:.1f} Mb/s" if br else "") +
            (f", {v['transfer']}" if v["transfer"] else ""))
        if v["transfer"] in HDR:
            add("check", f"The colour is HDR ({v['transfer']}): phones and the platforms show it differently from Rec.709.")
    else:
        add("check", "There is no picture in the file (sound only).")

    if expect:
        name = expect.get("name") or "the sequence"
        ew, eh, efps = expect.get("width"), expect.get("height"), expect.get("fps")
        if v and ew and eh and v["width"] and v["height"]:
            if abs(v["width"] / v["height"] - ew / eh) > 0.01:
                add("check", f"The file is {v['width']}x{v['height']}, “{name}” is {ew}x{eh}: a different shape.")
            elif (v["width"], v["height"]) != (ew, eh):
                add("info", f"“{name}” is {ew}x{eh}: the file is scaled to {v['width']}x{v['height']}.")
        if v and efps and v["fps"] and abs(v["fps"] - efps) > 0.01:
            add("check", f"The file plays at {fps_text(v['fps'])} fps, “{name}” at {fps_text(efps)} fps.")
        want = [x for x in (expect.get("duration"), expect.get("range")) if x]
        frame = 1.5 / (v["fps"] if v and v["fps"] else 30)
        if want and all(abs(dur - x) > max(0.1, frame) for x in want):
            add("check", f"The file is {clock(dur)} long, “{name}” {clock(want[0])}" +
                (f" (In to Out {clock(want[1])})" if len(want) > 1 else "") + ".")

    if m is None:
        add("check", "The picture and sound could not be measured (FFmpeg stopped).")
    else:
        if v:
            if m["bars"]:
                for b in m["bars"][:4]:
                    where = "the whole video" if b["start"] <= 0.2 and b["end"] >= dur - 0.2 else span(b["start"], b["end"])
                    sides = "on all sides" if b["sides"] == "all" else ("top and bottom" if b["sides"] == "top/bottom"
                                                                          else "left and right")
                    add("check", f"Black bars {sides}: {where} (or a very dark edge).")
                if len(m["bars"]) > 4:
                    add("check", f"… and {len(m['bars']) - 4} more places with bars.")
            else:
                add("ok", "No black bars.")
            black = m["black"]
            if black:
                for b in black[:4]:
                    n = b[1] - b[0]
                    what = "at the start" if b[0] <= 0.01 else "at the end (a fade?)" if b[1] >= dur - 0.1 else "in the middle"
                    add("check", f"Black picture {what}: {span(b[0], b[1])} ({n:.2f} s).")
                if len(black) > 4:
                    add("check", f"… and {len(black) - 4} more black places.")
            else:
                add("ok", "No black frames.")
            freeze = [r for r in m["freeze"] if not any(b[0] <= r[0] and r[1] <= b[1] + 0.05 for b in m["black"])]
            if freeze:
                for r in freeze[:4]:
                    add("check", f"The picture stands still {span(r[0], r[1])} ({r[1] - r[0]:.1f} s): a still on purpose, "
                                 "or a frozen clip?")
            else:
                add("ok", "No frozen picture.")

        if not a:
            add("check", "There is no sound in the file.")
        else:
            ch = m["channels"]
            rms = m["overall_rms"]
            if rms is None or rms == -math.inf or rms < SILENT_DB:
                add("check", "The sound is silent.")
            else:
                if len(ch) == 2 and all(c["rms"] is not None for c in ch):
                    l, r = ch[0]["rms"], ch[1]["rms"]
                    if r == -math.inf or (l != -math.inf and l - r > ONE_CHANNEL):
                        add("check", "Sound only on the left channel: the right is silent.")
                    elif l == -math.inf or r - l > ONE_CHANNEL:
                        add("check", "Sound only on the right channel: the left is silent.")
                tp = m["true_peak"]
                if tp is not None and tp > TRUE_PEAK_MAX:
                    add("check", f"True peak {tp:+.1f} dBFS: above {TRUE_PEAK_MAX:.0f} dBFS, the platforms' encoding may distort it.")
                elif tp is not None:
                    add("ok", f"True peak {tp:.1f} dBFS.")
                if any(c["peak"] is not None and c["peak"] >= FULL_SCALE for c in ch):
                    add("check", "The sound reaches full scale (0 dBFS): it is probably clipped somewhere.")
                lu = m["loudness"]
                if lu is not None and lu != -math.inf:
                    add("info", f"Loudness {lu:.1f} LUFS ({lu - LUFS_TARGET:+.1f} LU from {LUFS_TARGET:.0f}, the usual platform level; "
                                "information only).")
                for s in m["silence"]:
                    if s[0] <= 0.01 and s[1] - s[0] >= SILENT_START and s[1] < dur - 0.1:
                        add("check", f"Silence for the first {s[1]:.1f} s.")
                    elif s[1] >= dur - 0.1 and s[1] - s[0] >= SILENT_END and s[0] > 0.01:
                        add("info", f"Silence for the last {s[1] - s[0]:.1f} s.")

    checks = sum(1 for x in lines if x["level"] == "check")
    summary = "everything measured looks fine" if not checks else f"{checks} {'thing' if checks == 1 else 'things'} to look at"
    return {"status": "look" if checks else "fine", "summary": summary, "lines": lines}


def run(path: str, expect: dict | None = None, cancelled=None) -> dict:
    """Probe and measure one exported file. Never raises for a bad file: the report says what could not be measured."""
    from .settle import probe
    info = probe(path)
    if not info:
        return {"status": "look", "summary": "the file could not be read",
                "lines": [{"level": "check", "text": "FFprobe could not read the file."}]}
    f = facts(info)
    work = work_size(f["video"]["width"], f["video"]["height"]) if f["video"] else None
    try:
        p = _run(command(path, f), cancelled=cancelled)
        text = (p.stderr or b"").decode("utf-8", "replace")
        m = parse(text, f["duration"], work) if p.returncode == 0 else None
        if m is None:
            log.warning("after-export check: ffmpeg %s on %s: %s", p.returncode, os.path.basename(path), text[-400:])
    except Exception as e:                       # MediaError (timeout), Interrupted: the report says so
        log.warning("after-export check of %s stopped: %s", os.path.basename(path), e)
        m = None
    return report(f, m, expect)
