"""Background jobs with progress and cancellation. In memory only: a job lives as long as the engine."""
from __future__ import annotations

import logging
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from .media import MediaError
from .sync import Cancelled

log = logging.getLogger("asistent")


class Job:
    def __init__(self, kind: str):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.state = "queued"          # queued | running | done | error | cancelled
        self.progress = 0.0
        self.message = "Waiting"
        self.result = None
        self.error: str | None = None
        self.created = time.time()
        self._cancel = threading.Event()

    def cancel(self):
        self._cancel.set()
        if self.state == "queued":
            self.state = "cancelled"

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def to_dict(self) -> dict:
        return {"id": self.id, "kind": self.kind, "state": self.state, "progress": round(self.progress, 3),
                "message": self.message, "result": self.result, "error": self.error}


class JobManager:
    def __init__(self, workers: int = 2, keep: int = 50):
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="job")
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._keep = keep

    def submit(self, kind: str, fn: Callable[[Job], object]) -> Job:
        job = Job(kind)
        with self._lock:
            self._jobs[job.id] = job
            if len(self._jobs) > self._keep:
                for old in sorted(self._jobs.values(), key=lambda j: j.created)[: len(self._jobs) - self._keep]:
                    if old.state not in ("queued", "running"):
                        del self._jobs[old.id]
        self._pool.submit(self._run, job, fn)
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def active(self) -> int:
        return sum(1 for j in self._jobs.values() if j.state in ("queued", "running"))

    def _run(self, job: Job, fn: Callable[[Job], object]):
        if job.cancelled:
            job.state = "cancelled"
            return
        job.state = "running"
        t0 = time.time()
        try:
            job.result = fn(job)
            job.state = "done"
            job.progress = 1.0
        except Cancelled:
            job.state, job.message = "cancelled", "Cancelled"
        except (MediaError, ValueError) as e:
            job.state, job.error = "error", str(e)
        except Exception as e:  # unexpected: keep the detail in the log, show a short message
            job.state, job.error = "error", f"Unexpected error: {e}"
            log.error("job %s %s failed\n%s", job.kind, job.id, traceback.format_exc())
        log.info("job %s %s -> %s in %.1fs", job.kind, job.id, job.state, time.time() - t0)
