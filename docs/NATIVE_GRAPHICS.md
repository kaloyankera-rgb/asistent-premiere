# Native Premiere text graphics for subtitles: what Premiere 26.0.2 lets a script do

The user's request (2026-11-08): an optional subtitle output as native, editable Premiere text graphics, styled
automatically from the client's saved style; no MOGRTs, no After Effects templates, no rendered text, no burn-in.
Probed on 2026-11-08 in NEW TEST.prproj (Premiere 26.0.2, the same version as the 2026-11-04 probes) through the test
bridge. Raw results: [probes/native-graphics-2026-11-08.json](probes/native-graphics-2026-11-08.json).

## Result: not possible by script in Premiere 26.0.2
| Operation | Supported? | Evidence |
|---|---|---|
| Create a native text graphic | No | No UXP or ExtendScript call creates one; the only graphic-creating calls are MOGRT (`importMGT`, `insertMogrtFromPath/Library`), excluded. No command for "Upgrade Caption to Graphic" (2026-11-04). |
| Read a graphic's text | No | ExtendScript: Source Text reads as one character (code 380), Premiere's binary text document cut at the first zero byte. UXP: `getStartValue()` is null, no `getValue`. |
| Write a graphic's text | No | ExtendScript `setValue("…", true)` returns true and reads back the string, but the graphic then draws nothing (frame: 650 lit pixels before, 0 after); two JSON forms likewise 0. UXP `createKeyframe(text)` did not write (2026-11-04). |
| Font, size, fill, stroke, shadow, background, alignment | No | Not exposed as parameters: the Text component exposes only Transform-type values (Position, Scale, Rotation, Opacity, Anchor) and unnamed flags. |
| Position, scale, rotation, opacity | Yes | Text component and Motion parameters are plain numbers/points; Motion > Position written with `PointF` in one Undo step (2026-11-04). |
| Timing (start/end) | Yes for existing clips | `createSetStartAction` / `createSetEndAction` on track items (UXP). |
| Reuse a styled graphic without changing it | Clone exists, not useful | UXP `createCloneTrackItemAction` exists (not run), but a clone keeps the original text and the text cannot be written. |
| Rename a clip (ownership tag) | Yes (API present) | UXP `createSetNameAction`. |
| Group edits into one Undo | Yes | One transaction per press (Position probe; project rule). |
| Style captions by script | No | UXP `CaptionTrack` has no style or text write; Track Styles are applied by hand. |

So the "Native graphics" output mode is NOT built: it would need text writing, which Premiere 26.0.2 does not offer to
scripts. MOGRTs are not used as a substitute (the user's rule). The existing ReShape caption workflow is unchanged.

## The fewest manual steps (today's workflow, unchanged)
1. Asistent places the exact Bulgarian (and English) lines on caption tracks (one press, as now).
2. The editor applies the client's saved caption Track Style once (Properties > Track Style), which restyles all lines.
3. Only if real graphics are wanted: select the lines, right-click > Upgrade Caption to Graphic (one step).
4. Planned (TODO R.5): Asistent moves upgraded lines off faces (Position, one Undo), the part a script can do.

## Side effect of the probe
The probe graphic in NEW TEST ("SYNC – кам2", V1 at 390 s, "Your Title Here") now draws nothing: three Source Text writes.
Edit > Undo three times in NEW TEST should bring it back (not checked: Claude does not press Undo in Premiere); or delete it, it was only a probe.

## When to probe again
A Premiere update (the published UXP types start at 26.2 and may add text graphics). Re-run the P1 write probe (see the
JSON) on a fresh title on black in NEW TEST and compare lit pixels before/after; until a write changes the drawn text to
the written text, the answer above stands.
