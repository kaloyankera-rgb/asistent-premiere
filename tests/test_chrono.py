"""Recording order across cameras (chrono.py) and the recording time read by media.probe."""
import os
import subprocess

import pytest

from asistent import chrono, media

YEARS = 730 * 86400.0          # the GStroy FX30 clock is about two years behind the FX3


def group(*members):
    return {"anchor": members[0][0], "members": [{"clip": c, "offset": o} for c, o in members]}


def test_clock_difference_is_learnt_from_synced_pairs_and_applied_to_lone_clips():
    # camera A: clips at 0, 300, 900 s; camera B (clock 2 years behind) only at 300, synced 4 s after a2
    rec = [1000.0, 1300.0, 1900.0, 1300.0 + 4 - YEARS]
    out = chrono.chronology(rec, ["metadata"] * 4, ["A", "A", "A", "B"], [group((1, 0.0), (3, 4.0))])
    assert out["reference"] == "A"
    assert out["time"][:3] == [1000.0, 1300.0, 1900.0]
    assert out["time"][3] == pytest.approx(1304.0)
    assert out["note"] == [None] * 4
    b = next(c for c in out["cameras"] if c["camera"] == "B")
    assert b["linked"] and b["offset"] == pytest.approx(-YEARS) and b["pairs"] == 1


def test_lone_clip_of_the_other_camera_is_corrected_too():
    # B also has a lone clip 10 minutes after its synced one: it lands 10 minutes after on A's clock
    rec = [1000.0, 1300.0 - YEARS, 1900.0 - YEARS]
    out = chrono.chronology(rec, ["metadata"] * 3, ["A", "B", "B"], [group((0, 0.0), (1, 300.0))])
    assert out["reference"] == "B"                              # the camera with more timed clips
    assert out["time"][2] - out["time"][0] == pytest.approx(300.0 + 600.0)


def test_disagreeing_pairs_are_reported_not_hidden():
    rec = [1000.0, 1000.0, 2000.0, 2010.0]                       # second pair says the clocks differ by 10 s
    out = chrono.chronology(rec, ["metadata"] * 4, ["A", "B", "A", "B"],
                            [group((0, 0.0), (1, 0.0)), group((2, 0.0), (3, 0.0))])
    assert out["note"][1] and "разминават" in out["note"][1]


def test_unsynced_camera_keeps_its_clock_only_when_plausible():
    # C never synced: a clock inside the session is used (and reported), a clock years away is not
    rec = [1000.0, 1004.0, 1200.0, 1200.0 - YEARS]
    cams = ["A", "B", "C", "D"]
    out = chrono.chronology(rec, ["metadata"] * 4, cams, [group((0, 0.0), (1, 4.0))])
    assert out["time"][2] == 1200.0 and "не е проверен" in out["note"][2]
    assert out["time"][3] is None and "далеч" in out["note"][3]


def test_reference_is_a_camera_that_synced():
    # A has the most clips but never synced; B and C did: B or C must be the reference, so C is corrected
    rec = [10.0, 20.0, 30.0, 5000.0, 5000.0 + 3 - YEARS]
    out = chrono.chronology(rec, ["metadata"] * 5, ["A", "A", "A", "B", "C"], [group((3, 0.0), (4, 3.0))])
    assert out["reference"] in ("B", "C")
    assert abs(out["time"][3] - out["time"][4]) == pytest.approx(3.0)


def test_missing_time_is_none_with_a_reason():
    out = chrono.chronology([None, 5.0], [None, "file"], ["A", "A"], [])
    assert out["time"] == [None, 5.0]
    assert out["note"][0] == "няма време на запис" and "файла" in out["note"][1]


def test_probe_reads_creation_time(tmp_path):
    f = tmp_path / "c.mov"
    subprocess.run([media._tool("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
                    "-t", "0.5", "-metadata", "creation_time=2026-10-01T08:37:26Z", str(f)], check=True)
    info = media.probe(str(f))
    assert info.recorded_from == "metadata"
    assert info.recorded == pytest.approx(1790843846.0)


def test_probe_falls_back_to_file_time(tmp_path):
    f = tmp_path / "c.wav"
    subprocess.run([media._tool("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
                    "-t", "2", "-fflags", "+bitexact", str(f)], check=True)
    os.utime(f, (5000.0 + 1e9, 5000.0 + 1e9))
    info = media.probe(str(f))
    assert info.recorded_from == "file"
    assert info.recorded == pytest.approx(5000.0 + 1e9 - 2.0, abs=0.05)
