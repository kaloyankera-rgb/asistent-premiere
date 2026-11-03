"""Prepare Project: look through a footage folder, decide the bins (mirroring the editor's own folders),
inspect every clip and say what to do next. Reads only; the panel creates bins and imports.

Bins: subfolders become bins under RAW_FOOTAGE (…/9x16/fx3 -> RAW_FOOTAGE/9x16/fx3); a folder named like
B-roll, Music, SFX, Audio, Graphics/Assets/Brand/Logo goes to that category's bin instead. Sony card
folders (PRIVATE/M4ROOT/CLIP) are flattened, their proxies (SUB) and every cache/sidecar file skipped.
"""
from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

from .importer import AUDIO, GRAPHIC, IMAGE, MEDIA, VIDEO, _probe

SKIP_DIRS = re.compile(r"^(\..*|__macosx|adobe premiere pro (audio|video) previews|adobe premiere pro auto-save|"
                       r"media cache( files)?|peak files|proxy|proxies|thmbnl|general|sub|avf_info|"
                       r"\.?trash|боклук)$", re.I)
CARD_DIRS = re.compile(r"^(private|m4root|clip|dcim|avchd|bdmv|stream|xdroot|100msdcf|\d{3}[a-z]{5})$", re.I)
CATEGORY_DIRS = [
    ("BROLL", re.compile(r"b[\s_-]?roll|броул|stock", re.I)),
    ("MUSIC", re.compile(r"^music|музика", re.I)),
    ("SFX", re.compile(r"^sfx|ефекти|звуци", re.I)),
    ("GRAPHICS", re.compile(r"graphic|графи|brand|logo|лого|assets|overlay", re.I)),
    ("AUDIO", re.compile(r"^audio$|^звук$|^\d\d_audio$|voice|^vo$", re.I)),
]
SKIP_EXT = {".xml", ".bim", ".thm", ".prv", ".pek", ".cfa", ".ims", ".mcdb", ".lrv", ".lrf", ".ds_store", ".ini",
            ".db", ".pdf", ".txt", ".zip", ".prproj", ".aep", ".mogrt"}


def _bin_for(parts: list[str]) -> list[str]:
    parts = [p for p in parts if not CARD_DIRS.match(p)]
    for i, p in enumerate(parts):
        for cat, rx in CATEGORY_DIRS:
            if rx.search(p):
                return [cat] + parts[i + 1:]
    stripped = [re.sub(r"^\d\d_", "", p) for p in parts]
    if stripped and stripped[0].upper() == "RAW":
        stripped = stripped[1:]
    return ["RAW_FOOTAGE"] + stripped


def scan(folder: str) -> tuple[dict[tuple, list[str]], dict]:
    folder = os.path.abspath(os.path.expanduser(folder))
    if not os.path.isdir(folder):
        raise ValueError(f"The folder does not exist: {folder}")
    bins: dict[tuple, list[str]] = {}
    skipped = {"cache": 0, "other": 0}
    for root, dirs, files in os.walk(folder):
        keep = []
        for d in dirs:
            if SKIP_DIRS.match(d):
                skipped["cache"] += 1
            else:
                keep.append(d)
        dirs[:] = sorted(keep)
        rel = os.path.relpath(root, folder)
        parts = [] if rel == "." else re.split(r"[\\/]+", rel)
        for n in sorted(files):
            ext = os.path.splitext(n)[1].lower()
            if n.startswith(".") or ext in SKIP_EXT or ext not in MEDIA:
                skipped["other"] += 1
                continue
            bins.setdefault(tuple(_bin_for(parts)), []).append(os.path.join(root, n))
    return bins, skipped


def sony_xml(path: str) -> dict:
    """Camera, gamma and colour primaries from the Sony sidecar (C0001.MP4 -> C0001M01.XML)."""
    base = os.path.splitext(path)[0]
    for cand in (base + "M01.XML", base + "M01.xml"):
        if os.path.isfile(cand):
            try:
                root = ET.parse(cand).getroot()
            except ET.ParseError:
                return {}
            out = {}
            for el in root.iter():
                tag = el.tag.split("}")[-1]
                if tag == "Device" and el.get("modelName"):
                    out["camera"] = el.get("modelName")
                if tag == "Item" and el.get("name") in ("CaptureGammaEquation", "CaptureColorPrimaries"):
                    out["gamma" if el.get("name") == "CaptureGammaEquation" else "primaries"] = el.get("value")
            return out
    return {}


def _inspect(path: str) -> dict:
    info = {"path": path, "name": os.path.basename(path)}
    ext = os.path.splitext(path)[1].lower()
    info["kind"] = "video" if ext in VIDEO else "audio" if ext in AUDIO else "image" if ext in IMAGE | GRAPHIC else "other"
    p = _probe(path)
    if not p:
        info["unreadable"] = True
        return info
    fmt = p.get("format", {})
    try:
        info["duration"] = float(fmt.get("duration") or 0)
    except ValueError:
        info["duration"] = 0.0
    for s in p.get("streams", []):
        if s.get("codec_type") == "video" and "fps" not in info and not s.get("disposition", {}).get("attached_pic"):
            def rate(t):
                try:
                    a, b = (t or "0/0").split("/")
                    return float(a) / float(b) if float(b) else 0.0
                except ValueError:
                    return 0.0
            r, avg = rate(s.get("r_frame_rate")), rate(s.get("avg_frame_rate"))
            info["fps"] = round(avg or r, 3)
            info["vfr"] = bool(r and avg and abs(r - avg) / r > 0.002)
            info["size"] = f'{s.get("width")}x{s.get("height")}'
            info["transfer"] = s.get("color_transfer")
        if s.get("codec_type") == "audio" and "channels" not in info:
            info["channels"] = int(s.get("channels") or 0)
    info.update(sony_xml(path))
    return info


def _fmt_fps(v: float) -> str:
    return f"{v:g}"


def prepare(folder: str, progress=None) -> dict:
    progress = progress or (lambda f, m: None)
    bins, skipped = scan(folder)
    files = [p for ps in bins.values() for p in ps]
    progress(0.1, f"Looking at {len(files)} files")
    with ThreadPoolExecutor(max_workers=8) as pool:
        infos = list(pool.map(_inspect, files))
    by_path = {i["path"]: i for i in infos}

    groups = []
    for path, ps in sorted(bins.items()):
        items = [by_path[p] for p in ps]
        vids = [i for i in items if i["kind"] == "video" and not i.get("unreadable")]
        g = {"bin": list(path), "files": ps, "count": len(ps), "video": len(vids),
             "minutes": round(sum(i.get("duration", 0) for i in items) / 60, 1)}
        if vids:
            g["fps"] = sorted({_fmt_fps(i["fps"]) for i in vids if i.get("fps")})
            g["sizes"] = sorted({i["size"] for i in vids if i.get("size")})
            g["cameras"] = sorted({i["camera"] for i in vids if i.get("camera")})
            g["gamma"] = sorted({i["gamma"] for i in vids if i.get("gamma")})
            g["vfr"] = [i["name"] for i in vids if i.get("vfr")]
            g["stereo"] = sum(1 for i in vids if i.get("channels") == 2)
        g["unreadable"] = [i["name"] for i in items if i.get("unreadable")]
        groups.append(g)

    # suggestions
    cams = [g for g in groups if g["bin"][0] == "RAW_FOOTAGE" and g["video"]]
    tips = []
    if len(cams) >= 2:
        tips.append({"action": "sync", "text": f"{len(cams)} folders with video (cameras): select the clips in the timeline → "
                                               "Sync cameras."})
    if any(g.get("stereo") for g in cams):
        tips.append({"action": "audio", "text": "The cameras have stereo sound: after the sync → Fix audio "
                                                "(L/R, lavaliers, level)."})
    logs = sorted({x for g in cams for x in g.get("gamma", []) if "log" in x.lower()})
    if logs:
        tips.append({"action": "color", "text": f"Recorded in {', '.join(logs)}: a correction to Rec.709 is needed."})
    vfr = [n for g in groups for n in g.get("vfr", [])]
    if vfr:
        tips.append({"action": "vfr", "text": f"{len(vfr)} clips have a variable frame rate (phone?): the sync "
                                              "may drift later in the clip."})
    progress(1.0, "Done")
    return {"folder": os.path.abspath(os.path.expanduser(folder)), "groups": groups, "files": len(files),
            "skipped": skipped, "tips": tips}


def guess_footage(project_path: str) -> str | None:
    """Template layouts: <root>/04_PROJECT|05_PROJECT/x.prproj next to <root>/01_RAW."""
    d = os.path.dirname(project_path or "")
    if re.match(r"^\d\d_PROJECTS?$", os.path.basename(d), re.I):
        root = os.path.dirname(d)
        for name in sorted(os.listdir(root)) if os.path.isdir(root) else []:
            if re.match(r"^01_RAW", name, re.I) and os.path.isdir(os.path.join(root, name)):
                return root
    return None
