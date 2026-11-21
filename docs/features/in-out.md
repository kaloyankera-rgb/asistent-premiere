# In & Out animations

<!-- Status: Phase 0 probes done and Phase 1 maths built (0.10.125); not wired, not installed. Plan: docs/IN_OUT_PLAN.md. Probes: docs/probes/inout-phase0.md. -->

## What it does
Motion tab, planned: pick an In animation and an Out animation for the selected video clips (Position, Scale,
Rotation, Opacity presets, as in Easify 4), with direction, duration (frames) and Strength. Apply writes baked keys, one
per sequence frame, into an Asistent-owned Transform effect. Nothing is in the panel yet.

## How to use it
Not yet. Planned: 1. select clips. 2. pick In and/or Out (None = skip). 3. direction, turn, frames, Strength. 4. Apply.
Remove takes the owned Transform off again.

## Key points: do not break
- The editor's own Motion and Opacity keys and their own Transform are never touched (Keyframer rule).
- Only Asistent's tagged effect is removed; no track items are removed; nothing runs by itself.
- Unit-neutral so far: `inoutplan.js` assumes no Premiere units. Position, Rotation and Opacity units are unmeasured
  until probes P1-P4 run (`docs/probes/inout-phase0.md`).
- Sped-up clips: key times assumed `|speed| / fps`, not measured (P7).
- Measured limits to reuse: Scale above about 400 % blends straight (`blurplan.SCALE_MAX`); pins at each end of a key run.

## Decisions
- Owned Transform, not Motion: decided 2026-11-21 after probes P1-P9 (DECISIONS). On a clip with a Graphic group it goes before the group; the pivot there is the frame's centre, so the Anchor Point moves to the text for scale and rotation presets.
- Open (the user's word needed): Strength changes nothing on presets that must start or end fully off screen (see Status).
  Also to look at with it: at Strength 200, In Bounce's first hop goes all the way back off screen before landing.

## Code map
- Panel: `panel/inoutplan.js` (pure): `IN_PRESETS` (20), `OUT_PRESETS` (13), `plan()` one row per frame with pins,
  key-cap error; `times()` frame to media seconds; `find`, `groups`, `animates`, `needs`, `defaultFrames` for the page.
  Curves reused from `keyframeplan.js`, scale cap from `blurplan.js`.
- Not yet built: `panel/premiere-inout.js` (Phase 2), `panel/inout.js` (Phase 3).
- Probes: `docs/probes/inout-phase0.md`, scripts `docs/probes/inout/` (P1-P5, P8 run 2026-11-21).

## Status
- Since 0.10.124. Phase 0 done in 0.10.125: probes P1-P9 ran (units: Position = fraction of the layer, Scale %, Rotation degrees clockwise, Opacity 0-100; no crop at the layer's bounds; blur works; Undo per press; safe next to the blur's Transform; key base `inPt × |speed|`). Not tested: a type-tool text clip.
- Phase 1 (`inoutplan.js`): built and Node-tested, outside Premiere. Not wired, not installed, not in the zip.
- Phase 2 (apply, remove, record): not started. Phases 3-5: TODO IO.
- Open questions: (a) owned Transform or Motion fallback, after the probes; (b) Strength on presets that cannot travel less
  (In Slide, Whip, Fade, Zoom In; Out Slide, Whip, Drop, Shrink, Fade), departs from the plan's "Strength scales travel
  distance"; `needs().strength` lets the page grey it out; (c) may Phase 2 add two protective hooks in existing files (blur's
  `addOwn` count check; Keyframer's `readSelection` skipping In/Out's Transform); (d) the Anchor page would edit In/Out's
  Transform when it is the only one on the clip; (e) test clips A-F in NEW TEST for the probes.
- Open bugs and limits: none recorded in `BUGS.md` for this feature yet. TODO section IO.

## Tests
- `tests/inoutplan.test.js` (21): the two separate tables and their shape, groups and page helpers, every preset gives
  finite rows in range, In starts on the first frame and rests at the end, Out ends on the last frame, direction and turn,
  Strength (travel, overshoot, scale, rotation, Bounce / Drop hops, `needs().strength`), scale clamp, In + Out longer than
  the clip, In + Out meeting on one frame, In only / Out only / Both, key cap and bad input, frame rounding, `times()`.
- Node suite 433 pass at 0.10.125 (412 before the feature). Python unchanged (954 pass, 24 skipped). Live test material: NEW TEST, sequence "Asistent probe – In Out".
