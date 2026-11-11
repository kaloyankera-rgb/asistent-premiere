# Motion tracker (Cockpit plan A3, 0.10.51-0.10.53)

The user (2026-11-11): "we need to be able to track objects perfectly and track text/objects to things while they are moving
like it's in After Effects". Panel page **Tracker**; engine `tracker.py`; maths `panel/trackplan.js`; Premiere side
`panel/premiere-tracker.js`.

## How it works
1. **Load frame**: the selected clip's file at the playhead (upright, 640 px) in the panel.
2. The editor drags a **box** around the object.
3. **Track**: the engine decodes the clip's media range at one frame per timeline frame (FFmpeg `fps` filter, half a source
   frame of lead so the frame AT each time is the first kept; a 4K file at half size) and follows the box forwards and
   backwards from the boxed frame. Per step: Lucas-Kanade flow from the last motion with a forward-backward check and a
   RANSAC similarity (move, scale, turn); then the prediction is corrected by matching the FIRST frame's region (inner 80 %
   of the box) in the current frame warped to the predicted pose, sub-pixel peak, scale and angle refined on the template;
   both poses (the points' and the last frame's) are tried at three places (flow, constant motion, last place); not sure
   -> a wide coarse-to-fine search. A second template adapts to a change of look (taken every 4 frames while sure, or while
   unsure when flow and match agree within 1.5 px). Confidence = match score: sure >= 0.80, unsure >= 0.45, lost below
   (the flow alone never carries a frame: it can follow the background). No smoothing.
4. **Attach selected**: the selected text / logo / clip gets one Position key per tracked frame (Scale and Rotation when
   ticked), keeping its offset from the point on the boxed frame: `P = S + R(turn)·grow·(P0 − S0)`, with S the point mapped
   through the source clip's Motion (Position, Scale, Rotation, Anchor, Scale to Frame Size, keyframed or not). One Undo
   step. Lost frames get no key. Refused over Position / Scale / Rotation keyframes of the editor's own in that time; the
   tracker's own earlier keys are replaced (record in the panel store). **Detach** takes the tracker's keys off.

5. **Lock to it** (0.10.54): the tracked clip's own Position keys, `Position = T − R·scale·fit·(p − Anchor)` per frame, T the
   object's place on the boxed frame (or the centre). Smooth: a Gaussian path (sigma 6 frames). Zoom: the smallest Scale
   factor (steps of 0.5 %, up to 4x) that leaves no frame uncovered. Verified: the object on the same pixel in full-size frames.

6. **The page (0.10.55)**: live preview while tracking; afterwards a viewer (box, path coloured by state, readout) and a
   timeline (scrub, states, confidence curve, seconds, boxed frame, playhead) with transport and problem jumps, Premiere's
   playhead following. A bad stretch: draw a new box on one of its frames, Track from here / back from here replaces only
   that part (scale and angle continue from the nearest sure frame). 0.10.57 restyled it as a dark workspace (own `--tr-*`
   tokens, violet accent on the next step's button, Track and Apply cards, state chips on the viewer, a ruler and
   confidence-height runs on the timeline); behaviour unchanged.

## Accuracy (scripts/bench_tracker.py, synthetic, error against the known path)
| Scene | Median | Max | Notes |
|---|---|---|---|
| plain move over a panning background | 0.025 px | 0.044 px | |
| +50 % growth, 40° turn | 0.012 px | 0.020 px | scale within 0.02 %, angle within 0.01° |
| blur + light change | 0.011 px | 0.032 px | |
| 12 frames covered | 0.012 px | 0.020 px | exactly those 12 frames lost, picked up again |
| 45 px / frame with sudden reversals | 0.002 px | 0.005 px | |
| 70 px / frame + motion blur | 0.013 px | 0.019 px | |
| change of look | 0.004 px | 0.014 px | |
| turning away in depth 30° / 55° / 70° | 0.44 / 0.76 / 0.95 px | 0.83 / 1.32 / 1.75 px | perspective, at the real centre |

About 7 ms a frame at 1280x720 on this Mac (M-series); a 4K file: 180 frames in 4.6 s including decoding.

## Verified in Premiere 26.5.2 (NEW TEST, sequence "Tracker test", 2026-11-11)
Synthetic 4K vertical clip (`<app>/testmedia/track-test.mp4`, known path) with a keyframed punch-in 100 -> 115 % on V1, a
red square on V2 placed 300 px above the object on frame 60:
- Track from frame 60: 180 frames sure; frame 0 at 700.002, 1399.884 (true 700, 1400).
- Attach (Position): 180 keys; full-resolution frames (QE exportFramePNG) put the square within 0.25-0.50 px of the true
  spot (the measurement's own step is 0.5 px), the punch-in followed.
- Attach (Position + Scale + Rotation): the square's angle -8.33 / 0 / +8.33 / +16.53° as the object's (clockwise, sign
  right), size within 0.6 px, centre with the turning offset within 0.4 px.
- Attaching again replaced the tracker's own 180 keys; Detach took all of them off; Attach over one Position key of the
  editor's was refused with nothing changed.

## Limits (say so in the panel and here)
- One point (with scale and turn); no corner pin / perspective: a flat sign turning in depth stays within about 1-2 px.
- An object fully hidden is marked lost (red, no keys); it is found again when it comes back in view.
- A plain area without detail cannot be tracked (the panel says to box something with detail).
- Not tried by the user on real footage yet.
