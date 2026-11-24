"""The subtitle edit log (TODO SAL, Step 1, 0.10.155): a silent, local journal of everything that happens in subtitles, and at
an export the captions Asistent placed compared with the caption lines the editor left in the saved project.

The user's idea (2026-11-24): the real corrections happen in Premiere's Text panel after the captions are placed, and Asistent
never saw them. So every press is journalled (settings, runs, placement, Captions tab fixes, Move off faces), and at a finished
export (and Export transcript) the placed captions are laid next to Premiere's own lines (`prcaptions.read`): which lines were
split, merged, deleted, moved in time, and which words were fixed. Nothing is learned and nothing is applied here: the counts
decide what to improve (Steps 2-4, docs/SUBTITLE_EDIT_LOG_PLAN.md).

Where: `<app>/learning/subtitles/<client>.jsonl` on this computer, one JSON line per event, append only (like colour learning's
records). The client is the folder that holds a "... Subtitle Learning" folder (`learning.find_folder`), else "local". Nothing is
written on the office server and nothing into the client's learning folder. No audio, frames or file contents: words, numbers
and settings only. A write error goes to engine.log and never reaches a job.

An event: {v, id, t, computer, name, project (the project's id, not its path), sequence (guid, else name), client, kind, data}.
Several compares of the same project and sequence are all kept; a reader takes the newest per key (`newest_compares`).
"""
from __future__ import annotations

import difflib
import json
import logging
import os
import queue
import re
import threading
import time
import uuid
from collections import Counter

from . import captionstate, config, learning, prcaptions, subtitles, transcript

log = logging.getLogger("asistent")
FORMAT = 1
# the fixed list of what the journal knows; an unknown kind is refused, not written
KINDS = ("run", "placed", "caption_apply", "speakers", "learned_remove", "learned_restore", "move_off_faces", "transcript", "compare")
PANEL_KINDS = ("placed", "move_off_faces")        # the ones the panel posts itself (the rest the engine writes where it happens)
MAX_DATA = 20000                                  # characters of one posted event's data
FIX_WORDS = 3                                     # a replaced group of 1-3 words each side is a recognition fix; more is a rewrite
# A track is Asistent's only when this share of the run's caption words is still in its lines. Measured 2026-11-24: an English
# line (the run's own translation) against the Bulgarian words 0.005; a Bulgarian track with 40 % of its lines deleted 0.50-0.57
# (the 15 real runs on this Mac, the lines dropped at random); so 0.25 keeps a heavily edited Bulgarian track and never lets
# an English one through (even a Latin-letter brand or number in every line stays far below it).
LIKENESS_FLOOR = 0.25
OVERLAP = 0.5                                     # a caption and a line belong together when they share half of the shorter one
PAUSE_CAUSE = 0.12                                # a gap this long without punctuation is a pause (delivery strength 0.5 and up)
_lock = threading.Lock()
_q: "queue.Queue[tuple]" = queue.Queue()
_worker: threading.Thread | None = None
_state = {"pending": 0, "last": None}


def store_dir() -> str:
    return os.path.join(config.app_dir(), "learning", "subtitles")


def _safe(name: str) -> str:
    return re.sub(r"[\\/:*?\"<>|]+", "_", name).strip() or "unknown"


def client_of(project: str) -> str:
    try:
        found = learning.find_folder(project)
        if found:
            return found[0]
    except Exception:                                   # noqa: BLE001 (a server that does not answer: this computer's file)
        pass
    return "local"


def _path(client: str) -> str:
    return os.path.join(store_dir(), f"{_safe(client)}.jsonl")


# ---------------------------------------------------------------- the journal

def log_event(project: str, sequence: str, kind: str, data: dict | None = None) -> dict | None:
    """Append one event -> the event, or None when it could not be written (logged, never raised: a journal never fails a
    job). An unknown kind is a programming error and is refused."""
    if kind not in KINDS:
        raise ValueError(f"Unknown subtitle log event: {kind}")
    try:
        me = learning.computer()
        client = client_of(project)
        ev = {"v": FORMAT, "id": uuid.uuid4().hex[:16], "t": round(time.time(), 3), "computer": me["id"], "name": me["name"],
              "project": learning.project_id(project) if project else "", "sequence": str(sequence or ""), "client": client,
              "kind": kind, "data": data if isinstance(data, dict) else {}}
        line = json.dumps(ev, ensure_ascii=False)
        os.makedirs(store_dir(), exist_ok=True)
        with _lock, open(_path(client), "a", encoding="utf-8") as f:
            f.write(line + "\n")
        return ev
    except Exception as e:                              # noqa: BLE001 (a full disk, a locked file, data that is not JSON)
        log.warning("subtitle log: %s not written: %s", kind, e)
        return None


def post_event(project: str, sequence: str, kind: str, data) -> dict:
    """What the panel may post (POST /subtitles/editlog/event): only its own kinds, a bounded object."""
    if kind not in PANEL_KINDS:
        raise ValueError(f"The panel cannot post this subtitle log event: {kind}")
    if not isinstance(project, str) or not project:
        raise ValueError("The project is missing.")
    if data is None:
        data = {}
    if not isinstance(data, dict) or len(json.dumps(data, ensure_ascii=False, default=str)) > MAX_DATA:
        raise ValueError("Invalid subtitle log data.")
    return {"logged": log_event(project, str(sequence or ""), kind, data) is not None}


def read(client: str) -> list[dict]:
    """Every event of this client's file, oldest first (a damaged line is skipped)."""
    out = []
    try:
        with open(_path(client), encoding="utf-8") as f:
            for line in f:
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                if isinstance(ev, dict) and ev.get("kind") in KINDS and isinstance(ev.get("data"), dict):
                    out.append(ev)
    except OSError:
        pass
    return out


def newest(events: list[dict], kind: str) -> dict:
    """The newest event of a kind per (project id, sequence): a later export of the same sequence replaces the earlier one."""
    out: dict = {}
    for ev in events:
        if ev.get("kind") != kind:
            continue
        key = (ev.get("project"), ev.get("sequence"))
        if key not in out or ev.get("t", 0) >= out[key].get("t", 0):
            out[key] = ev
    return out


def newest_compares(project: str) -> dict:
    return newest(read(client_of(project)), "compare")


# ---------------------------------------------------------------- the run event (written around the /subtitles job)

def _count(v) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def run_data(body: dict, result: dict | None = None, status: str = "done", reason: str | None = None) -> dict:
    """What a Make subtitles press chose and what came out of it (numbers and settings only). status: done | failed |
    cancelled | refused (the request was not accepted)."""
    body = body if isinstance(body, dict) else {}
    preset = body.get("preset") if isinstance(body.get("preset"), str) else "auto"
    reshape = preset == "reshape"                        # the job ignores these for ReShape: the log says what ran
    items = [i for i in (body.get("items") or []) if isinstance(i, dict)]
    clip_seconds = 0.0
    for i in items:
        try:
            clip_seconds += max(0.0, float(i.get("end")) - float(i.get("start")))
        except (TypeError, ValueError):
            pass
    colour = body.get("colour") if isinstance(body.get("colour"), str) else None
    line_break = bool(body.get("line_break")) and not reshape
    data: dict = {
        "status": status,
        "settings": {"preset": preset, "max_words": None if reshape else _count(body.get("max_words")),
                     "case": None if reshape or not isinstance(body.get("case"), str) else body.get("case"),
                     "line_break": line_break, "colour": colour.upper() if colour and line_break else None,
                     "english": bool(body.get("english"))},
        "again": bool(body.get("again")),                 # a rebuild from the Captions tab, not a new reading
        "clips": len(items), "clip_seconds": round(clip_seconds, 1),
    }
    if reason:
        data["reason"] = str(reason)[:300]
    try:
        from . import corrections
        parsed = corrections.parse(body.get("text") or "")
        data["typed"] = {"pairs": len(parsed["pairs"]), "terms": len(parsed["terms"]) + len(body.get("terms") or [])}
    except Exception:                                    # noqa: BLE001 (the log never stops a run)
        pass
    if isinstance(result, dict):
        data["settings"]["resolved"] = result.get("preset")            # what Auto became
        counts = result.get("counts") or {}
        timing = result.get("timing") or {}
        learned = result.get("learning") or {}
        rec = result.get("recognizer")
        data.update({
            "captions": counts.get("captions"), "words": counts.get("words"), "flagged": counts.get("flagged"),
            "speech_seconds": (result.get("readings") or {}).get("seconds"),
            "timing": {"method": timing.get("method"), "aligned": timing.get("aligned"), "weak": timing.get("weak")},
            "asr_seconds": result.get("asr_seconds"), "cached": result.get("cached"),
            "review": len(result.get("review") or []),
            "learned": {"used": len(learned.get("used") or []), "refused": len(learned.get("vetoed") or []),
                        "rules": learned.get("rules")} if learned else None,
            "corrections": [{"heard": str(c.get("heard"))[:80], "said": str(c.get("said"))[:80], "applied": c.get("applied")}
                            for c in (result.get("corrections") or [])[:100] if isinstance(c, dict)],
            "recognition": result.get("profile"), "recognizer": rec.get("name") if isinstance(rec, dict) else None,
            "recognizer_local": rec.get("local") if isinstance(rec, dict) else None,
        })
    return data


def log_run(body: dict, result: dict | None = None, status: str = "done", reason: str | None = None) -> None:
    """Journal one Make subtitles press. Never raises."""
    try:
        body = body if isinstance(body, dict) else {}
        seq = body.get("guid") if isinstance(body.get("guid"), str) and body.get("guid") else body.get("name")
        proj = body.get("project") if isinstance(body.get("project"), str) else ""
        log_event(proj, seq if isinstance(seq, str) else "", "run", run_data(body, result, status, reason))
    except Exception as e:                               # noqa: BLE001
        log.warning("subtitle log: run not written: %s", e)


def apply_data(typed) -> dict | None:
    """The Captions tab's Apply and rebuild: the pairs typed (bounded). None when nothing was typed."""
    if not isinstance(typed, dict):
        return None
    raw = typed.get("pairs") if isinstance(typed.get("pairs"), list) else []          # a malformed body is no pairs, not an error
    pairs = [{"heard": str(p.get("heard"))[:80], "said": str(p.get("said"))[:80]} for p in raw[:100]
             if isinstance(p, dict) and p.get("heard") is not None and p.get("said") is not None]
    out = {"pairs": pairs, "lines": _count(typed.get("lines")) or 0, "english": _count(typed.get("english")) or 0}
    return out if pairs or out["english"] else None


# ---------------------------------------------------------------- the comparison at an export

def _tokens(text: str) -> list[str]:
    return [t for t in str(text).split() if transcript._norm(t)]


def _likeness(run: dict, track: dict) -> float:
    """The share of the run's caption words that a track's lines still have, in order, ignoring case and punctuation."""
    want = [transcript._norm(t) for c in run.get("captions") or [] for t in _tokens(c.get("text", ""))]
    got = [transcript._norm(w) for l in track["lines"] if l.get("text") for w in _tokens(l["text"])]
    if not want or not got:
        return 0.0
    same = sum(b.size for b in difflib.SequenceMatcher(None, want, got, autojunk=False).get_matching_blocks())
    return same / len(want)


def _pick_track(run: dict, tracks: list[dict]) -> tuple[dict | None, float]:
    """Asistent's Bulgarian track -> (track, share of the run's caption time its lines cover), or (None, best coverage) when
    none can be told to be it. Of the tracks that cover the run's captions well enough (`transcript.match_track`, TRACK_MATCH)
    the one whose words read most like the captions wins, never the one that covers the most time (after the editor deleted a
    Bulgarian line the untouched English track covers more), and it must reach LIKENESS_FLOOR, so a wrong track is unlikely to become
    fix pairs (a short clip of brand names and numbers can still pass: a known limit). The captionstate record is not used: its track index is UXP's at placement, `prcaptions` counts inside a track
    group at export, and nothing ties the two numberings together."""
    scored = [(t, transcript.match_track(run, [t])[1]) for t in tracks if t.get("lines")]
    if not scored:
        return None, 0.0
    good = [(t, s) for t, s in scored if s >= transcript.TRACK_MATCH]
    if not good:
        return None, max(s for _, s in scored)
    best = max(good, key=lambda x: _likeness(run, x[0]))
    return best if _likeness(run, best[0]) >= LIKENESS_FLOOR else (None, best[1])


def _components(captions: list[dict], lines: list[dict]) -> list[tuple[list[int], list[int]]]:
    """Captions and lines that overlap in time, grouped: [(caption indexes, line indexes)] in time order. A caption or a line
    alone in its group is a deleted caption or an added line."""
    parent = list(range(len(captions) + len(lines)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for i, c in enumerate(captions):
        for j, l in enumerate(lines):
            ov = max(0.0, min(c["end"], l["end"]) - max(c["start"], l["start"]))
            short = min(c["end"] - c["start"], l["end"] - l["start"])
            if ov > 0 and ov >= OVERLAP * max(short, 1e-6):
                parent[find(i)] = find(len(captions) + j)
    groups: dict[int, tuple[list[int], list[int]]] = {}
    for x in range(len(parent)):
        g = groups.setdefault(find(x), ([], []))
        (g[0] if x < len(captions) else g[1]).append(x if x < len(captions) else x - len(captions))
    return sorted(groups.values(), key=lambda g: min([captions[i]["start"] for i in g[0]] + [lines[j]["start"] for j in g[1]]))


def _cause(word: str, gap: float) -> str:
    if transcript.SENTENCE_END.search(word):
        return "sentence_end"
    if transcript.CLAUSE_END.search(word):
        return "comma"
    return "pause" if gap >= PAUSE_CAUSE else "none"


def _caption_words(words: list[dict], captions: list[dict]) -> list[list[int]]:
    """Which of the run's words each placed caption shows (indexes into `words`, in order): by the most time shared with the
    caption, else the nearest one. The run's JSON keeps a caption's text, not its words."""
    out: list[list[int]] = [[] for _ in captions]
    if not captions:
        return out
    for i, w in enumerate(words):
        if not transcript._norm(w["word"]):
            continue
        ws, we = float(w["start"]), float(w["end"])
        best = max(range(len(captions)), key=lambda k: (transcript._overlap(ws, we, captions[k]["start"], captions[k]["end"]),
                                                         -abs((ws + we) / 2 - (captions[k]["start"] + captions[k]["end"]) / 2)))
        out[best].append(i)
    return out


def _cuts(cap_words: list[int], words: list[dict], delivery: dict, parts: list[dict]) -> list[dict]:
    """Where a caption was cut into lines: the word index of each cut and what the engine saw there."""
    counts = [len(_tokens(p["text"])) for p in parts if p.get("text") is not None]
    if len(counts) != len(parts) or not cap_words or not sum(counts):
        return []
    total, n = sum(counts), len(cap_words)
    out, at = [], 0
    for c in counts[:-1]:
        at += c
        k = at if total == n else round(at * n / total)        # an edited word shifts the count: the cut is then proportional
        if not 0 < k < n:
            continue
        before, after = words[cap_words[k - 1]], words[cap_words[k]]
        gap = max(0.0, float(after["start"]) - float(before["end"]))
        punct = re.search(r"[^\w\s]+$", str(before["word"]))
        out.append({"k": k, "word": cap_words[k], "gap": round(gap, 3), "punct": punct.group(0) if punct else "",
                    "strength": round(delivery.get(id(before), 0.0), 2), "cause": _cause(str(before["word"]), gap),
                    **({"approx": True} if total != n else {})})
    return out


def _word_changes(captions: list[dict], lines: list[dict]) -> dict:
    """difflib on the words (case and punctuation ignored): a replaced group of 1-3 words each side is a fix pair, anything
    else is only counted."""
    a, owner = [], []

    def caps_line(l: dict) -> bool:                      # a client style's capitals, as transcript.edited_words reads them
        text = str(l.get("text") or "")
        return any(ch.isalpha() for ch in text) and text == text.upper()
    for ci, c in enumerate(captions):
        for t in _tokens(c.get("text", "")):
            a.append(t)
            owner.append(ci)
    b, b_caps = [], []
    for l in lines:
        if l.get("text") is not None:
            for t in _tokens(l["text"]):
                b.append(t)
                b_caps.append(caps_line(l))
    na, nb = [transcript._norm(t) for t in a], [transcript._norm(t) for t in b]
    fixes, counts, moved = [], Counter(), 0
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, na, nb, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        moved += max(i2 - i1, j2 - j1)
        if op == "replace" and i2 - i1 <= FIX_WORDS and j2 - j1 <= FIX_WORDS:
            counts["fix"] += 1
            fixes.append({"heard": " ".join(na[i1:i2]), "said": " ".join(nb[j1:j2]),
                          "heard_raw": " ".join(a[i1:i2]), "said_raw": " ".join(b[j1:j2]), "said_caps": all(b_caps[j1:j2]), "left": na[i1 - 1] if i1 else "",
                          "right": na[i2] if i2 < len(na) else "", "example": " ".join(a[max(0, i1 - 3):i2 + 3]), "caption": owner[i1]})
        else:
            counts["rewrite" if op == "replace" else "insert" if op == "insert" else "delete"] += 1
    return {"fixes": fixes, "counts": dict(counts), "words_changed": moved}


def _minutes_since_placed(events: list[dict], pid: str, sequence: str) -> float | None:
    at = [e["t"] for e in events if e.get("kind") == "placed" and e.get("project") == pid and e.get("sequence") == sequence]
    return round((time.time() - max(at)) / 60, 1) if at else None


def compare_sequence(seq: dict, record: dict, events: list[dict] | None = None, project: str = "") -> dict:
    """One sequence of the saved project against what Asistent placed there -> the compare event's data."""
    guid = seq["guid"]
    base = {"status": "ok", "sequence": guid, "name": seq.get("name") or ""}
    srt = record.get("srt")
    js = os.path.splitext(srt)[0] + ".json" if isinstance(srt, str) and srt else ""
    try:
        with open(js, encoding="utf-8") as f:
            run = json.load(f)
    except (OSError, ValueError):
        return {**base, "status": "no_run"}                  # the run's file is gone (moved, deleted): nothing to compare with
    track, score = _pick_track(run, seq["tracks"])
    if not track or score < transcript.TRACK_MATCH:                          # the editor moved, replaced or rewrote the track
        return {**base, "status": "no_track", "run": os.path.basename(js)}
    fps = float(run.get("fps") or 25.0)
    frame = 1.0 / max(fps, 1.0)
    captions = [{"start": float(c["start"]), "end": float(c["end"]), "text": str(c.get("text") or "")} for c in run.get("captions") or []]
    lines = sorted(track["lines"], key=lambda l: (l["start"], l["end"]))
    words = transcript._words(run)
    delivery = subtitles._delivery(words) if words else {}
    cap_words = _caption_words(words, captions)
    counts: Counter = Counter()
    splits, merges, deleted, added, retimes, regroups = [], [], [], [], [], []
    for ci_list, lj_list in _components(captions, lines):
        if len(ci_list) == 1 and len(lj_list) == 1:
            c, l = captions[ci_list[0]], lines[lj_list[0]]
            ds, de = l["start"] - c["start"], l["end"] - c["end"]
            if abs(ds) > frame or abs(de) > frame:
                counts["retime"] += 1
                retimes.append({"caption": ci_list[0], "start": round(ds, 3), "end": round(de, 3)})
        elif len(ci_list) == 1 and len(lj_list) > 1:
            counts["split"] += 1
            parts = [lines[j] for j in lj_list]
            splits.append({"caption": ci_list[0], "lines": len(parts),
                           "cuts": _cuts(cap_words[ci_list[0]], words, delivery, parts)})
        elif len(ci_list) > 1 and len(lj_list) == 1:
            counts["merge"] += 1
            merges.append({"captions": ci_list, "line": lj_list[0]})
        elif not lj_list:
            for i in ci_list:
                counts["deleted"] += 1
                deleted.append({"caption": i, "start": round(captions[i]["start"], 3), "end": round(captions[i]["end"], 3),
                                "words": len(_tokens(captions[i]["text"]))})
        elif not ci_list:
            for j in lj_list:
                counts["added"] += 1
                added.append({"line": j, "start": round(lines[j]["start"], 3), "end": round(lines[j]["end"], 3)})
        else:                                               # several captions into several lines: regrouped, counts only
            counts["regroup"] += 1
            regroups.append({"captions": ci_list, "lines": len(lj_list)})
    wc = _word_changes(captions, lines)
    counts.update(wc["counts"])
    pid = learning.project_id(project) if project else ""
    return {**base, "run": os.path.basename(js), "preset": run.get("preset"), "fps": fps, "track": track.get("index"),
            "match": round(score, 2), "placed": len(captions), "lines": len(lines), "counts": dict(counts),
            "words_changed": wc["words_changed"], "splits": splits, "merges": merges, "deleted": deleted, "added": added,
            "retimes": retimes, "regroups": regroups, "fixes": wc["fixes"],
            "unreadable": sum(1 for l in lines if l.get("text") is None),
            "minutes_since_placed": _minutes_since_placed(events, pid, guid) if events is not None else None}


def compare(project: str) -> list[dict]:
    """The saved project's caption lines against Asistent's placed captions, one record (a compare event's data, with the
    sequence's guid) per sequence Asistent put captions on. A sequence with no record is not Asistent's: skipped. Reads only."""
    if not isinstance(project, str) or not project:
        return []
    try:
        seqs = prcaptions.read(project)
    except (OSError, EOFError, ValueError, SyntaxError) as e:      # SyntaxError: ElementTree's ParseError
        log.warning("subtitle log: the project could not be read (%s)", type(e).__name__)
        return []
    events = read(client_of(project))
    out = []
    for seq in seqs:
        record = captionstate.get(project, "guid:" + seq["guid"])
        if not record:
            continue
        try:
            out.append(compare_sequence(seq, record, events, project))
        except Exception as e:                                     # noqa: BLE001 (one odd sequence never stops the others)
            log.warning("subtitle log: %s not compared: %s", seq.get("name"), e)
    return out


def _same(a: dict, b: dict) -> bool:
    drop = ("minutes_since_placed", "saved")            # time moves on between two exports, and `saved` is not a finding
    return {k: v for k, v in a.items() if k not in drop} == {k: v for k, v in b.items() if k not in drop}


def compare_now(project: str, saved=None) -> dict:
    """compare() and one `compare` event per sequence, written now, unless its findings equal the newest compare of that
    sequence (repeated exports with no change add nothing, whether or not the file was saved this time, so an identical compare
    on an unsaved file is never written after a saved one). saved: whether the panel saved the project just before (True / False / "skipped", None when unknown), kept in the
    event so a comparison made on an unsaved file can be told apart."""
    recs = compare(project)
    pid = learning.project_id(project) if project else ""
    last = newest(read(client_of(project)), "compare")
    written = same = 0
    for r in recs:
        if saved is not None:
            r["saved"] = saved
        prev = last.get((pid, r["sequence"]))
        if prev is not None and _same(prev["data"], r):
            same += 1
        elif log_event(project, r["sequence"], "compare", r) is not None:
            written += 1
    log.info("subtitle log: %s: %d sequences compared, %d written, %d unchanged", client_of(project), len(recs), written, same)
    return {"client": client_of(project), "sequences": len(recs), "written": written, "unchanged": same}


def has_record(project: str) -> bool:
    """Has Asistent placed captions in this project (a record in captions.json)? Read only, the key rule of
    captionstate: normcase(project) | sequence. The panel saves the project at an export only when this is true."""
    if not isinstance(project, str) or not project:
        return False
    try:
        with open(os.path.join(config.app_dir(), "captions.json"), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return False
    prefix = os.path.normcase(project) + "|guid:"
    return isinstance(data, dict) and any(isinstance(k, str) and k.startswith(prefix) for k in data)


def _run():
    while True:
        project = _q.get()
        try:
            _state["last"] = compare_now(*project)
        except Exception as e:                          # noqa: BLE001 (never stops the worker)
            log.warning("subtitle log: compare failed: %s", e)
        finally:
            _state["pending"] = max(0, _state["pending"] - 1)
            _q.task_done()


def queue_compare(project: str, saved=None) -> dict:
    """Queued for the background worker (a project can be 100 MB); returns at once."""
    global _worker
    if not isinstance(project, str) or not project:
        raise ValueError("The project is missing.")
    if saved not in (True, False, "skipped"):
        saved = None
    _q.put((project, saved))
    _state["pending"] += 1
    if _worker is None or not _worker.is_alive():
        _worker = threading.Thread(target=_run, name="editlog", daemon=True)
        _worker.start()
    return {"queued": 1, "client": client_of(project)}


def status() -> dict:
    return {"pending": _state["pending"], "last": _state["last"]}


def wait(timeout: float = 10.0) -> None:
    """Let queued comparisons finish (tests)."""
    end = time.time() + timeout
    while _q.unfinished_tasks and time.time() < end:
        time.sleep(0.02)


# ---------------------------------------------------------------- the counts (read only)

def summary(project: str) -> dict:
    """What the journal holds for this project's client: events per kind; the settings most used (the LAST run of each
    sequence counts, so trying options does not count five times); word fixes with the number of distinct videos; splits by
    cause. From the newest compare of each sequence. For the recap later (Step 3) and for the bridge check now."""
    client = client_of(project)
    events = read(client)
    kinds = Counter(e["kind"] for e in events)
    last = newest([e for e in events if e["data"].get("status") == "done"], "run") if events else {}
    settings: dict[str, Counter] = {k: Counter() for k in ("preset", "resolved", "max_words", "case", "line_break", "english", "colour")}
    for ev in last.values():
        s = ev["data"].get("settings") or {}
        for k, c in settings.items():
            c[str(s.get(k))] += 1
    fixes: dict[str, dict] = {}
    causes: Counter = Counter()
    totals: Counter = Counter()
    # the newest valid comparison of each sequence: a later "no_run" / "no_track" does not erase an earlier good one
    compared = list(newest([e for e in events if e["data"].get("status") == "ok"], "compare").values())
    for ev in compared:
        d = ev["data"]
        totals.update(d.get("counts") or {})
        for sp in d.get("splits") or []:
            causes.update(c["cause"] for c in sp.get("cuts") or [])
        for fx in d.get("fixes") or []:
            key = learning.rule_key(fx["heard"], fx["said"])
            row = fixes.setdefault(key, {"key": key, "heard": fx["heard"], "said": fx["said"], "count": 0, "videos": set()})
            row["count"] += 1
            row["videos"].add((ev["project"], ev["sequence"]))
    rows = sorted(({**r, "videos": len(r["videos"])} for r in fixes.values()), key=lambda r: (-r["videos"], -r["count"], r["key"]))
    return {"client": client, "events": dict(kinds), "runs": len(last),
            "settings": {k: dict(c.most_common()) for k, c in settings.items()},
            "compared": len(compared), "counts": dict(totals), "fixes": rows, "splits": dict(causes)}
