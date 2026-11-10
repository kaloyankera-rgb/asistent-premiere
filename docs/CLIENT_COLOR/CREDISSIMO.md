# Colour: where Credissimo's graded videos end up (measured 2026-11-10)

Same method as `GSTROY.md`: Asistent's own `color.measure` / `frame_stats` on a frame every 1.5 s of the 10 exports of
"Контент план 13" (503 frames, 496 with a detected face). Only the finished look is known (the originals were not compared).
The videos are of two kinds: street interviews in daylight (Видео 1, 3, 5, 7, 9) and studio games in a room with a warm
pink-orange wall (Видео 2, 4, 8, 10), so the per-video numbers spread more than GStroy's.

| | Credissimo (median, p10-p90) | GStroy | Asistent's current target |
|---|---|---|---|
| Skin luma (detected faces) | **0.53** (0.42-0.66); Видео 1, 2, 5: 0.62-0.66 | 0.46 | 0.62 |
| Mid-tone median | 0.38 (0.26-0.53) | 0.54 | 0.42 |
| White balance on neutral surfaces, temp / tint (log2) | **-0.24** (-0.78 to +0.35) / -0.05 | +0.00 / +0.09 | balanced = within 0.08 / 0.05 |
| Whole picture (grey world) temp | -0.57: warm | -0.14 | |
| Black point (1st percentile) | 0.014: blacks crushed to black | 0.044 | |
| White point (99th percentile) | 0.87: highlights kept below white | 0.98 | |
| Contrast (p90-p10) | 0.65 | 0.68 | |
| Saturation (mean chroma) | 0.14 (0.12-0.23) | 0.11 | |
| Clipped pixels | 1.6 % | 2.5 % | new clipping ≤ 3 % |

What it means:
- **Exposure**: faces brighter than GStroy's and in three videos exactly at Asistent's 0.62; the backgrounds darker (mid 0.38).
  A face-led exposure at 0.55-0.62 fits Credissimo; a per-client target is less needed here than for GStroy.
- **White balance**: the grade is warm (neutrals -0.24, the whole picture -0.57; negative = warm in Asistent's units). Part
  is the light (autumn sun outdoors, the warm studio wall that the neutral search may take for grey), but every studio video
  and most street ones lean warm, so a "make it neutral" correction would cool the client's look. If per-client targets come,
  Credissimo's white-balance target should be warm (about -0.2), not 0.
- **Contrast / saturation**: deep blacks, highlights rolled off under white, more saturated than GStroy: a "film" grade, made
  with contrast and curves the Colour tab does not touch (permanent rule). Reference only.

Same proposal as GStroy (not built, needs the user's decision): per-client targets (Credissimo skin about 0.57, warm white
balance about -0.2), and better, pairs of graded clips and their originals to learn the editors' actual moves.
