# Sync

## What it does
The Sync row ("Sync cameras", Tools > Run). The editor selects clips from two or more cameras, a recorder or a
lavalier; Asistent lines them up by their shared sound and builds a new sequence "SYNC – <sequence>" in the bin
"SYNC". The editor's own sequence is only read. The main POV (the camera on the lowest video track, usually V1) makes the
order: its clips follow their file numbers (fx30661, fx30662…) on V1, each synced partner sits against its main clip, and
clips with no partner go where they were recorded (0.10.154).

## How to use it
1. Select the clips in the timeline (all of them is fine, at least two different files from two folders or more).
2. Press Sync cameras. The panel shows progress, then the groups and any notes (unsynced clips, uncertain places).
3. The new sequence opens. One camera = one folder = one track; each camera's sound goes on every other audio
   track (A1, A3, A5) when there are two or more cameras, so Fix audio's second side lands right under it.
4. Optional, in Track names: "Also after Sync and rough cut" (on by default) names the new tracks POV 1, POV 2;
   a label colour per POV colours the camera files before they are placed.

## Key points: do not break
- Sync works from the timeline selection and builds a new sequence; the user's sequence is read only (CLAUDE.md).
- Nothing uncertain is applied: only High pairs make groups. Medium pairs are listed as "possible, not applied".
- Never mute or reroute tracks: every track in SYNC plays (the user rejected muting secondary cameras).
- No track item is removed through UXP. All clips except the seed go in ONE transaction ("Asistent: SYNC"); the seed
  is moved in its own step, camera colours and "Fix audio again" are separate steps (more than one Undo).
- Agreement: 5 ms (`AGREE_TOL`), independent windows, drift only over 60 s and up to 100 ppm, High needs 60 % of all
  windows (`HIGH_COVERAGE`). Edge artefacts gave false matches, so peaks at the search edge do not count.
- A second offset is "repeating sound" (never High) only when it could be a real repeat. One that lies inside the 0.1 s a
  candidate's stretches searched, where those stretches chose their own peak clearly (ratio 1.3 or more, not fewer stretches),
  is an echo: `sync._echo`, 0.10.156 (MASTERHAUS Видео 5, a shop hall, 85 ms and 29 ms). Do not widen it to offsets outside
  the searched range: a beat or a line said twice must stay ambiguous.
- Camera = folder, or folder + file prefix when one folder holds two numbered series (0.10.149, `groups._cameras`;
  MASTERHAUS fx306xx + fx30-3-20xx in one folder). Same-camera pairs are not compared when there are several cameras
  (one camera cannot record two clips at once). With one folder only, two clips on one track move to the next free track (0.10.6, BUG-011).
- Camera clocks are a witness, never the truth: learnt only from sure pairs (`chrono.py`). A spread up to 2.0 s
  (`CLOCK_PRECISE`, 0.10.117) lets the clocks decide a short take or a two-offset pair. Raw clocks and file dates never.
- Order (0.10.154): the main POV's file numbers make the spine and beat any clock; no other camera's numbers move a main
  clip. Main POV = lowest video track in the editor's timeline, else most clips, most footage, first (`mainCamera`); it gets
  V1 and the seed, and the report names it. Other entries are slotted between the spine entries their own numbers allow, by
  the clock inside that stretch; a lone clip whose number contradicts the spine goes by the clock and is listed as uncertain.
- Which pairs are compared (0.10.154): the clocks' difference is a guess until 3 strict High pairs confirm it by sound; then
  pairs further apart than `CLOCK_VETO` are skipped, but a clip without a partner is always compared with everything. Raw
  clocks never decide. The second look (`near`) only adds candidates; what counts as High does not change.
- No markers in the new sequence (0.9.52) and no gap between recordings (`GAP` 0, 0.10.38).
- Files that had Asistent's L/R copies get Fix audio again in SYNC (it is built from whole files, 0.10.38).
- The sequence takes its settings from the first clip with picture (`seed`); verification fails on extra video clips.
- Premiere's own Synchronize cannot be called from UXP or ExtendScript; multicam cannot be created (0.9.54).

## Decisions
- Timeline selection to a new sequence; in-place moves, Project panel selection and multicam rejected: DECISIONS "Sync" section (undated, early 11-2026).
- Short take may sync on two stretches when the learnt clocks agree: DECISIONS 2026-11-11 (0.10.45).
- Fix audio redone inside SYNC, no gap between recordings: DECISIONS 2026-11-11 (0.10.38).
- Learnt clock counts as witness up to 2.0 s of spread, reverse with `CLOCK_PRECISE = 1.0`: DECISIONS 2026-11-18.
- Track names after Sync on by default: DECISIONS 2026-11-10.
- File numbers decide the order within a camera, the clock only interleaves: DECISIONS 2026-11-23 (0.10.149).
- Main POV makes the order; clock-guided comparing with a fallback; second look: DECISIONS 2026-11-23 (0.10.154).
- An echo inside the searched range is not a second possible offset: DECISIONS 2026-11-24 (0.10.156).

## Code map
- Panel: `panel/main.js` `onSync`, `describe` (flow and report); `panel/engine.js` `startGroups`;
  `panel/layout.js` `syncLayout`, `mainCamera`, `chronological`, `byFileNumber` (pure, node-tested); `panel/premiere.js` `buildSyncSequence`
  (touches Premiere); `panel/premiere-labels.js` `colorFiles`; `panel/index.html` row `secSync`, button `sync`.
- Engine: `engine/asistent/sync.py` (pair analysis: GCC-PHAT, windows, `analyze_pair`, `near`, `_echo`), `groups.py` (`sync_groups`, `_cameras`, `camera_name`,
  `_clock_plan`, `_clock_confirm`, `_gap`, `_clock_check`, `_build_groups`), `chrono.py` (recording order, `chronology`); `server.py` `POST /sync_groups`.
  `POST /sync` (two-clip `sync_clips`) is older and not used by the row.
- Host: none.

## Status
- 0.10.156 (2026-11-24, built, not installed): the echo rule, after the user's report on MASTERHAUS КП-4 Видео 5 (two pairs
  Premiere synced and Asistent left apart). Offline on nine real shoots: every old group identical, four new pairs, each
  confirmed by the clocks. Not tried in Premiere. Still apart: nine takes of 1.5-11 s that the clocks put together (TODO SYN).
- 0.10.154 (2026-11-23, installed): main POV order, clock-guided comparing, second look. Offline on real files: MASTERHAUS
  22.1 -> 6.6 s with the same 16 groups, GStroy КП11 Видео 8 12.4 -> 7.6 s with one more real pair. Not tried in Premiere.
- 0.10.149 (2026-11-23, installed): two cameras in one folder told apart by file prefix, and file-number order per camera,
  after the MASTERHAUS КП-4 Видео 4 reports (wrong order; 668/2038 and two more pairs vetoed by a shared clock). Offline on
  the real files: 16 groups (was 12), nothing uncertain. Not tried in Premiere.
- Since 0.2 to 0.3.1 (Phase 2, "Done + verified": 28/28 clips placed, max 8.3 ms = half a frame, in Premiere).
  Latest change 0.10.117 (2026-11-18, installed): not tried in Premiere; 7 more pairs on GStroy КП11 Видео 8 offline.
- 0.10.45-0.10.47: every-other-audio-track layout and camera files coloured before placing verified through the bridge
  on NEW TEST; the clips' own colour on the timeline is unreadable by scripts (TODO R: the user to look).
- 0.10.38 (no gap, Fix audio again): not verified by the user in Premiere (TODO F, 4a1a mobilefox B-Roll).
- Windows: untested (`setup_win.ps1` never run, TODO W).
- Limits (BUGS "Algorithm limitations"): clips under about 8 s or nearly silent stay Low unless two stretches agree and
  the clocks confirm; up to half a frame of error; VFR may drift; no sub-frame alignment; no manual sync tool.
  Many clips without a partner still cost the full comparison (the fallback). Bridge `select` in a SYNC sequence is unreliable (TODO P item 3).

## Tests
- `tests/test_sync.py` (synthetic recordings with a known answer; the echo rule and a hall echo, 0.10.156), `test_groups.py` (groups, short takes, clock rules),
  `test_chrono.py`, `test_server.py` (`/sync` guards), `test_real_footage.py` (GStroy footage, skipped elsewhere).
- `tests/layout.test.js` (placements, tracks, main POV, chronology, file-number order incl. the MASTERHAUS case), `wiring.test.js` (Sync calls `fixAudio`), `selection.test.js`.
