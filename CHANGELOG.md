# Changelog

All notable changes to Asistent. Newest first. Reconstructed from the git history up to 0.9.41 (all work so far happened on 2026-11-01); from here on every completed and verified task adds an entry under `Unreleased` or a new version heading (see the workflow in `CLAUDE.md`).

Versions are the panel/engine version (`panel/manifest.json` and `engine/asistent/config.py` always match). "Verified" means confirmed by the user in Premiere; details per feature are in `PROJECT_STATUS.md`.

## Unreleased

### Branch improvements/2026-11 (the user's implementation prompt of 2026-11-08; installed on the development Mac, not pushed)
- 2026-11-09 notes: the rough cut's slowness on a 10-minute video is speech recognition on the CPU (cancelled after 326 s; the cutting takes seconds): options in TODO A. `panel/version.js` brought to 0.10.17 (written by packaging).
- **Protected backup before any change**: local tag `backup/pre-improvements-2026-11-08` (2991cf4, 0.10.8) and a private,
  read-only backup outside the repo (Git bundle, whole working tree, app data, installed panel/host, LaunchAgent, model
  hashes, restore steps; isolated restore ran 574 pytest + 166 node green). See `docs/ROLLBACK.md`.
- **ReShape baseline (dev only, no app change)**: `scripts/reshape_guard.py` (protected files changed since the tag),
  `tests/test_reshape_baseline.py` (preset, constants, byte-exact captions of 36 synthetic inputs made by the tag's code; a
  0.01 s lead change fails 15 of them), `scripts/reshape_golden.py` (the whole job on the client's own ReShape recording,
  byte for byte against the run recorded at the tag; private store outside the repo; two cold runs identical, ~75 s).
- **Native-graphics probes (docs/NATIVE_GRAPHICS.md, raw results in docs/probes/)**: in Premiere 26.0.2 no script can write or
  read a native text graphic's words (an ExtendScript write leaves the graphic drawing nothing; UXP reads null) or its font,
  size, fill and stroke (not parameters); only position/scale/rotation/opacity and timing are writable. The optional
  "Native graphics" output is therefore not built; captions stay. The probe blanked the old "Your Title Here" test graphic in
  NEW TEST (three Undo steps or delete it).
- **Bulgarian recognition benchmark (dev only, docs/BENCHMARK.md)**: `engine/asistent/bench` (normalization that keeps ъ, ь, й, ѝ
  and hyphenated words; digits and numerals compared as spoken) and `scripts/bench_asr.py` (backends run with their own Python,
  scoring with jiwer 4.0.0 in its own `<app>/venv-bench`): WER/CER raw and normalized, numbers, negations (also inserted ones),
  names, dropped passages, word timing, word edits, time and peak memory. Private store with dev and held-out clips; scores only
  against references a person verified. Starter set: three Masterhaus clips (143 s), drafts written, none verified yet, so no
  accuracy numbers. Tests: 6 in any venv, 13 with jiwer.
- **whisper.cpp evaluated (dev only, not wired)**: v1.9.5 with Metal and `ggml-large-v3` (multilingual), beam 5, in
  `<app>/experiments/whisper.cpp`; `bench_asr.py hyp --backend whispercpp`. 7.3x faster than Classic on the 143 s, but an invented
  „Абонирайте се!“, „млн.“ for „мм“ and rougher word times; kept out until the verified references are scored (docs/BENCHMARK.md).
  Word timing now ignores lone dialogue dashes.

## 0.10.142 - Colour learning fixed after the colour audit: right clients, footage only, measurements kept (2026-11-22, installed, untested in Premiere: the user tries it at the office on Monday)
The colour audit of 2026-11-22 (`docs/CLIENT_COLOR/AUDIT_2026-11-22.md`) compared ~1,600 recorded clips (the editors' Lumetri next
to Auto color's suggestion). It found the learning records unfit for fitting targets; this version fixes the recording and the
report. Nothing in Premiere is written; Auto color itself is unchanged.
- **Client from the project name**: a video folder mounted as its own volume (`/Volumes/Видео 7 - .../Assets/x.prproj`) filed the
  clips under "Assets" (733 clip ranges, 1,525 lines, of Credissimo, RoboHubPro, Pulse Fitness, GStroy, Fornetti, ЕКОПАК). The client
  now comes from the project file name (`Credissimo КП-14 - ...` → Credissimo) after the Subtitle Learning folder and `01_CLIENTS`.
  Existing lines are re-filed once per engine run on the first report (`colorlearn.repair`, every changed file copied to
  `learning/color/backup/<time>/` first, nothing dropped, time order kept). Dry run on a copy of this Mac's records: 1,525 moved,
  4,033 lines before and after.
- **Footage only**: stills and graphics (png, jpg, psd, ...) and files in render, graphics, stock, transition, overlay, SFX,
  02_RESOURCES, Downloads, logo, mockup, Kling / Higgsfield folders are neither analysed nor recorded, and older such lines are left
  out of the report (`colorlearn.footage`).
- **Measurements kept** (record format 2): what Auto color measured on the file (face and mid-tone brightness, casts on neutrals and
  the whole picture, neutral and skin area, clipping, the raw exposure need) and the look (`color.look_stats`: black / white point,
  contrast, saturation), so per-client targets can be fitted from the records without the raw files. `color.decide` returns a new
  `measured` block (additive).
- **Every Lumetri setting the editor changed**: the panel compares the Lumetri's full fingerprint, already read for ownership, with
  the untouched Lumetri (`colorplans.lumetriDiff`, no extra Premiere calls) and sends the differences (`editor_all`, `layer_all`):
  Whites, Blacks, Highlights, Shadows, Vibrance, Creative, curves, LUTs.
- **Report in stops**: the editors' Exposure was Lumetri units against Auto color's stops (about 0.85 stop per unit at skin), which
  made Auto color look like it overshot; now converted with the probe's curve at the measured brightness. The report also shows the
  editors' own Contrast and Saturation per camera (how often and the middle change); the panel's "What the editors did" prints them.
- Tests: Python 1138 passed / 24 skipped (7 new in `test_colorlearn.py`), Node 614 pass (1 new in `colorplans.test.js`).

## 0.10.141 - Move off faces rebuilt from 25 client videos: a lane per Style, moves only when something is covered (2026-11-22, installed, the user: "works splendid" on one video)

- **The user's report:** "it doesn't do anything almost": every client got ReShape's chin rule, which lands where the
  lines already sat; it looked at the largest face only, at 3 frames per shot (a face a zoom brings in was averaged away),
  could put a line above a low face (editors never do), and ignored other on-screen text.
- **Measured first** (docs/SUBTITLE_PLACEMENT.md): 25 finished 9:16 videos of 14 clients, 2022 chunks. Editors keep a lane
  (centre 0.488), move down under a face (never above), off other text either way, and do not follow zooms.
- **The new rule** (all Styles; ReShape keeps its chin rule as the base, the user's decision): a lane per Style (top of
  the first line) fitted on half the videos; a shot's base max(lane, chin + 0.05); per line, on its own frames, a drop
  under every face (from 3 % of the frame tall) or to the free side of other text, from the line where a zoom or a face
  moving in causes it until free again; a line with no free place is left where it was and listed. Moves only between
  lines and at cuts (keyframes at cuts as before). One Undo; hand-moved and keyframed lines left alone. 16:9 keeps the old
  rule (no data yet).
- **Zooms:** Motion and Transform (`AE.ADBE Geometry*`) Scale/Position keyframes on the clip and on adjustment layers above
  it (reversed clips mapped from the out side) add frames at each zoom; camera zooms are caught by the per-line frames.
- **Frames:** one at every line's middle (start and end for long lines or a zoom), hard cap 240 (zoom and cut lines first);
  ReShape also its old 3 per shot for the base. OCR in batches of 40 (90 s each; a failed batch costs only its frames);
  frames deleted on every path, also when the face detector is missing.
- **Engine:** `/captions/faces` answers `{frames, preset, reshape, ocr, lines}`; per frame also `boxes` (each line's own
  text box), `other` (other text) and `lines`; two-row chunks found as one block; `<font color>` stripped before matching.
- **Result line:** "Moved N of M lines" with reasons (in the lane, under a face, off on-screen text, a zoom brought a face,
  a face moved in, no free place, with times), per-shot rows, "Nothing was measured: no line moved" when no frame came back.
- **Replay on 12 held-out videos:** face covered 0.0 % (editors 0.3 %, fixed lane 2.3 %), face or text 0.8 % (1.3 %, 9.3 %),
  never above a face; centre error 0.037 (target 0.033 missed; fixed lane 0.046); moves inside a shot 7.7 % (editors 13 %).
- **Dev tools (no client data):** `measure_style.py placement | placement-report`, `placement_measure.py`,
  `placement_report.py`, `placement_vision.swift`, `placement_replay.py`, `placement_rule_cli.js`.
- **Checks:** Node 613 pass, Python 1131 passed / 24 skipped, ReShape subtitle golden identical; rules-reviewer BLOCK (frame
  cap, OCR timeout and frame leak, "no free place" lines written, ReShape with no frames) fixed, PASS with notes on the
  re-check. Bridge probes not run; the user's press on one video: "works splendid".

## 0.10.140 - Export transcript: a time on every sentence (2026-11-22, installed, pushed, awaiting the user's look)

- **The bug (the user, 2026-11-21: "the timings on the text are not right"):** a voice-over cut tight has no pause, so the whole
  40 s were one paragraph (it broke only at 120 words) under one time; every sentence after the first sat under a time that was
  not its own. The times themselves were right (the words and the captions start together).
- **Now:** with times, every sentence is on its own line after its own `[m:ss]`; a sentence of 18+ words gets a second time after
  its next comma. Paragraphs break at a pause as before, and also after their 4th sentence or past 60 words, so the plain export
  reads in blocks too. The English section follows the same layout (each caption's English as one piece).
- **Code:** `engine/asistent/transcript.py` (`paragraphs` returns each paragraph's sentences, `_section`); the "With times"
  tooltip. **Tests:** `tests/test_transcript.py` +3 (a tight voice-over, a long sentence, English); Python 1114 passed / 24 skipped.

## 0.10.139 - Subtitles: Line break, the bottom line in the client's colour (2026-11-22, installed, pushed, untested in Premiere)

- **The user's request:** "a line break option like in Submagic": up to 5 words a subtitle, 1-3 words one line, 4-5 words two
  lines with up to 3 on top and the last 1-2 below, the bottom line in the client's colour; every subtitle over 3 words breaks.
- **Panel:** a "Line break" row under Case (Style default / On) with a colour box and swatch. The box starts with the style's
  measured colour (GStroy #94D000, Credissimo #F84430, ЕКОПАК #18CC6E, Beauty Sector #D45E58, AULA #37D977; Auto the
  Submagic orange #EF7A00) and remembers a typed colour per style. Greyed for ReShape. The result line names the line break
  and its colour and counts the two-line subtitles; the client keyword suggestions give way to it.
- **Engine:** `subtitles.with_line_break` (a copy of the style: cap 5 words or the editor's Max words, the delivery cutter, no
  stack/split/keyword rules), `_broken` (top up to 3 words, bottom 1-2, a cut between units, a top line not ending on a little
  word when another cut fits), captions get `accent_line` and `accent` (the bottom line); `write_srt(..., colour)` wraps the
  bottom line in `<font color="#RRGGBB">` in the Bulgarian .srt only (the JSON and the English .srt stay plain).
  `/subtitles` takes `line_break` (bool) and `colour` (#RRGGBB); the result has `line_break` and `colour` only when asked.
- **Not known yet:** whether Premiere keeps the colour from the .srt, ignores it or shows the tag as text (the user's test).
- **ReShape:** untouched (`with_line_break` returns its style as is); golden check identical; with Line break off every style
  gives the same captions as before (336 runs, 8 presets). **Tests:** `tests/test_line_break.py` (new), `test_subtitle_job.py`
  +2 and 5 bad requests, `subtitleplan.test.js` +4; Node 580 pass.

## 0.10.138 - Subtitles: Max words and Case (2026-11-21, installed, pushed, awaiting the user's look)

- **The user's requests:** a Submagic/Kapwing-style choice of the most words a subtitle may show, and all subtitles in ALL CAPS
  or normal.
- **Max words** (Style default, 1-4): a hard cap on one subtitle's words, both lines counted; only one counted unit (a number
  with what it counts, „8 евро“) may go over it. 16:9 goes through the delivery phrase cutter when capped. With a cap the English
  line may come out empty on some lines (a note says how many).
- **Case** (Style default, Normal, ALL CAPS): ALL CAPS also puts the English line in capitals; a client's names keep their own
  spelling (GStroy). Normal takes a client style out of capitals with the same cuts.
- Both greyed for ReShape (its style is fixed) and remembered on this computer. Engine: `subtitles.with_max_words`,
  `with_case`, `CASES`; `/subtitles` takes `max_words` (int 1-4) and `case`; the result has them only when asked.
- First installed as 0.10.137 without a version bump: Adobe's installer kept the old panel (same version), so the Case row was
  missing until the bump. **Tests:** `tests/test_max_words.py`, `tests/test_case.py` (new), `test_subtitle_job.py`,
  `subtitleplan.test.js`. ReShape golden identical.

## 0.10.136 - In & Out curve editor and own presets: Phase 5 complete (2026-11-21, not installed, not pushed, not run in Premiere)

- **The plan:** step 5 of the Phase 5 plan (`docs/IN_OUT_PLAN.md`), the last step. Steps 1-4 are in 0.10.135. Phase 5 is now
  fully built; nothing of it is installed or run in Premiere yet.
- **What the editor shows:** a small "Curves" button (`ioEdit`) at the right end of the dock's summary line. It opens the curve
  editor in place of the filter chips and tiles; the preview, the In | Out switch and the dock stay where they are. The dock's
  height does not change (240 / 300 / 420 px). In the editor: "Presets" (back), a chip per animated property (an edited one reads
  "Scale •"; a multi-step property is greyed with the reason), Reset, a 208 x 160 px graph (press adds a point, drag moves, double
  press removes, Alt + press makes a corner), a name box and "Save as new". On an own preset also Rename and Delete (a second press
  confirms; any other press cancels). Unsaved edits show as "In · Pop (edited)" and Apply writes them. Own presets are tiles right
  after None with an accent left edge. Save, Rename and Delete each say one line in the status.
- **Files:** new `panel/inoutedit.js`: the pure decisions (`clearDrafts`, `baseline`, `effectiveFrames`, `editDraft`, `resetDraft`,
  `editedOf`, `pointsFor`, `uniqueName`, `specOf`, `syncDrafts`, `saveSpec`) and `mount()` with the editor's DOM and the store reads
  and writes. It makes no Premiere call, runs no timer and mounts the graph once. Hooks: `panel/inout.js` (own presets loaded before
  the stored choices, tiles in a wrapper `div.io-presets`, the tiles of one side refilled at mount and after save / rename / delete
  / a real change of the stored list, the summary row, `edit()`, a wider `info()`), `panel/style.css` (`.io-sumrow`, `.io-edbtn`,
  `.io-mine`, `.io-ed*`), `panel/main.js` (bridge hook `inout`), `panel/devbridge.js` (`inout_page`, `inout_edit {side, prop, pts}`,
  `ioEdName` in the `fill` allowlist), `scripts/package_ccx.sh` (packs `curvegraph.js` and `inoutedit.js`), `preview/` (scenarios
  `inout-editor` and `inout-mine`; `boot.js` lets a scenario seed the store).
- **Choices made while building** (the user has not been asked; recorded in DECISIONS as builder's choices, the user's look
  pending): on an own preset the name box starts with that preset's name, and "Save as new" makes the name unique ("Snappy",
  "Snappy 2"); Reset on an own preset goes back to the built-in base curve; switching to a side with nothing picked closes the
  editor; the stored choices read again (the engine coming back) clear unsaved edits only when something really changed, and never
  under a running Apply (deferred to its end); Save, Rename and Delete do nothing until the panel store has loaded ("Your presets
  are still loading. Try again in a moment.").
- **Review:** rules-reviewer BLOCK on step 5 for one bug, fixed: a Save, Rename or Delete before the panel store had loaded from the
  engine would have written a list without the presets saved earlier. Also fixed from that review: the stored choices read again
  could change the presets under a running Apply; a press on the graph did not cancel an armed Delete; the Save sentence. These
  fixes came after the review; the reviewer's re-check of them is a PASS. The reviewer judged the tile refill safe on reasoning and asks for a
  soak through the bridge before release.
- **Tests:** Node 572 pass (553 at 0.10.135). New `tests/inoutedit.test.js` (14, the pure half only); `tests/wiring.test.js` +5.
  No Python changed; the Python suite not run. Browser harness only (Chrome): screenshots at 240 / 300 / 420 px read; dock heights
  equal to 0.10.135; `#ioEd` 267 px tall, the pane with the editor open 405 px.
- **Not verified:** not installed, not run in Premiere or UXP, not bridge-tested, not pushed. The user has seen none of it. The
  bridge checks for NEW TEST are listed in `TODO.md` section IO.

## 0.10.135 - In & Out own presets: Phase 5 foundation (2026-11-21, not installed, not pushed, nothing visible changed yet)

- **The plan:** the user approved the Phase 5 plan on 2026-11-21 ("approved", then "Go ahead"). This version builds steps 1-4 of it.
  Step 5, the editor page (a "Curves" button on the dock's summary line, the editor in place of the tiles, Save as new / Rename /
  Delete), is not built, so the panel looks the same as in 0.10.134.
- **`panel/inoutplan.js`:** an own preset is a built-in base whose one-piece properties get point curves (`{kind:"points"}` from
  `keyframeplan.js`). A registry behind `find(side, id)` lets the preview and Apply get own presets with no change of their own.
  New: `setCustom` (returns how many rows were kept and which were dropped, with a reason), `setDraft`, `resolve`, `customOf`,
  `editable`, `curveFor`, `DRAFT`, `PRESET_V`. An id may be used once across both sides. For a point curve only, Strength scales
  from the first frame within 0.5 % of the target (judged on the baked frames).
- **`panel/inoutpresets.js` (new, pure):** the rules for the store list `asistent.inout.presets`: name and length limits, add,
  rename, remove, next name. Rows of other versions are kept byte for byte. A save never stores a row the maths would refuse.
- **`panel/curvegraph.js` (new, pure rules and a mount):** a points-curve editor with the Keyframer's own limits (grab 12 px, add
  gap 0.015, drag gap 0.012, y -0.5 to 1.5, 16 points, double press 350 ms, Alt for a corner). The mount uses a fixed pool of 16
  circles and 16 squares, creates no node after mount and runs no timer. No page mounts it and it is not packed yet; both come
  with step 5. The Keyframer's own editor is untouched.
- **`panel/inoutui.js`:** own tiles right after None (with the base's filter and icon); drafts in `view()`; `editorView(state, raw)`;
  `afterDelete` falls back to the base preset; `afterPick` ends that side's draft; an unknown or draft id restores as None. With no
  own presets and no drafts everything is as in 0.10.134.
- **Review:** rules-reviewer BLOCK on the first pass: a one-frame pop on the arrival frame of a steep own curve at Strength other
  than 100; `added()` could save a row the maths drops; `set()` and a missed pointer release in the graph. All three fixed, with
  tests. Second pass: PASS; its three smaller points fixed too (the graph's missed-release check applies only where the press
  reported a button, `inoutpresets.js` is in the packing test, a draft counts only for the preset it was made on).
- **Built-in results unchanged:** a pinned hash test in `tests/inoutplan.test.js`, plus a one-off comparison of 13,233 `plan()` /
  `needs()` outputs against the 0.10.134 code: identical.
- `scripts/package_ccx.sh` packs `inoutpresets.js`.
- **Tests:** Node 553 pass (495 at 0.10.134). New: `tests/inoutpresets.test.js`, `tests/curvegraph.test.js`; `tests/inoutplan.test.js`
  and `tests/inoutui.test.js` extended. No Python file changed; pytest not run.
- **Not verified:** not installed (the user still has 0.10.134 to try), not bridge-tested (nothing to press yet), not pushed. The
  graph has never run in UXP.

## 0.10.134 - In & Out tiles: a pick is seen on the first click (2026-11-21, installed, not pushed, cause not proven, awaiting the user's look)

- **The user's report (0.10.133):** "I have to double click the buttons for them to work".
- **Measured:** the engine log has every one of the user's tile presses on the first pointerdown, and the page's state changed on
  it (replayed through the bridge: a hover and one press give the picked class, the "In · ..." label and the summary). So the
  pick was made and not seen. The bridge reads the DOM, not what Premiere paints, so the cause is not proven.
- **Changed, for the two things that can hide a pick while the pointer stays on the tile:**
  - a pick takes the hover away: the caption stops saying "Preview: ..." and the pick plays from its first frame (before, a click
    on the tile under the pointer changed nothing in the preview, as the hover was already playing that preset);
  - the picked look is stated for the hovered and the pressed tile too (`style.css`), and it is set again when the button goes up,
    in case Premiere puts back the look from before the press.
- **Logging (temporary):** each tile press writes "inout: tile <side> <id> down / up" with the tile's class, border and background
  as Premiere computes them, so the user's next presses show whether the look was there after one click.
- Node 495 pass (the wiring test extended). No Python file changed.

## 0.10.133 - In & Out page as Tiles, the user's choice of layout A (2026-11-21, installed, reviewed, bridge-tested, not pushed, awaiting the user's look)
- **Why:** the user asked for three different layouts, "optimized for fast and easy use", and chose A. Three working mockups were
  put on a design canvas: A Tiles, B Two columns, C Quick pairs. The user answered "A Tiles". It replaces the compact layout of
  0.10.132 (installed and bridge-tested, but never seen approved by the user).
- **Now, top to bottom:** the preview full width (a drawing of 208 x 94 px centred in a full-width frame, a 46 x 32 px box, the
  caption inside the frame; while the pointer is on a preset it reads "Preview: ..."). Then the In | Out switch, whose labels show
  the current picks. Then filter chips All / Move / Scale / Spin / Fade (one filter for both sides, remembered; old saved values
  open on All; None is always shown). Then the active side's presets as tiles in 3 columns (2 columns below 280 px), each with a
  small drawn icon of what moves.
- **Picks and hover:** all tiles of both sides always exist; the other side and filtered-out tiles are hidden. A pick by id shows
  its side and resets the filter to All when the tile would be hidden. Hovering a tile plays it in the preview without picking.
- **Dock (always visible):** the active side's length as a stepper (minus, frames, plus); Edge as four drawn arrow buttons and Turn as
  two, when they apply; Strength % and a "Blur on / off" pill; Apply (wide) and Remove; then the summary and status lines. Edge and
  Turn sit in the dock, so the tiles never move on a pick. The arrow characters of 0.10.132 are gone (drawn SVG icons).
- **Unchanged:** hide and grey rules, status and Undo wording, Apply and Remove behaviour, `premiere-inout.js`, `inoutplan.js`, and
  the preview's drawing rule (two SVG shapes made once, nothing added or removed per frame).
- **Files:** `panel/inout.js`, `panel/inoutui.js` (FILTERS, tiles, shownTiles, afterPick, filter in restore / snapshot / view),
  `panel/inoutpreview.js`, `panel/style.css` (the `.io-*` block replaced), `preview/scenarios.js` and `preview/shoot.js` (new
  scenarios `inout-scale` and `inout-hover`), `tests/inoutui.test.js`, `tests/wiring.test.js`, `tests/inoutpreview.test.js`.
- **Measured in the browser harness only:** page content with the All filter 540 px for In (21 tiles) and 432 px for Out (14
  tiles) at 300 and 420 px; 756 px and 540 px at 240 px (2 columns); the dock 125 px (151 px at 240 px when Edge wraps). With a
  filter on, the list is 1 to 3 rows. Screenshots at 240, 300 and 420 px read.
- **Tests:** Node 494 pass (490 at 0.10.132). No Python file changed; pytest not reported for this version.
- **Not run yet:** the review verdict, the install and the bridge test.
- **Not verified in Premiere (the user's look needed):** the real panel's column count and tile look, the preview frame (in a wide
  panel a slide appears and disappears at the edge of the drawing, some way inside the frame), the icons, the hover.
- **Git:** 0.10.131 was pushed to GitHub on 2026-11-21 (`improvements/2026-11` at `c2397d0`). 0.10.132 (`7552dca`) and 0.10.133
  are local only.

- **After the first write-up of this entry:** rules-reviewer BLOCK for one bug, fixed before the install: a press on the length
  stepper while the length box had the focus was lost or shown but not applied (paint() never rewrites a focused box, so the box's
  own commit read the old number back); the stepper now writes the box itself. Also fixed from the review: a hover is dropped when
  a filter hides its tile, and the stepper does nothing on a side that is None (it used to clear a remembered length). A stale
  header comment in `inoutpreview.js` corrected. Node 495 pass (one new wiring test for the stepper).
- **Bridge test in NEW TEST (installed 19:26, panel 487 x 523 px):** 3 tiles per row, all 35 tiles 139 x 48, no clipped name; In / All
  372 px of tiles (7 rows), Out / All 264 px (5 rows); dock 151 px, stepper and Edge on one row, Blur pill at the right end; preview
  svg centred in its frame, caption inside it; every tile icon drawn with a stroke. Filters hide the right tiles, a pick by id under
  a filter goes back to All, a pick of a visible tile keeps the filter. Tile positions identical for Pop, Slide and Spin In. Stepper:
  +3 and -1 as expected, nothing on a None side, the Out side changes only its own length, and with the box focused and 20 typed a
  plus gives 21 in the box, the summary and the store. Hover changes only the preview and its caption; 20 quick pairs leave one box;
  a filter that hides the hovered tile ends the hover. The preview stops on another tab, restarts on return, rests after 8 plays.
  Apply (In Slide from the top 14f, Out Fade 11f: 16 position keys and 12 opacity keys, 2 Undo steps named) and Remove left the
  chain as found, including a Transform of the user's own on that clip, which was not touched. No "arrived at" or error line in the
  engine log since the install.
- **Seen in that test, open:** at that panel height only about 2 tile rows show between the preview and the dock (the scrolling
  area is 307 px and the preview, switch and chips take about 208 px). The Out switch button is 1 px wider than the page.

## 0.10.132 - In & Out page rebuilt compact (2026-11-21, installed, reviewed, bridge-tested, not pushed, replaced by 0.10.133 before the user's look)
- **Why:** the user, 2026-11-21: "we also need a better UI for this its super unoptimized". At a 300 px panel the page was about
  1600 px of scrolling: intro card, preview card, In list (20), Out list (13), Settings card, stacked.
- **Now:** the intro card is gone (its sentence is in the Apply tooltip). One top card holds the preview and the settings beside
  it, or under it in a narrow panel: In and Out frames on one row, Strength % and a labelled Blur switch, Edge as four arrow
  buttons, Turn as two. The preview is 104 x 72 px with a 36 x 26 px box (was 148 x 104 and 52 x 36).
- **In | Out switch:** the buttons show the current pick ("In · Slide", "Out · Anticipate"), and only that side's preset list
  shows, in smaller buttons. The side is remembered in `asistent.inout.ui`; old saved values open on In; a pick by id also shows
  its side.
- **Hover:** pointing at a preset plays it in the preview without picking it. A hover is never saved and never writes to Premiere
  (`inoutui.hoverView`, pure).
- **Dock:** a one-line summary under Apply and Remove, for example "In Slide 12f · Out Anticipate 16f".
- **Measured in the browser harness** (pane top to the last card, one side): 479-499 px at 240 px, 378-401 px at 300 px (about
  425 px after the Blur label got its own row), 355 px at 420 px. No horizontal overflow. Screenshots at 240, 300 and 420 read.
- **Unchanged:** every earlier id (`ioIn-*`, `ioOut-*`, `ioDir-*`, `ioTurn-*`, `ioInFrames`, `ioOutFrames`, `ioStrength`,
  `ioBlurSwitch`, `ioApply`, `ioRemove`); the hide and grey rules; `premiere-inout.js` and `inoutplan.js`; the preview's drawing
  code (two SVG shapes made once).
- **Files:** `panel/inout.js`, `panel/inoutui.js`, `panel/inoutpreview.js` (constants), `panel/style.css` (`.io-row` removed;
  `.io-top`, `.io-pvcol`, `.io-set`, `.io-pair`, `.io-glyph`, `.io-seg`, `.io-list`, `.io-sum` added), `preview/scenarios.js` and
  `preview/shoot.js` (new scenario `inout-out`), `tests/inoutui.test.js`, `tests/wiring.test.js`.
- **Tests:** Node 490 pass (487 at 0.10.131). No Python file changed; pytest not reported for this version. Review verdict, install
  and bridge test: not yet.
- **Not verified in Premiere (the user's look needed):** whether the arrow glyphs ← ↑ ↓ → ↻ ↺ render in UXP's font (fallback:
  inline SVG icons); whether a 300 px panel really gets the side-by-side layout in UXP; the hover preview's behaviour.
- **Git:** 0.10.131 was pushed to GitHub on 2026-11-21 with the user's yes (branch `improvements/2026-11` at `c2397d0`). 0.10.132
  is not pushed.

- **After the first write-up of this entry:** rules-reviewer PASS, no must-fix. Five of its notes taken before the install: the Edge /
  Turn line keeps its height when empty (the list must not jump under the pointer), a hover is dropped when its list is hidden or the
  pointer leaves the page, the side switch does nothing while busy, a number typed without Enter counts on Apply (the commits now run
  before the busy flag; broken since 0.10.129), and pointer moves do not restart the preview while Apply or Remove writes.
- **Bridge test in NEW TEST (installed 18:50, panel 484 px wide):** preview and settings side by side; first card to last card 365-367 px
  on both sides; no overflow; edge and turn buttons on one row, 23 x 20 px. Side switch keeps the hidden side's pick; a pick by id shows
  its side. Hover on Elastic changed only the preview and its caption, the stored choice stayed; 20 quick enter / leave pairs left one
  box in the preview. The preview stops on another tab, restarts on return, rests after 8 plays. Apply (Pop: 13 scale keys, 2 Undo
  steps named) and Remove left the chain as found. No "arrived at" or error line in the engine log since the install. The list still
  moves 2 px when the Edge row appears. Not typed through the bridge: the frames boxes (no fill id). Not seen by anyone: what is painted.

## 0.10.131 - The In & Out preview no longer crashes Premiere (2026-11-21, installed, not released, awaiting the user's look)
- **Crash:** 0.10.130 was installed at 18:17 and Premiere 26.5.3 crashed at 18:18:44 during the bridge test, six seconds after the
  In & Out page was opened with the preview looping. Crash report: EXC_BAD_ACCESS on the main thread in UXP's SVG painter
  (`torq::ui::SvgGeometryNode::prePaint` -> `NodeImpl::hasAttribute`). It is the only crash report with that signature.
- **Likely cause (not proven by a second crash):** the preview removed its box and created a new one on every frame at 30 fps,
  and the painter still held the removed node. The Keyframer's preview draws the same way but plays once on a press.
- **Fix:** `panel/inoutpreview.js` creates its two shapes once and never takes them out of the tree; a frame only changes the
  `points` attribute and the opacity. Also from the review of 0.10.130: the loop rests after 8 plays without a pointer move or a
  new pick, stops while Apply or Remove writes, and does not retry after a draw failure.
- **Tests:** a new test runs the real `mount` on a fake tree for 400 frames and asserts no node is created or removed after the
  build. Node 487 pass. Pytest at 0.10.130: 954 passed, 24 skipped (no Python changed since).
- **Bridge test in NEW TEST (0.10.131):** three rounds of the tab sequence that crashed 0.10.130 and about five minutes of looping, Premiere stayed up and no new crash report appeared; the preview keeps exactly one box and one outline. Stray presses: on a grid over the page the old rule would have pressed a hidden button at 1142 of 3522 points (In & Out showing) and 1885 of 4516 (Brand showing), the new rule at 0. Preview: 52 steps for Pop, 65 with Out Slide, all four edges travel the right way, stops on another tab, restarts on return, rests after 8 plays. Apply (Pop, 13 scale keys, 2 Undo steps named) and Remove left the chain as found. Not seen by anyone yet: what is painted.
- 0.10.130 was never committed on its own; this commit carries both.

## 0.10.130 - Stray-press fix on every page, and In & Out Phase 4: the preview (2026-11-21, not installed, not released, awaiting the user's look)
- **Fix: clicks on the settings opened other tabs.** The user's report of 2026-11-21: "when I click somewhere on the settings it opens up the other tabs", on Motion and Brand.
  Cause: the 0.10.77 safety net `strayPresses()` in `panel/main.js` pressed the first button whose rectangle held the pointer when a press
  landed on a non-button. In Premiere 26.5.3 a button inside a hidden pane keeps the rectangle it had when the pane was last shown (measured
  through the bridge: 63 of 296 buttons, offsetParent and offsetWidth non-zero too), so clicks on labels, card backgrounds and the Tracker
  picture pressed buttons of pages visited earlier: Tools actions (which jump to the Tools tab), Keyframer presets, and once a Brand asset was
  imported and placed from a click on an In & Out label (engine log 18:09:09). Every page was affected; the stray presses have been in the
  logs since 15 November, and the cause is older than In & Out (commit afff051).
  Fix: the net skips any button with a `hidden` ancestor. New `tests/straypress.test.js` (4 tests, run against the real source cut from
  `main.js`); the original Track / Stop case still passes.
  Known gap, not fixed: only `#app` is checked for scrolled-out buttons. `#work` and `#result` (max-height 240 px, scrolling, outside `#app`)
  could still have a scrolled-out button stray-pressed (found in review).
- **In & Out Phase 4: a Preview card** at the top of the In & Out page (new `panel/inoutpreview.js`, tests in `tests/inoutpreview.test.js`).
  It plays the picked In and Out presets on a sample box, from the same rows `inoutplan.plan()` gives Apply, with the page's edge, turn,
  frames and Strength. The loop is In, 15 frames of rest, Out, 24 frames of pause, at 30 fps. Both None: a resting box and no timer.
  It uses the Keyframer preview's technique (an SVG polygon redrawn with setTimeout) and its `.kf-pv*` classes; the Keyframer code is
  untouched and no CSS was added.
  It never writes to Premiere or to the store. The timer stops when the pane is hidden, after 8 plays without a pointer move or a new pick,
  during Apply and Remove, and after a draw failure. `openTab` wakes it (`inoutPage.wake()`; `inoutPage` is now a `let` beside `trackerPage`).
  The frame is a fixed 148 x 104 px with a 52 x 36 px box: it shows the motion, not the clip's real size, and it does not draw motion blur.
  The blur switch already existed since Phase 3 and is unchanged.
- Packed in `scripts/package_ccx.sh`; wiring test added in `tests/wiring.test.js`.
- Checks: Node 486 pass (467 at 0.10.129; 19 new: 14 preview, 4 stray press, 1 wiring). No Python changed. rules-reviewer PASS, no must-fix.
- Not run yet: pytest, the install, the bridge test.
- Not verified: the user has not seen the preview's drawing or layout in Premiere, and has not confirmed the click fix in real use.

## 0.10.129 - In & Out animations: Phase 3, the page (2026-11-21, installed on the development Mac, not released, awaiting the user's look)
- 0.10.128 was an install-only step on the development Mac for the bridge test; it was never committed or released and has no entry of its own.
- New Motion → In & Out page: `panel/inout.js` (the page) and the pure helper `panel/inoutui.js` (what the controls show and say, Node-tested in `tests/inoutui.test.js`).
  An In card and an Out card, each with None and its presets grouped Position / Scale / Rotation / Opacity (20 In, 13 Out).
- Controls: Edge (Left, Top, Bottom, Right) only when a picked preset needs it; Turn (Clockwise, Counter-clockwise) only when one rotates;
  In frames and Out frames (a preset fills its own length unless the editor typed one); Strength % (greyed, with the tooltip "Strength does not
  change this animation", on presets where it changes nothing); a Motion blur switch.
- Apply and Remove are in the dock. Apply runs on every selected video clip. Nothing runs by itself (no live update, no timers).
  While both sides are None, Apply says "Pick an In or an Out animation first." and writes nothing.
- The status line says how many clips and keyframes, the Undo count ("Cmd/Ctrl+Z 2 times" the first time, once after), skipped clips with
  their reasons, "Shortened to fit the clip", and notes. The choices are remembered in the panel store (`asistent.inout.ui`).
- The Motion tab has four pages now: Keyframer, Tracker, Anchor, In & Out. The four Motion buttons get narrower padding below 260 px so "In & Out" fits.
- Hooks in existing files: `panel/index.html` (tab, pane, dock), `panel/main.js` (page list, Motion tab, dock switch, mount, remembered choices),
  `panel/style.css`, `scripts/package_ccx.sh` (packs both new modules), `tests/wiring.test.js`. Browser preview: `preview/fake-inout.js`, four scenarios.
- Test bridge in NEW TEST on 0.10.128, 10 checks passed: navigation shows one pane and one dock at a time; every preset's Edge / Turn / Strength
  state matches the maths (33 presets, 0 mismatches); clamps (frames 1-1000, strength 25-200); Apply through the page writes what the direct
  call writes, with the right Undo counts; the blur switch gives Shutter 180 / 0; three clips, a reversed clip skipped with its reason, shortening,
  the graphic note; Remove and "Nothing removed"; nothing selected refused; nothing written without Apply; the Keyframer, Tracker and Anchor pages
  unaffected; no panel errors in the log.
- Four small fixes after that run: a frames box no longer pins the default when only focused; typed numbers are committed at Apply; the hint
  while both sides are None; a stale status line is cleared when a choice changes. Reinstalled as 0.10.129 and smoke-tested through the page
  (Pop applied: 13 scale keys, the 2-Undo sentence; Remove restored the chain).
- Not verified: the user has not looked at the page in Premiere yet. The bridge reads the DOM, not what is painted: the card layout, the greyed
  rows, the dock, the four Motion buttons at narrow widths, tooltips, and how the animations look in playback.
- Tests: `node --test tests/*.test.js` 467 pass (451 at 0.10.127; new `tests/inoutui.test.js`). No Python changed (954 passed, 24 skipped earlier today).

## 0.10.127 - In & Out animations: Phase 2, apply, re-apply and remove on the Premiere side (2026-11-21, installed on the development Mac, not released, no page yet)
- 0.10.126 was an install-only step on the development Mac and was never committed or released; it has no entry of its own.
- New `panel/premiere-inout.js`: `apply` puts the picked In and/or Out preset on every selected video clip. Each clip gets one
  Asistent-owned Transform, tagged in its Skew Axis and recorded in the panel store (`asistent.inout.v1`), with baked keys (one per
  frame, from `inoutplan.plan()`) for Position, Scale, Rotation and Opacity, and optional motion blur (Shutter Angle 180).
  `remove` takes that effect off again; `info` reads the state. Clips with a Graphic group (Premiere text) get the Transform inserted before the group.
- Undo: a first Apply is 2 steps for any number of clips (the effect, then the tag and keys), a re-apply is 1, Remove is 1. The result says the number.
- Never writes the editor's Motion, Opacity or own Transform, and never removes a track item.
- `panel/inoutplan.js` gains pure exports: `boxOf`, `exitDistance`, `edgeOf`, `transformKeys`, `capCheck`, `boxUsable`, `MIN_SIZE`.
  They turn the frame rows into Transform values from the clip's on-screen box. Rotation is handled in the clip's own rotated axes.
  A clip whose Motion scale is 0 or tiny is skipped for position presets, with a reason. Non-finite keys are never written.
- Two protective hooks in existing files, on the user's go-ahead (2026-11-21): `premiere-keyframes.js` `readSelection` skips In/Out's
  tagged Transform, so the Keyframer neither lists nor reshapes its keys; `premiere-blur.js` `addOwn` now needs the Transform count to
  rise by exactly one and refuses a tagged one. Nothing changes when the blur's add works.
- `devbridge.js`: test-bridge commands `inout_info`, `inout_apply`, `inout_remove` (test projects only). `scripts/package_ccx.sh` packs both new modules.
- Nothing in the panel's UI changed: the feature is reachable only through the test bridge. The page is Phase 3.
- Bridge test in NEW TEST, sequence "Asistent probe – In Out", 13 checks, all passed: key values match the maths to float noise on
  plain, trimmed, 200 % and 50 % clips and on a Basic Title graphic; frame 0 fully off screen and the landing bit-identical to the
  baseline; Undo 2 / 1 / 1 on three clips; blur smears by half the per-frame travel, and off is sharp; In + Out longer than the clip
  is shortened; a small off-centre clip exits fully and lands exactly; the Keyframer no longer lists our Transform; the blur's and
  our Transform never touch each other in either order; an editor's own untagged Transform is never written or removed; refusals
  (nothing selected, no preset, unknown preset, reversed clip, key cap) write nothing.
- Rotation conversion: measured at 30°, then re-checked live on five rotated clips (30°, 30° off-centre, 90°, −45°, 15° larger than the frame; 25 runs): travel along the screen axis within 0.5 px, fully off screen at frame 0, lands exactly.
- Not verified by the user: how the motion looks (the bridge reads numbers only).
- Known limits, open and not fixed: `BUGS.md` "In & Out".
- Tests: `tests/inoutkeys.test.js` new. Node 451 pass (433 at 0.10.125). Python: pytest in a scratch HOME 954 passed, 24 skipped,
  run before the last fixes; no Python changed since.

## 0.10.125 - In & Out animations: Phase 0 live probes, the key base on sped-up clips (2026-11-21, not installed, not wired)
- Probes P1-P9 ran in NEW TEST through the bridge, no crash (`docs/probes/inout-phase0.md`). Measured: Transform's Position is a
  fraction of the layer, Scale percent, Rotation degrees clockwise, Opacity 0-100; at rest the picture is bit-identical; it acts
  after Motion around the clip's visible centre and crops nothing; per-frame keys + Shutter Angle blur; Undo per press (add 2,
  keys 1, re-apply 1) for three clips; the blur's Transform and the tagged one never touch each other; on a text graphic it
  works when inserted before the Graphic group (appended: Position only) and pivots on the frame's centre.
- **Decision (DECISIONS):** In & Out writes to an Asistent-owned Transform, never to Motion.
- **Fixed in `inoutplan.times`:** a key's time is `inPt × |speed| + f × |speed| / fps`. With `inPt` alone every key of a
  trimmed 200 % clip landed before the visible media (measured). Unit notes for Phase 2 in the module.
- BUGS: the Keyframer on a clip that is both trimmed and sped up may have the same base problem (to check).
- NEW TEST now holds the sequence "Asistent probe – In Out" (plain, trimmed, 200 %, 50 %, Motion-keyed clips, a text) for
  the next phases' tests. Tests: 433 Node. Nothing in the panel changed; not installed.

## 0.10.124 - In & Out animations: Phase 0 desk findings and Phase 1 maths (2026-11-21, not installed, not wired)
- Plan `docs/IN_OUT_PLAN.md` (approved 2026-11-21): In and Out animations for the selected clips, with separate preset lists.
  This version is the first two steps only. Nothing is in the panel yet: no page, no Premiere code, not in the zip.
- New `panel/inoutplan.js` (pure, Node-tested): `IN_PRESETS` (20: Slide, Glide, Whip, Overshoot, Elastic, Bounce, Drop;
  Pop, Pop Soft, Pop Elastic, Pop Bounce, Slam, Zoom In; Spin In, Swing, Twist Pop, Roll In; Fade, Slide Fade, Pop Fade) and
  `OUT_PRESETS` (13: Slide, Whip, Anticipate, Drop; Shrink, Pop Out, Zoom Out; Spin Out, Twist Shrink, Roll Out, Swing Out;
  Fade, Slide Fade). `plan()` gives one row per sequence frame (offset, scale, rotation, opacity), with pins, shortened
  frames when In and Out meet, and a key-cap error. The maths is unit-neutral on purpose: no Premiere units are assumed yet.
  Curves are reused from `keyframeplan.js` and scale is capped by `blurplan.SCALE_MAX`; nothing is copied.
- Desk findings in `docs/probes/inout-phase0.md`: a second Asistent Transform next to the blur's, the hooks it needs,
  Transform units from the repo, key times and Undo steps. The live probes P1-P9 are written, not run (Premiere held a
  client project; the scripts in `docs/probes/inout/` are syntax-checked only). The owned-Transform decision waits for them.
- Tests: `tests/inoutplan.test.js` 21 new. Node 433 pass (412 before). Python unchanged (954 pass, 24 skipped).

## 0.10.123 - Cut silences: the razor's timecode on an odd frame rate (2026-11-21, installed, the user's next press to confirm)
- The user's first press of 0.10.122 ("Lokal 2", 4a1a, iPhone clips, 59.974 fps, 29:45, 436 cuts): the new check stopped the cut
  with "no clip edge at 434 of 436 cut frames", nothing removed, and logged the evidence the probe was waiting for: frame 16058
  (4:27 at this rate) was handed to the razor as "00:08:55:08". `Time.getFormatted` counted 30 frames to the second; the razor
  reads the string with the sequence's 60, so every cut landed at twice its time.
- `host.jsx as_cut_timecode`: a plain timecode is written by the host with the sequence's own whole-number frame base
  ("00:04:27:38" for that frame); drop-frame strings (probed at 29.97) and non-timecode displays stay Premiere's own. The first
  razor is checked at once and the cut stops there if it did not land (one stray cut in the duplicate instead of hundreds);
  the log carries both strings (`tc`, `tc_own`).
- Built from the log, not from a probe: the user's project was open, the bridge works only in the test projects. That the razor
  counts 60 frames to the second on this sequence is inferred from the cuts landing at twice the time; the next press shows it.
- Tests: 1 new Node (412 pass); Python unchanged (954).

## 0.10.122 - Cut silences audited and repaired: the host cut, the ElevenLabs path, takes and detection (2026-11-21, not installed yet, untested in Premiere)
The user: "do an audit with the agents ... on the rest of the cut silences", then "use the agents to fix them". Four read-only
audits (logs of real use, detection, engine code, panel and host), three builders, one review that blocked the first version
(it cut two things HEAD kept) and was answered. Found in the logs: since the host cut (0.10.108) no real project got a result:
two presses on a 59.97361 fps sequence (iPhone footage) failed with "Premiere did not cut the new sequence", two were cancelled
after 4-5 minutes because Detect had stayed on AI-assisted.
- **Host cut (host.jsx `as_cut_*`, premiere-roughcut.js):** clean removes only clips that overlap no kept piece, and nothing at
  all when a kept piece has no clip (a razor that landed off used to remove kept speech); after the razor the host checks a
  clip edge exists at every asked frame and stops with the frame rate named and the first razor's timecode and clip counts
  logged (the odd-frame-rate failure is now DETECTED, not fixed: it needs a probe in Premiere); Cancel works between rounds; a
  stopped or doubtful cut is headlined "Stopped at ..." / "Made, but the check found ...", only a clean one "Done"; every round
  does at least one item; lock states go back; the result says about how many Undo steps; no silent fall to the copies path
  over 40 pieces.
- **Words only when used (roughcut_job):** read (and sent) only when Remove hesitation sounds is on or Cut = AI rough cut; AI
  rough cut reads them with any Detect, Manual dB included (it used to read none and still say "AI rough cut").
- **ElevenLabs path (fixes to 0.10.121):** a run is ReShape when the project folder OR any media path is (NFC, whole words,
  `denkov` anywhere); the subtitles' cloud key no longer hashes the names prompt, so readings really are shared (cloud readings
  made with a names list in 0.10.119-0.10.121 are read once more); a failed reading is not remembered; clips over 5 minutes are
  cut into parts unless their whole reading is cached; a failed window is read here in parts; two retries on busy / timeout;
  estimated progress; a cancelled upload that finishes is kept; four requests at once; old cached shouts are cleaned.
- **Detection (silence.py, takes.py, edl.py):** `drop_flashes` drops only a video piece another camera covers, never sound (a
  camera clip's last frames could go black, a microphone's last frames of speech could go); the dead-channel rule of TODO SIL
  (a clip whose line is under -60 dB counts as speech only where Silero is sure, half-heard stretches kept and flagged, off
  with one microphone); ranges of one file share their noise floor and may only keep more; a word guard in the AI modes (a cut
  covering a word's start is trimmed, a word mostly inside a cut is kept and flagged; not in Manual dB); a false start is cut
  when the full sentence only adds words (per take: a take differing by a number or a negation is still only listed); the
  takes window is really 90 s (beyond 12 sentences: exact with 5+ words, listed only); a lone exact repeat of 4 words or fewer
  is listed, not cut.
- **Panel:** a line in the options says before the press whether the words go to ElevenLabs or are read here; Settings group
  "Speech recognition" covers both features; Manual dB that would remove over 60 % asks for a second press (checked on a
  preview run, nothing written); Suggest says why it did nothing; "Skipped" became "Not in the new sequence"; the preview's
  signature holds the source In point and a pending option change is flushed before the cut.
- Not done: the frame-rate fix itself (probe), words read from both microphones of a split L/R clip (`window_audio`, protected
  file), words reused across "Listen to" ticks, a hesitation glued to a word, Calm as default, keeping unselected clips.
- Tests: 954 Python (24 skipped) + 411 Node pass; `reshape_golden.py check` identical. Nothing run in Premiere.

## 0.10.121 - Cut silences: AI-assisted words by ElevenLabs, about 4x faster and better at takes (2026-11-21, not installed yet: `release_mac.sh` waits for the user; untested in Premiere)
- The user (2026-11-21): "can we also use elevenlabs there to recognize speech faster make the cuts more precise?". Only the
  AI parts of Cut silences recognise speech (Detect = AI-assisted, needed for hesitation sounds, and Cut = AI rough cut for
  repeated takes); Automatic and Manual dB stay as they were, without words. Where the cut sits still comes from each
  microphone's level every 10 ms: the words decide what goes (a hesitation, an older take), never the cut's edge.
- `roughcut_job.read_cloud`: when ElevenLabs is on (key saved, switch on), each window of the dialogue mix is read by Scribe
  v3 instead of Whisper large-v3. It is the subtitles' own reading (same sound, same request, same cache key), so a window
  either feature sent is never sent again. A window ElevenLabs cannot read is read on this computer as before (no model here:
  no words there) and the result says why. Never in a ReShape project (`is_reshape`: "ReShape" / "Решейп" / the doctor's
  name in the project's folder or in the share path behind a deeper Finder mount).
- Panel: the preview and the result say "N words recognised by ElevenLabs Scribe v3", and name what it could not read.
- Measured on IMG_9422 (Lokali, 3:56, AI rough cut + hesitation sounds, empty caches): recognition 139 s with large-v3, 34 s
  with Scribe; 581 against 662 words; Scribe heard two hesitation sounds Whisper left out (neither cut: both are glued to
  speech, the rule cuts only a hesitation standing alone) and found the repeated take „А карал ли си някога на симулатор?“ /
  „А карал ли си на симулатор?“ that Whisper's reading missed (1.6 s cut). Silence and off-mic cuts identical.
- Tests: 7 new Python (`tests/test_silence_cloud.py`), 1 new Node test and new checks in another; 901 Python + 384 Node pass.

## 0.10.120 - Subtitles froze at "Aligning the words to the sound…" on a clip with a shout (2026-11-21, installed, untested in Premiere)
- The user's first run of 0.10.119 in Premiere (NEW TEST, 6 pieces of IMG_9423, 29 s): the bar stood at "Aligning the words
  to the sound…" for minutes and the engine stopped answering. Cause: ElevenLabs wrote a shout as one word of 1000 letters
  („Оооо…“). The project has learned fixes, so every heard word is compared with the dictionary's neighbours
  (`_variants` -> `lexicon._candidates`), and that search grows with the square of the word's length: minutes of pure Python,
  which also kept the engine from answering the panel. Reproduced outside Premiere with a stack dump.
- `cloudasr.words_of`: a letter written more than three times in a row is cut to three („Оооо“). `lexicon._candidates`: a
  "word" of more than 40 letters is not searched (no Bulgarian word is that long; shorter words are untouched, ReShape golden
  identical). The same run now takes 8 s. Saved ElevenLabs readings holding such a word were removed on this Mac.
- Tests: one new (the 1000-letter word); 894 Python + 383 Node pass.

## 0.10.119 - Subtitles can be read by ElevenLabs Scribe: about 44 % fewer wrong Bulgarian words, about 14x faster (2026-11-21, installed, untested in Premiere)
- The user's audit request (2026-11-20): Bulgarian words in Auto come out wrong on every client but ReShape and the wait is
  long; ReShape must not change. Measured on 28 finished videos of five clients against the editors' burned-in subtitles
  (docs/BENCHMARK.md): shipped Auto 650 wrong or missing words of 4171, the best local profile 604, **ElevenLabs Scribe v3 365**;
  work per second of sound 3.1 s against about 0.2 s. Nearly all of Whisper's wrong words are wrong in its first reading, so
  no local setting moved it far. The user's decision (2026-11-21): build ElevenLabs in.
- **New: Settings > Subtitles.** Paste an ElevenLabs API key (Speech to Text access), Save key; Turn off / Turn on; Remove key.
  With a key saved, Auto and the five client styles send the SOUND of the selected clips to ElevenLabs (nothing else: no
  picture, names, prompt or corrections), each transcript is deleted there once its words are back, and the result says
  "Words by ElevenLabs Scribe v3". The ReShape style is always recognised on this computer. When ElevenLabs cannot be reached
  or refuses (no internet, key, no time left) the clip is recognised on this computer as before and the result says why.
- Engine: `cloudasr.py` (the request, the key in `<app>/elevenlabs.key`, never returned to the panel; plain urllib),
  `recognition.py` (one recognition profile per run: `CLASSIC` ReShape frozen, `STRICT` the 0.10.118 behaviour and still the
  local default, `CLOUD`, `NEXT` local experiments), `/cloud` endpoint. After Scribe the dictionary repair is off (it broke 6
  of Scribe's right words and fixed 1); corrections, learned fixes, writing rules, alignment and line cutting are unchanged.
- Local experiments kept behind the development switch `ASISTENT_RECOGNITION` only: the model in full precision
  (`asr.LARGE_FULL`, 285 / 326 against 315 / 335), `lexicon.repair(careful=)` and `repair_by_ear`, a second reading of the
  doubtful piece alone that cannot win with fewer words. Nothing changes on this computer for any style.
- Development: `scripts/bench_subtitles.py` (pick, refs, run, score, cloud) and `engine/asistent/bench/layers.py`; the office
  share is only read.
- ReShape: `scripts/reshape_golden.py check` identical; `tests/test_recognition_profiles.py` pins its profile, cache keys,
  the exact call and the result's keys; `tests/test_cloudasr.py` checks a ReShape run never asks ElevenLabs.
- Tests: 893 Python (24 skipped) + 383 Node pass. Not yet tried in Premiere. Cost: the free plan covers trying it (about 4.5 hours a
  month, no commercial rights); client work needs Starter, about $6 a month for about 27 hours (third-party price lists,
  2026-11: check elevenlabs.io/pricing).

## 0.10.118 - Exposure ±0.5 pressed twice fast crashed Premiere: effects read again only after Premiere settles (2026-11-18, installed, untested in Premiere)
- The user, 2026-11-18 11:48 (Premiere 26.5.3, GStroy КП11 Видео 8): Exposure +0.5 pressed twice fast on fx30-2-1826 and
  fx30-2-1830 crashed Premiere. The log stops right after the selection was read (the rest of the panel's lines were lost
  with Premiere); no crash report was written (none in DiagnosticReports or Sentry). Most likely cause: the known Premiere
  26.5 fault of 2026-11-15 (BUGS: a freed object handed to the script when a clip's effects are read straight after an effect
  was added), fixed then for the Keyframer only (0.10.87). The colour path added a Lumetri and read the effects at once from
  the old chain handle, and a press queued during the first one read them again with no pause.
- `premiere-color.js`: `attachedAll` (all four places that add a Lumetri: Auto color, Shot Match, ±0.5, rough cut colour)
  waits 60 ms once, reads the effects from a fresh chain handle and keeps the created Lumetri referenced. `main.js`: a
  queued ±0.5 press waits 60 ms before reading the clips again. `premiere-brand.js`: the same for the Brand Tint (the new
  one-click Apply row). Not reproducible on demand (intermittent); not yet tried in Premiere.

## 0.10.117 - Sync: short takes sync when the whole-second camera clocks wander up to 2 s (2026-11-18, installed with 0.10.118)
- The user's GStroy КП11 Видео 8 (49 clips): 7 pairs synced, obvious pairs left out (fx30210/1819, fx30212/1820,
  fx30216/1824, fx30226/1831, fx30231/1834, fx30232/1835). Cause: each is a short take with 2 agreeing stretches of sound, which needs
  the learnt camera clocks as the second witness, and that rule (and the "recorded at the same time" hints) only ran when
  the learnt clock's spread was at most 1.0 s; here it was 1.6 s (the FX30s write whole seconds).
- `groups.CLOCK_PRECISE` 1.0 -> 2.0 s. Nothing else changed in Sync. On Видео 8: 7 -> 11 groups, 35 -> 26 unsynced,
  fx30232/fx30233 with 1835 named as hints (the sound there is too weak). On 9 earlier shoots (GStroy brand test footage,
  GStroy КП11 Видео 2/7/9/10, MASTERHAUS КП3 Видео 1/6, КП2 Видео 8, Pulse Fitness КП5 Видео 7) no pair that synced
  before was lost or moved (0.00 ms); Видео 7 +1 pair, Видео 9 +5 (three of them a third clip joining an old pair).
- Tests: two new in `test_groups.py` (spread 1.6 s confirmed, 2.8 s not); 836 Python + 383 Node pass.

## 0.10.116 - Brand colours: an Apply row and a Copy row (2026-11-18, installed)
- The user, 2026-11-18: the Colours card shows two rows per colour group. A click in the **Apply** row puts the colour on the
  selected clips at once (same `PB.applyColor` as before: Tint for files and Premiere text, MOGRT colour control; the
  "Into:" buttons for other MOGRT controls still appear after the first press). A click in the **Copy** row copies the HEX.
  The separate "Apply to selected" bar under the swatches is gone. The ring marks the colour last used in the row it was used in.
- `panel/brand.js` (`swatch`, `swatchRow`, `state.hexRow`), `panel/style.css` (`.bk-swrow`, `.bk-swlabel`; `.bk-apply`,
  `.bk-chip`, `.bk-applyhex` removed), README and `docs/BRAND_KIT.md`. Node tests pass; seen in the browser preview at 240/300/420 px.

## 0.10.111-0.10.115 - Tabs, Keyframer dock, brand colour on text, Auto import on the project's folder, clearer Export check (2026-11-15, installed: 0.10.115)
The user's requests of 2026-11-15, after testing 0.10.110.
- **Tabs** ("clearly readable", "a distinct, modern" open tab, "avoid overly bright borders"): every tab name light grey
  (#c4c6ce instead of #9a9ca6); the open tab is a soft amethyst pill with white bold text; a faint fill under the pointer and on
  press. The old yellow underline (a one-side border colour) showed in Premiere as a yellow box round the whole tab: only
  whole-box borders now (`--tab-*` tokens). UXP runs no CSS transitions (css_probe 0.9.71), so the page that opens fades in from
  a script (four opacity steps, about 100 ms). Same tabs, ids and behaviour.
- **Keyframer: Apply always in view**: Apply, Undo last, Update live and the answer sit in a dock under the page (`#kfDock`, shown
  only with the Keyframer); the presets and settings above scroll. Measured in NEW TEST: the dock at the panel's bottom (49 px),
  the page scrolling above it (857 px of content in 425 px).
- **Brand colour on text made in Premiere** (the user: "the colour presets ... should be able to be applied to text"): Premiere
  26.5.3 still exposes no fill, font or size on its own text (probed again: the Text component has Position, Scale, Rotation,
  Opacity; Source Text null), so Apply to selected now puts a Tint on it: Map White To the colour, Map Black To black, Amount
  100 %, so white letters take the colour and a dark outline or shadow stays dark. Found on the way: a Tint APPENDED to a
  graphic's effects lands after its Text layer and draws nothing (0 pixels changed); inserted before the Graphic group it does
  (`createInsertComponentAction`). Measured on the MASTERHAUS text in NEW TEST with #ED1C24: the letters' most-changed pixels
  232,28,40 after (about 210,203,200 before); a second press reuses the Tint (one Undo step). The host lists the clips without a
  MOGRT (`others`), the panel tints those with Premiere's Text component; a nested sequence or a colour matte is left alone and
  said. Also measured: `ppro.Color` takes 0-1 values (`brandplan.COLOR_RANGE` = 1 is right; the Tint reads back 236,27,40).
  Captions on a caption track are not clips and cannot be coloured. The Colours tooltip says all this as rows.
- **Auto import on by default, watching the project's folder** (the user: "automatically on and ... link to the folder where the
  project is saved ... most of the time it's the folder where I download the assets"; the user chose Auto import, not Show
  exports): a project with no folder of its own and not switched off watches the folder its .prproj is in from the panel's first
  status call (`Store.auto_bind`); switching it off is remembered per project (`off`), even when another project in the same
  folder takes the folder over; Other folder… / a dropped folder still win. Existing projects keep the folders they had. Left
  alone in the watched folder: Premiere's previews, auto-saves, caches and Asistent_* folders (`importer.PREMIERE_DIRS`,
  shared with exports.py), and the editor's own exports (`ExportWatcher.is_export`: the file Premiere's preferences name, one an
  export event named, one already recorded), listed as "your export from Premiere, not imported". Found in NEW TEST: while
  Premiere auto-saves, the open project reads for a moment as its recovery copy (…/Adobe Premiere Pro Auto-Save/RecoveryProjects/
  NEW TEST--<id>.prproj); such a copy never gets a folder, and a binding made for one is dropped when the engine starts
  (0.10.114-0.10.115). NEW TEST now watches Ludi Glavi/Projects, steady over a restart.
- **Export check, organised** (the user: "more clear and organized warnings if something is wrong"): the engine adds `issues` to
  the report, one per kind with its places together, a topic (Picture, Sound, File) and what to check in Premiere (`FIX`); the
  summary counts issues ("Black bar at the bottom" at two times is one thing to look at, in 2 places). The panel shows the file
  and the verdict, then each issue in a warning card (heading, "2 places: 0:28.4-0:28.9, 0:30.4-0:31.3", what to check), then
  what passed in one green line and the numbers to know in one grey line (`exportcheck.afterSections`, pure). A report from
  before gathers its lines the same way (seen in the panel on the user's ASP_EDIT_V1.mp4: one issue, 2 places).
- Versions: 0.10.111 had the tabs, dock, Export check and the appended Tint; 0.10.112 the Tint before the Graphic group (a
  reinstall under the same version is skipped by Adobe's installer); 0.10.113 Auto import; 0.10.114-0.10.115 the recovery copy.
- Tests: node 383 (afterSections, the dock wiring, whole-box tab borders), pytest 834 (issues and fixes, auto_bind, the working
  folders, exports skipped, the recovery copy, is_export).

## 0.10.110 - Cut silences: no 1-frame slivers or gaps; tooltips as a summary and one row per choice (2026-11-15, installed)
- The user's test of 0.10.109 (2026-11-15): after closing the gaps of a "keep the spaces" result, little clips and 1-frame gaps
  were left between the clips. Measured in their sequences: a 1-frame clip on V1 and a 1-frame gap on V2, A3 and A4 at the same
  moments. Cause: the silence plan is timed on a 10 ms grid, so "no sound clip here" could end a fraction of a frame before the
  sound clip really starts (168.93 s against a clip at 168.935 s = frame 5062.98); rounded down, the kept part started one frame
  early, and the camera without sound kept a frame the others did not. Remove had the same 1-frame hole (v86).
- `edl.align_to_edges`: a cut edge within 1 frame of a clip's own edge is moved onto it (`run_silence`, before the pieces).
  "Remove, keep the spaces" now drops a camera's few-frame flashes like Remove does (`MIN_PIECE_FRAMES` + `drop_flashes`).
- Tooltips (the user: "more clear instructions and more organized"): `panel/tiptext.js` (pure) reads a tip as a summary line and
  "Name: what it does" rows; `showTip` shows the names in bold. Every Silences tip rewritten that way (Cut, Detect, Below dB,
  Suggest, Sensitivity, Pacing, the four Custom numbers, short pauses, hesitation sounds, Range, Result, Preview, the button).
  The Brand tab's tips that already had line breaks now show them as rows too.
- Checked in NEW TEST through the bridge after a restart: "keep the spaces" on the user's v83 (84 pieces, shared gaps closed in
  the check like Premiere's Close Gap), Remove on v83 and on SYNC – кам2 (4): no clip and no gap under 15 frames on any track,
  every piece verified, no crash. The tooltip shows its rows in the panel (DOM read); its look is not yet seen by the user.
- Tests: `test_a_cut_edge_a_frame_off_a_clip_edge_lands_on_it` (the user's numbers), keep-the-spaces drops what Remove drops,
  `tests/tiptext.test.js`. 827 Python + 379 node pass.

## 0.10.108-0.10.109 - Cut silences: the cut is made by the host in a duplicate of the sequence; the crash is gone (2026-11-15, installed: 0.10.109)
The user approved (2026-11-15, "Yes") the one removal this needs: clips removed by the host in Asistent's OWN duplicate, never in the editor's sequence.
- **How.** The engine's pieces now carry where they lie in the source sequence (`seq_in`, `seq_out`, frames; `edl.pieces` / `pieces_in_place`) and the result carries the review markers (`marks`). The panel turns them into a plan (`premiere-roughcut.js hostPlan`, pure: the frames to razor, only where a piece ends inside its clip; Mute razors the sound tracks only) and calls the host through `POST /roughcut/cut` one phase at a time (`host.jsx as_rough_cut`: start = `Sequence.clone()`, renamed, into the bin "No silence", opened; razor = QE sequence razor at drop-frame timecode with the other kind's tracks locked where only one kind is cut; clean = remove every clip that is not a kept piece; move = each piece by its frame offset; finish = review markers, In / Out reset to the whole cut, playhead to 0). Each call stops after 15 s and says where; the panel calls again. Every phase after start works only on the sequence whose id AND name start made, and the razor checks the sequence in front is that one.
- **Probed in NEW TEST before building:** `clone()` makes "<name> Copy"; QE track razor is unusable (QE hides tracks with a duplicate name), the sequence razor cuts every unlocked track frame exact; `TrackItem.remove(false, false)` and `move(Time)` change that one item only (a linked partner stays).
- **Measured in NEW TEST (bridge, "SYNC – кам2 (4)", 52 clips):** 17 runs, 0 crashes (was 2 of 8 at 0.10.107, 4 of 4 before): Remove ×7 (38 cuts, 84 of 84 pieces), Keep the spaces ×2 (85), Split only ×2 (178), Mute ×2 (68), In to Out inside clips ×3 (20). Every piece checked by the panel (place, file, source frame): "as written". The cut takes about 1 s. The source sequence: the same clip counts before and after. The pieces keep their effects and their video-audio links (the old way had to link them again).
- **0.10.109:** the duplicate came with the editor's In and Out (an In to Out cut of 33 s kept In 40.5 / Out 200.25): reset to the whole cut.
- The copies way (0.10.45-0.10.107) stays only as the fallback when the host is not running AND the pieces are at most 40; otherwise the editor is told the host is needed.
- Tests: `tests/hostroughcut.test.js` (the host cut against a model of Premiere: Remove, Mute, a sequence that starts at another timecode, a razor that did not cut, a phase pointed at the editor's sequence, the time budget), `hostPlan` in `roughcutclones.test.js`, `wiring.test.js`: `.remove(` in the host only once, in `as_cut_clean`.

## 0.10.99-0.10.107 - Cut silences crash on many clips: reduced, NOT fixed (2026-11-15, installed: 0.10.107)
Reproduced through the bridge in NEW TEST (`ASISTENT_LANE=26`; "SYNC – кам2 (4)", 52 clips, 85 pieces, Keep the spaces), about 60 runs, with breadcrumbs written to disk (`P.trace` -> plugin-data:/trace.txt).
- **What it is.** Premiere 26.5.3 crashes in its own scripting layer while it makes an object for the script (`v8impl::Reference` constructor: `napi_wrap`, a callback's argument, once even a text buffer for a file write), on the script's thread ("dvascripting::Engine3P"). Seventeen crash reports, the same place. With the breadcrumbs: always inside the project lock of the COPY step (`SequenceEditor.getEditor` + `createCloneTrackItemAction`), never in the trim / move step.
- **Second face of the same thing:** handles Premiere calls "no longer valid" a moment after it handed them out. It hands the script the same object for a clip each time it is asked, also when that object is already dead.
- **Kept (each measured):** actions made inside the lock before the transaction (outside the lock every `create...Action` is refused: probed); no clip handle kept between steps, the editor's clips located by numbers and read again for every batch; trim and move in ONE transaction with one handle (2 steps per batch instead of 3; 85 of 85 placed); a stale handle is read again and retried (4 tries); 1 s of doing nothing before every step; a batch is at most 20 pieces.
- **Result:** before: 4 of 4 runs crashed. Now: 2 of 8 runs crash (0.10.104, 0.10.105 and 0.10.107 alike), and some sessions refuse many pieces instead (reported, not crashed). Longer waits (0.45 -> 1 s) and collecting dropped handles did not change the rate.
- **Not the cause:** batch size alone (0.10.98), time since the last edit, which clips.
- **Decided:** the cutting moved to the host (0.10.108, above).

## 0.10.98 - Cut silences crashed Premiere on many short clips: a batch of copies is at most 20 pieces (the user 2026-11-15) - installed, NOT yet run in Premiere
- The user (NEW TEST, recording 15.33.44): "crashes when I select a sequence of POVs around 5 minutes; on a short selected clip it didn't". Crash reports 15:32:40 and 15:33:57: a bad pointer where UXP calls back into the script inside a transaction, the same place as the 204-copy crash of 05:09.
- Cause: 0.10.94 limited a batch by timeline length only (two hours of scratch). Many short clips all fit, so 94 and 133 copies went into ONE transaction. Every run in the log that worked had at most 58 copies in one transaction (41, 9, 58; batched runs 14-20 per batch, up to 202 pieces in all); every crash had 94 or more (94, 133, 204). The engine had finished in 1.7-1.8 s both times; the crash was in the placing.
- Fix: a batch is also at most 20 pieces (`BATCH_PIECES`). Test: 49 short clips, 146 pieces -> 8 batches, no transaction over 40 actions.
- Not reproduced in Premiere by me: the panel did not answer the test bridge, so the fix rests on the log's pattern.

## 0.10.97 - Cut silences: Manual dB failed on a clip of a few frames (the user's first run, 2026-11-15) - installed
- The user, In to Out + Manual dB -24: "operands could not be broadcast together with shapes (3,) (10,)". The Out point lay one frame into the next clip (IMG_9424), so that clip was 30 ms long, shorter than Manual dB's 0.1 s averaging window, and the averaged level came back longer than the clip. `silence.smooth_db` now never averages over more than the clip; In to Out leaves out a clip that reaches less than 0.07 s into the range. Tests: a 0 / 1 / 3 / 9-frame clip in every method; the one-frame sliver.

## 0.10.96 - Cut silences rebuilt after AutoCut: three modes, three detection methods, pacing presets, preview with review, four results (the user 2026-11-15) - installed, NOT yet run in Premiere
The user's brief: "review and significantly improve Cut Silences, using AutoCut Silences as the primary reference ... first audit, do not rebuild what works".
- **Audit.** Before: one mode (level + Silero per microphone, 0.10.65) plus the quieter-voices rule (0.10.95); the words-and-takes engine (Whisper, `takes.py`) existed but was hidden since 0.10.65; no preview, three fixed pacings, one result (remove and close). Kept: the per-microphone listening, Silero, the main-voice rule, `takes.py`, the clone-based sequence. No new library: pyannote was not added (no diarisation needed for these rules, and it would be a new model download).
- **Engine (`silence.py`): measuring and deciding are apart.** `measure` reads a clip once (level per 10 ms, Silero) and remembers it; `label_item` + `plan` decide from that with `settings`. A preview after a changed setting takes 0.15-0.2 s (measured on real clips), the first one as long as listening did before.
- **Modes (what goes):** Silences only (every voice stays) · Silences + off-mic (the 0.10.95 rule; a phrase within 2 dB above the line is kept and flagged "not sure") · AI rough cut (also repeated takes from the recognised words).
- **Detection (how speech is found):** Automatic · Manual dB (the editor's number alone: what stays under it goes, speech or not; short-term loudness, no Silero, no main voice) · AI-assisted (Automatic + Whisper's words, for hesitation sounds and takes). Sensitivity 1-5: Auto 12 / 10 / 8 / 6.5 / 5 dB under the main voice; Manual: the averaging time 0.01-0.4 s. Suggest proposes a dB (8 dB under the quietest microphone's main voice).
- **Pacing:** Calm, Measured, Paced, Energetic, Custom (minimum silence, minimum speech, padding before / after). Calm, Measured and Paced cut exactly what Calm, Normal and Tight cut before (a test compares them with the old rule); the labels now show the real pause length (1.3 / 0.87 / 0.65 s: the old "over 0.5 s" was 0.5 s left after the margins).
- **Remove short pauses** (own switch, on in Energetic): a pause between two numbers that the pacing leaves alone is trimmed to 0.12 s; one with a breath in it stays. **Remove hesitation sounds** (AI-assisted): ъъъ, ъм, um… only as a stretch of their own between two pauses; ами, значи, така are words and stay.
- **Repeated takes** go as whole stretches of speech between pauses, never into a neighbour (Whisper's times were 1.6 s early on the Lokali interview), and only when the take that stays is itself kept; otherwise they are listed.
- **Preview** (new button): the waveform with every part marked by kind (silence, off-mic, short pause, take / um, not sure), zoom and scroll, a tap keeps or cuts a part, the unsure parts also as lines with a Cut button, which tracks are listened to, each microphone's levels. A changed option updates it. Cut silences after a preview cuts exactly that, with the editor's choices; if the clips changed since, nothing is cut and it says so.
- **Range:** selected clips, In to Out, or the whole sequence. **Result:** remove and close the gaps · remove, keep the spaces · split only · mute the sound (picture whole, sound only where kept); always a new sequence, never a track muted or an item removed in the editor's own.
- **Measured.** Lokali IMG_9422 with the user's labels: Silences only keeps all speech (red 131.1 of 131.3 s stays); Silences + off-mic: green 22.7 / 22.7 s kept, red left 2.7 s, 1 part flagged; Manual -28 / -30 / -32 dB: green lost 2.3 / 1.2 / 0 s, red left 3.1 / 9.7 / 24.5 s; AI: green lost 0. Masterhaus C0728: the real quiet line (7 dB under) is kept and flagged. Tried and NOT used, because they did not separate the labels: Whisper word confidence (red 0.60-0.96, green 0.90-0.94), spectral tilt, and the level's range inside a phrase (it follows the recording's noise, not the distance).
- **Not built:** audio crossfades at the cuts and J / L cuts (UXP 26 has no audio-transition action; the host route needs a probe in Premiere, which was not reachable); filler removal inside a run of words; speaker diarisation.
- Files: `silence.py`, `roughcut_job.py`, `edl.py` (pieces in place), new `panel/silenceplan.js` (pure) and `panel/silences.js` (options, preview, cut), `roughcutplan.js` (ranges, result text), `premiere-roughcut.js` (In / Out, options), `index.html`, `style.css`. Tests: pytest 848 (+11), node 369 (+5); browser preview scenarios `silences*`.

## 0.10.95 - Cut silences cuts the quieter voices; clone errors no longer half-run; subtitles keep the reading that fits the sound (the user 2026-11-15) - installed, NOT yet run in Premiere
- **Quieter voices** (the user's recording 2026-11-15 5.54.05 and the red/green labels on "NO SILENCE – Lokali v10"): Auto kept
  people talking further from the phone, because they are speech. Measured on the labelled pieces of IMG_9422: green phrases
  0.0-0.2 dB under the clip's main voice, red 7.2-22 dB under, the guest's „Не.“ / „Да.“ 3-6 dB under; a single speaker's real
  softer line (Masterhaus C0728) 6.6 dB under. Auto now cuts a phrase (speech joined over gaps under 0.5 s) whose loudness (90th
  percentile) is more than 8 dB under the main voice (the level the loudest phrases reach that make up 10 % of the speech, at
  least 3 s), per microphone (`silence.drop_quiet`). IMG_9422: green 22.7 of 22.7 s kept, red 130.7 -> 2.7 s; ReShape export and
  Ludi Glavi IMG_5421: nothing cut. Options > Quieter voices: Cut (default) / Keep every voice; a fixed dB never drops voices.
  The result says how many seconds of quieter voices went and each microphone's main voice level.
- **Clone errors on the "Lokali" clip** (engine log 05:52, crash report 05:52:40): "Illegal Parameter type" from addAction and
  "The script object is no longer valid" on a trim threw out of the middle of a transaction; the actions before it stayed (whole
  copies left after the end of v7 and v8, no audio) and the next press crashed Premiere. Every piece's actions are now made and
  added one at a time inside the transaction; a piece Premiere refuses is skipped and named in the result, the rest is placed.
  The cause of the refusal itself was not reproduced (the user's Premiere held the client project).
- **Subtitles on fast speech** (Lokali: „а карал ли си с асимилатор“): the job's own second opinion had heard „Карал ли си някога
  реална кола? Не. А карал ли си на симулатор? Да.“, but the dictionary had already turned the first reading's „асимулатор“
  into the real „асимилатор“, so the two looked equally sure and the first stayed. Whisper also flips on fast speech with the
  level alone (3 of 6 gains each way). In every style but ReShape's, a piece with a word the dictionary does not know (before
  repairs) is read three ways (as is, alone with 2 s of context, the window +6 dB) and the reading whose text Whisper scores
  highest over the piece's sound is kept (at least 2 points better in total and per token; `asr.score_texts(counts=True)`).
  Lokali now: „Карал ли си някога реална кола? Не. А карал ли си на симулатор? Да.“ Whisper prefers „на симулатор“ to „със
  симулатор“ (-2.2 / -9.6). „ако ви биеш на съседание“ is heard so in every reading and level; Hunspell does not suggest
  „състезание“; it stays marked unsure (Names and terms fixes it). ReShape golden run identical.
- Tests: 837 pytest (+7), 364 node (+1).

## 0.10.94 - Cut silences no longer crashes Premiere on a long clip; dictionary repairs keep the syllables (the user 2026-11-15) - installed, NOT yet run in Premiere
- **Cut silences crash** (the user's screen recording 2026-11-15 5.10.12, three crash reports 05:09-05:10): at -30 dB an
  8-minute iPhone clip gave 101 cuts, 204 pieces with its audio. Every piece is first cloned as the WHOLE clip into its own
  slot after the end, so the copies reached 28.6 hours of timeline (the run before: 58 pieces, 4.1 hours, fine) and Premiere
  crashed inside the clone transaction (UXP `executeTransaction`, a freed object turned into JavaScript). The pieces now go in
  batches whose scratch area stays within 2 hours after the end (`SCRATCH_SPAN`); each batch is trimmed and moved into place
  before the next reuses the same empty area. Undo: 3 steps per batch (the result says how many). New
  `tests/roughcutclones.test.js` replays the case on a faked timeline (old code fails it).
- **Subtitles: the dictionary no longer turns a heard word into a different word** (the user: "the transcribing of the
  Bulgarian talking is very inaccurate"). In the 4a1a „Lokali“ run Whisper heard close to right, then `lexicon.repair` changed
  4 of 26 words for the worse: „съседание“ -> „съседни“ (said „състезание“), „Карао“ / „карао“ -> „Кара“ (said „карал“),
  „асимулатор“ -> „асимилатор“. A repair may no longer add or drop a syllable, except a vowel next to я / ю (одяло -> одеяло);
  the colloquial -л said as о / у (карао, карау) is written -л before the dictionary is asked. On the 16 repairs of all 30
  earlier runs this removes the 6 wrong or doubtful ones and keeps every right one; the 2 left (асимилатор, туни) cannot be told
  apart by any rule or by the sound check (measured, DECISIONS). The step and its ties are decided as before and only then is a
  word with a syllable more or less dropped, so the rule can only take a repair away (a first version let a looser step reach
  „хирурги“ -> „хирурга“; the ReShape golden run caught it). **The ReShape style keeps the old rules** (the user: "leave
  ReShape as it is"): its golden run is byte-identical. Correction lines match the spellings of both rule sets.
- Measured on the Lokali clip with the new rules: Whisper itself varies between runs („Карао“ once, „Кара“ the next); with two
  terms in Names and terms („симулатор, състезание“) the whole clip came out right except a doubtful „ви“. ReShape's accuracy
  comes from clean lavalier speech and its projects' correction lines (subtitle_settings.json), not from the style.

## 0.10.93 - Anchor on a text: instant again (the user 2026-11-15: "it needs to be instant like before") - installed
- **Kept box**: a text's measured box is kept per clip in the layer's own pixels, so later clicks on the same text need no
  render and no hide / show step (one Undo step, as fast as before 0.10.91), also after the anchor, Position, Scale or
  Rotation changed. Measured again when the clip moves or is trimmed, or anything readable inside the graphic changes (its
  layers' transforms, the text's length). Premiere gives no script the words or the font: a same-length rewording keeps the old
  box until the panel reloads. The done line says when the box was measured.
- **Faster first click**: rendered at half size for 4K (long side 1920; an edge within 1 sequence pixel) and taken as soon as
  the PNG's end is written (`anchoralpha.ready`, `/frames/wait` with `png`) instead of the same size twice 0.15 s apart.
  Timed in NEW TEST: both renders and the comparison 0.2-0.3 s (0.10.91: about 2 s). Measuring frames are deleted also when
  nothing is found. 0.10.92 was a test build.
- Tests: node 361 (kept box: second click no render, one step; 4K measured at half size), pytest anchoralpha 6.

## 0.10.91 - Anchor: the letters' own box for a text made in Premiere (the user's screen recording 2026-11-15) - installed
- **The wish**: selecting the text (not the whole graphic) should put the anchor on the letters, so Keyframer's pop grows from
  where the text is anchored. 0.10.90 used the sequence frame as such a graphic's picture.
- **How**: Premiere gives no script the text's box (UXP Source Text null, ExtendScript one character), so on Clip / Selection the
  page renders the frame at the playhead as it is and once with the graphic hidden (its Opacity 0 for a moment, then put back
  exactly; a graphic layer's own Opacity when the clip's is animated, refused when all are). Two renders of one moment are
  identical, so the changed pixels are exactly the text, over footage too (`anchoralpha.drawn`, `/anchor/drawn`); their hull is
  taken through Motion (and Transform) back into the layer. About one second. Premiere lists two extra steps (hide, show) that
  cancel out; one Cmd/Ctrl+Z takes the anchor back, and the done line says so. Sequence mode is not measured.
- **Measured in NEW TEST** on the user's text (V1 390.29 s, Motion Scale pop): box 837 x 85 px found; anchor on its centre; the
  box middle then stays at 1141, 2118 at 390.45, 390.6 and 392 s (before: y 2079 to 2152, the pop grew from the frame centre);
  the frame at the playhead unchanged. The text is left anchored on its centre.
- Tests: node 359, pytest anchoralpha 5.

## 0.10.90 - Anchor: text made in Premiere and animated Scale / Rotation (the user's screenshot 2026-11-15) - installed
- **The problem**: on a text made with Premiere's Type tool the Anchor page said "Graphic: source media is unavailable". Such a
  graphic has no project item, so there was no source size to read; the user's subtitles worked because they are MOGRTs (a file).
  The same clip also had 45 Scale keys from Keyframer and a Rotation key, which the page refused as well.
- **Text and shapes made in Premiere** (`premiere-anchor.js`): a clip with no project item whose effects include Graphic Group /
  Text / Shape counts as the size of the sequence frame (its Motion Anchor 0.5, 0.5 shows as 1080, 1920 in a 2160 x 3840
  sequence). Premiere does not tell a script where the text sits inside that layer (Source Text reads back null in UXP and as
  binary in ExtendScript), so Use alpha is refused on a graphic with a plain message, and Clip means the frame.
- **Animated Scale / Rotation** is allowed now: Position moves by one fixed amount read with Scale and Rotation at the playhead,
  so the picture stays where it is at the playhead and the animation grows and turns around the new point. The playhead must be
  on the clip and Scale must not be 0 there (0.10.89 fell back to the clip's start, a pop's Scale 0, and moved nothing: caught
  in NEW TEST, fixed). Animated Anchor Point is still refused. The done line says when this applied.
- **Measured in NEW TEST** on the user's clip (V1 401.87 s), frames 2160 x 3840 from Premiere: at the playhead the text's box,
  centre and ink are identical before, with the anchor top-left, bottom-right and back at the centre; during the pop the text
  grows from the chosen point (centre at 402.02 s: 1078, 2080 / 862, 1696 / 1294, 2464) and returns exactly when put back.
- Tests: node 358 (animated Scale gives the static result, playhead off the clip and Scale 0 refused, animated Anchor refused, a
  graphic is the frame and refuses Use alpha). 0.10.89 was a test build.

## 0.10.88 - Keyframer: motion blur (on/off, amount) and a live preview (the user's reminders 8 and 9, 2026-11-15) - installed
- 0.10.78-0.10.87 were this change's test builds on the development Mac (Premiere loads a panel again only when its version
  changes); nothing else changed in between.
- **Motion blur** (Keyframer, right of the curve): a switch, an Amount slider and a number (0-100 %; 50 = a film camera's 180°
  shutter, 100 = the whole frame, kept at 346° so the window ends before the next frame). Off by default; the last choice is
  remembered (panel store `asistent.keyframer.blur`, read again when the store loads late). Apply (and Update live) writes it.
- How (measured in NEW TEST, see DECISIONS): Premiere's Motion has no blur; its Transform effect has (shutter angle, the
  composition's shutter off) and honours keys between frames. Asistent adds its own Transform at the end of the clip's
  effects that is at rest on every frame and, inside each frame's shutter window, moves the picture as Motion will move it:
  Rel(u) = Motion(t)^-1 · Motion(u) (`blurplan.js`). The smear is Premiere's own, so it follows each frame's speed; Position,
  Scale and Rotation all blur (a Directional Blur could only blur straight moves). Your Motion keys are never touched.
- Accuracy on rendered frames (a 300 px square, 86.4 px per frame): smear 21 / 43 / 82 px at 25 / 50 / 100 % (expected 21.6 /
  43.2 / 82.9); frames before and after a move sharp; an Elastic scale pop matches the real motion within 1 px on every frame
  (overshoot inside a frame included); a 1000x600 picture turned 30° smears exactly along its path (49.8°).
- The window's motion is drawn as straight pieces between keys: two per window, more (up to 8) where the motion curves inside
  it, each window's ends pinned (Premiere draws Position's path between keys as its own curve). Premiere renders every frame of
  a Transform as a plain start-to-end blend once any Scale key passes about 4x (400 % right, 460 % broke the other frames):
  such a frame (the first frame of a pop from nothing) is left sharp and the status line says so.
- One press stays one Undo step; only the first blur on a clip takes two (Premiere adds the effect in a step of its own).
  Off (switch or Amount 0) takes Asistent's Transform off again; Undo last takes it with the keys. It is recognised by the
  times of its Position keys (the clip's record), so a Transform of the editor's is never touched, and it is left out of the
  property list.
- **Live preview** (right of the curve, under it in a narrow panel): plays the motion with `keyframeplan.shapedFn` (new: the
  shaped animation between frames, equal to every baked key, tested for every curve kind with and without Ping-pong / Loop)
  and the same shutter window, at the sequence's frame rate, one drawing per frame; the read clip's first ticked property
  (Position as its path, Scale, Rotation, anything else), or a sample move. Play / Replay; it replays on every change.
- The curve editor's empty sides are cut (viewBox, 12 px each side instead of 60) to make room; the curve's coordinates and
  dragging are unchanged.
- Test bridge: `uxp_eval` (a UXP script in the test projects, like `host eval`), `fill kfBlurAmount`, `keyframer_info` shows
  the blur and the preview.
- Tests: `tests/blurplan.test.js` (12); node 354 pass.

## 0.10.77 - Tracker: the object's colours; Track / Stop take the first press (the user's ball recording 2026-11-15) - installed
- The user's screen recording (a basketball, 1080x1920, 0.10.76): after 4 sure and 4 unsure frames the track went red, and
  Track and Stop needed several clicks. Measured on the clip: the grey template took the dark shorts for the orange ball
  (16 frames called sure there in a re-run), and the box shrank to 0.72 of the ball in ten blurred frames.
- Colour model in `tracker.RegionTracker` (colour footage only; the engine already decoded every frame in colour for the
  panel's pictures): the object's colours (inside the box's ellipse) against its surroundings (a ring and the whole picture),
  a never-seen colour counted as background, used only while it sets the object apart. Every candidate is weighed by how much
  of the object's colours and colour spot (a centre-surround of its size) it holds; a place with hardly any is no candidate and
  no rival; a jump or pick-up after a loss must land on such a spot; a sure frame must hold nearly all of them; the first frame
  after a loss is unsure; colours of the surroundings (fast) and the object (slow) learnt on sure frames. Where the template
  cannot follow, the spots of its colours in the searched area are matched as well; a colour spot alone near the motion keeps
  a weak frame as unsure.
- An unsure frame changes size and angle by at most 1 % and 1 degree (the drift above).
- Scored against hand-marked ball centres (57 frames of the first shot): 0.10.76 4 on the ball, 3 wrong, 50 lost; 0.10.77 13 on
  the ball, 2 clearly off and 2 at its edge (all orange), 40 lost; the remaining losses are the low fast bounces where the ball,
  the shadowed court and the player's skin share one colour. Rejected after measuring: a two-frame pick-up after a loss (more
  ball frames, but 7-11 wrong ones: court corners, the head), a roundness score (the court scored as round as the ball).
- Synthetic colour scenes (tests): a dribbled orange ball with motion blur crossing a dark area next to a grey disc as bright
  as it: grey alone 99-130 of 150 wrong (or 101 lost) over six scenes, with colour 0 wrong, 0 lost; into shade (half the
  brightness): 0 lost. Grey benchmarks unchanged (bench_tracker.py identical; bench_tracker_hard.py WRONG unchanged).
- Panel: a press that lands on a button but reaches another element (the Tracker's picture still holding the pointer after the
  box was drawn: Track's tooltip stayed up while it was clicked) now presses that button and is logged ("press for ... arrived
  at ..."); the picture, the timeline, the Keyframer graph and the Anchor board release the pointer by hand on release; the
  picture ignores a press outside itself.
- Slower when lost: about 55 ms a frame on the 1080x1920 clip (35 before), mostly the colour spots searched while lost.

## 0.10.76 - Tracker: small, blurry, low-detail and fast objects (the user 2026-11-14) - installed, engine tried on the 4K test clip
- The user's spec: track small, blurry, low-detail and fast objects accurately; no minimum box; sub-pixel; the file's own
  resolution; less jitter, drift and jumps; no jumping to look-alikes; detect failures; recover after unclear or covered
  frames; confidence that marks unreliable stretches; predicted places never confirmed; judged on frame-by-frame positions.
- Engine step reworked inside `tracker.RegionTracker` (panel, data and keys unchanged): search of the whole reachable area
  weighed by the motion prediction, second-best place kept (ambiguous = never sure), far or look-alike places only when sure
  and alone, sure threshold raised above the background's own match and judged against the noise, weak evidence in a row
  ends as lost, small boxes magnified (2x) and tracked on the file's own pixels (`work_for_box`), scale / angle only when the
  object shows them, tight boxes around plain things use the whole box, shading taken out for smooth things, motion-smeared
  and focus-blurred matching (unsure on that alone), adapting template only from sharp sure frames like its last look, flow
  points seeded only on sure frames, lost search from the last place seen growing by the object's speed with kept looks,
  lost frames report the last measured place. Box minimum 2 px (was 8). Details and numbers: `docs/TRACKER.md`.
- New `scripts/bench_tracker_hard.py` (13 scenes). WRONG frames (sure/unsure in the wrong place) 184 -> 6 over all scenes,
  all 6 in the scene where nothing tells the object apart (was 144 there, up to 1135 px off); the older benchmark unchanged.
  4K 24 px object: median 0.045 px (0.115), faster (38 vs 51 ms a frame).
- Panel: the small-box hint now says to zoom in (Alt + click) and draw it tight.
- Tests: 10 new in `tests/test_tracker.py`; one changed (a 3 px box is now taken). pytest 825 passed, node 342 passed.

## 0.10.75 - Tracker: the layout follows the clip's shape (the user 2026-11-14) - installed, tried in Premiere 2026 through the bridge
- The user's spec: detect the source's aspect ratio (the file, not the sequence), a portrait layout for 9:16 with a much larger
  preview, a wide layout for 16:9, other shapes without stretching or cropping, controls and timeline placed by the shape,
  compact, recalculated when switching clips, box / zoom / mouse exact, tracking and keyframes unchanged.
- `trackplan.layoutFor` sizes two layouts and keeps the larger picture: stacked (as before; a vertical clip may now take 62 % of
  the height instead of 52 %) and side by side (the viewer card exactly as wide as the picture on the left, as tall as the page
  allows; the timeline, Track and Apply in a column on the right). Side by side only for shapes narrower than 1.2:1 and when it
  gives 25 % more picture; 16:9, 4:3 and wider always stack (the timeline keeps the full width). The same nodes are moved
  between the layouts; chosen on Load frame (the engine's file size: `display_size`, rotation included) and again when the panel
  is resized. The clip line names the shape ("2160 × 3840 · 9:16"; `trackplan.aspectName`). Box, path, zoom and Move/Alt use the
  one viewport as before. Nothing in the tracking, the engine or the keyframes changed.
- Tried in NEW TEST (Premiere 26.5.3, panel 737 x 455 px of room, bridge): fx31031 and C0728 (9:16) side by side, viewer
  195 x 347 (was 140 x 248), timeline 514 px; aula_lesson_outro.mp4 (16:9) stacked 421 x 237, timeline 703 px; back to 9:16 side by
  side. Playhead moved for Load frame and put back. Preview (Chrome) at 760 x 540, 1000 x 760 and 300 x 760 for 9:16, 16:9 and
  1:1 (scenarios `tracker-wide`, `tracker-square`). 342 node tests pass (7 new).

## 0.10.74 - Tracker zoom: Move, Alt + drag, Alt + click, a one-line guide (the user 2026-11-14) - installed
- The user: "I can zoom but I can't move around the frame", then "with ALT + dragging it works, we need a little guide, minimal",
  "the move button is nice, we can keep it", "zoom in/out while holding alt + scroll". Zoomed in: a Move button (arrows icon,
  gold when on: dragging moves the picture instead of drawing a box; off again at Fit and after Load frame), Alt + drag and the
  middle button move it too, Alt + click zooms in where clicked (Alt + Shift + click out; also on a fresh frame at Fit, where
  there is nothing to move), and one muted line under the viewer: "Alt + click: zoom · Alt + drag: move".
- Measured in Premiere 26.5.3 (logging build, the user's try): Alt and the drag reach the panel and move the view when zoomed;
  NO scroll reaches the panel at all (no `wheel` or `mousewheel` on the viewer, the page or the document), so Alt + scroll,
  Cmd/Ctrl + scroll and pinch zoom were taken out again. The user: the buttons and Move work.
- Preview (Chrome, real mouse): Alt + click Fit -> 1.5× at the click, Alt + drag moves, Alt + Shift + click back to Fit.
  336 node tests pass.

## 0.10.73 - Tracker: zoom in and out of the viewer (the user 2026-11-14) - installed, buttons tried through the bridge
- The user: "We need an option to be able to zoom in/out of the preview in the tracker as well." − / Fit / + in the viewer's
  corner (up to 8×; + from Fit zooms in on the box or the tracked point), Cmd/Ctrl + scroll or a pinch at the mouse, scroll or
  Alt-drag to move around zoomed in, the view follows the tracked point while stepping or playing. Boxes drawn zoomed in land
  on the same object (frame and overlay share one size and shift). Load frame now asks for 1280 px (was 640) so it stays sharp.
  Maths in `trackplan.js` (`viewport`, `zoomAt`, `zoomStep`, `panBy`, `follow`, 6 node tests); preview scenario `tracker-zoom`.
  Details: `docs/TRACKER.md`.
- Tried in NEW TEST (bridge): a 1280 px frame of fx31031 loaded (720 x 1280), box set, + twice -> 2× centred on the box,
  − -> 1.5×, Fit -> 1. The viewer there is 140 x 248 px. Not checkable through the bridge: that Premiere clips the zoomed picture
  to the viewer, scroll / pinch / Alt-drag (the user's look). 336 node tests pass.

## 0.10.72 - Keyframer: Update live after Apply (the user 2026-11-14) - installed, tried in Premiere 2026 through the bridge
- The user: "Can we have keyframer auto update when we change these settings? Right now when I update the values I have to
  click apply again". After Apply on a clip, every change of the curve or its settings (kind, presets, a dragged handle or point,
  Elastic / Bounce / Overshoot+ / Bounce Back steppers, Repeat) is applied to that clip again by itself, 500 ms after the last
  change (a drag: when it ends; several presses in a row: one update). Each update is one Undo step and replaces Asistent's
  earlier curve as Apply always did. Checkbox "Update live after Apply" under Apply, on by default, kept per computer
  (store `asistent.keyframer.live`).
- Only the clip last applied: when another clip is selected the update is skipped and the page says "Live update paused:
  <clip> on V<n> is not selected"; back on that clip, the next change applies again. Undo last stops it until the next Apply.
  The clip is recognised by media, In point, track and start: Premiere's graphics all share media and In (two "Graphic"
  clips in NEW TEST, both In 3600 s), which the first build mixed up (the update went to the other Graphic, wrote nothing).
- Test bridge `keyframer_info` (status lines and the live state).
- Tried in NEW TEST (Premiere 26.5.3, bridge): Apply (Ease in-out, 8 keys) then Elastic -> "Updated live" in ~0.5 s after the
  press; Overshoot+ -> 86 keys; another Graphic selected + a change -> paused, nothing written; back -> updated; Undo last ->
  keys taken out, live off. The user's own look in the panel still to come. 330 node tests pass.

## 0.10.71 - Brand tab: the client's brand kit inside Premiere (the user 2026-11-14) - installed, NOT yet run in Premiere
- The user's spec: per-client brand kits on the office server, the client found from the project, one-click import and
  timeline placement of logos and video assets, HEX copy and colour on supported graphics, subtitle and text styles,
  intros and outros, frequent assets without browsing, create / edit / duplicate / delete kits, drag and drop, custom server
  paths, refresh when files change, a local cache, graceful when files, formats or the server are missing, Mac and Windows.
  Full description, Premiere limits per action and the open Premiere checks: `docs/BRAND_KIT.md`.
- Engine `brandkit.py` + `/brand/*` endpoints: kits from library folders (Content Studio's `brand-kits/`, an office server
  folder; `/Volumes/Production/Brand Kits` read when it exists), client folders anywhere, and a `Brand Kit` folder above the
  project; the client from the project's name or folders (across Cyrillic and Latin, aliases); files sorted by folder words
  and type, one row per logo in several formats; colours, fonts, subtitle style and notes from `brand.json` (read only),
  the editor's changes in `asistent-kit.json`; signature for refresh, offline index, local copies of server files from the
  second use (Premiere still gets the server's file while it is reachable), thumbnails (FFmpeg; SVG as is), font install for
  the user, clipboard through the engine, Show / Open, manage (Delete moves the kit into `_Deleted kits`), adding files as a
  copy job.
- Host: `brand_mogrt` (ExtendScript `importMGT`, the call proven for the subtitle graphics) and `brand_color` (the selected
  MOGRTs' colour control). Host version 0.10.71.
- Panel: a **Brand** tab (`brand.js`, `premiere-brand.js`, pure `brandplan.js`): client picker (Auto = detected, a choice is
  remembered per project), search, Quick (starred, then most used), Colours (click = copy; Apply to selected: Tint on picture
  and video files, the MOGRT's colour control; native text cannot be coloured by script: said, HEX copied), Logos, Graphics,
  Video (Add at the playhead above everything there, At end for outros, Import), Fonts (Install, Copy), Presets (MOGRT Add,
  the client's subtitle style Use, effect presets / LUTs shown with the manual step), References (Open), Notes, Manage, drop
  files on the page. Every placement is checked afterwards. Bridge: `brand_info`, `brand_choose`, `brand_act`, `brand_color`.
- Open: `brandplan.COLOR_RANGE` (what `ppro.Color` takes, 0-1 or 0-255) is not measured; the Tint colour is checked on the
  first Premiere run (docs/BRAND_KIT.md step 1). Installed on the Mac on the user's word (the first attempt was stopped by Claude Code's permission check).
- Installer: after this install Premiere 2026 kept loading 0.10.70 even after a restart (its own plugin list still had the old
  copy first, while Adobe's installer listed only 0.10.71). `install.install_panel` now also checks Premiere's list
  (`_premiere_versions`) and removes + installs again when it holds another version; fixed by hand on this Mac. 2 pytest.
- Preview: scenarios `brand`, `brand-manage`, `brand-offline`; `shoot.js --only a,b`.
- Tests: `test_brandkit.py` (15), `brandplan.test.js` (12); 792 pytest + 24 skipped, 330 node.

## 0.10.70 - Auto import: only real downloads (a folder 3 deep at most, never a repository)
- **Bug found 2026-11-12**: Auto import had Downloads bound to NEW TEST (switched on at 00:30), and Asistent's repository sits
  inside Downloads (Downloads/LOVDJIQ/04. AUDIO/MUSIC/Content Studio/tools/asistent). The 928 preview screenshots written
  tonight were imported into NEW TEST (filed under MUSIC, from the path). Only NEW TEST got them; bound to a client project,
  the vault's renders and frames would have gone into it.
- Fix (`importer.wanted`): a file counts only up to 3 folders below the watched folder (an unzipped shoot,
  Footage/Day 1/Cam A/clip.mp4, still does) and never inside a git repository or a node_modules / venv / .cache folder; the
  catch-up after a restart no longer walks into those folders either (faster on a big Downloads).
- NEW TEST keeps the imported screenshots (Asistent deletes nothing from a project): delete the bin by hand.
- Tests: 2 pytest; 775 pytest + 24 skipped.

## 0.10.69 - Anchor: Anchor Studio in the Motion tab, Use alpha read by the engine (the user 2026-11-12)
- The user: "we also need added anchor from our github we have it built, integrate it into our asistent ... if you find bugs or
  performance fixes apply them, if you can make it better also do it". Anchor Studio 0.3.1 (github kaloyankera-rgb/anchor-studio,
  private) is the third page of Motion: Keyframer | Tracker | **Anchor**. Nine points (or press between them and drag): the
  selected clips' anchor point goes there, Position compensated so the picture stays; Effect Motion / Transform; Box Clip /
  Sequence / Selection; X / Y percentages; Save / Use saved; one Undo step.
- Kept as it was (its 33 tests ported and passing): the geometry (`panel/anchorplan.js` = core.js) and the Premiere side
  (`panel/premiere-anchor.js` = premiere.js: every clip read and checked before any write, one transaction inside
  lockedAccess, values read back; rotated / non-uniform Motion, Transform under Motion, Linear / Hold Position keys moved).
- Better: **Use alpha needs no file dialog** and has no size limit: the engine reads the visible pixels with OpenCV
  (`engine/asistent/anchoralpha.py`, `POST /anchor/alpha`), where Anchor Studio asked the editor to pick the same PNG once
  and decoded up to 24 MP in JavaScript (with fflate). PNG, TIFF and WebP; 8 / 16 bit; grey + alpha; a palette with
  transparency; Premiere's Invert Alpha; the same cutoff rule (its test image gives its documented (72, 40)-(184, 152) at
  50 %, (200, 168) at 1 %). The page is in Asistent's look (div buttons; no absolutely placed marker: CLAUDE.md, 0.10.59);
  the choices and the saved anchor live in the panel's store (UXP's localStorage is erased by every update, 0.10.17).
- Its file-access code (alpha-source.js) compared paths after turning "/" into "\" and lowering the case, which on a Mac with
  a case-sensitive volume could accept another file: gone with the dialog. Its PNG decoder and fflate are not brought over.
- NOT tried in Premiere (a client project was open). Anchor Studio's own one-click Motion placement was confirmed by the user
  in Premiere at its 0.1.2; its Transform path is still untested in Premiere (as its README says).
- Tests: 33 node (Anchor Studio's), 4 pytest (`tests/test_anchoralpha.py`, its test image in tests/fixtures); 773 pytest + 24
  skipped, node 318.

## 0.10.68 - Keyframer: Custom curves you shape with points (the user 2026-11-12)
- The user: "for the keyframer we need to be able to move and make custom motion curves not only see them as a preview from the
  presets we have". Until now only the plain Curve's two Bézier handles could be dragged; Elastic, Bounce and the others were
  a picture.
- **Custom**: a curve through points you place: click the graph to add one, drag it anywhere (time only runs left to right,
  progress may overshoot from -50 % to 150 %), double-click to remove it, Alt-click for a sharp corner (a hit, as in a bounce);
  Straight starts again, Smooth all removes the corners. Up to 16 points; smooth between them (cubic Hermite, Catmull-Rom
  slopes), one-sided at a corner. Baked like every curve: one keyframe per frame between your keyframes, Repeat works.
- **Edit as points** under Curve, Elastic and Bounce turns the curve shown into a few points to drag (3-4 for an ease, 8-14
  for an elastic or a bounce with its hits as sharp corners; within 2-4 % of the preset), so any preset is a starting point.
  Overshoot+ and Bounce Back move after the last keyframe and keep their settings.
- Save this curve keeps Custom curves too (My curve N, every project). The editor's drawing area is bigger (120 px).
- Tried in the browser preview with real mouse events: add, drag (lands on the spot), Alt-click corner, double-click remove,
  a point dragged past the end stays inside. NOT tried in Premiere (a client project was open): UXP's pointer events were
  probed in 0.10.31; a double-click is also detected by hand (two presses within 0.35 s) in case UXP sends none.
- Tests: 4 node (keyframeplan: through the points, corners, refusals, Edit as points accuracy, baking and repeat).

## 0.10.67 - Auto import: drop a folder on the row to watch it (the user 2026-11-12)
- The user: "another way of syncing folders ... just dragging the folder and dropping it on top of the area of upload for the
  sync auto import". The Auto import row is a drop target: it lights up (dashed golden edge, tinted) while something is held
  over it; a folder dropped there is watched for this project and Auto import switches on (as Other folder… does). A file
  dropped there: "That is a file (…): drop the folder it is in." (engine `importer.bind`).
- `panel/dropfolder.js` (pure) reads the path from whatever the drop carries: the files list (nativePath / path), the file://
  links of text/uri-list (escaped spaces, Windows drives), or plain text that is a path. What Premiere's UXP gives a panel
  for a drag from Finder is not documented: every drop is logged ("import drop: types …, files …, uri …"), and when no path
  comes the panel says to use Other folder… instead.
- NOT tried in Premiere (a client project was open; a drag from Finder also needs a person): the first drop will show in
  engine.log whether Premiere hands the path over.
- Tests: 3 node (`tests/dropfolder.test.js`), 1 pytest.

## 0.10.66 - Captions: Export transcript (the user 2026-11-12: "export the captions as transcriptions")
- Captions tab: **Export transcript** (and **With times**): the last subtitles as a .txt next to the .srt
  ("<name> transcript.txt" / "... transcript (times).txt"), shown in Finder. Built from the run's own words (corrected,
  aligned, with their case and punctuation), not from the caption lines a client style shows in capitals without
  punctuation; paragraphs break where the speaker stops (a sentence end then 0.8 s, or any 2 s pause); times are the
  sequence's ([1:05]); an English line, when made, follows as its own section. Lines typed but not applied are not in it
  (the panel says so: Apply and rebuild first).
- Engine: `transcript.py`, `POST /subtitles/transcript {json, times}` (only files in an Asistent_subtitles folder).
- Tried on a real NEW TEST run (6 paragraphs, times right). NOT installed tonight: a client project was open in Premiere 2026.
- Tests: 3 pytest (`tests/test_transcript.py`), 1 node.

## 0.10.65 - Rough cut becomes Silences: cut silences only, from every microphone's own level (the user 2026-11-12)
- The user: "change the rough cut to remove silences and focus on only removing silences and dead spaces in selected videos
  ... below a certain threshold you cut ... keep in mind the multiple POVs ... accurate and also fast and optimized".
- **New `engine/asistent/silence.py`, no speech recognition** (the old cut waited minutes for Whisper):
  1. every selected sound clip on its own, its level in dB per 10 ms (the louder channel, or the one an L/L / R/R copy plays);
  2. Auto: the clip's own noise floor and voice level set its threshold (speech from 9.5 dB over the floor or 12.8 dB under
     the voice), with 6 dB hysteresis so a word's tail is not chopped; a fixed dB (Level: -30 ... -60 dB) is the level alone;
  3. Silero (already installed) in Auto: drops a short burst it does not hear at all (under 0.15 s: a click, a knock), keeps
     quiet speech it is sure of (also under music or hum: over -60 dB), and lets a word's fading tail / soft start go on
     while it still hears speech (up to 0.5 s). It never removes a loud stretch of word length: measured, it misses short
     loud words („Има“ at -20 dB, Silero 0.03-0.6);
  4. multi-POV: a moment is kept when ANY selected microphone hears speech (two lavaliers are two people; a camera and a
     lavalier are one person twice), and the same cuts go through every selected clip, so the cameras stay in sync;
  5. Pauses: Calm (cut over 0.8 s; 0.20 s kept before speech, 0.30 s after), Normal (0.5 s; 0.15 / 0.22), Tight (0.3 s;
     0.15 / 0.20); time with no selected sound is cut whole; margins never reach over a clip's edge.
- **Measured** (NEW TEST and the ReShape golden recording, 274 s, 573 words with ALIGNED times as the reference): words cut
  into: Normal 0, Calm 0, Tight 4 (soft starts on very quiet camera microphones; said in its tooltip). Against Whisper's own
  word times the remaining hits were Whisper's errors (checked one by one on the levels: words placed 0.3-0.6 s early,
  „Абонирайте“ on silence). Sound over its own microphone's threshold inside the cuts: only clicks of 0.1 s or less.
  Speed: 388 s of a two-camera + lavalier sequence (24 sound clips) in 2.3 s (the whole job, XML included).
- Panel: the row is **Silences** with **Cut silences**; options Pauses and Level (remembered); the new sequence is
  "NO SILENCE – <sequence> vN" in the bin "No silence", built from clones of the editor's own clips as before (rotation,
  Motion, colour, effects, Fix audio's L / R copies kept). Mode, Review markers and Fast are gone from the panel (the engine
  keeps Safe / Smart for a later review step).
- NOT run in Premiere yet: a client project (GStroy КП-11) was open in Premiere 2026 when it was ready, so Premiere was left
  alone. The engine job ran end to end on the real NEW TEST media (above).
- Tests: 9 new pytest (`tests/test_silence.py`), 1 new node; 765 pytest + 24 skipped, node 277.

## 0.10.64 - Tracker: a range to track, Stop that keeps what is tracked, go on from any tracked frame (the user 2026-11-12)
- The user: "we need to be able to start and stop the tracking whenever we want to, cause right now it tracks the whole clip and
  you can't stop it. We need to be able to choose until when we want to track."
- **Range**: as soon as a frame is loaded the timeline shows the whole clip with a golden handle at each end; drag them to
  track only that part (outside it is darker; Premiere's playhead follows the handle so the Program Monitor shows the frame;
  "Track 1.67-4.04 s · 71 frames" under it). Track works inside the range, forwards then backwards from the boxed frame.
- **Stop** (was Cancel, which threw the work away): ends the tracking at once and keeps every frame tracked so far.
- **Go on**: Track from here / Track back from here now also work on a tracked frame without a new box (the tracker goes on
  with the box it had there, scale and angle continuing), up to the range's end / start; with a new box drawn they fix a
  stretch as before. At the edge of what is tracked, Track from here is the highlighted next step.
- Engine: `tracker.track(..., rng, stopping)`; every frame of the clip comes back, a frame not tracked as state "none" (no key
  is written for it, it is not counted as lost, the problem arrows skip it); `POST /jobs/<id>/stop` (finish now, keep the
  result; cancel still drops it); a clip up to 36 000 frames, tracked up to 9 000 at a time.
- Checked in Premiere 26.5.2 (NEW TEST, "Tracker test", through the bridge): range 50-120 -> 71 frames tracked, 109 not; the end
  handle moved to 179 and Track from here at 120 -> 60 more, all sure; Stop after 0.8 s -> 9 frames kept, 171 not tracked.
  Found on the way: the highlighted-button rule used an undefined name (fixed before commit; the browser preview has a new
  "tracker-range" scenario that runs that path). A reinstall of the same version number does not replace Adobe's copy:
  0.10.63 was never committed.
- Tests: 3 new pytest (range, Stop, a stopped job finishes with its result), 2 new node; 756 pytest + 24 skipped, node 276.

## 0.10.62 - The after-export check names the sides that really show a black bar; tried in Premiere
- **Tried in Premiere 26.5.2 (NEW TEST, through the bridge, 2026-11-12)**: the 6 s sequence "Tracker test" (a synthetic clip,
  no client footage) exported with Premiere's own "Match Source - Low bitrate" H.264 preset into a scratch folder the watcher
  had learned. The watcher found the file by itself and the check ran in 1.9 s: complete 0:06.0, 2160x3840 29.97 fps H264,
  no black frames, no frozen picture, silent sound (the sequence has none), and black edges where the tracked clip moves
  (measured on the file's own pixels: top at 0-0.6 s, right 0.6-1.5 s and from 2.7 s, bottom from 3.6 s). Premiere's export
  event did NOT reach the panel for a scripted export (`exportSequence`, IMMEDIATELY), so the comparison with the sequence
  (shape, frame rate, length) still needs a real Export from the Export tab.
- **Fixed**: bars were named by pairs only ("top and bottom", "left and right", "on all sides"); that clip's right and bottom
  bars read "on all sides". Now the sides that show one: "Black bar on the right", "Black bars at the bottom and on the right"
  (a moved Anchor Point, a tracked or keyed Position); centred bars read as before.
- Checked: 753 pytest (2 new in `tests/test_filecheck.py`: the naming, a shifted picture with bars at the top and on the right)
  + 274 node.

## Tests 2026-11-12 (no version change) - the "Python quit unexpectedly" crashes were the test runs
- Every Python crash report of 2026-11-11/12 (5) came from a test run started in the terminal, never from the engine: the
  translator's sentencepiece (SWIG) warns on Python 3.12 while setting itself up, the test command's `-W error` turned that
  into an error inside its C code, and Python crashed while loading the model or at exit. `tests/conftest.py` imports it once
  with only that warning ignored (`python -W error -c "import sentencepiece"`: 139 before, 0 with the filter). The real-model
  translator tests run again: 751 passed, 24 skipped, no crash report.

## 0.10.61 - Subtitles are cut where the speaker ends a phrase (the user 2026-11-12: "the last word of a connected phrase appears in the next subtitle")
- **The cause, measured** on the editors' own chunks of 40 client videos (GStroy, Credissimo, ЕКОПАК, Beauty Sector, AULA; their
  speech through Whisper, chunks read from the exports in 2026-11-10): 133 times a word said straight on from the phrase before
  it stood alone in the next caption with a phrase end after it („СЪС СЪВМЕСТИМ / АДАПТЕР“, „И ЗАХРАНВА / ОСВЕТЛЕНИЕТО“). The
  cutting already scored pauses and grammar, but a phrase wider than the style's usual size (17-20 characters) was not allowed
  at all, and a fourth word only with little words in it, so the last word had nowhere to go but the next caption.
- **New in `subtitles.py`, for Auto (short) and the five client styles (`"delivery"`)**: each word boundary gets a strength from
  how it was said: a sentence end 1, a comma Whisper heard 0.8, a pause by its length (0.35 s = 1). A cut costs what that
  strength leaves; a phrase end heard inside a caption costs the same way. A caption of one word that belongs to the phrase
  before it (said on, then a phrase end) costs as much as the strongest grammar rule; a lone first word less (editors do start
  a phrase with one). The style's size and the 2-3 words are targets: a two-line client chunk may go up to 7 characters over
  its usual size (their editors' chunks: 21-23 characters at the 97th percentile, 25 at most), never a line over 16; a fourth
  word is allowed at a price. Grammar: a chain of short words after a verb ends a caption with it („Готова ли си“,
  „признавате ли си“); a verb keeps its „да“ (`verb_chain`, the user's rule); a number keeps what it counts („220 волта“,
  „3 месеца“). Each style's line layout inside a chunk is unchanged (GStroy's editors do write „ОЩЕ В / ПРОФИЛИТЕ“).
- **Measured on the same 40 videos**: leftover words 133 -> 8 (the 8 are phrases wider than two lines of 16: „МОЖЕ ДА
  ИЗГЛЕЖДАТ / ЕДНАКВО“), cuts where the editors cut F1 0.740 -> 0.761 (GStroy 0.767 -> 0.802, ЕКОПАК 0.735 -> 0.778, Beauty
  Sector 0.772 -> 0.790, AULA 0.720 -> 0.754; Credissimo 0.727 -> 0.718, its editors join across commas more often), captions
  2787 -> 2542 (the editors 2490), 2.28 -> 2.50 words a chunk. No word or time changes: only where the captions are cut.
- **Tried and left out**: a drawn-out last word of a phrase (time per letter against the speaker's pace) as a phrase end, and
  the pause read against the speaker's typical gap: on these word times the first moved the cuts away from the editors'
  (F1 0.754 -> 0.748, leftovers 3 -> 6) and the second changed nothing. Pitch and loudness need the sound (TODO).
- **ReShape unchanged** (protected): it has no `"delivery"`, so its classic path runs as before; `tests/test_reshape_baseline.py`
  byte-identical and `scripts/reshape_golden.py check` on the client's recording: identical (SRT, English, job JSON). The
  16:9 Standard style is unchanged too (it still fills two lines of 42; TODO).
- Checked: 751 pytest (11 new in `tests/test_delivery.py`; the key ones fail on the old rules with the user's exact defect) +
  274 node. In Premiere 2026 (NEW TEST, through the bridge): Make subtitles on C0737 L / R with AULA placed its caption track;
  on those aligned words GStroy, Credissimo and ReShape cut as before, Auto and AULA no longer split „ако / е“ and start
  „ТЯ ДА НЕ Е АНТИКА“ with its subject. Not yet seen by the user.

## 0.10.60 - The glow is the panel's background (0.10.59 showed only the glow in Premiere)
- **Bug (the user's screenshot, 2026-11-12)**: in 0.10.59 the Asistent panel in Premiere 2026 showed nothing but the purple
  glow. The glow was an absolutely placed `<img>` meant to sit under `#shell`; Premiere's UXP painted it **over** the whole
  panel (in Chrome, the browser preview, it sat underneath). The test bridge reads the DOM, not what is painted, so every
  bridge check had passed.
- **Fix**: no element for the glow any more: it is the body's `background-image: url("img/glow.jpg")` (`background-size:
  100% 100%`). Confirmed by the user in Premiere 2026 after a restart: the panel with the glow behind it.
- Note: a new panel version loads only after Premiere restarts; closing and reopening the panel kept 0.10.59.

## 0.10.59 - A minimal panel: Tools as rows, Motion, the user's colours and a glow (the user 2026-11-11/12: "keep it minimal, right now everything is everywhere"; chosen from three clickable mockups: A · Rows, Amethyst + Golden, the glow Soft)
- **Tools as rows**: two bordered lists. **Run**: one row per tool (Sync, Rough cut, Track names, Audio, Color, Subtitles,
  Before export) with its icon, its name (the tooltip says what it does: the old ⓘ text) and its main button, all one
  width; **▾** opens the row's options under it (the about text first), one row at a time, remembered. **Automatic**: Auto
  import, Show exports, Export check (the after-export check) and Learn from exports, each with a switch and a status line
  ("Watching Downloads", "In Finder · Premiere's folder", "Checks every export"); ▾ holds the folders, the newest
  export's check and the **Recent exports** list (moved from Log). Nothing was removed; every id and handler is the same.
  At 240 px the run rows show the button alone.
- **Renamed buttons** (to fit one width): Name the tracks → **Name tracks**, Subtitles (Bulgarian) → **Make subtitles**,
  Check before export → **Check export**. "Manual ▸" is gone: its six buttons are in the Audio row's ▾.
- **Tabs**: Tools · **Motion** (Keyframer and Tracker with a switch between them; the last one used comes back) and, at the
  right, a **clock** (Log: the last report and the earlier runs, any time) and a **gear** (Settings: the developer tools).
  Before / after and Captions still appear after a run. The bridge's `click "Keyframer"` / `"Tracker"` press the switch.
- **Header**: one line: the dot, the project, the version (red "No engine" when the engine is down).
- **Keyframer**: its sections in cards (Clip, Motion, Repeat and Apply, Stash); stash rows fill the width.
- **Colours**: Amethyst #8745A5 for actions and switches (a gradient where UXP draws one), Golden Yellow #FFC945 (`--sel`)
  for what is active or chosen (tab underline, open row, chosen chips, Motion and Attach / Lock switches, the Tracker's
  step bar and boxed-frame mark); the Tracker's "unsure" frames are orange (#f0883e) so they don't read as a selection.
- **Glow**: `panel/img/glow.jpg` (14 KB, made once with OpenCV: soft amethyst, deep purple and a faint golden light) behind
  the panel; cards, lists and the result bar are translucent (`--glass`). UXP has no proven blur, so the blur is in the
  image. Packed by `package_ccx.sh` (`img`).
- Dev: `dev_cmd.py click "#id"` presses an element by id (the switches have no label); preview states row-open,
  settings, log-page.
- Checked: panel tests 274, engine version/package/wiring tests; browser preview 87 shots at 240 / 300 / 420 px. Premiere
  26.5.2 (NEW TEST, bridge): loads as 0.10.59; the button list against 0.10.58 differs only by the renames, the switches
  and the tabs; Motion / Keyframer / Tracker / Tools open; Keyframer read "Tracker test"; Tracker loaded its frame; Check
  export ran ("1 to look at: picture fills the frame"); the Export check, Show exports and Learn switches each turned the
  engine's setting off and on again. All of that passed while the panel was in fact covered by the glow (fixed in 0.10.60:
  the bridge cannot see what is painted). Not checked: how it looks in UXP (the glow image, translucency, the gradient) and the
  Auto import switch (switching it on would import Downloads into NEW TEST).

## 0.10.58 - The whole panel takes the Tracker's look (the user 2026-11-11: "put the same UI on the overall tool while following the rules for UI design we have")
- **Palette**: the `:root` tokens are the Tracker's: grounds #141518 / #1c1d22, controls #26282f, lines #303239 / #3a3d45,
  text #e7e8ec / #9a9ca6 / #686b75, violet accent #705cf6 (hover #8270f8), links #a99dff; status colours re-tinted for the
  dark ground. Plain values: Premiere's `--uxp-host-*` variables are not defined in this UXP (css_probe), so nothing followed
  Premiere's theme before either. The Tracker's own `--tr-*` set is gone: it uses the shared tokens.
- **Buttons**: one system for every page: quiet controls (hover lightens the edge, press darkens), the main button of each
  card or page in solid violet (hover lighter), disabled at 40 %. Radius 5 px. On the Tracker page only the next step's
  button is violet, as before.
- **Long explanations**: the Keyframer's two paragraphs and the Captions page's became one line each with the whole text in
  the tooltip (`.desc.brief`, help cursor), as on the Tracker page. The Tools cards keep theirs behind the ⓘ.
- **Keyframer graph**: its frame, curve, arms and handles take their colours from CSS classes (`kf-frame`, `kf-curve`,
  `kf-arm`, `kf-handle`); they were SVG attributes, which UXP ignores (CHANGELOG 0.9.71), so in Premiere the outlines may
  not have shown. The springs' hidden arms use `kf-arm off`.
- **Toast**: a softer edge (the status colour at 40 %) on the same solid face.
- Nothing else changed: labels, ids, layout, every handler. Browser preview: all 78 states at 240 / 300 / 420 px looked at.
  Premiere 26.5.2 (NEW TEST, bridge): the panel loads as 0.10.58, Tools / Log / Keyframer / Tracker open, Keyframer read the
  test clip (every preset live), Tracker loaded its frame (2160x3840 at 172x306); no panel errors. Not checked: how it looks
  to the eye in UXP (the user's look). Known and older: with five tabs (Captions or Before / after) the tab row runs out of
  room at 300 px.

## 0.10.57 - Tracker page restyled as a dark tracking workspace (the user 2026-11-11: "a premium, professional tracking tool"; nothing in the tracking changed)
- **Look**: the Tracker page has its own darker palette (`--tr-*` tokens in `style.css`: #141518 / #1c1d22, lines #303239, violet
  accent #705cf6); no other page changed. One button in the accent at a time, the next step's (Load frame, Track, Track from
  here when a fix box is drawn, Attach selected / Lock to it); the others are quiet. A running button gets an accent outline.
- **Layout**: a 4-part step bar (Load, Box, Track, Apply); the clip line (name, time, track, speed, frame size) with Load frame;
  one workspace card with the viewer, transport and timeline; then a Track card and an Apply card (Attach / Lock as a two-way
  switch, the mode's options, the action and Detach). The cards sit side by side from 600 px. The long paragraphs became one
  line each, the full text is in the tooltips.
- **Viewer**: the picture centred on black at its own aspect, up to about half the panel's height; an empty state before a
  frame is loaded and "Loading frame" while it loads; the box with a dark edge under it and corner handles; a crosshair with a
  gap at the point; chips for the frame's state (sure / unsure with %, lost, fixed) and the frame number; while tracking, a
  "Tracking n %" chip, the live frame and box, and a thin progress line. Redrawn when the panel is resized (window resize, or
  when the mouse comes back to the page); the box and the picture share one pixel size, so the overlay stays on the object.
- **Timeline**: a ruler with frame marks and seconds, each run in its state colour with the confidence as the colour's
  height, the boxed frame as a violet mark, a playhead with a head; during the first track the part done so far and where
  the tracker is; while a stretch is tracked again, that part highlighted. Under it: the frame's time, how many frames are
  sure / unsure / lost, and "Sync Premiere" (the old "Move Premiere's playhead along", same checkbox).
- SVG shapes take their colours from a `style` (UXP ignores the stroke attribute, CHANGELOG 0.9.71). No CSS beyond what
  `css_probe` proved (no gap, grid or transitions). Labels, ids and bridge hooks unchanged; `info()` also reports the frame
  chip and the viewer / timeline sizes. Browser preview: new states tracker-empty, tracker-box, tracker-busy.
- Verified in Premiere 26.5.2 (NEW TEST, "Tracker test", through the bridge): Load frame (2160x3840 shown at 172x306 in a
  691 px stage), box, Track (live chip 28 / 58 / 100 %, 180/180 sure, 180 thumbnails), goto 30 moved Premiere to 1.0015 s,
  Track from here (30 frames) and back from here (41), Cancel mid-track (track kept), Attach with Scale + Rotation (180 keys
  each, a second press replaces its own), Detach (540 keys), Lock with Smooth + Centre (180 keys), Detach (180). Not checked:
  a real panel resize in Premiere and how it looks to the eye in UXP (the user's look).

## 0.10.55-0.10.56 - Tracker page redesigned (the user 2026-11-11: "a preview of what's being tracked, a better timeline that we can go through easily after the thing is tracked, a better UI overall")
- **Live preview**: while tracking, the viewer shows the frame being tracked with the box moving on it, and a progress bar.
- **Viewer**: the frame with the tracked box (grown and turned with the object), the whole path coloured by how sure each
  frame is, a readout (frame, time, sure / unsure / lost and the score, "fixed").
- **Timeline**: drag to scrub, the coloured states, a confidence curve, second marks, the boxed frame (diamond) and a
  playhead; **transport** first / back / play / on / last and jump to the previous / next unsure or lost stretch; "Move
  Premiere's playhead along" (on by default).
- **Fixing a stretch**: draw a new box on a bad frame, then **Track from here** (to the end) or **Track back from here** (to
  the start): only that part is replaced; scale and angle continue from the nearest sure frame (0.10.56: not from the new
  box's size, so a tighter box does not make an attached text jump).
- Steps line (1 Load frame, 2 Draw a box, 3 Track, 4 Use), an **Attach / Lock** switch showing only that mode's options.
- Engine: one colour decode serves the tracking (its brightness) and a 480 px JPEG of every frame (about 25 KB each, the last
  4 tracks kept in memory: `GET /tracker/thumbs`); the job's `extra.live` is the frame being tracked; `/tracker/track` takes
  `into: {id, offset}` for a part. Tracking speed unchanged (4K clip, 180 frames, 4.7 s).
- Verified through the bridge in Premiere 26.5.2 ("Tracker test"): live frames during the track, 180 frames to scrub, a jump
  to frame 151 moved Premiere's playhead to 5.0055 s (5.005 expected), Track from here (30 frames) and back from here
  (31 frames) replaced only their part. Layout checked in the browser preview at 240 / 300 / 420 px. NOT tried by the user.

## 0.10.54 - Tracker: Lock to it (the user 2026-11-11, a dribbled basketball: "track the ball's movement so it's locked in on it")
- Tracker page, **Lock to it**: the TRACKED clip itself gets Position keys so the object stays where it is on the boxed frame
  (**Centre it**: in the middle), as if the camera followed it; works through the clip's own Motion, also a keyframed punch-in.
  **Smooth** follows a Gaussian-smoothed path (sigma 6 frames) like a camera operator instead of shaking with every bounce
  (lost frames bridged); without it lost frames get no key. **Zoom** (on by default) scales the clip by the smallest factor
  that keeps every frame covered (coverage.gap, as the pre-export check); not when the clip's Scale is keyframed (then the
  panel says which Scale would hide the edges). One Undo step; refused over Position keys of the editor's own; Detach takes
  the keys off. Verified in Premiere 26.5.2 on the synthetic 4K clip: the object on the same pixel in six full-size frames
  across the clip while the clip moved and kept its keyframed zoom; the Scale keys were left alone. NOT tried by the user.

## 0.10.51-0.10.53 - Motion tracker (Cockpit plan A3, the user 2026-11-11: "track objects perfectly ... like it's in After Effects")
- New **Tracker** page: Load frame (the selected clip at the playhead), drag a box around the object, Track (forwards and
  backwards over the whole clip, progress, Cancel, a green / yellow / red strip; a click moves the playhead there), then
  **Attach selected**: the selected text / logo / clip follows the object with one Position key per frame (Scale and
  Rotation when ticked), keeping where the editor put it on the boxed frame, through the source clip's own Motion (also a
  keyframed punch-in). One Undo step; lost frames get no key; never over the editor's own keyframes; **Detach** takes the
  tracker's keys off.
- Engine `tracker.py`: optical flow with a forward-backward check and RANSAC similarity, corrected every frame against the
  first frame's region (sub-pixel), scale and angle refined on it, a wide search when unsure, an adapting second template
  for changes of look, lost / unsure / sure per frame. Synthetic accuracy 0.002-0.03 px median (also 70 px a frame, blur,
  light change, 12 hidden frames picked up again), about 1 px for a 70° turn in depth (docs/TRACKER.md,
  scripts/bench_tracker.py). Endpoints `/tracker/frame`, `/tracker/track` (job).
- Verified in Premiere 26.5.2 on a synthetic 4K clip with a known path: attached square within 0.25-0.5 px at full
  resolution, angle and size following exactly. 0.10.52-0.10.53: test bridge only (`tracker_box`, `tracker_info`, the
  Tracker's checkboxes in `fill`; the page reads its checkboxes when Attach is pressed). NOT tried by the user yet.

## 0.10.50 - Stash clips (Cockpit plan A2b, the user's go 2026-11-11)
- Keyframer page, Stash: **Save selected clips** keeps the clips selected in the timeline (a logo on V2 over its background on
  V1, a title with its sound) as a stash for any project. The clips are copied (createCloneTrackItemAction: same project items,
  every effect, Motion, keyframe) into a new empty sequence "Stash - <name> <id>" in the bin "Asistent stash" (made from a shell
  XML the engine writes), and the host saves that sequence with `Sequence.exportAsProject` into `<app>/stash/clips/<id>/`.
- Pressing a clips stash puts it in at the playhead: from its sequence when it is still in the project, otherwise its project
  file is imported into "Asistent stash" first. Same tracks when they are free there; otherwise the whole group moves up
  (video) / down (audio) to free tracks, adding tracks on top when needed (host QE `addTracks`). A copy never covers or cuts a
  clip. A clip and its sound are linked again. Undo: one step for the copies, one for the link.
- Asistent deletes nothing in the project: the stash sequences and anything imported stay in the bin "Asistent stash" (the
  editor may delete it). Deleting a stash in the panel removes its folder in `<app>/stash/`.
- Verified through the bridge in Premiere 26.5.2 (NEW TEST, then TEST.prproj): V1 clip + V2 adjustment layer (Black & White,
  Transform) + A1 saved (13.8 KB project); applied at 120 s on the same tracks with the same effect chains, linked; applied again
  at the same place it went to V3/V4/A2 and Premiere added V4; Position keyframes carried with the same times and values;
  in TEST.prproj it was imported from the file, placed and linked, Black & White working (saturation 0.0) and the file upright
  (no black bars). NOT tried by the user yet.

## 0.10.49 - Auto color on slowed-down clips (the user, 2026-11-11)
- fx30449 (a 4.5 s 119.88 fps file, slowed on the timeline) said "Cannot read frames": its clip's range lay past the file's
  end, so every seek gave nothing and the frames through the LUT layer were dropped with it (their log check reads the file
  too). `color.read_frames` keeps the range inside the file (the whole file when nothing of it is). Verified on the real file
  (4 frames read from a range past its end) and on a synthetic one. NOT verified by the user in Premiere yet.

## 0.10.48 - Auto color looks through a LUT-only layer in Premiere 27.0 too (the user, 2026-11-11)
- The user's Pulse Fitness Video 6 in Premiere 27.0: an adjustment layer with only an S-Log3 LUT was taken for a layer that
  covers the clip ("its Lumetri has more than a LUT (Color Wheels: false, untouched false)"), so Auto color measured the flat
  file and applied nothing (+1.5 stops measured). The untouched Lumetri was learnt in 26.5.2 and 27.0 names a parameter
  differently. `colorplans.lutOnlyDiff` (pure, tested) now compares each parameter by its value; a heading's open / closed
  switch counts as nothing under either name. NOT verified in 27.0 by the user yet.

## 0.10.45-0.10.47 - The user's seven reminders (2026-11-11), tested in NEW TEST in Premiere 26.5.2 while the user edited in 27.0
- **Rough cut from clones (reminders 2 and 6):** the XML import made NEW master clips; Premiere 26.5.2 switched off their
  rotation flag (`IsOverridenImageOrientationType`, the FX3's vertical shots came in sideways) and dropped S-Log3, and Fix
  audio's L/R copies came in as plain stereo. The XML now only makes the empty sequence (`xmeml.write(shell=True)`: size,
  rate, tracks, review markers); every piece is a clone of the editor's own clip (`createCloneTrackItemAction`), trimmed with
  In / Out and moved into place, then video and audio are linked again through the host (`as_link`, `/roughcut/link`).
  Verified: same project items, effects kept, L/R copies kept and linked, nothing left past the end. The XML with clips is
  still written as the fallback.
- **Cancel (reminder 4):** recognition runs in its own thread and the waiter looks at Cancel every 0.2 s (`asr.transcribe`):
  a rough cut cancelled in 0.06 s (was 75 s). Cause measured on Pulse Fitness: one 30 s stretch took up to 132 s because a
  repeated take tripped Whisper's compression-ratio limit (2.4) and the stretch was read six times. The rough cut now reads
  with `asr.ROUGH_COMPRESSION` 3.0 under its own cache keys (`rough3-`, `turbo3-`): 95 -> 31 s and 51 -> 19 s on two clips,
  same or better words. Subtitles unchanged.
- **Sync short takes (reminder 7):** a Low pair whose two stretches agree (peak ratio >= 1.25) becomes High when the
  cameras' LEARNT clocks agree within 1.5 s; a two-offset pair is decided by the clocks when the other offset is far. On the
  Pulse Fitness footage 7 of the 10 pairs the user synced by hand now sync; the rest are named ("recorded at the same time by
  the camera clocks", `clock_overlaps`). A suggestion the clocks place in another take says so.
- **POV colours (reminder 5):** a placed clip keeps the colour its file had then, so Sync colours the camera files BEFORE
  placing (`premiere-labels.colorFiles`, its own Undo step; Put names back restores them). Files verified (Forest / Magenta);
  the clips' own colour is not readable by scripts: the user to look.
- **Fix audio track order (the user's note with reminder 5):** one second-side track per source track
  (`audioplan.lowerTracks`), and Sync puts each camera's sound on every other audio track. Verified: A1+A2 POV 1, A3+A4 POV 2,
  A4 added through QE `addTracks` (`as_add_audio_track`), tracks named "POV n audio 2" right after the split.
- **Check before export (reminder 1):** Premiere's timecode (drop frame at 59.94 / 29.97), a click on a timed line moves the
  playhead, "Put N markers on the timeline" (one Undo step, no duplicates), the In / Out respected, and sound running on after
  the last picture said as such (the ReShape "0:58.1-2:23.9: 85.9 s of black"). Verified in NEW TEST.
- **Keyframer Overshoot+ and Bounce Back (reminder 3, the user's BOUNCr reference):** the motion after the last keyframe,
  driven by the arriving speed, BOUNCr's settings and defaults (50/2/4, 50/50/10), measured against the recording frame by
  frame. Overshoot+ verified in NEW TEST (0 -> 143 -> 83 -> 106 -> 100 %).
- **Two Premiere versions side by side:** every command carries a lane (the Premiere's major version: `X-Asistent-Lane`
  from the panel and the host, `ASISTENT_LANE` for `dev_cmd.py`); the engine hands a command only to the side of the Premiere
  it came from. Bridge probe `rough_probe` (dev only).

## 0.10.44 - Check before export: does every clip's picture fill the frame (the user, 2026-11-11)
- The user: "I often make the mistake for the B-Rolls to not be fully scaled and you can see either black bars or a little
  bit of the video that is below the B-Roll ... we need to catch that before the export". New part "Picture fills the frame"
  in Check before export: for every video and photo clip (not PNG / PSD / SVG / GIF logos, not transparent files, not
  graphics, adjustment layers or switched-off clips) the picture's place is worked out from the file's frame (engine
  `/export/frames`: size, display rotation, alpha) and Motion (Position, Scale / Scale Width, Uniform Scale, Rotation, Anchor
  Point, Crop, or the Crop effect) at the clip's start, end and every keyframe; any strip over half a pixel is reported with
  its size, side, time, scale and what shows through ("V1 C0728 shows through" or "black shows").
- New `panel/coverage.js` (pure geometry, 7 node tests), reader in `premiere-exportcheck.js`, `exportcheck.frames` (1 pytest).
- NOT verified in Premiere yet: the units of Anchor Point (taken as a fraction of the file; the default centre is right either
  way), the names of Motion's Crop parameters, and whether "Scale to Frame Size" can be read (if not, the report says the clips
  are measured as if it is off). A Transform effect is noted, not measured.

## 0.10.43 - Stash clips probe (dev only)
- Temporary bridge `clone_probe`: `createCloneTrackItemAction` copies clips from one sequence into another with their effects in
  order (NEW TEST). Plan for Stash clips in docs/probes/cockpit-phase0.md; one decision is the user's (delete Asistent's own
  temporary sequences or keep them in a bin). Also there: how Quick Search now makes adjustment layers (P-Q1 to P-Q3 answered).

## 0.10.41-0.10.42 - Test bridge for the after-export check and the Fast switch; both verified in Premiere 26.5.2
- Bridge `after_export {out}`: the panel's export-event path (read the sequence, `/exports/done` with it), since a scripted
  export fires no event. Bridge `fill` also takes `roughFast` and says whether its row and the download offer are shown.
- VERIFIED in NEW TEST: the sequence read (2160x3840, 29.97 fps, 128.5 s), a real 128 s export (`export_try`) checked in 20.7 s,
  the report in the panel (Log > Report). It found real letterbox bars 1:18.5-1:44.0: exactly clip fx31030 (pure black rows at
  the top and bottom, measured), and 1.5 s of silence at the start. Fast rough cut: turbo loaded, 51.5 s read in 21.1 s,
  sequence "as written".
- Found: in Premiere 26.5.2 the bridge's `dispatchEvent(new Event("change"))` throws "reading 'detail'" (the box is ticked
  before it throws, so the test still ran); BUGS.md.

## 0.10.40 - Fast rough cut with large-v3-turbo, as a switch (TODO A, the user's choice 2026-11-11)
- `asr.py` knows two models: large-v3 (subtitles, unchanged and still the default of every call) and large-v3-turbo
  (`mobiuslabsgmbh/faster-whisper-large-v3-turbo`, MIT, pinned commit and SHA-256 in `pins.py`, `<app>/models/whisper-turbo`).
- Rough cut: a new "Fast (fewer takes found)" switch, off by default, shown once turbo is downloaded (a "Download the fast
  recognizer" button under Rough cut, `POST /roughcut/model/download`). Turbo words are cached under their own key, so the
  subtitles never see them; a subtitle reading of the same audio is still reused.
- Measured on GStroy FX3 (15 clips, 215 s, empty cache, M4 Max, at low priority while Premiere ran): large-v3 76.7 s, turbo
  35.8 s (2.1x). The cut differs: turbo missed one false start and resolved one group of three takes differently (takes cut
  58.4 -> 34.5 s, result 108.8 -> 123.3 s). Hence a switch, not the new default.
- ReShape golden check identical (SRT, English SRT, job JSON). Tests: 3 new pytest; 705 pytest + 24 skipped, node 238.

## 0.10.39 - After-export check of the exported file (TODO I14, the user 2026-11-11)
- New `engine/asistent/filecheck.py`: every export the watcher finds is played once through FFmpeg in the background (two
  threads, `nice` 10, working picture 640 px long side): black bars (cropdetect per frame, runs of 0.3 s or more), black
  frames (one frame or more), frozen picture (a second or more), sound on one channel only, silent sound, no sound, true
  peak above -1 dBFS, samples at full scale, silence in the first 0.5 s / last 1 s, FFprobe's size, frame rate, codec, bit
  rate, HDR colour; and against the exported sequence (sent by the panel with Premiere's export event): a different shape,
  frame rate or length (an In to Out length counts). Loudness is information only, next to -14 LUFS (the user's choice).
- Automatic, on by default (the user's choice): `exports.json` `check`; the watcher runs while showing OR checking is on, so
  exports are checked also with Show exports off. Report in `/exports/recent` (`check`), the new After export card (the newest
  export, line by line) and the Log's Exports list (summary + Report).
- Measured on 8 real finished exports (numbers only): 1.6-22 s each (a 4K minute is the slowest); true peaks over 0 dBFS
  found on two. NOT verified in Premiere yet (the user was editing; the event payload and the sequence read are new).
- Tests: 9 new pytest (synthetic files for each finding) + 4 watcher tests; 713 pytest + 24 skipped, node 238.

## 0.10.38 - Sync keeps Fix audio, and no gap between recordings (the user's field report, 2026-11-11)
- The user (4a1a mobilefox › B-Roll, C0930 / C0932 / IMG_0357): after Fix audio, Sync "removed it once again" and "left a small
  gap between the clips which we don't have in the original timeline". The log showed the engine right (IMG_0357 on C0930 at
  +46.30 s, C0932 alone); the SYNC sequence is built from whole files, so Fix audio's L / R copies and levels were not in it,
  and the layout put 2 s between entries.
- Sync now does Fix audio again on its new sequence for every selected file that has Asistent's L / R copies anywhere in the
  user's sequence (selected or not), with the same code as the button (`fixAudio()`, split out of `onAudio`;
  `readAudioSelection(project, pick)` takes a rule instead of the selection). A failure there is said, never hides the sync.
- `layout.js` GAP 0: recordings follow each other directly. The export check's note on SYNC gaps reworded.
- Tests: the user's case in layout.test.js, a wiring test for the redo; 700 pytest + 24 skipped, node 238.
- NOT verified in Premiere: the user had the client project in front (the bridge refuses it); to try in B-Roll.

## 0.10.37 - Stash v1: save an animation, put it on another clip at the playhead (Cockpit plan A2)
- Keyframer page, new Stash section: Save animation (the ticked properties of the read clip), a list of saved stashes with a
  client filter ("Show"), each one a button that writes it on the selected clip from the playhead in one Undo step; × twice
  deletes. Footer: how many and how much disk.
- The easing is kept exactly: the value at every frame between the first and the last key is stored and written back like a
  Keyframer bake (the editor's keys as keys, the frames between as Asistent's), so Undo last and a new curve work on an
  applied stash. Keys the Keyframer baked on the source count as easing, not as the editor's keys. Another frame rate is
  resampled. `stashplan.js` (pure, 5 node tests), `premiere-stash.js`.
- Never over the editor's work: a property whose time on the target already holds a key of its own is not written; an effect
  the target lacks is not added (listed); keys past the clip's end are cut; the playhead must be over the clip.
- Stored as data in `<app>/stash/<id>.json` with the client of the project it came from (`stash.py`, endpoints
  /stash/list|get|save|delete|rename, 3 pytest), so it works in every project and survives panel updates. No thumbnail yet.
- `premiere-keyframes.js`: properties carry their effect's match name and parameter name; `remember()` for keys written
  outside a Keyframer press.
- Verified through the bridge on NEW TEST (ROUGH v3): fx31028 Position 0.3 -> 0.7 with Ease In-Out saved, put on C0728 from
  35.00 s: 2 + 29 keys with the same values from media 2.734 s; Undo last left the 2 keys; a second press over those keys
  wrote nothing; playhead outside the clip refused. Both clips put back, the test stash deleted.

## 0.10.36 - Colour learning at export: the editors' Lumetri next to Auto color, per client and camera (TODO EL1)
- When Premiere says an export ended (the Export tab's EXPORT_MEDIA_COMPLETE; once per 20 s), the panel reads the open
  sequence's picture clips (up to 150): the five Basic values, whether the Lumetri is still Asistent's own, keyframes, Input
  LUT / Look, and a Lumetri on an adjustment layer above. Read only. `premiere-colorlearn.js`.
- The engine (`colorlearn.py`, its own background thread, never the job pool) analyses each file range as Auto color would
  (exposure in stops; Temperature / Tint through the learnt calibration), with the camera and picture profile from the Sony
  sidecar (else the folder), and appends one line per clip to `<app>/learning/color/<client>.jsonl`. Client: the folder with
  a "... Subtitle Learning" folder, else the folder under 01_CLIENTS, else the share's first folder.
- Color card: "Learn from exports" (on) and "What the editors did": per camera, the median of editors minus Auto color
  (exposure, temperature, tint; only where Asistent was sure and nothing is keyframed; clip + layer together), how often
  Asistent's own correction was kept, no correction, graded on a layer. A re-export of a clip replaces its line.
- NOT on the office server: EL0 (a learning folder per client there) waits for the user's yes.
- Bridge `learn_export` runs the same step (an export started by a script fires no event, probed again 2026-11-10).
- Verified through the bridge on NEW TEST (ROUGH v3, 14 clips, 33 s in the background): camera ILME-FX3 / ILME-FX30 from the
  sidecars; a fresh Auto color recorded as Asistent's own (0.85), a hand change (0.4, temperature 8) as the editor's; the
  report per camera. Test records deleted afterwards; the test Lumetri on fx31028 (ROUGH v3) set back to neutral.

## 0.10.35 - Before export: offline media, black, text outside the safe area, microphone over -6 dBFS (TODO I12)
- New Tools card "Before export" > Check before export (whole open sequence, no selection, read only). Five parts, each
  ✓ measured and fine, ! to look at, or ? not measurable through the API:
  - offline media (track, clip, time);
  - black gaps and flash frames between 0 and the end (switched-off clips, hidden tracks and adjustment layers show nothing;
    a SYNC sequence's 2 s gaps between groups are noted as on purpose);
  - text graphics whose centre is outside the safe area (9:16: x 0.06-0.86, y 0.10-0.80 for the apps' buttons and caption;
    otherwise title safe 90 %), and caption lines that overlap in time (a caption track's place cannot be read: said so);
  - microphone level: each clip on a camera or microphone track (tracknames.js) peaking above -6 dBFS, music or effects
    only near 0 dBFS; the file's true peak in the clip's range (new engine job `/export/peaks`, `exportcheck.py`) plus the
    highest Volume the clip reaches; Fix audio's L / R copies and Fill effects count only the channel they play;
  - missing fonts: always "?", Premiere does not tell a script.
- `premiere.js` readItem keeps `offline` on each item (was computed, not kept).
- Verified through the bridge on NEW TEST: ROUGH … v3 flagged C0728-C0730 at -1.5 dBFS (FFmpeg astats on C0728: -1.56, R
  channel); SYNC – кам2 clean after the channel fix (C0728 L had been read on its louder R channel: -4.4 instead of ~-9);
  a subtitle graphic moved to y 0.95 was reported "too low", then put back. NOT seen live: offline media and caption overlaps
  (node-tested; NEW TEST has neither).

## 0.10.34 - Track names: POV 1 / POV 2, their sound, Mic, Subtitles BG / EN (TODO I7)
- New Tools card "Track names": Name the tracks / Put names back, "Also after Sync and rough cut" (on), a label colour per
  camera (Keep by default). `tracknames.js` (pure, 9 node tests) decides, `premiere-labels.js` writes in one transaction.
- Rules (the user's choice 2026-11-10: POV 1 / POV 2 by track order): a video track is a camera when at least 80 % of its files
  share one folder and that folder's sound is on an audio track; audio is a camera's by its file, else its folder; an audio
  track whose folder is on no video track is a Mic; Asistent's own caption tracks (recorded signature) are Subtitles BG / EN.
  Names the editor typed are kept; B-roll and graphics tracks are left alone; Asistent's earlier names are renumbered.
- Colours are project-item labels (Premiere has none per timeline clip), so they show on that file everywhere: off unless chosen.
- Put names back returns to the names and colours from before Asistent's first press, only where they are still as it left them.
- Probed in Premiere 26.5.2: VideoTrack, AudioTrack and CaptionTrack have `createSetNameAction` (26.0.2 had no track rename in
  UXP); ExtendScript `Track.name` is writable too; timeline clips have no colour label in either API.
- Test bridge: `fill` also sets the Track names options (test projects only).
- Verified through the bridge on NEW TEST: SYNC – кам2 (a stray file on V1, Fix audio's L/R copies) named V1 POV 1, V2 POV 2,
  A1 POV 1 audio, A2 POV 2 audio, A3 POV 2 audio 2; second press "nothing to change"; colours Rose / Mango on 24 files and back;
  Put names back to Video 1 … Audio 3; a new Sync and a rough cut of it were named on their own. NOT verified: Cmd+Z (macOS
  did not let a script press it).

## 0.10.33 - Keyframer: Elastic, Bounce, Ping-pong and Loop (the user: "a smooth bounce in, ping pong")
- `keyframeplan.js`: Elastic (exactly n overshoots, the first one the % set, each later one smaller, no jerk), Bounce (a ball
  dropped on the target: n hops, each a set height of the one before, never past it), each at the end, the start or both;
  Ping-pong and Loop after the last keyframe (n times, or as many whole repeats as fit before the clip's out point).
  Our own functions, not a copy of any After Effects script. 12 node tests.
- Keyframer page: Motion switch Curve / Elastic / Bounce; for Elastic and Bounce, Where (at the end / at the start / both),
  Bounces (1-8) and Overshoot (5-50 %) or Height (5-80 %) steppers, the curve drawn in the box; a "Repeat after the last
  keyframe" row (Off / Ping-pong / Loop, Times 1-20 or "until the clip ends"). Premiere's own Linear / ease / Hold with a
  repeat is refused (they add no keys). The result line counts the repeated keys.
- Verified through the bridge in Premiere 26.5.2 on NEW TEST C0738 (two Position keys 0.3 -> 0.7, 4.40-5.40 s, out 12.91 s):
  Elastic 29 keys (peak 0.773, lands on 0.700); Ping-pong until the end replaced them (-29, +239, ends 12.40 s on 0.3);
  Bounce x5 with Loop replaced those (-239, +239, hops 50/25/12/6/3 % under the target, never past it); Undo last left the
  2 keys; Linear with Loop refused, Linear alone set without keys. C0738 put back afterwards.

## 0.10.32 - Keyframer: shape the motion between keyframes with a curve (Cockpit plan A1)
- A new page, Keyframer (the other tabs are unchanged): Read the selected clip lists its keyframed properties (numbers and
  positions, any effect) with their frame counts; tick them, pick a curve (Ease In-Out, Ease In, Ease Out, Cubic, Expo Out,
  Overshoot, or drag the two handles; Save this curve keeps your own) and press Apply. A custom curve is baked as one keyframe
  per frame between your keyframes, which stay as they are; Premiere's own Linear, Premiere ease and Hold only set your
  keyframes' interpolation. One Undo step per press; Undo last takes out only what Asistent added; a second press replaces
  Asistent's earlier curve instead of stacking on it. A sped-up clip gets one key per sequence frame; reversed clips are refused.
- Verified in Premiere 26.5.2 by Claude through the bridge (NEW TEST, C0738, two Position keys 1 s apart at 29.97 fps): Ease
  In-Out added 29 keys (0.300 -> 0.500 in the middle -> 0.700, symmetric), Expo Out replaced them (removed 29, added 29),
  Undo last left the two keys, Premiere ease set Bezier with no keys added. C0738 restored afterwards. Not yet tried: a
  sped-up clip, Overshoot on screen, dragging the handles by hand.

## 0.10.31 - Cockpit Phase 0 done: the temporary probe is removed
- 0.10.30 carried a temporary panel module (`probe-cockpit.js`, test bridge only) for the Phase 0 probes
  (`docs/probes/cockpit-phase0.md`). It is removed again: the panel is the same as 0.10.29 apart from the version.

## 0.10.29 - An exposure that went past the target is scaled back once (Pulse, S-Log3 under a LUT)
- In Premiere 26.5.2 (Pulse Fitness IVO7V9795 under its LC-709 LUT layer) +2.15 landed 0.7 stops over the target: Lumetri
  Exposure on the log signal, under the LUT, moves more than on Rec.709. When the after-check finds the brightness more than
  0.35 stops past the target on the other side, what this press added is scaled once by wanted / achieved (here 2.15 -> about
  1.56) and re-checked. It only ever lowers. NOT yet tried in Premiere.

## 0.10.28 - Log clips: "converted" judged against the flat file; mixed light leaves white alone
- Premiere's own frames through the LC-709 Look were softer than FFmpeg's render of the same LUT (range x1.25, colour x1.34,
  blacks 0.081 lower than the file), so the 0.10.25 check against a model of the conversion said "could not tell".
  `color.log_shown` now asks whether the timeline is still the flat file: range and colour both 12 % or more wider ->
  converted; the same blacks, range and colour -> flat. The flat file cropped 9:16 like the timeline stays at x0.99-1.00 on
  five Pulse clips.
- White balance: when the neutral surfaces and the whole picture read opposite ways (Pulse: the neutral patch warm -0.29,
  the blue-lit gym +0.8), white balance is left alone ("Mixed light"). It used to be "medium" and would have cooled a
  picture that looks blue. More careful on every clip; nothing else changes.
- Verified in Premiere 26.5.2 by the user: IVO7V9795 measured on the timeline through the LUT layer, exposure applied
  (high), white balance left alone.

## 0.10.27 - The panel's settings load when the engine comes back (found testing Pulse)
- Premiere reloads the panel the moment an update installs it, while the engine is still restarting: the one load of the
  panel's settings failed and was never retried, so the untouched-Lumetri reference (and the other settings) were missing
  until the panel was reopened. The header refresh now retries; settings made in the meantime stay.

## 0.10.26 - A Lumetri section opened in the panel no longer counts as a grade on a LUT layer
- The Pulse LUT layer was refused for "Color Wheels & Match": a section heading whose true/false is whether it is opened in
  the Lumetri panel. Section headings may differ in that state only; every setting is still compared. A refusal now logs
  the two values.

## 0.10.25 - Field bugs fixed: Fix audio with several projects open, iPhone audio, S-Log3 under a LUT layer; faster rough cut
- **Fix audio / subtitles with several projects open** (field report 2026-11-10, Credissimo: "No active sequence." 5 times of 6).
  With several projects open, ExtendScript's `app.project` is the front project, and `activeSequence` read from any project
  object is the front one's sequence (probed in Premiere 26.5.2 with TEST and NEW TEST open). The host now finds the panel's
  project by its path among `app.projects` and the sequence by its id (UXP `Sequence.guid` = ExtendScript `sequenceID`, sent by
  the panel), then by its name, only among that project's own sequences (`host.jsx` `as_target`, used by captions, graphics and
  the L/R split). Verified in Premiere 26.5.2: C0728 split into L/L + R/R in NEW TEST while TEST.prproj was in front; the copies
  went into NEW TEST's bin. Refusals now say what is wrong (project not open, sequence not found, two sequences of one name).
- **iPhone clips in Sync** (Credissimo IMG_0357.MOV: "no decoder found for: apple_apac"). An iPhone file carries a normal AAC
  track beside Apple's spatial audio; a track FFmpeg cannot decode is left out when another one can (logged); a file with only
  APAC says so in plain words. Normal files are read exactly as before.
- **Colour on S-Log3 under a LUT adjustment layer** (Pulse Fitness КП-5, A7V IVO7V9795/9798: "Nothing to correct with
  certainty"). Two causes: an adjustment layer counted as covering the clip (so the flat file was measured, REVIEW_NEEDED), and a
  log clip measured on the timeline was always "low". Now (1) an adjustment layer holding only a LUT (one Lumetri equal to an
  untouched one except the LUT parameters, read in 26.5.2: 4-7, 32-37, 122-124, 128-129; nothing else but Motion/Opacity) is
  looked through, and (2) the engine checks how Premiere shows a log clip (`color.log_shown`: the timeline frame against the file
  read flat and read converted): converted -> measured as Rec.709 with the usual frame check; flat -> "put the conversion LUT on
  first"; unclear -> low as before. Frames through a LUT layer count only for a log clip they convert (a LUT over Rec.709 footage
  is a look: the file is measured as before). Measured with Sony's LC-709 / Cine+709 LUTs on the Pulse files: 0.16-0.23 from
  converted against 0.68 from flat. NOT yet tried in Premiere.
- **Rough cut faster on one long clip**: with fewer windows than readers, long pieces are read in ~30 s parts cut at their
  quietest moment (Beauty Sector fx30-2-1304, 133 s, first run: 149 -> 60 s, 219 vs 217 words). Three or more windows: as before
  (splitting REVO's three clips was slower, 106 -> 167 s). The subtitles are unchanged (their own long windows; ReShape baseline).
- The panel says plainly when it and the engine differ ("close the Asistent panel and open it again"): the Pulse screenshot
  showed an old 0.10.17 panel.

## 0.10.24 - The install works with two Premiere versions side by side (found installing 0.10.23)
- This Mac now has Premiere Pro 2026 (26.5.2) and 2027 (27.0.0). Adobe lists Asistent once per Premiere, so the install check
  ("Adobe lists exactly the new version") saw "0.10.23, 0.10.23" and stopped before restarting the engine. The check now reads
  Adobe's list per Premiere: each one must list exactly the new version; an old copy beside it in any of them is still removed.

## 0.10.23 - Every client style joins the article to an English name (the user's answer 2026-11-10)
- GStroy, Credissimo, ЕКОПАК and Beauty Sector join the Bulgarian article to an English name as AULA does („iPhone -а“ →
  IPHONE-А). The client's own brand takes no article (the user: "Its not GStroy-A its GStroy"): „G -Stroy -а“ → GStroy,
  „Credissimo -то“ → CREDISSIMO, also ЕКОПАК, BEAUTY SECTOR, AULA and AULA.BG (preset key `brand`). ReShape, short and standard are
  unchanged. On the saved speech of all five clients no caption changes (the four never say such a name there).

## 0.10.22 - Subtitle Style "AULA" (the user's request 2026-11-10)
- Captions > Style > **AULA**, measured on the client's 10 exported videos (738 chunks): the shared Submagic template, up to 4
  words / 17 characters (2.20 words against the editors' 2.36, 45 % two-line against 46 %, 69 % of their breaks), even cuts
  (91 % of the editors'), a green keyword (#37D977) suggested on 30 % of chunks, as the editors (agrees 42 %, chance 30 %;
  tech and interface words). English names in Latin capitals as the exports write them, with the Bulgarian article joined by a
  hyphen (`join_articles`, AULA only): „iPhone -а“ → IPHONE-А, „Sunbox -а“ → SANDBOX-А; the brand AULA.BG (from „aula .bg“,
  „AOL .bg“, „AulaBG“, „Яло АБГ“), GTA VI. The result box says "Green keywords".
- `scripts/measure_style.py chunks --latin`: counts subtitle lines in Latin capitals too (AULA's English names; without it 92
  chunks were missed).
- Docs: `docs/SUBTITLE_STYLES/AULA.md` (two heights by format: filmed 0.42-0.47, screen tutorials 0.57-0.72; about one green
  chunk in five colours a whole short line), `docs/CLIENT_COLOR/AULA.md` (no one look: faces 0.40, the darkest of the five,
  varying by shoot); vault: `clients/AULA/`, `editing/client-styles.md`.

## 0.10.21 - Subtitle Style "Beauty Sector"; GStroy written GStroy (the user's answers 2026-11-10)
- Captions > Style > **Beauty Sector**, measured on the client's 7 exported videos (350 chunks): the shared Submagic template
  (Montserrat Heavy = Black, capitals, glow, with the word), up to 4 words / 18 characters (2.17 words against the editors' 2.19,
  44 % two-line against 46 %, 65 % of their breaks), even cuts (96 % of the editors'), a coral keyword (#D45E58) suggested on
  about one chunk in three (agrees 53 %, chance 35 %). Names in Latin capitals as the exports write them: BEAUTY SECTOR, DOUBLO
  GOLD, HIFU (from Whisper's „HiFull“, „HIFO“, „High Flow“; „High Flow Lifting“ → HIFU ЛИФТИНГ), BODY SCULPT, SMAS, DOCTOR VANDEV.
  The result box says "Coral keywords".
- GStroy: the brand is **GStroy** even among the capitals (the user); Whisper's two words „G -Stroy“ are joined (preset `names`
  now takes split forms, longest first, and a name keeps the client's own case). A lone „–“ is not shown in the client styles
  (`drop_dashes`; 3 in 837 GStroy words). ЕКОПАК's name is written ЕКОПАК by the same rule.
- Even two-line cuts never leave a one-letter word alone on a line („С DOUBLO GOLD“ stays one line); Credissimo and ЕКОПАК keep
  their fit (2.50 / 2.25 words a chunk, 49 % / 40 % two-line).
- Docs: `docs/SUBTITLE_STYLES/BEAUTY_SECTOR.md`, `docs/CLIENT_COLOR/BEAUTY_SECTOR.md` (the cleanest grade: faces 0.57, neutral);
  the subtitles of all four clients are made in Submagic with Montserrat Heavy (the user); vault: `clients/Beauty Sector/`,
  `editing/client-styles.md`.

## 0.10.20 - Subtitle Style "ЕКОПАК", CREDISSIMO in Latin, Montserrat Black installed (the user's requests 2026-11-10)
- Captions > Style > **ЕКОПАК**, measured on 7 of the client's exported videos (400 chunks, `scripts/measure_style.py`): the
  shared template again (Montserrat Black 52, capitals, no punctuation, glow, appears with the word), up to 4 words / 17
  characters (2.25 words a chunk against the editors' 2.35, 41 % two-line against 42 %, 65 % of their break points), lines cut
  evenly, a green keyword (#18CC6E) suggested on about one chunk in four, recycling words first. The result box says
  "Green keywords".
- Credissimo: the brand is always CREDISSIMO (the user's decision), however Whisper wrote it (preset key `names`, only that
  style; also „Ecopack“ -> „Екопак“ in ЕКОПАК's).
- Montserrat Black (OFL) ships in `fonts/` and the setup installs it: the three clients' subtitles use it.
- `measure_style.py pace`: cuts, mean shot, loudness (LUFS), loudness range, true peak; one video in several sizes is v3,
  v3_2, v3_3 (they overwrote each other).
- Docs: `docs/SUBTITLE_STYLES/EKOPAK.md`, `docs/CLIENT_COLOR/EKOPAK.md`; the client knowledge for the other tools (autoedit,
  client-edit) in the vault: `editing/client-styles.md` and `clients/<client>/look.md` + `edit-style.json` for GStroy,
  Credissimo and ЕКОПАК.

## 0.10.19 - Subtitle Style "Credissimo", and a script to measure the next client (the user's request 2026-11-10)
- Captions > Style > **Credissimo**, measured on 9 of the client's exported videos (674 chunks): the same template as GStroy's
  (Montserrat Black 52, capitals, no punctuation, the even dark glow, centre at 50 %, appears with the word), but longer chunks
  (up to 4 words, 20 characters: 2.50 words a chunk against the editors' 2.52, 49 % two-line against 48 %) cut where the two
  lines come out most even (90 % of the editors' two-line chunks; ties give the longer top line), and a **red** keyword
  (#F84430) suggested on about one chunk in six: the last word if it is a money word („пари“, „бюджет“, „вноска“…) or a long
  word standing out among its neighbours (agrees with the editors on 28 %, chance 16 %). The result box says "Red keywords".
- Preset keys `split: "even"`, `accent_near`, `accent_words` (used only by Credissimo); GStroy, ReShape, short and standard give
  byte-identical captions on the 7 GStroy recordings at 25/29.97/30 fps; ReShape baseline and golden check identical.
- `scripts/measure_style.py`: the measurement as one dev script (frames + Mac text recognition, chunks and their statistics,
  Whisper word times, timing, a preset against the editors' chunks, colour). Reads the share only; refuses a work folder inside
  the repo. Re-run on Credissimo, it gave the same 674 chunks and numbers as the hand-run analysis.
- Docs: `docs/SUBTITLE_STYLES/CREDISSIMO.md`, colour findings `docs/CLIENT_COLOR/CREDISSIMO.md` (a warm grade, faces 0.53).

## 0.10.18 - Subtitle Style "GStroy", measured on the client's exported videos (the user's request 2026-11-10)
- Captions > Style > **GStroy**: the client's own subtitles, measured on 9 of its exported videos (395 chunks; Apple Vision text
  recognition at 8 frames a second, Asistent's Whisper for the speech times): 1-3 words in CAPITALS, no punctuation; a chunk over
  12 characters is stacked on two lines with its last word alone underneath ("ПРИ / ТРАДИЦИОННАТА"; never a little word alone
  below, a number keeps its unit); the usual 0.03 s lead (their chunks appear with the word, not 0.18 s ahead like ReShape's).
  On the editors' own speech: 2.22 words a chunk (theirs 2.21), 43 % two-line (theirs 40 %), 57 % of their break points.
- Green keyword suggestions: about one chunk in three, its last word (the editors' green word is the last word in 80 of 86
  cases); agrees with their picks on 43 % (they choose by meaning), so the result box lists them for the editor to colour and
  change; the JSON has `accent` per line. Look for the Track Style (Montserrat Black 52 px, white, green #94D000, an even dark
  glow, centre at 50 %) in `docs/SUBTITLE_STYLES/GSTROY.md`. Colour findings from the same videos (skin ends at 0.46-0.49, not
  0.62) in `docs/CLIENT_COLOR/GSTROY.md`, nothing in the Colour tab changed.
- New keys `stack`, `upper`, `accent` used only by this preset; ReShape's output is unchanged (baseline test byte-identical,
  golden full-job check identical).

## 0.10.17 - The panel's settings survive updates (found while testing Move off faces)
- **Every update erased the panel's own settings.** They lived in UXP localStorage, which Adobe's installer deletes with the panel,
  and every update removes the old panel (0.10.10's fix for the stale panel; before 0.10.6 the installer removed it too): the
  Style choice (ReShape), the English line switch, the English lines and words an editor typed per project, Review helpers, card
  open/closed, the colour "fresh Lumetri" snapshot and Move off faces' own positions. Found on this Mac: the storage folder was
  recreated empty at the 0.10.16 install, so Move off faces called its own earlier move "moved by hand".
- Now they are kept by the engine in `<app>/panel_store.json` (`panelstore.py`, `GET/POST /panel/store`; panel `store.js`:
  read from memory, written to the engine in order, localStorage kept as a fallback). On the first start of 0.10.17 whatever the
  panel's storage still holds is copied over. Nothing was in it worth recovering: the protected backup of 2026-11-08 17:10 held only
  the colour snapshot.
- Tests: store (engine copy wins, one-time copy, engine offline), panelstore (put/get/delete, only the panel's keys, size limit).

## 0.10.16 - Move off faces says which shot is which (the user could not tell if the second POV was seen)
- The user's two POVs (NEW TEST, 4:54.6–5:03.6: camera 1 C0738 on top, switched off in two pieces so camera 2 fx31035 shows) were
  both found ("1 under the face, 1 no face"), but the message did not say which was which. Now each shot is listed with its clip,
  time, what was found and how many lines it holds ("C0738, 4:58.7–5:01.4: under the face (face in 3 of 3 frames), 4 lines"), and
  the same goes into the log. A shot with no face found is marked, with the note that faces turned sideways are often missed
  (YuNet finds faces seen from the front), so such a shot gets the middle of the frame.

## 0.10.15 - Move off faces: a line over a cut changes height at the cut (two POVs, scene changes)
- The user's test of 0.10.14 worked on one shot ("Moved 9 subtitle lines off faces … 1 under the face; text position read on 3
  lines") and asked for two POVs and scene changes. Each line already took the height of the shot under its middle; a line that
  runs over a cut (POV A to POV B) got one height for both. Now every line is split at the cuts under it (the top visible clip
  with media in each stretch; hidden tracks and switched-off clips do not count; a stretch under 0.1 s joins its neighbour), each
  piece gets its shot's height, and a line over a cut gets Position keyframes: its first shot's height until one frame before
  the cut, the next shot's height from the cut (no slide; same one Undo step). Frames for the faces are taken in every shot a
  line piece covers.
- A second press may rewrite Asistent's own keyframes (same count and times as it wrote); keyframes the editor made stay.
- The keyframes' times count from the clip's In point; one line's keyframes are read back into the log to check the time base.
- Tests: cover (cuts, slivers, stacked POVs), keys at the cut, own keyframes.

## 0.10.14 - Move off faces reads where each subtitle's letters really are (the user's test in NEW TEST)
- The user's shot (one speaker, face in the upper third): "Виж тази чиния" ended at ~75 % of the height instead of ~50 %. The
  faces were found right; the starting point was wrong: an upgraded caption keeps its letters near the bottom (~0.89) while its
  Position values suggested 0.65, so every line moved the right distance from the wrong place.
- Now the frames exported for the faces (1080 px on the long side) are also read with the Mac's own text recognition (Vision,
  `ocr.swift` compiled once into `<app>/bin`, local only, `ocr.py`), and each graphic's words, taken from Asistent's own SRT
  files (the line with the same start and end), find its line in the frame: its measured centre is the starting point. Lines not
  measured follow the median offset of their role (one caption style per track). A Bulgarian/English pair: both lines are found
  by their own words; the lower (else the higher track) is English. Nothing readable: the old estimate, and the result says so.
- Windows: no text recognition yet (falls back to the estimate, with the warning).
- Tests: framefaces (SRT lines, words per graphic, line found by its words not by other text, pair), calibration and pairing.

## 0.10.13 - Move off faces reported "nothing changed" after moving the lines (found in NEW TEST)
- The user's first press in NEW TEST (9 upgraded lines, V5, 190.8-201.0 s) moved every line (all to Motion Y 0.3565, one shot,
  under a face), then said "Premiere did not accept the move (nothing changed)": `transaction()` returns nothing and throws on a
  refusal, and the new code read the missing value as a refusal; the written positions were not remembered either. Fixed; a test
  now checks that no panel code reads `transaction()`'s return value.

## 0.10.12 - Move off faces: subtitle graphics go to the client's height per shot (TODO R.5; not installed yet)
- **Move off faces** (Subtitles card): after the editor's right-click > Upgrade Caption to Graphic, select the subtitle graphics
  and press. Each line moves to the height the client's videos use (docs/SUBTITLE_STYLE.md, measured on 625 lines): one height per
  shot, the Bulgarian line's top 0.11 under the speaker's chin, above the face when it is low, the middle with no face, never
  above 0.16 or below 0.72 of the height; an English line (same times, the lower one) stays 0.035 under its Bulgarian line.
- How: the shots are the top visible clips under the lines; up to 3 program frames per shot are exported and the engine finds
  faces in them (YuNet, numbers only, frames deleted after: `framefaces.py`, `POST /captions/faces`); the rule is
  `placementplan.js` (pure); only Motion > Position is written, all lines in one Undo step (`premiere-placement.js`).
- Left alone: graphics with Position keyframes, and graphics the editor moved (Position no longer Premiere's default after the
  upgrade nor the value Asistent wrote last time, remembered per sequence on this computer). Text, style and timing never change.
- Limits: Premiere does not tell a script how tall a text graphic is (docs/NATIVE_GRAPHICS.md): the line height is a setting
  (0.035) and the text's on-screen centre is estimated from the layer's offsets (0.009 off on the probe title).
- Tests: 8 node (placement rule), 2 pytest (frames folder guard, fractions, deletion). Not yet pressed in Premiere.

## 0.10.11 - Captions tab ▶ plays in Premiere's Program Monitor (the user's review of 0.10.9)
The user: ▶ played "in the background, not in the program viewer", and with the timeline playing it was heard twice.
- ▶ now moves the playhead 1.5 s before the line and Premiere plays it in the Program Monitor, then stops 1.5 s after the line,
  only if the playhead is still inside that passage (playback the editor started elsewhere is left alone). The separate
  player (`listen.py`, afplay/winsound, `/subtitles/listen`) is removed. Through the host: QE `player.play(1.0)` / `stop()`
  (probed in NEW TEST; `qe.startPlayback()` did nothing); new host commands `play` / `play_stop`, engine `POST /subtitles/play`.
- Checked in NEW TEST through the engine: played from 1:57.8 (at 1:59.2 after 1.5 s), stopped inside the passage, left alone
  for a passage elsewhere. The panel loaded 0.10.11 live and Adobe lists only 0.10.11 (the 0.10.10 installer fix, on a real update).
- `host/host.jsx` and `hostbridge.py` gained the two commands only (guard lists them); ReShape golden check identical.

## 0.10.10 - Updates leave exactly one panel version, so Premiere runs the new one (found while testing 0.10.9)
- **Premiere kept running an old panel after every update since 0.10.6.** Adobe's installer, asked to install over the old
  panel, kept the older copies enabled beside the new one (this Mac: 0.10.7, 0.10.8 and 0.10.9 all "enabled", some twice), and
  Premiere loads the first one listed: after a restart it ran 0.10.7, so 0.10.7 and 0.10.8 never ran here. Now, when Adobe lists
  anything but the new version, every copy is removed and the new one installed again (one retry; the message says to
  double-click the .ccx if that fails). The path given to Adobe is absolute: a relative one failed with status -160.
  Checked on this Mac: after the 0.10.10 install Adobe lists only 0.10.10 (0.10.9, still open in Premiere, is "uninstalling").
  Other computers get the fix with this update; their older copies are removed by it.
- **0.10.9 checked in NEW TEST** (Subtitles on fx31031 in "SYNC – кам2", 17 lines, own earlier pair replaced): the review loaded
  (17 ▶ buttons, Lines to check shown; 12 lines to check, both „500 млн.“ lines first as number doubts, the dictionary repairs
  „водяло → видяло“ and „пусока → посока“ shown with their originals); Lines to check switched to "All lines"; ▶ moved the
  playhead from 2:10.4 to the line's 1:59.3 and played the passage (afplay). Through the test bridge; the user's own listen and
  Review helpers off still to try.
- Tests: 5 new (fake Adobe installer), 637 pytest + 173 node pass.

## 0.10.9 - Captions tab: reasons under the lines to check, Play with the sound around a line (branch improvements/2026-11)
The user's implementation prompt, stage 4 (faster, clearer subtitle review). Not installed yet (each install needs the user's OK).
- **Reasons under each line to check** (engine `review.py`, `POST /subtitles/review`; panel `reviewplan.js`): read from the run's own
  JSON, nothing changed in it. Words (recognition) and Timing are separate kinds; what changed is shown with its original
  („масна“ → „масона“, dictionary repair / learned fix / your correction / speaker form); numbers and prices, negations, names, a
  word that may be missing, gender forms and endings that disagree come first. "Unsure" is what the recognition reported, never a
  percentage; same-model readings are not called a confirmation. Weak alignment alone is shown but does not make a line one to
  check (on 19 real runs it would have marked 14 of 17 lines).
- **Lines to check**: shows only those lines; press again for all. The line under Apply says how many and of what kind.
- **Play** (▶ on every line, `listen.py`, `POST /subtitles/listen`): plays the line with 1.5 s before and after, from the same
  microphone piece the subtitles were made from, on this computer (afplay / winsound), and moves Premiere's playhead there
  (`Sequence.setPlayerPosition`, present in 26.0.2). A new Play stops the previous one.
- **Review helpers** checkbox (on by default, remembered on this computer): off shows the list as before (only the checkbox row is new).
- Correction history: unchanged and kept: every run writes its own timestamped JSON with `verbatim` (Whisper's words, never
  edited) and `edits`; Apply and rebuild re-aligns changed words as before. Partial reprocessing: not added (the rebuild reuses
  the recognition cache and takes seconds).
- The ReShape path is untouched: `reshape_guard` clean, golden full-job check identical, baseline test green.
- Tests: 12 pytest (review, listen), 1 server test, 7 node tests; preview scenario `review` (240/300/420 px).

## 0.10.8 - A covered clip gets only what needs no frame check (found by testing in NEW TEST)
Claude ran the open Premiere checks through the test bridge in NEW TEST.prproj (2026-11-08) and found one real problem.
- **Colour on a clip under a visible layer applied an unchecked +2 stops.** fx31030 in the rough-cut sequence: on the timeline
  (no face found) the midtones said "on target" at Exposure 0.5; covered by V2 it was measured on its file, where the skin said
  +2.7 stops, and Exposure 2.1 went in at medium confidence with ~14 % estimated highlight clipping, while the frame check cannot
  run under a layer. The white balance from the file also differed (Temperature 24.3 against 18 on the timeline). Now a covered
  clip measured on its file gets only high-confidence corrections, never an exposure expected to burn out the highlights, and
  says why; the misleading "checked on a frame after applying" note is gone there. NEW TEST: the same press now applies only the
  white balance and says "Exposure not applied … the highlights would probably burn out".
- A value the clip already has is not written again (the covered press reported "Applied to 1 clip" for an unchanged
  Temperature and Tint). Node tests; seen in Premiere once the panel is reloaded.
- **Verified in NEW TEST through the bridge (panel 0.10.6 code, unchanged since):**
  0.10.0 one press on V1 reads only V1 ("1 selected parts"); the V2 clip with the same cut, switched off, gets no Lumetri and stays
  off, also when it is selected too (listed as "switched off"). 0.10.4: with the track above hidden the clip is measured on the
  timeline; a razor-cut piece of a clip with Asistent's Lumetri is recognised as Asistent's own and updated (the other piece
  untouched); Fix audio's L/L and R/R copies keep the clip's colour label, and a second press gives recoloured older copies the
  clip's label back without splitting again. 0.9.89: three quick Exposure −0.5 presses all count (2.1 → 0.6).
- Tests: 1 new pytest (covered clip rules), 574 pytest + 166 node pass.

## 0.10.7 - Show exports: works after the office drive mounts, and fast in a new plan folder
The user, 2026-11-08: a finished export did not open its folder, and when it did it took up to ~30 s.
- **Nothing was watched after a restart.** The engine starts at login, before `/Volumes/Production` is mounted; the watcher
  started only on the folders that existed then (none) and looked again only when the editor switched projects. The log showed
  no "exports: watching" line at all since the 10:18 restart. Now the checker keeps running while Show exports is on and starts
  (or stops) watching a folder within ~1.5 s of it appearing (a drive mounted, back from sleep). Test with a real file watcher.
- **An export into a new plan folder waited for Premiere's preferences.** Premiere names the Export tab's folder in its
  preferences only when it gets round to writing them, sometimes after the export ended, and a named file older than them then
  waited another 10 s. Now Asistent learns the office's export tree (a folder whose children held exports of 3 different
  clients: here `Production/Exported Videos`, learned from the recent list) and catches a video written exactly
  `<client>/<plan>/` deep in it through the Mac's file events. Verified on this Mac: a Premiere export (host
  `exportAsMediaDirect`, NEW TEST, 8 s) into a new plan folder of a test tree was shown selected in Finder ~3 s after it ended,
  with Premiere's preferences naming another folder. The tree is never scanned and only file events count: macOS reports only
  this Mac's own writes, so a colleague's export on the shared drive is never shown; no trees on Windows (its share
  notifications include other computers). A whole drive or the home folder is never a tree.
- **Premiere's export events are used when they come.** The panel listens to `EncoderManager.EVENT_RENDER_COMPLETE / _ERROR /
  _CANCEL` and `OperationCompleteEvent.EVENT_EXPORT_MEDIA_COMPLETE` (all present in 26.0.2, probed through the bridge) and tells
  the engine an export ended; with a path it is checked at once, without one the preferences are read again for 30 s and a file
  they name that was written within 60 s before the event counts with no wait. Every event is written to the engine log. Probe
  result: an export started by ExtendScript (`exportAsMediaDirect`) fires none of them; whether the Export tab does is unknown.
- `panel/exportevents.js` (new, node tests), bridge command `export_try` (EncoderManager.exportSequence into a given file).
- Tests: 7 new pytest (drive mounted late, export event with and without a path, preferences written after the event, tree
  learning, tree file events, tree never scanned), 4 node tests; 573 pytest + 166 node pass.

## 0.10.6 - Existing edits protected, correctness, speed, safe updates (the independent audit of 0.10.1)
An outside audit of 0.10.1 listed 24 problems; each was checked against the code (report in the session of 2026-11-08), every
valid one fixed here. "NEW TEST" = checked in Premiere 26.0.2 in NEW TEST.prproj through the test bridge on 2026-11-08.
**Existing edits**
- Subtitles: a caption track counts as Asistent's only when every line still has the time Asistent gave it (count + first/last
  let an edit inside the track pass, and the next press deleted it); records are kept by the sequence's guid, not its name; a
  record from before 0.10.6 is never trusted for removal, only named. NEW TEST: a press replaced its own earlier pair (C23 -> C24),
  the guid key logged. (BUG-001)
- Subtitles: nothing is recorded or removed unless the whole new pair (Bulgarian and English) is placed and checked; an English
  line the host refused or that timed out keeps the earlier pair and says so (it used to remove the earlier English track and
  report success). Mock tests. (BUG-002)
- Subtitles go only onto the sequence they were made from: switched sequence or project during the job -> "moved", nothing
  placed. NEW TEST: switched to "кам2" mid-job, nothing placed, the message named both. (BUG-003)
- Fix audio: a subclip is reused only when it is the same media file and range (a tag of the media path in the name, the path
  and in/out checked); a copy whose channels failed is renamed "… FAILED" and never reused; a half-done split says which copy
  stayed. NEW TEST: a split, and a second split of the same range reused the subclips. (BUG-004)
- Fix audio: a clip with Volume / Channel Volume / Panner keyframes, another effect or a Dynamics with its own settings is not
  split (the copies replace it without them). NEW TEST: overwriteClip DOES drop the original's Volume keyframes (measured), and
  such a clip is now refused with the reason; a plain clip still splits. (BUG-005)
- Colour: "untouched" means the whole Lumetri equals the untouched one Asistent learns when it adds one itself (it meant only the
  five sliders at 0, so a Highlights-only grade got values and became "Asistent's"); ±0.5 records only a new, untouched or own
  Lumetri; Asistent's ownership of a cut piece now needs the same folder + file name (0.10.4 matched the name alone). NEW TEST:
  the untouched snapshot is the same on two clips; a Highlights-only grade got only Exposure, was not recorded, Auto color
  refused it. (BUG-006)
- Colour: a parameter with keyframes is never written, in any Lumetri and by any button, read again just before the write.
  NEW TEST: keyframed Exposure in Asistent's Lumetri left alone. (BUG-007)
- Managed Lumetri records: one lock per file for the whole engine, a unique temporary file, a damaged file kept aside (two
  requests at once lost a record or left invalid JSON, which then counted every grade as unknown). (ARCH-003)
**Correctness**
- Rough cut: a near repeat that differs in a negation („не“), a number (also in words: пет/шест) or a name is "said
  differently" and never cut, in either direction. (BUG-012)
- Cancel: a job cancelled while its last step ignored the request ends "cancelled" and its result is dropped; FFmpeg/FFprobe
  stop on cancel or after a time limit; Shot Match can be cancelled; the panel never applies a result after Cancel. (BUG-014)
- Subtitles: switched-off and muted audio is not recognised; an L/L or R/R copy is heard on its own channel only, and the second
  reading of a piece uses the channels the mix chose. NEW TEST: subtitles from an L/L copy. (BUG-008)
- Rough cut: a switched-off video clip or a video track with its eye off is left out and named. (BUG-009)
- Rough cut: per clip, what of a Lumetri was not carried (settings beyond the five, keyframes). NEW TEST: both notes shown.
  (BUG-010)
- English word fixes taken back are revoked for the client too (they came back from the shared learning). (BUG-013)
- Sync: two cameras whose files share one folder never land on top of each other on one track. (BUG-011)
- Checks: the rough cut checks every piece (file, part of the file, place) and fails on a track the plan did not have; Sync fails
  on extra picture clips. NEW TEST: a rough cut and a Sync passed with no false alarm. (ARCH-004)
- Buttons: only the main mouse button acts, and a press held longer than 1 s no longer acts twice. Node tests; UXP's own event
  order not checked. (UX-001)
**Speed** (measured, identical output)
- FFmpeg's sound is streamed into place: 20 min of 48 kHz stereo peaked at 724 MB instead of 1644 MB, bit-identical (also on
  real FX3 footage), slightly faster; long items are decoded fewer at a time (2 GB budget); the FFT thread setting is per thread.
  `scripts/bench_decode.py`. (PERF-001; pair pruning not done: no criterion proven safe yet)
- Word alignment: up to two aligner processes stay loaded (stopped after 60 s unused) instead of one Python + model per window:
  ~0.9 s per window instead of ~2.1 s, bit-identical. (PERF-002)
**Updates and reliability**
- Host commands: one Premiere did not take in time is withdrawn (it used to run later, after the editor's retry); one already
  taken is said to maybe still finish; waits up to 600 s. (ARCH-001)
- Updates keep the installed version in `<app>/previous` (files, panel package, package list) and put it back when pip, the files,
  the host or the panel fail; the panel is installed over the old one before any removal; an engine that does not start three
  times after an update is put back by `run_engine.py`. Failure tests on a private app folder. (ARCH-002)
- sentencepiece 0.2.1 (CVE-2026-1260 / GHSA-38vq-g6vr-w8wf): same tokens and same English on a test set. (SEC-001)
- Downloads pinned: Whisper and the translator at one commit with SHA-256 checks, the Bulgarian dictionary at one commit with
  SHA-256, CUDA wheels pinned (untried on the PC); hash-locked requirement files for the Mac (`scripts/lock_requirements.py`)
  used by setup and updates. (SEC-002)
- Test bridge: `click` with `now: true` presses while the panel is busy (to test Cancel).

## 0.10.5 - Show exports: Finder within ~2 s, no older file, no downloads
The user's first real export (MASTERHAUS КП-3 Видео 7, 13:53): "it didn't open the folder". The log: Premiere wrote its
preferences when the export started (13:53:40) naming a file that still held the earlier export of the same video, which was
counted at once; the new file was written 13:53:46-13:54:09 and Finder was asked only at ~13:54:19. Earlier, sound effects
downloaded into the project's Assets folder had been "shown" as exports.
- The waits are 1.5 s (size steady) + 1.5 s (queue) instead of 3 + 5, and the folder is looked at every 1.5 s: an MP4 / MOV is
  proven whole by its boxes and FFprobe, so a pause in writing cannot pass for the end.
- A file the preferences name that is older than the preferences waits 10 s: replaced by then (an export starting), only the
  new file counts; unchanged (an export that ended before Premiere wrote them), it is shown.
- The project's own folder is no longer watched (the office never exports there; downloads land there). Watched: Premiere's
  export folder and folders added with "Add export folder…".
- Checked: Show again on that export brought Finder to the front over Premiere with the file selected.

## 0.10.4 - Colour works under a hidden or visible overlay and on cut clips; Fix audio copies keep the clip's label
The user, 2026-11-05 (MASTERHAUS КП-3, C0706): Auto color and White balance said "nothing was touched" while Before / after
showed a change; and after Fix audio a razor cut turned the audio piece green.
- **A hidden track covered every clip.** The safety-margin template sat on V4 with its eye off; the panel counted any clip on
  a higher track as a layer over the picture, so it measured the file, and a file measurement was always "low" and never
  applied. A video track's eye (`isMuted`) is now read: a hidden track or a switched-off clip covers nothing (`moments.covered`).
- **A visible layer no longer blocks the correction.** When a clip under a logo / title / template has no colour effects of its
  own (only Motion, Opacity, Time Remapping and an untouched or Asistent's own Lumetri, `fileShowsClip`), the file shows the
  same picture: the engine keeps the measurement's confidence and the panel writes the values as they are (absolute), replacing
  Asistent's earlier ones. Another effect or a hand grade: still a proposal only, said in the warning.
- **Asistent's own Lumetri on a cut clip.** Ownership was kept per clip piece (media + in/out), so after a cut or trim Match POVs'
  Lumetri (fx31028: Tint −1, Saturation 111) counted as a hand grade and was refused. Now the same snapshot written on any piece of
  the same media file (matched by file name) is Asistent's; any hand change still makes it the editor's (`managed.owned`).
- **Fix audio labels.** The L/R subclips took Premiere's default Audio label (green) while the placed pieces showed the clip's
  colour, so a razor cut made a green piece. The subclips now get the label of the clip they come from (`as_same_label`), and a
  Fix audio press over copies from an earlier press only relabels them (route "label", never split again).
- Not yet pressed in Premiere (the user's client project was open): the video `isMuted` read is logged once as "hidden check".

## 0.10.3 - Show exports: a finished export from the Export tab is shown in Finder
The user, 2026-11-05: "for now just do the export mode" (Media Encoder and Quick Export later). New card "Show exports"
(off by default; on, on the user's Mac): when an export from the Export tab is finished, Finder opens with the file selected
(Explorer on Windows, untested). A queue shows only its last file; the Log tab lists every export with "Show again".
- **Where it looks** (`exports.py`): the office exports into a tree of its own (Production/Exported Videos/<client>/<plan>),
  not next to the project, so the engine reads Premiere's preferences (`ExportSettings.Info.SaveAsFile` OutPath and
  `MZ.Prefs.Export.Media.Path`, the newest Premiere version's file) and watches the folder the Export tab writes to, only the
  files directly in it (a "Към клиент - компресирано" copy made afterwards does not count). When Premiere rewrites its
  preferences, the file they name is checked too if it was written after watching started (an export to a new place). Also
  watched: the project's folder, folders added with "Add export folder…". Paths compared without case or Unicode form.
- **When it is finished** (`settle.py`, now shared with Smart Folder Sync): size and time unchanged for 3 s, the file opens,
  an MP4 / MOV has all its boxes inside the file (Premiere writes ftyp, moov, uuid, mdat; checked on a real 1.26 GB export),
  FFprobe reads a duration. Previews, Auto-Save, Media Cache, temp files and Asistent's own frames never count.
- Not probed in Premiere yet: whether Premiere writes the export under its final name from the start (the checks cover both).
  The UXP / ExtendScript export events (phase 0 of `docs/EXPORT_REVEAL_PLAN.md`) are left for Media Encoder / Quick Export;
  the bridge commands `export_listen` / `export_events` for them are in `devbridge.js`.

## 0.10.2 - Faster subtitles; English words written in English
The user, 2026-11-04: subtitles are slow; and an English word a Bulgarian speaker says should be written in English
(„Бюти сектор“ = "Beauty Sector", „спей се“ = "Space").
- **Speed** (cold runs, nothing cached, measured on the M4 Max): ReShape (72 s of speech in one window, learned fixes)
  256 -> 130 s; Beauty Sector (31 s, two windows) 89 -> 53 s. Where the time went: one Whisper reading at a time inside a
  window, the second opinions one after another (96 s), the sound checks of learned fixes one after another (51 s, ~10 s each),
  the English sentences one after another. Now the second opinions of a window and the sound checks run at the same time, the
  translator takes three sentences at once and loads while Whisper reads, and Whisper runs 3 readings x 4 threads instead of
  5 x 2 (one long window reads 32 % faster; the thread count does not change the words). The subtitles are byte-identical
  to before on ReShape (Bulgarian and English SRT); only the order of the learned-fix list in the report changed (now sorted).
- **English words in English** (`english.py`, a writing rule after the aligner, listed in the edits as `english`): a Cyrillic
  word that is not Bulgarian, not a Bulgarian word with its ending swallowed, 4+ letters, and the usual Cyrillic spelling of a
  common English word is written in English („уоркшоп“ -> workshop, „имейл“ -> email, „окей“ -> okay), and the English words
  right after it too („бюти сектор“ -> Beauty Sector, capitals for a name of two or more words); „спей се“ (Whisper splitting
  a final s) -> Space. A Latin name in the names box is written exactly as given. Bulgarian loans spelled the Bulgarian way
  stay („дискомфорт“, „маркетинг“, „фитнес“). The data: `models/english_bg.json.gz` (381 KB, from CMUdict, BSD, see
  LICENSES.md; `scripts/build_english_index.py`). On all 16 earlier runs on this Mac (1345 words) it changed only бюти,
  сектор, спей се, уоркшоп. An English name is not split across two lines. The English line improves too ("shop we" ->
  "Space we").

## 0.10.1 - Exposure ±0.5 also works in a Lumetri you set yourself
The user, 2026-11-04 (MASTERHAUS fx31028, a Lumetri with Exposure, Tint and Saturation set by hand: "Nothing changed"):
Exposure −0.5 / +0.5 now move Exposure in the editor's own Lumetri too. Only Exposure changes; Tint, Saturation and every other
slider stay as they were. That Lumetri is not recorded as Asistent's, so Auto color, White balance, Exposure and Match POVs
still never touch it. A keyframed Exposure is left alone (said in the details). Only these two buttons; one Cmd/Ctrl+Z undoes
a press. 0.10.0's selection fix is confirmed in the log of that press ("1 selected parts: V1 fx31028.MP4").

## 0.10.0 - A selected clip no longer selects the clips with the same cut on other tracks
The user, 2026-11-04 (MASTERHAUS, two POVs after Sync): Auto color on the POV on V1, with the POV on V2 switched off, corrected
the V2 clip instead. The panel matched Premiere's selection to the timeline clips by kind, start and end only; after Sync every
cut lines up on all tracks, so the V1 clip also selected the V2 clip at the same place (the log: "1 in the list, 2 selected
parts"), and an audio clip on A1 also selected A2 and A3. Every tool reads the selection this way (colour, Match POVs, Fix
audio, the audio splits, Subtitles, Rough cut, Sync), so all of them could take clips that were not selected. The selection is
now matched by track, name and time (`getTrackIndex`; without it by name and time, and the log says so); the log also marks
how each part was found and which are switched off. Colour (Auto color, White balance, Exposure, ±0.5, Match POVs) leaves a
switched-off clip alone and says so when it was the only one selected. Tests: `tests/selection.test.js` (fails on 0.9.99).

## 0.9.99 - Colour applies on the first click
The user, 2026-11-04: the apply buttons are not needed. Auto color, White balance and Exposure now measure and put the
correction into Lumetri in one press (high- and medium-confidence corrections; low confidence is still left alone), then the
frame check takes back what made the picture worse, and Before / after shows the change. Match POVs matches at once too; a
camera's button under the result matches to that camera instead. One Cmd/Ctrl+Z undoes a press, as before.

## 0.9.98 - Every spoken word kept, no scraps, closer English, word fixes learned, search on Enter
The user's review of 0.9.97 on the ReShape video (2026-11-04).
- A missing word after a cut: the media between the clips (retakes the editor cut out) was heard too, and the aligner put the
  clip's own „Затова“ on a retake 1.5 s earlier, outside the clip. That media is now silence for Whisper and the aligner (the
  context before the first and after the last clip stays: silencing it too lost „Когато“). On the ReShape video the only
  change is „Затова“ back; the first run of a recording reads it again (about 2 minutes), then the cache serves it.
- A scrap at a clip's edge that was not heard clearly (the final „На“, the start of a sentence the cut left out) is left out of
  the lines and listed for review, not shown.
- An adverb stays with its participle or adjective („Те са / патологично променени“, „просто наднормено тегло“).
- English: every line is also translated on its own, and its words pull the English cut ("the fat cells / aren't just bigger",
  "They're / pathologically altered", "Fluid retention / further increases"); plain words for the viewer ("adipose" -> "fat");
  the words an editor changes in an English line are learned for the client from the first fix ("lipidemia" -> "lipedema"),
  typing the old word back takes the fix out. About 17 s for the ReShape video's English (was 11). Tried and dropped: choosing
  among the translator's other sentences by the lines' own words (made other sentences worse), a stronger pull (3-4).
- The search in the Captions tab runs on Enter or Find, with Clear: filtering while typing hid most lines at the third
  letter, after which Premiere took the keyboard and the next keys went to the timeline.

## 0.9.97 - A new pair replaces the old one, lines wait for the cut, phrases stay whole, a better translator, search
The user's requests after the first learning test (2026-11-04).
- Apply and rebuild (and Subtitles pressed again) replaces Asistent's own earlier pair: after the new pair is placed, every line
  of the earlier Bulgarian and English tracks is removed in one step (one Undo). Only tracks Asistent placed and nobody changed
  (the remembered signature, read again just before); the emptied tracks stay, since no script can delete a caption track
  (right-click > Delete Track). The one exception to "never remove": tested in NEW TEST with the user's OK, 13 tracks of 60
  lines removed while ExtendScript ran the whole time, then the panel's own placement three times in a row, no crash.
- A line no longer appears before the cut it belongs to: the ReShape lead (0.18 s) showed the first line after a cut over the
  end of the previous shot and took the previous line off early (up to 0.17 s on the ReShape video). Every clip start is a cut.
- Lines keep phrases whole: an adjective stays with its noun („хронично заболяване“, „мастните клетки“, „съединителната
  тъкан“; found with the dictionary, `agreement.bond`), a line may end on „е“ when the next one holds such a pair („Това е /
  хронично заболяване“), „може да“ stays together; the ReShape style allows 25 characters (their own longest line), so
  „Задържането на течности“ is one line. On the ReShape video 8 cuts changed, all better; 12 Ludi Glavi runs unchanged.
- The English line uses NLLB-200 1.3B (about 1.4 GB, the user's OK): „просто с отслабване“ is "by just losing weight" (600M:
  "just by weakening"), „мастните клетки не са просто по-големи“ "the fat cells aren't just bigger" (600M had the meaning
  wrong). About twice the time (11 s for the ReShape video). A computer with only the 600M model keeps it until the bigger one
  is downloaded from the same button. An English line no longer ends on "not", "may", "does", "just" and the like. Tried and
  dropped: the previous sentence as context (both models often returned nothing).
- Captions tab: a search box over the lines, Bulgarian and English; the other lines are hidden, not dropped.

## 0.9.96 - Who speaks per track, agreement marks, the Learned list, measuring (the plan's phases 5-8)
- Captions tab, "Who speaks": per microphone track a man, a woman, or not set / both (per project, and the client's default
  for its next projects through the learning folder). First-person forms on a set track follow that person („съм свършил“
  -> „съм свършила“, „бях доволна“ -> „бях доволен“, also „Казала съм“), unless Whisper finds the changed word clearly worse
  for the sound (then it stays and is listed for review). Not set: only checked, as before. Tried on the Ludi Glavi
  recording: woman -> „свършила“ (score -4.5), man -> unchanged. A change here alone is enough for Apply and rebuild.
- An adjective that disagrees with the noun after it („нов стена“, „нова телефон“) is marked (yellow edge, review reason),
  never changed: an ending is one letter of sound, which the sound check cannot hear (Phase 0). Count forms, plurals in
  -ове, adverbs, participles and pronoun-like words are left out; on 19 saved runs no false mark is left.
- The Learned list under the caption lines (collapsed): every learned fix of the client, in use / waiting / removed, with
  Remove and Restore for everyone (an event that always counts after what the editor saw).
- Every use of a learned fix is recorded (once per project); `scripts/measure_learning.py report` shows uses against the
  ones typed back (target 98 %), `dry` what the rules would do to saved runs.

## 0.9.95 - Subtitles learn from the editors' fixes, shared through the office; Bulgarian writing rules
The Smart Subtitle Correction plan (2026-11-04), phases 0-4; the user's choices: learning runs in the background with nothing to
press, every editor's fixes help everyone through the office (no cloud), the office folder
`Production/ReShape/ReShape Subtitle Learning`.
- `learning.py`: every correction line that matched in a run (typed in the Captions tab or the corrections box), every name line
  and every typed English line is recorded once per project, with the words around it, into the client's learning folder (a
  folder whose name ends in "Subtitle Learning" inside the client folder, found by walking up from the project; a deep folder
  that Finder mounted as its own volume is traced back through `mount`). Each computer writes its own file; a failed write
  waits in an outbox. The next videos use what was learned: a name for the whole client from the first fix (and in Whisper's
  prompt), a word fix on the same computer at once and for everyone after two projects, other clients after three projects by
  two computers; a single dictionary word only between the words it was fixed between. Typing the original back undoes a
  learned fix for everyone and is never learned the other way round. The editor's own English lines are reused for the same
  Bulgarian line in the client's other projects.
- `audiocheck.py` + `asr.score_texts`: before a learned fix is used, Whisper reads the heard and the fixed words over the same
  sound; a fix scoring more than 8 lower is not used (it catches a different word, not a near-miss: measured on 26 fixes and
  the first real run, see the module). Results are kept per reading, so a rebuild does not check again.
- `bgnorm.py`: Bulgarian writing rules applied without asking (only how a said word is written): „не знам“ apart, „по-“/„най-“
  joined (also Whisper's own „по -пълни“), full or short article of masculine words by their place (after a preposition,
  sentence subject, after „това е“). The editor's fixed words are never touched. They run before the corrections, so a
  correction can be written from what the captions show.
- Fixed: a correction line written from the captions did not match when the dictionary had several repairs for the heard word
  (the ReShape run showed „месната“ for „масната“; „месната => мастната“ matched nothing). Every possible repair matches now.
- Tried end to end on the ReShape „Липедемата“ recording with a temporary learning folder: four fixes typed in one project
  (мастните, мастна, мастната, компрометира) were all used in a second project, scores -2.7 … -6.9; 25 s instead of 11 s.

## 0.9.94 - English lines in the Captions tab; tooltips never under a text box
- The user, 2026-11-04 (screenshots): "there is only a captions tab for the Bulgarian subtitles". With the English line on, every
  Bulgarian line in the Captions tab now has its English line under it ("EN"), editable. Apply and rebuild keeps a typed English
  line for its Bulgarian line as it reads after the rebuild (`english_fixed`, per project on this computer, sent with every run;
  the engine uses it wherever that Bulgarian line is unchanged; a changed Bulgarian line gets a new translation). Only English
  changed is enough to rebuild. Tried on the client reference 7698708: the typed line replaced the translation, all others same.
- The user: "the info is displayed weirdly on top of the captions". Text boxes are drawn by Premiere over everything, so the
  tooltip of "Apply and rebuild" sat under the caption lines. A tooltip that would cover a text box or dropdown now goes above
  its button.

## 0.9.93 - Every button acts on the press
- The user's screen recording 2026-11-04 10:26 (clicking the Tools / Log / Before-after tabs): clicks that did nothing were made
  with an arrow cursor instead of the hand, at any spot of a tab; the log has no click for them. As with Exposure ±0.5 (0.9.91,
  every press counted since), the first click after one of Premiere's own panels had the focus only took the focus back. Now
  every button, tab, link and Cancel acts when the mouse button goes down (`onTap`: pointerdown / mousedown / click, whichever
  comes first, once per press); the "panel just changed" guard stays for the normal buttons, Exposure ±0.5 and Cancel skip it.
  `onPress` is folded into `onTap`. The native dropdowns and checkboxes are Premiere's and unchanged.
- The toast moved from under the header (it covered the tabs for 3.5 s after every answer, and a tab clicked then hit the
  toast) to over the project name and engine line, which have nothing to click.

## 0.9.92 - A toast that reads as a message
- The user, 2026-11-04: "Where is the pop up message?" It was there (the screen recording shows it under the header), but in
  Premiere 26.0.2 the one-sided green border did not render, so it was a plain black bar that looked like part of the panel.
  Now it has a green face (red for a failure), bold 12 px text, and for Exposure ±0.5 plain words: "+0.5 exposure added ·
  fx31028.MP4 now +1.5" / "0.5 exposure removed · 3 clips" (`finish(..., { toast })`).

## 0.9.91 - Exposure ±0.5 act on the press
- The user's screen recording (2026-11-04 10:19, Masterhaus fx31028) next to the log: Effect Controls stayed at 0.0 and at 1.0
  for seconds while the user clicked, and no click reached the panel in that time (no "click" line at all); two quick clicks did.
  After each write Premiere puts the focus on its own panels, and the next click on Asistent only takes it back. So the Exposure
  buttons now act when the mouse button goes down (`onPress`: pointerdown / mousedown / click, whichever comes first, once per
  press; a click within 1 s of its own press is not counted again). The panel logs "focus lost" / "focus back", so the next try
  shows what Premiere delivers.
- The morning's three "Exposure 0 → -0.5" presses in a row (10:18:54-10:19:02) read 0 each time: the value read right after
  a write can be stale. Not changed yet: if it shows again with presses that do arrive, the step will be counted from the value
  Asistent last wrote.

## 0.9.90 - The answer as a toast
- The user, 2026-11-04: "a little pop up message when something is added or removed, somewhere visible but not taking much space,
  so we don't have to look at the bottom". Every answer (`finish()`) now also shows for 3.5 s (a failure 7 s) as a toast under the
  header, over the list, two lines at most, with a green or red edge; a click hides it. It floats (absolute, like the tooltips),
  so no button moves; the full answer stays at the bottom and in Log. Seen in the browser preview; not yet in Premiere.

## 0.9.89 - Exposure ±0.5 react to every click
- The user, 2026-11-04: "I have to click the +0,5 buttons multiple times before they work". The log (Masterhaus C0728, 10:10)
  shows every recorded press was written, but a quick second click was dropped by the "panel just changed" guard (700 ms after
  each answer; made for answers that used to appear at the top and move the buttons, which no longer happens), and a click during
  a write (~50 ms, panel greyed) was dropped too. Now the two Exposure buttons skip the guard (`onTap(..., { repeat: true })`),
  do not grey the panel, and a press that arrives during a write is added to the next write, so no click is lost. The answer shows
  the clip's new value ("Exposure +0.5 on 1 clip (now +1.5), one Undo step").
- The same log has two presses that started from 0 again (10:10:18, 10:10:32): the Exposure had been put back by Undo between
  them (each press is one Undo step); nothing in Asistent resets it.

## 0.9.88 - Exposure −0.5 / +0.5
- **Two buttons in the Color card** (the user, 2026-11-04: a robot video with no faces was underexposed and Exposure "didn't
  really do much"): Exposure −0.5 and Exposure +0.5 add that step to the Exposure slider of every selected clip at once, as an
  editor types it into Lumetri: no measuring, so they work without faces. Same Lumetri choice as Apply (a new one, a neutral
  one or Asistent's own; a hand grade is never touched, the clip is listed as not touched), recorded as Asistent's so Auto color
  can update it later. One Undo step (two when a Lumetri is added first). The answer lists each clip "Exposure +1.05 → +1.55".
- Why Exposure did little on those clips (log of 2026-11-03 18:04-18:07, RoboHubPro "Сервизен робот"): the first press proposed
  and applied +0.5 to +2 on most clips; fx30-2-1284 measured 0 (no faces: by the midtones), and the later presses read 0 because
  they measure the timeline with the earlier correction in it. The midtone estimate is a guess without faces; the buttons are
  the editor's way to finish it.
- Engine 424, panel 116 tests passing. Not pressed in Premiere yet (Premiere was closed).

## 0.9.87 - Updates from the panel; Windows install brought up to date
- **Updater** (the user, 2026-11-04: "install an updater so people don't need to download from GitHub every update"):
  `engine/asistent/updater.py` asks the GitHub releases for `latest.json` when the panel opens and every few hours (at most every
  6 h, only a GET to github.com). A newer version shows a line at the top of the panel with an **Update** button; the job
  downloads `Asistent-<version>.zip`, checks its SHA-256, refuses unsafe zip paths, installs Python packages only for a changed
  requirements file, puts the engine, host, fonts and panel in place and restarts the engine (Mac: the LaunchAgent restarts it
  after exit 75; Windows: a detached new engine waits for the port). The panel reloads during the update and the new one says
  "Updated to …" (`updates/last.json`, shown once). Tried end to end on this Mac with a local test release 0.9.88
  (`<app>/update_source.txt`): engine back on 0.9.88 within a second, Adobe lists the panel 0.9.88, then reinstalled 0.9.87.
- **Installed layout**: the engine now runs from `<app>/current` (a copy), no longer from the repo, so a computer needs only a
  release zip. `engine/asistent/install.py` does the placing for both systems: files, the host into the CEP folder (Mac
  `defaults`, Windows registry for PlayerDebugMode), Montserrat Bold into the user's fonts (Windows: per-user font + registry), the
  panel through UnifiedPluginInstallerAgent (`--install` on Mac, `/install` on Windows). `scripts/install_host_mac.sh` is gone.
- **Releases**: `scripts/build_release.py` makes `dist/Asistent-<version>.zip` (engine, host, scripts, fonts, requirements, licences,
  README, `.ccx`, `Install Asistent (Mac).command`, `Install Asistent (Windows).cmd` at the top) and `dist/latest.json`;
  `scripts/publish_release.sh` uploads them as release `v<version>` (only on the user's word, after commit and push).
- **Windows**: `setup_win.ps1` now matches the Mac: installs from the folder it is in, keeps the subtitle packages current where
  they exist, downloads the Bulgarian word list with `-Subtitles`, stops a running engine before replacing files, installs host,
  font and panel, Startup shortcut to `current\engine`. The host's log goes to `%LOCALAPPDATA%\Asistent\logs` like the engine's.
  Not run on Windows yet (no PowerShell on this Mac).
- **Translator download button** in the Subtitles card (about 620 MB, NLLB-200, only from the button, like the speech model),
  shown when English line is on and the translator is missing; `/subtitles/model` reports `translator`.
- Tests: `tests/test_updater.py` (12: version compare, offline check, damaged download refused, unsafe paths, the whole update
  into a private folder, requirement changes, the release zip's contents). Engine 424, panel 115, all passing.

## 0.9.86 - The ReShape style, measured on the client's own videos
- **Measured** (the user, 2026-11-04: "we need to recreate this style for this client"): six of the client's TikTok videos and the
  Instagram reference, 625 lines, read with the Mac's own text recognition (Apple Vision), faces with YuNet, speech with Asistent's
  own recognition (its word starts are 0.025 s after the sound onset, so usable as truth). Results in `docs/SUBTITLE_STYLE.md`:
  2-3 words a line, no punctuation, a capital only at a sentence start, each line 0.18 s before its first word with a ~4-frame
  fade-in; the height is kept per shot (79 of 90 changes at a cut) with the line's top 0.11 of the frame height under the chin.
- **Subtitles card: Style** Auto / ReShape (remembered on this computer). ReShape = preset `reshape` in `subtitles.py`: 2-3 words,
  no punctuation around words (inside stays: "360-градусово", "1,5"), lines start 0.18 s early even in continuous speech. With the
  English line on, the English gets no punctuation either, except a question's "?" (`translate.bare`); the translation now reads
  the words with their punctuation, so sentences are still found.
- **"ли" never starts a line, a short pronoun may end one after its noun or verb** (all styles): "и прави ли / такива операции",
  "бюста ви" (before: "и прави / ли такива операции"); after a function word it still goes with the verb ("ще ви покажа").
- Against the client's own line breaks: 72 % of Asistent's breaks are theirs and 70 % of theirs are Asistent's (71 / 69 % before);
  their remaining breaks follow the speaker's rhythm and 7.5 % end on "на", "да", "и", which Asistent never does on purpose.
  Engine tests 412, panel 115, all passing. Not pressed in Premiere yet.

## 0.9.82-0.9.85 - The English line (reference style); probes for the subtitle graphics
- **English line** (the user, 2026-11-04: the same number of lines and the same times as the Bulgarian, translating the same words
  and still making sense): `engine/asistent/translate.py` translates every Bulgarian sentence whole with the local NLLB-200 600M
  (int8, one sentence per call) and cuts the English into one piece per Bulgarian line: the model's attention (offset 0), a cut at
  matching punctuation, a length rule (each piece about as long as its line suggests) and no piece ending on "the", "of", "in"…
  (attention alone gave lone "the" / "an" lines). The subtitle job writes `<name>.en.srt` with the same times; the panel puts it on
  a second caption track. Subtitles card: checkbox "English line" (remembered on this computer). Without the translator the result
  says what is missing.
- Tried on the ReShape reference (68 s): 69 Bulgarian and 69 English lines, identical times, translation in 5.7 s; e.g. "Защо 360
  липосукцията / и оформяне / на цялата средна / част на тялото" -> "Why is 360 liposuction / and the shaping / of the entire middle /
  part of the body". Some pieces still lag by a word; wrong Bulgarian carries over ("везя" -> "weight"): correct the Bulgarian first.
  Both tracks placed in NEW TEST through the engine (69 + 69 items).
- The English style from the user's tool: Arial Pro Heavy, white, sentence case, 56 % height, box #551D1D at 63 % (docs/SUBTITLE_STYLE.md).
- Bridge probes (test projects only): `graphic_text` (UXP cannot read or write a Premiere text graphic's text), `graphic_move`
  (Motion > Position with `new PointF(x, y)` in one Undo step works).
- Tests: `tests/test_translate.py` (split rules; the real model when installed).

## 0.9.81 - Subtitles back on a caption track: restyle them all at once in Properties
- The user needs to select all subtitles and change font, outline, shadow and the rest in Premiere's Properties panel. Only Premiere's own captions and text graphics are edited together there; Asistent's After Effects template graphics (0.9.80) expose only their text, and Premiere's own text graphics cannot be created with words by a script (probed: ExtendScript reads their text as binary, there is no `executeCommand` for "Upgrade Caption to Graphic", and UXP has only `CaptionTrack`/`TextSegments`). So Subtitles puts a caption track again (as up to 0.9.79); the result tells how to restyle all captions and save a Track Style, and right-click > Upgrade Caption to Graphic turns them into real text graphics by hand.
- The graphics way stays as tested code, not used by the panel: `premiere-captions.placeGraphics`, engine `/captions/graphics`, host `as_graphics`, `scripts/caption_template.*`.
- Checked in NEW TEST: an SRT of 25 lines through the engine onto a caption track (subtitle format), read back with 25 items.

## 0.9.80 - Subtitles as text graphics (the user's choice 2026-11-04: text graphics, static lines)
- Every subtitle line is now an editable text graphic on a new video track "Asistent subtitles" at the top of the active sequence, instead of a caption track; the .srt is still written (folder Asistent_subtitles) and the Captions tab works as before (Apply and rebuild puts a new graphics track; delete the old one).
- **Template**: `scripts/caption_template.jsx` + `.sh` build Asistent's own subtitle templates in After Effects (a new empty project; refuses when After Effects has unsaved work): "Asistent Subtitle 9x16" (1080x1920, 74 px) and "Asistent Subtitle 16x9" (1920x1080, 58 px), Visuelt Pro Bold, white with a black outline, centred, lower part of the frame; one exposed field "Text". Built on first use by the engine (about a minute) into `<app>/templates`. Premiere's own templates cannot be used: their text reads back as binary through scripts (probed).
- **Placing** (`host.jsx` `as_graphics`, engine `POST /captions/graphics`, panel `premiere-captions.place`): a new top video track (QE `addTracks`), one `importMGT` per line at its start, trimmed to its end, the words written into "Text" (line breaks as After Effects wants them), scaled to the sequence (the template has its own size: 200 % in a 2160x3840 sequence). The template is picked by the subtitle preset (9:16 short lines, 16:9 two lines).
- **Tried in NEW TEST** (25 lines of an earlier run, through the engine endpoint): placed in 2.0 s (80 ms a line), all 25 read back with the same words and times within a frame. The Subtitles button itself was not pressed (the bridge cannot select clips in that sequence): user to try.
- Undo: each line is its own step in Premiere (ExtendScript has no transactions): the result says to delete the track instead.

## 0.9.74-0.9.79 - Speed finished and measured in Premiere; NEW TEST is a test project; bridge can select clips
- **NEW TEST.prproj** (Ludi Glavi/Projects) is a test project too (the user, 2026-11-04: use it for future tests, Claude may run them): the panel bridge and the host's `eval` accept `TEST.prproj` and `NEW TEST.prproj`, nothing else (test: a name that only ends in TEST is refused).
- **Colour frames from the file** (`color.read_frames`): the frames of a clip are decoded side by side and the colour-range probe is asked once per file. 15 Masterhaus clips 24.6 -> 19.7 s, the full result (previews included) identical to the HEAD code; more clip workers do not help (4K decoding fills the CPU), so 4 stay.
- **Skipped exports**: inside a batch a frame is waited for 5 s, then exported once more on its own (normal wait), instead of holding the batch for 20 s.
- **Measured in NEW TEST (24 clips, by the bridge)**: Auto color 23 s for the whole press (96 frames in ~12 s, one skipped export retried at once, engine 7.2 s; before: ~1.3 s of frames per clip, ~31 s for frames alone), Sync cameras 6.7 s in the engine (your last press on the same 24 clips: 11.2 s; same 10 groups, 4 unsynced).
- **Bridge `select` works** (Premiere 26.0.2): `TrackItemSelection.createEmptySelection(callback)` hands the selection to the callback, it is filled and set there, and `setSelection`'s promise is ignored (it rejects with "A nullptr was dereferenced" even when the clips were selected): the timeline read back is the answer. Video or audio alone worked three times in the first sequence; video and audio together did not, and after that attempt even video selected nothing in the SYNC sequence (open: TODO).

## 0.9.73 - Faster with many clips (user's request 2026-11-03)
Measured on the user's own presses and the Masterhaus/Ludi Glavi test footage; every change gives bit-identical results (compared against the HEAD code on real footage).
- **Sync cameras** (`sync.py`): each signal's FFT is computed once and reused for every channel pair (coarse search and window checks), and a window measured in the quick look is not measured again. 24 clips / 120 pairs: 10.2 -> 7.5 s (one thread 29 -> 18 s); the full result is byte-identical.
- **Probe cache** (`media.probe`): FFprobe answers kept by path, size and modification time for the engine's life; `media.probe_all` probes a job's files side by side.
- **Rough cut**: the dialogue items are decoded side by side (`dialoguemix.build_mix`, also used by Subtitles) and every file is probed up front. 38-item rough cut replay: 12.1 -> 2.8 s; cuts, takes and XML identical.
- **Color**: the analysis frames of all clips, and Apply's before/after/re-check frames, are queued in Premiere together and waited for together (`premiere-color.js` `exportFrames`, batches of 16; nothing on the timeline changes between them; the Lumetri probe still waits for each). Tried in TEST.prproj on 36 clips: 84 frames, all distinct and correct, but 3 were never written by Premiere and each held its batch for the 20 s wait (press 86 s, engine 39 s).

## 0.9.71-0.9.72 - Asistent draws its own buttons; the CSS probe measured in Premiere
- **CSS probe in Premiere 26.0.2 (TEST.prproj, 2026-11-03)**, after waiting for the layout (UXP lays a new element out a moment later; read at once every size was 0): works: flexbox, absolute position, variables, `calc`, `transform`, text ellipsis, width media queries, inline SVG, `:not`, `cursor`. Does not work: flex `gap`, grid, transitions, animations, `:focus-visible`, `matchMedia`; Premiere's `--uxp-host-*` colour variables are not defined (the panel always ran on its fallback colours). `<header>`/`<footer>` default to a centred flex row. An SVG outline comes only from CSS (a class or `style`), never from the `stroke` attribute. A `<button>` takes the panel's background in its style but Premiere draws its own grey face over it (36 px tall by default). Spectrum's built-in widgets (`sp-button`, `sp-picker`, …) exist.
- **Own buttons** (the user's choice of three, 2026-11-03): every button is a `div.btn` drawn by Asistent with the panel's colours (blue main buttons, quiet tabs and links, ⓘ). `enable()` sets `disabled` (read by `onTap`, which now ignores a press on a disabled button, and by the test bridge) and the `disabled` attribute (dims it). The bridge presses `button, .btn` (checked in TEST.prproj: Log and Tools pressed and logged). Ids, labels and tooltips unchanged.
- **Icons**: their lines come from one CSS rule (`svg.i …`), no attributes on the shapes.

## 0.9.69-0.9.70 - The new look fixed after the first look in Premiere (user's screenshot 2026-11-03)
- The top and bottom areas, the tabs and the status boxes are plain `div`s with their own direction: UXP had laid out `<header>`/`<footer>` as centred rows (the answer sat at the bottom right, the project line in the middle).
- Icons: every shape carries its own outline style (UXP does not pass `fill`/`stroke` from `<svg>` to its shapes, so they came out as filled dots and discs).
- Rough cut: Mode and Tempo each on their own row; "Safe" is marked selected (UXP showed an empty Mode box).
- The main buttons have no border: Premiere draws its own grey face for a `<button>` and the blue border stood outside its corners.
- `css_probe` also measures the default layout of each element, whether a button takes a background colour, how icons inherit their style, and a dropdown without a selection.

## 0.9.68 - A new look for the panel (user's request 2026-11-03: clean, compact, every feature kept)
- **Layout**: the project name and the connection stay at the top, the views scroll, and the progress (with Cancel) and the answer of the last run sit at the bottom. The answer no longer pushes the buttons down; **Hide** frees its space (it stays in Log). The header says `Connected · 0.9.68`, both versions only when the panel and the engine differ.
- **Feature cards**: icon, name and an ⓘ button per card. The description paragraph is behind the ⓘ (the same text, also in the tooltips), so the main controls are what you see: Sync, Rough cut (Mode, Tempo, Review markers), Audio (Manual ▸), Color (White balance, Exposure, Match POVs), Subtitles (corrections box, model download), Auto import. Whether an ⓘ is open is remembered on this computer. The whole Tools list is about 1,000 px tall at 300 px wide instead of about 2,400 px.
- **Developer**: the Lumetri probe moved from COLOR into a closed "Developer" card at the bottom (the user approved). Nothing was removed, renamed or merged; every button keeps its id, label and tooltip, and every press still goes through `onTap`.
- **Style**: every colour is a named token with its old value (`style.css` `:root`, checked pixel-identical before the layout changed); one button system (primary, secondary, quiet, link) with hover, press and disabled states; titles in sentence case instead of small capitals; option rows wrap at 240 px. Only CSS the panel already used in Premiere (flexbox, margins, borders, radius, opacity, absolute position, variables): no `gap`, grid, transitions, transforms or shadows.
- **Icons**: inline SVG (paths drawn after Lucide, ISC licence, no package). Whether UXP draws inline SVG is not yet measured: if not, the cards show an empty 16 px slot and PNG icons replace them.
- **CSS probe** (`panel/cssprobe.js`, `dev_cmd.py css_probe`, TEST.prproj only): measures on temporary elements which CSS this UXP really supports (flex gap, grid, transitions, transforms, shadows, inline SVG, media queries, Premiere's theme variables). Checked in Chrome; not yet run in Premiere.
- **Browser preview** (`preview/`, development only, never packed): the real panel markup, style and code with fake Premiere and engine modules and ten states (idle, offline, busy, done, error, log, color proposal, before/after, captions, options open); `node preview/shoot.js <label> --compare <earlier>` takes screenshots at 240/300/420 px with the Chrome on this computer (`playwright-core` 1.55.0, dev only) and reports the pixels that changed. `main.js` hands its view functions to the preview only when the preview page asks (never inside Premiere).
- Tests: 398 engine, 113 panel (the AUDIO block in `wiring.test.js` is found by its card id now).

## 0.9.67 - Subtitles: a caption editor; rough cut: muted audio is not used; rotated files described upright
- **Captions tab (SUBTITLES)**: after a subtitles run a hidden tab "Captions" appears with one field per line (time + text; lines holding an uncertain word have a yellow edge, edited lines a blue edge). Type a wrong word right and press **Apply and rebuild**: `panel/captionedit.js` turns each edit into the editor's correction lines (`heard => said`; the smallest changed stretch, anchored on a neighbouring word when a word was only added or removed or the changed word is 3 letters or less, two changes with one short word between are one phrase), adds them to the corrections box (saved per project, same line for the same heard words is replaced), and the job runs again: the recognised speech is cached, so it takes seconds, the new words are timed by the sound (forced alignment, as before) and the new set is placed on a NEW caption track (`place(..., {again: true})`); the result says to delete the old track (Asistent never removes anything). Matching ignores case and punctuation and also accepts the spelling shown in the captions.
- Why an editor and not a better recognition: tried on the 23 s GStroy clip (loudness normalisation, 90 Hz high-pass, beam 8): Whisper's wording changes at random with tiny audio changes ("Приведно", "Примерно", "Природа", "Прилно") and none of them fixed "трябваше да боядисам"; the three-reading vote already in place is the right tool, and a Bulgarian fine-tune (public ones are trained on read speech and are not in CTranslate2 format) would be a 3 GB download that needs the user's OK. Not changed.
- **Rough cut: muted audio is not used**: audio on a muted track (`track.isMuted()`) or a switched-off clip (`isDisabled()`) is left out of the cut and of the speech, as if deleted (the quiet camera microphone that left gaps); the result says it once per track. The panel logs once whether those two Premiere methods exist (unverified in 26.0.2; if they are missing the old behaviour stays and the workaround is to deselect or delete the track).
- **Rough cut: rotated files**: `media.MediaInfo.rotation` (the display-matrix flag, 90/270) and `xmeml` describes such a file by its displayed size (2160x3840 instead of 3840x2160). An unverified attempt at the sideways bug: if the picture still comes in sideways, the probe XMLs decide (TODO).
- Tests: 398 engine, 113 panel.

## 0.9.66 - The whole tool is in English (user's request 2026-11-03)
Every user-facing text is English now: the panel (buttons, tooltips, section titles, progress, results, errors), the engine's messages and reasons, the host's messages, the Undo step names, the script output and the README (rewritten and brought up to date: Fix audio with L/L and R/R copies and the limiter, the color buttons, Match POVs, Rough cut, Subtitles). What Asistent creates in Premiere has English names: the bin "Rough cut", sequences "ROUGH – <sequence> (safe|smart) vN", markers "Review", the subtitle bin "Subtitles", the test bin "Asistent test". Nothing made earlier depends on an old name (the L/R bin was already "Asistent L-R"), so older projects keep working.
- Button names: Синхронизирай камерите → Sync cameras · Груб монтаж → Rough cut (Внимателно/Умно → Safe/Smart, Спокойно/Нормално/Стегнато → Calm/Normal/Tight, Маркери за прегледа → Review markers) · Оправи звука → Fix audio (Ръчно → Manual: Split L/R, Split R/L, L only, R only, Level only, Even out phrases) · Авто цвят → Auto color, Бяло → White balance, Експозиция → Exposure, Изравни POV-тата → Match POVs, Приложи сигурните / и средните → Apply the sure ones / the medium ones too, Приложи изравняването → Apply the match · Субтитри (български) → Subtitles (Bulgarian), Свали модела → Download the model · Следи Downloads → Watch Downloads · Инструменти / Дневник / Преди / след / Отказ / Подробности → Tools / Log / Before / after / Cancel / Details.
- Unchanged on purpose: the Bulgarian language data of the subtitles and the take finder (spelling, dictionary, numbers, filler words, month and money words) and the importer's Bulgarian folder keywords ("музика", "ефекти"); the example in the corrections box stays Bulgarian because the subtitles are Bulgarian.
- Result fields renamed with the texts: `kind_bg` → `kind_label` (takes), `tempo_bg` → `tempo_label`; the colour check no longer sends `clipping_message_bg` (the panel shows `clipping_message`).
- Fixed on the way: the Match POVs confidence read the anchor from the basis text; "the white/grey surfaces" contains "face", so it now matches whole words.
- `scripts/setup_win.ps1` is plain ASCII now (Windows PowerShell 5.1 reads non-ASCII scripts wrongly without a BOM).
- Tests: 396 engine, 102 panel, assertions moved to the English texts. Not yet seen in Premiere.

## 0.9.65 - ГРУБ МОНТАЖ: repeated takes are cut, the last full take stays (user's test 2026-11-03)
The user's test of 0.9.64: three clips with the same line said slightly differently, "it kept all 3". The run file showed the group was found (three takes, the last recommended) but 0.9.64 only listed it, and marked it as "said differently" because of one extra sentence.
- **Cut, in both modes**: for a plain repeat everything from the first take up to the winning take goes in one piece when only short setup talk is said between the takes (sentences of at most 8 words, at most 25 s: „Добре, готови?“, „Тихо“); otherwise each losing take goes alone; a take that broke off after the winner goes too. The cut starts at the breath or rustle before the first take (never before the previous word) and stops 0.15 s before the winner's first sound (`pauses.take_edges`, `pauses.with_takes`). A start repeated inside a sentence is cut only in Умно. A group said differently (a number, or more content words than max(2, a quarter of the winner's)) is only listed, as before.
- **Better takes**: a take that begins in the middle of the passage gets its opening back when it was said in other words („Вижте тези чини! Ако са под 700 евро, ги взимаме.“ against „Виж тази чиния. Ако е под 700 евро, да я взимаме.“: loose matching where alike words count as the same word). Words said a little differently („вижте“/„виж“, „тези“/„тази“) are no longer counted as lost content. The ring of links between the end of one take and the start of the next is broken at the longest pause, so the passage keeps its order.
- Replayed on the user's test (9 items, Внимателно/Спокойно): 73.8 s → 12.4 s; kept „Може и още. Отдала е свободно.“ and the last take of the plate scene; the two earlier takes and the setup talk between them (52 s) are gone. The result text says per group which take stayed and how many seconds went.
- Tests: 20 in `test_takes.py`, the job test now checks the losing take is cut and the winner whole. Not yet pressed in Premiere.
- Found, not fixed: vertical footage stored as 3840×2160 with a rotation flag (Sony, `rotation=90`) comes into the new sequence sideways; the XML describes the file as landscape. Probe XMLs are ready, the fix needs TEST.prproj (BUGS.md).

## 0.9.64 - ГРУБ МОНТАЖ: repeated takes and false starts are found and listed (Phase 8 M3, first half)
- New `engine/asistent/takes.py` (difflib on the recognised words, no new download): sentences (end mark, pause over 0.5 s, comma plus pause over 0.25 s); each sentence is compared with the next 12 sentences within 90 s: `exact`, `near` (ratio 0.75, length ratio 0.6-1.6), `false_start` (a short or unfinished start said again within 20 s, or a take that breaks off after a good one) and `restart` (the same 2-4 words twice inside the talk with only a filler or a pause between). Sentences under 3 words are never matched. Matched sentences are grouped and chained into whole passages, so a scene said three times is ONE group with three takes, even when one take has an extra sentence in the middle. The recommended take is the editor's rule (the last full one); a group whose other takes say content words the winner lacks (more than 2, or any number) is marked as different text, not a plain repeat.
- Nothing is cut for a repeat in either mode (the choice of the take and Умно's cutting are M4). The result lists each group: where it lands in the NEW sequence, kind, number of takes, the recommended one and its text; with "Маркери за прегледа" ticked each group also gets a marker. `result.takes`, `counts.takes`, run JSON.
- Run on the real words of the Ludi Glavi test (281 words): the "700 евро" plate scene is found as one group of three takes with the last one recommended; the price line said with 200 and 300 euro is marked as different text.
- Tests: `tests/test_takes.py` (13), a job test, a panel text test. Not yet pressed in Premiere.

## 0.9.63 - ГРУБ МОНТАЖ: fewer cuts, holes in a camera's row (third test, 2026-11-03)
The user's third test (48 items, two POVs, 388 s): "different types of gaps", "very fast cuts for no reason". Read from the run file: no hole in the picture as a whole (the union of the cameras was continuous) but holes of 0.4-2 s in ONE camera's row while the other kept playing, and kept pieces of 0.7-1.3 s between two trims.
- **Jump cuts**: `pauses._no_jump_cuts`: where two cuts leave a kept piece shorter than `MIN_SHOT` = 1.5 s, the smaller pause cut is not made (the pause stays), so the shots join. Внимателно now touches only pauses longer than 2.0 s (Спокойно) / 1.5 s (Нормално) / 1.2 s (Стегнато) (was 1.2 / 0.8 / 0.8) and makes no pause cut under 0.5 s (Умно 0.25 s). Same selection: 45 → 32 cuts, shortest kept piece 0.1 s → 1.57 s.
- **Holes in one camera's row** (`pauses._close_track_holes`): the part of a hole between two clips of one track that no cut takes out is cut from every track when nobody speaks in it. Where somebody does (the last word of the line is spoken on the other camera's microphone after this camera's clip ended: 204.7-205.0 s in the user's run) the hole stays and its seconds are said in the result (`hole_speech_s`). Cutting it would cut speech; that is the user's decision (asked).
- Tests: 25 in `test_roughcut.py`. Not yet pressed in Premiere.

## 0.9.62 - ГРУБ МОНТАЖ: the last 1-2 frame gaps between clips
- Cause (read from the user's run files: holes of 1 and 2 frames between item0→1 and item2→3 on the main track, cut ended at 58.025 s, clip starts at 58.058 s): `pauses.guard` was applied to the whole cut list, including the empty time between two clips. The 10 ms frame that holds the clip's first 8 ms is voiced, so the guard stopped the cut one frame short. The guard now protects only pause cuts (inside `plan`), the empty time and the time with no selected sound are cut exactly to the clip edges.
- Checked on the user's last selection in three modes (Внимателно/Спокойно, Умно/Нормално, Внимателно/Стегнато): no hole under one second on any track. Tests: 23 in `test_roughcut.py`. Not yet pressed in Premiere.

## 0.9.61 - ГРУБ МОНТАЖ: little gaps between clips, chopped clip ends (second test, 2026-11-03)
- **1-2 frame gaps between clips**: the Whisper word padding (0.04 s before a word) reached over the edge of a clip into the empty time before it, and the final guard kept those frames, so the closed gap stopped 1-2 frames short (cut ended at 58.01 s, the clip starts at 58.058 s). Nothing is "word" or "voiced" where no sound clip covers the time any more, and the cuts are put back on the frame grid after the guard.
- **Fast cuts at the end of clips**: the silence after a clip's last word held islands of breath that split it into several cuts with small kept pieces between. The end of a clip is now handled as a stretch of its own: the picture keeps `TAIL_OUT` = 0.8 s after the last word (the user's "let it breathe"), then everything after it goes in ONE cut, islands included (nobody speaks after it). A kept piece of pure pause between two cuts shorter than 0.6 s (was 0.3) is merged. A piece of 15 frames or less (a flash) of an item that goes on elsewhere is dropped (`edl.drop_flashes`): 5 frames of the second camera at the end of its clip were a flash on the timeline; a short piece that nothing longer covers is kept (a short word is a shot).
- Not ours: 1-2 frame holes that the SOURCE sequence already had (the user ran the rough cut on the output of the faulty 0.9.59 run, "ГРУБ – SYNC – ГРУБ – SYNC"). Run it on the original SYNC sequence.
- Tests: 22 in `test_roughcut.py`. Not yet pressed in Premiere.

## 0.9.60 - ГРУБ МОНТАЖ: the user's first test (2026-11-03) fixed
Four findings from pressing the button on the user's TEST sequence (data read from the `Asistent_roughcut/*.json` of those runs):
- **Time with no selected sound stayed in** (34 s of cam2's picture before cam1's first words; the empty timeline between two recordings stayed as a 0.35-0.45 s hole on every track, so the next shot did not follow). Now the speech map spans the whole selection and `pauses.plan(sound, present)` takes out whole: time no selected sound clip covers (nobody is known to speak) and time no item covers (an empty gap). The pause budget applies only inside the sound. The levels (floor, voice) are read only from the covered sound: zeros of the uncovered time had dragged the speech threshold down. The result says how many seconds went for each reason.
- **Many cuts at the end for nothing**: the last two seconds were four cuts with 0.1 s slivers of breath between them. Cuts separated by a kept piece under 0.3 s that holds no word or voiced sound are merged (`_merge_slivers`), and a pause cut under 0.25 s is not made (`MIN_CUT`; was 3 frames).
- **Effects were lost** ("Оправи звука" first, then „Груб монтаж“): the new sequence is built from the media, so nothing on the old clips came with it. Now carried over: the L/L / R/R split (a clip named "… L …" / "… R …" reads source channel 1 / 2 on both exploded sides in the XML, which is what Audio Channels does), the Volume level (XML Audio Levels, read back and set again through Volume when the import did not take it), Dynamics → Limiter −6 dB (put on the new pieces after the import by the same code as „Оправи звука“, `noLimiter` skips it for clips that had none) and the Lumetri values Exposure/Temperature/Tint/Contrast/Saturation (`premiere-color.copyLumetri`; a correction that was Asistent's own is recorded as its own again). Not carried and SAID in the result: any other effect by name, keyframed levels, a hand grade's other settings.
- **Multiple clips with two POVs** use the same rules (the gap between recordings is closed on both cameras, the next shot follows).
- Tests: 369 pytest (4 new), 101 node (2 new). **Not yet pressed in Premiere**: the effect carry-over is new code (Premiere API) and has only been checked statically.

## 0.9.59 - ГРУБ МОНТАЖ (Phase 8, M0-M2): pauses cut into a new sequence, source untouched
- **M0 probes in TEST.prproj** (details in `docs/ROUGHCUT_PLAN.md`, decision in `DECISIONS.md`): the engine-written FCP7 XML imports through UXP `project.importFiles` with no dialog, frame exact, V/A linked, camera offset intact, Cyrillic markers from `<marker>` work, `setPlayerPosition` exists.
- **Engine**: `vad.py` (Silero v6 from faster-whisper's own ONNX, a veto on cutting), `speechmap.py` (a label per 10 ms: WORD / VOICED / LOW / SILENT, cutcheck's energy rule), `pauses.py` (pause budget by tempo and sentence end, cuts only SILENT frames, edges snapped INWARD to the frame grid, a final guard that never lets a cut cover a WORD or VOICED frame), `edl.py` (kept ranges in sequence time, the same cuts for every selected item, so the cameras stay in sync), `xmeml.py` (port of autoedit's writer, any tracks, links by media range, optional markers), `roughcut_job.py` + `POST /roughcut`. Words come from the same cached Whisper readings as the subtitles; without the speech model the pauses come from the energy and Silero and the result says so. Output: `<project>/Asistent_roughcut/ГРУБ – <seq> (<mode>) vN.xml/.json`, every press a new version.
- **Panel**: card ГРУБ МОНТАЖ (Режим Внимателно/Умно, Темпо, optional review markers, one button), `roughcutplan.js` (pure), `premiere-roughcut.js` (reads only; imports the XML into bin „Груб монтаж“, finds the sequence, checks pieces per track and the length against the engine's list, opens it). Nothing is removed, muted or trimmed in the source sequence.
- **Not in yet** (said in the panel): repeated takes and false starts (M3/M4), the review list view. Effects (Lumetri, volume, L/R split) are not carried into the new sequence: run it before colour and sound.
- Real footage (Masterhaus fx31028 + C0728, numbers only): 56.06 s → 51.18 s in Внимателно/Нормално, 10 cuts, 65 words, 4 voiced-without-word places listed, 41 s (cold, three Whisper windows).
- Tests: 365 pytest (15 new), 99 node (7 new). **Not yet pressed in Premiere** (the bridge refused: a client project was open).

## 0.9.58 - ЦВЯТ: separate Бяло / Експозиция buttons, Авто цвят, „Изравни POV-тата“ in one clear card
- **Nothing in the colour engine changed** (no `engine/` file is touched except the version string; Lumetri writes, thresholds, targets and the render check are the 0.9.57 code). Only the panel's buttons are reorganised.
- **Авто цвят** is the former „Бяло и експозиция“ button, unchanged: one analysis, the suggestion with before/after, then „Приложи сигурните“ / „Приложи и средните“.
- **Бяло** and **Експозиция** run the same analysis and the same apply path, and only narrow the plans (`plansFor(..., only)`): Бяло plans Temperature/Tint, Експозиция plans Exposure. With no part the function returns exactly what it returned before (a test keeps the 0.9.57 function as the reference and compares all confidence combinations). The audit log gets a `part` field.
- **Контраст and Наситеност get no single-clip button on purpose**: the single-clip engine has no contrast or saturation algorithm (`color.py`: "never contrast, saturation or LUTs"); they exist only inside Shot Match, relative to a reference camera, and stay there. Inventing a single-clip algorithm was ruled out by the request.
- **„Изравни POV-тата“** is the existing Auto Shot Match under its new name, a button in the same ЦВЯТ card (no sub-section): it already works after the corrections (the clip's current Lumetri values are simulated on the source, then absolute values are fitted to the reference camera), keeps everything outside the components it changes, never touches a hand-made Lumetri, matches exposure, white, contrast and saturation, supports several clips, lets the user pick the reference camera and checks the result on Premiere's own frame (worse parts are put back). No algorithm was changed.
- Tests: node 92 (6 new: part filter, Auto Color equivalence, wiring of the new buttons, no contrast/saturation button).

## 0.9.57 - „Оправи звука“: the two speakers balanced by speech loudness, Dynamics → Limiter −6 dB
- **Balance** (`audio.balance`): after the L/L and R/R split the two sides' gated BS.1770 loudness (the level of the active speech, not a peak match) is compared; when they are more than 2 dB apart (`BALANCE_TOL`, request field `balance_db`) only the LOUDER side is lowered, by at most 12 dB, so nothing is lifted and no noise is amplified. A channel that carries nobody of its own (its share of frames ≥ 10 dB above the other is under 10 %: the far copy of one voice, room bleed) is not matched to anything and is not lifted above its source level. Identical channels or a stereo mic: untouched. The sum of both sides stays under −6 dB (existing rule, applied after the balance); the existing noise cap and ±30 dB still apply. Measured on Masterhaus C0731: 5.4 dB apart → 2.0 dB. Stale "Вдигнато само с…" notes are dropped when a later rule changes the gain.
- **Limiter**: every levelled clip gets Premiere's native Dynamics with only Limiter on and its Threshold at −6 dB (`Limiter Enabled` 1, `Limiter Threshold` 0.9: the parameters are normalised, value = (dB + 60) / 60; the default −1 dB is 0.98333, as the user's video shows). An existing untouched Dynamics is reused (only the limiter is switched on), one that is already Limiter −6 dB is left as it is (second press: no duplicates), and a Dynamics with somebody else's settings (other processors on, another limiter threshold, several Dynamics) is not touched and said. The effect is appended in the same step as the levels, its limiter is switched on in the next (a new effect has no parameters before it is applied) and read back; a failed read-back is reported as a problem. Two Undo steps for levels + limiter.
- **Limitation, said in the panel**: the user's video puts the limiter on the Mix (master) track. No script API reaches it in Premiere 26.0.2 (QE has only Audio 1-N, the sequence has no master track, `audioTracks[N]` is empty), so the limiter is per clip and the combined peak of the two sides is held under −6 dB by the gains themselves.
- Host: an Asistent bin clip whose name does not say L or R is refused with a message instead of being skipped silently. Test bridge: `audio_chain` (all effect parameters of audio clips, read only) and `audio_fx_add` (one effect on one clip).
- Verified in TEST.prproj (Premiere 26.0.2): one new clip (L/L + R/R, one Dynamics each, parameters read back: Limiter Enabled 1, Threshold 0.9, AutoGate/Compressor/Expander 0), second press (no new effect, "лимитерът е вече на −6 dB"), four clips at once (eight sides, one Dynamics each).

## 0.9.56 - „Оправи звука“: L/L and R/R through the clips' own Audio Channels, no Fill effects
- The one button now does what the user's reference video shows: the audio is duplicated onto the track below, the upper clip plays only the Left source channel (L/L), the lower one only the Right (R/R) (Modify Clip > Audio Channels), all linked to the video again. The Fill Left/Right effects are never added any more (a Fill that is already on a clip from earlier versions is left alone: only its level changes).
- How (no API sets the channels of a clip on the timeline): the host (`host.jsx` `as_audio_route`, command `audio_route`, endpoint `/audio/route`) makes an audio-only subclip per media range and side in the bin „Asistent L-R“ (`createSubClip`), sets its source mapping (`getAudioChannelMapping` + `setMappingForChannel` + `setAudioChannelMapping`; `audioChannelsType` is read-only), overwrites the original audio with the L/L copy and puts the R/R copy on the nearest free track below, checks both sit exactly where the original was with the same In point, and links video + both sides (`linkSelection`). Nothing is removed or muted by script.
- Every stereo clip is split (`split_all`; the user splits even clips the analysis calls one voice on two mics); the analysis only informs and sets the two levels, whose sum stays under −6 dB. A mono file is left alone. A selected video clip brings its own audio.
- Second press: sides are recognised by name („C0731 L 6.37-13.78“) and in the bin, so no new copies or subclips are made; both sides are measured as a pair and get the same levels again. No free track below: refused with the instruction to add one.
- The panel's levels are one Undo step; the splitting is separate Premiere steps (said in the result).
- `host.jsx` now starts with a UTF-8 BOM (`$.evalFile` read it as Mac Roman and Cyrillic messages came out garbled).
- Verified in TEST.prproj (Premiere 26.0.2) on Masterhaus clips: single clip, three clips at once (R/R copy of a clip whose A2 was taken went to a free track), repeat press (no duplicates, bin unchanged), clips placed to the tick with the same In point, 3 linked parts; the user confirmed in Modify Clip > Audio Channels: A1 L/L, A2 R/R.

## 0.9.55 - panel: sections, tooltips, report and pictures in their own views
- Every feature is a card: title, one line saying what it does, then its buttons (СИНХРОН, ЗВУК, ЦВЯТ, СУБТИТРИ, АВТО ВНАСЯНЕ). The manual audio variants are folded under „Ръчно ▸“; nothing was removed.
- Tooltips on every button (UXP shows nothing for `title`): shown after a short hover under the button, above it near the bottom edge, always inside the panel; hidden on leave, press or scroll. Buttons made in code get one through `button(cls, label, help, fn)` (a test checks every button in the HTML and in main.js).
- Three views: „Инструменти“ (actions), „Дневник“ (the full report of the last run plus the last 10 results; a badge counts its warnings, red on an error) and „Преди / след“ (the before/after pictures of „Бяло и експозиция“ and „Изравни камерите“, with the Приложи buttons above them). The main view keeps only the progress, the one-line result, the decisions (Приложи…, the Shot Match reference) and links to the two views. Starting a run returns to „Инструменти“.
- `[hidden]` always wins over a row's display, so folded rows stay folded.

## 0.9.54 - SYNC: fewer false „несигурно“, every decision explained
- Cause found on the Masterhaus shoot (two pairs „Възможно, но несигурно“, like the user's fx39059/C9052 +2.273 s): every window found a strong, real peak, but they spread over 11-18 ms, and a window counted only within 5 ms of the line. Two POVs metres apart hear each speaker over a different path difference (1 ms = 34 cm), so speech from different places gives slightly different offsets; there is no single exact one.
- New High rule for scattered windows (`sync.py`: `_band_cluster`, `LOOSE_BAND` 20 ms): at least 4 windows and 80 % of all (and of the informative) windows strong and inside one 20 ms band, median peak ratio >= 1.3, no second candidate, and the spread must not be a clock drift (`_drifting`: a straight line over >= 60 s stays refused). The offset is the band's median (error under 10 ms). The quick look before the full check accepts such candidates too.
- The cameras' clocks as a second witness (`groups._clock_check`): a scattered-rule pair whose learnt-clock times disagree by > 10 s is vetoed (same line from another take); an uncertain pair (no drift, no second offset) whose recording times agree with the audio within 2 s becomes High. Raw clocks may confirm (two clips only, as in the user's case) but never veto.
- Results: Masterhaus 7 → 10 synced pairs (fx31030/C0730 +2.208 s, fx31036/C0740 +6.952 s by the band rule, C0741/fx31037 +9.955 s by the clocks); learnt clocks agree with all 10 audio offsets within 0.8 s. GStroy 16x9 11 groups (+2 by the band rule, clock-consistent within 1.4 s like its strict pairs). GStroy 9x16 unchanged (10 groups); unrelated takes, drift and repeated sounds still never High.
- Panel: an uncertain pair now shows its reason; an accepted pair that needed the band rule or the clocks says so under its group.
- Premiere's own Synchronize cannot be called: neither UXP nor ExtendScript exposes it.

## 0.9.53 - SYNC: everything in recording order, also clips without a partner
- Clips without a second POV were placed after all groups. Now groups and single clips are laid out in one list in the order they were recorded (user's example: A 10:00, A+B 10:05, A 10:15 stays in that order).
- Recording time: the engine reads each file's `creation_time` (Sony writes the record start; equal to the XML sidecar), else the file time minus the duration (`media.probe`: `recorded`, `recorded_from`).
- Camera clocks: `chrono.py` learns each camera's clock difference from the synced pairs (median; reported when the pairs disagree by more than 3 s) and corrects all clips of that camera, the unsynced ones too. GStroy footage: the FX30 clock is 731 days behind the FX3's; 12 pair measurements agree within 2.1 s; the 6 lone clips now sit between the groups where they were recorded.
- Nothing is invented: a camera that never synced keeps its own clock only when it falls within 30 min of the session (reported as unchecked); a clip without any usable time keeps its place from the editor's timeline (follows its neighbour there) and is listed as „Несигурно място“ in the panel.
- Panel: groups are listed in the order of the new sequence; a corrected camera clock is named; unsynced clips are no longer described as „сложени накрая“.

## 0.9.52 - SYNC: no markers in the new sequence
- „Синхронизирай камерите“ no longer writes the „Група N“ / „Без синхрон“ markers into the new `SYNC – …` sequence (user, 2026-11-03: the timeline must stay clean). They were labels only; the clips are placed from the engine's offsets, so nothing about the sync changes. The group list stays in the panel's result. The user's own sequence and its markers were never touched and still are not.
- Tests: the Bulgarian dictionary loader (`lexicon.py`) now collects the files spylls 0.1.7 leaves open; their ResourceWarning used to fail whichever test was running at that moment under `-W error` (5 random failures).
- Numbering: 0.9.49-0.9.51 are skipped because a panel build labelled 0.9.51 that is not in this repository was seen on another computer; the next real version is 0.9.52 so the two can never be confused.

## 0.9.48 - subtitles: 5 times faster, numbers aligned, the Bulgarian transcription guide built in
- Speed (C9025, 8 pieces, 49.6 s of speech: **230 s → 45 s** from a cold cache): one Whisper reading per stretch of a source file with 4 s of context around the pieces and the windows of nearby pieces merged (91 s of audio read instead of 252 s); several windows read at the same time (`asr.workers()`: 5 readings × 2 threads on the M4 Max; one reading with 10 threads was SLOWER than with 4); alignment and checking run per window in parallel; the second opinion uses a cheaper decode.
- Words: unknown words are repaired by the smallest edit that gives exactly one dictionary word (`lexicon.repair`: reduced vowel, dropped vowel as „одяло“ → „одеяло“, two vowel edits „одялоце“ → „одеялце“, one letter „Взиваме“ → „Взимаме“ when the recording says „взимаме“ elsewhere); diminutives the dictionary lacks are accepted by their stem; „евро“ is known. Every repair is listed in the result.
- Second opinion: a piece that still has an unknown word (or a first-person „съм …л/ла“ form) is read again alone with 2 s of context; the reading with fewer doubts wins (C9025: „е одял, Острова“ became „одеяло струва“).
- Numbers: every number is given to the aligner as spoken Bulgarian (`numbers.py`: 500 → петстотин), and the aligner's confidence no longer discards a time (the confidence is no sign of a wrong word); only a word squeezed into too little time is distrusted. The words after prices were 0.3-0.5 s late before; now median 0.00 s.
- Review (guide §5, §7, §11): a month name in a conversation about prices, a word with no speech-like sound under it (the hallucinated „Така.“ was stretched over 1.3 s of breath), a gender-form disagreement between readings: each is marked „?“ with its reason in the panel; nothing is rewritten.
- Text: „5 ,79“ → „5,79“ (`subtitles.tidy_words`), a comma closes an „Ако …“ clause when Whisper wrote none; words stay inside their clip („Ах,“ no longer starts 0.6 s before it).
- Voiced sound without a word (the guide's first/last seconds check) is listed with its time: C9025 had two such places (0.26-0.91 s and 12.25-12.82 s); the panel says „чуй“.
- Results keep an immutable `verbatim` layer and an `edits` log next to the final words.
- `docs/BULGARIAN_TRANSCRIPTION_GUIDE.md` added as the permanent reference and linked from CLAUDE.md; its §10 table is `tests/test_guide_regressions.py`.
- Tests: 329 pytest + 70 node.

## 0.9.47 - subtitles: no speaker setting, captions clear sooner
- Tested large-v2 as a second opinion on the four real pieces: fixes „неща" but breaks „Примерно на мен", „то и за градината" and the end phrase is worse; not used, test model deleted.
- Removed the Мъж / Жена / Авто setting and `gender.py` (user: most clips have both speakers, so a gender rule would rewrite correctly spoken forms). Every form stays as heard; a form the readings disagree on is marked „?“.
- A caption now clears 0.15 s after its last word (was 0.3 s); the rule against a blank screen under 0.2 s between captions is unchanged. Measured on the real clip: captions that switched late/early by 80-120 ms are listed in `PROJECT_STATUS.md`.
- Tests: 280 pytest + 70 node.

## 0.9.46 - subtitles: corrections that re-time, speaker gender, silence trim
- Corrections and names: new box in СУБТИТРИ (per project, kept by the engine). `чуто => казано` replaces the heard words BEFORE the alignment, so the new words are placed by the sound, not copied over old times (`corrections.py`); a line without `=>` is a name/term for Whisper's prompt. The result says which corrections matched and warns about one that found nothing or cannot be read. Lines can be written from what the captions show (the by-ear respelling is matched too).
- (Removed in 0.9.47) Speaker (Авто / Мъж / Жена): first-person past forms after „съм“/„бях“ („свършила“ → „свършил“) are set to the speaker's gender, only to a form the dictionary knows (`gender.py`). Авто decides only from the forms heard in all readings (at least two votes, two to one); pitch was measured and rejected (150-258 Hz within one clip).
- Timing: a weak word is fitted between its aligned neighbours (no overlap); a word is not spoken in silence, so a start or end inside silence moves to where the voice is (`align.trim_silence`; thresholds follow the recording). „Ей,“ was 0.26 s early.
- Tested against Whisper's own times and stable-ts 2.19 on 13 words after a pause: median error -0.41 s / -0.10 s / +0.04 s (MMS_FA), within 80 ms 0 / 5 / 11 of 13. MMS_FA stays; after the silence trim 13 of 14 words are within 80 ms.
- Premiere cannot delete a caption track from any API (UXP: no; ExtendScript: only `createCaptionTrack`; QE removes only video/audio tracks), so a second press still refuses to stack a second set and says what to delete.
- `scripts/check_subtitles.py` checks a finished run against the audio (speech without a word, onset errors, captions over silence).
- Tests: 283 pytest + 70 node.

## 0.9.45 - subtitles: one press puts them on the timeline; alignment on; word check
- Placement: after the SRT is made, the panel puts it on a caption track of the active sequence. UXP cannot (probed again on 26.0.2: `Sequence` has no `createCaptionTrack`), so a new invisible CEP extension, the Asistent host (`host/`, installed by `scripts/install_host_mac.sh`, needs ONE Premiere restart), runs ExtendScript `createCaptionTrack`. Engine: `hostbridge.py`, `/host/poll`, `/host/result`, `/captions/place`, `captionstate.py`. The panel verifies the result (new track, item count, first/last time) and says where the captions are. A second press with an Asistent track still on the sequence does not stack a second one: it tells the editor to delete that track (Asistent never removes or mutes tracks). Not verified in Premiere yet.
- Missing first word: Whisper's early word starts pushed „Имаш“ out of the piece at a cut. With alignment installed the word is placed by the sound (energy trace confirms speech at 0.02-0.28 s) and kept.
- Timing: MMS_FA alignment is now installed and on (59 of 65 words aligned, 6 weak keep Whisper times); on „Добре,“ the aligned start is on the real onset (1.13 s; Whisper said 0.88 s, 0.25 s early in silence).
- Words: each piece is read three times with 0.7 s, 2 s and 4 s of surrounding sound (`consensus.py`); a word is replaced only when two readings agree AND the Bulgarian dictionary (`lexicon.py`, Hunspell bg_BG through `spylls`) knows the new word and not the old one; disagreement or an unknown word Whisper doubts is marked „?“ and the panel lists the words with their times. Voting without the dictionary turned „градината“ into „градвината“, so it never replaces on its own.
- Spelling by ear: Bulgarian reduces unstressed vowels (е heard as и, о as у, а as ъ), so Whisper wrote „нища“ for „неща“. An unknown word Whisper doubts that is exactly one swapped vowel (those pairs) away from ONE real word is respelled to it (`lexicon.respell`); several or no candidates: it stays and is reported. On the cached transcripts only „нища“ is touched.
- Verified in Premiere (user, TEST.prproj, 23:47): the host loaded after the restart, 25 captions went onto caption track C2 in one press, panel check found no problems; timing „a lot better“.
- A blank screen shorter than 0.2 s between two captions is bridged (no blink).
- Host check commands for development: `scripts/dev_cmd.py host ping|probe|captions|eval`, `host_status`.
- Tests: 269 pytest + 68 node.

## 0.9.44 - subtitles: per-piece recognition, optional alignment, natural phrases
- Words: each piece is recognised on its own with 2 s of real media around it (the joined mix of cut pieces gave „и аз да видим“, „Приведно на мен“; per piece gives „я да видим“, „Примерно на мен“).
- Timing: optional word alignment (MMS_FA, as in the 4a1a autoedit workflow) in its own environment; Whisper's raw word starts are early by a median 0.12 s. Off until installed (`scripts/setup_mac.sh --align`); the weights are CC-BY-NC 4.0, see LICENSES.md. The panel result says which timing was used.
- Grouping (short preset): phrases of 2-3 words by pauses, punctuation and grammar (no caption ends on a preposition, conjunction or particle; no sentence end inside a caption); one-frame lead, no blinking in continuous speech.
- Tests: 249 pytest + 60 node.

## 0.9.43 - subtitles: the cleanest microphone is recognised
- Fix: wrong words came from noisy, quiet camera-mic copies chosen only because they were on the lowest track. The engine now treats items that overlap and follow the same loudness envelope as duplicates and keeps the cleanest one (speech level over noise floor); speech the winner does not cover is kept from the weaker copy. The panel sends every eligible item; the result lists which copy replaced which.
- Result JSON now keeps the request items for reproduction.
- Tests: 234 pytest + 59 node (duplicate choice with synthetic microphones, partial overlap, different speakers, tie → lowest track).

## 0.9.42 - Phase 7 M3: dialogue mix, /subtitles job, СУБТИТРИ section
- Engine: `dialoguemix.py` (selected audio items as one 16 kHz mono signal at sequence time), `subtitle_job.py` and `POST /subtitles` (Whisper words cached by mix + prompt; captions per preset; SRT + JSON written to `<project folder>/Asistent_subtitles/`).
- Panel: section „СУБТИТРИ“ with „Субтитри (български)“; pure `subtitleplan.js` (duplicate audio on a higher track is skipped and named); the model download starts only from its own button that names the size.
- Verified end to end on a real Bulgarian clip through the live engine (2.8x real time) and by the user in Premiere (34 captions from 4 selected items, 4 duplicates skipped, frame size read, SRT written next to the project).
- Tests: 228 pytest + 60 node.

## Docs and workflow (earlier today)
- Docs: `NEXT_STEPS.md` is now `TODO.md`, `BUGS_AND_LIMITATIONS.md` is now `BUGS.md` (history preserved by `git mv`); added `CHANGELOG.md`, `docs/INDEX.md`, repo-local snapshot of the dev workflow and agents, extended `.gitignore`, a pre-commit documentation check.

## 0.9.41 - Phase 7 M2: speech recognition
- faster-whisper large-v3, local only, model downloaded after the user confirms; about 2.8x real time on the Mac.

## 0.9.40 - Phase 7 M1: subtitle text core
- `bgtext.py` (Bulgarian spelling), `subtitles.py` (line breaking, presets, frame snap, SRT with BOM). Not wired to the panel yet.

## 0.9.38-0.9.39 - Phase 7 plan and probes
- `docs/SUBTITLES_PLAN.md`; M0 probes. Verified in Premiere: Cyrillic SRT imports correctly with and without BOM.

## 0.9.33-0.9.37 - faces in "Цвят", test bridge
- Single-clip exposure uses detected faces; guard against unseen renders; Premiere test bridge (`devbridge`, only in TEST.prproj).

## 0.9.28-0.9.32 - Auto Shot Match
- Anchors (skin, neutrals, tones), measured Lumetri models, absolute idempotent fit, reference choice, flags, render check and revert.
- Skin measured only on faces found by the YuNet detector. Verified by the user on the GStroy pairs.

## 0.9.24-0.9.27 - ownership, statuses, audit log
- Managed correction ownership (fingerprints in `managed.json`; a manual Lumetri grade is never touched). Statuses and `color_audit.jsonl` per clip and press; accept/revert of parts that got worse. Verified in Premiere.

## 0.9.17-0.9.23 - colour check refinements
- Soft tolerance for final highlight clipping; colour analysis on timeline renders (480 px); one failing clip never stops the others; "Приложи и средните" counted per correction.

## 0.9.13-0.9.16 - exposure curve and step-back
- Probe verified (Temperature/Tint as channel gains, Exposure shoulder curve); Exposure in Lumetri units from the probe; clipping step-back measured from frames (verified: 4.4 % to 3.08 %).

## 0.9.9-0.9.12 - fixes
- Volume level always in Premiere's scale; only the audio buttons start "Оправи звука"; frame export works again (name must end in `.png`); presses ignored while the panel moves.

## 0.9.1-0.9.8 - panel and colour probe
- Results at the top of the panel, clearer colour result, exported frames found, section titles, clip level capped at +15 dB, sync reports which files it saw selected, selection read by list OR `getIsSelected`.

## 0.9.0 - Lumetri capability probe
- First step of the colour engine spec (`COLOR_CORRECTION_PLAN.md`).

## 0.8.0 - Phase 6: white balance and exposure
- Preview first, then apply Exposure/Temperature/Tint in Lumetri; Phase 5 (client profiles) started and later postponed.

## 0.7.1 - Phases 1-4
- UXP panel and Python engine; Smart Auto Sync (new `SYNC – <sequence>`); lavalier audio (Fill L/R, split copies, Volume level, phrase leveling, main mic peak at most -6 dBFS); auto import from watched folders.
