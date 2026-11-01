# Phase 7 plan: Bulgarian subtitles (architecture-planner, 2026-11-01; recommendations accepted by the user, M0 run)

Goal: select the dialogue clips, press one button → local Whisper large-v3 → the user's spelling and line-breaking
rules → review in the panel with uncertain words flagged → SRT; into Premiere only on a second press, one Undo step.
Nothing is downloaded without the user's OK. V = verified, A = assumed.

## Findings
- Line breaking already exists: `tools/autoedit/export.py` `caption_lines` (line 16) and `write_srt` (line 72): numbers
  glued to their word, function words never ending a line, pause > 0.35 s splits, `bgtext.fix_prepositions`. 4a1a:
  `caption_max_words 2`, `caption_max_chars 11`, `punct true`, `case as-is`, Whisper `prompt` with brand terms
  (`clients/4a1a Racing/edit-style.json`). Copy, do not rewrite. (V)
- ASR to copy: `tools/autoedit/asr.py` (faster-whisper large-v3, word timestamps, CUDA first, CPU int8 fallback; fed a
  numpy array from a wav because PyAV breaks the decoder). MMS_FA alignment needs torch. (V)
- Manual SRT path: autoedit's README says import the `.srt`, drag it over the sequence, Premiere creates the caption
  track, style in Essential Graphics. Not re-checked with Cyrillic on 26.0.2. (A)
- Premiere 26.0.2 API (bridge `api`, read only): `ppro.Transcript` = `importFromJSON`, `exportToJSON`,
  `createImportTextSegmentsAction`; `ppro.TextSegments` static `importFromJSON`/`exportToJSON`; `CaptionTrack` read
  only; no create-caption-track or add-caption method; `project.importFiles`. (V) Formats and behaviour: unverified.
- Engine: jobs via `JOBS.submit` with progress/cancel (2 workers); `readItem` gives path, in/out, start/end, speed,
  reversed, track; speed ≠ 1 and reversed are already skipped; `audio.py` classifies channels. (V)
- Original spec (`PROGRESS.md:141`) also lists MMS_FA alignment, English translation, bilingual subtitles, face
  detection: later milestones (MMS_FA moved to M6, see decision 4).

## Decisions proposed
- **Output:** (a) MVP: SRT imported into a bin „Субтитри“, the user drags it over the sequence (our line breaks survive;
  per-client track style). Automatic placement on a caption track only if probe P2 passes. (b) Later, optional:
  `Transcript` import (P3) — Premiere's own „Create captions“ re-breaks lines against the user's rules. (c) Rejected:
  a MOGRT per caption (hundreds of items, unclear Undo), burned-in ProRes (not editable).
- **ASR:** faster-whisper large-v3 on both machines (one code path, Bulgarian proven in autoedit). Windows CUDA float16;
  Mac CPU int8 (CTranslate2 has no Metal). Estimates (A, to be measured in M2): Mac CPU 60 s clip ≈ 20-60 s, 10 min ≈
  4-10 min; Windows CUDA ≈ 5-10 s / 1-2 min; MLX on the Mac GPU ≈ 5-10 s / ≈ 1 min (M5, only if M2 is too slow, after
  checking its dependencies). Not whisper.cpp (second model format, a binary per machine). large-v3, not turbo.
- **Alignment:** Whisper word timestamps (A: ±0.1-0.2 s) + snap each caption start to the speech onset in the mix
  within ±150 ms (RMS envelope, numpy). No torch in the MVP; MMS_FA in M6 if the user sees drift.
- **Model:** `Systran/faster-whisper-large-v3` (MIT, ~3.1 GB) in `<app_dir>/models/whisper`, loaded with
  `local_files_only=True` (never downloads on its own). Download only from a panel button after a confirm naming size
  and place, as a job with progress. Windows: reuse autoedit's Hugging Face cache if present. pip deps (faster-whisper,
  ctranslate2, tokenizers, huggingface_hub, onnxruntime, av; ~200-300 MB, A) in `requirements-asr.txt`, outside the base
  requirements; installing them also needs the user's OK.
- **Audio:** one 16 kHz mono dialogue mix in sequence time from the selected audio items (cut to in/out, placed at
  start, ffmpeg) → word times are sequence times. Overlapping items (POVs sharing audio): the lowest audio track wins,
  the others listed as „пропуснати, дублират A1“. Channels from `audio.py` (one_channel/phase_inverted → the good
  channel, dual_mono → one, two_mics → summed). Speed ≠ 1, reversed, nested/offline skipped with a reason. Times
  snapped to frames.
- **Text:** copy `bgtext.py` and `caption_lines`. Presets: „Кратки (9:16)“ 2 words, 11-16 chars, 1 line, 0.5-2.5 s;
  „Стандартни (16:9)“ 2 × 42 chars, 1-6 s; picked from the sequence frame size. Optional „Имена и термини“ →
  Whisper `initial_prompt`, saved per project in `subtitles.json`. Words with p < 0.5 flagged „?“ in the review. No
  auto-correction beyond в/във, с/със.
- **Files:** `<project folder>/Asistent_subtitles/<sequence> <date-time>.srt` + `.json` (words, p, sources, skipped).
  ASR cached in `cache/subtitles/` by mix + prompt, so rule changes do not re-run Whisper.

## Milestones (each: implement → tests → bump → `release_mac.sh` → user verifies → commit → `PROJECT_STATUS.md`)
- **M0 Probes in TEST.prproj** (needs the user's OK: they write to TEST.prproj). New bridge commands:
  P1 `srt_import` (tiny Cyrillic .srt, UTF-8 with and without BOM, into bin „Asistent тест“: item type, content type,
  Cyrillic intact?); P2 `caption_place` (`createOverwriteItemAction` / `createInsertProjectItemAction` at 0 in one
  transaction, caption track count before/after, the user undoes); P3 `transcript_export` (`Transcript.exportToJSON` on
  a clip the user transcribed once in Premiere's Text panel: reveals the format; the user checks whether Premiere's
  Speech to Text lists Bulgarian). Done: results in `PROJECT_STATUS.md` and `DECISIONS.md`.
- **M1 Text core:** `engine/asistent/bgtext.py`, `subtitles.py` (rules, frame snap, min/max duration, presets, flags,
  SRT writer with BOM per P1), `tests/test_subtitles.py` (във/със, „Формула 1“, „за 8 евро“, no function word at line
  end, pause splits, max chars, flags).
- **M2 ASR + install** (needs the OK for pip + 3 GB): `engine/asistent/asr.py` (copied; `download_root`,
  `local_files_only`, per-segment cancel/progress, one ASR job at a time, model freed after 10 min idle),
  `requirements-asr.txt`, `--subtitles` / `-Subtitles` in the setup scripts, `GET /subtitles/model`, job
  `POST /subtitles/model/download`, LICENSES rows. Tests: missing backend/model → clear Bulgarian error; a real 30-60 s
  Bulgarian clip on this Mac only (logs the speed).
- **M3 Dialogue mix + `/subtitles` job:** mix builder, job, cache; panel section „СУБТИТРИ“ with „Субтитри (български)“;
  pure `panel/subtitleplan.js` (audio items, overlap, skip reasons; zip list). Tests: synthetic two-item mix at the right
  sequence times, fake backend word times, overlap dedup, node tests.
- **M4 Review + import:** result list (time, text, flags, counts, skipped); „Внеси в проекта“ = `importFiles` into
  „Субтитри“ (one Undo) + drag hint; „Сложи на caption пътека“ only if P2 passed. `panel/premiere-subtitles.js`.
- **M5 (optional):** MLX backend on the Mac behind the same interface (dependency check + download OK).
- **M6 Later:** Transcript import (P3), caption position off faces (`faces.py` on exported frames), EN translation and
  bilingual subtitles, MMS_FA alignment, editing text in the panel, client prompt from Phase 5 profiles.

LICENSES rows: faster-whisper, CTranslate2, Whisper weights (OpenAI) + Systran conversion: MIT; huggingface_hub,
tokenizers: Apache-2.0; onnxruntime (Silero VAD): MIT; PyAV: BSD (bundles LGPL FFmpeg); code copied from autoedit: same
author.

## Acceptance
Tests: 4a1a preset ≤ 2 words / 11 (+4) chars; no line ends in във/или/за/на; „Формула 1“ never split; words at sequence
time ± 1 frame; overlapping POV audio transcribed once; speed ≠ 1 / reversed skipped and named; no download without the
explicit job; cancel within one segment; new panel modules in the zip list.
Live in Premiere: Cyrillic SRT import (P1); the caption item lines up at 00:00; „Внеси“ = one Undo; P2 placement; real
Bulgarian accuracy and timing judged by the user; speed on the Mac and on the Windows PC (CUDA never run there).

## M0 results (2026-11-01 18:43-18:50, TEST.prproj, panel/engine 0.9.39, through the bridge)
- **P1 SRT import: works.** `project.importFiles([utf8.srt, bom.srt], true, bin, false)` → `true`; both appear in the bin
  „Asistent тест“ as `ClipProjectItem`, `type` 1, `getContentType()` 1, media path = the .srt. Whether the Cyrillic text is
  intact (with and without BOM) is NOT visible through the API: the user drags each over a sequence and looks.
- **P2 caption placement: does not work.** `createOverwriteItemAction` and `createInsertProjectItemAction` with the SRT
  item at the sequence end (+5 s, top video/audio track) each committed a transaction without an error, but nothing
  appeared: caption tracks 0 → 0, video/audio tracks unchanged, no item after the end. (Two empty Undo steps
  „Asistent тест: субтитри (overwrite/insert)“ were left.) → no automatic placement; the MVP stays „внеси + довлечи“.
- **P3 transcript export: blocked.** `Transcript.exportToJSON(ClipProjectItem)` → „Illegal Parameter type“,
  `exportToJSON(ProjectItem)` → „Invalid parameter.“ on C9010 (no Premiere transcript on it); `ClipProjectItem` and
  `ProjectItem` have no transcript/text/caption methods. Needs a clip the user transcribed once in Premiere's Text
  panel (and the answer whether Speech to Text lists Bulgarian) before the format can be read.

## Open decisions for the user
1. Mac speed: faster-whisper CPU first (recommended), MLX later only if M2 is too slow.
2. Downloads: ~3 GB model + ~250 MB pip on the Mac (Windows reuses autoedit's model if there); large-v3, not turbo.
3. Output: SRT into a bin + drag (recommended) vs automatic placement (only if P2 passes) vs Premiere transcript (P3).
4. Timing: Whisper timestamps + onset snap (recommended) vs MMS_FA (torch, ~1-2 GB more, A) only if captions lag.
   Note: the original spec named MMS_FA; the plan defers it.
