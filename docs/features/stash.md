# Stash

## What it does
Motion tab > Keyframer page, section Stash. It saves a clip's animation (the ticked properties) or a group of clips (a
logo over its background, a title with its sound) and puts it back at the playhead later, in any project. An animation
stash keeps the easing exactly. A clips stash keeps the clips with every effect, Motion and keyframe.

## How to use it
1. Animation: "Read the selected clip", tick properties, press "Save animation".
2. Clips: select clips in the timeline (several tracks are fine), press "Save selected clips".
3. To use one: park the playhead where the animation or the clips should start. For an animation, the target clip is
   selected and the playhead is over it. Press the stash's button in the list.
4. The "Show" filter lists stashes by the client of the project they were saved in. A cross, pressed twice, deletes one.
5. One Undo step per press. A clips stash takes two (the copies, then the link between a clip and its sound).

## Key points: do not break
- Never over the editor's work. A property whose time already holds a key of the editor's is not written; an effect
  the target lacks is not added (it is listed); keys past the clip's end are cut (0.10.37).
- A clips stash goes in only where tracks are free: the same tracks, else the whole group moves up (video) or down
  (audio) up to 12 tracks, adding tracks on top by QE `addTracks` when needed. A copy never covers or cuts a clip,
  because overwrite would remove the editor's clips (DECISIONS 2026-11-11).
- Asistent deletes nothing in the project. The stash sequences ("Stash - <name> <id>") and anything imported stay in the
  bin "Asistent stash"; the editor may delete the bin. Deleting a stash in the panel removes only its folder on disk.
- The host function `as_stash_export` refuses any sequence not named "Stash - ..." and an existing project file.
- Easing is stored as one sample per frame (up to 3000) with the editor's keys marked, so Undo last and new curves still
  work on an applied stash. Keys the Keyframer baked on the source count as easing, not as the editor's keys.
- Stash data lives in `<app>/stash/` (outside the project and the repo), so it survives panel updates. A stash file is
  capped at 2,000,000 bytes (`stash.py` `MAX_BYTES`); a clips stash is at most 60 clips.

## Decisions
- Stash sequences are kept, not deleted, and a stash never overwrites: DECISIONS 2026-11-11 ("Stash clips keeps its sequences").
- Animation stash is plain data (no Premiere object), by the plan in `../COCKPIT_PLAN.md` A2. No DECISIONS heading of its own.

## Code map
- Panel pure: `panel/stashplan.js` `capture`, `place`, `captureClips`, `fitClips`, `linkGroups` (node-tested).
- Panel Premiere: `panel/premiere-stash.js` `capture`, `apply`, `saveClips`, `applyClips`, `STASH_BIN`; UI in
  `panel/keyframer.js` (stash rows, store key `asistent.stash.profile`); client calls `stashList`, `stashGet` in `panel/engine.js`.
- Engine: `engine/asistent/stash.py` `save`, `get`, `delete`, `rename`, `begin_clips`; endpoints `/stash/list|get|save|delete|rename`
  and `/stash/clips/begin|export` in `server.py`.
- Host: `host/host.jsx` `as_stash_export` (Sequence.exportAsProject into `<app>/stash/clips/<id>/`), `as_add_tracks`.

## Status
- Since 0.10.37 (animations) and 0.10.50 (clips). Current build 0.10.120.
- Tried in Premiere 26.5.2 through the test bridge (NEW TEST and TEST.prproj): exact values, Undo last, overwrite guard,
  playhead check, the same chain on a second project's import, linked clips, tracks added. NOT tried by the user.
  Latest status lines: PROJECT_STATUS 0.10.50 and 0.10.37.
- Windows: untested (not installed or run there; TODO W).
- Missing by design or open: no thumbnail, no rename in the panel (the engine has `/stash/rename`), no sharing through
  the office (TODO CP A2, waiting for EL0). Not measured: a sped-up source clip (TODO CP leftovers).
- BUGS.md has no entry for Stash.

## Tests
- `tests/stashplan.test.js` capture, place, free-track fit, linking.
- `tests/test_stash.py` the engine's store: save, get, delete, rename, clips folder.
