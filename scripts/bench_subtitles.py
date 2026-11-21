#!/usr/bin/env python3
"""Subtitle accuracy benchmark on the editors' finished videos (development only): the WHOLE /subtitles job, scored against
the subtitles the editors corrected and burned in, with each word mistake given to the layer that made it.

  bench_subtitles.py pick  <client's export folder> [--n 6] [--per-plan 2] [--slug name]   choose videos, copy their sound
  bench_subtitles.py refs  [--clip ID]                       read the burned-in subtitles of the chosen videos (once)
  bench_subtitles.py run   --profile strict [--pieces] [--cold] [--set dev|heldout|all] [--client slug] [--clip ID] [--again]
  bench_subtitles.py run   --profile <new name> --next '{"second": "none"}' [--pieces] ...      NEXT with fields to try
  bench_subtitles.py score --profile strict[+p] [--set ...] [--client slug] [--examples 15]
  bench_subtitles.py cloud --upload [--model scribe_v3] [--set ...] [--clip ID]    a cloud recogniser on the same sound (UPLOADS it)

Why (2026-11-20 audit): no checked transcript existed, so every earlier accuracy fix was tuned on one run. The office's
finished videos carry subtitles made in another tool and corrected by an editor: text that does not share Asistent's own
mistakes. `scripts/bench_asr.py` scores the recogniser alone; this scores what the editor actually gets.

The office share is ONLY READ (the user's rule: nothing there is written, renamed, moved or deleted). `pick` copies each
video's sound into the private store, so runs need no share; `refs` reads the picture from the share once. The store is
outside the repo (client words): ~/Kaloyan/02_RESOURCES/Asistent benchmark/exports/ (`--store`).

  manifest.json   {"clips": {id: {"client", "slug", "source", "audio", "duration", "fps", "width", "height", "split", "skip"?}}}
  audio/<id>.flac refs/<id>.ref.txt + <id>.chunks.json   results/<profile>/<id>.json   reports/<profile> <time>.md

Splits: per client the chosen videos alternate dev / heldout. Tune on dev only; heldout is the judge and is never tuned on.

A run is the real job (`subtitle_job.run`) in a child process with HOME on a scratch folder, as `reshape_golden.py` does:
cold caches, the models linked read only, no project (so no learning folder is read or written and no Asistent_subtitles
folder appears next to anybody's project). Profiles: `strict` = the Auto style as shipped; `classic` = the same sound
through the ReShape style's recognition (how the two paths compare on other clients' speech).

Limits, to keep in mind with every number: the videos have music under the voice, editors tidy what was said (fillers,
digits, brand spellings) and text recognition misreads some letters, so the absolute error rate is pessimistic. Compare
configurations on the same sound; do not quote the absolute figure as Asistent's accuracy.
Run with any Python: it re-runs itself with the app's venv.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
APP = os.path.expanduser("~/Library/Application Support/Asistent")
APP_PY = os.path.join(APP, "venv", "bin", "python")
STORE = os.path.expanduser("~/Kaloyan/02_RESOURCES/Asistent benchmark/exports")
SLUGS = {"GStroy": "gstroy", "Credissimo": "credissimo", "Beauty Sector": "beautysector", "AULA": "aula", "Екопак": "ekopak"}
MIN_S, MAX_S = 15.0, 150.0
FPS = 8                    # frames a second read for the reference, as measure_style.py
# profile -> what the job is asked for; a new recognition path gets its own name here when it exists
#   strict   the Auto style as shipped in 0.10.118, run from that version's code kept in the store (`code/0.10.118/engine`,
#            made once with `git archive e3f0f46 engine | tar -x -C <store>/code/0.10.118`): the baseline does not move
#            while the working tree changes
#   now      the Auto style of the working tree (must score exactly as `strict` until the default profile changes)
#   classic  the same sound through the ReShape style's recognition
#   next     the working tree's NEXT profile; any other name with --next '{"second": "none", ...}' is NEXT with those
#            fields (recognition.py), stored under that name
PROFILES = {"strict": {"body": {"preset": "auto"}, "engine": "0.10.118"}, "now": {"body": {"preset": "auto"}},
            "classic": {"body": {"preset": "reshape"}},
            "next": {"body": {"preset": "auto"}, "env": {"ASISTENT_RECOGNITION": "next"}},
            # the whole job with ElevenLabs reading the windows (UPLOADS their sound: needs --upload, as `cloud` does)
            "cloud": {"body": {"preset": "auto"}, "env": {"ASISTENT_RECOGNITION": "cloud"}, "upload": True}}


def _profile(args) -> dict:
    if args.next:
        json.loads(args.next)                              # a typing mistake stops here, not after an hour of reading
        base = "cloud" if args.base == "cloud" else "next"
        return {"body": {"preset": "auto"}, "env": {"ASISTENT_RECOGNITION": base + ":" + args.next}, "upload": base == "cloud"}
    if args.profile not in PROFILES:
        sys.exit(f"Unknown profile {args.profile}; known: {', '.join(PROFILES)} (or a new name with --next '{{...}}')")
    return PROFILES[args.profile]


def _label(args) -> str:
    """The folder a run's results live in: the profile's name, with "+p" when the videos were cut into pieces."""
    return args.profile + ("+p" if getattr(args, "pieces", False) and not args.profile.endswith("+p") else "")


def _engine(args, prof: dict) -> str:
    if not prof.get("engine"):
        return os.path.join(REPO, "engine")
    path = os.path.join(args.store, "code", prof["engine"], "engine")
    if not os.path.isdir(path):
        sys.exit(f"The {prof['engine']} code is not in the store ({path}): see the note above PROFILES.")
    return path


def _local(path: str) -> str:
    """A path this script may write to: never the office share (the user's rule)."""
    real = os.path.realpath(path)
    if real.startswith("/Volumes/") or os.path.realpath(REPO) + os.sep in real + os.sep:
        sys.exit(f"Refusing to write to {path}: results stay in the private store on this computer.")
    return path


def _manifest(store: str) -> dict:
    path = os.path.join(store, "manifest.json")
    if not os.path.isfile(path):
        return {"note": "private benchmark (client speech): never commit or upload", "clips": {}}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save(store: str, man: dict) -> None:
    os.makedirs(_local(store), exist_ok=True)
    with open(os.path.join(store, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(man, f, ensure_ascii=False, indent=1)


def _clips(args) -> dict:
    clips = _manifest(args.store)["clips"]
    if args.clip:
        return {args.clip: clips[args.clip]}
    # "skip": a video whose burned-in text is not what is said (a counting game shown as digits, a screen recording whose
    # own text is read as subtitles): set by hand in the manifest with the reason, after reading the REFERENCE, never because
    # of how a profile scored on it
    return {k: v for k, v in clips.items() if (args.set == "all" or v["split"] == args.set)
            and (not args.client or v["slug"] == args.client) and not v.get("skip")}


def _probe(path: str) -> dict | None:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,r_frame_rate,width,height",
                        "-of", "json", path], capture_output=True, text=True)
    if r.returncode:
        return None
    info = json.loads(r.stdout)
    out = {"duration": float(info["format"]["duration"]), "fps": 25.0, "width": 0, "height": 0, "audio": False}
    for s in info.get("streams", []):
        if s.get("codec_type") == "video" and not out["width"]:
            a, b = s["r_frame_rate"].split("/")
            out.update(fps=float(a) / float(b), width=int(s["width"]), height=int(s["height"]))
        out["audio"] = out["audio"] or s.get("codec_type") == "audio"
    return out


# ---------------------------------------------------------------- pick

def cmd_pick(args) -> int:
    folder = os.path.abspath(args.folder)
    client = os.path.basename(folder.rstrip("/"))
    slug = args.slug or SLUGS.get(client)
    if not slug:
        sys.exit(f"No short name for {client}: pass --slug <latin name>.")
    man = _manifest(args.store)
    mine = [c for c in man["clips"].values() if c["slug"] == slug and not c.get("skip")]
    nfc = lambda s: unicodedata.normalize("NFC", s)       # a share may hand names out decomposed
    plans = sorted(((int(m.group(1)), d) for d in os.listdir(folder) if (m := re.fullmatch(r"Контент план (\d+)", nfc(d)))), reverse=True)
    os.makedirs(_local(os.path.join(args.store, "audio")), exist_ok=True)
    added = 0
    for plan, d in plans:
        if len(mine) >= args.n:
            break
        by_video: dict[int, str] = {}
        for f in sorted(os.listdir(os.path.join(folder, d))):
            name = nfc(f).lower()
            m = re.search(r"видео (\d+)", name)
            if m and name.endswith(".mp4") and "субтитри" in name and not re.search(r"16\s*[xх]\s*9", name):
                by_video[int(m.group(1))] = f                      # sorted: the last version of a video wins (v2 after v1)
        taken = 0
        for num in sorted(by_video):
            if taken >= args.per_plan or len(mine) >= args.n:
                break
            cid = f"{slug}-kp{plan}-v{num}"
            if cid in man["clips"]:
                taken += 1
                continue
            src = os.path.join(folder, d, by_video[num])
            p = _probe(src)
            if not p or not p["audio"] or not (MIN_S <= p["duration"] <= MAX_S) or p["height"] <= p["width"]:
                continue                                           # vertical videos of ordinary length only (what Auto is used on)
            audio = os.path.join(args.store, "audio", cid + ".flac")
            subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", src, "-vn", "-c:a", "flac", _local(audio)], check=True)
            clip = {"client": client, "slug": slug, "source": src, "audio": os.path.basename(audio), "duration": round(p["duration"], 3),
                    "fps": round(p["fps"], 3), "width": p["width"], "height": p["height"], "split": "dev" if len(mine) % 2 == 0 else "heldout"}
            man["clips"][cid] = clip
            mine.append(clip)
            taken += 1
            added += 1
            _save(args.store, man)
            print(f"{cid}: {clip['duration']:.0f} s, {clip['split']}", flush=True)
    print(f"{client}: {added} added, {len(mine)} in the benchmark.")
    return 0


# ---------------------------------------------------------------- refs

def _measure_style():
    spec = importlib.util.spec_from_file_location("measure_style", os.path.join(HERE, "measure_style.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def cmd_refs(args) -> int:
    from asistent import ocr

    ms = _measure_style()
    ms.LATIN = True                 # keep lines with Latin names: the scorer sets those words aside, it must not lose the line
    refs = os.path.join(args.store, "refs")
    os.makedirs(_local(refs), exist_ok=True)
    for cid, clip in _clips(args).items():
        out = os.path.join(refs, cid + ".chunks.json")
        if os.path.exists(out) and not args.again:
            continue
        if not os.path.isfile(clip["source"]):
            print(f"{cid}: the video is not reachable ({clip['source']}): is the office share mounted?")
            continue
        work = tempfile.mkdtemp(prefix="bench-refs-")
        try:
            frames = os.path.join(work, "frames")
            os.makedirs(frames)
            subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", clip["source"], "-vf", f"fps={FPS},scale=540:-2", "-q:v", "3",
                            os.path.join(frames, "%05d.jpg")], check=True)
            files = sorted(os.path.join(frames, f) for f in os.listdir(frames) if f.endswith(".jpg"))
            rows = []
            for i in range(0, len(files), 100):
                rows += ocr.read(files[i:i + 100])
            if not any(rows):
                print(f"{cid}: no text was read (is the text recognition helper built?)")
                continue
            with open(os.path.join(work, f"ocr_{cid}.json"), "w", encoding="utf-8") as f:
                json.dump({"files": files, "ocr": rows}, f, ensure_ascii=False)
            chunks = ms._merge(ms._events(work, cid)["events"])
        finally:
            shutil.rmtree(work, ignore_errors=True)        # the frames are measured, never looked at, and do not stay
        rows = [{"start": c["start"], "end": c["end"], "text": " ".join(l["text"].strip() for l in c["lines"])} for c in chunks]
        with open(out, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)
        with open(os.path.join(refs, cid + ".ref.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(r["text"] for r in rows) + "\n")
        print(f"{cid}: {len(rows)} subtitle chunks, {sum(len(r['text'].split()) for r in rows)} words", flush=True)
    return 0


# ---------------------------------------------------------------- run

def child(args) -> int:
    """Inside the scratch HOME: the job on one clip's sound -> args.out."""
    from asistent import asr, subtitle_job

    if os.environ.get("BENCH_WHISPER_DIR"):
        # another recognition model tried in place of large-v3 (--model-dir): only inside this benchmark process, the app's
        # code is not touched. Its readings live in their own HOME (cmd_run), never next to large-v3's.
        other = os.environ["BENCH_WHISPER_DIR"]
        asr.model_dir = lambda kind=asr.LARGE: other if kind == asr.LARGE else os.path.join(os.path.dirname(other), asr.MODELS[kind]["folder"])
    if os.environ.get("BENCH_COMPUTE"):
        # the processor's arithmetic for the model (--compute float32; the app uses int8), again only in this process
        compute = os.environ["BENCH_COMPUTE"]
        asr._device = lambda: ("cpu", compute)
    clip = json.loads(args.clip_json)
    out_dir = os.path.join(os.environ["HOME"], "out", clip["id"])
    os.makedirs(out_dir, exist_ok=True)
    cuts = clip.get("pieces") or [0.0, clip["duration"]]
    body = {"items": [{"path": clip["path"], "start": a, "end": b, "at": a, "name": clip["id"], "track": 0} for a, b in zip(cuts, cuts[1:])],
            "fps": clip["fps"], "width": clip["width"], "height": clip["height"], "out_dir": out_dir, "name": clip["id"],
            "english": False, "project": "", **json.loads(args.body)}
    t0 = time.time()
    result = subtitle_job.run(body, lambda f, m: None, lambda: False)
    seconds = time.time() - t0
    with open(result["json"], encoding="utf-8") as f:
        full = json.load(f)
    shutil.rmtree(out_dir, ignore_errors=True)             # the job's own files are not kept (the result below is)
    keep = {k: full[k] for k in ("preset", "words", "verbatim", "edits", "segments", "readings", "counts", "asr_seconds", "cached")}
    if result.get("recognizer"):
        keep["recognizer"] = result["recognizer"]
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"profile": args.profile, "clip": clip["id"], "seconds": round(seconds, 1), "audio_seconds": clip["duration"], **keep},
                  f, ensure_ascii=False, indent=1)
    return 0


def _pieces(path: str, cid: str, duration: float) -> list[float]:
    """Cut points that turn one finished video into the short clips of a real timeline: pieces of 3-9 s (the length is
    drawn from the clip's own name, so it is the same every run), each cut moved to the quietest 0.2 s within a second of
    where it fell. A whole video as ONE clip never shows what Asistent does per clip: the second opinions, the reading
    that replaces a piece, a word cut by a clip's edge."""
    import numpy as np

    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    y = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    win = 3200
    energy = np.convolve(y ** 2, np.ones(win) / win, mode="same")
    seed = hashlib.sha1(cid.encode("utf-8")).digest()
    cuts, k = [0.0], 0
    while duration - cuts[-1] > 10.0:
        want = cuts[-1] + 3.0 + 6.0 * seed[k % len(seed)] / 255.0
        k += 1
        lo, hi = int(max(cuts[-1] + 2.0, want - 1.0) * 16000), int(min(duration - 2.0, want + 1.0) * 16000)
        if hi <= lo:
            break
        cuts.append(round((lo + int(np.argmin(energy[lo:hi]))) / 16000.0, 3))
    return cuts + [duration]


def cmd_run(args) -> int:
    prof = _profile(args)
    engine = _engine(args, prof)
    outdir = os.path.join(args.store, "results", _label(args))
    os.makedirs(_local(outdir), exist_ok=True)
    def one(item) -> int:
        cid, clip = item
        out = os.path.join(outdir, cid + ".json")
        if os.path.exists(out) and not args.again:
            return 0
        # the benchmark's own HOME: its reading cache is kept between runs, so a profile that changes only what happens to
        # the words afterwards (repair, which reading wins) is scored in seconds, not hours. --cold: an empty one, for timing.
        name = "home" + ("-" + os.path.basename(args.model_dir.rstrip("/")) if args.model_dir else "") + ("-" + args.compute if args.compute else "")
        home = tempfile.mkdtemp(prefix="bench-subs-home-") if args.cold else _local(os.path.join(args.store, name))
        app = os.path.join(home, "Library", "Application Support", "Asistent")
        os.makedirs(app, exist_ok=True)
        for name in ("models", "venv-align"):              # read-only use; nothing is written into either
            if os.path.exists(os.path.join(APP, name)) and not os.path.lexists(os.path.join(app, name)):
                try:
                    os.symlink(os.path.join(APP, name), os.path.join(app, name))
                except FileExistsError:                    # another job of this run made it first
                    pass
        env = dict(os.environ, HOME=home, PYTHONPATH=engine)
        env.pop("ASISTENT_CACHE_DIR", None)
        env.pop("ASISTENT_RECOGNITION", None)
        env.update(prof.get("env", {}))
        env.pop("ELEVENLABS_API_KEY", None)                # a local profile never has the key in reach
        if prof.get("upload"):
            if not args.upload:
                sys.exit("This profile sends the videos' sound to ElevenLabs: run it with --upload only on the user's yes.")
            with open(CLOUD_KEY, encoding="utf-8") as f:
                env["ELEVENLABS_API_KEY"] = f.read().strip()
        if args.model_dir:
            env["BENCH_WHISPER_DIR"] = os.path.abspath(args.model_dir)
        if args.compute:
            env["BENCH_COMPUTE"] = args.compute
        job = dict(clip, id=cid, path=os.path.join(args.store, "audio", clip["audio"]))
        if args.pieces:
            job["pieces"] = _pieces(job["path"], cid, clip["duration"])
        try:
            rc = subprocess.run([sys.executable, os.path.abspath(__file__), "_child", "--profile", args.profile, "--engine", engine,
                                 "--body", json.dumps(prof["body"]), "--clip-json", json.dumps(job), "--out", out], env=env).returncode
        finally:
            if args.cold:
                shutil.rmtree(home, ignore_errors=True)
        if rc:
            print(f"{cid}: failed ({rc})", flush=True)
            return rc
        with open(out, encoding="utf-8") as f:
            r = json.load(f)
        print(f"{cid}: {len(r['words'])} words in {r['seconds']} s for {r['audio_seconds']:.0f} s of sound "
              + ("(readings from the cache: not a timing)" if r["cached"] else f"({r['seconds'] / r['audio_seconds']:.2f} s per second)"), flush=True)
        return 0

    # --jobs: videos side by side. A profile that reads each window once uses one of the Mac's three readers per video, so
    # three at a time is how the app itself is loaded; the seconds then describe a busy machine: time a profile with --jobs 1
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        codes = list(pool.map(one, _clips(args).items()))
    return next((c for c in codes if c), 0)


# ---------------------------------------------------------------- cloud

CLOUD_URL = "https://api.elevenlabs.io/v1/speech-to-text"
CLOUD_KEY = os.path.expanduser("~/.config/asistent/elevenlabs.key")


def cmd_cloud(args) -> int:
    """A cloud recogniser (ElevenLabs Scribe) on the same sound, scored like any profile: `score --profile <model>`.

    Asistent itself stays local ("no cloud, nothing uploaded"): this exists to MEASURE how far a cloud model is ahead of
    large-v3 on the office's own Bulgarian before the user decides anything (2026-11-20: Whisper's first reading holds most
    of the wrong words, and no local setting moved it far). It UPLOADS the sound of each chosen video to ElevenLabs, so it
    runs only with --upload, which is the user's yes for that run. The key is read from a file outside the repo (or
    ELEVENLABS_API_KEY) and handed to curl on its standard input: never on a command line, never printed, never stored."""
    if not args.upload:
        sys.exit("cloud sends the videos' sound to ElevenLabs: run it with --upload only when the user said yes to that.")
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key and os.path.isfile(CLOUD_KEY):
        with open(CLOUD_KEY, encoding="utf-8") as f:
            key = f.read().strip()
    if not key:
        sys.exit(f"No API key: put it in {CLOUD_KEY} (pbpaste > that file) or in ELEVENLABS_API_KEY.")
    label = args.model
    outdir = os.path.join(args.store, "results", label)
    os.makedirs(_local(os.path.join(outdir, "raw")), exist_ok=True)
    failed = 0
    for cid, clip in _clips(args).items():
        out = os.path.join(outdir, cid + ".json")
        if os.path.exists(out) and not args.again:
            continue
        audio = os.path.join(args.store, "audio", clip["audio"])
        t0 = time.time()
        r = subprocess.run(["curl", "-sS", "--max-time", "600", "-K", "-", "-X", "POST", CLOUD_URL,
                            "-F", f"model_id={args.model}", "-F", "language_code=bul", "-F", "timestamps_granularity=word",
                            "-F", "tag_audio_events=false", "-F", "diarize=false", "-F", f'file=@"{audio}"'],
                           input=f'header = "xi-api-key: {key}"\n', capture_output=True, text=True)
        seconds = time.time() - t0
        try:
            data = json.loads(r.stdout)
        except ValueError:
            data = {}
        if r.returncode or "words" not in data:
            failed += 1
            detail = data.get("detail") if isinstance(data, dict) else None
            print(f"{cid}: failed ({str(detail or r.stderr or r.stdout)[:300].replace(key, '<key>')})", flush=True)
            if isinstance(detail, dict) and detail.get("status") in ("invalid_api_key", "missing_permissions", "quota_exceeded"):
                return 1                                   # the same answer would come for every video
            continue
        with open(os.path.join(outdir, "raw", cid + ".json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        words = [{"word": w["text"], "start": round(float(w.get("start") or 0.0), 3), "end": round(float(w.get("end") or 0.0), 3),
                  "p": round(float(2.718281828459045 ** min(0.0, float(w.get("logprob") or 0.0))), 3)}
                 for w in data["words"] if w.get("type") == "word" and str(w.get("text", "")).strip()]
        with open(out, "w", encoding="utf-8") as f:
            # the same keys a local run leaves, so `score` reads it: no text layer ran, so first reading = final text
            json.dump({"profile": label, "clip": cid, "seconds": round(seconds, 1), "audio_seconds": clip["duration"], "preset": "",
                       "words": words, "verbatim": words, "edits": {}, "segments": [], "readings": {}, "counts": {"words": len(words)},
                       "asr_seconds": round(seconds, 1), "cached": False, "language": data.get("language_code"),
                       "language_probability": data.get("language_probability")}, f, ensure_ascii=False, indent=1)
        print(f"{cid}: {len(words)} words in {seconds:.1f} s for {clip['duration']:.0f} s of sound "
              f"({seconds / clip['duration']:.2f} s per second, upload included)", flush=True)
    return 1 if failed else 0


# ---------------------------------------------------------------- score

def cmd_score(args) -> int:
    from asistent import lexicon
    from asistent.bench import layers

    known = lexicon.known if lexicon.available() else None      # puts back Cyrillic words read in look-alike Latin letters
    rows, missing = [], []
    for cid, clip in _clips(args).items():
        ref = os.path.join(args.store, "refs", cid + ".ref.txt")
        res = os.path.join(args.store, "results", args.profile, cid + ".json")
        if not os.path.isfile(ref) or not os.path.isfile(res):
            missing.append(cid)
            continue
        with open(ref, encoding="utf-8") as f:
            ref_text = layers.reference(f.read(), known)
        with open(res, encoding="utf-8") as f:
            run = json.load(f)
        rows.append((cid, clip, run, layers.compare(ref_text, run["verbatim"], run["words"], run["edits"], run["segments"])))
    if missing:
        print("Not scored (no reference or no run): " + ", ".join(missing))
    if not rows:
        return 1
    kinds = [k for k, _ in layers.KINDS] + ["swap", "unlogged"]

    def total(group):
        n = sum(c["words"] for *_, c in group)
        err = lambda side: sum(c[side]["sub"] + c[side]["del"] for *_, c in group)        # reference words wrong or missing
        extra = lambda side: sum(c[side]["ins"] for *_, c in group)
        by = lambda side: {k: sum(1 for *_, c in group for b in c[side] if b["cause"] == k) for k in kinds}
        return {"videos": len(group), "words": n, "first": err("first") / max(n, 1), "final": err("final") / max(n, 1),
                "wrong": (err("first"), err("final")), "extra": (extra("first"), extra("final")),
                "broken": by("broken"), "fixed": by("fixed"),
                "invented": (sum(len(c["first"]["invented"]) for *_, c in group), sum(len(c["final"]["invented"]) for *_, c in group)),
                "speed": timed(group)}

    def timed(group):
        """Seconds of work per second of sound, over the runs that really recognised (a cached reading is not a timing)."""
        runs = [r for _, _, r, _ in group if not r.get("cached")]
        return f"{sum(r['seconds'] for r in runs) / sum(r['audio_seconds'] for r in runs):.2f}" if runs else "cached"

    def cell(d):
        return ", ".join(f"{k} {v}" for k, v in d.items() if v) or "0"
    lines = [f"### {args.profile}: the whole subtitle job against the editors' burned-in subtitles",
             "Pessimistic absolute numbers (music under the voice, tidied text, text-recognition misreads): compare rows, not the level.", "",
             "Wrong = a reference word written differently or missing. Extra words are counted apart: most are speech the editors left without a subtitle.", "",
             "| client | split | videos | ref words | wrong, first reading | wrong, final text | right → wrong | wrong → right | extra words (first / final) | invented lines (first / final) | s per s of sound |",
             "|---|---|---|---|---|---|---|---|---|---|---|"]
    groups = {}
    for row in rows:
        groups.setdefault((row[1]["slug"], row[1]["split"]), []).append(row)
    for split in ("dev", "heldout"):
        part = [r for r in rows if r[1]["split"] == split]
        if part:
            groups[("ALL", split)] = part
    for (slug, split), group in sorted(groups.items(), key=lambda kv: (kv[0][0] == "ALL", kv[0])):
        t = total(group)
        lines.append(f"| {slug} | {split} | {t['videos']} | {t['words']} | {t['wrong'][0]} ({100 * t['first']:.1f} %) | {t['wrong'][1]} ({100 * t['final']:.1f} %) | "
                     f"{cell(t['broken'])} | {cell(t['fixed'])} | {t['extra'][0]} / {t['extra'][1]} | {t['invented'][0]} / {t['invented'][1]} | {t['speed']} |")
    print("\n".join(lines))
    report = lines + ["", "## Words (private: client speech)"]
    for name, side in (("right → wrong", "broken"), ("wrong → right", "fixed")):
        report += ["", f"### {name}", "| clip | cause | said (reference) | first reading | final text |", "|---|---|---|---|---|"]
        report += [f"| {cid} | {b['cause']} | {b['ref']} | {b['first'] or '–'} | {b['final'] or '–'} |" for cid, _, _, c in rows for b in c[side]]
    report += ["", "### invented lines in the final text"] + [f"- {cid}: {t}" for cid, _, _, c in rows for t in c["final"]["invented"]]
    out = os.path.join(args.store, "reports")
    os.makedirs(_local(out), exist_ok=True)
    path = os.path.join(out, f"{args.profile} {args.set} {time.strftime('%Y-%m-%d %H-%M-%S')}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print(f"\nThe words behind the counts: {path}")
    if args.examples:
        shown = [(cid, b) for cid, _, _, c in rows for b in c["broken"]][:args.examples]
        if shown:
            print("\nright → wrong, first examples: " + "; ".join(f"{b['ref']} → {b['final'] or '(dropped)'} [{b['cause']}]" for _, b in shown))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("action", choices=["pick", "refs", "run", "score", "cloud", "_child"])
    ap.add_argument("folder", nargs="?")
    ap.add_argument("--store", default=STORE)
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--per-plan", type=int, default=2)
    ap.add_argument("--slug")
    ap.add_argument("--profile", default="strict")
    ap.add_argument("--set", default="all", choices=["dev", "heldout", "all"])
    ap.add_argument("--client")
    ap.add_argument("--clip")
    ap.add_argument("--again", action="store_true")
    ap.add_argument("--cold", action="store_true", help="run: an empty scratch HOME (nothing cached), for timing a profile")
    ap.add_argument("--model-dir", help="run: a CTranslate2 Whisper model folder to try in place of large-v3 (its own cache)")
    ap.add_argument("--compute", help="run: the model's arithmetic on the processor, e.g. float32 (the app: int8; its own cache)")
    ap.add_argument("--jobs", type=int, default=1, help="run: this many videos at the same time (accuracy runs; not for timing)")
    ap.add_argument("--pieces", action="store_true", help="run: each video cut into clips of 3-9 s, as on a real timeline (results under <profile>+p)")
    ap.add_argument("--examples", type=int, default=15)
    ap.add_argument("--next", help="run: NEXT with these fields (JSON), stored under --profile's name")
    ap.add_argument("--base", default="next", choices=["next", "cloud"], help="run --next: the profile the fields change")
    ap.add_argument("--upload", action="store_true", help="cloud: yes, send the chosen videos' sound to ElevenLabs")
    ap.add_argument("--model", default="scribe_v3", help="cloud: the ElevenLabs model (results under its name)")
    ap.add_argument("--clip-json")
    ap.add_argument("--body")
    ap.add_argument("--engine")
    ap.add_argument("--out")
    args = ap.parse_args()
    if args.action == "_child":
        sys.path.insert(0, args.engine)                    # the code this profile runs: the working tree's or a kept version's
        return child(args)
    # the child already runs with the app's Python, and its HOME is the scratch folder (APP would point into it)
    if args.action != "_child" and os.path.realpath(sys.prefix) != os.path.realpath(os.path.join(APP, "venv")):
        env = dict(os.environ, PYTHONPATH=os.path.join(REPO, "engine"))
        return subprocess.run([APP_PY, os.path.abspath(__file__), *sys.argv[1:]], env=env).returncode
    sys.path.insert(0, os.path.join(REPO, "engine"))
    if args.action == "pick" and not args.folder:
        ap.error("pick needs the client's export folder")
    return {"pick": cmd_pick, "refs": cmd_refs, "run": cmd_run, "score": cmd_score, "cloud": cmd_cloud, "_child": child}[args.action](args)


if __name__ == "__main__":
    sys.exit(main())
