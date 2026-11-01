# Project status — Asistent 0.9.16 (2026-11-01)

Installed on the user's MacBook (Premiere Pro 26.0.2, macOS 15.7, M4 Max): panel 0.9.16 via
UnifiedPluginInstallerAgent, engine 0.9.16 as LaunchAgent `com.contentstudio.asistent` (starts at login).
Git: `tools/asistent` repo, last commit see `git log`. Tests: 107 pytest + 14 node, all passing at 0.9.16.

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
- **First real „Приложи“ (12:21, fx31032, 0.9.13):** +1.5 stops suggested, written as 1.5 units (pre-curve);
  render check worked: skin still 0.28 stop short (the Exposure shoulder), 3.95 % newly clipped → stepped back
  to 1.0 in a second step (3 Undo steps in all: append Lumetri, values, step-back); white residual 0.048
  (neutral). The same check learnt Temperature −84 (biased by the simultaneous Exposure change): removed,
  backup `lumetri.before-0.9.14.json`.
- 0.9.14: Exposure suggestions carry Lumetri units from the probe's curve (`exposure_curve` in `lumetri.json`,
  brightening only; darkening still 1:1, unmeasured); the panel writes units and shows stops = units.
  Probe values (`probe` in `lumetri.json`: temp −50, tint −66.67) are authoritative; a render check learns
  only an axis the probe never measured and never from a render that also changed Exposure.
- **Apply with the curve verified (12:29, fx31032, 0.9.15):** +1.5 stops → Exposure 1.7 units; skin 0.14 stop
  short (was 0.28 with 1:1 units), white residual 0.047 (neutral), Temperature −5.1 / Tint 2.4 from the probe
  values, nothing learnt (correct). 5.6 % newly clipped → stepped back a fixed 0.5 to 1.2 units: that final
  state is NOT re-checked (skin likely ~0.5 stop under again, clipping after the step unknown).
- 0.9.16: the step-back is measured: `pullback_units` (engine, from the before/after frames and the probe
  curve) takes Exposure back only as far as needed for ≤ 3 % new clipping (on the 12:29 frames: 0.35 units
  instead of the fixed 0.5); the panel then exports one more frame and reports the real clipping and how far
  the brightness is from the target. No further automatic step (Undo stays at 3 at most). NOT verified in
  Premiere yet. Attempt 12:26 on fx31031 was skipped: the
  clip already had a graded Lumetri (left alone by design); 0.9.15 no longer reports such a press as „Приложено“.
  Earlier probe runs 12:03-12:10 (0.9.10/0.9.11) were invalid (queued exports, reused file names); their calibration
  is kept aside in `lumetri.before-0.9.12.json`.
- **Probe VERIFIED at 0.9.13 (12:16, C0737, TEST.prproj):** 7 distinct frames written in order ~0.33 s apart;
  source and empty-Lumetri frames byte-identical (an untouched Lumetri changes nothing). Table: white balance,
  exposure, contrast, saturation SUPPORTED; skin tones PARTIAL (global only); colour management PARTIAL (clip
  input/embedded LUT readable, here none). Indices: Temperature 14, Tint 15, Saturation 16, Exposure 19,
  Contrast 20. Checked pixel by pixel on unclipped pixels:
  - Temperature +50 = pure channel gains R +0.41, G −0.09, B −0.59 stops (spread ±0.02) → −50 units per log2 B/R.
  - Tint +50 = R +0.49, G −0.26, B +0.49 stops → −66.7 units per log2 G/√(RB). Same values on C0729 → clip-independent.
    `lumetri.json` now holds only these (temp −50, tint −66.7).
  - Exposure +1 is NOT a plain gain: +1.00 stop in shadows (encoded luma < 0.2), +0.92 at 0.3–0.4, +0.79 at
    0.5–0.6, +0.68 at 0.6–0.7, +0.57 at 0.7–0.8 (soft highlight shoulder). Skin (target 0.62) gets ~0.7 stop per
    unit, so the planner must use this curve, not 1 stop/unit (next step).
- Not implemented from the colour plan: analysis on timeline renders, colour-management/double-transform
  check, statuses + audit log, contrast, saturation, skin tones, shot match, Auto Color, accept/revert,
  managed correction ownership. See `COLOR_CORRECTION_PLAN.md` and `NEXT_STEPS.md`.

## Phases 7–9 (Planned)
7 Bulgarian subtitles (faster-whisper; reuse `tools/autoedit/asr.py` by copying), 8 rough-cut markers and
export QA, 9 Windows (run setup, silent install there, packaging for colleagues).
