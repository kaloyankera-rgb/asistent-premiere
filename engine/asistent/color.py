"""Smart White Balance and exposure: measure a clip from several frames and suggest a conservative fix.

Everything is measured in linear Rec.709 light. Rec.709 footage is decoded with the BT.1886 2.4 gamma,
S-Log3 / S-Gamut3.Cine footage (Sony, read from the sidecar XML) with Sony's own curve and gamut matrix.

Exposure: from skin when faces are in the picture (encoded skin luma ~0.62 is the target), otherwise from
the mid-tones with lower confidence; never so much that more than a sliver of the picture clips.
Suggested in 0.5-stop steps.

White balance: from near-neutral bright surfaces (walls, white clothes, paper), checked against the
whole picture (grey world on unsaturated mid-tones). A cast is two numbers in log2 units:
  temp = log2(B/R)      > 0 cool/blue,  < 0 warm/orange
  tint = log2(G/√(RB))  > 0 green,      < 0 magenta/purple
High confidence only when both methods agree and the frames agree. No neutrals + warm light (a
restaurant) is treated as intentional: low confidence, nothing applied. Never contrast, saturation or LUTs.
"""
from __future__ import annotations

import os

import numpy as np

from .media import MediaError, _run, _tool, probe

GAMMA = 2.4
SKIN_TARGET = 0.62            # encoded luma of well exposed skin in Rec.709
MID_TARGET = 0.42             # encoded median of an average scene
STEP = 0.5
MAX_STOPS = 2.0               # the user's range: +0.5 … +2 (and the same down)
NEW_CLIP = 0.03               # brightening may burn out at most this much more of the picture
CLIP_SOFT_TOLERANCE = 0.0025  # up to 0.25 points over NEW_CLIP the final result is accepted with a warning
SKIN_CLIP_LIMIT = 0.01        # newly clipped share of the skin area that makes a result need review
LIGHT_LEVEL = 0.90            # already this bright before (lamps, windows, sky, reflections): usually intended
SKIN_ON_TARGET = 0.2          # stops from the skin/mid-tone target that still count as "preserved"
BALANCED = (0.08, 0.05)       # |temp|, |tint| below this: leave it
MAX_FIX = (0.8, 0.4)          # never correct more than this in one go
SEARCH = (0.9, 0.5)           # |temp|, |tint| a camera cast can have: only there a surface may count as grey

# S-Gamut3.Cine -> Rec.709 (linear), Sony technical summary
SG3C_TO_709 = np.array([[1.6269474, -0.5401385, -0.0868089],
                        [-0.1785155, 1.4179409, -0.2394254],
                        [-0.0444361, -0.1959199, 1.2403560]])


# ---------------------------------------------------------------- decoding

def slog3_to_linear(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    cut = 171.2102946929 / 1023.0
    hi = (10 ** ((x * 1023.0 - 420.0) / 261.5)) * (0.18 + 0.01) - 0.01
    lo = (x * 1023.0 - 95.0) * 0.01125000 / (171.2102946929 - 95.0)
    return np.where(x >= cut, hi, lo)


def to_linear(rgb: np.ndarray, gamma: str | None) -> np.ndarray:
    """Encoded R'G'B' (0..1) -> linear Rec.709."""
    if gamma and "log3" in gamma.lower():
        # Sony's curve is defined on the 10-bit code values of the legal-range signal (black 95, grey 420):
        # put the full-range R'G'B' back onto that scale before decoding
        lin = slog3_to_linear((np.asarray(rgb) * (940 - 64) + 64) / 1023.0)
        return np.clip(lin @ SG3C_TO_709.T, 0, None)
    return np.clip(rgb, 0, 1) ** GAMMA


def encode(lin: np.ndarray) -> np.ndarray:
    return np.clip(lin, 0, 1) ** (1 / GAMMA)


def _display_size(path: str, info) -> tuple[int, int]:
    """Width and height as the picture is shown: phones and cameras held upright store a rotation."""
    import json as _json
    p = _run([_tool("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries",
              "stream_side_data=rotation:stream_tags=rotate", "-of", "json", path])
    rot = 0
    try:
        st = (_json.loads(p.stdout or b"{}").get("streams") or [{}])[0]
        rot = int(float((st.get("tags") or {}).get("rotate") or 0))
        for sd in st.get("side_data_list") or []:
            if "rotation" in sd:
                rot = int(float(sd["rotation"]))
    except (ValueError, IndexError):
        rot = 0
    w, h = info.width or 16, info.height or 9
    return (h, w) if abs(rot) % 180 == 90 else (w, h)


def read_frames(path: str, n: int = 6, width: int = 480, start: float = 0.0, end: float | None = None) -> list[np.ndarray]:
    """n frames spread over [start, end) of the media as encoded R'G'B' floats (full range).
    `width` is the long side; the picture keeps its shown proportions (rotation included)."""
    info = probe(path)
    if not info.has_video:
        raise MediaError(f"{os.path.basename(path)} няма картина.")
    dur = (end if end else info.duration) - start
    dw, dh = _display_size(path, info)
    if dw >= dh:
        w, h = width, int(round(width * dh / dw / 2) * 2)
    else:
        w, h = int(round(width * dw / dh / 2) * 2), width
    width = w
    p = _run([_tool("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_range",
              "-of", "default=nk=1:nw=1", path])
    rng = "pc" if p.stdout.decode(errors="replace").strip() == "pc" else "tv"
    frames = []
    for i in range(n):
        t = start + dur * (0.05 + 0.9 * (i + 0.5) / n)
        p = _run([_tool("ffmpeg"), "-v", "error", "-nostdin", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1",
                  "-vf", f"scale={width}:{h}:flags=area:in_color_matrix=bt709:in_range={rng}:out_range=pc,format=rgb48le",
                  "-f", "rawvideo", "-"])
        data = np.frombuffer(p.stdout, dtype="<u2")
        if p.returncode == 0 and data.size == width * h * 3:
            frames.append(data.reshape(h, width, 3).astype(np.float64) / 65535.0)
    if not frames:
        raise MediaError(f"Не мога да прочета кадри от {os.path.basename(path)}.")
    return frames


def read_image(path: str) -> np.ndarray:
    """A still (e.g. a frame exported by Premiere) as encoded R'G'B' floats."""
    p = _run([_tool("ffmpeg"), "-v", "error", "-nostdin", "-i", path, "-frames:v", "1", "-vf", "format=rgb48le",
              "-f", "rawvideo", "-"])
    q = _run([_tool("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
              "-of", "csv=p=0", path])
    w, h = (int(v) for v in q.stdout.decode().strip().split(",")[:2])
    return np.frombuffer(p.stdout, dtype="<u2").reshape(h, w, 3).astype(np.float64) / 65535.0


# ---------------------------------------------------------------- measuring one frame

def _luma(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def _skin(enc: np.ndarray) -> np.ndarray:
    """Skin-like pixels (BT.709 YCbCr box, wide enough for a mild cast)."""
    y = _luma(enc)
    cb = (enc[..., 2] - y) / 1.8556
    cr = (enc[..., 0] - y) / 1.5748
    return (y > 0.25) & (y < 0.92) & (cr > 0.02) & (cr < 0.17) & (cb > -0.16) & (cb < -0.01)


def _cast(rgb_sum: np.ndarray) -> tuple[float, float]:
    r, g, b = np.maximum(rgb_sum, 1e-9)
    return float(np.log2(b / r)), float(np.log2(g / np.sqrt(r * b)))


def measure(enc: np.ndarray, gamma: str | None = None) -> dict:
    """One frame: exposure need (stops), cast from neutrals and from grey world, coverage numbers."""
    lin = to_linear(enc, gamma)
    view = encode(lin)                       # what it looks like in Rec.709
    y_lin = _luma(lin)
    y_enc = _luma(view)
    clipped = np.max(view, axis=-1) >= 0.97
    out = {"clipped": float(np.mean(clipped))}

    lit = y_enc > 0.04
    if lit.any():
        out["y_mid"] = float(np.median(y_enc[lit]))
        out["exp_mid"] = float(GAMMA * np.log2(MID_TARGET / max(out["y_mid"], 1e-4)))

    ok = ~clipped & (y_lin > np.percentile(y_lin, 40)) & (y_lin < np.percentile(y_lin, 99.5))

    def chroma_after(cast):
        """How coloured each pixel is once a cast is taken out (a grey wall under warm light is grey again)."""
        t, g = cast
        gains = np.array([2 ** (t / 2 + g / 3), 2 ** (-2 * g / 3), 2 ** (-t / 2 + g / 3)])
        x = lin * gains
        mx, mn = np.max(x, axis=-1), np.min(x, axis=-1)
        return (mx - mn) / np.maximum(mx, 1e-9)

    # grey world on the less coloured mid-tones (skin and coloured objects would pull it)
    mid = ~clipped & (y_enc > 0.15) & (y_enc < 0.85)
    cast = _cast(lin[mid].sum(axis=0)) if mid.sum() > 50 else (0.0, 0.0)    # rough: every mid-tone
    for _ in range(3):
        sel = mid & (chroma_after(cast) < 0.35)
        if sel.sum() <= 50:
            break
        cast = _cast(lin[sel].sum(axis=0))
    if mid.sum() > 50:
        out["cast_world"] = cast
    # near-neutral bright surfaces: the biggest group of bright pixels sharing one tint, looked for only
    # where a camera cast can be (a green plant or warm wood is far outside and never counts as grey)
    neutral = np.zeros_like(ok)
    px = lin[ok]
    if len(px) > 50:
        safe = np.maximum(px, 1e-6)
        pt = np.log2(safe[:, 2] / safe[:, 0])
        pg = np.log2(safe[:, 1] / np.sqrt(safe[:, 0] * safe[:, 2]))
        inside = (np.abs(pt) <= SEARCH[0]) & (np.abs(pg) <= SEARCH[1])
        if inside.sum() > 50:
            hist, et, eg = np.histogram2d(pt[inside], pg[inside], bins=(37, 21),
                                          range=((-SEARCH[0], SEARCH[0]), (-SEARCH[1], SEARCH[1])),
                                          weights=_luma(px[inside]))
            pad = np.pad(hist, 1)
            smooth = sum(pad[i:i + hist.shape[0], j:j + hist.shape[1]] for i in range(3) for j in range(3))
            it, ig = np.unravel_index(int(np.argmax(smooth)), smooth.shape)
            ct, cg = (et[it] + et[it + 1]) / 2, (eg[ig] + eg[ig + 1]) / 2
            near = inside & (np.abs(pt - ct) < 0.12) & (np.abs(pg - cg) < 0.08)
            if near.sum() > 50:
                idx = np.flatnonzero(ok)[near]
                neutral.flat[idx] = True
                cast_n = _cast(px[near].sum(axis=0))
                out["cast_neutral"] = cast_n
                cast = cast_n
    out["neutral"] = float(np.mean(neutral))

    # skin, looked for once the cast is out (a grey wall under warm light would pass for skin)
    t, g = cast
    view_fixed = encode(lin * np.array([2 ** (t / 2 + g / 3), 2 ** (-2 * g / 3), 2 ** (-t / 2 + g / 3)]))
    skin = _skin(view_fixed) & ~clipped
    out["skin"] = float(np.mean(skin))
    if out["skin"] >= 0.01:
        out["y_skin"] = float(np.median(_luma(view_fixed)[skin]))
        out["exp_skin"] = float(GAMMA * np.log2(SKIN_TARGET / max(out["y_skin"], 1e-4)))
    # what a given exposure would clip (for the highlight guard)
    out["_view_max"] = np.max(view, axis=-1)
    out["_lin_max"] = np.max(lin, axis=-1)
    return out


# ---------------------------------------------------------------- the decision

def _round_step(stops: float) -> float:
    s = round(stops / STEP) * STEP
    return float(np.clip(s, -MAX_STOPS, MAX_STOPS))


def decide(frames: list[np.ndarray], gamma: str | None = None) -> dict:
    ms = [measure(f, gamma) for f in frames]
    reasons, warnings = [], []

    # ---- exposure
    skin_vals = [m["exp_skin"] for m in ms if "exp_skin" in m]
    mid_vals = [m["exp_mid"] for m in ms if "exp_mid" in m]
    # at_luma: the encoded brightness being corrected (Lumetri Exposure moves dark and bright pixels differently)
    if len(skin_vals) >= max(2, len(ms) // 2):
        raw, basis, spread = float(np.median(skin_vals)), "кожата", float(np.std(skin_vals))
        at_luma = float(np.median([m["y_skin"] for m in ms if "y_skin" in m]))
    elif mid_vals:
        raw, basis, spread = float(np.median(mid_vals)), "средните тонове", float(np.std(mid_vals))
        at_luma = float(np.median([m["y_mid"] for m in ms if "y_mid" in m]))
    else:
        raw, basis, spread, at_luma = 0.0, None, 9.0, None
    stops = _round_step(raw) if abs(raw) >= 0.35 else 0.0
    # highlights: a plain gain is a pessimistic model (Lumetri rolls the highlights off), so this only
    # warns; the panel checks the real Lumetri result on an exported frame and steps back if needed
    def burnt(s):
        return float(np.mean([np.mean((m["_lin_max"] * 2 ** s) ** (1 / GAMMA) >= 0.97) - m["clipped"] for m in ms]))
    burn = burnt(stops) if stops > 0 else 0.0
    if burn > NEW_CLIP:
        warnings.append(f"Светлите части може да изгорят (груба оценка {burn:.0%} от картината): "
                        "проверява се на кадър от Premiere след прилагането.")
    exp_conf = "high" if basis == "кожата" and spread < 0.4 else "medium" if basis and spread < 0.6 else "low"
    if basis:
        reasons.append(f"Експозиция по {basis}: {'+' if stops > 0 else ''}{stops:g} (измерено {raw:+.2f} стопа).")

    # ---- white balance
    neu = [m["cast_neutral"] for m in ms if "cast_neutral" in m]
    wor = [m["cast_world"] for m in ms if "cast_world" in m]
    neutral_frac = float(np.mean([m["neutral"] for m in ms]))
    temp = tint = 0.0
    wb_conf = "low"
    if neu:
        n_t, n_g = np.median([c[0] for c in neu]), np.median([c[1] for c in neu])
        n_sd = max(np.std([c[0] for c in neu]), np.std([c[1] for c in neu]))
        temp, tint = float(n_t), float(n_g)
        agree = bool(wor) and abs(np.median([c[0] for c in wor]) - n_t) < 0.25 and \
            abs(np.median([c[1] for c in wor]) - n_g) < 0.15
        if neutral_frac >= 0.02 and agree and n_sd < 0.1:
            wb_conf = "high"
        elif neutral_frac >= 0.005 and n_sd < 0.2:
            wb_conf = "medium"
        if not agree:
            reasons.append("Неутралните повърхности и цялата картина не са съгласни (цветни обекти или смесена светлина).")
    elif wor:
        temp = float(np.median([c[0] for c in wor]))
        tint = float(np.median([c[1] for c in wor]))
        reasons.append("Няма неутрални повърхности за мерене: само ориентир.")
    if neutral_frac < 0.01 and temp < -0.25:
        wb_conf = "low"
        reasons.append("Топла светлина без неутрални повърхности: вероятно е нарочна (ресторант, лампи), не се пипа.")
    balanced = abs(temp) < BALANCED[0] and abs(tint) < BALANCED[1]
    fix_t = 0.0 if balanced else float(np.clip(-temp, -MAX_FIX[0], MAX_FIX[0]))
    fix_g = 0.0 if balanced else float(np.clip(-tint, -MAX_FIX[1], MAX_FIX[1]))
    if balanced and wb_conf != "low":
        reasons.append("Бялото е наред: без корекция.")
    if not balanced:
        if tint > 0.08:
            reasons.append(f"Зелен оттенък ({tint:+.2f}).")
        elif tint < -0.08:
            reasons.append(f"Лилав/магента оттенък ({tint:+.2f}).")
        if temp < -0.08:
            reasons.append(f"Твърде топло ({temp:+.2f}).")
        elif temp > 0.08:
            reasons.append(f"Твърде студено ({temp:+.2f}).")

    # log footage: Lumetri on the flat signal does not act like on Rec.709 and the render check would
    # measure a flat picture; until the colour management / LUT of these projects is known: suggest only
    if gamma and "log" in gamma.lower():
        exp_conf = "medium" if exp_conf == "high" else exp_conf
        wb_conf = "medium" if wb_conf == "high" else wb_conf
        warnings.append(f"Запис в {gamma}: предложението е за картината след превръщане в Rec.709; "
                        "не се прилага само (първо LUT или цветово управление).")

    # channel gains (linear) that remove the cast, luminance kept
    r, g, b = 2 ** (-fix_t / 2 - fix_g / 3), 2 ** (2 * fix_g / 3), 2 ** (fix_t / 2 - fix_g / 3)
    norm = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return {
        "exposure": {"stops": stops, "measured": round(raw, 2), "basis": basis, "confidence": exp_conf,
                     "burn_estimate": round(burn, 3),
                     "at_luma": round(at_luma, 3) if at_luma is not None else None},
        "white": {"cast_temp": round(temp, 3), "cast_tint": round(tint, 3), "fix_temp": round(fix_t, 3),
                  "fix_tint": round(fix_g, 3), "balanced": balanced, "confidence": wb_conf,
                  "neutral_area": round(neutral_frac, 4), "gains": [round(v / norm, 4) for v in (r, g, b)]},
        "skin_area": round(float(np.mean([m["skin"] for m in ms])), 4),
        "clipped": round(float(np.mean([m["clipped"] for m in ms])), 4),
        "frames": len(ms), "gamma": gamma or "rec709", "reasons": reasons, "warnings": warnings,
    }


def analyze_clip(path: str, start: float = 0.0, end: float | None = None, gamma: str | None = None) -> dict:
    if gamma is None:
        from .prepare import sony_xml
        gamma = sony_xml(path).get("gamma")
    res = decide(read_frames(path, start=start, end=end), gamma)
    res.update(path=path, name=os.path.basename(path))
    return res


def new_clipping(before: np.ndarray, after: np.ndarray) -> float:
    """Share of the picture that burns out in `after` but did not in `before` (same size, encoded)."""
    b = np.max(before, axis=-1) >= 0.97
    a = np.max(after, axis=-1) >= 0.97
    return float(np.mean(a & ~b))


def check_render(before_path: str, after_path: str, exposure_units: float = 0.0, cal=None,
                 soft_tolerance: float = CLIP_SOFT_TOLERANCE) -> dict:
    """Two frames exported by Premiere (without / with the correction): how neutral and how bright the
    result is, and how much burnt out. Used to verify and, if needed, step the correction back."""
    b, a = read_image(before_path), read_image(after_path)
    if b.shape != a.shape:
        raise MediaError("Кадрите преди и след са с различен размер.")
    ma = measure(a)
    out = {"new_clipping": round(new_clipping(b, a), 4),
           "cast_after": ma.get("cast_neutral") or ma.get("cast_world"),
           "exposure_after": ma.get("exp_skin", ma.get("exp_mid")),
           "skin_after": round(ma.get("skin", 0.0), 4)}
    if exposure_units > 0 and out["new_clipping"] > NEW_CLIP:
        out["pullback_units"] = pullback_units(b, a, exposure_units, cal or Calibration())
    out["clipping_regions"] = clipping_regions(b, a)
    out.update(classify_clipping(out["new_clipping"], out["clipping_regions"], out["exposure_after"], soft_tolerance))
    if out.get("pullback_units"):
        # not a final verdict: the validated one-time step back follows and the re-check gives the verdict
        pct = f"{round(out['new_clipping'] * 10000) / 100:.2f}%"
        out.update(clipping_status="STEP_BACK",
                   clipping_message=f"Highlight clipping {pct} is over the target: Exposure steps back "
                                    f"{out['pullback_units']} units once and is re-checked.",
                   clipping_message_bg=f"Изгорели {pct}, над границата: експозицията се сваля веднъж с "
                                       f"{out['pullback_units']} и се проверява пак.")
    return out


def clipping_regions(before: np.ndarray, after: np.ndarray) -> dict:
    """Where the new clipping is: on skin (what matters most), in areas that were already near white before
    (lamps, windows, sky, reflections: usually intended), or in other detail. `skin` is a share of the skin
    area, `light` and `detail` are shares of the whole picture (they add up to the new clipping).

    Skin means skin TONES: only skin-coloured pixels below LIGHT_LEVEL before. Warm near-white highlights also
    fall in the skin colour box (C0739: 189 scattered pixels across the whole frame, all 0.94-0.97 before),
    and calling them burnt skin turned a good result into REVIEW_NEEDED."""
    mb, ma = np.max(before, axis=-1), np.max(after, axis=-1)
    was = mb >= 0.97
    new = (ma >= 0.97) & ~was
    skin = _skin(before) & (mb < LIGHT_LEVEL)
    light = new & (mb >= LIGHT_LEVEL)
    return {"skin": round(float(np.mean(new[skin])), 4) if np.mean(skin) >= 0.005 else 0.0,
            "light": round(float(np.mean(light)), 4), "detail": round(float(np.mean(new & ~light)), 4)}


def classify_clipping(new: float, regions: dict | None = None, exposure_after: float | None = None,
                      soft_tolerance: float = CLIP_SOFT_TOLERANCE, limit: float = NEW_CLIP) -> dict:
    """Status of the final clipping. Never asks for another correction: it only says how good the result is.

    ACCEPTED ≤ limit; ACCEPTED_WITH_WARNING up to `soft_tolerance` above it (verified C0739: 3.08 % with the
    skin on target is a good result, another step would only darken the skin), or above that when the excess
    is all in areas that were already near white; REVIEW_NEEDED when skin clips or real detail goes beyond the
    tolerance. Compared in hundredths of a percent, so 3.25 % is inside the tolerance and 3.26 % is not."""
    regions = regions or {}
    bp, lim, top = round(new * 10000), round(limit * 10000), round((limit + soft_tolerance) * 10000)
    pct, target = f"{bp / 100:.2f}%", f"≤{lim / 100:.2f}%"
    skin_ok = exposure_after is None or abs(exposure_after) < SKIN_ON_TARGET
    skin_clip = regions.get("skin", 0.0)
    if skin_clip > SKIN_CLIP_LIMIT:
        status = "REVIEW_NEEDED"
        en = (f"Highlight clipping on skin ({skin_clip * 100:.1f}% of the skin area, {pct} of the picture). "
              "No further correction applied: review the exposure by hand.")
        bg = (f"Кожата изгаря ({skin_clip * 100:.1f}% от кожата, {pct} от кадъра). "
              "Нищо повече не е пипано: провери експозицията ръчно.")
    elif bp <= lim:
        status = "ACCEPTED"
        en = f"Highlight clipping within target ({pct}, target {target})."
        bg = f"Изгорелите места са в границата ({pct}, граница {target})."
    elif bp <= top or round(regions.get("detail", new) * 10000) <= lim:
        status = "ACCEPTED_WITH_WARNING"
        light = bp > top                        # over the tolerance only because of lamps, windows, sky
        skin_en = " Skin exposure is preserved." if skin_ok else ""
        skin_bg = " Кожата е запазена." if skin_ok else ""
        if light:
            en = (f"Highlight clipping remains ({pct}, target {target}), mostly in areas that were already near "
                  f"white (lamps, windows, sky: {regions.get('light', 0) * 100:.2f}%).{skin_en} "
                  "No further correction applied.")
            bg = (f"Остават изгорели места ({pct}, граница {target}), главно където вече беше почти бяло "
                  f"(лампи, прозорци, небе: {regions.get('light', 0) * 100:.2f}%).{skin_bg} Нищо повече не е пипано.")
        else:
            en = f"Minor highlight clipping remains ({pct}, target {target}).{skin_en} No further correction applied."
            bg = f"Остават малко изгорели места ({pct}, граница {target}).{skin_bg} Нищо повече не е пипано."
    else:
        status = "REVIEW_NEEDED"
        en = (f"Highlight clipping above tolerance ({pct}, target {target}, tolerance "
              f"+{soft_tolerance * 100:.2f}). No further correction applied: pull Highlights/Whites by hand.")
        bg = (f"Изгорелите места са над допустимото ({pct}, граница {target}). Нищо повече не е пипано: "
              "прибери светлите части ръчно (Highlights/Whites).")
    return {"clipping_status": status, "clipping_message": en, "clipping_message_bg": bg}


def pullback_units(before: np.ndarray, after: np.ndarray, units: float, cal, limit: float = NEW_CLIP) -> float:
    """How many Exposure units to take back so that at most `limit` of the picture is newly burnt out.

    The brightest `limit` of what was not clipped before may clip; the pixel at that edge must land just
    under the clip level. The darkest pixels that did clip at `units` show where the clip level sits; both
    are moved with the probe's curve (bright pixels gain only ~0.5 stop per unit). Rounded up to 0.05, so
    it errs towards a darker picture; the panel re-checks the result on a new frame anyway."""
    mb, ma = np.max(before, axis=-1), np.max(after, axis=-1)
    was = mb >= 0.97
    new = (ma >= 0.97) & ~was
    if units <= 0 or np.mean(new) <= limit:
        return 0.0
    free = mb[~was]
    edge = float(np.quantile(free, float(np.clip(1 - limit * mb.size / free.size, 0, 1))))
    clipped_from = float(np.percentile(mb[new], 2))      # darkest pixels that burnt out at `units`
    if edge <= clipped_from:
        return 0.0
    log_lin = lambda v: GAMMA * np.log2(max(v, 1e-4))
    clip_level = log_lin(clipped_from) + units * cal.exposure_rate(clipped_from)
    keep = (clip_level - log_lin(edge)) / cal.exposure_rate(edge)
    back = float(np.ceil((units - keep) * 20 - 1e-9) / 20)
    return float(min(units, max(0.05, back)))


# ---------------------------------------------------------------- preview and Lumetri calibration

def _jpeg_b64(enc: np.ndarray) -> str:
    """A JPEG of an encoded frame at its own size and proportions, base64 for the panel's <img>."""
    import base64
    h, w = enc.shape[:2]
    raw = (np.clip(enc, 0, 1) * 65535).astype("<u2").tobytes()
    p = _run_input([_tool("ffmpeg"), "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", f"{w}x{h}", "-i", "-",
                    "-frames:v", "1", "-q:v", "3", "-f", "mjpeg", "-"], raw)
    return base64.b64encode(p).decode("ascii") if p else ""


def _run_input(cmd: list[str], data: bytes) -> bytes:
    import subprocess
    import sys as _sys
    flags = subprocess.CREATE_NO_WINDOW if _sys.platform == "win32" else 0
    p = subprocess.run(cmd, input=data, capture_output=True, creationflags=flags)
    return p.stdout if p.returncode == 0 else b""


def preview(frames: list[np.ndarray], gamma: str | None, res: dict) -> dict:
    """Before/after of one frame as the engine would correct it (an approximation of Lumetri)."""
    f = frames[len(frames) // 2]
    lin = to_linear(f, gamma)
    gains = np.array(res["white"]["gains"]) if res["white"]["confidence"] != "low" else np.ones(3)
    stops = res["exposure"]["stops"]
    return {"before": _jpeg_b64(encode(lin)), "after": _jpeg_b64(encode(lin * gains * 2 ** stops))}


def analyze_items(items: list[dict], with_preview: bool = True, progress=None, cancel=None) -> dict:
    from concurrent.futures import ThreadPoolExecutor
    from .prepare import sony_xml
    from .sync import Cancelled
    progress = progress or (lambda f, m: None)
    done = [0]
    cal = Calibration()

    def one(it):
        if cancel and cancel():
            raise Cancelled()
        path = it["path"]
        try:
            gamma = sony_xml(path).get("gamma")
            frames = read_frames(path, start=float(it.get("start") or 0), end=it.get("end"))
            r = decide(frames, gamma)
            r.update(path=path, name=os.path.basename(path))
            # what to write into Lumetri for these stops at this brightness (Exposure has a highlight shoulder)
            r["exposure"]["units"] = cal.exposure_units(r["exposure"]["stops"], r["exposure"]["at_luma"])
            if with_preview:                       # a sharper frame of its own for the eye (720 px long side)
                big = read_frames(path, n=1, width=720, start=float(it.get("start") or 0), end=it.get("end"))
                r["preview"] = preview(big, gamma, r)
                r["preview"]["portrait"] = big[0].shape[0] > big[0].shape[1]
        except MediaError as e:
            r = {"path": path, "name": os.path.basename(path), "error": str(e)}
        done[0] += 1
        progress(done[0] / len(items), f"Гледам {done[0]} от {len(items)}")
        return r

    with ThreadPoolExecutor(max_workers=4) as pool:
        return {"items": list(pool.map(one, items))}


class Calibration:
    """How many Lumetri slider units move the measured cast by one log2 unit (learnt from real renders).

    Starts from a guess; every verified render refines it, so later clips are right in one step.
    """

    GUESS = {"temp": 60.0, "tint": 80.0}

    def __init__(self, path: str | None = None):
        from . import config
        self.path = path or os.path.join(config.app_dir(), "lumetri.json")
        self.data = {"temp": [], "tint": []}
        try:
            import json
            with open(self.path, encoding="utf-8") as f:
                self.data.update(json.load(f))
        except (OSError, ValueError):
            pass

    def k(self, axis: str) -> float:
        probe = (self.data.get("probe") or {}).get(axis)
        if probe:
            return float(probe)
        xs = self.data.get(axis) or []
        return float(np.median(xs[-9:])) if xs else self.GUESS[axis]

    def learnt(self, axis: str) -> bool:
        return bool((self.data.get("probe") or {}).get(axis) or self.data.get(axis))

    def from_probe(self, axis: str) -> bool:
        """Temperature and Tint are pure channel gains (probe 2026-11-01): the probe, which moves one slider
        alone and compares pixel by pixel, is exact; a render check that also changed Exposure is not (the
        highlight shoulder squeezes the channel ratios: it read −84 where the probe read −50)."""
        return bool((self.data.get("probe") or {}).get(axis))

    def set_probe(self, axis: str, slider: float, moved: float) -> bool:
        if abs(slider) < 5 or abs(moved) < 0.05 or not (5 <= abs(slider / moved) <= 2000):
            return False
        self.data.setdefault("probe", {})[axis] = round(float(slider / moved), 2)
        self._save()
        return True

    def _save(self):
        import json
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f)
        os.replace(tmp, self.path)

    def sliders(self, fix_temp: float, fix_tint: float) -> dict:
        return {"temperature": round(self.k("temp") * fix_temp, 1), "tint": round(self.k("tint") * fix_tint, 1)}

    def exposure_units(self, stops: float, luma: float | None) -> float:
        """Lumetri Exposure units that move pixels of this encoded brightness by `stops`.

        Exposure is not a plain gain (probe 2026-11-01, C0737): +1 unit gives +1.00 stop in the shadows but
        about +0.7 at skin brightness and +0.57 at 0.75 (soft highlight shoulder). Brightening uses the
        probe's curve; darkening was never measured, so it stays 1 unit = 1 stop until it is. The render
        check after applying still measures the real result."""
        if stops <= 0 or luma is None or not self.data.get("exposure_curve"):
            return round(stops, 2)
        units = stops / self.exposure_rate(luma)
        return round(float(min(units, 2 * MAX_STOPS)) * 20) / 20     # Lumetri steps of 0.05

    def exposure_rate(self, luma: float) -> float:
        """Stops gained per Exposure unit at this encoded brightness (1.0 until the probe measured it)."""
        curve = self.data.get("exposure_curve") or []
        if len(curve) < 2:
            return 1.0
        ys, rates = zip(*sorted(curve))
        return max(float(np.interp(luma, ys, rates)), 0.25)          # flat beyond the measured ends

    def set_exposure_curve(self, points: list[list[float]]) -> bool:
        """[[encoded luma, stops per unit], ...] measured by the probe; replaces the old curve."""
        points = [[round(float(y), 3), round(float(r), 3)] for y, r in points if 0 < y < 1 and 0.2 <= r <= 1.5]
        if len(points) < 3:
            return False
        self.data["exposure_curve"] = points
        self._save()
        return True

    def learn(self, axis: str, slider: float, moved: float) -> bool:
        """slider units applied, cast change measured (log2): keep it when it is a clear, sane measurement."""
        if abs(slider) < 5 or abs(moved) < 0.05:
            return False
        k = slider / moved
        if not (5 <= abs(k) <= 2000):
            return False
        self.data.setdefault(axis, []).append(float(k))
        self._save()
        return True


# ---------------------------------------------------------------- capability probe (spec 01)

def frame_stats(enc: np.ndarray) -> dict:
    """Global numbers of a rendered frame: brightness (linear), cast, contrast, saturation."""
    lin = to_linear(enc, None)
    y_enc = _luma(enc)
    use = (np.max(enc, axis=-1) < 0.97) & (y_enc > 0.04)
    if use.sum() < 50:
        use = np.ones(y_enc.shape, bool)
    t, g = _cast(lin[use].sum(axis=0))
    return {"lin_mean": float(_luma(lin)[use].mean()), "temp": t, "tint": g,
            "spread": float(np.percentile(y_enc, 90) - np.percentile(y_enc, 10)),
            "chroma": float((np.max(enc, axis=-1) - np.min(enc, axis=-1))[use].mean()),
            "clipped": float(np.mean(np.max(enc, axis=-1) >= 0.97)), "_use": use}


def _found(path: str) -> str | None:
    """The exported frame, also when Premiere added its own extension once more (x.png -> x.png.png)."""
    for cand in (path, path + ".png"):
        if cand and os.path.isfile(cand) and os.path.getsize(cand) > 0:
            return cand
    return None


def _wait_file(path: str, seconds: float = 6.0) -> str | None:
    """The exported frame once Premiere has finished writing it (same size twice in a row).

    exportSequenceFrame in 26.0.2 only queues the export and returns at once: the file appears later,
    sometimes after the panel already changed the next value (seen 2026-11-01: seven probe frames written
    together, byte-identical). So the panel waits for each frame through this before it touches anything."""
    import time
    end = time.time() + seconds
    last = None
    while time.time() < end:
        hit = _found(path)
        size = os.path.getsize(hit) if hit else None
        if hit and size == last:
            return hit
        last = size
        time.sleep(0.15)
    return _found(path)


def prune_frames(folder: str, max_age_s: float = 24 * 3600) -> int:
    """Old exported frames out of the way; every export has its own name, so nothing reuses them."""
    import time
    gone = 0
    if not os.path.isdir(folder):
        return 0
    for name in os.listdir(folder):
        p = os.path.join(folder, name)
        if name.lower().endswith(".png") and os.path.isfile(p) and time.time() - os.path.getmtime(p) > max_age_s:
            os.remove(p)
            gone += 1
    return gone


def probe_measure(refs: dict, frames: list[dict]) -> dict:
    """Responses of the Lumetri parameters measured on Premiere's own frames, and the capability table."""
    out = {"frames": [], "identity": None}
    base_path = _wait_file((refs or {}).get("baseline") or "")
    if not base_path:
        out["error"] = "Няма изнесен кадър от Premiere (exportSequenceFrame не върна файл)."
        return out
    base = read_image(base_path)
    bs = frame_stats(base)
    src_path = _wait_file((refs or {}).get("source") or "")
    if src_path:
        ss = frame_stats(read_image(src_path))
        out["identity"] = {"stops": round(float(np.log2(bs["lin_mean"] / max(ss["lin_mean"], 1e-9))), 3),
                           "temp": round(bs["temp"] - ss["temp"], 3), "tint": round(bs["tint"] - ss["tint"], 3)}
    frame_of = {}                                  # param -> its measured frame
    for f in frames:
        rec = {k: v for k, v in f.items() if k != "path"}
        fp = _wait_file(f.get("path") or "") if f.get("path") else None
        if fp:
            a = read_image(fp)
            if a.shape == base.shape:
                st = frame_stats(a)
                # brightness and cast compared pixel by pixel on pixels usable in BOTH frames (brightening
                # burns some out; comparing different pixel sets would understate the change)
                both = bs["_use"] & st["_use"]
                la, lb = to_linear(a, None)[both], to_linear(base, None)[both]
                ya, yb = _luma(la), _luma(lb)
                ok = yb > 1e-4
                stops = float(np.median(np.log2(ya[ok] / yb[ok]))) if ok.any() else 0.0
                ca, cb = _cast(la.sum(axis=0)), _cast(lb.sum(axis=0))
                rec.update(
                    stops=round(stops, 3), d_temp=round(ca[0] - cb[0], 3), d_tint=round(ca[1] - cb[1], 3),
                    d_spread=round(st["spread"] - bs["spread"], 3),
                    sat_ratio=round(st["chroma"] / max(bs["chroma"], 1e-9), 3),
                    d_clipped=round(st["clipped"] - bs["clipped"], 4))
                frame_of[rec.get("param")] = fp
        out["frames"].append(rec)
    by = {f["param"]: f for f in out["frames"]}
    # Every frame exactly like the baseline although the values were written: Premiere rendered them before or
    # after the change (26.0.2 queues exports), not "the parameter does nothing". Say so and learn nothing.
    measured = [f for f in out["frames"] if f.get("stops") is not None]
    if len(measured) >= 2 and all(f["stops"] == 0 and f["d_temp"] == 0 and f["d_tint"] == 0 and f["d_spread"] == 0
                                  and f["sat_ratio"] == 1 for f in measured):
        out["error"] = ("Всички кадри са еднакви с изходния, макар стойностите да са записани: Premiere ги е "
                        "изнесъл преди или след промяната. Резултатът не е достоверен, нищо не е научено.")
        out["table"] = {f["param"]: "UNVERIFIED" for f in out["frames"]}
        out["units"] = {}
        return out

    def moved(key, field, limit):
        f = by.get(key) or {}
        return f.get(field) is not None and abs(f[field]) >= limit

    table = {}
    table["white_balance"] = "SUPPORTED" if moved("temperature", "d_temp", 0.03) and moved("tint", "d_tint", 0.03) \
        else "PARTIAL" if moved("temperature", "d_temp", 0.03) or moved("tint", "d_tint", 0.03) else "BLOCKED"
    table["exposure"] = "SUPPORTED" if moved("exposure", "stops", 0.2) else "BLOCKED"
    table["contrast"] = "SUPPORTED" if moved("contrast", "d_spread", 0.01) else "BLOCKED"
    table["saturation"] = "SUPPORTED" if (by.get("saturation") or {}).get("sat_ratio", 1) > 1.03 else "BLOCKED"
    table["skin_tones"] = "PARTIAL (само глобално: API-то не дава маски/HSL избор по област)"
    table["shot_match"] = "SUPPORTED" if table["white_balance"] != "BLOCKED" and table["exposure"] == "SUPPORTED" \
        else "BLOCKED"
    table["render_check"] = "SUPPORTED"
    table["color_management"] = "PARTIAL (входен LUT на клипа се чете; работното и изходното пространство не се " \
                                "виждат през API: проверява се с кадри от Premiere)"
    out["table"] = table
    # units for the planner
    units = {}
    if moved("exposure", "stops", 0.2):
        f = by["exposure"]
        units["exposure_stops_per_unit"] = round(f["stops"] / (f["to"] - f["from"]), 3)
    for key, field in (("temperature", "d_temp"), ("tint", "d_tint")):
        if moved(key, field, 0.03):
            f = by[key]
            units[f"{key}_units_per_log2"] = round((f["to"] - f["from"]) / f[field], 1)
    out["units"] = units
    cal = Calibration()
    for key, axis in (("temperature", "temp"), ("tint", "tint")):
        f = by.get(key) or {}
        if f.get("d_" + axis) is not None:
            cal.set_probe(axis, float(f["to"] - f["from"]), float(f["d_" + axis]))
    if frame_of.get("exposure") and moved("exposure", "stops", 0.2):
        f = by["exposure"]
        curve = exposure_curve(base, read_image(frame_of["exposure"]), float(f["to"] - f["from"]))
        if cal.set_exposure_curve(curve):
            units["exposure_curve"] = curve
    return out


def exposure_curve(before: np.ndarray, after: np.ndarray, units: float) -> list[list[float]]:
    """Stops gained per Exposure unit by brightness band of the frame before: [[band centre, rate], ...].
    Pixels that burn out after are left out (they would only say "clipped", not how far it moved)."""
    yb, ya = _luma(to_linear(before, None)), _luma(to_linear(after, None))
    y_enc = _luma(before)
    usable = (np.max(after, axis=-1) < 0.97) & (yb > 1e-4) & (ya > 1e-4)
    out = []
    for lo in np.arange(0.02, 0.9, 0.08):
        m = usable & (y_enc >= lo) & (y_enc < lo + 0.08)
        if m.sum() >= 200:
            out.append([round(float(lo + 0.04), 3), round(float(np.median(np.log2(ya[m] / yb[m]))) / units, 3)])
    return out
