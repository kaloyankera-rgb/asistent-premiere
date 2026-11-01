# Modular automatic color correction — implementation specification

## Seven operations
1. **Auto Color Correct**: inspect all categories; run ONLY justified modules and check final rendered output.
2. **White Balance**: estimate credible neutral color shift; adjust Temperature/Tint only, preserving scene mood.
3. **Exposure**: protect subject/highlights; change exposure-related controls only; don't lift deliberately dark scenes.
4. **Contrast**: optimize tonal separation only where warranted; preserve highlight and shadow detail.
5. **Saturation**: correct measurable under/over-saturation without oversaturating skin.
6. **Skin Tones**: use reliable skin ROI and targeted controls where supported; avoid uniform skin-tone targets.
7. **Shot Match**: match genuine unwanted differences for shots under comparable conditions; preserve intentional changes.

## Core safety invariant
**No-change is a successful outcome.** If a shot is correctly balanced, or data are insufficient, return SKIPPED with no effect modifications.

- Read and preserve pre-existing manual grades; use separate managed correction instance/layer when feasible.
- Re-running must be idempotent or have explicit correction ownership/reset logic; no accumulating green/magenta, exposure, or saturation shifts.
- Protect unrelated params. Detect cross-module coupling and flag conflicts rather than pretending perfect independence of final pixels.
- Render full output from Premiere for comparison, not just source frames.
- Automatically revert changes if any technical gate worsens or the effect operation fails.
- Never force both RGB equality and desired artistic mood. Neutral white references can be missing, tinted, clipped, or under colored lighting.

## Default conservative mode
- Do not make a correction unless confidence and expected improvement clear calibrated thresholds on representative footage.
- Separate *technical correction* from any optional creative look.
- In SDR Rec.709, near-black/highlight and facial IRE ranges are soft guidance only; not universal constraints. Do not assume same skin brightness across complexions or lighting.
- For mixed lights, do not apply aggressive global white balance to fix one region at expense of another.
- Keep disabled/unknown tools unavailable rather than substituting guessed Lumetri values.

## Pipeline
`source metadata and Premiere timeline state -> representative frame selection -> diagnostics -> confidence -> proposed parameter delta -> save state -> apply -> render through Premiere -> compare -> keep/revert -> structured audit log`

## Decision statuses
- `ALREADY_BALANCED`: no edits
- `CORRECTED`: evidence of improvement after render
- `REVIEW_NEEDED`: ambiguous image/light/profile or unsupported local operation
- `REVERTED`: post-render quality regressed
- `BLOCKED`: API or environmental capability absent
- `FAILED`: operational error, state restored

## Application order
Color-management verification -> scene analysis -> white balance when justified -> exposure and contrast jointly checked for interaction -> saturation -> targeted skin correction when available -> shot matching -> final render QC.
The *independent buttons* run only their requested module, except minimal shared validation. Never quietly execute all seven.
