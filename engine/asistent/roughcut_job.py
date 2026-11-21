"""The `/roughcut` job (Phase 8 M2): selected dialogue -> a new rough-cut sequence as FCP7 XML + a report on disk.

Safe Cut takes out only pauses that are certainly silence; Smart Cut shortens every pause to its budget. Both cut a
plain repeated take (takes.py: the last full take stays). The source sequence is never touched: the panel imports the
XML as a new sequence.

Nothing here talks to Premiere. Words come from the same Whisper readings as the subtitles (cached by their audio, so a
second run with another mode or tempo costs seconds); without the speech model the pauses are cut from the energy and
Silero alone, and the result says so. Since 0.10.121 Cut silences' AI-assisted words come from ElevenLabs Scribe when the
editor saved a key and left the switch on (the user, 2026-11-21), never in a ReShape project (`is_reshape`).
"""
from __future__ import annotations

import json
import logging

import numpy as np
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from . import asr, cloudasr, edl, learning, media, pauses, recognition, silence, speechmap, subtitles, takes, vad, xmeml
from .dialoguemix import ASR_SR, build_mix, read_segment
from .subtitle_job import PAD, _cached, _inside, _same_word, _store, plan_windows, read_window, window_audio

log = logging.getLogger("asistent")
MODES = {"safe": "safe", "smart": "smart", "silence": "silences", "offmic": "silences + off-mic", "ai": "AI rough cut"}
SILENCE_MODES = silence.MODES                     # the panel's three: silence.py decides, run_silence builds
# 0.10.65 (the user 2026-11-12): the panel's only mode is "silence" (Remove silences, silence.py: no recognition); Safe and
# Smart (words, repeated takes) stay in the engine for a later Review step but are no longer offered
MIN_PIECE_FRAMES = 2
# When there are fewer windows than readers, long pieces are read in parts of about this many seconds, cut at their quietest
# moment, so the readers work side by side (0.10.25, the user: "the rough cut took way too much time"). One long window
# kept two of the three readers idle; measured on the M4 Max: GStroy C9036 118 s 189 -> 87 s, Beauty Sector fx30-2-1304
# 133 s 137 -> 45 s. The words may differ from
# one long reading, which the cut can afford (it needs where speech is and which takes repeat, not the spelling); the
# subtitles keep their own long windows.
PART = 30.0
# 0.10.40 (the user's choice 2026-11-11, TODO A "rough cut faster on many clips"): the cut can read with large-v3-turbo. Measured
# on GStroy FX3 (15 clips, 215 s, empty cache, M4 Max): 76.7 -> 35.8 s, but the takes differ: turbo missed a false start and
# resolved one group of three takes differently (takes cut 58.4 -> 34.5 s, result 108.8 -> 123.3 s). So it is a switch the
# editor turns on ("Fast"), never the default. Its words are kept under their own cache key (TURBO_KEY + the subtitles' key), so
# the subtitles never see them; a subtitle reading of the same audio (large-v3) is still reused when it is there, at no cost.
TURBO_KEY = "turbo3-"      # 0.10.45: read with asr.ROUGH_COMPRESSION (the 0.10.40 "turbo-" readings are not reused)
ROUGH_KEY = "rough3-"      # 0.10.45: the rough cut's own large-v3 reading (asr.ROUGH_COMPRESSION)
# 0.10.121 (the user, 2026-11-21: "can we also use elevenlabs there to recognize speech faster"): Cut silences' AI-assisted
# words are read by Scribe like the subtitles' (recognition.CLOUD), never in a ReShape project: its subtitles are frozen on
# this computer and its sound stays here too. ReShape is known by its folder ("ReShape", or the doctor's name the Brand tab
# uses for it), also when Finder mounted a deeper folder of the share as its own volume (learning._mounts).
RESHAPE_MARKS = ("reshape", "решейп", "denkov", "денков")


def is_reshape(folder: str) -> bool:
    """Is this project folder (or the share path behind its mount) a ReShape one?"""
    if not folder:
        return False
    path = os.path.abspath(folder)
    paths = [path]
    for _host, remote, point in learning._mounts():
        if path == point or path.startswith(point + "/"):
            paths.append(remote + path[len(point):])
    parts = [re.sub(r"[^0-9a-zа-я]", "", part.lower()) for p in paths for part in re.split(r"[\\/]", p)]
    return any(m in part for part in parts for m in RESHAPE_MARKS)


def use_cloud(out_dir: str) -> bool:
    """Scribe reads the words of this Cut silences run: a key is saved, the switch is on and it is not a ReShape project."""
    return cloudasr.available() and not is_reshape(out_dir)


def model(fast: bool = False) -> str | None:
    """Which recognizer the rough cut uses: turbo when asked for and downloaded, else large-v3, else none."""
    if not asr.backend_installed():
        return None
    if fast and asr.model_present(asr.TURBO):
        return asr.TURBO
    return asr.LARGE if asr.model_present() else None


def read_rough(win: dict, kind: str, progress, cancelled) -> dict:
    """One window's words for the cut: the subtitles' large-v3 reading if cached, else the rough cut's own reading (with
    asr.ROUGH_COMPRESSION, under its own cache key, so the subtitles never get a reading made with other settings)."""
    y, key = window_audio(win, "")
    if kind == asr.LARGE:
        entry = _cached(key) or {}
        if "words" in entry:
            return {"y": y, "key": key, "entry": entry, "cached": True}
        key = ROUGH_KEY + key
    else:
        entry = _cached(key) or {}
        if "words" in entry:
            return {"y": y, "key": key, "entry": entry, "cached": True}
        key = TURBO_KEY + key
    entry = _cached(key) or {}
    cached = "words" in entry
    if not cached:
        entry = {"words": asr.transcribe(y, None, progress, cancelled, model=kind, compression=asr.ROUGH_COMPRESSION)}
        _store(key, entry)
    return {"y": y, "key": key, "entry": entry, "cached": cached}


def read_cloud(win: dict, kind: str | None, progress, cancelled) -> dict:
    """One window's words from Scribe. The reading is the subtitles' own (same sound, same request, same cache key: an empty
    prompt and recognition.CLOUD's tag), so a window either feature already sent is never sent again. When ElevenLabs cannot
    read it, the window is read on this computer as before ("fallback": the reason), or gives no words without a model."""
    y, key = window_audio(win, "", recognition.CLOUD)
    entry = _cached(key) or {}
    if "words" in entry:
        return {"y": y, "key": key, "entry": entry, "cached": True}
    try:
        # only the sound goes, as for the subtitles (cloudasr.py says what leaves the computer and why)
        entry = {"words": cloudasr.transcribe(y, progress, cancelled, recognition.CLOUD.cloud), "by": recognition.CLOUD.cloud}
    except cloudasr.CloudError as e:
        log.warning("silences: %s; this window is recognised on this computer", e)
        if not kind:
            return {"y": y, "key": key, "entry": {"words": []}, "cached": False, "fallback": str(e), "missed": True}
        return {**read_rough(win, kind, progress, cancelled), "fallback": str(e)}
    _store(key, entry)
    return {"y": y, "key": key, "entry": entry, "cached": False}


def split_long(segments: list[dict], read=read_segment, part: float = PART) -> list[dict]:
    """Pieces over `part` + 10 s -> parts of `part` ± a few seconds, each cut in its quietest 0.4 s, with the same keys
    (`at` moved with the start)."""
    out: list[dict] = []
    for sg in segments:
        if sg["end"] - sg["start"] <= part + 10.0:
            out.append(sg)
            continue
        y, _ = read(sg, 0.0)
        sr = ASR_SR
        win = max(1, int(0.4 * sr))
        energy = np.convolve(np.asarray(y, dtype=np.float64) ** 2, np.ones(win) / win, mode="same")
        cuts = [0]
        while len(y) - cuts[-1] > int((part + 10.0) * sr):
            lo, hi = cuts[-1] + int((part - 8.0) * sr), cuts[-1] + int((part + 4.0) * sr)
            cuts.append(lo + int(np.argmin(energy[lo:hi])))
        times = [sg["start"] + c / sr for c in cuts] + [sg["end"]]
        for a, b in zip(times, times[1:]):
            out.append({**sg, "start": a, "end": b, "at": sg["at"] + (a - sg["start"])})
    return out


def _num(v, what: str, lo: float = 0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"Invalid value: {what}.")
    if not f >= lo:
        raise ValueError(f"Invalid value: {what}.")
    return f


def validate(body: dict) -> dict:
    items = body.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("Select the clips with speech in the timeline (the cameras and the microphones).")
    dialogue = []
    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get("path"), str):
            raise ValueError("Invalid clip in the request.")
        if not os.path.isfile(it["path"]):
            raise ValueError("The file is missing (offline media?): " + os.path.basename(it["path"]))
        start, end = _num(it.get("start"), "start"), _num(it.get("end"), "end")
        if end <= start:
            raise ValueError("Invalid clip in the request.")
        dialogue.append({"path": it["path"], "start": start, "end": end, "at": _num(it.get("at"), "position"),
                         "name": str(it.get("name") or os.path.basename(it["path"])), "track": int(_num(it.get("track", 0), "track")),
                         **({"side": it["side"]} if it.get("side") in ("L", "R") else {})})
    layout = body.get("layout")
    if not isinstance(layout, list) or not layout:
        raise ValueError("Select the clips to cut in the timeline.")
    lay = []
    for it in layout:
        if not isinstance(it, dict) or it.get("kind") not in ("video", "audio") or not isinstance(it.get("path"), str):
            raise ValueError("Invalid clip in the request.")
        if not os.path.isfile(it["path"]):
            raise ValueError("The file is missing (offline media?): " + os.path.basename(it["path"]))
        s, e = _num(it.get("start"), "start"), _num(it.get("end"), "end")
        if e <= s:
            raise ValueError("Invalid clip in the request.")
        ch = int(it.get("channel") or 0)
        if ch not in (0, 1, 2):
            raise ValueError("Invalid channel in the request.")
        try:
            gain = None if it.get("gain_db") is None else float(it["gain_db"])
        except (TypeError, ValueError):
            raise ValueError("Invalid level in the request.")
        lay.append({"kind": it["kind"], "track": int(_num(it.get("track", 0), "track")), "path": it["path"], "start": s, "end": e,
                    "inPt": _num(it.get("inPt", 0), "in point"), "name": str(it.get("name") or os.path.basename(it["path"])),
                    "channel": ch, "gain_db": gain})
    mode, tempo = body.get("mode", "safe"), body.get("tempo", "normal")
    sil = silence.settings(body) if mode in SILENCE_MODES else None    # 0.10.96: every choice of Cut silences, checked
    if mode not in MODES or (sil is None and tempo not in pauses.TEMPO):
        raise ValueError("Invalid mode or tempo.")
    threshold = sil["threshold"] if sil else None
    if sil and sil["listen"] is not None and not any(d["track"] in sil["listen"] for d in dialogue):
        raise ValueError("Tick at least one audio track to listen to.")
    out_dir = body.get("out_dir")
    if not isinstance(out_dir, str) or not os.path.isdir(out_dir):
        raise ValueError("The project folder was not found: save the project and try again.")
    return {"dialogue": dialogue, "layout": lay, "mode": mode, "tempo": tempo, "out_dir": out_dir,
            "fps": subtitles.exact_fps(_num(25.0 if body.get("fps") is None else body.get("fps"), "frames per second", 1.0)),
            "width": int(_num(body.get("width") or 1920, "width", 1)), "height": int(_num(body.get("height") or 1080, "height", 1)),
            "name": str(body.get("name") or "sequence"), "markers": bool(body.get("markers")), "skipped": body.get("skipped") or [],
            "fast": bool(body.get("fast")), "threshold": threshold, "settings": sil, "preview": bool(body.get("preview")),
            # 0.10.95: Auto cuts the quieter voices (silence.QUIET_UNDER_DB) unless the editor keeps them
            "quiet": bool(sil and sil["mode"] != "silence")}


def _words(segments: list[dict], progress, cancelled, fast: bool = False, cloud: bool = False) -> tuple[list[dict], dict]:
    """Whisper words of the pieces in SEQUENCE seconds (verbatim, no spelling work: the cut needs where speech is, not how it
    is spelled) and a note on how they were made. `cloud`: Scribe reads them (read_cloud), this computer only where it fails."""
    kind = model(fast)
    if not kind and not cloud:
        return [], {"asr": False, "note": "No speech model: the pauses were found only by the sound level and Silero."}
    wins = plan_windows(segments)
    # fewer windows than readers (one long clip): long pieces are read in parts, unless the subtitles' readings of the same
    # media are all there to reuse. With as many windows as readers splitting only adds work (REVO, three clips of 102-190 s:
    # 106 s as three windows, 167 s as sixteen parts). Scribe reads a whole window in seconds: no parts
    if not cloud and len(wins) < asr.workers() and not all("words" in (_cached(window_audio(w, "")[1]) or {}) for w in wins):
        parts = split_long(segments)
        if len(parts) > len(segments):
            wins = plan_windows(parts, max_window=PART + 2 * PAD + 10.0)
    total = sum(w["b"] - w["a"] for w in wins) or 1.0
    shares = [(w["b"] - w["a"]) / total for w in wins]
    frac = [0.0] * len(wins)

    def read_one(i):
        def on_progress(f, m):
            frac[i] = f
            progress(sum(a * b for a, b in zip(frac, shares)), m)
        return (read_cloud if cloud else read_rough)(wins[i], kind, on_progress, cancelled)

    reads = [None] * len(wins)
    order = sorted(range(len(wins)), key=lambda i: -(wins[i]["b"] - wins[i]["a"]))
    with ThreadPoolExecutor(max_workers=max(1, min(asr.workers(), len(wins)))) as pool:
        futures = {i: pool.submit(read_one, i) for i in order}
        try:
            for i, f in futures.items():
                reads[i] = f.result()
        except BaseException:
            for f in futures.values():
                f.cancel()
            raise
    words: list[dict] = []
    for win, rd in zip(wins, reads):
        for sg in win["pieces"]:
            lo = sg["start"] - win["a"]
            hi = lo + (sg["end"] - sg["start"])
            words += [{"word": w["word"], "start": sg["at"] + w["start"] - lo, "end": sg["at"] + w["end"] - lo, "p": w.get("p")}
                      for w in rd["entry"]["words"] if _inside(w, lo, hi)]
    words.sort(key=lambda w: (w["start"], w["end"]))
    unique: list[dict] = []
    for w in words:
        if not any(_same_word(w, u) for u in unique[-3:]):
            unique.append(w)
    how = {"asr": True, "cached": all(r["cached"] for r in reads), "windows": len(wins), "model": kind}
    if cloud:
        # who read the words, for the result line (as the subtitles report it): "local" windows were read on this computer,
        # "missed" ones gave no words (no model here either)
        missed = sum(1 for r in reads if r.get("missed"))
        how.update({"model": recognition.CLOUD.cloud, "recognizer": {
            "name": cloudasr.NAME, "windows": len(wins), "local": sum(1 for r in reads if r.get("fallback") and not r.get("missed")),
            "missed": missed, "fallback": sorted({r["fallback"] for r in reads if r.get("fallback")})}})
        if missed == len(wins):
            how.update({"asr": False, "note": "ElevenLabs could not read the speech and there is no speech model on this computer: "
                                              "detected without recognition (no hesitation sounds, no repeated takes)."})
    return unique, how


def _version(folder: str, stem: str) -> int:
    n = 1
    while os.path.exists(os.path.join(folder, f"{stem} v{n}.xml")):
        n += 1
    return n


def _clock(t: float) -> str:
    return f"{int(t // 60)}:{t % 60:04.1f}"


def run(body: dict, progress: Callable[[float, str], None], cancelled: Callable[[], bool]) -> dict:
    p = validate(body)
    t0 = time.time()
    media.probe_all([d["path"] for d in p["dialogue"]] + [i["path"] for i in p["layout"]])     # the XML needs every file's facts
    if p["mode"] in SILENCE_MODES:
        return run_silence(p, progress, cancelled, t0)
    fps = p["fps"]
    progress(0.0, "Reading the sound…")
    mix = build_mix(p["dialogue"], lambda f, m: progress(0.1 * f, m), cancelled)
    words, how = _words(mix["segments"], lambda f, m: progress(0.1 + 0.6 * f, m), cancelled, p["fast"])
    progress(0.72, "Finding the pauses…")
    t_start = round(min(i["start"] for i in p["layout"]) * fps) / fps
    t_end = round(max(i["end"] for i in p["layout"]) * fps) / fps
    # the map spans the WHOLE selection, not only the sound: time with no selected sound is silence to the map
    full = np.zeros(int(np.ceil((t_end - t_start) * ASR_SR)), dtype=np.float32)
    o = int(round((mix["origin"] - t_start) * ASR_SR))
    lo, hi = max(o, 0), min(o + len(mix["audio"]), len(full))
    if hi > lo:
        full[lo:hi] = mix["audio"][lo - o:hi - o]
    sound = [(d["at"], d["at"] + (d["end"] - d["start"])) for d in p["dialogue"]]
    sm = speechmap.build(full, words, t_start, sound=sound)
    present = [(i["start"], i["end"]) for i in p["layout"]]
    by_track: dict = {}
    for i in p["layout"]:
        by_track.setdefault((i["kind"], i["track"]), []).append((i["start"], i["end"]))
    plan = pauses.plan(sm, words, fps, p["mode"], p["tempo"], sound, present, by_track)
    # repeated takes: a plain repeat goes in both modes (from the first take to the winner), a start repeated inside a
    # sentence only in Smart; a group said differently is only listed
    found = takes.find(words)
    take_cuts = []
    for g in found:
        wanted = g["cut"] if p["mode"] == "smart" or g["kind"] != "restart" else []
        edges = [e for e in (pauses.take_edges(a, b, sm, words) for a, b in wanted) if e]
        g["applied"], g["cut_s"] = bool(edges), round(sum(b - a for a, b in edges), 2)
        take_cuts += edges
    cuts = pauses.snap(pauses.with_takes(plan["cuts"], take_cuts, sm) if take_cuts else plan["cuts"], fps)   # onto the frame grid
    kept = edl.kept_ranges(t_start, t_end, cuts)
    pieces = [x for x in edl.pieces(p["layout"], kept, fps) if x["end"] - x["start"] >= MIN_PIECE_FRAMES]
    pieces, flashes = edl.drop_flashes(pieces)
    before, after = (round(t_end * fps) - round(t_start * fps)) / fps, edl.total_frames(kept, fps) / fps

    folder = os.path.join(p["out_dir"], "Asistent_roughcut")
    os.makedirs(folder, exist_ok=True)
    stem = f"ROUGH – {p['name']} ({MODES[p['mode']]})"
    ver = _version(folder, stem)
    seq_name = f"{stem} v{ver}"
    marks = []
    plan["voiced"] = [(a, b) for a, b in plan["voiced"] if not any(x <= a and b <= y for x, y in cuts)]
    if p["markers"]:
        for a, b in plan["voiced"]:                               # where each listed stretch lands in the output
            marks.append({"frame": edl.output_frame(kept, fps, a), "name": "Review",
                          "comment": f"speech without a word, {b - a:.1f} s (laughter, a reaction or a missed word)"})
    for g in found:
        for t in g["takes"]:
            t["start"], t["end"] = round(t["start"], 2), round(t["end"], 2)
        g["cut"] = [[round(a, 2), round(b, 2)] for a, b in g["cut"]]
        g["out_at"] = round(edl.output_frame(kept, fps, g["takes"][g["recommended"] if g["applied"] else 0]["start"]) / fps, 2)
        if p["markers"]:
            n = len(g["takes"])
            marks.append({"frame": round(g["out_at"] * fps), "name": "Review",
                          "comment": f"{g['kind_label']} ×{n}: " + (f"kept #{g['recommended'] + 1}, the others were cut" if g["applied"] else
                                                                f"best is #{g['recommended'] + 1}" + ("" if g["safe"] else "; said differently, review"))})
    progress(0.85, "Building the sequence…")
    xml_path = os.path.join(folder, seq_name + ".xml")
    layout_check = xmeml.write(xml_path, seq_name, fps, p["width"], p["height"], pieces, marks)
    # 0.10.45: the same sequence without clips; the panel fills it with clones of the editor's own clips (xmeml.write shell)
    shell_path = os.path.join(folder, seq_name + " (shell).xml")
    xmeml.write(shell_path, seq_name, fps, p["width"], p["height"], pieces, marks, shell=True)
    review = [{"at": round(a, 2), "end": round(b, 2), "kind": "voiced", "text": "Speech without a recognised word (laughter, a reaction or a missed word): kept."}
              for a, b in plan["voiced"]]
    saved = sum(b - a for a, b in cuts)
    result = {
        "xml": xml_path, "shell": shell_path, "json": os.path.join(folder, seq_name + ".json"), "name": seq_name, "mode": p["mode"], "tempo": p["tempo"], "tempo_label": pauses.TEMPO_LABEL[p["tempo"]],
        "before_s": round(before, 2), "after_s": round(after, 2), "saved_s": round(saved, 2),
        "takes_cut_s": round(sum(g["cut_s"] for g in found), 2),
        "flashes_dropped": flashes, "hole_speech_s": plan["hole_speech_s"], "no_sound_s": plan["no_sound_s"], "empty_s": plan["empty_s"],
        "pieces": [{"kind": x["kind"], "track": x["track"], "item": x["item"], "start": x["start"], "end": x["end"],
                    "path": x["path"], "src_in": x["src_in"], "src_out": x["src_out"],
                    "seq_in": x["seq_in"], "seq_out": x["seq_out"]} for x in pieces],                # the panel checks each one (0.10.6)
        "counts": {"pauses_seen": plan["gaps"], "cuts": len(cuts), "kept_ranges": len(kept), "pieces": len(pieces), "review": len(review), "takes": len(found),
                   "takes_cut": sum(1 for g in found if g["applied"])},
        "takes": found, "marks": marks,
        "cuts": [{"start": round(a, 3), "end": round(b, 3)} for a, b in cuts], "review": review,
        "check": {"frames": layout_check["frames"], "video": layout_check["video"], "audio": layout_check["audio"], "fps": fps},
        "speech": {**how, "words": len(words), "vad": sm["vad"], "thresholds": {k: round(v, 6) for k, v in sm["thr"].items()}},
        "skipped": p["skipped"], "seconds": round(time.time() - t0, 1),
    }
    with open(result["json"], "w", encoding="utf-8") as f:
        json.dump({**result, "words": words, "items": p["layout"]}, f, ensure_ascii=False, indent=1)
    log.info("roughcut: %s %s/%s %.1f -> %.1f s (%d cuts, %d review) words=%d asr=%s vad=%s in %.1f s", seq_name, p["mode"], p["tempo"],
             before, after, len(cuts), len(review), len(words), how.get("asr"), sm["vad"], time.time() - t0)
    progress(1.0, "Done")
    return result


_WORDS: dict = {}                                 # the words of the last selections (AI): a preview after a changed setting reads nothing again


def _silence_words(dialogue: list[dict], fast: bool, progress, cancelled, cloud: bool = False) -> tuple[list[dict], dict]:
    """The recognised words for AI-assisted detection, remembered by what was selected and by who reads them (the readings
    themselves are cached by their audio as well, like the subtitles')."""
    key = (fast, cloud, tuple((d["path"], round(d["start"], 3), round(d["end"], 3), round(d["at"], 3), d.get("side")) for d in dialogue))
    if key not in _WORDS:
        if not cloud and not model(fast):
            return [], {"asr": False, "note": "No speech model on this computer: detected without recognition (no hesitation sounds, no repeated takes)."}
        mix = build_mix(dialogue, lambda f, m: progress(0.1 * f, m), cancelled)
        _WORDS[key] = _words(mix["segments"], lambda f, m: progress(0.1 + 0.9 * f, m), cancelled, fast, cloud)
        while len(_WORDS) > 4:
            _WORDS.pop(next(iter(_WORDS)))
    return _WORDS[key]


def run_silence(p: dict, progress, cancelled, t0: float) -> dict:
    """Cut silences (0.10.65 silence.py; 0.10.96 modes, methods, preview and actions): every selected sound clip is listened
    to on its own, what goes is planned as regions (silence.plan), and either the plan comes back for the panel's preview
    (nothing written) or the new sequence is built like the rough cut's (XML + the shell the panel fills with clones of the
    editor's own clips)."""
    fps, s = p["fps"], p["settings"]
    t_start = round(min(i["start"] for i in p["layout"]) * fps) / fps
    t_end = round(max(i["end"] for i in p["layout"]) * fps) / fps
    dialogue = [d for d in p["dialogue"] if s["listen"] is None or d["track"] in s["listen"]]
    ai = s["method"] == "ai"
    progress(0.0, "Listening to the sound…")
    det = silence.detect(dialogue, t_start, t_end, progress=lambda f, m: progress((0.25 if ai else 0.75) * f, m), cancelled=cancelled, s=s)
    words, how, groups = [], {"asr": False}, []
    if ai:
        words, how = _silence_words(dialogue, p["fast"], lambda f, m: progress(0.25 + 0.5 * f, m), cancelled, use_cloud(p["out_dir"]))
        if s["mode"] == "ai" and words:
            groups = takes.find(words)
    pl = silence.plan(det, s, t_start, words, groups)
    raw = pl["cuts"]
    cuts = edl.align_to_edges(pauses.snap(raw, fps), p["layout"], fps)
    cuts = [(a, b) for a, b in cuts if (b - a) * fps >= MIN_PIECE_FRAMES - 1e-6]
    kept = edl.kept_ranges(t_start, t_end, cuts)
    before = (round(t_end * fps) - round(t_start * fps)) / fps
    saved = sum(b - a for a, b in cuts)
    by_kind: dict = {}
    for r in pl["regions"]:
        if r["cut"]:
            by_kind[r["kind"]] = round(by_kind.get(r["kind"], 0.0) + r["end"] - r["start"], 2)
    tracks = sorted({d["track"] for d in p["dialogue"]})
    common = {
        "mode": s["mode"], "method": s["method"], "threshold": s["threshold"], "tempo": s["pacing"], "tempo_label": silence.PACING_LABEL[s["pacing"]],
        "action": s["action"], "sensitivity": s["sensitivity"], "short": s["short"], "fillers": s["fillers"],
        "quiet": {"cut": s["mode"] != "silence" and s["method"] != "manual", "under_db": silence.UNDER_DB[s["sensitivity"]],
                  "seconds": round(by_kind.get("offmic", 0.0), 2)},
        "settings": {k: s[k] for k in ("min_silence", "min_speech", "before", "after", "short_min", "short_max")},
        "before_s": round(before, 2), "saved_s": round(saved, 2), "by_kind": by_kind,
        "flagged": sum(1 for r in pl["regions"] if r["flag"] and not r["cut"]),
        "restored": sum(1 for r in pl["regions"] if r.get("by") == "you" and not r["cut"] and not r["flag"]),
        "regions": pl["regions"], "cuts": [{"start": round(a, 3), "end": round(b, 3)} for a, b in cuts],
        "suggest_db": silence.suggest_threshold([i.get("main") for i in det["items"]]),
        "tracks": tracks, "listen": s["listen"],
        "what": s["mode"], "takes": [g for g in groups if g.get("applied") or g.get("listed")], "takes_cut_s": round(sum(g.get("cut_s", 0.0) for g in groups), 2),
        "speech": {"asr": bool(how.get("asr")), "note": how.get("note"), "words": len(words), "recognizer": how.get("recognizer"),
                   "vad": any(i["vad"] for i in det["items"]), "listened": det["items"]},
        "skipped": p["skipped"],
    }
    for g in groups:                                                   # as the rough cut reports them
        for t in g["takes"]:
            t["start"], t["end"] = round(t["start"], 2), round(t["end"], 2)
        g["cut"] = [[round(a, 2), round(b, 2)] for a, b in g["cut"]]
        g["out_at"] = round(edl.output_frame(kept, fps, g["takes"][g["recommended"] if g.get("applied") else 0]["start"]) / fps, 2)
    if p["preview"]:
        progress(1.0, "Done")
        log.info("silences preview: %s/%s %s %.1f s, %d regions (%s), %d flagged, %d sound clips in %.1f s", s["mode"], s["method"], s["pacing"],
                 before, len(pl["regions"]), by_kind, common["flagged"], len(dialogue), time.time() - t0)
        return {**common, "preview": True, "t_start": round(t_start, 3), "t_end": round(t_end, 3), "fps": fps,
                "after_s": round(before - saved if s["action"] == "remove" else before, 2),
                "env": {"hop": silence.ENV_HOP_S, "db": silence.envelope(det["env"])}, "seconds": round(time.time() - t0, 2)}
    flashes = 0
    if s["action"] == "remove":
        pieces = [x for x in edl.pieces(p["layout"], kept, fps) if x["end"] - x["start"] >= MIN_PIECE_FRAMES]
        pieces, flashes = edl.drop_flashes(pieces)
        after = edl.total_frames(kept, fps) / fps
    else:
        # the three that move nothing: the kept pieces where they were (spaces stay), every piece cut apart but there
        # (Split only), or the picture whole with the sound only where it is kept (Mute)
        whole = [(t_start, t_end)]
        if s["action"] == "gaps":
            # as Remove: a camera's last few frames inside a kept part are a flash once the editor closes the gaps
            pieces = [x for x in edl.pieces_in_place(p["layout"], kept, fps, t_start) if x["end"] - x["start"] >= MIN_PIECE_FRAMES]
            pieces, flashes = edl.drop_flashes(pieces)
        elif s["action"] == "split":
            pieces = edl.pieces_in_place(p["layout"], sorted(kept + cuts), fps, t_start)
        else:
            pieces = edl.pieces_in_place(p["layout"], whole, fps, t_start, audio_ranges=kept)
        pieces = [x for x in pieces if x["end"] - x["start"] >= 1]
        after = before
    progress(0.85, "Building the sequence…")
    folder = os.path.join(p["out_dir"], "Asistent_roughcut")
    os.makedirs(folder, exist_ok=True)
    stem = f"NO SILENCE – {p['name']}"
    seq_name = f"{stem} v{_version(folder, stem)}"
    xml_path = os.path.join(folder, seq_name + ".xml")
    layout_check = xmeml.write(xml_path, seq_name, fps, p["width"], p["height"], pieces, [])
    shell_path = os.path.join(folder, seq_name + " (shell).xml")
    xmeml.write(shell_path, seq_name, fps, p["width"], p["height"], pieces, [], shell=True)
    no_sound = float((~det["covered"]).sum()) * silence.HOP_S
    result = {
        **common, "mode": "silence",
        "xml": xml_path, "shell": shell_path, "json": os.path.join(folder, seq_name + ".json"), "name": seq_name,
        "after_s": round(after, 2), "flashes_dropped": flashes, "hole_speech_s": 0.0, "no_sound_s": round(no_sound, 2), "empty_s": 0.0,
        "pieces": [{"kind": x["kind"], "track": x["track"], "item": x["item"], "start": x["start"], "end": x["end"],
                    "path": x["path"], "src_in": x["src_in"], "src_out": x["src_out"],
                    "seq_in": x["seq_in"], "seq_out": x["seq_out"]} for x in pieces],
        "counts": {"pauses_seen": len(raw), "cuts": len(cuts), "kept_ranges": len(kept), "pieces": len(pieces), "review": common["flagged"],
                   "takes": len(groups), "takes_cut": sum(1 for g in groups if g.get("applied"))},
        "review": [],
        "check": {"frames": layout_check["frames"], "video": layout_check["video"], "audio": layout_check["audio"], "fps": fps},
        "seconds": round(time.time() - t0, 1),
    }
    with open(result["json"], "w", encoding="utf-8") as f:
        json.dump({**result, "items": p["layout"]}, f, ensure_ascii=False, indent=1)
    log.info("silences: %s %s/%s %s %s %.1f -> %.1f s (%d cuts: %s; %d flagged) from %d sound clips in %.1f s; action %s", seq_name, s["mode"],
             s["method"], s["pacing"], "auto" if s["threshold"] is None else f"{s['threshold']} dB", before, after, len(cuts), by_kind,
             common["flagged"], len(dialogue), time.time() - t0, s["action"])
    progress(1.0, "Done")
    return result
