"""Regression on real client footage (read only, never copied): GStroy brand 9x16, Sony FX3 + FX30.

Skipped where the footage is not present. The expected offsets were found by the engine on 2026-11-01
and confirmed independently: for every pair the 10 ms loudness curves of both cameras line up best at
exactly this offset. Takes from different shooting blocks cannot overlap and must never come back High.
"""
import glob
import os

import pytest

from asistent import sync as S

BASE = os.environ.get("ASISTENT_REAL_FOOTAGE",
                      os.path.expanduser("~/Kaloyan/01_CLIENTS/The Pact/GStroy/Media/GStroy brand/9x16"))
pytestmark = pytest.mark.skipif(not os.path.isdir(os.path.join(BASE, "fx3")), reason="real footage not on this machine")

# (FX30 take, FX3 take, offset of the shorter take on the longer one's clock)
PAIRS = [
    ("C9010", "fx39010", 6.4920), ("C9011", "fx39011", -0.5507), ("C9013", "fx39013", 0.0265),
    ("C9021", "fx39023", 2.1501), ("C9023", "fx39024", 8.8569), ("C9024", "fx39026", 0.1808),
    ("C9025", "fx39027", 1.1375), ("C9025", "fx39028", 23.6952), ("C9025", "fx39029", 39.3416),
    ("C9026", "fx39030", 3.1710), ("C9037", "fx39042", -0.3541), ("C9038", "fx39043", 0.3104),
]
BLOCK = {**{n: 1 for n in ("fx39010", "fx39011", "fx39012", "fx39013", "C9010", "C9011", "C9012", "C9013")},
         **{n: 2 for n in ("fx39023", "fx39024", "fx39025", "fx39026", "C9021", "C9022", "C9023", "C9024")},
         **{n: 3 for n in ("fx39027", "fx39028", "fx39029", "fx39030", "C9025", "C9026")},
         **{n: 4 for n in ("fx39042", "fx39043", "fx39044", "C9037", "C9038", "C9039")}}


@pytest.fixture(scope="module")
def clips():
    out = {}
    for cam in ("fx3", "fx30"):
        for p in sorted(glob.glob(os.path.join(BASE, cam, "*.MP4"))):
            out[os.path.basename(p)[:-4]] = S.load_clip(p)
    return out


def pair(clips, x, y):
    a, b = clips[x], clips[y]
    ref, other = (a, b) if a.length >= b.length else (b, a)
    return S.analyze_pair(ref, other)


@pytest.mark.parametrize("fx30,fx3,offset", PAIRS)
def test_known_pairs(clips, fx30, fx3, offset):
    r = pair(clips, fx30, fx3)
    assert r["confidence"] == "high", r["reasons"]
    assert abs(r["offset"] - offset) <= 0.005


def test_different_blocks_never_sync(clips):
    bad = []
    for x in clips:
        for y in clips:
            if x.startswith("fx3") and y.startswith("C") and BLOCK[x] != BLOCK[y]:
                r = pair(clips, y, x)
                if r["confidence"] != "low":
                    bad.append((y, x, r["confidence"], r.get("offset")))
    assert not bad, bad


def test_whole_timeline_selection():
    from asistent.groups import sync_groups
    paths = sorted(glob.glob(os.path.join(BASE, "fx3", "*.MP4"))) + sorted(glob.glob(os.path.join(BASE, "fx30", "*.MP4")))
    res = sync_groups(paths)
    names = [c["name"][:-4] for c in res["clips"]]
    got = {frozenset(names[m["clip"]] for m in g["members"]) for g in res["groups"]}
    want = {frozenset(p) for p in [("C9010", "fx39010"), ("C9011", "fx39011"), ("C9013", "fx39013"),
                                   ("C9021", "fx39023"), ("C9023", "fx39024"), ("C9024", "fx39026"),
                                   ("C9025", "fx39027", "fx39028", "fx39029"), ("C9026", "fx39030"),
                                   ("C9037", "fx39042"), ("C9038", "fx39043")]}
    assert got == want and not res["conflicts"]

    # recording order (Bug 3): the FX30's clock is set to 2024, the FX3's to 2026; the 10 synced pairs
    # must agree on one clock difference, and then every clip (synced or not) gets a time on one clock
    fx30 = next(c for c in res["clocks"] if c["name"] == "fx30")
    fx3 = next(c for c in res["clocks"] if c["name"] == "fx3")
    assert fx30["linked"] and fx3["linked"]
    gap = abs(fx30["offset"] - fx3["offset"])
    assert 700 * 86400 < gap < 740 * 86400                       # about two years apart
    assert max(fx30["spread"], fx3["spread"]) <= 3.0
    assert all(c["rec_time"] is not None and c["rec_note"] is None for c in res["clips"])
    # the lone FX3 take fx39025 (1.5 s) was recorded between the fx39024 and fx39026 groups
    t = {c["name"][:-4]: c["rec_time"] for c in res["clips"]}
    assert t["fx39024"] < t["fx39025"] < t["fx39026"]
    # a synced pair now starts within a few seconds on the shared clock
    assert abs(t["C9023"] - t["fx39024"]) < 30
