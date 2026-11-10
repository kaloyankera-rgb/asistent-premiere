# Next steps (ordered by priority)

Work rule for every step: implement → tests → bump version (manifest + config) → `scripts/release_mac.sh` →
ask the user to try in `TEST.prproj` → read `engine.log` → commit → update `PROJECT_STATUS.md`.

## A. Fix known bugs
- **Rough cut too slow and not a good cut (the user, 2026-11-09).** Log: a 10-minute video (48 items, IVO7V97xx) spent its time in
  speech recognition (Whisper large-v3 on the CPU, int8 beam 5) and was cancelled after 326 s; the cutting itself takes seconds
  (388 s of footage cut in 2.7-4.8 s once the words were known). Options to measure: reuse words the subtitle run already
  recognised for the same media; a faster recognizer just for the rough cut (whisper.cpp measured 7.3x faster, but invented a line,
  so only where takes are matched, never for subtitles); greedy decoding for the rough cut only. Ask the user what was wrong with
  the cut (cut too much / too little / wrong take / mid-word) and look at a run before changing the rules.
- **Next planned (asked by the user 2026-11-09): timeline labels (I7)**: camera track names, POV label colours, BG/EN subtitle
  names. Probe first in NEW TEST (ExtendScript Track.name writable? track-item labels? caption tracks). Waiting for the user's
  answers: camera naming (model / A-B / POV 1-2) and existing colour conventions.
- **Move off faces, still to see (0.10.17):** the 17 C29 lines over the kam2/kam1 cuts (2:04.1, 2:24.6), a second press says
  "already in place" (positions now remembered by the engine).
- **0.10.11, the user:** ▶ on a few lines: plays in the Program Monitor from 1.5 s before the line and stops after it, no double
  sound. (0.10.9 review helpers: the user confirmed they work, 2026-11-08.)
- **0.10.6, check while working:** Cancel during a long job (nothing applied); right-click on a button does nothing; a long
  press acts once; an update from the panel to the next version (keeps <app>/previous; the panel installed over the old one).
- **Windows PC:** setup_win.ps1 with the pinned CUDA wheels; generate `requirements-*-lock-win.txt` there
  (`python scripts\lock_requirements.py`) so Windows installs hash-locked too.
- **Subtitle speed (the user, 2026-11-08: "whatever is faster and more accurate").** Measured on 143 s of Masterhaus speech
  (fx31031/28/32, lavalier R, Asistent's own `asr.transcribe`): today's CPU int8 beam 5 123 s; CPU float32 148 s and 18 % of words
  different, not better (noise stretches both wrong, „пусока“ for „посока“); mlx-whisper 0.4.2 fp16 on the GPU 10 s (12x) but
  greedy only (no beam search) and clearly worse (гелче -> дядче, с периферия -> спириферият, invented lines), 41 % different.
  Neither is both, so nothing changed. whisper.cpp Metal beam 5 built and measured 2026-11-08 (docs/BENCHMARK.md): 7.3x faster,
  but an invented line and a unit error seen; not adopted. **Needs the user:** verify the three Masterhaus references
  (`~/Kaloyan/02_RESOURCES/Asistent benchmark/refs/*.draft.txt`), then `bench_asr.py score` both backends and decide. Splitting a long window into pieces only buys speed (less context), not tried.
  (Done in 0.10.6: the aligner stays loaded, ~0.9 s per window instead of ~2.1 s.)
- **0.10.2, check from the panel:** a Beauty Sector clip shows "Beauty Sector", "Beauty Space", "workshop"; ReShape unchanged.
- (0.10.0 and 0.10.4 checks done by Claude in NEW TEST on 2026-11-08, CHANGELOG 0.10.8.)
- **Colour: two anchors disagree by 2 stops on the same clip** (fx31030: timeline midtones "on target", file skin +2.7): the
  timeline frame found no face where the file frame did. Look at why the face is missed on the timeline frame (9:16 crop, frame
  size) and whether the skin target 0.62 is too bright (B9).
- **0.10.7 Show exports, check while working (reopen the Asistent panel once to load 0.10.7):** at the office, an export from
  the Export tab into a NEW plan folder of Exported Videos opens Finder with the file selected ~3 s after it ends; the log should
  show "exports: watching …/Exported Videos" after the drive mounts and "exports: Premiere event …" if the Export tab fires
  events (then read the payload: does it carry the path?). If nothing happens: `grep exports ~/Library/Application\ Support/Asistent/logs/engine.log`.
- **Show exports for Media Encoder and Quick Export** (later, the user 2026-11-05): phase 0 probes of
  `docs/EXPORT_REVEAL_PLAN.md` in NEW TEST.prproj (`export_listen` / `export_events`), where Quick Export writes, AME's queue.
Done in 0.9.9 (Volume scale, `/color/probe` docstring).

## I. 2026-11 improvements, later stages (the user's implementation prompt of 2026-11-08, sections 6-13)
Each one: behind its own switch, Classic stays the default, ReShape never changed (`reshape_guard`, golden check), its own commit,
a row in docs/ROLLBACK.md, measured against Classic on the same inputs before it is offered. Order by measured benefit.
- **I0. Needs the user first:** verify the three Masterhaus references (docs/BENCHMARK.md), then score Classic and whisper.cpp;
  try 0.10.9 in NEW TEST after the install OK.
- **Quiet microphones (postponed by the user 2026-11-08, "for now no"):** a very quiet piece is misheard. Masterhaus fx31031 R
  (lavalier, RMS about −57 dB, peaks −35 dB on the passage) gave „500 млн.“ / „20 млн.“ for „500 евро“ / „20 евро“ already in
  Whisper's own reading; the same 13 s normalized (highpass 80 Hz + loudnorm −20 LUFS) gave „евро“ every time, as did camera 1's
  C0731 R (about 35 dB louder) and a prompt „евро, лева“. Possible fix: raise only pieces with peaks under −20 dB before
  recognition, so normally recorded sound (ReShape, the user's good test) stays byte-identical (golden check). Meanwhile:
  select every camera's audio, the mix takes the cleanest copy. Also seen: the dictionary repair „водяло“ → „видяло“ although
  every reading hears „водяло“.
- **I6. Colour accuracy and camera calibration.** First validate `color.py` (BT.1886, S-Log3/S-Gamut3.Cine, legal range) against
  colour-science (pin the exact PyPI version, BSD-3) on synthetic patches: same numbers within 1e-4, or a documented reason; no
  duplicate log transform (read `getInputLUTID` per clip). Then camera calibration as a 3x3 matrix from chart patches or verified
  shared samples (never assuming synced angles share pixels), profiles saved with camera, picture profile, input/output spaces
  and conditions; checked on unseen shots, skin, shadows, highlights, saturated colours. Probe in NEW TEST whether Lumetri's Input
  LUT / Look (params 6-7, 34-35, 128-129) accept a .cube path before promising automatic LUTs; else a labelled manual .cube export.
  camera-match only after reading its license and pinning a released version. OpenColorIO only if more cameras need it.
  Accept: fewer Shot Match retries or smaller ΔE on held-out pairs than Classic Shot Match, which stays.
- **I7. Timeline identification.** Probe first: ExtendScript `Track.name` writable? (UXP `VideoTrack` has no rename; clips have
  `createSetNameAction`; project items have `setColorLabel`, already used by Fix audio). Then optional "Camera A — FX3" / "Subtitles —
  Bulgarian" names and configurable camera label colours, remembered old values for undo, editor names kept by default, applied in
  Sync, Fix audio and rough cut. Accept: names/colours survive a Sync + rough cut rebuild in NEW TEST; one Undo restores them.
- **I8. Client workflow presets.** Extend `subtitle_settings` + the client learning folder (not the unfinished profiles.py draft)
  with: subtitle style choice, English on/off, terminology, audio target, aspect/safe margins, naming and export preferences; new
  keys only, the ReShape preset untouched. Accept: a second project of the same client opens with the same choices.
- **I9. Transcript editing and rough-cut review.** The Review tab of docs/ROUGHCUT_PLAN.md: keep/remove per passage with ▶ (reuse
  listen.py), compare takes, restore a removed passage, the reason for each cut, rebuild as ROUGH vN+1 (new sequence). Number,
  negation, name protections stay (takes.py); never cut on similarity alone. Accept: an editor's override survives the rebuild.
- **I10. Marketing variants.** Editor-marked hook/body/CTA regions (markers), chosen combinations built as named new sequences
  (FCP7 XML like the rough cut); no wording chosen by Asistent. Probe Media Encoder / `EncoderManager.exportSequence` before batch export.
- **I11. Reframing and face-aware placement.** YuNet (already bundled) first: smoothed vertical crop suggestions and the planned
  "Move off faces" for upgraded caption graphics (Position via PointF, one Undo, verified 2026-11-04); safe margins, editor
  overrides, no jumps. MediaPipe only with a measured benefit (landmarks). Outside the ReShape preset; opt-in.
- **I12. Pre-export checks.** Report: offline media, black gaps (not intentional ones), caption overlaps/overflow/unsafe placement,
  missing fonts (where the API tells), peaks over −6 dBFS on the main mic; each marked confirmed / warning / not measurable through
  the API.
- **I13. Later experiments** (each with its license and local-only check): pyannote (local, telemetry off, gated model needs a
  token: ask), Opus-MT bg→en against NLLB on terminology/numbers/negations (never replacing ReShape's English), PySceneDetect for
  B-roll index, open_clip (needs multilingual model or local query translation), music ducking, multicam suggestions.

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

## E. Exposure −0.5 / +0.5 (0.9.88)
USER: try in NEW TEST (see PROJECT_STATUS). Later, if wanted: the same step for Temperature, or a "−1 / +1" for very dark clips.

## W. Windows and updates (0.9.87)
1. USER / PC session: on the Windows PC unzip the release and double-click `Install Asistent (Windows).cmd`; open Premiere twice
   (host, font); check the panel and the engine; then one update from the panel once a newer release exists.
2. Done 2026-11-04: release v0.9.87 published (the engine on this Mac reads it: current = latest). Later versions: commit, push,
   `scripts/publish_release.sh` on the user's word.
3. Windows: Shot Match / colour frames and the subtitle GPU path are still untried there (CUDA wheels in setup).

## D. Later phases
5 Client profiles + Prepare Project (in the office; draft in `profiles.py`/`prepare.py`; Basecamp paste),
7 Bulgarian subtitles, 8 AI Auto Rough Cut (plan: `docs/ROUGHCUT_PLAN.md`, next step M0 = probes in TEST.prproj: XML import from code, trimming, markers; `rapidfuzz` needs the user's OK) + export QA, 9 Windows (run `setup_win.ps1`, silent install with
UnifiedPluginInstallerAgent on Windows, test there), manual sync for short clips, sub-frame audio alignment.

## SL. Smart subtitle correction and learning (0.9.95 phases 0-4, 0.9.96 phases 5-8; to test all at once in Premiere)
- [x] In Premiere: fix a word in the Captions tab of a ReShape project, Apply and rebuild: the fix is in the events file and
  in Learned (the user, 2026-11-04). Still to see: a second ReShape project gets it.
- [ ] 0.9.97 in a real project: Apply and rebuild replaces the old pair (old tracks emptied, one Undo brings them back), lines
  after a cut start on the cut, the search box, the English line from 1.3B. On each office computer: press Download the
  translator (1.4 GB) once.
- [x] English word fixes learned per client (0.9.98): fix "lipidemia" -> "lipedema" once in an English line. In Premiere:
  check a second ReShape project gets it. A fix of a common word ("forming" -> "and form") applies to every video of the
  client: the editor types it back if that is wrong somewhere.
- [ ] English cuts the Bulgarian lines cannot match when the English word order differs ("in fat / tissue", "chronic fatty /
  tissue disease"): the editor fixes those lines.
- [ ] Apply and rebuild stops with "Select the audio clips" when nothing is selected (the user hit it 2026-11-04): reuse the
  clips of the last run.
- [ ] Windows: open a ReShape project from the server on the PC, run subtitles once, check the PC's events file appears.
- [ ] Other clients: each needs a "<Client> Subtitle Learning" folder in its client folder (ask the user before creating them).
- [x] Phase 5 (0.9.96): "Who speaks" per microphone track in the Captions tab; first-person forms follow it (real audio:
  „съм свършил“ -> „свършила“ with a woman set, score -4.5). In Premiere: set A1/A2, Apply and rebuild, read the lines.
- [x] Phase 6 (0.9.96): adjective-noun agreement MARKED (yellow edge), not changed. Not built: pronoun-noun and subject-verb
  (no reliable way to tell the noun's number without a parser); widen only with measured examples.
- [x] Phase 7 (0.9.96): the Learned list (collapsed under the lines; Remove / Restore for everyone). In Premiere: open it,
  remove one, check another project no longer uses it.
- [x] Phase 8 (0.9.96): `scripts/measure_learning.py report <project>` (uses vs typed back, target 98 %) and `dry <runs>`
  (19 saved runs: 6 writing changes all right, 0 agreement false alarms after the fixes). Re-run `report` after a few
  weeks of office use before lowering any threshold.
- [ ] The dictionary repair is wrong on medical words („масните“ -> „масоните“, „масната“ -> „месната“; the doctor says
  „мастните“): learned fixes cover it once an editor fixes it; a better repair needs more than the nearest dictionary word.

## S. Client subtitle profiles (started 2026-11-10: GStroy first, then every client)
- [ ] GStroy (0.10.18, `gstroy` preset, docs/SUBTITLE_STYLES/GSTROY.md): USER: install (needs OK), press Subtitles with Style
  GStroy in NEW TEST on a GStroy recording, judge the chunks and the suggested green words; make the Track Style "GStroy"
  (Montserrat Black 52, white, glow) once; install Montserrat Black (not shipped: only Bold is).
- [ ] Probe in NEW TEST whether an SRT `<font color="#94D000">` tag survives Premiere's caption import (then the green words
  could arrive coloured); otherwise the editor colours them by hand from the list.
- [ ] Move off faces uses ReShape's chin rule; GStroy keeps a fixed height (centre 0.50): a per-style placement if it matters.
- [ ] Colour: per-client targets (GStroy skin 0.48, mid 0.54, docs/CLIENT_COLOR/GSTROY.md) only with the user's decision; better:
  pair graded clips with their originals to learn the actual moves.
- [ ] Credissimo (0.10.19, `credissimo` preset, docs/SUBTITLE_STYLES/CREDISSIMO.md): USER: try it in NEW TEST on a Credissimo
  recording; Track Style "Credissimo" (as GStroy's, keyword #F84430); say whether the brand is written CREDISSIMO or КРЕДИСИМО
  (the exports use both).
- [ ] GStroy's two-line split: "most even" matches its editors as well as "last word alone" (87 % vs 85 %); keep unless the
  user's test shows otherwise.
- [ ] Next clients: `scripts/measure_style.py frames|chunks|asr|timing|compare|colour` (font and shadow still by hand).

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
5. Built in 0.10.12 (to install and try in NEW TEST: upgrade C29's lines, select them, press; check heights per shot, the English pairs,
   one Undo; then move one by hand and press again: it must stay). 0.10.14 verified on one shot by the user (2026-11-09).
   Open: faces in profile are missed by YuNet (the user's wide two-shot found "no face" -> middle); if that matters, measure a
   profile-capable detector (or the person's body/head box) on NEW TEST shots before adding one. Spec as built: "Move off faces" button: selected subtitle graphics (after Upgrade), faces under each line (engine YuNet on the visible clip's
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
