"""Dev only: replay "Move off faces" lane placement on the editors' finished videos and score it.

Reads the measurement run of `measure_style.py placement` (<work>/<tag>/{faces,ocr,result}.json; private, outside the repo, never
committed), fits one lane per client on the TRAINING videos (odd tags), replays the rule on the HELD-OUT videos (even tags) and prints
the numbers against the editors and against a fixed median lane. The rule itself is not re-implemented here: every plan is made by
panel/placementplan.js through scripts/placement_rule_cli.js (node), so what is scored is the code the panel runs.

  placement_replay.py [--work DIR] [--eval test|train|all] [--base first|all] [--k K] [--emit-lanes] [--fits]

  --eval   which videos are scored (default test = held-out; train is for choosing between variants, never test)
  --base   how a shot's base is taken (placementplan.js planLanes opts.base)
  --k      the chin clearance k everywhere (default 0.05 = "lane + collision only"; L is still fitted per client); --fit-k fits it
  --min-face   what-if for the smallest face height that is an obstacle (code: 0.08)
  --client-k   also fit k per client (default: one pooled k, since a client's own k from one or two videos did not generalise)
  --emit-lanes   print the LANES literal for placementplan.js
  --fits   print the per-client fits

Fit: top = max(L, chin + k) per chunk, the chin being the shot's worst-case chin exactly as planLanes takes it, L and k
minimising the mean absolute error of the first line's top over the training chunks (a grid): k pooled over all clients, L per
client (k fitted per client on one or two videos did not carry over to the client's other videos). A client with a single video, or
too few training chunks, uses the pooled fit. Asistent Styles with their own lane: gstroy, credissimo, ekopak, beautysector, aula;
every other style (Auto, ReShape, Fornetti, ...) gets the pooled lane ("default").
Measurement conventions (placement_report.py): overlap = the subtitle box covers >= 10 % of an object's box, judged at the
chunk's middle frame; face chunks = a face of height >= 0.08.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import placement_report as PR  # noqa: E402  (hit(): the report's overlap rules)

FPS = 8
CLI = os.path.join(HERE, "placement_rule_cli.js")
DEFAULT_WORK = os.path.expanduser("~/Library/Application Support/Asistent/dev/placement")
STYLE_OF = {"Aula": "aula", "Beauty Sector": "beautysector", "Credissimo": "credissimo", "ЕКОПАК": "ekopak", "GStroy": "gstroy"}
MIN_PIECE = 0.1          # as placementplan.cover(): a piece of a line shorter than this over another shot joins its neighbour
MIN_FIT_CHUNKS = 30      # a client's own fit needs this many training chunks, and a second video


def node(query: dict):
    r = subprocess.run(["node", CLI], input=json.dumps(query), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


# ---------------------------------------------------------------- data

def _json(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return json.load(f)


def load(work: str):
    metas = {m["tag"]: m for m in _json(work, "videos.json")}
    vids = {}
    for tag, m in metas.items():
        d = os.path.join(work, tag)
        res = _json(d, "result.json")
        vids[tag] = {"meta": m, "rows": res["rows"], "faces": _json(d, "faces.json"), "ocr": _json(d, "ocr.json")}
        vids[tag]["train"] = int(tag) % 2 == 1
    return vids


def pieces_of(t0, t1, edits):
    """The stretches of a line between the cuts inside it (cover()'s rule: a sliver joins its longer neighbour)."""
    cuts = [t0] + [e for e in edits if t0 < e < t1] + [t1]
    while len(cuts) > 2:
        lens = [cuts[i + 1] - cuts[i] for i in range(len(cuts) - 1)]
        i = int(np.argmin(lens))
        if lens[i] >= MIN_PIECE:
            break
        if i == 0:
            del cuts[1]
        elif i == len(lens) - 1:
            del cuts[-2]
        elif lens[i - 1] >= lens[i + 1]:
            del cuts[i]
        else:
            del cuts[i + 1]
    return [(cuts[i], cuts[i + 1]) for i in range(len(cuts) - 1)]


def scenario(v):
    """graphics, shots and zoom times of one video, in the shape placementplan.js takes."""
    m = v["meta"]
    edits = sorted(list(m["cuts"]) + [p["t"] for p in m["punches"]])
    shot_of = lambda t: int(np.searchsorted(edits, t, side="right"))
    graphics = []
    for r in v["rows"]:
        pcs = pieces_of(r["t0"], r["t1"], edits)
        graphics.append({
            "id": r["k"], "start": r["t0"], "end": r["t1"], "center": r["sub_cy"], "motionY": 0.5,
            "lines": 2 if r["lines"] >= 2 else 1,
            "span": {"x0": r["sub_x0"], "x1": r["sub_x0"] + r["sub_w"]},
            "pieces": [{"from": a, "to": b, "shot": shot_of((a + b) / 2)} for a, b in pcs],
        })
    bounds = [0.0] + edits + [m["seconds"]]
    shots = [{"start": bounds[i], "end": bounds[i + 1]} for i in range(len(bounds) - 1)]
    zooms = sorted([r["t0"] for r in m["ramps"]] + [r["t1"] for r in m["ramps"]] + [p["t"] for p in m["punches"]])
    return graphics, shots, zooms


def per_line_frames(v, moments):
    """The frames the rule sees: at each moment the faces and the recognised text of the 8 fps frame nearest to it."""
    rows = {r["k"]: r for r in v["rows"]}
    n = len(v["faces"])
    out = {}
    for mo in moments:
        r = rows[mo["id"]]
        i = min(max(int(round(mo["t"] * FPS)), 0), n - 1)
        own = {"x": r["sub_x0"], "y": r["sub_top"], "w": r["sub_w"], "h": r["sub_h"]}
        out.setdefault(mo["id"], []).append({
            "t": mo["t"],
            "faces": [{"x": b[0], "y": b[1], "w": b[2], "h": b[3]} for b in v["faces"][i]],
            "text": v["ocr"][i], "own": [own],
        })
    return out


def run_video(v, lane, base="first", cap=240, min_face=None):
    graphics, shots, zooms = scenario(v)
    moments = node({"op": "moments", "graphics": graphics, "zoomTimes": zooms, "cap": cap})
    per = per_line_frames(v, moments)
    plans = node({"op": "planLanes", "graphics": graphics, "shots": shots, "perLine": per, "lane": lane,
                  "frame": 1 / 30, "opts": dict({"base": base}, **({} if min_face is None else {"minFace": min_face}))})
    by_id = {p["id"]: p for p in plans}
    out = {}
    for g, r in zip(graphics, v["rows"]):
        p = by_id[g["id"]]
        tops = p.get("tops") or [p["top"]]
        idx = 0
        for i, pc in enumerate(g["pieces"]):                       # the piece the chunk's middle frame falls in
            if pc["from"] <= r["tm"] < pc["to"]:
                idx = i
        out[r["k"]] = {"top": tops[idx], "reason": p["reason"], "flag": p["flag"], "chin": p["chin"]}
    return out, graphics, shots, zooms, moments


# ---------------------------------------------------------------- fit

def fit_lane(tops, chins, ks=None):
    """L and k minimising mean |top - max(L, chin + k)| (no chin: just L). Grid in steps of 0.002."""
    tops = np.asarray(tops, float)
    has = np.array([c is not None for c in chins])
    ch = np.array([c if c is not None else 0.0 for c in chins], float)
    best = (1e9, None, None)
    for k in (np.arange(0.0, 0.300001, 0.002) if ks is None else [ks]):
        for L in np.arange(0.30, 0.640001, 0.002):
            pred = np.where(has, np.maximum(L, ch + k), L)
            e = float(np.mean(np.abs(tops - pred)))
            if e < best[0] - 1e-12:
                best = (e, float(L), float(k))
    return {"top": round(best[1], 3), "k": round(best[2], 3), "n": int(len(tops)), "mae": round(best[0], 4)}


def fits(vids, base="first", k_fixed=None, shared_k=True, min_face=None):
    """chin per chunk, then the pooled fit, the per-client fits and the lane each Style gets."""
    dummy = {"top": 0.0, "k": 0.0}
    train = {t: v for t, v in vids.items() if v["train"]}
    rows = []
    for tag, v in train.items():
        res, *_ = run_video(v, dummy, base, min_face=min_face)
        for r in v["rows"]:
            rows.append({"tag": tag, "client": v["meta"]["client"], "top": r["sub_top"], "chin": res[r["k"]]["chin"]})
    pooled = fit_lane([r["top"] for r in rows], [r["chin"] for r in rows], k_fixed)
    nvid = {}
    for v in vids.values():
        nvid[v["meta"]["client"]] = nvid.get(v["meta"]["client"], 0) + 1
    per_client = {}
    for c in sorted({r["client"] for r in rows}):
        rs = [r for r in rows if r["client"] == c]
        kc = k_fixed if k_fixed is not None else (pooled["k"] if shared_k else None)
        per_client[c] = dict(fit_lane([r["top"] for r in rs], [r["chin"] for r in rs], kc), videos=nvid[c],
                             own=nvid[c] >= 2 and len(rs) >= MIN_FIT_CHUNKS)
    lanes = {"default": {k: pooled[k] for k in ("top", "k", "n")}}
    for client, style in STYLE_OF.items():
        f = per_client.get(client)
        lanes[style] = ({k: f[k] for k in ("top", "k", "n")} if f and f["own"] else dict(lanes["default"]))
    return lanes, pooled, per_client, rows


def lane_for(client, lanes):
    return lanes[STYLE_OF.get(client, "default")]


def group_of(client):
    return STYLE_OF.get(client, "default")


# ---------------------------------------------------------------- scoring

def face_chunk(r):
    return r["chin"] is not None and r["face_h"] is not None and r["face_h"] >= 0.08


def box(r, top):
    return (r["sub_x0"], top, r["sub_w"], r["sub_h"])


def above_face(r, top):
    """The line's box lies wholly above a face (height >= 0.08) that it overlaps horizontally, at the middle frame."""
    b = box(r, top)
    for f in r["boxes"]["faces"]:
        if f[3] >= 0.08 and min(b[0] + b[2], f[0] + f[2]) - max(b[0], f[0]) > 0 and b[1] + b[3] <= f[1]:
            return True
    return False


def score(vids, tags, lanes, base, k_fixed=None, min_face=None):
    """Everything the targets are about, for the editors, a fixed top lane, a fixed centre lane and the rule."""
    plan, flags = {}, {}
    for t in tags:
        res, *_ = run_video(vids[t], lane_for(vids[t]["meta"]["client"], lanes), base, min_face=min_face)
        for k, d in res.items():
            plan[(t, k)] = d
    rows = [(t, r) for t in tags for r in vids[t]["rows"]]
    flat = {t for t in tags if vids[t]["meta"]["flat"]}
    # fixed lanes: the median top / centre of the same training chunks the rule's lane was fitted on (own client, or all)
    def eff_group(client):
        g = group_of(client)
        return "default" if g == "default" or lanes[g] == lanes["default"] else g

    med_top, med_cy = {}, {}
    for g in {eff_group(v["meta"]["client"]) for v in vids.values()}:
        tr = [r for v in vids.values() if v["train"] and (g == "default" or eff_group(v["meta"]["client"]) == g) for r in v["rows"]]
        med_top[g] = float(np.median([r["sub_top"] for r in tr]))
        med_cy[g] = float(np.median([r["sub_cy"] for r in tr]))

    def tops_for(method, t, r):
        g = eff_group(vids[t]["meta"]["client"])
        if method == "editors":
            return r["sub_top"]
        if method == "fixed top":
            return med_top[g]
        if method == "fixed centre":
            return med_cy[g] - r["sub_h"] / 2
        return plan[(t, r["k"])]["top"]

    methods = ["editors", "fixed top", "fixed centre", "new rule"]
    out = {m: {} for m in methods}
    nonflat = [(t, r) for t, r in rows if t not in flat]
    fc = [(t, r) for t, r in nonflat if face_chunk(r)]
    for m in methods:
        o = out[m]
        fh, ft, ab, abx = 0, 0, 0, 0
        for t, r in nonflat:
            top = tops_for(m, t, r)
            b = box(r, top)
            h = PR.hit("face", b, r["boxes"]["faces"])
            tx = PR.hit("text", b, r["boxes"]["text"])
            fh += h
            ft += h or tx
            a = above_face(r, top)
            ab += a
            if m == "new rule":
                abx += a and not plan[(t, r["k"])]["flag"]
        n = max(len(nonflat), 1)
        o["face %"] = 100 * fh / n
        o["face|text %"] = 100 * ft / n
        o["above face"] = ab
        o["above face (unflagged)"] = abx if m == "new rule" else ab
        errs = [abs(tops_for(m, t, r) - r["sub_top"]) for t, r in fc]
        o["MAE top, face chunks"] = float(np.mean(errs)) if errs else float("nan")
        o["MAE centre, face chunks"] = float(np.mean([abs((tops_for(m, t, r) + r["sub_h"] / 2) - r["sub_cy"]) for t, r in fc])) if fc else float("nan")
        al = [abs(tops_for(m, t, r) - r["sub_top"]) for t, r in rows]
        o["MAE top, all chunks"] = float(np.mean(al)) if al else float("nan")
        # same-shot changes between consecutive chunks (gap <= 1 s)
        ch_top, ch_cy, npair = 0, 0, 0
        for tag in tags:
            if tag in flat:
                continue
            rs = sorted(vids[tag]["rows"], key=lambda r: r["t0"])
            for a, b2 in zip(rs, rs[1:]):
                if b2["t0"] - a["t1"] > 1.0 or a["shot"] != b2["shot"]:
                    continue
                npair += 1
                ta, tb = tops_for(m, tag, a), tops_for(m, tag, b2)
                ch_top += abs(tb - ta) > 0.02
                ch_cy += abs((tb + b2["sub_h"] / 2) - (ta + a["sub_h"] / 2)) > 0.02
        o["same-shot change % (top)"] = 100 * ch_top / max(npair, 1)
        o["same-shot change % (centre)"] = 100 * ch_cy / max(npair, 1)
    nflag = sum(plan[(t, r["k"])]["flag"] for t, r in nonflat)
    out["new rule"]["flagged %"] = 100 * nflag / max(len(nonflat), 1)
    moved = sum(plan[(t, r["k"])]["reason"] in ("off text", "zoom brought a face") for t, r in nonflat)
    out["new rule"]["moved by a collision %"] = 100 * moved / max(len(nonflat), 1)
    reasons = {}
    for t, r in nonflat:
        reasons[plan[(t, r["k"])]["reason"]] = reasons.get(plan[(t, r["k"])]["reason"], 0) + 1
    # per Style client: top MAE on face chunks, rule vs the client's own fixed top lane
    per = {}
    for client, style in STYLE_OF.items():
        cs = [(t, r) for t, r in fc if vids[t]["meta"]["client"] == client]
        ca = [(t, r) for t, r in rows if vids[t]["meta"]["client"] == client]
        if not ca:
            continue
        per[style] = {
            "n_face": len(cs), "n_all": len(ca),
            "rule": float(np.mean([abs(tops_for("new rule", t, r) - r["sub_top"]) for t, r in cs])) if cs else None,
            "fixed": float(np.mean([abs(tops_for("fixed top", t, r) - r["sub_top"]) for t, r in cs])) if cs else None,
            "rule_all": float(np.mean([abs(tops_for("new rule", t, r) - r["sub_top"]) for t, r in ca])),
            "fixed_all": float(np.mean([abs(tops_for("fixed top", t, r) - r["sub_top"]) for t, r in ca])),
        }
    return {"methods": out, "per_style": per, "n": len(nonflat), "n_face": len(fc), "n_all": len(rows), "flat": sorted(flat),
            "reasons": reasons, "videos": len(tags), "plan": plan}


TARGETS = [
    ("face %", "new rule", lambda v: v <= 0.5, "<= 0.5 (editors 0.3, fixed lane 3.0)"),
    ("face|text %", "new rule", lambda v: v <= 3.0, "<= 3"),
    ("above face (unflagged)", "new rule", lambda v: v == 0, "0"),
    ("MAE centre, face chunks", "new rule", lambda v: v <= 0.033, "<= .033 (fixed .0396)"),
    ("same-shot change % (top)", "new rule", lambda v: 10 <= v <= 15, "10-15"),
    ("flagged %", "new rule", lambda v: v <= 2.0, "<= 2"),
]


def report(s, title):
    P = print
    P("== %s: %d videos, %d chunks (%d with a face; flat pictures left out of overlap rows: %s) ==" % (
        title, s["videos"], s["n"], s["n_face"], s["flat"] or "none"))
    names = ["editors", "fixed top", "fixed centre", "new rule"]
    keys = ["face %", "face|text %", "above face", "above face (unflagged)", "MAE top, face chunks", "MAE centre, face chunks",
            "MAE top, all chunks", "same-shot change % (top)", "same-shot change % (centre)"]
    P("%-30s" % "" + "".join("%14s" % n for n in names))
    for k in keys:
        cells = []
        for n in names:
            v = s["methods"][n].get(k)
            cells.append("%14s" % ("" if v is None else ("%d" % v if k.startswith("above") else ("%.4f" % v if "MAE" in k else "%.1f" % v))))
        P("%-30s" % k + "".join(cells))
    P("%-30s%14s%14s%14s%14.1f" % ("flagged % (no free place)", "", "", "", s["methods"]["new rule"]["flagged %"]))
    P("%-30s%14s%14s%14s%14.1f" % ("moved by a collision %", "", "", "", s["methods"]["new rule"]["moved by a collision %"]))
    P("reasons: " + ", ".join("%s %d" % kv for kv in sorted(s["reasons"].items())))
    P("\nper Style client, top MAE on face chunks (rule vs the client's own fixed top lane; target: rule <= fixed + .005)")
    P("%-14s %7s %8s %9s %9s %s" % ("style", "n face", "n all", "rule", "fixed", "verdict"))
    for style, d in s["per_style"].items():
        if d["rule"] is None or d["n_face"] < 5:
            P("%-14s %7d %8d  (too few face chunks) all chunks: rule %.4f fixed %.4f" % (style, d["n_face"], d["n_all"], d["rule_all"], d["fixed_all"]))
            continue
        ok = d["rule"] <= d["fixed"] + 0.005
        P("%-14s %7d %8d %9.4f %9.4f %s   (all chunks: rule %.4f fixed %.4f)" % (style, d["n_face"], d["n_all"], d["rule"], d["fixed"], "OK" if ok else "FAIL", d["rule_all"], d["fixed_all"]))
    P("\ntargets (new rule)")
    allok = True
    for key, m, test, want in TARGETS:
        v = s["methods"][m][key]
        ok = test(v)
        allok &= ok
        P("  %-28s %8.3f   want %-28s %s" % (key, v, want, "OK" if ok else "FAIL"))
    for style, d in s["per_style"].items():
        if d["rule"] is not None and d["n_face"] >= 5 and d["rule"] > d["fixed"] + 0.005:
            allok = False
    P("  all targets met: %s" % allok)
    return allok


def lanes_literal(lanes):
    order = ["default", "gstroy", "credissimo", "ekopak", "beautysector", "aula"]
    body = "".join("  %s: { top: %s, k: %s, n: %d },\n" % (k, lanes[k]["top"], lanes[k]["k"], lanes[k]["n"]) for k in order)
    return "const LANES = {\n" + body + "};"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--work", default=DEFAULT_WORK)
    ap.add_argument("--eval", default="test", choices=["test", "train", "all"])
    ap.add_argument("--base", default="first", choices=["first", "all"])
    ap.add_argument("--k", type=float, default=0.05)
    ap.add_argument("--fit-k", action="store_true", help="fit k from the training chunks instead of fixing it")
    ap.add_argument("--min-face", type=float, default=None, help="what-if: smallest face height that counts as an obstacle (code: 0.08)")
    ap.add_argument("--client-k", action="store_true", help="fit k per client too (default: one pooled k, L per client)")
    ap.add_argument("--emit-lanes", action="store_true")
    ap.add_argument("--fits", action="store_true")
    a = ap.parse_args()
    if a.fit_k:
        a.k = None
    vids = load(a.work)
    lanes, pooled, per_client, _ = fits(vids, a.base, a.k, not a.client_k, a.min_face)
    if a.fits:
        print("pooled fit (training, %d chunks): L %.3f k %.3f MAE %.4f" % (pooled["n"], pooled["top"], pooled["k"], pooled["mae"]))
        for c, f in per_client.items():
            print("  %-14s videos %d training chunks %4d  L %.3f k %.3f MAE %.4f  %s" % (
                c[:14], f["videos"], f["n"], f["top"], f["k"], f["mae"], "own lane" if f["own"] else "-> pooled"))
        print("lanes by Style:", json.dumps(lanes))
    tags = [t for t, v in vids.items() if (a.eval == "all" or (v["train"] == (a.eval == "train")))]
    s = score(vids, tags, lanes, a.base, a.k, a.min_face)
    report(s, "%s videos, base=%s%s%s" % (a.eval, a.base, "" if a.k is None else ", k=%.3f" % a.k, "" if a.min_face is None else ", minFace=%.3f" % a.min_face))
    if a.emit_lanes:
        print("\n" + lanes_literal(lanes))


if __name__ == "__main__":
    main()
