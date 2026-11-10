#!/usr/bin/env python3
"""Measure a client's subtitle style (and graded colour) from its exported videos, for a new Style preset.

  measure_style.py frames  <video folder> <work>   frames at 8 a second (540 px wide) + the Mac's text recognition
  measure_style.py chunks  <work> [--skip v6 ...] [--latin]  subtitle chunks: text, times, lines, position, size, accent colour + summary
  measure_style.py asr     <work>                  Asistent's Whisper on each video's sound (word times; slow on the CPU)
  measure_style.py timing  <work>                  when a chunk appears / goes compared with its words
  measure_style.py compare <work> <preset> [k=v …] a preset on the editors' own speech against their chunks (try values: line_chars=18)
  measure_style.py colour  <video folder> <work>   where the grade ends: skin, mid-tones, white balance, contrast, saturation
  measure_style.py pace    <video folder> <work>   cuts and mean shot length, loudness (LUFS), loudness range, true peak

How GStroy and Credissimo were measured (docs/SUBTITLE_STYLES/). The video folder is only read (the office share: never write,
move or delete there); everything goes into <work>, which must be outside the repo: client words and frames are private.
Videos are named v<N> after "Видео N" in the file name. Font weight and shadow are measured by hand (see the style docs:
width / cap-height and stem thickness against Montserrat's weights with CoreText; darkening around the letters over a bright
background). Run with the engine's Python: "<app>/venv/bin/python" scripts/measure_style.py …
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter
from difflib import SequenceMatcher

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "engine"))
from asistent import subtitles as Sb  # noqa: E402

FPS = 8
LATIN = False          # chunks --latin: count Latin capitals as subtitle text too
UPPER = re.compile(r"[^0-9А-ЯЁЪЬЮЯA-Z\- ]")


def norm(t: str) -> str:
    return UPPER.sub("", t.upper()).strip()


def videos(folder: str) -> list[tuple[str, str]]:
    out = []
    for f in sorted(os.listdir(folder)):
        m = re.search(r"Видео (\d+)", f)
        if f.lower().endswith((".mp4", ".mov")) and m:
            tag = f"v{m.group(1)}"
            n = sum(1 for t, _ in out if t == tag or t.startswith(tag + "_"))
            out.append((tag if not n else f"{tag}_{n + 1}", os.path.join(folder, f)))   # one video in several sizes: v3, v3_2, v3_3
    return out


# ---------------------------------------------------------------- frames + text recognition

def cmd_frames(a):
    from asistent import ocr
    os.makedirs(a.work, exist_ok=True)
    index = videos(a.folder)
    json.dump(index, open(os.path.join(a.work, "index.json"), "w"), ensure_ascii=False, indent=1)
    for tag, path in index:
        d = os.path.join(a.work, "frames", tag)
        os.makedirs(d, exist_ok=True)
        subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-vf", f"fps={FPS},scale=540:-2", "-q:v", "3",
                        os.path.join(d, "%05d.jpg")], check=True)
        files = sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".jpg"))
        rows = []
        for i in range(0, len(files), 100):
            rows += ocr.read(files[i:i + 100])
        json.dump({"files": files, "ocr": rows}, open(os.path.join(a.work, f"ocr_{tag}.json"), "w"), ensure_ascii=False)
        print(tag, len(files), "frames", flush=True)


# ---------------------------------------------------------------- chunks

def _is_sub(o) -> bool:
    t = o["text"].strip()
    letters = [c for c in t if c.isalpha()]
    if o["confidence"] < 0.3 or (not letters and not re.search(r"\d", t)):
        return False
    if letters:
        up = sum(c.isupper() for c in letters) / len(letters)
        cyr = sum("А" <= c.upper() <= "Я" or c in "ЁЪЬЮЯ" for c in letters) / len(letters)
        if up < 0.7 or (cyr < 0.6 and not LATIN):      # Cyrillic capitals; --latin also counts Latin ones (AULA)
            return False
    return abs(o["x"] + o["w"] / 2 - 0.5) <= 0.06       # centred


def _colour(img, o, W, H):
    """'accent' when saturated bright pixels outnumber white ones in the line's box, with their mean RGB."""
    x0, x1, y0, y1 = int(o["x"] * W), int((o["x"] + o["w"]) * W), int(o["y"] * H), int((o["y"] + o["h"]) * H)
    px = img[max(y0, 0):y1, max(x0, 0):x1].reshape(-1, 3)
    if not len(px):
        return "white", None
    mx, mn = px.max(1), px.min(1)
    sat = (mx - mn) / np.maximum(mx, 1)
    acc = (mx > 140) & (sat > 0.45)
    white = (mn > 200) & (sat < 0.15)
    return ("accent" if acc.sum() > white.sum() else "white"), (px[acc].mean(0).round().tolist() if acc.sum() > 30 else None)


def _events(work, tag):
    import cv2
    data = json.load(open(os.path.join(work, f"ocr_{tag}.json")))
    files, rows = data["files"], data["ocr"]
    H, W = cv2.imread(files[0]).shape[:2]
    frames = [sorted((o for o in r if _is_sub(o)), key=lambda o: o["y"]) for r in rows]
    cnt = Counter((norm(o["text"]), round(o["y"], 2)) for f in frames for o in f)
    still = {k for k, v in cnt.items() if v > 5 * FPS}               # a title that stays: not a subtitle
    frames = [[o for o in f if (norm(o["text"]), round(o["y"], 2)) not in still] for f in frames]
    events, cur = [], None
    for i, f in enumerate(frames):
        groups = []
        for o in f:                                                   # lines stacked close together are one chunk
            if groups and o["y"] - (groups[-1][-1]["y"] + groups[-1][-1]["h"]) < 0.025 * (H / W / 1.78):
                groups[-1].append(o)
            else:
                groups.append([o])
        g = max(groups, key=lambda g: sum(len(o["text"]) for o in g)) if groups else None
        key = " ".join(norm(o["text"]) for o in g) if g else None
        if cur and key and key == cur["key"]:
            cur["end"] = i; cur["obs"].append((i, g)); continue
        if cur and key is None and i - cur["end"] <= 1:
            continue
        if cur:
            events.append(cur); cur = None
        if g:
            cur = {"key": key, "start": i, "end": i, "obs": [(i, g)]}
    if cur:
        events.append(cur)
    out = []
    for e in events:
        i, g = e["obs"][len(e["obs"]) // 2]
        img = cv2.imread(files[i])[:, :, ::-1].astype(float)
        lines = []
        for o in g:
            col, rgb = _colour(img, o, W, H)
            lines.append({"text": o["text"], "x": o["x"], "y": o["y"], "w": o["w"], "h": o["h"], "colour": col, "rgb": rgb})
        out.append({"start": e["start"] / FPS, "end": (e["end"] + 1) / FPS, "frames": e["end"] - e["start"] + 1, "lines": lines})
    return {"W": W * 2, "H": H * 2, "events": out}                  # sizes in 1080-wide units


def _merge(events):
    """Text recognition flickers: a chunk read twice with a line missing or a letter wrong is one chunk."""
    lines_of = lambda e: [norm(l["text"]) for l in e["lines"] if norm(l["text"])]
    sim = lambda a, b: SequenceMatcher(None, a, b).ratio()

    def same(a, b):
        A, B = lines_of(a), lines_of(b)
        if not A or not B:
            return False
        return sim(" ".join(A), " ".join(B)) > 0.75 or all(any(sim(x, y) > 0.75 for y in B) for x in A) \
            or all(any(sim(y, x) > 0.75 for x in A) for y in B)
    merged = []
    for e in events:
        if merged and same(merged[-1], e) and e["start"] - merged[-1]["end"] <= 0.26:
            m = merged[-1]
            m["end"] = e["end"]
            if len(lines_of(e)) > len(lines_of(m)) or (len(lines_of(e)) == len(lines_of(m)) and e["frames"] > m["best"]):
                m["lines"], m["best"] = e["lines"], e["frames"]
            continue
        merged.append(dict(e, best=e["frames"]))
    return [m for m in merged if m["end"] - m["start"] >= 0.24 and m["lines"][0]["y"] > 0.30]   # no one-frame ghosts, no top graphics


def _pct(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(p * len(v)))]


def _summ(name, v):
    if v:
        print(f"  {name}: n={len(v)} median {np.median(v):.3f}  p10 {_pct(v, .1):.3f}  p90 {_pct(v, .9):.3f}  max {max(v):.3f}")


def cmd_chunks(a):
    global LATIN
    LATIN = a.latin
    index = json.load(open(os.path.join(a.work, "index.json")))
    D = {}
    for tag, _ in index:
        if tag in a.skip:
            continue
        d = _events(a.work, tag)
        d["chunks"] = [dict(c, W=d["W"], H=d["H"]) for c in _merge(d["events"])]
        D[tag] = d
    json.dump(D, open(os.path.join(a.work, "chunks.json"), "w"), ensure_ascii=False, indent=1)
    C = [c for d in D.values() for c in d["chunks"]]
    W = lambda c: [w for l in c["lines"] for w in l["text"].split()]
    print("chunks per video:", {t: len(d["chunks"]) for t, d in D.items()})
    nw = [len(W(c)) for c in C]
    print("words per chunk:", dict(sorted(Counter(nw).items())), " mean %.2f" % np.mean(nw))
    print("lines per chunk:", dict(sorted(Counter(len(c["lines"]) for c in C).items())))
    _summ("chars per chunk", [len(" ".join(norm(l["text"]) for l in c["lines"])) for c in C])
    _summ("chars of one-line chunks", [len(norm(c["lines"][0]["text"])) for c in C if len(c["lines"]) == 1])
    _summ("seconds on screen", [c["end"] - c["start"] for c in C])
    raw = [l["text"] for c in C for l in c["lines"]]
    print("  lines with punctuation:", sum(bool(re.search(r"[.,!?:;…]", t)) for t in raw), "of", len(raw),
          "· with lowercase:", sum(bool(re.search(r"[а-я]", t)) for t in raw))
    two = [(norm(c["lines"][0]["text"]).split(), norm(c["lines"][1]["text"]).split()) for c in C if len(c["lines"]) == 2]
    two = [(x, y) for x, y in two if x and y and len(x) + len(y) >= 3]
    if two:
        L = lambda ws: len(" ".join(ws))
        even = lambda ws: min(range(1, len(ws)), key=lambda k: (abs(L(ws[:k]) - L(ws[k:])), -k))
        print("  two-line splits (3+ words): last word alone %.0f%%, most even %.0f%%" % (
            100 * np.mean([len(y) == 1 for x, y in two]), 100 * np.mean([even(x + y) == len(x) for x, y in two])))
    acc = [c for c in C if any(l["colour"] == "accent" for l in c["lines"])]
    rgb = [l["rgb"] for c in acc for l in c["lines"] if l["colour"] == "accent" and l["rgb"]]
    one = [c for c in acc if sum(len(l["text"].split()) for l in c["lines"] if l["colour"] == "accent") == 1]
    print("accent: %d of %d chunks%s; one-word %d, of them the last word %d" % (
        len(acc), len(C), (", RGB about %s" % [int(np.median([r[i] for r in rgb])) for i in range(3)]) if rgb else "", len(one),
        sum(W(c)[-1] == [w for l in c["lines"] if l["colour"] == "accent" for w in l["text"].split()][0] for c in one)))
    _summ("OCR line height px (1080 wide)", [l["h"] * c["H"] for c in C for l in c["lines"] if len(norm(l["text"])) >= 4])
    _summ("chunk centre (fraction of height)", [(c["lines"][0]["y"] + c["lines"][-1]["y"] + c["lines"][-1]["h"]) / 2 for c in C])
    _summ("line pitch px", [(c["lines"][1]["y"] - c["lines"][0]["y"]) * c["H"] for c in C if len(c["lines"]) == 2])


# ---------------------------------------------------------------- speech

def cmd_asr(a):
    from asistent import asr
    index = json.load(open(os.path.join(a.work, "index.json")))
    D = json.load(open(os.path.join(a.work, "chunks.json")))
    os.makedirs(os.path.join(a.work, "asr"), exist_ok=True)
    for tag, path in index:
        out = os.path.join(a.work, "asr", tag + ".json")
        if tag not in D or os.path.exists(out):
            continue
        wav = os.path.join(a.work, "asr", tag + ".wav")
        subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                        wav, "-y"], check=True)
        json.dump(asr.transcribe(asr.read_wav(wav)), open(out, "w"), ensure_ascii=False)
        os.remove(wav)
        print(tag, "recognised", flush=True)


def _speech(work):
    D = json.load(open(os.path.join(work, "chunks.json")))
    for tag, d in D.items():
        p = os.path.join(work, "asr", tag + ".json")
        if os.path.exists(p):
            yield tag, json.load(open(p)), d["chunks"]


def cmd_timing(a):
    n = lambda t: re.sub(r"[^0-9а-яёъьюяa-z]", "", t.lower().replace("ь", "ъ"))
    lead, tail = [], []
    for tag, W, C in _speech(a.work):
        for c in C:
            ws = [n(w) for l in c["lines"] for w in l["text"].split() if n(w)]
            best = None
            for i, w in enumerate(W):
                if abs(w["start"] - c["start"]) <= 1.2:
                    s = SequenceMatcher(None, " ".join(ws), " ".join(n(x["word"]) for x in W[i:i + len(ws)])).ratio()
                    if s > 0.8 and (best is None or s > best[0]):
                        best = (s, i)
            if best:
                i = best[1]
                lead.append(W[i]["start"] - c["start"]); tail.append(c["end"] - W[min(i + len(ws) - 1, len(W) - 1)]["end"])
    print("matched", len(lead), "chunks; the 8-a-second sampling makes appearances look about 0.06 s later than they are")
    _summ("appears before its first word (s)", lead)
    _summ("stays after its last word ends (s)", tail)


def cmd_compare(a):
    cfg = dict(Sb.PRESETS[a.preset])
    for kv in a.set:
        k, v = kv.split("=", 1)
        cfg[k] = float(v) if "." in v else int(v)
    mine, ed, hit, tot = [], [], 0, 0
    for tag, W, C in _speech(a.work):
        words, _ = Sb.tidy_words(W)
        caps = Sb.build_captions(words, cfg, 29.97)
        C = [c for c in C if words[0]["start"] - 0.3 <= c["start"] <= words[-1]["end"]]
        mine += caps; ed += C
        ms = [c["start"] for c in caps]
        for s in [c["start"] for c in C][1:]:
            tot += 1; hit += any(abs(s - m) <= 0.2 for m in ms)
    nw = lambda c: len(c["text"].split())
    ew = lambda c: sum(len(l["text"].split()) for l in c["lines"])
    print("chunks: preset %d, editors %d" % (len(mine), len(ed)))
    print("mean words: preset %.2f, editors %.2f · one-word: %.2f / %.2f" % (
        np.mean([nw(c) for c in mine]), np.mean([ew(c) for c in ed]), np.mean([nw(c) == 1 for c in mine]), np.mean([ew(c) == 1 for c in ed])))
    print("two-line: preset %.2f, editors %.2f · accent: %.2f / %.2f" % (
        np.mean(["\n" in c["text"] for c in mine]), np.mean([len(c["lines"]) == 2 for c in ed]),
        np.mean(["accent" in c for c in mine]), np.mean([any(l["colour"] == "accent" for l in c["lines"]) for c in ed])))
    print("editors' chunk starts that are also the preset's (±0.2 s): %.0f%%" % (100 * hit / max(tot, 1)))


# ---------------------------------------------------------------- colour

def cmd_colour(a):
    from asistent import color
    rows = []
    for tag, path in videos(a.folder):
        times = list(np.arange(0.75, color.probe(path).duration - 0.5, 1.5))
        for f in color.read_frames(path, width=480, times=times):
            m, s = color.measure(f), color.frame_stats(f)
            y = color._luma(f)
            rows.append({"tag": tag, "skin": m.get("y_skin"), "mid": m.get("y_mid"), "cast": m.get("cast_neutral"),
                         "world": m.get("cast_world"), "spread": s["spread"], "chroma": s["chroma"], "clipped": m["clipped"],
                         "p01": float(np.percentile(y, 1)), "p99": float(np.percentile(y, 99))})
        print(tag, "measured", flush=True)
    json.dump(rows, open(os.path.join(a.work, "colour.json"), "w"))
    for k in ("skin", "mid", "spread", "chroma", "clipped", "p01", "p99"):
        _summ(k, [r[k] for r in rows if r[k] is not None])
    _summ("neutral temp (log2, < 0 warm)", [r["cast"][0] for r in rows if r["cast"]])
    _summ("neutral tint (log2, > 0 green)", [r["cast"][1] for r in rows if r["cast"]])
    _summ("whole-picture temp", [r["world"][0] for r in rows if r["world"]])


# ---------------------------------------------------------------- pacing and sound

def cmd_pace(a):
    """Cuts (FFmpeg scene change over 0.3 on a small picture: hard cuts, not slow moves), the mean shot, and the finished
    sound: integrated loudness (LUFS), loudness range (LU) and true peak (dBTP), by EBU R128."""
    rows = []
    for tag, path in videos(a.folder):
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                                   capture_output=True, text=True).stdout.strip() or 0)
        r = subprocess.run(["ffmpeg", "-nostdin", "-i", path, "-an", "-vf", "scale=160:-2,select='gt(scene,0.3)',showinfo",
                            "-f", "null", "-"], capture_output=True, text=True)
        cuts = len(re.findall(r"pts_time:", r.stderr))
        s = subprocess.run(["ffmpeg", "-nostdin", "-i", path, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"],
                           capture_output=True, text=True).stderr
        tail = s[s.rfind("Summary:"):]
        num = lambda key: float(re.search(key + r":\s+(-?[\d.]+)", tail).group(1)) if re.search(key + r":\s+(-?[\d.]+)", tail) else None
        rows.append({"tag": tag, "seconds": round(dur, 1), "cuts": cuts, "shot": round(dur / (cuts + 1), 2),
                     "lufs": num("I"), "lra": num("LRA"), "peak": num("Peak")})
        print("%-4s %6.1f s  %3d cuts  shot %.2f s  %s LUFS  LRA %s  peak %s dBTP" % (
            tag, dur, cuts, dur / (cuts + 1), rows[-1]["lufs"], rows[-1]["lra"], rows[-1]["peak"]), flush=True)
    json.dump(rows, open(os.path.join(a.work, "pace.json"), "w"), indent=1)
    if rows:
        print("median: shot %.2f s, %.1f LUFS, peak %.1f dBTP" % (np.median([r["shot"] for r in rows]),
              np.median([r["lufs"] for r in rows if r["lufs"] is not None]), np.median([r["peak"] for r in rows if r["peak"] is not None])))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, args in (("frames", ("folder", "work")), ("chunks", ("work",)), ("asr", ("work",)), ("timing", ("work",)),
                       ("compare", ("work", "preset")), ("colour", ("folder", "work")), ("pace", ("folder", "work"))):
        s = sub.add_parser(name)
        for x in args:
            s.add_argument(x)
        if name == "chunks":
            s.add_argument("--skip", nargs="*", default=[], help="videos without subtitles (v6 …)")
            s.add_argument("--latin", action="store_true", help="the subtitles also have Latin capitals (English names)")
        if name == "compare":
            s.add_argument("set", nargs="*", help="preset values to try, key=value")
    a = p.parse_args()
    if os.path.abspath(getattr(a, "work", "/")).startswith(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))):
        sys.exit("The work folder must be outside the repo (client words and frames are private).")
    globals()["cmd_" + a.cmd](a)


if __name__ == "__main__":
    main()
