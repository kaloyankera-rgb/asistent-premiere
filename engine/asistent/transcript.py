"""The subtitles as a transcript (0.10.66, the user 2026-11-12: "export the captions as transcriptions").

Built from the run's own words (the JSON next to the SRT: the corrected, aligned words with their case and punctuation), not
from the caption lines, which a client style shows in capitals without punctuation. Paragraphs break where the speaker
stops: a sentence end followed by a pause, or any long pause, and after a few sentences. With times (0.10.140), every sentence
is on its own line after its own [m:ss] in the sequence's time. An English line (when the run made one) follows as its own section. Written next to the SRT, UTF-8, and only inside an
Asistent_subtitles folder (the engine's own output).

0.10.150 (the user: subtitles changed in Premiere's Text panel must be in the transcript): when the panel names the project
and the sequence, the caption lines are read from the saved project (`prcaptions.py`), Asistent's own track is found by its
times, and the editor's words replace the run's where they differ (`edited_words`). Words the editor did not change keep the
run's case, punctuation and times, so an untouched track gives exactly the transcript the run alone gives.
"""
from __future__ import annotations

import difflib
import json
import os
import re

from . import prcaptions

SENTENCE_END = re.compile(r"[.!?…][\"»“)]*$")
CLAUSE_END = re.compile(r"[,;:–—][\"»“)]*$")
PARA_AFTER_SENTENCE = 0.8      # a sentence end followed by a pause this long starts a new paragraph
PARA_ANY = 2.0                 # any pause this long does too
PARA_SENTENCES = 4             # 0.10.140: and so does a 4th sentence end (a voice-over cut tight has no pauses at all)
PARA_MAX_WORDS = 60            # and a paragraph this long breaks at its next sentence end
LONG_SENTENCE = 18             # with times, a sentence this long also gets a time after its next comma


def _clock(t: float) -> str:
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t // 60 % 60):02d}:{int(t % 60):02d}" if t >= 3600 else f"{int(t // 60)}:{int(t % 60):02d}"


def _tidy(text: str) -> str:
    text = re.sub(r"\s+([,.!?…:;])", r"\1", text)                    # Whisper's spaces before punctuation, if any
    return text[0].upper() + text[1:] if text and text[0].islower() else text


def paragraphs(words: list[dict]) -> list[dict]:
    """[{"start", "text", "sentences": [{"start", "text"}]}] from timed words (or English lines, one per item).
    A paragraph ends where the speaker stops (a sentence end and a pause, or a long pause), after its 4th sentence or past
    60 words at a sentence end. Each sentence keeps its own start time; a long one is split after a comma, so a time is
    never more than a sentence or so away from its words (0.10.140: one tight 40 s voice-over had one time for all)."""
    out: list[dict] = []
    cur: list[dict] = []
    sent: list[dict] = []
    sentences: list[dict] = []
    count = 0                                                        # words in the paragraph so far

    def close_sentence():
        nonlocal sent
        if sent:
            sentences.append({"start": float(sent[0]["start"]), "text": _tidy(" ".join(str(x["word"]).strip() for x in sent))})
            sent = []

    for i, w in enumerate(words):
        text = str(w.get("word", "")).strip()
        if not text:
            continue
        cur.append(w)
        sent.append(w)
        count += len(text.split())
        nxt = words[i + 1] if i + 1 < len(words) else None
        gap = (float(nxt["start"]) - float(w["end"])) if nxt else 1e9
        end = bool(SENTENCE_END.search(text))
        if end or gap >= PARA_ANY or (CLAUSE_END.search(text) and sum(len(str(x["word"]).split()) for x in sent) >= LONG_SENTENCE):
            close_sentence()
        if gap >= PARA_ANY or (end and (gap >= PARA_AFTER_SENTENCE or len(sentences) >= PARA_SENTENCES
                                         or count >= PARA_MAX_WORDS)):
            close_sentence()
            out.append({"start": float(cur[0]["start"]), "text": _tidy(" ".join(str(x["word"]).strip() for x in cur)),
                        "sentences": sentences})
            cur, sentences, count = [], [], 0
    if cur:
        close_sentence()
        out.append({"start": float(cur[0]["start"]), "text": _tidy(" ".join(str(x["word"]).strip() for x in cur)),
                    "sentences": sentences})
    return out


def _section(items: list[dict], times: bool) -> list[str]:
    """Paragraphs as text: plain, or with times every sentence on its own line after its [m:ss]."""
    if not times:
        return [p["text"] for p in paragraphs(items)]
    return ["\n".join(f"[{_clock(s['start'])}] {s['text']}" for s in p["sentences"]) for p in paragraphs(items)]


TOKEN_EDGE = re.compile(r"^[\W_]+|[\W_]+$")
TRACK_MATCH = 0.5              # Asistent's track: its lines cover at least half of the run's caption time
TIME_SLACK = 1.0               # a kept word stays at its own time while it is within this of its line on the timeline


def _norm(token: str) -> str:
    return TOKEN_EDGE.sub("", str(token).lower()).replace("ё", "е")


def _words(run: dict) -> list[dict]:
    words = sorted((w for w in run.get("words") or [] if "start" in w and "end" in w), key=lambda w: float(w["start"]))
    if not words:                                                    # an older run without words: the caption lines
        words = [{"word": c["text"].replace("\n", " "), "start": c["start"], "end": c["end"]} for c in run.get("captions") or []]
    return words


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def match_track(run: dict, tracks: list[dict]) -> tuple[dict | None, float]:
    """The caption track whose lines cover the run's caption times best -> (track, share of the run's time covered)."""
    caps = [(float(c["start"]), float(c["end"])) for c in run.get("captions") or []]
    total = sum(e - s for s, e in caps) or 0.0
    best, score = None, 0.0
    for t in tracks:
        if not total or not t["lines"]:
            continue
        lines = [(l["start"], l["end"]) for l in t["lines"]]
        covered = sum(min(e - s, sum(_overlap(s, e, a, b) for a, b in lines)) for s, e in caps)
        if covered / total > score:
            best, score = t, covered / total
    return best, score


def edited_words(words: list[dict], lines: list[dict]) -> tuple[list[dict], int]:
    """The run's timed words with the timeline's caption lines (as the editor left them) laid over them -> (words, lines
    changed). Aligned word by word ignoring case and punctuation: an equal word is the run's own word (its case, punctuation
    and time; the line's time when the editor moved the line); a changed or added word is the editor's, lower case when the
    line is in capitals (a client style), timed inside its line; a word the editor deleted is gone. A line whose text could
    not be read counts as unchanged."""
    words = [w for w in words if str(w.get("word", "")).strip()]
    lines = sorted(lines, key=lambda l: (l["start"], l["end"]))
    tokens = []                                                      # the timeline's words: (text, line index, place, count)
    for li, line in enumerate(lines):
        if line.get("text") is None:
            got = [str(w["word"]).strip() for w in words if line["start"] <= (float(w["start"]) + float(w["end"])) / 2 < line["end"]]
        else:
            got = str(line["text"]).split()
        got = [t for t in got if _norm(t)]
        tokens += [(t, li, k, len(got)) for k, t in enumerate(got)]
    keep = [i for i, w in enumerate(words) if _norm(w["word"])]      # a lone dash or mark rides along with its neighbours
    a = [_norm(words[i]["word"]) for i in keep]
    b = [_norm(t[0]) for t in tokens]

    def timed(tok) -> tuple[float, float]:
        line = lines[tok[1]]
        step = (line["end"] - line["start"]) / max(1, tok[3])
        return line["start"] + tok[2] * step, line["start"] + (tok[2] + 1) * step

    def caps(li: int) -> bool:
        text = str(lines[li].get("text") or "")
        return any(c.isalpha() for c in text) and text == text.upper()

    out: list[dict] = []
    changed: set[int] = set()
    done = 0                                                         # words[] before this index are placed or dropped

    def carry(upto: int, keep_marks: bool) -> None:
        nonlocal done
        for w in words[done:upto]:
            if keep_marks and not _norm(w["word"]):
                out.append(dict(w))
        done = max(done, upto)

    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        first = keep[i1] if i1 < len(keep) else len(words)
        carry(first, True)
        if op == "equal":
            for i, j in zip(range(i1, i2), range(j1, j2)):
                carry(keep[i], True)
                w = dict(words[keep[i]])
                line = lines[tokens[j][1]]
                mid = (float(w["start"]) + float(w["end"])) / 2
                if not line["start"] - TIME_SLACK <= mid <= line["end"] + TIME_SLACK:
                    w["start"], w["end"] = timed(tokens[j])
                out.append(w)
                done = keep[i] + 1
            continue
        old = [words[keep[i]] for i in range(i1, i2)]
        # words added after a sentence's last word ("Алфа." + "спорт"): the mark moves to the end of the added words, unless
        # the editor's own text kept it on that word
        moved = ""
        if op == "insert" and out and j1 > 0:
            mark = re.search(r"[\W_]+$", str(out[-1]["word"]))
            if mark and not re.search(r"[\W_]$", tokens[j1 - 1][0]):
                moved = mark.group(0)
                out[-1] = {**out[-1], "word": str(out[-1]["word"])[:-len(moved)]}
        for k, j in enumerate(range(j1, j2)):
            text = tokens[j][0]
            if caps(tokens[j][1]) and text.upper() == text:
                text = text.lower()
                if k == 0 and old and str(old[0]["word"])[:1].isupper():
                    text = text[:1].upper() + text[1:]
            if k == j2 - j1 - 1 and old:
                mark = re.search(r"[\W_]+$", str(old[-1]["word"]))
                if mark and not re.search(r"[\W_]$", text):
                    text += mark.group(0)
            if k == j2 - j1 - 1 and moved and not re.search(r"[\W_]$", text):
                text += moved
            start, end = timed(tokens[j])
            out.append({"word": text, "start": start, "end": end})
            changed.add(tokens[j][1])
        for w in old:                                                # deleted words: the line they sat in
            mid = (float(w["start"]) + float(w["end"])) / 2
            near = [li for li, l in enumerate(lines) if l["start"] - TIME_SLACK <= mid <= l["end"] + TIME_SLACK]
            changed.add(near[0] if near else -1 - len(changed))
        carry(keep[i2 - 1] + 1 if i2 > i1 else done, op != "delete")
    carry(len(words), True)
    return out, len(changed)


def premiere_lines(run: dict, project: str, guid: str | None, name: str | None) -> tuple[list[dict] | None, str]:
    """Asistent's caption lines as they are in the saved project -> (lines, "") or (None, why not)."""
    if not isinstance(project, str) or not project.lower().endswith(".prproj") or not os.path.isfile(project):
        return None, "the project file was not found"
    try:
        seqs = prcaptions.read(project)
    except (OSError, EOFError, ValueError, SyntaxError) as e:            # SyntaxError: ElementTree's ParseError
        return None, f"the project could not be read ({type(e).__name__})"
    seq = next((s for s in seqs if guid and s["guid"] == guid), None) or next((s for s in seqs if name and s["name"] == name), None)
    if not seq:
        return None, "the saved project has no captions on this sequence"
    track, score = match_track(run, seq["tracks"])
    if not track or score < TRACK_MATCH:
        return None, "Asistent's caption track was not found on the sequence (moved or replaced)"
    return track["lines"], ""


def build(run: dict, times: bool, lines: list[dict] | None = None) -> str:
    words = _words(run)
    if lines:
        words, _ = edited_words(words, lines)
    if not words:
        raise ValueError("These subtitles have no lines to export.")
    body = _section(words, times)
    # the English line (when the run made one): each caption's English as one item, in the same paragraphs and times
    en = [{"word": str(c["en"]).replace("\n", " ").strip(), "start": float(c["start"]), "end": float(c["end"])}
          for c in run.get("captions") or [] if str(c.get("en") or "").strip()]
    text = "\n\n".join(body)
    if en:
        text += "\n\nEnglish\n\n" + "\n\n".join(_section(en, times))
    return text + "\n"


def export(json_path: str, times: bool = False, project: str | None = None, guid: str | None = None,
           name: str | None = None) -> dict:
    """The run's JSON -> {"path", "paragraphs", "premiere"}: the transcript written next to its SRT. With a project, the
    caption lines as saved there replace the run's words where the editor changed them; "premiere" says how many lines
    were read and changed, or why the timeline's lines were not used."""
    if not isinstance(json_path, str) or not json_path.endswith(".json") or not os.path.isfile(json_path):
        raise ValueError("The subtitles' file was not found: make the subtitles again.")
    if os.path.basename(os.path.dirname(json_path)) != "Asistent_subtitles":
        raise ValueError("Only subtitles Asistent made can be exported.")
    with open(json_path, encoding="utf-8") as f:
        run = json.load(f)
    lines, why, info = None, "", None
    if project:
        lines, why = premiere_lines(run, project, guid, name)
    if lines:
        info = {"lines": len(lines), "changed": edited_words(_words(run), lines)[1]}
    elif project:
        info = {"lines": 0, "changed": 0, "why": why}
    text = build(run, times, lines)
    stem = os.path.splitext(json_path)[0]
    out = f"{stem} transcript{' (times)' if times else ''}.txt"
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return {"path": out, "paragraphs": text.count("\n\n") + 1, "premiere": info}
