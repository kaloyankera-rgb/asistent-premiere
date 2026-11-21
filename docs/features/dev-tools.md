# Development tools

## What it does
Tools for building and checking Asistent itself, not for editors: the test bridge that drives the panel and the host
inside Premiere, a browser preview of the panel, a CSS probe, logs, the benchmarks, the ReShape guard and the git hook.
Editors only meet the Log tab and the Lumetri probe button in Settings.

## How to use it
1. Bridge on: `python3 scripts/dev_cmd.py on` (creates `devbridge.enabled` in the app folder), then `ping`, `state`,
   `click "<label>"`, `wait_idle`, `select`, `lumetri`, `chain`, `frame`, `api`, `uxp_eval` (the docstring lists all).
   `dev_cmd.py off` removes the flag. Premiere and the panel must be open, in `TEST.prproj` or `NEW TEST.prproj`.
2. Host: `dev_cmd.py host ping|probe|captions|eval`, `host_status`. Two Premieres side by side: `ASISTENT_LANE=27`.
3. Preview: `cd preview && npm install`, then `node preview/shoot.js <label> [--compare <earlier>] [--only a,b]`.
   Shots land in `preview/shots/` (ignored by git). Look at them before installing.
4. CSS: `dev_cmd.py css_probe` measures what this UXP supports.
5. Logs: the panel's Log tab; `logs/engine.log` in the app folder; Premiere's `UXPLogs_*` and crash dumps (paths in CLAUDE.md).
6. Tests, safely: point `HOME` at a scratch folder holding a copy of `models/lexicon`, call the app venv's python by its
   full path, run `python -m pytest tests -q -W error -p no:cacheprovider` and `node --test tests/*.test.js`.
7. Subtitle path touched: `scripts/reshape_guard.py`, then `scripts/reshape_golden.py check`; recognition changes go
   through `scripts/bench_subtitles.py` (commands in `docs/BENCHMARK.md`).

## Key points: do not break
- Bridge only in the two test projects: the panel refuses every command but `ping` elsewhere, and `host eval` checks the
  project name too. The flag file is git-ignored and never packed. Never close or restart Premiere without asking; never
  look at client frames (measure with numbers); never test in a client project.
- The bridge proves the DOM and the numbers, not what is painted. After a layout or look change ask the user for one look.
  Report "works through the bridge", never "looks right". Known limits: a command sent while a job runs waits until the
  job ends; a Cancel press cannot be delivered; `fill` on a checkbox throws (`BUGS.md`).
- `dev_cmd.py` hard-codes the Mac app folder and port 47390: Mac only. Same localhost-only `X-Asistent` protection as the engine.
- Measured UXP CSS (0.9.71-0.9.72): flexbox, absolute position, variables, calc, transform, ellipsis, width media
  queries, inline SVG. Not gap, grid, transitions, animations, :focus-visible, matchMedia, header/footer. Buttons are
  `div.btn`. An absolutely placed element paints over the panel. Chrome is not UXP: Premiere is the final check.
- `preview/` is never packed; `scripts/githooks` is not in the release zip either.
- Benchmarks read the editors' videos only: the office share is read only, stores are private and outside the repo, a
  scratch `HOME` and empty `project` are used, and `bench_subtitles.py cloud --upload` sends sound out, so only on the
  user's yes. Tune on the dev set, never on held-out; never regenerate `tests/fixtures/reshape_baseline.json`.
- `reshape_guard.py` exits 1 when a protected file changed since the local tag `backup/pre-improvements-2026-11-08`.
- The pre-commit hook (`git config core.hooksPath scripts/githooks`) refuses code commits without `CHANGELOG.md` and
  `PROJECT_STATUS.md` staged. `--no-verify` only for a deliberate exception (typo, test-only).

## Decisions
- DECISIONS 2026-11-03: Asistent draws its own buttons (`div.btn`) after the CSS probe; Playwright only for screenshots.
- DECISIONS 2026-11-12: Settings holds only the developer tools (plus the key card since 0.10.119); the Log is an icon tab.
- DECISIONS 2026-11-21: subtitles are judged by the benchmark first (the ElevenLabs entry); ReShape stays on `CLASSIC`.
- CHANGELOG 0.10.45, 0.10.6: bridge lanes; command lifecycle queued, taken, done (no DECISIONS entry).

## Code map
- Bridge: `engine/asistent/devbridge.py` (`Bridge`, `enabled`), `/dev/*` and `/host/*` in `server.py`, `panel/devbridge.js`
  (`createBridge`), `scripts/dev_cmd.py`, `engine/asistent/hostbridge.py`, `host/host.jsx` (`as_run`, `as_eval`).
- CSS: `panel/cssprobe.js`. Preview: `preview/index.html`, `boot.js`, `scenarios.js`, `shoot.js`.
- UI: `panel/index.html` (`paneLog`, `paneSettings`, `probe`), `panel/main.js`. Logging: `config.setup_logging` (1 MB, 3 backups).
- Benchmarks: `scripts/bench_asr.py`, `bench_subtitles.py`, `bench_decode.py`, `bench_tracker.py`, `bench_tracker_hard.py`,
  `engine/asistent/bench/`, `requirements-bench.txt`, `docs/BENCHMARK.md`. Also `check_subtitles.py`, `measure_style.py`.
- ReShape: `scripts/reshape_guard.py`, `reshape_golden.py`, `docs/ROLLBACK.md`. Hook: `scripts/githooks/pre-commit`.

## Status
- Mac development machine: bridge, host commands and `css_probe` used in Premiere 26.0.2 and 26.5.x (the lane for 27 exists, its use is unverified);
  preview used at 240, 300 and 420 px. Benchmarks and ReShape golden run on this Mac. Windows: not tested.
- Open: bridge `select` selected nothing once in a SYNC sequence (`TODO.md` P, `BUGS.md`: not reproduced); the counts of tests in CLAUDE.md are old (0.10.7).

## Tests
- `tests/devbridge.test.js` (panel side), `tests/test_server.py` (flag, round trip, host eval needs the flag),
  `tests/test_hostbridge.py` (lanes, give-up). `tests/test_bench.py`, `test_bench_layers.py`, `test_bench_metrics.py`.
- `tests/test_reshape_baseline.py`, `tests/test_recognition_profiles.py`. No test for `shoot.js` or `dev_cmd.py`.
