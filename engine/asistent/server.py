"""Local HTTP API for the Premiere panel. Listens on 127.0.0.1 only.

Requests must carry the header `X-Asistent: 1`. A web page cannot add a custom header to a request to
another origin without a CORS preflight, which this server never approves, so a browser tab cannot
drive the engine. The Host header is checked against DNS rebinding.

  GET  /status               engine version and busy state
  GET  /update/check?force=1 {"current", "latest", "newer", "notes"} from the GitHub releases (updater.py)
  POST /update/install       job: download, check and install the newest release, then the engine restarts
  GET  /subtitles/model      speech model status (backend installed, model present, size, device, "translator")
  POST /subtitles/model/download   job: download the ~3 GB model (only from the confirmed panel button)
  POST /subtitles/translator/download   job: download the ~1.4 GB English translator (only from its panel button; also replaces
                                        the 600 MB one of 0.9.94-0.9.96)
  POST /subtitles            {"items": [{path, start, end, at, name}], "out_dir", "name", "fps", "width", "height",
                              "preset"?: auto|short|standard|reshape|gstroy|credissimo|ekopak|beautysector|aula, "terms"?: [...], "skipped"?: [...]} -> job: dialogue mix ->
                              Whisper -> captions -> SRT + JSON in <out_dir>/Asistent_subtitles (nothing goes to Premiere)
  GET  /host/poll?wait=s     the Premiere host (CEP extension, ExtendScript): the next command; GET /host/status
  POST /host/result          {id, ok, data} from the host
  POST /subtitles/review     {json} -> what to check per caption line (review.py; reads the run's JSON, changes nothing)
  GET  /panel/store         the panel's settings {values}; POST /panel/store {key, value|null} (survive panel updates)
  POST /captions/faces      {frames: [{path, t}], project, graphics: [{id, start, end}]} -> per frame faces and each graphic's
                             measured text centre (Mac text recognition), as fractions (Move off faces; frames deleted after)
  POST /subtitles/play       {start} Premiere plays from there in the Program Monitor (Captions tab ▶); {stop, from, until} stops it
                             if the playhead is still inside that passage
  POST /captions/graphics    {"captions": [{start, end, text}], "preset", "sequence", "project"?} -> every line as a text
                             graphic on a new video track (Asistent's After Effects template, built on first use)
  POST /captions/place       {"srt", "sequence", "project"?, "bin"?} -> puts the SRT on a caption track of the active
                             sequence through the host; {"ok", "msg", ...} (503 with the reason when the host is away)
  GET  /subtitles/settings?project=   {text}: the corrections and names text (per project)
  POST /subtitles/settings   {project, text} -> saved + {errors} of the text; /subtitles also takes "text"
  POST /subtitles/speakers   {project, speakers: {track: "m"|"f"|""}} -> saved per project, the client's default (learning.py)
  GET  /subtitles/learned?project=   the client's learned fixes (Captions tab); POST {project, key, action: remove|restore}
  GET  /captions/state?project=&sequence=   the caption track Asistent placed there before ({} when none)
  POST /captions/record      {project, sequence, signature: {index, count, first, last, srt}}; POST /captions/forget
  GET  /dev/poll?wait=s      test bridge (only with devbridge.enabled): the next panel command
  POST /dev/command          {name, args} -> {id};  GET /dev/result?id=&wait=s;  POST /dev/result {id, ok, data}
  POST /sync                 {"paths": [...], "reference": null|int} -> {"job": id}
  POST /sync_groups          {"paths": [...]} -> {"job": id}; groups among all clips (timeline selection)
  POST /audio                {"items": [{"path", "start", "end", "force"?}], "force"?, "target"?, "ceiling"?,
                              "phrases"?: true -> Volume keyframes that even out phrases,
                              "balance_db"?: how far apart two speakers may be (default 2)}
  POST /colorlearn/record    {project, sequence, clips: [{path, start, end, lumetri, owned, layer, lut, animated}]} -> queued:
                              after an export, each clip's Lumetri next to Auto color's suggestion (colorlearn.py, read only)
  GET  /colorlearn/report?project=|client=   per camera: editors minus Asistent (medians), kept, untouched; /colorlearn/status
  POST /export/peaks         {"items": [{path, start, end}]} -> job: each clip's true peak per channel in the used range
                              (pre-export check, read only; exportcheck.py)
  POST /audio/route          {"items": [{track, start, end, route}], "sequence", "project"?} -> through the host:
                              L/L and R/R subclips placed and linked (host.jsx as_audio_route); {"ok", "items"}
  GET  /jobs/<id>            state, progress, message, result
  POST /jobs/<id>/cancel
  POST /log                  {"level": "info"|"error", "message": "..."} panel messages into the engine log
  POST /color               {"items": [{"path", "start", "end"}]} -> job: exposure + white balance + preview
  POST /color/sliders        {"fix_temp", "fix_tint"} -> Lumetri Temperature/Tint (learnt calibration)
  POST /shotmatch            {"items": [{path, camera, times, overlap, current, lumetri}], "reference"?} -> job
  POST /shotmatch/check      {"job", "before", "after", "clip"?} -> match before/after vs the reference, revert list
  POST /color/audit          {"record"} -> one JSON line per clip and press in color_audit.jsonl
  POST /color/managed/check  {"key", "snapshot"} -> {"owned"}: is this Lumetri exactly as Asistent left it?
  POST /color/managed/record {"key", "snapshot", "values"} -> remember a Lumetri Asistent just wrote
  POST /color/check          {"before", "after", "applied", "fix", "clip_tolerance"?, "final"?} -> verify a
                             Premiere render; clipping_status ACCEPTED / ACCEPTED_WITH_WARNING / REVIEW_NEEDED
  POST /color/probe          {"refs": {"baseline", "source"?}, "frames": [{"path", ...}], "report"?}
                             -> Lumetri parameter responses + capability table, saved to lumetri_capabilities.json
  POST /frames/wait          {"path", "timeout"?} -> {"path": file|null} once Premiere finished writing the frame
                             (exportSequenceFrame only queues the export); paths inside the frames folder only
  GET  /import/status?project=P[&wait=s]   folder, queue, last imports; wait: return as soon as a file is ready
  POST /import/bind          {"project", "folder"?}  switch on (default folder: ~/Downloads)
  POST /import/unbind        {"project"}
  POST /import/result        {"id", "ok", "note"?}   the panel reports each import
  GET  /exports/settings     {enabled, project, folders: [{path, why: project|added|learned}], app: Finder|Explorer}
  POST /exports/settings     {"project"?, "enabled"?, "add"?: folder, "remove"?: folder} -> the same (exports.py)
  POST /exports/done         {"path"?, "kind": complete|error|cancel, "source"} an export event from the panel or host
  GET  /exports/recent       {items: [{id, name, path, at, shown, note}]} for the Log tab
  POST /exports/reveal       {"id"} show an export from the list again (only files the engine itself recorded)
"""
from __future__ import annotations

import json
import logging
import os
import re
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from . import config
from .jobs import JobManager
from .audio import analyze_items
from . import color as COLOR
from . import exportcheck as EXPORTCHECK
from . import colorlearn
from .groups import sync_groups
from .importer import Store, Watcher
from .exports import ExportWatcher, Settings as ExportSettings
from .managed import ManagedStore
from . import shotmatch as SHOT
from . import asr
from . import install
from . import subtitle_job
from . import roughcut_job
from . import devbridge
from . import hostbridge
from . import captionstate
from . import subtitle_settings
from . import learning
from . import review
from . import framefaces
from . import panelstore
from . import translate
from . import updater

SHOT_REFS: dict = {}            # shot-match job id -> reference look (for the render check after applying)
from .sync import sync_clips

log = logging.getLogger("asistent")
JOBS = JobManager()
STORE: Store | None = None
WATCHER: Watcher | None = None
EXPORTS: ExportWatcher | None = None
BRIDGE = devbridge.Bridge()


def _guid(body: dict) -> str | None:
    """The panel's sequence id for the host (UXP `Sequence.guid` = ExtendScript `sequenceID`), when it sent one."""
    g = body.get("guid")
    return g if isinstance(g, str) and 0 < len(g) <= 64 else None


def _exports() -> ExportWatcher:
    global EXPORTS
    if EXPORTS is None:
        EXPORTS = ExportWatcher(ExportSettings())
    return EXPORTS


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
        raise ValueError("Choose at least two clips with audio.")
    missing = [p for p in paths if not os.path.isfile(p)]
    if missing:
        raise ValueError("The file is missing (offline media?): " + ", ".join(os.path.basename(p) for p in missing))
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
        raise ValueError("Select at least two different clips in the timeline.")
    missing = [p for p in paths if not os.path.isfile(p)]
    if missing:
        raise ValueError("The file is missing (offline media?): " + ", ".join(os.path.basename(p) for p in missing))

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


ACTIONS = {None, "use_left", "use_right", "split", "split_all", "none"}


def _start_audio(body: dict) -> dict:
    items = body.get("items") or []
    if not isinstance(items, list) or not items or not all(isinstance(i, dict) and isinstance(i.get("path"), str)
                                                           for i in items):
        raise ValueError("Select at least one clip with sound in the timeline.")
    if body.get("force") not in ACTIONS or any(i.get("force") not in ACTIONS for i in items):
        raise ValueError("Invalid action.")
    missing = sorted({os.path.basename(i["path"]) for i in items if not os.path.isfile(i["path"])})
    if missing:
        raise ValueError("The file is missing (offline media?): " + ", ".join(missing))
    target = float(body.get("target", -17.0))
    ceiling = float(body.get("ceiling", -6.0))
    balance_tol = float(body.get("balance_db", 2.0))             # how far apart two speakers may be, in dB

    def work(job):
        def progress(f, msg):
            job.progress, job.message = f, msg
        res = analyze_items(items, body.get("force"), target, ceiling, progress, lambda: job.cancelled,
                            phrases=bool(body.get("phrases")), balance_tol=balance_tol)
        log.info("audio: %s", [(r["name"], r.get("kind"), r.get("action"),
                                [o.get("gain_db") for o in r.get("outputs", [])]) for r in res["items"]])
        return res

    return {"job": JOBS.submit("audio", work).id}


def _start_roughcut(body: dict) -> dict:
    roughcut_job.validate(body)          # fail now, with the message, not inside the job

    def work(job):
        def progress(f, msg):
            job.progress, job.message = f, msg
        return roughcut_job.run(body, progress, lambda: job.cancelled)

    return {"job": JOBS.submit("roughcut", work).id}


def _start_subtitles(body: dict) -> dict:
    subtitle_job.validate(body)          # fail now, with the message, not inside the job

    def work(job):
        def progress(f, msg):
            job.progress, job.message = f, msg
        return subtitle_job.run(body, progress, lambda: job.cancelled)

    return {"job": JOBS.submit("subtitles", work).id}


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
            raise ValueError("The request is too large.")
        raw = self.rfile.read(n) if n else b"{}"
        data = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(data, dict):
            raise ValueError("Invalid request.")
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
                return self._send(400, {"error": "No project."})
            wait = float((q.get("wait") or ["0"])[0] or 0)
            if wait > 0:                       # long poll: answer as soon as a file is ready for this project
                _store().wait_queue(project, wait)
            return self._send(200, _import_status(project))
        if self.path == "/subtitles/model":
            return self._send(200, {**asr.model_status(), "translator": translate.available(),
                                    "translator_better": translate.better_available(), "translator_mb": translate.MODEL_MB})
        if url.path == "/update/check":
            return self._send(200, updater.check(force=(parse_qs(url.query).get("force") or ["0"])[0] == "1"))
        if url.path == "/subtitles/settings":
            return self._send(200, subtitle_settings.get((parse_qs(url.query).get("project") or [""])[0]))
        if url.path == "/subtitles/learned":
            return self._send(200, learning.listing((parse_qs(url.query).get("project") or [""])[0]))
        if url.path == "/panel/store":
            return self._send(200, {"values": panelstore.get_all()})
        if url.path == "/colorlearn/report":
            q = parse_qs(url.query)
            client = (q.get("client") or [""])[0] or colorlearn.client_of((q.get("project") or [""])[0])
            return self._send(200, {**colorlearn.report(client), "clients": colorlearn.clients(), **colorlearn.status()})
        if url.path == "/colorlearn/status":
            return self._send(200, colorlearn.status())
        if url.path == "/captions/state":
            q = parse_qs(url.query)
            return self._send(200, captionstate.get((q.get("project") or [""])[0], (q.get("sequence") or [""])[0]) or {})
        if url.path == "/host/status":
            return self._send(200, hostbridge.status())
        if url.path == "/exports/settings":
            return self._send(200, _exports().status())
        if url.path == "/exports/recent":
            return self._send(200, {"items": _exports().recent()})
        if url.path == "/host/poll":
            q = parse_qs(url.query)
            hostbridge.touch(self.headers.get("X-Asistent-Host"))
            wait = float((q.get("wait") or ["0"])[0] or 0)
            cmd = hostbridge.HOST.poll(wait)
            hostbridge.touch()                     # the poll itself can last 20 s: it is alive when it returns
            return self._send(200, cmd or {})
        if url.path in ("/dev/poll", "/dev/result"):
            if not devbridge.enabled():
                return self._send(404, {"error": "The test bridge is off."})
            q = parse_qs(url.query)
            wait = float((q.get("wait") or ["0"])[0] or 0)
            if url.path == "/dev/poll":
                return self._send(200, BRIDGE.poll(wait) or {})
            res = BRIDGE.wait_result((q.get("id") or [""])[0], wait)
            return self._send(200, res) if res else self._send(202, {"pending": True})
        if self.path == "/status":
            frames = os.path.join(config.app_dir(), "frames")
            os.makedirs(frames, exist_ok=True)
            return self._send(200, {"ok": True, "app": "asistent", "version": config.VERSION,
                                    "busy": JOBS.active(), "platform": sys.platform, "frames_dir": frames})
        m = re.fullmatch(r"/jobs/([0-9a-f]{12})", self.path)
        if m:
            job = JOBS.get(m.group(1))
            return self._send(200, job.to_dict()) if job else self._send(404, {"error": "No such job."})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._allowed():
            return self._send(403, {"error": "forbidden"})
        try:
            body = self._body()
            if self.path == "/subtitles/model/download":
                if asr.model_present():
                    return self._send(200, {"done": True, "status": asr.model_status()})

                def work(job):
                    def progress(f, msg):
                        job.progress, job.message = f, msg
                    return asr.download_model(progress, lambda: job.cancelled)
                return self._send(200, {"job": JOBS.submit("subtitles_model", work).id})
            if self.path == "/subtitles/translator/download":
                if translate.available() and not translate.better_available():
                    return self._send(200, {"done": True})

                def work_tr(job):
                    def progress(f, msg):
                        job.progress, job.message = f, msg
                    return translate.download_model(progress, lambda: job.cancelled)
                return self._send(200, {"job": JOBS.submit("translator_model", work_tr).id})
            if self.path == "/update/install":
                if JOBS.active():
                    return self._send(409, {"error": "Asistent is busy: update when the running task has finished."})

                def work_up(job):
                    def progress(f, msg):
                        job.progress, job.message = f, msg
                    return updater.install_update(progress, lambda: job.cancelled)
                return self._send(200, {"job": JOBS.submit("update", work_up).id})
            if self.path == "/subtitles":
                return self._send(200, _start_subtitles(body))
            if self.path == "/roughcut":
                return self._send(200, _start_roughcut(body))
            if self.path == "/host/result":
                hostbridge.HOST.result(str(body.get("id") or ""), bool(body.get("ok")), body.get("data"))
                hostbridge.touch()
                return self._send(200, {"ok": True})
            if self.path == "/captions/place":
                srt, seq = body.get("srt"), body.get("sequence")
                if not isinstance(srt, str) or not isinstance(seq, str) or not seq:
                    raise ValueError("A file or sequence is missing.")
                proj = body.get("project") if isinstance(body.get("project"), str) else None
                res = hostbridge.place_captions(srt, seq, proj, str(body.get("bin") or "Subtitles"), _guid(body))
                log.info("captions/place: %s", res)
                return self._send(200, res)
            if self.path == "/captions/graphics":
                seq = body.get("sequence")
                if not isinstance(seq, str) or not seq:
                    raise ValueError("The sequence is missing.")
                proj = body.get("project") if isinstance(body.get("project"), str) else None
                res = hostbridge.place_graphics(body.get("captions"), str(body.get("preset") or "standard"), seq, proj, _guid(body))
                log.info("captions/graphics: %s", {k: v for k, v in res.items() if k != "captions"})
                return self._send(200, res)
            if self.path == "/audio/route":
                seq = body.get("sequence")
                if not isinstance(seq, str) or not seq:
                    raise ValueError("The sequence is missing.")
                proj = body.get("project") if isinstance(body.get("project"), str) else None
                res = hostbridge.route_audio(body.get("items"), seq, proj, _guid(body))
                log.info("audio/route: %s", res)
                return self._send(200, res)
            if self.path == "/subtitles/settings":
                return self._send(200, subtitle_settings.put(str(body.get("project") or ""), body.get("text") or ""))
            if self.path == "/subtitles/speakers":
                proj = str(body.get("project") or "")
                res = subtitle_settings.put_speakers(proj, body.get("speakers"))
                try:
                    learning.record_speakers(proj, res["speakers"])
                except OSError as e:
                    log.warning("learning: speakers not shared: %s", e)
                return self._send(200, res)
            if self.path == "/subtitles/learned":
                key, action = body.get("key"), body.get("action")
                if not isinstance(key, str) or action not in ("remove", "restore"):
                    raise ValueError("Invalid learned fix.")
                return self._send(200, learning.set_removed(str(body.get("project") or ""), key, action == "remove"))
            if self.path == "/subtitles/review":         # what to check, line by line (reads the job's JSON, changes nothing)
                return self._send(200, review.load(str(body.get("json") or "")))
            if self.path == "/panel/store":             # the panel's settings, kept outside the installed panel
                v = body.get("value")
                return self._send(200, panelstore.put(str(body.get("key") or ""), v if v is None else str(v)))
            if self.path == "/captions/faces":           # Move off faces: faces in frames the panel exported (numbers only)
                if not framefaces.faces.available():
                    raise ValueError("The face detector is not installed (OpenCV and models/face_detection_yunet_2023mar.onnx).")
                return self._send(200, {"frames": framefaces.measure(body.get("frames"), str(body.get("project") or ""),
                                                                     body.get("graphics") if isinstance(body.get("graphics"), list) else None)})
            if self.path == "/subtitles/play":           # Captions tab ▶: Premiere's own playback through the host (0.10.11)
                if body.get("stop"):
                    return self._send(200, hostbridge.run("play_stop", {"from": float(body.get("from") or 0.0),
                                                                        "until": float(body.get("until") or 0.0)}, 10.0))
                return self._send(200, hostbridge.run("play", {"start": float(body.get("start") or 0.0)}, 10.0))
            if self.path in ("/captions/record", "/captions/forget"):
                proj, seq = body.get("project"), body.get("sequence")
                if not isinstance(proj, str) or not isinstance(seq, str) or not seq:
                    raise ValueError("The project or sequence is missing.")
                if self.path == "/captions/forget":
                    captionstate.forget(proj, seq)
                else:
                    sig = body.get("signature")
                    if not isinstance(sig, dict):
                        raise ValueError("The signature is missing.")
                    captionstate.record(proj, seq, sig)
                return self._send(200, {"ok": True})
            if self.path == "/host/command":
                if not devbridge.enabled():
                    return self._send(404, {"error": "The test bridge is off."})
                res = hostbridge.run(str(body.get("name") or ""), body.get("args") if isinstance(body.get("args"), dict) else {},
                                     float(body.get("wait") or 60))
                return self._send(200, res)
            if self.path in ("/dev/command", "/dev/result"):
                if not devbridge.enabled():
                    return self._send(404, {"error": "The test bridge is off."})
                if self.path == "/dev/command":
                    cid = BRIDGE.submit(str(body.get("name") or ""), body.get("args") if isinstance(body.get("args"), dict) else {})
                    log.info("dev bridge command %s %s %s", cid, body.get("name"), body.get("args") or {})
                    return self._send(200, {"id": cid})
                BRIDGE.result(str(body.get("id") or ""), bool(body.get("ok")), body.get("data"))
                log.info("dev bridge result %s ok=%s", body.get("id"), body.get("ok"))
                return self._send(200, {"ok": True})
            if self.path == "/sync":
                return self._send(200, _start_sync(body))
            if self.path == "/sync_groups":
                return self._send(200, _start_groups(body))
            if self.path == "/audio":
                return self._send(200, _start_audio(body))
            if self.path == "/colorlearn/record":
                return self._send(200, colorlearn.queue_export(body.get("project") or "", body.get("sequence") or "",
                                                               body.get("clips") or []))
            if self.path == "/export/peaks":
                items = body.get("items") or []
                if not all(isinstance(i, dict) and isinstance(i.get("path"), str) for i in items):
                    raise ValueError("Every audio clip needs its file.")

                def work_peaks(job):
                    def progress(f, msg):
                        job.progress, job.message = f, msg
                    return EXPORTCHECK.peaks(items, progress, lambda: job.cancelled)
                return self._send(200, {"job": JOBS.submit("export_peaks", work_peaks).id})
            if self.path == "/color":
                items = body.get("items") or []
                if not items or not all(isinstance(i, dict) and isinstance(i.get("path"), str) for i in items):
                    raise ValueError("Select at least one video clip in the timeline.")

                def work(job):
                    def progress(f, msg):
                        job.progress, job.message = f, msg
                    res = COLOR.analyze_items(items, True, progress, lambda: job.cancelled)
                    log.info("color: %s", [(r["name"], r.get("exposure", {}).get("stops"),
                                            r.get("white", {}).get("confidence"), r.get("measured_on"))
                                           for r in res["items"]])
                    return res
                return self._send(200, {"job": JOBS.submit("color", work).id})
            if self.path == "/shotmatch":
                items = body.get("items") or []
                if not items or not all(isinstance(i, dict) and isinstance(i.get("path"), str) for i in items):
                    raise ValueError("Select video clips from at least two cameras.")
                reference = body.get("reference")

                def work(job):
                    def progress(f, msg):
                        job.progress, job.message = f, msg
                    res = SHOT.run(items, reference, progress=progress, cancelled=lambda: job.cancelled)
                    SHOT_REFS[job.id] = res["reference_look"]
                    log.info("shot match: reference %s scores %s %s", res["reference"], res["scores"],
                             [(c["name"], c["role"], c.get("proposal"), c["flags"]) for c in res["clips"]])
                    return res
                return self._send(200, {"job": JOBS.submit("shotmatch", work).id})
            if self.path == "/shotmatch/check":
                ref = SHOT_REFS.get(str(body.get("job") or ""))
                if not ref:
                    raise ValueError("No such match analysis: press Match POVs again.")
                before = COLOR._wait_file(str(body.get("before") or ""), 4.0)
                after = COLOR._wait_file(str(body.get("after") or ""), 4.0)
                if not (before and after):
                    raise ValueError("No exported frames to check.")
                res = SHOT.check(before, after, ref)
                log.info("shot match check %s: %s", body.get("clip"), res)
                return self._send(200, res)
            if self.path == "/color/audit":
                # one JSON line per clip and press (colour plan B4): what was measured, written, kept, reverted
                import time as _time
                rec = body.get("record") if isinstance(body.get("record"), dict) else {}
                rec = {"at": _time.strftime("%Y-%m-%dT%H:%M:%S"), "engine": config.VERSION, **rec}
                with open(os.path.join(config.app_dir(), "color_audit.jsonl"), "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
                log.info("color audit: %s %s", rec.get("clip"), rec.get("status"))
                return self._send(200, {"ok": True})
            if self.path in ("/color/managed/check", "/color/managed/record"):
                store = ManagedStore(os.path.join(config.app_dir(), "managed.json"))
                key, snap = str(body.get("key") or ""), str(body.get("snapshot") or "")
                if self.path.endswith("check"):
                    return self._send(200, {"owned": store.owned(key, snap)})
                store.record(key, snap, body.get("values") or {})
                log.info("color managed: recorded %s %s", key, body.get("values"))
                return self._send(200, {"ok": True})
            if self.path == "/color/sliders":
                cal = COLOR.Calibration()
                out = cal.sliders(float(body.get("fix_temp") or 0), float(body.get("fix_tint") or 0))
                out["learnt"] = cal.learnt("temp") and cal.learnt("tint")
                return self._send(200, out)
            if self.path == "/color/probe":
                import json as _json
                import time as _time
                res = COLOR.probe_measure(body.get("refs") or {}, body.get("frames") or [])
                record = {"report": body.get("report"), "result": res, "at": _time.time()}
                path = os.path.join(config.app_dir(), "lumetri_capabilities.json")
                with open(path, "w", encoding="utf-8") as fh:
                    _json.dump(record, fh, ensure_ascii=False, indent=1, default=str)
                log.info("color probe: %s units %s identity %s", res.get("table"), res.get("units"), res.get("identity"))
                return self._send(200, res)
            if self.path == "/frames/wait":
                # only files inside the engine's own frames folder
                folder = os.path.realpath(os.path.join(config.app_dir(), "frames"))
                want = os.path.realpath(str(body.get("path") or ""))
                if os.path.dirname(want) != folder:
                    raise ValueError("The frame must be in the engine's frames folder.")
                timeout = min(max(float(body.get("timeout") or 15), 0.5), 60)
                return self._send(200, {"path": COLOR._wait_file(want, timeout)})
            if self.path == "/color/check":
                before = COLOR._wait_file(str(body.get("before") or ""), 4.0)
                after = COLOR._wait_file(str(body.get("after") or ""), 4.0)
                if not (before and after):
                    raise ValueError("No exported frames to check.")
                applied, fix = body.get("applied") or {}, body.get("fix") or {}
                # clip_tolerance: the soft tolerance above the 3 % target (default 0.25 points), configurable per call
                tol = float(body.get("clip_tolerance", COLOR.CLIP_SOFT_TOLERANCE))
                res = COLOR.check_render(before, after, float(applied.get("exposure") or 0),
                                         soft_tolerance=min(max(tol, 0.0), 0.02), final=bool(body.get("final")),
                                         applied=applied)
                cb = res.get("cast_before")
                if cb and res["cast_after"]:
                    cal = COLOR.Calibration()
                    # only an axis the probe never measured, and only from a render without an Exposure change
                    # (the highlight shoulder biases the cast: 2026-11-01 it read −84 where the probe read −50)
                    clean = not float(applied.get("exposure") or 0)
                    res["learnt"] = {
                        axis: clean and not cal.from_probe(axis) and
                        cal.learn(axis, float(applied.get(key) or 0), res["cast_after"][i] - cb[i])
                        for i, (axis, key) in enumerate((("temp", "temperature"), ("tint", "tint")))}
                    res["residual"] = [round(res["cast_after"][0] + 0.0, 3), round(res["cast_after"][1] + 0.0, 3)]
                    res["sliders_now"] = cal.sliders(float(fix.get("fix_temp") or 0), float(fix.get("fix_tint") or 0))
                log.info("color check: %s", {k: v for k, v in res.items() if k != "sliders_now"})
                return self._send(200, res)
            if self.path == "/import/bind":
                project = body.get("project")
                if not isinstance(project, str) or not project:
                    raise ValueError("No project open.")
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
            if self.path == "/exports/settings":
                add, remove = body.get("add"), body.get("remove")
                res = _exports().configure(str(body.get("project") or "") or None,
                                           None if body.get("enabled") is None else bool(body.get("enabled")),
                                           add if isinstance(add, str) else None, remove if isinstance(remove, str) else None)
                return self._send(200, res)
            if self.path == "/exports/done":
                path = body.get("path")
                return self._send(200, _exports().done(path if isinstance(path, str) else None,
                                                       str(body.get("kind") or "complete"), str(body.get("source") or "")))
            if self.path == "/exports/reveal":
                return self._send(200, _exports().again(str(body.get("id") or "")))
            m = re.fullmatch(r"/jobs/([0-9a-f]{12})/cancel", self.path)
            if m:
                job = JOBS.get(m.group(1))
                if not job:
                    return self._send(404, {"error": "No such job."})
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
            self._send(500, {"error": f"Unexpected error: {e}"})


def already_running() -> bool:
    try:
        req = Request(f"http://{config.HOST}:{config.PORT}/status", headers={"X-Asistent": "1"})
        with urlopen(req, timeout=1.5) as r:
            return json.loads(r.read()).get("app") == "asistent"
    except Exception:
        return False


def main():
    log = config.setup_logging()
    if os.environ.pop("ASISTENT_RESTART", None):       # started by an update: the old engine is letting the port go
        for _ in range(40):
            if not already_running():
                break
            time.sleep(0.5)
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
    try:
        _exports().refresh()                           # on only when the editor switched it on
    except Exception:
        log.exception("export watching could not start")
    httpd.socket.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    try:
        COLOR.prune_frames(os.path.join(config.app_dir(), "frames"))
    except OSError:
        log.exception("old frames could not be removed")
    log.info("Asistent engine %s listening on %s:%s", config.VERSION, config.HOST, config.PORT)
    try:
        install.boot_ok()                              # an update that got this far stands (0.10.6, run_engine.py)
    except OSError:
        log.exception("the update mark could not be removed")
    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
