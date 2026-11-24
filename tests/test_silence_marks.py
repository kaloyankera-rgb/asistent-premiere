"""Cut silences, Mark repeated lines (0.10.157): the words are read, a repeated line gets one marker per take in the new
sequence, and nothing is cut because of it. No test reaches the network (the fixtures of test_silence_cloud_audit)."""
import os

from asistent import cloudasr, roughcut_job, silence as SI
from test_silence_cloud_audit import KEY, RUN, body, calls, home  # noqa: F401  (fixtures)


def group(a=(1.0, 2.0), b=(5.0, 6.0), rec=1):
    return {"kind": "exact", "kind_label": "repeated take", "recommended": rec, "safe": True, "lost": [], "whole": False,
            "cut": [(a[0], a[1])],
            "takes": [{"start": a[0], "end": a[1], "text": "Днес ще ви покажа", "n_words": 4, "ends": True},
                      {"start": b[0], "end": b[1], "text": "Днес ще ви покажа.", "n_words": 4, "ends": True}]}


def test_the_setting_is_off_unless_asked():
    assert SI.settings({"mode": "offmic"})["mark_takes"] is False
    assert SI.settings({"mode": "offmic", "mark_takes": True})["mark_takes"] is True


def test_every_take_that_stays_gets_a_marker_over_its_length():
    m = roughcut_job.take_marks([group()], [], lambda t: round(t * 30))
    assert [(x["frame"], x["end"], x["name"]) for x in m] == [(30, 60, "Repeat 1/2"), (150, 180, "Repeat 2/2")]
    assert "Asistent would keep take 2" in m[0]["comment"] and "Asistent would keep this take" in m[1]["comment"]
    assert "Днес ще ви покажа" in m[0]["comment"] and m[0]["group"] == m[1]["group"] == 0
    # a take that went has no marker and is not counted: one left alone is marked only when the AI rough cut took the others
    assert roughcut_job.take_marks([group()], [(0.9, 2.1)], lambda t: round(t * 30)) == []
    m = roughcut_job.take_marks([{**group(), "applied": True}], [(0.9, 2.1)], lambda t: round(t * 30))
    assert [x["name"] for x in m] == ["Repeat kept"] and "the other take was cut" in m[0]["comment"]
    three = group()
    three["takes"].append({"start": 8.0, "end": 9.0, "text": "Днес ще ви покажа.", "n_words": 4, "ends": True})
    three["recommended"] = 2
    m = roughcut_job.take_marks([three], [(0.9, 2.1)], lambda t: round(t * 30))            # the first of three went
    assert [x["name"] for x in m] == ["Repeat 1/2", "Repeat 2/2"]
    assert "said 3 times, 2 of them here, Asistent would keep take 2" in m[0]["comment"]
    three["recommended"] = 0                                                               # the one it would keep is not here: not named
    assert "Asistent" not in roughcut_job.take_marks([three], [(0.9, 2.1)], lambda t: round(t * 30))[0]["comment"]
    # a silence cut that only touches a take does not take its marker
    assert len(roughcut_job.take_marks([group()], [(1.8, 4.9)], lambda t: round(t * 30))) == 2
    long = group()
    long["takes"][0]["text"] = "а" * 200
    assert len(roughcut_job.take_marks([long], [], lambda t: 0)[0]["comment"]) < 160


def test_marking_reads_the_words_and_cuts_no_take(home, calls, monkeypatch):
    cloudasr.save({"key": KEY})
    monkeypatch.setattr(roughcut_job.takes, "find", lambda words: [group((3.0, 4.0), (6.0, 7.0))])   # inside the synthetic speech
    res = roughcut_job.run(body(home, mode="offmic", method="auto", fillers=False, mark_takes=True), *RUN)
    assert calls["cloud"] == 1 and res["speech"]["asr"] and res["mark_takes"] is True
    assert not any(r["kind"] == "take" for r in res["regions"]) and res["takes"] == [] and res["takes_cut_s"] == 0
    assert [m["name"] for m in res["marks"]] == ["Repeat 1/2", "Repeat 2/2"] and res["marked"] == 1
    # the same cut without it reads nothing and marks nothing, and it is the same cut: the words only place the markers
    roughcut_job._WORDS.clear()
    plain = roughcut_job.run(body(home, mode="offmic", method="auto", fillers=False), *RUN)
    assert calls["cloud"] == 1 and plain["marks"] == [] and plain["mark_takes"] is False
    assert plain["cuts"] == res["cuts"] and plain["regions"] == res["regions"]
    # the AI rough cut alone still marks nothing
    roughcut_job._WORDS.clear()
    assert roughcut_job.run(body(home, fillers=False), *RUN)["marks"] == []


def test_the_markers_are_where_the_takes_land_and_go_into_the_sequence_file(home, calls, monkeypatch):
    cloudasr.save({"key": KEY})
    monkeypatch.setattr(roughcut_job.takes, "find", lambda words: [group((3.0, 4.0), (6.0, 7.0))])   # inside the synthetic speech
    b = body(home, mode="offmic", method="auto", fillers=False, mark_takes=True, preview=False)
    res = roughcut_job.run(b, *RUN)
    kept = roughcut_job.edl.kept_ranges(0.0, 10.0, [(c["start"], c["end"]) for c in res["cuts"]])
    assert len(res["marks"]) == 2
    for m, t in zip(res["marks"], (3.0, 6.0)):
        assert m["frame"] == roughcut_job.edl.output_frame(kept, 30, t)
    def text(path):
        with open(path, encoding="utf-8") as f:
            return f.read()
    xml = text(res["xml"])
    assert xml.count("<marker>") == 2 and "<name>Repeat 1/2</name>" in xml
    assert "<in>%d</in><out>%d</out>" % (res["marks"][0]["frame"], res["marks"][0]["end"]) in xml      # the marker spans the take
    assert os.path.isfile(res["shell"]) and text(res["shell"]).count("<marker>") == 2
    # nothing moves with "keep the spaces": a marker stays where its take is
    roughcut_job._WORDS.clear()
    still = roughcut_job.run({**b, "action": "gaps", "preview": True}, *RUN)
    assert [(m["frame"], m["end"]) for m in still["marks"]] == [(90, 120), (180, 210)]
