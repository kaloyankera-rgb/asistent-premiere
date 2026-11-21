# Auto import

## What it does
The Auto import row (Tools tab, group Automatic) watches a folder and puts every new file into the open Premiere
project, in the bin of its type: MUSIC, SFX, BROLL, IMAGES, GRAPHICS or OTHER. The editor downloads assets and they
appear in Premiere. It is on by itself and watches the folder the project is saved in.

## How to use it
1. Do nothing: a project with no folder of its own watches its `.prproj` folder from the panel's first status call. The
   row shows "Watching <folder>".
2. To watch another folder, drop that folder from Finder / Explorer onto the row, or press "Other folder…" under the
   row's more arrow. A dropped file is refused with "drop the folder it is in".
3. The switch turns it off; off is remembered for that project. The row lists the last imports.
4. The panel must be open and idle: files are imported while no other job runs.

## Key points: do not break
- A folder belongs to one project and a project to one folder. Files go only to that project, and only while it is the
  open one. A folder another project watched passes to the project open now.
- Files are imported in place with `importFiles`: never copied, moved or renamed. Nothing touches the timeline.
- Files already there when watching was switched on are left alone. The same file (path, size, time) is never queued
  twice, also after a restart.
- A file is ready only when it is complete: a browser rename from a temp name counts after 0.3 s (`settle.MOVED_STABLE`),
  any other write after 1.5 s of steady size (`STABLE_SECONDS`), and FFprobe must read a media file.
- Only real downloads count: at most 3 folders below the watched one, never inside a git repository or a node_modules /
  venv / .cache folder (0.10.70: Downloads held the Asistent repository and 928 screenshots were imported).
- Skipped inside the project's folder (0.10.113): Premiere's previews, auto-saves, recovery projects and caches,
  Asistent's own `Asistent_*` folders, and the editor's exports (named by Premiere's preferences or an export event).
- While Premiere auto-saves, the open project can read as its recovery copy for a moment. Such a path never gets a folder
  (0.10.114, BUGS "Premiere names its recovery copy").
- The category comes from the folder name, then the file name, then the media (`importer.classify`). Unsure = OTHER.
- Show exports (`exports.py`) shares `settle.py` and `PREMIERE_DIRS`; keep both features in step when changing them.

## Decisions
- One folder per project, long polling, no polling at 4 s (DECISIONS section "Auto import").
- On by default and watching the project's own folder, not the Show exports row (DECISIONS 2026-11-15, 0.10.113).
- Only real downloads, depth 3, no repositories (CHANGELOG 0.10.70; no separate DECISIONS entry).

## Code map
- Panel: `panel/main.js` `renderImport`, `importLoop`, `importSwitch`, `importDrop`; `panel/premiere-import.js`
  `importPending` (bin per category through `ensureBin`, check the file arrived), `pickFolder`; `panel/dropfolder.js`
  (pure) `partsOf`, `droppedPath`, `fromUri`, the path a drop carries.
- Engine: `engine/asistent/importer.py` `Store` (`bind`, `auto_bind`, queue), `Watcher` (watchdog, `catch_up`),
  `classify`, `wanted`, `premiere_work`; `settle.py`; endpoints `/import/status`, `/import/bind`, `/import/unbind`,
  `/import/result` in `server.py`. No host code.

## Status
- Since 0.7.0 (folder sync, verified by the user in Premiere with Epidemic music / SFX and Shutterstock B-roll);
  on by default since 0.10.113. 0.10.113-0.10.115 were checked in NEW TEST through the bridge (it watches
  Ludi Glavi/Projects, steady over a restart). The new default in a new project: confirmed fine by the user 2026-11-21.
- Folder drop (0.10.67): not tried in Premiere. Whether Premiere's UXP hands the panel the dropped path is unknown; the
  panel logs "import drop: …" and then says to use "Other folder…".
- Latest status line: 0.10.115-0.10.116 confirmed by the user 2026-11-21. Latest release v0.10.118.
- Windows: untested (watchdog, `settle`, folder picker never run on the PC).
- Open: BUGS: the recovery-copy limit above.

## Tests
- `tests/test_importer.py`: classify, settle, binding, auto_bind, exports skipped, depth and repository rules.
- `tests/dropfolder.test.js`: the path a drop carries. `tests/test_server.py`: the `/import/*` endpoints.
- `tests/test_exports.py`: the shared watcher rules.
