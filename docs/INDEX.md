# Documentation map

Read in this order when continuing the project (the first four are the whole handoff):

| # | File | What it holds |
|---|---|---|
| 1 | [../CLAUDE.md](../CLAUDE.md) | Architecture, development rules, permanent user rules. Loaded automatically by Claude Code. |
| 2 | [../PROJECT_STATUS.md](../PROJECT_STATUS.md) | Version, every phase and feature, what is verified in Premiere and what is not. |
| 3 | [../TODO.md](../TODO.md) | Remaining tasks in priority order. |
| 4 | [../BUGS.md](../BUGS.md) | Open bugs, Premiere/UXP limits, things that crash. |
| 5 | [../DECISIONS.md](../DECISIONS.md) | Why things are the way they are (user decisions, rejected approaches). |
| 6 | [../PROGRESS.md](../PROGRESS.md) | Detailed dated log. Search it, do not read it whole. |
| 7 | [../README.md](../README.md) | User guide (Bulgarian): install and every button. |
| 8 | [../COLOR_CORRECTION_PLAN.md](../COLOR_CORRECTION_PLAN.md) | Colour engine plan; spec package in [color-spec/](color-spec/00_START_HERE.md). |
| 9 | [SUBTITLES_PLAN.md](SUBTITLES_PLAN.md) | Phase 7 (Bulgarian subtitles) plan and milestones M0-M5. |
| 9c | [SUBTITLE_STYLES/EKOPAK.md](SUBTITLE_STYLES/EKOPAK.md) | ЕКОПАК's style (preset `ekopak`), colour in [CLIENT_COLOR/EKOPAK.md](CLIENT_COLOR/EKOPAK.md); what the three clients share: the vault's `editing/client-styles.md`. |
| 9b | [SUBTITLE_STYLES/CREDISSIMO.md](SUBTITLE_STYLES/CREDISSIMO.md) | Credissimo's style (preset `credissimo`), colour in [CLIENT_COLOR/CREDISSIMO.md](CLIENT_COLOR/CREDISSIMO.md); measured with `scripts/measure_style.py`. |
| 9a | [SUBTITLE_STYLES/GSTROY.md](SUBTITLE_STYLES/GSTROY.md) | GStroy's subtitle style measured on its exports (preset `gstroy`); colour findings in [CLIENT_COLOR/GSTROY.md](CLIENT_COLOR/GSTROY.md). |
| 9b | [ROUGHCUT_PLAN.md](ROUGHCUT_PLAN.md) | Phase 8 (AI Auto Rough Cut: Safe/Smart cut, repeated takes) research and plan, milestones M0-M6. Planning only, nothing built (2026-11-03). |
| 9a | [BULGARIAN_TRANSCRIPTION_GUIDE.md](BULGARIAN_TRANSCRIPTION_GUIDE.md) | **Read before touching the subtitle pipeline.** Linguistic and engineering rules for Bulgarian speech-to-text (gender forms, verb forms, numbers, punctuation, alignment, grouping) and the documented SRT errors used as regression tests. |
| 9c | [ROLLBACK.md](ROLLBACK.md) | The protected backup of 2026-11-08, the ReShape guard/baseline/golden checks, and per feature how to switch off, revert and restore. |
| 9d | [NATIVE_GRAPHICS.md](NATIVE_GRAPHICS.md) | What Premiere 26.0.2 lets a script do with native text graphics (probed 2026-11-08): no text or style write; the manual steps. |
| 9e | [BENCHMARK.md](BENCHMARK.md) | Bulgarian recognition benchmark: what is measured, the private reference sets, how to verify a reference, results. |
| 10 | [../LICENSES.md](../LICENSES.md) | Licences of dependencies and the bundled face model. |
| 11 | [dev-workflow/DEV_WORKFLOW.md](dev-workflow/DEV_WORKFLOW.md) | Which model/agent does what; snapshot of the four agent definitions in [dev-workflow/agents/](dev-workflow/agents/). |

## Setting up on a new machine (or after cloning from GitHub)
1. Clone the repo. It is self-contained; the surrounding Content Studio vault is not needed to read or test the code.
2. Mac: `scripts/setup_mac.sh` (Python 3.12 venv + LaunchAgent, outside the repo in `~/Library/Application Support/Asistent/`); Windows: `scripts/setup_win.ps1`.
3. Tests: `"$HOME/Library/Application Support/Asistent/venv/bin/python" -m pytest tests -q -W error -p no:cacheprovider` and `node --test tests/*.test.js` (see `CLAUDE.md`).
4. Not in Git by design: `dist/` (rebuild with `scripts/package_ccx.sh`), the 3 GB Whisper model (downloaded from the panel after the user confirms), the Python venv, logs, client footage, and `.claude/agents/` (symlinks into the Content Studio vault).
5. Subagents: inside the vault they come from `<vault>/.claude/agents/`. In a standalone clone, copy the files from `dev-workflow/agents/` to `.claude/agents/` if you want them.
6. Model routing, state files and handoff habits: `dev-workflow/DEV_WORKFLOW.md`. The canonical copy lives in the vault (`tools/DEV_WORKFLOW.md`); this one is a snapshot of 2026-11-01.

## Last verified
2026-11-01, v0.9.41: 211 pytest + 50 node tests pass. Premiere-side verification status per feature is in `PROJECT_STATUS.md`.
