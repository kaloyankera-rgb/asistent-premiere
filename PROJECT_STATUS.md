# Project status — Asistent 0.9.13 (2026-11-01)

Installed on the user's MacBook (Premiere Pro 26.0.2, macOS 15.7, M4 Max): panel 0.9.13 via
UnifiedPluginInstallerAgent, engine 0.9.13 as LaunchAgent `com.contentstudio.asistent` (starts at login).
Git: `tools/asistent` repo, last commit see `git log`. Tests: 101 pytest + 14 node, all passing at 0.9.13.

Legend: **Done + verified in Premiere** · **Done, engine-tested, NOT verified in Premiere** · **Partial** · **Planned**

## Phase 1 — architecture (Done + verified)
UXP panel + Python engine on localhost, setup/release scripts for Mac, engine autostart. Windows script
`scripts/setup_win.ps1` written but never run.

## Phase 2 — Smart Auto Sync (Done + verified)
- Engine `sync.py`/`groups.py`: per-channel GCC-PHAT + onset candidates, quick reject, independent windows,
  5 ms tolerance, drift ≤ 100 ppm only over ≥ 60 s, groups of High pairs, same-folder pairs skipped,
  parallel, audio cache. Real footage (GStroy 9x16, FX3 + FX30, 28 clips): 10 groups, 0 false, ~6.6 s.
- Panel: timeline selection → new sequence `SYNC – <sequence>` in bin `SYNC`, one track per camera folder,
  groups in timeline order, markers; verified in Premiere 0.3.1 (28/28 clips placed, max 8.3 ms = half frame).
- Not done: manual sync for very short clips (< 8 s, only listed); sub-frame audio alignment.

## Phase 3 — Smart Audio (Partial verification)
- Engine `audio.py`: kinds one_channel, dual_mono, safety, phase_inverted, stereo_mic, same_voice, two_mics,
  uncertain, silent; loudness BS.1770 to −17 LUFS, peak ≤ −6 dBFS, noise cap −55 dBFS, ±30 dB; split refused
  when both channels carry one sound; phrase leveling with Volume keyframes (`phrase_plan`).
- Panel buttons: „Оправи звука“, „Раздели L/R“, „Раздели R/L“, „Само L“, „Само R“, „Само сила“, „Изравни фразите“.
- Verified in Premiere: Fill effects exist („Fill Left with Right“/„Fill Right with Left“), Volume Level uses
  Premiere's scale (0.1778 = 0 dB, max 1.0 = +15 dB), clone copies only the audio item.
- NOT verified: one Undo per press, „Раздели R/L“, „Изравни фразите“ keyframe positions. Level unit: always Premiere's scale since 0.9.9
  (the old guess misread a clip at +15 dB).

## Phase 4 — Auto import (Done + verified)
watchdog folder watching, browser-download completion (rename = ready after 0.3 s, copies 1.5 s), categories
MUSIC/SFX/BROLL/IMAGES/GRAPHICS/OTHER, one folder ↔ one project, no duplicates, long-poll to the panel,
import in place into bins. Verified 0.7.0 (Epidemic music/SFX, Shutterstock 4K B-roll). Speed-up of 0.7.1
not confirmed by the user.

## Phase 5 — client profiles + Prepare Project (Planned; postponed by the user to the office)
`engine/asistent/profiles.py` and `engine/asistent/prepare.py` exist as a first draft: not wired to the
server or panel, no tests. Basecamp text parsing not started.

## Phase 6 / colour engine (Partial)
Done, engine-tested (`tests/test_color.py`, 18 tests): `color.py` — frames read with rotation-aware size,
linear Rec.709 (BT.1886) and S-Log3/S-Gamut3.Cine (gamma from Sony sidecar XML), exposure from skin
(target 0.62 encoded luma) or mid-tones in 0.5-stop steps ±2, white balance from the largest near-neutral
group inside the camera-cast range checked against grey world, confidence rules, previews (720 px),
`check_render`, `Calibration` (Lumetri slider units), `probe_measure`.
Panel: „Цвят: бяло и експозиция“ → preview + „Приложи сигурните“/„Приложи и средните“ → appends Lumetri
(`AE.ADBE Lumetri`) and sets Exposure/Temperature/Tint; render check with `Exporter.exportSequenceFrame`.
„Проба на Lumetri (тестов проект)“ capability probe.
- Verified in Premiere: Lumetri appended on C0730 (0.9.4), 130 parameters enumerated, frames exported.
- NOT verified: values actually set and read back, render check (frame names fixed only in 0.9.5, no
  „color check“ entry in the log yet), Temperature/Tint calibration (`lumetri.json` does not exist yet),
  probe runs 12:03-12:10 (0.9.10/0.9.11, clips C0731, C0729, C0733, C0736, fx31033): Exposure (index 19), Temperature (14), Tint (15), Contrast (20), Saturation (16) are written, read back and restored. The measured table is NOT valid: `exportSequenceFrame` only queues the export, all frames were rendered after the values were restored (byte-identical) and same-named files from earlier runs were measured; the tables differed per clip. The calibration learnt from them was moved to `lumetri.before-0.9.12.json`. Fixed in 0.9.13 (unique names, wait for each finished frame); probe to rerun.
- Not implemented from the colour plan: analysis on timeline renders, colour-management/double-transform
  check, statuses + audit log, contrast, saturation, skin tones, shot match, Auto Color, accept/revert,
  managed correction ownership. See `COLOR_CORRECTION_PLAN.md` and `NEXT_STEPS.md`.

## Phases 7–9 (Planned)
7 Bulgarian subtitles (faster-whisper; reuse `tools/autoedit/asr.py` by copying), 8 rough-cut markers and
export QA, 9 Windows (run setup, silent install there, packaging for colleagues).
