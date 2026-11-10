# Colour: where Beauty Sector's graded videos end up (measured 2026-11-10)

`scripts/measure_style.py colour` on the 7 exports of "Контент план 11" (239 frames, 163 with a detected face). Only the finished
look is known. Treatment rooms, close-ups of skin and devices, product graphics.

| | Beauty Sector (median, p10-p90) | GStroy | Credissimo | ЕКОПАК | Asistent's target |
|---|---|---|---|---|---|
| Skin luma (detected faces) | **0.57** (0.36-0.63) | 0.46 | 0.53 | 0.53 | 0.62 |
| Mid-tone median | 0.48 | 0.54 | 0.38 | 0.50 | 0.42 |
| White balance on neutrals, temp / tint (log2) | **0.00** / +0.03 | 0.00 / +0.09 | -0.24 / -0.05 | +0.13 / +0.01 | within 0.08 / 0.05 |
| Black / white point (1st / 99th percentile) | 0.030 / 0.94 | 0.044 / 0.98 | 0.014 / 0.87 | 0.033 / 0.96 | |
| Contrast (p90-p10) | 0.67 | 0.68 | 0.65 | 0.76 | |
| Saturation (mean chroma) | **0.081**: low | 0.11 | 0.14 | 0.078 | |
| Clipped pixels | 1.5 % | 2.5 % | 1.6 % | 2.2 % | ≤ 3 % new |

What it means: the closest of the four to Asistent's own targets. Faces bright (0.57, the brightest of the clients), white
balance exactly neutral, soft colour (skin and white rooms without a cast: a clean clinic look). A face-led exposure toward 0.6
and neutral white balance fit this client as Asistent works today.
