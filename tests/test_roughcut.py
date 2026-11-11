"""Phase 8 M1-M2: the speech map, pause cutting, the decision list, the XML and the whole job on synthetic speech."""
import json
import os
import re

import numpy as np
import pytest

import synth
from asistent import asr, config, edl, pauses, roughcut_job, speechmap, xmeml

SR = 16000
FPS = 30000 / 1001


def signal_with_pauses():
    """0-3 s speech, 3-6 s pause, 6-9 s speech, 9-9.65 s short pause, 9.65-12 s speech, 12-20 s nothing."""
    x = synth.talker(12.0, 3, sr=SR)
    y = np.zeros(20 * SR, np.float32)
    y[:len(x)] = x
    y[3 * SR:6 * SR] = 0
    y[9 * SR:int(9.65 * SR)] = 0
    y += (np.random.default_rng(1).standard_normal(len(y)) * 0.0005).astype(np.float32)
    return y


WORDS = [{"word": "един", "start": 0.3, "end": 2.9}, {"word": "два.", "start": 6.1, "end": 8.9}, {"word": "три", "start": 9.7, "end": 11.9}]


@pytest.fixture(scope="module")
def smap():
    return speechmap.build(signal_with_pauses(), WORDS, 0.0)


def test_speech_map_labels_words_and_silence(smap):
    lab = smap["labels"]
    assert (lab[50:250] == speechmap.WORD).all()                       # inside a word
    assert (lab[400:560] == speechmap.SILENT).all()                    # the middle of the 3 s pause
    assert (lab[1400:1900] == speechmap.SILENT).all()                  # after the last word


def test_safe_shortens_only_long_pauses_and_keeps_the_budget(smap):
    plan = pauses.plan(smap, WORDS, FPS, "safe", "normal")
    cuts = pauses.guard(plan["cuts"], smap)
    inside = [c for c in cuts if 3.0 <= c[0] and c[1] <= 6.0]
    assert len(inside) == 1
    kept = (inside[0][0] - 2.9) + (6.1 - inside[0][1])                 # what stays of the pause between the words
    assert 0.2 <= kept <= 0.5                                          # the budget (0.22 inside a sentence) plus the word pads
    assert not any(9.0 <= a < 9.6 for a, _ in cuts)                    # the 0.5 s pause is left alone in Safe


def test_smart_also_shortens_a_short_pause(smap):
    cuts = pauses.guard(pauses.plan(smap, WORDS, FPS, "smart", "normal")["cuts"], smap)
    assert any(9.0 <= a and b <= 9.7 for a, b in cuts)


def test_the_trailing_silence_keeps_a_tail(smap):
    cuts = pauses.guard(pauses.plan(smap, WORDS, FPS, "safe", "normal")["cuts"], smap)
    tail = [c for c in cuts if c[0] > 12.0]
    assert len(tail) == 1 and 12.7 <= tail[0][0] <= 13.1 and tail[0][1] > 19.9   # the picture breathes 0.8 s after the last word


def test_tempo_changes_what_is_kept(smap):
    def kept(t):
        c = [x for x in pauses.guard(pauses.plan(smap, WORDS, FPS, "safe", t)["cuts"], smap) if 3.0 <= x[0] <= 6.0][0]
        return (c[0] - 2.9) + (6.1 - c[1])
    assert kept("calm") > kept("normal") > kept("tight")


def test_cuts_sit_on_frames_and_never_grow_past_the_silence(smap):
    for a, b in pauses.guard(pauses.plan(smap, WORDS, FPS, "smart", "tight")["cuts"], smap):
        assert abs(a * FPS - round(a * FPS)) < 1e-6 and abs(b * FPS - round(b * FPS)) < 1e-6
        i0, i1 = int(np.ceil(a / 0.01)), int(np.floor(b / 0.01))
        assert (smap["labels"][i0:i1] < speechmap.VOICED).all()        # no word or voiced frame inside a cut


def test_guard_splits_a_cut_around_voiced_frames(smap):
    sm = dict(smap, labels=smap["labels"].copy())
    sm["labels"][450:460] = speechmap.VOICED                           # a laugh in the middle of the pause
    out = pauses.guard([(3.5, 5.5)], sm)
    assert len(out) == 2 and out[0][1] <= 4.5 + 1e-9 and out[1][0] >= 4.6 - 1e-9


def test_speech_is_never_cut_even_when_whisper_missed_the_word():
    y = signal_with_pauses()
    sm = speechmap.build(y, [WORDS[0], WORDS[2]], 0.0)                 # the middle sentence was not recognised
    cuts = pauses.guard(pauses.plan(sm, [WORDS[0], WORDS[2]], FPS, "smart", "tight")["cuts"], sm)
    speech = sm["thr"]["speech"]
    for a, b in cuts:                                                  # the energy and Silero keep the unrecognised speech
        frames = sm["env"][int(np.ceil(a / 0.01)):int(np.floor(b / 0.01))]
        assert len(frames) and np.percentile(frames, 95) < speech


# ---------------------------------------------------------------- decision list

def test_kept_ranges_are_the_complement_of_the_cuts():
    assert edl.kept_ranges(0, 20, [(3, 5), (9, 10)]) == [(0, 3), (5, 9), (10, 20)]
    assert edl.kept_ranges(0, 20, [(0, 2)]) == [(2, 20)]
    assert edl.kept_ranges(2, 20, [(0, 3)]) == [(3, 20)]               # a cut starting before the first item


def test_every_item_gets_the_same_cuts_and_the_camera_offset_survives():
    cam_a = {"kind": "video", "track": 0, "path": "a.mp4", "start": 0.0, "end": 30.0, "inPt": 10.0}
    cam_b = {"kind": "video", "track": 1, "path": "b.mp4", "start": 4.0, "end": 30.0, "inPt": 2.0}   # starts later, own In point
    kept = edl.kept_ranges(0, 30, [(6.0, 9.0), (12.0, 20.0)])
    ps = edl.pieces([cam_a, cam_b], kept, FPS)
    for p in ps:
        assert p["end"] > p["start"] and p["src_out"] - p["src_in"] == p["end"] - p["start"]
    checked = 0
    for pa in (p for p in ps if p["item"] == 0):
        for pb in (p for p in ps if p["item"] == 1 and p["start"] < pa["end"] and pa["start"] < p["end"]):
            f = max(pa["start"], pb["start"])                          # one output frame both cameras show
            t_a = (pa["src_in"] + (f - pa["start"])) / FPS - 10.0 + 0.0     # sequence second seen on A (A starts at 0)
            t_b = (pb["src_in"] + (f - pb["start"])) / FPS - 2.0 + 4.0      # sequence second seen on B (B starts at 4)
            assert abs(t_a - t_b) < 2 / FPS
            checked += 1
    assert checked >= 3
    assert max(p["end"] for p in ps if p["item"] == 0) == max(p["end"] for p in ps if p["item"] == 1)


def test_output_frame_maps_sequence_time():
    kept = [(0.0, 3.0), (5.0, 9.0)]
    assert edl.output_frame(kept, FPS, 1.0) == round(1.0 * FPS)
    assert edl.output_frame(kept, FPS, 6.0) == round(3.0 * FPS) + round(6.0 * FPS) - round(5.0 * FPS)
    assert edl.output_frame(kept, FPS, 4.0) == round(3.0 * FPS)        # cut out: the next kept range


# ---------------------------------------------------------------- XML

def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


class FakeInfo:
    def __init__(self, video=True, channels=2, rotation=0):
        self.duration, self.has_video, self.width, self.height, self.rotation = 100.0, video, 3840, 2160, rotation
        self.audio = [type("A", (), {"channels": channels, "sample_rate": 48000})()] if channels else []


def test_xml_has_every_piece_linked_and_the_markers():
    items = [{"kind": "video", "track": 0, "path": "/m/a.mp4", "start": 0.0, "end": 10.0, "inPt": 0.0, "name": "a"},
             {"kind": "audio", "track": 0, "path": "/m/a.mp4", "start": 0.0, "end": 10.0, "inPt": 0.0, "name": "a"},
             {"kind": "video", "track": 1, "path": "/m/b.mp4", "start": 2.0, "end": 10.0, "inPt": 0.0, "name": "b"},
             {"kind": "audio", "track": 1, "path": "/m/b.mp4", "start": 2.0, "end": 10.0, "inPt": 0.0, "name": "b"}]
    kept = edl.kept_ranges(0, 10, [(4.0, 6.0)])
    ps = edl.pieces(items, kept, FPS)
    import tempfile
    path = os.path.join(tempfile.mkdtemp(), "x.xml")
    check = xmeml.write(path, "ГРУБ – тест", FPS, 2160, 3840, ps, [{"frame": 30, "name": "Преглед", "comment": "тест"}],
                        probe=lambda s: FakeInfo())
    xml = read(path)
    assert "<name>ГРУБ – тест</name>" in xml and "<marker>" in xml
    assert check["video"] == {1: 2, 2: 2} and check["audio"] == {1: 2, 2: 2}
    assert check["frames"] == edl.total_frames(kept, FPS)
    assert xml.count("<clipitem") == 2 * 2 + 4 * 2                      # video pieces + two exploded channels per audio piece
    assert xml.count('<file id="file-1"><name>a.mp4') == 1              # a file is defined once
    ids = re.findall(r'<clipitem(?: premiereChannelType="stereo")? id="([^"]+)"', xml)
    assert len(ids) == len(set(ids))
    refs = set(re.findall(r"<linkclipref>([^<]+)</linkclipref>", xml))
    assert refs <= set(ids) and "v1-1" in refs and "a1-1" in refs and "a2-1" in refs


def test_a_file_stored_sideways_with_a_rotation_flag_is_described_as_it_displays(tmp_path):
    items = [{"kind": "video", "track": 0, "path": "/m/v.mp4", "start": 0.0, "end": 5.0, "inPt": 0.0, "name": "v"}]
    ps = edl.pieces(items, [(0.0, 5.0)], FPS)
    for rot, size in ((90, "<width>2160</width><height>3840</height>"), (270, "<width>2160</width><height>3840</height>"), (0, "<width>3840</width><height>2160</height>")):
        path = str(tmp_path / f"r{rot}.xml")
        xmeml.write(path, "r", FPS, 2160, 3840, ps, probe=lambda s, rot=rot: FakeInfo(channels=0, rotation=rot))
        x = read(path)
        file_part = x[x.index("<file id"):x.index("</file>")]
        assert size in file_part


def test_the_probe_reads_the_rotation_flag(tmp_path):
    from asistent import media
    wav = synth.write_wav(tmp_path / "a.wav", [np.zeros(16000, np.float32)], sr=16000)
    mp4 = synth.write_mp4(tmp_path / "v.mp4", wav)
    assert media.probe(mp4).rotation == 0


def test_xml_with_a_mono_file_reads_channel_one_on_both_sides():
    items = [{"kind": "audio", "track": 0, "path": "/m/m.wav", "start": 0.0, "end": 5.0, "inPt": 0.0, "name": "m"}]
    ps = edl.pieces(items, [(0.0, 5.0)], FPS)
    import tempfile
    path = os.path.join(tempfile.mkdtemp(), "x.xml")
    xmeml.write(path, "m", FPS, 1920, 1080, ps, probe=lambda s: FakeInfo(video=False, channels=1))
    xml = read(path)
    assert xml.count("<trackindex>1</trackindex></sourcetrack>") == 2


# ---------------------------------------------------------------- the whole job

@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path / "app"))
    monkeypatch.setattr(asr, "backend_installed", lambda: False)        # no speech model: the pauses come from energy + Silero
    return tmp_path


def test_job_on_two_synthetic_cameras(home):
    y = signal_with_pauses()
    wav1 = synth.write_wav(home / "c1.wav", [np.repeat(y, 3)], sr=48000)                 # 16 kHz signal repeated to 48 kHz
    wav2 = synth.write_wav(home / "c2.wav", [np.repeat(y * 0.4, 3)], sr=48000)
    mp1, mp2 = synth.write_mp4(home / "cam1.mp4", wav1), synth.write_mp4(home / "cam2.mp4", wav2)
    lay = []
    for tr, p in enumerate((mp1, mp2)):
        for kind in ("video", "audio"):
            lay.append({"kind": kind, "track": tr, "path": p, "start": 0.0, "end": 20.0, "inPt": 0.0, "name": os.path.basename(p)})
    body = {"items": [{"path": mp1, "start": 0.0, "end": 20.0, "at": 0.0, "name": "cam1", "track": 0},
                      {"path": mp2, "start": 0.0, "end": 20.0, "at": 0.0, "name": "cam2", "track": 1}],
            "layout": lay, "out_dir": str(home), "name": "тест", "fps": 30, "width": 1080, "height": 1920, "mode": "safe", "tempo": "normal"}
    log = []
    res = roughcut_job.run(body, lambda f, m: log.append(m), lambda: False)
    assert res["counts"]["cuts"] >= 2 and res["after_s"] < res["before_s"] - 5
    assert res["speech"]["asr"] is False and "No speech model" in res["speech"]["note"]
    assert os.path.isfile(res["xml"]) and os.path.isfile(res["json"])
    assert res["name"].endswith(" v1") and "(safe)" in res["name"]
    xml = read(res["xml"])
    assert xml.count("<clipitem") > 0 and "<name>ROUGH – тест (safe) v1</name>" in xml
    # the check the panel makes against Premiere's sequence
    assert res["check"]["video"] == {"1": res["counts"]["kept_ranges"], "2": res["counts"]["kept_ranges"]} or \
        res["check"]["video"] == {1: res["counts"]["kept_ranges"], 2: res["counts"]["kept_ranges"]}
    # a second run is a new version, the first files stay
    res2 = roughcut_job.run(body, lambda f, m: None, lambda: False)
    assert res2["name"].endswith(" v2") and os.path.isfile(res["xml"])


def test_job_cuts_a_repeated_take_and_marks_it(home, monkeypatch):
    y = signal_with_pauses()
    wav = synth.write_wav(home / "c1.wav", [np.repeat(y, 3)], sr=48000)
    mp = synth.write_mp4(home / "cam1.mp4", wav)
    words = [{"word": w, "start": 0.2 + 0.4 * k, "end": 0.5 + 0.4 * k, "p": 0.9} for k, w in enumerate("Днес ще ви покажа три неща.".split())]
    words += [{"word": w, "start": 6.2 + 0.4 * k, "end": 6.5 + 0.4 * k, "p": 0.9} for k, w in enumerate("Днес ще ви покажа три неща.".split())]
    monkeypatch.setattr(roughcut_job, "_words", lambda *a, **k: (words, {"asr": True, "cached": True, "windows": 1}))
    lay = [{"kind": k, "track": 0, "path": mp, "start": 0.0, "end": 20.0, "inPt": 0.0, "name": "cam1"} for k in ("video", "audio")]
    body = {"items": [{"path": mp, "start": 0.0, "end": 20.0, "at": 0.0, "name": "cam1", "track": 0}], "layout": lay, "out_dir": str(home),
            "name": "тест", "fps": 30, "width": 1080, "height": 1920, "mode": "safe", "tempo": "normal", "markers": True}
    res = roughcut_job.run(body, lambda f, m: None, lambda: False)
    assert res["counts"]["takes"] == 1 and len(res["takes"]) == 1
    g = res["takes"][0]
    assert g["kind"] == "exact" and g["recommended"] == 1 and g["applied"] and g["cut_s"] > 4
    assert "Review" in read(res["xml"]) and "kept #2" in read(res["xml"])
    first, winner = g["takes"]
    assert any(c["start"] <= first["start"] and first["end"] <= c["end"] for c in res["cuts"])           # the first take is gone
    assert not any(c["start"] < winner["end"] and c["end"] > winner["start"] for c in res["cuts"])        # the winner is whole
    assert res["counts"]["takes_cut"] == 1 and res["after_s"] < 20 - 6


def test_job_refuses_what_it_cannot_do(home):
    with pytest.raises(ValueError, match="Select"):
        roughcut_job.validate({"items": []})
    with pytest.raises(ValueError, match="Invalid mode"):
        roughcut_job.validate({"items": [{"path": __file__, "start": 0, "end": 1, "at": 0}],
                               "layout": [{"kind": "video", "path": __file__, "start": 0, "end": 1}], "out_dir": str(home), "mode": "x"})


# ---------------------------------------------------------------- what the user's 2026-11-03 test showed

def test_time_with_no_selected_sound_is_taken_out_whole(smap):
    # the selection's sound covers only 6-12 s (like cam1's microphone while cam2's picture runs from 0)
    sound, present = [(6.0, 12.0)], [(0.0, 20.0)]
    plan = pauses.plan(smap, WORDS, FPS, "safe", "normal", sound, present)
    assert plan["no_sound_s"] > 6.0
    assert any(a <= 0.001 and b >= 5.5 for a, b in plan["cuts"])       # the lead-in: gone, not a kept pause


def test_empty_timeline_between_two_recordings_is_closed_not_kept_as_a_pause(smap):
    # items present 0-8 and 11-20, nothing on the timeline 8-11; sound everywhere there is an item
    sound = present = [(0.0, 8.0), (11.0, 20.0)]
    plan = pauses.plan(smap, WORDS, FPS, "safe", "normal", sound, present)
    assert any(abs(a - 8.0) < 1 / FPS and abs(b - 11.0) < 1 / FPS for a, b in plan["cuts"])
    assert plan["empty_s"] == 3.0


def test_no_slivers_of_breath_between_cuts():
    labels = np.zeros(1000, dtype=np.uint8)
    labels[300:310] = speechmap.LOW                                    # a breath inside a long pause
    labels[0:100] = speechmap.WORD
    labels[900:] = speechmap.WORD
    sm = {"labels": labels, "origin": 0.0, "env": np.zeros(1000), "thr": {}, "vad": True}
    cuts = pauses.plan(sm, [], FPS, "safe", "tight")["cuts"]
    assert len(cuts) == 1                                              # one cut, the breath is not an island between two


def test_a_split_clip_reads_one_channel_on_both_sides_and_carries_its_level():
    items = [{"kind": "audio", "track": 0, "path": "/m/a.mp4", "start": 0.0, "end": 5.0, "inPt": 0.0, "name": "a L", "channel": 1, "gain_db": -3.0},
             {"kind": "audio", "track": 1, "path": "/m/a.mp4", "start": 0.0, "end": 5.0, "inPt": 0.0, "name": "a R", "channel": 2, "gain_db": None}]
    import tempfile
    path = os.path.join(tempfile.mkdtemp(), "x.xml")
    xmeml.write(path, "s", FPS, 1080, 1920, edl.pieces(items, [(0.0, 5.0)], FPS), probe=lambda s: FakeInfo(video=False, channels=2))
    xml = read(path)
    tracks = xml.split("<track currentExplodedTrackIndex")[1:]
    assert len(tracks) == 4
    src = [re.search(r"<sourcetrack><mediatype>audio</mediatype><trackindex>(\d)</trackindex>", t).group(1) for t in tracks]
    assert src == ["1", "1", "2", "2"]                                  # L/L upper, R/R lower
    assert xml.count("Audio Levels") == 2                               # only the clip that had a level
    assert "<value>0.70795</value>" in xml                              # -3 dB linear


def test_a_words_padding_does_not_leave_a_gap_before_the_next_clip():
    # two clips on the timeline, 6-12 s and 14-20 s, with 2 s of nothing between; the second starts speaking at once
    y = np.zeros(20 * SR, np.float32)
    x = synth.talker(12.0, 5, sr=SR)
    y[6 * SR:12 * SR] = x[:6 * SR]
    y[14 * SR:20 * SR] = x[6 * SR:12 * SR]
    words = [{"word": "а", "start": 6.5, "end": 11.0}, {"word": "б", "start": 14.0, "end": 19.0}]   # starts exactly at the clip
    sound = present = [(6.0, 12.0), (14.0, 20.0)]
    sm = speechmap.build(y, words, 0.0, sound=sound)
    plan = pauses.plan(sm, words, FPS, "safe", "normal", sound, present)
    cuts = pauses.snap(plan["cuts"], FPS)
    joined = [c for c in cuts if c[0] < 12.5 and c[1] > 13.5][0]
    # the empty time goes whole up to the clip edge: not one frame short (the guard used to stop it at the voiced first frame)
    assert abs(joined[1] * FPS - round(14.0 * FPS)) < 1e-6 and joined[0] <= 12.9


def test_the_end_of_a_clip_is_one_cut_after_a_breathing_tail_not_a_run_of_small_ones():
    labels = np.zeros(2000, dtype=np.uint8)
    labels[:200] = speechmap.WORD
    for k in range(300, 1800, 120):                                   # islands of breath in the silence after the speech
        labels[k:k + 15] = speechmap.LOW
    labels[1900:] = speechmap.WORD                                    # the next clip's speech
    labels[1800:1850] = speechmap.LOW
    sm = {"labels": labels, "origin": 0.0, "env": np.zeros(2000), "thr": {}, "vad": True}
    sound = present = [(0.0, 18.0), (18.5, 20.0)]                      # clip A ends at 18 s, clip B starts at 18.5 s
    cuts = pauses.plan(sm, [], FPS, "smart", "normal", sound, present)["cuts"]
    assert len(cuts) == 1                                             # the tail after the speech and the gap, in one piece
    assert 2.7 <= cuts[0][0] <= 3.1                                   # 0.8 s of breathing after the last word (2.0 s)
    assert 18.5 <= cuts[0][1] <= 18.9                                 # through the gap to the next clip and its lead, no leftover


def test_a_few_frames_of_the_second_camera_at_the_end_of_its_clip_are_not_kept():
    cam1 = {"kind": "video", "track": 1, "path": "b.mp4", "start": 0.0, "end": 10.0, "inPt": 0.0}
    cam2 = {"kind": "video", "track": 0, "path": "a.mp4", "start": 0.0, "end": 20.0, "inPt": 0.0}
    kept = [(0.0, 4.0), (9.8, 15.0)]                                  # the second range holds only 0.2 s of cam1
    ps = edl.pieces([cam1, cam2], kept, FPS)
    out, dropped = edl.drop_flashes(ps)
    assert dropped == 1 and not [p for p in out if p["item"] == 0 and p["start"] >= round(4.0 * FPS)]
    assert len([p for p in out if p["item"] == 1]) == 2               # the long camera keeps both pieces
    # a short piece that nothing longer covers is a shot of its own: kept
    only = edl.pieces([cam1], [(0.0, 4.0), (9.8, 10.0)], FPS)
    assert edl.drop_flashes(only)[1] == 0


def test_the_gap_between_two_clips_closes_exactly_even_when_the_next_clip_starts_with_loud_speech():
    y = np.zeros(10 * SR, np.float32)
    y[:3 * SR] = 0.3 * np.sin(2 * np.pi * 220 * np.arange(3 * SR) / SR)          # clip A: 0-3 s of a loud tone
    start = round(6.0 * FPS) / FPS                                               # clip B starts on a frame, mid-10 ms-frame
    i0 = int(round(start * SR))
    y[i0:] = 0.3 * np.sin(2 * np.pi * 220 * np.arange(len(y) - i0) / SR)
    sound = present = [(0.0, 3.0), (start, 10.0)]
    sm = speechmap.build(y, [{"word": "а", "start": 0.2, "end": 2.8}, {"word": "б", "start": start, "end": 9.5}], 0.0, sound=sound)
    cuts = pauses.snap(pauses.plan(sm, [], FPS, "safe", "normal", sound, present)["cuts"], FPS)
    gap = [c for c in cuts if c[0] <= 3.9 and c[1] >= start - 1e-6]
    assert gap and abs(gap[0][1] * FPS - round(start * FPS)) < 1e-6


def test_no_jump_cut_leaves_a_piece_shorter_than_a_shot():
    spans = [(10.0, 12.0), (12.7, 14.0), (30.0, 33.0)]                   # 0.7 s of speech between the first two cuts
    out = pauses._no_jump_cuts(spans, [])
    assert (12.7, 14.0) not in out and (10.0, 12.0) in out               # the smaller cut is not made, the pause stays
    assert (30.0, 33.0) in out
    # the time that goes whole is never dropped, only the pause cut next to it
    out = pauses._no_jump_cuts([(10.0, 11.0)], [(11.7, 14.0)])
    assert out == []
    assert pauses._no_jump_cuts([(10.0, 11.0)], [(11.0, 14.0)]) == [(10.0, 11.0)]   # touching: one cut, not a jump cut


def _labels(n, speech=()):
    lab = np.zeros(n, dtype=np.uint8)
    for a, b in speech:
        lab[int(a * 100):int(b * 100)] = speechmap.WORD
    return lab


def test_a_hole_in_one_camera_row_where_nobody_speaks_is_cut_from_every_track():
    # cam 1: clips 0-10 and 14-30; cam 2 runs 0-30; the hole 10-14 holds a word at 10-10.3 only in test 2, nothing in test 1
    tracks = {("video", 0): [(0.0, 10.0), (14.0, 30.0)], ("video", 1): [(0.0, 30.0)]}
    lab = _labels(3000, speech=[(0.0, 9.5), (14.5, 29.0)])
    cuts, closed, left = pauses._close_track_holes([], tracks, lab, 0.0, FPS)
    assert len(cuts) == 1 and abs(cuts[0][0] - 10.0) < 1 / FPS and abs(cuts[0][1] - 14.0) < 1 / FPS and left == 0.0
    # somebody speaks inside the hole: it stays, and its seconds are reported
    lab = _labels(3000, speech=[(0.0, 9.5), (11.0, 11.5), (14.5, 29.0)])
    cuts, closed, left = pauses._close_track_holes([], tracks, lab, 0.0, FPS)
    assert cuts == [] and abs(left - 4.0) < 0.05


def test_a_long_piece_is_read_in_parts_cut_in_its_quietest_moments():
    """0.10.25: one long clip kept two of the three readers idle (Beauty Sector 133 s: 149 -> 60 s read in five parts).
    Parts are about 30 s, cut where the sound is quietest, and keep their sequence place."""
    import numpy as np
    from asistent import roughcut_job as R
    sr = R.ASR_SR
    y = np.random.default_rng(1).normal(0, 0.1, int(100 * sr)).astype(np.float32)
    for q in (27.0, 55.5, 83.0):                                    # pauses where the parts should end
        y[int(q * sr):int((q + 0.6) * sr)] = 0.0
    sg = {"path": "/m/a.mp4", "start": 10.0, "end": 110.0, "at": 200.0, "track": 0}
    parts = R.split_long([sg], read=lambda s, pad: (y, 0.0))
    assert [round(p["start"], 1) for p in parts][0] == 10.0 and parts[-1]["end"] == 110.0
    for a, b in zip(parts, parts[1:]):
        assert a["end"] == b["start"]                                # nothing lost, nothing read twice
    cuts = [p["end"] - 10.0 for p in parts[:-1]]
    assert all(any(q - 0.05 <= c <= q + 0.65 for q in (27.0, 55.5, 83.0)) for c in cuts), cuts
    assert all(p["at"] == 200.0 + (p["start"] - 10.0) for p in parts)
    short = {"path": "/m/b.mp4", "start": 0.0, "end": 39.0, "at": 0.0, "track": 0}
    assert R.split_long([short], read=lambda s, pad: (_ for _ in ()).throw(AssertionError("not read"))) == [short]


# ---------------------------------------------------------------- 0.10.40: large-v3-turbo for the rough cut only

def test_the_rough_cut_uses_turbo_only_when_fast_and_falls_back_to_large(monkeypatch):
    from asistent import roughcut_job as R
    have = {asr.LARGE: True, asr.TURBO: True}
    monkeypatch.setattr(asr, "backend_installed", lambda: True)
    monkeypatch.setattr(asr, "model_present", lambda kind=asr.LARGE: have[kind])
    assert R.model() == asr.LARGE                                   # turbo only when the editor switched Fast on
    assert R.model(fast=True) == asr.TURBO
    have[asr.TURBO] = False
    assert R.model(fast=True) == asr.LARGE
    have[asr.LARGE] = False
    assert R.model(fast=True) is None


def test_turbo_words_never_reach_the_subtitles_cache_but_subtitle_words_are_reused(tmp_path, monkeypatch):
    from asistent import roughcut_job as R, subtitle_job as S
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path / "app"))
    audio = np.zeros(16000, dtype=np.float32)
    monkeypatch.setattr(R, "window_audio", lambda win, prompt: (audio, "k1"))
    calls = []
    monkeypatch.setattr(asr, "transcribe", lambda y, prompt, progress, cancelled, model=asr.LARGE, compression=None:
                        calls.append((model, compression)) and False or [{"word": "турбо", "start": 0.0, "end": 0.5, "p": 0.9}])
    r = R.read_rough({}, asr.TURBO, None, lambda: False)
    assert calls == [(asr.TURBO, asr.ROUGH_COMPRESSION)] and r["key"] == R.TURBO_KEY + "k1" and not r["cached"]
    assert S._cached("k1") is None                                  # the subtitles' key stays empty
    assert R.read_rough({}, asr.TURBO, None, lambda: False)["cached"] and len(calls) == 1   # cached under its own key
    S._store("k1", {"words": [{"word": "голям", "start": 0.0, "end": 0.5, "p": 0.9}]})       # subtitles read it with large-v3
    r = R.read_rough({}, asr.TURBO, None, lambda: False)
    assert r["cached"] and r["entry"]["words"][0]["word"] == "голям" and len(calls) == 1


def test_asr_keeps_large_v3_as_the_default_model(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path))
    assert asr.model_dir().endswith(os.path.join("models", "whisper"))
    assert asr.model_dir(asr.TURBO).endswith(os.path.join("models", "whisper-turbo"))
    import inspect
    assert inspect.signature(asr.transcribe).parameters["model"].default == asr.LARGE
    assert asr.model_status(asr.TURBO)["expected_bytes"] < asr.model_status()["expected_bytes"]


# ---------------------------------------------------------------- 0.10.45: the rough cut's own reading, and Cancel at once

def test_the_rough_cut_reads_large_v3_with_its_own_limit_under_its_own_key(tmp_path, monkeypatch):
    from asistent import roughcut_job as R, subtitle_job as S
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path / "app"))
    audio = np.zeros(16000, dtype=np.float32)
    monkeypatch.setattr(R, "window_audio", lambda win, prompt: (audio, "k2"))
    calls = []
    monkeypatch.setattr(asr, "transcribe", lambda y, prompt, progress, cancelled, model=asr.LARGE, compression=None:
                        calls.append((model, compression)) and False or [{"word": "дубъл", "start": 0.0, "end": 0.5, "p": 0.9}])
    r = R.read_rough({}, asr.LARGE, None, lambda: False)
    assert calls == [(asr.LARGE, asr.ROUGH_COMPRESSION)] and r["key"] == R.ROUGH_KEY + "k2"
    assert S._cached("k2") is None                                  # never in the subtitles' cache
    S._store("k2", {"words": [{"word": "субтитри", "start": 0.0, "end": 0.5, "p": 0.9}]})
    assert R.read_rough({}, asr.LARGE, None, lambda: False)["entry"]["words"][0]["word"] == "субтитри"


def test_cancel_returns_at_once_while_a_stretch_is_still_being_read(monkeypatch):
    import threading
    import time as _t
    from asistent.sync import Cancelled
    gate = threading.Event()

    class Slow:
        def transcribe(self, audio, **kw):
            def gen():
                gate.wait(5)                                         # one long stretch that cannot be interrupted
                yield from ()
            return gen(), None
    monkeypatch.setattr(asr, "_load", lambda kind=asr.LARGE: Slow())
    flag = {"on": False}
    threading.Timer(0.3, lambda: flag.update(on=True)).start()
    t0 = _t.time()
    with pytest.raises(Cancelled):
        asr.transcribe(np.zeros(16000, dtype=np.float32), cancelled=lambda: flag["on"])
    assert _t.time() - t0 < 1.5
    gate.set()


def test_the_shell_xml_has_the_sequence_tracks_and_markers_but_no_clips():
    # 0.10.45: the panel fills it with clones of the editor's own clips (no new master clips, nothing re-interpreted)
    items = [{"kind": "video", "track": 1, "path": "/m/a.mp4", "start": 0.0, "end": 10.0, "inPt": 0.0, "name": "a"},
             {"kind": "audio", "track": 2, "path": "/m/a.mp4", "start": 0.0, "end": 10.0, "inPt": 0.0, "name": "a"}]
    ps = edl.pieces(items, edl.kept_ranges(0, 10, [(4.0, 6.0)]), FPS)
    import tempfile
    path = os.path.join(tempfile.mkdtemp(), "s.xml")
    xmeml.write(path, "ROUGH – s", FPS, 2160, 3840, ps, [{"frame": 30, "name": "Review", "comment": "x"}],
                probe=lambda s: (_ for _ in ()).throw(AssertionError("a shell reads no file")), shell=True)
    xml = read(path)
    assert "<clipitem" not in xml and "<file" not in xml and "<marker>" in xml
    assert xml.count("<track>") == 2 and xml.count('premiereTrackType="Stereo"') == 6     # V1-V2, A1-A3 as pairs
    assert "<width>2160</width><height>3840</height>" in xml
