# Changelog

All notable changes to Asistent. Newest first. Reconstructed from the git history up to 0.9.41 (all work so far happened on 2026-11-01); from here on every completed and verified task adds an entry under `Unreleased` or a new version heading (see the workflow in `CLAUDE.md`).

Versions are the panel/engine version (`panel/manifest.json` and `engine/asistent/config.py` always match). "Verified" means confirmed by the user in Premiere; details per feature are in `PROJECT_STATUS.md`.

## Unreleased

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
