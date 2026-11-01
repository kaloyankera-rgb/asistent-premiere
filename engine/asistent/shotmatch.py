"""Auto Shot Match: make clips from two or more cameras look like one reference camera.

Measured on content-independent anchors, never on average RGB or luminance: skin (brightness, hue, saturation),
neutral surfaces (white balance) and, only where both cameras show the same real moment, the tone spread
(contrast). The clips are read from the source files at the moments the panel picks (overlapping moments of
the cameras first), and the clip's current Lumetri values are simulated on them with the models the probe
measured. The proposal is therefore an ABSOLUTE set of Lumetri values computed from the source: running Shot
Match again gives the same values, nothing accumulates. Differences too large to be a camera mismatch, or anchors
that disagree, are flagged and not applied (intentional light, different scene, or no reliable anchor).
"""
from __future__ import annotations

import os

import numpy as np

from . import color as C

# Lumetri models measured by the probe on C0737 (2026-11-01), per slider unit
TEMP_GAINS = np.array([0.00814, -0.00187, -0.01188])     # log2 gain per channel: a pure white-balance gain
TINT_GAINS = np.array([0.00988, -0.00513, 0.00987])
TEMP_PER_T = float(TEMP_GAINS[2] - TEMP_GAINS[0])         # log2(B/R) per Temperature unit (≈ −0.020)
TINT_PER_G = float(TINT_GAINS[1] - (TINT_GAINS[0] + TINT_GAINS[2]) / 2)   # log2(G/√RB) per Tint unit (≈ −0.015)
CONTRAST_K, CONTRAST_PIVOT = 0.002288, 0.50               # encoded luma slope 1 + k·c around the pivot
SAT_B = 0.00931                                          # linear chroma × (1 + b·(S − 100)), luma kept

DEFAULT = {"exposure": 0.0, "temperature": 0.0, "tint": 0.0, "contrast": 0.0, "saturation": 100.0}
# beyond these a difference is not a camera mismatch but light, scene or intent: flagged, never forced
LIMITS = {"stops": 1.5, "temp": 0.5, "tint": 0.3, "contrast": 20.0, "saturation": 20.0}
# below these a change is not worth an edit (and keeps re-runs from fiddling)
MINIMUM = {"exposure": 0.05, "temperature": 1.0, "tint": 1.0, "contrast": 3.0, "saturation": 3.0}
AGREE = (0.15, 0.10)          # neutral surfaces and skin must agree on the white difference (log2 t, g)
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

def anchors(enc: np.ndarray) -> dict:
    """Content-independent anchors of one frame: skin (brightness, hue, saturation), neutral surfaces, tones."""
    lin = C.to_linear(enc, None)
    m = C.measure(enc)
    clipped = np.max(enc, axis=-1) >= 0.97
    cast = m.get("cast_neutral") or m.get("cast_world") or (0.0, 0.0)
    t, g = cast
    fixed = C.encode(lin * np.array([2 ** (t / 2 + g / 3), 2 ** (-2 * g / 3), 2 ** (-t / 2 + g / 3)]))
    skin = C._skin(fixed) & ~clipped
    y_enc = C._luma(enc)
    lit = y_enc > 0.04
    out = {"neutral": m.get("cast_neutral") if m.get("neutral", 0) >= 0.005 else None,
           "clipped": float(np.mean(clipped)), "skin": None,
           "mid": float(np.median(y_enc[lit])) if lit.any() else None,
           "spread": float(np.percentile(y_enc[lit], 95) - np.percentile(y_enc[lit], 5)) if lit.sum() > 100 else None}
    if np.mean(skin) >= 0.01:
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
           "skin": None, "neutral": None}
    if n and len(skins) * 2 >= n:
        out["skin"] = {"y": med([s["y"] for s in skins]), "chroma": med([s["chroma"] for s in skins]),
                       "cast": (med([s["cast"][0] for s in skins]), med([s["cast"][1] for s in skins])),
                       "area": med([s["area"] for s in skins])}
    if n and len(neutrals) * 2 >= n:
        out["neutral"] = (med([c[0] for c in neutrals]), med([c[1] for c in neutrals]))
    return out


def look(frames_lin: list[np.ndarray], values: dict, cal) -> dict:
    """The anchors of these source frames as they look with these Lumetri values."""
    return pool([anchors(C.encode(simulate(f, values, cal))) for f in frames_lin])


# ---------------------------------------------------------------- comparing and fitting

def match_error(a: dict, ref: dict) -> dict:
    """How far a look is from the reference, per component (None: no common anchor to say)."""
    err = {"exposure": None, "white": None, "saturation": None, "contrast": None}
    if a["skin"] and ref["skin"]:
        err["exposure"] = abs(float(np.log2(a["skin"]["y"] / ref["skin"]["y"])))
        err["saturation"] = abs(float(np.log2(a["skin"]["chroma"] / ref["skin"]["chroma"])))
    elif a["mid"] and ref["mid"]:
        err["exposure"] = abs(C.GAMMA * float(np.log2(a["mid"] / ref["mid"])))
    pair = (a["neutral"], ref["neutral"]) if a["neutral"] and ref["neutral"] else \
        (a["skin"]["cast"], ref["skin"]["cast"]) if a["skin"] and ref["skin"] else None
    if pair:
        err["white"] = max(abs(pair[0][0] - pair[1][0]) / 0.1, abs(pair[0][1] - pair[1][1]) / 0.06)
    if a["spread"] and ref["spread"]:
        err["contrast"] = abs(float(np.log2(a["spread"] / ref["spread"])))
    return err


def fit(frames_lin: list[np.ndarray], ref: dict, cal, overlap: bool, current: dict | None = None) -> dict:
    """Absolute Lumetri values that make these source frames look like the reference, component by component.
    `overlap`: the frames show the same real moments as the reference camera (contrast only then).
    A component that is not fitted (flagged, no anchor) or would move less than MINIMUM keeps the clip's
    `current` value: a flag never wipes an earlier correction, and a re-run does not fiddle."""
    current = {**DEFAULT, **(current or {})}
    v = dict(DEFAULT)
    flags, basis = [], {}
    cur = look(frames_lin, v, cal)

    # white: neutral surfaces and the skin's hue, which must agree (different light otherwise)
    dn = (ref["neutral"][0] - cur["neutral"][0], ref["neutral"][1] - cur["neutral"][1]) \
        if ref["neutral"] and cur["neutral"] else None
    ds = (ref["skin"]["cast"][0] - cur["skin"]["cast"][0], ref["skin"]["cast"][1] - cur["skin"]["cast"][1]) \
        if ref["skin"] and cur["skin"] else None
    d = None
    if dn and ds and (abs(dn[0] - ds[0]) > AGREE[0] or abs(dn[1] - ds[1]) > AGREE[1]):
        flags.append("бялото: неутралните повърхности и кожата не са съгласни (различна светлина?): не е пипано")
    elif dn or ds:
        d = ((dn[0] + ds[0]) / 2, (dn[1] + ds[1]) / 2) if dn and ds else (dn or ds)
        basis["white"] = "неутрални + кожа" if dn and ds else "неутрални" if dn else "кожа"
    else:
        flags.append("бялото: няма неутрални повърхности и кожа и в двете камери: не е пипано")
    if d and (abs(d[0]) > LIMITS["temp"] or abs(d[1]) > LIMITS["tint"]):
        flags.append(f"бялото: разликата е голяма ({d[0]:+.2f}/{d[1]:+.2f}), вероятно нарочна светлина: не е пипано")
        d = None
    if d:
        v["temperature"] = round(d[0] / TEMP_PER_T, 1)
        v["tint"] = round(d[1] / TINT_PER_G, 1)

    # exposure: the skin's brightness (or, at the same real moment, the mid-tones)
    cur = look(frames_lin, v, cal)
    def need(c):
        if ref["skin"] and c["skin"]:
            return float(np.log2(ref["skin"]["y"] / c["skin"]["y"])), "кожата", float(C.encode(np.array(c["skin"]["y"])))
        if overlap and ref["mid"] and c["mid"]:
            return C.GAMMA * float(np.log2(ref["mid"] / c["mid"])), "общия момент", c["mid"]
        return None, None, None
    stops, why, at = need(cur)
    if stops is None:
        flags.append("яркостта: няма кожа и общ момент с еталона: не е пипано")
    elif abs(stops) > LIMITS["stops"]:
        flags.append(f"яркостта: разликата е {stops:+.1f} стопа, вероятно нарочна или друга сцена: не е пипано")
    else:
        basis["exposure"] = why
        for _ in range(3):                     # the curve and the shoulder: correct, look again, correct
            rate = float(np.interp(float(at), *_curve(cal))) if stops > 0 else 1.0
            v["exposure"] = round(v["exposure"] + stops / max(rate, 0.25), 2)
            cur = look(frames_lin, v, cal)
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
                flags.append(f"наситеността: разликата е голяма ({s - 100:+.0f}): не е пипано")
                v["saturation"], ok = 100.0, False
                break
            v["saturation"] = round(s, 0)
            cur = look(frames_lin, v, cal)
        if ok:
            basis["saturation"] = "кожата"
    # contrast: the tone spread, only where both cameras show the same real moment (content would decide otherwise)
    if overlap and ref["spread"] and cur["spread"]:
        c = v["contrast"] + (ref["spread"] / cur["spread"] - 1) / CONTRAST_K
        if abs(c) > LIMITS["contrast"]:
            flags.append(f"контрастът: разликата е голяма ({c:+.0f}): не е пипано")
        else:
            v["contrast"] = round(c, 0)
            basis["contrast"] = "общия момент"
    fitted = {"white": ("temperature", "tint"), "exposure": ("exposure",), "saturation": ("saturation",),
              "contrast": ("contrast",)}
    for part, keys in fitted.items():
        for k in keys:
            if part not in basis or abs(v[k] - current[k]) < MINIMUM[k]:
                v[k] = current[k]
    before, after = match_error(look(frames_lin, current, cal), ref), match_error(look(frames_lin, v, cal), ref)
    changed = [k for k in DEFAULT if abs(v[k] - current[k]) >= 1e-9]
    return {"values": v, "changed": changed, "flags": flags, "basis": basis, "error_before": before,
            "error_after": after}


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
        progress(0.6 * i / max(len(items), 1), f"Гледам {i + 1} от {len(items)}")
        rec = {"index": i, "name": os.path.basename(it["path"]), "camera": it.get("camera") or "?",
               "overlap": bool(it.get("overlap")), "current": {**DEFAULT, **(it.get("current") or {})},
               "lumetri": it.get("lumetri") or "none", "flags": []}
        gamma = sony_xml(it["path"]).get("gamma")
        if gamma and "log" in gamma.lower():
            rec["flags"].append(f"запис в {gamma}: Shot Match засега е само за Rec.709, пропуснато")
        else:
            try:
                rec["frames"] = [C.to_linear(f, None) for f in C.read_frames(it["path"], times=it.get("times") or None,
                                                                            n=4)]
            except C.MediaError as e:
                rec["flags"].append(str(e))
        clips.append(rec)
    usable = [c for c in clips if c.get("frames")]
    cameras = sorted({c["camera"] for c in usable})
    if len(cameras) < 2:
        raise ValueError("За изравняване трябват клипове от поне две камери (папки).")
    # each camera as it looks now (its current Lumetri values simulated on the source)
    looks = {cam: pool([a for c in usable if c["camera"] == cam for a in
                        [anchors(C.encode(simulate(f, c["current"], cal))) for f in c["frames"]]]) for cam in cameras}
    scores = {cam: reliability(p) for cam, p in looks.items()}
    ref_cam = reference if reference in cameras else max(cameras, key=lambda k: scores[k])
    ref = looks[ref_cam]
    notes = []
    if any(c["lumetri"] == "manual" for c in usable if c["camera"] == ref_cam):
        notes.append("еталонът има ръчна корекция: взети са само Exposure/Temperature/Tint/Contrast/Saturation от нея")
    out = []
    for n, c in enumerate(clips):
        progress(0.6 + 0.4 * n / max(len(clips), 1), f"Изравнявам {n + 1} от {len(clips)}")
        r = {k: c[k] for k in ("index", "name", "camera", "overlap", "current", "lumetri")}
        r["flags"] = list(c["flags"])
        if not c.get("frames"):
            r["role"] = "skipped"
        elif c["camera"] == ref_cam:
            r["role"] = "reference"
        else:
            r["role"] = "match"
            f = fit(c["frames"], ref, cal, c["overlap"], c["current"])
            r.update(proposal=f["values"], changed=f["changed"], basis=f["basis"], error_before=f["error_before"],
                     error_after=f["error_after"])
            r["flags"] += f["flags"]
            if c["lumetri"] == "manual":
                r["flags"].append("има ръчна Lumetri корекция: няма да се пипа")
            r["preview"] = _preview(c["frames"][0], c["current"], f["values"], cal)
        out.append(r)
    return {"reference": ref_cam, "cameras": cameras, "scores": scores, "reference_look": ref, "notes": notes,
            "clips": out}


def _preview(lin, current, proposal, cal) -> dict:
    return {"before": C._jpeg_b64(C.encode(simulate(lin, current, cal))),
            "after": C._jpeg_b64(C.encode(simulate(lin, proposal, cal))),
            "portrait": lin.shape[0] > lin.shape[1]}


def check(before_path: str, after_path: str, ref: dict) -> dict:
    """The match on Premiere's own frames of the clip, before and after: per component better/same/worse."""
    b = pool([anchors(C.read_image(before_path))])
    a = pool([anchors(C.read_image(after_path))])
    eb, ea = match_error(b, ref), match_error(a, ref)
    verdict = {}
    for k in ("exposure", "white", "saturation", "contrast"):
        if eb[k] is None or ea[k] is None:
            verdict[k] = "unknown"
        else:
            verdict[k] = "worse" if ea[k] > eb[k] + WORSE[k] else "better" if ea[k] < eb[k] - WORSE[k] else "same"
    return {"error_before": eb, "error_after": ea, "verdict": verdict,
            "revert": [k for k, x in verdict.items() if x == "worse"]}
