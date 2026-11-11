"""Test bridge: lets a developer (Claude Code) drive the panel in the user's TEST.prproj through the engine.

Off unless the file `devbridge.enabled` exists in the app folder. The panel long-polls `GET /dev/poll`, runs the
command it gets (`ping`, `state`, `selection`, `click`, ...) and posts the answer to `POST /dev/result`; the
developer sends `POST /dev/command` and reads `GET /dev/result?id=`. The panel itself refuses every command
unless the open project is TEST.prproj (the user's rule: Premiere tests only there). Same localhost-only,
`X-Asistent` header protection as every other endpoint; commands and answers are logged.
"""
from __future__ import annotations

import collections
import os
import threading
import time
import uuid

import logging

from . import config

log = logging.getLogger("asistent")

FLAG = "devbridge.enabled"
KEEP = 50                      # answers kept for reading


def enabled() -> bool:
    return os.path.isfile(os.path.join(config.app_dir(), FLAG))


class Bridge:
    """Commands for the other side (the panel or the CEP host) with a lifecycle (0.10.6, ARCH-001): queued -> taken -> done.
    A command whose waiter gave up while it was still queued is withdrawn and never runs; one that was already taken may
    still finish (Premiere is busy, not dead): its late answer is logged and the waiter was told so."""

    def __init__(self):
        self._cv = threading.Condition()
        self._queue: collections.deque = collections.deque()
        self._results: collections.OrderedDict = collections.OrderedDict()
        self._taken: dict = {}                  # id -> time the other side took it
        self._abandoned: set = set()            # ids whose waiter gave up after they were taken

    def submit(self, name: str, args: dict | None = None, deadline: float | None = None, lane: str = "") -> str:
        """lane (0.10.45): which Premiere may take it. Two Premiere versions can run side by side (the user edits in one
        while Claude tests in the other); each panel and host says its Premiere's major version, and a command goes only to
        the side of the Premiere it came from. Clients from before 0.10.45 say nothing: lane ""."""
        if not isinstance(name, str) or not name or len(name) > 40:
            raise ValueError("Invalid command.")
        cid = uuid.uuid4().hex[:12]
        with self._cv:
            self._queue.append({"id": cid, "name": name, "args": args or {}, "_deadline": deadline, "_lane": lane or ""})
            self._cv.notify_all()
        return cid

    def poll(self, wait: float, lane: str = "") -> dict | None:
        """The next command of this lane, or None after `wait` seconds. Commands past their deadline are dropped."""
        end = time.time() + max(0.0, min(wait, 25.0))
        with self._cv:
            while True:
                for old in [c for c in self._queue if c.get("_deadline") and c["_deadline"] < time.time()]:
                    self._queue.remove(old)
                    log.warning("bridge: %s %s expired before it was taken: never run", old["name"], old["id"])
                cmd = next((c for c in self._queue if c.get("_lane", "") == (lane or "")), None)
                if cmd:
                    self._queue.remove(cmd)
                    self._taken[cmd["id"]] = time.time()
                    return {k: v for k, v in cmd.items() if not k.startswith("_")}
                left = end - time.time()
                if left <= 0:
                    return None
                self._cv.wait(left)

    def result(self, cid: str, ok: bool, data) -> None:
        with self._cv:
            self._taken.pop(cid, None)
            if cid in self._abandoned:
                self._abandoned.discard(cid)
                log.warning("bridge: a late answer for %s (the waiter had given up): ok=%s %s", cid, ok, str(data)[:300])
            self._results[cid] = {"id": cid, "ok": bool(ok), "data": data, "at": time.time()}
            while len(self._results) > KEEP:
                self._results.popitem(last=False)
            self._cv.notify_all()

    def wait_result(self, cid: str, wait: float) -> dict | None:
        end = time.time() + max(0.0, min(wait, 600.0))
        with self._cv:
            while cid not in self._results:
                left = end - time.time()
                if left <= 0:
                    return None
                self._cv.wait(left)
            return self._results[cid]

    def give_up(self, cid: str) -> str:
        """The waiter stops waiting -> "withdrawn" (it was still queued: it never runs) or "running" (already taken: it may
        still finish; its answer is logged when it comes) or "done" (the answer arrived meanwhile)."""
        with self._cv:
            if cid in self._results:
                return "done"
            for cmd in list(self._queue):
                if cmd["id"] == cid:
                    self._queue.remove(cmd)
                    return "withdrawn"
            self._abandoned.add(cid)
            return "running"
