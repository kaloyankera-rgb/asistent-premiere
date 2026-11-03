"""The updater and the installer, on a release zip built from this repo, with GitHub, Premiere's folders and the
restart replaced: nothing here touches the network, Premiere or the real app folder."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile

import pytest

from asistent import config, install, updater

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture
def app(tmp_path, monkeypatch):
    """A private app folder, CEP folder and fonts folder; no defaults/registry writes, no Adobe installer, no restart."""
    a = tmp_path / "app"
    a.mkdir()
    monkeypatch.setattr(config, "app_dir", lambda: str(a))
    monkeypatch.setattr(install, "cep_dir", lambda: str(tmp_path / "cep"))
    monkeypatch.setattr(install, "font_dir", lambda: str(tmp_path / "fonts"))
    monkeypatch.setattr(install, "_debug_mode", lambda: None)
    panels = []
    monkeypatch.setattr(install, "install_panel", lambda ccx, ver: panels.append((os.path.basename(ccx), ver)))
    restarts = []
    monkeypatch.setattr(updater, "restart_soon", lambda *a: restarts.append(True))
    updater._cache.update(at=0.0, info=None)
    return {"dir": a, "tmp": tmp_path, "panels": panels, "restarts": restarts}


def fake_release(tmp_path, version):
    """A release zip like build_release.py makes (engine, host, fonts, requirements, a .ccx), at another version."""
    root = tmp_path / "src" / f"Asistent-{version}"
    for part in ("engine", "host", "fonts"):
        shutil.copytree(os.path.join(REPO, part), root / part, ignore=install.SKIP)
    for f in ("requirements.txt", "requirements-asr.txt"):
        shutil.copy(os.path.join(REPO, f), root / f)
    cfg = root / "engine" / "asistent" / "config.py"
    cfg.write_text(cfg.read_text().replace(f'VERSION = "{config.VERSION}"', f'VERSION = "{version}"'))
    ccx = root / f"Asistent-{version}.ccx"
    with zipfile.ZipFile(ccx, "w") as z:
        z.writestr("manifest.json", json.dumps({"version": version}))
    zpath = tmp_path / f"Asistent-{version}.zip"
    with zipfile.ZipFile(zpath, "w") as z:
        for p in root.rglob("*"):
            if p.is_file():
                z.write(p, p.relative_to(root.parent))
    data = zpath.read_bytes()
    return zpath, {"version": version, "bundle": {"name": zpath.name, "sha256": hashlib.sha256(data).hexdigest(),
                                                  "size": len(data)}, "notes": "## 9.9.9 - test"}


def test_versions_compare_as_numbers():
    assert updater.parse_version("0.9.10") > updater.parse_version("0.9.9")
    assert updater.parse_version("v1.0.0") > updater.parse_version("0.99.99")


def test_check_says_newer_only_for_a_higher_version(app, monkeypatch):
    for ver, newer in (("9.9.9", True), (config.VERSION, False), ("0.0.1", False)):
        info = {"version": ver, "bundle": {"name": "a.zip", "sha256": "0" * 64, "size": 10}}
        monkeypatch.setattr(updater, "_get", lambda url, timeout=15.0, i=info: json.dumps(i).encode())
        r = updater.check(force=True)
        assert r["newer"] is newer and r["latest"] == ver and r["current"] == config.VERSION


def test_check_offline_is_an_answer_not_an_error(app, monkeypatch):
    def boom(url, timeout=15.0):
        raise OSError("no network")
    monkeypatch.setattr(updater, "_get", boom)
    r = updater.check(force=True)
    assert "error" in r and "newer" not in r


def test_a_bundle_name_with_a_path_is_refused(monkeypatch):
    info = {"version": "9.9.9", "bundle": {"name": "../x.zip", "sha256": "0" * 64, "size": 10}}
    monkeypatch.setattr(updater, "_get", lambda url, timeout=15.0: json.dumps(info).encode())
    with pytest.raises(ValueError):
        updater.latest()


def test_extract_refuses_paths_outside_the_folder(tmp_path):
    z = tmp_path / "evil.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("../outside.txt", "x")
    with pytest.raises(ValueError):
        updater._extract(str(z), str(tmp_path / "out"))
    assert not (tmp_path / "outside.txt").exists()


def test_update_installs_everything_and_restarts(app, monkeypatch):
    zpath, info = fake_release(app["tmp"], "9.9.9")
    monkeypatch.setattr(updater, "latest", lambda: info)
    monkeypatch.setattr(updater, "_download", lambda url, dest, size, progress, cancelled: shutil.copy(zpath, dest))
    monkeypatch.setattr(updater, "changed_requirements", lambda new, cur, asr: [])
    steps = []
    r = updater.install_update(lambda f, m: steps.append(m), lambda: False)
    assert r["updated"] and r["version"] == "9.9.9"
    cur = app["dir"] / "current"
    assert 'VERSION = "9.9.9"' in (cur / "engine" / "asistent" / "config.py").read_text()
    assert (cur / "engine" / "run_engine.py").is_file()
    assert (app["tmp"] / "cep" / install.HOST_ID / "host.jsx").is_file()
    assert (app["tmp"] / "fonts" / "Montserrat-Bold.ttf").is_file()
    assert app["panels"] == [("Asistent-9.9.9.ccx", "9.9.9")]
    assert app["restarts"] == [True]
    assert "close and reopen Premiere once" in r["text"]          # the first host install needs one restart
    last = json.loads((app["dir"] / "updates" / "last.json").read_text())
    assert last["version"] == "9.9.9"


def test_a_damaged_download_is_not_installed(app, monkeypatch):
    zpath, info = fake_release(app["tmp"], "9.9.9")
    info["bundle"]["sha256"] = "f" * 64
    monkeypatch.setattr(updater, "latest", lambda: info)
    monkeypatch.setattr(updater, "_download", lambda url, dest, size, progress, cancelled: shutil.copy(zpath, dest))
    with pytest.raises(ValueError, match="damaged"):
        updater.install_update(lambda f, m: None, lambda: False)
    assert not (app["dir"] / "current").exists() and app["panels"] == [] and app["restarts"] == []


def test_no_update_when_already_newest(app, monkeypatch):
    monkeypatch.setattr(updater, "latest", lambda: {"version": config.VERSION, "bundle": {}})
    r = updater.install_update(lambda f, m: None, lambda: False)
    assert r["updated"] is False and app["restarts"] == []


def test_the_new_panel_hears_about_the_update_once(app, monkeypatch):
    monkeypatch.setattr(updater, "_get", lambda url, timeout=15.0: (_ for _ in ()).throw(OSError("offline")))
    os.makedirs(app["dir"] / "updates")
    (app["dir"] / "updates" / "last.json").write_text(json.dumps({"version": config.VERSION, "text": "Updated."}))
    assert updater.check()["just_updated"] == "Updated."
    assert "just_updated" not in updater.check()


def test_only_changed_requirements_are_installed_again(tmp_path):
    new, cur = tmp_path / "new", tmp_path / "cur"
    new.mkdir(), cur.mkdir()
    (new / "requirements.txt").write_text("numpy==2\n")
    (cur / "requirements.txt").write_text("numpy==2\n")
    (new / "requirements-asr.txt").write_text("a==2\n")
    (cur / "requirements-asr.txt").write_text("a==1\n")
    assert updater.changed_requirements(str(new), str(cur), asr_installed=True) == ["requirements-asr.txt"]
    assert updater.changed_requirements(str(new), str(cur), asr_installed=False) == []
    (new / "requirements.txt").write_text("numpy==3\n")
    assert updater.changed_requirements(str(new), str(cur), asr_installed=False) == ["requirements.txt"]


def test_sync_replaces_a_part_whole(tmp_path):
    src, dest = tmp_path / "src", tmp_path / "dest"
    (src / "engine").mkdir(parents=True)
    (src / "engine" / "a.py").write_text("new")
    (dest / "engine").mkdir(parents=True)
    (dest / "engine" / "gone.py").write_text("old")
    install.sync(str(src), str(dest))
    assert (dest / "engine" / "a.py").read_text() == "new" and not (dest / "engine" / "gone.py").exists()


def test_the_release_zip_has_what_a_computer_needs(tmp_path):
    if shutil.which("zip") is None:
        pytest.skip("zip is needed to pack the panel")
    r = subprocess.run([sys.executable, os.path.join(REPO, "scripts", "build_release.py")], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    ver = json.load(open(os.path.join(REPO, "panel", "manifest.json")))["version"]
    latest = json.load(open(os.path.join(REPO, "dist", "latest.json")))
    assert latest["version"] == ver
    with zipfile.ZipFile(os.path.join(REPO, "dist", latest["bundle"]["name"])) as z:
        names = {n.split("/", 1)[1] for n in z.namelist()}
        mode = z.getinfo(f"Asistent-{ver}/scripts/setup_mac.sh").external_attr >> 16
    for need in ("engine/run_engine.py", "engine/asistent/updater.py", "engine/asistent/install.py",
                 "engine/asistent/models/face_detection_yunet_2023mar.onnx", "host/host.jsx", "host/CSXS/manifest.xml",
                 "scripts/setup_mac.sh", "scripts/setup_win.ps1", "fonts/Montserrat-Bold.ttf", "fonts/OFL.txt",
                 "requirements.txt", "requirements-asr.txt", "LICENSES.md", f"Asistent-{ver}.ccx",
                 "Install Asistent (Mac).command", "Install Asistent (Windows).cmd"):
        assert need in names, need
    assert not any("__pycache__" in n or n.startswith("tests/") or "dev_cmd.py" in n for n in names)
    assert mode & 0o111
