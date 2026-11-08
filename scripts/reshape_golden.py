#!/usr/bin/env python3
"""ReShape golden check: the whole /subtitles job on one ReShape recording, compared byte for byte with a recorded run.

  reshape_golden.py record [--input <video or audio>] [--store <dir>]
  reshape_golden.py check  [--input <video or audio>] [--store <dir>]

The ReShape preset is protected (the user, 2026-11-08): recognition, corrections, learned terms, English, timing,
grouping and the look must not change while other work goes on. `record` runs the job once at the protected baseline
and keeps the SRT, the English SRT and the job's JSON (paths and run times removed); `check` runs it again with the
same inputs and reports every difference. Run `check` after any change that could reach the subtitle pipeline.

Private by design: the input is a client's video and the outputs hold its words, so the store lives outside the repo
(default `~/Kaloyan/07_ARCHIVE/_backups/Asistent baselines/reshape`) and nothing here is ever committed.

The job runs in a child process with HOME pointed at a scratch folder, so nothing touches the real app folder or the
office: the models and the aligner's venv are linked read only, the caches start empty (a cold run, like the first
press in Premiere), and the learned fixes come from a frozen copy made at `record` (this computer's own learning
folder at that moment; the office folders are not used because the project path is outside any client folder).
Run with the engine's Python: "<app>/venv/bin/python" scripts/reshape_golden.py check
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
REAL_APP = os.path.expanduser("~/Library/Application Support/Asistent")
DEFAULT_STORE = os.path.expanduser("~/Kaloyan/07_ARCHIVE/_backups/Asistent baselines/reshape")
DEFAULT_INPUT_DIR = os.path.join(REPO, "references", "subtitles", "reshape")
# what differs between two identical runs and so is left out of the comparison
VOLATILE = {"srt", "srt_en", "json", "asr_seconds", "mix_seconds", "cached", "out_dir"}


def default_input() -> str:
    if os.path.isdir(DEFAULT_INPUT_DIR):
        for name in sorted(os.listdir(DEFAULT_INPUT_DIR)):
            if name.lower().endswith((".mp4", ".mov", ".wav", ".m4a")):
                return os.path.join(DEFAULT_INPUT_DIR, name)
    return ""


def probe(path: str) -> tuple[float, float, int, int]:
    """-> (duration s, fps, width, height) of the input, through ffprobe."""
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,r_frame_rate,width,height",
                          "-of", "json", path], capture_output=True, text=True, check=True).stdout
    info = json.loads(out)
    dur = float(info["format"]["duration"])
    fps, w, h = 25.0, 1080, 1920
    for s in info.get("streams", []):
        if s.get("codec_type") == "video":
            a, b = s["r_frame_rate"].split("/")
            fps, w, h = float(a) / float(b), int(s["width"]), int(s["height"])
    return dur, fps, w, h


def canonical(result: dict) -> dict:
    """The job's JSON without what changes from run to run (paths, timings), in a fixed key order."""
    keep = {k: v for k, v in result.items() if k not in VOLATILE}
    for k in ("items", "segments"):            # the input path depends on where the scratch folder was
        for it in keep.get(k) or []:
            if isinstance(it, dict) and "path" in it:
                it["path"] = os.path.basename(it["path"])
    return json.loads(json.dumps(keep, ensure_ascii=False, sort_keys=True))


def child(args) -> int:
    """Inside the scratch HOME: run the job and write srt / en.srt / json into args.out."""
    sys.path.insert(0, os.path.join(REPO, "engine"))
    from asistent import subtitle_job          # noqa: E402  (imported after HOME was switched by the parent)

    dur, fps, w, h = probe(args.input)
    project_dir = os.path.join(os.environ["HOME"], "project")   # inside the scratch HOME, removed with it
    os.makedirs(project_dir, exist_ok=True)
    body = {"items": [{"path": args.input, "start": 0.0, "end": dur, "at": 0.0, "name": os.path.basename(args.input), "track": 0}],
            "preset": "reshape", "fps": fps, "width": w, "height": h, "out_dir": project_dir, "name": "reshape golden",
            "english": True, "project": os.path.join(project_dir, "golden.prproj")}
    t0 = time.time()
    result = subtitle_job.run(body, lambda f, m: None, lambda: False)
    seconds = time.time() - t0
    with open(result["json"], encoding="utf-8") as f:
        full = json.load(f)
    shutil.copyfile(result["srt"], os.path.join(args.out, "reshape.srt"))
    if result.get("srt_en"):
        shutil.copyfile(result["srt_en"], os.path.join(args.out, "reshape.en.srt"))
    with open(os.path.join(args.out, "reshape.json"), "w", encoding="utf-8") as f:
        json.dump(canonical(full), f, ensure_ascii=False, indent=1, sort_keys=True)
    with open(os.path.join(args.out, "run.txt"), "w", encoding="utf-8") as f:
        f.write("seconds %.1f\n" % seconds)
    return 0


def run_job(inp: str, learning_seed: str, out: str) -> float:
    """Runs the job in a child with a scratch HOME; -> seconds."""
    home = tempfile.mkdtemp(prefix="reshape-golden-home-")
    app = os.path.join(home, "Library", "Application Support", "Asistent")
    os.makedirs(app)
    for name in ("models", "venv-align"):      # read-only use; nothing is written into either
        if os.path.exists(os.path.join(REAL_APP, name)):
            os.symlink(os.path.join(REAL_APP, name), os.path.join(app, name))
    if os.path.isdir(learning_seed):
        shutil.copytree(learning_seed, os.path.join(app, "learning"))
    env = dict(os.environ, HOME=home)
    env.pop("ASISTENT_CACHE_DIR", None)
    t0 = time.time()
    try:
        subprocess.run([sys.executable, os.path.abspath(__file__), "_child", "--input", inp, "--out", out], env=env, check=True)
    finally:
        shutil.rmtree(home, ignore_errors=True)
    return time.time() - t0


def compare(store: str, new: str) -> list[str]:
    problems = []
    for name in ("reshape.srt", "reshape.en.srt", "reshape.json"):
        a, b = os.path.join(store, name), os.path.join(new, name)
        if not os.path.exists(a) and not os.path.exists(b):
            continue
        if not os.path.exists(a) or not os.path.exists(b):
            problems.append(f"{name}: present in only one run")
            continue
        with open(a, "rb") as fa, open(b, "rb") as fb:
            da, db = fa.read(), fb.read()
        if da != db:
            diff = difflib.unified_diff(da.decode("utf-8", "replace").splitlines(), db.decode("utf-8", "replace").splitlines(),
                                        "baseline/" + name, "now/" + name, lineterm="", n=1)
            problems.append(f"{name} differs:\n" + "\n".join(list(diff)[:80]))
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("action", choices=["record", "check", "_child"])
    ap.add_argument("--input", default="")
    ap.add_argument("--store", default=DEFAULT_STORE)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    if args.action == "_child":
        return child(args)

    inp = os.path.abspath(args.input or default_input())
    if not os.path.isfile(inp):
        print("No ReShape input: pass --input <video> (the client's reference lives in references/subtitles/reshape, never committed).")
        return 2
    store = os.path.abspath(args.store)
    seed = os.path.join(store, "learning-seed")
    if args.action == "record":
        if os.path.exists(os.path.join(store, "reshape.srt")):
            print(f"A baseline already exists in {store}: it is protected; move it aside by hand to record again.")
            return 2
        os.makedirs(store, exist_ok=True)
        if os.path.isdir(os.path.join(REAL_APP, "learning")):
            shutil.copytree(os.path.join(REAL_APP, "learning"), seed)
        seconds = run_job(inp, seed, store)
        head = subprocess.run(["git", "-C", REPO, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        with open(os.path.join(store, "BASELINE.txt"), "w", encoding="utf-8") as f:
            f.write(f"commit {head}\ninput {inp}\nrecorded {time.strftime('%Y-%m-%d %H:%M:%S')}\nwall seconds {seconds:.1f}\n")
        print(f"Recorded the ReShape baseline in {store} ({seconds:.0f} s).")
        return 0
    if not os.path.exists(os.path.join(store, "reshape.srt")):
        print(f"No baseline in {store}: run `record` at the protected baseline first.")
        return 2
    out = tempfile.mkdtemp(prefix="reshape-golden-now-")
    seconds = run_job(inp, seed, out)
    problems = compare(store, out)
    if problems:
        print("ReShape output CHANGED against the baseline:\n\n" + "\n\n".join(problems))
        print(f"\nThis run is kept in {out}")
        return 1
    shutil.rmtree(out, ignore_errors=True)
    print(f"ReShape output identical to the baseline (SRT, English SRT, job JSON; {seconds:.0f} s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
