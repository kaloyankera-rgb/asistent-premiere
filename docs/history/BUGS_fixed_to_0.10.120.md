# BUGS.md: fixed and superseded entries moved out on 2026-11-21

Kept word for word. Each fix is also in `CHANGELOG.md` under its version. Open bugs and limits: [../../BUGS.md](../../BUGS.md).

## FIXED (0.10.120): subtitles froze at "Aligning the words to the sound…"
- ElevenLabs wrote a shout as one 1000-letter word and the dictionary's neighbour search (used when the project has learned
  fixes or correction lines) ran for minutes, holding the whole engine. CHANGELOG 0.10.120. Still true: a long pure-Python
  step in a job keeps the engine from answering the panel until it ends.

## FIXED (0.10.112): a Tint on text made in Premiere drew nothing
- Appended to the clip's effects it lands after the graphic's Text layer, where Premiere does not draw it; inserted before the
  Graphic group it colours the text. CHANGELOG 0.10.111-0.10.115.

## FIXED (0.10.110): Cut silences left 1-frame slivers and gaps between the clips
- The 10 ms plan edges rounded to the frame before a sound clip's first frame: one camera kept a frame the others did not. Cut
  edges now snap onto clip edges within a frame; keep-the-spaces drops flashes. CHANGELOG 0.10.110.

## FIXED (0.10.108): Cut silences crashed Premiere 26.5.3 on many clips (52 clips, 85 pieces)
- The crash was inside Premiere's UXP layer while it handed the panel a copy of a clip. The host now cuts a duplicate of the sequence instead (no copies): 17 runs, 0 crashes. CHANGELOG 0.10.108-0.10.109. The copies way remains only as a fallback without the host for at most 40 pieces.
- NEW TEST now holds about 75 "NO SILENCE – SYNC – кам2 (4) vN" sequences and one "HOSTPROBE" from these runs (the user may delete them); it held about 60 "NO SILENCE – SYNC – кам2 (4) vN" sequences from these runs: delete them.

## Superseded: the 0.10.98 batch limit (kept, harmless)
- Many short clips (49 clips, 94 and 133 pieces) went into one batch; Premiere 26.5.3 crashed in UXP's transaction callback. Batches are now at most 20 pieces. The exact limit is not known (58 worked, 94 crashed).

## Fixed in 0.10.95, not yet confirmed: Cut silences kept people talking further away; clone errors half-ran
See CHANGELOG 0.10.95. The 0.10.94 crash fix worked (05:49: 202 pieces in 15 batches); three later presses on the "Lokali" clip
hit "Illegal Parameter type" / "script object is no longer valid" and then a crash (05:52:40). The refusal's cause is unknown;
a refused piece is now skipped and named. Still open: „съседание“ for „състезание“ (Whisper hears it so every time).

## Fixed in 0.10.94, not yet confirmed by the user: Cut silences crashed Premiere on a long clip with many cuts
Three crashes 2026-11-15 05:09-05:10 (4a1a ALPHA, IMG_9423.MOV 492.8 s, -30 dB, 101 cuts): the whole-clip clones reached 28.6
hours of timeline. Now in batches within 2 hours (CHANGELOG 0.10.94). The exact limit was not reproduced (the user's Premiere was
open; no crash test there): if it happens again with batches, the next suspect is the number of clones per transaction.

## Fixed in 0.10.94: the dictionary turned heard words into different words („съседни“, „Кара“)
See CHANGELOG 0.10.94. Still possible: a same-syllable near-miss (асимулатор -> асимилатор), listed among the changed words.

## Fixed in 0.10.90: Anchor refused a text made in Premiere ("source media is unavailable") and animated Scale / Rotation
- A Type-tool graphic has no project item; it now counts as the sequence frame. Limit: Premiere gives no script the text's box
  (Source Text is null / binary), 0.10.91 measures the letters from two renders instead (two extra Undo steps that cancel out; refused when every Opacity is animated).

## Fixed 2026-11-12: the translator crashed pytest (and macOS reported "Python quit unexpectedly")
sentencepiece is built with SWIG, which warns on Python 3.12 while it sets itself up; under the test command's `-W error` the
warning became an error inside its C code and left it half set up, so Python crashed while loading the model or when unloading
it at exit (5 crash reports 2026-11-11/12, all from test runs started in the terminal, none from the engine, which never runs
with -W error). `tests/conftest.py` imports it once with only that warning ignored; the real-model tests run again (12 pass).

## Fixed in 0.10.70: Auto import took files from deep inside the watched folder (the vault's screenshots)
See CHANGELOG 0.10.70. NEW TEST still holds the 928 imported screenshots (bin MUSIC): delete them by hand.
