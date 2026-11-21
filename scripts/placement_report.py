"""Dev only: the tables of `measure_style.py placement-report <work>`, from <work>/chunks_rows.json and videos.json.

Overlap rules (one place, so the counterfactual lines use the very same ones):
  face, hand, handbig (hands over 1 % of the frame), text - the subtitle box covers >= 10 % of the object's box
  human, salient    - big boxes: >= 50 % of the subtitle box lies inside the object's box
The counterfactual is a subtitle box of the same width, height and x-centre at a fixed centre y (the client's median, or 0.50)
over the same frames, so what the editors avoid shows as the gap between the two rates.
"""
from __future__ import annotations

import json
import os
from collections import Counter, defaultdict

import numpy as np

CATS = ("face", "hand", "handbig", "text", "human", "sal")
BOX_KEY = {"face": "faces", "hand": "hands", "handbig": "hands_big", "text": "text", "human": "humans", "sal": "salient"}
HAND_BIG = 0.01          # hands under 1 % of the frame (median 0.35 %) are mostly far-away or partly seen ones


def _inter(a, b):
    w = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    h = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    return max(w, 0) * max(h, 0)


def hit(cat, sub, boxes):
    sa = max(sub[2] * sub[3], 1e-9)
    for b in boxes:
        i = _inter(sub, b)
        if cat in ("human", "sal"):
            if i / sa >= 0.5:
                return True
        elif i / max(b[2] * b[3], 1e-9) >= 0.10:
            return True
    return False


def sub_box(r, cy=None):
    cy = r["sub_cy"] if cy is None else cy
    return (r["sub_x0"], cy - r["sub_h"] / 2, r["sub_w"], r["sub_h"])


def hits(r, cy=None):
    sb = sub_box(r, cy)
    return {c: hit(c, sb, r["boxes"][BOX_KEY[c]]) for c in CATS}


def pct(v, p):
    return float(np.percentile(v, p)) if len(v) else float("nan")


def stats(v):
    return "n=%-4d med %.3f p10 %.3f p90 %.3f" % (len(v), np.median(v) if len(v) else float("nan"), pct(v, 10), pct(v, 90))


def report(work):
    rows = json.load(open(os.path.join(work, "chunks_rows.json")))
    metas = json.load(open(os.path.join(work, "videos.json")))
    for r in rows:
        r["boxes"]["hands_big"] = [b for b in r["boxes"]["hands"] if b[2] * b[3] >= HAND_BIG]
    out = []
    P = lambda *a: (print(*a), out.append(" ".join(str(x) for x in a)))
    clients = sorted({r["client"] for r in rows})
    by_client = {c: [r for r in rows if r["client"] == c] for c in clients}
    P("== videos ==")
    P("%-3s %-14s %6s %-5s %-4s %6s %6s %6s %6s %5s %5s %5s" % ("tag", "client", "secs", "mode", "asp", "chunks", "ch/min", "subcov", "face%", "cuts", "punch", "ramps"))
    for m in metas:
        asp = "9:16" if m["h"] > m["w"] * 1.4 else "16:9"
        P("%-3s %-14s %6.1f %-5s %-4s %6d %6.1f %6.2f %6.2f %5d %5d %5d" % (
            m["tag"], m["client"][:14], m["seconds"], m["mode"], asp, m["chunks"], m["chunks"] / m["seconds"] * 60,
            m["coverage_caps_any"][m["mode"]], m["frames_with_face"], len(m["cuts"]), len(m["punches"]), len(m["ramps"])))
    flat = {m["tag"] for m in metas if m["flat"]}
    if flat:
        P("flat picture (counts for the y distribution only): videos %s" % sorted(flat))
    med = {}
    for c in clients:
        for asp in {r["aspect"] for r in by_client[c]}:
            med[(c, asp)] = float(np.median([r["sub_cy"] for r in by_client[c] if r["aspect"] == asp]))
    for r in rows:
        r["med"] = med[(r["client"], r["aspect"])]

    P("\n== 1. subtitle centre y (fraction of frame height) ==")
    for c in clients:
        P("%-14s %s" % (c[:14], stats([r["sub_cy"] for r in by_client[c]])))
    P("ALL            %s" % stats([r["sub_cy"] for r in rows]))
    for asp in sorted({r["aspect"] for r in rows}):
        P("aspect %-6s %s" % (asp, stats([r["sub_cy"] for r in rows if r["aspect"] == asp])))
    for name, f in (("face", lambda r: r["face_found"]), ("no face", lambda r: not r["face_found"])):
        P("%-14s %s" % (name, stats([r["sub_cy"] for r in rows if f(r)])))
    P("lines: 1 line %d, 2 lines %d; sub height median %.3f; width median %.3f; xc median %.3f p10 %.3f p90 %.3f" % (
        sum(r["lines"] == 1 for r in rows), sum(r["lines"] == 2 for r in rows), np.median([r["sub_h"] for r in rows]),
        np.median([r["sub_w"] for r in rows]), np.median([r["sub_xc"] for r in rows]), pct([r["sub_xc"] for r in rows], 10),
        pct([r["sub_xc"] for r in rows], 90)))

    rows = [r for r in rows if r["tag"] not in flat]               # from here on: pictures that really show something
    metas = [m for m in metas if not m["flat"]]
    by_client = {c: [r for r in rows if r["client"] == c] for c in clients}
    clients = [c for c in clients if by_client[c]]
    P("(sections 2-11 leave out the flat file: %d chunks, %d videos left)" % (len(rows), len(metas)))

    P("\n== 2. against the chin (chunks with a face, face height >= 0.08) ==")
    P("%-14s %5s %9s %9s %8s %8s %8s %8s" % ("client", "n", "top-chin", "cy-chin", "spread", "MAE chin", "MAE fixed", "MAE chin LOVO"))
    def chin_rows(rs):
        return [r for r in rs if r["chin"] is not None and r["face_h"] >= 0.08]
    for c in clients + ["ALL"]:
        rs = chin_rows(rows if c == "ALL" else by_client[c])
        if len(rs) < 5:
            P("%-14s %5d (too few)" % (c[:14], len(rs)))
            continue
        k = np.median([r["off_chin_cy"] for r in rs])
        fixed = np.median([r["sub_cy"] for r in rs])
        e_chin = np.mean([abs(r["off_chin_cy"] - k) for r in rs])
        e_fixed = np.mean([abs(r["sub_cy"] - fixed) for r in rs])
        # leave one video out: k and the fixed y from the other videos of the client (ALL: of the other clients)
        lo_chin, lo_fixed = [], []
        key = "tag" if c != "ALL" else "client"
        for g in {r[key] for r in rs}:
            tr_ = [r for r in rs if r[key] != g]
            te = [r for r in rs if r[key] == g]
            if len(tr_) < 5:
                continue
            k2, f2 = np.median([r["off_chin_cy"] for r in tr_]), np.median([r["sub_cy"] for r in tr_])
            lo_chin += [abs(r["off_chin_cy"] - k2) for r in te]
            lo_fixed += [abs(r["sub_cy"] - f2) for r in te]
        P("%-14s %5d %9.3f %9.3f %8.3f %8.3f %8.3f %8s" % (
            c[:14], len(rs), np.median([r["off_chin_top"] for r in rs]), k, np.std([r["off_chin_cy"] for r in rs]), e_chin, e_fixed,
            "%.3f/%.3f" % (np.mean(lo_chin), np.mean(lo_fixed)) if lo_chin else "-"))
    rs = chin_rows(rows)
    P("top-chin p10/p50/p90 over all: %.3f / %.3f / %.3f" % (pct([r["off_chin_top"] for r in rs], 10), pct([r["off_chin_top"] for r in rs], 50), pct([r["off_chin_top"] for r in rs], 90)))
    P("chin height bins -> subtitle centre y and the line's place against the face (all clients):")
    for lo, hi in ((0.0, 0.35), (0.35, 0.45), (0.45, 0.55), (0.55, 0.65), (0.65, 1.0)):
        b = [r for r in rs if lo <= r["chin"] < hi]
        if b:
            above = np.mean([r["sub_bottom"] <= r["face_top"] for r in b])
            below = np.mean([r["sub_top"] >= r["chin"] for r in b])
            P("  chin %.2f-%.2f n=%-4d cy med %.3f p10 %.3f p90 %.3f | line above face %.0f%%, below chin %.0f%%, beside/over %.0f%%" % (
                lo, hi, len(b), np.median([r["sub_cy"] for r in b]), pct([r["sub_cy"] for r in b], 10), pct([r["sub_cy"] for r in b], 90),
                100 * above, 100 * below, 100 * (1 - above - below)))

    P("\n== 3. overlap rates: editors vs a fixed line at the client's median y vs at 0.50 (same frames; %) ==")
    P("%-14s %5s | %s" % ("client", "n", " | ".join("%-17s" % (c + " ed/med/.50") for c in CATS)))
    H = {}
    for r in rows:
        H[id(r)] = (hits(r), hits(r, r["med"]), hits(r, 0.5))
    for c in clients + ["ALL"]:
        rs = rows if c == "ALL" else by_client[c]
        cells = []
        for cat in CATS:
            cells.append("%5.1f/%5.1f/%5.1f  " % tuple(100 * np.mean([H[id(r)][j][cat] for r in rs]) for j in range(3)))
        P("%-14s %5d | %s" % (c[:14], len(rs), " | ".join(cells)))
    P("any of face/big hand/text:")
    for c in clients + ["ALL"]:
        rs = rows if c == "ALL" else by_client[c]
        anyf = lambda j: 100 * np.mean([any(H[id(r)][j][x] for x in ("face", "handbig", "text")) for r in rs])
        P("  %-14s editors %5.1f   fixed median %5.1f   fixed 0.50 %5.1f" % (c[:14], anyf(0), anyf(1), anyf(2)))
    fr = [r for r in rows if r["face_found"] and r["face_h"] >= 0.08]
    P("face overlap on chunks with a face (n=%d): editors %.1f%%, fixed median %.1f%%, fixed 0.50 %.1f%%; any-touch (>0) editors %.1f%%" % (
        len(fr), *[100 * np.mean([H[id(r)][j]["face"] for r in fr]) for j in range(3)], 100 * np.mean([r["face_cov"] > 0 for r in fr])))

    P("\n== 4. chunks whose y differs from the client median by > 0.05: what was at the median position ==")
    dev = [r for r in rows if abs(r["sub_cy"] - r["med"]) > 0.05]
    P("n=%d of %d (%.0f%%); above median %d, below %d" % (len(dev), len(rows), 100 * len(dev) / len(rows),
                                                           sum(r["sub_cy"] < r["med"] for r in dev), sum(r["sub_cy"] > r["med"] for r in dev)))
    def at_median(rs, title):
        cnt = Counter()
        for r in rs:
            h = H[id(r)][1]
            for k, x in h.items():
                cnt[k] += x
            cnt["nothing (no face/big hand/text)"] += not (h["face"] or h["handbig"] or h["text"])
            cnt["nothing at all"] += not any(h.values())
        P("  %s n=%d: %s" % (title, len(rs), ", ".join("%s %d" % (k, v) for k, v in cnt.items())))
    at_median(dev, "all deviating")
    at_median([r for r in dev if r["sub_cy"] < r["med"]], "moved above")
    at_median([r for r in dev if r["sub_cy"] > r["med"]], "moved below")
    at_median([r for r in rows if abs(r["sub_cy"] - r["med"]) <= 0.05], "kept at median (for comparison)")
    for c in clients:
        d = [r for r in dev if r["client"] == c]
        if d:
            P("   %-14s deviating %d of %d" % (c[:14], len(d), len(by_client[c])))

    # ---- zoom and edit points
    P("\n== 5. cuts, punch-ins, zoom ramps ==")
    P("hard cuts %d, punch-in/out jumps %d (in %d / out %d), ramps %d (in %d / out %d) over %.0f s of video" % (
        sum(len(m["cuts"]) for m in metas), sum(len(m["punches"]) for m in metas),
        sum(p["ls"] > 0 for m in metas for p in m["punches"]), sum(p["ls"] < 0 for m in metas for p in m["punches"]),
        sum(len(m["ramps"]) for m in metas), sum(p["ls"] > 0 for m in metas for p in m["ramps"]),
        sum(p["ls"] < 0 for m in metas for p in m["ramps"]), sum(m["seconds"] for m in metas)))
    pj = [abs(p["ls"]) for m in metas for p in m["punches"]]
    rj = [abs(p["ls"]) for m in metas for p in m["ramps"]]
    P("punch size (log scale) median %.3f p90 %.3f; ramp total median %.3f p90 %.3f" % (np.median(pj) if pj else 0, pct(pj, 90), np.median(rj) if rj else 0, pct(rj, 90)))
    for c in clients:
        ms = [m for m in metas if m["client"] == c]
        P("  %-14s cuts %3d  punches %3d  ramps %3d  (per minute: %.1f / %.1f / %.1f)" % (c[:14], sum(len(m["cuts"]) for m in ms), sum(len(m["punches"]) for m in ms),
          sum(len(m["ramps"]) for m in ms), *[60 * sum(len(m[k]) for m in ms) / sum(m["seconds"] for m in ms) for k in ("cuts", "punches", "ramps")]))
    zc = [r for r in rows if r["face_h_vs_shot_first"] is not None and not r["shot_first_chunk"] and abs(r["zoom_vs_shot_first"]) > 0.02]
    if len(zc) > 5:
        P("zoom check (chunks after the first of a shot, |zoom| > 2 %%, n=%d): corr(face size change, picture scale change) = %.2f; median ratio %.2f" % (
            len(zc), np.corrcoef([r["face_h_vs_shot_first"] for r in zc], [r["zoom_vs_shot_first"] for r in zc])[0, 1],
            np.median([r["face_h_vs_shot_first"] / r["zoom_vs_shot_first"] for r in zc])))
    P("chunks inside a ramp: %d; their y change within the chunk: median |%.4f|, > 0.01 in %.0f%%; chunks outside: median |%.4f|, > 0.01 in %.0f%%" % (
        sum(r["ramp"] for r in rows), np.median([abs(r["cy_end"] - r["cy_start"]) for r in rows if r["ramp"]] or [0]),
        100 * np.mean([abs(r["cy_end"] - r["cy_start"]) > 0.01 for r in rows if r["ramp"]] or [0]),
        np.median([abs(r["cy_end"] - r["cy_start"]) for r in rows if not r["ramp"]]),
        100 * np.mean([abs(r["cy_end"] - r["cy_start"]) > 0.01 for r in rows if not r["ramp"]])))

    # ---- where y changes happen: consecutive chunks of one video
    P("\n== 6. where y changes happen (consecutive chunks, gap <= 1 s; change = centre differs by > 0.02) ==")
    cats = defaultdict(list)
    pairs = []
    for tag in sorted({r["tag"] for r in rows}):
        rs = sorted([r for r in rows if r["tag"] == tag], key=lambda r: r["t0"])
        m = next(x for x in metas if x["tag"] == tag)
        hard = np.array(m["cuts"])
        pun = np.array([p["t"] for p in m["punches"]])
        for a, b in zip(rs, rs[1:]):
            if b["t0"] - a["t1"] > 1.0:
                continue
            hc = bool(len(hard) and ((hard > a["tm"]) & (hard <= b["tm"])).any())
            pc = bool(len(pun) and ((pun > a["tm"]) & (pun <= b["tm"])).any())
            zoom = sum(r["zoom_in_chunk"] for r in (a, b)) / 2   # placeholder, replaced below by the exact span
            # exact scale change between the two chunk middles inside the same shot: sum of the ramps that overlap the span
            span = sum(rm["ls"] for rm in m["ramps"] if rm["t0"] < b["tm"] and rm["t1"] > a["tm"])
            kind = "hard cut" if hc else ("punch-in" if pc else ("same shot, zoom" if abs(span) >= 0.03 else "same shot, no zoom"))
            dy = b["sub_cy"] - a["sub_cy"]
            pairs.append((kind, dy, a, b, span))
            cats[kind].append(abs(dy) > 0.02)
    P("%-20s %6s %8s %12s" % ("between chunks", "pairs", "changed", "share changed"))
    for k in ("hard cut", "punch-in", "same shot, zoom", "same shot, no zoom"):
        v = cats[k]
        P("%-20s %6d %8d %11.0f%%" % (k, len(v), sum(v), 100 * np.mean(v) if v else 0))
    ch = sum(sum(v) for v in cats.values())
    P("of %d y changes: %s" % (ch, ", ".join("%s %d (%.0f%%)" % (k, sum(cats[k]), 100 * sum(cats[k]) / max(ch, 1)) for k in cats)))
    for k in ("hard cut", "punch-in", "same shot, zoom", "same shot, no zoom"):
        d = [abs(p[1]) for p in pairs if p[0] == k and abs(p[1]) > 0.02]
        if d:
            P("   size of the change at '%s': median %.3f p90 %.3f" % (k, np.median(d), pct(d, 90)))
    P("movement inside one chunk (cy_range > 0.01): %d of %d chunks; with an edit inside the chunk %d of %d; with a ramp %d of %d" % (
        sum(r["cy_range"] > 0.01 for r in rows), len(rows), sum(r["cy_range"] > 0.01 and r["edit_in_chunk"] for r in rows), sum(r["edit_in_chunk"] for r in rows),
        sum(r["cy_range"] > 0.01 and r["ramp"] for r in rows), sum(r["ramp"] for r in rows)))

    P("\n== 7. y and the chin through zoom and through cuts (pairs of consecutive chunks, both with a face) ==")
    for kind in ("same shot, zoom", "same shot, no zoom", "punch-in", "hard cut"):
        ps = [p for p in pairs if p[0] == kind and p[2]["chin"] is not None and p[3]["chin"] is not None
              and p[2]["face_h"] >= 0.08 and p[3]["face_h"] >= 0.08]
        if len(ps) < 4:
            P("  %-20s n=%d (too few)" % (kind, len(ps)))
            continue
        dy = np.array([p[1] for p in ps]); dc = np.array([p[3]["chin"] - p[2]["chin"] for p in ps])
        corr = np.corrcoef(dy, dc)[0, 1] if dy.std() > 0 and dc.std() > 0 else float("nan")
        # keep-offset-to-chin rule: the new y = old y + change of chin; fixed rule: new y = old y
        P("  %-20s n=%-4d mean |dchin| %.3f, mean |dy| %.3f, corr(dy, dchin) %.2f; error of 'follow the chin' %.3f vs 'stay fixed' %.3f" % (
            kind, len(ps), np.abs(dc).mean(), np.abs(dy).mean(), corr, np.abs(dy - dc).mean(), np.abs(dy).mean()))
    zs = [p for p in pairs if p[0] == "same shot, zoom" and p[2]["chin"] is not None and p[3]["chin"] is not None]
    big = [p for p in zs if abs(p[3]["chin"] - p[2]["chin"]) > 0.03]
    if big:
        P("  zoom pairs where the chin moved > 0.03 (n=%d): y changed > 0.02 in %.0f%%; error of follow-chin %.3f vs fixed %.3f" % (
            len(big), 100 * np.mean([abs(p[1]) > 0.02 for p in big]), np.mean([abs(p[1] - (p[3]["chin"] - p[2]["chin"])) for p in big]),
            np.mean([abs(p[1]) for p in big])))
    P("subtitle y before / after punch-ins (nearest chunks each side within 1.5 s):")
    jumps = []
    for tag in sorted({r["tag"] for r in rows}):
        rs = sorted([r for r in rows if r["tag"] == tag], key=lambda r: r["t0"])
        m = next(x for x in metas if x["tag"] == tag)
        for pj_ in m["punches"]:
            before = [r for r in rs if r["tm"] < pj_["t"] and pj_["t"] - r["tm"] < 1.5]
            after = [r for r in rs if r["tm"] >= pj_["t"] and r["tm"] - pj_["t"] < 1.5]
            if before and after:
                jumps.append((pj_["ls"], after[0]["sub_cy"] - before[-1]["sub_cy"], before[-1], after[0]))
    if jumps:
        dy = np.array([j[1] for j in jumps])
        P("  %d punches with chunks on both sides: y changed > 0.02 in %.0f%%; median |dy| %.3f; zoom in (n=%d) mean dy %.3f, zoom out (n=%d) mean dy %.3f" % (
            len(jumps), 100 * np.mean(np.abs(dy) > 0.02), np.median(np.abs(dy)), sum(j[0] > 0 for j in jumps),
            np.mean([j[1] for j in jumps if j[0] > 0] or [0]), sum(j[0] < 0 for j in jumps), np.mean([j[1] for j in jumps if j[0] < 0] or [0])))
        ed = [j for j in jumps if abs(j[0]) <= 0.35]            # a plausible editorial punch-in/out (up to x1.4)
        if ed:
            d2 = np.array([j[1] for j in ed])
            P("  only jumps up to 0.35 in log scale (n=%d): y changed > 0.02 in %.0f%%; median |dy| %.4f" % (len(ed), 100 * np.mean(np.abs(d2) > 0.02), np.median(np.abs(d2))))
        wf = [j for j in jumps if j[2]["chin"] is not None and j[3]["chin"] is not None]
        if wf:
            P("  with faces on both sides (n=%d): mean |dchin| %.3f, mean |dy| %.3f, error of follow-chin %.3f vs fixed %.3f" % (
                len(wf), np.mean([abs(j[3]["chin"] - j[2]["chin"]) for j in wf]), np.mean([abs(j[1]) for j in wf]),
                np.mean([abs(j[1] - (j[3]["chin"] - j[2]["chin"])) for j in wf]), np.mean([abs(j[1]) for j in wf])))


    # ---- avoidance: direction, and moves triggered by a collision
    P("\n== 9. what the editors did where a fixed line at the client's median would collide ==")
    for cat in ("face", "handbig", "text"):
        hs = [r for r in rows if H[id(r)][1][cat]]
        if not hs:
            continue
        dy = np.array([r["sub_cy"] - r["med"] for r in hs])
        P("  median-line hits %-7s n=%-4d: editors moved down %d / up %d / stayed (|dy|<=0.01) %d; median dy %.3f; p10 %.3f p90 %.3f; after the move still hit %.0f%%" % (
            cat, len(hs), (dy > 0.01).sum(), (dy < -0.01).sum(), (np.abs(dy) <= 0.01).sum(), np.median(dy), pct(dy, 10), pct(dy, 90),
            100 * np.mean([H[id(r)][0][cat] for r in hs])))
    P("  consecutive chunks (same video, gap <= 1 s): would the PREVIOUS chunk's y collide on the new chunk's frame, and did y change?")
    pr = []
    for tag in sorted({r["tag"] for r in rows}):
        rs = sorted([r for r in rows if r["tag"] == tag], key=lambda r: r["t0"])
        for a, b in zip(rs, rs[1:]):
            if b["t0"] - a["t1"] <= 1.0:
                hh = hits(b, a["sub_cy"])
                pr.append((hh, b["sub_cy"] - a["sub_cy"], a, b))
    for name, f in (("collides with a face", lambda hh: hh["face"]), ("collides with a big hand", lambda hh: hh["handbig"]),
                    ("collides with other text", lambda hh: hh["text"]),
                    ("collides with face/hand/text", lambda hh: hh["face"] or hh["handbig"] or hh["text"]),
                    ("no collision", lambda hh: not (hh["face"] or hh["handbig"] or hh["text"]))):
        s = [(dy, b) for hh, dy, a, b in pr if f(hh)]
        if s:
            d = np.array([x[0] for x in s])
            P("    %-30s pairs %-5d y changed (>0.02) %.0f%%; of those down %d up %d; median |dy| when changed %.3f; the new y collides %.0f%%" % (
                name, len(s), 100 * np.mean(np.abs(d) > 0.02), (d > 0.02).sum(), (d < -0.02).sum(),
                np.median(np.abs(d)[np.abs(d) > 0.02]) if (np.abs(d) > 0.02).any() else 0,
                100 * np.mean([any(H[id(x[1])][0][k] for k in ("face", "handbig", "text")) for x in s])))

    # ---- anchors and lanes
    P("\n== 10. what stays fixed: top, centre or bottom of the line; fixed lane or follows the face ==")
    P("%-14s %5s %7s %7s %7s | share within 0.01 of the client median: top / centre / bottom | within 0.01 of the median centre" % ("client", "n", "MADtop", "MADcen", "MADbot"))
    top_best = 0
    lanes = []
    for c in clients:
        rs = by_client[c]
        v = {k: np.array([r[k] for r in rs]) for k in ("sub_top", "sub_cy", "sub_bottom")}
        mad = {k: float(np.median(np.abs(x - np.median(x)))) for k, x in v.items()}
        share = {k: float(np.mean(np.abs(x - np.median(x)) <= 0.01)) for k, x in v.items()}
        top_best += mad["sub_top"] <= mad["sub_cy"]
        lanes.append(share["sub_cy"])
        P("%-14s %5d %7.3f %7.3f %7.3f | %.0f%% / %.0f%% / %.0f%%" % (c[:14], len(rs), mad["sub_top"], mad["sub_cy"], mad["sub_bottom"], 100 * share["sub_top"], 100 * share["sub_cy"], 100 * share["sub_bottom"]))
    P("top edge is the most stable (MAD <= centre's) in %d of %d clients; fixed lane (>= 70%% of chunks within 0.01 of the median centre): %s" % (
        top_best, len(clients), [c[:10] for c, s in zip(clients, lanes) if s >= 0.7]))
    two = [r for r in rows if r["lines"] == 2]; one = [r for r in rows if r["lines"] == 1]
    P("1 line: centre %.3f top %.3f; 2 lines: centre %.3f top %.3f (a second line grows downward when top barely moves: top diff %.3f, centre diff %.3f)" % (
        np.median([r["sub_cy"] for r in one]), np.median([r["sub_top"] for r in one]), np.median([r["sub_cy"] for r in two]),
        np.median([r["sub_top"] for r in two]), np.median([r["sub_top"] for r in two]) - np.median([r["sub_top"] for r in one]),
        np.median([r["sub_cy"] for r in two]) - np.median([r["sub_cy"] for r in one])))
    # within one client and one shot-free comparison: top / centre difference between its 1-line and 2-line chunks
    P("per client, median of the 2-line minus 1-line chunks: top / centre (negative top = line starts higher)")
    for c in clients:
        o1 = [r for r in by_client[c] if r["lines"] == 1]; o2 = [r for r in by_client[c] if r["lines"] == 2]
        if len(o1) >= 5 and len(o2) >= 5:
            P("   %-14s n1=%-4d n2=%-4d top %+.3f centre %+.3f" % (c[:14], len(o1), len(o2), np.median([r["sub_top"] for r in o2]) - np.median([r["sub_top"] for r in o1]),
              np.median([r["sub_cy"] for r in o2]) - np.median([r["sub_cy"] for r in o1])))
    P("slope of subtitle centre on chin height (chunks with a face), low chin < 0.45 and high chin >= 0.45")
    for c in clients + ["ALL"]:
        rs = [r for r in rows if r["chin"] is not None and r["face_h"] >= 0.08 and (c == "ALL" or r["client"] == c)]
        s = []
        for name, f in (("<.45", lambda r: r["chin"] < 0.45), (">=.45", lambda r: r["chin"] >= 0.45)):
            b = [r for r in rs if f(r)]
            if len(b) >= 8 and np.std([r["chin"] for r in b]) > 0:
                s.append("%s n=%d slope %.2f corr %.2f" % (name, len(b), np.polyfit([r["chin"] for r in b], [r["sub_cy"] for r in b], 1)[0],
                                                          np.corrcoef([r["chin"] for r in b], [r["sub_cy"] for r in b])[0, 1]))
        P("   %-14s %s" % (c[:14], "; ".join(s)))
    fr = [r for r in rows if r["chin"] is not None and r["face_h"] >= 0.08]
    y = np.array([r["sub_cy"] for r in fr]); ch = np.array([r["chin"] for r in fr])
    best = min((np.abs(np.maximum(a, ch + k) - y).mean(), a, k) for a in np.arange(0.40, 0.60, 0.005) for k in np.arange(0.05, 0.20, 0.005))
    fx = min((np.abs(a - y).mean(), a) for a in np.arange(0.3, 0.7, 0.002))
    ck = min((np.abs(ch + k - y).mean(), k) for k in np.arange(0.05, 0.25, 0.002))
    P("pooled fits on chunks with a face (n=%d): fixed y %.3f MAE %.4f; chin + k, k %.3f MAE %.4f; max(Y0, chin + k), Y0 %.3f k %.3f MAE %.4f" % (
        len(fr), fx[1], fx[0], ck[1], ck[0], best[1], best[2], best[0]))
    P("  the same rule fitted on the OTHER clients, MAE on the client / the client's own fixed y MAE:")
    for c in clients:
        rs = [r for r in fr if r["client"] == c]
        if len(rs) < 20:
            continue
        ot = [r for r in fr if r["client"] != c]
        yo = np.array([r["sub_cy"] for r in ot]); co = np.array([r["chin"] for r in ot])
        bb = min((np.abs(np.maximum(a, co + k) - yo).mean(), a, k) for a in np.arange(0.40, 0.60, 0.01) for k in np.arange(0.05, 0.20, 0.01))
        yy = np.array([r["sub_cy"] for r in rs]); cc = np.array([r["chin"] for r in rs])
        P("   %-14s hybrid(Y0 %.2f, k %.2f) %.3f | own fixed %.3f" % (c[:14], bb[1], bb[2], np.abs(np.maximum(bb[1], cc + bb[2]) - yy).mean(), np.abs(np.median(yy) - yy).mean()))

    P("\n== 11. punch-in sizes (log scale; 0.1 = 10 %) ==")
    pj = [abs(p["ls"]) for m in metas for p in m["punches"]]
    P("  <0.10: %d, 0.10-0.20: %d, 0.20-0.30: %d, 0.30-0.50: %d, >=0.50: %d (the biggest are mostly screen recordings and B-roll scale animations)" % (
        sum(x < .1 for x in pj), sum(.1 <= x < .2 for x in pj), sum(.2 <= x < .3 for x in pj), sum(.3 <= x < .5 for x in pj), sum(x >= .5 for x in pj)))

    # ---- detector reliability
    P("\n== 8. detectors ==")
    P("face found (YuNet, any frame of the video): %.0f%%; at chunk middles: %.0f%%; Vision face at chunk middles: %.0f%%; either: %.0f%%" % (
        100 * np.mean([m["frames_with_face"] for m in metas]), 100 * np.mean([r["face_found"] for r in rows]),
        100 * np.mean([r["face_nv"] > 0 for r in rows]), 100 * np.mean([r["face_found"] or r["face_nv"] > 0 for r in rows])))
    both = [r for r in rows if r["face_found"] and r["face_nv"] > 0]
    P("  YuNet found, Vision not: %d; Vision found, YuNet not: %d; both: %d" % (
        sum(r["face_found"] and r["face_nv"] == 0 for r in rows), sum((not r["face_found"]) and r["face_nv"] > 0 for r in rows), len(both)))
    P("subtitle chunks: %d in %d videos (%.1f per minute); coverage of the video time by chunks %.0f%% (median over videos)" % (
        len(rows), len(metas), 60 * len(rows) / sum(m["seconds"] for m in metas), 100 * np.median([m["coverage_caps_any"][m["mode"]] for m in metas])))
    P("chunks with a hand: %.0f%% (a hand over 1%% of the frame: %.0f%%), with a human box: %.0f%%, with a salient box: %.0f%%, with other text: %.0f%%" % tuple(
        100 * np.mean([len(r["boxes"][k]) > 0 for r in rows]) for k in ("hands", "hands_big", "humans", "salient", "text")))
    P("salient box area median (fraction of frame): %.2f; human box area median: %.2f" % (
        np.median([b[2] * b[3] for r in rows for b in r["boxes"]["salient"]] or [0]), np.median([b[2] * b[3] for r in rows for b in r["boxes"]["humans"]] or [0])))
    open(os.path.join(work, "report.txt"), "w").write("\n".join(out) + "\n")
