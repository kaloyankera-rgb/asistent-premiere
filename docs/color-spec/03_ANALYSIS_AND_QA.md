# Analysis, reference evaluation and post-render QA

## Sampling
- Analyze multiple frames per clip (beginning, middle, end, and transitions where appropriate).
- Sample more frames when lighting/subjects change; don't extrapolate from a single still.
- Analyze on full-frame and region-of-interest levels (face, reliably neutral patch, highlights).
- Compare consistent pixel coordinates/color transforms; frame buffers may be gamma-encoded or scene-linear and must not be mixed without transforms.

## Measurements (examples, not final thresholds)
- Luma histogram/percentiles, clipping percentages, distribution by region.
- RGB / chroma of verified neutral patches, not all-image RGB mean.
- Pixel saturation distribution; separately assess skin masks when reliably detected.
- Source-output consistency (same frame/timecode, effect pipeline, output Rec.709/HDR classification).
- Scene cuts and shot match: compare similar illuminated reference subjects, not unrelated backgrounds.

## White balance guardrails
- Neutral patches are low-chroma candidates but not automatically valid: mask skin, colored lights and clipped pixels; inspect spatial consistency.
- A neutral patch under one light may not represent a person under a different light.
- Green/magenta tint estimation from raw channel means is unreliable. Require validated reference patches and scene confidence.
- No credible neutral reference => conservative/no-op/review; do NOT guess temperature or tint from a single screenshot.

## Exposure guardrails
- Detect source clipping vs recovered details; never claim clipped highlights can be restored when source contains no detail.
- Evaluate subject vs background; globally dark footage may be artistically correct.
- Do not overcorrect faces. Use appropriate luminance/color space and tone mapping.
- Validate before/after highlight clipping and shadow information; smooth temporal behavior.

## Closed-loop QA
1. Save exact prior effect state and keyframe structure.
2. Apply only tested, warranted changes.
3. Render a representative frame from the actual Premiere timeline including all current effects and output color management.
4. Recompute diagnostics on rendered output.
5. Compare with original timeline rendering, not raw camera source alone.
6. Require no regression in clipping, neutral references, subject appearance and cross-shot continuity.
7. Keep, revert, or flag review. Log evidence and reason.

## Example quality record
```json
{
  "clip_id": "scene_01_take_02",
  "operation": "white_balance",
  "status": "REVIEW_NEEDED",
  "confidence": 0.34,
  "reason": "mixed lighting, no reliable neutral reference",
  "modified_parameters": [],
  "before_render": "reference-before.png",
  "after_render": null,
  "premiere_version": "detect-at-runtime"
}
```

## Regression criteria
- No changes on ALREADY_BALANCED examples; identical settings and output after no-op.
- Detect obvious simulated casts on representative controlled test patches; validate against expert-labelled references.
- Do not claim a numerical metric equals expert visual quality. Keep review sets and human review.
- Re-run same module and compare; no cumulative corrections.
- Use correct cross-platform rendering and compare output with tolerance for codec/render differences.
