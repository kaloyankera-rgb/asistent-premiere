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
from .media import MediaError
from .settle import MOVED_STABLE, STABLE_SECONDS, TEMP_SUFFIXES, Settle, is_temp, opens, temp_sibling  # noqa: F401
from .settle import probe as _probe

log = logging.getLogger("asistent")

AUDIO = {".wav", ".mp3", ".aif", ".aiff", ".m4a", ".flac", ".ogg", ".aac", ".opus"}
VIDEO = {".mp4", ".mov", ".mxf", ".m4v", ".avi", ".mkv", ".webm", ".mts", ".m2ts"}
IMAGE = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".heic", ".bmp", ".gif"}
GRAPHIC = {".psd", ".ai", ".svg", ".eps"}
MEDIA = AUDIO | VIDEO | IMAGE | GRAPHIC
CATEGORIES = ("MUSIC", "SFX", "BROLL", "IMAGES", "GRAPHICS", "OTHER")

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


def classify(path: str, folder_root: str | None = None, probe: dict | None = None) -> tuple[str, str]:
    """(category, reason). OTHER when it cannot be told with confidence."""
    ext = os.path.splitext(path)[1].lower()
    rel = os.path.relpath(path, folder_root) if folder_root else os.path.basename(path)
    parts = [p.lower() for p in rel.replace("\\", "/").split("/")[:-1]]
    for p in reversed(parts):                                   # 1. the folder it was saved into
        if p in FOLDER_CATEGORY:
            return FOLDER_CATEGORY[p], f"folder \"{p}\""
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
            return "SFX", "the name suggests a sound effect"
        if music and not sfx:
            return "MUSIC", "the name suggests music"
        if duration is not None and duration <= 8:
            return "SFX", f"short sound ({duration:.1f} s)"
        if duration is not None and duration >= 60 and (tagged or " - " in os.path.basename(path)):
            return "MUSIC", f"long recording ({duration:.0f} s) with an artist"
        if duration is not None and duration >= 90:
            return "MUSIC", f"long recording ({duration:.0f} s)"
        return "OTHER", "unclear whether it is music or an effect"
    if ext in VIDEO:
        if alpha or GRAPHIC_WORDS.search(text):
            return "GRAPHICS", "video with transparency" if alpha else "the name suggests a graphic"
        return "BROLL", "video"
    if ext in IMAGE:
        return ("GRAPHICS", "the name suggests a graphic") if GRAPHIC_WORDS.search(text) else ("IMAGES", "image")
    if ext in GRAPHIC:
        return "GRAPHICS", "graphics file"
    return "OTHER", "unknown type"


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
            raise ValueError(f"The folder does not exist: {folder}")
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
                raise ValueError("No such file in the queue.")
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
        self.settle = Settle()
        self.fails: dict[str, int] = {}            # path -> unreadable attempts
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
        self.settle.touch(path, moved)

    # -- completion
    def check(self, now: float | None = None):
        owners = {}

        def keep(path, st):
            own = owners[path] = self.store.owner(path)
            return bool(own) and st.st_mtime >= own[1]["since"] - 1      # older than switching on: not ours
        for path, st in self.settle.ready(now, keep):
            self._finish(path, st, *owners[path])

    def _finish(self, path: str, st: os.stat_result, folder: str, binding: dict):
        key = Store.key(path, st)
        if self.store.known(key):
            return
        if not opens(path):
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
                            "note": "FFprobe cannot read the file (damaged or incomplete)."})
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
