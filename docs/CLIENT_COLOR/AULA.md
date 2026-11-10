# Colour: where AULA's graded videos end up (measured 2026-11-10)

`scripts/measure_style.py colour` on the 10 exports of "Контент план 27" (449 frames, 242 with a detected face). Only the
finished look is known. Most frames of the tutorials are screen recordings (Word and Excel pages, Mac and Windows desktops,
phone screens), which carry no grade, so the numbers that say something about the grade are the filmed parts, mostly the street
interviews (V3, V6, V10: 195 frames, 166 with a face).

| | AULA, filmed (V3, V6, V10) | AULA, all frames | GStroy | Credissimo | ЕКОПАК | Beauty Sector | Asistent's target |
|---|---|---|---|---|---|---|---|
| Skin luma (detected faces) | **0.40** (0.32-0.59) | 0.40 | 0.46 | 0.53 | 0.53 | 0.57 | 0.62 |
| Mid-tone median | 0.39 | 0.46 | 0.54 | 0.38 | 0.50 | 0.48 | 0.42 |
| White balance on neutrals, temp (log2) | +0.24 (-0.51 to +0.85) | +0.08 | 0.00 | -0.24 | +0.13 | 0.00 | within 0.08 |
| Black / white point (1st / 99th percentile) | 0.060 / 0.96 | 0.055 / 0.96 | 0.044 / 0.98 | 0.014 / 0.87 | 0.033 / 0.96 | 0.030 / 0.94 | |
| Contrast (p90-p10) | 0.63 | 0.62 | 0.68 | 0.65 | 0.76 | 0.67 | |
| Saturation (mean chroma) | 0.15 | 0.14 | 0.11 | 0.14 | 0.078 | 0.081 | |

Per video the faces go from 0.36 (V6, outdoors, against the light) to 0.53 (V10) and 0.51 (V3), and the "neutral" areas from
neutral to cool (V6 +0.69, V10 +0.49: sky, shade and pavement more than a grade).

What it means: no one look. The faces are the darkest of the five clients and vary with the light of each shoot; the colour is
fairly saturated and natural. A per-client target would not fit AULA; Asistent's current face-led exposure (toward 0.6) would
lift the interviews, which suits them, and the screen recordings need nothing.
