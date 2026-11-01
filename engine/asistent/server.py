"""Local HTTP API for the Premiere panel. Listens on 127.0.0.1 only.

Requests must carry the header `X-Asistent: 1`. A web page cannot add a custom header to a request to
another origin without a CORS preflight, which this server never approves, so a browser tab cannot
drive the engine. The Host header is checked against DNS rebinding.

  GET  /status               engine version and busy state
  POST /sync                 {"paths": [...], "reference": null|int} -> {"job": id}
  POST /sync_groups          {"paths": [...]} -> {"job": id}; groups among all clips (timeline selection)
  POST /audio                {"items": [{"path", "start", "end", "force"?}], "force"?, "target"?, "ceiling"?,
                              "phrases"?: true -> Volume keyframes that even out phrases}
  GET  /jobs/<id>            state, progress, message, result
  POST /jobs/<id>/cancel
  POST /log                  {"level": "info"|"error", "message": "..."} panel messages into the engine log
  GET  /import/status?project=P[&wait=s]   folder, queue, last imports; wait: return as soon as a file is ready
  POST /import/bind          {"project", "folder"?}  switch on (default folder: ~/Downloads)
  POST /import/unbind        {"project"}
  POST /import/result        {"id", "ok", "note"?}   the panel reports each import
"""
from __future__ import annotations

import json
import logging
import os
import re
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from . import config
from .jobs import JobManager
from .audio import analyze_items
from .groups import sync_groups
from .importer import Store, Watcher
from .sync import sync_clips

log = logging.getLogger("asistent")
JOBS = JobManager()
STORE: Store | None = None
WATCHER: Watcher | None = None


def _store() -> Store:
    global STORE
    if STORE is None:
        STORE = Store()
    return STORE


def _import_status(project: str) -> dict:
    st = _store()
    b = st.binding_for(project)
    folder, binding = b if b else (None, None)
    pending = [{k: i[k] for k in ("id", "path", "name", "category", "why")} for i in st.queue(project)]
    recent = [{k: i.get(k) for k in ("name", "category", "state", "note", "done_at")} for i in st.recent(project)]
    return {"folder": folder, "enabled": bool(binding and binding.get("enabled")), "pending": pending,
            "recent": recent, "watching": bool(WATCHER)}
_ALLOWED_HOSTS = {f"{config.HOST}:{config.PORT}", f"localhost:{config.PORT}"}


def _start_sync(body: dict) -> dict:
    paths = body.get("paths") or []
    if not isinstance(paths, list) or len(paths) < 2 or not all(isinstance(p, str) for p in paths):
        raise ValueError("Избери поне два клипа с аудио.")
    missing = [p for p in paths if not os.path.isfile(p)]
    if missing:
        raise ValueError("Файлът липсва (офлайн медия?): " + ", ".join(os.path.basename(p) for p in missing))
    ref = body.get("reference")
    ref = int(ref) if isinstance(ref, int) and 0 <= ref < len(paths) else None

    def work(job):
        def progress(f, msg):
            job.progress, job.message = f, msg
        log.info("sync %d clips: %s", len(paths), [os.path.basename(p) for p in paths])
        res = sync_clips(paths, reference=ref, progress=progress, cancel=lambda: job.cancelled)
        log.info("sync result: %s", [(c["name"], c["confidence"], c.get("offset")) for c in res["clips"]])
        return res

    return {"job": JOBS.submit("sync", work).id}


def _start_groups(body: dict) -> dict:
    paths = body.get("paths") or []
    if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths) or len(set(paths)) < 2:
        raise ValueError("Маркирай поне два различни клипа в таймлайна.")
    missing = [p for p in paths if not os.path.isfile(p)]
    if missing:
        raise ValueError("Файлът липсва (офлайн медия?): " + ", ".join(os.path.basename(p) for p in missing))

    def work(job):
        def progress(f, msg):
            job.progress, job.message = f, msg
        log.info("sync_groups %d clips", len(set(paths)))
        res = sync_groups(paths, progress=progress, cancel=lambda: job.cancelled)
        log.info("sync_groups: %d groups %s, %d unsynced, %d conflicts, %d pairs",
                 len(res["groups"]), [len(g["members"]) for g in res["groups"]], len(res["unsynced"]),
                 len(res["conflicts"]), res["pairs_checked"])
        return res

    return {"job": JOBS.submit("sync_groups", work).id}


ACTIONS = {None, "use_left", "use_right", "split", "none"}


def _start_audio(body: dict) -> dict:
    items = body.get("items") or []
    if not isinstance(items, list) or not items or not all(isinstance(i, dict) and isinstance(i.get("path"), str)
                                                           for i in items):
        raise ValueError("Маркирай поне един клип със звук в таймлайна.")
    if body.get("force") not in ACTIONS or any(i.get("force") not in ACTIONS for i in items):
        raise ValueError("Невалидно действие.")
    missing = sorted({os.path.basename(i["path"]) for i in items if not os.path.isfile(i["path"])})
    if missing:
        raise ValueError("Файлът липсва (офлайн медия?): " + ", ".join(missing))
    target = float(body.get("target", -17.0))
    ceiling = float(body.get("ceiling", -6.0))

    def work(job):
        def progress(f, msg):
            job.progress, job.message = f, msg
        res = analyze_items(items, body.get("force"), target, ceiling, progress, lambda: job.cancelled,
                            phrases=bool(body.get("phrases")))
        log.info("audio: %s", [(r["name"], r.get("kind"), r.get("action"),
                                [o.get("gain_db") for o in r.get("outputs", [])]) for r in res["items"]])
        return res

    return {"job": JOBS.submit("audio", work).id}


class Handler(BaseHTTPRequestHandler):
    server_version = f"Asistent/{config.VERSION}"

    def log_message(self, fmt, *args):  # quiet: the job log is enough
        pass

    def _send(self, code: int, payload: dict):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _allowed(self) -> bool:
        host, origin = self.headers.get("Host", ""), self.headers.get("Origin", "")
        reason = None
        if host not in _ALLOWED_HOSTS:
            reason = "host"
        elif self.headers.get("X-Asistent") != "1":
            reason = "header"
        elif origin.startswith(("http://", "https://")):
            reason = "origin"
        if reason:
            log.warning("rejected %s %s (%s): host=%r origin=%r ua=%r", self.command, self.path, reason, host,
                        origin, self.headers.get("User-Agent", ""))
        return reason is None

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1_000_000:
            raise ValueError("Заявката е твърде голяма.")
        raw = self.rfile.read(n) if n else b"{}"
        data = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(data, dict):
            raise ValueError("Невалидна заявка.")
        return data

    def do_OPTIONS(self):
        self.send_response(403)
        self.end_headers()

    def do_GET(self):
        if not self._allowed():
            return self._send(403, {"error": "forbidden"})
        url = urlparse(self.path)
        if url.path == "/import/status":
            q = parse_qs(url.query)
            project = (q.get("project") or [""])[0]
            if not project:
                return self._send(400, {"error": "Няма проект."})
            wait = float((q.get("wait") or ["0"])[0] or 0)
            if wait > 0:                       # long poll: answer as soon as a file is ready for this project
                _store().wait_queue(project, wait)
            return self._send(200, _import_status(project))
        if self.path == "/status":
            return self._send(200, {"ok": True, "app": "asistent", "version": config.VERSION,
                                    "busy": JOBS.active(), "platform": sys.platform})
        m = re.fullmatch(r"/jobs/([0-9a-f]{12})", self.path)
        if m:
            job = JOBS.get(m.group(1))
            return self._send(200, job.to_dict()) if job else self._send(404, {"error": "Няма такава задача."})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._allowed():
            return self._send(403, {"error": "forbidden"})
        try:
            body = self._body()
            if self.path == "/sync":
                return self._send(200, _start_sync(body))
            if self.path == "/sync_groups":
                return self._send(200, _start_groups(body))
            if self.path == "/audio":
                return self._send(200, _start_audio(body))
            if self.path == "/import/bind":
                project = body.get("project")
                if not isinstance(project, str) or not project:
                    raise ValueError("Няма отворен проект.")
                info = _store().bind(body.get("folder") or os.path.expanduser("~/Downloads"), project)
                if WATCHER:
                    WATCHER.refresh()
                log.info("import: %s -> %s", info["folder"], os.path.basename(project))
                return self._send(200, {**info, **_import_status(project)})
            if self.path == "/import/unbind":
                _store().unbind(str(body.get("project") or ""))
                if WATCHER:
                    WATCHER.refresh()
                return self._send(200, _import_status(str(body.get("project") or "")))
            if self.path == "/import/result":
                it = _store().result(str(body.get("id")), bool(body.get("ok")), str(body.get("note") or ""))
                return self._send(200, {"state": it["state"]})
            m = re.fullmatch(r"/jobs/([0-9a-f]{12})/cancel", self.path)
            if m:
                job = JOBS.get(m.group(1))
                if not job:
                    return self._send(404, {"error": "Няма такава задача."})
                job.cancel()
                return self._send(200, job.to_dict())
            if self.path == "/log":
                level = logging.ERROR if body.get("level") == "error" else logging.INFO
                log.log(level, "panel: %s", str(body.get("message", ""))[:2000])
                return self._send(200, {"ok": True})
            self._send(404, {"error": "not found"})
        except ValueError as e:
            self._send(400, {"error": str(e)})
        except Exception as e:
            log.exception("request %s failed", self.path)
            self._send(500, {"error": f"Неочаквана грешка: {e}"})


def already_running() -> bool:
    try:
        req = Request(f"http://{config.HOST}:{config.PORT}/status", headers={"X-Asistent": "1"})
        with urlopen(req, timeout=1.5) as r:
            return json.loads(r.read()).get("app") == "asistent"
    except Exception:
        return False


def main():
    log = config.setup_logging()
    if already_running():
        log.info("engine already running on %s", config.PORT)
        return 0
    try:
        httpd = ThreadingHTTPServer((config.HOST, config.PORT), Handler)
    except OSError as e:
        log.error("port %s busy: %s", config.PORT, e)
        return 1
    httpd.daemon_threads = True
    global WATCHER
    try:
        WATCHER = Watcher(_store())
        WATCHER.start()
    except Exception:
        log.exception("folder watching could not start")
        WATCHER = None
    httpd.socket.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    log.info("Asistent engine %s listening on %s:%s", config.VERSION, config.HOST, config.PORT)
    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
