"""Show an exported video in Finder / Explorer once the export is finished (0.10.0, the user's plan 2026-11-04).

Which folders: the folder Export mode last wrote to (Premiere keeps it in its preferences, read again whenever they
change; only the files directly in it), folders the editor added for the open project, and folders an export event showed
(learned). Not the project's own folder (0.10.5): sound effects downloaded into Assets were shown as exports, and the
office never exports there. Off by default; while it is off nothing is watched at all.

Exports go to a folder of their own (the office: Production/Exported Videos/<client>/<plan>), not next to the project,
so the preferences are the main source. They also name the export's file. Premiere wrote them when an export STARTED (2026-11-05: preferences 13:53:40, file created
13:53:46; a file of that name from before was an older export about to be replaced) and once well after one ended (12:38
export, 12:40 preferences). So a named file older than the preferences waits LATER seconds: replaced by then, the watched
folder sees the new one; unchanged, it was an export that ended before Premiere wrote them, and it counts.

What counts: a video or audio file that appeared or changed after watching started, inside a watched folder, not in
Premiere's preview / Auto-Save / Media Cache folders or Asistent's own data folder, and finished by the same rules as
Smart Folder Sync (settle.py): size and time stopped changing, the file opens, an MP4 / MOV is whole (its boxes fill the
file exactly), FFprobe reads a duration.

A queue: several exports finishing close together show only the last one, once nothing else is still being written
for QUIET seconds; the others are listed in the Log. Showing only selects the file; it is never opened, moved or renamed.
"""
from __future__ import annotations

import glob
import html
import json
import logging
import os
import re
import struct
import sys
import threading
import time
import unicodedata
import uuid

from . import config, reveal
from .importer import AUDIO, VIDEO
from .settle import Settle, is_temp, opens, probe

log = logging.getLogger("asistent")

EXPORTED = VIDEO | AUDIO
# The user, 2026-11-05: Finder came ~10 s after the export ended and was missed. An MP4 / MOV is proven whole by its boxes
# and FFprobe, so a pause in writing cannot pass for the end; the waits only need to see the size stop.
STABLE = 1.5              # size and time unchanged this long
QUIET = 1.5               # a queue: wait this long after the last finished export before showing it
SCAN_EVERY = 1.5          # network drives and some external disks send no file events: look for new files this often
SCAN_DEPTH = 2            # ... in the folder and two levels below it
MAX_TRIES = 10            # FFprobe cannot read it after this many settled checks: damaged or cancelled, never shown
RECENT = 20
LATER = 10.0              # a named file older than Premiere's preferences: this long to see whether it is being replaced
# 0.10.7: Premiere's export-complete event (the panel hears it) says an export ENDED just now. Its file was written within
# FRESH seconds before the event; the preferences may name it only a little later, so they are read again for HINT seconds.
FRESH = 60.0
HINT = 30.0
# 0.10.7: the office exports into <tree>/<client>/<plan>/. A folder that held exports of ROOT_CHILDREN different clients is
# such a tree: it is watched as a whole, so an export into a new plan folder is seen at once instead of when Premiere gets
# round to rewriting its preferences (up to ~30 s, the user 2026-11-08). Only video files exactly <client>/<plan> deep count.
# Mac only, and only through file events, never scanned: FSEvents reports only what THIS Mac writes, so a colleague's export
# on the shared drive is never shown. Windows' share notifications include other computers' writes, so no trees there.
ROOT_CHILDREN = 3
IGNORED = ("adobe premiere pro video previews", "adobe premiere pro audio previews", "adobe premiere pro auto-save",
           "media cache files", "media cache", "adobe premiere pro captured audio", "analysis files")


BOXED = (".mp4", ".mov", ".m4v", ".m4a", ".3gp")


def complete(path: str) -> bool:
    """An MP4 / MOV is whole when its top-level boxes fill the file exactly. Premiere's export: ftyp, moov, uuid, mdat
    (checked on a finished one, 2026-11-05); while it is written a box runs past the end or is open-ended (size 0)."""
    if os.path.splitext(path)[1].lower() not in BOXED:
        return True
    try:
        n = os.path.getsize(path)
        off = 0
        with open(path, "rb") as f:
            while off < n:
                f.seek(off)
                head = f.read(16)
                if len(head) < 8:
                    return False
                size = struct.unpack(">I", head[:4])[0]
                if size == 1:
                    if len(head) < 16:
                        return False
                    size = struct.unpack(">Q", head[8:16])[0]
                if size < 8:
                    return False
                off += size
        return off == n
    except OSError:
        return False


def prefs_files() -> list[str]:
    """Premiere's preference files, every installed version (Documents/Adobe/Premiere Pro/<version>/Profile-<user>/)."""
    docs = os.path.join(os.environ.get("USERPROFILE") or os.path.expanduser("~"), "Documents")
    return glob.glob(os.path.join(docs, "Adobe", "Premiere Pro", "*", "Profile-*", "Adobe Premiere Pro Prefs"))


def read_prefs(text: str) -> dict:
    """{"file": the last Export mode output or None, "folders": [where Export mode writes]} from the preferences text."""
    out, folders = None, []
    m = re.search(r"<ExportSettings\.Info\.SaveAsFile>(.*?)</ExportSettings\.Info\.SaveAsFile>", text, re.S)
    if m:
        try:
            out = json.loads(html.unescape(m.group(1).strip())).get("OutPath") or None
        except ValueError:
            out = None
    if out:
        out = os.path.normpath(out)
        folders.append(os.path.dirname(out))
    m = re.search(r"<MZ\.Prefs\.Export\.Media\.Path>(.*?)</MZ\.Prefs\.Export\.Media\.Path>", text, re.S)
    if m and m.group(1).strip():
        folders.append(os.path.normpath(html.unescape(m.group(1).strip())))
    return {"file": out, "folders": list(dict.fromkeys(folders))}


class PremierePrefs:
    """Where Export mode writes, from the preferences of the Premiere used last (the newest file); read again only when
    that file changes (Premiere rewrites it now and then, not at a set moment)."""

    def __init__(self, files=None):
        self.files = files or prefs_files
        self.stamp = None
        self.state = {"file": None, "folders": []}

    def read(self) -> tuple[dict, bool]:
        """(state, changed since the last read)."""
        try:
            paths = [(os.stat(p), p) for p in self.files()]
        except OSError:
            paths = []
        if not paths:
            return self.state, False
        st, path = max(paths, key=lambda x: x[0].st_mtime)
        stamp = (path, st.st_mtime, st.st_size)
        if stamp == self.stamp:
            return self.state, False
        self.stamp = stamp
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                new = read_prefs(f.read())
        except OSError:
            return self.state, False
        changed = new != self.state
        self.state = new
        return new, changed

    def folders(self) -> list[dict]:
        return [{"path": f, "why": "premiere"} for f in self.state["folders"] if os.path.isdir(f)]


def app_name() -> str:
    return "Explorer" if sys.platform == "win32" else "Finder"


def ignored(path: str) -> bool:
    if is_temp(path) or os.path.splitext(path)[1].lower() not in EXPORTED:
        return True
    parts = {p.lower() for p in os.path.normpath(path).split(os.sep)}
    if any(p in parts for p in IGNORED):
        return True
    own = os.path.normpath(config.app_dir())
    return path == own or path.startswith(own + os.sep)


def same(path: str) -> str:
    """A path as the Mac and Windows file systems compare it: case and Unicode form do not matter (the preferences say
    „Екопак“, a file event may spell the folder as it is on the drive)."""
    return unicodedata.normalize("NFC", path).casefold()


def inside(path: str, folder: str) -> bool:
    path, folder = same(path), same(folder)
    return path == folder or path.startswith(folder.rstrip(os.sep) + os.sep)


class Settings:
    """exports.json in the engine data folder (outside the vault): on/off, the last project, its folders, recent exports."""

    def __init__(self, path: str | None = None):
        self.path = path or os.path.join(config.app_dir(), "exports.json")
        self.lock = threading.RLock()
        self.data = {"enabled": False, "project": "", "projects": {}, "recent": [], "roots": []}
        if os.path.isfile(self.path):
            try:
                with open(self.path, encoding="utf-8") as f:
                    self.data.update(json.load(f))
            except (OSError, ValueError):
                log.warning("exports settings unreadable, starting empty")

    def save(self):
        with self.lock:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)

    def _project(self, project: str) -> dict:
        return self.data["projects"].setdefault(project, {"added": [], "learned": []})

    def folders(self, project: str | None = None) -> list[dict]:
        """[{path, why}] for the project: added, learned; each folder once, existing ones only."""
        project = self.data["project"] if project is None else project
        if not project:
            return []
        p = self.data["projects"].get(project, {})
        out, seen = [], set()
        for path, why in [(f, "added") for f in p.get("added", [])] + \
                [(f, "learned") for f in p.get("learned", [])]:
            path = os.path.normpath(path)
            if path not in seen and os.path.isdir(path):
                seen.add(path)
                out.append({"path": path, "why": why})
        return out

    def add(self, project: str, folder: str, why: str = "added") -> bool:
        folder = os.path.normpath(os.path.abspath(os.path.expanduser(folder)))
        if not os.path.isdir(folder):
            raise ValueError(f"The folder does not exist: {folder}")
        with self.lock:
            p = self._project(project)
            if folder in p["added"] or folder in p["learned"]:
                return False
            p[why].append(folder)
            self.save()
            return True

    def remove(self, project: str, folder: str):
        folder = os.path.normpath(folder)
        with self.lock:
            p = self._project(project)
            for k in ("added", "learned"):
                p[k] = [f for f in p[k] if f != folder]
            self.save()

    def remember(self, item: dict):
        with self.lock:
            self.data["recent"] = ([item] + [i for i in self.data["recent"] if i["id"] != item["id"]])[:RECENT]
            self.save()

    def item(self, item_id: str) -> dict | None:
        return next((i for i in self.data["recent"] if i["id"] == item_id), None)

    def learn_roots(self, extra: list[str] = ()) -> bool:
        """Export trees from the folders exports were seen in (the recent list and Premiere's export folder): a folder
        whose children held exports of ROOT_CHILDREN different clients. Kept once learned (the recent list is short)."""
        if sys.platform == "win32":
            return False
        kids: dict[str, set] = {}
        for folder in [i.get("folder") or "" for i in self.data["recent"]] + list(extra):
            folder = os.path.normpath(folder) if folder else ""
            root = os.path.dirname(os.path.dirname(folder))
            # never a whole drive (raw footage copied into Production/<client>/<plan> would count) or the home folder
            if not folder or root == os.path.dirname(root) or os.path.ismount(root) or \
                    same(root) == same(os.path.expanduser("~")):
                continue
            kids.setdefault(root, set()).add(same(os.path.basename(os.path.dirname(folder))))
        with self.lock:
            roots = self.data.setdefault("roots", [])
            new = [r for r, k in kids.items() if len(k) >= ROOT_CHILDREN and r not in roots]
            if new:
                roots.extend(new)
                self.save()
                log.info("exports: export tree learned: %s", ", ".join(new))
            return bool(new)

    def roots(self) -> list[dict]:
        if sys.platform == "win32":
            return []
        return [{"path": r, "why": "tree"} for r in self.data.get("roots", []) if os.path.isdir(r)]


class ExportWatcher:
    def __init__(self, settings: Settings, show=reveal.reveal, premiere: PremierePrefs | None = None):
        self.settings = settings
        self.show = show
        self.premiere = premiere or PremierePrefs()
        self.started = time.time()                  # when watching was switched on
        self.settle = Settle(stable=STABLE)
        self.fails: dict[str, int] = {}
        self.retry: dict[str, float] = {}            # path -> when to ask FFprobe again (the index is written last)
        self.confirmed: set[str] = set()            # paths an export event named
        self.since: dict[str, float] = {}           # folder -> when watching it started
        self.flat: set[str] = set()                 # folders watched without their subfolders (Premiere's export folder)
        self.trees: set[str] = set()                # export trees: <tree>/<client>/<plan>/file, file events only
        self.known: set[str] = set()                # path|size|mtime already counted
        self.batch: list[dict] = []                 # finished, not shown yet
        self.last_done = 0.0
        self.last_scan = 0.0
        self.later: dict[str, tuple[float, float]] = {}   # path -> (its mtime when the preferences named it, when to decide)
        self.hint_at = 0.0                          # when Premiere last said an export ended (0: never)
        self.last_follow = 0.0
        self.lock = threading.RLock()
        self.observer = None
        self.watched: dict[str, object] = {}
        self._stop: threading.Event | None = None

    # -- settings from the panel
    def configure(self, project: str | None = None, enabled: bool | None = None, add: str | None = None,
                  remove: str | None = None) -> dict:
        s = self.settings
        with s.lock:
            if project:
                s.data["project"] = project
            if enabled is not None:
                s.data["enabled"] = bool(enabled)
            if add:
                if not s.data["project"]:
                    raise ValueError("No project open.")
                s.add(s.data["project"], add)
            if remove and s.data["project"]:
                s.remove(s.data["project"], remove)
            s.save()
        self.refresh()
        return self.status()

    def folders(self) -> list[dict]:
        """Premiere's export folder first, then the project's, added and learned ones; each folder once."""
        out, seen = [], set()
        for f in self.premiere.folders() + self.settings.folders() + self.settings.roots():
            if f["path"] not in seen:
                seen.add(f["path"])
                out.append(f)
        return out

    def status(self) -> dict:
        d = self.settings.data
        return {"enabled": bool(d["enabled"]), "project": d["project"], "folders": self.folders(),
                "app": app_name(), "watching": sorted(self.watched) if self.observer else []}

    def recent(self) -> list[dict]:
        return list(self.settings.data["recent"])

    # -- watching
    def refresh(self):
        """Start, stop or re-aim the watching to follow the settings and the folders that exist now. While the setting is
        on the checker keeps running even with no folder to watch: the office drive is mounted after the engine starts at
        login (0.10.7: nothing was watched until the editor switched projects), and it comes and goes with sleep."""
        with self.lock:
            if not self.settings.data["enabled"]:
                self._halt()
                return
            if self.observer is None:
                self.started = time.time()
                self.premiere.read()                       # the export folder before the first export
                self._begin()
            self.settings.learn_roots(self.premiere.state["folders"])
            folders = self.folders()
            want = {f["path"] for f in folders}
            flat = {f["path"] for f in folders if f["why"] == "premiere"}
            self.trees = {f["path"] for f in folders if f["why"] == "tree"}
            before = set(self.watched)
            for f in list(self.watched):
                if f not in want or (f in flat) != (f in self.flat):
                    w = self.watched.pop(f)
                    if w is not None:
                        try:
                            self.observer.unschedule(w)
                        except Exception:                  # its drive is gone: the stream is gone with it
                            pass
                    self.since.pop(f, None)
            self.flat = flat
            for f in want - set(self.watched):
                self.since[f] = time.time()
                try:
                    self.watched[f] = self.observer.schedule(self._handler(), f, recursive=f not in flat)
                except OSError:
                    log.warning("exports: cannot watch %s, only looking every %.0f s", f, SCAN_EVERY)
                    self.watched[f] = None
            if set(self.watched) != before or not before:
                log.info("exports: watching %s", ", ".join(sorted(self.watched)) or "nothing yet (no export folder found)")

    def follow(self, now: float | None = None):
        """Every SCAN_EVERY: a folder appeared (a drive mounted) or went away: watch what exists now."""
        now = now or time.time()
        if now - self.last_follow < SCAN_EVERY:
            return
        self.last_follow = now
        if {f["path"] for f in self.folders()} != set(self.watched):
            self.refresh()

    def _begin(self):
        from watchdog.observers import Observer
        self.observer = Observer()
        self.observer.start()
        self._stop = threading.Event()
        threading.Thread(target=self._loop, args=(self._stop,), name="exports-check", daemon=True).start()

    def _halt(self):
        if self.observer is not None:
            self._stop.set()
            self.observer.stop()
            self.observer = None
            log.info("exports: not watching")
        self.watched.clear()
        self.since.clear()
        self.flat = set()
        self.trees = set()
        self.settle = Settle(stable=STABLE)
        self.batch.clear()
        self.retry.clear()
        self.confirmed.clear()
        self.later.clear()
        self.hint_at = 0.0

    def _handler(self):
        from watchdog.events import FileSystemEventHandler
        watcher = self

        class Handler(FileSystemEventHandler):
            def on_any_event(self, event):
                if event.is_directory or event.event_type in ("deleted", "opened", "closed_no_write"):
                    return
                dest = getattr(event, "dest_path", None)
                watcher.touch(os.fsdecode(dest or event.src_path), moved=bool(dest))
        return Handler()

    def touch(self, path: str, moved: bool = False):
        if path in self.retry:                            # already waiting for a direct check (an event named it)
            return
        if not ignored(path) and self._folder(path):
            self.settle.touch(path, moved)

    def _folder(self, path: str) -> str | None:
        best = None
        for f in list(self.since):
            if f in self.flat:
                ok = same(os.path.dirname(path)) == same(f)
            elif f in self.trees:
                ok = same(os.path.dirname(os.path.dirname(os.path.dirname(path)))) == same(f) and \
                    os.path.splitext(path)[1].lower() in VIDEO
            else:
                ok = inside(path, f)
            if ok and (best is None or len(f) > len(best)):
                best = f
        return best

    def scan(self):
        """Files the file events missed (network drives): new ones near the top of each watched folder."""
        for folder, since in list(self.since.items()):
            if folder in self.trees:                      # file events only: a scan would see a colleague's export
                continue
            deepest = 0 if folder in self.flat else SCAN_DEPTH
            stack = [(folder, 0)]
            while stack:
                d, depth = stack.pop()
                try:
                    entries = list(os.scandir(d))
                except OSError:
                    continue
                for e in entries:
                    try:
                        if e.is_dir(follow_symlinks=False):
                            if depth < deepest and e.name.lower() not in IGNORED:
                                stack.append((e.path, depth + 1))
                        elif os.path.splitext(e.name)[1].lower() in EXPORTED and e.path not in self.settle:
                            st = e.stat()
                            if st.st_mtime >= since - 1 and f"{e.path}|{st.st_size}|{int(st.st_mtime)}" not in self.known:
                                self.touch(e.path)
                    except OSError:
                        continue

    # -- finishing
    def check(self, now: float | None = None):
        now = now or time.time()
        if now - self.last_scan >= (0.5 if self._hinted(now) else SCAN_EVERY):
            self.last_scan = now
            self.from_prefs(now)
            self.scan()
        self._decide_later(now)

        def keep(path, st):
            if path in self.confirmed:
                return True
            f = self._folder(path)
            return bool(f) and st.st_mtime >= self.since.get(f, now) - 1      # older than watching: not a new export
        for path, st in self.settle.ready(now, keep):
            self._finished(path, st, now)
        for path, due in list(self.retry.items()):
            if now >= due and path not in self.settle:
                del self.retry[path]
                try:
                    self._finished(path, os.stat(path), now)
                except OSError:
                    self.fails.pop(path, None)
        self._maybe_show(now)

    def from_prefs(self, now: float | None = None):
        """Premiere rewrote its preferences: watch the export folder they name now, and check the file they name when it
        was written after watching started (an export into a folder nobody watched yet)."""
        if not self.settings.data["enabled"]:
            return
        now = now or time.time()
        hinted = self._hinted(now)
        if hinted:
            self.premiere.stamp = None                            # read them again even if their time did not change
        state, changed = self.premiere.read()
        if not changed and not hinted:
            return
        if {f["path"] for f in self.folders()} != set(self.since):
            self.refresh()
        path = state["file"]
        written = (self.premiere.stamp or (None, 0))[1]           # when Premiere wrote them
        try:
            st = os.stat(path) if path and not ignored(path) else None
        except OSError:
            st = None                                             # not written yet: the watched folder will see it
        mtime = st.st_mtime if st else None
        if mtime is None or mtime < self.started - 1 or path in self.confirmed or \
                f"{path}|{st.st_size}|{int(mtime)}" in self.known:
            return
        if mtime >= written - 1 or self._fresh(mtime, now):
            self.later.pop(path, None)
            self._named(path, now)
        elif changed:
            self.later[path] = (mtime, now + LATER)

    def _hinted(self, now: float) -> bool:
        return bool(self.hint_at) and now - self.hint_at < HINT

    def _fresh(self, mtime: float, now: float) -> bool:
        """Written just before Premiere said an export ended: it is that export, whatever the preferences' time says."""
        return self._hinted(now) and mtime >= self.hint_at - FRESH

    def _named(self, path: str, now: float | None = None):
        log.info("exports: Premiere's preferences name %s", os.path.basename(path))
        self.confirmed.add(path)
        now = now or time.time()
        try:
            fresh = self._fresh(os.stat(path).st_mtime, now)
        except OSError:
            fresh = False
        if fresh:                                         # the export has ended: check it now, no settling wait
            self.settle.drop(path)
            self.retry[path] = now
        else:
            self.settle.touch(path)

    def _decide_later(self, now: float):
        for path, (mtime, due) in list(self.later.items()):
            if now < due and not self._fresh(mtime, now):
                continue
            del self.later[path]
            try:
                same = os.stat(path).st_mtime == mtime
            except OSError:
                same = False
            if same:                                              # not replaced: an export that ended before the preferences
                self._named(path, now)

    def _finished(self, path: str, st: os.stat_result, now: float):
        key = f"{path}|{st.st_size}|{int(st.st_mtime)}"
        if key in self.known:
            self.confirmed.discard(path)
            return
        how = "event" if path in self.confirmed else "watcher"
        info = probe(path) if opens(path) and complete(path) else None
        try:
            duration = float(((info or {}).get("format") or {}).get("duration") or 0)
        except ValueError:
            duration = 0.0
        if duration <= 0:
            n = self.fails[path] = self.fails.get(path, 0) + 1
            if n < MAX_TRIES:
                self.retry[path] = now + STABLE         # the index is written last: look again
            else:
                self.confirmed.discard(path)
                log.info("exports: %s never became readable (cancelled or damaged): not shown", os.path.basename(path))
            return
        self.fails.pop(path, None)
        self.confirmed.discard(path)
        self.known.add(key)
        self.batch.append({"id": uuid.uuid4().hex[:12], "path": path, "name": os.path.basename(path),
                           "folder": os.path.dirname(path), "at": now, "how": how, "shown": False,
                           "project": self.settings.data["project"]})
        # Premiere said this export ended: show it now (QUIET only waits for the rest of a queue, and busy() still does)
        self.last_done = now - QUIET if how == "event" and self._hinted(now) else now
        log.info("exports: finished %s (%s)", os.path.basename(path), how)

    def busy(self, now: float) -> bool:
        """Another export is still being written (it changed within QUIET seconds)."""
        return any(now - s["since"] < QUIET and s["size"] > 0 for s in list(self.settle.pending.values()))

    def _maybe_show(self, now: float):
        if not self.batch or now - self.last_done < QUIET or self.busy(now):
            return
        batch, self.batch = self.batch, []
        last = batch[-1]
        for it in batch[:-1]:
            it["note"] = "in a queue: the last export was shown"
            self.settings.remember(it)
        try:
            self.show(last["path"])
            last["shown"] = True
            last["note"] = f"shown in {app_name()}"
        except Exception as e:                          # gone already, or no Finder: the Log still lists it
            last["note"] = f"could not be shown: {e}"
            log.warning("exports: reveal %s failed: %s", last["path"], e)
        self.settings.remember(last)
        if self.settings.learn_roots():
            self.refresh()

    def done(self, path: str | None = None, kind: str = "complete", source: str = "") -> dict:
        """An export event from the panel or the host: Premiere says an export ended. With a path, that file is checked at
        once (it must exist and be finished) and its folder is learned for the project. Without one (Premiere's events
        may not carry it) the preferences are read again and the file they name counts at once when it was written just
        before the event; the watched folders are looked at again too."""
        log.info("exports: event %s from %s: %s", kind, source or "?", path or "(no path)")
        if kind != "complete" or not self.settings.data["enabled"]:
            return {"ok": True, "counted": False}
        now = time.time()
        with self.lock:
            self.hint_at = now
            self.last_scan = 0.0                          # read the preferences and look in the folders on the next check
            for p, (mtime, _) in list(self.later.items()):
                if self._fresh(mtime, now):
                    self.later[p] = (mtime, now)
        if not path:
            return {"ok": True, "counted": False, "hint": True}
        path = os.path.normpath(path)
        if ignored(path) or not os.path.isfile(path):
            return {"ok": True, "counted": False, "hint": True}
        folder = os.path.dirname(path)
        project = self.settings.data["project"]
        if project and not self._folder(path):
            self.settings.add(project, folder, "learned")
            self.refresh()
        self.confirmed.add(path)
        self.settle.drop(path)
        self.retry[path] = now
        return {"ok": True, "counted": True}

    def again(self, item_id: str) -> dict:
        """Show an earlier export again (from the Log). Only files this watcher recorded: never a path a request sends."""
        it = self.settings.item(item_id)
        if not it:
            raise ValueError("No such export.")
        try:
            self.show(it["path"])
        except FileNotFoundError:
            raise ValueError(f"{it['name']} is not there any more (moved or deleted).") from None
        return {"ok": True, "app": app_name()}

    def _loop(self, stop: threading.Event):
        while not stop.wait(0.25):
            try:
                self.follow()
                self.check()
            except Exception:
                log.exception("exports check failed")
