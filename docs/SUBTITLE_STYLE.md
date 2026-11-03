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

## Measured on the client's own videos (2026-11-04)

Seven finished videos with the subtitles burned in: six from the client's TikTok (dr.denkov: 7695818175748771094,
7697316191752260886, 7698708538926943510, 7701013582724582678, 7701383592064306435, 7703622136702848278; three more need a
login) and the Instagram reel above, 625 Bulgarian lines. In `references/subtitles/tiktok/` (never committed). Read with the Mac's
own text recognition (Apple Vision, 8 frames a second), faces with Asistent's YuNet, speech with Asistent's own recognition and
alignment (its word starts sit 0.025 s after the sound onset, median of 77 words after a pause, so they can be used as truth).

**Bulgarian line**
- 1-5 words, mostly 2-3 (93 / 259 / 187 / 75 / 11 lines with 1 / 2 / 3 / 4 / 5 words, mean 2.4); 13 characters median, 20 at p90,
  25 at most; always one line, never wrapped. Asistent's 9:16 preset now: mean 2.6 words, 15 characters median; 69 % of the
  client's line breaks are also Asistent's.
- On screen 0.88 s median (0.50 at p10, 1.38 at p90); 92 % follow the previous line with no gap.
- Capital letter only where a sentence starts (130 of 625), no punctuation at all (3 of 625 end with a mark; Asistent: 223 of
  585), numbers as digits ("10 години", "360-градусово").
- 7.5 % end on a little word ("с поставяне на", "можем да"): the editor cut by the speech rhythm. Asistent never does (its grammar
  rule), and "ли" / "ви" stay with the word before ("и прави ли", "бюста ви"); Asistent put "ли" and "ви" on the next line twice.
- Timing: the line starts 0.185 s before its first word (median; 0.10-0.26 s for 80 %, 516 of 563 earlier than 0.1 s) and fades in
  over about 4 frames, so it is fully there just before the word; it ends 0.08 s before its last word ends, where the next line
  starts. No fade out. Asistent now: 0.03 s early, no fade.

**Position**
- Centred; the height is kept for the whole shot and changes at a cut (79 of 90 changes are at a cut).
- The top of the Bulgarian line sits under the speaker's chin: 0.11 of the frame height below it (median; 0.06-0.19 for 80 %).
  "chin + 0.11" predicts the height within 0.028 (median), a fixed height only within 0.042. Range seen 0.16-0.72 of the height.
- It covers a face in 7 of 486 lines with a face; when the face is low in the frame the line goes above it.
- With no face (B-roll, drawings) it stays around the middle (0.50-0.53).

**English line**
- Centre 0.035 of the frame height under the Bulgarian line's centre, letters 0.81 of the Bulgarian size, maroon box.
- 1-4 words (mean 2.6), 14 characters median; a capital where a sentence starts, a "?" kept on questions, no other marks.
- Same times as its Bulgarian line in 59 % of the lines; elsewhere one English piece spans two Bulgarian lines or switches a few
  frames later. The user's rule (2026-11-04) is the same times for every line, which Asistent keeps. 5 of 625 lines had no English.
- Appears without a fade.
