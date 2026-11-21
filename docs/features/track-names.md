# Track names

## What it does
The Track names row ("Name tracks", Tools > Run). It names the tracks of the open sequence: each camera POV 1,
POV 2 in track order, its sound "POV 1 audio" (a second track of the same camera "POV 1 audio 2", the L/R split),
a recorder or lavalier "Mic 1", Asistent's own subtitle tracks "Subtitles BG" / "Subtitles EN". Optionally it gives
each camera's files a label colour.

## How to use it
1. Open the sequence (no selection needed) and press Name tracks. The result lists what was renamed and what was kept.
2. Names the editor typed are kept; B-roll, graphics and adjustment-layer tracks are left alone.
3. Options under the arrow: "Also after Sync and rough cut" (on by default) names the new SYNC and NO SILENCE
   sequences at once, and after a Fix audio press that made second sides; POV 1 colour and POV 2 colour (Keep by default).
4. Put names back returns the names and colours from before Asistent's first press, only where they are still as it
   left them. One Cmd/Ctrl+Z also takes a press back.

## Key points: do not break
- Only Premiere's default names ("Video 3", "Audio 2", "Subtitle") and Asistent's own earlier names (`OURS`) are
  changed. A name the editor typed is never overwritten (0.10.34).
- A video track is a camera when at least 80 % of its files share one folder (`MAIN`) and that folder's sound is on an
  audio track. Real sequences have a stray file on a camera track, and Fix audio's copies are new files in the camera's
  folder, so a plain "one folder" test failed in NEW TEST.
- A track with files from several folders (B-roll, an edit) is not a camera. Audio whose main folder is on no video
  track is a Mic. Asistent's caption tracks are found by the signature it recorded when placing them, checked again now.
- A label colour exists only on the project item (no per-clip label in UXP or ExtendScript): it recolours the file
  everywhere. So colours are Keep unless chosen, and Sync colours the files BEFORE placing, because a placed clip keeps
  the colour its file had then (0.10.45).
- Only names and chosen colours change. Nothing is removed, muted, moved or rerouted. All renames and colours of one
  press are one transaction ("Asistent: Name the tracks"); Sync's colouring is its own step ("Asistent: Camera colours").
- Put names back merges earlier presses so it returns to the editor's own names; the record is kept per sequence
  (`asistent.labels.v1`, by sequence guid).
- The pre-export check uses `tracknames.plan(...).speech` to know the microphone tracks held to -6 dBFS: changing the
  rules changes that check too (`premiere-exportcheck.js`).
- The hook after Sync and rough cut is one guarded call (`autoLabels`) and must never fail the build.

## Decisions
- Names by an 80 % main folder, colours off by default, naming after Sync and rough cut on: DECISIONS 2026-11-10 (0.10.34).
- POV 1 / POV 2 by track order was the user's choice of 2026-11-10 (CHANGELOG 0.10.34).
- Fix audio second sides on a shared track, named right after the split: CHANGELOG 0.10.45 (no DECISIONS heading).

## Code map
- Panel: `panel/tracknames.js` (pure, node-tested: `plan`, `describe`, `restore`, `COLORS`); `panel/premiere-labels.js`
  (touches Premiere: `nameTracks`, `putBack`, `colorFiles`, `read`); `panel/main.js` `onNameTracks`, `autoLabels`,
  `labelSettings`; `panel/index.html` row `secLabels`, buttons `labelsName`, `labelsBack`, `labelsAuto`, `labelsColor1/2`.
- Engine: only `captionsState` (the caption record, `captionstate.py`) is read; no endpoint of its own.
- Host: none.

## Status
- Since 0.10.34 (2026-11-10); 0.10.45 added colouring before Sync and the second-side names. Verified through the bridge
  on NEW TEST: names, renumbering, colours and their restore, Put names back, automatic after Sync and rough cut.
- Not verified: one Cmd+Z (macOS did not let a script press it, TODO A), caption tracks (NEW TEST has no Asistent caption
  record), and the clips' own colour on the timeline (TODO R: the user to look). The user's try on a client sequence is open.
- Windows: untested.
- Limits: track rename needs `createSetNameAction` (Premiere 26.5.2; 26.0.2 had none, the panel says how many cannot be renamed).
  Later if wanted: "Camera A, FX3" names from the camera model (TODO I7).

## Tests
- `tests/tracknames.test.js` (which name each track gets, kept names, restore, colours list). `premiere-labels.js` and
  `onNameTracks` have no node test; they were checked through the bridge only.
