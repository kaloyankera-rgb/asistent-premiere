# Rollback and protection (2026-11 improvements)

The 2026-11 improvements (branch `improvements/2026-11`, the user's implementation prompt of 2026-11-08) are built so
that each one can be switched off, reverted or have its data restored on its own, without losing the others.

## The protected starting point
- Local tag `backup/pre-improvements-2026-11-08` = commit `fbe0b28`, version 0.10.8 (never pushed).
- Full private backup (Git bundle, whole working tree incl. untracked files, app data, installed panel/host, LaunchAgent,
  model hashes, restore steps): `~/Kaloyan/07_ARCHIVE/_backups/Asistent 2026-11-08 pre-improvements/MANIFEST.md`.
  Read-only; never edit or delete it. Restore steps are in that manifest, part by part.
- Never restore a backup over newer editor work without comparing first and saying what would be replaced.

## The ReShape preset is protected
- `scripts/reshape_guard.py`: lists the files of the ReShape path changed since the tag (exit 1 if any). Run before
  every commit of this work.
- `tests/test_reshape_baseline.py` + `tests/fixtures/reshape_baseline.json`: the preset settings, shared constants and
  byte-exact captions for 36 synthetic inputs (12 texts x 25 / 29.97 / 30 fps), made by the tag's code (checked on a
  clone of the tag). Never regenerate the fixture to make a failure pass.
- `scripts/reshape_golden.py check`: the whole subtitle job (recognition, alignment, grouping, English) on the client's
  own 68 s ReShape recording, compared byte for byte with the run recorded at the tag. Private store:
  `~/Kaloyan/07_ARCHIVE/_backups/Asistent baselines/reshape/` (read-only). Cold run ~75 s. Limit: the office
  "ReShape Subtitle Learning" folder was not reachable, so this run uses no learned fixes (0 rules); learned-fix use
  stays covered by `tests/test_learning.py`.

## Per feature: how to switch off, revert, restore
| Feature | Switch off | Revert code | Data it adds (restore) |
|---|---|---|---|
| ReShape guard, baseline test, golden harness (dev only) | not part of the app | revert its commit | golden store outside the repo; delete it only if the baseline is no longer wanted |
| Recognition benchmark (dev only) | not part of the app | revert its commit | `<app>/venv-bench` (delete to remove), private store `~/Kaloyan/02_RESOURCES/Asistent benchmark/` (references a person verified: keep) |
| Captions review helpers (0.10.9) | Captions tab > uncheck Review helpers (remembered; the list is as before) | revert the 0.10.9 commit (review.py, listen.py, reviewplan.js, the two endpoints, the Captions tab additions) | none: it only reads the run's JSON. 0.10.11: ▶ plays through the host (`play`/`play_stop` in host.jsx); revert that commit for the 0.10.9 behaviour |
| whisper.cpp experiment (dev only) | not part of the app | revert its commit | `<app>/experiments/whisper.cpp` (build + 3.1 GB model: delete the folder to remove); Homebrew `cmake` (`brew uninstall cmake`) |
| Installer: one panel version (0.10.10) | not switchable (it is how an update installs) | revert the 0.10.10 commit (install.py) | none; if a panel ever goes missing: double-click `dist/Asistent-<version>.ccx` |
