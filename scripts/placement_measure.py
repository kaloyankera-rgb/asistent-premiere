"""Dev only (scripts/measure_style.py placement / placement-report): WHERE editors put the subtitles in finished client
videos, measured as numbers so "Move off faces" can be redesigned from evidence.

Per video (cached step by step in <work>/<tag>/): frames at 8 a second (540 px wide) + the Mac's text recognition (ocr.py),
YuNet faces on every frame (faces.py), Apple Vision hands / humans / salient objects on each chunk's start, middle and end
frame (placement_vision.swift), and cuts + zoom from the picture at 25 frames a second (ORB features between consecutive
frames, a similarity transform: its scale is the zoom, no match with a big pixel change is a hard cut, a big scale step
with a good match is a punch-in cut). Everything goes into <work> (outside the repo; client frames and words are private,
and nothing here ever shows a frame). The video folder is only read.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "engine"))

FPS = 8              # frames kept for text and faces
MFPS = 25            # frames per second the cuts and the zoom are measured at
MW = 240             # width of those frames
FRAME_W = 540
SUBTITLE_MAX_SECONDS = 6.0


# ---------------------------------------------------------------- inputs

def client_of(name: str) -> str:
    stem = os.path.splitext(name)[0]
    if stem.lower() == "video":
        return "unknown"
    if " КП-" in stem:
        return stem.split(" КП-")[0]
    if " - " in stem:
        return stem.split(" - ")[0]
    return stem


def list_videos(folder: str) -> tuple[list[dict], list[dict]]:
    """(to measure, skipped with the reason): exact duplicates ' (1).mp4' with their twin's size, and unreadable files."""
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith((".mp4", ".mov")))
    keep, skip = [], []
    for f in files:
        p = os.path.join(folder, f)
        m = re.match(r"(.*) \(1\)(\.\w+)$", f)
        if m and os.path.exists(os.path.join(folder, m.group(1) + m.group(2))) \
                and os.path.getsize(os.path.join(folder, m.group(1) + m.group(2))) == os.path.getsize(p):
            skip.append({"file": f, "why": "exact duplicate of its twin (same size)"})
            continue
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                            "stream=width,height,duration,r_frame_rate", "-of", "json", p], capture_output=True, text=True)
        try:
            st = json.loads(r.stdout)["streams"][0]
            w, h = int(st["width"]), int(st["height"])
        except Exception:
            skip.append({"file": f, "why": "ffprobe cannot read it"})
            continue
        client = client_of(f)
        keep.append({"idx": len(keep) + 1, "file": f, "path": p, "client": client, "w": w, "h": h,
                     "seconds": float(st.get("duration") or 0), "size": os.path.getsize(p)})
    for k in keep:
        k["tag"] = "%02d" % k["idx"]
    return keep, skip


# ---------------------------------------------------------------- step A: frames, text, faces

def step_frames(v: dict, work: str):
    d = os.path.join(work, v["tag"], "frames")
    done = os.path.join(work, v["tag"], "frames.done")
    if not os.path.exists(done):
        os.makedirs(d, exist_ok=True)
        subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", v["path"], "-vf", f"fps={FPS},scale={FRAME_W}:-2", "-q:v", "3",
                        "-y", os.path.join(d, "%05d.jpg")], check=True)
        open(done, "w").write("ok")
    return sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".jpg"))


def step_ocr(v, work, files):
    p = os.path.join(work, v["tag"], "ocr.json")
    if not os.path.exists(p):
        from asistent import ocr
        rows = []
        for i in range(0, len(files), 100):
            rows += ocr.read(files[i:i + 100])
        json.dump(rows, open(p, "w"), ensure_ascii=False)
    return json.load(open(p))


def step_faces(v, work, files):
    p = os.path.join(work, v["tag"], "faces.json")
    if not os.path.exists(p):
        import cv2
        from asistent import faces
        out = []
        for f in files:
            img = cv2.imread(f)
            H, W = img.shape[:2]
            enc = img[:, :, ::-1].astype(np.float32) / 255.0
            out.append([[b[0] / W, b[1] / H, b[2] / W, b[3] / H, round(b[4], 3)] for b in faces.detect(enc)])
        json.dump(out, open(p, "w"))
    return json.load(open(p))


def stage_a(v, work):
    files = step_frames(v, work)
    ocr_rows = step_ocr(v, work, files)
    step_faces(v, work, files)
    return v["tag"], len(files)


def run_a(videos, work, jobs):
    with ProcessPoolExecutor(jobs) as ex:
        futs = [ex.submit(stage_a, v, work) for v in videos]
        for f in futs:
            print("A done", f.result(), flush=True)


# ---------------------------------------------------------------- step B: cuts and zoom at 25 frames a second

def _text_mask(shape, boxes, pad=0.012):
    """255 where features may be taken: everything but the text boxes (the subtitle is fixed and would pull the scale to 1)."""
    import cv2
    H, W = shape
    m = np.full((H, W), 255, np.uint8)
    for b in boxes:
        x0, x1 = int(max(b["x"] - pad, 0) * W), int(min(b["x"] + b["w"] + pad, 1) * W)
        y0, y1 = int(max(b["y"] - pad, 0) * H), int(min(b["y"] + b["h"] + pad, 1) * H)
        m[y0:y1, x0:x1] = 0
    return m


def step_motion(v, work, ocr_rows):
    """Per step between two consecutive 25 fps frames: pixel change, histogram correlation, matched features, inliers of a
    similarity transform, log of its scale (= zoom) and its shift. Saved as columns."""
    p = os.path.join(work, v["tag"], "motion.json")
    if os.path.exists(p):
        return json.load(open(p))
    import cv2
    ww = MW
    hh = int(round(v["h"] * ww / v["w"] / 2)) * 2
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", v["path"], "-an", "-vf", f"fps={MFPS},scale={ww}:{hh},format=gray",
           "-f", "rawvideo", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    orb = cv2.ORB_create(nfeatures=700, fastThreshold=8)
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    rows, prev, i = [], None, 0
    n = ww * hh
    while True:
        buf = proc.stdout.read(n)
        if len(buf) < n:
            break
        g = np.frombuffer(buf, np.uint8).reshape(hh, ww)
        fi = min(int(i / MFPS * FPS), len(ocr_rows) - 1)           # the text boxes of the nearest 8 fps frame
        mask = _text_mask((hh, ww), [b for b in ocr_rows[fi] if b["confidence"] >= 0.3] if ocr_rows else [])
        kp, des = orb.detectAndCompute(g, mask)
        small = cv2.resize(g, (32, 56), interpolation=cv2.INTER_AREA).astype(np.float32)
        hist = cv2.calcHist([g], [0], None, [32], [0, 256]).ravel()
        hist /= max(hist.sum(), 1)
        if prev is not None:
            pk, pdes, psmall, phist = prev
            row = {"i": i, "diff": float(np.abs(small - psmall).mean()),
                   "hcorr": float(np.minimum(hist, phist).sum()),         # histogram intersection, 1 = same
                   "match": 0, "inl": 0, "ls": 0.0, "tx": 0.0, "ty": 0.0}
            if des is not None and pdes is not None and len(kp) >= 8 and len(pk) >= 8:
                ms = bf.match(pdes, des)
                row["match"] = len(ms)
                if len(ms) >= 8:
                    a = np.float32([pk[m.queryIdx].pt for m in ms])
                    b = np.float32([kp[m.trainIdx].pt for m in ms])
                    M, inl = cv2.estimateAffinePartial2D(a, b, method=cv2.RANSAC, ransacReprojThreshold=2.0, maxIters=500)
                    if M is not None:
                        row["inl"] = int(inl.sum())
                        row["ls"] = float(np.log(np.hypot(M[0, 0], M[1, 0])))
                        row["tx"], row["ty"] = float(M[0, 2] / ww), float(M[1, 2] / hh)
            rows.append(row)
        prev = (kp, des, small, hist)
        i += 1
    proc.stdout.close()
    proc.wait()
    json.dump(rows, open(p, "w"))
    return rows


# ---------------------------------------------------------------- step C: subtitle chunks (any case, any script)

def _norm(t):
    return re.sub(r"[^0-9A-ZА-ЯЁЪЬЮЯ\- ]", "", t.upper()).strip()


def _cand(o, mode):
    """A centred text line that may be a subtitle. mode 'caps': capitals (Cyrillic or Latin) like measure_style._is_sub;
    'any': any case (sentence-case subtitles), found by being centred and changing."""
    t = o["text"].strip()
    letters = [c for c in t if c.isalpha()]
    if o["confidence"] < 0.3 or (not letters and not re.search(r"\d", t)):
        return False
    if mode == "caps" and letters and sum(c.isupper() for c in letters) / len(letters) < 0.7:
        return False
    if abs(o["x"] + o["w"] / 2 - 0.5) > (0.06 if mode == "caps" else 0.08):
        return False
    return o["y"] + o["h"] / 2 > 0.15


def chunks_from_ocr(rows, mode):
    """Chunks = a continuous stretch where the same subtitle text is shown (as measure_style._events + _merge), with the
    position at every frame it is shown: events [{start, end, frames, track:[(i, top, bottom, x0, x1, lines)], key, ...}]."""
    from difflib import SequenceMatcher
    frames = []
    for r in rows:
        frames.append(sorted((dict(o, _k=k) for k, o in enumerate(r) if _cand(o, mode)), key=lambda o: o["y"]))
    cnt = Counter((_norm(o["text"]), round(o["y"], 2)) for f in frames for o in f)
    still = {k for k, v in cnt.items() if v > 5 * FPS}               # a title that stays: not a subtitle
    frames = [[o for o in f if (_norm(o["text"]), round(o["y"], 2)) not in still] for f in frames]
    events, cur = [], None
    for i, f in enumerate(frames):
        groups = []
        for o in f:
            if groups and o["y"] - (groups[-1][-1]["y"] + groups[-1][-1]["h"]) < 0.025:
                groups[-1].append(o)
            else:
                groups.append([o])
        g = max(groups, key=lambda g: sum(len(o["text"]) for o in g)) if groups else None
        key = " ".join(_norm(o["text"]) for o in g) if g else None
        if cur and key and key == cur["key"]:
            cur["end"] = i; cur["obs"].append((i, g)); continue
        if cur and key is None and i - cur["end"] <= 1:
            continue
        if cur:
            events.append(cur); cur = None
        if g:
            cur = {"key": key, "start": i, "end": i, "obs": [(i, g)]}
    if cur:
        events.append(cur)
    for e in events:
        e["track"] = [(i, min(o["y"] for o in g), max(o["y"] + o["h"] for o in g), min(o["x"] for o in g),
                       max(o["x"] + o["w"] for o in g), len(g), [o["_k"] for o in g]) for i, g in e["obs"]]
        e["text"] = " ".join(_norm(o["text"]) for o in e["obs"][len(e["obs"]) // 2][1])
        del e["obs"]
    sim = lambda a, b: SequenceMatcher(None, a, b).ratio()
    merged = []
    for e in events:
        if merged and sim(merged[-1]["key"], e["key"]) > 0.75 and (e["start"] - merged[-1]["end"]) / FPS <= 0.26:
            m = merged[-1]
            m["end"] = e["end"]; m["track"] += e["track"]
            if len(e["track"]) > m["best"]:
                m["text"], m["best"] = e["text"], len(e["track"])
            continue
        merged.append(dict(e, best=len(e["track"])))
    out = []
    for m in merged:
        if (m["end"] - m["start"] + 1) / FPS < 0.24 or (m["end"] - m["start"] + 1) / FPS > SUBTITLE_MAX_SECONDS:
            continue                                                   # no one-frame ghosts, no long titles
        out.append(m)
    return out


def step_vision(v, work, files, frame_idx):
    """Apple Vision (faces, hands, humans, salient objects) on the given frames: {frame index: {...}}."""
    p = os.path.join(work, v["tag"], "vision.json")
    cache = json.load(open(p)) if os.path.exists(p) else {}
    need = [i for i in sorted(set(frame_idx)) if str(i) not in cache]
    exe = os.path.join(work, "placement-vision")
    if not os.path.isfile(exe):
        subprocess.run(["swiftc", "-O", "-o", exe, os.path.join(HERE, "placement_vision.swift")], check=True)
    for k in range(0, len(need), 60):
        part = need[k:k + 60]
        r = subprocess.run([exe, *[files[i] for i in part]], capture_output=True, text=True, timeout=600)
        res = [json.loads(ln) for ln in r.stdout.splitlines() if ln.strip().startswith("{")]
        for i, d in zip(part, res):
            cache[str(i)] = d
    json.dump(cache, open(p, "w"))
    return cache


# ---------------------------------------------------------------- step D: cuts, punch-ins and zoom ramps from the motion steps

HARD_INL = 12        # fewer inliers than this and a big pixel change = no common picture = a hard cut
HARD_DIFF = 6.0      # mean grey-level change on a 32x56 picture
PUNCH_STEP = 0.02    # |log scale| of one 25 fps step that starts a scale jump
PUNCH_TOTAL = 0.05   # a jump of at least 5 % within 0.28 s is a punch-in (or out); slower is a ramp
RAMP_WINDOW = 15     # steps (0.6 s)
RAMP_MIN = 0.02      # |log scale| over the window that marks a ramp
RAMP_TOTAL = 0.03    # a ramp changes the scale by 3 % at least


def analyse_motion(rows):
    """{cuts:[t], punches:[{t, ls}], ramps:[{t0, t1, ls}], steps: per-step usable log-scale list, edits: sorted times}."""
    n = len(rows)
    cut = [False] * n
    for k, r in enumerate(rows):
        if r["inl"] < HARD_INL and (r["diff"] > HARD_DIFF or r["hcorr"] < 0.85):
            cut[k] = True
    ls = [r["ls"] if (r["inl"] >= HARD_INL and not cut[k]) else 0.0 for k, r in enumerate(rows)]
    cuts, last = [], -99
    for k in range(n):
        if cut[k]:
            if k - last > 3:                                   # flagged steps within 0.12 s are one cut
                cuts.append(rows[k]["i"] / MFPS)
            last = k
    punches, used = [], [False] * n
    k = 0
    while k < n:
        if abs(ls[k]) >= PUNCH_STEP and rows[k]["inl"] >= 20:
            sg, j, tot = np.sign(ls[k]), k, ls[k]
            while j + 1 < n and j - k < 6:                    # the run goes on while the next step (or the one after) still moves the same way
                nxt = [q for q in (j + 1, j + 2) if q < n and abs(ls[q]) >= 0.01 and np.sign(ls[q]) == sg]
                if not nxt:
                    break
                j = nxt[0]
                tot += ls[j]
            if abs(tot) >= PUNCH_TOTAL and (j - k + 1) / MFPS <= 0.28 + 1e-9:
                punches.append({"t": rows[k]["i"] / MFPS, "ls": float(tot)})
                for q in range(k, j + 1):
                    used[q] = True
                k = j + 1
                continue
        k += 1
    base = [0.0 if used[k] else ls[k] for k in range(n)]
    edit_t = sorted(cuts + [p["t"] for p in punches])
    # ramps: windowed sums of the steps, inside one shot (a cut or punch-in resets the window)
    flag = [False] * n
    for k in range(n):
        lo = max(0, k - RAMP_WINDOW + 1)
        if any(cut[q] or used[q] for q in range(lo, k + 1)):
            continue
        if abs(sum(base[lo:k + 1])) >= RAMP_MIN:
            for q in range(lo, k + 1):
                flag[q] = True
    ramps, k = [], 0
    while k < n:
        if flag[k]:
            j = k
            while j + 1 < n and flag[j + 1]:
                j += 1
            tot = sum(base[k:j + 1])
            if abs(tot) >= RAMP_TOTAL and (j - k + 1) / MFPS >= 0.4:
                ramps.append({"t0": rows[k]["i"] / MFPS, "t1": rows[j]["i"] / MFPS, "ls": float(tot)})
            k = j + 1
        else:
            k += 1
    return {"cuts": cuts, "punches": punches, "ramps": ramps, "edits": edit_t,
            "steps": [float(x) for x in base], "step_t": [r["i"] / MFPS for r in rows]}


# ---------------------------------------------------------------- step E: one row per chunk

def _inter(a, b):
    """Intersection area of two boxes (x, y, w, h)."""
    w = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    h = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    return max(w, 0) * max(h, 0)


def overlaps(sub, boxes):
    """sub box vs boxes: the largest share of a box that the subtitle covers, the IoU, the share of the subtitle it takes
    (summed), and any overlap (>= 0.1 % of the frame)."""
    cov, iou, frac = 0.0, 0.0, 0.0
    sa = sub[2] * sub[3]
    for b in boxes:
        i = _inter(sub, b)
        ba = max(b[2] * b[3], 1e-9)
        cov = max(cov, i / ba)
        iou = max(iou, i / (sa + ba - i + 1e-12))
        frac += i / max(sa, 1e-9)
    return {"cov": cov, "iou": iou, "frac": min(frac, 1.0)}


def pick_mode(rows):
    out = {}
    for mode in ("caps", "any"):
        ch = chunks_from_ocr(rows, mode)
        out[mode] = (ch, sum((c["end"] - c["start"] + 1) / FPS for c in ch))
    mode = "any" if out["any"][1] - out["caps"][1] > 0.1 * len(rows) / FPS else "caps"
    return mode, out[mode][0], {k: round(v[1] / (len(rows) / FPS), 3) for k, v in out.items()}


def analyse_video(v, work, only_cached=False):
    d = os.path.join(work, v["tag"])
    ocr_rows = json.load(open(os.path.join(d, "ocr.json")))
    faces_all = json.load(open(os.path.join(d, "faces.json")))
    files = step_frames(v, work)
    mode, chunks, cov = pick_mode(ocr_rows)
    mids = []
    for c in chunks:
        c["mid"] = c["track"][len(c["track"]) // 2][0]
        mids.append(c["mid"])
    vis = step_vision(v, work, files, mids)
    mrows = step_motion(v, work, ocr_rows)
    mot = analyse_motion(mrows)
    dur = len(ocr_rows) / FPS
    edits = mot["edits"]
    st, ss = np.array(mot["step_t"]), np.array(mot["steps"])

    def shot_of(t):
        return int(np.searchsorted(edits, t, side="right"))

    def cum(t0, t1):                       # log scale change between two times (steps inside, jumps and cuts left out)
        m = (st > t0) & (st <= t1)
        return float(ss[m].sum())

    def main_face(i):
        for q in (i, i - 1, i + 1):
            if 0 <= q < len(faces_all) and faces_all[q]:
                f = max(faces_all[q], key=lambda b: b[2] * b[3])
                return f, q
        return None, None

    rows = []
    for k, c in enumerate(chunks):
        tr = c["track"]
        tops = [t[1] for t in tr]
        bots = [t[2] for t in tr]
        cys = [(t[1] + t[2]) / 2 for t in tr]
        im = c["mid"]
        mt = [t for t in tr if t[0] == im][0]
        sub = (min(t[3] for t in tr), mt[1], max(t[4] for t in tr) - min(t[3] for t in tr), mt[2] - mt[1])
        sub_cy = sub[1] + sub[3] / 2
        j = max(1, len(cys) // 4)
        t0, t1, tm = c["start"] / FPS, (c["end"] + 1) / FPS, im / FPS
        f, fq = main_face(im)
        fs, _ = main_face(tr[0][0])
        fe, _ = main_face(tr[-1][0])
        vi = vis.get(str(im), {})
        fy = faces_all[im] if im < len(faces_all) else []
        yfaces = [b[:4] for b in fy]
        other = [(o["x"], o["y"], o["w"], o["h"]) for q, o in enumerate(ocr_rows[im])
                 if q not in mt[6]
                 and o["confidence"] >= 0.5 and len(o["text"].strip()) >= 2]
        row = {
            "tag": v["tag"], "client": v["client"], "k": k, "mode": mode,
            "aspect": "9:16" if v["h"] > v["w"] * 1.4 else ("16:9" if v["w"] > v["h"] * 1.4 else "other"),
            "t0": round(t0, 3), "t1": round(t1, 3), "tm": round(tm, 3), "chars": len(c["text"]), "words": len(c["text"].split()),
            "lines": int(round(np.median([t[5] for t in tr]))),
            "sub_top": round(sub[1], 4), "sub_bottom": round(sub[1] + sub[3], 4), "sub_cy": round(sub_cy, 4),
            "sub_x0": round(sub[0], 4), "sub_w": round(sub[2], 4), "sub_xc": round(sub[0] + sub[2] / 2, 4), "sub_h": round(sub[3], 4),
            "cy_start": round(float(np.median(cys[:j])), 4), "cy_end": round(float(np.median(cys[-j:])), 4),
            "cy_range": round(max(cys) - min(cys), 4),
            "face_n": len(fy), "face_found": f is not None, "face_nv": len(vi.get("faces", [])),
            "chin": round(f[1] + f[3], 4) if f else None, "face_top": round(f[1], 4) if f else None,
            "face_h": round(f[3], 4) if f else None, "face_cx": round(f[0] + f[2] / 2, 4) if f else None,
            "chin_start": round(fs[1] + fs[3], 4) if fs else None, "chin_end": round(fe[1] + fe[3], 4) if fe else None,
            "off_chin_top": round(sub[1] - (f[1] + f[3]), 4) if f else None,
            "off_chin_cy": round(sub_cy - (f[1] + f[3]), 4) if f else None,
            "shot": shot_of(tm), "zoom_in_chunk": round(cum(t0, t1), 4),
            "ramp": any(r["t0"] < t1 and r["t1"] > t0 for r in mot["ramps"]),
            "edit_in_chunk": any(t0 < e <= t1 for e in edits),
            "boxes": {"faces": yfaces, "faces_v": vi.get("faces", []), "hands": vi.get("hands", []),
                      "humans": vi.get("humans", []), "salient": vi.get("salient", []), "text": other},
        }
        for name, bx in (("face", yfaces), ("facev", vi.get("faces", [])), ("hand", vi.get("hands", [])),
                         ("human", vi.get("humans", [])), ("sal", vi.get("salient", [])), ("text", other)):
            o = overlaps(sub, bx)
            row[name + "_cov"], row[name + "_iou"], row[name + "_frac"] = round(o["cov"], 4), round(o["iou"], 4), round(o["frac"], 4)
        rows.append(row)
    # per shot: scale relative to the shot's first chunk, and the main face's size change (a check of the zoom)
    first = {}
    for r in rows:
        first.setdefault(r["shot"], r)
    for r in rows:
        a = first[r["shot"]]
        r["zoom_vs_shot_first"] = round(cum(a["tm"], r["tm"]), 4)
        r["face_h_vs_shot_first"] = round(float(np.log(r["face_h"] / a["face_h"])), 4) if r["face_h"] and a["face_h"] else None
        r["shot_first_chunk"] = a is r
    meta = {"tag": v["tag"], "client": v["client"], "file": v["file"], "w": v["w"], "h": v["h"], "seconds": round(dur, 2),
            "mode": mode, "coverage_caps_any": cov, "chunks": len(rows), "frames": len(ocr_rows),
            "frames_with_face": round(float(np.mean([bool(f) for f in faces_all])), 3),
            # a flat picture (the GStroy 0.7 MB file: grey 70 all through, no face, no cut): its subtitles count for the
            # position, nothing else is measured on it
            "flat": bool(not mot["cuts"] and not any(faces_all) and mrows and float(np.percentile([r["diff"] for r in mrows], 99)) < 3.0),
            "chunk_frames_with_face": round(float(np.mean([r["face_found"] for r in rows])), 3) if rows else None,
            "cuts": [round(x, 2) for x in mot["cuts"]], "punches": mot["punches"], "ramps": mot["ramps"]}
    return meta, rows


# ---------------------------------------------------------------- the whole run

CSV_SKIP = ("boxes",)


def one_video(v, work):
    """Every step for one video; the result is cached as <tag>/result.json (delete it to re-analyse after a rule change)."""
    files = step_frames(v, work)
    ocr_rows = step_ocr(v, work, files)
    step_faces(v, work, files)
    step_motion(v, work, ocr_rows)
    meta, rows = analyse_video(v, work)
    json.dump({"meta": meta, "rows": rows}, open(os.path.join(work, v["tag"], "result.json"), "w"))
    return meta["tag"], len(rows)


def run_all(videos, work, jobs=4, only=None):
    vs = [v for v in videos if not only or any(o in v["file"] or o == v["tag"] for o in only)]
    with ProcessPoolExecutor(jobs) as ex:
        futs = [ex.submit(one_video, v, work) for v in vs]
        for f in futs:
            print("done", f.result(), flush=True)
    collect(videos, work)


def collect(videos, work):
    metas, rows = [], []
    for v in videos:
        p = os.path.join(work, v["tag"], "result.json")
        if os.path.exists(p):
            d = json.load(open(p))
            metas.append(d["meta"]); rows += d["rows"]
    json.dump(metas, open(os.path.join(work, "videos.json"), "w"), ensure_ascii=False, indent=1)
    json.dump(rows, open(os.path.join(work, "chunks_rows.json"), "w"), ensure_ascii=False)
    keys = [k for k in rows[0] if k not in CSV_SKIP] if rows else []
    with open(os.path.join(work, "chunks_rows.csv"), "w") as f:
        f.write(",".join(keys) + "\n")
        for r in rows:
            f.write(",".join('"%s"' % r[k] if isinstance(r[k], str) else ("" if r[k] is None else str(r[k])) for k in keys) + "\n")
    print(len(metas), "videos,", len(rows), "chunks ->", work)
