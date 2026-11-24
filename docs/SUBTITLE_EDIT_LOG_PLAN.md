> Status (2026-11-24): Step 1 built in 0.10.155, not installed; Steps 2-4 open. TODO SAL.

# Asistent: subtitles learn from what the editor does in Premiere (TODO SAL)

## Context
Today Asistent learns only from fixes typed in its own Captions tab, so the editor has to pick the mistakes by hand
("not conventional"). The real corrections happen in Premiere's Text panel after the captions are placed, and Asistent
never sees them. The user's idea, in three parts: (1) log which subtitle settings are used most, (2) learn from the
words fixed in Premiere's Text panel, (3) log the lines the editor splits, because two sentences or two intonation
phrases sometimes land on one caption. Goal: all of it is logged with nothing to press, and the counts show what to
improve next.

What makes it possible (found in the code):
- The saved `.prproj` holds every caption line's text and times; `prcaptions.read(path)` returns them per sequence guid
  (0.10.150). `transcript.premiere_lines` / `match_track` / `edited_words` already find Asistent's track and diff words.
- `captionstate.get(project, "guid:<guid>")` gives the placed pair's record with `srt`; the run's `.json` next to it has
  `captions`, `words` (times, `p`), `preset`, `max_words`, `case`, `line_break`.
- The panel already reacts to a finished export: `main.js` `exportEvents.listen` → `learnFromExport()` (colour).
- Why lines merge today (`subtitles.py`): a break comes only from punctuation and the gap between words. In the phrase
  styles a sentence end inside a caption is a cost (`inner_sentence_end` 4.0), not a rule, and two phrases with no
  punctuation and a gap under 0.12 s have delivery strength 0. No pitch / intonation signal exists in the engine.

## Fine-tuning of the idea
- **Settings**: every run is logged; for "most used" the LAST run of a sequence counts (so trying options does not
  count five times). Kept per client. The log also keeps the original choice (`auto` and what it became) and the English
  switch, which the run JSON does not hold today.
- **Word fixes** (the user, 2026-11-24: "if I fix something one time it shouldn't auto fix it afterwards; clock whenever
  I fix the same thing multiple times and keep in mind the rest"): only a replaced word group of 1-3 words counts as a
  recognition fix. Every fix is counted per client. Three levels:
  - seen in 1-2 videos = **remembered**: listed with its count, changes nothing in the text;
  - seen in 3 different videos (not 3 times in one video) = **repeated**: it becomes a suggestion in the recap (below),
    never applied by itself;
  - **approved** in the recap = handed to the existing learning, which then applies it with its sound check and the
    Learned list to take it out; typing the old word back resets it;
  - deleted or added sentences are a rewrite, not a mistake: counted, never learned.
  `REPEATED_VIDEOS = 3` is one constant, easy to change after real use.
- **Recap every few days** (the user, 2026-11-24: "a recap on this every few days, check what we corrected the most and
  from there approve if we want to fix it"): nothing learned from Premiere edits is switched on without the user's yes.
  Every `RECAP_DAYS = 3` days with something new, the Captions tab shows a Recap card: what was corrected most since the
  last recap (word fixes, splits by cause, settings), each repeated word fix with **Fix it from now on** / **Not now** /
  **Never** (Never hides that pair for good). Split causes are shown as counts with the proposed rule; a yes there
  starts Step 4 for that rule, it does not change splitting on the spot.
- **Splits**: every split is logged with what the engine saw at that point (punctuation, gap in seconds, delivery
  strength, style), so the counts say WHY it was merged. Merges, deleted lines and moved start / end times are logged
  the same way. Nothing in line splitting changes from the log alone: a rule changes only after a replay on the logged
  splits shows it is better, and never for ReShape.
- **When**: at a finished export (the version the editor is happy with), and when Export transcript is pressed. The
  panel saves the open project first (the user's yes, 2026-11-24; the same `premiere.maybe(project, "save")` Export
  transcript uses), so the latest Text panel fixes are in the file. A later export of the same sequence replaces the
  earlier record.

## Design

### Step 1. The log (engine, silent) — new module `engine/asistent/editlog.py`
No ReShape-guarded file is changed (`subtitles.py`, `subtitle_job.py`, `learning.py`, `captionstate.py`,
`captionedit.js` stay as they are; only their public functions are called).
- `compare(project) -> list[record]`: `prcaptions.read(project)`; for each sequence, `captionstate.get(project,
  "guid:" + guid)`; no record = not Asistent's captions, skip. Load the run JSON (`srt` → `.json`), pick the track with
  `transcript.match_track` (threshold `TRACK_MATCH`), then align placed captions to Premiere lines by time overlap:
  - `split`: one placed caption → 2+ lines; record the word index of each cut and, from the run's `words`, the gap, the
    punctuation before the cut, and `subtitles._delivery` strength there (read only);
  - `merge`: 2+ placed captions → one line; `deleted`; `retime` (start / end moved by more than one frame, with the delta);
  - `words`: `difflib` opcodes on normalised words (reuse `transcript._norm`): `replace` of 1-3 words → a fix pair with
    left / right context; inserts and deletes → counts only.
- Storage, like colour learning: `<app>/learning/subtitles/<client>.jsonl`, client from `learning.find_folder(project)`
  (else `local`). One record per project id + sequence guid; reading keeps the newest per key. Nothing new is written
  to the office server.
- **A journal of everything in subtitles** (the user, 2026-11-24: "log everything we do inside subtitles, from
  generating to settings to corrections to times corrected, everything"). The same file is an append-only journal, one
  line per event with time, computer, project id, sequence guid and client. Every event is kept (the counts decide what
  to read: for "most used settings" the last run of a sequence, for the rest all of them):
  - `run`: every Make subtitles press, also reruns: the settings as chosen (`preset` incl. `auto` and what it became,
    `max_words`, `case`, `line_break`, `colour`, `english`), recognition profile / recogniser, number of clips and
    seconds of speech, `counts`, `timing`, `asr_seconds`, `cached`, captions made, doubtful lines (`review`), learned
    fixes used / refused, corrections-box pairs and terms, `again` (a rebuild from the Captions tab) or a new reading,
    and failures / cancels with the reason. Written in `server.py` around the `/subtitles` job (`_start_subtitles`), so
    guarded `subtitle_job.py` is not touched;
  - `placed`: the pair placed in Premiere (lines, English track or not, old pair replaced);
  - `caption_apply`: Captions tab Apply and rebuild: the pairs typed, how many lines changed;
  - `speakers`, `learned_remove` / `learned_restore`, `transcript` (with how many lines were changed in Premiere): in
    their existing `server.py` endpoints;
  - `move_off_faces`: a press, lines moved / left / no free place (the panel posts it);
  - `compare`: the export-time comparison above, with per-kind counts, every single change, and the minutes between
    `placed` and the export (how long the fixing took);
  - `recap_seen`, `decision` (approved / later / never).
  One generic `POST /subtitles/editlog/event {project, sequence, kind, data}` for the panel-side events (kinds from a
  fixed list, unknown ones refused); logging never blocks or fails a job (errors go to `engine.log` only).
  No audio, no frames, no file contents: words, numbers and settings only; local to this computer.
- Endpoints in `server.py`: `POST /subtitles/editlog/compare {project}` (queued in the background like
  `colorlearn.queue_export`), `GET /subtitles/editlog?project=` (the counts for the panel).
- Panel `main.js`: in the `kind === "complete"` branch next to `learnFromExport()`, and at the end of `onTranscript()`,
  call `engine.editlogCompare(project.path)`. Throttled like `learnFromExport`.

### Step 2. Repeated word fixes into the existing learning
`editlog.counts(client)` groups the fix pairs by `learning.rule_key(heard, said)` and counts distinct videos (project id
+ sequence guid). A pair below `REPEATED_VIDEOS` stays in the log only; at 3 videos it is offered in the recap. The
user's answers are kept in `<app>/learning/subtitles/<client>.decisions.json` (`approved` / `later` / `never`, with the
date; `later` comes back in the next recap). On **Fix it from now on** (`POST /subtitles/editlog/decide {project, key,
action}`): build the pair's `contexts` (`{heard, said, left, right, example}`) from the logged videos and write its
`fix` events through `learning.plan_for` + `learning.record`, one per logged video, so the existing trust rules see the
three projects and switch it on; every further video with that fix records it too (deterministic ids: repeated exports
do not count twice). A fix typed in the Captions tab keeps today's rules (it is a
deliberate instruction). Typing the old word back is a `revert`, as now. Never from tests or development scripts into a
real client folder (temp folder / scratch `HOME`).
Later option (touches guarded `subtitle_job.py`, so golden check + DECISIONS): a remembered fix (1-2 videos) marks the
word in "Lines to check" the next time it is heard, without changing it.

### Step 3. Recap card and "What you fix most" in the Captions tab
- Recap card (shown when `RECAP_DAYS` passed since the last one and there is something new; a small dot on the Captions
  tab until opened; "Recap now" opens it any time): since the last recap, the top word fixes with counts and the three
  buttons on the repeated ones, splits by cause ("sentence end inside a line: 14", "no pause, no punctuation: 9", "after
  a comma: 3"), merges, average retime, most used settings. Closing it stores the recap date
  (`GET /subtitles/editlog/recap?project=`, `POST /subtitles/editlog/recap/seen`).
- A collapsed all-time list under Learned with the same sections, including the remembered (1-2 videos) fixes.
- Pure module `panel/editlogplan.js` (what is due, what each row says; node-tested), drawn in `main.js` next to
  `renderLearned`. Needs the user's look in Premiere after a restart.

### Step 4. Better splitting, measured (after the log has real data)
- `scripts/split_replay.py` (like `placement_replay.py`): rebuilds the captions of every logged run with a candidate
  rule and scores it against the editor's logged splits and merges (hit / miss / new wrong splits). Also usable now on
  the benchmark's `refs/<id>.chunks.json` (the editors' burned-in chunks, which exist but are not scored).
- Candidates, each behind a new preset key so ReShape and `standard` are untouched: (a) a sentence end inside a caption
  becomes a hard break in the delivery styles; (b) a higher `inner` cost; (c) an audio cue at the boundary (pitch fall /
  energy dip from the 10 ms envelope) as an experiment only.
- A rule ships only when the replay is better and `scripts/reshape_golden.py check` is identical; DECISIONS entry.
- Later, with the user's yes: pre-select a client's most used settings in a new project.

## Files
- New: `engine/asistent/editlog.py`, `panel/editlogplan.js` (+ zip list in `scripts/package_ccx.sh`),
  `scripts/split_replay.py`, `tests/test_editlog.py`, `tests/editlogplan.test.js`, `docs/features/subtitle-edit-log.md`
  (+ row in `docs/INDEX.md`).
- Changed: `engine/asistent/server.py` (3 endpoints), `panel/engine.js`, `panel/main.js` (export hook, transcript hook,
  settings call after `recordCaptions`, the list), `panel/index.html`, `panel/style.css`; docs per the definition of done.
- Step 4 only: `engine/asistent/subtitles.py` (guarded: golden check + DECISIONS).

## Verification
- `tests/test_editlog.py`: synthetic run JSON + fake `prcaptions.read` output: a split at a sentence end, a split with
  no punctuation, a merge, a deleted line, a retime, a 1-word fix, a rewritten sentence (counted, not learned), a
  sequence with no record (skipped), a second export replacing the first; a pair in 3 videos is offered and writes NO
  learning event until approved, `never` hides it, `later` returns; the recap is due after 3 days only with something
  new; every journal kind is written once per action (run, rerun, failed run, placed, apply, speakers, learned toggle,
  move off faces, transcript, compare), an unknown kind is refused, a journal write error never fails the job; learning
  written only to a temp folder.
- Full pytest with a scratch `HOME`, `node --test tests/*.test.js`, `scripts/reshape_golden.py check` (steps 1-3 touch
  no guarded file, so it must be identical).
- Bridge in NEW TEST: make subtitles, change a word and split a line through a saved copy, fire the export hook
  (`devbridge` already calls `learnFromExport(true)` / `exportDone`), read `GET /subtitles/editlog`: one fix, one split
  with its gap and cause.
- The user: one real client video; after export, the Captions tab list shows what was fixed.

## Order
Step 1 → 2 → 3 as one release each (version bump, tests, `release_mac.sh`, docs, commit). Step 4 only after a few
real videos are logged. Before building: ask the user whether to use the extension agents.
