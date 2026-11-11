"""Sync everything that can be synced among many clips (a whole timeline selection).

Every pair is compared once, except two clips from the same folder when the selection spans several
folders: one camera cannot record two clips at the same time. High pairs are joined into groups; in
each group the longest clip is the anchor and every other clip gets its offset on the anchor's clock.
A group whose pairs disagree (a loop that does not close within 10 ms, or two clips of one camera
that would overlap) is reported and not applied.
"""
from __future__ import annotations

import os
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from . import chrono, sync
from .sync import Cancelled, Clip, ProgressFn, analyze_pair, load_clip

LOOP_TOL = 0.010
CLOCK_VETO = 10.0      # s: recording times (1 s steps, a moment of start-up) further apart than this are another take
CLOCK_CONFIRM = 2.0    # s: recording times this close to the audio's offset confirm an uncertain pair
# Short takes (Pulse Fitness, 2026-11-11: 10 pairs of 4-12 s clips missed, the user synced them by hand). Two stretches
# give the same offset, too few for High on sound alone; the clocks LEARNT from the sure pairs (never raw clocks) must
# then agree within CLOCK_SHORT. Measured there: all 9 such pairs agree within 0.65 s (the cameras write whole seconds).
SHORT_MIN_WINDOWS = 2
SHORT_RATIO = 1.25     # median peak / second peak of the two stretches (measured 1.27-2.32 on the real pairs)
CLOCK_SHORT = 1.5      # s
CLOCK_PRECISE = 1.0    # s: a learnt camera clock this consistent (spread) may decide a short or a two-offset pair
OVERLAP_HINT = 1.0     # s: clips the clocks put together for this long are named when the sound could not confirm them
# FFmpeg decoding and NumPy/SciPy FFTs release the GIL, so threads use several cores
WORKERS = max(2, min(8, (os.cpu_count() or 4) - 2))


def _folder(path: str) -> str:
    return os.path.dirname(os.path.abspath(path))


def sync_groups(paths: list[str], progress: ProgressFn | None = None,
                cancel: Callable[[], bool] | None = None) -> dict:
    paths = list(dict.fromkeys(paths))            # one entry per file, first-seen order
    if len(paths) < 2:
        raise ValueError("Select at least two different clips.")
    progress = progress or (lambda f, m: None)

    def check():
        if cancel and cancel():
            raise Cancelled()

    lock = threading.Lock()
    done = [0]

    def tick(share: float, start: float, total: int, msg: str):
        with lock:
            done[0] += 1
            progress(start + share * done[0] / max(total, 1), msg.format(done[0], total))

    def load(p: str) -> Clip:
        check()
        clip = load_clip(p)
        tick(0.3, 0.0, len(paths), "Reading the sound: {} of {}")
        return clip

    # parallel pairs instead of parallel FFTs: one FFT thread per pool thread, set in those threads only (0.10.6)
    pool = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="pair", initializer=sync.set_fft_workers, initargs=(1,))
    try:
        clips: list[Clip] = list(pool.map(load, paths))
        folders = [_folder(p) for p in paths]
        split_by_folder = len(set(folders)) > 1
        pairs = [(i, j) for i in range(len(clips)) for j in range(i + 1, len(clips))
                 if not (split_by_folder and folders[i] == folders[j])]
        done[0] = 0

        def compare(pair: tuple[int, int]) -> dict | None:
            i, j = pair
            check()
            ref, oth = (i, j) if clips[i].length >= clips[j].length else (j, i)
            r = analyze_pair(clips[ref], clips[oth], check, quick=True)
            tick(0.65, 0.3, len(pairs), "Comparing {} of {}")
            # a Low pair is kept only when two stretches agree: the clocks may confirm it (short takes, 0.10.45)
            keep = r["confidence"] in ("high", "medium") or (r.get("windows_agree") or 0) >= SHORT_MIN_WINDOWS
            if keep and r.get("offset") is not None:
                return {"a": ref, "b": oth, "offset": r["offset"], "confidence": r["confidence"],
                        "agree": f'{r.get("windows_agree")}/{r.get("windows_total")}', "loose": bool(r.get("loose")),
                        "ambiguous": bool(r.get("ambiguous")), "drifting": bool(r.get("drifting")),
                        "n_agree": r.get("windows_agree") or 0, "n_info": r.get("windows_informative") or 0,
                        "peak_ratio": r.get("peak_ratio") or 0.0, "runner_offset": r.get("runner_offset"),
                        "reasons": r["reasons"], "warnings": r["warnings"]}
            return None

        edges = [e for e in pool.map(compare, pairs) if e]
    finally:
        pool.shutdown(wait=True, cancel_futures=True)

    rec = [c.info.recorded for c in clips]
    src = [c.info.recorded_from for c in clips]
    _clock_check(clips, folders, split_by_folder, edges, rec, src)
    groups, conflicts = _build_groups(clips, folders if split_by_folder else None,
                                      [e for e in edges if e["confidence"] == "high"])
    grouped = {m["clip"] for g in groups for m in g["members"]}
    # when each clip was recorded, on one clock for all cameras (the layout puts everything in that order)
    when = chrono.chronology(rec, src, folders, groups)
    together = _clock_overlaps(clips, folders, groups, when)
    progress(1.0, "Done")
    return {
        "clips": [{"path": c.info.path, "name": c.name, "duration": round(c.info.duration, 3),
                   "fps": c.info.fps, "has_video": c.info.has_video,
                   "rec_time": when["time"][i], "rec_note": when["note"][i]} for i, c in enumerate(clips)],
        "clocks": [{**x, "name": os.path.basename(x["camera"]) or x["camera"]} for x in when["cameras"]],
        "clock_reference": os.path.basename(when["reference"]) or when["reference"],
        "groups": groups,
        "conflicts": conflicts,
        "unsynced": [i for i in range(len(clips)) if i not in grouped],
        "suggestions": [e for e in edges if e["confidence"] == "medium"
                        and not ({e["a"], e["b"]} <= grouped)],
        # pairs accepted by the scattered-window rule or by the clocks: the panel says how each was decided
        "accepted_notes": [{"a": e["a"], "b": e["b"], "text": " ".join(e["reasons"] + e["warnings"])}
                           for e in edges if e["confidence"] == "high" and (e.get("loose") or e.get("clock_confirmed"))
                           and {e["a"], e["b"]} <= grouped],
        "pairs_checked": len(pairs),
        # not synced, but the learnt clocks say these were recording at the same time: the editor syncs them by hand
        "clock_overlaps": together,
    }


def _clock_overlaps(clips: list[Clip], folders: list[str], groups: list[dict], when: dict) -> list[dict]:
    """Pairs of clips from different cameras that the learnt clocks put side by side for OVERLAP_HINT or more, but that
    are not in one group (the sound was too short or too quiet to confirm). Only cameras whose clock was learnt from
    synced pairs (or the reference camera) count: a raw clock may simply be wrong."""
    precise = {c["camera"] for c in when["cameras"] if c["camera"] == when["reference"]
               or (c["pairs"] > 0 and c["spread"] <= CLOCK_PRECISE)}
    group_of = {m["clip"]: k for k, g in enumerate(groups) for m in g["members"]}
    out = []
    t = when["time"]
    for i in range(len(clips)):
        for j in range(i + 1, len(clips)):
            if folders[i] == folders[j] or folders[i] not in precise or folders[j] not in precise:
                continue
            if t[i] is None or t[j] is None or when["note"][i] or when["note"][j]:
                continue
            if i in group_of and group_of.get(j) == group_of[i]:
                continue
            shared = min(t[i] + clips[i].info.duration, t[j] + clips[j].info.duration) - max(t[i], t[j])
            if shared >= OVERLAP_HINT:
                a, b = (i, j) if clips[i].info.duration >= clips[j].info.duration else (j, i)
                out.append({"a": a, "b": b, "offset": round(t[b] - t[a], 1)})
    return out


def _clock_check(clips: list[Clip], folders: list[str], split_by_folder: bool, edges: list[dict],
                 rec: list, src: list) -> None:
    """The cameras' recording times as a second, independent witness (changes `edges`).

    Clock differences between cameras are learnt from the strict pairs alone (chrono.py).
    - Veto: a pair that is High only by the scattered-window rule (sync.LOOSE_BAND) whose learnt-clock
      times disagree by more than CLOCK_VETO is the same line from another take (the one false match
      audio alone cannot rule out): back to the suggestions, with the reason.
    - Confirm: a Medium pair (not drifting, no second possible offset) whose times agree within
      CLOCK_CONFIRM becomes High. Without a learnt difference the raw clocks may confirm too: two
      arbitrary camera clocks landing within 2 s of the audio's offset by chance is not credible; raw
      clocks never veto, as they may simply be set wrong (GStroy FX30: two years behind).
    Masterhaus (2026-11-03): all 9 audio pairs agree with the learnt clocks within 0.8 s."""
    loose = [e for e in edges if e["confidence"] == "high" and e.get("loose")]
    medium = [e for e in edges if e["confidence"] == "medium" and not e.get("ambiguous") and not e.get("drifting")]
    short = [e for e in edges if e["confidence"] == "low" and not e.get("ambiguous") and not e.get("drifting")
             and e.get("n_agree", 0) >= SHORT_MIN_WINDOWS and e["n_agree"] >= 0.5 * e.get("n_info", 0)
             and e.get("peak_ratio", 0.0) >= SHORT_RATIO]
    two = [e for e in edges if e["confidence"] == "medium" and e.get("ambiguous") and not e.get("drifting")
           and e.get("runner_offset") is not None]
    if not loose and not medium and not short and not two:
        return
    strict = [e for e in edges if e["confidence"] == "high" and not e.get("loose")]
    base, _ = _build_groups(clips, folders if split_by_folder else None, strict)
    clock = chrono.chronology(rec, src, folders, base)
    learnt = {c["camera"]: (c["offset"], c["spread"]) for c in clock["cameras"] if c["pairs"] > 0}
    if learnt or len(set(folders)) == 1:
        learnt[clock["reference"]] = (0.0, 0.0)

    def said(e, raw, precision):
        """b's start minus a's on one clock, from cameras whose learnt clocks are this precise."""
        a, b = e["a"], e["b"]
        if src[a] != "metadata" or src[b] != "metadata":
            return None
        ka, kb = learnt.get(folders[a]), learnt.get(folders[b])
        if ka and kb and max(ka[1], kb[1]) <= precision:
            return (rec[b] - kb[0]) - (rec[a] - ka[0])
        return rec[b] - rec[a] if raw else None

    for e in loose:
        s = said(e, raw=False, precision=CLOCK_VETO / 2)
        if s is None:
            continue
        if abs(s - e["offset"]) > CLOCK_VETO:
            e["confidence"] = "medium"
            e["reasons"].append(f"The camera clocks say {s:+.0f} s and the sound {e['offset']:+.1f} s: "
                                f"probably the same line from another take.")
        else:
            e["reasons"].append("The camera clocks confirm it.")
    for e in medium:
        s = said(e, raw=True, precision=CLOCK_CONFIRM)
        sure = said(e, raw=False, precision=CLOCK_PRECISE)
        if sure is not None and abs(sure - e["offset"]) > CLOCK_VETO:
            e["reasons"].append(f"The camera clocks say they were not recorded together ({sure - e['offset']:+.0f} s apart).")
            continue
        if s is not None and abs(s - e["offset"]) <= CLOCK_CONFIRM:
            e["confidence"] = "high"
            e["clock_confirmed"] = True
            e["reasons"].append(f"The sound alone was not enough ({e['agree']} stretches), but the camera clocks give "
                                f"the same offset ({s:+.1f} s against {e['offset']:+.3f} s from the sound).")
    for e in short:
        s = said(e, raw=False, precision=CLOCK_PRECISE)
        if s is not None and abs(s - e["offset"]) <= CLOCK_SHORT:
            e["confidence"] = "high"
            e["clock_confirmed"] = True
            e["reasons"] = [f"A short take: {e['n_agree']} stretches of sound give the same offset, and the camera clocks "
                            f"agree ({s:+.1f} s against {e['offset']:+.3f} s from the sound)."]
    for e in two:
        # two possible offsets (repeating sound): the clocks take the one they agree with, only when the other is far off
        s = said(e, raw=False, precision=CLOCK_PRECISE)
        if s is not None and abs(s - e["offset"]) <= CLOCK_SHORT and abs(s - e["runner_offset"]) > CLOCK_VETO / 2:
            e["confidence"] = "high"
            e["clock_confirmed"] = True
            e["reasons"] = [f"The sound allows two offsets ({e['offset']:+.3f} s and {e['runner_offset']:+.3f} s); the camera "
                            f"clocks say {s:+.1f} s, so the first."]


def _build_groups(clips: list[Clip], folders: list[str] | None, edges: list[dict]):
    adj: dict[int, list[tuple[int, float]]] = defaultdict(list)
    for e in edges:
        # offset = where b's first frame sits on a's clock
        adj[e["a"]].append((e["b"], e["offset"]))
        adj[e["b"]].append((e["a"], -e["offset"]))

    seen: set[int] = set()
    groups, conflicts = [], []
    for start in sorted(adj, key=lambda i: -clips[i].length):
        if start in seen:
            continue
        comp, stack = [], [start]
        seen.add(start)
        while stack:
            u = stack.pop()
            comp.append(u)
            for v, _ in adj[u]:
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        anchor = max(comp, key=lambda i: clips[i].length)
        pos = {anchor: 0.0}
        queue, problem = [anchor], None
        while queue:
            u = queue.pop(0)
            for v, d in adj[u]:
                want = pos[u] + d
                if v not in pos:
                    pos[v] = want
                    queue.append(v)
                elif abs(pos[v] - want) > LOOP_TOL:
                    problem = (f"{clips[u].name} and {clips[v].name} give different offsets "
                               f"({abs(pos[v] - want) * 1000:.0f} ms apart)")
        if folders and not problem:
            for x in comp:
                for y in comp:
                    if x < y and folders[x] == folders[y]:
                        a0, a1 = pos[x], pos[x] + clips[x].length
                        b0, b1 = pos[y], pos[y] + clips[y].length
                        if min(a1, b1) - max(a0, b0) > 0.5:
                            problem = (f"{clips[x].name} and {clips[y].name} are from one camera "
                                       f"but come out simultaneous")
        names = [clips[i].name for i in comp]
        if problem:
            conflicts.append({"clips": sorted(comp), "names": names, "reason": problem})
            continue
        groups.append({
            "anchor": anchor,
            "members": [{"clip": i, "offset": round(pos[i], 6)} for i in sorted(comp, key=lambda i: pos[i])],
        })
    return groups, conflicts
