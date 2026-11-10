# Subtitle style: Beauty Sector (measured 2026-11-10)

The fourth client measured with `scripts/measure_style.py` (the user's request 2026-11-10). The code is the `beautysector` preset
in `engine/asistent/subtitles.py` (panel: Captions > Style > Beauty Sector). The subtitles are made in Submagic with Montserrat
Heavy (the user, 2026-11-10), the same template as GStroy's, Credissimo's and ЕКОПАК's (the vault's `editing/client-styles.md`).

## Source

"Контент план 11" exports (office server, Exported Videos/Beauty Sector), only read: 7 videos, all 1080x1920 at 29.97/30 fps,
all with burned-in subtitles. 350 subtitle chunks. Aesthetic procedures (HIFU, Doublo Gold, Body Sculpt) and a salon offer
(Видео 8), with many product graphics over the picture.

## Look

| | Measured | Set in Premiere (Track Style "Beauty Sector") |
|---|---|---|
| Font | Montserrat Black = Submagic's Montserrat Heavy (width/cap-height of "НА КОНТУРА" 10.36, Black 10.32, ExtraBold 10.13) | Montserrat Black |
| Size | cap height 36 px on 1080 wide = about 52 px | 52 |
| Case | capitals; names in Latin capitals (below) | All Caps |
| Colour | white; keyword in coral red **#D45E58** (RGB 212 94 88; sampled over skin and white, so ±10) | fill white; keyword fill #D45E58 |
| Shadow | the template's even dark glow | black ~90 %, distance 0, size ~3, blur ~20 |
| Position | chunk centre 0.48 of the height (0.43-0.61 for 80 %), moved off the product graphics | vertical about 48 % |
| Motion | hard cut in and out | none |

## Text and timing (built into the `beautysector` preset)

- 1-4 words, mean 2.19 (93 / 127 / 103 / 26 with 1 / 2 / 3 / 4); 12.5 characters median, 19 at p90. No punctuation (2 of 510
  lines). Two lines in 46 %.
- Two lines cut where they come out most even: **96 %** of the two-line chunks with 3+ words, the clearest of the four clients.
  A one-letter word never stands alone on a line ("С DOUBLO GOLD" stays one line, as the editors wrote it); a short word alone
  on top is allowed ("БЕЗ / ОПЕРАЦИЯ", 9 of 160).
- Timing: appears with the first word (340 chunks matched; median 0.06 s after Whisper's start, about 0.00 s once the sampling
  is allowed for): Asistent's usual 0.03 s lead. On screen 0.75 s median.

## Names (in Latin capitals, as the subtitles write them)

| Whisper writes | Subtitles |
|---|---|
| „Бюти Сектор“ | BEAUTY SECTOR |
| „Double Gold“ | DOUBLO GOLD |
| „HiFull“, „HIFO“, „High Flow“ | HIFU; „High Flow Lifting“ → HIFU ЛИФТИНГ |
| „BodySculpt“ | BODY SCULPT |
| „Dr. Vandev“ | DOCTOR VANDEV |
| SMAS | SMAS |

"БЮТИ САЛОН" (not the brand) stays Cyrillic, as in the exports. "Aesthetic Dental Clinic" is left as Whisper writes it (the
exports also show "VANDEV CLINIC"): the editor checks it.

## Coral keyword

- On 121 of 350 chunks (35 %, about one in three). One word in 104; the chunk's last word in 101 of 104; the bottom line in 75 of
  78 two-line chunks.
- The procedure and its result: "КОЖА", "КОНТУР", "ЛИФТИНГ", "ПРОЦЕДУРА", "РЕЗУЛТАТ", "ТОНУС", "КОНСУЛТАЦИЯ".
- Rule (suggestions): the last word if it is a procedure/beauty word, or if it has 6+ letters and stands out from the chunks on
  each side; never two in a row. Picks 125 (editors 121), agrees on 53 % (chance 35 %; length alone 49 %). The word list was
  made from these videos.

## How close the preset comes (the editors' own speech, Whisper words)

| | Editors | `beautysector` |
|---|---|---|
| Mean words a chunk | 2.19 | 2.17 |
| One-word chunks | 27 % | 24 % |
| Two-line chunks | 46 % | 44 % |
| Chunks with a coral word | 35 % | 35 % |
| Editors' chunk starts that are also Asistent's (±0.2 s) | | 65 % |

## Not in the preset

The product graphics ("Targets SMAS layer at 4.5mm", the cartridge names D4, S7, M7, "NON-ABLATIVE / NO ANESTHESIA") and the
device's own labels are graphics, in English.
