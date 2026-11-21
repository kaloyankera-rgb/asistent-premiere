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


# --- lane placement additions (2026-11-22): boxes, other text, rows, two-line blocks; the old keys stay as they were ---

def _two_line_project(tmp_path, bottom='<font color="#00FF00">втори ред</font>'):
    proj = tmp_path / "proj"
    (proj / "Asistent_subtitles").mkdir(parents=True)
    (proj / "Asistent_subtitles" / "s.srt").write_text(f"1\n00:00:01,000 --> 00:00:02,000\nпърви ред\n{bottom}\n\n", encoding="utf-8")
    return str(proj / "A.prproj")


def test_srt_rows_have_the_font_tags_stripped(tmp_path):
    lines = framefaces.srt_lines(_two_line_project(tmp_path))
    assert lines[0]["rows"] == ["първи ред", "втори ред"]
    assert lines[0]["text"] == "първи ред втори ред"
    assert framefaces.rows_of(lines, 1.0, 2.0) == ["първи ред", "втори ред"]
    assert framefaces.rows_of(lines, 5.0, 6.0) is None


def test_two_adjacent_boxes_are_joined_into_one_block():
    boxes = [{"text": "първи ред", "x": 0.3, "y": 0.50, "w": 0.4, "h": 0.03, "confidence": 0.9},
             {"text": "втори ред", "x": 0.32, "y": 0.54, "w": 0.36, "h": 0.03, "confidence": 0.8},
             {"text": "Цена 12,99", "x": 0.1, "y": 0.2, "w": 0.2, "h": 0.03, "confidence": 0.9}]
    b = framefaces.find_line(boxes, "първи ред втори ред")
    assert round(b["y"], 3) == 0.5 and round(b["h"], 3) == 0.07 and b["confidence"] == 0.8 and len(b["parts"]) == 2
    assert framefaces.find_line(boxes, "първи ред")["y"] == 0.5 and "parts" not in framefaces.find_line(boxes, "първи ред")
    far = [boxes[0], {**boxes[1], "y": 0.80}]                                  # not adjacent: no block
    assert "parts" not in (framefaces.find_line(far, "първи ред втори ред") or {})


def _ocr(monkeypatch, boxes):
    monkeypatch.setattr(ocr, "read", lambda paths: [boxes])


def test_boxes_other_text_and_lines_of_a_two_line_chunk(monkeypatch, tmp_path):
    f = _frames(monkeypatch, tmp_path)
    _ocr(monkeypatch, [{"text": "първи ред", "x": 0.3, "y": 0.50, "w": 0.4, "h": 0.03, "confidence": 0.9},
                       {"text": "втори ред", "x": 0.32, "y": 0.54, "w": 0.36, "h": 0.03, "confidence": 0.8},
                       {"text": "ЦЕНА 12,99", "x": 0.1, "y": 0.2, "w": 0.2, "h": 0.03, "confidence": 0.95},
                       {"text": "първи", "x": 0.3, "y": 0.50, "w": 0.1, "h": 0.03, "confidence": 0.4}])     # a piece of its own words
    out = framefaces.measure([{"path": str(f), "t": 1.5}], _two_line_project(tmp_path), [{"id": 3, "start": 1.0, "end": 2.0}])
    r = out[0]
    assert r["faces"] and r["text"] == {"3": {"bg": 0.535}}                      # the block's centre (0.50..0.57)
    assert r["boxes"] == {"3": {"bg": {"top": 0.5, "bottom": 0.57, "x": 0.3, "w": 0.4}}}
    assert r["lines"] == {"3": {"bg": ["първи ред", "втори ред"]}}
    assert [o["text"] for o in r["other"]] == ["ЦЕНА 12,99"] and r["other"][0]["confidence"] == 0.95
    assert not f.exists()


def test_other_text_is_left_empty_when_the_line_itself_was_not_found(monkeypatch, tmp_path):
    f = _frames(monkeypatch, tmp_path)
    _ocr(monkeypatch, [{"text": "ЦЕНА 12,99", "x": 0.1, "y": 0.2, "w": 0.2, "h": 0.03, "confidence": 0.95}])
    r = framefaces.measure([{"path": str(f), "t": 1.5}], _two_line_project(tmp_path), [{"id": 3, "start": 1.0, "end": 2.0}])[0]
    assert r["other"] == [] and r["boxes"] == {} and r["text"] == {}


def test_without_graphics_the_frame_keeps_exactly_its_old_keys(monkeypatch, tmp_path):
    f = _frames(monkeypatch, tmp_path)
    assert set(framefaces.measure([{"path": str(f), "t": 1.5}])[0]) == {"faces", "text"}


def test_run_info_reads_the_newest_run_json(tmp_path):
    proj = _two_line_project(tmp_path)
    folder = tmp_path / "proj" / "Asistent_subtitles"
    assert framefaces.run_info(proj) == {"preset": "", "media": []}
    (folder / "a.json").write_text('{"preset": "gstroy", "items": [{"path": "/x/y.mp4"}]}', encoding="utf-8")
    assert framefaces.run_info(proj) == {"preset": "gstroy", "media": ["/x/y.mp4"]}
    assert framefaces.run_info("") == {"preset": "", "media": []}


# --- the audit fixes (2026-11-22): OCR in batches, frames deleted on every path, rows of every graphic ---

def test_ocr_batches_a_timed_out_batch_gives_no_text_but_keeps_the_others(monkeypatch):
    import subprocess
    monkeypatch.setattr(ocr, "_ensure", lambda: "/bin/fake")
    monkeypatch.setattr(ocr, "BATCH", 2)
    calls = []

    def run(cmd, **kw):
        calls.append(cmd[1:])
        if cmd[1] == "c":
            raise subprocess.TimeoutExpired(cmd, kw["timeout"])
        return type("R", (), {"stdout": "".join('[{"text": "%s"}]\n' % p for p in cmd[1:])})()

    monkeypatch.setattr(subprocess, "run", run)
    out = ocr.read(["a", "b", "c", "d", "e"])
    assert calls == [["a", "b"], ["c", "d"], ["e"]]
    assert [[b["text"] for b in o] for o in out] == [["a"], ["b"], [], [], ["e"]]


def test_frames_are_deleted_when_the_text_recognition_raises(monkeypatch, tmp_path):
    f = _frames(monkeypatch, tmp_path)

    def boom(paths):
        raise RuntimeError("vision died")

    monkeypatch.setattr(ocr, "read", boom)
    out = framefaces.measure([{"path": str(f), "t": 1.5}], _two_line_project(tmp_path), [{"id": 3, "start": 1.0, "end": 2.0}])
    assert out[0]["faces"] and out[0]["other"] == [] and out[0]["text"] == {}     # faces only: no failed press
    assert not f.exists()


def test_frames_are_deleted_when_the_face_detection_raises_outside_measure(monkeypatch, tmp_path):
    f = _frames(monkeypatch, tmp_path)
    monkeypatch.setattr(faces, "detect", lambda img: (_ for _ in ()).throw(RuntimeError("no")))
    assert "error" in framefaces.measure([str(f)])[0]
    assert not f.exists()
    g = tmp_path / "frames" / "b.png"
    g.write_bytes(b"png")
    framefaces.discard([{"path": str(g)}, 5, {"path": str(tmp_path / "outside.png")}])
    assert not g.exists()


def test_rows_for_every_graphic_sent_without_any_frame(tmp_path):
    rows = framefaces.rows_for(_two_line_project(tmp_path), [{"id": 3, "start": 1.0, "end": 2.0}, {"id": 4, "start": 8.0, "end": 9.0}, {"id": 5}])
    assert rows == {"3": {"bg": ["първи ред", "втори ред"]}}
    assert framefaces.rows_for("", None) == {}
