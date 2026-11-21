# BUGS.md: fixed and superseded entries moved out on 2026-11-21

Kept word for word. Each fix is also in `CHANGELOG.md` under its version. Open bugs and limits: [../../BUGS.md](../../BUGS.md).

## CONFIRMED BY THE USER (2026-11-21): no Premiere crash since 0.10.118
- The user has had no crash since the settle-and-fresh-handle fixes (0.10.87 Keyframer, 0.10.118 Lumetri / Tint). If one
  comes back: note the time and the step; crash reports are in `~/Library/Logs/DiagnosticReports/Adobe Premiere Pro 2026-*.ips`.
- **Premiere crashed on Exposure +0.5 pressed twice fast (2026-11-18 11:48, the user's GStroy project, 26.5.3):** two clips
  without a Lumetri; no crash report written. Treated as the same Premiere fault as the Keyframer crash below; 0.10.118 settles
  60 ms and reads the effects from a fresh handle after every Lumetri / Tint add and between queued presses. If it happens
  again, note the time and whether the clips already had a Lumetri.
- **Premiere crashed once while testing 0.10.86 (2026-11-15 04:07, NEW TEST, recovered on relaunch):** inside UXP, turning a
  Premiere object into JavaScript (`napi_wrap` from `CallProperty`; the pointer read was text: a freed object), right after
  the Keyframer added its motion blur Transform. The same step ran fine about ten times before and after; Lumetri and Tint
  add effects the same way. 0.10.87 keeps the new effect referenced, waits 60 ms and reads the chain from a fresh handle. If
  it happens again, the crash report is in `~/Library/Logs/DiagnosticReports/Adobe Premiere Pro 2026-*.ips`.

## CONFIRMED BY THE USER (2026-11-21): Tracker Track / Stop on the first click (0.10.77)
- **Fixed in 0.10.77, not yet confirmed by the user (2026-11-15):** Track and Stop in the Tracker needed several clicks (the
  user's screen recording): Track's tooltip stayed up while it was clicked and only the last press reached the log. Likely the
  picture kept the pointer captured after the box was drawn. Captures are released by hand now, and a press landing on a button
  but delivered elsewhere presses that button (log: "press for ... arrived at ..."); if that line never shows and presses are
  still lost, the cause is elsewhere.

## SUPERSEDED (2026-11-21): rough cut bugs, the rough cut was replaced by Cut silences (0.10.65)
- The user, 2026-11-21: the rough cut is no more, Cut silences replaced it; the sideways vertical footage is believed fixed.
- **Rough cut: vertical footage comes in sideways (2026-11-03, 0.9.64; 0.9.67 describes rotated files upright in the XML, UNVERIFIED).** The Masterhaus files (fx31033, C0736: 3840×2160, display matrix `rotation=90`) are upright in the source sequence (Premiere reads the flag on a normal import) but sideways and letterboxed in the rough cut, with no rotation in Effect Controls: the XML's `<file>` says 3840×2160 and the master clips the import makes do not take the flag. Probe XMLs (A as now, B 2160×3840, C no `<media>` in `<file>`) in the session scratchpad; the fix waits for TEST.prproj.

- **Rough cut: an unused quiet audio track counts as sound (2026-11-03, 0.9.63; 0.9.67 leaves out audio on a muted track or a disabled clip, UNVERIFIED: needs `isMuted`/`isDisabled` in Premiere 26.0.2).** The camera's own mic (A1) selected next to the lavalier tracks makes the stretches where only that camera records look like speech; they stay and leave gaps in the other camera's row (44.8 s in the last run, more with A1 selected). Workaround: delete (or do not select) the unused track; then the time no selected audio covers is cut whole (162 s in that run; the result says so). Proposed fix, not built: audio on a muted or disabled track is ignored for speech and left out of the rough cut.
- **Rough cut: the user says the effects of „Оправи звука“ do not transfer (2026-11-03, 0.9.63).** Read back on the new sequence in TEST.prproj: Volume level and Dynamics → Limiter -6 dB are on every piece and match the source. Not checked and not readable by any API: the L/L and R/R channel routing (the new clips use the full media file through the XML, not the „… L …“/„… R …“ subclips). The user was asked which effect is missing.

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
