#!/usr/bin/env python3
"""Benchmark for PERF-001 (0.10.6): the old decode (FFmpeg stdout captured whole, then de-interleaved with a copy) against
media.decode_f32 (streamed into place). Each variant runs in its own process; reported: peak RSS, wall time, and whether the
samples are bit-identical (SHA-1 of the array).

  bench_decode.py <audio or video file> [--sr 48000] [--start 0] [--end SECONDS]

Never writes anything but its report to stdout.
"""
import argparse
import hashlib
import json
import os
import resource
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "engine"))


def cmd_for(path, sr, start, end, ch):
    from asistent.media import _tool
    c = [_tool("ffmpeg"), "-v", "error", "-nostdin"]
    if start > 0:
        c += ["-ss", f"{start:.6f}"]
    c += ["-i", path, "-map", "0:a:0"]
    if end:
        c += ["-t", f"{end - start:.6f}"]
    return c + ["-ar", str(sr), "-ac", str(ch), "-f", "f32le", "-"]


def child(variant, path, sr, start, end):
    import numpy as np
    from asistent import media
    info = media.probe(path)
    ch = info.audio[0].channels
    cmd = cmd_for(path, sr, start, end, ch)
    t0 = time.perf_counter()
    if variant == "old":
        p = subprocess.run(cmd, capture_output=True)
        x = np.frombuffer(p.stdout, dtype=np.float32)
        n = len(x) // ch
        x = x[: n * ch].reshape(n, ch).T.copy()
        del p
    else:
        span = (end - start) if end else max(0.0, info.duration - start)
        x = media.decode_f32(cmd, ch, int(span * sr) + sr // 10 + 1)
    dt = time.perf_counter() - t0
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak = peak if sys.platform == "darwin" else peak * 1024
    print(json.dumps({"variant": variant, "seconds": round(dt, 3), "peak_mb": round(peak / 1e6, 1), "shape": list(x.shape),
                      "contiguous": bool(x.flags["C_CONTIGUOUS"]), "sha1": hashlib.sha1(x.tobytes()).hexdigest(),
                      "array_mb": round(x.nbytes / 1e6, 1)}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--sr", type=int, default=48000)
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=0.0)
    ap.add_argument("--child")
    a = ap.parse_args()
    if a.child:
        return child(a.child, a.path, a.sr, a.start, a.end)
    out = []
    for v in ("old", "new"):
        r = subprocess.run([sys.executable, __file__, a.path, "--sr", str(a.sr), "--start", str(a.start), "--end", str(a.end),
                            "--child", v], capture_output=True, text=True)
        if r.returncode:
            sys.exit(r.stderr)
        out.append(json.loads(r.stdout))
    old, new = out
    print(json.dumps({"old": old, "new": new, "identical": old["sha1"] == new["sha1"] and old["shape"] == new["shape"],
                      "peak_saved_mb": round(old["peak_mb"] - new["peak_mb"], 1)}, indent=1))


if __name__ == "__main__":
    main()
