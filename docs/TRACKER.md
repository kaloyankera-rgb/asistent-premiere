# Motion tracker (Cockpit plan A3, 0.10.51-0.10.53; hard cases 0.10.76)

The user (2026-11-11): "we need to be able to track objects perfectly and track text/objects to things while they are moving
like it's in After Effects". Panel page **Tracker**; engine `tracker.py`; maths `panel/trackplan.js`; Premiere side
`panel/premiere-tracker.js`.

## How it works
1. **Load frame**: the selected clip's file at the playhead (upright, 1280 px since 0.10.73, 640 before) in the panel.
2. The editor drags a **box** around the object.
3. **Track**: the engine decodes the clip's media range at one frame per timeline frame (FFmpeg `fps` filter, half a source
   frame of lead so the frame AT each time is the first kept; a 4K file at half size) and follows the box forwards and
   backwards from the boxed frame. Per step: Lucas-Kanade flow from the last motion with a forward-backward check and a
   RANSAC similarity (move, scale, turn); then the prediction is corrected by matching the FIRST frame's region (inner 80 %
   of the box) in the current frame warped to the predicted pose, sub-pixel peak, scale and angle refined on the template;
   both poses (the points' and the last frame's) are tried at three places (flow, constant motion, last place); not sure
   -> a wide coarse-to-fine search. A second template adapts to a change of look (taken every 4 frames while sure, or while
   unsure when flow and match agree within 1.5 px). Confidence = match score: sure >= 0.80, unsure >= 0.45, lost below
   (the flow alone never carries a frame: it can follow the background). No smoothing. 0.10.76 reworked this step for
   small, blurry, low-detail and fast objects: see "Small, blurry, low-detail and fast objects" below.
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

## Range, Stop and going on (0.10.64)
The timeline shows the whole clip once a frame is loaded; two golden handles set the range to track (Premiere's playhead
follows a handle). Stop ends a run and keeps what is tracked; frames not tracked come back with state "none" (no key, not lost).
Track from here / back from here on a tracked frame go on with the box the tracker had there (`trackplan.boxAt`, the part's
scale and angle continue that frame's, `merge(..., null)`), up to the range's end / start; with a new box they fix a stretch.

## Layout by the clip's shape (0.10.75)
The viewer is sized for the loaded file's real shape (the engine's `display_size`, never the sequence). Two layouts are sized
(`trackplan.layoutFor`) and the larger picture wins: stacked (viewer, then timeline, Track and Apply; a vertical clip may use
62 % of the page's height) or side by side (viewer card as wide as the picture on the left, timeline / Track / Apply in a column on
the right; only for shapes narrower than 1.2:1 and when the picture grows by 25 %). Landscape always stacks. Chosen on Load
frame and on a panel resize; the nodes are moved, not rebuilt, so every handler and the box geometry stay as they are.

## Zoom in the viewer (0.10.73)
The user (2026-11-14): "an option to zoom in/out of the preview in the tracker". − / Fit / + in the viewer's bottom-right
corner (1, 1.5, 2, 3, 4, 6, 8×; + from Fit zooms in on the tracked point or the box). The viewer keeps its size: the frame and
its overlay (box, path, crosshair) are drawn larger and shifted together (`trackplan.viewport`), so a box drawn while zoomed
lands on the same object. Stepping or playing a track keeps the tracked point in sight (`trackplan.follow`). Load frame asks
the engine for 1280 px on the long side (was 640). 0.10.74: a Move button (drag moves instead of drawing a box), Alt + drag and the middle button move too, Alt + click zooms in where clicked (Alt + Shift + click out), and the line "Alt + click: zoom · Alt + drag: move" under the viewer while zoomed. Measured: Premiere 26.5.3 passes no scroll to the panel at all (wheel / mousewheel, viewer, page, document), so there is no scroll or pinch zoom.
when zoomed. Relies on UXP clipping the zoomed picture to the viewer (`overflow: hidden`): the user's look decides it.

## Small, blurry, low-detail and fast objects (0.10.76)
The user (2026-11-14): "accurately track small, blurry, low-detail and fast-moving objects ... Evaluate accuracy using actual
frame-by-frame target positions ... When reliable tracking is impossible, clearly identify uncertainty instead of generating
inaccurate keyframes." The engine step was reworked inside `RegionTracker` (the panel, the data it gets and the keys are as
before; only the small-box hint changed). What changed, each from a failure measured in `scripts/bench_tracker_hard.py`:

| Change | Why (measured on 0.10.75) |
|---|---|
| The template is matched over the whole area the object can have reached, every place weighed by its distance from where its motion puts it (capped, so a clearly better match farther away still wins); the second-best place is kept | a look-alike passing 34 px away took the track for 14 frames |
| Nearly as good a second place = ambiguous: never sure; a far place, or one where a look-alike seen earlier is expected, only when sure and alone; else the place the motion allows (unsure) or lost | jumps to the twin; a fully covered object "found" 125 px away as unsure |
| Sure means clearly better than the background around the object matched on the boxed frame (threshold raised up to 0.95), and the score is judged against what the picture's noise allows | a motion-blurred streak matched a smooth background patch at 0.99: 144 of 150 frames sure, up to 1135 px off; low contrast in noise: correct but every frame unsure |
| Weak evidence (blur-only match, smeared template not clearly alone, fallen back, ambiguous) more than 3 frames in a row = lost | chains of unsure frames sliding onto the background |
| Small objects matched magnified (up to 2x, cubic); boxes under 48 working pixels tracked on the file's own pixels (a 4K file is no longer halved for them) | a 24 px object on 4K: median 0.115 px, now 0.045 |
| Scale and angle only when the object shows them (its edges across / along the radius); a tight box around a plain thing uses the whole box (its outline is its only detail); a smooth thing is matched with the slow shading taken out | a round blob's angle wandered 40 degrees and its scale to 1.33, dragging the position 2-6 px |
| Blurred frames: the template smeared along the motion, or blurred like the frame (focus); at most unsure on that alone | |
| The adapting template is renewed only on sharp, sure frames that look like its last look (not on the boxed look's score) | renewed on the background after a blurred stretch; then followed the background |
| Flow points seeded only where the object surely is, so the flow is an independent witness | re-seeded points agreed with a wrong place |
| Lost: the search goes on from the last place seen, wider by the object's usual speed each frame, with the boxed look and up to 8 kept sure looks; picked up again only on a sure match standing alone, after the pose is refined | a curving object out of a 12-frame occlusion was never found again |
| A lost frame reports the last place measured, not a guessed path (still no key) | |

Hard benchmark (`scripts/bench_tracker_hard.py`, 1280x720, 150 frames each, error of every frame against the true centre).
WRONG = sure or unsure frames more than max(2 px, a quarter of the object) off (a key in the wrong place); MISSED = lost while
fully visible.

| Scene | 0.10.75 sure-frame error med / max, WRONG | 0.10.76 sure-frame error med / max, WRONG, lost |
|---|---|---|
| 12 px textured, panning background | 0.028 / 0.065 px, 0 | 0.027 / 0.061 px, 0, 0 |
| 6 px textured | 0.084 / 0.253 px, 0 | 0.044 / 0.104 px, 0, 0 |
| soft opaque blob, smooth background | 0.891 / 29.46 px, 1 | 0.470 / 1.686 px, 0, 0 |
| soft blob: busy / big / small | 0.280 / 1.154 / 0.135 px median, 0 | 0.298 / 0.502 / 0.191 px median, 0, 0 |
| 16 px at 15-35 px a frame, motion blur | 0.362 / 391.6 px, 17 | 0.258 / 3.07 px, 2 (unsure), 4 |
| 20 px at up to 65 px a frame, texture like the background (not separable: measured, it matches no better at its true place than the background nearby) | 545.7 / 1134.9 px, 144 | 0.98 / 1.96 px, 2, 142 |
| 24 px, out of focus (sigma 4) and back | 0.069 / 1.036 px, 0 | 0.086 / 0.936 px, 0, 0 |
| 16 grey levels in noise 4 | (every frame unsure) 0 | 0.252 / 0.794 px, 0, 0 (all sure) |
| half covered 16 frames, fully 8 | 0.101 / 0.200 px, 8 | 0.036 / 0.325 px, 0, exactly the 8 |
| identical look-alike passing 17-37 px away | 0.034 / 34.0 px, 14 | 0.028 / 0.144 px, 0, 0 (21 unsure while overlapping) |
| 100 px textured (regression) | 0.048 / 0.092 px, 0 | 0.047 / 0.092 px, 0, 0 |

The older benchmark below is unchanged (occlusion: exactly the 12 covered frames lost, angle 0.37 degrees off on the first frame
after; tilt 55 / 70 degrees: max 1.34 / 1.74 px, as before). A 4K file with a 24 px object (encoded, through `track`): median
0.045 px, max 0.085 (0.10.75: 0.115 / 0.270), 38 ms a frame with decoding (51); hidden 25 frames on 4K: exactly those lost, found
again at once, 8 ms a frame. Tests: 10 new in `tests/test_tracker.py` (tiny, soft blob, fast with blur, focus, low contrast,
look-alike, covered, the honesty scene, scale/angle kept, working size). Installed engine (Premiere 2026 Mac): the test clip
`track-test.mp4` 180 sure, frame 0 at 700.002, 1399.886 (true 700, 1400); a 40 px box there tracked at 2160x3840.

Still to see: real footage (a finger, a ball). Fast objects with motion blur get more orange (unsure) frames than before: they get
keys, but a sure frame now has to be clearly the object.

## The object's colours (0.10.77)

The user's first real test, a dribbled basketball (1080x1920 stock clip, screen recording 2026-11-15), went red after eight
frames; re-run, the grey template followed the ball onto the player's dark shorts and called 16 frames sure there, and the box
shrank to 0.72 of the ball in ten blurred frames. Normalised grey correlation ignores brightness and colour, so a plain ball
looks like any patch with the same shading.

| Change | Why (measured) |
|---|---|
| Colour model: the object's colours (ellipse in the box) against a ring around it and the whole picture; a colour never seen counts as background; colour footage only, used while it sets the object apart | the shorts were taken for the ball; the court, never in the ring, first scored above the ball itself |
| Every candidate weighed by its lack of the object's colours and colour spot (centre-surround of its size); hardly any: no candidate, no rival | an arm (template 0.62) beat the blurred ball (0.45) |
| Jumps and pick-ups after a loss only onto a colour spot; the first frame after a loss unsure; sure only with nearly all its colours | a background patch 440 px away matched at 0.84 and was called sure; sure on the shorts as the ball crossed them |
| Spots of its colours searched too where the template cannot follow; a spot alone near the motion keeps a weak frame unsure | fast drops of the ball |
| An unsure frame changes size and angle by at most 1 % and 1 degree | the 0.72 drift (0.5 % and 2 % measured worse on the focus test) |
| Colours learnt on sure frames (surroundings fast, the object slowly) | the object moving into shade |

Scored against the ball's centre marked by hand on every third frame of the first shot (57 frames, off = more than 30 px, the
ball is about 100 px across):

| | on the ball | off | lost |
|---|---|---|---|
| 0.10.76 | 4 | 3 | 50 |
| 0.10.77 | 13 | 4 (2 of them 30-36 px, at its edge; all orange) | 40 |

The remaining losses are the low fast bounces, where the ball, the shadowed court and the player's skin are one colour: there
it says red rather than guess. A two-frame pick-up after a loss reached 32 ball frames but with 9 off (court corners, the head):
rejected. The clip is a montage; after its first cut the ball is in other shots, and the track is lost there, as it should be.

Synthetic colour scenes (tests): a dribbled orange ball with motion blur crossing a dark area next to a grey disc exactly as
bright: grey alone wrong on 99-130 of 150 frames (or 101 lost) over six scenes, with colour 0 wrong and 0 lost; the ball into
shade (half the brightness): 0 lost. Grey footage (the benchmarks) gets no colour model: both benchmarks unchanged. Cost: about
55 ms a frame on the 1080x1920 clip (35 before), mostly while lost.

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
- A plain area without detail cannot be tracked (the panel says to box something with detail). A plain object with an
  outline (a ball, a fingertip) can (0.10.76): box it with a little background around it.
- Something that bends (a finger curling) changes shape: the move/scale/turn template does not follow a bend; expect unsure
  or lost frames there and fix them with a new box.
- When the object looks like its surroundings and moves faster than its own size each frame, nothing tells it apart: the
  tracker says lost or unsure rather than guess (0.10.76).
- A plain object the colour of its surroundings (a basketball low over a brown court, against brown skin) is lost while it
  is there; colour helps only where it differs (0.10.77).
- Tried by the engine on one real clip (the user's basketball); not yet by the user in Premiere after 0.10.77.
