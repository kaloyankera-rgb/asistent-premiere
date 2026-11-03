"""Timeline mode: many clips from two cameras (each in its own folder) -> groups of synced takes."""
import os

import synth
from asistent.groups import sync_groups


def test_two_cameras_three_takes(tmp_path):
    s1, s2 = synth.scene(200.0, seed=12)
    os.makedirs(tmp_path / "camA")
    os.makedirs(tmp_path / "camB")
    os.makedirs(tmp_path / "other")

    def take(cam, name, start, length, seed):
        return synth.write_wav(tmp_path / cam / name, [synth.mic([(s1, 1), (s2, .8)], start, length, seed=seed)])

    # take 1: A 10-40, B 12-38 ; take 2: A 60-75, B 58-80 and a second B clip 81-95 inside A's long take 3
    a1 = take("camA", "a1.wav", 10, 30, 1)
    a2 = take("camA", "a2.wav", 60, 15, 2)
    a3 = take("camA", "a3.wav", 100, 60, 3)
    b1 = take("camB", "b1.wav", 12, 26, 4)
    b2 = take("camB", "b2.wav", 58, 22, 5)
    b3 = take("camB", "b3.wav", 110, 14, 6)
    b4 = take("camB", "b4.wav", 130, 20, 7)
    o1, o2 = synth.scene(30.0, seed=77)
    lone = synth.write_wav(tmp_path / "other" / "lone.wav", [synth.mic([(o1, 1), (o2, 1)], 0, 25, seed=8)])

    paths = [a1, b1, a2, b2, a3, b3, b4, lone, a1]           # a duplicate path is ignored
    res = sync_groups(paths)
    names = [c["name"] for c in res["clips"]]
    groups = {frozenset(names[m["clip"]] for m in g["members"]): g for g in res["groups"]}
    assert set(groups) == {frozenset({"a1.wav", "b1.wav"}), frozenset({"a2.wav", "b2.wav"}),
                           frozenset({"a3.wav", "b3.wav", "b4.wav"})}
    assert [names[i] for i in res["unsynced"]] == ["lone.wav"]
    assert not res["conflicts"]
    truth = {"a1.wav": 10, "b1.wav": 12, "a2.wav": 60, "b2.wav": 58, "a3.wav": 100, "b3.wav": 110, "b4.wav": 130}
    for g in res["groups"]:
        anchor = names[g["anchor"]]
        for m in g["members"]:
            assert abs(m["offset"] - (truth[names[m["clip"]]] - truth[anchor])) < 0.002
    # same-camera pairs are not compared: 4 + 3 clips in two folders + 1 other -> 4*3 + 4 + 3 pairs
    assert res["pairs_checked"] == 19


# ---- the cameras' clocks as a second witness (groups._clock_check), 2026-11-03

from types import SimpleNamespace

from asistent import groups as G


def _clips(n):
    return [SimpleNamespace(length=30.0, name=f"c{i}") for i in range(n)]


def _edge(a, b, off, conf, **kw):
    return {"a": a, "b": b, "offset": off, "confidence": conf, "agree": "3/6", "reasons": [], "warnings": [], **kw}


def test_two_clips_uncertain_audio_confirmed_by_raw_clocks():
    # the user's case: only two clips selected, audio 3/6 at +2.273 s, the cameras' clocks say +2 s
    e = _edge(0, 1, 2.273, "medium")
    G._clock_check(_clips(2), ["/A", "/B"], True, [e], [1000.0, 1002.0], ["metadata"] * 2)
    assert e["confidence"] == "high" and e["clock_confirmed"]


def test_raw_clocks_far_apart_neither_confirm_nor_veto():
    medium = _edge(0, 1, 2.273, "medium")
    loose = _edge(2, 3, 1.5, "high", loose=True)
    G._clock_check(_clips(4), ["/A", "/B", "/A", "/B"], True, [medium, loose],
                   [1000.0, 1000.0 - 6.3e7, 2000.0, 2000.0 - 6.3e7], ["metadata"] * 4)
    assert medium["confidence"] == "medium"
    assert loose["confidence"] == "high"


def test_second_possible_offset_is_never_confirmed():
    e = _edge(0, 1, 2.273, "medium", ambiguous=True)
    G._clock_check(_clips(2), ["/A", "/B"], True, [e], [1000.0, 1002.0], ["metadata"] * 2)
    assert e["confidence"] == "medium"


def test_scattered_match_from_another_take_is_vetoed_by_learnt_clocks():
    # strict pair 0-1 teaches: B's clock is 3600 s behind A's; the scattered pair 2-3 says +1.5 s,
    # but on the learnt clock 3 started 300 s after 2: the same line from another take
    strict = _edge(0, 1, 4.0, "high")
    loose = _edge(2, 3, 1.5, "high", loose=True)
    rec = [1000.0, 1004.0 - 3600, 2000.0, 2300.0 - 3600]
    G._clock_check(_clips(4), ["/A", "/B", "/A", "/B"], True, [strict, loose], rec, ["metadata"] * 4)
    assert loose["confidence"] == "medium" and "друг дубъл" in loose["reasons"][-1]
    assert strict["confidence"] == "high"


def test_file_times_are_never_a_witness():
    e = _edge(0, 1, 2.273, "medium")
    G._clock_check(_clips(2), ["/A", "/B"], True, [e], [1000.0, 1002.0], ["file", "file"])
    assert e["confidence"] == "medium"
