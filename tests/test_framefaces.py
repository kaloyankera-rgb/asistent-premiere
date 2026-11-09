"""Move off faces, engine side (framefaces.py): only the engine's own frames are read and they are deleted after; each
graphic's words come from Asistent's own SRT files (same start and end) and find its line in the recognised text."""
import numpy as np

from asistent import color, config, faces, framefaces, ocr


def test_files_outside_the_frames_folder_are_refused(tmp_path):
    p = tmp_path / "x.png"
    p.write_bytes(b"x")
    assert framefaces.measure([str(p), 5]) == [{"error": "not a frame Asistent exported"}] * 2
    assert p.exists()


def _frames(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    (tmp_path / "frames").mkdir()
    f = tmp_path / "frames" / "a.png"
    f.write_bytes(b"png")
    monkeypatch.setattr(color, "read_image", lambda p: np.zeros((200, 100, 3)))
    monkeypatch.setattr(faces, "detect", lambda img: [(25, 50, 50, 40, 0.9)])
    return f


def test_a_frame_is_measured_as_fractions_and_deleted(monkeypatch, tmp_path):
    f = _frames(monkeypatch, tmp_path)
    assert framefaces.measure([str(f)]) == [{"faces": [{"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.2, "score": 0.9}], "text": {}}]
    assert not f.exists()


def _project(tmp_path):
    proj = tmp_path / "proj"
    (proj / "Asistent_subtitles").mkdir(parents=True)
    (proj / "Asistent_subtitles" / "s.srt").write_text(
        "﻿1\n00:00:01,000 --> 00:00:02,000\nВиж тази чиния\n\n2\n00:00:02,000 --> 00:00:03,500\nколко струва\n\n", encoding="utf-8")
    (proj / "Asistent_subtitles" / "s.en.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nLook at this plate\n\n", encoding="utf-8")
    return str(proj / "A.prproj")


def test_srt_lines_and_the_words_of_a_graphic(tmp_path):
    lines = framefaces.srt_lines(_project(tmp_path))
    assert {(round(x["start"], 2), x["text"], x["en"]) for x in lines} >= {(1.0, "Виж тази чиния", False), (1.0, "Look at this plate", True)}
    assert framefaces.text_of(lines, 2.0, 3.5) == "колко струва"
    assert framefaces.text_of(lines, 2.0, 3.0) is None
    assert framefaces.text_of(lines, 1.0, 2.0) == "Виж тази чиния"
    assert framefaces.text_of(lines, 1.0, 2.0, en=True) == "Look at this plate"


def test_the_line_is_found_by_its_words_not_by_other_text():
    boxes = [{"text": "Цена 12,99", "y": 0.3, "h": 0.02}, {"text": "Виж тази чиния", "y": 0.74, "h": 0.03}]
    assert framefaces.find_line(boxes, "Виж тази чиния")["y"] == 0.74
    assert framefaces.find_line(boxes, "нещо съвсем друго") is None


def test_a_graphic_gets_its_measured_text_centre(monkeypatch, tmp_path):
    f = _frames(monkeypatch, tmp_path)
    monkeypatch.setattr(ocr, "read", lambda paths: [[{"text": "Виж тази чиния", "x": 0.3, "y": 0.74, "w": 0.4, "h": 0.03},
                                                     {"text": "Look at this plate", "x": 0.3, "y": 0.78, "w": 0.4, "h": 0.02}]])
    out = framefaces.measure([{"path": str(f), "t": 1.5}], _project(tmp_path), [{"id": 7, "start": 1.0, "end": 2.0}])
    assert out[0]["text"] == {"7": {"bg": 0.755, "en": 0.79}}
    assert not f.exists()
