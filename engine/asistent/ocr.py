"""Text lines in frames through the Mac's own text recognition (Vision), for Move off faces (2026-11 improvements).

Premiere does not tell a script where a text graphic's letters are (docs/NATIVE_GRAPHICS.md); the frames Asistent exports
already show them, and the subtitle's words are known from the run, so the line is found by its words. The helper
`ocr.swift` is compiled once into `<app>/bin/asistent-ocr` with the command line tools Homebrew already needs; nothing leaves
the computer. Not on Windows (yet): `available()` is False there and Move off faces falls back to its estimate.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys

from . import config

log = logging.getLogger("asistent.ocr")
SOURCE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ocr.swift")


def _binary() -> str:
    with open(SOURCE, "rb") as f:
        tag = hashlib.sha256(f.read()).hexdigest()[:12]
    return os.path.join(config.app_dir(), "bin", f"asistent-ocr-{tag}")


def available() -> bool:
    return sys.platform == "darwin" and (os.path.isfile(_binary()) or shutil.which("swiftc") is not None)


def _ensure() -> str | None:
    exe = _binary()
    if os.path.isfile(exe):
        return exe
    if not available():
        return None
    os.makedirs(os.path.dirname(exe), exist_ok=True)
    r = subprocess.run(["swiftc", "-O", "-o", exe, SOURCE], capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        log.warning("ocr: could not build the text recognition helper: %s", r.stderr[-500:])
        return None
    log.info("ocr: text recognition helper built (%s)", os.path.basename(exe))
    return exe


def read(paths: list[str]) -> list[list[dict]]:
    """[image path] -> per image the text lines {text, x, y, w, h, confidence} (fractions, top-left origin); [] when
    recognition is not available."""
    exe = _ensure() if paths else None
    if not exe:
        return [[] for _ in paths]
    r = subprocess.run([exe, *paths], capture_output=True, text=True, timeout=120)
    out = [json.loads(ln) for ln in r.stdout.splitlines() if ln.strip().startswith("[")]
    return out if len(out) == len(paths) else [[] for _ in paths]
