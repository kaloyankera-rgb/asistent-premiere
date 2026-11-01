"""Client profiles: the settings that differ per client, kept as JSON next to the code (synced to the PC).

A profile never carries a colour correction: footage of one client is shot in different places, so
corrections are measured per clip (Phase 6). It holds preferences: audio target, watched folder,
subtitle language, brand, notes.
"""
from __future__ import annotations

import copy
import json
import os
import re
import sys

PROFILES_DIR = os.environ.get("ASISTENT_PROFILES") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "profiles")
VAULT_CLIENTS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(PROFILES_DIR))), "clients")

# folders that sort a client's material by kind; anything else inside an agency folder is a sub-client
KIND_FOLDERS = {"audio", "exports", "graphics", "media", "other", "projects", "docs", "brand kit"}

DEFAULT = {
    "audio": {"target_lufs": -17.0, "peak_db": -6.0},
    "import": {"watch": "~/Downloads"},
    "subtitles": {"language": "bg", "english": False},
    "brand": {},
    "notes": "",
}


def client_roots() -> list[str]:
    roots = [os.path.expanduser("~/Kaloyan/01_CLIENTS")]
    if sys.platform == "win32":
        roots.append(os.path.join(os.environ.get("USERPROFILE", ""), "Kaloyan", "01_CLIENTS"))
    extra = os.environ.get("ASISTENT_CLIENTS")
    if extra:
        roots.insert(0, extra)
    return [r for r in dict.fromkeys(roots) if os.path.isdir(r)]


def _subclients(path: str) -> list[str]:
    out = []
    for d in sorted(os.listdir(path)):
        full = os.path.join(path, d)
        if os.path.isdir(full) and not d.startswith((".", "_")) and d.lower() not in KIND_FOLDERS \
                and not re.match(r"^\d{4}-\d{2}-\d{2}", d):
            if any(os.path.isdir(os.path.join(full, k)) for k in os.listdir(full)):
                out.append(d)
    return out


def list_clients() -> list[str]:
    names = set()
    for root in client_roots():
        for d in os.listdir(root):
            full = os.path.join(root, d)
            if not os.path.isdir(full) or d.startswith((".", "_", "00_")) or d.upper() == "DOCS":
                continue
            names.add(d)
            # an agency folder (it has Media/Projects AND other folders): its sub-clients too
            if any(os.path.isdir(os.path.join(full, k)) for k in ("Media", "Projects")):
                for sub in _subclients(full):
                    names.add(f"{d} / {sub}")
    if os.path.isdir(PROFILES_DIR):
        for f in os.listdir(PROFILES_DIR):
            if f.endswith(".json"):
                try:
                    with open(os.path.join(PROFILES_DIR, f), encoding="utf-8") as fh:
                        names.add(json.load(fh).get("client") or f[:-5])
                except (OSError, ValueError):
                    pass
    return sorted(names, key=str.lower)


def client_from_path(path: str) -> str | None:
    """'…/01_CLIENTS/The Pact/GStroy/Media/…' -> 'The Pact / GStroy'; '…/01_CLIENTS/4a1a Racing/…' -> '4a1a Racing'."""
    parts = re.split(r"[\\/]+", path or "")
    if "01_CLIENTS" not in parts:
        return None
    i = parts.index("01_CLIENTS")
    if i + 1 >= len(parts):
        return None
    client = parts[i + 1]
    root = "/".join(parts[: i + 2]) if not re.match(r"^[A-Za-z]:$", parts[0]) else "\\".join(parts[: i + 2])
    if i + 2 < len(parts) - 1:
        sub = parts[i + 2]
        if sub.lower() not in KIND_FOLDERS and not re.match(r"^\d{4}-\d{2}-\d{2}", sub) and \
                os.path.isdir(os.path.join(root, sub)) and sub in _subclients(root):
            return f"{client} / {sub}"
    return client


def _file(client: str) -> str:
    safe = re.sub(r"[^\w\- ]+", "_", client.replace(" / ", " - ")).strip()
    return os.path.join(PROFILES_DIR, f"{safe}.json")


def _seed_from_vault(client: str, prof: dict) -> dict:
    """Content Studio already knows some clients (clients/<name>/edit-style.json): reuse brand and sound."""
    name = client.split(" / ")[-1]
    path = os.path.join(VAULT_CLIENTS, name, "edit-style.json")
    if not os.path.isfile(path):
        return prof
    try:
        with open(path, encoding="utf-8") as fh:
            edit = json.load(fh).get("edit", {})
    except (OSError, ValueError):
        return prof
    kit = edit.get("brand_kit") or {}
    if kit:
        prof["brand"] = {k: kit[k] for k in ("colors", "font") if k in kit}
    sound = edit.get("sound") or {}
    if "voice_lufs" in sound:
        prof["audio"]["target_lufs"] = float(sound["voice_lufs"])
    if "peak_dbfs" in sound:
        prof["audio"]["peak_db"] = float(sound["peak_dbfs"])
    prof["source"] = f"clients/{name}/edit-style.json"
    return prof


def load(client: str) -> dict:
    path = _file(client)
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            prof = json.load(fh)
        merged = copy.deepcopy(DEFAULT)
        for k, v in prof.items():
            merged[k] = {**merged[k], **v} if isinstance(v, dict) and isinstance(merged.get(k), dict) else v
        merged["client"] = client
        merged["saved"] = True
        return merged
    prof = copy.deepcopy(DEFAULT)
    prof["client"] = client
    prof["saved"] = False
    return _seed_from_vault(client, prof)


def save(client: str, prof: dict) -> dict:
    if not client or not isinstance(prof, dict):
        raise ValueError("Няма клиент или профил.")
    data = {k: v for k, v in prof.items() if k not in ("saved",)}
    data["client"] = client
    os.makedirs(PROFILES_DIR, exist_ok=True)
    path = _file(client)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    return load(client)
