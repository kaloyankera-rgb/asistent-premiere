# Subtitle style: the reference to replicate (2026-11-04)

The user's reference for how subtitles must look ("one of our clients that we struggle with his subtitles the most"):
`references/subtitles/reshape/ReShape КП-5 - Видео 9 - Реклама body contouring - със субтитри + англ.mp4` (1080x1920, 68 s)
and `references/subtitles/instagram/DfIEy5PjdhL.mp4` (720x1280, 125 s, the same style on another clinic's reel).
Both have the subtitles burned in. Measured from the frames (the references are finished videos the user asked to analyse).

## Two layers, two timings

| | Bulgarian line | English line |
|---|---|---|
| What | the spoken words, 1-3 per chunk, lowercase as spoken; a long chunk wraps to 2 lines | a translation of the phrase, spanning several Bulgarian chunks ("for most surgeons" stays while "от повечето" -> "хирурзи") |
| When | word by word with the speech (our 9:16 preset: up to 3 words) | its own phrase timing; not every chunk has one |
| Font | Montserrat Bold (wide geometric, Cyrillic), white | a plain bold grotesque (looks like Arial Bold), white |
| Size on 1080 px wide | about 72 px | about 44 px |
| Look | soft dark shadow, no outline | maroon box behind it, about 60 % opaque (over black it reads rgb 62, 28, 28), small rounded corners, tight padding |
| Place | horizontally centred, about 48 % of the height (chest level) | just under it, about 54 % |
| Motion | fades in over 1-2 frames, no movement | changes with its phrase |

The middle-of-frame position is why lines can cover a face in wide shots and B-roll: each line has to move off faces on its own.

## The English line's exact settings (from the user, 2026-11-04, the caption tool they were made with)

Font Arial Pro, weight Heavy, size 21 px in that tool's canvas (about 44 px on a 1080 px wide frame, measured), case "Aa"
(sentence case); position vertical 56 %, horizontal 50 %; font colour #FFFFFF; box ("keyword highlights", main and third colour)
#551D1D with alpha A0 = 63 % opacity (measured over black: rgb 62, 28, 28, which fits); second colour #E7E5E7; emphasized font
#FFFFFF on a transparent background. The English line has the same number of lines and the same times as the Bulgarian
(the user, 2026-11-04): one English piece per Bulgarian line.

## The user's requirements (2026-11-04)

- Exact words and precise timing (the existing recognition pipeline, corrections, Captions tab).
- Every line its own layer, editable alone, and all of them restyled at once in Premiere's Properties panel.
- Each line moved when it covers a face.
- The English must match the Bulgarian words of its chunk while still making sense.

## How it is built in Premiere 26 (see DECISIONS.md)

Premiere's own text graphics are the only clips that can be both restyled together in Properties and moved one by one, and no
script can create them with words in them. So: Asistent puts the exact lines on caption tracks, the editor selects them and runs
right-click > Upgrade Caption to Graphic (Premiere's own, one step), and Asistent's "Move off faces" then moves each line (Motion >
Position, one Undo step for all; verified through UXP with a PointF value).
