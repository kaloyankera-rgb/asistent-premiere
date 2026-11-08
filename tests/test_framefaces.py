"""Move off faces, engine side (framefaces.py): only the engine's own frames are read, and they are deleted after."""
import os

import numpy as np

from asistent import color, config, faces, framefaces


def test_files_outside_the_frames_folder_are_refused(tmp_path):
    p = tmp_path / "x.png"
    p.write_bytes(b"x")
    assert framefaces.measure([str(p), 5]) == [{"error": "not a frame Asistent exported"}] * 2
    assert p.exists()


def test_a_frame_is_measured_as_fractions_and_deleted(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    (tmp_path / "frames").mkdir()
    f = tmp_path / "frames" / "a.png"
    f.write_bytes(b"png")
    monkeypatch.setattr(color, "read_image", lambda p: np.zeros((200, 100, 3)))
    monkeypatch.setattr(faces, "detect", lambda img: [(25, 50, 50, 40, 0.9)])
    assert framefaces.measure([str(f)]) == [{"faces": [{"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.2, "score": 0.9}]}]
    assert not f.exists()
