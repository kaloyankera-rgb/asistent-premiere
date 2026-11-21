# Asistent: In & Out animations

## Context

The user watched the Easify 4 tutorial (youtube `riu3gr7amqA`, 14:22-16:55) and wants the same idea in Asistent:
ready-made **in** and **out** animations for the selected clips, with **separate preset lists for in and for out**,
that play as smoothly in Premiere as they would in After Effects.

What the video shows (seen in the frames, confirmed by the captions):
- A grid of transition presets: Slide, Glide, Whip, Slam, Anticipate, Overshoot, Elastic, Bounce, Slide Fade, Fly In.
  Small icons on each card show which properties it animates (position, scale, rotation, opacity).
- Apply to **In**, **Out** or **Both**; slide presets also ask for the edge they come from.
- The animation's length is shown on the clip and can be changed; a curve editor per property
  (Position, Scale, Rotation, Opacity) with "save as new preset".
- From 15:53: constant wiggle effects (Shake, Impact, Handheld). **Out of scope** (user's choice).

Decisions the user made in this session:
- Scope: in/out animations only.
- Controls: **simple controls first** (presets, in/out/both, direction, duration, strength);
  the per-property curve editor and own presets are a **later phase** of this same plan.
- Handover: after approval, save this plan as a doc in `tools/asistent/docs/` for a Claude session in VS Code.

## Why Premiere is not smooth today, and the fix

Measured facts already in the repo (`docs/probes/cockpit-phase0.md` P-A1, `DECISIONS.md:555`):
UXP can set a key's interpolation mode (Linear, Bezier, Hold) but **cannot set bezier handles**. So an
AE-style curve cannot be written as two keys. The Keyframer already solves this by **baking one key per
sequence frame**; an in/out animation is 4-30 frames, so baking is cheap and gives the exact AE curve,
including Elastic and Bounce.

The second half of "AE smooth" is **motion blur**. Asistent already has it (`panel/premiere-blur.js`,
0.10.88): its own Transform effect (`AE.ADBE Geometry2`) with "Use Composition's Shutter Angle" off.

## Approach

All paths below are under `tools/asistent/`. New feature = new files, smallest hooks in existing ones
(`../COCKPIT_PLAN.md` rules 13-60).

**Where the keys go: an Asistent-owned Transform effect on each clip** (recommended; confirm in Phase 0).
- The editor's own Motion and Opacity keys are never touched (permanent Keyframer rule).
- Position, Scale, Rotation and Opacity all live in one effect, and its Shutter Angle gives motion blur
  with no extra work.
- Removing the animation = removing that one effect, so the feature stays removable on its own.
- Fallback if Phase 0 shows a blocker: write to Motion + Opacity only when those properties have no
  keys, and refuse (with a message) when they do.

**Timing.** In starts at the clip's first frame; Out ends on its last frame. Key times are media seconds:
`inPt + frame * step`, `step = |speed| / fps` (same maths as `premiere-keyframes.js:44-84`). If
in + out is longer than the clip, both are shortened in proportion and the panel says so. Reversed clips
are refused, as in the Keyframer.

**Several clips.** Applies to every selected video clip in one transaction (the Keyframer only takes the
first; Tint and Anchor show the multi-clip pattern).

### New files
- `panel/inoutplan.js` (pure, Node-tested): preset tables and the maths.
  - `IN_PRESETS` and `OUT_PRESETS` are two separate tables. Each preset:
    `{id, name, props: [{prop: "pos"|"scale"|"rot"|"op", from|to, curve}], directional}`.
    Out presets have their own ease-in curves; they are not mirrored ins.
  - First set, grouped by what moves (the user asked for rotation and pop variations):
    - **In, position:** Slide, Glide, Whip, Overshoot, Elastic, Bounce, Drop (from the top, lands with a bounce).
    - **In, scale (pop):** Pop (0.6 → 1, overshoot), Pop Soft (0.85 → 1, no overshoot), Pop Elastic,
      Pop Bounce, Slam (large → 1, hard stop), Zoom In (0 → 1, expo out).
    - **In, rotation:** Spin In (full turn, settles), Swing (tilt ±12° that overshoots and settles),
      Twist Pop (scale + quarter turn), Roll In (slide + rotation in the travel direction).
    - **In, opacity:** Fade, Slide Fade, Pop Fade.
    - **Out, position:** Slide, Whip, Anticipate (small pull back, then out), Drop.
    - **Out, scale:** Shrink, Pop Out (grows slightly, then collapses), Zoom Out (grows + fades).
    - **Out, rotation:** Spin Out, Twist Shrink, Roll Out, Swing Out.
    - **Out, opacity:** Fade, Slide Fade.
  - Every preset is one table row, so adding a variation later is a data change with a test, not new code.
  - Rotation presets take a turn direction (clockwise / counter-clockwise); Strength scales travel
    distance, overshoot amount, scale range and rotation angle together.
  - `plan({clip, inPreset, outPreset, inFrames, outFrames, direction, strength})` returns per-property
    baked keys `[{t, v}]` plus rest pins, and refuses above the existing `MAX_KEYS`.
  - **Reuse** the curves in `panel/keyframeplan.js`: `PRESETS` beziers (lines 6-13), Elastic/Bounce
    (48-116), `bake()` (335-350), `shapedFn()` (398-449). Do not copy them.
- `panel/premiere-inout.js`: reads the selection with `P.readTimeline` (`premiere.js:145`), adds or finds
  the owned Transform, writes keys, removes.
  - **Reuse** from `premiere-blur.js`: `transformMatch()` (34), `transformParams()` (42-65), the
    add-then-re-read pattern in `addOwn()` (232-249), the value/time-varying actions (254-287), and the
    measured limits (Scale keys under 400 %, Position pins at each end).
  - Keys are created inside the `transaction()` callback (`premiere.js:32-42`), label
    "Asistent: In/Out animation".
  - A record per clip in panel store key `asistent.inout.v1` (which effect is ours, which preset,
    frames) so Remove and re-apply only ever touch our own effect. Re-applying replaces our keys.
- `panel/inout.js`: the page. Mounted like the other pages
  (`require("./inout.js").mount({ $, el, button, enable, bindTips, premiere })`).
- `tests/inoutplan.test.js`, and a feature page `docs/features/in-out.md` from `_TEMPLATE.md`.

### Hooks in existing files
- `panel/index.html`: a `paneInOut` div and one more `div.btn.mside` under Motion (248-255).
- `panel/main.js`: entries in `PANES` and `MOTION` (256-299) and one mount line (2138-2155).
- `scripts/package_ccx.sh`: add the three new panel files (a wiring test checks this).
- `panel/devbridge.js`: an `inout_info` read for the live tester, like `keyframer_info` (632).

### Page layout (simple controls)
Built from `kf-card` divs; panel CSS rules apply (no grid, gap or transitions; buttons are `div.btn`;
a tooltip on every button).
- **In** list: "None" + the in presets as small buttons under short group labels (Position, Scale,
  Rotation, Opacity), one highlighted.
- **Out** list: "None" + the out presets, grouped the same way, one highlighted.
- Direction (left, top, bottom, right), shown only when a picked preset is directional.
- Turn (clockwise, counter-clockwise), shown only when a picked preset rotates.
- In frames, Out frames, Strength %, Motion blur on/off.
- **Apply** and **Remove** in the dock. In only, Out only or Both simply follows which rows are not "None".
- Status line: how many clips, how many Undo steps (see below).

**Undo.** Adding the effect has to be its own step ("a detached component shows no parameters"), so the
first apply on a clip is 2 Undo steps and a re-apply is 1. The panel says the number, as the rule requires.

## Phases (one verified, committed task each)

0. **Probe**, through the test bridge in NEW TEST only. Answers go in `docs/probes/`:
   - Transform's Position, Rotation and Opacity units and rest values; baked keys + Shutter Angle
     really blur; rotation and scale happen around the clip's visible centre (anchor) on a clip the
     editor has already moved or scaled with Motion.
   - Can a second Asistent Transform sit next to the blur feature's Transform without either feature
     mistaking the other's? How does `premiere-blur.js` recognise its own today?
   - Key times on a sped-up clip (not measured yet, per `keyframer.md`).
   - Undo step count for several clips at once.
   - Decide: owned Transform (recommended) or the Motion fallback. Record it in `DECISIONS.md`.
1. `inoutplan.js` + Node tests (curve shape per preset, one key per frame, trimmed and sped-up clip,
   in + out longer than the clip, key cap).
2. `premiere-inout.js`: apply, re-apply, remove, record. Live test through the bridge.
3. The page, the hooks, packaging, wiring tests. One look by the user in Premiere.
4. **Built in 0.10.130:** the motion blur toggle (since Phase 3) and a small preview of the picked preset (`panel/inoutpreview.js`, the Keyframer's technique). Not yet installed or bridge-tested.
5. **Later:** per-property curve editor (reuse the Keyframer's editor in `keyframer.js`) and
   "Save as new preset" into store key `asistent.inout.presets`, same shape as
   `asistent.keyframer.curves`.
6. Each phase closes with the usual paperwork: version bump in `panel/manifest.json` and
   `engine/asistent/config.py`, CHANGELOG, PROJECT_STATUS, TODO, BUGS, PROGRESS, INDEX row.
   Push only on the user's yes.

`../DEV_WORKFLOW.md` counts this as Complex: ask the user before starting the agent chain
(architecture-planner, feature-builder, test-runner, live-tester, rules-reviewer, release-clerk).

## Rules that bind this feature
- One press = one Undo step where Premiere allows; otherwise the panel says how many.
- Never touch the editor's own keys, Motion, or their own Transform; never remove track items; nothing
  runs by itself; additive files only; independent of Quick Search.
- Premiere tests only in TEST / NEW TEST; never open files into the user's Premiere.
- A new version needs a Premiere restart; the bridge cannot see the panel, so layout needs the user's look.

## Verification
- `node --test tests/*.test.js` (412 pass today, plus the new ones).
- pytest in a scratch HOME (command in the Asistent CLAUDE.md) to confirm nothing else moved.
- Bridge, NEW TEST: pick a clip, `click` Apply with Overshoot in / Fade out, then read the chain and
  check as numbers: one owned Transform, keys = frames + pins per property, first key at the clip's In,
  last out key on the last frame, values match `plan()`; Remove leaves the chain as it was; the editor's
  Motion keys are unchanged before and after.
- Repeat on a trimmed clip, a sped-up clip, three clips at once, and a clip shorter than in + out.
- The user's look in Premiere: playback next to the same preset in the sample, with motion blur on and off.

