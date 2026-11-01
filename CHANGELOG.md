# Changelog

All notable changes to Asistent. Newest first. Reconstructed from the git history up to 0.9.41 (all work so far happened on 2026-11-01); from here on every completed and verified task adds an entry under `Unreleased` or a new version heading (see the workflow in `CLAUDE.md`).

Versions are the panel/engine version (`panel/manifest.json` and `engine/asistent/config.py` always match). "Verified" means confirmed by the user in Premiere; details per feature are in `PROJECT_STATUS.md`.

## Unreleased

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
