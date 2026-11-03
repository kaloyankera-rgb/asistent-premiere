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
# FFmpeg decoding and NumPy/SciPy FFTs release the GIL, so threads use several cores
WORKERS = max(2, min(8, (os.cpu_count() or 4) - 2))


def _folder(path: str) -> str:
    return os.path.dirname(os.path.abspath(path))


def sync_groups(paths: list[str], progress: ProgressFn | None = None,
                cancel: Callable[[], bool] | None = None) -> dict:
    paths = list(dict.fromkeys(paths))            # one entry per file, first-seen order
    if len(paths) < 2:
        raise ValueError("Маркирай поне два различни клипа.")
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
        tick(0.3, 0.0, len(paths), "Чета звука: {} от {}")
        return clip

    old_workers = sync.FFT_WORKERS
    sync.FFT_WORKERS = 1                      # parallel pairs instead of parallel FFTs
    pool = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="pair")
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
            tick(0.65, 0.3, len(pairs), "Сравнявам {} от {}")
            if r["confidence"] in ("high", "medium") and r.get("offset") is not None:
                return {"a": ref, "b": oth, "offset": r["offset"], "confidence": r["confidence"],
                        "agree": f'{r.get("windows_agree")}/{r.get("windows_total")}',
                        "reasons": r["reasons"], "warnings": r["warnings"]}
            return None

        edges = [e for e in pool.map(compare, pairs) if e]
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
        sync.FFT_WORKERS = old_workers

    groups, conflicts = _build_groups(clips, folders if split_by_folder else None,
                                      [e for e in edges if e["confidence"] == "high"])
    grouped = {m["clip"] for g in groups for m in g["members"]}
    # when each clip was recorded, on one clock for all cameras (the layout puts everything in that order)
    when = chrono.chronology([c.info.recorded for c in clips], [c.info.recorded_from for c in clips], folders, groups)
    progress(1.0, "Готово")
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
        "pairs_checked": len(pairs),
    }


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
                    problem = (f"{clips[u].name} и {clips[v].name} дават различни отмествания "
                               f"({abs(pos[v] - want) * 1000:.0f} ms разлика)")
        if folders and not problem:
            for x in comp:
                for y in comp:
                    if x < y and folders[x] == folders[y]:
                        a0, a1 = pos[x], pos[x] + clips[x].length
                        b0, b1 = pos[y], pos[y] + clips[y].length
                        if min(a1, b1) - max(a0, b0) > 0.5:
                            problem = (f"{clips[x].name} и {clips[y].name} са от една камера, "
                                       f"а излизат едновременни")
        names = [clips[i].name for i in comp]
        if problem:
            conflicts.append({"clips": sorted(comp), "names": names, "reason": problem})
            continue
        groups.append({
            "anchor": anchor,
            "members": [{"clip": i, "offset": round(pos[i], 6)} for i in sorted(comp, key=lambda i: pos[i])],
        })
    return groups, conflicts
