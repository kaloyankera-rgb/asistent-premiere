# Next steps (ordered by priority)

Work rule for every step: implement → tests → bump version (manifest + config) → `scripts/release_mac.sh` →
ask the user to try in `TEST.prproj` → read `engine.log` → commit → update `PROJECT_STATUS.md`.

## A. Fix known bugs
Done in 0.9.9 (Volume scale, `/color/probe` docstring).

## B. Colour engine, per `COLOR_CORRECTION_PLAN.md` (current focus of the user)
1. **Probe: done and verified at 0.9.13** (results in `PROJECT_STATUS.md`). Still to confirm: one real apply +
   render check (`color check` lines in the log).
1b. **Exposure shoulder**: Lumetri Exposure gives +1 stop in shadows but ~0.7 at skin brightness; convert the
   wanted stops at the measured brightness into Exposure units with the probe curve (store it next to the
   slider calibration), then confirm with the render check.
2. **Analyse timeline renders, not source files** (T13, T18): export the clip's frames from the active sequence
   (several moments, skip moments covered by upper layers) and run `decide()` on them; fall back to source
   frames only with status REVIEW_NEEDED. This makes re-runs idempotent.
3. **Colour management / double transform (T12)**: for log clips compare the timeline render with the source
   decoded as Rec.709 and as S-Log3→709; if Premiere already converts, measure as Rec.709 and never add a
   transform; unknown → REVIEW_NEEDED. Read `getInputLUTID`/`getEmbeddedLUTID` into the record.
4. **Statuses + audit log**: ALREADY_BALANCED / CORRECTED / REVIEW_NEEDED / REVERTED / BLOCKED / FAILED, one
   JSON record per clip and operation (format in `docs/color-spec/03_ANALYSIS_AND_QA.md`), stored in the engine
   data folder; show the status in the panel.
5. **Accept / revert**: save exact prior values and keyframe state of every touched parameter, apply, export,
   re-measure, revert to the saved values when any gate worsens (new clipping, neutral residual, skin, cast,
   continuity). Report Undo steps.
6. **Managed correction ownership**: our own Lumetri instance per clip, identified by the audit log (values we
   wrote); update it with absolute values (idempotent); never touch a manual grade (T14).
7. **Split operations into independent buttons**: White Balance, Exposure (exists combined), then Contrast and
   Saturation (only if the probe shows them writable and measurable), Skin Tones (global only unless local
   tools exist → PARTIAL/BLOCKED), Shot Match (same scene: groups from sync or the selection; match measured
   differences, never copy values), Auto Color (runs only justified modules in the spec order).
8. **Tests per the matrix** `docs/color-spec/05_TEST_MATRIX.csv` (T01–T18): engine tests with synthetic frames
   where possible, a Premiere checklist for the rest; results recorded, nothing claimed without running.
9. **Exposure taste**: ask the user for 3–5 clips they corrected by hand; fill `06_REFERENCE_TEMPLATE.json`-style
   records; compare suggestions to their values and tune the skin target (now 0.62).

## C. Still to verify from earlier phases
„Изравни фразите“, one Undo (audio), „Раздели R/L“, auto-import speed.

## D. Later phases
5 Client profiles + Prepare Project (in the office; draft in `profiles.py`/`prepare.py`; Basecamp paste),
7 Bulgarian subtitles, 8 rough-cut markers + export QA, 9 Windows (run `setup_win.ps1`, silent install with
UnifiedPluginInstallerAgent on Windows, test there), manual sync for short clips, sub-frame audio alignment.
