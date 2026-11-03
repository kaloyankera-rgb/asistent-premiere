"""Pause cutting (Phase 8 M2): which stretches of the speech map are taken out, and where exactly the cut lands.

A pause is shortened, never closed: it keeps a budget that depends on the tempo and on whether a sentence just ended.
Only SILENT frames (no word, no energy, no Silero speech) are ever cut; a pause that holds LOW frames (breath, a
click) keeps them. Cut edges move INWARD onto the sequence's frame grid, so a cut can never grow into speech.
"""
from __future__ import annotations

import numpy as np

from .speechmap import HOP_S, LOW, SILENT, VOICED, WORD, coverage, runs

# (kept after a sentence, kept inside a sentence) in seconds
TEMPO = {"calm": (0.45, 0.30), "normal": (0.35, 0.22), "tight": (0.25, 0.12)}
TEMPO_BG = {"calm": "спокойно", "normal": "нормално", "tight": "стегнато"}
SAFE_MIN = {"calm": 2.0, "normal": 1.5, "tight": 1.2}     # Внимателно touches only pauses longer than this (the long dead stretches)
SMART_SLACK = 0.10                                         # Умно shortens a pause that exceeds its budget by this
LEAD_IN, TAIL_OUT = 0.15, 0.80                             # kept before the first word of a clip / after its last word (the picture breathes)
MIN_CUT = {"safe": 0.5, "smart": 0.25}                      # a pause cut shorter than this is not worth an edit
MIN_SHOT = 1.5                                             # a kept piece shorter than this between two cuts is a jump cut for nothing: the smaller cut is not made
MIN_KEEP = 0.60                                            # a kept piece of pure pause shorter than this between two cuts is cut too
MIN_SILENT_RUN = 5                                         # 50 ms of SILENT in a row before it may be cut
VOICED_REVIEW = 0.6                                        # a voiced stretch without words this long is listed
SENTENCE_END = (".", "?", "!", "…")


def _ends_sentence(words: list[dict], t: float) -> bool:
    """Did the word that ends last before second `t` close a sentence?"""
    prev = None
    for w in words:
        if w["end"] <= t + 0.3:
            prev = w
        else:
            break
    return bool(prev and prev["word"].strip().endswith(SENTENCE_END))


def _union(spans: list[tuple[float, float]], gap: float = 1e-9) -> list[tuple[float, float]]:
    """Merge overlapping spans, and spans closer than `gap` seconds."""
    out: list[list[float]] = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1] + gap:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def uncovered(t0: float, t1: float, spans: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """The parts of [t0, t1] that none of `spans` covers."""
    out, at = [], t0
    for a, b in _union(spans):
        if a > at:
            out.append((at, min(a, t1)))
        at = max(at, b)
        if at >= t1:
            break
    if at < t1:
        out.append((at, t1))
    return [(a, b) for a, b in out if b > a + 1e-9]


def plan(sm: dict, words: list[dict], fps: float, mode: str = "safe", tempo: str = "normal",
         sound: list[tuple[float, float]] | None = None, present: list[tuple[float, float]] | None = None,
         tracks: dict | None = None) -> dict:
    """-> {"cuts": [(a, b)] sequence seconds on the frame grid, "gaps": n pauses seen, "voiced": [(a, b)] listed stretches,
    "no_sound_s": seconds taken out only because no selected sound clip covers them, "empty_s": seconds where nothing was
    on the timeline at all}

    `sound`: the sequence spans of the selected dialogue audio. Where none covers the time nobody is known to speak, so
    that time is taken out whole (the user's 2026-11-03 test: 34 s of the other camera before the first words stayed, and
    the empty timeline between two recordings stayed as a pause). `present`: the spans of every selected item; time no
    item covers is an empty gap on the timeline and is closed whole too. Inside the sound the pause budget applies."""
    labels, origin = sm["labels"], sm["origin"]
    n = len(labels)
    t_end = origin + n * HOP_S
    after_sentence, inside = TEMPO[tempo]
    cov = coverage(sound, origin, n)
    cut = np.zeros(n, dtype=bool)
    gaps = 0
    tail = int(round(TAIL_OUT / HOP_S))
    for g0, g1 in runs(labels < VOICED):
        first, last = g0 == 0, g1 == n
        if first and last:                                  # no speech anywhere in the selection: leave it
            continue
        a_s = origin + g0 * HOP_S
        size = g1 - g0
        # the pause is looked at one covered stretch at a time: the time between two clips belongs to no stretch
        for sa, sb in runs(cov[g0:g1]):
            gaps += 1
            dur = (sb - sa) * HOP_S
            after_speech = sa == 0 and not first            # speech of this clip ends where the stretch starts
            before_speech = sb == size and not last         # speech of this clip begins where the stretch ends
            silent = labels[g0 + sa:g0 + sb] == SILENT
            if after_speech and not before_speech:
                # the tail of a clip: the picture breathes for TAIL_OUT after the last word, then everything goes (LOW
                # frames too: nobody speaks after it; islands of breath there made the chopped ends of the 2026-11-03 test)
                if (sb - sa) > tail + int(round(0.3 / HOP_S)):
                    cut[g0 + sa + tail:g0 + sb] = True
                continue
            if not after_speech and not before_speech:      # a covered stretch with no speech at all (a silent clip)
                if not (first and last):
                    cut[g0 + sa:g0 + sb] = True
                continue
            if first or not after_speech:                    # the lead of a clip: LEAD_IN before its first word
                keep_a, keep_b, budget = 0.0, LEAD_IN, LEAD_IN
            else:                                            # an ordinary pause inside the speech
                budget = after_sentence if _ends_sentence(words, a_s + sa * HOP_S) else inside
                keep_a = keep_b = budget / 2
            threshold = max(budget, SAFE_MIN[tempo]) if mode == "safe" else budget + SMART_SLACK
            if dur <= threshold:
                continue
            keep = np.zeros(sb - sa, dtype=bool)
            keep[:int(round(keep_a / HOP_S))] = True
            if keep_b:
                keep[len(keep) - int(round(keep_b / HOP_S)):] = True
            # only the frames all three signals call silent; a LOW frame (breath, click) is kept, slivers are merged below
            cut[g0 + sa:g0 + sb] = (~keep) & silent
    spans = []
    for s0, s1 in runs(cut):
        if (s1 - s0) >= MIN_SILENT_RUN:
            spans.append((origin + s0 * HOP_S, origin + s1 * HOP_S))
    # the guard protects speech inside a PAUSE cut only. It must not touch the empty time between clips (below): the first
    # 10 ms frame of the next clip is partly inside it and may be voiced, and the guard then stopped the cut 1-2 frames
    # short of the clip (the user's 2026-11-03 test: cut ended at 58.025 s, the clip starts at 58.058 s)
    spans = guard(_merge_slivers(spans, labels, origin), sm)
    spans = [(a, b) for a, b in snap(spans, fps) if b - a >= MIN_CUT[mode]]
    # time nobody speaks in (no selected sound there) and empty timeline: whole, on the frame grid
    t_start = origin
    extra = []
    no_sound = uncovered(t_start, t_end, sound) if sound is not None else []
    empty = uncovered(t_start, t_end, present) if present is not None else []
    for a, b in no_sound + empty:
        fa, fb = int(round(a * fps)), int(round(b * fps))
        if fb > fa:
            extra.append((fa / fps, fb / fps))
    exact = _union(extra)
    # a pause cut inside the time that goes whole anyway is redundant
    spans = [(a, b) for a, b in spans if not any(x <= a + 1e-9 and b <= y + 1e-9 for x, y in exact)]
    cuts = _union(_no_jump_cuts(spans, exact) + exact, gap=0.07)     # a piece under 2 frames between two cuts is not a piece
    holes_kept = 0.0
    if tracks:
        cuts, closed, holes_kept = _close_track_holes(cuts, tracks, labels, origin, fps)
    voiced = []
    for v0, v1 in runs(labels == VOICED):
        if (v1 - v0) * HOP_S >= VOICED_REVIEW:
            voiced.append((origin + v0 * HOP_S, origin + v1 * HOP_S))
    return {"cuts": cuts, "gaps": gaps, "voiced": voiced, "hole_speech_s": round(holes_kept, 2),
            "no_sound_s": round(sum(b - a for a, b in no_sound), 2), "empty_s": round(sum(b - a for a, b in empty), 2)}


def _no_jump_cuts(spans: list[tuple[float, float]], exact: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Where two cuts leave a kept piece shorter than MIN_SHOT between them, the smaller PAUSE cut is dropped (that pause stays
    as it was), so the shots join into one. The time that goes whole (no clip, no selected sound) is never dropped. The user's
    2026-11-03 test: "very fast cuts for no reason" (0.7 s of speech between two trims)."""
    spans = sorted(spans)
    while True:
        allc = sorted([(a, b, False) for a, b in spans] + [(a, b, True) for a, b in exact])
        drop = None
        for (a1, b1, e1), (a2, b2, e2) in zip(allc, allc[1:]):
            if 0.07 < a2 - b1 < MIN_SHOT and not (e1 and e2):
                cand = [(b - a, a, b) for a, b, e in ((a1, b1, e1), (a2, b2, e2)) if not e]
                drop = min(cand)[1:]
                break
        if drop is None:
            return spans
        spans = [s for s in spans if s != drop]


def _close_track_holes(cuts, tracks, labels, origin, fps):
    """A track that has no media between two of its clips while another camera plays there shows as a hole in that row (the
    user's 2026-11-03 test: "different types of gaps"; a camera's clip ended and its row stayed empty for the breathing tail
    of the other one). The part of such a hole where nobody speaks (no word, no voiced sound) is taken out of every track too,
    so the next shot follows. Where somebody does speak on the other camera the hole stays (cutting it would cut speech) and
    its seconds are returned. -> (cuts, seconds closed, seconds of hole left because of speech)"""
    n = len(labels)
    extra, left = [], 0.0
    for spans in tracks.values():
        spans = sorted(spans)
        for (a1, b1), (a2, b2) in zip(spans, spans[1:]):
            if a2 - b1 < 1.5 / fps:
                continue
            at = b1
            for ca, cb in sorted(cuts) + [(a2, a2)]:            # the parts of the hole that no cut takes out
                if cb <= at:
                    continue
                if ca > at:
                    seg_a, seg_b = at, min(ca, a2)
                    if seg_b > seg_a:
                        i0 = max(int(np.ceil((seg_a - origin) / HOP_S)), 0)
                        i1 = min(int(np.floor((seg_b - origin) / HOP_S)), n)
                        if i1 > i0 and (labels[i0:i1] >= VOICED).any():
                            left += seg_b - seg_a                # somebody speaks here: the whole piece of hole stays
                        else:                                    # nobody speaks: the whole piece goes, as one cut
                            fa, fb = int(np.ceil(seg_a * fps - 1e-6)), int(np.floor(seg_b * fps + 1e-6))
                            if fb > fa:
                                extra.append((fa / fps, fb / fps))
                at = max(at, cb)
                if at >= a2:
                    break
    closed = sum(b - a for a, b in extra)
    return _union(list(cuts) + extra, gap=0.07), closed, left


def _merge_slivers(spans: list[tuple[float, float]], labels: np.ndarray, origin: float) -> list[tuple[float, float]]:
    """Two cuts with a kept piece between them shorter than MIN_KEEP that holds no word or voiced sound are one cut: a
    0.1 s piece of breath between two cuts is an edit for nothing (the user's 2026-11-03 test: four cuts in the last
    two seconds)."""
    out: list[list[float]] = []
    for a, b in spans:
        if out and a - out[-1][1] < MIN_KEEP:
            i0 = int(round((out[-1][1] - origin) / HOP_S))
            i1 = int(round((a - origin) / HOP_S))
            if not (labels[i0:i1] >= VOICED).any():
                out[-1][1] = b
                continue
        out.append([a, b])
    return [(a, b) for a, b in out]


def snap(cuts: list[tuple[float, float]], fps: float) -> list[tuple[float, float]]:
    """Cut edges onto the frame grid, moving INWARD (start up, end down): the cut only ever shrinks."""
    out = []
    for a, b in cuts:
        fa, fb = int(np.ceil(a * fps - 1e-6)), int(np.floor(b * fps + 1e-6))
        if fb > fa:
            out.append((fa / fps, fb / fps))
    return out


def guard(cuts: list[tuple[float, float]], sm: dict) -> list[tuple[float, float]]:
    """Final safety net: whatever happened before, no cut may cover a frame labelled WORD or VOICED. The cut is split
    around such frames (they are then kept)."""
    labels, origin = sm["labels"], sm["origin"]
    out = []
    for a, b in cuts:
        i0 = max(int(np.floor((a - origin) / HOP_S)), 0)
        i1 = min(int(np.ceil((b - origin) / HOP_S)), len(labels))
        if i1 <= i0:                                        # outside the map (no audio there): nothing to protect
            out.append((a, b))
            continue
        bad = labels[i0:i1] >= VOICED
        if not bad.any():
            out.append((a, b))
            continue
        for s0, s1 in runs(~bad):
            out.append((max(a, origin + (i0 + s0) * HOP_S), min(b, origin + (i0 + s1) * HOP_S)))
    return out
