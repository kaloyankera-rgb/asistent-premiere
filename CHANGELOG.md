# Changelog

All notable changes to Asistent. Newest first. Reconstructed from the git history up to 0.9.41 (all work so far happened on 2026-11-01); from here on every completed and verified task adds an entry under `Unreleased` or a new version heading (see the workflow in `CLAUDE.md`).

Versions are the panel/engine version (`panel/manifest.json` and `engine/asistent/config.py` always match). "Verified" means confirmed by the user in Premiere; details per feature are in `PROJECT_STATUS.md`.

## Unreleased

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
