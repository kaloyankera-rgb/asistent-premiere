# Next steps (ordered by priority)

Work rule for every step: implement → tests → bump version (manifest + config) → `scripts/release_mac.sh` →
ask the user to try in `TEST.prproj` → read `engine.log` → commit → update `PROJECT_STATUS.md`.

## A. Fix known bugs
Done in 0.9.9 (Volume scale, `/color/probe` docstring).

## B. Colour engine, per `COLOR_CORRECTION_PLAN.md` (current focus of the user)
0. **Auto Shot Match: face-aware since 0.9.30, verified by the user at 0.9.32 on the GStroy pairs (more clients: on request)**
   Open: the „Цвят“ single-clip exposure (`color.py`) still finds skin by colour box: give it the same faces.
   (user's priority, 2026-11-01). Then the remaining independent buttons (item 7). Skin brightness (9) and
   S-Log3 / colour management (3) are parked by the user.
1. **Probe and exposure curve: done** (0.9.13-0.9.14, see `PROJECT_STATUS.md`). Confirm with the user: one
   „Приложи“ at 0.9.14 on a clip with skin; the „color check“ line should show `exposure_after` near 0.
   Done 12:29 (skin 0.14 stop short at 1.7 units). Measured step-back verified 12:40 (C0739: 4.4 % → 3.08 %).
   Soft tolerance + region-aware verdict done in 0.9.17. The first check keeps stepping back at anything over
   3.00 % (user, 2026-11-01); the tolerance applies only to the final result.
   Also measure darkening (Exposure −1) in the probe so the curve covers both directions.
2. **Analyse timeline renders: built in 0.9.18** (T13, T18). Confirm in Premiere: „Цвят“ on a clip already
   corrected by Asistent should say „Мерено на таймлайна“ and suggest nothing; a clip under a title/adjustment
   layer should fall back with REVIEW_NEEDED.
3. **Colour management / double transform (T12)**: for log clips compare the timeline render with the source
   decoded as Rec.709 and as S-Log3→709; if Premiere already converts, measure as Rec.709 and never add a
   transform; unknown → REVIEW_NEEDED. Read `getInputLUTID`/`getEmbeddedLUTID` into the record.
4. **Statuses + audit log: built in 0.9.26** (`color_audit.jsonl`, status next to each clip).
5. **Accept / revert: built in 0.9.26** (white/exposure gates on the final check; clipping is not a gate). Still
   open from the spec: keyframe state of touched parameters (none are keyframed by Asistent) and continuity
   between clips of one scene (with Shot Match).
6. **Managed correction ownership: built in 0.9.24** (fingerprints in `managed.json`). Confirm in Premiere:
   „Приложи сигурните“ (white only) → „Цвят“ → „Приложи и средните“ adds the exposure to the same Lumetri;
   touching any Lumetri slider by hand → the next apply leaves the clip alone.
7. **Split operations into independent buttons**: White Balance, Exposure (exists combined), then Contrast and
   Saturation (only if the probe shows them writable and measurable), Skin Tones (global only unless local
   tools exist → PARTIAL/BLOCKED), Shot Match (same scene: groups from sync or the selection; match measured
   differences, never copy values), Auto Color (runs only justified modules in the spec order).
8. **Tests per the matrix** `docs/color-spec/05_TEST_MATRIX.csv` (T01–T18): engine tests with synthetic frames
   where possible, a Premiere checklist for the rest; results recorded, nothing claimed without running.
9. **Exposure taste** (fx39027: skin on target yet 6.4 % of the skin clipped, target 0.62 may be too bright): ask the user for 3–5 clips they corrected by hand; fill `06_REFERENCE_TEMPLATE.json`-style
   records; compare suggestions to their values and tune the skin target (now 0.62).

## C. Still to verify from earlier phases
„Изравни фразите“, one Undo (audio), „Раздели R/L“, auto-import speed.

## D. Later phases
5 Client profiles + Prepare Project (in the office; draft in `profiles.py`/`prepare.py`; Basecamp paste),
7 Bulgarian subtitles, 8 rough-cut markers + export QA, 9 Windows (run `setup_win.ps1`, silent install with
UnifiedPluginInstallerAgent on Windows, test there), manual sync for short clips, sub-frame audio alignment.
