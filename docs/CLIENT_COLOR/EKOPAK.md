# Colour: where ЕКОПАК's graded videos end up (measured 2026-11-10)

Same method as `GSTROY.md` (`scripts/measure_style.py colour`): a frame every 1.5 s of the 9 exports of "Контент план 7"
(380 frames, 295 with a detected face). Only the finished look is known. Mostly outdoor street scenes and containers in daylight.

| | ЕКОПАК (median, p10-p90) | GStroy | Credissimo | Asistent's target |
|---|---|---|---|---|
| Skin luma (detected faces) | **0.53** (0.39-0.58) | 0.46 | 0.53 | 0.62 |
| Mid-tone median | 0.50 (0.34-0.62) | 0.54 | 0.38 | 0.42 |
| White balance on neutral surfaces, temp / tint (log2) | **+0.13** (-0.34 to +0.40) / +0.01 | +0.00 / +0.09 | -0.24 / -0.05 | balanced within 0.08 / 0.05 |
| Black point / white point (1st / 99th percentile) | 0.033 / 0.955 | 0.044 / 0.98 | 0.014 / 0.87 | |
| Contrast (p90-p10) | **0.76** | 0.68 | 0.65 | |
| Saturation (mean chroma) | **0.078** (0.07-0.19) | 0.11 | 0.14 | |
| Clipped pixels | 2.2 % | 2.5 % | 1.6 % | new clipping ≤ 3 % |

What it means:
- **Exposure**: faces at 0.53 like Credissimo's, below Asistent's 0.62.
- **White balance**: neutral to slightly cool (+0.13, positive = blue in Asistent's units), no green: the opposite of
  Credissimo's warm grade. Daylight outdoors left clean.
- **Contrast / saturation**: the most contrast and the least colour of the three clients: a muted, punchy, documentary grade
  (grey streets, the coloured containers and the green accent carry the colour). Reference only: the Colour tab does not touch
  contrast or saturation.

The three clients end in three different places (GStroy bright and neutral with darker faces, Credissimo warm and saturated,
ЕКОПАК cool, contrasty and muted), so one exposure and white-balance target for everyone fits none of them well: the case for
per-client colour targets (proposal, needs the user's decision).
