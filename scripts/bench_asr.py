#!/usr/bin/env python3
"""Bulgarian recognition benchmark (development only): run a backend on reference clips, score it against human-verified
transcripts.

  bench_asr.py init                                  create the private store with the Masterhaus starter set
  bench_asr.py hyp   --backend classic [--set dev|heldout|all] [--clip ID]   recognise the clips (backend's own Python)
  bench_asr.py draft --from classic [--clip ID]      write <id>.draft.txt (UNVERIFIED) for a person to correct into <id>.ref.txt
  bench_asr.py score --backend classic [--set ...] [--allow-unverified]     WER/CER/meaning/omissions/time/memory table
  bench_asr.py agree --a classic --b whispercpp      how often two backends write the same words (NOT accuracy)

The store is private and outside the repo (client speech): ~/Kaloyan/02_RESOURCES/Asistent benchmark/ (`--store`).
manifest.json: {"clips": {id: {"media", "channel" (L|R|mix), "start", "end", "split" (dev|heldout), "reference"
(file name), "verified" (true only after a person checked every word against the audio), "names" [..]}}}.
Held-out clips are never used to tune anything, never typed into corrections and never learned from.
Scores against an unverified draft are refused unless --allow-unverified, and are then labelled "draft, not accuracy".

Backends write results/<backend>/<id>.json: {"backend", "model", "settings", "words" [{word, start, end}], "text",
"seconds", "peak_rss_mb"}. classic = Asistent's own asr.transcribe (faster-whisper large-v3 int8, beam 5, CPU), run with the
app's Python; scoring runs with <app>/venv-bench (jiwer). Each command re-runs itself with the right interpreter.
"""
from __future__ import annotations

import argparse
import json
import os
import resource
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
APP = os.path.expanduser("~/Library/Application Support/Asistent")
APP_PY = os.path.join(APP, "venv", "bin", "python")
BENCH_PY = os.path.join(APP, "venv-bench", "bin", "python")
STORE = os.path.expanduser("~/Kaloyan/02_RESOURCES/Asistent benchmark")
MASTERHAUS = os.path.expanduser("~/Kaloyan/01_CLIENTS/The Pact/Masterhaus/Media/Masterhaus - kupuva/кам2")
# the 143 s measured for the speed decision of 2026-11-08 (lavalier on the right channel)
STARTER = {"mh-fx31028": ("fx31028.MP4", "dev"), "mh-fx31031": ("fx31031.MP4", "dev"), "mh-fx31032": ("fx31032.MP4", "heldout")}


def _rerun(python: str, argv: list[str]) -> int:
    env = dict(os.environ, PYTHONPATH=os.path.join(REPO, "engine"))
    return subprocess.run([python, os.path.abspath(__file__), *argv], env=env).returncode


def _manifest(store: str) -> dict:
    with open(os.path.join(store, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)


def _clips(store: str, split: str, clip: str | None) -> dict:
    clips = _manifest(store)["clips"]
    if clip:
        return {clip: clips[clip]}
    return {k: v for k, v in clips.items() if split == "all" or v["split"] == split}


def _duration(path: str) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def cmd_init(args) -> int:
    path = os.path.join(args.store, "manifest.json")
    if os.path.exists(path):
        print(f"{path} exists; nothing changed.")
        return 0
    os.makedirs(os.path.join(args.store, "refs"), exist_ok=True)
    clips = {}
    for cid, (name, split) in STARTER.items():
        media = os.path.join(MASTERHAUS, name)
        if not os.path.isfile(media):
            print(f"missing {media}; skipped")
            continue
        clips[cid] = {"media": media, "channel": "R", "start": 0.0, "end": round(_duration(media), 3), "split": split,
                      "reference": f"{cid}.ref.txt", "verified": False, "names": []}
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"note": "private benchmark (client speech): never commit or upload", "clips": clips}, f, ensure_ascii=False, indent=1)
    print(f"Created {path} with {len(clips)} clips (no reference is verified yet).")
    return 0


def decode(clip: dict):
    """16 kHz mono float32 of the clip's channel, through FFmpeg."""
    import numpy as np

    pan = {"L": "pan=mono|c0=c0", "R": "pan=mono|c0=c1"}.get(clip.get("channel"), "pan=mono|c0=0.5*c0+0.5*c1")
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-ss", str(clip["start"]), "-to", str(clip["end"]), "-i", clip["media"],
           "-vn", "-af", pan, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32).copy()


def cmd_hyp_classic(args) -> int:
    """(app venv) Asistent's own recognition, exactly as the subtitle job calls it for one window (no prompt)."""
    from asistent import asr

    clip = json.loads(args.clip_json)
    audio = decode(clip)
    t_load = time.time()
    asr._load()                                            # model load timed apart: the app keeps the model loaded between windows
    load_seconds = time.time() - t_load
    t0 = time.time()
    words = asr.transcribe(audio, beam=5)
    seconds = time.time() - t0
    out = {"backend": "classic", "model": "faster-whisper large-v3 (pins.WHISPER_REVISION)", "settings": "CPU int8, beam 5, no VAD",
           "words": [{"word": w["word"], "start": w["start"], "end": w["end"]} for w in words],
           "text": " ".join(w["word"] for w in words), "seconds": round(seconds, 2), "load_seconds": round(load_seconds, 2), "audio_seconds": round(len(audio) / 16000, 2),
           "peak_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1 << 20), 1)}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    return 0


def cmd_hyp(args) -> int:
    runners = {"classic": APP_PY}
    if args.backend not in runners:
        print(f"Unknown backend {args.backend}; known: {', '.join(runners)}")
        return 2
    outdir = os.path.join(args.store, "results", args.backend)
    os.makedirs(outdir, exist_ok=True)
    for cid, clip in _clips(args.store, args.set, args.clip).items():
        out = os.path.join(outdir, cid + ".json")
        rc = _rerun(runners[args.backend], [f"_hyp_{args.backend}", "--clip-json", json.dumps(clip), "--out", out])
        if rc:
            print(f"{cid}: failed ({rc})")
            return rc
        with open(out, encoding="utf-8") as f:
            r = json.load(f)
        print(f"{cid}: {len(r['words'])} words, {r['seconds']} s (+{r.get('load_seconds', 0)} s model load) for {r['audio_seconds']} s of audio, peak {r['peak_rss_mb']} MB")
    return 0


def cmd_draft(args) -> int:
    for cid, clip in _clips(args.store, "all", args.clip).items():
        src = os.path.join(args.store, "results", getattr(args, "from"), cid + ".json")
        with open(src, encoding="utf-8") as f:
            text = json.load(f)["text"]
        dst = os.path.join(args.store, "refs", cid + ".draft.txt")
        with open(dst, "w", encoding="utf-8") as f:
            f.write(f"# UNVERIFIED DRAFT from {getattr(args, 'from')} ({clip['media']}, {clip['channel']}, {clip['start']}-{clip['end']} s).\n"
                    "# Listen and correct every word exactly as said (no tidying), save as " + clip["reference"] + " without these lines,\n"
                    "# then set \"verified\": true for this clip in manifest.json.\n" + text + "\n")
        print(f"wrote {dst}")
    return 0


def _ref_text(store: str, clip: dict) -> str | None:
    path = os.path.join(store, "refs", clip["reference"])
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return "\n".join(ln for ln in f.read().splitlines() if not ln.startswith("#"))


def cmd_score(args) -> int:
    from asistent.bench import metrics

    rows, skipped = [], []
    for cid, clip in _clips(args.store, args.set, args.clip).items():
        ref = _ref_text(args.store, clip)
        if ref is None or (not clip.get("verified") and not args.allow_unverified):
            skipped.append(f"{cid} ({'no reference' if ref is None else 'reference not verified'})")
            continue
        with open(os.path.join(args.store, "results", args.backend, cid + ".json"), encoding="utf-8") as f:
            hyp = json.load(f)
        s = metrics.score(ref, hyp["text"], names=clip.get("names", ()))
        rows.append((cid, clip, hyp, s))
    if skipped:
        print("Not scored: " + ", ".join(skipped))
    if not rows:
        return 1
    print(f"\n### {args.backend}" + ("" if all(c.get("verified") for _, c, _, _ in rows) else "  (AGAINST UNVERIFIED DRAFTS: not accuracy)"))
    print("| clip | split | WER raw | WER norm | CER norm | numbers err | negations err | names err | inserted neg | deleted | word edits | s | x realtime | peak MB |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for cid, clip, hyp, s in rows:
        m = s["meaning"]
        print(f"| {cid} | {clip['split']} | {s['raw']['wer']:.3f} | {s['normalized']['wer']:.3f} | {s['normalized']['cer']:.3f} | "
              f"{m['numbers']['errors']}/{m['numbers']['in_reference']} | {m['negations']['errors']}/{m['negations']['in_reference']} | "
              f"{m['names']['errors']}/{m['names']['in_reference']} | {len(m['inserted_negations'])} | {s['omissions']['deleted_words']} | "
              f"{s['effort']['word_edits']} | {hyp['seconds']} | {hyp['audio_seconds'] / max(hyp['seconds'], 1e-6):.1f} | {hyp['peak_rss_mb']} |")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({cid: s for cid, _, _, s in rows}, f, ensure_ascii=False, indent=1)
    return 0


def cmd_agree(args) -> int:
    from asistent.bench import metrics

    print(f"Agreement {args.a} vs {args.b} (word differences between two machine readings; NOT accuracy)")
    for cid, _ in _clips(args.store, args.set, args.clip).items():
        try:
            with open(os.path.join(args.store, "results", args.a, cid + ".json"), encoding="utf-8") as f:
                a = json.load(f)
            with open(os.path.join(args.store, "results", args.b, cid + ".json"), encoding="utf-8") as f:
                b = json.load(f)
        except FileNotFoundError:
            continue
        s = metrics.score(a["text"], b["text"])
        t = metrics.timing(a["words"], b["words"])
        print(f"{cid}: differ {s['normalized']['wer']:.3f} (normalized), word starts median {t.get('median_abs_s')} s apart")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("action", choices=["init", "hyp", "draft", "score", "agree", "_hyp_classic"])
    ap.add_argument("--store", default=STORE)
    ap.add_argument("--backend", default="classic")
    ap.add_argument("--set", default="all", choices=["dev", "heldout", "all"])
    ap.add_argument("--clip")
    ap.add_argument("--from", default="classic")
    ap.add_argument("--allow-unverified", action="store_true")
    ap.add_argument("--json")
    ap.add_argument("--a")
    ap.add_argument("--b")
    ap.add_argument("--clip-json")
    ap.add_argument("--out")
    args = ap.parse_args()
    if args.action in ("score", "agree") and os.path.realpath(sys.prefix) != os.path.realpath(os.path.join(APP, "venv-bench")):
        return _rerun(BENCH_PY, sys.argv[1:])
    sys.path.insert(0, os.path.join(REPO, "engine"))
    return {"init": cmd_init, "hyp": cmd_hyp, "draft": cmd_draft, "score": cmd_score, "agree": cmd_agree,
            "_hyp_classic": cmd_hyp_classic}[args.action](args)


if __name__ == "__main__":
    sys.exit(main())
