# Asistent: documentation map

Start here. To change a feature, read its page below before the code, and update that page in the same commit.
Each page has the same sections: what it does, how to use it, key points (do not break), decisions, code map,
status, tests. Status as of 0.10.129 (2026-11-21).

## Features

| Feature | What it does | Page | Mac / Premiere | Windows |
|---|---|---|---|---|
| Sync | Lines up cameras and lavaliers by shared sound in a new SYNC sequence | [sync](features/sync.md) | Verified; 0.10.117 not tried | Untested |
| Fix audio | L/L and R/R copies, level to -17 LUFS, peak under -6 dBFS | [fix-audio](features/fix-audio.md) | Split verified; Undo count unverified | Untested |
| Cut silences | Silences, off-mic voices and repeated takes cut in a duplicate sequence | [cut-silences](features/cut-silences.md) | Audit fixes 0.10.122 not installed; odd frame rates stop (probe open) | Untested |
| Track names | Tracks named POV 1, POV 2, Mic n, Subtitles BG / EN; camera colours | [track-names](features/track-names.md) | Bridge-tested; Cmd+Z unverified | Untested |
| Color | Auto color (white balance + exposure), Match POVs, Exposure ±0.5, Before / after | [color](features/color.md) | Used by the user; 0.10.118 untested | Untested |
| Learn from exports | Editors' Lumetri noted next to Auto color's, per client and camera | [color-learning](features/color-learning.md) | Bridge-verified; real Export untried | Untested |
| Before export | Check export: offline, gaps, picture that does not fill, safe area, peaks | [export-check-before](features/export-check-before.md) | Bridge-verified; not tried by the user | Untested |
| Show exports, Export check | Finished export shown in Finder; FFmpeg measures the file | [exports](features/exports.md) | Seen on a real export; event unverified | Untested |
| Subtitles | Bulgarian speech to SRT and a caption track; Captions tab fixes and learning | [subtitles](features/subtitles.md) | Core verified; ElevenLabs Auto verified 2026-11-21, ReShape and switch-off runs open | Untested |
| Auto import | Watches the project's folder, imports new files into type bins | [auto-import](features/auto-import.md) | Verified; default-on bridge-tested | Untested |
| Brand | The client's brand kit in Premiere: place, colours, MOGRTs, fonts | [brand](features/brand.md) | Installed; not tried by the user | Untested |
| Folders | Favourite folders as buttons that open them in Finder; colours, names, follows the project | [folders](features/folders.md) | Installed 0.10.143; not tried in Premiere | Untested |
| Keyframer | Curves between keyframes, repeats, motion blur, live preview | [keyframer](features/keyframer.md) | Bridge-tested; user's look open | Untested |
| Stash | Save a clip's animation or clips, apply at the playhead | [stash](features/stash.md) | Bridge-tested; not tried by the user | Untested |
| Tracker | Track an object, attach a text or lock the clip to it | [tracker](features/tracker.md) | Bridge-tested; engine on a real clip | Untested |
| Anchor | Anchor point to nine places while the picture stays put | [anchor](features/anchor.md) | Bridge-measured; text case used | Untested |
| Install and update | Installers, release zip, the panel's Update button, rollback | [install-and-update](features/install-and-update.md) | Verified on the Mac | Never run |
| In & Out | Preset in and out animations (position, scale, rotation, opacity) on selected clips; Motion → In & Out page | [in-out](features/in-out.md) | Phase 5 built: steps 1-4 in 0.10.135 (own presets), step 5 in 0.10.136 (the Curves editor, Save as new / Rename / Delete; BLOCK fixed, PASS on the re-check; browser harness only; not installed, not run in Premiere, not bridge-tested); Tiles page (0.10.133) built, not installed, reviewed or bridge-tested; 0.10.132 compact page local only; Phase 4 preview (0.10.130); Phase 3 page (0.10.129) bridge-tested on 0.10.128, installed on the dev Mac, not released; the user has not looked at any of them yet | Untested |
| Development tools | Test bridge, browser preview, CSS probe, logs, benchmarks, guards, hook | [dev-tools](features/dev-tools.md) | Used on the Mac | Not tested |

New feature: copy [features/_TEMPLATE.md](features/_TEMPLATE.md), keep it under ~80 lines, add a row here.

## Other documents

| File | What it is for |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | Architecture, development rules, permanent user rules (loaded automatically). |
| [../PROJECT_STATUS.md](../PROJECT_STATUS.md) | Short snapshot: version, in progress, what waits for a check in Premiere. |
| [../TODO.md](../TODO.md) | Open tasks in priority order. |
| [../BUGS.md](../BUGS.md) | Open bugs, Premiere / UXP limits, warnings. |
| [../DECISIONS.md](../DECISIONS.md) | Why things are the way they are (dated entries). |
| [../CHANGELOG.md](../CHANGELOG.md) | One entry per version, newest first. |
| [../PROGRESS.md](../PROGRESS.md) | Detailed dated log. Search it, do not read it whole. |
| [../README.md](../README.md) | The user guide (English, like the panel): install and every button. |
| [BULGARIAN_TRANSCRIPTION_GUIDE.md](BULGARIAN_TRANSCRIPTION_GUIDE.md) | **Read before touching the subtitle pipeline.** Rules and the regression table. |
| [BENCHMARK.md](BENCHMARK.md) | Recognition benchmark and the table every recognition change is judged by. |
| [SUBTITLE_STYLE.md](SUBTITLE_STYLE.md), [SUBTITLE_STYLES/](SUBTITLE_STYLES/GSTROY.md) | Subtitle styles; one measured file per client (AULA, Beauty Sector, Credissimo, ЕКОПАК, GStroy). |
| [SUBTITLE_PLACEMENT.md](SUBTITLE_PLACEMENT.md) | Where subtitles sit, measured on 25 client videos; the Move off faces rule and its replay (0.10.141). |
| [CLIENT_COLOR/](CLIENT_COLOR/GSTROY.md) | Colour findings per client (proposals only). |
| [../COLOR_CORRECTION_PLAN.md](../COLOR_CORRECTION_PLAN.md), [color-spec/](color-spec/00_START_HERE.md) | Colour engine plan and spec package (contrast, saturation and the rest not built). |
| [BRAND_KIT.md](BRAND_KIT.md), [TRACKER.md](TRACKER.md) | Deep references behind the Brand and Tracker pages. |
| [ROLLBACK.md](ROLLBACK.md) | The protected backup, the ReShape guard / golden checks, how to switch off and restore per feature. |
| [NATIVE_GRAPHICS.md](NATIVE_GRAPHICS.md) | What a script can do with Premiere's native text graphics (probed 2026-11-08). |
| [SMART_EXPORT_DESTINATION_PLAN.md](SMART_EXPORT_DESTINATION_PLAN.md) | Plan only, not built (TODO XD). |
| [IN_OUT_PLAN.md](IN_OUT_PLAN.md) | In & Out animations (separate in and out preset lists, baked AE-style curves, motion blur). Approved 2026-11-21; Phase 0 (probes, decision) and Phase 1 (maths) done in 0.10.125; Phase 2 (apply, remove) done in 0.10.127; Phase 3 (the page) done in 0.10.129; Phase 4 (a small preview) built in 0.10.130, page made compact in 0.10.132, then rebuilt as Tiles in 0.10.133; Phase 5 built: steps 1-4 in 0.10.135 (own presets, curve maths, store, graph rules), step 5 (the editor page) in 0.10.136. |
| [SUBTITLES_PLAN.md](SUBTITLES_PLAN.md), [ROUGHCUT_PLAN.md](ROUGHCUT_PLAN.md), [EXPORT_REVEAL_PLAN.md](EXPORT_REVEAL_PLAN.md) | Shipped plans, kept as history (code comments point to them). Current behaviour: the feature pages. |
| [probes/](probes/cockpit-phase0.md), [probes/inout-phase0.md](probes/inout-phase0.md) | Probe results (Cockpit phase 0, native graphics); In & Out phase 0 (desk findings, live probes P1-P9, scripts in probes/inout/). |
| [history/](history/PROJECT_STATUS_to_0.10.120.md) | Old PROJECT_STATUS (to 0.10.120), finished TODO sections, fixed BUGS entries, word for word. |
| [../LICENSES.md](../LICENSES.md) | Licences of dependencies and the bundled face model. |
| [dev-workflow/DEV_WORKFLOW.md](dev-workflow/DEV_WORKFLOW.md) | Which model / agent does what; snapshot of the agent definitions in [dev-workflow/agents/](dev-workflow/agents/). |

## Setting up on a new machine (or after cloning from GitHub)
1. Clone the repo. It is self-contained; the surrounding Content Studio vault is not needed to read or test the code.
2. The normal route is a release zip with the double-click installers, or on a bare Mac `installer/mac/Install Asistent.command`
   (puts Python 3.12 and FFmpeg into Asistent's folder; [install-and-update](features/install-and-update.md)). From the repo:
   `scripts/setup_mac.sh [--subtitles] [--align] [--no-panel]` (venv, host, fonts, panel, LaunchAgent, all outside the repo in
   `~/Library/Application Support/Asistent/`); Windows `scripts/setup_win.ps1 [-Subtitles] [-NoPanel]` (never run yet).
3. Enable the docs hook once: `git config core.hooksPath scripts/githooks`.
4. Tests: `node --test tests/*.test.js`, and pytest with `HOME` pointed at a scratch folder holding a copy of `models/lexicon`
   (some tests write into the real app folder; exact command in `CLAUDE.md`). `test_real_footage.py` is skipped without
   `ASISTENT_REAL_FOOTAGE`. Browser preview: `npm install` in `preview/` ([dev-tools](features/dev-tools.md)).
5. Not in Git by design: `dist/`, the Whisper model (downloaded from the panel after the user confirms), the venv, logs,
   client footage, keys, and `.claude/agents/` (inside the vault they come from `<vault>/.claude/agents/`; in a standalone clone
   copy them from `dev-workflow/agents/`).
