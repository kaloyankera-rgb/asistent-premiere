# Show exports and Export check (after an export)

## What it does
Two rows under Automatic, both about a finished export. Show exports reveals the new file, selected, in Finder (Explorer on
Windows). Export check then plays the exported file once through FFmpeg in the background and reports what it measured: black
bars, black or frozen picture, sound on one channel only or silent, true peak above -1 dBFS, full-scale (clipped) samples,
silence at the start or end, and size, frame rate and length against the exported sequence. Loudness is shown next to -14 LUFS
as information only. Both only read: no file is opened, moved or changed.

## How to use it
1. Show exports has a switch (off in the engine's default `exports.json`; the user switched it on). Export Check's switch is on
   by default and works with Show exports off. Export from the Export tab as usual.
2. A moment after the file is whole, Finder opens with it selected. A queue shows only its last file.
3. Open the Export check row's arrow: the newest report, a "Recent exports" list (Show again, Report). Issues come as cards
   (topic, where, what to check in Premiere), then one green line of what passed and one grey line of numbers to know.
4. "Add export folder..." adds a folder that Premiere's preferences do not name.

## Key points: do not break
- Only finished new files count: size and time stopped changing, the file opens, an MP4 / MOV has all its boxes, FFprobe reads a
  duration (`settle.py`, shared with Auto import). Previews, Auto-Save, Media Cache, temp files and Asistent's own folders never count.
- Where it looks: the folder Premiere's preferences name (read again when they change, only files directly in it), folders added
  by the editor, folders learned from an export event, and on the Mac an office tree learned after exports of 3 clients
  (`Exported Videos/<client>/<plan>`, file events only, never scanned, never on Windows). The project's own folder is NOT watched
  (sound effects downloaded there were shown as exports, 0.10.5).
- A file the preferences name that is older than them waits 10 s (`LATER`): replaced by then means the new file counts.
- Showing only selects the file (`reveal.py`: `open -R` on Mac, `explorer.exe /select,` on Windows). "Show again" takes only an
  id the watcher recorded, never a path from a request.
- With both Show exports and Export check off nothing is watched. The check runs one file at a time in its own thread at low
  priority (`nice` 10, two threads, 640 px working picture) so Premiere stays responsive.
- The check never says "error": a still end card freezes and a fade is black on purpose. Thresholds in `filecheck.py`: bar 2 % of
  a side for 0.3 s, frozen 1 s, silence 0.5 s at the start and 1 s at the end, one channel 30 dB under the other, silent below
  -60 dBFS, full scale -0.05 dBFS, true peak -1 dBFS. Bars name the sides that show one (0.10.62).
- Premiere's export events (`EncoderManager` render complete / error / cancel, `OperationCompleteEvent` export media complete)
  tell the engine an export ended and carry the exported sequence's size, frame rate and length for the comparison. A scripted
  export (`exportAsMediaDirect`, `exportSequence`) fires none. The same event starts colour learning (see color-learning.md).
- Office server is read only: the watcher reads the tree and writes nothing there.

## Decisions
- Folder from Premiere's preferences, not the project's: DECISIONS 2026-11-05 (0.10.3), project folder dropped 2026-11-05 (0.10.5).
- Office tree learned, file events only, no scanning: DECISIONS 2026-11-08 (0.10.7).
- Auto import skips the editor's exports: DECISIONS 2026-11-15 (0.10.113).
- After-export check automatic, loudness only as information: the user's choice 2026-11-11, CHANGELOG 0.10.39 (no DECISIONS entry).
- Planned, not built: Smart Export Destination, `docs/SMART_EXPORT_DESTINATION_PLAN.md`; the first plan `docs/EXPORT_REVEAL_PLAN.md`.

## Code map
- Panel: `panel/exportevents.js` (`listen`, `pathIn`, `fieldsOf`); `panel/premiere-exportcheck.js` `exportedSequence`;
  `panel/exportcheck.js` `afterSections` (pure, the cards); `panel/main.js` (`renderExports`, `renderAfter`, `afterBlocks`,
  `exportsLoop`, `exportsChange`); markup `secExports`, `secAfter`, `exportsList` in `panel/index.html`.
- Engine: `engine/asistent/exports.py` (`ExportWatcher`, `Settings`, `PremierePrefs`; `done`, `queue_check`, `is_export`),
  `reveal.py`, `settle.py`, `filecheck.py` (`run`, `report`, `bars`). Endpoints in `server.py`: `GET/POST /exports/settings`,
  `POST /exports/done`, `GET /exports/recent`, `POST /exports/reveal`. Engine data `exports.json`.
- Host: none. Bridge commands `export_try`, `export_listen`, `after_export` in `panel/devbridge.js` (development only).

## Status
- Since: Show exports 0.10.3 (fixed 0.10.5, 0.10.7), Export check 0.10.39, cards 0.10.111. Latest line: 0.10.115-0.10.116
  installed, the cards "seen in the panel's DOM", next export still to look at (TODO V96).
- Mac: Show exports seen on the user's real export (0.10.5) and on a real Premiere export through the bridge (0.10.7); Export
  check verified through the bridge in Premiere 26.5.2 (a 128 s export checked in 20.7 s, real letterbox found, 0.10.41-0.10.42; a
  scripted export, 0.10.62). Unverified: the Export tab's event reaching the panel, and the comparison with the sequence on a real
  Export (a scripted export fires no event). Media Encoder and Quick Export not tried.
- Windows: untested ("Explorer on Windows, untested"); no office tree there.
- Limits (`BUGS.md`): an export into a new folder outside the learned tree and Premiere's last folder is found only through the
  preferences; a colleague's export on the shared drive is never shown; the project path can briefly read as a recovery copy.
- Open TODO: A "Show exports for Media Encoder and Quick Export", FILL "USER: one real export", XD (plan only).

## Tests
- `tests/test_exports.py` (watcher rules, queue, prefs, tree, events, check on by default, reveal commands, a real watchdog run).
- `tests/test_filecheck.py` (synthetic exports with each problem, parse, sides, issues).
- `tests/exportevents.test.js`, `tests/exportcheck.test.js` (`afterSections`), `tests/wiring.test.js` (the Show exports card wiring).
