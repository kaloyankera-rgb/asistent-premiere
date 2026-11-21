# In & Out animations, Phase 0 probes

Plan: `../IN_OUT_PLAN.md`. Two halves:

- **Desk half, done 2026-11-21:** what the code and earlier probes already settle (below). Read from the repo; nothing
  was run in Premiere.
- **Live half, run 2026-11-21:** P1-P9 all ran in NEW TEST; scripts in `inout/`, results in the table at the end.

Decision: the owned Transform (DECISIONS 2026-11-21). Phase 1 (`panel/inoutplan.js`) was built before the live half
on the user's word, unit-neutral; the probes changed one line of it (the key base in `times`).

## Desk findings

### Can a second Asistent Transform sit next to the blur's?

The blur recognises its own by its keys: `premiere-blur.js` `findOwn()` (70-82) returns the Geometry2 whose Position key
times equal the record `asistent.keyframer.v1[clipKey].__blur.times` (`premiere-keyframes.js` 133-141).

| Place | What it does | With In/Out's Transform on the clip |
|---|---|---|
| `premiere-blur.js` `prepare` → `findOwn` | finds the blur's own | Safe by construction (blur keys carry sub-frame keys and pins, In/Out keys are per frame, the lists cannot be equal). Not measured: P6. |
| `premiere-keyframes.js` `readSelection` (55-58) | hides the blur's Transform from the property list | **In/Out's keyed parameters would be listed** ("Transform › Position" ...), and the Keyframer could reshape them. Phase 2 needs a hook: skip In/Out's index too. Not in the plan's hook list. |
| `premiere-blur.js` `addOwn` (241-246) | after its append, takes the **last** Geometry2, no ownership check | Right only if the append landed. If it silently did not, "last" is In/Out's (or the editor's): its keys are wiped (`actions`, 266), the record adopts it and `remove` (291) later deletes it. A risk that exists today; smallest guard: Geometry2 count must be exactly +1 after the add. Touches a blur file: needs the user's yes. |
| `premiere-anchor.js` `componentOf('transform')` (21-31) | refuses more than one Geometry2; with exactly one, uses it | With only In/Out's on the clip, the Anchor page's Transform target would edit ours. To be said on the feature page, or guarded. |
| `premiere-exportcheck.js` (`GEOMETRY`), `premiere-stash.js` | read only | Not read in detail: check both in Phase 2. |

Recognition proposed for In/Out: **a tag on the effect plus the record.** A static sentinel in Skew Axis (parameter 6)
with Skew at 0 (should change no pixel; P1 proves the round trip), and a Transform is ours only if it is Geometry2, the
tag matches, and it is not the one `PB.findOwn` returns. The record `asistent.inout.v1` keeps preset, frames and key
times for re-apply and the status line. The record alone is not enough: Fade and Pop presets have no Position keys, two
uses of the same media and In point share a `clipKey` (BUGS: "Keyframer's record cannot tell Premiere's graphics
apart"), and the panel store can be lost.

Text graphics: an effect appended after the Graphic group draws nothing (measured for Tint, `premiere-brand.js`
192-196), so In/Out on text would have to insert before the group, which shifts chain indices that Keyframer records
point at. P9 decides.

### Transform (`AE.ADBE Geometry2`) units and rest values

| Parameter | Known | Status |
|---|---|---|
| Order | Anchor Point, Position, Uniform Scale, Scale Height, Scale Width, Skew, Skew Axis, Rotation, Opacity, Use Composition's Shutter Angle, Shutter Angle, Sampling | Measured (`cockpit-phase0.md` P-A3). UXP names the two shutter controls `""`, hence the `rot + 2` / `rot + 3` fallback in `premiere-blur.js` 56-58. |
| Position, Anchor Point | fractions of the **layer**, 0-1; rest is Position = Anchor (0.5, 0.5) | Measured indirectly (the blur renders right: `blurplan.js` 6, 19-20, `rest()`). |
| Scale | percent, rest 100; Uniform Scale on → Scale Height drives both | Measured (the blur writes 100). |
| Rotation | degrees, rest 0 | Written by the blur; the unit was never isolated. |
| Opacity | found by name, **never written anywhere** | Unknown: 0-100 or 0-1, rest value. |
| Shutter Angle | degrees, capped at 346 (`OPEN_MAX` 0.96) | Measured (DECISIONS 2026-11-15). |

Measured limits (DECISIONS 2026-11-15, `blurplan.js` 28-35): a Scale key past about 400 % makes Premiere blend every
frame straight; Position's path between keys is Premiere's auto bezier, held by a second key 0.01 frame outside each
end; new keys are already Linear, and setting interpolation in the same step adds a key at media time 0 (so it is not
set, and a remove-range guard is kept); wait 60 ms after an add and re-read the chain from a fresh handle.

Nowhere in the repo: whether Transform clips its output to the layer's bounds (a slide or pop on a scaled-down clip),
and whether an attached Transform at rest leaves the picture identical.

### Key times

Trimmed clip: media time, exact (measured, `cockpit-phase0.md` P-A2). Sped-up clip: `step = |speed| / fps`
(`premiere-keyframes.js` 50) is **assumed**, never measured (`keyframer.md` Status, TODO "Phase 0 leftovers").

### Undo

Adding an effect must be its own step (measured, P-A3). Tint (`premiere-brand.js` 228-237, 271-275) appends for all
clips in one transaction, waits, re-reads, then writes all values in one: 2 steps for N clips the first time, 1 on
re-apply. So the plan's "2 then 1" should hold per press, not per clip; no recorded measurement on several clips (P8).

## Live probes (to run)

**Before running:** `ASISTENT_LANE=26 python3 scripts/dev_cmd.py ping` must answer `NEW TEST.prproj`.

Test clips, after the sequence end (the test squares on V3 at 650-890 s, bin "Asistent test", may still do: confirm
with `timeline`): **A** a bright shape on black, nothing under it, 2 s or more, normal speed · **B** A at 200 % ·
**C** A at 50 % · **D** A trimmed (In > 0) · **E** a text made in Premiere · **F1-F3** three more copies of A.

Helpers: `. docs/probes/inout/run.sh` gives `run <body.js> ['const …;']`, `sel`, `shot <seconds> <name>`,
`meas <png>` (numbers only: never open a frame as an image; delete the frames at the end). Bodies: `add.js` (append +
tag), `set.js` (static values), `bake.js` (per-frame Position ramp + shutter), `motion.js` (move the clip with Motion,
returns the old values), `state.js` (read only), `clean.js` (removes only tagged Transforms on the selected clips; effects, never track items).

After every probe, with the same clips selected: `run clean.js` until `removed` is empty, then `state.js` must show the same `chain` as `add.js`
printed in `before`, and `left: 0`. Stop at the first failure and clean up. A Transform that `add.js` reports as
"did not attach" or "not where expected" was never tagged, so `clean.js` cannot see it: take it off by hand.
`motion.js` only on the probe clips A-F.

| # | Question | Steps | Pass |
|---|---|---|---|
| P1 | Attaches, rest values, tag, picture unchanged at rest | A: `shot` + `meas`; `run add.js`; `shot` + `meas` | 12 parameters in the order above, rest values written down (Opacity and Shutter as read), `tag` 17.25, `last` true, `box` / `area` / `grad` identical |
| P2 | Position unit, clipping | `run set.js 'const W={1:[0.75,0.5]};'`; measure; put back 0.5 | `cx` shift = 0.25 × layer width × Motion scale × fit × export scale (± 3 %), `cy` same; note `area` after / before |
| P3 | Rotation, Scale, Opacity units | one `set` each, measure, put back: `{7:45}`, `{3:50}`, `{3:200}`, `{8:50}` | square's `w`, `h` × 1.41 with centre kept → degrees; halves / doubles around the centre; `peak` about half → 0-100 |
| P4 | Pivot and clipping on a clip moved with Motion | `run motion.js 'const MV={Position:[0.3,0.35],Scale:50};'` (keep `old`); baseline; P3's rotation and scale; `{1:[1.0,0.5]}`; restore Motion | centre within 1 px of the baseline; `area` 1.00 while inside the frame (about 0.5 = cropped at the layer's bounds) |
| P5 | Per-frame keys + Shutter Angle really blur | `run bake.js 'const C={f0:5,n:10,x0:0.3,x1:0.7,sh:0};'`; `shot seqT[1]`; again with `sh:180` | 11 keys, `maxErrFrames` < 0.05, linear between keys; at 180° `w` grows by 0.4-0.6 of the per-frame travel and `grad` drops |
| P6 | Blur's Transform + In/Out's on one clip | F1 with two hand-made Motion Position keys: `add.js`, `bake.js`, `state.js`; Keyframer "Read the selected clip" + `keyframer_info`; Apply with blur on; change amount, Apply; blur off, Apply. F2: the reverse order, then "Undo last" | tagged Transform's `posTimes` identical every time, never removed; note whether "Transform › Position" is listed |
| P7 | Key times at 200 %, 50 %, trimmed | A, B, C, D: `add.js`, `bake.js`, `shot` at `seqT[0..3]` | `mediaPerSeq` ≈ `speed`; equal spacing (± 5 %), same three-frame travel as A, end value at frame n + 3 |
| P8 | Undo steps for three clips | F1-F3: `add.js` (2 steps), `bake.js` (1); undo one at a time (`host eval` `qe.project.undo()` is unverified: else the user presses Cmd+Z), `state.js` after each | each undo acts on all three clips at once; re-apply is 1 step |
| P9 | Text graphic | E: `add.js` (append), `set.js` position, measure, clean; then `run add.js "const AT='group';"`, same | which position moves the text; chain strings before and after |

### What forces the Motion fallback

Keep the owned Transform unless: P1 changes the picture at rest or crashes on the add; P2 / P4 show output cropped to
the layer's bounds on a small or Motion-scaled clip (then full-frame clips use the Transform, smaller ones use Motion or
are refused with a message); P9 renders at neither chain position on a Premiere text (titles are the main use: Motion
for graphics); P6 shows damage the hooks above cannot stop.

Not fallback triggers: P5 fails (no blur, or sub-frame keys as `blurplan.js` does), P7 fails (refuse sped-up clips or use
the measured factor), P8 is one step per clip (say the number), the tag fails (record only), Opacity's scale is odd
(use the measured factor).

## Live results (2026-11-21, Premiere 2026, NEW TEST, sequence "SYNC – кам2 (4)")

Run by the live tester through the bridge; no crash in any add, remove, 3-clip batch or undo. Probe clip: a camera clip on
V2 with nothing under or above it (layer 2160x3840, fills the frame); for P4 it was set to Motion Position 0.3/0.35,
Scale 50 and put back. Frames export at 270x480 RGBA; measured by difference against a baseline frame and from the
alpha channel (empty picture = alpha 0), numbers only. Everything was cleaned up: every clip's chain is `Opacity > Motion`
again, nothing tagged is left, the exported frames are deleted, the project was not saved.

| # | Answer | Evidence |
|---|---|---|
| P1 | **Pass.** Attaches last, 12 parameters, the Skew Axis tag round-trips, the picture at rest is bit-identical | max pixel difference 0 before / after; tag read back 17.25; chain back to `before` after `clean.js` |
| P2 | **Pass.** Position = fraction of the layer (x of its width, y of its height) | x 0.75: 68 px of 270 (expected 67.5); y 0.7: 96 px of 480 (exact) |
| P3 | **Pass.** Rotation in degrees, clockwise positive; Scale in percent; **Opacity 0-100**, rest 100 | 45° and 20° fits (IoU 0.997 / 0.999; the opposite sign 0.63 / 0.77); Scale 50 → exactly half, centre kept; Scale 200 → 2.00 ± 0.01; Opacity 50 → alpha 127, 25 → 64, colour unchanged |
| P4 | **Pass.** On a clip moved and scaled with Motion the pivot is the clip's own visible centre, Position is a fraction of the Motion-scaled picture, and **nothing is cropped at the layer's bounds** | rotation and scale keep the centre at (80.5, 167.5) exactly; x 0.75 → +34 px (33.75), x 1.0 → +67.6 (67.5), y 0.75 → +60 (60); area ratio 1.00 with the picture moved past its original rectangle |
| P5 | **Pass.** Per-frame keys land exactly and Shutter Angle blurs them | 11 keys, error 3e-15 frame, linear between keys, no extra key at 0; at 180° the edge smears over 5 px for 10.8 px of travel per frame (0.46; expected 0.4-0.6), max alpha gradient 255 → 48 |
| P6 | **Pass.** The blur's Transform and the tagged one never touch each other, in either order | ours first, then Keyframer Apply with blur on, amount changed, blur off, Apply, Undo last; and blur first, then ours, same steps: the tagged Transform's key times identical after every step, never adopted or removed (its index moves when the blur's goes). The Keyframer **does list and tick** "Transform › Position" from ours: the `readSelection` hook is needed. Per-frame keys were left alone by Apply; sparse keys or a Hold / Premiere-ease curve not tested |
| P7 | **Pass for the step, correction for the base.** `step = \|speed\| / fps` is right at 200 % and 50 %; the key base is `inPt × \|speed\|`, not `inPt` | plain, 200 %, 50 %: x at the four sample frames 0.3815 / 0.5 / 0.6185 / 0.7, identical; trimmed at speed 1: the same when sampled mid-frame; trimmed 200 % (In 2) and trimmed 50 % (In 1): with `inPt` every key missed the visible media (x stuck at 0.7 / 0.3), with `inPt × speed` 0.3815 / 0.50 / 0.62 / 0.7. `readTimeline`'s `outPt − inPt` always equals `end − start` (timeline units) |
| P8 | **Pass.** Per press, not per clip: add = 2 Undo steps for 3 clips (append, tag), keys = 1, re-apply = 1, remove = 1 | `qe.project.undo()` through the host, state read after each step: every undo acted on all three clips at once |
| P9 | **Pass with a condition: insert BEFORE the Graphic group.** Appended after the text, only Position acts | Basic Title MOGRT, chain `Opacity > Motion > Graphic Group > Text`. Append: Position moves the text (+68 px, expected 67.5), Rotation, Scale, Opacity do nothing. Insert at the group's index: Position (+68; y +96), Rotation 45°, Scale 200 / 50 (width 2× / half), Opacity 50 (alpha 218 → 109) all act; per-frame keys land (In 3599.96 s); `clean.js` restores the chain. **Pivot = the frame's centre, not the text's**; the group and the text move one index down while ours is there. A type-tool text clip was not tested |

Rest values read after the add (index, UXP name, value): 0 Anchor Point [0.5, 0.5] · 1 Position [0.5, 0.5] · 2 "" (Uniform
Scale) true · 3 Scale 100 · 4 " " (Scale Width) 100 · 5 Skew 0 · 6 Skew Axis 0 · 7 Rotation 0 · 8 Opacity 100 · 9 ""
(Use Composition's Shutter Angle) true · 10 Shutter Angle 0 · 11 Sampling 0.

What this means for the build: the Transform acts after Motion, around the clip's visible centre, so no anchor
correction is needed; an offset of the sequence frame becomes Position by dividing by the clip's on-screen size as a
fraction of the frame (Motion scale × fit); `o` × 100 is Opacity. The first Apply is **3 steps if the tag is its own
step** (append, tag, keys): write the tag in the same transaction as the keys to keep the plan's 2.

Against "What forces the Motion fallback": none of the four triggers fired. **Decision: the owned Transform**, for
footage and for graphics (DECISIONS 2026-11-21); on a clip with a Graphic group it is inserted before the group.

What Phase 2 has to do because of the second round: key base `inPt × |speed|` (now in `inoutplan.times`); on graphics
insert before the group and set Anchor Point (and Position with it) to the text's centre for scale and rotation presets;
hide the tagged Transform from the Keyframer's list; sample mid-frame in tests. The same base probably applies to the
Keyframer's own keys on a clip that is both trimmed and sped up (BUGS, not measured there).

Notes from the runs: the active sequence changed once while the tester was reading (not by the tester): `pre.js` takes an
optional `const SEQ='name';` guard. `shot` prints the exact path (`<stamp>_<n>_dev_<name>.png`); `meas` only suits a
bright shape on black: footage and Opacity are measured on the alpha channel (`cv2.imread(f, -1)`).

Test material left in NEW TEST (saved): sequence **"Asistent probe – In Out"**, V1: plain clip 0-9 s, trimmed (In 2)
14-21 s, 200 % 24-28.5 s, 50 % 36-45 s, two clips with two Motion Position keys 60-69 s and 72-81 s, 50 % with In 1
101-109 s; V2: a Basic Title text 90-95 s. How they were made, for Phase 2's tests: `createSequenceFromMedia`;
`SequenceEditor.createOverwriteItemAction` (frame-aligned ticks); `createSetInPointAction` (head trim, moves the start);
speed only through the host's QE `item.setSpeed(speed, "00;00;00;00", false, false, false)` (clips at even QE indices);
text with `insertMogrtFromPath` and Premiere's own Basic Title; Keyframer buttons through `kfclick.js` (the bridge's
`click "Apply"` hits the Anchor page's button). More helpers in `inout/`: `mkkeys.js`, `kfdom.js`, `untick.js`,
`both.js`, `vals.js`, `motion_read.js`.

## Open questions for the user

- May Phase 2 add two small protective hooks in existing files: the `+1` count check in the blur's `addOwn`, and
  `readSelection` skipping In/Out's Transform (P6 showed the Keyframer lists and ticks ours)?
- Strength on the presets where it changes nothing (feature page).
