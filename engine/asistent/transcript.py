"""The subtitles as a transcript (0.10.66, the user 2026-11-12: "export the captions as transcriptions").

Built from the run's own words (the JSON next to the SRT: the corrected, aligned words with their case and punctuation), not
from the caption lines, which a client style shows in capitals without punctuation. Paragraphs break where the speaker
stops: a sentence end followed by a pause, or any long pause. With times, each paragraph starts with [m:ss] in the sequence's
time. An English line (when the run made one) follows as its own section. Written next to the SRT, UTF-8, and only inside an
Asistent_subtitles folder (the engine's own output).
"""
from __future__ import annotations

import json
import os
import re

SENTENCE_END = re.compile(r"[.!?…][\"»“)]*$")
PARA_AFTER_SENTENCE = 0.8      # a sentence end followed by a pause this long starts a new paragraph
PARA_ANY = 2.0                 # any pause this long does too
PARA_MAX_WORDS = 120           # and a very long paragraph breaks at its next sentence end


def _clock(t: float) -> str:
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t // 60 % 60):02d}:{int(t % 60):02d}" if t >= 3600 else f"{int(t // 60)}:{int(t % 60):02d}"


def paragraphs(words: list[dict]) -> list[dict]:
    """[{"start", "text"}] from timed words."""
    out: list[dict] = []
    cur: list[dict] = []
    for i, w in enumerate(words):
        text = str(w.get("word", "")).strip()
        if not text:
            continue
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        gap = (float(nxt["start"]) - float(w["end"])) if nxt else 1e9
        end = bool(SENTENCE_END.search(text))
        if gap >= PARA_ANY or (end and gap >= PARA_AFTER_SENTENCE) or (end and len(cur) >= PARA_MAX_WORDS):
            out.append({"start": float(cur[0]["start"]), "text": " ".join(str(x["word"]).strip() for x in cur)})
            cur = []
    if cur:
        out.append({"start": float(cur[0]["start"]), "text": " ".join(str(x["word"]).strip() for x in cur)})
    for p in out:                                                    # Whisper's spaces before punctuation, if any
        p["text"] = re.sub(r"\s+([,.!?…:;])", r"\1", p["text"])
        if p["text"] and p["text"][0].islower():
            p["text"] = p["text"][0].upper() + p["text"][1:]
    return out


def build(run: dict, times: bool) -> str:
    words = sorted((w for w in run.get("words") or [] if "start" in w and "end" in w), key=lambda w: float(w["start"]))
    if not words:                                                    # an older run without words: the caption lines
        words = [{"word": c["text"].replace("\n", " "), "start": c["start"], "end": c["end"]} for c in run.get("captions") or []]
    if not words:
        raise ValueError("These subtitles have no lines to export.")
    body = [(f"[{_clock(p['start'])}] " if times else "") + p["text"] for p in paragraphs(words)]
    en = [c for c in run.get("captions") or [] if str(c.get("en") or "").strip()]
    english: list[str] = []
    para: list[str] = []
    for i, c in enumerate(en):
        if not para and times:
            para.append(f"[{_clock(float(c['start']))}]")
        para.append(str(c["en"]).replace("\n", " ").strip())
        nxt = en[i + 1] if i + 1 < len(en) else None
        if not nxt or float(nxt["start"]) - float(c["end"]) >= PARA_ANY or (SENTENCE_END.search(para[-1]) and len(para) >= 8):
            english.append(" ".join(para))
            para = []
    text = "\n\n".join(body)
    if english:
        text += "\n\nEnglish\n\n" + "\n\n".join(english)
    return text + "\n"


def export(json_path: str, times: bool = False) -> dict:
    """The run's JSON -> {"path", "paragraphs"}: the transcript written next to its SRT."""
    if not isinstance(json_path, str) or not json_path.endswith(".json") or not os.path.isfile(json_path):
        raise ValueError("The subtitles' file was not found: make the subtitles again.")
    if os.path.basename(os.path.dirname(json_path)) != "Asistent_subtitles":
        raise ValueError("Only subtitles Asistent made can be exported.")
    with open(json_path, encoding="utf-8") as f:
        run = json.load(f)
    text = build(run, times)
    stem = os.path.splitext(json_path)[0]
    out = f"{stem} transcript{' (times)' if times else ''}.txt"
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return {"path": out, "paragraphs": text.count("\n\n") + 1}
