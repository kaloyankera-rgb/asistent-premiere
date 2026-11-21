# Project status: Asistent 0.10.125 (2026-11-21)

A short snapshot: replace outdated lines, keep it under ~120 lines. Per feature (what it does, rules, code,
status, tests): [docs/INDEX.md](docs/INDEX.md) and `docs/features/`. What changed in each version: `CHANGELOG.md`.
The full status log up to 0.10.120 (800 lines, per version and per phase):
[docs/history/PROJECT_STATUS_to_0.10.120.md](docs/history/PROJECT_STATUS_to_0.10.120.md).

## Version
- 0.10.125 (In & Out, Phase 0 probes + Phase 1 maths): built, NOT installed, NOT wired. Probes P1-P9 all ran in NEW TEST. Nothing in the panel changed.
- 0.10.123 installed on the development Mac (Premiere 2026, 26.5.x; 2027 also installed). Branch `improvements/2026-11`,
  pushed to `origin/main` at `348d2ee`.
- Last published release: v0.10.118 (2026-11-19). 0.10.119 and 0.10.120 are pushed but not released, 0.10.121-0.10.123 committed, not pushed, so the editors'
  panels do not offer them yet. Releases only when the user asks (`scripts/publish_release.sh`).
- Windows: largely untested (`scripts/setup_win.ps1` and the Windows installer never run by the user). See
  [install-and-update](docs/features/install-and-update.md).

## In progress
- Subtitles read by ElevenLabs Scribe (0.10.119-0.10.120): works in Premiere (the user, 2026-11-21: two videos, fast and
  accurate). Still open: one ReShape run, the switch-off run, and replacing the key pasted into the chat on 2026-11-21.
  TODO V119. [subtitles](docs/features/subtitles.md)
- Cut silences (0.10.121 ElevenLabs words, 0.10.122 audit fixes): built and tested outside Premiere, not installed. Open: the
  host razor on odd frame rates (detected, not fixed). TODO V122, AUD.
- In & Out animations (0.10.125, plan `docs/IN_OUT_PLAN.md`): Phase 0 done (probes P1-P9, `docs/probes/inout-phase0.md`; decision:
  owned Transform, DECISIONS 2026-11-21) and Phase 1 maths built (`panel/inoutplan.js`). Next: Phase 2 (`premiere-inout.js`).
  Open (the user's word): Strength on presets where it changes nothing; two protective hooks in the blur and the Keyframer.
- Local recognition experiments (`NEXT` profile) paused behind a development switch; the held-back runs were stopped.

## Waiting for a check in Premiere (newest first)
- 0.10.121: Cut silences with Detect = AI-assisted (or Cut = AI rough cut): the result says "words recognised by
  ElevenLabs Scribe v3", faster than before; a ReShape project stays on this computer. [cut-silences](docs/features/cut-silences.md)
- 0.10.119-0.10.120: one ReShape run (same captions as before), switch off and run again (Auto confirmed 2026-11-21).
  [subtitles](docs/features/subtitles.md)
- 0.10.117: Sync accepts short takes whose camera clocks wander up to 2.0 s. [sync](docs/features/sync.md)
- 0.10.96-0.10.110: Cut silences rebuilt (options, Preview) and cut by the host in a duplicate sequence; checked in NEW TEST
  through the bridge, the user's own run on a long sequence still to come. [cut-silences](docs/features/cut-silences.md)
- 0.10.88-0.10.93: Keyframer motion blur and live preview (look); Anchor on text made in Premiere.
  [keyframer](docs/features/keyframer.md), [anchor](docs/features/anchor.md)
- 0.10.73-0.10.76: Tracker zoom, layout and the object's colours on real footage (Track / Stop on the first click
  confirmed 2026-11-21).
  [tracker](docs/features/tracker.md)
- 0.10.71: Brand tab as a whole; `ppro.Color`'s range unmeasured. [brand](docs/features/brand.md)
- 0.10.67: a folder dropped on the Auto import row. [auto-import](docs/features/auto-import.md)
- 0.10.62: the after-export check on a real Export (a scripted export fires no event).
  [exports](docs/features/exports.md)
- Full checklists per version: `TODO.md` (sections V119, V96 and on).

## Open problems
- Cut silences on a 59.974 fps sequence (iPhone footage): 0.10.122 stopped the wrong cut on the user's "Lokal 2"; 0.10.123 writes the
  razor's timecode itself (built from that log, the user's next press confirms). `BUGS.md`.
- Keyframer's record key cannot tell Premiere's graphics apart. `BUGS.md`, [keyframer](docs/features/keyframer.md).
- Everything else open: `BUGS.md` (open bugs and platform limits) and `TODO.md` (tasks in priority order).

## Next
1. The user's next press of Cut silences on "Lokal 2" (0.10.123), then the checks above (TODO V122).
2. Release 0.10.123 when the user asks.
3. In & Out: Phase 2 (apply, re-apply, remove, record), tested in NEW TEST's sequence "Asistent probe – In Out".
4. `TODO.md` in its order.
