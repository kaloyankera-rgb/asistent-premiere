"""Cut silences, detection defects of the 2026-11-21 audit (0.10.122): a dead channel, the recognised words as a second witness,
one recording cut into short clips, Manual dB with the AI rough cut's takes."""
import numpy as np
import pytest

import synth
from asistent import config, silence as SI, vad

SR = 16000
S, Z = SI.SPEECH, SI.SIL
AT = lambda t: int(round(t / SI.HOP_S))


def db_frames(spec):
    return np.concatenate([np.full(int(round(s / SI.HOP_S)), d, dtype=np.float64) for s, d in spec])


def _labels(spec):
    lab = np.concatenate([np.full(int(round(s / SI.HOP_S)), v, dtype=np.uint8) for s, v in spec])
    return {"labels": lab, "covered": np.ones(len(lab), bool), "under": np.zeros(len(lab), dtype=np.float32)}


def _probs(db, sure_where):
    """Silero as a model: 0.95 where `sure_where` (a bool mask per 10 ms) is true, 0.02 elsewhere (one value per 32 ms)."""
    idx = (np.arange(int(len(db) * SI.HOP_S * SR / 512) + 1) * 512 / SR / SI.HOP_S).astype(int).clip(0, len(db) - 1)
    return np.where(sure_where[idx], 0.95, 0.02).astype(np.float32)


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path / "app"))
    return tmp_path


# ---------------------------------------------------------------- 2. a dead channel
def _dead_db(seconds, seed=1):
    """A dead input: hiss from -90 dB with slow bursts up to about -66 dB (Fornetti fx30-3-0403 R: floor -88.6, voice -66.4)."""
    rng = np.random.default_rng(seed)
    n = int(seconds / SI.HOP_S)
    walk = np.convolve(rng.standard_normal(n), np.ones(40) / 40, mode="same")
    return np.clip(-86.0 + 9.0 * walk / walk.std() * 1.0, -92.0, -62.0)


def test_a_dead_channel_counts_as_speech_only_where_silero_is_sure():
    db = _dead_db(60.0)
    thr = SI.auto_threshold(db)
    assert thr["open"] < SI.SURE_MIN_DB                                      # the case: Auto's line is far under -60 dB
    nothing = _probs(db, np.zeros(len(db), bool))
    sp, _ = SI.item_speech(db, nothing, None)
    assert sp.sum() == 0                                                     # hiss is not heard as a voice
    assert SI.item_speech(db, None, None)[0].sum() > 1000                    # without Silero the level decides (the safe side): as before
    # a real voice in the same hiss is still found, whole, where Silero is sure somewhere in it
    voice = db.copy()
    voice[AT(10):AT(12)] = -30.0
    sure = np.zeros(len(db), bool)
    sure[AT(10.5):AT(11.0)] = True
    sp, _ = SI.item_speech(voice, _probs(voice, sure), None)
    assert sp[AT(10):AT(12)].all() and sp[:AT(9)].sum() == 0 and sp[AT(13):].sum() == 0


def test_a_quiet_lavalier_at_minus_57_db_is_still_heard():
    # the guard case of TODO SIL (fx31031): the voice sits near -57 dB, the floor far under it; Auto's line is under -60 dB too
    spec = [(1, -85), (0.6, -57), (0.3, -62), (0.5, -55), (1, -85), (0.8, -58), (0.2, -64), (0.4, -56), (1, -85)]
    db = db_frames(spec)
    assert SI.auto_threshold(db)["open"] < SI.SURE_MIN_DB
    sure = db > -66.0                                                        # Silero hears a clean voice wherever it speaks, not in every syllable
    sure[AT(1.8):AT(1.95)] = False                                           # ... and misses a soft stretch of the first word
    sp, _ = SI.item_speech(db, _probs(db, sure), None)
    for a, b in ((1.0, 2.4), (3.4, 4.8)):
        assert sp[AT(a):AT(b)].all(), (a, b)
    assert sp[:AT(0.9)].sum() == 0 and sp[AT(5.0):AT(5.3)].sum() == 0               # and the room tone around it is not


def _hiss(seconds, seed=1):
    """The dead input as sound: white noise at the level `_dead_db` describes."""
    db = _dead_db(seconds, seed)
    gain = np.repeat(10.0 ** (db / 20.0), SI.HOP)[: int(seconds * SR)]
    return (np.random.default_rng(seed + 5).standard_normal(len(gain)) * gain).astype(np.float32)


def _speech_mic(seconds, gain):
    a = synth.talker(3.0, 3, sr=SR) * gain
    rng = np.random.default_rng(1)
    m = (rng.standard_normal(int(seconds * SR)) * 0.00002).astype(np.float32)
    m[:3 * SR] += a
    m[8 * SR:10 * SR] += a[:2 * SR]
    return m


def _two_mics(home, speech, hiss):
    w1 = synth.write_wav(home / "speech.wav", [np.repeat(speech, 3)], sr=48000)
    w2 = synth.write_wav(home / "hiss.wav", [np.repeat(hiss, 3)], sr=48000)
    return [{"path": w1, "start": 0.0, "end": 12.0, "at": 0.0, "name": "mic"}, {"path": w2, "start": 0.0, "end": 12.0, "at": 0.0, "name": "dead"}]


@pytest.mark.skipif(not vad.available(), reason="Silero is not installed here")
def test_a_speech_microphone_and_a_hiss_microphone_share_their_silences(home, monkeypatch):
    items = _two_mics(home, _speech_mic(12, 1.0), _hiss(12.0))
    det = SI.detect(items, 0.0, 12.0)
    dead = next(i for i in det["items"] if i["name"] == "dead")
    assert dead["open"] < SI.SURE_MIN_DB and dead["speech_s"] < 0.5, dead
    cuts = SI.cuts(det["speech"], det["covered"], 0.0, "normal")
    for a, b in ((2.5, 3.9), (5.6, 7.9), (10.4, 11.9)):
        assert any(x <= a and b <= y for x, y in cuts), (a, b, cuts)          # the shared silences are cut
    for a, b in ((0.2, 2.07), (8.2, 9.98)):
        assert not any(x < b and y > a for x, y in cuts), (a, b, cuts)        # the voice is not
    # without the rule (the line moved out of reach) the hiss blocks the cuts through the union: what the audit measured
    monkeypatch.setattr(SI, "SURE_MIN_DB", -300.0)
    det0 = SI.detect(items, 0.0, 12.0)
    cuts0 = SI.cuts(det0["speech"], det0["covered"], 0.0, "normal")
    assert sum(b - a for a, b in cuts0) < 0.6 * sum(b - a for a, b in cuts)
    print("shared silences cut: with the rule %.1f s, without %.1f s" % (sum(b - a for a, b in cuts), sum(b - a for a, b in cuts0)))


def test_a_quiet_lavalier_and_a_hiss_microphone_still_cut_around_the_lavalier(home, monkeypatch):
    # synth.talker is no voice to the real Silero (it stays under 0.8), so a model of Silero stands in: sure where a real voice
    # is (the clip that carries one, over -75 dB), never in the hiss
    def model(y):
        if np.abs(y).max() < 0.005:
            return np.zeros(-(-len(y) // 512), dtype=np.float32)
        pad = np.zeros(-(-len(y) // 512) * 512)
        pad[:len(y)] = y
        rms = np.sqrt((pad.reshape(-1, 512) ** 2).mean(axis=1))
        return np.where(rms > 10 ** (-75 / 20), 0.95, 0.02).astype(np.float32)
    monkeypatch.setattr(SI.vad, "probabilities", model)
    items = _two_mics(home, _speech_mic(12, 0.03), _hiss(12.0))
    det = SI.detect(items, 0.0, 12.0)
    mic = next(i for i in det["items"] if i["name"] == "mic")
    cuts = SI.cuts(det["speech"], det["covered"], 0.0, "normal")
    assert mic["open"] < SI.SURE_MIN_DB + 0.2 and mic["speech_s"] > 1.4, mic       # a quiet voice, Auto's line at about -60 dB
    for a, b in ((0.2, 2.07), (8.2, 9.98)):
        assert not any(x < b and y > a for x, y in cuts), (a, b, cuts, mic)       # the quiet voice is heard
    assert any(x <= 2.6 and y >= 7.8 for x, y in cuts)                           # and the shared silence between is cut


# ---------------------------------------------------------------- 7. one recording cut into short clips
def _fake(monkeypatch, dbs):
    monkeypatch.setattr(SI, "measure", lambda it, cancelled=None: {"db": dbs[it["name"]], "probs": None})


def _it(name, start, end, at, path="rec.wav", side=None):
    return {"path": path, "start": start, "end": end, "at": at, "name": name, "side": side}


def test_ranges_of_one_recording_share_their_floor_so_a_cut_down_clip_keeps_its_soft_words(monkeypatch):
    tight = db_frames([(3, -22), (1, -32)])                                  # already cut down: no pause left, its 10th percentile is speech
    paused = db_frames([(1, -70), (3, -22), (1, -70), (3, -22)])
    _fake(monkeypatch, {"a": tight, "b": paused})
    s = SI.settings({"mode": "silence", "method": "auto", "pacing": "measured"})
    alone = SI.detect([_it("a", 0, 4, 0.0)], 0.0, 4.0, s=s)
    assert not alone["speech"][AT(3.2):AT(3.8)].any()                        # judged on its own: the soft words are "silence"
    both = SI.detect([_it("a", 20, 24, 0.0), _it("b", 0, 8, 4.0)], 0.0, 12.0, s=s)
    assert both["speech"][AT(3.1):AT(3.9)].all()                              # pooled with its own recording's pauses: kept
    assert both["items"][0]["floor"] == both["items"][1]["floor"] and both["items"][0]["floor"] < -65


def test_pooling_falls_back_to_each_clip_when_the_levels_differ_by_more_than_6_db(monkeypatch):
    loud = db_frames([(1, -70), (3, -22), (1, -70), (3, -22)])
    quiet = db_frames([(1, -80), (3, -40), (1, -80), (3, -40)])              # 18 dB lower: another gain, another scene
    dbs = {"a": loud, "b": quiet}
    _fake(monkeypatch, dbs)
    s = SI.settings({"mode": "silence", "method": "auto", "pacing": "measured"})
    items = [_it("a", 0, 8, 0.0), _it("b", 20, 28, 8.0)]
    measured = [SI.measure(i) for i in items]
    assert SI.pools_for(items, measured, s) == [None, None]
    both = SI.detect(items, 0.0, 16.0, s=s)
    for k, name in enumerate(("a", "b")):
        own = SI.label_item(dbs[name], None, s)
        assert (both["labels"][AT(8.0 * k):AT(8.0 * k + 8.0)] == own["labels"][:AT(8.0)]).all()
    assert SI.pooled_levels([loud]) is None                                   # one range: nothing to pool
    # different files and different channels of one file are never pooled
    other = [_it("a", 0, 8, 0.0, path="x.wav"), _it("b", 0, 8, 8.0, path="y.wav"), _it("a", 0, 8, 16.0, path="x.wav", side="L")]
    assert SI.pools_for(other, [SI.measure(i) for i in other], s) == [None, None, None]


def test_a_single_whole_clip_gives_exactly_what_label_item_gives(monkeypatch):
    rng = np.random.default_rng(4)
    db = np.concatenate([np.full(300, -70.0), -30.0 + 5 * rng.standard_normal(500), np.full(200, -68.0), np.full(400, -45.0) + rng.standard_normal(400)])
    probs = _probs(db, db > -50)
    monkeypatch.setattr(SI, "measure", lambda it, cancelled=None: {"db": db, "probs": probs})
    for body in ({"mode": "silence", "method": "auto"}, {"mode": "offmic", "method": "auto", "sensitivity": 4},
                 {"mode": "silence", "method": "manual", "threshold": -40}, {"mode": "ai", "method": "ai"}):
        s = SI.settings({**body, "pacing": "measured"})
        want = SI.label_item(db, probs, s)
        got = SI.detect([_it("only", 0, 14, 0.0)], 0.0, len(db) * SI.HOP_S, s=s)
        assert (got["labels"] == want["labels"]).all() and (got["under"] == want["under"]).all(), body
        assert SI.pools_for([_it("only", 0, 14, 0.0)], [{"db": db, "probs": probs}], s) == [None]


def _kept(r):
    return r["labels"] >= SI.FLAG


@pytest.mark.parametrize("mode", ["silence", "offmic"])
def test_pooling_never_loses_speech_or_gains_off_mic(monkeypatch, mode):
    # reviewer 2026-11-21: A's voice at -20 dB, B's phrases at -24 and -30 dB (90th percentiles 4 dB apart). Pooled on the host's
    # main voice B's -30 dB phrase became "off-mic" and its threshold rose; a range judged with others may only ever keep MORE
    A = db_frames([(1, -70), (6, -20), (1, -70)])
    B = db_frames([(1, -70), (3, -24), (0.8, -70), (3, -30), (1, -70)])
    dbs = {"a": A, "b": B}
    _fake(monkeypatch, dbs)
    s = SI.settings({"mode": mode, "method": "auto", "pacing": "measured"})
    items = [_it("a", 0, 8, 0.0), _it("b", 20, 28.8, 8.0)]
    assert SI.pools_for(items, [SI.measure(i) for i in items], s) != [None, None]      # they ARE pooled (4 dB apart)
    both = SI.detect(items, 0.0, 16.8, s=s)
    for k, name in enumerate(("a", "b")):
        n = len(dbs[name])
        own = SI.label_item(dbs[name], None, s)
        got = both["labels"][AT(8.0 * k):AT(8.0 * k) + n]
        assert (got[:n] >= SI.FLAG)[_kept(own)[:len(got)]].all(), name              # every frame kept alone is kept pooled
        assert not ((got == SI.OFF) & _kept(own)[:len(got)]).any(), name            # nothing alone kept is off-mic pooled
    if mode == "offmic":
        alone_b = SI.label_item(B, None, s)
        assert (both["labels"][AT(8.0 + 5.0):AT(8.0 + 7.5)] >= SI.FLAG).all()       # the -30 dB phrase stays kept, flagged or not
        assert not (both["labels"][AT(8.0):AT(8.0) + len(B)] == SI.OFF).sum() > (alone_b["labels"] == SI.OFF).sum()


def test_pooled_ranges_always_keep_at_least_what_each_keeps_alone(monkeypatch):
    rng = np.random.default_rng(21)
    for trial in range(40):
        base = float(rng.uniform(-35, -18))
        dbs = {}
        for name in "abc":
            parts = []
            for _ in range(int(rng.integers(2, 6))):
                parts.append((float(rng.uniform(0.3, 2.5)), float(rng.choice([-70.0, base + rng.uniform(-8, 3)]))))
            parts.append((0.5, base))
            dbs[name] = db_frames(parts)
        _fake(monkeypatch, dbs)
        mode = ["silence", "offmic"][trial % 2]
        s = SI.settings({"mode": mode, "method": "auto", "pacing": "measured", "sensitivity": int(rng.integers(1, 6))})
        at, items = 0.0, []
        for name in "abc":
            items.append(_it(name, 0, len(dbs[name]) * SI.HOP_S, at))
            at += len(dbs[name]) * SI.HOP_S
        both = SI.detect(items, 0.0, at, s=s)
        for it in items:
            o = AT(it["at"])
            own = SI.label_item(dbs[it["name"]], None, s)
            got = both["labels"][o:o + len(own["labels"])]
            assert (got >= SI.FLAG)[_kept(own)[:len(got)]].all(), (trial, it["name"])


# ---------------------------------------------------------------- 2b. the dead-channel rule: half-heard and single microphone
QUIET = [(1, -85), (0.5, -57), (0.3, -62), (1, -85), (0.4, -56), (1, -85)]          # a very quiet lavalier, Auto's line far under -60


def test_a_stretch_silero_half_hears_is_kept_and_flagged_under_the_dead_channel_rule():
    db = db_frames(QUIET)
    assert SI.auto_threshold(db)["open"] < SI.SURE_MIN_DB
    p = np.zeros(len(db), bool)
    sure, half, none = np.zeros(len(db)), np.zeros(len(db)), np.zeros(len(db))
    idx = (np.arange(int(len(db) * SI.HOP_S * SR / 512) + 1) * 512 / SR / SI.HOP_S).astype(int).clip(0, len(db) - 1)
    pr = np.full(len(idx), 0.02, dtype=np.float32)
    pr[(idx >= AT(1.0)) & (idx < AT(1.8))] = 0.95                                   # the first word: Silero sure
    pr[(idx >= AT(2.8)) & (idx < AT(3.2))] = 0.6                                    # the second: only half (it misses short loud words)
    s = SI.settings({"mode": "silence", "method": "auto", "pacing": "measured"})
    unsure = np.zeros(len(db), bool)
    sp, _ = SI.item_speech(db, pr, None, s["min_speech"], None, True, unsure)
    assert sp[AT(1.0):AT(1.8)].all() and not sp[AT(2.8):AT(3.2)].any()               # sure: speech; half: not speech ...
    assert unsure[AT(2.8):AT(3.2)].all() and not unsure[:AT(2.7)].any()              # ... but marked unsure
    r = SI.label_item(db, pr, s)
    assert (r["labels"][AT(2.8):AT(3.2)] == SI.FLAG).all() and (r["labels"][AT(1.0):AT(1.8)] == SPEECH_).all()
    det = {"labels": r["labels"], "covered": np.ones(len(db), bool), "under": r["under"]}
    pl = SI.plan(det, s, 0.0)
    f = [x for x in pl["regions"] if x["flag"]]
    assert len(f) == 1 and f[0]["start"] <= 2.8 and f[0]["end"] >= 3.2 and "quiet sound" in f[0]["text"]
    assert not any(a < 3.2 and b > 2.8 for a, b in pl["cuts"])                       # kept
    # under HEARD (0.5) it is not speech and not unsure: hiss
    pr[(idx >= AT(2.8)) & (idx < AT(3.2))] = 0.3
    sp2, _ = SI.item_speech(db, pr, None, s["min_speech"], None, True, unsure2 := np.zeros(len(db), bool))
    assert not sp2[AT(2.8):AT(3.2)].any() and not unsure2.any()


SPEECH_ = SI.SPEECH


def test_the_dead_channel_rule_is_off_when_the_clip_is_the_only_microphone(monkeypatch):
    dead = _dead_db(20.0)
    none = _probs(dead, np.zeros(len(dead), bool))
    monkeypatch.setattr(SI, "measure", lambda it, cancelled=None: {"db": dead, "probs": none})
    s = SI.settings({"mode": "silence", "method": "auto", "pacing": "measured"})
    one = SI.detect([_it("x", 0, 20, 0.0, path="x.wav")], 0.0, 20.0, s=s)
    assert one["speech"].sum() > 300                                                # alone: the level decides, as before this rule
    two = SI.detect([_it("x", 0, 10, 0.0, path="x.wav"), _it("x2", 10, 20, 10.0, path="x.wav")], 0.0, 20.0, s=s)
    assert two["speech"].sum() > 300                                                # two ranges of ONE file are one microphone too
    both = SI.detect([_it("x", 0, 20, 0.0, path="x.wav"), _it("y", 0, 20, 0.0, path="y.wav")], 0.0, 20.0, s=s)
    assert both["speech"].sum() == 0                                                 # with another microphone the hiss is not speech
    assert SI.item_speech(dead, none, None, gate=False)[0].sum() > 300 and SI.item_speech(dead, none, None)[0].sum() == 0


# ---------------------------------------------------------------- 6. the word guard
def _words(*spec):
    """Scribe-shaped words: (text, start, end); many have start == end."""
    return [{"word": w, "start": a, "end": b, "p": 0.9} for w, a, b in spec]


def _cut_frames(pl, n):
    m = np.zeros(n, bool)
    for a, b in pl["cuts"]:
        m[AT(a):AT(b)] = True
    return m


PLAIN = [(1, Z), (2, S), (6, Z), (1, S), (1, Z)]                             # speech 1-3 and 9-10, silence 3-9


def _plan(words, body=None, det=None, spec=PLAIN):
    s = SI.settings({"mode": "ai", "method": "ai", "pacing": "measured", **(body or {})})
    return SI.plan(det or _labels(spec), s, 0.0, words), s


def test_a_cut_never_covers_the_start_of_a_word_even_when_scribe_gives_it_no_length():
    base, s = _plan([])
    assert any(a < 3.5 and b > 8.5 for a, b in base["cuts"])                  # without words one long cut
    pl, _ = _plan(_words(("Така", 5.0, 5.0)))
    assert not any(a < 5.0 and b > 4.85 + 0.011 for a, b in pl["cuts"])        # `before` (0.15 s) ahead of the start up to the word and its tail
    assert any(abs(b - 4.85) < 0.011 for a, b in pl["cuts"])                  # the cut before it ends exactly there
    assert any(a >= 5.4 and b >= 8.5 for a, b in pl["cuts"])                  # the quiet after it goes on being cut
    assert not [r for r in pl["regions"] if r["flag"]]                        # a word of no length: trimmed quietly, nothing to flag
    assert (_cut_frames(pl, len(_labels(PLAIN)["labels"])) <= _cut_frames(base, len(_labels(PLAIN)["labels"]))).all()


def test_a_word_mostly_inside_a_cut_is_kept_and_flagged():
    base, s = _plan([])
    pl, _ = _plan(_words(("тихо", 5.0, 5.6)))
    flag = [r for r in pl["regions"] if r["flag"] and r["kind"] == "silence"]
    assert len(flag) == 1 and not flag[0]["cut"] and "word" in flag[0]["text"]
    assert flag[0]["start"] <= 4.86 and flag[0]["end"] >= 5.6                  # the whole word, with its margin
    assert not any(a < 5.6 and b > 5.0 for a, b in pl["cuts"])
    # a word that starts in the speech and lies mostly inside the cut after it
    pl2, _ = _plan(_words(("дълго", 3.0, 3.6)))
    f2 = [r for r in pl2["regions"] if r["flag"]]
    assert len(f2) == 1 and f2[0]["start"] == pytest.approx(3.22, abs=0.02) and f2[0]["end"] >= 3.6 - 0.011
    assert not any(a < 3.6 and b > 3.0 for a, b in pl2["cuts"])
    # one that lies a quarter inside: not "mostly", and its start is outside the cut: nothing changes
    pl3, _ = _plan(_words(("къс", 2.9, 3.4)))                                 # 0.18 of 0.5 s inside the cut (3.22-): 36 %
    assert not [r for r in pl3["regions"] if r["flag"]] and pl3["cuts"] == base["cuts"]


def test_words_in_speech_and_hesitation_sounds_change_nothing():
    base, s = _plan([])
    pl, _ = _plan(_words(("Добър", 1.1, 1.5), ("ден", 1.6, 2.0), ("ъъъ", 5.0, 5.4), ("ъм", 6.0, 6.0), ("още", 9.2, 9.6)))
    assert pl["cuts"] == base["cuts"] and [r["kind"] for r in pl["regions"]] == [r["kind"] for r in base["regions"]]


def test_manual_db_stays_the_level_alone_even_with_words():
    body = {"mode": "ai", "method": "manual", "threshold": -40}
    base, s = _plan([], body)
    pl, _ = _plan(_words(("Така", 5.0, 5.6)), body)
    assert pl["cuts"] == base["cuts"] and not [r for r in pl["regions"] if r["flag"]]


def test_the_word_guard_never_cuts_more_and_leaves_the_editors_choices_alone():
    rng = np.random.default_rng(11)
    n = 2500
    for trial in range(40):
        lab = np.zeros(n, np.uint8)
        t = 0
        while t < n:
            k = int(rng.integers(20, 400))
            lab[t:t + k] = rng.choice([Z, S])
            t += k
        det = {"labels": lab, "covered": np.ones(n, bool), "under": np.zeros(n, dtype=np.float32)}
        words = []
        for _ in range(int(rng.integers(0, 25))):
            a = float(rng.uniform(0, 24.5))
            words.append({"word": "дума", "start": round(a, 2), "end": round(a + float(rng.choice([0.0, 0.0, 0.2, 0.7])), 2)})
        words.sort(key=lambda w: w["start"])
        s = SI.settings({"mode": "ai", "method": "ai", "pacing": rng.choice(["calm", "measured", "energetic"]), "short": bool(rng.integers(0, 2))})
        with_words = SI.plan({**det, "labels": lab.copy()}, s, 0.0, words)
        without = SI.plan({**det, "labels": lab.copy()}, s, 0.0, [])
        assert (_cut_frames(with_words, n) <= _cut_frames(without, n)).all(), trial
    # an override the editor made is the last word: the flagged word cut anyway stays cut, marked "you"
    pl, _ = _plan(_words(("тихо", 5.0, 5.6)))
    flag = next(r for r in pl["regions"] if r["flag"])
    over, _ = _plan(_words(("тихо", 5.0, 5.6)), {"overrides": [{"start": flag["start"], "end": flag["end"], "cut": True}]})
    mine = [r for r in over["regions"] if r.get("by") == "you"]
    assert len(mine) == 1 and mine[0]["cut"] and any(a <= flag["start"] + 0.011 and b >= flag["end"] - 0.011 for a, b in over["cuts"])


# ---------------------------------------------------------------- Manual dB + the AI rough cut (takes still apply)
def _take_group(takes, cut, rec=-1, safe=True, **extra):
    return {"kind": "exact", "kind_label": "repeated take", "safe": safe, "lost": [], "whole": False, "cut": cut, "recommended": rec % len(takes),
            "takes": [{"start": a, "end": b, "text": "Добър ден на всички", "n_words": 4, "ends": True} for a, b in takes], **extra}


def test_manual_db_in_the_ai_mode_cuts_silence_by_the_level_and_still_cuts_a_repeated_take():
    s = SI.settings({"mode": "ai", "method": "manual", "threshold": -40, "pacing": "measured", "fillers": True})
    assert (s["mode"], s["method"], s["threshold"], s["fillers"]) == ("ai", "manual", -40.0, True)
    assert SI.settings({"mode": "silence", "method": "manual", "threshold": -40, "fillers": True})["fillers"] is False      # not without the AI mode
    det = _labels([(1, Z), (3, S), (0.4, Z), (2, S), (0.4, Z), (2, S), (1, Z)])
    pl = SI.plan(det, s, 0.0, [], [_take_group([(4.4, 6.4), (6.8, 8.8)], [(4.4, 6.8)])])
    take = [r for r in pl["regions"] if r["kind"] == "take"]
    assert len(take) == 1 and take[0]["cut"] and take[0]["start"] == pytest.approx(4.4, abs=0.011)
    assert any(a < 1.0 and b > 0.5 for a, b in pl["cuts"])                    # the lead-in silence goes
    # said differently: listed, kept; hesitation sounds go too when the words are there
    g = _take_group([(4.4, 6.4), (6.8, 8.8)], [], safe=False)
    pl = SI.plan(det, s, 0.0, [], [g])
    assert [r["text"] for r in pl["regions"] if r["kind"] == "take"] and g["listed"]
    words = [{"word": " ъъъ,", "start": 3.35, "end": 3.75}]
    det2 = _labels([(1, Z), (2, S), (0.3, Z), (0.5, S), (0.3, Z), (2, S), (1, Z)])
    assert [r for r in SI.plan(det2, s, 0.0, words)["regions"] if r["kind"] == "filler"]


def test_listed_takes_say_why_when_they_are_far_apart_or_short():
    det = _labels([(1, Z), (3, S), (0.4, Z), (2, S), (0.4, Z), (2, S), (1, Z)])
    s = SI.settings({"mode": "ai", "method": "ai", "pacing": "measured"})
    for extra, text in (({"far": True}, "far apart"), ({"short": True}, "short phrase")):
        g = _take_group([(4.4, 6.4), (6.8, 8.8)], [], safe=False, **extra)
        pl = SI.plan(det, s, 0.0, [], [g])
        assert any(text in r["text"] for r in pl["regions"] if r["kind"] == "take")
