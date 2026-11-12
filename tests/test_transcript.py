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


def test_only_asistents_own_runs_are_exported(tmp_path):
    p = tmp_path / "x.json"
    p.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="Asistent made"):
        T.export(str(p))
    with pytest.raises(ValueError, match="not found"):
        T.export(str(tmp_path / "missing.json"))
