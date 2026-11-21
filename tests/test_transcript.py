"""The subtitles as a transcript (0.10.66): paragraphs from the run's words, times, English, only Asistent's own runs."""
import json
import os
from pathlib import Path

import pytest

from asistent import transcript as T


def _w(text, t, d=0.3, gap=0.05):
    out = []
    for tok in text.split():
        if tok.startswith("|"):
            t += float(tok[1:])
            continue
        out.append({"word": tok, "start": t, "end": t + d})
        t += d + gap
    return out


def test_paragraphs_break_where_the_speaker_stops():
    words = _w("Днес ще ви покажа нещо. |1.0 после продължаваме тук , без пауза. Още едно.", 61.0)
    ps = T.paragraphs(words)
    assert [p["text"] for p in ps] == ["Днес ще ви покажа нещо.", "После продължаваме тук, без пауза. Още едно."]
    assert ps[1]["start"] == pytest.approx(61.0 + 5 * 0.35 + 1.0)


def test_export_writes_next_to_the_srt_with_times_and_english(tmp_path):
    folder = tmp_path / "Asistent_subtitles"
    folder.mkdir()
    run = {"words": _w("Първо изречение. |2.5 Второ изречение.", 65.0),
           "captions": [{"start": 65.0, "end": 65.6, "text": "ПЪРВО ИЗРЕЧЕНИЕ", "en": "First sentence."},
                        {"start": 68.2, "end": 68.9, "text": "ВТОРО ИЗРЕЧЕНИЕ", "en": "Second sentence."}]}
    p = folder / "seq 2026.json"
    p.write_text(json.dumps(run, ensure_ascii=False), encoding="utf-8")
    plain = T.export(str(p))
    assert os.path.basename(plain["path"]) == "seq 2026 transcript.txt"
    text = Path(plain["path"]).read_text(encoding="utf-8")
    assert text.startswith("Първо изречение.\n\nВторо изречение.\n\nEnglish\n\n")       # the words' case and punctuation, not the capitals
    assert "First sentence." in text and "ПЪРВО" not in text
    timed = Path(T.export(str(p), times=True)["path"]).read_text(encoding="utf-8")
    assert timed.startswith("[1:05] Първо изречение.\n\n[1:08] Второ изречение.")


def test_a_tight_voice_over_gets_a_time_on_every_sentence_and_short_paragraphs():
    # 0.10.140 (the user: "the timings on the text are not right"): no pause anywhere, so before this the whole
    # 40 s were one paragraph under one time; now each sentence has its own line and time, four to a paragraph
    sentences = [f"Изречение номер {i} има малко думи." for i in range(1, 11)]
    words = _w(" ".join(sentences), 178.0)
    text = T.build({"words": words}, times=True)
    paras = text.strip().split("\n\n")
    assert [len(p.split("\n")) for p in paras] == [4, 4, 2]
    lines = text.strip().replace("\n\n", "\n").split("\n")
    assert len(lines) == 10
    for i, line in enumerate(lines):
        start = words[6 * i]["start"]
        assert line == f"[{T._clock(start)}] {sentences[i]}"
    assert T.build({"words": words}, times=False).strip().count("\n\n") == 2      # the plain one: the same paragraphs


def test_a_long_sentence_gets_a_second_time_after_a_comma():
    words = _w("Едно две три четири пет шест седем осем девет десет единайсет дванайсет тринайсет четиринайсет "
               "петнайсет шестнайсет седемнайсет осемнайсет , после още малко думи.", 10.0)
    text = T.build({"words": words}, times=True)
    assert text.count("[") == 2 and text.startswith("[0:10] Едно") and "\n[0:16] После още малко думи." in text


def test_english_follows_with_a_time_on_every_sentence():
    caps = [{"start": 61.0 + i, "end": 61.9 + i, "text": "Х", "en": e}
            for i, e in enumerate(["Here is what", "you get.", "This is Alpha."])]
    text = T.build({"words": _w("Ето какво получавате. Това е Алфа.", 61.0), "captions": caps}, times=True)
    assert text.endswith("English\n\n[1:01] Here is what you get.\n[1:03] This is Alpha.\n")


def test_only_asistents_own_runs_are_exported(tmp_path):
    p = tmp_path / "x.json"
    p.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="Asistent made"):
        T.export(str(p))
    with pytest.raises(ValueError, match="not found"):
        T.export(str(tmp_path / "missing.json"))
