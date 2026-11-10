# Subtitle style: ЕКОПАК (measured 2026-11-10)

The user's request (2026-11-10): the same analysis for the third client, ЕКОПАК, and, across all clients, enough knowledge for all
the tools (`editing/client-styles.md` in the Content Studio vault). The code is the `ekopak` preset in
`engine/asistent/subtitles.py` (panel: Captions > Style > ЕКОПАК). Measured end to end with `scripts/measure_style.py`.

## Source

"Контент план 7" exports (office server, Exported Videos/Екопак), only read: 9 videos, 9:16 (Видео 9 in 2160x3840 at 59.94 fps,
the rest 1080x1920 at 29.97/30 fps). 7 have burned-in subtitles; Видео 5 and Видео 9 (no "субтитри" in the name) have none
(Видео 9 shows only a counter's digits). 400 subtitle chunks. The client's "Бранд материали" folder on the server is empty.

## Look: the shared template with a green accent

| | Measured | Set in Premiere (Track Style "ЕКОПАК") |
|---|---|---|
| Font | Montserrat **Black** (width/cap-height of "НЕ СЕ" 4.44, Black 4.44, ExtraBold 4.39; stem 12.2 px) | Montserrat Black |
| Size | cap height 36 px on a 1080 px wide frame = about 52 px | 52 (1080x1920); 104 in 2160x3840 |
| Case | capitals | All Caps |
| Colour | white; keyword in green **#18CC6E** (RGB 24 204 110, the same in three frames; not GStroy's #94D000) | fill white; keyword fill #18CC6E |
| Shadow | the template's even dark glow (visible in every frame checked) | black ~90 %, distance 0, size ~3, blur ~20 |
| Lines | up to two, centred, line pitch 63 px | centre, normal leading |
| Position | chunk centre 0.47 of the height (0.38-0.57 for 80 %): a little higher and moved more than the other clients | vertical about 47 % |
| Motion | hard cut in and out | none |

## Text and timing (built into the `ekopak` preset)

- 1-4 words, mean 2.35 (80 / 161 / 117 / 35 with 1 / 2 / 3 / 4 words); 11 characters median per chunk, 18 at p90. No
  punctuation (6 of 575 lines, misreads). Two lines in 43 %.
- The two lines are cut where they come out most even (87 % of the two-line chunks with 3+ words; one word alone below 69 %),
  as Credissimo's. On the editors' own text, a chunk over 11-12 characters is two lines in 82-84 % of the cases.
- Timing: the chunk appears with its first word (345 chunks matched: median 0.025 s after Whisper's word start, about 0.035 s
  early once the sampling is allowed for): Asistent's usual 0.03 s lead. On screen 0.75 s median.
- The name: Whisper writes „Екопак“; the subtitles show ЕКОПАК (capitals). „Ecopack“ is written „Екопак“ too.

## Green keyword

- On 90 of 400 chunks (23 %, about one in four). One word in 73; the chunk's last word in 67 of 73.
- Mostly recycling words and the point of the line: "БОКЛУК", "КОНТЕЙНЕР", "ОПАКОВКА", "РЕЦИКЛИРА", "РАЗДЕЛНО", "ПЛАТФОРМА",
  "КАРТАТА", "ЕКОПАК".
- Rule (suggestions): the last word if it is a recycling word, or if it has 7+ letters and is the longest last word within
  two chunks on each side; never two chunks in a row. It picks as many as the editors (90) and agrees on 43 % (chance about
  23 %). The word list was made from these same videos, so the 43 % is optimistic until checked on new ones.

## How close the preset comes (the editors' own speech, Whisper words)

| | Editors | `ekopak` | `gstroy` | `credissimo` |
|---|---|---|---|---|
| Chunks | 400 | 432 | 409 | 381 |
| Mean words a chunk | 2.35 | 2.25 | 2.38 | 2.55 |
| One-word chunks | 20 % | 18 % | 14 % | 12 % |
| Two-line chunks | 42 % | 41 % | 49 % | 57 % |
| Chunks with a green word | 23 % | 21 % | 30 % | 11 % |
| Editors' chunk starts that are also Asistent's (±0.2 s) | | 65 % | 62 % | 60 % |

## Not in the preset

The map screen of map.ecopak.bg (Видео 4), the counter in the drawing game (Видео 9) and the sign "Събирай разделно с ЕКОПАК"
(Видео 1) are graphics.
