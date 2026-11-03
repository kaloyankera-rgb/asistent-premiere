"""The decision list of a rough cut (Phase 8): kept ranges in SEQUENCE time, applied identically to every selected item.

Every cut is a range of the source sequence's timeline. Each selected item (a camera, a microphone, either channel) is
cut by the same ranges, so the cameras stay aligned: no track is ever cut on its own.
"""
from __future__ import annotations


def kept_ranges(t0: float, t1: float, cuts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """The complement of `cuts` inside [t0, t1]."""
    kept, at = [], t0
    for a, b in sorted(cuts):
        a, b = max(a, t0), min(b, t1)
        if b <= a:
            continue
        if a > at:
            kept.append((at, a))
        at = max(at, b)
    if t1 > at:
        kept.append((at, t1))
    return kept


def pieces(items: list[dict], kept: list[tuple[float, float]], fps: float) -> list[dict]:
    """items: [{kind, track, path, start, end, inPt}] (sequence seconds, media seconds). -> one piece per item and kept
    range it crosses, in FRAMES: {kind, track, path, src_in, src_out (source frames), start, end (output frames), item}.
    The output position of a piece is the running length of the kept ranges before it plus its offset inside its range."""
    out = []
    pos = 0                                             # output frames before the current kept range
    spans = []
    for a, b in kept:
        fa, fb = round(a * fps), round(b * fps)
        spans.append((fa, fb, pos))
        pos += fb - fa
    for n, it in enumerate(items):
        s_f, e_f = round(it["start"] * fps), round(it["end"] * fps)
        in_f = round(it["inPt"] * fps)
        for fa, fb, base in spans:
            lo, hi = max(fa, s_f), min(fb, e_f)
            if hi <= lo:
                continue
            out.append({"kind": it["kind"], "track": it["track"], "path": it["path"], "item": n,
                        "channel": it.get("channel") or 0, "gain_db": it.get("gain_db"),
                        "src_in": in_f + (lo - s_f), "src_out": in_f + (hi - s_f),
                        "start": base + (lo - fa), "end": base + (hi - fa)})
    return out


MIN_PIECE = 15                    # frames (0.5 s): a shorter piece of an item that goes on elsewhere is a flash, not a shot


def drop_flashes(pieces: list[dict], min_frames: int = MIN_PIECE) -> tuple[list[dict], int]:
    """Remove the end of a camera that is only a few frames long while another track carries the moment: a 5-frame piece
    of the second POV at the end of its clip is a flash on the timeline (the user's 2026-11-03 test: "very fast cuts at the
    end of some clips"). A short piece is kept when nothing longer plays at the same time (a short word is a shot of its
    own). -> (pieces, how many were dropped)"""
    keep = []
    dropped = 0
    for p in pieces:
        if p["end"] - p["start"] < min_frames:
            longer = any(q is not p and q["end"] - q["start"] >= min_frames and q["start"] < p["end"] and p["start"] < q["end"]
                         for q in pieces)
            if longer:
                dropped += 1
                continue
        keep.append(p)
    return keep, dropped


def total_frames(kept: list[tuple[float, float]], fps: float) -> int:
    return sum(round(b * fps) - round(a * fps) for a, b in kept)


def output_frame(kept: list[tuple[float, float]], fps: float, t: float) -> int:
    """Where sequence second `t` lands in the rough cut (the start of the next kept range when `t` was cut out)."""
    pos = 0
    for a, b in kept:
        fa, fb = round(a * fps), round(b * fps)
        if t * fps < fb:
            return pos + max(0, round(t * fps) - fa)
        pos += fb - fa
    return pos
