# TODO.md: finished and superseded sections moved out on 2026-11-21

Kept word for word. V94 and V95 check the clone path that the host cut of 0.10.108 replaced (the subtitle checks they held
are repeated in V119); C2 and P8 are the shipped Phase 7 and Phase 8 plans; U and L check panel versions long replaced
(0.10.59 layout); T1 is done by the documentation reorganisation of 2026-11-21. Open tasks: [../../TODO.md](../../TODO.md).

## V95. Verify 0.10.95 (2026-11-15)
- [ ] Cut silences, Auto, on IMG_9422 (Lokali): the red-labelled parts are gone, the green ones stay, the result says how many
      seconds of quieter voices went. Same on the "Lokali" IMG_9423 clip: no error, no crash; if Premiere refuses a piece the
      result names it.
- [ ] Make subtitles on the Lokali pieces: „Карал ли си някога реална кола? Не. А карал ли си на симулатор? Да.“

## V94. Verify 0.10.94 (2026-11-15)
- [ ] Cut silences at -30 dB on the 8-minute IMG_9423.MOV (4a1a ALPHA "Lokali"): no crash, 204 pieces placed and linked, the
      result names the batches.
- [ ] Make subtitles on the same Lokali clip again: „карал“ instead of „Кара“, „съседание“ kept and marked instead of „съседни“.

## C2. Phase 7 subtitles (user's current focus, 2026-11-01)
Plan: `docs/SUBTITLES_PLAN.md`. Done: M0 probes (0.9.39), M1 text core (0.9.40), M2 ASR + model (0.9.41; Mac 2.8x real time), M3 dialogue mix + `/subtitles` job + panel section (0.9.42, engine verified end to end on a real clip).
**Next (0.9.48):** (Z) user presses the button on a new video, checks the panel's „Провери / Чуй“ list against the sound and tells which flags were useful and which were noise; the places C9025 0:00.3-0.9 and 0:12.3-12.8 (voiced, no word) and „Така.“ 0:10.5 need a listen; (Y) decide on per-speaker gender metadata (needs speaker separation); older:  (A) user tries the corrections box (Корекции и имена) on real projects and gives the places where timing is still off (time + early/late) and reports remaining wrong words; (B) a second ASR model is not worth it (large-v2 tested, worse, see DECISIONS.md); (C) M4: click-to-edit list in the panel instead of typing correction lines; (D) Windows: host install + CEP path. Older (0.9.45) list: (0) USER: close and reopen Premiere once (loads the Asistent host), open TEST.prproj, press „Субтитри (български)“; then the end-to-end placement test through the bridge (`dev_cmd.py host ping|probe`, check caption format constant, track count, item times vs the SRT) and the first-run settings in `host.jsx`; (0a) decide whether Asistent may delete its own old caption track from ExtendScript (probe first), otherwise the editor deletes it; (0b) M4 text correction in the panel (the words still flagged: „нища“, „десом“, „свършила“); (0c) Windows: host install script + CEP path on the PC. Older list: (1) done 2026-11-01: the button works in `TEST.prproj`, frame size read, duplicates skipped; still open: the user judges accuracy/timing and says whether 4-word captions from glued function words are too long for 9:16 (rule in `subtitles.py` `_attach_function_words`); (1a) 0.9.44: user presses the button again (words per piece, new grouping). DECISION NEEDED: install the aligner (`scripts/setup_mac.sh --align`, ~2.1 GB, weights CC-BY-NC) or keep Whisper times, or evaluate a permissive alternative (e.g. stable-ts); copy the already downloaded weights instead of fetching again if a test venv still exists; (1b) 0.9.43: user presses the button again on the same selection and judges the words; answers whether captions are early or late (and by how much) so timing can be fixed: a fixed offset if systematic, else forced alignment (MMS_FA, needs OK for ~1-2 GB torch); (2) M4 review + import: result list with flags, „Внеси в проекта“ = `importFiles` into bin „Субтитри" (one Undo) + drag hint; (3) „Имена и термини“ field saved per project in `subtitles.json` → Whisper prompt (engine already takes `terms`); (4) Windows CUDA run; (5) M5/M6 per `docs/SUBTITLES_PLAN.md`.

## U. Panel redesign (0.9.68)
0.9.72: own buttons (div.btn), probe done. USER: send a screenshot of 0.9.72+ (main buttons blue, line icons, tabs as text); then commit the redesign. Older note: open the panel (any project is fine for looking): the cards, the ⓘ toggles, Developer, a run's answer at the bottom and Hide, the icons (an empty square means UXP does not draw inline SVG). Then, with TEST.prproj open: `python3 scripts/dev_cmd.py css_probe`; if inline SVG is missing switch the icons to PNG; if `gap`/transitions work, they may replace the margins and add 120 ms colour fades (only on approval). Say anything that looks worse than before.

## L. English UI (0.9.66)
USER: open the panel and check every text reads well in English; report anything still Bulgarian or unclear.

## P8. Rough cut (plan `docs/ROUGHCUT_PLAN.md`)
Done: M0 probes, M1 speech map, M2 Safe/Smart pauses (0.9.59-0.9.63), M3 takes found (0.9.64) and cut (0.9.65). Next: (1) the rotation bug (BUGS.md): open TEST.prproj and import the three probe XMLs (A as now, B upright size, C no size) through `dev_cmd.py host eval`, read each new master clip's frame size, fix `xmeml.py`; (2) USER: press „Груб монтаж“ on the repeated-takes clips again (0.9.65) and check which take stayed; tell which effect of „Оправи звука“ is missing; (3) the quiet-audio-track problem (BUGS.md), left for later by the user; (4) the „Преглед“ view (pick another take, keep or cut) and a rebuild as vN+1; (5) M4 `takescore.py` and `scripts/eval_roughcut.py` against a rough cut the user made by hand (needs one XML); (6) M5/M6 optional items; `rapidfuzz` only if difflib misses real repeats.

## T. Housekeeping (documentation)
T1. Refresh `BUGS.md`: last fully reviewed at 0.9.18; fold in findings from 0.9.19-0.9.41 (see `PROJECT_STATUS.md`, `PROGRESS.md`) and drop fixed items.
