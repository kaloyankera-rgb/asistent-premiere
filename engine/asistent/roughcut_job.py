"""The `/roughcut` job (Phase 8 M2): selected dialogue -> a new rough-cut sequence as FCP7 XML + a report on disk.

Safe Cut takes out only pauses that are certainly silence; Smart Cut shortens every pause to its budget. Both cut a
plain repeated take (takes.py: the last full take stays). The source sequence is never touched: the panel imports the
XML as a new sequence.

Nothing here talks to Premiere. Words come from the same Whisper readings as the subtitles (cached by their audio, so a
second run with another mode or tempo costs seconds); without the speech model the pauses are cut from the energy and
Silero alone, and the result says so.
"""
from __future__ import annotations

import json
import logging

import numpy as np
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from . import asr, edl, media, pauses, speechmap, subtitles, takes, vad, xmeml
from .dialoguemix import ASR_SR, build_mix
from .subtitle_job import _inside, _same_word, plan_windows, read_window

log = logging.getLogger("asistent")
MODES = {"safe": "safe", "smart": "smart"}
MIN_PIECE_FRAMES = 2


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
                         "name": str(it.get("name") or os.path.basename(it["path"])), "track": int(_num(it.get("track", 0), "track"))})
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
    if mode not in MODES or tempo not in pauses.TEMPO:
        raise ValueError("Invalid mode or tempo.")
    out_dir = body.get("out_dir")
    if not isinstance(out_dir, str) or not os.path.isdir(out_dir):
        raise ValueError("The project folder was not found: save the project and try again.")
    return {"dialogue": dialogue, "layout": lay, "mode": mode, "tempo": tempo, "out_dir": out_dir,
            "fps": subtitles.exact_fps(_num(25.0 if body.get("fps") is None else body.get("fps"), "frames per second", 1.0)),
            "width": int(_num(body.get("width") or 1920, "width", 1)), "height": int(_num(body.get("height") or 1080, "height", 1)),
            "name": str(body.get("name") or "sequence"), "markers": bool(body.get("markers")), "skipped": body.get("skipped") or []}


def _words(segments: list[dict], progress, cancelled) -> tuple[list[dict], dict]:
    """Whisper words of the pieces in SEQUENCE seconds (verbatim, no spelling work: the cut needs where speech is, not how it
    is spelled) and a note on how they were made."""
    if not (asr.backend_installed() and asr.model_present()):
        return [], {"asr": False, "note": "No speech model: the pauses were found only by the sound level and Silero."}
    wins = plan_windows(segments)
    total = sum(w["b"] - w["a"] for w in wins) or 1.0
    shares = [(w["b"] - w["a"]) / total for w in wins]
    frac = [0.0] * len(wins)

    def read_one(i):
        def on_progress(f, m):
            frac[i] = f
            progress(sum(a * b for a, b in zip(frac, shares)), m)
        return read_window(wins[i], "", on_progress, cancelled)

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
    return unique, {"asr": True, "cached": all(r["cached"] for r in reads), "windows": len(wins)}


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
    fps = p["fps"]
    progress(0.0, "Reading the sound…")
    mix = build_mix(p["dialogue"], lambda f, m: progress(0.1 * f, m), cancelled)
    words, how = _words(mix["segments"], lambda f, m: progress(0.1 + 0.6 * f, m), cancelled)
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
    review = [{"at": round(a, 2), "end": round(b, 2), "kind": "voiced", "text": "Speech without a recognised word (laughter, a reaction or a missed word): kept."}
              for a, b in plan["voiced"]]
    saved = sum(b - a for a, b in cuts)
    result = {
        "xml": xml_path, "json": os.path.join(folder, seq_name + ".json"), "name": seq_name, "mode": p["mode"], "tempo": p["tempo"], "tempo_label": pauses.TEMPO_LABEL[p["tempo"]],
        "before_s": round(before, 2), "after_s": round(after, 2), "saved_s": round(saved, 2),
        "takes_cut_s": round(sum(g["cut_s"] for g in found), 2),
        "flashes_dropped": flashes, "hole_speech_s": plan["hole_speech_s"], "no_sound_s": plan["no_sound_s"], "empty_s": plan["empty_s"],
        "pieces": [{"kind": x["kind"], "track": x["track"], "item": x["item"], "start": x["start"], "end": x["end"]} for x in pieces],
        "counts": {"pauses_seen": plan["gaps"], "cuts": len(cuts), "kept_ranges": len(kept), "pieces": len(pieces), "review": len(review), "takes": len(found),
                   "takes_cut": sum(1 for g in found if g["applied"])},
        "takes": found,
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
