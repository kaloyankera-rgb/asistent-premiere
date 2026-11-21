"""The subtitles as a transcript (0.10.66, the user 2026-11-12: "export the captions as transcriptions").

Built from the run's own words (the JSON next to the SRT: the corrected, aligned words with their case and punctuation), not
from the caption lines, which a client style shows in capitals without punctuation. Paragraphs break where the speaker
stops: a sentence end followed by a pause, or any long pause, and after a few sentences. With times (0.10.140), every sentence
is on its own line after its own [m:ss] in the sequence's time. An English line (when the run made one) follows as its own section. Written next to the SRT, UTF-8, and only inside an
Asistent_subtitles folder (the engine's own output).
"""
from __future__ import annotations

import json
import os
import re

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


def build(run: dict, times: bool) -> str:
    words = sorted((w for w in run.get("words") or [] if "start" in w and "end" in w), key=lambda w: float(w["start"]))
    if not words:                                                    # an older run without words: the caption lines
        words = [{"word": c["text"].replace("\n", " "), "start": c["start"], "end": c["end"]} for c in run.get("captions") or []]
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
