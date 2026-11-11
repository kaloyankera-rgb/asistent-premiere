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
    assert loose["confidence"] == "medium" and "another take" in loose["reasons"][-1]
    assert strict["confidence"] == "high"


def test_file_times_are_never_a_witness():
    e = _edge(0, 1, 2.273, "medium")
    G._clock_check(_clips(2), ["/A", "/B"], True, [e], [1000.0, 1002.0], ["file", "file"])
    assert e["confidence"] == "medium"


# ---- short takes confirmed by the learnt clocks (0.10.45, Pulse Fitness: 4-12 s clips, two stretches each)

def _learn(n_pairs=2):
    """strict pairs teach: B's clock runs 3141.3 s ahead of A's (rec of B minus its offset)."""
    edges, rec = [], []
    for k in range(n_pairs):
        a, b = 2 * k, 2 * k + 1
        edges.append(_edge(a, b, 1.0, "high"))
        rec += [1000.0 + 100 * k, 1000.0 + 100 * k + 1.0 + 3141.3 + (0.3 if k else 0.0)]
    return edges, rec


def _short(a, b, off, **kw):
    return _edge(a, b, off, "low", **{"n_agree": 2, "n_info": 3, "peak_ratio": 1.6, **kw})


def test_short_take_with_two_stretches_is_confirmed_by_learnt_clocks():
    strict, rec = _learn()
    e = _short(4, 5, 2.29)
    rec += [5000.0, 5000.0 + 1.7 + 3141.3]                 # the clocks say +1.7 s, the sound +2.29 s
    G._clock_check(_clips(6), ["/A", "/B"] * 3, True, strict + [e], rec, ["metadata"] * 6)
    assert e["confidence"] == "high" and e["clock_confirmed"] and "short take" in e["reasons"][0]


def test_short_take_needs_learnt_clocks_not_raw_ones():
    e = _short(0, 1, 2.29)
    G._clock_check(_clips(2), ["/A", "/B"], True, [e], [1000.0, 1002.0], ["metadata"] * 2)
    assert e["confidence"] == "low"


def test_short_take_far_from_the_clocks_stays_low():
    strict, rec = _learn()
    e = _short(4, 5, 4.0)
    rec += [5000.0, 5000.0 + 1.7 + 3141.3]
    G._clock_check(_clips(6), ["/A", "/B"] * 3, True, strict + [e], rec, ["metadata"] * 6)
    assert e["confidence"] == "low"


def test_short_take_with_a_weak_peak_or_one_stretch_stays_low():
    strict, rec = _learn()
    weak = _short(4, 5, 1.7, peak_ratio=1.1)
    one = _edge(6, 7, 1.7, "low", n_agree=1, n_info=2, peak_ratio=2.0)
    rec += [5000.0, 5000.0 + 1.7 + 3141.3, 6000.0, 6000.0 + 1.7 + 3141.3]
    G._clock_check(_clips(8), ["/A", "/B"] * 4, True, strict + [weak, one], rec, ["metadata"] * 8)
    assert weak["confidence"] == "low" and one["confidence"] == "low"


def test_two_possible_offsets_decided_by_learnt_clocks_only_when_the_other_is_far():
    strict, rec = _learn()
    near = _edge(4, 5, 26.47, "medium", ambiguous=True, runner_offset=28.0)
    far = _edge(6, 7, 26.47, "medium", ambiguous=True, runner_offset=3.0)
    rec += [5000.0, 5000.0 + 26.7 + 3141.3, 6000.0, 6000.0 + 26.7 + 3141.3]
    G._clock_check(_clips(8), ["/A", "/B"] * 4, True, strict + [near, far], rec, ["metadata"] * 8)
    assert near["confidence"] == "medium"
    assert far["confidence"] == "high" and far["clock_confirmed"]


def test_uncertain_pair_from_another_take_is_said_by_the_clocks():
    strict, rec = _learn()
    e = _edge(4, 5, 0.63, "medium")
    rec += [5654.0, 5386.0 + 3141.3]
    G._clock_check(_clips(6), ["/A", "/B"] * 3, True, strict + [e], rec, ["metadata"] * 6)
    assert e["confidence"] == "medium" and "not recorded together" in e["reasons"][-1]


def test_clock_overlaps_name_unconfirmed_pairs():
    clips = [SimpleNamespace(length=d, name=f"c{i}", info=SimpleNamespace(duration=d)) for i, d in enumerate([40.0, 11.0, 5.0])]
    when = {"time": [100.0, 117.7, 300.0], "note": [None, None, None], "reference": "/B",
            "cameras": [{"camera": "/A", "pairs": 3, "spread": 0.6}, {"camera": "/B", "pairs": 0, "spread": 0.0}]}
    out = G._clock_overlaps(clips, ["/A", "/B", "/B"], [], when)
    assert out == [{"a": 0, "b": 1, "offset": 17.7}]
    # in one group already, or a camera whose clock was never learnt: nothing to say
    assert G._clock_overlaps(clips, ["/A", "/B", "/B"], [{"members": [{"clip": 0}, {"clip": 1}]}], when) == []
    when["cameras"][0]["pairs"] = 0
    assert G._clock_overlaps(clips, ["/A", "/B", "/B"], [], when) == []
