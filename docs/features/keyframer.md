# Keyframer

## What it does
Motion tab > Keyframer. It shapes the motion between a clip's own keyframes with a curve: ease, elastic, bounce, a
curve drawn from points, or motion after the last key (Overshoot+, Bounce Back, Ping-pong, Loop). It can add a motion
blur that follows each frame's speed. A live preview plays the motion next to the curve.

## How to use it
1. Select one clip that has keyframes and press "Read the selected clip". Tick the properties to shape.
2. Pick a curve: a preset, Elastic / Bounce (Where, Bounces, Overshoot or Height), Custom (click the graph to add points,
   drag, double-click removes, Alt-click makes a sharp corner), or "Edit as points" on any preset.
3. Optional: Repeat after the last keyframe, and the Motion blur switch with Amount (0-100 %, default 50).
4. Press Apply (in the dock that stays in view). One press is one Undo step. "Undo last" takes out Asistent's keys.
5. After Apply, a changed curve or setting is applied again by itself 500 ms later ("Update live after Apply").
6. A text's pop (Scale keys) grows around the clip's Anchor Point: set it first on the Anchor page.

## Key points: do not break
- UXP sets a keyframe's interpolation but not its bezier handles, so a custom curve is baked as one key per sequence
  frame between the editor's keys. Premiere's own Linear, Premiere ease and Hold only set the editor's keys (0.10.32).
- Only keys Asistent added (its record, checked again on the clip) are removed, each in a quarter-frame window.
  The editor's keys are never touched. A press above 3000 keys is refused; reversed clips are refused.
- Update live: only the clip last applied, 500 ms after the last change, one Undo step per update, paused when another
  clip is selected, off after Undo last (0.10.72). The clip is matched by media, In point, track and start.
- Motion blur is Asistent's own Transform at the end of the clip's effects. It is found by its Position key times in the
  record, so the editor's own Transform is never changed. Motion keys are never touched (0.10.88).
- Blur limits: the first blur on a clip takes two Undo steps (Premiere adds the effect in its own step). A frame stays
  sharp when the picture grows past about 4x inside the shutter time (Premiere blends it straight).
- After adding the Transform the code waits 60 ms and reads the chain from a fresh handle (a Premiere crash inside UXP
  once followed the add, 0.10.86; BUGS "Open bugs").
- Panel CSS: no grid, gap or transitions. Pointer capture is released by hand (0.10.77). The look needs the user's eye.

## Decisions
- Curves are baked, Premiere's modes are set natively: DECISIONS 2026-11-10 ("Keyframer curves are baked").
- Update live starts only with Apply, one Undo step per update: DECISIONS 2026-11-14.
- Motion blur is an Asistent Transform moving only inside each shutter window: DECISIONS 2026-11-15 (0.10.88).

## Code map
- Panel: `panel/keyframer.js` the page, graph, dock, preview, live update (touches Premiere through the modules below).
- Panel pure: `panel/keyframeplan.js` curves, bake, Elastic / Bounce, after-last-key motion, `shapedFn` (node-tested);
  `panel/blurplan.js` the blur's Transform keys (node-tested).
- Panel Premiere: `panel/premiere-keyframes.js` `readSelection`, `apply`, `undo`, `clipKey`, record `asistent.keyframer.v1`;
  `panel/premiere-blur.js` finds, adds and removes Asistent's Transform.
- Store keys: `asistent.keyframer.curves`, `.live`, `.blur`. No engine endpoint and no host function.
- Test bridge (`panel/devbridge.js`): `keyframer_info`, `fill kfBlurAmount`, `uxp_eval`.

## Status
- Since 0.10.32 (curves), 0.10.33 Elastic / Bounce / repeat, 0.10.68 Custom, 0.10.72 live, 0.10.88 blur and preview,
  0.10.115 the dock. Current build 0.10.120.
- Tried in Premiere 26.5.x through the test bridge (NEW TEST): bake, replace, Undo last, live, blur measured on rendered
  frames, dock measured. The user has used it in Premiere (their requests quote it); a look at the preview, blur controls and
  dock is still open (the dock's buttons staying at the bottom: confirmed by the user 2026-11-21). Latest status line: PROJECT_STATUS 0.10.115 (dock "measured"), 0.10.88 (blur).
- Windows: untested.
- Open: BUGS "Keyframer's record cannot tell Premiere's graphics apart" (`clipKey` is media + In point, so two Premiere
  graphics share a record); blur limit above; the crash of 2026-11-15 not seen again (user, 2026-11-21). Not measured: a sped-up clip (TODO CP leftovers).
- TODO: section N (user checks), CP leftovers.

## Tests
- `tests/keyframeplan.test.js` curves, bake, presets, Custom points, repeat, `shapedFn` for every kind.
- `tests/blurplan.test.js` the blur's keys and limits. `tests/wiring.test.js` the dock sits outside the scrolling page.
