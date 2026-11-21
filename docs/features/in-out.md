# In & Out animations

<!-- Status: Tiles page (0.10.133): not installed, not reviewed, Node-tested (494 pass), bridge test not run. 0.10.132 (compact page) was local only and is replaced. Phase 4 preview (0.10.130) and Phase 3 page (0.10.129): the page was bridge-tested on 0.10.128 and installed on the dev Mac, not released. The user has not looked at any of it in Premiere yet. Plan: docs/IN_OUT_PLAN.md. -->

## What it does
Motion → In & Out: pick an In and/or an Out animation (ready-made presets: Position, Scale, Rotation, Opacity, as in Easify 4)
for the selected video clips. Apply gives each clip one Asistent-owned Transform with baked keys, one per frame; Remove takes it off
again. Phase 2 (0.10.127) is the Premiere side; Phase 3 (0.10.129) is the page on top of it; Phase 4 (0.10.130) added the preview;
0.10.132 made the page compact; 0.10.133 rebuilt it as Tiles (the layout the user chose).

## How to use it
1. Motion → In & Out. The preview is on top, full width, with a small drawing of the picked animation on a sample box.
2. Pick a side with the In | Out switch. Its labels show the current picks ("In · Slide", "Out · Anticipate").
3. Filter the presets with the chips All / Move / Scale / Spin / Fade (one filter for both sides; remembered). The active side's
   presets are tiles in 3 columns (2 below 280 px), each with a small drawn icon of what moves. Presets: In 20, Out 13, plus None.
   Pointing at a tile plays it in the preview without picking it. Pick on one or both sides. While both are None, Apply says
   "Pick an In or an Out animation first." and writes nothing.
4. The dock, always visible: the active side's length as a stepper (minus, frames, plus, empty = the preset's own length); Edge as four drawn
   arrow buttons and Turn as two (only when the picked preset needs them); Strength % (greyed where it changes nothing, with a
   tooltip) and a "Blur on / off" pill; then Apply and Remove.
5. Select the video clips in Premiere and press Apply. The status line gives the clips, keyframes and the Undo count ("Cmd/Ctrl+Z 2
   times" the first time, once after), skipped clips with reasons, "Shortened to fit the clip", and notes. Under Apply and Remove the
   dock shows a one-line summary, for example "In Slide 12f · Out Anticipate 16f".
6. Remove (dock) takes Asistent's effect off the selected clips.
Choices, and the side and filter last shown, are kept in the panel store (`asistent.inout.ui`). Old saved values open on In and All.
Nothing is applied by itself. The one timer is the Preview's; it only redraws the sample box.

## Key points: do not break
- The editor's own Motion, Opacity and own Transform are never written or removed. A Transform counts as ours only when its Skew
  Axis holds TAG (17.25) with Skew 0 (`isTagged`); an untagged one is never adopted.
- Only Asistent's tagged effect is removed; no track item is removed; nothing runs by itself.
- Apply and Remove are the only writes. A change of a choice writes nothing and clears the old status line.
- The blur's Transform and ours never touch each other, in either order (`premiere-blur.js` `addOwn` refuses a tagged one).
- The Keyframer does not list or reshape our keys (`premiere-keyframes.js` `readSelection` skips the tagged Transform).
- Undo: first Apply 2 steps for any number of clips, re-apply 1, Remove 1. The result says the number.
- Key times: `inPt × |speed| + f × |speed| / fps` (`inoutplan.times`), measured on a 200 % clip (P7).
- Scale above about 400 % blends straight (`blurplan.SCALE_MAX`); pins at each end of a key run.
- Non-finite keys are never written; a clip whose Motion scale is 0 or tiny is skipped for position presets, with a reason.
- The Preview and the hover never write to Premiere or the store. The preview draws the rows `inoutplan.plan()` gives Apply. Its timer
  stops when the pane is hidden, after 8 plays without a pointer move or a new pick, during Apply and Remove, and after a draw
  failure. `inout.js` wakes it on open (`inoutPage.wake()` from `openTab`).
- A looping SVG in the panel changes attributes only; it never creates or removes nodes per frame (the 0.10.130 crash).

## Decisions
- Owned Transform, not Motion (DECISIONS 2026-11-21, after probes P1-P9). On a clip with a Graphic group it goes before the group.
- Hooks in existing files (the user's go-ahead 2026-11-21, "continue"): the blur's `addOwn` needs the Transform count to rise by
  exactly one; the Keyframer's `readSelection` skips In/Out's tagged Transform.
- Choices are remembered in the panel store, not in the project.
- Layout A "Tiles" chosen by the user on 2026-11-21 from three working mockups on a design canvas: A Tiles, B Two columns, C Quick
  pairs. The user answered "A Tiles", asking for something "optimized for fast and easy use". B and C were not built into the panel.
  A is the one that is built; the reason for it is the user's answer, not a measurement.
- Tiles layout (0.10.133), replacing the compact page of 0.10.132 (which the user had not seen approved): the preview goes full width
  on top; one side at a time through the In | Out switch; filter chips; tiles in 3 columns; Edge and Turn live in the dock so the tiles
  never move on a pick; a pick by id shows its side and resets the filter to All if the tile would be hidden.
- Preview (0.10.130, size changed in 0.10.133): a drawing of 208 x 94 px centred in a full-width frame, with a 46 x 32 px box (was
  104 x 72 and 36 x 26 in 0.10.132), so it shows the motion, not the clip's real size, and draws no motion blur. Same technique as the
  Keyframer preview (SVG polygon, setTimeout, `.kf-pv*` classes); two shapes made once, changed by attribute only (the 0.10.130 crash).
- Edge and Turn are drawn SVG icons, not arrow characters (0.10.133): the arrow glyphs of 0.10.132 were never confirmed to render in
  UXP's font.
- Open (the user's word needed): Strength changes nothing on In Slide, Whip, Fade, Zoom In and Out Slide, Whip, Drop, Shrink, Fade
  (a clip that must start or end fully off screen cannot travel less). The page greys it out via `needs().strength`. The plan says
  "Strength scales travel distance": keep the exception or change the plan? At Strength 200, In Bounce's first hop goes all the way
  back off screen before landing.

## Code map
- `panel/inout.js` (Phase 3 page, Tiles in 0.10.133): `mount({ $, el, button, enable, bindTips, premiere })` builds the preview on
  top, the In | Out switch (`ioSideIn`, `ioSideOut`), the filter chips (`ioFilter-*`), the tiles (`ioIn-<id>`, `ioOut-<id>`; all exist,
  the hidden ones carry the `hidden` property), and the dock (`ioFramesMinus` / `ioFramesPlus` around `ioInFrames` / `ioOutFrames`,
  `ioDir-*`, `ioTurn-*`, `ioStrength`, `ioBlurSwitch`, Apply, Remove, summary) into `#paneInOut` / `#ioDock`; calls
  `premiere-inout.js`; keeps choices, side and filter under `asistent.inout.ui`.
- `panel/inoutui.js` (pure, no DOM): `FILTERS`, `tiles`, `shownTiles`, `afterPick`, `restore`, `snapshot`, `view` (which controls
  show), `framesAfterTyping`, `clampFrames`, `clampStrength`, `presetTip`, `statusFor` / `status`, `undoLine`, `PICK_FIRST`,
  `hoverView` (what the preview shows while the pointer is on a tile; never saved). An unknown saved filter reads as All.
- `panel/premiere-inout.js` (Phase 2): `apply(project, opts)`, `remove(project)`, `info(project)`, `isTagged`, `TAG`; record
  `asistent.inout.v1` per clip, keyed by `clipKey`.
- `panel/inoutplan.js` (pure): `IN_PRESETS` (20), `OUT_PRESETS` (13), `plan()`, `times()`, `find`, `groups`, `animates`, `needs`,
  `defaultFrames`; the Transform maths `boxOf`, `exitDistance`, `edgeOf`, `transformKeys`, `capCheck`, `boxUsable`, `MIN_SIZE`.
- `panel/inoutpreview.js` (Phase 4): pure `build(opts)` (picked rows to the loop's steps, both None = resting box), `caption`,
  `styleOf`, `corners`, `exitOf`; the drawing and box constants (`W` 208, `H` 94, `BOX_W` 46, `BOX_H` 32); `mount({ host, el,
  visible, debug })` returns `set(view)`, `wake()`, `stop()`, `info()`. Draws only; no Premiere, no store, no engine.
- Hooks: `panel/index.html` (`tabInOut`, `paneInOut`, `ioDock`), `panel/main.js` (`PANES`, `MOTION`, dock switch in `openTab`, the
  mount line, `inoutPage.remembered()`, `inoutPage.wake()` in `openTab`; `inoutPage` is a `let` beside `trackerPage`), `panel/style.css`
  (the `.io-*` block: tiles, chips, switch, preview and dock classes, replaced in 0.10.133; `.io-off`, `#tabInOut` nowrap,
  the 260 px rule for the four Motion buttons), `panel/premiere-blur.js` (`addOwn`), `panel/premiere-keyframes.js` (`readSelection`),
  `panel/devbridge.js` (`inout_info`, `inout_apply`, `inout_remove`), `scripts/package_ccx.sh` (packs `inoutplan.js`,
  `premiere-inout.js`, `inoutui.js`, `inoutpreview.js`, `inout.js`).
- Preview: `preview/fake-inout.js`; scenarios in `preview/scenarios.js` (`inout-edge`, `inout-turn`, `inout-out`, `inout-scale`,
  `inout-hover`, `inout-done`; the last two added in 0.10.133); `preview/shoot.js` shoots them for the browser harness.
- Not yet built: Phase 5 (per-property curve editor, own presets).

## Status
- Phase 0-1 (0.10.124-0.10.125): probes P1-P9 in NEW TEST; `inoutplan.js` maths.
- Phase 2 (0.10.127): bridge NEW TEST, 13 checks passed (key values on plain, trimmed, 200 %, 50 % clips and a Basic Title; frame 0
  off screen; Undo 2 / 1 / 1; blur; refusals write nothing); rotation re-checked live on five clips (25 runs).
- Phase 3 (0.10.129): bridge NEW TEST on 0.10.128, 10 checks passed: one pane and one dock at a time; every preset's Edge / Turn /
  Strength state matches the maths (33 presets, 0 mismatches); clamps (frames 1-1000, strength 25-200); Apply through the page writes
  what the direct call writes, with the right Undo counts; blur switch Shutter 180 / 0; three clips, a reversed clip skipped with its
  reason, shortening, the graphic note; Remove and "Nothing removed"; nothing selected refused; nothing written without Apply; the
  Keyframer, Tracker and Anchor pages unaffected; no panel errors. Then four fixes, reinstalled as 0.10.129 and smoke-tested.
- Phase 4 (0.10.130): preview card built; `tests/inoutpreview.test.js` (14) and the wiring test pass; rules-reviewer PASS, no must-fix.
  0.10.131 fixed the Premiere crash in the preview's SVG painter (bridge test, three rounds and about five minutes of looping, no new
  crash report).
- Compact page (0.10.132): local only, replaced by 0.10.133. Node 490 pass; browser harness only; installed and bridge-tested for the
  compact layout, rules-reviewer PASS.
- Tiles page (0.10.133): built; Node 494 pass; the browser harness measured the page content (one side, All filter): In 540 px (21
  tiles) and Out 432 px (14 tiles) at 300 and 420 px; 756 px and 540 px at 240 px (2 columns); the dock 125 px (151 px at 240 px when
  Edge wraps); a filter on leaves 1-3 rows. Screenshots at 240, 300 and 420 px read. Not run: review verdict, install, bridge test.
- Not verified by the user: the page in Premiere (the real column count, tile look, icons, the preview frame, hover, dock summary,
  greyed rows, tooltips), the preview's drawing and loop speed, and the motion in playback next to the reference, blur on and off.
  The bridge reads the DOM, not what is painted.
- Limits: BUGS.md "In & Out preview and Tiles page (0.10.130-0.10.133, limits)", "In & Out animations, Phase 3 page" and "Phase 2";
  open items in TODO.md section IO.

## Tests
- `tests/inoutplan.test.js` (21): preset tables, groups, finite rows in range, In starts on the first frame and rests at the end, Out
  ends on the last frame, direction and turn, Strength, scale clamp, In + Out longer than the clip, key cap, frame rounding, `times()`.
- `tests/inoutkeys.test.js`: the Transform maths (`boxOf`, `exitDistance`, `transformKeys`, `capCheck`, `boxUsable`).
- `tests/inoutui.test.js` (new in 0.10.129, extended in 0.10.132 and 0.10.133): what the page shows and says (restore, view, tips,
  status lines, the side, the filter, `tiles`, `shownTiles`, `afterPick`, `hoverView`).
- `tests/inoutpreview.test.js` (14 at 0.10.130; changed in 0.10.133): the styles and corners, the loop (In, hold, Out, pause),
  one-side loops, typed frames, directions, turns, Strength, opacity presets, every preset's loop, a plan error, the caption.
- `tests/wiring.test.js`: the page's hooks and ids (tiles, filter chips, dock stepper and icons), the mount line, the packing list,
  and the preview's rules (draws only, one timer, stops when hidden, mounted and woken by the page).
- Node suite 494 pass at 0.10.133 (490 at 0.10.132, 487 at 0.10.131, 486 at 0.10.130). No Python file changed in 0.10.133; pytest not
  reported for it.
- Live test material: NEW TEST, sequence "Asistent probe – In Out".
