"""Start the engine from any working directory (used by the LaunchAgent / Windows Startup shortcut).

Boot check (0.10.6, ARCH-002): after an update, `<app>/update_pending.json` counts the starts until the new engine is
listening (server.main removes it). A version that fails three starts in a row (it does not even import, or it dies
before listening) is replaced by the copy the updater kept in `<app>/previous`. Standard library only, so it works when
the new engine's own code is what is broken.
"""
import json
import os
import shutil
import sys

PARTS = ("engine", "host", "scripts", "fonts")
MAX_STARTS = 3


def app_dir() -> str:
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/Asistent")
    if sys.platform == "win32":
        return os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Asistent")
    return os.path.expanduser("~/.local/share/Asistent")


def boot_check(app: str) -> str | None:
    """-> a note when the previous version was put back, else None."""
    mark = os.path.join(app, "update_pending.json")
    if not os.path.isfile(mark):
        return None
    try:
        with open(mark, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    data["attempts"] = int(data.get("attempts") or 0) + 1
    prev, cur = os.path.join(app, "previous"), os.path.join(app, "current")
    if data["attempts"] < MAX_STARTS or not os.path.isdir(os.path.join(prev, "engine")):
        with open(mark, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return None
    for part in PARTS:                       # the same whole-folder swap as install.sync
        src = os.path.join(prev, part)
        if not os.path.isdir(src):
            continue
        dst = os.path.join(cur, part)
        shutil.rmtree(dst + ".new", ignore_errors=True)
        shutil.copytree(src, dst + ".new")
        shutil.rmtree(dst + ".old", ignore_errors=True)
        if os.path.isdir(dst):
            os.replace(dst, dst + ".old")
        os.replace(dst + ".new", dst)
        shutil.rmtree(dst + ".old", ignore_errors=True)
    os.remove(mark)
    note = (f"Asistent {data.get('version', '?')} did not start {MAX_STARTS} times after the update: "
            f"{data.get('previous', 'the earlier version')} was put back.")
    os.makedirs(os.path.join(app, "updates"), exist_ok=True)         # what the panel says once (updater._last_path)
    with open(os.path.join(app, "updates", "last.json"), "w", encoding="utf-8") as f:
        json.dump({"version": data.get("previous") or "", "text": note}, f)
    return note


if __name__ == "__main__":
    try:
        put_back = boot_check(app_dir())
    except OSError:
        put_back = None
    here = os.path.dirname(os.path.abspath(__file__))
    if put_back and os.path.basename(os.path.dirname(here)) == "current":
        # this file was itself replaced: start the put-back engine instead of the code already in memory
        os.execv(sys.executable, [sys.executable, os.path.join(here, "run_engine.py")])
    sys.path.insert(0, here)
    from asistent.server import main  # noqa: E402

    sys.exit(main())
