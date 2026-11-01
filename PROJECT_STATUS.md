# Project status — Asistent 0.9.28 (2026-11-01)

Installed on the user's MacBook (Premiere Pro 26.0.2, macOS 15.7, M4 Max): panel 0.9.28 via
UnifiedPluginInstallerAgent, engine 0.9.28 as LaunchAgent `com.contentstudio.asistent` (starts at login).
Git: `tools/asistent` repo, last commit see `git log`. Tests: 150 pytest + 41 node, all passing at 0.9.28.

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
  the brightness is from the target. No further automatic step (Undo stays at 3 at most).
- **Step-back verified (12:40, C0739, 0.9.16):** +0.5 stops → 0.65 units, skin 0.007 stop from target;
  4.42 % newly clipped → pull-back 0.15 units → re-check 3.08 % (limit 3 %, the engine would have taken
  another 0.05), skin 0.10 stop dark (on target). The old fixed 0.5 would have left 0.15 units.
- 0.9.17: final clipping verdict (reporting only, the exposure path of c289c31 untouched): ACCEPTED ≤ 3.00 %,
  ACCEPTED_WITH_WARNING up to +0.25 points (`CLIP_SOFT_TOLERANCE`, per call `clip_tolerance`) or when the
  excess is only in areas already near white before (≥ 0.90: lamps, windows, sky), REVIEW_NEEDED above that
  or when skin TONES (skin-coloured, < 0.90 before) clip on > 1 % of the skin area; a first check followed by
  the step-back is STEP_BACK, not a verdict. Never triggers another correction. Replayed on the C0739 frames:
  first 4.42 % → 0.15 back (unchanged) → recheck 3.08 % ACCEPTED_WITH_WARNING with the specified message.
  Found while replaying: the skin box also catches warm near-white highlights (C0739: 189 scattered pixels at
  0.94-0.97), so skin clipping counts only skin tones below 0.90.
- 0.9.18: analysis on timeline renders (spec T13/T18). The panel exports 4 frames per clip from the sequence
  (720 px, evenly inside the clip, moments under an upper layer skipped, `moments.js`), the engine measures
  them as Rec.709 with any existing correction included, so a corrected clip measures as fine. Fewer than two
  usable frames (covered, export failed) → measured on the file, `status: REVIEW_NEEDED`, confidence low
  (shown, never applied). Log sources measured on the timeline: confidence low until the colour-management
  step shows whether Premiere converts them.
- 12:58 (C0739, 0.9.18): analysis measured on 4 timeline frames (verified); the clip had no correction (the
  12:40 one was undone), so +0.5 again was right and the apply reproduced 12:40 exactly. Bug found: the final
  re-check was labelled STEP_BACK. 0.9.19: the panel sends `final` on the re-check; the engine then gives the
  verdict only (replayed on the real frames: ACCEPTED_WITH_WARNING, the specified message).
- **Re-run on a corrected clip FAILED at 0.9.19 (13:08, C0739 with Exposure 0.5 on it):** suggested +0.5 again;
  the four 720 px timeline frames were byte-identical to the uncorrected ones from 12:58, while the 480 px
  check frames follow every change. 0.9.20: analysis exports at 480 px, plus one 720 px diagnostic of the
  first moment (log line `diag720`: mean luma at both sizes) to confirm whether the size is the cause.
- 13:12 (0.9.20): still +0.5. Size is NOT the cause (moment 0: 480 px 0.576, 720 px 0.5725 = the uncorrected
  12:58 value), and a fresh 480 px render is also uncorrected, so not a stale cache: Premiere renders the
  correction at the clip's middle (0.573 → 0.627 at 13:06) but not at the analysis moments. Suspected: the
  value written by „Приложи“ is time-dependent (keyframe). 0.9.21 logs the clip's Lumetri state
  (`diag lumetri`: value, isTimeVarying, keyframes, value at the moments) and the middle frame (`diag frames`).
- 13:16 (0.9.21): Premiere reported NO Lumetri on C0739 and the middle rendered uncorrected (0.5732): every
  re-run so far started from a clip whose correction had been undone, so the analysis was right each time and
  the keyframe theory is wrong (Exposure is a constant, stopwatch off). Idempotence still to be shown with one
  „Цвят“ press right after an apply. The diagnostics stay until then.
- 0.9.22 (user's rule: one static best-effort value per clip, no keyframes; a clip too far gone gets what is
  possible within the range and the work moves on): out-of-range clips say so („извън обхвата… не се гони“);
  one failing clip no longer stops the analysis or the apply of the others.
- **Re-run on a corrected clip VERIFIED (13:24, fx39026, 0.9.22):** with Asistent's Temperature −4.7 / Tint 12.5
  on the clip (diag lumetri confirms), the timeline analysis measured the white as balanced (cast 0.05/−0.008,
  was −0.094/+0.187) and suggested no new white correction; exposure +2 was still suggested because it had
  not been applied (exposure was medium confidence, „Приложи сигурните“ = high only).
- Gap found: „Приложи и средните“ afterwards was refused („вече има Lumetri с промени (temperature, tint)“):
  the never-touch-a-grade rule also blocks Asistent's OWN correction, so a missing exposure cannot be added.
  Needs managed correction ownership (NEXT_STEPS B6).
- Bug (user, fx39024 13:25): with a high white and a medium exposure only „Приложи сигурните“ was shown (buttons
  counted clips, 1 = 1), so the exposure could not be applied even on a clean clip. 0.9.23: `colorplans.js`
  counts corrections; „Приложи и средните“ appears whenever it adds one; „сигурните“ names what it left out
  (with the Undo hint until B6 exists).
- **Verified 13:34 (fx39024, 0.9.23):** both buttons shown; on the clean clip „Приложи и средните“ applied
  Exposure (+2 stops, capped: the clip measured +2.43) with Temperature/Tint; 1.74 % new clipping (ACCEPTED),
  white residual 0.05/−0.05 (neutral), skin still 0.68 stop under target (out-of-range clip: one capped pass,
  as the user wants). The first try at 13:34:17 was refused by Asistent's own earlier Lumetri (B6 gap again).
- 0.9.24: managed correction ownership (B6). After every write the panel fingerprints the whole Lumetri (all
  parameters) and the engine keeps the sha1 per clip (path + source in/out, `managed.json`, last 6 states, so
  an undone step-back still counts). An existing Lumetri is updated only when its fingerprint matches; then the
  new suggestion (a difference, measured on the timeline) is added to its current values; the render check
  gets the differences. Any manual change → not Asistent's → never touched. Lumetris written before 0.9.24 have
  no fingerprint and stay protected.
- **Ownership verified (16:12-16:13, fx39024, 0.9.24):** „сигурните“ wrote the white and recorded it; „средните“
  recognised Asistent's own Lumetri and added Exposure 2.1 to it; after the user moved Exposure to 1.9 by hand
  the next apply left the clip alone. Bug: step 2 also moved Temperature −4.9 → −0.2 and Tint 12.8 → 11.5: the
  render check called the white neutral (residual 0.096 < 0.1) but the re-analysis flags from 0.08 and
  „corrected" it back. 0.9.25: on Asistent's own Lumetri a white within the check's limits (0.1 / 0.06,
  `WHITE_OK`) is kept; the refine step uses the same limits. NOT verified in Premiere yet.
- 0.9.26: temporary diagnostics removed (4 timeline frames per clip again). Statuses + audit (B4): every clip of
  a press gets CORRECTED / ALREADY_BALANCED / REVIEW_NEEDED / REVERTED / PARTLY_REVERTED / BLOCKED / FAILED
  (shown next to the clip name) and one JSON line in `color_audit.jsonl`. Accept/revert (B5): every check
  measures before and after; a part (white, exposure) that ended measurably worse than before this press is
  put back to its previous value in one extra Undo step („Asistent: върни влошеното“). White: worse = outside
  the neutral limits AND further than before; exposure: further from the target by > 0.15 stop (overshoot).
  Clipping is never a revert gate (user's rule). A refined white now also gets the final re-check.
- **Verified 16:17-16:25 (0.9.26):** statuses and audit records written (fx39026 CORRECTED twice, gates white
  better / exposure better, no revert); ownership in real use: „сигурните“ (white) then „Цвят“ + „средните“
  added Exposure 2.1 to the same Lumetri in one Undo step, white kept (fx39024, fx39026). Found: a white refine
  wrote the same sliders again (−4.7/12.5: extra Undo step, identical re-check); the Undo hint was outdated; the
  second press showed no result line. 0.9.27: refine skipped when it would not change the sliders by ≥ 0.5,
  every check shows one result line, hint says „Цвят“ + „Приложи и средните“ (no Undo).
- Observation (fx39027 16:19): skin exactly on target (0.0005) but 6.4 % of the skin area clipped → REVIEW_NEEDED:
  the 0.62 skin target may be too bright for some faces (input for „exposure taste“, NEXT_STEPS B9). Attempt 12:26 on fx31031 was skipped: the
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

## Auto Shot Match (0.9.28, user's priority 2026-11-01; skin brightness and S-Log3 parked)
„Изравни камерите“ (ЦВЯТ): selected clips grouped into cameras (media folder, or file-name prefix when all
share one folder); for each clip 4 source moments, inside the timeline overlap with the other cameras when
there is one (same real moment), evenly otherwise. Engine `shotmatch.py`: anchors per frame, never average
RGB/luma: skin (brightness, hue, saturation), neutral surfaces (white), tone spread (contrast, only on common
moments). Lumetri simulated with models fitted from the C0737 probe frames: Temperature/Tint channel gains,
Exposure with the shoulder curve, Contrast slope 1 + 0.00229·c around 0.50 encoded, Saturation chroma ×
(1 + 0.0093·(S−100)). Reference: the chosen camera or the most reliable (skin, neutrals, exposure, clipping);
„Еталон: …“ buttons re-run against another camera. The fit gives ABSOLUTE values from the source (re-run =
same values, `changed` empty); unfitted/flagged/tiny components keep the clip's current value. Flags instead
of force: > 1.5 stops, white > 0.5/0.3, neutrals vs skin disagreeing, no anchor, contrast/saturation > 20.
Apply: only changed components, new or Asistent-owned Lumetri only (manual grade → BLOCKED); each clip
checked on a Premiere frame at a visible moment against the reference look, worse components put back in one
step; fully covered clips: model only (said). Log/S-Log clips skipped. Audit: `kind: shotmatch`.
NOT verified in Premiere yet (needs real multi-POV footage).
