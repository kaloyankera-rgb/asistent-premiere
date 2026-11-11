# Cockpit plan, Phase 0 probes (2026-11-10, Premiere 26.5.2 on the Mac, NEW TEST.prproj)

Plan: `../../../COCKPIT_PLAN.md`. Run by Claude through the test bridge (temporary panel module `probe-cockpit.js`, removed
after Phase 0) and the host's ExtendScript `eval`. Every write was on C0738 in "SYNC – кам2" of NEW TEST and was put back in
the same run. Note: this Mac now runs 26.5.2, like the PC, so the plan's "26.0.2 on the Mac" no longer holds.

| Probe | Answer | Evidence |
|---|---|---|
| P-A1 keyframe interpolation | **Partly.** `ComponentParam.createSetInterpolationAtKeyframeAction` exists with `Constants.InterpolationMode` BEZIER, HOLD, LINEAR, TIME, TIME_TRANSITION_START/END. No call sets bezier handles (influence, speed). | `cockpit_probe names` on Motion > Position. A `Keyframe` has only `position` and `value`. |
| | So: Premiere's own ease / linear / hold can be set natively (few, editable keys); a custom curve (Expo Out, Overshoot, the user's own) is baked into one key per frame. Also available: `createRemoveKeyframeRangeAction`, `findNearest/Next/PreviousKeyframe`, `getValueAtTime`. | |
| P-A2 keyframe time base | **Trimmed clip: media time, exact.** Keys asked at In + 0.5 s and In + 1.5 s (C0738, In 3.904 s) landed at 4.4039 / 5.4039; `getValueAtTime` read the second key's value (40). Restored (no keyframes left). | `cockpit_probe kfwrite` (Opacity). Position is a `PointF` of the frame (0-1), as `premiere-placement.js` already writes it. |
| | **Sped-up clip: not measured** (no sped-up clip in NEW TEST). To check in the Keyframer build on a test sequence. | |
| P-A3 other effects from UXP | **Yes.** `VideoFilterFactory.createComponent` + `createAppendComponentAction` attach Tint (`AE.ADBE Tint`) and the new Transform (`AE.ADBE Geometry2`, which ExtendScript cannot pick); `createRemoveComponentAction` removes them. A detached component shows no parameters: read them after attaching. | `cockpit_probe attach` |
| | Tint: Map Black To, Map White To (Color), Amount to Tint. A colour is accepted only as `new ppro.Color(r, g, b, a)` (arrays and plain objects: "Illegal Parameter type"); reading it back gives an opaque object, so the build checks the written colour on a frame. Transform: Anchor Point, Position (2 values), Uniform Scale, Scale Height/Width, Skew, Skew Axis, Rotation, Opacity, Shutter Angle, Sampling. | |
| | No Fill effect in this Premiere (Tint covers "colour a logo"). No pitch effect found through `AudioFilterFactory` by name (Perfect Pitch is out of scope anyway). Third-party: Impact Crop / Stroke (Impact plug-ins) are installed here, not on every computer. | |
| P-A4 Premiere's mask tracking by script | **Not answered:** no mask on the test clip, and ExtendScript lists only Opacity (Opacity, Blend Mode) and Motion parameters. Needs one mask drawn and tracked by hand in NEW TEST. Bonus only; the tracker does not depend on it. | host `eval` on C0738's components |
| P-A5 Stash of clips | **Likely yes (not run):** ExtendScript has `Sequence.createSubsequence`, `Sequence.exportAsProject`, `Project.importSequences` (and QE `importProject`). A selection can become a small project file and come back in another project. Also seen: `Project.applyLumetriPreset`, `Project.setLogColorManagement`. | host `eval` reflect on Sequence and Project |
| P-A6 pointer events in the panel | **Yes.** One real 45 s drag by the user: `pointerdown/move/up` (and the mouse events) fire on inline SVG and on an absolutely positioned div, with `offsetX/Y` inside the element; `setPointerCapture` exists. A curve editor with draggable handles and a target box on a frame can be built. | `cockpit_probe pointer`: SVG 9 down / 1636 move / 9 up, box 8 / 1510 / 7 |
| P-A7 trackers in OpenCV 5.0.0 | **TrackerMIL** (no model files), plus DNN trackers DaSiamRPN, Nano, Vit (need model downloads). No CSRT / KCF in this build. Core: `calcOpticalFlowPyrLK`, `matchTemplate`. Synthetic moving target, 640x360: MIL median 1.0 px, max 7.2 px, 72 ms a frame (about a minute for 30 s of 25 fps); Lucas-Kanade exact and fast. Plan: optical flow with template refresh, MIL as a fallback. | engine venv |
| P-Q1 (Quick Search) adjustment layer | **No direct create:** QE project (26.5.2) has newBarsAndTone, newBlackVideo, newColorMatte, newTransparentVideo, newUniversalCountingLeader, no adjustment layer. Route: import one from a tiny template project (`importProject` / `importSequences`), to test in the Quick Search build. | host `eval` reflect on `qe.project` (read only; Quick Search itself not touched) |

Still open before the builds: P-A4 (one mask, optional), P-A2 on a sped-up clip, P-Q2/P-Q3 (placement and
whether the layer's Transform comes along: Quick Search session), P-Q4 (WebView2 on the PC).

## 2026-11-11: P-Q1 to P-Q3 answered (NEW TEST, Premiere 26.5.2, through the Asistent host's ExtendScript `eval`)
- **P-Q1 YES, by a generated template.** No API creates an adjustment layer, but one can be imported: QE
  `newBlackVideo(w, h, fps, 1, 1)` -> `createNewSequenceFromClips` -> `Sequence.exportAsProject` gives a small project; in its XML
  the Black Video's `<MasterClip>` gets `<IsAdjustmentLayer>true</IsAdjustmentLayer>` BEFORE `<Name>` (the layout of a real
  adjustment layer, read from a purchased editing pack's project) and the frame rate in ticks (29.97: 8475667200).
  `Project.importFiles([that .prproj], true, bin)` imports it with no dialog (plus its holder sequence).
  Proof by numbers on an exported frame (fx31028 under it): with the layer on V2 the picture is unchanged (saturation 34.3,
  luma 163.1; a plain Black Video would have covered it); Black & White on the layer only -> saturation 0.0. A Transparent
  Video with the same flag (first try, flag after `<Name>`) did NOT work: saturation unchanged.
- **P-Q2 YES:** `videoTracks[n].overwriteClip(item, seconds)` places it; its length is the item's In / Out.
- **P-Q3 not needed:** effects go on the placed track item (QE `addVideoEffect` by name, as Quick Search already does).
- Left in NEW TEST: bin "Quick Search test" (layers, holder sequences), sequences "QS AL test" and "QS AL test 2".

## 2026-11-11: P-A5 Stash of clips answered (bridge `clone_probe`, temporary)
- **Clips can cross sequences, effects included:** UXP `SequenceEditor.getEditor(target).createCloneTrackItemAction(item from
  another sequence, offset, videoTrackOffset, 0, true, false)` placed both adjustment-layer clips of "QS AL cmd test" V2 into
  "QS AL test 2" at the same times, with Opacity, Motion, Black & White, Transform in the source's order (overwrite: it replaced
  what was under it). Keyframes not checked yet.
- With `Sequence.exportAsProject` (seen in the Quick Search probe) a selection can be saved exactly and brought back:
  Save = clone the selected clips into a temporary sequence -> exportAsProject into `<app>/stash/clips/`; Apply = importFiles of
  that project into a bin -> clone its clips into the active sequence at the playhead (flat clips, not a nest).
- Open decision for the user: the temporary sequence (on Save) and the imported one (on Apply) are Asistent's own, but the
  permanent rule says the host removes nothing without the user's approval of that specific deletion. Delete them, or keep
  them in a bin "Asistent stash"?

