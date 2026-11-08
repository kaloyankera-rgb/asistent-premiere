"""Updates from the GitHub releases, so nobody has to download anything by hand after the first install.

Every release carries `latest.json` ({"version", "bundle": {"name", "sha256", "size"}, "notes"}) and the bundle
`Asistent-<version>.zip` (engine, host, scripts, fonts, requirements, panel .ccx; see scripts/build_release.py).
The panel asks `check()` when it opens and every few hours; nothing is installed until the editor presses Update.
`install()` downloads the bundle, checks its SHA-256 against latest.json, installs the Python packages only when a
requirements file changed, puts the files in place (install.py) and restarts the engine on the new code.

Only GET requests to github.com; nothing is sent anywhere.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import zipfile
from pathlib import Path
from urllib.request import Request, urlopen

from . import config, install

log = logging.getLogger("asistent.updater")

REPO = "kaloyankera-rgb/asistent-premiere"
LATEST = f"https://github.com/{REPO}/releases/latest/download/latest.json"
ASSET = "https://github.com/{repo}/releases/download/v{version}/{name}"
CHECK_EVERY = 6 * 3600          # seconds between two real checks; the panel may ask more often
LAUNCHD_LABEL = "com.contentstudio.asistent"
RESTART_EXIT = 75               # a non-zero exit: the Mac LaunchAgent (KeepAlive SuccessfulExit=false) starts the engine again
REQUIREMENTS = ("requirements.txt", "requirements-asr.txt")

_lock = threading.Lock()
_cache: dict = {"at": 0.0, "info": None}


def parse_version(v: str) -> tuple:
    return tuple(int(x) for x in str(v).strip().lstrip("v").split("."))


def _get(url: str, timeout: float = 15.0) -> bytes:
    req = Request(url, headers={"User-Agent": f"Asistent/{config.VERSION}"})
    with urlopen(req, timeout=timeout) as r:
        return r.read()


def _source() -> str | None:
    """Development only: a folder with latest.json and the zip named in `<app>/update_source.txt` replaces GitHub, so an
    update can be tried end to end before anything is published. Absent on every normal install."""
    try:
        with open(os.path.join(config.app_dir(), "update_source.txt"), encoding="utf-8") as f:
            d = f.read().strip()
    except OSError:
        return None
    return d if d and os.path.isdir(d) else None


def _latest_url() -> str:
    src = _source()
    return Path(src, "latest.json").as_uri() if src else LATEST


def _asset_url(version: str, name: str) -> str:
    src = _source()
    return Path(src, name).as_uri() if src else ASSET.format(repo=REPO, version=version, name=name)


def latest() -> dict:
    info = json.loads(_get(_latest_url()))
    parse_version(info["version"])                      # a broken file fails here, not halfway through an install
    b = info["bundle"]
    if not (isinstance(b.get("name"), str) and len(b.get("sha256", "")) == 64 and int(b.get("size", 0)) > 0):
        raise ValueError("latest.json has no valid bundle")
    if os.path.basename(b["name"]) != b["name"]:
        raise ValueError("latest.json names a bundle with a path")
    return info


def _last_path() -> str:
    return os.path.join(config.app_dir(), "updates", "last.json")


def _just_updated() -> str | None:
    """The message of an update that brought this very version, once (the panel reloads during an update and misses it)."""
    try:
        with open(_last_path(), encoding="utf-8") as f:
            last = json.load(f)
        os.remove(_last_path())
    except (OSError, ValueError):
        return None
    return last.get("text") if last.get("version") == config.VERSION else None


def check(force: bool = False) -> dict:
    """-> {"current", "latest", "newer", "notes"} or {"current", "error"}; a real check at most every CHECK_EVERY.
    Right after an update it also carries "just_updated": the message of that update."""
    done = _just_updated()
    if done:
        return {"current": config.VERSION, "latest": config.VERSION, "newer": False, "just_updated": done}
    with _lock:
        if not force and _cache["info"] and time.time() - _cache["at"] < CHECK_EVERY:
            return _cache["info"]
        try:
            info = latest()
            out = {"current": config.VERSION, "latest": info["version"], "notes": str(info.get("notes") or "")[:2000],
                   "newer": parse_version(info["version"]) > parse_version(config.VERSION)}
        except Exception as e:                           # offline, no release yet, GitHub down: say so, try again later
            log.info("update check failed: %s", e)
            out = {"current": config.VERSION, "error": f"The update check failed: {e}"}
        _cache.update(at=time.time(), info=out)
        return out


# ---------------------------------------------------------------- install

def _download(url: str, dest: str, size: int, progress, cancelled) -> None:
    req = Request(url, headers={"User-Agent": f"Asistent/{config.VERSION}"})
    got = 0
    with urlopen(req, timeout=60) as r, open(dest + ".part", "wb") as f:
        while True:
            if cancelled():
                raise InterruptedError("Cancelled.")
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            got += len(chunk)
            progress(min(got / size, 1.0))
    os.replace(dest + ".part", dest)


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _extract(zpath: str, dest: str) -> str:
    """Unpack, refusing any entry that would land outside `dest` -> the release root inside it."""
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(dest)
    root = os.path.realpath(dest)
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            target = os.path.realpath(os.path.join(dest, name))
            if target != root and not target.startswith(root + os.sep):
                raise ValueError(f"unsafe path in the update: {name}")
        z.extractall(dest)
    if os.path.isdir(os.path.join(dest, "engine")):
        return dest
    inner = [d for d in os.listdir(dest) if os.path.isdir(os.path.join(dest, d, "engine"))]
    if len(inner) != 1:
        raise ValueError("the update has no engine folder")
    return os.path.join(dest, inner[0])


def _venv_python() -> str:
    if sys.platform == "win32":
        return os.path.join(config.app_dir(), "venv", "Scripts", "python.exe")
    return os.path.join(config.app_dir(), "venv", "bin", "python")


def _read(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def changed_requirements(new_root: str, cur_root: str, asr_installed: bool) -> list[str]:
    """The requirement files to install again: those that differ from the installed copy (ASR only where it is installed)."""
    names = [n for n in REQUIREMENTS if n != "requirements-asr.txt" or asr_installed]
    lock = lambda n: n.replace(".txt", f"-lock-{'mac' if sys.platform == 'darwin' else 'win'}.txt")   # 0.10.6: a re-lock counts too
    return [n for n in names if os.path.isfile(os.path.join(new_root, n))
            and any(_read(os.path.join(new_root, f)) != _read(os.path.join(cur_root, f)) for f in (n, lock(n)))]


def install_update(progress, cancelled) -> dict:
    """The update job: the newest release -> installed; the engine restarts a moment after the job ends."""
    progress(0.0, "Reading the newest release…")
    info = latest()
    version = info["version"]
    if parse_version(version) <= parse_version(config.VERSION):
        return {"version": config.VERSION, "updated": False, "text": f"Asistent {config.VERSION} is the newest version."}
    b = info["bundle"]
    work = os.path.join(config.app_dir(), "updates", version)
    os.makedirs(work, exist_ok=True)
    zpath = os.path.join(work, b["name"])
    if not (os.path.isfile(zpath) and _sha256(zpath) == b["sha256"]):
        _download(_asset_url(version, b["name"]), zpath, int(b["size"]),
                  lambda f: progress(0.05 + 0.55 * f, f"Downloading Asistent {version}…"), cancelled)
    if _sha256(zpath) != b["sha256"]:
        os.remove(zpath)
        raise ValueError("The download is damaged (its checksum does not match). Try again.")
    progress(0.62, "Unpacking…")
    root = _extract(zpath, os.path.join(work, "files"))
    from . import asr
    reqs = changed_requirements(root, install.current_dir(), asr.backend_installed())
    if cancelled():
        raise InterruptedError("Cancelled.")
    # 0.10.6 (ARCH-002): the installed version is kept first; anything failing below puts it back
    progress(0.63, "Keeping the installed version…")
    install.snapshot(_venv_python())
    stages: list = []
    try:
        done = _apply(root, reqs, progress, cancelled, stages)
    except BaseException as e:
        failed = install.rollback(stages, _venv_python())
        log.error("update to %s failed (%s); put back: %s", version, e, "everything" if not failed else "all but " + ", ".join(failed))
        if failed:
            raise RuntimeError(f"The update failed ({e}) and could not put back {', '.join(failed)}.") from e
        if isinstance(e, InterruptedError):
            raise
        raise RuntimeError(f"The update failed and Asistent {config.VERSION} was put back: {e}") from e
    for d in os.listdir(os.path.dirname(work)):                       # keep only this update's download
        if d != version:
            shutil.rmtree(os.path.join(os.path.dirname(work), d), ignore_errors=True)
    text = f"Updated to Asistent {version}. The engine restarts now"
    text += "; close and reopen Premiere once to load the Asistent host." if done["host_new"] else "."
    if done["fonts"]:
        text += " New fonts appear in Premiere after its next restart."
    with open(_last_path(), "w", encoding="utf-8") as f:
        json.dump({"version": version, "text": text}, f)
    install.mark_pending(version, config.VERSION)                     # run_engine.py puts it back if it never starts
    restart_soon()
    return {"version": version, "updated": True, "text": text, "notes": info.get("notes") or ""}


def _apply(root: str, reqs: list, progress, cancelled, stages: list) -> dict:
    """The packages, then the files, the host and the panel; `stages` says how far it got."""
    for i, name in enumerate(reqs):
        if cancelled():
            raise InterruptedError("Cancelled.")
        stages.append("packages")
        progress(0.65 + 0.15 * i / len(reqs), "Installing Python packages…")
        lock = os.path.join(root, name.replace(".txt", f"-lock-{'mac' if sys.platform == 'darwin' else 'win'}.txt"))
        args = ["--require-hashes", "-r", lock] if os.path.isfile(lock) else ["-r", os.path.join(root, name)]   # 0.10.6
        r = subprocess.run([_venv_python(), "-m", "pip", "install", "-q", *args],
                           capture_output=True, text=True, timeout=1800)
        if r.returncode:
            raise RuntimeError("pip could not install the new packages: " + (r.stderr or r.stdout).strip()[-400:])
    progress(0.82, "Putting the files in place…")
    return install.install_all(root, stages=stages)


# ---------------------------------------------------------------- restart

def _under_launchd() -> bool:
    return sys.platform == "darwin" and os.environ.get("XPC_SERVICE_NAME") == LAUNCHD_LABEL


def restart_soon(delay: float = 2.0) -> None:
    """Exit after the job result has been read; the engine comes back on the new code.

    Mac: the LaunchAgent starts it again after a non-zero exit. Elsewhere (Windows Startup shortcut, a hand start):
    a detached new engine is started first; it waits until this one has let the port go (server.main)."""
    def go():
        time.sleep(delay)
        log.info("restarting the engine after an update")
        if not _under_launchd():
            script = os.path.join(install.current_dir(), "engine", "run_engine.py")
            exe = sys.executable
            if sys.platform == "win32" and exe.lower().endswith("python.exe"):
                exe = exe[:-len("python.exe")] + "pythonw.exe"              # no console window
            flags = 0
            if sys.platform == "win32":
                flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | 0x01000000   # BREAKAWAY_FROM_JOB
            subprocess.Popen([exe, script], cwd=config.app_dir(), env={**os.environ, "ASISTENT_RESTART": "1"},
                             creationflags=flags, start_new_session=sys.platform != "win32",
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
        logging.shutdown()
        os._exit(RESTART_EXIT if _under_launchd() else 0)
    threading.Thread(target=go, daemon=True).start()
