# Project status: Asistent 0.10.120 (2026-11-21)

A short snapshot: replace outdated lines, keep it under ~120 lines. Per feature (what it does, rules, code,
status, tests): [docs/INDEX.md](docs/INDEX.md) and `docs/features/`. What changed in each version: `CHANGELOG.md`.
The full status log up to 0.10.120 (800 lines, per version and per phase):
[docs/history/PROJECT_STATUS_to_0.10.120.md](docs/history/PROJECT_STATUS_to_0.10.120.md).

## Version
- 0.10.120 installed on the development Mac (Premiere 2026, 26.5.x; 2027 also installed). Branch `improvements/2026-11`,
  pushed to `origin/main` at `348d2ee`.
- Last published release: v0.10.118 (2026-11-19). 0.10.119 and 0.10.120 are pushed but not released, so the editors'
  panels do not offer them yet. Releases only when the user asks (`scripts/publish_release.sh`).
- Windows: largely untested (`scripts/setup_win.ps1` and the Windows installer never run by the user). See
  [install-and-update](docs/features/install-and-update.md).

## In progress
- Subtitles read by ElevenLabs Scribe (0.10.119): the user's first run in Premiere froze at "Aligning the words to the
  sound…"; fixed in 0.10.120 (a shout written as a 1000-letter word), the next run in Premiere still to come. The key
  that was pasted into the chat on 2026-11-21 should be replaced with a new one. TODO V119.
  [subtitles](docs/features/subtitles.md)
- Local recognition experiments (`NEXT` profile) paused behind a development switch; the held-back runs were stopped.

## Waiting for a check in Premiere (newest first)
- 0.10.119-0.10.120: the Settings > Subtitles card, one Auto run, one ReShape run (same captions as before), switch off
  and run again. [subtitles](docs/features/subtitles.md)
- 0.10.118: Exposure ±0.5 pressed twice fast no longer crashes (settle after a Lumetri / Tint add).
  [color](docs/features/color.md)
- 0.10.117: Sync accepts short takes whose camera clocks wander up to 2.0 s. [sync](docs/features/sync.md)
- 0.10.115-0.10.116: the restyled tab row; Keyframer's dock; Brand colour Apply / Copy rows and Apply on text made in
  Premiere; Auto import on by default in a new project; Export check cards. [brand](docs/features/brand.md),
  [keyframer](docs/features/keyframer.md), [auto-import](docs/features/auto-import.md),
  [exports](docs/features/exports.md)
- 0.10.96-0.10.110: Cut silences rebuilt (options, Preview) and cut by the host in a duplicate sequence; checked in NEW TEST
  through the bridge, the user's own run on a long sequence still to come. [cut-silences](docs/features/cut-silences.md)
- 0.10.88-0.10.93: Keyframer motion blur and live preview (look); Anchor on text made in Premiere.
  [keyframer](docs/features/keyframer.md), [anchor](docs/features/anchor.md)
- 0.10.73-0.10.77: Tracker zoom, layout and the object's colours on real footage (Track / Stop presses by the user).
  [tracker](docs/features/tracker.md)
- 0.10.71: Brand tab as a whole; `ppro.Color`'s range unmeasured. [brand](docs/features/brand.md)
- 0.10.67: a folder dropped on the Auto import row. [auto-import](docs/features/auto-import.md)
- 0.10.62: the after-export check on a real Export (a scripted export fires no event).
  [exports](docs/features/exports.md)
- Full checklists per version: `TODO.md` (sections V119, V96 and on).

## Open problems
- Premiere crashes once in a while inside its scripting layer (Exposure +0.5 twice fast, 2026-11-18; Keyframer, 2026-11-15).
  `BUGS.md` "Open bugs".
- Keyframer's record key cannot tell Premiere's graphics apart. `BUGS.md`, [keyframer](docs/features/keyframer.md).
- Everything else open: `BUGS.md` (open bugs and platform limits) and `TODO.md` (tasks in priority order).

## Next
1. The user's checks above, starting with subtitles by ElevenLabs.
2. Release 0.10.120 when the user asks.
3. `TODO.md` in its order.
