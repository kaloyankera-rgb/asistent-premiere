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

from . import config

FLAG = "devbridge.enabled"
KEEP = 50                      # answers kept for reading


def enabled() -> bool:
    return os.path.isfile(os.path.join(config.app_dir(), FLAG))


class Bridge:
    def __init__(self):
        self._cv = threading.Condition()
        self._queue: collections.deque = collections.deque()
        self._results: collections.OrderedDict = collections.OrderedDict()

    def submit(self, name: str, args: dict | None = None) -> str:
        if not isinstance(name, str) or not name or len(name) > 40:
            raise ValueError("Invalid command.")
        cid = uuid.uuid4().hex[:12]
        with self._cv:
            self._queue.append({"id": cid, "name": name, "args": args or {}})
            self._cv.notify_all()
        return cid

    def poll(self, wait: float) -> dict | None:
        """The next command for the panel, or None after `wait` seconds."""
        end = time.time() + max(0.0, min(wait, 25.0))
        with self._cv:
            while not self._queue:
                left = end - time.time()
                if left <= 0:
                    return None
                self._cv.wait(left)
            return self._queue.popleft()

    def result(self, cid: str, ok: bool, data) -> None:
        with self._cv:
            self._results[cid] = {"id": cid, "ok": bool(ok), "data": data, "at": time.time()}
            while len(self._results) > KEEP:
                self._results.popitem(last=False)
            self._cv.notify_all()

    def wait_result(self, cid: str, wait: float) -> dict | None:
        end = time.time() + max(0.0, min(wait, 120.0))
        with self._cv:
            while cid not in self._results:
                left = end - time.time()
                if left <= 0:
                    return None
                self._cv.wait(left)
            return self._results[cid]
