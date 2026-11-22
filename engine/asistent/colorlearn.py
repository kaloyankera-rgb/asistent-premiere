"""Colour learning at export (TODO EL1, 0.10.36): what the editors set in Lumetri, next to what Asistent would suggest.

The user's plan (2026-11-10, TODO EL0-EL5): learn from the other editors, colour first, read only. When an export ends the
panel reads the exported sequence's clips (their Lumetri values, whether the Lumetri is still Asistent's own, a Lumetri on
an adjustment layer above them) and sends them here. In the background, one export at a time and never in the job pool
the editor's buttons use, each clip's file is analysed as Auto color would (color.analyze_clip) and one line per clip is
appended to the client's record. Nothing in Premiere and nothing in the footage is changed.

Where: `<app>/learning/color/<client>.jsonl` on this computer. The office folders per client (TODO EL0) wait for the user's
yes; until then nothing is written on the server. The client is the folder that holds a "... Subtitle Learning" folder
(learning.find_folder), else the folder under "01_CLIENTS", else the share's first folder under /Volumes.

The report: per client and camera, the median of what the editors set minus what Asistent would have set (exposure in
stops, Temperature and Tint in Lumetri's units), only from clips where both are known and Asistent was sure enough; plus
how often Asistent's own correction was kept as it was. A re-export of the same clip replaces its earlier line.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import queue
import re
import socket
import statistics
import threading

from . import config

log = logging.getLogger("asistent")
FORMAT = 2                       # 2 (0.10.142): + "measured", "look", "editor_all", "layer_all"
MAX_CLIPS = 150                  # per export: a longer edit records its first 150 clip ranges
_q: "queue.Queue[dict]" = queue.Queue()
_worker: threading.Thread | None = None
_lock = threading.Lock()
_state = {"pending": 0, "last": None}


def store_dir() -> str:
    return os.path.join(config.app_dir(), "learning", "color")


def _safe(name: str) -> str:
    return re.sub(r"[\\/:*?\"<>|]+", "_", name).strip() or "unknown"


# "Credissimo КП-14 - Видео 7 - ....prproj": the client is the name before the content plan number (КП = контент план).
# Needed when the video's own folder is mounted as a volume (/Volumes/Видео 7 - .../Assets/x.prproj): the share's first
# folder is then "Assets", which filed 733 records of six clients under one name (audit 2026-11-22).
_CLIENT_IN_NAME = re.compile(r"^(.+?)\s+(?:КП|KP)[\s.-]*\d+", re.I)


def client_in_name(project: str) -> str | None:
    m = _CLIENT_IN_NAME.match(os.path.splitext(os.path.basename(project or ""))[0])
    return m.group(1).strip() if m else None


# Not camera footage: stills and graphics, renders, stock, transitions, sound-designed renders, downloads. The editors do not
# grade these like footage, and Auto color is not meant for them (audit 2026-11-22: "Assets", "renders", "Със SFX" counted as
# cameras). Matched on the file's extension and on its folder names, never on the file name.
_STILL = {".png", ".jpg", ".jpeg", ".psd", ".tif", ".tiff", ".gif", ".webp", ".svg", ".ai", ".bmp", ".heic", ".mogrt", ".aep"}
_NOT_FOOTAGE_DIR = re.compile(r"render|graphic|stock|transition|overlay|(?<![a-zа-я])sfx(?![a-zа-я])|02_resources|"
                              r"downloads|logo|mockup|kling|higgsfield|copypasta|_за преглед", re.I)


def footage(path: str) -> bool:
    if os.path.splitext(path or "")[1].lower() in _STILL:
        return False
    dirs = [d for d in re.split(r"[\\/]+", os.path.dirname(path or "")) if d]
    return not any(_NOT_FOOTAGE_DIR.search(d) for d in dirs)


def client_of(project: str) -> str:
    try:
        from . import learning
        found = learning.find_folder(project)
        if found:
            return found[0]
    except Exception:                                   # noqa: BLE001 (a server that does not answer: use the path)
        pass
    parts = [p for p in re.split(r"[\\/]+", os.path.abspath(project or "")) if p]
    for i, p in enumerate(parts):
        if p.upper() == "01_CLIENTS" and i + 1 < len(parts) - 1:
            return parts[i + 1]
    named = client_in_name(project)
    if named:
        return named
    if len(parts) > 3 and parts[0] == "Volumes":
        return parts[2] if len(parts) > 3 else parts[1]
    return parts[-2] if len(parts) >= 2 else "unknown"


def _camera(path: str) -> tuple[str, str | None]:
    """(camera, picture profile): the Sony sidecar's model and gamma, else the clip's folder name."""
    try:
        from .prepare import sony_xml
        meta = sony_xml(path) or {}
    except Exception:                                   # noqa: BLE001
        meta = {}
    folder = os.path.basename(os.path.dirname(path))
    cam = meta.get("camera")
    return (f"{cam} ({folder})" if cam else folder or "unknown"), meta.get("gamma")


def suggestion(path: str, start: float, end: float | None, gamma: str | None) -> dict:
    """What Auto color would set on this clip, in Lumetri's units (exposure in stops; Temperature / Tint by the calibration),
    plus what it measured on the file (`measured`: face and mid-tone brightness, casts; `look`: black / white point, contrast,
    saturation), so that targets can later be fitted from the records alone, without the files (audit 2026-11-22)."""
    from . import color as COLOR
    if gamma is None:
        from .prepare import sony_xml
        gamma = sony_xml(path).get("gamma")
    frames = COLOR.read_frames(path, start=start, end=end)
    res = COLOR.decide(frames, gamma)
    ex, wh = res.get("exposure") or {}, res.get("white") or {}
    sl = COLOR.Calibration().sliders(float(wh.get("fix_temp") or 0), float(wh.get("fix_tint") or 0))
    return {"exposure": ex.get("stops"), "exposure_confidence": ex.get("confidence"),
            "temperature": sl.get("temperature"), "tint": sl.get("tint"), "white_confidence": wh.get("confidence"),
            "gamma": res.get("gamma"), "source_gamma": res.get("source_gamma"),
            "measured": {**(res.get("measured") or {}), "exposure_raw": ex.get("measured"), "basis": ex.get("basis"),
                         "at_luma": ex.get("at_luma"), "cast_temp": wh.get("cast_temp"), "cast_tint": wh.get("cast_tint"),
                         "neutral_area": wh.get("neutral_area"), "skin_area": res.get("skin_area"),
                         "clipped": res.get("clipped"), "frames": res.get("frames")},
            "look": COLOR.look_stats(frames, gamma)}


def _line(project: str, sequence: str, client: str, clip: dict) -> dict:
    path = clip["path"]
    start = float(clip.get("start") or 0.0)
    end = clip.get("end")
    camera, gamma = _camera(path)
    out = {"format": FORMAT, "at": _dt.datetime.now().isoformat(timespec="seconds"), "computer": socket.gethostname(),
           "project": project, "sequence": sequence, "client": client, "camera": camera, "profile": gamma,
           "file": os.path.basename(path), "path": path, "start": round(start, 3), "end": None if end is None else round(float(end), 3),
           "editor": clip.get("lumetri"), "owned": bool(clip.get("owned")), "layer": clip.get("layer"),
           "lut": clip.get("lut"), "animated": bool(clip.get("animated")),
           # every Lumetri setting that differs from an untouched Lumetri (the panel's fingerprint diff; null when unknown)
           "editor_all": clip.get("changed"), "layer_all": clip.get("layer_changed")}
    try:
        out["asistent"] = suggestion(path, start, None if end is None else float(end), gamma)
    except Exception as e:                              # noqa: BLE001 (an unreadable file: recorded without a suggestion)
        out["asistent"] = None
        out["error"] = str(e)[:200]
    return out


def _append(client: str, lines: list[dict]) -> str:
    d = store_dir()
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{_safe(client)}.jsonl")
    with _lock, open(path, "a", encoding="utf-8") as f:
        for ln in lines:
            f.write(json.dumps(ln, ensure_ascii=False) + "\n")
    return path


def record_now(project: str, sequence: str, clips: list[dict], cancelled=lambda: False) -> dict:
    """Analyse and record one export's clips (each file range once). -> {"client", "recorded", "file"}"""
    client = client_of(project)
    seen = set()
    lines = []
    skipped = 0
    for c in clips:
        if cancelled() or len(lines) >= MAX_CLIPS:
            break
        if not isinstance(c, dict) or not isinstance(c.get("path"), str):
            continue
        if not footage(c["path"]):
            skipped += 1
            continue
        key = (c["path"], round(float(c.get("start") or 0), 2), None if c.get("end") is None else round(float(c["end"]), 2))
        if key in seen:
            continue
        seen.add(key)
        lines.append(_line(project, sequence, client, c))
    file = _append(client, lines) if lines else None
    log.info("colour learning: %s, %s: %d clips recorded, %d not footage", client, sequence, len(lines), skipped)
    return {"client": client, "recorded": len(lines), "skipped": skipped, "file": file}


def _run():
    while True:
        item = _q.get()
        try:
            _state["last"] = record_now(item["project"], item["sequence"], item["clips"])
        except Exception as e:                          # noqa: BLE001 (never stops the worker)
            log.warning("colour learning failed: %s", e)
        finally:
            _state["pending"] = max(0, _state["pending"] - 1)


def queue_export(project: str, sequence: str, clips: list[dict]) -> dict:
    """Queued for the background worker; returns at once."""
    global _worker
    if not isinstance(clips, list) or not clips:
        return {"queued": 0}
    _q.put({"project": project or "", "sequence": sequence or "", "clips": clips[: MAX_CLIPS * 2]})
    _state["pending"] += 1
    if _worker is None or not _worker.is_alive():
        _worker = threading.Thread(target=_run, name="colorlearn", daemon=True)
        _worker.start()
    return {"queued": len(clips), "client": client_of(project)}


def status() -> dict:
    return {"pending": _state["pending"], "last": _state["last"]}


def _lines(client: str) -> list[dict]:
    path = os.path.join(store_dir(), f"{_safe(client)}.jsonl")
    out = {}
    try:
        with open(path, encoding="utf-8") as f:
            for raw in f:
                try:
                    ln = json.loads(raw)
                except ValueError:
                    continue
                if not footage(ln.get("path") or ""):
                    continue                            # stills, renders, stock recorded before 0.10.142
                out[(ln.get("project"), ln.get("path"), ln.get("start"), ln.get("end"))] = ln   # the newest export wins
    except OSError:
        return []
    return list(out.values())


SURE = ("high", "medium")


def _editor_stops(units: float, ln: dict) -> float:
    """The editor's Lumetri Exposure in stops at the brightness Auto color corrects (Exposure is not a plain gain: about
    0.85 stop per unit at skin brightness, probe 2026-11-01). Auto color's own value is already in stops; comparing units
    with stops made Asistent look like it overshot (audit 2026-11-22). Darkening stays 1 unit = 1 stop, as in color.py."""
    if units <= 0:
        return units
    luma = ((ln.get("asistent") or {}).get("measured") or {}).get("at_luma")
    if luma is None:
        return units
    from . import color as COLOR
    return units * COLOR.Calibration().exposure_rate(float(luma))


def report(client: str) -> dict:
    """Per camera: clips, Asistent's own kept, untouched, the median editor - Asistent difference (exposure in stops,
    Temperature and Tint in Lumetri units), and the editors' own Contrast and Saturation moves (Auto color has none to
    compare: how often they were changed and the middle change)."""
    repair()
    cams: dict[str, dict] = {}
    for ln in _lines(client):
        c = cams.setdefault(ln.get("camera") or "unknown", {"clips": 0, "kept": 0, "untouched": 0, "layer": 0,
                                                            "exposure": [], "temperature": [], "tint": [],
                                                            "contrast": [], "saturation": []})
        c["clips"] += 1
        ed = ln.get("editor") or {}
        if ln.get("owned"):
            c["kept"] += 1
        if not ln.get("editor") and not ln.get("layer"):
            c["untouched"] += 1
        if ln.get("layer"):
            c["layer"] += 1
        a = ln.get("asistent") or {}
        if ln.get("animated"):
            continue                                    # keyframed values: no single value to compare
        lay = ln.get("layer") or {}
        for k, conf in (("exposure", "exposure_confidence"), ("temperature", "white_confidence"), ("tint", "white_confidence")):
            if a.get(k) is None or a.get(conf) not in SURE:
                continue
            mine = float(ed.get(k) or 0) + float(lay.get(k) or 0)          # the clip's and the layer's together
            if k == "exposure":
                mine = _editor_stops(mine, ln)
            c[k].append(mine - float(a[k]))
        # the layer's saturation is already its change from 100 (premiere-colorlearn.js)
        c["contrast"].append(float(ed.get("contrast") or 0) + float(lay.get("contrast") or 0))
        sat = ed.get("saturation")
        c["saturation"].append((float(sat) - 100 if sat is not None else 0.0) + float(lay.get("saturation") or 0))
    out = []
    for cam, c in sorted(cams.items(), key=lambda kv: -kv[1]["clips"]):
        row = {"camera": cam, "clips": c["clips"], "kept": c["kept"], "untouched": c["untouched"], "layer": c["layer"]}
        for k in ("exposure", "temperature", "tint"):
            row[k] = {"n": len(c[k]), "median": round(statistics.median(c[k]), 2) if c[k] else None}
        for k in ("contrast", "saturation"):
            moved = [v for v in c[k] if abs(v) > 1e-6]
            row[k] = {"n": len(c[k]), "changed": len(moved), "median": round(statistics.median(moved), 2) if moved else None}
        out.append(row)
    return {"client": client, "cameras": out}


_repaired = False


def _at(raw: str) -> str:
    try:
        return str(json.loads(raw).get("at") or "")
    except ValueError:
        return ""


def repair() -> dict:
    """Once per engine run: lines filed under the wrong client move to the client their project file names
    ("Credissimo КП-14 - ....prproj" -> Credissimo.jsonl). Before 0.10.142 a video folder mounted as its own volume filed
    them under "Assets". Every file that changes is copied to learning/color/backup/ first; nothing is dropped."""
    global _repaired
    if _repaired:
        return {"moved": 0}
    _repaired = True
    d = store_dir()
    try:
        names = sorted(n for n in os.listdir(d) if n.endswith(".jsonl"))
    except OSError:
        return {"moved": 0}
    keep: dict[str, list[str]] = {}
    move: dict[str, list[str]] = {}
    for n in names:
        here = n[:-6]
        try:
            with open(os.path.join(d, n), encoding="utf-8") as f:
                raws = [r for r in f if r.strip()]
        except OSError:
            continue
        for raw in raws:
            try:
                ln = json.loads(raw)
            except ValueError:
                keep.setdefault(here, []).append(raw)
                continue
            named = client_in_name(ln.get("project") or "")
            if named and _safe(named) != here:
                ln["client"] = named
                move.setdefault(_safe(named), []).append(json.dumps(ln, ensure_ascii=False) + "\n")
            else:
                keep.setdefault(here, []).append(raw if raw.endswith("\n") else raw + "\n")
    moved = sum(len(v) for v in move.values())
    if not moved:
        return {"moved": 0}
    import shutil
    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    bdir = os.path.join(d, "backup", stamp)
    os.makedirs(bdir, exist_ok=True)
    with _lock:
        for n in names:
            shutil.copy2(os.path.join(d, n), os.path.join(bdir, n))
        for client in {n[:-6] for n in names} | set(move):
            # in time order, so "the newest export wins" in _lines still holds after the merge
            rows = sorted(keep.get(client, []) + move.get(client, []), key=_at)
            path = os.path.join(d, f"{client}.jsonl")
            if not rows:
                os.remove(path)
                continue
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.writelines(rows)
            os.replace(tmp, path)
    log.info("colour learning: %d lines moved to the client their project names (backup %s)", moved, bdir)
    return {"moved": moved, "backup": bdir}


def clients() -> list[str]:
    repair()
    try:
        return sorted(n[:-6] for n in os.listdir(store_dir()) if n.endswith(".jsonl"))
    except OSError:
        return []
