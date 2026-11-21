# In & Out animations

<!-- Status: Phase 2 built (0.10.127): apply, re-apply, remove through the test bridge; installed on the dev Mac, not released, no page yet. Plan: docs/IN_OUT_PLAN.md. Probes: docs/probes/inout-phase0.md. -->

## What it does
Planned Motion tab feature: pick an In and/or Out animation for the selected video clips (Position, Scale, Rotation, Opacity
presets, as in Easify 4). Phase 2 (0.10.127) is the Premiere side only: each clip gets one Asistent-owned Transform with baked
keys, one per sequence frame, and the effect can be removed again. The page does not exist yet (Phase 3).

## How to use it
Not from the panel yet. Through the test bridge (`inout_apply`, `inout_remove`, `inout_info`, test projects only): select clips,
give the preset ids, frames, direction, turn, strength, blur flag. Remove takes the owned Transform off again.

## Key points: do not break
- The editor's own Motion, Opacity and own Transform are never written or removed. A Transform counts as ours only when its Skew
  Axis holds TAG (17.25) with Skew 0 (`isTagged`); an untagged one is never adopted.
- Only Asistent's tagged effect is removed; no track item is removed; nothing runs by itself.
- The blur's Transform and ours never touch each other, in either order (`premiere-blur.js` `addOwn` refuses a tagged one).
- The Keyframer does not list or reshape our keys (`premiere-keyframes.js` `readSelection` skips the tagged Transform).
- Undo: first Apply 2 steps for any number of clips, re-apply 1, Remove 1. The result says the number.
- Key times: `inPt × |speed| + f × |speed| / fps` (`inoutplan.times`), measured on a 200 % clip (P7).
- Scale above about 400 % blends straight (`blurplan.SCALE_MAX`); pins at each end of a key run.
- Non-finite keys are never written; a clip whose Motion scale is 0 or tiny is skipped for position presets, with a reason.

## Decisions
- Owned Transform, not Motion (DECISIONS 2026-11-21, after probes P1-P9). On a clip with a Graphic group it goes before the group.
- Hooks in existing files (built on the user's go-ahead 2026-11-21, "continue"): the blur's `addOwn` needs the Transform count to
  rise by exactly one; the Keyframer's `readSelection` skips In/Out's tagged Transform. No change when the blur's add works.
- Open (the user's word needed): Strength changes nothing on In Slide, Whip, Fade, Zoom In and Out Slide, Whip, Drop, Shrink, Fade
  (a clip that must start or end fully off screen cannot travel less). `needs().strength` lets the page grey it out.
  At Strength 200, In Bounce's first hop goes all the way back off screen before landing.

## Code map
- `panel/premiere-inout.js` (Phase 2): `apply(project, opts)` (add the effect in one step, then tag and keys in one transaction),
  `remove(project)`, `info(project)`, `isTagged`, `TAG`; record `asistent.inout.v1` per clip, keyed by `clipKey`.
- `panel/inoutplan.js` (pure): `IN_PRESETS` (20), `OUT_PRESETS` (13), `plan()` one row per frame with pins and the key-cap error;
  `times()`; `find`, `groups`, `animates`, `needs`, `defaultFrames`; Phase 2 additions `boxOf`, `exitDistance`, `edgeOf`,
  `transformKeys` (frame rows to Transform values from the clip's on-screen box, rotation in the clip's own rotated axes),
  `capCheck`, `boxUsable`, `MIN_SIZE`.
- Hooks: `panel/premiere-blur.js` (`addOwn`), `panel/premiere-keyframes.js` (`readSelection`), `panel/devbridge.js` (3 commands),
  `scripts/package_ccx.sh` (packs both new modules).
- Not yet built: `panel/inout.js` (Phase 3 page), Phase 4 blur toggle and preview, Phase 5 curve editor.
- Probes: `docs/probes/inout-phase0.md`, scripts `docs/probes/inout/`.

## Status
- Phase 0 (0.10.125): probes P1-P9 ran in NEW TEST. Units: Position = fraction of the layer, Scale %, Rotation degrees clockwise,
  Opacity 0-100; no crop at the layer's bounds; blur works; safe next to the blur's Transform.
- Phase 1 (0.10.124-0.10.125): `inoutplan.js`, Node-tested.
- Phase 2 (0.10.127): built, installed on the dev Mac, bridge-tested in NEW TEST ("Asistent probe – In Out"), 13 checks passed:
  key values match the maths on plain, trimmed, 200 %, 50 % clips and a Basic Title graphic; frame 0 fully off screen and the
  landing bit-identical to the baseline; Undo 2 / 1 / 1 on three clips; blur smears by half the per-frame travel; In + Out longer
  than the clip shortened; small off-centre clip exits fully and lands exactly; refusals write nothing.
  Rotation conversion measured at 30° and re-checked live on five rotated clips (30°, 30° off-centre, 90°, −45°, 15° larger than the frame; 25 runs): travel along the screen axis within 0.5 px, fully off screen at frame 0, lands exactly.
- Not verified by the user: how the motion looks (the bridge reads numbers only). No page yet, so nothing in the panel UI changed.
- Open: Phase 3 page (TODO IO), Strength question above, a type-tool text clip not probed. Limits: BUGS.md "In & Out animations, Phase 2".

## Tests
- `tests/inoutplan.test.js` (21): the preset tables and shape, groups and page helpers, finite rows in range, In starts on the
  first frame and rests at the end, Out ends on the last frame, direction and turn, Strength, scale clamp, In + Out longer than the
  clip, meeting on one frame, key cap and bad input, frame rounding, `times()`.
- `tests/inoutkeys.test.js` (new in 0.10.127): the Transform maths (`boxOf`, `exitDistance`, `transformKeys`, capCheck, boxUsable).
- Node suite 451 pass at 0.10.127 (433 at 0.10.125). Python: 954 pass, 24 skipped (scratch HOME, run before the last fixes; no
  Python changed). Live test material: NEW TEST, sequence "Asistent probe – In Out".
