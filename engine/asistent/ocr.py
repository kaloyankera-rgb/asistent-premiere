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


BATCH = 40               # frames per recognition process: one slow or crashing batch costs only its own frames
BATCH_TIMEOUT = 90.0     # seconds per batch


def read(paths: list[str]) -> list[list[dict]]:
    """[image path] -> per image the text lines {text, x, y, w, h, confidence} (fractions, top-left origin); [] when
    recognition is not available, and [] for the frames of a batch that timed out or failed (the others keep their text)."""
    exe = _ensure() if paths else None
    if not exe:
        return [[] for _ in paths]
    out: list[list[dict]] = []
    for i in range(0, len(paths), BATCH):
        chunk = paths[i:i + BATCH]
        try:
            r = subprocess.run([exe, *chunk], capture_output=True, text=True, timeout=BATCH_TIMEOUT)
            res = [json.loads(ln) for ln in r.stdout.splitlines() if ln.strip().startswith("[")]
        except (subprocess.SubprocessError, OSError, ValueError) as e:
            log.warning("ocr: a batch of %d frames gave no text (%s)", len(chunk), e)
            res = []
        out.extend(res if len(res) == len(chunk) else [[] for _ in chunk])
    return out
