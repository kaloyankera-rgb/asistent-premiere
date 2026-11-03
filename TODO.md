# Next steps (ordered by priority)

Work rule for every step: implement → tests → bump version (manifest + config) → `scripts/release_mac.sh` →
ask the user to try in `TEST.prproj` → read `engine.log` → commit → update `PROJECT_STATUS.md`.

## A. Fix known bugs
Done in 0.9.9 (Volume scale, `/color/probe` docstring).

## B. Colour engine, per `COLOR_CORRECTION_PLAN.md` (current focus of the user)
0. **Auto Shot Match: face-aware since 0.9.30, verified by the user at 0.9.32 on the GStroy pairs (more clients: on request)**
   „Цвят“ single-clip exposure uses the same faces since 0.9.33 (verify in Premiere: one „Приложи“ on a clip with a face and one with OSB only).
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
7. **Split operations into independent buttons** (0.9.58: Бяло, Експозиция, Авто цвят and „Изравни POV-тата“ done and node-tested, to be tried in TEST.prproj; Contrast/Saturation stay inside Shot Match, no single-clip algorithm exists): White Balance, Exposure (exists combined), then Contrast and
   Saturation (only if the probe shows them writable and measurable), Skin Tones (global only unless local
   tools exist → PARTIAL/BLOCKED), Shot Match (same scene: groups from sync or the selection; match measured
   differences, never copy values), Auto Color (runs only justified modules in the spec order).
8. **Tests per the matrix** `docs/color-spec/05_TEST_MATRIX.csv` (T01–T18): engine tests with synthetic frames
   where possible, a Premiere checklist for the rest; results recorded, nothing claimed without running.
9. **Exposure taste** (fx39027: skin on target yet 6.4 % of the skin clipped, target 0.62 may be too bright): ask the user for 3–5 clips they corrected by hand; fill `06_REFERENCE_TEMPLATE.json`-style
   records; compare suggestions to their values and tune the skin target (now 0.62).

## C. Still to verify from earlier phases
„Изравни фразите“, one Undo (audio), „Раздели R/L“, auto-import speed.

## C2. Phase 7 subtitles (user's current focus, 2026-11-01)
Plan: `docs/SUBTITLES_PLAN.md`. Done: M0 probes (0.9.39), M1 text core (0.9.40), M2 ASR + model (0.9.41; Mac 2.8x real time), M3 dialogue mix + `/subtitles` job + panel section (0.9.42, engine verified end to end on a real clip).
**Next (0.9.48):** (Z) user presses the button on a new video, checks the panel's „Провери / Чуй“ list against the sound and tells which flags were useful and which were noise; the places C9025 0:00.3-0.9 and 0:12.3-12.8 (voiced, no word) and „Така.“ 0:10.5 need a listen; (Y) decide on per-speaker gender metadata (needs speaker separation); older:  (A) user tries the corrections box (Корекции и имена) on real projects and gives the places where timing is still off (time + early/late) and reports remaining wrong words; (B) a second ASR model is not worth it (large-v2 tested, worse, see DECISIONS.md); (C) M4: click-to-edit list in the panel instead of typing correction lines; (D) Windows: host install + CEP path. Older (0.9.45) list: (0) USER: close and reopen Premiere once (loads the Asistent host), open TEST.prproj, press „Субтитри (български)“; then the end-to-end placement test through the bridge (`dev_cmd.py host ping|probe`, check caption format constant, track count, item times vs the SRT) and the first-run settings in `host.jsx`; (0a) decide whether Asistent may delete its own old caption track from ExtendScript (probe first), otherwise the editor deletes it; (0b) M4 text correction in the panel (the words still flagged: „нища“, „десом“, „свършила“); (0c) Windows: host install script + CEP path on the PC. Older list: (1) done 2026-11-01: the button works in `TEST.prproj`, frame size read, duplicates skipped; still open: the user judges accuracy/timing and says whether 4-word captions from glued function words are too long for 9:16 (rule in `subtitles.py` `_attach_function_words`); (1a) 0.9.44: user presses the button again (words per piece, new grouping). DECISION NEEDED: install the aligner (`scripts/setup_mac.sh --align`, ~2.1 GB, weights CC-BY-NC) or keep Whisper times, or evaluate a permissive alternative (e.g. stable-ts); copy the already downloaded weights instead of fetching again if a test venv still exists; (1b) 0.9.43: user presses the button again on the same selection and judges the words; answers whether captions are early or late (and by how much) so timing can be fixed: a fixed offset if systematic, else forced alignment (MMS_FA, needs OK for ~1-2 GB torch); (2) M4 review + import: result list with flags, „Внеси в проекта“ = `importFiles` into bin „Субтитри" (one Undo) + drag hint; (3) „Имена и термини“ field saved per project in `subtitles.json` → Whisper prompt (engine already takes `terms`); (4) Windows CUDA run; (5) M5/M6 per `docs/SUBTITLES_PLAN.md`.

## D. Later phases
5 Client profiles + Prepare Project (in the office; draft in `profiles.py`/`prepare.py`; Basecamp paste),
7 Bulgarian subtitles, 8 AI Auto Rough Cut (plan: `docs/ROUGHCUT_PLAN.md`, next step M0 = probes in TEST.prproj: XML import from code, trimming, markers; `rapidfuzz` needs the user's OK) + export QA, 9 Windows (run `setup_win.ps1`, silent install with
UnifiedPluginInstallerAgent on Windows, test there), manual sync for short clips, sub-frame audio alignment.

## P8. Rough cut (plan `docs/ROUGHCUT_PLAN.md`)
Done: M0 probes, M1 speech map, M2 Safe/Smart pauses (0.9.59). Next: (1) USER: press „Груб монтаж“ in TEST.prproj and judge the cuts by ear/eye; (2) M3 takes (`takes.py`, `rapidfuzz` needs the user's OK; difflib first) + the „Преглед“ view; (3) M4 `takescore.py` and Smart takes, `scripts/eval_roughcut.py` against the user's own rough cut XML; (4) M5/M6 optional items.

## T. Housekeeping (documentation)
T1. Refresh `BUGS.md`: last fully reviewed at 0.9.18; fold in findings from 0.9.19-0.9.41 (see `PROJECT_STATUS.md`, `PROGRESS.md`) and drop fixed items.
