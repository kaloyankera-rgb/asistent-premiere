"""Where the engine keeps its own files (never inside the synced vault) and how it logs."""
from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler

VERSION = "0.10.8"
HOST = "127.0.0.1"
PORT = int(os.environ.get("ASISTENT_PORT", "47390"))   # Quick Search uses 47231-47234


def app_dir() -> str:
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support/Asistent")
    elif sys.platform == "win32":
        base = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Asistent")
    else:
        base = os.path.expanduser("~/.local/share/Asistent")
    os.makedirs(base, exist_ok=True)
    return base


def log_dir() -> str:
    d = os.path.join(app_dir(), "logs")
    os.makedirs(d, exist_ok=True)
    return d


def setup_logging() -> logging.Logger:
    log = logging.getLogger("asistent")
    if not log.handlers:
        log.setLevel(logging.INFO)
        h = RotatingFileHandler(os.path.join(log_dir(), "engine.log"), maxBytes=1_000_000, backupCount=3,
                                encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        log.addHandler(h)
        if sys.stderr and sys.stderr.isatty():
            log.addHandler(logging.StreamHandler())
    return log
