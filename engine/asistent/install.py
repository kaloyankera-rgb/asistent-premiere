"""Putting a release in place, the same way on Mac and Windows: used by the setup scripts and by the updater.

A release (the repo itself, or the `Asistent-<version>.zip` of a GitHub release) has engine/, host/, scripts/, fonts/,
the requirements files and the panel `.ccx`. Installed, it lives in `<app>/current/` (the engine runs from there, so a
computer needs no copy of the repo), the host goes to Premiere's CEP folder, the fonts to the user's fonts, and the
panel through Adobe's UnifiedPluginInstallerAgent (no dialog; an open Premiere loads the new panel at once).

Standard library only: the setup scripts run this before the engine's packages are installed.
    python -m asistent.install --src <release root> [--ccx <file>] [--no-panel]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys

from . import config

HOST_ID = "com.contentstudio.asistent.host"
PANEL_NAME = "Asistent"
CSXS_VERSIONS = (10, 11, 12, 13)          # CEP loads an unsigned extension only with PlayerDebugMode=1 (as Quick Search)
PARTS = ("engine", "host", "scripts", "fonts")
FILES = ("requirements.txt", "requirements-asr.txt", "requirements-align.txt", "requirements-dev.txt", "LICENSES.md",
         "README.md")
SKIP = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store", "tests")
FONTS = ("Montserrat-Bold.ttf",)          # the ReShape style's Bulgarian line (OFL, fonts/OFL.txt)


def current_dir() -> str:
    return os.path.join(config.app_dir(), "current")


def _same(a: str, b: str) -> bool:
    return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))


def sync(src: str, dest: str | None = None) -> str:
    """Copy the release parts from `src` into `<app>/current` (old files of a part are removed first)."""
    dest = dest or current_dir()
    if _same(src, dest):
        return dest
    os.makedirs(dest, exist_ok=True)
    for part in PARTS:
        s = os.path.join(src, part)
        if not os.path.isdir(s):
            continue
        d = os.path.join(dest, part)
        tmp = d + ".new"
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.copytree(s, tmp, ignore=SKIP)
        old = d + ".old"
        shutil.rmtree(old, ignore_errors=True)
        if os.path.isdir(d):
            os.replace(d, old)            # a rename, so a running engine keeps its loaded modules and the swap is whole
        os.replace(tmp, d)
        shutil.rmtree(old, ignore_errors=True)
    for f in FILES:
        if os.path.isfile(os.path.join(src, f)):
            shutil.copy2(os.path.join(src, f), os.path.join(dest, f))
    return dest


# ---------------------------------------------------------------- the host (CEP)

def cep_dir() -> str:
    if sys.platform == "win32":
        return os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "Adobe", "CEP", "extensions")
    return os.path.expanduser("~/Library/Application Support/Adobe/CEP/extensions")


def _debug_mode() -> None:
    if sys.platform == "win32":
        import winreg
        for v in CSXS_VERSIONS:
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Adobe\CSXS.{v}") as k:
                winreg.SetValueEx(k, "PlayerDebugMode", 0, winreg.REG_SZ, "1")
    elif sys.platform == "darwin":
        for v in CSXS_VERSIONS:
            subprocess.run(["defaults", "write", f"com.adobe.CSXS.{v}", "PlayerDebugMode", "1"], check=False)


def install_host(src_host: str) -> bool:
    """-> True on the first install (Premiere must be restarted once to load it); later changes apply without."""
    dest = os.path.join(cep_dir(), HOST_ID)
    new = not os.path.isdir(dest)
    os.makedirs(cep_dir(), exist_ok=True)
    shutil.rmtree(dest + ".new", ignore_errors=True)
    shutil.copytree(src_host, dest + ".new", ignore=SKIP)
    shutil.rmtree(dest, ignore_errors=True)
    os.replace(dest + ".new", dest)
    _debug_mode()
    return new


# ---------------------------------------------------------------- the panel (UXP, through Adobe's installer)

def upia() -> str | None:
    if sys.platform == "win32":
        base = os.environ.get("CommonProgramFiles", r"C:\Program Files\Common Files")
        p = os.path.join(base, "Adobe", "Adobe Desktop Common", "RemoteComponents", "UPI", "UnifiedPluginInstallerAgent",
                         "UnifiedPluginInstallerAgent.exe")
    else:
        p = ("/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/"
             "UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent")
    return p if os.path.isfile(p) else None


def _flag(name: str) -> str:
    return ("/" if sys.platform == "win32" else "--") + name


def install_panel(ccx: str, version: str) -> None:
    """Remove, then install (an open Premiere unloads the old panel and loads the new one). Raises with a message."""
    agent = upia()
    if not agent:
        raise RuntimeError("Adobe's plugin installer was not found (Creative Cloud): double-click " + os.path.basename(ccx))
    subprocess.run([agent, _flag("remove"), PANEL_NAME], capture_output=True, timeout=120)
    r = subprocess.run([agent, _flag("install"), ccx], capture_output=True, text=True, timeout=300)
    listed = subprocess.run([agent, _flag("list"), "all"], capture_output=True, text=True, timeout=120).stdout
    if not any(PANEL_NAME in ln and version in ln for ln in listed.splitlines()):
        raise RuntimeError(f"Adobe does not report {PANEL_NAME} {version} as installed: {(r.stdout or r.stderr).strip()[-300:]}")


# ---------------------------------------------------------------- fonts

def font_dir() -> str:
    if sys.platform == "win32":
        return os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Microsoft", "Windows", "Fonts")
    return os.path.expanduser("~/Library/Fonts")


def install_fonts(src_fonts: str) -> list[str]:
    """Copy the release's fonts into the user's fonts if missing (no admin rights needed) -> the names added.
    Premiere sees a new font after a restart."""
    added = []
    for name in FONTS:
        s = os.path.join(src_fonts, name)
        d = os.path.join(font_dir(), name)
        if not os.path.isfile(s) or os.path.isfile(d):
            continue
        os.makedirs(font_dir(), exist_ok=True)
        shutil.copy2(s, d)
        if sys.platform == "win32":                    # a per-user font is known to Windows by this registry entry
            import winreg
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Fonts") as k:
                winreg.SetValueEx(k, os.path.splitext(name)[0].replace("-", " ") + " (TrueType)", 0, winreg.REG_SZ, d)
        added.append(name)
    return added


# ---------------------------------------------------------------- all of it

def find_ccx(src: str) -> str | None:
    found = sorted(glob.glob(os.path.join(src, "Asistent-*.ccx")) + glob.glob(os.path.join(src, "dist", "Asistent-*.ccx")))
    return found[-1] if found else None


def install_all(src: str, ccx: str | None = None, panel: bool = True) -> dict:
    """The release at `src` -> installed. Returns what was done, for the caller to say."""
    cur = sync(src)
    out = {"current": cur, "host_new": install_host(os.path.join(cur, "host"))}
    out["fonts"] = install_fonts(os.path.join(cur, "fonts")) if os.path.isdir(os.path.join(cur, "fonts")) else []
    ccx = ccx or find_ccx(src)
    if panel and ccx:
        install_panel(ccx, ccx_version(ccx))
        out["panel"] = os.path.basename(ccx)
    return out


def ccx_version(ccx: str) -> str:
    import zipfile
    with zipfile.ZipFile(ccx) as z:
        return json.loads(z.read("manifest.json"))["version"]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m asistent.install")
    ap.add_argument("--src", required=True, help="the release root (repo or unpacked release zip)")
    ap.add_argument("--ccx", help="the panel package (default: Asistent-*.ccx in the release root or its dist/)")
    ap.add_argument("--no-panel", action="store_true", help="leave the panel as it is")
    a = ap.parse_args(argv)
    try:
        out = install_all(os.path.abspath(a.src), a.ccx, not a.no_panel)
    except (OSError, RuntimeError, subprocess.SubprocessError) as e:
        print(f"Install failed: {e}")
        return 1
    print("Asistent files are in " + out["current"])
    print("Asistent host is installed. Close and reopen Premiere once to load it." if out["host_new"] else "Asistent host is updated.")
    if out["fonts"]:
        print("Fonts added: " + ", ".join(out["fonts"]) + " (Premiere sees them after a restart).")
    if out.get("panel"):
        print("Panel installed: " + out["panel"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
