# Subtitle edit log

## What it does
A silent local journal of everything that happens to subtitles, and at a finished export a comparison of the captions
Asistent placed with the caption lines the editor left in the saved project (splits, merges, deleted and added lines,
retimes, word fixes). The editor presses nothing new. Nothing is shown and nothing is learned or applied yet: the counts
decide what to improve (Steps 2-4 in [SUBTITLE_EDIT_LOG_PLAN.md](../SUBTITLE_EDIT_LOG_PLAN.md), TODO SAL).

## How to use it
1. Nothing to press. Every Make subtitles press is journalled (settings as chosen and as resolved, counts, failures).
2. Edit the captions in Premiere's Text panel as usual; the placed, Move off faces and speaker events are logged where they happen.
3. Export (the finished version). The panel asks the engine whether the project holds Asistent captions; if so it saves the
   open project and queues the comparison. Export transcript does the same for the project it saved itself.
4. The summary is read at `GET /subtitles/editlog?project=...` (counts, most used settings, word-fix pairs with the number of
   videos, splits by cause). Nothing in the panel reads it yet.

## Key points: do not break
- Silent: nothing in the panel, no learning, no change to any caption. A journal error never fails a job (logged only).
- Words, numbers and settings only: no audio, frames or file contents. The project is stored as its id, never its path.
- Local only: `<app>/learning/subtitles/<client>.jsonl`. Nothing on the office server, nothing in a "Subtitle Learning" folder.
- The user's decisions (2026-11-24): log everything in subtitles; Asistent may save the project at a finished export to read
  the Text panel's fixes; a fix seen once is never applied by itself; splitting rules change only after a replay on the logged splits.
- The comparison reads the project (`prcaptions.read`) and never writes to it. Saving is the only write, and only at export.
- ReShape is frozen: no guarded file changed; `scripts/reshape_golden.py check` identical.
- Unknown event kinds are refused (`KINDS`); the panel may post only `placed` and `move_off_faces`.
- The compared track is chosen by word likeness to the placed captions only, never by a track index (the record's index
  and the saved project's numbering are not the same thing). Below `LIKENESS_FLOOR` (0.25) the result is `no_track`.
- The save at export happens only when Asistent has a caption record for the project (`/subtitles/editlog/has`).

## Decisions
- DECISIONS 2026-11-24: learning comes from what the editor does in Premiere, with nothing to select; log everything;
  save at a finished export; a fix is counted until it repeats in 3 videos and is approved; splitting rules replayed first.

## Code map
- Engine: `editlog.py` (journal `log_event`, `run_data`, `apply_data`, `compare` / `compare_sequence` / `_components` /
  `_cuts` / `_word_changes`, `compare_now`, `has_record`, the background queue `queue_compare`, `summary`).
- Engine endpoints in `server.py`: GET `/subtitles/editlog`, GET `/subtitles/editlog/has`, POST `/subtitles/editlog/compare`,
  POST `/subtitles/editlog/event`; `log_run` around the `/subtitles` job, `caption_apply` on rebuild.
- Panel: `main.js` `editlogCompare` (called after an export and Export transcript, throttled 20 s; while a press runs only the save is skipped),
  `editlogPost` for `placed` and `move_off_faces`; `engine.js` `editlogCompare`, `editlogHas`, `editlog`, `editlogEvent`;
  `devbridge.js` `editlog_compare` (development).
- Reads from: `captionstate.py` (the record), the run's `.json` next to the `.srt`, `prcaptions.py`, `learning.py` (client, ids),
  `transcript.py` (matching, words), `subtitles.py` (`_delivery`).

## Status
- Since 0.10.155 (2026-11-24): built, not installed. Outside Premiere only: Python suite and Node tests green, one real project
  read (55 captions to 55 lines, no changes). Not verified in Premiere: the save at a finished export, a read-only or locked
  project, the export event firing the comparison, the placed and Move off faces entries. Windows: untested.
- Known limit: with the Bulgarian track gone or mostly deleted, a short clip of brand names and numbers can pass the
  likeness floor on its English track and give wrong fix pairs (Step 2 still needs 3 videos and the user's yes).
- Known limit: a comparison is only as good as the saved project; an unsaved export compares the file on disk (`saved` marks it).
- Open: TODO SAL (USER and bridge checks; Steps 2-4).

## Tests
- `tests/test_editlog.py` (26 tests): journal and refusals, run data, the comparison (splits and causes, merges, deleted,
  added, retimes, word fixes and caps, no_run, no_track, equal comparison not repeated), summary, has_record, queue.
- `tests/test_server.py`: the four endpoints and the 400 for an unknown panel kind.
- Node: the panel side is covered by the existing `tests/*.test.js` runs (640 passed); the export hook is bridge-only.
