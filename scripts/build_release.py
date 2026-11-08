"""Build what a GitHub release carries: dist/Asistent-<version>.zip and dist/latest.json.

The zip is everything a computer needs (engine, host, scripts with the double-click installers, fonts, requirements,
licences, README, the panel .ccx); latest.json names it with its SHA-256, which the updater checks before installing.
    python3 scripts/build_release.py        (run scripts/publish_release.sh to upload; only when the user asks)
"""
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS = ("engine", "host", "scripts", "fonts")
FILES = ("requirements.txt", "requirements-asr.txt", "requirements-lock-mac.txt", "requirements-asr-lock-mac.txt", "requirements-align.txt", "LICENSES.md", "README.md")
SKIP_DIRS = {"__pycache__", ".pytest_cache", "githooks"}
SKIP_FILES = {".DS_Store", "devbridge.enabled"}
INSTALLERS = ("Install Asistent (Mac).command", "Install Asistent (Windows).cmd")   # at the top of the zip, easy to find
SKIP_SCRIPTS = set(INSTALLERS) | {"dev_cmd.py", "check_subtitles.py", "measure_learning.py", "caption_template.jsx", "caption_template.sh", "build_release.py",
                "publish_release.sh", "release_mac.sh"}
EXECUTABLE = (".sh", ".command")


def version() -> str:
    with open(os.path.join(REPO, "panel", "manifest.json"), encoding="utf-8") as f:
        return json.load(f)["version"]


def notes(ver: str) -> str:
    """The CHANGELOG entry of this version, as the release text and the update's "what is new"."""
    with open(os.path.join(REPO, "CHANGELOG.md"), encoding="utf-8") as f:
        text = f.read()
    m = re.search(r"^## (?:[\d.]+-)?" + re.escape(ver) + r"\b.*?$(.*?)(?=^## )", text, re.M | re.S)
    return (m.group(0).strip() if m else f"Asistent {ver}")


def files(ccx: str):
    """-> (path on disk, name in the zip) for everything that goes in."""
    for part in PARTS:
        for root, dirs, names in os.walk(os.path.join(REPO, part)):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
            for n in sorted(names):
                if n in SKIP_FILES or n.endswith((".pyc", ".log")) or (part == "scripts" and n in SKIP_SCRIPTS):
                    continue
                p = os.path.join(root, n)
                yield p, os.path.relpath(p, REPO)
    for n in FILES:
        yield os.path.join(REPO, n), n
    for n in INSTALLERS:
        yield os.path.join(REPO, "scripts", n), n
    yield ccx, os.path.basename(ccx)


def build() -> dict:
    ver = version()
    ccx = subprocess.run([os.path.join(REPO, "scripts", "package_ccx.sh")], check=True, capture_output=True,
                         text=True).stdout.strip().splitlines()[-1]
    dist = os.path.join(REPO, "dist")
    name = f"Asistent-{ver}.zip"
    out = os.path.join(dist, name)
    root = f"Asistent-{ver}"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for path, arc in files(ccx):
            info = zipfile.ZipInfo.from_file(path, f"{root}/{arc}")
            # the installers must stay runnable after unzipping on a Mac (Finder keeps these bits)
            info.external_attr = (stat.S_IFREG | (0o755 if arc.endswith(EXECUTABLE) else 0o644)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(path, "rb") as f:
                z.writestr(info, f.read())
    h = hashlib.sha256()
    with open(out, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    latest = {"version": ver, "bundle": {"name": name, "sha256": h.hexdigest(), "size": os.path.getsize(out)},
              "notes": notes(ver)}
    with open(os.path.join(dist, "latest.json"), "w", encoding="utf-8") as f:
        json.dump(latest, f, ensure_ascii=False, indent=1)
    with open(os.path.join(dist, "notes.md"), "w", encoding="utf-8") as f:
        f.write(latest["notes"] + "\n")
    return latest


if __name__ == "__main__":
    info = build()
    print(json.dumps({k: v for k, v in info.items() if k != "notes"}, indent=1))
    sys.exit(0)
