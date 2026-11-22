"""Show one file in Finder (Mac) or Explorer (Windows), selected, or open a folder there (the Folders page, 0.10.143). Only
shows: never opens a file in its app, plays, moves, renames or writes anything. UXP cannot do either, so the engine does it."""
from __future__ import annotations

import os
import subprocess
import sys


def command(path: str, platform: str | None = None) -> list[str]:
    platform = platform or sys.platform
    if platform == "darwin":
        return ["open", "-R", path]
    if platform == "win32":
        # subprocess quotes a path with spaces as its own argument: `explorer.exe /select, "C:\a b\x.mp4"`, which
        # explorer reads; "/select,C:\a b\x.mp4" quoted as one argument it does not. It answers 1 even when it worked.
        return ["explorer.exe", "/select,", path.replace("/", "\\")]
    raise OSError(f"Showing a file is not supported on {platform}.")


def reveal(path: str) -> None:
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    subprocess.Popen(command(path), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     close_fds=True)


def open_command(path: str, platform: str | None = None) -> list[str]:
    """A folder opened in a Finder / Explorer window (the Folders page's buttons)."""
    platform = platform or sys.platform
    if platform == "darwin":
        return ["open", path]
    if platform == "win32":
        return ["explorer.exe", path.replace("/", "\\")]
    raise OSError(f"Opening a folder is not supported on {platform}.")


def open_folder(path: str) -> None:
    if not path or not os.path.isdir(path):
        raise FileNotFoundError(path)
    subprocess.Popen(open_command(path), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     close_fds=True)


def folders_exist(paths: list) -> list[bool]:
    """Which of these are folders now (read only: the page dims a button whose folder is gone or not mounted)."""
    out = []
    for p in (paths or [])[:200]:
        try:
            out.append(isinstance(p, str) and bool(p) and os.path.isdir(p))
        except OSError:
            out.append(False)
    return out
