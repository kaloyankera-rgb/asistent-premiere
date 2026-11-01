# Automatic Color Correction Engine — requirements (preserved) and implementation map

Source: the user's message of 2026-11-01 ("AUTOMATIC COLOR CORRECTION ENGINE — COMPLETE IMPLEMENTATION",
18 sections) plus the reference package `Premiere_Color_Engine_Claude` (8 files), now copied to
`docs/color-spec/`. Target: the existing extension **Asistent** (not Quick Search, which the first spec forbids touching).

**Completeness of the source:** sections 1–9 arrived in full and are preserved below almost verbatim.
Section 10 was cut off after its title ("10. CONFIDENCE-B…"). Sections 10–17 are known only from the user's
one-line summaries (section 17 itself was cut mid-word). **Section 18 is missing entirely** (title and content
unknown). Ask the user for the full text of 10–18 before treating these parts as specified.

## Reference package (`docs/color-spec/`)
| File | Role |
|---|---|
| `00_START_HERE.md` | Order of work; rules: no change on correct footage, preserve manual grades, isolate operations, check rendered output, skip and flag when uncertain, do not claim training from reading |
| `01_PREMIERE_API_COMPATIBILITY.md` | Mandatory capability probe before control code; module ↔ Lumetri controls table; colour-management prerequisites; SUPPORTED/PARTIAL/BLOCKED deliverable |
| `02_COLOR_CORRECTION_SPEC.md` | Seven operations, core safety invariant, conservative mode, pipeline, statuses, application order |
| `03_ANALYSIS_AND_QA.md` | Sampling, measurements, WB and exposure guardrails, closed-loop QA, quality record JSON, regression criteria |
| `04_REFERENCE_CASES.json` | 9 synthetic scenario descriptions (not real graded footage) |
| `05_TEST_MATRIX.csv` | Regression tests T01–T18 |
| `06_REFERENCE_TEMPLATE.json` | Template to document the user's own reference footage |
| `07_OFFICIAL_ADOBE_REFERENCES.md` | Adobe documentation (Lumetri scopes, colour management, UXP Component/ComponentParam, recipes) |

---

## 1. Role and objective
Implement a professional, reliable, modular Automatic Color Correction Engine directly in the existing Premiere
Pro extension (not a separate application or Claude Skill). Deliver accurate, natural, consistent correction with
minimal manual intervention. Core principle: **only correct what genuinely needs correction; never modify footage
that is already properly balanced.** Prioritize: accurate white balance; natural, controlled exposure; no unwanted
green or magenta casts; realistic skin tones; balanced contrast and saturation; highlight and shadow preservation;
shot-to-shot consistency; non-destructive corrections; automatic validation and rollback; preservation of
already-correct footage.

## 1b. Reference package — mandatory (from the user's message)
Before implementing: extract and read every file starting with `00_START_HERE.md`; understand the specifications and
test scenarios; inspect the official Adobe documentation referenced; compare with the existing extension architecture;
identify what is already implemented; implement only missing or incomplete functionality; avoid duplicating systems.
Rules: use the documents as specifications; do not assume the JSON scenarios are real professionally graded footage;
do not invent reference images, footage or measurements; if Adobe documentation conflicts with the references, verify
the current API and document the discrepancy; use actual Premiere functionality wherever possible.

## 2. Seven independently executable operations
**2.1 Auto Color Correct** — analyze; identify actual colour and exposure problems; decide which modules are
necessary; skip parameters already correct; apply only justified corrections; validate the actual rendered output;
revert corrections that degrade the image. Do not run every module unless necessary.
**2.2 Auto White Balance** — detect unwanted green/magenta casts and excessive warm/cool casts; identify reliable
neutral reference regions; analyze RGB balance; account for natural skin tones; preserve intentional coloured
lighting; handle mixed lighting conservatively; adjust Temperature and Tint only when justified; do not modify
exposure, contrast or saturation.
**2.3 Auto Exposure** — analyze subject brightness and luminance distribution; protect highlight detail; preserve
appropriate shadow detail; prevent overexposed faces; avoid excessive brightening; preserve naturally dark
environments; avoid unnecessary shadow lifting; do not modify white balance or saturation.
**2.4 Auto Contrast** — maintain natural contrast; avoid crushed blacks and washed-out footage; preserve highlight
and shadow detail; avoid unnecessary contrast boosts; do not modify unrelated colour parameters.
**2.5 Auto Saturation** — detect excessive saturation and unnatural desaturation; preserve natural colours; avoid
oversaturated skin; preserve intentional colour styling; never increase saturation to look "cinematic".
**2.6 Auto Skin Tones** — targeted corrections when reliable skin detection is available; detect unwanted green,
magenta, red or orange casts; preserve different natural complexions; respect environmental lighting; avoid
artificial skin colours; prefer localized corrections where supported; do not aggressively modify the whole frame
to fix a localized skin problem.
**2.7 Auto Shot Match** — match footage of the same scene: identify a reference shot; compare exposure, white
balance, contrast, saturation and skin appearance; preserve intentional lighting differences; never blindly copy
identical Lumetri settings.

## 3. Shared image analysis engine
Reusable analysis for all operations (OpenCV, NumPy, FFmpeg where appropriate), multiple representative frames per
clip. Measure: luminance distribution and percentiles; highlight and shadow clipping; RGB channel balance; reliable
neutral regions; skin regions where detectable; saturation distribution; temporal colour consistency; differences
between neighbouring clips. Do not rely only on subjective AI visual interpretation. Never assume the whole image
should be neutral grey. Never use global grey-world as the sole white-balance algorithm. Interpret all measurements
in the correct colour space and transfer function.

## 4. Color management
Before correcting: identify the source colour profile; inspect Premiere colour-management settings; identify existing
technical LUTs when accessible; determine working and output colour spaces; prevent duplicate technical transforms.
Support correctly identified Rec.709, Sony S-Log3 / S-Gamut3.Cine, and other formats when metadata and supported
transforms exist. Never apply a technical LUT twice, treat unconverted log as Rec.709, assume one profile for all
clips, apply arbitrary LUTs, or override colour management without verification. If the profile cannot be identified
reliably, flag the footage for review.

## 5. White balance accuracy
Use neutral references, RGB analysis, skin information and scene context. Prevent green-looking, magenta-looking,
excessively warm or cool footage and unnatural skin. Do not use clipped highlights as white references; do not
assume every white-looking object is neutral; preserve deliberate warm, cool or coloured lighting; be conservative
when confidence is limited; never introduce a new cast while removing another.

## 6. Exposure accuracy
Evaluate by subject brightness and scene context. SDR Rec.709 flexible guidelines (not targets): blacks ≈ 0–10 IRE,
shadows ≈ 10–30 IRE, typical skin ≈ 45–75 IRE (complexion and lighting dependent), avoid unintended clipping near
100 IRE. Never force identical brightness across scenes; never brighten a correctly exposed shot; preserve intended
lighting and atmosphere.

## 7. Skin tone protection
With reliable skin regions: analyze skin hue and saturation; use vectorscope skin-tone references as secondary
guidance; prevent green/magenta shifts; avoid excessive orange/red saturation; preserve natural complexion; respect
environmental lighting. Never force all skin to one colour or luminance; if skin detection is unreliable, avoid
aggressive corrections.

## 8. Smart Correction Protection (mandatory)
Do not modify footage that is already correct. Before any adjustment: analyze the original, identify a genuine
issue, estimate whether correction improves the result, apply only justified adjustments, validate the output.
Never brighten correct footage, change accurate white balance, modify saturation unnecessarily, force contrast,
neutralize intentional lighting, introduce green/magenta casts, overwrite manual corrections blindly, or apply
changes when improvement is negligible or uncertain. **Zero correction is a valid success**; success is final image
quality, not the number of corrections.

## 9. Independent operation safety
Every module works independently: do not modify unrelated parameters; preserve manual adjustments and other modules'
corrections; handle shared parameters without conflicts; support individual rollback; avoid cumulative adjustments;
support different execution orders or manage dependencies explicitly. **Idempotency:** repeated runs must not
accumulate (exposure must not keep rising, tint must not drift, saturation must not keep increasing); if the current
correction is appropriate, change nothing.

## 10. Confidence-based decisions — INCOMPLETE (text cut off)
Known from the summary: High, Medium and Low confidence levels decide whether corrections are applied.
(Package `02` adds: correct only when confidence and expected improvement clear calibrated thresholds; otherwise
SKIPPED/REVIEW_NEEDED.)

## 11. Automatic validation — summary only
Analyze → Calculate → Apply → Render → Reanalyze → Accept or Revert. (Package `03` "Closed-loop QA" gives the
seven steps: save exact prior effect state and keyframes; apply warranted changes; render a representative timeline
frame with all effects and output colour management; recompute diagnostics; compare with the original timeline
rendering, not the raw source; require no regression in clipping, neutral references, subject, continuity; keep,
revert or flag, and log evidence.)

## 12. Non-destructive processing and rollback — summary only
Preserve existing adjustments; restore previous settings if corrections fail. (Package `02`: separate managed
correction instance where feasible; ownership/reset logic; automatic revert on regression or failed operation.)

## 13. Processing performance — summary only
Optimize frame analysis, caching, rendering and batch processing.

## 14. Automated testing — summary only
Regression tests for white balance, exposure, skin tones, colour casts, existing corrections and rollback
(see `05_TEST_MATRIX.csv` T01–T18).

## 15. Real visual reference training — summary only
Use professionally corrected before/after footage to evaluate and improve the algorithms (document with
`06_REFERENCE_TEMPLATE.json`; no training is claimed without such data — none has been provided yet).

## 16. Official Adobe references — summary only
Verify Lumetri, colour management, scopes and Premiere API capabilities using the attached documentation
(`07_OFFICIAL_ADOBE_REFERENCES.md`). Lumetri Scopes (RGB Parade, Waveform, Vectorscope) are referenced for analysis;
the API exposes no scope data, so scope-equivalent measurements must be computed from exported timeline frames.

## 17. Implementation workflow — summary only, cut off
Inspect the codebase, implement incrementally, validate each module, and preserve existing functionalit[…cut off].

## 18. — MISSING
Not received. Unknown.

---

## Pipeline, statuses and order (from package `02`)
Pipeline: source metadata + timeline state → representative frames → diagnostics → confidence → proposed delta →
save state → apply → render through Premiere → compare → keep/revert → structured audit log.
Statuses: `ALREADY_BALANCED`, `CORRECTED`, `REVIEW_NEEDED`, `REVERTED`, `BLOCKED`, `FAILED`.
Order: colour-management check → scene analysis → white balance → exposure + contrast (checked together) →
saturation → skin → shot match → final render QC. Independent buttons run only their module.

## Adobe compatibility (package `01`, plus what was measured on 26.0.2)
| Module | Controls | Status on 26.0.2 (2026-11-01) |
|---|---|---|
| White balance | Lumetri Temperature, Tint | params exist (130-param list read from `AE.ADBE Lumetri`); writes and units NOT yet measured (probe not run) |
| Exposure | Exposure (+ Highlights/Shadows/Whites/Blacks exist) | Exposure write attempted in 0.9.4; read-back/render NOT yet confirmed |
| Contrast | Contrast | param exists; not implemented |
| Saturation | Saturation | param exists; not implemented |
| Skin tones | HSL Secondary / masks | no local mask API known → expected PARTIAL (global) or BLOCKED |
| Shot match | per-shot corrections | not implemented |
| Colour management | — | PARTIAL: only clip input/embedded LUT IDs and linear compositing flag readable; spaces not exposed |
| Render check | `Exporter.exportSequenceFrame` | exists; adds `.png` itself; end-to-end check not yet confirmed |

## Implementation map (what exists in code at 0.9.8)
- Implemented: multi-frame analysis in linear light with rotation-aware frames (`color.read_frames`, `measure`,
  `decide`); neutral search inside the camera-cast range + grey-world agreement; skin-based exposure in 0.5 steps;
  S-Log3/S-Gamut3.Cine decode from Sony XML gamma (suggest only); confidence High/Medium/Low; preview (engine
  approximation); Lumetri apply of Exposure/Temperature/Tint skipping a Lumetri with manual values; render check +
  slider calibration (`check_render`, `Calibration`); capability probe (`panel/premiere-probe.js`, `probe_measure`).
- Partial: validation (refine once, no revert; unproven), independence (WB + exposure in one operation), rollback
  (only via Cmd+Z), colour management (Sony XML only).
- Planned: everything else in sections 2.4–2.7, 4, 9, 10–14, statuses and audit log — ordered in `TODO.md` B.
