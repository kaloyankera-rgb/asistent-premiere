# Tracker

Deep reference with the algorithm, accuracy tables and the hard-case benchmark: `docs/TRACKER.md` (175 lines). This page
is the short summary. Read the reference before changing `tracker.py`.

## What it does
Motion tab > Tracker. The editor boxes an object on a frame, Asistent follows it through the clip, and then either a
text or logo gets Position keys so it follows the object ("Attach selected"), or the tracked clip itself gets Position
keys so the object stays put on screen ("Lock to it"). Each frame is marked sure, unsure, lost or not tracked.

## How to use it
1. Select the clip and press "Load frame" (the frame at the playhead). Drag a box around an object with some detail,
   with a little background around a plain one. The golden handles on the timeline set the range.
2. Press Track. Stop keeps what is tracked. "Track from here" and "Track back from here" go on from a tracked frame, or
   fix a bad stretch when a new box is drawn on it.
3. Attach: select the text or logo, press "Attach selected" (Position; Scale and Rotation when ticked). One Undo step.
4. Lock: press "Lock to it" on the tracked clip (Smooth, Centre it and Zoom options). One Undo step.
5. "Detach" takes the tracker's own keys off the selected clip. The viewer has - / Fit / + and Move; Alt + click zooms.

## Key points: do not break
- A lost frame gets no key and reports the last measured place, never a guessed path. Wrong keys are worse than red
  frames (DECISIONS 2026-11-15). Unsure frames still get keys. Frames not tracked (outside the range, after Stop) get none.
- Keys are the measured positions, no smoothing; Lock's Smooth is optional (a 6-frame Gaussian sigma).
- Never over keys of the editor's own: Attach and Lock are refused over Position (and Scale / Rotation) keys in that time.
  The tracker's own earlier keys are replaced, found by its record in the store (`asistent.tracker.v1`).
- The tracked source clip is only read. Lock's Zoom is skipped when the clip's Scale is keyframed (the panel says which).
- Colour helps only footage in colour and never picks the object up again after a loss on colour alone (0.10.77).
- Every frame is decoded at one per timeline frame with the frame at each time first (a test pins this, 0.10.51).
  One run tracks at most 9000 frames (`tracker.py` `MAX_FRAMES`).
- Premiere passes no scroll to panels (no scroll zoom). A press that reaches another element still presses the button
  under it; pointer capture is released by hand (0.10.77). Panel CSS limits apply (no grid, gap, transitions).
- Layout is chosen by the clip's real shape (`trackplan.layoutFor`); nodes are moved, not rebuilt, so handlers stay.
- One point with scale and turn only. No corner pin: a flat sign turning in depth stays within about 1 to 2 px.

## Decisions
- Placed box first, no smoothing, no key where lost: DECISIONS 2026-11-11 ("the tracker follows a placed box first").
- Say unsure or lost rather than guess: DECISIONS 2026-11-15 ("the tracker says unsure or lost rather than guess").
- Colour as a gate, not a pick-up rule: DECISIONS 2026-11-15 ("the tracker uses colour, but never picks an object up again").

## Code map
- Panel: `panel/tracker.js` the page (viewer, timeline, zoom, transport). Pure, node-tested: `panel/trackplan.js` (the
  tracked point through Motion, `attach`, `lock`, `merge`, `boxAt`, `viewport`, `layoutFor`).
- Panel Premiere: `panel/premiere-tracker.js` `readSource`, `attach`, `lockClip`, `detach`, `seek`, `motionParams`.
- Engine: `engine/asistent/tracker.py` (`RegionTracker`, `track`, `preview`, `thumbs`); endpoints `/tracker/frame`,
  `/tracker/track` (a job), `/tracker/thumbs` and `/jobs/<id>/stop` in `server.py`.
- Host: none besides `as_add_tracks` (only when a clips stash or a tracked layer needs room).
- Benchmarks: `scripts/bench_tracker.py`, `scripts/bench_tracker_hard.py`. Test bridge: `tracker_box`, `tracker_info`.

## Status
- Since 0.10.51 (engine, Attach), 0.10.54 Lock, 0.10.55-0.10.58 the page, 0.10.64 range and Stop, 0.10.73-0.10.75 zoom
  and layout, 0.10.76 hard cases, 0.10.77 colour. Current build 0.10.120.
- Tried in Premiere 26.5.2 through the test bridge on a synthetic 4K clip: within 0.5 px in Premiere's own frames, scale
  and rotation right, Detach and the refusal over the editor's keys checked. The user ran it on a real clip (their ball
  recording, 2026-11-15); the engine scored 13 of 57 hand-marked ball frames followed, 4 off, 40 lost. Latest status
  line: PROJECT_STATUS 0.10.77. Not yet confirmed by the user: Track and Stop acting on the first press.
- Windows: untested (the OpenCV wheel exists, not run there).
- Open limits: bending shapes, objects the colour of their surroundings moving fast, no corner pin (docs/TRACKER.md "Limits").
- TODO: section N (user checks), CP A3 / A3b "Later if wanted" (Stabilise, 9:16 reframe on a face, corner pin).

## Tests
- `tests/test_tracker.py` accuracy, lost and found again, range, Stop, endpoints, the hard cases, colour scenes.
- `tests/trackplan.test.js` attach, lock, merge, going on, zoom maths, layout.
