# Changelog

All notable changes to Asistent. Newest first. Reconstructed from the git history up to 0.9.41 (all work so far happened on 2026-11-01); from here on every completed and verified task adds an entry under `Unreleased` or a new version heading (see the workflow in `CLAUDE.md`).

Versions are the panel/engine version (`panel/manifest.json` and `engine/asistent/config.py` always match). "Verified" means confirmed by the user in Premiere; details per feature are in `PROJECT_STATUS.md`.

## Unreleased

### Branch improvements/2026-11 (the user's implementation prompt of 2026-11-08; not installed, not pushed)
- **Protected backup before any change**: local tag `backup/pre-improvements-2026-11-08` (fbe0b28, 0.10.8) and a private,
  read-only backup outside the repo (Git bundle, whole working tree, app data, installed panel/host, LaunchAgent, model
  hashes, restore steps; isolated restore ran 574 pytest + 166 node green). See `docs/ROLLBACK.md`.
- **ReShape baseline (dev only, no app change)**: `scripts/reshape_guard.py` (protected files changed since the tag),
  `tests/test_reshape_baseline.py` (preset, constants, byte-exact captions of 36 synthetic inputs made by the tag's code; a
  0.01 s lead change fails 15 of them), `scripts/reshape_golden.py` (the whole job on the client's own ReShape recording,
  byte for byte against the run recorded at the tag; private store outside the repo; two cold runs identical, ~75 s).
- **Native-graphics probes (docs/NATIVE_GRAPHICS.md, raw results in docs/probes/)**: in Premiere 26.0.2 no script can write or
  read a native text graphic's words (an ExtendScript write leaves the graphic drawing nothing; UXP reads null) or its font,
  size, fill and stroke (not parameters); only position/scale/rotation/opacity and timing are writable. The optional
  "Native graphics" output is therefore not built; captions stay. The probe blanked the old "Your Title Here" test graphic in
  NEW TEST (three Undo steps or delete it).
- **Bulgarian recognition benchmark (dev only, docs/BENCHMARK.md)**: `engine/asistent/bench` (normalization that keeps ъ, ь, й, ѝ
  and hyphenated words; digits and numerals compared as spoken) and `scripts/bench_asr.py` (backends run with their own Python,
  scoring with jiwer 4.0.0 in its own `<app>/venv-bench`): WER/CER raw and normalized, numbers, negations (also inserted ones),
  names, dropped passages, word timing, word edits, time and peak memory. Private store with dev and held-out clips; scores only
  against references a person verified. Starter set: three Masterhaus clips (143 s), drafts written, none verified yet, so no
  accuracy numbers. Tests: 6 in any venv, 13 with jiwer.
- **whisper.cpp evaluated (dev only, not wired)**: v1.9.5 with Metal and `ggml-large-v3` (multilingual), beam 5, in
  `<app>/experiments/whisper.cpp`; `bench_asr.py hyp --backend whispercpp`. 7.3x faster than Classic on the 143 s, but an invented
  „Абонирайте се!“, „млн.“ for „мм“ and rougher word times; kept out until the verified references are scored (docs/BENCHMARK.md).
  Word timing now ignores lone dialogue dashes.

## 0.10.13 - Move off faces reported "nothing changed" after moving the lines (found in NEW TEST)
- The user's first press in NEW TEST (9 upgraded lines, V5, 190.8-201.0 s) moved every line (all to Motion Y 0.3565, one shot,
  under a face), then said "Premiere did not accept the move (nothing changed)": `transaction()` returns nothing and throws on a
  refusal, and the new code read the missing value as a refusal; the written positions were not remembered either. Fixed; a test
  now checks that no panel code reads `transaction()`'s return value.

## 0.10.12 - Move off faces: subtitle graphics go to the client's height per shot (TODO R.5; not installed yet)
- **Move off faces** (Subtitles card): after the editor's right-click > Upgrade Caption to Graphic, select the subtitle graphics
  and press. Each line moves to the height the client's videos use (docs/SUBTITLE_STYLE.md, measured on 625 lines): one height per
  shot, the Bulgarian line's top 0.11 under the speaker's chin, above the face when it is low, the middle with no face, never
  above 0.16 or below 0.72 of the height; an English line (same times, the lower one) stays 0.035 under its Bulgarian line.
- How: the shots are the top visible clips under the lines; up to 3 program frames per shot are exported and the engine finds
  faces in them (YuNet, numbers only, frames deleted after: `framefaces.py`, `POST /captions/faces`); the rule is
  `placementplan.js` (pure); only Motion > Position is written, all lines in one Undo step (`premiere-placement.js`).
- Left alone: graphics with Position keyframes, and graphics the editor moved (Position no longer Premiere's default after the
  upgrade nor the value Asistent wrote last time, remembered per sequence on this computer). Text, style and timing never change.
- Limits: Premiere does not tell a script how tall a text graphic is (docs/NATIVE_GRAPHICS.md): the line height is a setting
  (0.035) and the text's on-screen centre is estimated from the layer's offsets (0.009 off on the probe title).
- Tests: 8 node (placement rule), 2 pytest (frames folder guard, fractions, deletion). Not yet pressed in Premiere.

## 0.10.11 - Captions tab ▶ plays in Premiere's Program Monitor (the user's review of 0.10.9)
The user: ▶ played "in the background, not in the program viewer", and with the timeline playing it was heard twice.
- ▶ now moves the playhead 1.5 s before the line and Premiere plays it in the Program Monitor, then stops 1.5 s after the line,
  only if the playhead is still inside that passage (playback the editor started elsewhere is left alone). The separate
  player (`listen.py`, afplay/winsound, `/subtitles/listen`) is removed. Through the host: QE `player.play(1.0)` / `stop()`
  (probed in NEW TEST; `qe.startPlayback()` did nothing); new host commands `play` / `play_stop`, engine `POST /subtitles/play`.
- Checked in NEW TEST through the engine: played from 1:57.8 (at 1:59.2 after 1.5 s), stopped inside the passage, left alone
  for a passage elsewhere. The panel loaded 0.10.11 live and Adobe lists only 0.10.11 (the 0.10.10 installer fix, on a real update).
- `host/host.jsx` and `hostbridge.py` gained the two commands only (guard lists them); ReShape golden check identical.

## 0.10.10 - Updates leave exactly one panel version, so Premiere runs the new one (found while testing 0.10.9)
- **Premiere kept running an old panel after every update since 0.10.6.** Adobe's installer, asked to install over the old
  panel, kept the older copies enabled beside the new one (this Mac: 0.10.7, 0.10.8 and 0.10.9 all "enabled", some twice), and
  Premiere loads the first one listed: after a restart it ran 0.10.7, so 0.10.7 and 0.10.8 never ran here. Now, when Adobe lists
  anything but the new version, every copy is removed and the new one installed again (one retry; the message says to
  double-click the .ccx if that fails). The path given to Adobe is absolute: a relative one failed with status -160.
  Checked on this Mac: after the 0.10.10 install Adobe lists only 0.10.10 (0.10.9, still open in Premiere, is "uninstalling").
  Other computers get the fix with this update; their older copies are removed by it.
- **0.10.9 checked in NEW TEST** (Subtitles on fx31031 in "SYNC – кам2", 17 lines, own earlier pair replaced): the review loaded
  (17 ▶ buttons, Lines to check shown; 12 lines to check, both „500 млн.“ lines first as number doubts, the dictionary repairs
  „водяло → видяло“ and „пусока → посока“ shown with their originals); Lines to check switched to "All lines"; ▶ moved the
  playhead from 2:10.4 to the line's 1:59.3 and played the passage (afplay). Through the test bridge; the user's own listen and
  Review helpers off still to try.
- Tests: 5 new (fake Adobe installer), 637 pytest + 173 node pass.

## 0.10.9 - Captions tab: reasons under the lines to check, Play with the sound around a line (branch improvements/2026-11)
The user's implementation prompt, stage 4 (faster, clearer subtitle review). Not installed yet (each install needs the user's OK).
- **Reasons under each line to check** (engine `review.py`, `POST /subtitles/review`; panel `reviewplan.js`): read from the run's own
  JSON, nothing changed in it. Words (recognition) and Timing are separate kinds; what changed is shown with its original
  („масна“ → „масона“, dictionary repair / learned fix / your correction / speaker form); numbers and prices, negations, names, a
  word that may be missing, gender forms and endings that disagree come first. "Unsure" is what the recognition reported, never a
  percentage; same-model readings are not called a confirmation. Weak alignment alone is shown but does not make a line one to
  check (on 19 real runs it would have marked 14 of 17 lines).
- **Lines to check**: shows only those lines; press again for all. The line under Apply says how many and of what kind.
- **Play** (▶ on every line, `listen.py`, `POST /subtitles/listen`): plays the line with 1.5 s before and after, from the same
  microphone piece the subtitles were made from, on this computer (afplay / winsound), and moves Premiere's playhead there
  (`Sequence.setPlayerPosition`, present in 26.0.2). A new Play stops the previous one.
- **Review helpers** checkbox (on by default, remembered on this computer): off shows the list as before (only the checkbox row is new).
- Correction history: unchanged and kept: every run writes its own timestamped JSON with `verbatim` (Whisper's words, never
  edited) and `edits`; Apply and rebuild re-aligns changed words as before. Partial reprocessing: not added (the rebuild reuses
  the recognition cache and takes seconds).
- The ReShape path is untouched: `reshape_guard` clean, golden full-job check identical, baseline test green.
- Tests: 12 pytest (review, listen), 1 server test, 7 node tests; preview scenario `review` (240/300/420 px).

## 0.10.8 - A covered clip gets only what needs no frame check (found by testing in NEW TEST)
Claude ran the open Premiere checks through the test bridge in NEW TEST.prproj (2026-11-08) and found one real problem.
- **Colour on a clip under a visible layer applied an unchecked +2 stops.** fx31030 in the rough-cut sequence: on the timeline
  (no face found) the midtones said "on target" at Exposure 0.5; covered by V2 it was measured on its file, where the skin said
  +2.7 stops, and Exposure 2.1 went in at medium confidence with ~14 % estimated highlight clipping, while the frame check cannot
  run under a layer. The white balance from the file also differed (Temperature 24.3 against 18 on the timeline). Now a covered
  clip measured on its file gets only high-confidence corrections, never an exposure expected to burn out the highlights, and
  says why; the misleading "checked on a frame after applying" note is gone there. NEW TEST: the same press now applies only the
  white balance and says "Exposure not applied … the highlights would probably burn out".
- A value the clip already has is not written again (the covered press reported "Applied to 1 clip" for an unchanged
  Temperature and Tint). Node tests; seen in Premiere once the panel is reloaded.
- **Verified in NEW TEST through the bridge (panel 0.10.6 code, unchanged since):**
  0.10.0 one press on V1 reads only V1 ("1 selected parts"); the V2 clip with the same cut, switched off, gets no Lumetri and stays
  off, also when it is selected too (listed as "switched off"). 0.10.4: with the track above hidden the clip is measured on the
  timeline; a razor-cut piece of a clip with Asistent's Lumetri is recognised as Asistent's own and updated (the other piece
  untouched); Fix audio's L/L and R/R copies keep the clip's colour label, and a second press gives recoloured older copies the
  clip's label back without splitting again. 0.9.89: three quick Exposure −0.5 presses all count (2.1 → 0.6).
- Tests: 1 new pytest (covered clip rules), 574 pytest + 166 node pass.

## 0.10.7 - Show exports: works after the office drive mounts, and fast in a new plan folder
The user, 2026-11-08: a finished export did not open its folder, and when it did it took up to ~30 s.
- **Nothing was watched after a restart.** The engine starts at login, before `/Volumes/Production` is mounted; the watcher
  started only on the folders that existed then (none) and looked again only when the editor switched projects. The log showed
  no "exports: watching" line at all since the 10:18 restart. Now the checker keeps running while Show exports is on and starts
  (or stops) watching a folder within ~1.5 s of it appearing (a drive mounted, back from sleep). Test with a real file watcher.
- **An export into a new plan folder waited for Premiere's preferences.** Premiere names the Export tab's folder in its
  preferences only when it gets round to writing them, sometimes after the export ended, and a named file older than them then
  waited another 10 s. Now Asistent learns the office's export tree (a folder whose children held exports of 3 different
  clients: here `Production/Exported Videos`, learned from the recent list) and catches a video written exactly
  `<client>/<plan>/` deep in it through the Mac's file events. Verified on this Mac: a Premiere export (host
  `exportAsMediaDirect`, NEW TEST, 8 s) into a new plan folder of a test tree was shown selected in Finder ~3 s after it ended,
  with Premiere's preferences naming another folder. The tree is never scanned and only file events count: macOS reports only
  this Mac's own writes, so a colleague's export on the shared drive is never shown; no trees on Windows (its share
  notifications include other computers). A whole drive or the home folder is never a tree.
- **Premiere's export events are used when they come.** The panel listens to `EncoderManager.EVENT_RENDER_COMPLETE / _ERROR /
  _CANCEL` and `OperationCompleteEvent.EVENT_EXPORT_MEDIA_COMPLETE` (all present in 26.0.2, probed through the bridge) and tells
  the engine an export ended; with a path it is checked at once, without one the preferences are read again for 30 s and a file
  they name that was written within 60 s before the event counts with no wait. Every event is written to the engine log. Probe
  result: an export started by ExtendScript (`exportAsMediaDirect`) fires none of them; whether the Export tab does is unknown.
- `panel/exportevents.js` (new, node tests), bridge command `export_try` (EncoderManager.exportSequence into a given file).
- Tests: 7 new pytest (drive mounted late, export event with and without a path, preferences written after the event, tree
  learning, tree file events, tree never scanned), 4 node tests; 573 pytest + 166 node pass.

## 0.10.6 - Existing edits protected, correctness, speed, safe updates (the independent audit of 0.10.1)
An outside audit of 0.10.1 listed 24 problems; each was checked against the code (report in the session of 2026-11-08), every
valid one fixed here. "NEW TEST" = checked in Premiere 26.0.2 in NEW TEST.prproj through the test bridge on 2026-11-08.
**Existing edits**
- Subtitles: a caption track counts as Asistent's only when every line still has the time Asistent gave it (count + first/last
  let an edit inside the track pass, and the next press deleted it); records are kept by the sequence's guid, not its name; a
  record from before 0.10.6 is never trusted for removal, only named. NEW TEST: a press replaced its own earlier pair (C23 -> C24),
  the guid key logged. (BUG-001)
- Subtitles: nothing is recorded or removed unless the whole new pair (Bulgarian and English) is placed and checked; an English
  line the host refused or that timed out keeps the earlier pair and says so (it used to remove the earlier English track and
  report success). Mock tests. (BUG-002)
- Subtitles go only onto the sequence they were made from: switched sequence or project during the job -> "moved", nothing
  placed. NEW TEST: switched to "кам2" mid-job, nothing placed, the message named both. (BUG-003)
- Fix audio: a subclip is reused only when it is the same media file and range (a tag of the media path in the name, the path
  and in/out checked); a copy whose channels failed is renamed "… FAILED" and never reused; a half-done split says which copy
  stayed. NEW TEST: a split, and a second split of the same range reused the subclips. (BUG-004)
- Fix audio: a clip with Volume / Channel Volume / Panner keyframes, another effect or a Dynamics with its own settings is not
  split (the copies replace it without them). NEW TEST: overwriteClip DOES drop the original's Volume keyframes (measured), and
  such a clip is now refused with the reason; a plain clip still splits. (BUG-005)
- Colour: "untouched" means the whole Lumetri equals the untouched one Asistent learns when it adds one itself (it meant only the
  five sliders at 0, so a Highlights-only grade got values and became "Asistent's"); ±0.5 records only a new, untouched or own
  Lumetri; Asistent's ownership of a cut piece now needs the same folder + file name (0.10.4 matched the name alone). NEW TEST:
  the untouched snapshot is the same on two clips; a Highlights-only grade got only Exposure, was not recorded, Auto color
  refused it. (BUG-006)
- Colour: a parameter with keyframes is never written, in any Lumetri and by any button, read again just before the write.
  NEW TEST: keyframed Exposure in Asistent's Lumetri left alone. (BUG-007)
- Managed Lumetri records: one lock per file for the whole engine, a unique temporary file, a damaged file kept aside (two
  requests at once lost a record or left invalid JSON, which then counted every grade as unknown). (ARCH-003)
**Correctness**
- Rough cut: a near repeat that differs in a negation („не“), a number (also in words: пет/шест) or a name is "said
  differently" and never cut, in either direction. (BUG-012)
- Cancel: a job cancelled while its last step ignored the request ends "cancelled" and its result is dropped; FFmpeg/FFprobe
  stop on cancel or after a time limit; Shot Match can be cancelled; the panel never applies a result after Cancel. (BUG-014)
- Subtitles: switched-off and muted audio is not recognised; an L/L or R/R copy is heard on its own channel only, and the second
  reading of a piece uses the channels the mix chose. NEW TEST: subtitles from an L/L copy. (BUG-008)
- Rough cut: a switched-off video clip or a video track with its eye off is left out and named. (BUG-009)
- Rough cut: per clip, what of a Lumetri was not carried (settings beyond the five, keyframes). NEW TEST: both notes shown.
  (BUG-010)
- English word fixes taken back are revoked for the client too (they came back from the shared learning). (BUG-013)
- Sync: two cameras whose files share one folder never land on top of each other on one track. (BUG-011)
- Checks: the rough cut checks every piece (file, part of the file, place) and fails on a track the plan did not have; Sync fails
  on extra picture clips. NEW TEST: a rough cut and a Sync passed with no false alarm. (ARCH-004)
- Buttons: only the main mouse button acts, and a press held longer than 1 s no longer acts twice. Node tests; UXP's own event
  order not checked. (UX-001)
**Speed** (measured, identical output)
- FFmpeg's sound is streamed into place: 20 min of 48 kHz stereo peaked at 724 MB instead of 1644 MB, bit-identical (also on
  real FX3 footage), slightly faster; long items are decoded fewer at a time (2 GB budget); the FFT thread setting is per thread.
  `scripts/bench_decode.py`. (PERF-001; pair pruning not done: no criterion proven safe yet)
- Word alignment: up to two aligner processes stay loaded (stopped after 60 s unused) instead of one Python + model per window:
  ~0.9 s per window instead of ~2.1 s, bit-identical. (PERF-002)
**Updates and reliability**
- Host commands: one Premiere did not take in time is withdrawn (it used to run later, after the editor's retry); one already
  taken is said to maybe still finish; waits up to 600 s. (ARCH-001)
- Updates keep the installed version in `<app>/previous` (files, panel package, package list) and put it back when pip, the files,
  the host or the panel fail; the panel is installed over the old one before any removal; an engine that does not start three
  times after an update is put back by `run_engine.py`. Failure tests on a private app folder. (ARCH-002)
- sentencepiece 0.2.1 (CVE-2026-1260 / GHSA-38vq-g6vr-w8wf): same tokens and same English on a test set. (SEC-001)
- Downloads pinned: Whisper and the translator at one commit with SHA-256 checks, the Bulgarian dictionary at one commit with
  SHA-256, CUDA wheels pinned (untried on the PC); hash-locked requirement files for the Mac (`scripts/lock_requirements.py`)
  used by setup and updates. (SEC-002)
- Test bridge: `click` with `now: true` presses while the panel is busy (to test Cancel).

## 0.10.5 - Show exports: Finder within ~2 s, no older file, no downloads
The user's first real export (MASTERHAUS КП-3 Видео 7, 13:53): "it didn't open the folder". The log: Premiere wrote its
preferences when the export started (13:53:40) naming a file that still held the earlier export of the same video, which was
counted at once; the new file was written 13:53:46-13:54:09 and Finder was asked only at ~13:54:19. Earlier, sound effects
downloaded into the project's Assets folder had been "shown" as exports.
- The waits are 1.5 s (size steady) + 1.5 s (queue) instead of 3 + 5, and the folder is looked at every 1.5 s: an MP4 / MOV is
  proven whole by its boxes and FFprobe, so a pause in writing cannot pass for the end.
- A file the preferences name that is older than the preferences waits 10 s: replaced by then (an export starting), only the
  new file counts; unchanged (an export that ended before Premiere wrote them), it is shown.
- The project's own folder is no longer watched (the office never exports there; downloads land there). Watched: Premiere's
  export folder and folders added with "Add export folder…".
- Checked: Show again on that export brought Finder to the front over Premiere with the file selected.

## 0.10.4 - Colour works under a hidden or visible overlay and on cut clips; Fix audio copies keep the clip's label
The user, 2026-11-05 (MASTERHAUS КП-3, C0706): Auto color and White balance said "nothing was touched" while Before / after
showed a change; and after Fix audio a razor cut turned the audio piece green.
- **A hidden track covered every clip.** The safety-margin template sat on V4 with its eye off; the panel counted any clip on
  a higher track as a layer over the picture, so it measured the file, and a file measurement was always "low" and never
  applied. A video track's eye (`isMuted`) is now read: a hidden track or a switched-off clip covers nothing (`moments.covered`).
- **A visible layer no longer blocks the correction.** When a clip under a logo / title / template has no colour effects of its
  own (only Motion, Opacity, Time Remapping and an untouched or Asistent's own Lumetri, `fileShowsClip`), the file shows the
  same picture: the engine keeps the measurement's confidence and the panel writes the values as they are (absolute), replacing
  Asistent's earlier ones. Another effect or a hand grade: still a proposal only, said in the warning.
- **Asistent's own Lumetri on a cut clip.** Ownership was kept per clip piece (media + in/out), so after a cut or trim Match POVs'
  Lumetri (fx31028: Tint −1, Saturation 111) counted as a hand grade and was refused. Now the same snapshot written on any piece of
  the same media file (matched by file name) is Asistent's; any hand change still makes it the editor's (`managed.owned`).
- **Fix audio labels.** The L/R subclips took Premiere's default Audio label (green) while the placed pieces showed the clip's
  colour, so a razor cut made a green piece. The subclips now get the label of the clip they come from (`as_same_label`), and a
  Fix audio press over copies from an earlier press only relabels them (route "label", never split again).
- Not yet pressed in Premiere (the user's client project was open): the video `isMuted` read is logged once as "hidden check".

## 0.10.3 - Show exports: a finished export from the Export tab is shown in Finder
The user, 2026-11-05: "for now just do the export mode" (Media Encoder and Quick Export later). New card "Show exports"
(off by default; on, on the user's Mac): when an export from the Export tab is finished, Finder opens with the file selected
(Explorer on Windows, untested). A queue shows only its last file; the Log tab lists every export with "Show again".
- **Where it looks** (`exports.py`): the office exports into a tree of its own (Production/Exported Videos/<client>/<plan>),
  not next to the project, so the engine reads Premiere's preferences (`ExportSettings.Info.SaveAsFile` OutPath and
  `MZ.Prefs.Export.Media.Path`, the newest Premiere version's file) and watches the folder the Export tab writes to, only the
  files directly in it (a "Към клиент - компресирано" copy made afterwards does not count). When Premiere rewrites its
  preferences, the file they name is checked too if it was written after watching started (an export to a new place). Also
  watched: the project's folder, folders added with "Add export folder…". Paths compared without case or Unicode form.
- **When it is finished** (`settle.py`, now shared with Smart Folder Sync): size and time unchanged for 3 s, the file opens,
  an MP4 / MOV has all its boxes inside the file (Premiere writes ftyp, moov, uuid, mdat; checked on a real 1.26 GB export),
  FFprobe reads a duration. Previews, Auto-Save, Media Cache, temp files and Asistent's own frames never count.
- Not probed in Premiere yet: whether Premiere writes the export under its final name from the start (the checks cover both).
  The UXP / ExtendScript export events (phase 0 of `docs/EXPORT_REVEAL_PLAN.md`) are left for Media Encoder / Quick Export;
  the bridge commands `export_listen` / `export_events` for them are in `devbridge.js`.

## 0.10.2 - Faster subtitles; English words written in English
The user, 2026-11-04: subtitles are slow; and an English word a Bulgarian speaker says should be written in English
(„Бюти сектор“ = "Beauty Sector", „спей се“ = "Space").
- **Speed** (cold runs, nothing cached, measured on the M4 Max): ReShape (72 s of speech in one window, learned fixes)
  256 -> 130 s; Beauty Sector (31 s, two windows) 89 -> 53 s. Where the time went: one Whisper reading at a time inside a
  window, the second opinions one after another (96 s), the sound checks of learned fixes one after another (51 s, ~10 s each),
  the English sentences one after another. Now the second opinions of a window and the sound checks run at the same time, the
  translator takes three sentences at once and loads while Whisper reads, and Whisper runs 3 readings x 4 threads instead of
  5 x 2 (one long window reads 32 % faster; the thread count does not change the words). The subtitles are byte-identical
  to before on ReShape (Bulgarian and English SRT); only the order of the learned-fix list in the report changed (now sorted).
- **English words in English** (`english.py`, a writing rule after the aligner, listed in the edits as `english`): a Cyrillic
  word that is not Bulgarian, not a Bulgarian word with its ending swallowed, 4+ letters, and the usual Cyrillic spelling of a
  common English word is written in English („уоркшоп“ -> workshop, „имейл“ -> email, „окей“ -> okay), and the English words
  right after it too („бюти сектор“ -> Beauty Sector, capitals for a name of two or more words); „спей се“ (Whisper splitting
  a final s) -> Space. A Latin name in the names box is written exactly as given. Bulgarian loans spelled the Bulgarian way
  stay („дискомфорт“, „маркетинг“, „фитнес“). The data: `models/english_bg.json.gz` (381 KB, from CMUdict, BSD, see
  LICENSES.md; `scripts/build_english_index.py`). On all 16 earlier runs on this Mac (1345 words) it changed only бюти,
  сектор, спей се, уоркшоп. An English name is not split across two lines. The English line improves too ("shop we" ->
  "Space we").

## 0.10.1 - Exposure ±0.5 also works in a Lumetri you set yourself
The user, 2026-11-04 (MASTERHAUS fx31028, a Lumetri with Exposure, Tint and Saturation set by hand: "Nothing changed"):
Exposure −0.5 / +0.5 now move Exposure in the editor's own Lumetri too. Only Exposure changes; Tint, Saturation and every other
slider stay as they were. That Lumetri is not recorded as Asistent's, so Auto color, White balance, Exposure and Match POVs
still never touch it. A keyframed Exposure is left alone (said in the details). Only these two buttons; one Cmd/Ctrl+Z undoes
a press. 0.10.0's selection fix is confirmed in the log of that press ("1 selected parts: V1 fx31028.MP4").

## 0.10.0 - A selected clip no longer selects the clips with the same cut on other tracks
The user, 2026-11-04 (MASTERHAUS, two POVs after Sync): Auto color on the POV on V1, with the POV on V2 switched off, corrected
the V2 clip instead. The panel matched Premiere's selection to the timeline clips by kind, start and end only; after Sync every
cut lines up on all tracks, so the V1 clip also selected the V2 clip at the same place (the log: "1 in the list, 2 selected
parts"), and an audio clip on A1 also selected A2 and A3. Every tool reads the selection this way (colour, Match POVs, Fix
audio, the audio splits, Subtitles, Rough cut, Sync), so all of them could take clips that were not selected. The selection is
now matched by track, name and time (`getTrackIndex`; without it by name and time, and the log says so); the log also marks
how each part was found and which are switched off. Colour (Auto color, White balance, Exposure, ±0.5, Match POVs) leaves a
switched-off clip alone and says so when it was the only one selected. Tests: `tests/selection.test.js` (fails on 0.9.99).

## 0.9.99 - Colour applies on the first click
The user, 2026-11-04: the apply buttons are not needed. Auto color, White balance and Exposure now measure and put the
correction into Lumetri in one press (high- and medium-confidence corrections; low confidence is still left alone), then the
frame check takes back what made the picture worse, and Before / after shows the change. Match POVs matches at once too; a
camera's button under the result matches to that camera instead. One Cmd/Ctrl+Z undoes a press, as before.

## 0.9.98 - Every spoken word kept, no scraps, closer English, word fixes learned, search on Enter
The user's review of 0.9.97 on the ReShape video (2026-11-04).
- A missing word after a cut: the media between the clips (retakes the editor cut out) was heard too, and the aligner put the
  clip's own „Затова“ on a retake 1.5 s earlier, outside the clip. That media is now silence for Whisper and the aligner (the
  context before the first and after the last clip stays: silencing it too lost „Когато“). On the ReShape video the only
  change is „Затова“ back; the first run of a recording reads it again (about 2 minutes), then the cache serves it.
- A scrap at a clip's edge that was not heard clearly (the final „На“, the start of a sentence the cut left out) is left out of
  the lines and listed for review, not shown.
- An adverb stays with its participle or adjective („Те са / патологично променени“, „просто наднормено тегло“).
- English: every line is also translated on its own, and its words pull the English cut ("the fat cells / aren't just bigger",
  "They're / pathologically altered", "Fluid retention / further increases"); plain words for the viewer ("adipose" -> "fat");
  the words an editor changes in an English line are learned for the client from the first fix ("lipidemia" -> "lipedema"),
  typing the old word back takes the fix out. About 17 s for the ReShape video's English (was 11). Tried and dropped: choosing
  among the translator's other sentences by the lines' own words (made other sentences worse), a stronger pull (3-4).
- The search in the Captions tab runs on Enter or Find, with Clear: filtering while typing hid most lines at the third
  letter, after which Premiere took the keyboard and the next keys went to the timeline.

## 0.9.97 - A new pair replaces the old one, lines wait for the cut, phrases stay whole, a better translator, search
The user's requests after the first learning test (2026-11-04).
- Apply and rebuild (and Subtitles pressed again) replaces Asistent's own earlier pair: after the new pair is placed, every line
  of the earlier Bulgarian and English tracks is removed in one step (one Undo). Only tracks Asistent placed and nobody changed
  (the remembered signature, read again just before); the emptied tracks stay, since no script can delete a caption track
  (right-click > Delete Track). The one exception to "never remove": tested in NEW TEST with the user's OK, 13 tracks of 60
  lines removed while ExtendScript ran the whole time, then the panel's own placement three times in a row, no crash.
- A line no longer appears before the cut it belongs to: the ReShape lead (0.18 s) showed the first line after a cut over the
  end of the previous shot and took the previous line off early (up to 0.17 s on the ReShape video). Every clip start is a cut.
- Lines keep phrases whole: an adjective stays with its noun („хронично заболяване“, „мастните клетки“, „съединителната
  тъкан“; found with the dictionary, `agreement.bond`), a line may end on „е“ when the next one holds such a pair („Това е /
  хронично заболяване“), „може да“ stays together; the ReShape style allows 25 characters (their own longest line), so
  „Задържането на течности“ is one line. On the ReShape video 8 cuts changed, all better; 12 Ludi Glavi runs unchanged.
- The English line uses NLLB-200 1.3B (about 1.4 GB, the user's OK): „просто с отслабване“ is "by just losing weight" (600M:
  "just by weakening"), „мастните клетки не са просто по-големи“ "the fat cells aren't just bigger" (600M had the meaning
  wrong). About twice the time (11 s for the ReShape video). A computer with only the 600M model keeps it until the bigger one
  is downloaded from the same button. An English line no longer ends on "not", "may", "does", "just" and the like. Tried and
  dropped: the previous sentence as context (both models often returned nothing).
- Captions tab: a search box over the lines, Bulgarian and English; the other lines are hidden, not dropped.

## 0.9.96 - Who speaks per track, agreement marks, the Learned list, measuring (the plan's phases 5-8)
- Captions tab, "Who speaks": per microphone track a man, a woman, or not set / both (per project, and the client's default
  for its next projects through the learning folder). First-person forms on a set track follow that person („съм свършил“
  -> „съм свършила“, „бях доволна“ -> „бях доволен“, also „Казала съм“), unless Whisper finds the changed word clearly worse
  for the sound (then it stays and is listed for review). Not set: only checked, as before. Tried on the Ludi Glavi
  recording: woman -> „свършила“ (score -4.5), man -> unchanged. A change here alone is enough for Apply and rebuild.
- An adjective that disagrees with the noun after it („нов стена“, „нова телефон“) is marked (yellow edge, review reason),
  never changed: an ending is one letter of sound, which the sound check cannot hear (Phase 0). Count forms, plurals in
  -ове, adverbs, participles and pronoun-like words are left out; on 19 saved runs no false mark is left.
- The Learned list under the caption lines (collapsed): every learned fix of the client, in use / waiting / removed, with
  Remove and Restore for everyone (an event that always counts after what the editor saw).
- Every use of a learned fix is recorded (once per project); `scripts/measure_learning.py report` shows uses against the
  ones typed back (target 98 %), `dry` what the rules would do to saved runs.

## 0.9.95 - Subtitles learn from the editors' fixes, shared through the office; Bulgarian writing rules
The Smart Subtitle Correction plan (2026-11-04), phases 0-4; the user's choices: learning runs in the background with nothing to
press, every editor's fixes help everyone through the office (no cloud), the office folder
`Production/ReShape/ReShape Subtitle Learning`.
- `learning.py`: every correction line that matched in a run (typed in the Captions tab or the corrections box), every name line
  and every typed English line is recorded once per project, with the words around it, into the client's learning folder (a
  folder whose name ends in "Subtitle Learning" inside the client folder, found by walking up from the project; a deep folder
  that Finder mounted as its own volume is traced back through `mount`). Each computer writes its own file; a failed write
  waits in an outbox. The next videos use what was learned: a name for the whole client from the first fix (and in Whisper's
  prompt), a word fix on the same computer at once and for everyone after two projects, other clients after three projects by
  two computers; a single dictionary word only between the words it was fixed between. Typing the original back undoes a
  learned fix for everyone and is never learned the other way round. The editor's own English lines are reused for the same
  Bulgarian line in the client's other projects.
- `audiocheck.py` + `asr.score_texts`: before a learned fix is used, Whisper reads the heard and the fixed words over the same
  sound; a fix scoring more than 8 lower is not used (it catches a different word, not a near-miss: measured on 26 fixes and
  the first real run, see the module). Results are kept per reading, so a rebuild does not check again.
- `bgnorm.py`: Bulgarian writing rules applied without asking (only how a said word is written): „не знам“ apart, „по-“/„най-“
  joined (also Whisper's own „по -пълни“), full or short article of masculine words by their place (after a preposition,
  sentence subject, after „това е“). The editor's fixed words are never touched. They run before the corrections, so a
  correction can be written from what the captions show.
- Fixed: a correction line written from the captions did not match when the dictionary had several repairs for the heard word
  (the ReShape run showed „месната“ for „масната“; „месната => мастната“ matched nothing). Every possible repair matches now.
- Tried end to end on the ReShape „Липедемата“ recording with a temporary learning folder: four fixes typed in one project
  (мастните, мастна, мастната, компрометира) were all used in a second project, scores -2.7 … -6.9; 25 s instead of 11 s.

## 0.9.94 - English lines in the Captions tab; tooltips never under a text box
- The user, 2026-11-04 (screenshots): "there is only a captions tab for the Bulgarian subtitles". With the English line on, every
  Bulgarian line in the Captions tab now has its English line under it ("EN"), editable. Apply and rebuild keeps a typed English
  line for its Bulgarian line as it reads after the rebuild (`english_fixed`, per project on this computer, sent with every run;
  the engine uses it wherever that Bulgarian line is unchanged; a changed Bulgarian line gets a new translation). Only English
  changed is enough to rebuild. Tried on the client reference 7698708: the typed line replaced the translation, all others same.
- The user: "the info is displayed weirdly on top of the captions". Text boxes are drawn by Premiere over everything, so the
  tooltip of "Apply and rebuild" sat under the caption lines. A tooltip that would cover a text box or dropdown now goes above
  its button.

## 0.9.93 - Every button acts on the press
- The user's screen recording 2026-11-04 10:26 (clicking the Tools / Log / Before-after tabs): clicks that did nothing were made
  with an arrow cursor instead of the hand, at any spot of a tab; the log has no click for them. As with Exposure ±0.5 (0.9.91,
  every press counted since), the first click after one of Premiere's own panels had the focus only took the focus back. Now
  every button, tab, link and Cancel acts when the mouse button goes down (`onTap`: pointerdown / mousedown / click, whichever
  comes first, once per press); the "panel just changed" guard stays for the normal buttons, Exposure ±0.5 and Cancel skip it.
  `onPress` is folded into `onTap`. The native dropdowns and checkboxes are Premiere's and unchanged.
- The toast moved from under the header (it covered the tabs for 3.5 s after every answer, and a tab clicked then hit the
  toast) to over the project name and engine line, which have nothing to click.

## 0.9.92 - A toast that reads as a message
- The user, 2026-11-04: "Where is the pop up message?" It was there (the screen recording shows it under the header), but in
  Premiere 26.0.2 the one-sided green border did not render, so it was a plain black bar that looked like part of the panel.
  Now it has a green face (red for a failure), bold 12 px text, and for Exposure ±0.5 plain words: "+0.5 exposure added ·
  fx31028.MP4 now +1.5" / "0.5 exposure removed · 3 clips" (`finish(..., { toast })`).

## 0.9.91 - Exposure ±0.5 act on the press
- The user's screen recording (2026-11-04 10:19, Masterhaus fx31028) next to the log: Effect Controls stayed at 0.0 and at 1.0
  for seconds while the user clicked, and no click reached the panel in that time (no "click" line at all); two quick clicks did.
  After each write Premiere puts the focus on its own panels, and the next click on Asistent only takes it back. So the Exposure
  buttons now act when the mouse button goes down (`onPress`: pointerdown / mousedown / click, whichever comes first, once per
  press; a click within 1 s of its own press is not counted again). The panel logs "focus lost" / "focus back", so the next try
  shows what Premiere delivers.
- The morning's three "Exposure 0 → -0.5" presses in a row (10:18:54-10:19:02) read 0 each time: the value read right after
  a write can be stale. Not changed yet: if it shows again with presses that do arrive, the step will be counted from the value
  Asistent last wrote.

## 0.9.90 - The answer as a toast
- The user, 2026-11-04: "a little pop up message when something is added or removed, somewhere visible but not taking much space,
  so we don't have to look at the bottom". Every answer (`finish()`) now also shows for 3.5 s (a failure 7 s) as a toast under the
  header, over the list, two lines at most, with a green or red edge; a click hides it. It floats (absolute, like the tooltips),
  so no button moves; the full answer stays at the bottom and in Log. Seen in the browser preview; not yet in Premiere.

## 0.9.89 - Exposure ±0.5 react to every click
- The user, 2026-11-04: "I have to click the +0,5 buttons multiple times before they work". The log (Masterhaus C0728, 10:10)
  shows every recorded press was written, but a quick second click was dropped by the "panel just changed" guard (700 ms after
  each answer; made for answers that used to appear at the top and move the buttons, which no longer happens), and a click during
  a write (~50 ms, panel greyed) was dropped too. Now the two Exposure buttons skip the guard (`onTap(..., { repeat: true })`),
  do not grey the panel, and a press that arrives during a write is added to the next write, so no click is lost. The answer shows
  the clip's new value ("Exposure +0.5 on 1 clip (now +1.5), one Undo step").
- The same log has two presses that started from 0 again (10:10:18, 10:10:32): the Exposure had been put back by Undo between
  them (each press is one Undo step); nothing in Asistent resets it.

## 0.9.88 - Exposure −0.5 / +0.5
- **Two buttons in the Color card** (the user, 2026-11-04: a robot video with no faces was underexposed and Exposure "didn't
  really do much"): Exposure −0.5 and Exposure +0.5 add that step to the Exposure slider of every selected clip at once, as an
  editor types it into Lumetri: no measuring, so they work without faces. Same Lumetri choice as Apply (a new one, a neutral
  one or Asistent's own; a hand grade is never touched, the clip is listed as not touched), recorded as Asistent's so Auto color
  can update it later. One Undo step (two when a Lumetri is added first). The answer lists each clip "Exposure +1.05 → +1.55".
- Why Exposure did little on those clips (log of 2026-11-03 18:04-18:07, RoboHubPro "Сервизен робот"): the first press proposed
  and applied +0.5 to +2 on most clips; fx30-2-1284 measured 0 (no faces: by the midtones), and the later presses read 0 because
  they measure the timeline with the earlier correction in it. The midtone estimate is a guess without faces; the buttons are
  the editor's way to finish it.
- Engine 424, panel 116 tests passing. Not pressed in Premiere yet (Premiere was closed).

## 0.9.87 - Updates from the panel; Windows install brought up to date
- **Updater** (the user, 2026-11-04: "install an updater so people don't need to download from GitHub every update"):
  `engine/asistent/updater.py` asks the GitHub releases for `latest.json` when the panel opens and every few hours (at most every
  6 h, only a GET to github.com). A newer version shows a line at the top of the panel with an **Update** button; the job
  downloads `Asistent-<version>.zip`, checks its SHA-256, refuses unsafe zip paths, installs Python packages only for a changed
  requirements file, puts the engine, host, fonts and panel in place and restarts the engine (Mac: the LaunchAgent restarts it
  after exit 75; Windows: a detached new engine waits for the port). The panel reloads during the update and the new one says
  "Updated to …" (`updates/last.json`, shown once). Tried end to end on this Mac with a local test release 0.9.88
  (`<app>/update_source.txt`): engine back on 0.9.88 within a second, Adobe lists the panel 0.9.88, then reinstalled 0.9.87.
- **Installed layout**: the engine now runs from `<app>/current` (a copy), no longer from the repo, so a computer needs only a
  release zip. `engine/asistent/install.py` does the placing for both systems: files, the host into the CEP folder (Mac
  `defaults`, Windows registry for PlayerDebugMode), Montserrat Bold into the user's fonts (Windows: per-user font + registry), the
  panel through UnifiedPluginInstallerAgent (`--install` on Mac, `/install` on Windows). `scripts/install_host_mac.sh` is gone.
- **Releases**: `scripts/build_release.py` makes `dist/Asistent-<version>.zip` (engine, host, scripts, fonts, requirements, licences,
  README, `.ccx`, `Install Asistent (Mac).command`, `Install Asistent (Windows).cmd` at the top) and `dist/latest.json`;
  `scripts/publish_release.sh` uploads them as release `v<version>` (only on the user's word, after commit and push).
- **Windows**: `setup_win.ps1` now matches the Mac: installs from the folder it is in, keeps the subtitle packages current where
  they exist, downloads the Bulgarian word list with `-Subtitles`, stops a running engine before replacing files, installs host,
  font and panel, Startup shortcut to `current\engine`. The host's log goes to `%LOCALAPPDATA%\Asistent\logs` like the engine's.
  Not run on Windows yet (no PowerShell on this Mac).
- **Translator download button** in the Subtitles card (about 620 MB, NLLB-200, only from the button, like the speech model),
  shown when English line is on and the translator is missing; `/subtitles/model` reports `translator`.
- Tests: `tests/test_updater.py` (12: version compare, offline check, damaged download refused, unsafe paths, the whole update
  into a private folder, requirement changes, the release zip's contents). Engine 424, panel 115, all passing.

## 0.9.86 - The ReShape style, measured on the client's own videos
- **Measured** (the user, 2026-11-04: "we need to recreate this style for this client"): six of the client's TikTok videos and the
  Instagram reference, 625 lines, read with the Mac's own text recognition (Apple Vision), faces with YuNet, speech with Asistent's
  own recognition (its word starts are 0.025 s after the sound onset, so usable as truth). Results in `docs/SUBTITLE_STYLE.md`:
  2-3 words a line, no punctuation, a capital only at a sentence start, each line 0.18 s before its first word with a ~4-frame
  fade-in; the height is kept per shot (79 of 90 changes at a cut) with the line's top 0.11 of the frame height under the chin.
- **Subtitles card: Style** Auto / ReShape (remembered on this computer). ReShape = preset `reshape` in `subtitles.py`: 2-3 words,
  no punctuation around words (inside stays: "360-градусово", "1,5"), lines start 0.18 s early even in continuous speech. With the
  English line on, the English gets no punctuation either, except a question's "?" (`translate.bare`); the translation now reads
  the words with their punctuation, so sentences are still found.
- **"ли" never starts a line, a short pronoun may end one after its noun or verb** (all styles): "и прави ли / такива операции",
  "бюста ви" (before: "и прави / ли такива операции"); after a function word it still goes with the verb ("ще ви покажа").
- Against the client's own line breaks: 72 % of Asistent's breaks are theirs and 70 % of theirs are Asistent's (71 / 69 % before);
  their remaining breaks follow the speaker's rhythm and 7.5 % end on "на", "да", "и", which Asistent never does on purpose.
  Engine tests 412, panel 115, all passing. Not pressed in Premiere yet.

## 0.9.82-0.9.85 - The English line (reference style); probes for the subtitle graphics
- **English line** (the user, 2026-11-04: the same number of lines and the same times as the Bulgarian, translating the same words
  and still making sense): `engine/asistent/translate.py` translates every Bulgarian sentence whole with the local NLLB-200 600M
  (int8, one sentence per call) and cuts the English into one piece per Bulgarian line: the model's attention (offset 0), a cut at
  matching punctuation, a length rule (each piece about as long as its line suggests) and no piece ending on "the", "of", "in"…
  (attention alone gave lone "the" / "an" lines). The subtitle job writes `<name>.en.srt` with the same times; the panel puts it on
  a second caption track. Subtitles card: checkbox "English line" (remembered on this computer). Without the translator the result
  says what is missing.
- Tried on the ReShape reference (68 s): 69 Bulgarian and 69 English lines, identical times, translation in 5.7 s; e.g. "Защо 360
  липосукцията / и оформяне / на цялата средна / част на тялото" -> "Why is 360 liposuction / and the shaping / of the entire middle /
  part of the body". Some pieces still lag by a word; wrong Bulgarian carries over ("везя" -> "weight"): correct the Bulgarian first.
  Both tracks placed in NEW TEST through the engine (69 + 69 items).
- The English style from the user's tool: Arial Pro Heavy, white, sentence case, 56 % height, box #551D1D at 63 % (docs/SUBTITLE_STYLE.md).
- Bridge probes (test projects only): `graphic_text` (UXP cannot read or write a Premiere text graphic's text), `graphic_move`
  (Motion > Position with `new PointF(x, y)` in one Undo step works).
- Tests: `tests/test_translate.py` (split rules; the real model when installed).

## 0.9.81 - Subtitles back on a caption track: restyle them all at once in Properties
- The user needs to select all subtitles and change font, outline, shadow and the rest in Premiere's Properties panel. Only Premiere's own captions and text graphics are edited together there; Asistent's After Effects template graphics (0.9.80) expose only their text, and Premiere's own text graphics cannot be created with words by a script (probed: ExtendScript reads their text as binary, there is no `executeCommand` for "Upgrade Caption to Graphic", and UXP has only `CaptionTrack`/`TextSegments`). So Subtitles puts a caption track again (as up to 0.9.79); the result tells how to restyle all captions and save a Track Style, and right-click > Upgrade Caption to Graphic turns them into real text graphics by hand.
- The graphics way stays as tested code, not used by the panel: `premiere-captions.placeGraphics`, engine `/captions/graphics`, host `as_graphics`, `scripts/caption_template.*`.
- Checked in NEW TEST: an SRT of 25 lines through the engine onto a caption track (subtitle format), read back with 25 items.

## 0.9.80 - Subtitles as text graphics (the user's choice 2026-11-04: text graphics, static lines)
- Every subtitle line is now an editable text graphic on a new video track "Asistent subtitles" at the top of the active sequence, instead of a caption track; the .srt is still written (folder Asistent_subtitles) and the Captions tab works as before (Apply and rebuild puts a new graphics track; delete the old one).
- **Template**: `scripts/caption_template.jsx` + `.sh` build Asistent's own subtitle templates in After Effects (a new empty project; refuses when After Effects has unsaved work): "Asistent Subtitle 9x16" (1080x1920, 74 px) and "Asistent Subtitle 16x9" (1920x1080, 58 px), Visuelt Pro Bold, white with a black outline, centred, lower part of the frame; one exposed field "Text". Built on first use by the engine (about a minute) into `<app>/templates`. Premiere's own templates cannot be used: their text reads back as binary through scripts (probed).
- **Placing** (`host.jsx` `as_graphics`, engine `POST /captions/graphics`, panel `premiere-captions.place`): a new top video track (QE `addTracks`), one `importMGT` per line at its start, trimmed to its end, the words written into "Text" (line breaks as After Effects wants them), scaled to the sequence (the template has its own size: 200 % in a 2160x3840 sequence). The template is picked by the subtitle preset (9:16 short lines, 16:9 two lines).
- **Tried in NEW TEST** (25 lines of an earlier run, through the engine endpoint): placed in 2.0 s (80 ms a line), all 25 read back with the same words and times within a frame. The Subtitles button itself was not pressed (the bridge cannot select clips in that sequence): user to try.
- Undo: each line is its own step in Premiere (ExtendScript has no transactions): the result says to delete the track instead.

## 0.9.74-0.9.79 - Speed finished and measured in Premiere; NEW TEST is a test project; bridge can select clips
- **NEW TEST.prproj** (Ludi Glavi/Projects) is a test project too (the user, 2026-11-04: use it for future tests, Claude may run them): the panel bridge and the host's `eval` accept `TEST.prproj` and `NEW TEST.prproj`, nothing else (test: a name that only ends in TEST is refused).
- **Colour frames from the file** (`color.read_frames`): the frames of a clip are decoded side by side and the colour-range probe is asked once per file. 15 Masterhaus clips 24.6 -> 19.7 s, the full result (previews included) identical to the HEAD code; more clip workers do not help (4K decoding fills the CPU), so 4 stay.
- **Skipped exports**: inside a batch a frame is waited for 5 s, then exported once more on its own (normal wait), instead of holding the batch for 20 s.
- **Measured in NEW TEST (24 clips, by the bridge)**: Auto color 23 s for the whole press (96 frames in ~12 s, one skipped export retried at once, engine 7.2 s; before: ~1.3 s of frames per clip, ~31 s for frames alone), Sync cameras 6.7 s in the engine (your last press on the same 24 clips: 11.2 s; same 10 groups, 4 unsynced).
- **Bridge `select` works** (Premiere 26.0.2): `TrackItemSelection.createEmptySelection(callback)` hands the selection to the callback, it is filled and set there, and `setSelection`'s promise is ignored (it rejects with "A nullptr was dereferenced" even when the clips were selected): the timeline read back is the answer. Video or audio alone worked three times in the first sequence; video and audio together did not, and after that attempt even video selected nothing in the SYNC sequence (open: TODO).

## 0.9.73 - Faster with many clips (user's request 2026-11-03)
Measured on the user's own presses and the Masterhaus/Ludi Glavi test footage; every change gives bit-identical results (compared against the HEAD code on real footage).
- **Sync cameras** (`sync.py`): each signal's FFT is computed once and reused for every channel pair (coarse search and window checks), and a window measured in the quick look is not measured again. 24 clips / 120 pairs: 10.2 -> 7.5 s (one thread 29 -> 18 s); the full result is byte-identical.
- **Probe cache** (`media.probe`): FFprobe answers kept by path, size and modification time for the engine's life; `media.probe_all` probes a job's files side by side.
- **Rough cut**: the dialogue items are decoded side by side (`dialoguemix.build_mix`, also used by Subtitles) and every file is probed up front. 38-item rough cut replay: 12.1 -> 2.8 s; cuts, takes and XML identical.
- **Color**: the analysis frames of all clips, and Apply's before/after/re-check frames, are queued in Premiere together and waited for together (`premiere-color.js` `exportFrames`, batches of 16; nothing on the timeline changes between them; the Lumetri probe still waits for each). Tried in TEST.prproj on 36 clips: 84 frames, all distinct and correct, but 3 were never written by Premiere and each held its batch for the 20 s wait (press 86 s, engine 39 s).

## 0.9.71-0.9.72 - Asistent draws its own buttons; the CSS probe measured in Premiere
- **CSS probe in Premiere 26.0.2 (TEST.prproj, 2026-11-03)**, after waiting for the layout (UXP lays a new element out a moment later; read at once every size was 0): works: flexbox, absolute position, variables, `calc`, `transform`, text ellipsis, width media queries, inline SVG, `:not`, `cursor`. Does not work: flex `gap`, grid, transitions, animations, `:focus-visible`, `matchMedia`; Premiere's `--uxp-host-*` colour variables are not defined (the panel always ran on its fallback colours). `<header>`/`<footer>` default to a centred flex row. An SVG outline comes only from CSS (a class or `style`), never from the `stroke` attribute. A `<button>` takes the panel's background in its style but Premiere draws its own grey face over it (36 px tall by default). Spectrum's built-in widgets (`sp-button`, `sp-picker`, …) exist.
- **Own buttons** (the user's choice of three, 2026-11-03): every button is a `div.btn` drawn by Asistent with the panel's colours (blue main buttons, quiet tabs and links, ⓘ). `enable()` sets `disabled` (read by `onTap`, which now ignores a press on a disabled button, and by the test bridge) and the `disabled` attribute (dims it). The bridge presses `button, .btn` (checked in TEST.prproj: Log and Tools pressed and logged). Ids, labels and tooltips unchanged.
- **Icons**: their lines come from one CSS rule (`svg.i …`), no attributes on the shapes.

## 0.9.69-0.9.70 - The new look fixed after the first look in Premiere (user's screenshot 2026-11-03)
- The top and bottom areas, the tabs and the status boxes are plain `div`s with their own direction: UXP had laid out `<header>`/`<footer>` as centred rows (the answer sat at the bottom right, the project line in the middle).
- Icons: every shape carries its own outline style (UXP does not pass `fill`/`stroke` from `<svg>` to its shapes, so they came out as filled dots and discs).
- Rough cut: Mode and Tempo each on their own row; "Safe" is marked selected (UXP showed an empty Mode box).
- The main buttons have no border: Premiere draws its own grey face for a `<button>` and the blue border stood outside its corners.
- `css_probe` also measures the default layout of each element, whether a button takes a background colour, how icons inherit their style, and a dropdown without a selection.

## 0.9.68 - A new look for the panel (user's request 2026-11-03: clean, compact, every feature kept)
- **Layout**: the project name and the connection stay at the top, the views scroll, and the progress (with Cancel) and the answer of the last run sit at the bottom. The answer no longer pushes the buttons down; **Hide** frees its space (it stays in Log). The header says `Connected · 0.9.68`, both versions only when the panel and the engine differ.
- **Feature cards**: icon, name and an ⓘ button per card. The description paragraph is behind the ⓘ (the same text, also in the tooltips), so the main controls are what you see: Sync, Rough cut (Mode, Tempo, Review markers), Audio (Manual ▸), Color (White balance, Exposure, Match POVs), Subtitles (corrections box, model download), Auto import. Whether an ⓘ is open is remembered on this computer. The whole Tools list is about 1,000 px tall at 300 px wide instead of about 2,400 px.
- **Developer**: the Lumetri probe moved from COLOR into a closed "Developer" card at the bottom (the user approved). Nothing was removed, renamed or merged; every button keeps its id, label and tooltip, and every press still goes through `onTap`.
- **Style**: every colour is a named token with its old value (`style.css` `:root`, checked pixel-identical before the layout changed); one button system (primary, secondary, quiet, link) with hover, press and disabled states; titles in sentence case instead of small capitals; option rows wrap at 240 px. Only CSS the panel already used in Premiere (flexbox, margins, borders, radius, opacity, absolute position, variables): no `gap`, grid, transitions, transforms or shadows.
- **Icons**: inline SVG (paths drawn after Lucide, ISC licence, no package). Whether UXP draws inline SVG is not yet measured: if not, the cards show an empty 16 px slot and PNG icons replace them.
- **CSS probe** (`panel/cssprobe.js`, `dev_cmd.py css_probe`, TEST.prproj only): measures on temporary elements which CSS this UXP really supports (flex gap, grid, transitions, transforms, shadows, inline SVG, media queries, Premiere's theme variables). Checked in Chrome; not yet run in Premiere.
- **Browser preview** (`preview/`, development only, never packed): the real panel markup, style and code with fake Premiere and engine modules and ten states (idle, offline, busy, done, error, log, color proposal, before/after, captions, options open); `node preview/shoot.js <label> --compare <earlier>` takes screenshots at 240/300/420 px with the Chrome on this computer (`playwright-core` 1.55.0, dev only) and reports the pixels that changed. `main.js` hands its view functions to the preview only when the preview page asks (never inside Premiere).
- Tests: 398 engine, 113 panel (the AUDIO block in `wiring.test.js` is found by its card id now).

## 0.9.67 - Subtitles: a caption editor; rough cut: muted audio is not used; rotated files described upright
- **Captions tab (SUBTITLES)**: after a subtitles run a hidden tab "Captions" appears with one field per line (time + text; lines holding an uncertain word have a yellow edge, edited lines a blue edge). Type a wrong word right and press **Apply and rebuild**: `panel/captionedit.js` turns each edit into the editor's correction lines (`heard => said`; the smallest changed stretch, anchored on a neighbouring word when a word was only added or removed or the changed word is 3 letters or less, two changes with one short word between are one phrase), adds them to the corrections box (saved per project, same line for the same heard words is replaced), and the job runs again: the recognised speech is cached, so it takes seconds, the new words are timed by the sound (forced alignment, as before) and the new set is placed on a NEW caption track (`place(..., {again: true})`); the result says to delete the old track (Asistent never removes anything). Matching ignores case and punctuation and also accepts the spelling shown in the captions.
- Why an editor and not a better recognition: tried on the 23 s GStroy clip (loudness normalisation, 90 Hz high-pass, beam 8): Whisper's wording changes at random with tiny audio changes ("Приведно", "Примерно", "Природа", "Прилно") and none of them fixed "трябваше да боядисам"; the three-reading vote already in place is the right tool, and a Bulgarian fine-tune (public ones are trained on read speech and are not in CTranslate2 format) would be a 3 GB download that needs the user's OK. Not changed.
- **Rough cut: muted audio is not used**: audio on a muted track (`track.isMuted()`) or a switched-off clip (`isDisabled()`) is left out of the cut and of the speech, as if deleted (the quiet camera microphone that left gaps); the result says it once per track. The panel logs once whether those two Premiere methods exist (unverified in 26.0.2; if they are missing the old behaviour stays and the workaround is to deselect or delete the track).
- **Rough cut: rotated files**: `media.MediaInfo.rotation` (the display-matrix flag, 90/270) and `xmeml` describes such a file by its displayed size (2160x3840 instead of 3840x2160). An unverified attempt at the sideways bug: if the picture still comes in sideways, the probe XMLs decide (TODO).
- Tests: 398 engine, 113 panel.

## 0.9.66 - The whole tool is in English (user's request 2026-11-03)
Every user-facing text is English now: the panel (buttons, tooltips, section titles, progress, results, errors), the engine's messages and reasons, the host's messages, the Undo step names, the script output and the README (rewritten and brought up to date: Fix audio with L/L and R/R copies and the limiter, the color buttons, Match POVs, Rough cut, Subtitles). What Asistent creates in Premiere has English names: the bin "Rough cut", sequences "ROUGH – <sequence> (safe|smart) vN", markers "Review", the subtitle bin "Subtitles", the test bin "Asistent test". Nothing made earlier depends on an old name (the L/R bin was already "Asistent L-R"), so older projects keep working.
- Button names: Синхронизирай камерите → Sync cameras · Груб монтаж → Rough cut (Внимателно/Умно → Safe/Smart, Спокойно/Нормално/Стегнато → Calm/Normal/Tight, Маркери за прегледа → Review markers) · Оправи звука → Fix audio (Ръчно → Manual: Split L/R, Split R/L, L only, R only, Level only, Even out phrases) · Авто цвят → Auto color, Бяло → White balance, Експозиция → Exposure, Изравни POV-тата → Match POVs, Приложи сигурните / и средните → Apply the sure ones / the medium ones too, Приложи изравняването → Apply the match · Субтитри (български) → Subtitles (Bulgarian), Свали модела → Download the model · Следи Downloads → Watch Downloads · Инструменти / Дневник / Преди / след / Отказ / Подробности → Tools / Log / Before / after / Cancel / Details.
- Unchanged on purpose: the Bulgarian language data of the subtitles and the take finder (spelling, dictionary, numbers, filler words, month and money words) and the importer's Bulgarian folder keywords ("музика", "ефекти"); the example in the corrections box stays Bulgarian because the subtitles are Bulgarian.
- Result fields renamed with the texts: `kind_bg` → `kind_label` (takes), `tempo_bg` → `tempo_label`; the colour check no longer sends `clipping_message_bg` (the panel shows `clipping_message`).
- Fixed on the way: the Match POVs confidence read the anchor from the basis text; "the white/grey surfaces" contains "face", so it now matches whole words.
- `scripts/setup_win.ps1` is plain ASCII now (Windows PowerShell 5.1 reads non-ASCII scripts wrongly without a BOM).
- Tests: 396 engine, 102 panel, assertions moved to the English texts. Not yet seen in Premiere.

## 0.9.65 - ГРУБ МОНТАЖ: repeated takes are cut, the last full take stays (user's test 2026-11-03)
The user's test of 0.9.64: three clips with the same line said slightly differently, "it kept all 3". The run file showed the group was found (three takes, the last recommended) but 0.9.64 only listed it, and marked it as "said differently" because of one extra sentence.
- **Cut, in both modes**: for a plain repeat everything from the first take up to the winning take goes in one piece when only short setup talk is said between the takes (sentences of at most 8 words, at most 25 s: „Добре, готови?“, „Тихо“); otherwise each losing take goes alone; a take that broke off after the winner goes too. The cut starts at the breath or rustle before the first take (never before the previous word) and stops 0.15 s before the winner's first sound (`pauses.take_edges`, `pauses.with_takes`). A start repeated inside a sentence is cut only in Умно. A group said differently (a number, or more content words than max(2, a quarter of the winner's)) is only listed, as before.
- **Better takes**: a take that begins in the middle of the passage gets its opening back when it was said in other words („Вижте тези чини! Ако са под 700 евро, ги взимаме.“ against „Виж тази чиния. Ако е под 700 евро, да я взимаме.“: loose matching where alike words count as the same word). Words said a little differently („вижте“/„виж“, „тези“/„тази“) are no longer counted as lost content. The ring of links between the end of one take and the start of the next is broken at the longest pause, so the passage keeps its order.
- Replayed on the user's test (9 items, Внимателно/Спокойно): 73.8 s → 12.4 s; kept „Може и още. Отдала е свободно.“ and the last take of the plate scene; the two earlier takes and the setup talk between them (52 s) are gone. The result text says per group which take stayed and how many seconds went.
- Tests: 20 in `test_takes.py`, the job test now checks the losing take is cut and the winner whole. Not yet pressed in Premiere.
- Found, not fixed: vertical footage stored as 3840×2160 with a rotation flag (Sony, `rotation=90`) comes into the new sequence sideways; the XML describes the file as landscape. Probe XMLs are ready, the fix needs TEST.prproj (BUGS.md).

## 0.9.64 - ГРУБ МОНТАЖ: repeated takes and false starts are found and listed (Phase 8 M3, first half)
- New `engine/asistent/takes.py` (difflib on the recognised words, no new download): sentences (end mark, pause over 0.5 s, comma plus pause over 0.25 s); each sentence is compared with the next 12 sentences within 90 s: `exact`, `near` (ratio 0.75, length ratio 0.6-1.6), `false_start` (a short or unfinished start said again within 20 s, or a take that breaks off after a good one) and `restart` (the same 2-4 words twice inside the talk with only a filler or a pause between). Sentences under 3 words are never matched. Matched sentences are grouped and chained into whole passages, so a scene said three times is ONE group with three takes, even when one take has an extra sentence in the middle. The recommended take is the editor's rule (the last full one); a group whose other takes say content words the winner lacks (more than 2, or any number) is marked as different text, not a plain repeat.
- Nothing is cut for a repeat in either mode (the choice of the take and Умно's cutting are M4). The result lists each group: where it lands in the NEW sequence, kind, number of takes, the recommended one and its text; with "Маркери за прегледа" ticked each group also gets a marker. `result.takes`, `counts.takes`, run JSON.
- Run on the real words of the Ludi Glavi test (281 words): the "700 евро" plate scene is found as one group of three takes with the last one recommended; the price line said with 200 and 300 euro is marked as different text.
- Tests: `tests/test_takes.py` (13), a job test, a panel text test. Not yet pressed in Premiere.

## 0.9.63 - ГРУБ МОНТАЖ: fewer cuts, holes in a camera's row (third test, 2026-11-03)
The user's third test (48 items, two POVs, 388 s): "different types of gaps", "very fast cuts for no reason". Read from the run file: no hole in the picture as a whole (the union of the cameras was continuous) but holes of 0.4-2 s in ONE camera's row while the other kept playing, and kept pieces of 0.7-1.3 s between two trims.
- **Jump cuts**: `pauses._no_jump_cuts`: where two cuts leave a kept piece shorter than `MIN_SHOT` = 1.5 s, the smaller pause cut is not made (the pause stays), so the shots join. Внимателно now touches only pauses longer than 2.0 s (Спокойно) / 1.5 s (Нормално) / 1.2 s (Стегнато) (was 1.2 / 0.8 / 0.8) and makes no pause cut under 0.5 s (Умно 0.25 s). Same selection: 45 → 32 cuts, shortest kept piece 0.1 s → 1.57 s.
- **Holes in one camera's row** (`pauses._close_track_holes`): the part of a hole between two clips of one track that no cut takes out is cut from every track when nobody speaks in it. Where somebody does (the last word of the line is spoken on the other camera's microphone after this camera's clip ended: 204.7-205.0 s in the user's run) the hole stays and its seconds are said in the result (`hole_speech_s`). Cutting it would cut speech; that is the user's decision (asked).
- Tests: 25 in `test_roughcut.py`. Not yet pressed in Premiere.

## 0.9.62 - ГРУБ МОНТАЖ: the last 1-2 frame gaps between clips
- Cause (read from the user's run files: holes of 1 and 2 frames between item0→1 and item2→3 on the main track, cut ended at 58.025 s, clip starts at 58.058 s): `pauses.guard` was applied to the whole cut list, including the empty time between two clips. The 10 ms frame that holds the clip's first 8 ms is voiced, so the guard stopped the cut one frame short. The guard now protects only pause cuts (inside `plan`), the empty time and the time with no selected sound are cut exactly to the clip edges.
- Checked on the user's last selection in three modes (Внимателно/Спокойно, Умно/Нормално, Внимателно/Стегнато): no hole under one second on any track. Tests: 23 in `test_roughcut.py`. Not yet pressed in Premiere.

## 0.9.61 - ГРУБ МОНТАЖ: little gaps between clips, chopped clip ends (second test, 2026-11-03)
- **1-2 frame gaps between clips**: the Whisper word padding (0.04 s before a word) reached over the edge of a clip into the empty time before it, and the final guard kept those frames, so the closed gap stopped 1-2 frames short (cut ended at 58.01 s, the clip starts at 58.058 s). Nothing is "word" or "voiced" where no sound clip covers the time any more, and the cuts are put back on the frame grid after the guard.
- **Fast cuts at the end of clips**: the silence after a clip's last word held islands of breath that split it into several cuts with small kept pieces between. The end of a clip is now handled as a stretch of its own: the picture keeps `TAIL_OUT` = 0.8 s after the last word (the user's "let it breathe"), then everything after it goes in ONE cut, islands included (nobody speaks after it). A kept piece of pure pause between two cuts shorter than 0.6 s (was 0.3) is merged. A piece of 15 frames or less (a flash) of an item that goes on elsewhere is dropped (`edl.drop_flashes`): 5 frames of the second camera at the end of its clip were a flash on the timeline; a short piece that nothing longer covers is kept (a short word is a shot).
- Not ours: 1-2 frame holes that the SOURCE sequence already had (the user ran the rough cut on the output of the faulty 0.9.59 run, "ГРУБ – SYNC – ГРУБ – SYNC"). Run it on the original SYNC sequence.
- Tests: 22 in `test_roughcut.py`. Not yet pressed in Premiere.

## 0.9.60 - ГРУБ МОНТАЖ: the user's first test (2026-11-03) fixed
Four findings from pressing the button on the user's TEST sequence (data read from the `Asistent_roughcut/*.json` of those runs):
- **Time with no selected sound stayed in** (34 s of cam2's picture before cam1's first words; the empty timeline between two recordings stayed as a 0.35-0.45 s hole on every track, so the next shot did not follow). Now the speech map spans the whole selection and `pauses.plan(sound, present)` takes out whole: time no selected sound clip covers (nobody is known to speak) and time no item covers (an empty gap). The pause budget applies only inside the sound. The levels (floor, voice) are read only from the covered sound: zeros of the uncovered time had dragged the speech threshold down. The result says how many seconds went for each reason.
- **Many cuts at the end for nothing**: the last two seconds were four cuts with 0.1 s slivers of breath between them. Cuts separated by a kept piece under 0.3 s that holds no word or voiced sound are merged (`_merge_slivers`), and a pause cut under 0.25 s is not made (`MIN_CUT`; was 3 frames).
- **Effects were lost** ("Оправи звука" first, then „Груб монтаж“): the new sequence is built from the media, so nothing on the old clips came with it. Now carried over: the L/L / R/R split (a clip named "… L …" / "… R …" reads source channel 1 / 2 on both exploded sides in the XML, which is what Audio Channels does), the Volume level (XML Audio Levels, read back and set again through Volume when the import did not take it), Dynamics → Limiter −6 dB (put on the new pieces after the import by the same code as „Оправи звука“, `noLimiter` skips it for clips that had none) and the Lumetri values Exposure/Temperature/Tint/Contrast/Saturation (`premiere-color.copyLumetri`; a correction that was Asistent's own is recorded as its own again). Not carried and SAID in the result: any other effect by name, keyframed levels, a hand grade's other settings.
- **Multiple clips with two POVs** use the same rules (the gap between recordings is closed on both cameras, the next shot follows).
- Tests: 369 pytest (4 new), 101 node (2 new). **Not yet pressed in Premiere**: the effect carry-over is new code (Premiere API) and has only been checked statically.

## 0.9.59 - ГРУБ МОНТАЖ (Phase 8, M0-M2): pauses cut into a new sequence, source untouched
- **M0 probes in TEST.prproj** (details in `docs/ROUGHCUT_PLAN.md`, decision in `DECISIONS.md`): the engine-written FCP7 XML imports through UXP `project.importFiles` with no dialog, frame exact, V/A linked, camera offset intact, Cyrillic markers from `<marker>` work, `setPlayerPosition` exists.
- **Engine**: `vad.py` (Silero v6 from faster-whisper's own ONNX, a veto on cutting), `speechmap.py` (a label per 10 ms: WORD / VOICED / LOW / SILENT, cutcheck's energy rule), `pauses.py` (pause budget by tempo and sentence end, cuts only SILENT frames, edges snapped INWARD to the frame grid, a final guard that never lets a cut cover a WORD or VOICED frame), `edl.py` (kept ranges in sequence time, the same cuts for every selected item, so the cameras stay in sync), `xmeml.py` (port of autoedit's writer, any tracks, links by media range, optional markers), `roughcut_job.py` + `POST /roughcut`. Words come from the same cached Whisper readings as the subtitles; without the speech model the pauses come from the energy and Silero and the result says so. Output: `<project>/Asistent_roughcut/ГРУБ – <seq> (<mode>) vN.xml/.json`, every press a new version.
- **Panel**: card ГРУБ МОНТАЖ (Режим Внимателно/Умно, Темпо, optional review markers, one button), `roughcutplan.js` (pure), `premiere-roughcut.js` (reads only; imports the XML into bin „Груб монтаж“, finds the sequence, checks pieces per track and the length against the engine's list, opens it). Nothing is removed, muted or trimmed in the source sequence.
- **Not in yet** (said in the panel): repeated takes and false starts (M3/M4), the review list view. Effects (Lumetri, volume, L/R split) are not carried into the new sequence: run it before colour and sound.
- Real footage (Masterhaus fx31028 + C0728, numbers only): 56.06 s → 51.18 s in Внимателно/Нормално, 10 cuts, 65 words, 4 voiced-without-word places listed, 41 s (cold, three Whisper windows).
- Tests: 365 pytest (15 new), 99 node (7 new). **Not yet pressed in Premiere** (the bridge refused: a client project was open).

## 0.9.58 - ЦВЯТ: separate Бяло / Експозиция buttons, Авто цвят, „Изравни POV-тата“ in one clear card
- **Nothing in the colour engine changed** (no `engine/` file is touched except the version string; Lumetri writes, thresholds, targets and the render check are the 0.9.57 code). Only the panel's buttons are reorganised.
- **Авто цвят** is the former „Бяло и експозиция“ button, unchanged: one analysis, the suggestion with before/after, then „Приложи сигурните“ / „Приложи и средните“.
- **Бяло** and **Експозиция** run the same analysis and the same apply path, and only narrow the plans (`plansFor(..., only)`): Бяло plans Temperature/Tint, Експозиция plans Exposure. With no part the function returns exactly what it returned before (a test keeps the 0.9.57 function as the reference and compares all confidence combinations). The audit log gets a `part` field.
- **Контраст and Наситеност get no single-clip button on purpose**: the single-clip engine has no contrast or saturation algorithm (`color.py`: "never contrast, saturation or LUTs"); they exist only inside Shot Match, relative to a reference camera, and stay there. Inventing a single-clip algorithm was ruled out by the request.
- **„Изравни POV-тата“** is the existing Auto Shot Match under its new name, a button in the same ЦВЯТ card (no sub-section): it already works after the corrections (the clip's current Lumetri values are simulated on the source, then absolute values are fitted to the reference camera), keeps everything outside the components it changes, never touches a hand-made Lumetri, matches exposure, white, contrast and saturation, supports several clips, lets the user pick the reference camera and checks the result on Premiere's own frame (worse parts are put back). No algorithm was changed.
- Tests: node 92 (6 new: part filter, Auto Color equivalence, wiring of the new buttons, no contrast/saturation button).

## 0.9.57 - „Оправи звука“: the two speakers balanced by speech loudness, Dynamics → Limiter −6 dB
- **Balance** (`audio.balance`): after the L/L and R/R split the two sides' gated BS.1770 loudness (the level of the active speech, not a peak match) is compared; when they are more than 2 dB apart (`BALANCE_TOL`, request field `balance_db`) only the LOUDER side is lowered, by at most 12 dB, so nothing is lifted and no noise is amplified. A channel that carries nobody of its own (its share of frames ≥ 10 dB above the other is under 10 %: the far copy of one voice, room bleed) is not matched to anything and is not lifted above its source level. Identical channels or a stereo mic: untouched. The sum of both sides stays under −6 dB (existing rule, applied after the balance); the existing noise cap and ±30 dB still apply. Measured on Masterhaus C0731: 5.4 dB apart → 2.0 dB. Stale "Вдигнато само с…" notes are dropped when a later rule changes the gain.
- **Limiter**: every levelled clip gets Premiere's native Dynamics with only Limiter on and its Threshold at −6 dB (`Limiter Enabled` 1, `Limiter Threshold` 0.9: the parameters are normalised, value = (dB + 60) / 60; the default −1 dB is 0.98333, as the user's video shows). An existing untouched Dynamics is reused (only the limiter is switched on), one that is already Limiter −6 dB is left as it is (second press: no duplicates), and a Dynamics with somebody else's settings (other processors on, another limiter threshold, several Dynamics) is not touched and said. The effect is appended in the same step as the levels, its limiter is switched on in the next (a new effect has no parameters before it is applied) and read back; a failed read-back is reported as a problem. Two Undo steps for levels + limiter.
- **Limitation, said in the panel**: the user's video puts the limiter on the Mix (master) track. No script API reaches it in Premiere 26.0.2 (QE has only Audio 1-N, the sequence has no master track, `audioTracks[N]` is empty), so the limiter is per clip and the combined peak of the two sides is held under −6 dB by the gains themselves.
- Host: an Asistent bin clip whose name does not say L or R is refused with a message instead of being skipped silently. Test bridge: `audio_chain` (all effect parameters of audio clips, read only) and `audio_fx_add` (one effect on one clip).
- Verified in TEST.prproj (Premiere 26.0.2): one new clip (L/L + R/R, one Dynamics each, parameters read back: Limiter Enabled 1, Threshold 0.9, AutoGate/Compressor/Expander 0), second press (no new effect, "лимитерът е вече на −6 dB"), four clips at once (eight sides, one Dynamics each).

## 0.9.56 - „Оправи звука“: L/L and R/R through the clips' own Audio Channels, no Fill effects
- The one button now does what the user's reference video shows: the audio is duplicated onto the track below, the upper clip plays only the Left source channel (L/L), the lower one only the Right (R/R) (Modify Clip > Audio Channels), all linked to the video again. The Fill Left/Right effects are never added any more (a Fill that is already on a clip from earlier versions is left alone: only its level changes).
- How (no API sets the channels of a clip on the timeline): the host (`host.jsx` `as_audio_route`, command `audio_route`, endpoint `/audio/route`) makes an audio-only subclip per media range and side in the bin „Asistent L-R“ (`createSubClip`), sets its source mapping (`getAudioChannelMapping` + `setMappingForChannel` + `setAudioChannelMapping`; `audioChannelsType` is read-only), overwrites the original audio with the L/L copy and puts the R/R copy on the nearest free track below, checks both sit exactly where the original was with the same In point, and links video + both sides (`linkSelection`). Nothing is removed or muted by script.
- Every stereo clip is split (`split_all`; the user splits even clips the analysis calls one voice on two mics); the analysis only informs and sets the two levels, whose sum stays under −6 dB. A mono file is left alone. A selected video clip brings its own audio.
- Second press: sides are recognised by name („C0731 L 6.37-13.78“) and in the bin, so no new copies or subclips are made; both sides are measured as a pair and get the same levels again. No free track below: refused with the instruction to add one.
- The panel's levels are one Undo step; the splitting is separate Premiere steps (said in the result).
- `host.jsx` now starts with a UTF-8 BOM (`$.evalFile` read it as Mac Roman and Cyrillic messages came out garbled).
- Verified in TEST.prproj (Premiere 26.0.2) on Masterhaus clips: single clip, three clips at once (R/R copy of a clip whose A2 was taken went to a free track), repeat press (no duplicates, bin unchanged), clips placed to the tick with the same In point, 3 linked parts; the user confirmed in Modify Clip > Audio Channels: A1 L/L, A2 R/R.

## 0.9.55 - panel: sections, tooltips, report and pictures in their own views
- Every feature is a card: title, one line saying what it does, then its buttons (СИНХРОН, ЗВУК, ЦВЯТ, СУБТИТРИ, АВТО ВНАСЯНЕ). The manual audio variants are folded under „Ръчно ▸“; nothing was removed.
- Tooltips on every button (UXP shows nothing for `title`): shown after a short hover under the button, above it near the bottom edge, always inside the panel; hidden on leave, press or scroll. Buttons made in code get one through `button(cls, label, help, fn)` (a test checks every button in the HTML and in main.js).
- Three views: „Инструменти“ (actions), „Дневник“ (the full report of the last run plus the last 10 results; a badge counts its warnings, red on an error) and „Преди / след“ (the before/after pictures of „Бяло и експозиция“ and „Изравни камерите“, with the Приложи buttons above them). The main view keeps only the progress, the one-line result, the decisions (Приложи…, the Shot Match reference) and links to the two views. Starting a run returns to „Инструменти“.
- `[hidden]` always wins over a row's display, so folded rows stay folded.

## 0.9.54 - SYNC: fewer false „несигурно“, every decision explained
- Cause found on the Masterhaus shoot (two pairs „Възможно, но несигурно“, like the user's fx39059/C9052 +2.273 s): every window found a strong, real peak, but they spread over 11-18 ms, and a window counted only within 5 ms of the line. Two POVs metres apart hear each speaker over a different path difference (1 ms = 34 cm), so speech from different places gives slightly different offsets; there is no single exact one.
- New High rule for scattered windows (`sync.py`: `_band_cluster`, `LOOSE_BAND` 20 ms): at least 4 windows and 80 % of all (and of the informative) windows strong and inside one 20 ms band, median peak ratio >= 1.3, no second candidate, and the spread must not be a clock drift (`_drifting`: a straight line over >= 60 s stays refused). The offset is the band's median (error under 10 ms). The quick look before the full check accepts such candidates too.
- The cameras' clocks as a second witness (`groups._clock_check`): a scattered-rule pair whose learnt-clock times disagree by > 10 s is vetoed (same line from another take); an uncertain pair (no drift, no second offset) whose recording times agree with the audio within 2 s becomes High. Raw clocks may confirm (two clips only, as in the user's case) but never veto.
- Results: Masterhaus 7 → 10 synced pairs (fx31030/C0730 +2.208 s, fx31036/C0740 +6.952 s by the band rule, C0741/fx31037 +9.955 s by the clocks); learnt clocks agree with all 10 audio offsets within 0.8 s. GStroy 16x9 11 groups (+2 by the band rule, clock-consistent within 1.4 s like its strict pairs). GStroy 9x16 unchanged (10 groups); unrelated takes, drift and repeated sounds still never High.
- Panel: an uncertain pair now shows its reason; an accepted pair that needed the band rule or the clocks says so under its group.
- Premiere's own Synchronize cannot be called: neither UXP nor ExtendScript exposes it.

## 0.9.53 - SYNC: everything in recording order, also clips without a partner
- Clips without a second POV were placed after all groups. Now groups and single clips are laid out in one list in the order they were recorded (user's example: A 10:00, A+B 10:05, A 10:15 stays in that order).
- Recording time: the engine reads each file's `creation_time` (Sony writes the record start; equal to the XML sidecar), else the file time minus the duration (`media.probe`: `recorded`, `recorded_from`).
- Camera clocks: `chrono.py` learns each camera's clock difference from the synced pairs (median; reported when the pairs disagree by more than 3 s) and corrects all clips of that camera, the unsynced ones too. GStroy footage: the FX30 clock is 731 days behind the FX3's; 12 pair measurements agree within 2.1 s; the 6 lone clips now sit between the groups where they were recorded.
- Nothing is invented: a camera that never synced keeps its own clock only when it falls within 30 min of the session (reported as unchecked); a clip without any usable time keeps its place from the editor's timeline (follows its neighbour there) and is listed as „Несигурно място“ in the panel.
- Panel: groups are listed in the order of the new sequence; a corrected camera clock is named; unsynced clips are no longer described as „сложени накрая“.

## 0.9.52 - SYNC: no markers in the new sequence
- „Синхронизирай камерите“ no longer writes the „Група N“ / „Без синхрон“ markers into the new `SYNC – …` sequence (user, 2026-11-03: the timeline must stay clean). They were labels only; the clips are placed from the engine's offsets, so nothing about the sync changes. The group list stays in the panel's result. The user's own sequence and its markers were never touched and still are not.
- Tests: the Bulgarian dictionary loader (`lexicon.py`) now collects the files spylls 0.1.7 leaves open; their ResourceWarning used to fail whichever test was running at that moment under `-W error` (5 random failures).
- Numbering: 0.9.49-0.9.51 are skipped because a panel build labelled 0.9.51 that is not in this repository was seen on another computer; the next real version is 0.9.52 so the two can never be confused.

## 0.9.48 - subtitles: 5 times faster, numbers aligned, the Bulgarian transcription guide built in
- Speed (C9025, 8 pieces, 49.6 s of speech: **230 s → 45 s** from a cold cache): one Whisper reading per stretch of a source file with 4 s of context around the pieces and the windows of nearby pieces merged (91 s of audio read instead of 252 s); several windows read at the same time (`asr.workers()`: 5 readings × 2 threads on the M4 Max; one reading with 10 threads was SLOWER than with 4); alignment and checking run per window in parallel; the second opinion uses a cheaper decode.
- Words: unknown words are repaired by the smallest edit that gives exactly one dictionary word (`lexicon.repair`: reduced vowel, dropped vowel as „одяло“ → „одеяло“, two vowel edits „одялоце“ → „одеялце“, one letter „Взиваме“ → „Взимаме“ when the recording says „взимаме“ elsewhere); diminutives the dictionary lacks are accepted by their stem; „евро“ is known. Every repair is listed in the result.
- Second opinion: a piece that still has an unknown word (or a first-person „съм …л/ла“ form) is read again alone with 2 s of context; the reading with fewer doubts wins (C9025: „е одял, Острова“ became „одеяло струва“).
- Numbers: every number is given to the aligner as spoken Bulgarian (`numbers.py`: 500 → петстотин), and the aligner's confidence no longer discards a time (the confidence is no sign of a wrong word); only a word squeezed into too little time is distrusted. The words after prices were 0.3-0.5 s late before; now median 0.00 s.
- Review (guide §5, §7, §11): a month name in a conversation about prices, a word with no speech-like sound under it (the hallucinated „Така.“ was stretched over 1.3 s of breath), a gender-form disagreement between readings: each is marked „?“ with its reason in the panel; nothing is rewritten.
- Text: „5 ,79“ → „5,79“ (`subtitles.tidy_words`), a comma closes an „Ако …“ clause when Whisper wrote none; words stay inside their clip („Ах,“ no longer starts 0.6 s before it).
- Voiced sound without a word (the guide's first/last seconds check) is listed with its time: C9025 had two such places (0.26-0.91 s and 12.25-12.82 s); the panel says „чуй“.
- Results keep an immutable `verbatim` layer and an `edits` log next to the final words.
- `docs/BULGARIAN_TRANSCRIPTION_GUIDE.md` added as the permanent reference and linked from CLAUDE.md; its §10 table is `tests/test_guide_regressions.py`.
- Tests: 329 pytest + 70 node.

## 0.9.47 - subtitles: no speaker setting, captions clear sooner
- Tested large-v2 as a second opinion on the four real pieces: fixes „неща" but breaks „Примерно на мен", „то и за градината" and the end phrase is worse; not used, test model deleted.
- Removed the Мъж / Жена / Авто setting and `gender.py` (user: most clips have both speakers, so a gender rule would rewrite correctly spoken forms). Every form stays as heard; a form the readings disagree on is marked „?“.
- A caption now clears 0.15 s after its last word (was 0.3 s); the rule against a blank screen under 0.2 s between captions is unchanged. Measured on the real clip: captions that switched late/early by 80-120 ms are listed in `PROJECT_STATUS.md`.
- Tests: 280 pytest + 70 node.

## 0.9.46 - subtitles: corrections that re-time, speaker gender, silence trim
- Corrections and names: new box in СУБТИТРИ (per project, kept by the engine). `чуто => казано` replaces the heard words BEFORE the alignment, so the new words are placed by the sound, not copied over old times (`corrections.py`); a line without `=>` is a name/term for Whisper's prompt. The result says which corrections matched and warns about one that found nothing or cannot be read. Lines can be written from what the captions show (the by-ear respelling is matched too).
- (Removed in 0.9.47) Speaker (Авто / Мъж / Жена): first-person past forms after „съм“/„бях“ („свършила“ → „свършил“) are set to the speaker's gender, only to a form the dictionary knows (`gender.py`). Авто decides only from the forms heard in all readings (at least two votes, two to one); pitch was measured and rejected (150-258 Hz within one clip).
- Timing: a weak word is fitted between its aligned neighbours (no overlap); a word is not spoken in silence, so a start or end inside silence moves to where the voice is (`align.trim_silence`; thresholds follow the recording). „Ей,“ was 0.26 s early.
- Tested against Whisper's own times and stable-ts 2.19 on 13 words after a pause: median error -0.41 s / -0.10 s / +0.04 s (MMS_FA), within 80 ms 0 / 5 / 11 of 13. MMS_FA stays; after the silence trim 13 of 14 words are within 80 ms.
- Premiere cannot delete a caption track from any API (UXP: no; ExtendScript: only `createCaptionTrack`; QE removes only video/audio tracks), so a second press still refuses to stack a second set and says what to delete.
- `scripts/check_subtitles.py` checks a finished run against the audio (speech without a word, onset errors, captions over silence).
- Tests: 283 pytest + 70 node.

## 0.9.45 - subtitles: one press puts them on the timeline; alignment on; word check
- Placement: after the SRT is made, the panel puts it on a caption track of the active sequence. UXP cannot (probed again on 26.0.2: `Sequence` has no `createCaptionTrack`), so a new invisible CEP extension, the Asistent host (`host/`, installed by `scripts/install_host_mac.sh`, needs ONE Premiere restart), runs ExtendScript `createCaptionTrack`. Engine: `hostbridge.py`, `/host/poll`, `/host/result`, `/captions/place`, `captionstate.py`. The panel verifies the result (new track, item count, first/last time) and says where the captions are. A second press with an Asistent track still on the sequence does not stack a second one: it tells the editor to delete that track (Asistent never removes or mutes tracks). Not verified in Premiere yet.
- Missing first word: Whisper's early word starts pushed „Имаш“ out of the piece at a cut. With alignment installed the word is placed by the sound (energy trace confirms speech at 0.02-0.28 s) and kept.
- Timing: MMS_FA alignment is now installed and on (59 of 65 words aligned, 6 weak keep Whisper times); on „Добре,“ the aligned start is on the real onset (1.13 s; Whisper said 0.88 s, 0.25 s early in silence).
- Words: each piece is read three times with 0.7 s, 2 s and 4 s of surrounding sound (`consensus.py`); a word is replaced only when two readings agree AND the Bulgarian dictionary (`lexicon.py`, Hunspell bg_BG through `spylls`) knows the new word and not the old one; disagreement or an unknown word Whisper doubts is marked „?“ and the panel lists the words with their times. Voting without the dictionary turned „градината“ into „градвината“, so it never replaces on its own.
- Spelling by ear: Bulgarian reduces unstressed vowels (е heard as и, о as у, а as ъ), so Whisper wrote „нища“ for „неща“. An unknown word Whisper doubts that is exactly one swapped vowel (those pairs) away from ONE real word is respelled to it (`lexicon.respell`); several or no candidates: it stays and is reported. On the cached transcripts only „нища“ is touched.
- Verified in Premiere (user, TEST.prproj, 23:47): the host loaded after the restart, 25 captions went onto caption track C2 in one press, panel check found no problems; timing „a lot better“.
- A blank screen shorter than 0.2 s between two captions is bridged (no blink).
- Host check commands for development: `scripts/dev_cmd.py host ping|probe|captions|eval`, `host_status`.
- Tests: 269 pytest + 68 node.

## 0.9.44 - subtitles: per-piece recognition, optional alignment, natural phrases
- Words: each piece is recognised on its own with 2 s of real media around it (the joined mix of cut pieces gave „и аз да видим“, „Приведно на мен“; per piece gives „я да видим“, „Примерно на мен“).
- Timing: optional word alignment (MMS_FA, as in the 4a1a autoedit workflow) in its own environment; Whisper's raw word starts are early by a median 0.12 s. Off until installed (`scripts/setup_mac.sh --align`); the weights are CC-BY-NC 4.0, see LICENSES.md. The panel result says which timing was used.
- Grouping (short preset): phrases of 2-3 words by pauses, punctuation and grammar (no caption ends on a preposition, conjunction or particle; no sentence end inside a caption); one-frame lead, no blinking in continuous speech.
- Tests: 249 pytest + 60 node.

## 0.9.43 - subtitles: the cleanest microphone is recognised
- Fix: wrong words came from noisy, quiet camera-mic copies chosen only because they were on the lowest track. The engine now treats items that overlap and follow the same loudness envelope as duplicates and keeps the cleanest one (speech level over noise floor); speech the winner does not cover is kept from the weaker copy. The panel sends every eligible item; the result lists which copy replaced which.
- Result JSON now keeps the request items for reproduction.
- Tests: 234 pytest + 59 node (duplicate choice with synthetic microphones, partial overlap, different speakers, tie → lowest track).

## 0.9.42 - Phase 7 M3: dialogue mix, /subtitles job, СУБТИТРИ section
- Engine: `dialoguemix.py` (selected audio items as one 16 kHz mono signal at sequence time), `subtitle_job.py` and `POST /subtitles` (Whisper words cached by mix + prompt; captions per preset; SRT + JSON written to `<project folder>/Asistent_subtitles/`).
- Panel: section „СУБТИТРИ“ with „Субтитри (български)“; pure `subtitleplan.js` (duplicate audio on a higher track is skipped and named); the model download starts only from its own button that names the size.
- Verified end to end on a real Bulgarian clip through the live engine (2.8x real time) and by the user in Premiere (34 captions from 4 selected items, 4 duplicates skipped, frame size read, SRT written next to the project).
- Tests: 228 pytest + 60 node.

## Docs and workflow (earlier today)
- Docs: `NEXT_STEPS.md` is now `TODO.md`, `BUGS_AND_LIMITATIONS.md` is now `BUGS.md` (history preserved by `git mv`); added `CHANGELOG.md`, `docs/INDEX.md`, repo-local snapshot of the dev workflow and agents, extended `.gitignore`, a pre-commit documentation check.

## 0.9.41 - Phase 7 M2: speech recognition
- faster-whisper large-v3, local only, model downloaded after the user confirms; about 2.8x real time on the Mac.

## 0.9.40 - Phase 7 M1: subtitle text core
- `bgtext.py` (Bulgarian spelling), `subtitles.py` (line breaking, presets, frame snap, SRT with BOM). Not wired to the panel yet.

## 0.9.38-0.9.39 - Phase 7 plan and probes
- `docs/SUBTITLES_PLAN.md`; M0 probes. Verified in Premiere: Cyrillic SRT imports correctly with and without BOM.

## 0.9.33-0.9.37 - faces in "Цвят", test bridge
- Single-clip exposure uses detected faces; guard against unseen renders; Premiere test bridge (`devbridge`, only in TEST.prproj).

## 0.9.28-0.9.32 - Auto Shot Match
- Anchors (skin, neutrals, tones), measured Lumetri models, absolute idempotent fit, reference choice, flags, render check and revert.
- Skin measured only on faces found by the YuNet detector. Verified by the user on the GStroy pairs.

## 0.9.24-0.9.27 - ownership, statuses, audit log
- Managed correction ownership (fingerprints in `managed.json`; a manual Lumetri grade is never touched). Statuses and `color_audit.jsonl` per clip and press; accept/revert of parts that got worse. Verified in Premiere.

## 0.9.17-0.9.23 - colour check refinements
- Soft tolerance for final highlight clipping; colour analysis on timeline renders (480 px); one failing clip never stops the others; "Приложи и средните" counted per correction.

## 0.9.13-0.9.16 - exposure curve and step-back
- Probe verified (Temperature/Tint as channel gains, Exposure shoulder curve); Exposure in Lumetri units from the probe; clipping step-back measured from frames (verified: 4.4 % to 3.08 %).

## 0.9.9-0.9.12 - fixes
- Volume level always in Premiere's scale; only the audio buttons start "Оправи звука"; frame export works again (name must end in `.png`); presses ignored while the panel moves.

## 0.9.1-0.9.8 - panel and colour probe
- Results at the top of the panel, clearer colour result, exported frames found, section titles, clip level capped at +15 dB, sync reports which files it saw selected, selection read by list OR `getIsSelected`.

## 0.9.0 - Lumetri capability probe
- First step of the colour engine spec (`COLOR_CORRECTION_PLAN.md`).

## 0.8.0 - Phase 6: white balance and exposure
- Preview first, then apply Exposure/Temperature/Tint in Lumetri; Phase 5 (client profiles) started and later postponed.

## 0.7.1 - Phases 1-4
- UXP panel and Python engine; Smart Auto Sync (new `SYNC – <sequence>`); lavalier audio (Fill L/R, split copies, Volume level, phrase leveling, main mic peak at most -6 dBFS); auto import from watched folders.
