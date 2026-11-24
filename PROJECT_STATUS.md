# Project status: Asistent 0.10.157 (2026-11-24)

A short snapshot: replace outdated lines, keep it under ~120 lines. Per feature (what it does, rules, code,
status, tests): [docs/INDEX.md](docs/INDEX.md) and `docs/features/`. What changed in each version: `CHANGELOG.md`.
The full status log up to 0.10.120 (800 lines, per version and per phase):
[docs/history/PROJECT_STATUS_to_0.10.120.md](docs/history/PROJECT_STATUS_to_0.10.120.md).

## Version
- 0.10.157 (Cut silences: Cut = Simple, one choice that cuts dead air and the quiet stretches between the lines and marks repeated lines; Mark repeated lines as a box for the other modes): built, not installed. Python 1197 passed / 24 skipped, Node 644 passed. On the user's Sirvis clips of the day (preview): 466 -> 205 s, 23 markers on 8 repeated lines. Not tried in Premiere (the markers' span, the look). [cut-silences](docs/features/cut-silences.md)
- 0.10.156 (Sync: an echo 85 ms and 29 ms from the true offset was taken for "a second possible offset", so fx30686 / fx30-3-2059 and fx30687 / fx30-3-2060 of MASTERHAUS КП-4 Видео 5 stayed apart; now the offset whose stretches looked at both and chose wins. Nine real shoots before / after: every old group identical, four new pairs): built, not installed. Python 1193 passed / 24 skipped, Node 640 passed. Not tried in Premiere. Open: nine very short takes the clocks put together still stay apart (TODO SYN). [sync](docs/features/sync.md)
- 0.10.155 (Subtitle edit log, step 1: a silent journal of subtitle presses; at a finished export the placed captions are compared with the saved project's lines; nothing shown or learned yet): built, not installed. Python 1190 / 24 skipped, Node 640. Not verified in Premiere. [subtitle-edit-log](docs/features/subtitle-edit-log.md)
- 0.10.154 (Sync: the main POV, the camera on the lowest video track, makes the order and has V1, the second POV is placed against it; the camera clocks choose which pairs are compared, MASTERHAUS 22.1 -> 6.6 s with the same 16 groups; a second look where the clocks point found one more real pair on GStroy КП11 Видео 8): installed, Python 1162 / 24 skipped, Node 640. Not tried in Premiere (new panel after a Premiere restart). [sync](docs/features/sync.md)
- 0.10.153 (Tracker: Track / Saved tabs, tracks numbered TRACK n, a transparent TRACK clip above each tracked clip, Attach / Lock with a selected TRACK clip): installed, Node 636, Python 1156 / 24 skipped. Not tried in Premiere; the TRACK clip import and placement need the first check. [tracker](docs/features/tracker.md)
- 0.10.152 (committed d31f8c6; Tracker: every track saved, a Saved list opens one again after another track or a Premiere restart, the clip found where it is now): installed, Node 634, Python 1076 / 114 skipped. Not tried in Premiere. [tracker](docs/features/tracker.md)
- 0.10.151 (Fix audio only splits L/L and R/R: no Volume, no limiter; Level only and Even out phrases still level): installed, committed a7e3159, Node 631 pass, engine unchanged. Not tried in Premiere. [fix-audio](docs/features/fix-audio.md)
- 0.10.150 (Export transcript reads the caption lines as changed in Premiere's Text panel from the saved project, saving it first; Brand colours copied without #; Tint one-step Undo probe in the bridge): built, Python 1150 / 24 skipped, Node 630 pass. Installed 2026-11-23 (new panel after a Premiere restart), not tried in Premiere. [subtitles](docs/features/subtitles.md), [brand](docs/features/brand.md)
- 0.10.149 (Sync: two cameras in one folder are told apart by file prefix, so their clocks no longer veto good pairs (MASTERHAUS: 16 pairs instead of 12) and each POV gets its own track; within each camera the clips follow their file numbers; the clock only interleaves the cameras): installed together with 0.10.148, Python 1144 / 24 skipped, Node 628 pass. Not tried in Premiere (MASTERHAUS КП-4 Видео 4). [sync](docs/features/sync.md)
- 0.10.148 (Move off faces: a file with transparency, such as a safe-zone PNG left on, is a layer, not a shot; it had made one 104 s shot of a whole video): installed with 0.10.149, not tried in Premiere.
- 0.10.147 (Folders: a colour fills the whole button, in the CEP panel and on the tab): installed. The user confirmed the Asistent Folders panel works (drag and drop, 0.10.146).
- 0.10.146 (Asistent Folders panel, CEP, Window > Extensions: drag folders from Finder, right-click menu, shared list with the Folders tab; drop hints on Folders / Auto import / Brand corrected after the UXP drop was measured empty): installed, Node 621, Python 1141 / 24 skipped. Not tried in Premiere. [folders](docs/features/folders.md)
- 0.10.144 (Folders tab: favourite folders as buttons that open them in Finder; drop or Add folder…, Edit: name, colour, order, delete, follows the project): installed, Node 620 pass, Python 1141 passed / 24 skipped, browser preview at 240 / 300 / 420 px. Not tried in Premiere. [folders](docs/features/folders.md)
- 0.10.143 (Fix audio: speaker balance off; each side levelled on its own to -17 LUFS, peak -6 dBFS, Limiter -6 dB): engine and tests only.
- 0.10.142 (colour learning fixed after the colour audit: client from the project name, old records re-filed with a backup, footage only, measurements and every changed Lumetri setting kept, report in stops plus the editors' Contrast / Saturation): Python 1138 passed / 24 skipped, Node 614 pass. Installed, committed 39d0903; the user tries it at the office on Monday. Audit: docs/CLIENT_COLOR/AUDIT_2026-11-22.md, next steps TODO COL.
- 0.10.141 (Move off faces rebuilt: a lane per Style, moves only when a face or other text would be covered, also after a zoom; measured on 25 client videos, docs/SUBTITLE_PLACEMENT.md): installed, Node 613 pass, Python 1131 passed, rules-reviewer PASS with notes. The user: "works splendid" on one video; more clients to follow. Bridge probes (zoom keyframe times, adjustment layers, press time) not run.
- 0.10.140 (Export transcript: every sentence on its own line with its own time; short paragraphs): installed, Python 1114 passed / 24 skipped, Node 580 pass, pushed. Awaiting the user's export.
- 0.10.139 (Subtitles: Line break, up to 5 words, the last 1-2 on a second line in the client's colour via `<font color>` in the .srt): installed, ReShape golden identical, pushed. Untested in Premiere: whether Premiere keeps the colour.
- 0.10.138 (Subtitles: Max words 1-4 and Case Normal / ALL CAPS): installed, pushed. Awaiting the user's look in Premiere.
- 0.10.136 (In & Out Phase 5 step 5: the curve editor (Curves button), Save as new / Rename / Delete; Phase 5 fully built): not installed, Node 572 pass, rules-reviewer BLOCK fixed, PASS on the re-check, browser harness only, not run in Premiere or UXP, not bridge-tested, not pushed.
- 0.10.135 (In & Out Phase 5 foundation: own presets, point curves, preset store, curve-graph rules; nothing visible changes): not installed, Node 553 pass, rules-reviewer PASS on the second pass (three smaller points of it fixed too), not bridge-tested, not pushed.
- 0.10.134 (In & Out tiles: a pick is seen on the first click, after the user's "I have to double click"): installed, Node 495 pass, not pushed. The presses were always registered on the first click (log); the cause of not seeing them is not proven, each tile press now logs the tile's computed look. Awaiting the user's try.
- 0.10.133 (In & Out page as Tiles, the user's choice of layout A): installed, Node 495 pass, rules-reviewer BLOCK fixed (stepper with a focused box), bridge-tested in NEW TEST, not pushed, not released. The user has not seen it in Premiere. Open: at a 523 px tall panel only about 2 tile rows show above the dock.
- 0.10.132 (compact In & Out page, replaced by 0.10.133 before the user's look): local only (`7552dca`), installed and bridge-tested earlier; not pushed.
- 0.10.131 (stray-press fix on every page; the preview no longer recreates its SVG shapes after 0.10.130 crashed Premiere in the SVG painter at 18:18:44): pushed to GitHub 2026-11-21 with the user's yes (`improvements/2026-11` at `c2397d0`); installed, Node 487 pass, pytest 954 passed / 24 skipped, not released. The user has not confirmed the click fix.
- 0.10.146 installed on the development Mac (0.10.142-0.10.148 pushed and published as v0.10.148 on 2026-11-23). Two sessions both used 0.10.143 on 2026-11-22 (Fix audio and Folders); Folders was renumbered 0.10.144 so the installer replaces the panel. Earlier line: 0.10.141 installed on the development Mac (Premiere 2026, 26.5.x; 2027 also installed). Branch `improvements/2026-11`
  and `origin/main` at the same commit.
- Last published release: v0.10.154 (2026-11-23, the user's word "push the update to the others so they can test it"; main
  fast-forwarded to 516b953). It carries 0.10.149-0.10.154: Sync (two cameras in one folder, main POV order, clock-guided
  comparing), Export transcript following lines changed in Premiere, Fix audio only splitting, the Tracker's saved tracks and
  TRACK clips. None of these has been tried in Premiere by the user. Before: v0.10.148.
  Releases only when the user asks (`scripts/publish_release.sh`).
- Windows: largely untested (`scripts/setup_win.ps1` and the Windows installer never run by the user). See
  [install-and-update](docs/features/install-and-update.md).

## In progress
- Subtitle edit log (0.10.155, TODO SAL): Step 1 built, not installed. Steps 2-4 open: repeated fixes to learning after approval, the recap every 3 days, the split replay. [subtitle-edit-log](docs/features/subtitle-edit-log.md)
- Subtitles read by ElevenLabs Scribe (0.10.119-0.10.120): works in Premiere (the user, 2026-11-21: two videos, fast and
  accurate). Still open: one ReShape run, the switch-off run, and replacing the key pasted into the chat on 2026-11-21.
  TODO V119. [subtitles](docs/features/subtitles.md)
- Cut silences (0.10.121 ElevenLabs words, 0.10.122 audit fixes): built and tested outside Premiere, not installed. Open: the
  host razor on odd frame rates (detected, not fixed). TODO V122, AUD. 0.10.157 Simple and the markers on repeated lines:
  built, not installed. TODO V157.
- In & Out animations (0.10.136, plan `docs/IN_OUT_PLAN.md`): Phase 5 fully built (own presets in 0.10.135; the curve editor with
  Curves, Save as new / Rename / Delete in 0.10.136). Not installed, not run in Premiere, not bridge-tested; the bridge checks for
  NEW TEST are in TODO section IO. The user's look at the Tiles page (0.10.133-0.10.134) is still open.
  Open: Strength on presets where it changes nothing; the limits in BUGS.md. [in-out](docs/features/in-out.md)
- Local recognition experiments (`NEXT` profile) paused behind a development switch; the held-back runs were stopped.

## Waiting for a check in Premiere (newest first)
- 0.10.155 edit log: install, then save at a finished export; a changed word and a split line show in GET /subtitles/editlog. TODO SAL.
- 0.10.146 Folders: drag a folder onto the Asistent Folders panel, right-click menu, the same buttons on the Folders tab, a press opens Finder. TODO FLD.
- 0.10.143 Fix audio on a two-person video: both speakers at a similar level, no side lowered for balance. [fix-audio](docs/features/fix-audio.md)
- 0.10.142 after install: export a graded client video, then Color > What the editors did (right client, Contrast / Saturation line). TODO COL.
- 0.10.141 Move off faces on more clients (the user is trying it); a press over zooms and on a ReShape project. TODO MOF.
- 0.10.138-0.10.140 subtitles: Max words, Case, Line break (does the bottom line come in colour, white, or with the tag shown as
  text?), Export transcript with times. TODO SUB. [subtitles](docs/features/subtitles.md)
- 0.10.130: clicks on the Motion and Brand settings no longer open other tabs or press buttons of other pages (the stray-press net skips
  hidden panes). The user's real use to confirm. [tracker](docs/features/tracker.md)
- 0.10.136: In & Out curve editor and own presets (not installed): the Curves button, the editor's look and drag in Premiere, own tiles, the preview after a drag. [in-out](docs/features/in-out.md)
- 0.10.133: In & Out as Tiles (installed, bridge-tested): the real column count and tile look in Premiere, the preview frame, the icons and
  the hover preview. Earlier In & Out looks (0.10.129-0.10.130) are still open too, and so is the motion in playback next to the
  reference (blur on and off). [in-out](docs/features/in-out.md)
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
- Stray presses under a scrolled-out button in `#work` / `#result` (outside `#app`): not checked by the net yet. `BUGS.md`.
- Everything else open: `BUGS.md` (open bugs and platform limits) and `TODO.md` (tasks in priority order).

## Next
0. Install 0.10.155 when the user says so, then the bridge checks and the user's look in TODO SAL.
1. The user's next press of Cut silences on "Lokal 2" (0.10.123), then the checks above (TODO V122).
2. Release 0.10.123 when the user asks.
3. Install 0.10.136, then the bridge checks and the soak in TODO section IO (step 5). Still open: the review
   and bridge test of 0.10.133 (Tiles). Then the user's look in Premiere (Tiles page, the editor, own tiles, preview).
4. `TODO.md` in its order.
