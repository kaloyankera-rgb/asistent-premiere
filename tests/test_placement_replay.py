"""scripts/placement_replay.py on a tiny SYNTHETIC measurement run (no client data): the fit, the pieces, and a whole replay
through the real rule code (node + panel/placementplan.js)."""
import json
import os
import shutil
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import placement_replay as R  # noqa: E402

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")

FPS = 8


def _face(y):
    return [0.4, y, 0.2, 0.15, 0.95]


def make_video(work, tag, client, tops, chins):
    """8 one-second chunks over 10 s, one frame measured at 8 a second. A face at x .4-.6 whose chin follows `chins` per chunk;
    no recognised text. The editors' line top per chunk is `tops`."""
    n = 80
    faces = [[_face(chins[min(int(i / FPS / 1.2), 7)] - 0.15)] for i in range(n)]
    rows = []
    for k in range(8):
        t0 = round(k * 1.2, 3)
        mid = int(round((t0 + 0.5) * FPS))
        rows.append({
            "tag": tag, "client": client, "k": k, "t0": t0, "t1": t0 + 1.0, "tm": t0 + 0.5, "lines": 1,
            "sub_top": tops[k], "sub_h": 0.03, "sub_cy": tops[k] + 0.015, "sub_x0": 0.3, "sub_w": 0.4, "shot": 0,
            "chin": chins[k], "face_h": 0.15,
            "boxes": {"faces": [f[:4] for f in faces[mid]], "text": []},
        })
    meta = {"tag": tag, "client": client, "seconds": 10.0, "cuts": [], "punches": [], "ramps": [], "flat": False}
    d = os.path.join(work, tag)
    os.makedirs(d)
    for name, data in (("result.json", {"meta": meta, "rows": rows}), ("faces.json", faces), ("ocr.json", [[] for _ in range(n)])):
        with open(os.path.join(d, name), "w") as f:
            json.dump(data, f)
    return meta


@pytest.fixture
def work(tmp_path):
    w = str(tmp_path)
    chins = [0.35] * 4 + [0.5] * 4                        # a zoom brings the face down at chunk 4
    metas = [
        make_video(w, "01", "Aula", [0.47] * 8, [0.35] * 8),                       # training: the lane, no collision
        make_video(w, "02", "Aula", [0.47] * 4 + [0.55] * 4, chins),               # held out: the editors drop at the zoom
    ]
    with open(os.path.join(w, "videos.json"), "w") as f:
        json.dump(metas, f)
    return w


def test_fit_recovers_lane_and_clearance():
    chins = [0.30, 0.35, 0.50, 0.55, 0.60, None]
    tops = [max(0.47, c + 0.08) if c is not None else 0.47 for c in chins]
    f = R.fit_lane(tops, chins)
    assert abs(f["top"] - 0.47) < 0.003 and abs(f["k"] - 0.08) < 0.003 and f["n"] == 6
    assert R.fit_lane(tops, chins, 0.08)["k"] == 0.08


def test_pieces_cut_at_edits_and_slivers_join_their_neighbour():
    assert R.pieces_of(4.0, 6.0, [5.0]) == [(4.0, 5.0), (5.0, 6.0)]
    assert R.pieces_of(4.0, 6.0, [5.95]) == [(4.0, 6.0)]
    assert R.pieces_of(4.0, 6.0, []) == [(4.0, 6.0)]


def test_unknown_clients_use_the_pooled_group():
    assert R.group_of("Aula") == "aula" and R.group_of("Fornetti") == "default" and R.group_of("unknown") == "default"


def test_lanes_literal_lists_every_style():
    lanes = {k: {"top": 0.47, "k": 0.05, "n": 1} for k in ("default", "gstroy", "credissimo", "ekopak", "beautysector", "aula")}
    text = R.lanes_literal(lanes)
    assert text.startswith("const LANES = {") and text.count("top: 0.47") == 6 and "default:" in text


@needs_node
def test_replay_through_the_rule_code(work):
    vids = R.load(work)
    assert vids["01"]["train"] and not vids["02"]["train"]
    lanes, pooled, per_client, _ = R.fits(vids, "first", 0.05)
    assert abs(lanes["default"]["top"] - 0.47) < 0.003 and lanes["default"]["k"] == 0.05
    res, graphics, shots, zooms, moments = R.run_video(vids["02"], lanes["default"])
    assert [round(res[k]["top"], 3) for k in range(8)][:4] == [round(lanes["default"]["top"], 3)] * 4     # the lane while the face is clear
    assert all(res[k]["reason"] == "zoom brought a face" for k in range(4, 8))                        # the zoom brought it into the line
    assert all(res[k]["top"] == pytest.approx(0.55) for k in range(4, 8))                              # chin .50 + k .05, held, no stepping
    assert not any(r["flag"] for r in res.values())
    s = R.score(vids, ["02"], lanes, "first", 0.05)
    assert s["methods"]["new rule"]["face %"] == 0.0 and s["methods"]["editors"]["face %"] == 0.0
    assert s["methods"]["new rule"]["flagged %"] == 0.0
    assert s["methods"]["fixed top"]["face %"] > 0.0                                                   # a fixed lane does cover the face
    assert s["methods"]["new rule"]["MAE top, face chunks"] < 0.01
    assert s["methods"]["new rule"]["same-shot change % (top)"] == pytest.approx(100 / 7, abs=0.1)     # one change between the 7 pairs


@needs_node
def test_one_line_per_moment_over_the_cap(work):
    vids = R.load(work)
    graphics, shots, zooms = R.scenario(vids["02"])
    assert len(R.node({"op": "moments", "graphics": graphics, "zoomTimes": zooms, "cap": 240})) == 8
    assert len(R.node({"op": "moments", "graphics": graphics, "zoomTimes": zooms, "cap": 4})) <= 5
