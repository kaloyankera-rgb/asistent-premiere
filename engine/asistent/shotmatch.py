"""Auto Shot Match: make clips from two or more cameras look like one reference camera.

Measured on content-independent anchors, never on average RGB or luminance: skin (brightness, hue, saturation),
neutral surfaces (white balance) and, only where both cameras show the same real moment, the tone spread
(contrast). Skin is measured only inside detected faces (`faces.py`): wood, plywood and pale walls share skin's
colour, so a colour box cannot find it. The clips are read from the source files at the moments the panel picks (overlapping moments of
the cameras first), and the clip's current Lumetri values are simulated on them with the models the probe
measured. The proposal is therefore an ABSOLUTE set of Lumetri values computed from the source: running Shot
Match again gives the same values, nothing accumulates. Differences too large to be a camera mismatch, or anchors
that disagree, are flagged and not applied (intentional light, different scene, or no reliable anchor).
"""
from __future__ import annotations

import os

import numpy as np

from . import color as C
from . import faces as F

# Lumetri models measured by the probe on C0737 (2026-11-01), per slider unit
TEMP_GAINS = np.array([0.00814, -0.00187, -0.01188])     # log2 gain per channel: a pure white-balance gain
TINT_GAINS = np.array([0.00988, -0.00513, 0.00987])
TEMP_PER_T = float(TEMP_GAINS[2] - TEMP_GAINS[0])         # log2(B/R) per Temperature unit (≈ −0.020)
TINT_PER_G = float(TINT_GAINS[1] - (TINT_GAINS[0] + TINT_GAINS[2]) / 2)   # log2(G/√RB) per Tint unit (≈ −0.015)
CONTRAST_K, CONTRAST_PIVOT = 0.002288, 0.50               # encoded luma slope 1 + k·c around the pivot
SAT_B = 0.00931                                          # linear chroma × (1 + b·(S − 100)), luma kept

DEFAULT = {"exposure": 0.0, "temperature": 0.0, "tint": 0.0, "contrast": 0.0, "saturation": 100.0}
# beyond these a difference is not a camera mismatch but light, scene or intent: flagged, never forced
LIMITS = {"stops": 1.5, "stops_overlap": 2.5, "temp": 0.5, "tint": 0.3, "contrast": 20.0, "saturation": 20.0}
# below these a change is not worth an edit (and keeps re-runs from fiddling)
MINIMUM = {"exposure": 0.05, "temperature": 1.0, "tint": 1.0, "contrast": 3.0, "saturation": 3.0}
AGREE = (0.15, 0.10)          # neutral surfaces and skin must agree on the white difference (log2 t, g)
ANALYSIS_SIDE = 480           # long side of the frames the anchors are measured on (as color.read_frames)
SIMILAR = 0.75                # tone histograms at least this alike: the frames show comparable content
WORSE = {"exposure": 0.1, "white": 0.25, "saturation": 0.05, "contrast": 0.05}   # render check margins


# ---------------------------------------------------------------- Lumetri simulation

def simulate(lin: np.ndarray, v: dict, cal) -> np.ndarray:
    """What Lumetri does to linear Rec.709 light with these values (white, exposure, contrast, saturation)."""
    v = {**DEFAULT, **(v or {})}
    out = lin * 2.0 ** (v["temperature"] * TEMP_GAINS + v["tint"] * TINT_GAINS)
    if v["exposure"]:
        y = C._luma(C.encode(out))
        rate = np.interp(y, *_curve(cal)) if v["exposure"] > 0 else np.ones_like(y)   # highlight shoulder
        out = out * (2.0 ** (v["exposure"] * rate))[..., None]
    if v["contrast"]:
        enc = C.encode(out)
        y = np.maximum(C._luma(enc), 1e-4)
        y2 = np.clip(CONTRAST_PIVOT + (y - CONTRAST_PIVOT) * (1 + CONTRAST_K * v["contrast"]), 1e-4, 1.0)
        out = C.to_linear(np.clip(enc * (y2 / y)[..., None], 0, 1), None)
    if v["saturation"] != 100:
        y = C._luma(out)[..., None]
        out = y + (out - y) * (1 + SAT_B * (v["saturation"] - 100))
    return np.clip(out, 0, 1)


def _curve(cal):
    pts = sorted((cal.data.get("exposure_curve") or [[0.0, 1.0], [1.0, 1.0]]))
    return [p[0] for p in pts], [p[1] for p in pts]


# ---------------------------------------------------------------- anchors

def anchors(enc: np.ndarray, faces=None) -> dict:
    """Content-independent anchors of one frame: skin (of the detected `faces`: brightness, hue, saturation),
    neutral surfaces, tones. No faces means no skin anchor, never a guess from colour."""
    lin = C.to_linear(enc, None)
    m = C.measure(enc, faces=[])                  # the anchors use their own face list: no second detection
    clipped = np.max(enc, axis=-1) >= 0.97
    skin = F.skin_mask(enc, lin, faces)
    y_enc = C._luma(enc)
    lit = y_enc > 0.04
    has_neutral = m.get("neutral", 0) >= 0.005
    out = {"neutral": m.get("cast_neutral") if has_neutral else None,
           "neutral_y": m.get("neutral_y") if has_neutral else None,
           "clipped": float(np.mean(clipped)), "skin": None,
           "mid": float(np.median(y_enc[lit])) if lit.any() else None,
           "spread": float(np.percentile(y_enc[lit], 95) - np.percentile(y_enc[lit], 5)) if lit.sum() > 100 else None,
           "hist": (np.histogram(y_enc, bins=16, range=(0, 1))[0] / y_enc.size).tolist()}
    if skin.sum() >= F.FACE_MIN_PX:
        px = lin[skin]
        mx, mn = px.max(axis=1), px.min(axis=1)
        out["skin"] = {"y": float(np.median(C._luma(px))), "cast": C._cast(px.sum(axis=0)),
                       "chroma": float(np.median((mx - mn) / np.maximum(mx, 1e-6))), "area": float(np.mean(skin))}
    return out


def pool(per_frame: list[dict]) -> dict:
    """Anchors of several frames (one clip, or every clip of the reference camera): medians of what is present."""
    n = len(per_frame)
    skins = [a["skin"] for a in per_frame if a["skin"]]
    neutrals = [a["neutral"] for a in per_frame if a["neutral"]]
    med = lambda xs: float(np.median(xs)) if xs else None
    out = {"frames": n, "clipped": med([a["clipped"] for a in per_frame]),
           "mid": med([a["mid"] for a in per_frame if a["mid"] is not None]),
           "spread": med([a["spread"] for a in per_frame if a["spread"] is not None]),
           "neutral_y": med([a["neutral_y"] for a in per_frame if a.get("neutral_y")]),
           "hist": np.mean([a["hist"] for a in per_frame], axis=0).tolist() if n else None,
           "skin": None, "neutral": None}
    if n and len(skins) * 2 >= n:
        out["skin"] = {"y": med([s["y"] for s in skins]), "chroma": med([s["chroma"] for s in skins]),
                       "cast": (med([s["cast"][0] for s in skins]), med([s["cast"][1] for s in skins])),
                       "area": med([s["area"] for s in skins])}
    if n and len(neutrals) * 2 >= n:
        out["neutral"] = (med([c[0] for c in neutrals]), med([c[1] for c in neutrals]))
    return out


def look(frames_lin: list[np.ndarray], values: dict, cal, faces=None) -> dict:
    """The anchors of these source frames as they look with these Lumetri values (`faces`: the boxes per frame,
    which the simulation does not move)."""
    faces = faces or [None] * len(frames_lin)
    return pool([anchors(C.encode(simulate(f, values, cal)), fc) for f, fc in zip(frames_lin, faces)])


# ---------------------------------------------------------------- comparing and fitting

def similarity(a: dict, ref: dict) -> float:
    """How alike the tone distributions are (histogram intersection, 1 = same): different framing of one scene
    (ceiling and close wood vs. people) scores low, and then whole-frame numbers say nothing about the camera."""
    if not a.get("hist") or not ref.get("hist"):
        return 0.0
    return float(np.minimum(a["hist"], ref["hist"]).sum())


BASIS_BG = {"face": "face", "neutral": "white/grey surfaces", "mid": "overall tones"}
CONFIDENCE_BG = {"face": "high", "neutral": "medium", "mid": "low"}      # what each anchor is worth
PART_BG = {"exposure": "brightness", "white": "white balance", "saturation": "saturation", "contrast": "contrast"}


def common_basis(looks: list[dict], ref: dict, allow_mid: bool = True) -> dict:
    """What the reference and EVERY one of these looks can be compared on, per component. A before and an after
    frame measured on different anchors (a face in one, the grey floor in the other) say nothing about each
    other, so a component is only compared on an anchor that all of them have. Mid-tones are the weakest anchor
    (framing decides them) and are left out of render checks."""
    every = [*looks, ref]
    out = {}
    if all(x["skin"] for x in every):
        out["exposure"] = out["saturation"] = "face"
    elif all(x.get("neutral_y") for x in every):
        out["exposure"] = "neutral"
    elif allow_mid and all(x["mid"] for x in every):
        out["exposure"] = "mid"
    if all(x["neutral"] for x in every):
        out["white"] = "neutral"
    elif all(x["skin"] for x in every):
        out["white"] = "face"
    if all(x["spread"] for x in every) and all(similarity(x, ref) >= SIMILAR for x in looks):
        out["contrast"] = "tones"
    return out


def match_error(a: dict, ref: dict, basis: dict | None = None) -> dict:
    """How far a look is from the reference, per component (None: no common anchor to say). `basis` (from
    common_basis) fixes the anchor per component; without it the best anchor both have is used."""
    basis = common_basis([a], ref) if basis is None else basis
    err = {"exposure": None, "white": None, "saturation": None, "contrast": None}
    how = basis.get("exposure")
    if how == "face":
        err["exposure"] = abs(float(np.log2(a["skin"]["y"] / ref["skin"]["y"])))
    elif how == "neutral":
        err["exposure"] = abs(float(np.log2(a["neutral_y"] / ref["neutral_y"])))
    elif how == "mid":
        err["exposure"] = abs(C.GAMMA * float(np.log2(a["mid"] / ref["mid"])))
    if basis.get("saturation") == "face":
        err["saturation"] = abs(float(np.log2(a["skin"]["chroma"] / ref["skin"]["chroma"])))
    pair = (a["neutral"], ref["neutral"]) if basis.get("white") == "neutral" else \
        (a["skin"]["cast"], ref["skin"]["cast"]) if basis.get("white") == "face" else None
    if pair:
        err["white"] = max(abs(pair[0][0] - pair[1][0]) / 0.1, abs(pair[0][1] - pair[1][1]) / 0.06)
    if basis.get("contrast"):
        err["contrast"] = abs(float(np.log2(a["spread"] / ref["spread"])))
    return err


def fit(frames_lin: list[np.ndarray], ref: dict, cal, overlap: bool, current: dict | None = None,
        faces=None) -> dict:
    """Absolute Lumetri values that make these source frames look like the reference, component by component.
    `overlap`: the frames show the same real moments as the reference camera (contrast only then).
    A component that is not fitted (flagged, no anchor) or would move less than MINIMUM keeps the clip's
    `current` value: a flag never wipes an earlier correction, and a re-run does not fiddle."""
    current = {**DEFAULT, **(current or {})}
    v = dict(DEFAULT)
    flags, basis = [], {}
    cur = look(frames_lin, v, cal, faces)

    # white: neutral surfaces and the skin's hue, which must agree (different light otherwise)
    dn = (ref["neutral"][0] - cur["neutral"][0], ref["neutral"][1] - cur["neutral"][1]) \
        if ref["neutral"] and cur["neutral"] else None
    ds = (ref["skin"]["cast"][0] - cur["skin"]["cast"][0], ref["skin"]["cast"][1] - cur["skin"]["cast"][1]) \
        if ref["skin"] and cur["skin"] else None
    # each axis on its own: neutral surfaces jump with the framing (a warm wall in one frame, grey floor in the next)
    # and may disagree on Temperature while both anchors agree the camera is greener (Tint); the axis that agrees is
    # fitted, the one that does not is left alone and said
    d, unfitted = [None, None], set()
    axes = (("temperature", "temperature"), ("tint", "green/magenta tint"))
    if dn and ds:
        for i, (key, bg) in enumerate(axes):
            if abs(dn[i] - ds[i]) > AGREE[i]:
                flags.append(f"white balance, {bg}: the neutral surfaces and the face disagree (different light?): not touched")
            else:
                d[i] = (dn[i] + ds[i]) / 2
        basis_name = "neutrals + face"
    elif dn or ds:
        d = list(dn or ds)
        basis_name = "neutrals" if dn else "face"
    else:
        flags.append("white balance: no white/grey surfaces or face in both cameras: not touched")
        basis_name = None
    for i, (key, bg) in enumerate(axes):
        if d[i] is not None and abs(d[i]) > LIMITS["temp" if i == 0 else "tint"]:
            flags.append(f"white balance, {bg}: the difference is large ({d[i]:+.2f}), probably intended light: not touched")
            d[i] = None
        if d[i] is None:
            unfitted.add(key)
    if basis_name and len(unfitted) < 2:
        basis["white"] = basis_name
        if d[0] is not None:
            v["temperature"] = round(d[0] / TEMP_PER_T, 1)
        if d[1] is not None:
            v["tint"] = round(d[1] / TINT_PER_G, 1)

    # exposure: the skin's brightness (or, at the same real moment, the mid-tones)
    cur = look(frames_lin, v, cal, faces)
    def need(c):
        if ref["skin"] and c["skin"]:
            return float(np.log2(ref["skin"]["y"] / c["skin"]["y"])), "the face", float(C.encode(np.array(c["skin"]["y"])))
        if overlap and ref.get("neutral_y") and c.get("neutral_y"):        # same moment, same light
            return float(np.log2(ref["neutral_y"] / c["neutral_y"])), "the white/grey surfaces", \
                float(C.encode(np.array(c["neutral_y"])))
        if overlap and ref["mid"] and c["mid"] and similarity(c, ref) >= SIMILAR:
            return C.GAMMA * float(np.log2(ref["mid"] / c["mid"])), "the shared moment", c["mid"]
        return None, None, None
    stops, why, at = need(cur)
    if stops is None:
        flags.append("brightness: no face or white/grey surfaces in moments shared with the reference: not touched")
    elif abs(stops) > LIMITS["stops_overlap" if overlap else "stops"]:
        # the same real moment (synced POVs) has the same light: a big gap is then the cameras' settings, so the
        # limit is wider there; elsewhere it may be another scene or intent
        flags.append(f"brightness: the difference is {stops:+.1f} stops, probably intended or another scene: not touched")
    else:
        basis["exposure"] = why
        for _ in range(3):                     # the curve and the shoulder: correct, look again, correct
            rate = float(np.interp(float(at), *_curve(cal))) if stops > 0 else 1.0
            v["exposure"] = round(v["exposure"] + stops / max(rate, 0.25), 2)
            cur = look(frames_lin, v, cal, faces)
            stops, _, at = need(cur)
            if stops is None or abs(stops) < 0.03:
                break

    # saturation: the skin's saturation, with the white and exposure already in
    if ref["skin"] and cur["skin"]:
        ok = True
        for _ in range(2):
            ratio = ref["skin"]["chroma"] / max(cur["skin"]["chroma"], 1e-6)
            s = v["saturation"] + (ratio - 1) / SAT_B
            if abs(s - 100) > LIMITS["saturation"]:
                flags.append(f"saturation: the difference is large ({s - 100:+.0f}): not touched")
                v["saturation"], ok = 100.0, False
                break
            v["saturation"] = round(s, 0)
            cur = look(frames_lin, v, cal, faces)
        if ok:
            basis["saturation"] = "the face"
    elif not (ref["skin"] and cur["skin"]):
        flags.append("saturation: no recognised face in both cameras (it is measured only on facial skin): not touched")
    # contrast: the tone spread, only on the same real moments AND comparable content (framing decides otherwise)
    if not (overlap and similarity(cur, ref) >= SIMILAR):
        flags.append("contrast: the frames show different content (angle), cannot be compared: not touched")
    elif ref["spread"] and cur["spread"]:
        c = v["contrast"] + (ref["spread"] / cur["spread"] - 1) / CONTRAST_K
        if abs(c) > LIMITS["contrast"]:
            flags.append(f"contrast: the difference is large ({c:+.0f}): the frames are not comparable (angle or light), not touched")
        else:
            v["contrast"] = round(c, 0)
            basis["contrast"] = "the shared moment"
    fitted = {"white": ("temperature", "tint"), "exposure": ("exposure",), "saturation": ("saturation",),
              "contrast": ("contrast",)}
    for part, keys in fitted.items():
        for k in keys:
            if part not in basis or k in unfitted or abs(v[k] - current[k]) < MINIMUM[k]:
                v[k] = current[k]
    now, then = look(frames_lin, current, cal, faces), look(frames_lin, v, cal, faces)
    common = common_basis([now, then], ref)
    before, after = match_error(now, ref, common), match_error(then, ref, common)
    changed = [k for k in DEFAULT if abs(v[k] - current[k]) >= 1e-9]
    conf = {}
    for part, how in basis.items():
        words = how.split()                       # whole words: "surfaces" holds "face"
        kind = "face" if "face" in words else "mid" if "moment" in words else "neutral"
        conf[part] = CONFIDENCE_BG[kind]
    return {"values": v, "changed": changed, "flags": flags, "basis": basis, "confidence": conf,
            "error_before": before, "error_after": after}


# ---------------------------------------------------------------- reference and the whole run

def reliability(p: dict) -> float:
    """How good a camera is as the reference: skin and neutrals to measure, well exposed, little clipping."""
    score = (2.0 if p["skin"] else 0.0) + (1.0 if p["neutral"] else 0.0) - 10 * (p["clipped"] or 0)
    if p["skin"]:
        score += 1 - min(abs(float(np.log2(max(C.encode(np.array(p["skin"]["y"])), 1e-4) / C.SKIN_TARGET))) * 2, 1)
    if p["neutral"]:
        score += 1 - min(max(abs(p["neutral"][0]) / 0.3, abs(p["neutral"][1]) / 0.2), 1)
    return round(score, 3)


def run(items: list[dict], reference: str | None, cal=None, progress=None) -> dict:
    """items: [{path, camera, times: [media s], overlap: bool, current: {...}, lumetri: none|own|manual}]."""
    from .prepare import sony_xml
    cal = cal or C.Calibration()
    progress = progress or (lambda f, m: None)
    clips = []
    for i, it in enumerate(items):
        progress(0.6 * i / max(len(items), 1), f"Looking at {i + 1} of {len(items)}")
        rec = {"index": i, "name": os.path.basename(it["path"]), "camera": it.get("camera") or "?",
               "overlap": bool(it.get("overlap")), "current": {**DEFAULT, **(it.get("current") or {})},
               "lumetri": it.get("lumetri") or "none", "flags": []}
        gamma = sony_xml(it["path"]).get("gamma")
        if gamma and "log" in gamma.lower():
            rec["flags"].append(f"recorded in {gamma}: Shot Match is only for Rec.709 for now, skipped")
        else:
            try:
                frames, rec["faces"] = _frames_and_faces(it["path"], it.get("times") or None)
                rec["frames"] = [C.to_linear(f, None) for f in frames]
            except C.MediaError as e:
                rec["flags"].append(str(e))
        clips.append(rec)
    usable = [c for c in clips if c.get("frames")]
    cameras = sorted({c["camera"] for c in usable})
    if len(cameras) < 2:
        raise ValueError("Matching needs clips from at least two cameras (folders).")
    # each camera as it looks now (its current Lumetri values simulated on the source)
    looks = {cam: pool([a for c in usable if c["camera"] == cam for a in
                        [anchors(C.encode(simulate(f, c["current"], cal)), fc)
                         for f, fc in zip(c["frames"], c["faces"])]]) for cam in cameras}
    scores = {cam: reliability(p) for cam, p in looks.items()}
    ref_cam = reference if reference in cameras else max(cameras, key=lambda k: scores[k])
    ref = looks[ref_cam]
    notes = []
    if not F.available():
        notes.append("no face detection (OpenCV or the model is missing): skin is not measured, brightness and white balance "
                     "come from white/grey surfaces, saturation is not touched")
    if any(c["lumetri"] == "manual" for c in usable if c["camera"] == ref_cam):
        notes.append("the reference has a manual grade: only Exposure/Temperature/Tint/Contrast/Saturation are taken from it")
    out = []
    for n, c in enumerate(clips):
        progress(0.6 + 0.4 * n / max(len(clips), 1), f"Matching {n + 1} of {len(clips)}")
        r = {k: c[k] for k in ("index", "name", "camera", "overlap", "current", "lumetri")}
        r["flags"] = list(c["flags"])
        if not c.get("frames"):
            r["role"] = "skipped"
        elif c["camera"] == ref_cam:
            r["role"] = "reference"
        else:
            r["role"] = "match"
            f = fit(c["frames"], ref, cal, c["overlap"], c["current"], c["faces"])
            r.update(proposal=f["values"], changed=f["changed"], basis=f["basis"], confidence=f["confidence"],
                     error_before=f["error_before"], error_after=f["error_after"])
            r["flags"] += f["flags"]
            if c["lumetri"] == "manual":
                r["flags"].append("has a manual Lumetri grade: will not be touched")
            r["preview"] = _preview(c["frames"][0], c["current"], f["values"], cal)
        out.append(r)
    return {"reference": ref_cam, "cameras": cameras, "scores": scores, "reference_look": ref, "notes": notes,
            "clips": out}


def _frames_and_faces(path: str, times) -> tuple[list[np.ndarray], list[list]]:
    """The frames of one clip at the analysis size, and the faces found in each. Faces are small in wide shots,
    so they are looked for on a frame twice as big (one decode), which is then reduced to the analysis size."""
    frames = C.read_frames(path, times=times, n=4, width=2 * ANALYSIS_SIDE)
    faces = [F.detect(f) for f in frames]
    out, boxes = [], []
    for f, fc in zip(frames, faces):
        h, w = f.shape[:2]
        if max(h, w) < 1.5 * ANALYSIS_SIDE:                       # already small (tests, tiny sources)
            out.append(f)
            boxes.append(fc)
            continue
        k = ANALYSIS_SIDE / max(h, w)
        nh, nw = int(round(h * k / 2) * 2), int(round(w * k / 2) * 2)
        out.append(_shrink(f, nh, nw))
        boxes.append([(int(round(b[0] * nw / w)), int(round(b[1] * nh / h)), max(int(round(b[2] * nw / w)), 1),
                       max(int(round(b[3] * nh / h)), 1), b[4]) for b in fc])
    return out, boxes


def _shrink(f: np.ndarray, nh: int, nw: int) -> np.ndarray:
    """Area average down to nh x nw (the same look as ffmpeg's scale=area used for the analysis frames)."""
    h, w = f.shape[:2]
    ys, xs = np.linspace(0, h, nh + 1).astype(int), np.linspace(0, w, nw + 1).astype(int)
    rows = np.add.reduceat(f, ys[:-1], axis=0) / np.diff(ys)[:, None, None]
    return np.add.reduceat(rows, xs[:-1], axis=1) / np.diff(xs)[None, :, None]


def _preview(lin, current, proposal, cal) -> dict:
    return {"before": C._jpeg_b64(C.encode(simulate(lin, current, cal))),
            "after": C._jpeg_b64(C.encode(simulate(lin, proposal, cal))),
            "portrait": lin.shape[0] > lin.shape[1]}


def check(before_path: str, after_path: str, ref: dict) -> dict:
    """The match on Premiere's own frames of the clip, before and after, against the reference look.

    Each component is compared only on an anchor the reference, the before frame AND the after frame all have
    (faces are looked for on every frame: a face in one and none in the other is not a comparison). The rest is
    reported as skipped, with the reason, and can never count as an improvement or send a value back.
    Result: per component better/same/worse/unknown, `revert` (worse ones), `reliable` {component: anchor},
    `skipped` {component: reason}, `summary` and `report` (Bulgarian lines for the panel)."""
    img_b, img_a = C.read_image(before_path), C.read_image(after_path)
    if img_b.shape == img_a.shape and float(np.max(np.abs(img_b - img_a))) < 2 / 255:
        # GStroy 2026-11-01 (0.9.31): a clip piece's before and after frames were byte-identical although the values
        # changed (the clip was not what the viewer shows at that moment, or Premiere gave back the old frame).
        # Nothing was measured on the clip's change, so nothing may be called "same" or "better".
        skipped = {k: "the frame before and after is the same: the change does not show on it" for k in PART_BG}
        return {"error_before": {k: None for k in PART_BG}, "error_after": {k: None for k in PART_BG},
                "verdict": {k: "unknown" for k in PART_BG}, "revert": [], "reliable": {}, "skipped": skipped,
                "summary": "cannot check on a frame: the frame after the change is the same as before (the clip is hidden under "
                           "another layer at this moment, or Premiere did not refresh the frame), nothing is confirmed",
                "report": []}
    b = pool([anchors(img_b, F.detect(img_b))])
    a = pool([anchors(img_a, F.detect(img_a))])
    basis = common_basis([b, a], ref, allow_mid=False)
    eb, ea = match_error(b, ref, basis), match_error(a, ref, basis)
    verdict = {}
    for k in ("exposure", "white", "saturation", "contrast"):
        if eb[k] is None or ea[k] is None:
            verdict[k] = "unknown"
        else:
            verdict[k] = "worse" if ea[k] > eb[k] + WORSE[k] else "better" if ea[k] < eb[k] - WORSE[k] else "same"
    why = {"exposure": "no face or white/grey surfaces on the reference and on both frames",
           "white": "no white/grey surfaces or face on the reference and on both frames",
           "saturation": "no face on the reference and on both frames",
           "contrast": "the frames show different content"}
    reliable = {k: basis[k] for k in verdict if k in basis and verdict[k] != "unknown"}
    skipped = {k: why[k] for k in verdict if verdict[k] == "unknown"}
    revert = [k for k, x in verdict.items() if x == "worse"]
    report = [f"{PART_BG[k]}: {BASIS_BG.get(v, 'overall tones')}, {_VERDICT_BG[verdict[k]]}" for k, v in reliable.items()]
    report += [f"{PART_BG[k]}: not checked ({r})" for k, r in skipped.items()]
    if not reliable:
        summary = "cannot check on a frame: no measurement is reliable, so nothing was reverted and nothing is confirmed"
    elif revert:
        summary = ""
    else:
        summary = "checked on a frame: closer to the reference or the same (reliable measurements only)"
    return {"error_before": eb, "error_after": ea, "verdict": verdict, "revert": revert, "reliable": reliable,
            "skipped": skipped, "summary": summary, "report": report}


_VERDICT_BG = {"better": "closer to the reference", "same": "the same", "worse": "further from the reference"}
