# Subtitles

## What it does
The Subtitles row ("Make subtitles") recognises the Bulgarian speech of the selected audio clips, writes an `.srt` and
a `.json` into `Asistent_subtitles` next to the project, and puts the lines on a new caption track of the same sequence
(plus an English track when "English line" is on). The Captions tab fixes words, checks doubtful lines, sets who speaks
and exports a transcript. This page is a map; the long reasoning is in
`docs/BULGARIAN_TRANSCRIPTION_GUIDE.md`, `docs/BENCHMARK.md`, `docs/SUBTITLE_STYLE.md`, `docs/SUBTITLE_STYLES/` (one
file per client) and `docs/ROLLBACK.md` (switching off, restoring).

## How to use it
1. Select the audio clips with speech, pick a Style (Auto, ReShape, GStroy, Credissimo, ЕКОПАК, Beauty Sector, AULA),
   optionally Max words (1-4), Case (Normal / ALL CAPS) and Line break (On + colour), type names or `чуто => казано`
   corrections in the box if needed, press Make subtitles.
2. Select all the captions and restyle them together in Properties. Optional: Upgrade Caption to Graphic, select the
   graphics, press Move off faces (only Position changes, one Undo step; hand-moved lines stay).
3. Captions tab: type a wrong word right, Apply and rebuild (no new recognition, seconds). Also Who speaks per track,
   Lines to check, search, Learned, Export transcript. Settings > Subtitles: ElevenLabs key, Turn off, Remove key.

## Key points: do not break
- ReShape is frozen (the user, 2026-11-20: "perfect how it is"). It runs the `CLASSIC` profile, always local, with its own
  cache keys and result keys. Pinned by `tests/test_recognition_profiles.py`, `tests/test_reshape_baseline.py` and
  `scripts/reshape_golden.py check` (must stay identical). `scripts/reshape_guard.py` lists the protected files; touching
  one needs a golden check and a DECISIONS entry. New code in them is an optional argument whose default is the old call.
- The first cloud exception (the user, 2026-11-21, 0.10.119; the second is Cut silences' AI words, 0.10.121, which share these
  readings by cache key): every style but ReShape's may be read by ElevenLabs Scribe v3
  when a key is saved and the switch is on. Only the sound of the windows goes, never picture, names, prompt or corrections.
  No other feature may use it. `cloudasr.py` is the only module that sends anything out. The key stays in
  `<app>/elevenlabs.key`, is never returned to the panel, never printed or committed. Failure falls back to this computer
  and the result line says why.
- Recognition profiles (`recognition.py`): `CLASSIC` ReShape, `CLOUD` key saved, `STRICT` local default (= 0.10.118),
  `NEXT` local experiments (`ASISTENT_RECOGNITION`, development only). After Scribe the dictionary repair is off.
  A recognition change goes into `NEXT`, is scored by `scripts/bench_subtitles.py` on held-out videos, never tuned on one clip.
  The local model (faster-whisper large-v3, CPU int8, beam 5) is never downloaded without the panel button.
- Verbatim by default. A word changes only by a dictionary-checked repair, the editor's own correction line, a learned fix
  that passed the trust rules and the sound check, a writing rule (`bgnorm.py`, `english.py`) or a punctuation rule.
  Doubtful words are marked, never guessed. No global gender: Who speaks steers first-person forms on its track only.
  Corrections run before the aligner. `tests/test_guide_regressions.py` is the guide's §10 table: no hard-coded fixes.
- UXP cannot create a caption track, so the Asistent host does (`as_captions`, ExtendScript `createCaptionTrack`). After a
  new pair is placed and checked, the lines of Asistent's OWN earlier pair are removed in one step (`removeLines`), only when
  every line's time matches the record kept by sequence guid (`captionstate.py`). Empty tracks stay (no script deletes a
  caption track). This is the only removal allowed.
- Max words, Case, Line break (0.10.138-0.10.139) are copies of the style (`with_max_words`, `with_case`, `with_line_break`),
  never for ReShape; off, every style gives exactly the old captions. Line break's colour is `<font color>` on the bottom line
  of the Bulgarian .srt only (the JSON, the panel and the English stay plain text).
- A line never appears before its cut; cuts follow where the speaker ends a phrase (0.10.61, not ReShape).
- Learning writes only to the client's "<Client> Subtitle Learning" office folder (one file per computer, outbox when the
  server is away). Development scripts and tests must never write there.

## Decisions
- CEP host, never a guess (DECISIONS 2026-11-01); one reading per window (2026-11-02); captions not graphics, learning
  per client, a new pair replaces the own earlier pair (2026-11-04); CPU int8 beam 5 (2026-11-08); styles are presets
  (2026-11-10); cuts follow the delivery (2026-11-12); ElevenLabs after the benchmark (2026-11-21).

## Code map
- Panel: `subtitleplan.js`, `captionplan.js`, `captionedit.js`, `reviewplan.js`, `placementplan.js` (all pure, node-tested);
  `premiere-subtitles.js` reads the selection; `premiere-captions.js` `place`, `removeLines`, `readTracks`;
  `premiere-placement.js` Move off faces; `main.js` `onSubtitles`, `onCaptionApply`, `onTranscript`.
- Engine: `subtitle_job.py` + `dialoguemix.py` (the `/subtitles` job), `asr.py`, `cloudasr.py`, `recognition.py`,
  `subtitles.py` (`PRESETS`, `build_captions`), `bgtext.py`, `bgnorm.py`, `numbers.py`, `english.py`, `lexicon.py`,
  `consensus.py`, `suspects.py`, `agreement.py`, `align.py`, `corrections.py`, `learning.py`, `audiocheck.py`,
  `subtitle_settings.py` (per-project text and speakers), `review.py`, `transcript.py`, `translate.py`, `framefaces.py`,
  `captionstate.py`, `hostbridge.py`; endpoints `/subtitles*`, `/captions/*`, `/cloud` in `server.py`.
- Host: `host/host.jsx` `as_captions`. Dev: `scripts/check_subtitles.py`, `bench_subtitles.py`, `reshape_golden.py`.

## Status
- Since 0.9.42 (caption track 0.9.45 verified in Premiere by the user 2026-11-01; learning test passed 2026-11-04; Move
  off faces seen on one shot 2026-11-09; review helpers confirmed 2026-11-08).
- Latest: 0.10.119 ElevenLabs (650 wrong words of 4171 locally, 365 with Scribe, about 14x faster). The user's first run
  froze; fixed in 0.10.120 (a shout read as a 1000-letter word). The user, 2026-11-21: works in Premiere on two videos,
  fast and accurate. Still to run: ReShape on its own clip, and Auto with the switch off.
- Client styles (0.10.18-0.10.22), 0.10.61 cuts: not seen by the user in Premiere.
- 0.10.138 Max words and Case, 0.10.139 Line break, 0.10.140 Export transcript with a time on every sentence: installed,
  awaiting the user's look (TODO SUB); open: whether Premiere keeps the .srt colour.
- Windows: untested (host install, CEP path, learning folder). Latest release v0.10.118. Open: BUGS "Limits of
  subtitles by ElevenLabs"; TODO V119, SEG, SL, S, A.

## Tests
- Text: `test_subtitles.py`, `test_subtitle_job.py`, `test_max_words.py`, `test_case.py`, `test_line_break.py`, `test_chunking.py`, `test_delivery.py`, `test_guide_regressions.py`,
  `test_bgnorm.py`, `test_numbers.py`, `test_english.py`, `test_lexicon_by_ear.py`, `test_consensus.py`, `test_corrections.py`.
- Recognition and ReShape: `test_asr.py`, `test_recognition_profiles.py`, `test_cloudasr.py`, `test_reshape_baseline.py`.
- Learning, review, styles, bench: `test_learning.py`, `test_speakers.py`, `test_review.py`, `test_transcript.py`,
  `test_framefaces.py`, `test_hostbridge.py`, `test_*_style.py`, `test_bench*.py`; node: `subtitleplan`, `captionplan`,
  `captionplace`, `captionedit`, `reviewplan`, `placementplan` (`tests/*.test.js`).
