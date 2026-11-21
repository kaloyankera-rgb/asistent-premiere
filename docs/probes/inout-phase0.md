# In & Out animations, Phase 0 probes

Plan: `../IN_OUT_PLAN.md`. Two halves:

- **Desk half, done 2026-11-21:** what the code and earlier probes already settle (below). Read from the repo; nothing
  was run in Premiere.
- **Live half, NOT RUN YET:** Premiere held a client project on 2026-11-21, so no probe ran. The scripts are in
  `inout/` and have only been syntax-checked, never executed. Results go in the table at the end.

The owned-Transform-or-Motion decision is **not made** until the live half is in. Phase 1 (`panel/inoutplan.js`) was
built first on the user's word, unit-neutral, so no live answer can invalidate it.

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
| P3 | Rotation, Scale, Opacity units | one `set` each, measure, put back: `{7:45}`, `{3:50}`, `{3:200}`, `{8:50}` (if the shape vanishes: `{8:0.5}`) | square's `w`, `h` × 1.41 with centre kept → degrees; halves / doubles around the centre; `peak` about half → 0-100 |
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

## Live results

| # | Answer | Evidence |
|---|---|---|
| P1-P9 | not run | |

## Open questions for the user

- Clips A-F in NEW TEST: are the old test squares still there, or will new ones be prepared?
- May Phase 2 add two small protective hooks in existing files: the `+1` count check in the blur's `addOwn`, and
  `readSelection` skipping In/Out's Transform?
