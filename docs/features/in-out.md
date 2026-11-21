# In & Out animations

<!-- Status: Phase 4 preview built (0.10.130): not installed, Node-tested, bridge test not run. Phase 3 page (0.10.129): installed on the dev Mac, not released, bridge-tested on 0.10.128. The user has not looked at the page or the preview in Premiere yet. Plan: docs/IN_OUT_PLAN.md. -->

## What it does
Motion → In & Out: pick an In and/or an Out animation (ready-made presets: Position, Scale, Rotation, Opacity, as in Easify 4)
for the selected video clips. Apply gives each clip one Asistent-owned Transform with baked keys, one per frame; Remove takes it off
again. Phase 2 (0.10.127) is the Premiere side; Phase 3 (0.10.129) is the page on top of it; Phase 4 (0.10.130) adds a preview card to the page.

## How to use it
1. Motion → In & Out. Two cards: In and Out, each with None and its presets (In 20, Out 13), grouped by Position / Scale / Rotation / Opacity.
2. Pick a preset on one or both sides. While both are None, Apply says "Pick an In or an Out animation first." and writes nothing.
   The Preview card at the top of the page plays the picked animations on a sample box, from the same numbers Apply writes.
3. The settings the picked presets ask for appear: Edge (Left, Top, Bottom, Right) only when a preset needs it; Turn (Clockwise,
   Counter-clockwise) only when one rotates; In frames / Out frames (empty = the preset's own length); Strength % (greyed where it
   changes nothing, with a tooltip); Motion blur on or off.
4. Select the video clips in Premiere and press Apply (dock). The status line gives the clips, keyframes and the Undo count
   ("Cmd/Ctrl+Z 2 times" the first time, once after), skipped clips with reasons, "Shortened to fit the clip", and notes.
5. Remove (dock) takes Asistent's effect off the selected clips.
Choices are kept in the panel store (`asistent.inout.ui`). Nothing is applied by itself. The one timer is the Preview's; it only redraws the sample box.

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
- The Preview never writes to Premiere or the store. It draws the rows `inoutplan.plan()` gives Apply. Its timer stops when the pane
  is hidden, after 8 plays without a pointer move or a new pick, during Apply and Remove, and after a draw failure. `inout.js` wakes
  it on open (`inoutPage.wake()` from `openTab`).

## Decisions
- Owned Transform, not Motion (DECISIONS 2026-11-21, after probes P1-P9). On a clip with a Graphic group it goes before the group.
- Hooks in existing files (the user's go-ahead 2026-11-21, "continue"): the blur's `addOwn` needs the Transform count to rise by
  exactly one; the Keyframer's `readSelection` skips In/Out's tagged Transform.
- Choices are remembered in the panel store, not in the project.
- Preview (0.10.130): a fixed 148 x 104 px frame with a 52 x 36 px box, so it shows the motion, not the clip's real size, and draws
  no motion blur. Same technique as the Keyframer preview (SVG polygon, setTimeout, `.kf-pv*` classes); no CSS added.
- Open (the user's word needed): Strength changes nothing on In Slide, Whip, Fade, Zoom In and Out Slide, Whip, Drop, Shrink, Fade
  (a clip that must start or end fully off screen cannot travel less). The page greys it out via `needs().strength`. The plan says
  "Strength scales travel distance": keep the exception or change the plan? At Strength 200, In Bounce's first hop goes all the way
  back off screen before landing.

## Code map
- `panel/inout.js` (Phase 3 page): `mount({ $, el, button, enable, bindTips, premiere })` builds the In and Out cards, the settings and
  the dock (Apply, Remove) into `#paneInOut` / `#ioDock`; calls `premiere-inout.js`; keeps choices under `asistent.inout.ui`.
- `panel/inoutui.js` (pure, no DOM): `restore`, `snapshot`, `view` (which controls show), `framesAfterTyping`, `clampFrames`,
  `clampStrength`, `presetTip`, `statusFor` / `status`, `undoLine`, `PICK_FIRST`.
- `panel/premiere-inout.js` (Phase 2): `apply(project, opts)`, `remove(project)`, `info(project)`, `isTagged`, `TAG`; record
  `asistent.inout.v1` per clip, keyed by `clipKey`.
- `panel/inoutplan.js` (pure): `IN_PRESETS` (20), `OUT_PRESETS` (13), `plan()`, `times()`, `find`, `groups`, `animates`, `needs`,
  `defaultFrames`; the Transform maths `boxOf`, `exitDistance`, `edgeOf`, `transformKeys`, `capCheck`, `boxUsable`, `MIN_SIZE`.
- `panel/inoutpreview.js` (Phase 4, 0.10.130): pure `build(opts)` (picked rows to the loop's steps, both None = resting box),
  `caption`, `styleOf`, `corners`, `exitOf`; `mount({ host, el, visible, debug })` returns `set(view)`, `wake()`, `stop()`, `info()`.
  Draws only; no Premiere, no store, no engine.
- Hooks: `panel/index.html` (`tabInOut`, `paneInOut`, `ioDock`), `panel/main.js` (`PANES`, `MOTION`, dock switch in `openTab`, the
  mount line, `inoutPage.remembered()`, `inoutPage.wake()` in `openTab`; `inoutPage` is a `let` beside `trackerPage`), `panel/style.css`
  (`.io-row`, `.io-group`, `.io-off`, `#tabInOut` nowrap, the 260 px rule for the four Motion buttons), `panel/premiere-blur.js`
  (`addOwn`), `panel/premiere-keyframes.js` (`readSelection`), `panel/devbridge.js` (`inout_info`, `inout_apply`, `inout_remove`),
  `scripts/package_ccx.sh` (packs `inoutplan.js`, `premiere-inout.js`, `inoutui.js`, `inoutpreview.js`, `inout.js`).
- Preview: `preview/fake-inout.js`, four scenarios in `preview/scenarios.js`.
- Not yet built: Phase 5 (per-property curve editor, own presets).

## Status
- Phase 0-1 (0.10.124-0.10.125): probes P1-P9 in NEW TEST; `inoutplan.js` maths.
- Phase 2 (0.10.127): bridge NEW TEST, 13 checks passed (key values on plain, trimmed, 200 %, 50 % clips and a Basic Title; frame 0
  off screen; Undo 2 / 1 / 1; blur; refusals write nothing); rotation re-checked live on five clips (25 runs).
- Phase 3 (0.10.129): bridge NEW TEST on 0.10.128, 10 checks passed: one pane and one dock at a time; every preset's Edge / Turn /
  Strength state matches the maths (33 presets, 0 mismatches); clamps (frames 1-1000, strength 25-200); Apply through the page writes
  what the direct call writes, with the right Undo counts; blur switch Shutter 180 / 0; three clips, a reversed clip skipped with its
  reason, shortening, the graphic note; Remove and "Nothing removed"; nothing selected refused; nothing written without Apply; the
  Keyframer, Tracker and Anchor pages unaffected; no panel errors. Then four fixes (a frames box no longer pins the default when only
  focused; typed numbers committed at Apply; the hint while both are None; a stale status cleared on a choice change), reinstalled as
  0.10.129 and smoke-tested through the page (Pop: 13 scale keys, the 2-Undo sentence; Remove restored the chain).
- Phase 4 (0.10.130): preview card built; `tests/inoutpreview.test.js` (14) and the wiring test pass; rules-reviewer PASS, no must-fix.
  Not run yet: the bridge test and the install.
- Not verified by the user: the page in Premiere (card layout, greyed rows, dock, the four Motion buttons at narrow widths, tooltips),
  the preview's drawing and loop speed, and the motion in playback next to the reference, blur on and off. The bridge reads the DOM,
  not what is painted.
- Limits: BUGS.md "In & Out preview (0.10.130, limits)", "In & Out animations, Phase 3 page" and "Phase 2"; open items in TODO.md section IO.

## Tests
- `tests/inoutplan.test.js` (21): preset tables, groups, finite rows in range, In starts on the first frame and rests at the end, Out
  ends on the last frame, direction and turn, Strength, scale clamp, In + Out longer than the clip, key cap, frame rounding, `times()`.
- `tests/inoutkeys.test.js`: the Transform maths (`boxOf`, `exitDistance`, `transformKeys`, `capCheck`, `boxUsable`).
- `tests/inoutui.test.js` (new in 0.10.129): what the page shows and says (restore, view, tips, status lines).
- `tests/inoutpreview.test.js` (14, new in 0.10.130): the styles and corners, the loop (In, hold, Out, pause), one-side loops, typed
  frames, directions, turns, Strength, opacity presets, every preset's loop, a plan error, the caption.
- `tests/wiring.test.js`: the page's hooks, the mount line, the packing list, and the preview's rules (draws only, one timer, stops
  when hidden, mounted and woken by the page).
- Node suite 486 pass at 0.10.130 (467 at 0.10.129). Python unchanged: 954 passed, 24 skipped earlier today.
- Live test material: NEW TEST, sequence "Asistent probe – In Out".
