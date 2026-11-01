"""Smart Folder Sync: watch a download folder, wait until a file is really complete, sort it into a
category and queue it for the ONE Premiere project that owns that folder.

Safety rules:
  * a watched folder belongs to exactly one project at a time; its files are only ever handed to that
    project (the panel imports them only while that project is the open one);
  * files older than the moment the folder was switched on are left alone;
  * a file is ready only when no browser temp file exists for it, its size and time stopped changing,
    it can be opened, and FFprobe can read it (media);
  * the same file (path + size + time) is never queued twice, also after a restart;
  * files are imported in place: never moved, renamed or copied.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import uuid

from . import config
from .media import MediaError, _run, _tool

log = logging.getLogger("asistent")

AUDIO = {".wav", ".mp3", ".aif", ".aiff", ".m4a", ".flac", ".ogg", ".aac", ".opus"}
VIDEO = {".mp4", ".mov", ".mxf", ".m4v", ".avi", ".mkv", ".webm", ".mts", ".m2ts"}
IMAGE = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".heic", ".bmp", ".gif"}
GRAPHIC = {".psd", ".ai", ".svg", ".eps"}
MEDIA = AUDIO | VIDEO | IMAGE | GRAPHIC
CATEGORIES = ("MUSIC", "SFX", "BROLL", "IMAGES", "GRAPHICS", "OTHER")

# browsers and copy tools write under a temporary name first
TEMP_SUFFIXES = (".crdownload", ".part", ".partial", ".download", ".tmp", ".opdownload", ".!ut", ".aria2", ".filepart")
STABLE_SECONDS = 1.5      # copied in some other way: size and time unchanged this long
MOVED_STABLE = 0.3         # renamed from a browser temp name: the browser itself says it is complete

_W = lambda *ws: re.compile(r"(?:^|[^a-zа-я0-9])(?:" + "|".join(ws) + r")(?:[^a-zа-я0-9]|$)", re.I)  # noqa: E731
SFX_WORDS = _W("sfx", "sound ?effects?", "whoosh\\w*", "swoosh\\w*", "swish\\w*", "swipe", "hits?", "impacts?",
               "risers?", "boom\\w*", "clicks?", "pops?", "dings?", "glitch\\w*", "notification", "foley",
               "braams?", "stingers?", "transitions? ?sfx", "ефекти", "звуци", "звук")
MUSIC_WORDS = _W("music", "songs?", "beats?", "instrumental", "lo-?fi", "\\d+ ?bpm", "soundtrack", "remix",
                 "score", "музика", "песен")
BROLL_WORDS = _W("b-?roll", "stock", "footage", "броул")
GRAPHIC_WORDS = _W("overlays?", "lower ?thirds?", "titles?", "logos?", "alpha", "mogrt", "templates?",
                   "elements?", "graphics?", "графики", "лого")
FOLDER_CATEGORY = {"music": "MUSIC", "музика": "MUSIC", "sfx": "SFX", "ефекти": "SFX", "звуци": "SFX",
                   "broll": "BROLL", "b-roll": "BROLL", "b_roll": "BROLL", "images": "IMAGES", "снимки": "IMAGES",
                   "graphics": "GRAPHICS", "графики": "GRAPHICS"}


def is_temp(path: str) -> bool:
    name = os.path.basename(path).lower()
    return name.startswith((".", "~$")) or name.endswith(TEMP_SUFFIXES) or ".download/" in path.lower() + "/"


def temp_sibling(path: str) -> bool:
    """A browser still writing this file (Firefox keeps the final name at 0 bytes next to a .part)."""
    return any(os.path.exists(path + s) for s in TEMP_SUFFIXES)


def _probe(path: str) -> dict | None:
    p = _run([_tool("ffprobe"), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path])
    if p.returncode != 0:
        return None
    try:
        return json.loads(p.stdout or b"{}")
    except ValueError:
        return None


def classify(path: str, folder_root: str | None = None, probe: dict | None = None) -> tuple[str, str]:
    """(category, reason). OTHER when it cannot be told with confidence."""
    ext = os.path.splitext(path)[1].lower()
    rel = os.path.relpath(path, folder_root) if folder_root else os.path.basename(path)
    parts = [p.lower() for p in rel.replace("\\", "/").split("/")[:-1]]
    for p in reversed(parts):                                   # 1. the folder it was saved into
        if p in FOLDER_CATEGORY:
            return FOLDER_CATEGORY[p], f"папка „{p}“"
    text = rel.replace("_", " ")
    tags = {}
    duration = None
    alpha = False
    if probe:
        tags = {k.lower(): v for k, v in (probe.get("format", {}).get("tags") or {}).items()}
        try:
            duration = float(probe.get("format", {}).get("duration") or 0) or None
        except ValueError:
            duration = None
        for s in probe.get("streams", []):
            pf = (s.get("pix_fmt") or "").lower()
            if s.get("codec_type") == "video" and (pf.startswith(("yuva", "rgba", "argb", "bgra", "abgr", "gbrap"))
                                                    or pf.endswith("a")):
                alpha = True

    if ext in AUDIO:
        sfx, music = bool(SFX_WORDS.search(text)), bool(MUSIC_WORDS.search(text))
        tagged = any(tags.get(k) for k in ("artist", "album", "genre"))
        if sfx and not music:
            return "SFX", "името подсказва звуков ефект"
        if music and not sfx:
            return "MUSIC", "името подсказва музика"
        if duration is not None and duration <= 8:
            return "SFX", f"кратък звук ({duration:.1f} s)"
        if duration is not None and duration >= 60 and (tagged or " - " in os.path.basename(path)):
            return "MUSIC", f"дълъг запис ({duration:.0f} s) с изпълнител"
        if duration is not None and duration >= 90:
            return "MUSIC", f"дълъг запис ({duration:.0f} s)"
        return "OTHER", "не е ясно дали е музика или ефект"
    if ext in VIDEO:
        if alpha or GRAPHIC_WORDS.search(text):
            return "GRAPHICS", "видео с прозрачност" if alpha else "името подсказва графика"
        return "BROLL", "видео"
    if ext in IMAGE:
        return ("GRAPHICS", "името подсказва графика") if GRAPHIC_WORDS.search(text) else ("IMAGES", "снимка")
    if ext in GRAPHIC:
        return "GRAPHICS", "файл за графика"
    return "OTHER", "непознат вид"


class Store:
    """Folders, queue and history on disk (JSON), so nothing is lost or imported twice after a restart."""

    def __init__(self, path: str | None = None):
        self.path = path or os.path.join(config.app_dir(), "import.json")
        self.lock = threading.RLock()
        self.changed = threading.Condition(self.lock)   # wakes the panel's waiting request at once
        self.data = {"bindings": {}, "items": {}}
        if os.path.isfile(self.path):
            try:
                with open(self.path, encoding="utf-8") as f:
                    self.data = json.load(f)
            except (OSError, ValueError):
                log.warning("import store unreadable, starting empty")

    def save(self):
        with self.lock:
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)

    # bindings: folder -> project
    def bind(self, folder: str, project: str) -> dict:
        folder = os.path.abspath(os.path.expanduser(folder))
        if not os.path.isdir(folder):
            raise ValueError(f"Папката не съществува: {folder}")
        with self.lock:
            old = self.data["bindings"].get(folder)
            # one project follows one folder: switching to another folder drops the previous one
            for f in [f for f, b in self.data["bindings"].items() if b["project"] == project and f != folder]:
                del self.data["bindings"][f]
            self.data["bindings"][folder] = {"project": project, "since": time.time(), "enabled": True}
            self.save()
        return {"folder": folder, "previous_project": old["project"] if old and old["project"] != project else None}

    def unbind(self, project: str):
        with self.lock:
            for b in self.data["bindings"].values():
                if b["project"] == project:
                    b["enabled"] = False
            self.save()

    def binding_for(self, project: str) -> tuple[str, dict] | None:
        for folder, b in self.data["bindings"].items():
            if b["project"] == project:
                return folder, b
        return None

    def owner(self, path: str) -> tuple[str, dict] | None:
        """The enabled binding whose folder contains path (the deepest one wins)."""
        best = None
        for folder, b in self.data["bindings"].items():
            if b.get("enabled") and (path == folder or path.startswith(folder.rstrip(os.sep) + os.sep)):
                if best is None or len(folder) > len(best[0]):
                    best = (folder, b)
        return best

    # queue
    @staticmethod
    def key(path: str, st: os.stat_result) -> str:
        return f"{path}|{st.st_size}|{int(st.st_mtime)}"

    def known(self, key: str) -> bool:
        return any(i["key"] == key for i in self.data["items"].values())

    def add(self, item: dict) -> dict:
        with self.lock:
            item["id"] = uuid.uuid4().hex[:12]
            self.data["items"][item["id"]] = item
            self.save()
            self.changed.notify_all()
        return item

    def wait_queue(self, project: str, seconds: float) -> list[dict]:
        """The project's queue, waiting up to `seconds` for something to arrive."""
        deadline = time.time() + max(0.0, min(seconds, 25.0))
        with self.changed:
            while not self.queue(project) and time.time() < deadline:
                self.changed.wait(deadline - time.time())
            return self.queue(project)

    def queue(self, project: str) -> list[dict]:
        return [i for i in self.data["items"].values() if i["project"] == project and i["state"] == "pending"]

    def recent(self, project: str, n: int = 8) -> list[dict]:
        items = [i for i in self.data["items"].values() if i["project"] == project and i["state"] != "pending"]
        return sorted(items, key=lambda i: i.get("done_at", 0), reverse=True)[:n]

    def result(self, item_id: str, ok: bool, note: str = "") -> dict:
        with self.lock:
            it = self.data["items"].get(item_id)
            if not it:
                raise ValueError("Няма такъв файл в опашката.")
            if ok:
                it["state"], it["done_at"] = "imported", time.time()
            else:
                it["tries"] = it.get("tries", 0) + 1
                it["note"] = note
                if it["tries"] >= 3:
                    it["state"], it["done_at"] = "failed", time.time()
            self.save()
            return it


class Watcher:
    """Watches every enabled folder and turns finished downloads into queue items."""

    def __init__(self, store: Store):
        self.store = store
        self.pending: dict[str, dict] = {}         # path -> {size, mtime, since, moved}
        self.fails: dict[str, int] = {}            # path -> unreadable attempts
        self.lock = threading.Lock()
        self.observer = None
        self.watched: dict[str, object] = {}
        self._stop = threading.Event()

    # -- watchdog wiring
    def start(self):
        from watchdog.observers import Observer
        self.observer = Observer()
        self.observer.start()
        self.refresh()
        threading.Thread(target=self._loop, name="import-check", daemon=True).start()

    def stop(self):
        self._stop.set()
        if self.observer:
            self.observer.stop()

    def refresh(self):
        """Follow the bindings: watch new enabled folders, drop disabled ones, catch up on missed files."""
        from watchdog.events import FileSystemEventHandler

        watcher = self

        class Handler(FileSystemEventHandler):
            def on_any_event(self, event):
                if event.is_directory:
                    return
                dest = getattr(event, "dest_path", None)
                if dest:                                # renamed into place: the download just finished
                    watcher.touch(os.fsdecode(dest), moved=True)
                else:
                    watcher.touch(os.fsdecode(event.src_path))

        enabled = {f for f, b in self.store.data["bindings"].items() if b.get("enabled") and os.path.isdir(f)}
        for f in list(self.watched):
            if f not in enabled:
                self.observer.unschedule(self.watched.pop(f))
        for f in enabled - set(self.watched):
            self.watched[f] = self.observer.schedule(Handler(), f, recursive=True)
            self.catch_up(f)

    def catch_up(self, folder: str):
        """Files that arrived while the engine was not running (newer than the binding)."""
        since = self.store.data["bindings"][folder]["since"]
        for root, _dirs, files in os.walk(folder):
            for n in files:
                p = os.path.join(root, n)
                try:
                    if os.path.getmtime(p) >= since - 1:
                        self.touch(p)
                except OSError:
                    pass

    def touch(self, path: str, moved: bool = False):
        if is_temp(path) or os.path.splitext(path)[1].lower() not in MEDIA:
            return
        with self.lock:
            state = self.pending.setdefault(path, {"size": -1, "mtime": -1, "since": time.time(), "moved": False})
            state["moved"] = state["moved"] or moved

    # -- completion
    def check(self, now: float | None = None):
        now = now or time.time()
        with self.lock:
            paths = list(self.pending)
        for path in paths:
            state = self.pending.get(path)
            try:
                st = os.stat(path)
            except OSError:
                self.pending.pop(path, None)            # gone (renamed by the browser): the new name comes as an event
                continue
            own = self.store.owner(path)
            if not own:
                self.pending.pop(path, None)
                continue
            folder, binding = own
            if st.st_mtime < binding["since"] - 1:     # older than switching on: not ours
                self.pending.pop(path, None)
                continue
            if temp_sibling(path) or st.st_size == 0 or st.st_size != state["size"] or st.st_mtime != state["mtime"]:
                state.update(size=st.st_size, mtime=st.st_mtime, since=now)
                continue
            if now - state["since"] < (MOVED_STABLE if state.get("moved") else STABLE_SECONDS):
                continue
            self.pending.pop(path, None)
            self._finish(path, st, folder, binding)

    def _finish(self, path: str, st: os.stat_result, folder: str, binding: dict):
        key = Store.key(path, st)
        if self.store.known(key):
            return
        try:
            with open(path, "rb") as f:
                f.read(1)
        except OSError:
            self.touch(path)                            # still locked by the writer: try again later
            return
        try:
            probe = _probe(path)
        except MediaError:
            probe = None
        ext = os.path.splitext(path)[1].lower()
        if probe is None and ext not in GRAPHIC:
            n = self.fails[path] = self.fails.get(path, 0) + 1
            if n < 10:
                self.touch(path)
                return
            self.store.add({"key": key, "path": path, "name": os.path.basename(path), "project": binding["project"],
                            "category": "OTHER", "why": "", "state": "failed", "done_at": time.time(),
                            "note": "FFprobe не може да прочете файла (повреден или непълен)."})
            return
        category, why = classify(path, folder, probe)
        item = self.store.add({"key": key, "path": path, "name": os.path.basename(path), "project": binding["project"],
                               "category": category, "why": why, "state": "pending", "found_at": time.time()})
        log.info("import: %s -> %s (%s) for %s", item["name"], category, why, os.path.basename(binding["project"]))

    def _loop(self):
        while not self._stop.wait(0.1):
            try:
                self.check()
            except Exception:
                log.exception("import check failed")
