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

## W. Windows and updates (0.9.87)
1. USER / PC session: on the Windows PC unzip the release and double-click `Install Asistent (Windows).cmd`; open Premiere twice
   (host, font); check the panel and the engine; then one update from the panel once a newer release exists.
2. The first GitHub release (`scripts/publish_release.sh`) when the user says so; afterwards every installed panel offers updates.
3. Windows: Shot Match / colour frames and the subtitle GPU path are still untried there (CUDA wheels in setup).

## D. Later phases
5 Client profiles + Prepare Project (in the office; draft in `profiles.py`/`prepare.py`; Basecamp paste),
7 Bulgarian subtitles, 8 AI Auto Rough Cut (plan: `docs/ROUGHCUT_PLAN.md`, next step M0 = probes in TEST.prproj: XML import from code, trimming, markers; `rapidfuzz` needs the user's OK) + export QA, 9 Windows (run `setup_win.ps1`, silent install with
UnifiedPluginInstallerAgent on Windows, test there), manual sync for short clips, sub-frame audio alignment.

## R. Subtitles in the reference style (ReShape; started 2026-11-04, the user's current priority)
Spec: `docs/SUBTITLE_STYLE.md` (two layers: Bulgarian chunks word by word in Montserrat Bold with a soft shadow at ~48 % height; English
phrase line under it, Arial-like bold on a ~60 % maroon rounded box; 1-2 frame fade-in). User decisions so far: Premiere's own text
graphics (captions -> the editor's one right-click "Upgrade Caption to Graphic" -> Asistent's "Move off faces"); English that matches the
Bulgarian words and still makes sense; local translator NLLB-200 600M (downloaded, 623 MB, `<app>/models/nllb-600m-int8`); Montserrat
installed. Probed: UXP moves a graphic with `createKeyframe(new ppro.PointF(x, y))` in one Undo step (bridge `graphic_move`).
Done as prototypes (scratchpad, not in the engine yet): sentence translation (good English; one sentence per call, NLLB drops the
first of two), clause lines split by punctuation, attention-based cut for long clauses (offset 0 is right; cuts without punctuation
can land one word off). Tried on the ReShape reference audio: 69 chunks / 175 words; recognition errors the user must correct first
("хирурги" for "хирурзи", "баласките", "везя"), and they carry into the English ("везя" -> "weight").
Done in 0.9.85: English line, one per Bulgarian line with the same times (user's rule), translate.py, second caption track, checkbox.
USER: press Subtitles with "English line" on (NEW TEST); judge the English cuts; restart Premiere once so it sees Montserrat.
Open: Arial Pro Heavy (the user's English font) is not on this Mac (Arial Black / Arial Bold are): the user to install it or choose.
Next:
1. English lines editable in the Captions tab (now: fix them in Premiere after Upgrade; a rebuild makes them again).
4. Done in 0.9.86: Style "ReShape" (measured on 7 client videos, docs/SUBTITLE_STYLE.md). Open: "бюста / ви" can still split
   when the next words allow it (no word classes to tell it from "много хора / си представят").
5. "Move off faces" button: selected subtitle graphics (after Upgrade), faces under each line (engine YuNet on the visible clip's
   frames), a Bulgarian line and its English line move together, one Undo step (UXP PointF). The client's rule (measured 0.9.86):
   one height per shot, changed at a cut; the Bulgarian line's top 0.11 of the frame height under the chin (median error 0.028,
   a fixed height 0.042); above the face when the face is low; no face = the middle (0.50-0.53); never higher than ~0.16 or lower
   than ~0.72; English centre 0.035 of the height under the Bulgarian centre, letters 0.81 of its size.
6. Optional: the 1-2 frame fade-in (UXP `createAddVideoTransitionAction` exists).

## G. Subtitles: captions, restyled together (0.9.81)
USER: in NEW TEST select audio clips, press Subtitles; then select all captions on the new caption track and change font, outline,
shadow in Properties (open Properties first, then select; select only captions); save a Track Style. Say if anything cannot be changed
for all of them at once. The After Effects graphics (0.9.80) stay available if designed templates are wanted later.

## P. Speed with many clips (0.9.73-0.9.79, done; measured in NEW TEST 2026-11-04)
Done, results identical to the old code: sync FFT reuse, probe cache, parallel dialogue reading, batched colour frames with a retry,
parallel colour frame reading. Measured: Sync 11.2 -> 6.7 s, Rough cut replay 12.1 -> 2.8 s, Auto color 24 clips 23 s for the press.
Left, each needs the user's decision:
1. Subtitles (first run) is Whisper on the CPU (~2.4x faster than real time; repeat runs ~5 s from the cache). Faster means recognition on
   the Mac's GPU (e.g. an MLX build of Whisper): a new engine and a model download, needs the user's OK, and the words must be compared.
2. Sync below ~7 s: a process pool (threads stop helping after 4); the prepared clips would have to be shared between processes.
3. Bridge `select` in the SYNC sequence: after an attempt with linked video+audio it selected nothing (worked 3 times before in the
   first sequence). Until found, a rough cut press in Premiere needs the user to select the clips.

## U. Panel redesign (0.9.68)
0.9.72: own buttons (div.btn), probe done. USER: send a screenshot of 0.9.72+ (main buttons blue, line icons, tabs as text); then commit the redesign. Older note: open the panel (any project is fine for looking): the cards, the ⓘ toggles, Developer, a run's answer at the bottom and Hide, the icons (an empty square means UXP does not draw inline SVG). Then, with TEST.prproj open: `python3 scripts/dev_cmd.py css_probe`; if inline SVG is missing switch the icons to PNG; if `gap`/transitions work, they may replace the margins and add 120 ms colour fades (only on approval). Say anything that looks worse than before.

## S. Subtitles editor (0.9.67)
USER: press Subtitles on a clip, open the Captions tab, correct a word and press Apply and rebuild; check the new track and that the old one has to be deleted by hand. Say if a faster way to replace the old track is wanted. Optional: a Bulgarian fine-tuned Whisper (3 GB download, needs the user's OK).

## L. English UI (0.9.66)
USER: open the panel and check every text reads well in English; report anything still Bulgarian or unclear.

## P8. Rough cut (plan `docs/ROUGHCUT_PLAN.md`)
Done: M0 probes, M1 speech map, M2 Safe/Smart pauses (0.9.59-0.9.63), M3 takes found (0.9.64) and cut (0.9.65). Next: (1) the rotation bug (BUGS.md): open TEST.prproj and import the three probe XMLs (A as now, B upright size, C no size) through `dev_cmd.py host eval`, read each new master clip's frame size, fix `xmeml.py`; (2) USER: press „Груб монтаж“ on the repeated-takes clips again (0.9.65) and check which take stayed; tell which effect of „Оправи звука“ is missing; (3) the quiet-audio-track problem (BUGS.md), left for later by the user; (4) the „Преглед“ view (pick another take, keep or cut) and a rebuild as vN+1; (5) M4 `takescore.py` and `scripts/eval_roughcut.py` against a rough cut the user made by hand (needs one XML); (6) M5/M6 optional items; `rapidfuzz` only if difflib misses real repeats.

## T. Housekeeping (documentation)
T1. Refresh `BUGS.md`: last fully reviewed at 0.9.18; fold in findings from 0.9.19-0.9.41 (see `PROJECT_STATUS.md`, `PROGRESS.md`) and drop fixed items.
