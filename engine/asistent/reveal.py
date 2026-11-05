"""Show one file in Finder (Mac) or Explorer (Windows), selected. Only shows it: never opens, plays, moves or renames
it. UXP cannot select a file in Finder, so the engine does it."""
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
