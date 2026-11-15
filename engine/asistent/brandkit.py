"""Brand kits (0.10.71): one folder per client holding its logos, fonts, colours, video assets, presets and references,
read by the panel's Brand page so the editor gets them into Premiere in one press.

Where kits are (all read the same way, a kit is a folder):
- library folders: each sub-folder is one client's kit (the Content Studio `brand-kits/` folder, an office server folder
  such as `/Volumes/Production/Brand Kits`); set in the panel, plus the server folders below when they exist;
- extra folders the editor added for one client (a custom server path: `Production/GStroy/Brand Kit`);
- a `Brand Kit` folder found by walking up from the open project (`Production/<client>/Brand Kit`, the office layout that
  `profiles.KIND_FOLDERS` already names).

A kit may carry `brand.json` (the hand-written machine version made for every office client in `brand-kits/`; read only,
Asistent never rewrites it) and `asistent-kit.json` (what the editor changed in Asistent: name, aliases, added colours,
subtitle preset). Everything else is found by the files themselves: folder names and extensions say what each file is.

The server can be away: the last good reading of every kit is kept in `<app>/brandkits/index/`, files used more than once
are copied to `<app>/brandkits/cache/` (so they still import, and fonts install, while the server is down), and thumbnails
are kept in `<app>/brandkits/thumbs/`. Nothing in a kit is ever deleted: Delete moves the kit into `_Deleted kits` next
to it, and adding files copies them (a name that exists gets " (2)").
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor

from . import config

log = logging.getLogger("asistent")

FORMAT = 1
SIDE = "asistent-kit.json"
BRAND = "brand.json"
DELETED = "_Deleted kits"
KIT_FOLDER_NAMES = {"brand kit", "brandkit", "brand-kit", "brand_kit"}
WALK_UP = 6
MAX_DEPTH = 6
MAX_FILES = 3000
THUMB = 160
SVG_MAX = 400_000
CACHE_LIMIT = 2 * 1024 ** 3                  # local copies of server files: 2 GB, the least recently used go first
CACHE_AFTER_USES = 2                         # a server file is copied here from its second use ("frequently used")
_lock = threading.RLock()
_probe_cache: dict = {}
_font_cache: dict = {"key": None, "names": set()}
_copying: set = set()

# Office server folders tried as libraries when they exist (read only; nothing is created there unless the editor creates a kit)
SERVER_LIBRARIES = {
    "darwin": ["/Volumes/Production/Brand Kits", "/Volumes/Production/Brand kits", "/Volumes/Production/_Brand Kits"],
    "win32": [],
}

IMAGE = {"png", "jpg", "jpeg", "tif", "tiff", "psd", "gif", "bmp", "tga", "heic", "webp"}
VECTOR = {"ai", "eps", "svg", "pdf"}
VIDEO = {"mp4", "mov", "m4v", "mxf", "avi", "webm", "mkv"}
AUDIO = {"wav", "mp3", "aif", "aiff", "m4a", "flac"}
FONT = {"ttf", "otf", "ttc", "woff", "woff2"}
FONT_USABLE = {"ttf", "otf", "ttc"}
DOC = {"doc", "docx", "key", "pptx", "txt", "md", "rtf"}
SOURCE = {"aep", "prproj", "cdr", "indd", "sketch", "fig", "xd", "afdesign", "afphoto"}
# what Premiere imports (Adobe's supported formats: stills incl. Illustrator and EPS, video, audio); SVG, PDF and the
# design apps' own files are not importable, and the panel says so instead of trying
IMPORTABLE = (IMAGE | {"ai", "eps"} | VIDEO | AUDIO)
WHY_NOT = {
    "svg": "Premiere does not import SVG: use the PNG version.",
    "pdf": "Premiere does not import PDF.",
    "woff": "A web font: Premiere needs TTF or OTF.",
    "woff2": "A web font: Premiere needs TTF or OTF.",
}
RANK = {"png": 0, "tif": 1, "tiff": 1, "psd": 2, "webp": 3, "jpg": 4, "jpeg": 4, "gif": 5, "ai": 6, "eps": 7, "svg": 8, "pdf": 9}

CATEGORIES = ("logos", "graphics", "video", "audio", "fonts", "presets", "references", "other")
# folder words -> category, first match from the kit's top folder down
FOLDER_WORDS = [
    ("fonts", {"font", "fonts", "шрифт", "шрифтове", "typeface", "typefaces"}),
    ("presets", {"preset", "presets", "mogrt", "mogrts", "template", "templates", "styles", "lut", "luts"}),
    ("logos", {"logo", "logos", "лого", "лога", "wordmark", "lockup", "lockups", "logotype", "brandmark"}),
    ("video", {"intro", "outro", "intros", "outros", "endcard", "opener", "bumper", "sting", "stinger", "animation",
               "animations", "video", "videos", "motion"}),
    ("audio", {"audio", "sound", "sounds", "music", "sfx", "jingle", "sonic"}),
    ("graphics", {"overlay", "overlays", "graphic", "graphics", "element", "elements", "icon", "icons", "mascot", "маскот",
                  "sticker", "stickers", "campaign", "campaigns", "badge", "badges", "bulb", "shapes", "patterns", "textures",
                  "illustrations", "illustration", "frames", "lower"}),
    ("references", {"reference", "references", "refs", "example", "examples", "design", "brandbook", "guidelines", "guide",
                    "colors", "colours", "palette", "inspiration", "moodboard"}),
]
ADD_FOLDER = {"logos": "logo", "graphics": "graphics", "video": "video", "audio": "audio", "fonts": "fonts",
              "presets": "presets", "references": "reference", "other": "other"}


# ---------------------------------------------------------------- small helpers

def _dir() -> str:
    d = os.path.join(config.app_dir(), "brandkits")
    os.makedirs(d, exist_ok=True)
    return d


def kit_id(folder: str) -> str:
    return hashlib.sha1(os.path.normcase(os.path.abspath(folder)).encode("utf-8")).hexdigest()[:12]


_CYR = dict(zip("абвгдежзийклмнопрстуфхцчшщъьюя", ["a", "b", "v", "g", "d", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o",
                                                    "p", "r", "s", "t", "u", "f", "h", "ts", "ch", "sh", "sht", "a", "", "yu", "ya"]))


def norm(text: str) -> str:
    """'ЕКОПАК' -> 'ekopak', 'Beauty Sector' -> 'beautysector', 'Re/Shape' -> 'reshape': names compared across scripts."""
    s = unicodedata.normalize("NFKC", str(text or "")).lower()
    s = "".join(_CYR.get(c, c) for c in s)
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if c.isalnum() and ord(c) < 128)


def _safe_name(name: str) -> str:
    n = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", " ", str(name or "")).strip().strip(".")
    n = re.sub(r"\s+", " ", n)[:80]
    if not n:
        raise ValueError("Give the kit a name.")
    return n


def _inside(folder: str, rel: str) -> str:
    """The file `rel` inside the kit folder, refusing anything that leaves it."""
    if not isinstance(rel, str) or not rel or "\x00" in rel:
        raise ValueError("Unclear which file.")
    base = os.path.realpath(folder)
    full = os.path.realpath(os.path.join(base, rel))
    if os.path.commonpath([base, full]) != base or full == base:
        raise ValueError("That file is not in the kit.")
    return full


def _read_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8-sig") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_json(path: str, data: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def is_remote(path: str) -> bool:
    """On a network share (the office server): those files get a local copy and an offline index."""
    if sys.platform == "win32":
        p = os.path.abspath(path)
        if p.startswith("\\\\"):
            return True
        try:
            import ctypes
            return ctypes.windll.kernel32.GetDriveTypeW(p[:3]) == 4      # DRIVE_REMOTE
        except Exception:                                              # noqa: BLE001
            return False
    try:
        from .learning import _mounts
        return any(path == point or path.startswith(point + "/") for _h, _r, point in _mounts())
    except Exception:                                                  # noqa: BLE001
        return False


# ---------------------------------------------------------------- settings (per computer)

def _settings_path() -> str:
    return os.path.join(_dir(), "settings.json")


def settings() -> dict:
    s = _read_json(_settings_path())
    s.setdefault("format", FORMAT)
    for k in ("roots", "folders"):
        s[k] = [p for p in s.get(k) or [] if isinstance(p, str)]
    for k in ("usage", "favorites", "names"):
        s[k] = s.get(k) if isinstance(s.get(k), dict) else {}
    return s


def _save_settings(s: dict) -> None:
    with _lock:
        _write_json(_settings_path(), s)


def roots() -> list[str]:
    s = settings()
    out = list(s["roots"])
    env = os.environ.get("ASISTENT_BRANDKITS")
    if env:
        out.insert(0, env)
    out += SERVER_LIBRARIES.get(sys.platform, [])
    return list(dict.fromkeys(out))


# ---------------------------------------------------------------- finding kits

def _looks_like_kit(folder: str) -> bool:
    try:
        names = os.listdir(folder)
    except OSError:
        return False
    if BRAND in names or SIDE in names:
        return True
    return any(not n.startswith((".", "_")) for n in names)


def _kit_name(folder: str, brand: dict, side: dict) -> str:
    return str(side.get("name") or brand.get("display_name") or brand.get("client") or os.path.basename(folder.rstrip("/\\")))


def project_kit_folder(project: str) -> str | None:
    """A `Brand Kit` folder next to the project or in a folder above it (the client's own folder on the server)."""
    if not project:
        return None
    d = os.path.dirname(os.path.abspath(project))
    for _ in range(WALK_UP):
        try:
            names = os.listdir(d)
        except OSError:
            names = []
        for n in sorted(names):
            if n.lower() in KIT_FOLDER_NAMES and os.path.isdir(os.path.join(d, n)):
                return os.path.join(d, n)
        if os.path.dirname(d) == d:
            break
        d = os.path.dirname(d)
    return None


def _entry(folder: str, source: str, root: str | None = None) -> dict:
    s = settings()
    kid = kit_id(folder)
    online = os.path.isdir(folder)
    brand = _read_json(os.path.join(folder, BRAND)) if online else {}
    side = _read_json(os.path.join(folder, SIDE)) if online else {}
    if online:
        name = _kit_name(folder, brand, side)
    else:
        cached = _read_json(os.path.join(_dir(), "index", f"{kid}.json"))
        name = s["names"].get(kid) or cached.get("name") or os.path.basename(folder.rstrip("/\\"))
    aliases = [a for a in side.get("aliases") or [] if isinstance(a, str)] if online else []
    status = str(brand.get("status") or "")[:40] if brand else ""
    return {"id": kid, "name": name, "folder": folder, "source": source, "root": root, "online": online,
            "remote": is_remote(folder), "aliases": aliases, "status": status.split(" ")[0] if status else "",
            "brand_json": bool(brand)}


def list_kits(project: str = "") -> dict:
    """Every kit this computer can see, the client detected from the project, and the folders that are not reachable."""
    s = settings()
    kits: dict[str, dict] = {}
    missing = []
    for root in roots():
        if not os.path.isdir(root):
            if root in s["roots"]:
                missing.append(root)
            continue
        try:
            subs = sorted(os.listdir(root))
        except OSError:
            missing.append(root)
            continue
        for n in subs:
            full = os.path.join(root, n)
            if n.startswith((".", "_")) or not os.path.isdir(full) or not _looks_like_kit(full):
                continue
            e = _entry(full, "library", root)
            kits.setdefault(e["id"], e)
    for folder in s["folders"]:
        e = _entry(folder, "folder")
        if not e["online"]:
            missing.append(folder)
        kits.setdefault(e["id"], e)
    # kits read before whose library is away right now (the server is down): still listed, from the offline index
    # (a kit whose library IS reachable but whose folder is not there was deleted or moved: not listed)
    for kid, name in s["names"].items():
        if kid not in kits:
            cached = _read_json(os.path.join(_dir(), "index", f"{kid}.json"))
            folder = cached.get("folder")
            root = os.path.dirname(str(folder or "").rstrip("/\\"))
            if folder and root in s["roots"] and not os.path.isdir(root):
                kits[kid] = {"id": kid, "name": name, "folder": folder, "source": "library", "root": None, "online": False,
                             "remote": True, "aliases": [], "status": "", "brand_json": False}
    pk = project_kit_folder(project)
    if pk:
        e = _entry(pk, "project")
        kits[e["id"]] = {**kits.get(e["id"], {}), **e}
    items = sorted(kits.values(), key=lambda k: norm(k["name"]))
    with _lock:
        changed = False
        for k in items:
            if k["online"] and s["names"].get(k["id"]) != k["name"]:
                s["names"][k["id"]] = k["name"]
                changed = True
        if changed:
            _save_settings(s)
    found, why = detect(project, items, pk)
    return {"kits": items, "detected": found, "why": why, "roots": s["roots"], "server_roots": SERVER_LIBRARIES.get(sys.platform, []),
            "missing": missing}


def detect(project: str, kits: list[dict], project_kit: str | None = None) -> tuple[str | None, str]:
    """The client of the open project: a Brand Kit folder above it, else a kit's name (or alias) in the project's file name,
    else in one of the folders above it (the nearest wins)."""
    if project_kit:
        return kit_id(project_kit), f"the Brand Kit folder above the project ({os.path.basename(os.path.dirname(project_kit))})"
    if not project:
        return None, ""
    path = os.path.abspath(project)
    stem = norm(os.path.splitext(os.path.basename(path))[0])
    parts = [p for p in re.split(r"[\\/]+", os.path.dirname(path)) if p][::-1][:8]
    best = (0, 0, None, "")
    for k in kits:
        keys = {norm(k["name"]), norm(os.path.basename(str(k["folder"]).rstrip("/\\")))} | {norm(a) for a in k.get("aliases") or []}
        for key in (x for x in keys if len(x) >= 3):
            score, where = 0, ""
            if key in stem:
                score, where = 100, f"the project's name ({os.path.basename(path)})"
            else:
                for d, comp in enumerate(parts):
                    c = norm(comp)
                    if c == key:
                        score, where = 80 - d, f"the folder \"{comp}\""
                        break
                    if key in c:
                        score, where = 60 - d, f"the folder \"{comp}\""
                        break
            if score and (score, len(key)) > best[:2]:
                best = (score, len(key), k["id"], where)
    return (best[2], best[3]) if best[2] else (None, "")


def _find(kid: str, project: str = "") -> dict:
    for k in list_kits(project)["kits"]:
        if k["id"] == kid:
            return k
    raise ValueError("That brand kit is not found (its folder was moved or removed?).")


# ---------------------------------------------------------------- reading one kit

def _tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[^0-9a-zа-я]+", str(text).lower()) if t]


def _category_of(rel_dir: list[str], ext: str) -> str:
    if ext in FONT:
        return "fonts"
    if ext in {"mogrt", "prfpr", "cube", "look"}:
        return "presets"
    for seg in rel_dir:
        if seg.lower() == "assets":
            continue
        toks = set(_tokens(seg)) | {seg.lower()}
        for cat, words in FOLDER_WORDS:
            if toks & words:
                if cat in ("fonts", "presets"):          # a font or preset folder holding something else: by its type
                    break
                return cat
    if ext in VIDEO:
        return "video"
    if ext in AUDIO:
        return "audio"
    if ext in IMAGE or ext in VECTOR - {"pdf"}:
        return "graphics"
    if ext in DOC or ext == "pdf" or ext in SOURCE:
        return "references"
    return "other"


def _kind(ext: str) -> str:
    if ext in IMAGE:
        return "image"
    if ext in VECTOR:
        return "vector"
    if ext in VIDEO:
        return "video"
    if ext in AUDIO:
        return "audio"
    if ext in FONT:
        return "font"
    if ext == "mogrt":
        return "mogrt"
    if ext == "prfpr":
        return "effect"
    if ext in {"cube", "look"}:
        return "lut"
    if ext in DOC or ext == "pdf":
        return "doc"
    if ext in SOURCE:
        return "source"
    return "other"


ROLE_WORDS = [
    ("intro", {"intro", "intros", "opener", "bumper", "open"}),
    ("outro", {"outro", "outros", "endcard", "end", "ending", "endscreen"}),
    ("transition", {"transition", "transitions", "whoosh", "wipe"}),
    ("overlay", {"overlay", "overlays", "lower", "frame", "frames", "title", "titles", "badge", "sticker"}),
]


def _role(rel: str) -> str | None:
    """intro / outro / transition / overlay: by the file's own name first, then by a folder that names only one role
    ('intro-outro/GStroy outro.mp4' is an outro)."""
    parts = rel.split("/")
    for chunk in [os.path.splitext(parts[-1])[0]] + parts[-2::-1]:
        toks = set(_tokens(chunk))
        hits = [role for role, words in ROLE_WORDS if toks & words]
        if len(hits) == 1:
            return hits[0]
    return None


def _variant(name: str) -> str | None:
    toks = set(_tokens(name))
    if toks & {"white", "light", "negative", "inverse", "inverted", "бяло", "бял"}:
        return "for dark backgrounds"
    if toks & {"black", "dark", "positive", "черно", "тъмно"}:
        return "for light backgrounds"
    return None


def _pretty(stem: str) -> str:
    s = re.sub(r"[_]+", " ", stem).strip()
    return s or stem


def _walk(folder: str):
    base_depth = folder.rstrip("/\\").count(os.sep)
    n = 0
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith((".", "_")) and d != "__MACOSX")
        if dirpath.count(os.sep) - base_depth >= MAX_DEPTH:
            dirnames[:] = []
        for f in sorted(filenames):
            if f.startswith(".") or f in (BRAND, SIDE, "Thumbs.db", "desktop.ini") or f.endswith((".tmp", ".md")):
                continue
            full = os.path.join(dirpath, f)
            try:
                st = os.stat(full)
            except OSError:
                continue
            yield os.path.relpath(full, folder).replace("\\", "/"), full, st.st_size, st.st_mtime
            n += 1
            if n >= MAX_FILES:
                return


def signature(folder: str) -> str:
    """Changes when any file in the kit is added, removed, replaced or edited (the panel polls it)."""
    h = hashlib.sha1()
    for path in (os.path.join(folder, BRAND), os.path.join(folder, SIDE)):
        try:
            st = os.stat(path)
            h.update(f"{path}|{st.st_size}|{st.st_mtime_ns}".encode("utf-8"))
        except OSError:
            pass
    for rel, _full, size, mtime in _walk(folder):
        h.update(f"{rel}|{size}|{mtime}".encode("utf-8"))
    return h.hexdigest()[:16]


HEX = re.compile(r"#[0-9A-Fa-f]{6}\b")
SKIP_GROUP = re.compile(r"website|_ui|^ui_|codes|guide_|naming|black_and_white|client_file|page_bg|visibility|discrepancy|"
                        r"rule|note|source|meaning|role", re.I)


def _short(text, limit=40) -> str:
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    t = re.split(r"[:;(]", t)[0].strip() if len(t) > limit else t
    return t[:limit]


def colors_from(brand: dict, side: dict) -> list[dict]:
    """brand.json's colours by group (Primary, Accents, ...), the subtitle colours, and the ones added in Asistent."""
    out = []
    hidden = {str(h).upper() for h in side.get("hidden_colors") or []}

    def item(hexv, name, note=""):
        h = hexv.upper()
        return None if h in hidden else {"hex": h, "name": _short(name) if name else h, "note": _short(note, 80)}

    col = brand.get("colors")
    if isinstance(col, dict):
        for key, v in col.items():
            if SKIP_GROUP.search(str(key)):
                continue
            items = []
            if isinstance(v, list):
                for x in v:
                    if isinstance(x, dict) and isinstance(x.get("hex"), str) and HEX.search(x["hex"]):
                        items.append(item(HEX.search(x["hex"]).group(0), x.get("name") or x.get("use") or x.get("of") or "",
                                          x.get("role") or x.get("note") or x.get("use") or ""))
                    elif isinstance(x, str) and HEX.search(x):
                        items.append(item(HEX.search(x).group(0), ""))
            elif isinstance(v, dict):
                if isinstance(v.get("hex"), str) and HEX.search(v["hex"]):
                    items.append(item(HEX.search(v["hex"]).group(0), v.get("name") or str(key).replace("_", " "), v.get("note") or ""))
                else:
                    for k2, x in v.items():
                        if isinstance(x, str) and HEX.fullmatch(x.strip()[:7]) and len(x.strip()) <= 9:
                            items.append(item(x.strip()[:7], str(k2).replace("_", " ")))
                        elif isinstance(x, dict) and isinstance(x.get("hex"), str) and HEX.search(x["hex"]):
                            items.append(item(HEX.search(x["hex"]).group(0), x.get("name") or k2))
            seen, uniq = set(), []
            for it in items:
                if it and it["hex"] not in seen:
                    seen.add(it["hex"])
                    uniq.append(it)
            if uniq:
                out.append({"group": str(key).replace("_", " ").capitalize(), "items": uniq[:16]})
    subs = ((brand.get("text") or {}).get("subtitles") or {}) if isinstance(brand.get("text"), dict) else {}
    sub_items = []
    for k, label in (("fill", "Subtitle text"), ("highlight", "Subtitle keyword")):
        v = subs.get(k)
        if isinstance(v, str) and HEX.search(v):
            it = item(HEX.search(v).group(0), label)
            if it:
                sub_items.append(it)
    if sub_items:
        out.append({"group": "Subtitles", "items": sub_items})
    added = [item(c["hex"], c.get("name") or "") for c in side.get("colors") or []
             if isinstance(c, dict) and isinstance(c.get("hex"), str) and HEX.fullmatch(c["hex"])]
    added = [a for a in added if a]
    if added:
        out.append({"group": "Added", "items": added, "editable": True})
    return out[:12]


def _subtitle(brand: dict, side: dict) -> dict:
    subs = ((brand.get("text") or {}).get("subtitles") or {}) if isinstance(brand.get("text"), dict) else {}
    name = side.get("subtitle_preset") or subs.get("style_name") or ""
    return {"preset": norm(name) if name else "", "name": str(name), "font": _short(subs.get("font"), 60) if subs.get("font") else "",
            "case": str(subs.get("case") or "")[:20]}


def _notes(brand: dict) -> list[str]:
    out = []
    nr = brand.get("name_rules")
    if isinstance(nr, dict) and nr.get("write_as"):
        out.append(f"Name: {nr['write_as']}")
    slogan = brand.get("slogan")
    if isinstance(slogan, dict) and slogan.get("text"):
        out.append(f"Slogan: {slogan['text']}")
    for key in ("editing_notes", "editing_rules"):
        v = brand.get(key)
        if isinstance(v, list):
            out += [str(x) for x in v if isinstance(x, str)]
        elif isinstance(v, dict):
            out += [f"{k.replace('_', ' ')}: {x}" for k, x in v.items() if isinstance(x, str)]
    return [re.sub(r"\s+", " ", n).strip()[:240] for n in out][:10]


def _declared_fonts(brand: dict) -> list[dict]:
    out = []
    f = brand.get("fonts")
    if not isinstance(f, dict):
        return out
    for role, v in f.items():
        if isinstance(v, dict) and isinstance(v.get("family"), str):
            out.append({"family": v["family"].strip(), "role": str(role).replace("_", " "),
                        "missing": _short(v.get("missing"), 120) if isinstance(v.get("missing"), str) else ""})
    return out


# ---------------------------------------------------------------- fonts: names from the files, installed or not

def font_names(path: str) -> tuple[str, str, str] | None:
    """(family, style, full name) from a TTF / OTF / TTC name table; None for anything else (web fonts are compressed)."""
    try:
        with open(path, "rb") as f:
            head = f.read(12)
            if len(head) < 12:
                return None
            base = 0
            if head[:4] == b"ttcf":
                f.seek(12)
                base = struct.unpack(">I", f.read(4))[0]
                f.seek(base)
                head = f.read(12)
            if head[:4] not in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
                return None
            num = struct.unpack(">H", head[4:6])[0]
            name_off = None
            for _ in range(min(num, 100)):
                rec = f.read(16)
                if rec[:4] == b"name":
                    name_off = struct.unpack(">I", rec[8:12])[0]
                    break
            if name_off is None:
                return None
            f.seek(name_off)
            fmt, count, strings = struct.unpack(">HHH", f.read(6))
            recs = [struct.unpack(">HHHHHH", f.read(12)) for _ in range(min(count, 500))]
            found: dict[int, tuple[int, str]] = {}
            for plat, enc, lang, nid, length, off in recs:
                if nid not in (1, 2, 4, 16, 17):
                    continue
                prio = 0 if (plat == 3 and lang == 0x409) else 1 if plat == 3 else 2 if plat == 1 else 9
                if prio == 9 or (nid in found and found[nid][0] <= prio):
                    continue
                f.seek(name_off + strings + off)
                raw = f.read(length)
                text = raw.decode("utf-16-be", "replace") if plat == 3 else raw.decode("latin-1", "replace")
                found[nid] = (prio, text.strip("\x00 "))
    except (OSError, struct.error):
        return None
    fam = (found.get(16) or found.get(1) or (0, ""))[1]
    style = (found.get(17) or found.get(2) or (0, ""))[1]
    full = (found.get(4) or (0, f"{fam} {style}".strip()))[1]
    return (fam, style, full) if fam else None


def _font_dirs() -> list[str]:
    if sys.platform == "win32":
        dirs = [os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts"),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Windows", "Fonts"),
                os.path.join(os.environ.get("APPDATA", ""), "Adobe", "CoreSync", "plugins", "livetype", "r")]
    else:
        dirs = ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts", os.path.expanduser("~/Library/Fonts"),
                os.path.expanduser("~/Library/Application Support/Adobe/CoreSync/plugins/livetype/.r")]
    return [d for d in dirs if os.path.isdir(d)]


def installed_fonts() -> set[str]:
    """Normalised full names and 'family|style' of every font this computer has (system, user, Adobe Fonts)."""
    dirs = _font_dirs()
    key = tuple((d, os.stat(d).st_mtime) for d in dirs)
    if _font_cache["key"] == key:
        return _font_cache["names"]
    names: set[str] = set()
    for d in dirs:
        try:
            files = os.listdir(d)
        except OSError:
            continue
        for fn in files:
            if os.path.splitext(fn)[1].lower().lstrip(".") not in FONT_USABLE | {"dfont"}:
                continue
            got = font_names(os.path.join(d, fn))
            names.add("file:" + fn.lower())
            if got:
                names.add(norm(got[2]))
                names.add(norm(got[0]) + "|" + norm(got[1]))
                names.add("family:" + norm(got[0]))
    _font_cache.update(key=key, names=names)
    return names


def _font_installed(fn: str, names: tuple | None, have: set[str]) -> bool:
    if "file:" + os.path.basename(fn).lower() in have:
        return True
    return bool(names) and (norm(names[2]) in have or (norm(names[0]) + "|" + norm(names[1])) in have)


def user_font_dir() -> str:
    if sys.platform == "win32":
        return os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Microsoft", "Windows", "Fonts")
    return os.path.expanduser("~/Library/Fonts")


WEIGHT_WORDS = {"thin", "hairline", "extralight", "ultralight", "light", "regular", "book", "normal", "medium", "semibold",
                "demibold", "bold", "extrabold", "ultrabold", "black", "heavy", "italic", "oblique", "webfont", "web", "font",
                "vf", "variable", "it", "extra", "ultra", "semi", "demi"}


def _family_from_file(stem: str) -> str:
    """'cormac-black-webfont' -> 'cormac', 'Muller-ExtraBold' -> 'Muller' (a web font has no readable name table)."""
    parts = [p for p in re.split(r"[-_ ]+", re.sub(r"([a-z])([A-Z])", r"\1 \2", stem)) if p]
    while len(parts) > 1 and parts[-1].lower() in WEIGHT_WORDS:
        parts.pop()
    return " ".join(parts) or stem


def _install_font_file(src: str) -> str | None:
    """Copy one TTF/OTF into the user's fonts (no admin rights), registered on Windows as install.py does."""
    name = os.path.basename(src)
    dst = os.path.join(user_font_dir(), name)
    if os.path.exists(dst):
        return None
    os.makedirs(user_font_dir(), exist_ok=True)
    shutil.copy2(src, dst)
    if sys.platform == "win32":
        import winreg
        got = font_names(src)
        label = f"{got[2] if got else os.path.splitext(name)[0]} ({'OpenType' if name.lower().endswith('.otf') else 'TrueType'})"
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Fonts") as k:
            winreg.SetValueEx(k, label, 0, winreg.REG_SZ, dst)
    return name


# ---------------------------------------------------------------- the kit

def _probe(full: str, size: int, mtime: float) -> dict:
    key = (full, size, mtime)
    if key in _probe_cache:
        return _probe_cache[key]
    out = {}
    try:
        from . import media
        info = media.probe(full)
        out = {"duration": round(float(info.duration), 3) if info.duration else None, "has_audio": bool(info.audio),
               "has_video": bool(info.has_video)}
    except Exception as e:                                             # noqa: BLE001 - a file FFprobe cannot read: no numbers
        log.info("brandkit: probe %s: %s", os.path.basename(full), e)
    _probe_cache[key] = out
    return out


def read_kit(kid: str, project: str = "", sig: str | None = None) -> dict:
    """The whole kit for the Brand page; {"unchanged": True} when `sig` still matches (nothing in the folder changed)."""
    entry = _find(kid, project)
    folder = entry["folder"]
    idx_path = os.path.join(_dir(), "index", f"{kid}.json")
    if not os.path.isdir(folder):
        cached = _read_json(idx_path)
        if not cached:
            raise ValueError(f"The folder of {entry['name']} is not reachable ({folder}) and this computer has not read it before.")
        cached.update(online=False, note=f"The kit's folder is not reachable ({folder}): showing what this computer read last "
                                          f"({cached.get('read_at', '?')}). Files with a copy here still work.")
        _mark(cached)
        return cached
    now_sig = signature(folder)
    if sig and sig == now_sig:
        return {"unchanged": True, "sig": now_sig}
    brand = _read_json(os.path.join(folder, BRAND))
    side = _read_json(os.path.join(folder, SIDE))
    assets: dict[str, list] = {c: [] for c in CATEGORIES}
    fonts: dict[str, dict] = {}
    have = installed_fonts()
    probes = 0
    for rel, full, size, mtime in _walk(folder):
        ext = os.path.splitext(rel)[1].lower().lstrip(".")
        if not ext:
            continue
        parts = rel.split("/")
        cat = _category_of(parts[:-1], ext)
        stem = os.path.splitext(parts[-1])[0]
        a = {"rel": rel, "name": _pretty(stem), "ext": ext, "kind": _kind(ext), "cat": cat, "size": size,
             "importable": ext in IMPORTABLE, "folder": "/".join(parts[:-1])}
        if not a["importable"] and ext in WHY_NOT:
            a["why"] = WHY_NOT[ext]
        v = _variant(stem)
        if v:
            a["variant"] = v
        if a["kind"] in ("video", "audio"):
            r = _role(rel)
            if r:
                a["role"] = r
            if probes < 60:
                a.update(_probe(full, size, mtime))
                probes += 1
        if cat == "fonts":
            names = font_names(full) if ext in FONT_USABLE else None
            fam = names[0] if names else _family_from_file(stem)
            g = fonts.setdefault(norm(fam), {"family": fam, "files": [], "role": "", "missing": ""})
            g["files"].append({"rel": rel, "style": (names[1] if names else stem), "ext": ext, "usable": ext in FONT_USABLE,
                               "installed": ext in FONT_USABLE and _font_installed(full, names, have)})
            continue
        assets[cat].append(a)
    # one stem in one folder in several formats (logo.png + logo.svg + logo.ai): the best one shows, the others ride along
    for cat in ("logos", "graphics"):
        best: dict[tuple, dict] = {}
        order = []
        for a in assets[cat]:
            if a["kind"] not in ("image", "vector"):
                order.append(a)
                continue
            k = (a["folder"].lower(), a["name"].lower())
            cur = best.get(k)
            if cur is None:
                best[k] = a
                order.append(a)
            elif RANK.get(a["ext"], 20) < RANK.get(cur["ext"], 20):
                a["alts"] = cur.get("alts", []) + [{"rel": cur["rel"], "ext": cur["ext"]}]
                cur.pop("alts", None)
                best[k] = a
                order[order.index(cur)] = a
            else:
                cur.setdefault("alts", []).append({"rel": a["rel"], "ext": a["ext"]})
        assets[cat] = order
    for d in _declared_fonts(brand):
        g = fonts.setdefault(norm(d["family"]), {"family": d["family"], "files": [], "role": "", "missing": ""})
        if not any(f["usable"] for f in g["files"]):         # a name guessed from a web font's file: brand.json spells it right
            g["family"] = d["family"]
        g["role"] = g["role"] or d["role"]
        g["missing"] = g["missing"] or d["missing"]
    font_list = []
    for g in fonts.values():
        usable = [f for f in g["files"] if f["usable"]]
        if usable:
            g["installed"] = "yes" if all(f["installed"] for f in usable) else "partly" if any(f["installed"] for f in usable) else "no"
        else:                                              # no TTF/OTF in the kit: is the family on this computer anyway?
            g["installed"] = "yes" if "family:" + norm(g["family"]) in have else "no"
        g["files"].sort(key=lambda f: f["style"].lower())
        font_list.append(g)
    font_list.sort(key=lambda g: (0 if g["role"] else 1, g["family"].lower()))
    kit = {"id": kid, "name": entry["name"], "folder": folder, "source": entry["source"], "online": True,
           "remote": entry["remote"], "sig": now_sig, "read_at": time.strftime("%Y-%m-%d %H:%M"),
           "colors": colors_from(brand, side), "fonts": font_list, "assets": assets, "subtitle": _subtitle(brand, side),
           "notes": _notes(brand), "aliases": entry["aliases"], "brand_json": bool(brand),
           "status": str(brand.get("status") or "")[:60], "deletable": entry["source"] == "library",
           "counts": {c: len(v) for c, v in assets.items()} | {"fonts": len(font_list)}}
    try:
        os.makedirs(os.path.dirname(idx_path), exist_ok=True)
        _write_json(idx_path, kit)
    except OSError as e:
        log.info("brandkit: index not written: %s", e)
    _mark(kit)
    return kit


def _mark(kit: dict) -> None:
    """Favourites, use counts and which files have a copy on this computer (per computer, not in the kit)."""
    s = settings()
    favs = set(s["favorites"].get(kit["id"]) or [])
    uses = s["usage"].get(kit["id"]) or {}
    cdir = os.path.join(_dir(), "cache", kit["id"])
    for lst in kit["assets"].values():
        for a in lst:
            a["fav"] = a["rel"] in favs
            u = uses.get(a["rel"])
            a["uses"] = int(u[0]) if isinstance(u, list) and u else 0
            a["cached"] = os.path.isfile(os.path.join(cdir, a["rel"]))


# ---------------------------------------------------------------- using a file: path, usage, local copy

def resolve(kid: str, rel: str, project: str = "", count: bool = True) -> dict:
    """The file to hand Premiere: the kit's own (the server's) when it is reachable, else this computer's copy."""
    entry = _find(kid, project)
    folder = entry["folder"]
    cached = os.path.join(_dir(), "cache", kid, rel.replace("/", os.sep))
    if os.path.isdir(folder):
        src = _inside(folder, rel)
        if not os.path.isfile(src):
            raise ValueError(f"{os.path.basename(rel)} is no longer in the kit (moved or removed): press Refresh.")
        uses = _use(kid, rel) if count else 0
        if entry["remote"] and (uses >= CACHE_AFTER_USES or os.path.isfile(cached)):
            _copy_later(src, cached)
        return {"path": src, "cached": False}
    if os.path.isfile(cached):
        if count:
            _use(kid, rel)
        try:
            os.utime(cached)
        except OSError:
            pass
        return {"path": cached, "cached": True,
                "note": "The server is not reachable: this computer's copy was used. Relink it to the server later if others open the project."}
    raise ValueError(f"The kit's folder is not reachable ({folder}) and {os.path.basename(rel)} has no copy on this computer.")


def _use(kid: str, rel: str) -> int:
    with _lock:
        s = settings()
        u = s["usage"].setdefault(kid, {})
        n = int((u.get(rel) or [0])[0]) + 1
        u[rel] = [n, int(time.time())]
        _save_settings(s)
        return n


def _copy_later(src: str, dst: str) -> None:
    def work():
        try:
            st = os.stat(src)
            if os.path.isfile(dst):
                dt = os.stat(dst)
                if dt.st_size == st.st_size and abs(dt.st_mtime - st.st_mtime) < 2:
                    os.utime(dst)
                    return
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst + ".part")
            os.replace(dst + ".part", dst)
            os.utime(dst)
            _trim_cache()
        except OSError as e:
            log.info("brandkit: local copy of %s failed: %s", os.path.basename(src), e)
        finally:
            _copying.discard(dst)

    if dst in _copying:
        return
    _copying.add(dst)
    threading.Thread(target=work, daemon=True).start()


def _trim_cache(limit: int = CACHE_LIMIT) -> None:
    root = os.path.join(_dir(), "cache")
    files = []
    for dp, _dn, fns in os.walk(root):
        for fn in fns:
            p = os.path.join(dp, fn)
            try:
                st = os.stat(p)
                files.append((st.st_atime if st.st_atime > st.st_mtime else st.st_mtime, st.st_size, p))
            except OSError:
                pass
    total = sum(f[1] for f in files)
    for _t, size, p in sorted(files):
        if total <= limit:
            break
        try:
            os.remove(p)
            total -= size
        except OSError:
            pass


def favorite(kid: str, rel: str, on: bool) -> dict:
    with _lock:
        s = settings()
        favs = [r for r in s["favorites"].get(kid) or [] if r != rel]
        if on:
            favs.insert(0, rel)
        s["favorites"][kid] = favs[:40]
        _save_settings(s)
    return {"ok": True, "favorites": s["favorites"][kid]}


# ---------------------------------------------------------------- thumbnails

def _thumb_one(full: str, ext: str) -> str | None:
    try:
        st = os.stat(full)
    except OSError:
        return None
    if ext == "svg":
        if st.st_size > SVG_MAX:
            return None
        with open(full, "rb") as f:
            return "data:image/svg+xml;base64," + base64.b64encode(f.read()).decode("ascii")
    if ext not in IMAGE | VIDEO | {"ai"} - {"heic"}:
        return None
    video = ext in VIDEO
    out_ext = "jpg" if video or ext in ("jpg", "jpeg") else "png"
    key = hashlib.sha1(f"{full}|{st.st_size}|{st.st_mtime}|{THUMB}".encode("utf-8")).hexdigest()[:20]
    tdir = os.path.join(_dir(), "thumbs")
    os.makedirs(tdir, exist_ok=True)
    out = os.path.join(tdir, f"{key}.{out_ext}")
    if not os.path.isfile(out):
        try:
            from .media import _tool
            ff = _tool("ffmpeg")
        except Exception:                                              # noqa: BLE001
            return None
        cmd = [ff, "-v", "error", "-y"]
        if video:
            cmd += ["-ss", "1"]
        cmd += ["-i", full, "-frames:v", "1", "-vf", f"scale={THUMB}:{THUMB}:force_original_aspect_ratio=decrease"]
        cmd += ["-q:v", "4", out] if out_ext == "jpg" else ["-pix_fmt", "rgba", out]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=20)
            if (r.returncode != 0 or not os.path.isfile(out)) and video:       # shorter than a second: the first frame
                cmd[cmd.index("-ss") + 1] = "0"
                subprocess.run(cmd, capture_output=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            return None
        if not os.path.isfile(out):
            return None
    with open(out, "rb") as f:
        return f"data:image/{'jpeg' if out_ext == 'jpg' else 'png'};base64," + base64.b64encode(f.read()).decode("ascii")


def thumbs(kid: str, rels: list, project: str = "") -> dict:
    if not isinstance(rels, list) or not all(isinstance(r, str) for r in rels):
        raise ValueError("A list of files is needed.")
    entry = _find(kid, project)
    folder = entry["folder"]
    online = os.path.isdir(folder)
    cdir = os.path.join(_dir(), "cache", kid)

    def one(rel):
        try:
            full = _inside(folder, rel) if online else os.path.join(cdir, rel)
            return rel, _thumb_one(full, os.path.splitext(rel)[1].lower().lstrip("."))
        except (ValueError, OSError):
            return rel, None

    with ThreadPoolExecutor(max_workers=4) as pool:
        return {"thumbs": dict(pool.map(one, rels[:80]))}


# ---------------------------------------------------------------- fonts, clipboard, Finder

def install_font(kid: str, family: str, project: str = "") -> dict:
    kit = read_kit(kid, project)
    if kit.get("unchanged"):
        kit = read_kit(kid, project)
    g = next((f for f in kit["fonts"] if norm(f["family"]) == norm(family)), None)
    if not g:
        raise ValueError(f"The kit has no font {family}.")
    usable = [f for f in g["files"] if f["usable"]]
    if not usable:
        raise ValueError(f"{g['family']} has no TTF or OTF file in the kit" + (" (only web fonts)." if g["files"] else ".")
                         + (f" {g['missing']}" if g.get("missing") else ""))
    added, skipped = [], 0
    for f in usable:
        if f["installed"]:
            skipped += 1
            continue
        src = resolve(kid, f["rel"], project, count=False)["path"]
        name = _install_font_file(src)
        if name:
            added.append(name)
        else:
            skipped += 1
    _font_cache["key"] = None
    return {"ok": True, "added": added, "skipped": skipped,
            "msg": (f"Installed {len(added)} file{'s' if len(added) != 1 else ''} of {g['family']}: Premiere shows "
                    "new fonts after it restarts.") if added else f"{g['family']} is already installed."}


def copy_text(text: str) -> dict:
    t = str(text or "")
    if not t or len(t) > 500:
        raise ValueError("Nothing to copy.")
    if sys.platform == "darwin":
        subprocess.run(["pbcopy"], input=t.encode("utf-8"), check=True, timeout=5)
    elif sys.platform == "win32":
        subprocess.run(["clip"], input=t.encode("utf-16-le"), check=True, timeout=5)
    else:
        raise ValueError("Copying is not supported on this system.")
    return {"ok": True}


def reveal(kid: str, rel: str = "", project: str = "") -> dict:
    entry = _find(kid, project)
    folder = entry["folder"]
    if not os.path.isdir(folder):
        raise ValueError(f"The kit's folder is not reachable: {folder}")
    target = _inside(folder, rel) if rel else folder
    if sys.platform == "darwin":
        cmd = ["open", "-R", target] if rel else ["open", target]
    elif sys.platform == "win32":
        cmd = ["explorer.exe", "/select,", target] if rel else ["explorer.exe", target]
    else:
        raise ValueError("Showing files is not supported on this system.")
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
    return {"ok": True}


def open_file(kid: str, rel: str, project: str = "") -> dict:
    """A reference (PDF, picture, video) in its own app: only files inside a kit."""
    path = resolve(kid, rel, project, count=False)["path"]
    if sys.platform == "darwin":
        subprocess.Popen(["open", path], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif sys.platform == "win32":
        os.startfile(path)                                             # noqa: S606 - the editor's own kit file
    else:
        raise ValueError("Opening files is not supported on this system.")
    return {"ok": True}


# ---------------------------------------------------------------- managing kits

def _side_update(folder: str, change) -> dict:
    path = os.path.join(folder, SIDE)
    with _lock:
        side = _read_json(path)
        side.setdefault("format", FORMAT)
        change(side)
        side["updated"] = time.strftime("%Y-%m-%d %H:%M")
        _write_json(path, side)
    return side


def _library_for_new(root: str | None) -> str:
    if root:
        if root not in roots() or not os.path.isdir(root):
            raise ValueError("That library folder is not reachable.")
        return root
    for r in roots():
        if os.path.isdir(r):
            return r
    raise ValueError("No library folder yet: choose where the brand kits are (Library folder…).")


def manage(action: str, body: dict, project: str = "") -> dict:
    """create, duplicate, rename, delete, forget, aliases, color_add, color_remove, subtitle, add_folder, set_root, remove_root."""
    if action == "set_root":
        path = os.path.abspath(str(body.get("path") or ""))
        if not os.path.isdir(path):
            raise ValueError("That folder is not reachable.")
        with _lock:
            s = settings()
            s["roots"] = [path] + [r for r in s["roots"] if r != path]
            _save_settings(s)
        return {"ok": True, "roots": s["roots"]}
    if action == "remove_root":
        with _lock:
            s = settings()
            s["roots"] = [r for r in s["roots"] if r != body.get("path")]
            _save_settings(s)
        return {"ok": True, "roots": s["roots"]}
    if action == "add_folder":
        path = os.path.abspath(str(body.get("path") or ""))
        if not os.path.isdir(path):
            raise ValueError("That folder is not reachable.")
        with _lock:
            s = settings()
            if path not in s["folders"]:
                s["folders"].append(path)
            _save_settings(s)
        name = str(body.get("name") or "").strip()
        if name and not _read_json(os.path.join(path, BRAND)).get("display_name"):
            try:
                _side_update(path, lambda side: side.update(name=_safe_name(name)))
            except OSError as e:
                log.info("brandkit: name not written in %s: %s", path, e)
        return {"ok": True, "id": kit_id(path)}
    if action == "create":
        name = _safe_name(body.get("name"))
        root = _library_for_new(body.get("root"))
        folder = os.path.join(root, name)
        if os.path.exists(folder):
            raise ValueError(f"A kit named {name} already exists there.")
        for sub in ("logo", "fonts", "video", "graphics", "presets", "reference"):
            os.makedirs(os.path.join(folder, "assets", sub))
        _side_update(folder, lambda side: side.update(name=name, created=time.strftime("%Y-%m-%d")))
        return {"ok": True, "id": kit_id(folder), "folder": folder}

    entry = _find(str(body.get("id") or ""), project)
    folder = entry["folder"]
    if action == "forget":
        with _lock:
            s = settings()
            s["folders"] = [f for f in s["folders"] if os.path.abspath(f) != os.path.abspath(folder)]
            _save_settings(s)
        return {"ok": True}
    if not os.path.isdir(folder):
        raise ValueError(f"The kit's folder is not reachable ({folder}): it cannot be changed now.")
    if action == "duplicate":
        name = _safe_name(body.get("name") or f"{entry['name']} copy")
        dst = os.path.join(os.path.dirname(folder), name)
        if os.path.exists(dst):
            raise ValueError(f"A kit named {name} already exists there.")
        shutil.copytree(folder, dst, ignore=shutil.ignore_patterns(".DS_Store", "Thumbs.db"))
        _side_update(dst, lambda side: side.update(name=name, duplicated_from=entry["name"]))
        if entry["source"] == "folder":
            manage("add_folder", {"path": dst}, project)
        return {"ok": True, "id": kit_id(dst), "folder": dst}
    if action == "rename":
        name = _safe_name(body.get("name"))
        _side_update(folder, lambda side: side.update(name=name))
        return {"ok": True}
    if action == "delete":
        if entry["source"] != "library":
            raise ValueError("Only a kit inside a library folder can be deleted here; this one can be forgotten (its files stay).")
        trash = os.path.join(os.path.dirname(folder), DELETED)
        os.makedirs(trash, exist_ok=True)
        dst = os.path.join(trash, f"{os.path.basename(folder)} {time.strftime('%Y-%m-%d %H%M%S')}")
        shutil.move(folder, dst)
        return {"ok": True, "moved_to": dst}
    if action == "aliases":
        al = [a.strip()[:60] for a in body.get("aliases") or [] if isinstance(a, str) and a.strip()][:12]
        _side_update(folder, lambda side: side.update(aliases=al))
        return {"ok": True, "aliases": al}
    if action == "subtitle":
        preset = re.sub(r"[^a-z0-9]", "", str(body.get("preset") or "").lower())[:30]
        _side_update(folder, lambda side: side.update(subtitle_preset=preset))
        return {"ok": True}
    if action == "color_add":
        hexv = str(body.get("hex") or "").strip().upper()
        if re.fullmatch(r"[0-9A-F]{6}", hexv):
            hexv = "#" + hexv
        if not re.fullmatch(r"#[0-9A-F]{6}", hexv):
            raise ValueError("A colour is written as #RRGGBB (six hex digits).")
        name = re.sub(r"\s+", " ", str(body.get("name") or "")).strip()[:40]

        def add(side):
            cols = [c for c in side.get("colors") or [] if isinstance(c, dict) and str(c.get("hex", "")).upper() != hexv]
            side["colors"] = cols + [{"hex": hexv, "name": name}]
            side["hidden_colors"] = [h for h in side.get("hidden_colors") or [] if str(h).upper() != hexv]
        _side_update(folder, add)
        return {"ok": True}
    if action == "color_remove":
        hexv = str(body.get("hex") or "").strip().upper()

        def rm(side):
            before = len(side.get("colors") or [])
            side["colors"] = [c for c in side.get("colors") or [] if str(c.get("hex", "")).upper() != hexv]
            if len(side["colors"]) == before:                          # one of brand.json's: hidden here, the file untouched
                side["hidden_colors"] = list(dict.fromkeys((side.get("hidden_colors") or []) + [hexv]))
        _side_update(folder, rm)
        return {"ok": True}
    raise ValueError("Unknown kit action.")


def _target_dir(kit: dict, cat: str) -> str:
    """Where an added file goes: the kit's existing folder for that kind (the first one holding such files), else assets/<kind>."""
    for a in kit["assets"].get(cat, []) if cat != "fonts" else []:
        if a.get("folder"):
            return a["folder"]
    if cat == "fonts":
        for g in kit["fonts"]:
            for f in g["files"]:
                return os.path.dirname(f["rel"])
    base = "assets" if os.path.isdir(os.path.join(kit["folder"], "assets")) else ""
    return "/".join(x for x in (base, ADD_FOLDER.get(cat, "other")) if x)


def plan_add(kid: str, paths: list, category: str = "", project: str = "") -> list[tuple[str, str]]:
    """(source, destination) for every file to copy into the kit; refuses folders and missing files up front."""
    if not isinstance(paths, list) or not paths or not all(isinstance(p, str) for p in paths):
        raise ValueError("No files to add.")
    if category and category not in CATEGORIES:
        raise ValueError("Unknown category.")
    kit = read_kit(kid, project)
    if kit.get("unchanged") or not kit.get("online"):
        if not kit.get("online"):
            raise ValueError("The kit's folder is not reachable: files cannot be added now.")
        kit = read_kit(kid, project)
    out = []
    taken = set()
    for p in paths[:200]:
        if not os.path.isfile(p):
            raise ValueError(f"Not a file (folders are not added): {os.path.basename(p.rstrip('/'))}")
        ext = os.path.splitext(p)[1].lower().lstrip(".")
        cat = category or _category_of([], ext)
        if cat == "other" and ext in IMAGE:
            cat = "graphics"
        d = os.path.join(kit["folder"], _target_dir(kit, cat))
        stem, dot = os.path.splitext(os.path.basename(p))
        dst = os.path.join(d, stem + dot)
        n = 2
        while os.path.exists(dst) or dst in taken:
            dst = os.path.join(d, f"{stem} ({n}){dot}")
            n += 1
        taken.add(dst)
        _inside(kit["folder"], os.path.relpath(dst, kit["folder"]))
        out.append((p, dst))
    return out


def add_files(plan: list[tuple[str, str]], progress=None, cancelled=None) -> dict:
    done = []
    total = sum(os.path.getsize(s) for s, _d in plan) or 1
    moved = 0
    for i, (src, dst) in enumerate(plan):
        if cancelled and cancelled():
            break
        if progress:
            progress(moved / total, f"Copying {os.path.basename(src)} ({i + 1} of {len(plan)})")
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst + ".part")
        os.replace(dst + ".part", dst)
        moved += os.path.getsize(src)
        done.append(os.path.basename(dst))
    return {"added": done, "total": len(plan)}
