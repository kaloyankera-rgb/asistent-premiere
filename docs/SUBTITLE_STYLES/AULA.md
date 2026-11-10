# Subtitle style: AULA (measured 2026-11-10)

The fifth client measured with `scripts/measure_style.py` (the user's request 2026-11-10). The code is the `aula` preset in
`engine/asistent/subtitles.py` (panel: Captions > Style > AULA). Made in Submagic with Montserrat Heavy, the same template as
the other four clients (the vault's `editing/client-styles.md`).

## Source

"Контент план 27" exports (office server, Exported Videos/AULA), only read: 10 videos, all 1080x1920 at 29.97/30 fps, all with
burned-in subtitles. Two formats: street interviews (V6 "Последният ти ChatGPT въпрос", V10 "Гадже AI"), V3 "Claude AI Watermark" (filmed, a face in most frames), and
screen tutorials for Mac, iPhone, Windows, Word and Excel (V1, V2, V4, V5, V7, V8, V9). 738 subtitle chunks with
`chunks --latin` (new for this client: AULA's subtitles carry English names in Latin capitals; without it 646).

## Look

| | Measured | Set in Premiere (Track Style "AULA") |
|---|---|---|
| Font | Montserrat Black = Submagic's Montserrat Heavy (width/cap-height of „ИНТЕЛЕКТ“ 8.4; Black 8.29, ExtraBold 8.18) | Montserrat Black |
| Size | cap height 37-39 px on 1080 wide (OCR line height 52 px, as the other clients) = about 52-54 px | 52 |
| Case | capitals; English names in Latin capitals (below) | All Caps |
| Colour | white; keyword in green **#37D977** (RGB 55 217 119, very stable: ±2 over 221 chunks) | fill white; keyword fill #37D977 |
| Shadow | the template's even dark glow | black ~90 %, distance 0, size ~3, blur ~20 |
| Position | **by format**: filmed videos at 0.42-0.47 of the height (V3, V6, V10); screen tutorials lower, 0.57-0.72 (V1 0.72, V5 0.68, V2 and V8 0.64), under the menus and over the dock | vertical about 45 % for interviews, about 65 % for screen recordings |
| Motion | hard cut in and out | none |

## Text and timing (built into the `aula` preset)

- 1-4 words, mean 2.36 (153 / 290 / 207 / 67 with 1 / 2 / 3 / 4; 21 longer ones are mostly capitalised screen text read as
  subtitles); 12 characters median, 20 at p90. No punctuation (26 of 1109 lines, mostly code and screen text). Two lines in 46 %.
- Two lines cut where they come out most even: 91 % of the two-line chunks with 3+ words (last word alone 68 %).
- Timing: appears with the first word (599 chunks matched; median 0.04 s after Whisper's start, about 0.02 s before it once
  the sampling is allowed for): Asistent's usual 0.03 s lead. On screen 0.75 s median.

## Names: English in Latin capitals, the Bulgarian article joined

The exports write English product and interface names in Latin capitals: MACBOOK, SYSTEM SETTINGS, HOT CORNERS, IPHONE,
ANDROID, CLAUDE, CHATGPT, WORD, EXCEL, WINDOWS, WORDPRESS, CLOUDFLARE, SCREEN TIME, TURN WINDOWS FEATURES, BOT FIGHT MODE, GTA VI.
Whisper already writes them in Latin, so the capitals rule shows them right. A Bulgarian article goes on with a hyphen:
IPHONE-А, ANDROID-А, SANDBOX-А. Whisper hears it as a separate word („iPhone -а“), which could even land in the next chunk
(„IPHONE / -А И“); `join_articles` (AULA only) joins it to the English word before it.

| Whisper writes | Subtitles |
|---|---|
| „aula .bg“, „AOL .bg“, „AulaBG“, „aula .bgm“, „Яло АБГ“ | AULA.BG |
| „Aula“, „аула“ | AULA |
| „Sunbox“, „Sunbox -а“ | SANDBOX, SANDBOX-А |
| „GTA 6“ | GTA VI |
| „iPhone -а“ | IPHONE-А |
| „Айфонът“ | IPHONE-ЪТ |

Other mishearings ("Bot Fight Mall" for Mode, „гаджет“ for „гадже“) are left to the editor's correction lines.

## Green keyword

- On 221 of 738 chunks (30 %). One word in 170; the chunk's last word in 163 of 170; in two-line chunks the bottom line in 131
  of 138.
- **Unlike the other clients, about one green chunk in five colours a whole short line** („ТИ СПЕСТЯТ“, „ДА ЗАКЛЮЧИШ“, „МНОГО
  ТЪЖНО“, „ЕДНА СТЪПКА“, „AI ГАДЖЕ“). The preset suggests the last word; the editor widens it to the line when it reads as one.
- What: interface and tech words („НАСТРОЙКИ“, „ФАЙЛОВЕ“, „ИКОНКИ“, „ПАПКА“, „ПАРОЛИ“, „СИГУРНОСТТА“, „ХАКЕРИТЕ“) and the
  action in second person („СКРИЕШ“, „ПРЕМЕСТИШ“, „ИЗПОЛЗВАШ“, „ПРЕМАХНЕШ“).
- Rule (suggestions): the last word if it is a tech word, or if it has 7+ letters and stands out from the chunks on each side;
  never two in a row. Picks as many as the editors (30 %), agrees on 42 % (chance 30 %; length alone 34 %). The word list was
  made from these videos.

## How close the preset comes (the editors' own speech, Whisper words)

| | Editors | `aula` |
|---|---|---|
| Mean words a chunk | 2.36 | 2.20 |
| One-word chunks | 20 % | 16 % |
| Two-line chunks | 46 % | 45 % |
| Chunks with a green word | 30 % | 30 % |
| Editors' chunk starts that are also Asistent's (±0.2 s) | | 69 % |

17 characters a line keeps the two-line share and the most breaks; 18-19 bring the mean words closer (2.29-2.37) but give 50-55 %
two-line chunks and fewer shared breaks (65-67 %). The editors' mean is a little high from screen text counted as subtitles.

## Not in the preset

The position (two heights by format) is the Track Style's; the screen recordings' own English text is not subtitles.
