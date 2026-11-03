# Changelog

All notable changes to Asistent. Newest first. Reconstructed from the git history up to 0.9.41 (all work so far happened on 2026-11-01); from here on every completed and verified task adds an entry under `Unreleased` or a new version heading (see the workflow in `CLAUDE.md`).

Versions are the panel/engine version (`panel/manifest.json` and `engine/asistent/config.py` always match). "Verified" means confirmed by the user in Premiere; details per feature are in `PROJECT_STATUS.md`.

## Unreleased

## 0.9.67 - Subtitles: a caption editor; rough cut: muted audio is not used; rotated files described upright
- **Captions tab (SUBTITLES)**: after a subtitles run a hidden tab "Captions" appears with one field per line (time + text; lines holding an uncertain word have a yellow edge, edited lines a blue edge). Type a wrong word right and press **Apply and rebuild**: `panel/captionedit.js` turns each edit into the editor's correction lines (`heard => said`; the smallest changed stretch, anchored on a neighbouring word when a word was only added or removed or the changed word is 3 letters or less, two changes with one short word between are one phrase), adds them to the corrections box (saved per project, same line for the same heard words is replaced), and the job runs again: the recognised speech is cached, so it takes seconds, the new words are timed by the sound (forced alignment, as before) and the new set is placed on a NEW caption track (`place(..., {again: true})`); the result says to delete the old track (Asistent never removes anything). Matching ignores case and punctuation and also accepts the spelling shown in the captions.
- Why an editor and not a better recognition: tried on the 23 s GStroy clip (loudness normalisation, 90 Hz high-pass, beam 8): Whisper's wording changes at random with tiny audio changes ("Приведно", "Примерно", "Природа", "Прилно") and none of them fixed "трябваше да боядисам"; the three-reading vote already in place is the right tool, and a Bulgarian fine-tune (public ones are trained on read speech and are not in CTranslate2 format) would be a 3 GB download that needs the user's OK. Not changed.
- **Rough cut: muted audio is not used**: audio on a muted track (`track.isMuted()`) or a switched-off clip (`isDisabled()`) is left out of the cut and of the speech, as if deleted (the quiet camera microphone that left gaps); the result says it once per track. The panel logs once whether those two Premiere methods exist (unverified in 26.0.2; if they are missing the old behaviour stays and the workaround is to deselect or delete the track).
- **Rough cut: rotated files**: `media.MediaInfo.rotation` (the display-matrix flag, 90/270) and `xmeml` describes such a file by its displayed size (2160x3840 instead of 3840x2160). An unverified attempt at the sideways bug: if the picture still comes in sideways, the probe XMLs decide (TODO).
- Tests: 398 engine, 113 panel.

## 0.9.66 - The whole tool is in English (user's request 2026-11-03)
Every user-facing text is English now: the panel (buttons, tooltips, section titles, progress, results, errors), the engine's messages and reasons, the host's messages, the Undo step names, the script output and the README (rewritten and brought up to date: Fix audio with L/L and R/R copies and the limiter, the color buttons, Match POVs, Rough cut, Subtitles). What Asistent creates in Premiere has English names: the bin "Rough cut", sequences "ROUGH – <sequence> (safe|smart) vN", markers "Review", the subtitle bin "Subtitles", the test bin "Asistent test". Nothing made earlier depends on an old name (the L/R bin was already "Asistent L-R"), so older projects keep working.
- Button names: Синхронизирай камерите → Sync cameras · Груб монтаж → Rough cut (Внимателно/Умно → Safe/Smart, Спокойно/Нормално/Стегнато → Calm/Normal/Tight, Маркери за прегледа → Review markers) · Оправи звука → Fix audio (Ръчно → Manual: Split L/R, Split R/L, L only, R only, Level only, Even out phrases) · Авто цвят → Auto color, Бяло → White balance, Експозиция → Exposure, Изравни POV-тата → Match POVs, Приложи сигурните / и средните → Apply the sure ones / the medium ones too, Приложи изравняването → Apply the match · Субтитри (български) → Subtitles (Bulgarian), Свали модела → Download the model · Следи Downloads → Watch Downloads · Инструменти / Дневник / Преди / след / Отказ / Подробности → Tools / Log / Before / after / Cancel / Details.
- Unchanged on purpose: the Bulgarian language data of the subtitles and the take finder (spelling, dictionary, numbers, filler words, month and money words) and the importer's Bulgarian folder keywords ("музика", "ефекти"); the example in the corrections box stays Bulgarian because the subtitles are Bulgarian.
- Result fields renamed with the texts: `kind_bg` → `kind_label` (takes), `tempo_bg` → `tempo_label`; the colour check no longer sends `clipping_message_bg` (the panel shows `clipping_message`).
- Fixed on the way: the Match POVs confidence read the anchor from the basis text; "the white/grey surfaces" contains "face", so it now matches whole words.
- `scripts/setup_win.ps1` is plain ASCII now (Windows PowerShell 5.1 reads non-ASCII scripts wrongly without a BOM).
- Tests: 396 engine, 102 panel, assertions moved to the English texts. Not yet seen in Premiere.

## 0.9.65 - ГРУБ МОНТАЖ: repeated takes are cut, the last full take stays (user's test 2026-11-03)
The user's test of 0.9.64: three clips with the same line said slightly differently, "it kept all 3". The run file showed the group was found (three takes, the last recommended) but 0.9.64 only listed it, and marked it as "said differently" because of one extra sentence.
- **Cut, in both modes**: for a plain repeat everything from the first take up to the winning take goes in one piece when only short setup talk is said between the takes (sentences of at most 8 words, at most 25 s: „Добре, готови?“, „Тихо“); otherwise each losing take goes alone; a take that broke off after the winner goes too. The cut starts at the breath or rustle before the first take (never before the previous word) and stops 0.15 s before the winner's first sound (`pauses.take_edges`, `pauses.with_takes`). A start repeated inside a sentence is cut only in Умно. A group said differently (a number, or more content words than max(2, a quarter of the winner's)) is only listed, as before.
- **Better takes**: a take that begins in the middle of the passage gets its opening back when it was said in other words („Вижте тези чини! Ако са под 700 евро, ги взимаме.“ against „Виж тази чиния. Ако е под 700 евро, да я взимаме.“: loose matching where alike words count as the same word). Words said a little differently („вижте“/„виж“, „тези“/„тази“) are no longer counted as lost content. The ring of links between the end of one take and the start of the next is broken at the longest pause, so the passage keeps its order.
- Replayed on the user's test (9 items, Внимателно/Спокойно): 73.8 s → 12.4 s; kept „Може и още. Отдала е свободно.“ and the last take of the plate scene; the two earlier takes and the setup talk between them (52 s) are gone. The result text says per group which take stayed and how many seconds went.
- Tests: 20 in `test_takes.py`, the job test now checks the losing take is cut and the winner whole. Not yet pressed in Premiere.
- Found, not fixed: vertical footage stored as 3840×2160 with a rotation flag (Sony, `rotation=90`) comes into the new sequence sideways; the XML describes the file as landscape. Probe XMLs are ready, the fix needs TEST.prproj (BUGS.md).

## 0.9.64 - ГРУБ МОНТАЖ: repeated takes and false starts are found and listed (Phase 8 M3, first half)
- New `engine/asistent/takes.py` (difflib on the recognised words, no new download): sentences (end mark, pause over 0.5 s, comma plus pause over 0.25 s); each sentence is compared with the next 12 sentences within 90 s: `exact`, `near` (ratio 0.75, length ratio 0.6-1.6), `false_start` (a short or unfinished start said again within 20 s, or a take that breaks off after a good one) and `restart` (the same 2-4 words twice inside the talk with only a filler or a pause between). Sentences under 3 words are never matched. Matched sentences are grouped and chained into whole passages, so a scene said three times is ONE group with three takes, even when one take has an extra sentence in the middle. The recommended take is the editor's rule (the last full one); a group whose other takes say content words the winner lacks (more than 2, or any number) is marked as different text, not a plain repeat.
- Nothing is cut for a repeat in either mode (the choice of the take and Умно's cutting are M4). The result lists each group: where it lands in the NEW sequence, kind, number of takes, the recommended one and its text; with "Маркери за прегледа" ticked each group also gets a marker. `result.takes`, `counts.takes`, run JSON.
- Run on the real words of the Ludi Glavi test (281 words): the "700 евро" plate scene is found as one group of three takes with the last one recommended; the price line said with 200 and 300 euro is marked as different text.
- Tests: `tests/test_takes.py` (13), a job test, a panel text test. Not yet pressed in Premiere.

## 0.9.63 - ГРУБ МОНТАЖ: fewer cuts, holes in a camera's row (third test, 2026-11-03)
The user's third test (48 items, two POVs, 388 s): "different types of gaps", "very fast cuts for no reason". Read from the run file: no hole in the picture as a whole (the union of the cameras was continuous) but holes of 0.4-2 s in ONE camera's row while the other kept playing, and kept pieces of 0.7-1.3 s between two trims.
- **Jump cuts**: `pauses._no_jump_cuts`: where two cuts leave a kept piece shorter than `MIN_SHOT` = 1.5 s, the smaller pause cut is not made (the pause stays), so the shots join. Внимателно now touches only pauses longer than 2.0 s (Спокойно) / 1.5 s (Нормално) / 1.2 s (Стегнато) (was 1.2 / 0.8 / 0.8) and makes no pause cut under 0.5 s (Умно 0.25 s). Same selection: 45 → 32 cuts, shortest kept piece 0.1 s → 1.57 s.
- **Holes in one camera's row** (`pauses._close_track_holes`): the part of a hole between two clips of one track that no cut takes out is cut from every track when nobody speaks in it. Where somebody does (the last word of the line is spoken on the other camera's microphone after this camera's clip ended: 204.7-205.0 s in the user's run) the hole stays and its seconds are said in the result (`hole_speech_s`). Cutting it would cut speech; that is the user's decision (asked).
- Tests: 25 in `test_roughcut.py`. Not yet pressed in Premiere.

## 0.9.62 - ГРУБ МОНТАЖ: the last 1-2 frame gaps between clips
- Cause (read from the user's run files: holes of 1 and 2 frames between item0→1 and item2→3 on the main track, cut ended at 58.025 s, clip starts at 58.058 s): `pauses.guard` was applied to the whole cut list, including the empty time between two clips. The 10 ms frame that holds the clip's first 8 ms is voiced, so the guard stopped the cut one frame short. The guard now protects only pause cuts (inside `plan`), the empty time and the time with no selected sound are cut exactly to the clip edges.
- Checked on the user's last selection in three modes (Внимателно/Спокойно, Умно/Нормално, Внимателно/Стегнато): no hole under one second on any track. Tests: 23 in `test_roughcut.py`. Not yet pressed in Premiere.

## 0.9.61 - ГРУБ МОНТАЖ: little gaps between clips, chopped clip ends (second test, 2026-11-03)
- **1-2 frame gaps between clips**: the Whisper word padding (0.04 s before a word) reached over the edge of a clip into the empty time before it, and the final guard kept those frames, so the closed gap stopped 1-2 frames short (cut ended at 58.01 s, the clip starts at 58.058 s). Nothing is "word" or "voiced" where no sound clip covers the time any more, and the cuts are put back on the frame grid after the guard.
- **Fast cuts at the end of clips**: the silence after a clip's last word held islands of breath that split it into several cuts with small kept pieces between. The end of a clip is now handled as a stretch of its own: the picture keeps `TAIL_OUT` = 0.8 s after the last word (the user's "let it breathe"), then everything after it goes in ONE cut, islands included (nobody speaks after it). A kept piece of pure pause between two cuts shorter than 0.6 s (was 0.3) is merged. A piece of 15 frames or less (a flash) of an item that goes on elsewhere is dropped (`edl.drop_flashes`): 5 frames of the second camera at the end of its clip were a flash on the timeline; a short piece that nothing longer covers is kept (a short word is a shot).
- Not ours: 1-2 frame holes that the SOURCE sequence already had (the user ran the rough cut on the output of the faulty 0.9.59 run, "ГРУБ – SYNC – ГРУБ – SYNC"). Run it on the original SYNC sequence.
- Tests: 22 in `test_roughcut.py`. Not yet pressed in Premiere.

## 0.9.60 - ГРУБ МОНТАЖ: the user's first test (2026-11-03) fixed
Four findings from pressing the button on the user's TEST sequence (data read from the `Asistent_roughcut/*.json` of those runs):
- **Time with no selected sound stayed in** (34 s of cam2's picture before cam1's first words; the empty timeline between two recordings stayed as a 0.35-0.45 s hole on every track, so the next shot did not follow). Now the speech map spans the whole selection and `pauses.plan(sound, present)` takes out whole: time no selected sound clip covers (nobody is known to speak) and time no item covers (an empty gap). The pause budget applies only inside the sound. The levels (floor, voice) are read only from the covered sound: zeros of the uncovered time had dragged the speech threshold down. The result says how many seconds went for each reason.
- **Many cuts at the end for nothing**: the last two seconds were four cuts with 0.1 s slivers of breath between them. Cuts separated by a kept piece under 0.3 s that holds no word or voiced sound are merged (`_merge_slivers`), and a pause cut under 0.25 s is not made (`MIN_CUT`; was 3 frames).
- **Effects were lost** ("Оправи звука" first, then „Груб монтаж“): the new sequence is built from the media, so nothing on the old clips came with it. Now carried over: the L/L / R/R split (a clip named "… L …" / "… R …" reads source channel 1 / 2 on both exploded sides in the XML, which is what Audio Channels does), the Volume level (XML Audio Levels, read back and set again through Volume when the import did not take it), Dynamics → Limiter −6 dB (put on the new pieces after the import by the same code as „Оправи звука“, `noLimiter` skips it for clips that had none) and the Lumetri values Exposure/Temperature/Tint/Contrast/Saturation (`premiere-color.copyLumetri`; a correction that was Asistent's own is recorded as its own again). Not carried and SAID in the result: any other effect by name, keyframed levels, a hand grade's other settings.
- **Multiple clips with two POVs** use the same rules (the gap between recordings is closed on both cameras, the next shot follows).
- Tests: 369 pytest (4 new), 101 node (2 new). **Not yet pressed in Premiere**: the effect carry-over is new code (Premiere API) and has only been checked statically.

## 0.9.59 - ГРУБ МОНТАЖ (Phase 8, M0-M2): pauses cut into a new sequence, source untouched
- **M0 probes in TEST.prproj** (details in `docs/ROUGHCUT_PLAN.md`, decision in `DECISIONS.md`): the engine-written FCP7 XML imports through UXP `project.importFiles` with no dialog, frame exact, V/A linked, camera offset intact, Cyrillic markers from `<marker>` work, `setPlayerPosition` exists.
- **Engine**: `vad.py` (Silero v6 from faster-whisper's own ONNX, a veto on cutting), `speechmap.py` (a label per 10 ms: WORD / VOICED / LOW / SILENT, cutcheck's energy rule), `pauses.py` (pause budget by tempo and sentence end, cuts only SILENT frames, edges snapped INWARD to the frame grid, a final guard that never lets a cut cover a WORD or VOICED frame), `edl.py` (kept ranges in sequence time, the same cuts for every selected item, so the cameras stay in sync), `xmeml.py` (port of autoedit's writer, any tracks, links by media range, optional markers), `roughcut_job.py` + `POST /roughcut`. Words come from the same cached Whisper readings as the subtitles; without the speech model the pauses come from the energy and Silero and the result says so. Output: `<project>/Asistent_roughcut/ГРУБ – <seq> (<mode>) vN.xml/.json`, every press a new version.
- **Panel**: card ГРУБ МОНТАЖ (Режим Внимателно/Умно, Темпо, optional review markers, one button), `roughcutplan.js` (pure), `premiere-roughcut.js` (reads only; imports the XML into bin „Груб монтаж“, finds the sequence, checks pieces per track and the length against the engine's list, opens it). Nothing is removed, muted or trimmed in the source sequence.
- **Not in yet** (said in the panel): repeated takes and false starts (M3/M4), the review list view. Effects (Lumetri, volume, L/R split) are not carried into the new sequence: run it before colour and sound.
- Real footage (Masterhaus fx31028 + C0728, numbers only): 56.06 s → 51.18 s in Внимателно/Нормално, 10 cuts, 65 words, 4 voiced-without-word places listed, 41 s (cold, three Whisper windows).
- Tests: 365 pytest (15 new), 99 node (7 new). **Not yet pressed in Premiere** (the bridge refused: a client project was open).

## 0.9.58 - ЦВЯТ: separate Бяло / Експозиция buttons, Авто цвят, „Изравни POV-тата“ in one clear card
- **Nothing in the colour engine changed** (no `engine/` file is touched except the version string; Lumetri writes, thresholds, targets and the render check are the 0.9.57 code). Only the panel's buttons are reorganised.
- **Авто цвят** is the former „Бяло и експозиция“ button, unchanged: one analysis, the suggestion with before/after, then „Приложи сигурните“ / „Приложи и средните“.
- **Бяло** and **Експозиция** run the same analysis and the same apply path, and only narrow the plans (`plansFor(..., only)`): Бяло plans Temperature/Tint, Експозиция plans Exposure. With no part the function returns exactly what it returned before (a test keeps the 0.9.57 function as the reference and compares all confidence combinations). The audit log gets a `part` field.
- **Контраст and Наситеност get no single-clip button on purpose**: the single-clip engine has no contrast or saturation algorithm (`color.py`: "never contrast, saturation or LUTs"); they exist only inside Shot Match, relative to a reference camera, and stay there. Inventing a single-clip algorithm was ruled out by the request.
- **„Изравни POV-тата“** is the existing Auto Shot Match under its new name, a button in the same ЦВЯТ card (no sub-section): it already works after the corrections (the clip's current Lumetri values are simulated on the source, then absolute values are fitted to the reference camera), keeps everything outside the components it changes, never touches a hand-made Lumetri, matches exposure, white, contrast and saturation, supports several clips, lets the user pick the reference camera and checks the result on Premiere's own frame (worse parts are put back). No algorithm was changed.
- Tests: node 92 (6 new: part filter, Auto Color equivalence, wiring of the new buttons, no contrast/saturation button).

## 0.9.57 - „Оправи звука“: the two speakers balanced by speech loudness, Dynamics → Limiter −6 dB
- **Balance** (`audio.balance`): after the L/L and R/R split the two sides' gated BS.1770 loudness (the level of the active speech, not a peak match) is compared; when they are more than 2 dB apart (`BALANCE_TOL`, request field `balance_db`) only the LOUDER side is lowered, by at most 12 dB, so nothing is lifted and no noise is amplified. A channel that carries nobody of its own (its share of frames ≥ 10 dB above the other is under 10 %: the far copy of one voice, room bleed) is not matched to anything and is not lifted above its source level. Identical channels or a stereo mic: untouched. The sum of both sides stays under −6 dB (existing rule, applied after the balance); the existing noise cap and ±30 dB still apply. Measured on Masterhaus C0731: 5.4 dB apart → 2.0 dB. Stale "Вдигнато само с…" notes are dropped when a later rule changes the gain.
- **Limiter**: every levelled clip gets Premiere's native Dynamics with only Limiter on and its Threshold at −6 dB (`Limiter Enabled` 1, `Limiter Threshold` 0.9: the parameters are normalised, value = (dB + 60) / 60; the default −1 dB is 0.98333, as the user's video shows). An existing untouched Dynamics is reused (only the limiter is switched on), one that is already Limiter −6 dB is left as it is (second press: no duplicates), and a Dynamics with somebody else's settings (other processors on, another limiter threshold, several Dynamics) is not touched and said. The effect is appended in the same step as the levels, its limiter is switched on in the next (a new effect has no parameters before it is applied) and read back; a failed read-back is reported as a problem. Two Undo steps for levels + limiter.
- **Limitation, said in the panel**: the user's video puts the limiter on the Mix (master) track. No script API reaches it in Premiere 26.0.2 (QE has only Audio 1-N, the sequence has no master track, `audioTracks[N]` is empty), so the limiter is per clip and the combined peak of the two sides is held under −6 dB by the gains themselves.
- Host: an Asistent bin clip whose name does not say L or R is refused with a message instead of being skipped silently. Test bridge: `audio_chain` (all effect parameters of audio clips, read only) and `audio_fx_add` (one effect on one clip).
- Verified in TEST.prproj (Premiere 26.0.2): one new clip (L/L + R/R, one Dynamics each, parameters read back: Limiter Enabled 1, Threshold 0.9, AutoGate/Compressor/Expander 0), second press (no new effect, "лимитерът е вече на −6 dB"), four clips at once (eight sides, one Dynamics each).

## 0.9.56 - „Оправи звука“: L/L and R/R through the clips' own Audio Channels, no Fill effects
- The one button now does what the user's reference video shows: the audio is duplicated onto the track below, the upper clip plays only the Left source channel (L/L), the lower one only the Right (R/R) (Modify Clip > Audio Channels), all linked to the video again. The Fill Left/Right effects are never added any more (a Fill that is already on a clip from earlier versions is left alone: only its level changes).
- How (no API sets the channels of a clip on the timeline): the host (`host.jsx` `as_audio_route`, command `audio_route`, endpoint `/audio/route`) makes an audio-only subclip per media range and side in the bin „Asistent L-R“ (`createSubClip`), sets its source mapping (`getAudioChannelMapping` + `setMappingForChannel` + `setAudioChannelMapping`; `audioChannelsType` is read-only), overwrites the original audio with the L/L copy and puts the R/R copy on the nearest free track below, checks both sit exactly where the original was with the same In point, and links video + both sides (`linkSelection`). Nothing is removed or muted by script.
- Every stereo clip is split (`split_all`; the user splits even clips the analysis calls one voice on two mics); the analysis only informs and sets the two levels, whose sum stays under −6 dB. A mono file is left alone. A selected video clip brings its own audio.
- Second press: sides are recognised by name („C0731 L 6.37-13.78“) and in the bin, so no new copies or subclips are made; both sides are measured as a pair and get the same levels again. No free track below: refused with the instruction to add one.
- The panel's levels are one Undo step; the splitting is separate Premiere steps (said in the result).
- `host.jsx` now starts with a UTF-8 BOM (`$.evalFile` read it as Mac Roman and Cyrillic messages came out garbled).
- Verified in TEST.prproj (Premiere 26.0.2) on Masterhaus clips: single clip, three clips at once (R/R copy of a clip whose A2 was taken went to a free track), repeat press (no duplicates, bin unchanged), clips placed to the tick with the same In point, 3 linked parts; the user confirmed in Modify Clip > Audio Channels: A1 L/L, A2 R/R.

## 0.9.55 - panel: sections, tooltips, report and pictures in their own views
- Every feature is a card: title, one line saying what it does, then its buttons (СИНХРОН, ЗВУК, ЦВЯТ, СУБТИТРИ, АВТО ВНАСЯНЕ). The manual audio variants are folded under „Ръчно ▸“; nothing was removed.
- Tooltips on every button (UXP shows nothing for `title`): shown after a short hover under the button, above it near the bottom edge, always inside the panel; hidden on leave, press or scroll. Buttons made in code get one through `button(cls, label, help, fn)` (a test checks every button in the HTML and in main.js).
- Three views: „Инструменти“ (actions), „Дневник“ (the full report of the last run plus the last 10 results; a badge counts its warnings, red on an error) and „Преди / след“ (the before/after pictures of „Бяло и експозиция“ and „Изравни камерите“, with the Приложи buttons above them). The main view keeps only the progress, the one-line result, the decisions (Приложи…, the Shot Match reference) and links to the two views. Starting a run returns to „Инструменти“.
- `[hidden]` always wins over a row's display, so folded rows stay folded.

## 0.9.54 - SYNC: fewer false „несигурно“, every decision explained
- Cause found on the Masterhaus shoot (two pairs „Възможно, но несигурно“, like the user's fx39059/C9052 +2.273 s): every window found a strong, real peak, but they spread over 11-18 ms, and a window counted only within 5 ms of the line. Two POVs metres apart hear each speaker over a different path difference (1 ms = 34 cm), so speech from different places gives slightly different offsets; there is no single exact one.
- New High rule for scattered windows (`sync.py`: `_band_cluster`, `LOOSE_BAND` 20 ms): at least 4 windows and 80 % of all (and of the informative) windows strong and inside one 20 ms band, median peak ratio >= 1.3, no second candidate, and the spread must not be a clock drift (`_drifting`: a straight line over >= 60 s stays refused). The offset is the band's median (error under 10 ms). The quick look before the full check accepts such candidates too.
- The cameras' clocks as a second witness (`groups._clock_check`): a scattered-rule pair whose learnt-clock times disagree by > 10 s is vetoed (same line from another take); an uncertain pair (no drift, no second offset) whose recording times agree with the audio within 2 s becomes High. Raw clocks may confirm (two clips only, as in the user's case) but never veto.
- Results: Masterhaus 7 → 10 synced pairs (fx31030/C0730 +2.208 s, fx31036/C0740 +6.952 s by the band rule, C0741/fx31037 +9.955 s by the clocks); learnt clocks agree with all 10 audio offsets within 0.8 s. GStroy 16x9 11 groups (+2 by the band rule, clock-consistent within 1.4 s like its strict pairs). GStroy 9x16 unchanged (10 groups); unrelated takes, drift and repeated sounds still never High.
- Panel: an uncertain pair now shows its reason; an accepted pair that needed the band rule or the clocks says so under its group.
- Premiere's own Synchronize cannot be called: neither UXP nor ExtendScript exposes it.

## 0.9.53 - SYNC: everything in recording order, also clips without a partner
- Clips without a second POV were placed after all groups. Now groups and single clips are laid out in one list in the order they were recorded (user's example: A 10:00, A+B 10:05, A 10:15 stays in that order).
- Recording time: the engine reads each file's `creation_time` (Sony writes the record start; equal to the XML sidecar), else the file time minus the duration (`media.probe`: `recorded`, `recorded_from`).
- Camera clocks: `chrono.py` learns each camera's clock difference from the synced pairs (median; reported when the pairs disagree by more than 3 s) and corrects all clips of that camera, the unsynced ones too. GStroy footage: the FX30 clock is 731 days behind the FX3's; 12 pair measurements agree within 2.1 s; the 6 lone clips now sit between the groups where they were recorded.
- Nothing is invented: a camera that never synced keeps its own clock only when it falls within 30 min of the session (reported as unchecked); a clip without any usable time keeps its place from the editor's timeline (follows its neighbour there) and is listed as „Несигурно място“ in the panel.
- Panel: groups are listed in the order of the new sequence; a corrected camera clock is named; unsynced clips are no longer described as „сложени накрая“.

## 0.9.52 - SYNC: no markers in the new sequence
- „Синхронизирай камерите“ no longer writes the „Група N“ / „Без синхрон“ markers into the new `SYNC – …` sequence (user, 2026-11-03: the timeline must stay clean). They were labels only; the clips are placed from the engine's offsets, so nothing about the sync changes. The group list stays in the panel's result. The user's own sequence and its markers were never touched and still are not.
- Tests: the Bulgarian dictionary loader (`lexicon.py`) now collects the files spylls 0.1.7 leaves open; their ResourceWarning used to fail whichever test was running at that moment under `-W error` (5 random failures).
- Numbering: 0.9.49-0.9.51 are skipped because a panel build labelled 0.9.51 that is not in this repository was seen on another computer; the next real version is 0.9.52 so the two can never be confused.

## 0.9.48 - subtitles: 5 times faster, numbers aligned, the Bulgarian transcription guide built in
- Speed (C9025, 8 pieces, 49.6 s of speech: **230 s → 45 s** from a cold cache): one Whisper reading per stretch of a source file with 4 s of context around the pieces and the windows of nearby pieces merged (91 s of audio read instead of 252 s); several windows read at the same time (`asr.workers()`: 5 readings × 2 threads on the M4 Max; one reading with 10 threads was SLOWER than with 4); alignment and checking run per window in parallel; the second opinion uses a cheaper decode.
- Words: unknown words are repaired by the smallest edit that gives exactly one dictionary word (`lexicon.repair`: reduced vowel, dropped vowel as „одяло“ → „одеяло“, two vowel edits „одялоце“ → „одеялце“, one letter „Взиваме“ → „Взимаме“ when the recording says „взимаме“ elsewhere); diminutives the dictionary lacks are accepted by their stem; „евро“ is known. Every repair is listed in the result.
- Second opinion: a piece that still has an unknown word (or a first-person „съм …л/ла“ form) is read again alone with 2 s of context; the reading with fewer doubts wins (C9025: „е одял, Острова“ became „одеяло струва“).
- Numbers: every number is given to the aligner as spoken Bulgarian (`numbers.py`: 500 → петстотин), and the aligner's confidence no longer discards a time (the confidence is no sign of a wrong word); only a word squeezed into too little time is distrusted. The words after prices were 0.3-0.5 s late before; now median 0.00 s.
- Review (guide §5, §7, §11): a month name in a conversation about prices, a word with no speech-like sound under it (the hallucinated „Така.“ was stretched over 1.3 s of breath), a gender-form disagreement between readings: each is marked „?“ with its reason in the panel; nothing is rewritten.
- Text: „5 ,79“ → „5,79“ (`subtitles.tidy_words`), a comma closes an „Ако …“ clause when Whisper wrote none; words stay inside their clip („Ах,“ no longer starts 0.6 s before it).
- Voiced sound without a word (the guide's first/last seconds check) is listed with its time: C9025 had two such places (0.26-0.91 s and 12.25-12.82 s); the panel says „чуй“.
- Results keep an immutable `verbatim` layer and an `edits` log next to the final words.
- `docs/BULGARIAN_TRANSCRIPTION_GUIDE.md` added as the permanent reference and linked from CLAUDE.md; its §10 table is `tests/test_guide_regressions.py`.
- Tests: 329 pytest + 70 node.

## 0.9.47 - subtitles: no speaker setting, captions clear sooner
- Tested large-v2 as a second opinion on the four real pieces: fixes „неща" but breaks „Примерно на мен", „то и за градината" and the end phrase is worse; not used, test model deleted.
- Removed the Мъж / Жена / Авто setting and `gender.py` (user: most clips have both speakers, so a gender rule would rewrite correctly spoken forms). Every form stays as heard; a form the readings disagree on is marked „?“.
- A caption now clears 0.15 s after its last word (was 0.3 s); the rule against a blank screen under 0.2 s between captions is unchanged. Measured on the real clip: captions that switched late/early by 80-120 ms are listed in `PROJECT_STATUS.md`.
- Tests: 280 pytest + 70 node.

## 0.9.46 - subtitles: corrections that re-time, speaker gender, silence trim
- Corrections and names: new box in СУБТИТРИ (per project, kept by the engine). `чуто => казано` replaces the heard words BEFORE the alignment, so the new words are placed by the sound, not copied over old times (`corrections.py`); a line without `=>` is a name/term for Whisper's prompt. The result says which corrections matched and warns about one that found nothing or cannot be read. Lines can be written from what the captions show (the by-ear respelling is matched too).
- (Removed in 0.9.47) Speaker (Авто / Мъж / Жена): first-person past forms after „съм“/„бях“ („свършила“ → „свършил“) are set to the speaker's gender, only to a form the dictionary knows (`gender.py`). Авто decides only from the forms heard in all readings (at least two votes, two to one); pitch was measured and rejected (150-258 Hz within one clip).
- Timing: a weak word is fitted between its aligned neighbours (no overlap); a word is not spoken in silence, so a start or end inside silence moves to where the voice is (`align.trim_silence`; thresholds follow the recording). „Ей,“ was 0.26 s early.
- Tested against Whisper's own times and stable-ts 2.19 on 13 words after a pause: median error -0.41 s / -0.10 s / +0.04 s (MMS_FA), within 80 ms 0 / 5 / 11 of 13. MMS_FA stays; after the silence trim 13 of 14 words are within 80 ms.
- Premiere cannot delete a caption track from any API (UXP: no; ExtendScript: only `createCaptionTrack`; QE removes only video/audio tracks), so a second press still refuses to stack a second set and says what to delete.
- `scripts/check_subtitles.py` checks a finished run against the audio (speech without a word, onset errors, captions over silence).
- Tests: 283 pytest + 70 node.

## 0.9.45 - subtitles: one press puts them on the timeline; alignment on; word check
- Placement: after the SRT is made, the panel puts it on a caption track of the active sequence. UXP cannot (probed again on 26.0.2: `Sequence` has no `createCaptionTrack`), so a new invisible CEP extension, the Asistent host (`host/`, installed by `scripts/install_host_mac.sh`, needs ONE Premiere restart), runs ExtendScript `createCaptionTrack`. Engine: `hostbridge.py`, `/host/poll`, `/host/result`, `/captions/place`, `captionstate.py`. The panel verifies the result (new track, item count, first/last time) and says where the captions are. A second press with an Asistent track still on the sequence does not stack a second one: it tells the editor to delete that track (Asistent never removes or mutes tracks). Not verified in Premiere yet.
- Missing first word: Whisper's early word starts pushed „Имаш“ out of the piece at a cut. With alignment installed the word is placed by the sound (energy trace confirms speech at 0.02-0.28 s) and kept.
- Timing: MMS_FA alignment is now installed and on (59 of 65 words aligned, 6 weak keep Whisper times); on „Добре,“ the aligned start is on the real onset (1.13 s; Whisper said 0.88 s, 0.25 s early in silence).
- Words: each piece is read three times with 0.7 s, 2 s and 4 s of surrounding sound (`consensus.py`); a word is replaced only when two readings agree AND the Bulgarian dictionary (`lexicon.py`, Hunspell bg_BG through `spylls`) knows the new word and not the old one; disagreement or an unknown word Whisper doubts is marked „?“ and the panel lists the words with their times. Voting without the dictionary turned „градината“ into „градвината“, so it never replaces on its own.
- Spelling by ear: Bulgarian reduces unstressed vowels (е heard as и, о as у, а as ъ), so Whisper wrote „нища“ for „неща“. An unknown word Whisper doubts that is exactly one swapped vowel (those pairs) away from ONE real word is respelled to it (`lexicon.respell`); several or no candidates: it stays and is reported. On the cached transcripts only „нища“ is touched.
- Verified in Premiere (user, TEST.prproj, 23:47): the host loaded after the restart, 25 captions went onto caption track C2 in one press, panel check found no problems; timing „a lot better“.
- A blank screen shorter than 0.2 s between two captions is bridged (no blink).
- Host check commands for development: `scripts/dev_cmd.py host ping|probe|captions|eval`, `host_status`.
- Tests: 269 pytest + 68 node.

## 0.9.44 - subtitles: per-piece recognition, optional alignment, natural phrases
- Words: each piece is recognised on its own with 2 s of real media around it (the joined mix of cut pieces gave „и аз да видим“, „Приведно на мен“; per piece gives „я да видим“, „Примерно на мен“).
- Timing: optional word alignment (MMS_FA, as in the 4a1a autoedit workflow) in its own environment; Whisper's raw word starts are early by a median 0.12 s. Off until installed (`scripts/setup_mac.sh --align`); the weights are CC-BY-NC 4.0, see LICENSES.md. The panel result says which timing was used.
- Grouping (short preset): phrases of 2-3 words by pauses, punctuation and grammar (no caption ends on a preposition, conjunction or particle; no sentence end inside a caption); one-frame lead, no blinking in continuous speech.
- Tests: 249 pytest + 60 node.

## 0.9.43 - subtitles: the cleanest microphone is recognised
- Fix: wrong words came from noisy, quiet camera-mic copies chosen only because they were on the lowest track. The engine now treats items that overlap and follow the same loudness envelope as duplicates and keeps the cleanest one (speech level over noise floor); speech the winner does not cover is kept from the weaker copy. The panel sends every eligible item; the result lists which copy replaced which.
- Result JSON now keeps the request items for reproduction.
- Tests: 234 pytest + 59 node (duplicate choice with synthetic microphones, partial overlap, different speakers, tie → lowest track).

## 0.9.42 - Phase 7 M3: dialogue mix, /subtitles job, СУБТИТРИ section
- Engine: `dialoguemix.py` (selected audio items as one 16 kHz mono signal at sequence time), `subtitle_job.py` and `POST /subtitles` (Whisper words cached by mix + prompt; captions per preset; SRT + JSON written to `<project folder>/Asistent_subtitles/`).
- Panel: section „СУБТИТРИ“ with „Субтитри (български)“; pure `subtitleplan.js` (duplicate audio on a higher track is skipped and named); the model download starts only from its own button that names the size.
- Verified end to end on a real Bulgarian clip through the live engine (2.8x real time) and by the user in Premiere (34 captions from 4 selected items, 4 duplicates skipped, frame size read, SRT written next to the project).
- Tests: 228 pytest + 60 node.

## Docs and workflow (earlier today)
- Docs: `NEXT_STEPS.md` is now `TODO.md`, `BUGS_AND_LIMITATIONS.md` is now `BUGS.md` (history preserved by `git mv`); added `CHANGELOG.md`, `docs/INDEX.md`, repo-local snapshot of the dev workflow and agents, extended `.gitignore`, a pre-commit documentation check.

## 0.9.41 - Phase 7 M2: speech recognition
- faster-whisper large-v3, local only, model downloaded after the user confirms; about 2.8x real time on the Mac.

## 0.9.40 - Phase 7 M1: subtitle text core
- `bgtext.py` (Bulgarian spelling), `subtitles.py` (line breaking, presets, frame snap, SRT with BOM). Not wired to the panel yet.

## 0.9.38-0.9.39 - Phase 7 plan and probes
- `docs/SUBTITLES_PLAN.md`; M0 probes. Verified in Premiere: Cyrillic SRT imports correctly with and without BOM.

## 0.9.33-0.9.37 - faces in "Цвят", test bridge
- Single-clip exposure uses detected faces; guard against unseen renders; Premiere test bridge (`devbridge`, only in TEST.prproj).

## 0.9.28-0.9.32 - Auto Shot Match
- Anchors (skin, neutrals, tones), measured Lumetri models, absolute idempotent fit, reference choice, flags, render check and revert.
- Skin measured only on faces found by the YuNet detector. Verified by the user on the GStroy pairs.

## 0.9.24-0.9.27 - ownership, statuses, audit log
- Managed correction ownership (fingerprints in `managed.json`; a manual Lumetri grade is never touched). Statuses and `color_audit.jsonl` per clip and press; accept/revert of parts that got worse. Verified in Premiere.

## 0.9.17-0.9.23 - colour check refinements
- Soft tolerance for final highlight clipping; colour analysis on timeline renders (480 px); one failing clip never stops the others; "Приложи и средните" counted per correction.

## 0.9.13-0.9.16 - exposure curve and step-back
- Probe verified (Temperature/Tint as channel gains, Exposure shoulder curve); Exposure in Lumetri units from the probe; clipping step-back measured from frames (verified: 4.4 % to 3.08 %).

## 0.9.9-0.9.12 - fixes
- Volume level always in Premiere's scale; only the audio buttons start "Оправи звука"; frame export works again (name must end in `.png`); presses ignored while the panel moves.

## 0.9.1-0.9.8 - panel and colour probe
- Results at the top of the panel, clearer colour result, exported frames found, section titles, clip level capped at +15 dB, sync reports which files it saw selected, selection read by list OR `getIsSelected`.

## 0.9.0 - Lumetri capability probe
- First step of the colour engine spec (`COLOR_CORRECTION_PLAN.md`).

## 0.8.0 - Phase 6: white balance and exposure
- Preview first, then apply Exposure/Temperature/Tint in Lumetri; Phase 5 (client profiles) started and later postponed.

## 0.7.1 - Phases 1-4
- UXP panel and Python engine; Smart Auto Sync (new `SYNC – <sequence>`); lavalier audio (Fill L/R, split copies, Volume level, phrase leveling, main mic peak at most -6 dBFS); auto import from watched folders.
