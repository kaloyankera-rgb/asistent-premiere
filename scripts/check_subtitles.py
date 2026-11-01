#!/usr/bin/env python3
"""Check a finished subtitle run against the original audio (the .json next to the .srt).

  check_subtitles.py "<Asistent_subtitles>/<name>.json"

Reads the pieces the run used (same media, same cut), builds a 10 ms loudness trace in sequence time and reports:
  1. speech with no word: loud, voiced stretches of 0.3 s or more that no word covers (noise is told apart by its high
     spectral centroid), i.e. words that may be missing;
  2. onset error: for every word after a pause of 0.25 s or more, its start against the rising edge in the audio
     (+ = late), with median and how many are within 80 ms;
  3. captions that stay on screen over silence: shown more than 0.15 s before speech or kept more than 0.5 s after it.
Run with the engine's Python (needs numpy/scipy and the engine package): PYTHONPATH=engine <app>/venv/bin/python ...
"""
import json
import os
import sys

import numpy as np
from scipy import signal

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "engine"))
from asistent import dialoguemix as dm  # noqa: E402


def trace(segments):
    """-> (db per 10 ms frame, sequence second of frame 0, centroid Hz per frame)"""
    t0 = min(s["at"] for s in segments)
    t1 = max(s["at"] + s["end"] - s["start"] for s in segments)
    n = int((t1 - t0) * 100) + 2
    db = np.full(n, -120.0)
    cen = np.full(n, 0.0)
    for s in segments:
        y, _ = dm.read_segment(s, 0.0)
        env = dm._envelope(y)
        i0 = int(round((s["at"] - t0) * 100))
        m = min(len(env), n - i0)
        db[i0:i0 + m] = 20 * np.log10(env[:m] + 1e-6)
        for k in range(m):                                   # spectral centroid of the 10 ms frame (+ context)
            fr = y[max(0, k * 160 - 160):k * 160 + 320]
            if len(fr) >= 256:
                f, p = signal.periodogram(fr, 16000)
                cen[i0 + k] = (f * p).sum() / (p.sum() + 1e-12)
    return db, t0, cen


def main(path):
    d = json.load(open(path, encoding="utf-8"))
    segs = [s for s in d["segments"] if s["end"] - s["start"] >= 0.5]
    db, t0, cen = trace(segs)
    lvl = np.percentile(db[db > -100], 90)
    speech = (db > lvl - 25) & (cen < 1500)                   # loud AND speech-like (noise has a high spectral centroid)
    words = d["words"]
    covered = np.zeros(len(db), bool)
    for w in words:
        covered[max(0, int((w["start"] - 0.15 - t0) * 100)):max(0, int((w["end"] + 0.15 - t0) * 100))] = True
    print(f"{os.path.basename(path)}: {len(d['captions'])} captions, {len(words)} words, speech level {lvl:.0f} dB\n")

    print("1. speech with no word (voiced, >= 0.3 s):")
    i, found = 0, 0
    while i < len(db):
        if speech[i] and not covered[i]:
            j = i
            while j < len(db) and speech[j] and not covered[j]:
                j += 1
            if j - i >= 30:
                c = float(np.median(cen[i:j]))
                kind = "noise (high centroid)" if c > 1500 else "VOICED - words may be missing"
                print(f"   {t0 + i / 100:6.2f}-{t0 + j / 100:6.2f} s  centroid {c:5.0f} Hz  {kind}")
                found += kind.startswith("VOICED")
            i = j
        else:
            i += 1
    print(f"   -> {found} stretch(es) that may hide missing words\n")

    print("2. onset error of words after a pause (+ = late; noise is ignored):")
    errs = []
    for a, b in zip(words, words[1:]):
        if b["start"] - a["end"] < 0.25:
            continue
        lo, hi = int((a["end"] + 0.03 - t0) * 100), int((b["start"] + 0.5 - t0) * 100)
        k = next((j for j in range(max(lo, 3), min(hi, len(db) - 6)) if all(speech[j + m] for m in range(5)) and not speech[j - 3]), None)
        if k is not None:
            errs.append(b["start"] - (t0 + k / 100))
            print(f"   {b['word']:14s} {b['start']:6.2f} s  {errs[-1]:+.2f}")
    if errs:
        e = np.array(errs)
        print(f"   -> median {np.median(e):+.2f} s, within 80 ms: {int(np.sum(abs(e) <= .08))}/{len(e)}, worst {np.max(abs(e)):.2f} s\n")

    print("3. captions over silence:")
    bad = 0
    for c in d["captions"]:
        a, b = max(0, int((c["start"] - t0) * 100)), int((c["end"] - t0) * 100)
        idx = np.where(speech[a:b])[0]
        if not len(idx):
            print(f"   {c['start']:6.2f}  {c['text']!r}: no speech at all while shown")
            bad += 1
            continue
        early, late = idx[0] / 100, (b - a - idx[-1]) / 100
        if early > 0.15 or late > 0.5:
            print(f"   {c['start']:6.2f}  {c['text']!r}: speech starts {early:.2f} s after it appears, ends {late:.2f} s before it clears")
            bad += 1
    print(f"   -> {bad} caption(s) to look at of {len(d['captions'])}")


if __name__ == "__main__":
    main(sys.argv[1])
