"""Recording order across cameras, so the SYNC sequence can be laid out in the order things happened.

Every clip knows when it started in its camera's own clock (`media.MediaInfo.recorded`), but the cameras'
clocks are not set alike (GStroy: the FX30 is in 2024, the FX3 in 2026, an hour apart on top). A synced
group says exactly how far apart its clips really started (the audio offsets), so every pair of synced
clips from two cameras measures the difference between those two clocks. The median of those
measurements corrects a whole camera, including its clips that have no partner.

Nothing is invented: a camera that is never synced with the others keeps its own clock only when that
clock already falls inside the session (and is reported as unchecked); otherwise, and for clips without
any time, the clip gets no time and the layout keeps its place from the editor's timeline (reported).
"""
from __future__ import annotations

from collections import defaultdict
from statistics import median

CLOCK_SPREAD = 3.0          # s: creation_time has 1 s steps and cameras start writing a moment after the press
UNLINKED_WINDOW = 1800.0    # s: an unchecked clock is trusted only this close to the session's corrected times


def chronology(recorded: list[float | None], sources: list[str | None], cameras: list[str],
               groups: list[dict]) -> dict:
    """recorded/sources: per clip, from `media.probe`; cameras: a key per clip (its folder);
    groups: `groups.sync_groups` groups ({"members": [{"clip", "offset"}]}, offsets on the anchor's clock).

    -> {"time": [corrected seconds or None per clip], "note": [None or the reason the time is uncertain],
        "reference": camera key, "cameras": [{"camera", "offset", "pairs", "spread", "linked"}]}
    """
    n = len(recorded)
    est: dict[tuple[str, str], list[float]] = defaultdict(list)   # (a, b) -> b's clock minus a's clock
    for g in groups:
        ms = [m for m in g["members"] if recorded[m["clip"]] is not None]
        for x in ms:
            for y in ms:
                ca, cb = cameras[x["clip"]], cameras[y["clip"]]
                if ca != cb:
                    real = y["offset"] - x["offset"]                       # how far apart they really started
                    est[(ca, cb)].append((recorded[y["clip"]] - recorded[x["clip"]]) - real)

    # the reference is the busiest camera among those synced with another one (a camera that never synced
    # could not pass its clock on), else the busiest one with times at all
    timed = [cameras[i] for i in range(n) if recorded[i] is not None]
    linked = {c for pair in est for c in pair}
    pool = [c for c in timed if c in linked] or timed
    reference = max(dict.fromkeys(pool), key=pool.count) if pool else (cameras[0] if cameras else "")
    offset = {reference: 0.0}
    spread = {reference: 0.0}
    pairs = {reference: 0}
    queue = [reference]
    while queue:
        a = queue.pop(0)
        for (x, b), vals in sorted(est.items()):
            if x != a or b in offset:
                continue
            offset[b] = offset[a] + median(vals)
            spread[b] = max(vals) - min(vals)
            pairs[b] = len(vals)
            queue.append(b)

    time: list[float | None] = [None] * n
    note: list[str | None] = [None] * n
    for i in range(n):
        if recorded[i] is None:
            note[i] = "няма време на запис"
        elif cameras[i] in offset:
            time[i] = recorded[i] - offset[cameras[i]]
            if spread[cameras[i]] > CLOCK_SPREAD:
                note[i] = f"синхронът и часовникът на камерата се разминават с до {spread[cameras[i]]:.0f} s"
            elif sources[i] == "file":
                note[i] = "времето е от файла (няма го в записа)"
    known = [t for t in time if t is not None]
    for i in range(n):
        if recorded[i] is None or cameras[i] in offset:
            continue
        if known and min(known) - UNLINKED_WINDOW <= recorded[i] <= max(known) + UNLINKED_WINDOW:
            time[i] = recorded[i]
            note[i] = "часовникът на тази камера не е проверен (няма синхрон с другите)"
        else:
            note[i] = "часовникът на тази камера е далеч от другите и няма синхрон, по който да се поправи"

    cams = list(dict.fromkeys(cameras))
    return {
        "time": time, "note": note, "reference": reference,
        "cameras": [{"camera": c, "offset": round(offset[c], 3) if c in offset else None, "pairs": pairs.get(c, 0),
                     "spread": round(spread[c], 3) if c in spread else None, "linked": c in offset} for c in cams],
    }
