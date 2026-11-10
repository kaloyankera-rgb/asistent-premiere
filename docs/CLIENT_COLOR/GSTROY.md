# Colour: where GStroy's graded videos end up (measured 2026-11-10)

The user (2026-11-10): the client's finished videos are colour corrected (exposure, white balance and more), so the Colour tab
can learn from them. Measured with Asistent's own `color.measure` / `frame_stats` (the numbers the Colour tab works with) on a
frame every 1.5 s of all 11 exports of "Контент план 10" (9 distinct videos, Видео 3 counted once: 316 frames, 246 with a
detected face). Only the finished look is known: the original clips were not compared, so this says where the editors end,
not how far they moved each clip.

| | GStroy exports (median, p10-p90) | Asistent's current target |
|---|---|---|
| Skin luma (Rec.709, detected faces) | **0.46** (0.29-0.56); frames with a big face 0.47-0.49 | **0.62** (`SKIN_TARGET`) |
| Mid-tone median | 0.54 (0.39-0.71): bright shop and home interiors | 0.42 (`MID_TARGET`) |
| White balance on neutral surfaces, temp / tint (log2) | +0.00 (-0.14 to +0.34) / +0.09 (0.00 to +0.17) | balanced = within 0.08 / 0.05 |
| Black point (1st percentile luma) | 0.044 | none |
| White point (99th percentile) | 0.98: whites reach the top | none |
| Contrast (p90-p10 luma) | 0.68 | none |
| Saturation (mean chroma) | 0.11 (0.08-0.23) | none |
| Clipped pixels | 2.5 % (0.4-10.5 %): lamps, windows, white walls burn out | new clipping ≤ 3 % |

What it means:
- **Exposure**: the editors keep faces about 0.7-0.8 stop darker than Asistent aims (0.47-0.49 against 0.62): natural skin
  in a bright room, the room carrying the brightness. Asistent today would brighten GStroy faces past the client's look (the
  same doubt as TODO B.9, "target 0.62 may be too bright"). One frame was checked by eye (a face at 0.49): properly exposed.
- **White balance**: neutrals end neutral (temp 0.00), with a slight green tint left (+0.09, just over Asistent's 0.05
  "balanced" line). The client's brand green is everywhere (shirts, signs), so the green may be from the scenes rather than a
  choice: Asistent's neutral search already leaves saturated green out.
- **Contrast / saturation**: a full range (deep blacks, whites to the top), moderate saturation. The Colour tab does not touch
  contrast or saturation (permanent rule), so these are a reference only.

Proposed, not built (needs the user's decision): a per-client colour target, GStroy's skin target 0.48 instead of 0.62 and its
mid-tone target 0.54, chosen like the subtitle Style. A better measure would pair a few graded clips with their originals (the
project folders hold the raw footage) to learn the editors' actual moves, not only where they end.
