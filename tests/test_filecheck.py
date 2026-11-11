"""After-export check of the exported file (filecheck.py, TODO I14): synthetic exports with each problem, measured by FFmpeg."""
import math
import subprocess

import pytest

from asistent import filecheck as F


def make(path, video="testsrc2=size=270x480:rate=30:duration=4", audio="sine=f=440:sample_rate=48000:duration=4",
         vfilter=None, afilter=None):
    cmd = ["ffmpeg", "-v", "error", "-y"]
    if video:
        cmd += ["-f", "lavfi", "-i", video]
    if audio:
        cmd += ["-f", "lavfi", "-i", audio]
    if vfilter:
        cmd += ["-vf", vfilter]
    if afilter:
        cmd += ["-af", afilter]
    if video:
        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if audio:
        cmd += ["-c:a", "aac", "-ac", "2"]
    subprocess.run(cmd + [str(path)], check=True)
    return str(path)


def checks(r):
    return [x["text"] for x in r["lines"] if x["level"] == "check"]


def test_a_clean_export_is_fine(tmp_path):
    r = F.run(make(tmp_path / "ok.mp4", afilter="volume=0.3"), {"name": "Reel", "width": 270, "height": 480, "fps": 30,
                                                                "duration": 4.0})
    assert r["status"] == "fine", checks(r)
    text = " ".join(x["text"] for x in r["lines"])
    assert "No black bars" in text and "LUFS" in text and "information only" in text


def test_letterbox_bars_through_the_whole_video(tmp_path):
    r = F.run(make(tmp_path / "bars.mp4", vfilter="scale=270:152,pad=270:480:0:164:black,setsar=1"))
    assert any("Black bars top and bottom: the whole video" in c for c in checks(r))


def test_pillarbox_bars_in_part_of_the_video(tmp_path):
    r = F.run(make(tmp_path / "pillar.mp4", video="testsrc2=size=480x270:rate=30:duration=4",
                   vfilter="split[a][b];[b]crop=200:270,pad=480:270:140:0:black[p];[a][p]overlay=enable='between(t,1,2.5)'"))
    bars = [c for c in checks(r) if c.startswith("Black bars left and right")]
    assert len(bars) == 1 and "0:01.0" in bars[0]


def test_black_frames_in_the_middle_and_frozen_picture(tmp_path):
    r = F.run(make(tmp_path / "bf.mp4", vfilter="drawbox=c=black:t=fill:enable='between(t,1,1.2)',"
                                               "tpad=stop_mode=clone:stop_duration=2", audio="sine=duration=6"))
    c = checks(r)
    assert any(x.startswith("Black picture in the middle: 0:01.0") for x in c), c
    assert any(x.startswith("The picture stands still") for x in c), c


def test_sound_only_on_the_left_and_peaks(tmp_path):
    r = F.run(make(tmp_path / "left.mp4", afilter="pan=stereo|c0=c0|c1=0*c0"))
    assert "Sound only on the left channel: the right is silent." in checks(r)
    loud = F.run(make(tmp_path / "loud.mp4", afilter="volume=20"))
    c = checks(loud)
    assert any(x.startswith("True peak") for x in c) and any("full scale" in x for x in c)


def test_no_sound_silent_sound_and_silence_at_the_start(tmp_path):
    assert "There is no sound in the file." in checks(F.run(make(tmp_path / "mute.mp4", audio=None)))
    assert "The sound is silent." in checks(F.run(make(tmp_path / "silent.mp4", afilter="volume=0")))
    late = F.run(make(tmp_path / "late.mp4", afilter="adelay=1000|1000"))
    assert any(x.startswith("Silence for the first 1.0") for x in checks(late)), checks(late)


def test_the_sequence_comparison(tmp_path):
    path = make(tmp_path / "s.mp4")
    c = checks(F.run(path, {"name": "Wide", "width": 1920, "height": 1080, "fps": 25, "duration": 10.0}))
    assert any("a different shape" in x for x in c) and any("25 fps" in x for x in c) and any("long" in x for x in c)
    # an In / Out export matching the range is fine
    c = checks(F.run(path, {"name": "Reel", "width": 540, "height": 960, "fps": 30, "duration": 10.0, "range": 4.0}))
    assert not any("long" in x for x in c)


def test_an_unreadable_file_is_reported_not_raised(tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video")
    r = F.run(str(bad))
    assert r["status"] == "look" and r["lines"][0]["level"] == "check"


def test_parse_reads_ffmpegs_summary():
    text = """[Parsed_astats_0 @ 0x1] Channel: 1
[Parsed_astats_0 @ 0x1] Peak level dB: -3.0
[Parsed_astats_0 @ 0x1] RMS level dB: -20.0
[Parsed_astats_0 @ 0x1] Channel: 2
[Parsed_astats_0 @ 0x1] Peak level dB: -inf
[Parsed_astats_0 @ 0x1] RMS level dB: -inf
[Parsed_astats_0 @ 0x1] Overall
[Parsed_astats_0 @ 0x1] RMS level dB: -23.0
[Parsed_ebur128_1 @ 0x1] Summary:
  Integrated loudness:
    I:         -15.5 LUFS
  Loudness range:
    LRA:         4.0 LU
  True peak:
    Peak:       -0.4 dBFS
[silencedetect @ 0x1] silence_start: -0.01
[silencedetect @ 0x1] silence_end: 0.7 | silence_duration: 0.7
[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 3.0
"""
    m = F.parse(text, 5.0, None)
    assert m["loudness"] == -15.5 and m["true_peak"] == -0.4 and m["lra"] == 4.0
    assert m["channels"][0] == {"peak": -3.0, "rms": -20.0} and m["channels"][1]["rms"] == -math.inf
    assert m["overall_rms"] == -23.0 and m["silence"] == [[0.0, 0.7]] and m["freeze"] == [[3.0, 5.0]]


def test_bars_name_the_sides_that_really_show_one():
    assert F.bar_sides("top/bottom") == "Black bars top and bottom"
    assert F.bar_sides("left/right") == "Black bars left and right"
    assert F.bar_sides("all") == "Black bars on all sides"
    assert F.bar_sides("right") == "Black bar on the right"
    assert F.bar_sides("bottom/right") == "Black bars at the bottom and on the right"


def test_a_shifted_picture_reports_only_its_open_sides(tmp_path):
    # the picture moved down and to the left: bars at the top and on the right only (a moved Anchor Point or a tracked clip)
    r = F.run(make(tmp_path / "shift.mp4", vfilter="crop=230:420:0:0,pad=270:480:0:60:black,setsar=1"))
    bars = [c for c in checks(r) if c.startswith("Black bar")]
    assert bars and all(c.startswith("Black bars at the top and on the right") for c in bars), bars
