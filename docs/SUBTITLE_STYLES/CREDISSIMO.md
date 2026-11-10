# Subtitle style: Credissimo (measured 2026-11-10)

The user's request (2026-11-10): the same analysis as GStroy's for Credissimo, as much information as possible, and a profile
to test. The code is the `credissimo` preset in `engine/asistent/subtitles.py` (panel: Captions > Style > Credissimo). The
measurement can be repeated with `scripts/measure_style.py`.

## Source

"Контент план 13" exports (office server, Exported Videos/Credissimo), only read: 10 videos, all 9:16 (Видео 7, 9, 10 in
2160x3840, the rest 1080x1920). 9 have burned-in subtitles; Видео 6 (v2, 9 s) has none. Text recognition at 8 frames a second:
674 subtitle chunks. Five are street interviews (Видео 1, 3, 5, 7, 9), four studio games (Видео 2, 4, 8, 10). Both the
interviewer and the people answering are subtitled.

## Look: the same template as GStroy's, with a red accent

| | Measured | Set in Premiere (Track Style "Credissimo") |
|---|---|---|
| Font | Montserrat **Black** (width/cap-height 10.67 vs 10.63 for "КАКВА СУМА"; stem 12.0 px vs 12.3, ExtraBold 10.7) | Montserrat Black |
| Size | cap height 36 px on a 1080 px wide frame = about 52 px (the same in the 4K exports, scaled) | 52 (1080x1920); 104 in a 2160x3840 sequence |
| Case | capitals | All Caps |
| Colour | white; keyword in red **#F84430** (RGB 248 68 48, the same in three videos) | fill white; keyword fill #F84430 |
| Shadow | the same even dark glow as GStroy: about 90 % dark at 2 px, half at 8-10 px, no offset | as GStroy's (black, ~90 %, distance 0, size ~3, blur ~20) |
| Outline / box | none | none |
| Lines | up to two, centred, line pitch 64 px | centre, normal leading |
| Position | chunk centre 0.50 of the height (0.44-0.58 for 80 %); covers a face in 3 of 671 chunks; the chin does not predict it better than a fixed height (error 0.033 both) | vertical about 50 % |
| Motion | hard cut in and out | none |

## Text and timing (built into the `credissimo` preset)

- Longer chunks than GStroy's: 1-4 words, mean 2.5 (146 / 183 / 237 / 73 / 29 with 1 / 2 / 3 / 4 / 5 words); 12 characters
  median, 19 at p90, 25 at most. No punctuation (2 of 1000 lines, both misreads). Numbers as digits ("50 ЦЕНТА", "1500 ЕВРО",
  "100%").
- Two lines in 48 % of the chunks. One line up to about 12-13 characters (one-line chunks: 8 median, 13 at p90).
- The two lines are cut where they come out **most even** (90 % of the two-line chunks with 3+ words; ties give the longer top
  line): "КАКВА СУМА / БИХТЕ МУ ДАЛИ", "В СЛУЧАЯ / МНОГО ХОРА", "ДА МОГА / ДА СПЯ". Only 66 % have one word alone below (GStroy
  85 %), and 31 % of the top lines end on a little word ("ДА", "СЕ", "ТИ"): the editors cut by length, not grammar.
- Timing: the chunk appears with its first word (547 chunks matched to Whisper's words: median 0.035 s after the word start,
  about 0.025 s early once the 8 frames-a-second sampling is allowed for), as GStroy's: Asistent's usual 0.03 s lead. It
  stays 0.045 s past its last word (median), then the next one comes.
- On screen 0.75 s median (0.38 at p10, 1.13 at p90); 459 of 665 chunks follow the previous one with no gap.

## Red keyword

- On 109 of 674 chunks (16 %, about one in six; GStroy one in three). One word in 91 of 109; the chunk's last word in 84 of 91
  and its longest in 76; in a two-line chunk the bottom line (69 of 76).
- Many are money words: "ПАРИ" (7 times), "НАЗАЕМ", "БЮДЖЕТ", "РАЗХОДИ", "ДОХОДИ", "ВНОСКА", "ФИНАНСОВО", "КРЕДИСИМО"; the
  rest are the point of the answer ("СЛОЖНО", "РЕВНОСТ", "МАХМУРЛУК").
- Rule (suggestions, the editor changes them): the last word if it is a money word, or if it has 9+ letters and is the
  longest last word within two chunks on each side; never two chunks in a row. It picks as many as the editors (109) and
  agrees on 28 % (a random sixth would agree on about 16 %). Money words alone: 22 of the 72 chunks ending on one were red.

## The brand name

Written both ways in the exports: "ТО CREDISSIMO / НЯМА" (Latin, Видео 1) and "НИЕ ОТ / КРЕДИСИМО" (Cyrillic, Видео 9 and 10).
**The user's decision (2026-11-10): CREDISSIMO.** Whisper writes „Кредисимо“ or „Credissimo“; the preset's `names` shows
CREDISSIMO either way (0.10.20), only in this style.

## How close the preset comes (the editors' own speech, Whisper words, not the full pipeline)

| | Editors | `credissimo` | `gstroy` | `short` (Auto 9:16) |
|---|---|---|---|---|
| Chunks | 674 | 765 | 829 | 749 |
| Mean words a chunk | 2.52 | 2.50 | 2.30 | 2.55 |
| Two-line chunks | 48 % | 49 % | 38 % | 0 % |
| Chunks with a red word | 16 % | 16 % | 26 % | 0 |
| Editors' chunk starts that are also Asistent's (±0.2 s) | | 61 % | 63 % | 60 % |

Where the chunks break agrees about as well whatever the settings (61-63 %, F1 57 for every value tried: the editors cut by
the rhythm of the answer, Asistent by grammar and pauses); the settings were chosen so the chunks have the editors' size and
shape. One-word chunks stay rarer than theirs (15 % against 22 %).

## Not in the preset

- The score counters ("1-0", "2-1" in Видео 2 and 4) and the euro amounts at the top of Видео 8 ("1500 €") are graphics.
- English words said in Bulgarian speech ("НА SEEN") are written in English by Asistent's rule (`english.py`), as the editors did.
