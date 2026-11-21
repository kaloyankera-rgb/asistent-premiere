# Before export: Check export

## What it does
The "Before export" row on the Tools tab, button Check export. It looks over the whole open sequence before you export and
lists what is wrong, with times. Parts: offline media, black gaps and flash frames, video and photo clips whose picture does
not fill the frame (under-scaled B-roll), text outside the safe area and caption lines that overlap, microphone clips
peaking above -6 dBFS, and missing fonts (always "?"). It only reads; the one thing it can write is markers, on request.

## How to use it
1. Open the finished sequence (no selection needed). If you set an In and Out, only that range is checked.
2. Press Check export. Each part shows a mark: ✓ measured and fine, ! to look at, ? Premiere does not let a script see it.
3. A line with a time is a link: click it and the playhead goes there. Times use Premiere's timecode (drop frame at 29.97 / 59.94).
4. "Put N markers on the timeline" adds one marker per problem ("Check: ..." with the problem as comment) in one Undo step;
   pressed again it adds only the missing ones.

## Key points: do not break
- Read only. The sequence is never changed except by the markers button (one Undo step, no duplicates).
- A green line must never claim more than was measured: parts that cannot be read say "?" (fonts, caption positions, Scale
  to Frame Size when Premiere cannot read it, track faders, Audio Gain and effects on sound).
- Mic rule: dialogue never above -6 dBFS (`MIC_CEILING`). Each clip is measured on its file in the range it uses (true peak,
  4x oversampled, `/export/peaks`) plus the highest Volume it reaches. Only the channel a clip plays counts when known (Fix audio
  L / R copies by name, Fill effects); otherwise the louder channel, which can only over-warn. Camera and microphone tracks
  (`tracknames.js`) use -6; other tracks only warn near 0 dBFS (`CLIP_DB` = -1).
- Safe area (`SAFE`): 9:16 text centre x 0.06-0.86, y 0.10-0.80 (apps' buttons and caption area), other frames title safe 90 %.
  Caption track positions cannot be read, so only overlaps are checked.
- Black gaps: switched-off clips, hidden tracks and adjustment layers show nothing. A SYNC sequence is only noted ("a working
  sequence, not for export"). Sound running on after the last picture is said as such.
- Picture fills the frame (`panel/coverage.js`): geometry from Motion (Position, Scale, Rotation, Anchor Point, Crop or the Crop
  effect) at the clip's start, end and every keyframe, against the file's real frame (`/export/frames`: size, rotation, alpha).
  Any strip over 0.5 px counts. PNG / PSD / SVG / GIF logos, transparent files, graphics, adjustment layers and switched-off
  clips are skipped; a Transform effect is noted, not measured.
- Needs the engine running (peaks and frame sizes). A clip with no file or no sound is listed as not measured.

## Decisions
- Per-clip measuring and saying what it cannot see: DECISIONS 2026-11-10 ("the pre-export check measures per clip").
- Picture-fills-frame, markers, timecode, In / Out and the tail of sound: user's requests 2026-11-11, CHANGELOG 0.10.44 and 0.10.45-0.10.47 (no DECISIONS entry).

## Code map
- Panel: `panel/exportcheck.js` (pure: `report`, `gaps`, `span`, `overlaps`, `unsafe`, `loud`, `markers`, `afterSections`);
  `panel/coverage.js` (pure: `gap`, `check`); `panel/premiere-exportcheck.js` (touches Premiere: `gather`, `seek`, `addMarkers`,
  `textCentre`, `volumeDb`, `exportedSequence`); `panel/main.js` `onExportCheck`; markup `secCheck`, `checkExport`.
- Engine: `engine/asistent/exportcheck.py` (`peaks`, `frames`); `server.py` `POST /export/peaks` (job), `POST /export/frames`.
- Host: none.

## Status
- Since: 0.10.35 (offline, black, safe area, mic), 0.10.44 (fills the frame), 0.10.45-0.10.47 (timecode, links, markers, In / Out).
  Latest line: the row was renamed Check export in 0.10.59; no later change recorded.
- Mac: verified through the bridge in Premiere 26.5.2 (levels against FFmpeg, safe area, SYNC gaps; coverage with scale, anchor,
  crop, rotation, scale keys within a pixel). Not seen live: offline media, caption overlaps. The user has not tried it on own
  B-roll (TODO FILL "USER").
- Windows: untested.
- Open: the report names only a clip's first problem moment (TODO FILL); thin edge strips of any colour are only checked after
  export (TODO FILL); the user's check "what it missed or flagged wrongly" (TODO I12).

## Tests
- `tests/exportcheck.test.js` (the report, gaps, overlaps, safe area, loudness, markers), `tests/coverage.test.js` (geometry).
- `tests/test_exportcheck.py` (peaks only in the used range and per channel, the frames endpoint).
- `premiere-exportcheck.js` and `onExportCheck` have no node test (checked through the bridge only).
