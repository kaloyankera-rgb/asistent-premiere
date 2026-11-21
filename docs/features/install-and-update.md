# Install and update

## What it does
How Asistent gets onto a computer and stays current. A release zip (or the repo, on the development Mac) is put in
place by one installer: the engine files, the Asistent host (a small CEP extension), the fonts and the panel (`.ccx`).
After that, the panel shows "Asistent X is available" with an Update button, and one press installs the newest release.

## How to use it
1. Development Mac, after every change: bump the version in `panel/manifest.json` and `engine/asistent/config.py`, run
   the tests, then `scripts/release_mac.sh` (packs the `.ccx`, runs `setup_mac.sh`, checks the engine answers).
2. A Mac with nothing set up: the one-click `installer/mac/Install Asistent.command` (packed by `installer/mac/build.sh`).
3. Any other computer: unzip `Asistent-<version>.zip` from the GitHub release, double-click
   `Install Asistent (Mac).command` or `Install Asistent (Windows).cmd` (they call `setup_mac.sh` / `setup_win.ps1`).
4. Editors: press Update in the panel. The engine restarts by itself; a first host install needs one Premiere restart.
5. Publishing, only when the user asks, after commit and push: `scripts/publish_release.sh`.
6. Trying an update before publishing: a folder named in `<app>/update_source.txt` replaces GitHub (delete the file after).

## Key points: do not break
- Releases only when the user asks. `publish_release.sh` refuses an uncommitted or unpushed tree and a version that is
  already published. A published version is never moved or replaced: fix forward with a new version.
- The repo is public and the updater needs it public (while private, every check gets 404). Nothing private in commits;
  history is never rewritten; push only with the user's approval each time.
- The engine runs from `<app>/current`, not from the repo. The zip is built from the repo by `build_release.py`.
- A new panel module must be added to the list in `scripts/package_ccx.sh`; `tests/wiring.test.js` fails otherwise.
- Update never starts while a job runs (the server answers 409). Packages are installed only when a requirements file
  changed. The download's SHA-256 must match `latest.json`; zip paths outside the folder are refused.
- The installed version is copied to `<app>/previous` first and put back when pip, files, host or panel fail. An engine
  that does not start 3 times after an update is put back by `run_engine.py` (standard library only, so it still works
  when the new engine is broken). The panel says so once (`updates/last.json`).
- Exactly one Asistent panel version must be listed by Adobe's installer and by Premiere's own plugin list; otherwise
  Premiere loads an older one. `install_panel` removes every copy and installs again (0.10.10, 0.10.71). The `.ccx` path
  must be absolute.
- The panel's settings live in the engine (`<app>/panel_store.json`), never only in UXP localStorage: every update
  deletes the old panel and its storage (0.10.17). Keys start with `asistent.`.
- Model downloads and the dictionary are pinned to a commit and a SHA-256 (`pins.py`, the setup scripts): a new model is
  a deliberate change there. Mac installs are hash-locked (`requirements-*-lock-mac.txt`, `lock_requirements.py`).
- The host is separate from Quick Search; never import, call or change Quick Search. `host.jsx` is read per command, so
  edits to it need no restart; a NEW extension does.

## Decisions
- DECISIONS 2026-11-04: updates through GitHub releases, installed only when the editor presses Update.
- DECISIONS "Architecture" (undated): Adobe's UnifiedPluginInstallerAgent installs the panel with no dialog.
- DECISIONS 2026-11-08 (audit of 0.10.1, 0.10.6): updates can always go back; packages restored from a pip freeze.
- DECISIONS 2026-11-01: a small CEP host for the caption track (0.9.45); PlayerDebugMode set for CSXS 10 to 13.
- CHANGELOG 0.10.10, 0.10.17 (no DECISIONS entry): one panel version; panel settings kept by the engine.
- No DECISIONS entry for `installer/mac` (commits of 2026-11-20): Python 3.12 and FFmpeg downloaded into Asistent's folder.

## Code map
- Release: `scripts/release_mac.sh`, `package_ccx.sh` (writes `panel/version.js`), `build_release.py`, `publish_release.sh`.
- Setup: `scripts/setup_mac.sh` (venv, LaunchAgent), `setup_win.ps1` (venv, Startup shortcut), `uninstall_mac.sh`, `installer/mac/`.
- Engine: `engine/asistent/install.py` (sync, host, fonts, panel, snapshot, rollback), `updater.py`, `pins.py`, `panelstore.py`,
  `config.py` (VERSION, app folder), `engine/run_engine.py` (boot check). Endpoints in `server.py`: `/update/check`,
  `/update/install`, `/panel/store`.
- Panel: `panel/main.js` (`checkUpdate`, `onUpdate`), `store.js`, `engine.js`. Host: `host/` (`CSXS/manifest.xml`, `main.js`, `host.jsx`).
- Locks: `requirements*.txt`, `scripts/lock_requirements.py`. Rollback of features: `docs/ROLLBACK.md`.

## Status
- Mac development machine: install, update to a local test release and rollback tests verified (0.9.87, 0.10.6, 0.10.10).
  Releases up to v0.10.118 are tagged locally; 0.10.120 is installed here, not released. Editors on 0.10.24 were offered
  0.10.70 (2026-11-12); that an editor's Mac then updated is unverified.
- `installer/mac`: pushed 2026-11-20; a full run on a clean Mac and its published link are unverified.
- Windows: `setup_win.ps1`, registry entries, the installer call and the detached restart never run. No Windows lock file
  (Windows installs from `requirements.txt`); CUDA pins untried (`BUGS.md`, `TODO.md` A and W).
- The shipped host manifest still says 0.9.45; the installed version is the panel's.

## Tests
- `tests/test_updater.py`: check, install, damaged download, zip contents, rollback, boot check, changed requirements.
- `tests/test_install_panel.py`: one panel version, retry, absolute path. `tests/test_panelstore.py`, `tests/store.test.js`.
- `tests/wiring.test.js`: panel modules packed. No test for the setup scripts, `publish_release.sh` or `installer/mac`.
