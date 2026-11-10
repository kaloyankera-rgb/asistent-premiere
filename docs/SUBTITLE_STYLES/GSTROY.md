# Subtitle style: GStroy (measured 2026-11-10)

The user's request (2026-11-10): analyse the client's finished videos so the subtitles can be recreated, make a GStroy
profile to test, and do the same for every client afterwards. This file is the profile; the code is the `gstroy` preset in
`engine/asistent/subtitles.py` (panel: Captions > Style > GStroy). ReShape's own style is in `docs/SUBTITLE_STYLE.md`.

## Source

The client's "Контент план 10" exports (office server, Exported Videos/GStroy), only read: 11 files, 9 distinct videos (Видео 3
in 1080x1920, 1080x1080 and 1920x1080). 9 files have burned-in subtitles; Видео 8 and Видео 10 (v2) have none. Measured like
ReShape's: the Mac's text recognition (Apple Vision) on 8 frames a second, 395 subtitle chunks (331 in the 9:16 videos); letter
shapes, colour and shadow on full-resolution frames; speech times from Asistent's own Whisper (287 chunks matched to words);
faces with Asistent's YuNet. Numbers below are for the 9:16 videos unless said otherwise.

## Look (for the editor's Track Style in Premiere: no script can set a caption's font, see DECISIONS.md)

| | Measured | Set in Premiere (Properties > Track Style "GStroy") |
|---|---|---|
| Font | Montserrat **Black** = Submagic's Montserrat Heavy, the tool the subtitles are made with (the user, 2026-11-10) (width/cap-height 14.76 vs 14.83 measured, stem 12.4 vs 11.9 px; ExtraBold 10.2, Bold 8.9; the client's own LT Superior and Cygre are too narrow and thin) | Montserrat Black (OFL; install it: Asistent ships only Montserrat Bold) |
| Size | cap height 36 px on a 1080 px wide frame = font size about 51-52 px; 16:9 (1920x1080) about 64 px | 52 (9:16 and 1:1), 64 (16:9) |
| Case | CAPITALS everywhere (no lowercase in 463 lines) | All Caps on, or Asistent's capitals |
| Colour | white #FFFFFF; keyword in green **#94D000** (RGB 148 208 0, the same in three videos) | fill white; the keyword's fill #94D000 |
| Shadow | no offset: an even dark glow around the letters, about 90 % dark at 2 px, half at 8 px, gone by about 20 px | Shadow: black, opacity about 90 %, distance 0, size about 3, blur about 20 (start values, compare with a frame) |
| Outline / box | none | none |
| Lines | centred; two-line chunks with a line pitch of 63 px (about 1.2 x the size: the font's normal leading) | centre aligned, normal leading |
| Position | chunk centre at 0.50 of the height (median; 0.47-0.57 for 80 %), the same with or without a face; covers a face in 4 of 277 chunks. The distance from the chin does not predict it better than a fixed height (error 0.031 vs 0.030), unlike ReShape | vertical about 50 %; move a line by hand where it covers the product or a face |
| Motion | hard cut in and out: no fade, no pop, no word-by-word build (checked frame by frame) | none |

## Text and timing (built into the `gstroy` preset)

- 1-3 words a chunk, mostly 2 (79 / 135 / 89 / 23 / 5 with 1 / 2 / 3 / 4 / 5 words, mean 2.2); 11 characters median per chunk,
  19 at p90, 25 at most. No punctuation at all (0 of 463 lines); numbers as digits ("220 ВОЛТА", "ИЛИ 48 ВОЛТА").
- Up to two lines. A chunk of up to about 12 characters is one line (one-line chunks: 9 median, 12 at p90); a longer one is
  stacked, and the **last word stands alone underneath** (112 of 132 two-line chunks): "ПРИ / ТРАДИЦИОННАТА", "ОЩЕ В /
  ПРОФИЛИТЕ", "РЕЛСОВА / СИСТЕМА". Asistent never leaves a little word alone below ("ОСВЕТИТЕЛЯТ СЕ" stays one line) and keeps
  a number with its unit.
- Timing: the chunk appears with its first word, not ahead of it (median 0.05 s after Whisper's word start, about 0.01 s early
  once the 8 frames-a-second sampling is allowed for; only 8 % more than 0.1 s early), and stays until the next chunk (252 of
  386 follow with no gap). That is Asistent's usual 0.03 s lead; ReShape's is 0.18 s.
- On screen 0.75 s median (0.38 at p10, 1.13 at p90).
- 7 % of the editors' chunks end on a little word ("ДА", "ЛИ", "ГО"); Asistent keeps its grammar rule (never ends on a
  preposition or particle), as for ReShape.

## Green keyword

- About one chunk in three (110 of 395) has a green word; nearly always one word (88 of 102 green lines), in a two-line chunk
  the bottom one (64 of 73), and it is the chunk's **last word** (80 of 86) and its longest (74 of 86).
- The editors choose it by meaning (the product or the point: "МАГНИТНА", "ПРОФИЛИТЕ", "СЪВМЕСТИМ", "НАПРЕЖЕНИЕ"). No rule
  from lengths reproduces it well: the best (last word of 6+ letters, at least as long as the previous chunk's last word and
  longer than the next one's, never two chunks in a row) picks as often as the editors (31 % of chunks against 30 %) and
  agrees on 43 % of its picks (a random third would agree on about 30 %). So Asistent **suggests** them: the result box lists
  them with their times and the JSON carries `accent` per line; the editor colours them in Premiere and changes any.
- Open: whether Premiere can colour one word of a caption from the file (an SRT `<font color>` tag, untested) or only by hand
  (select the word in the Program Monitor, change its fill). To probe in NEW TEST before anything is automated.

## How close the preset comes (run on the editors' own speech, Whisper words, not the full pipeline)

| | Editors | `gstroy` | `short` (Auto 9:16) |
|---|---|---|---|
| Mean words a chunk | 2.21 | 2.22 | 2.52 |
| Two-line chunks | 40 % | 43 % | 0 % |
| Editors' chunk starts that are also Asistent's (±0.2 s) | | 57 % | 51 % |
| Chunks with a green word | 30 % | 31 % | 0 |

The rest of the break differences are mostly where the editor cut by the speech rhythm (one-word chunks: theirs 24 %,
Asistent 16 %). The real job also applies the writing rules (по-/най-, numbers), which this comparison skipped.

## The brand

**GStroy**, written exactly so even among the capitals (the user, 2026-11-10). Whisper hears „G -Stroy“ (two words); the preset
joins them and writes GStroy (`names` with a split form, 0.10.21). A lone „–“ Whisper writes is not shown (`drop_dashes`).

## Not in the preset

- Видео 3 (the brand skit, three sizes) moves lines around the frame (0.11-0.87 of the height) and uses up to 4 words on one line
  in 16:9: a one-off layout by hand.
- Titles at the top ("РАЗЛИЧНИТЕ ВИДОВЕ / КЛИЕНТИ В GSTROY") and the end card ("Майсторът си ти.") are graphics, not subtitles.
