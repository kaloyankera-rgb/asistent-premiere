# Folders: favourite folders one press away

## What it does
The Folders tab (next to Brand; a folder icon at the narrowest panel widths) holds the editor's favourite folders as buttons.
A press opens the folder in Finder / Explorer. Folders are added by dropping them from Finder / Explorer on the page or with
Add folder…; Edit renames, colours, moves and deletes buttons, and can make a folder follow the open project.

## How to use it
1. Open the Folders tab. Drop one or more folders from Finder anywhere on the page, or press Add folder… and pick one.
2. Press a button: the folder opens in Finder / Explorer. A dimmed button's folder is not there now (moved, renamed, a drive
   that is not mounted); its tooltip says where it pointed.
3. Edit: type a new name, click a colour, ↑ / ↓ to move, Delete (press twice within 5 s). Done goes back to the buttons.
4. "Follows the project" (in Edit): the folder is counted from the open project's folder ("Assets", "../Кам 1"), so one button
   opens each project's own folder when projects share a folder structure. Needs a saved project on the same drive.

## Key points: do not break
- Read only: nothing in Premiere, nothing in the folders is written, moved or renamed; Delete removes only the button. Office
  server folders are only opened (CLAUDE.md: the server is read only).
- UXP cannot open Finder: the engine does it (`reveal.open_folder`, `open <folder>` / `explorer.exe <folder>`), and only for an
  existing folder (a file or a missing path is refused with 404).
- The list lives in the panel's store (`asistent.folders`, engine-backed `panelstore`), so an update does not lose it.
- No right-click menu (Premiere's UXP gives a panel none): Edit mode instead. No drag to reorder: ↑ / ↓.
- Whether Premiere's UXP hands the panel a dropped folder's path is unverified (as for Auto import's drop, 0.10.67): the drop is
  logged as "folders drop: …" in engine.log; Add folder… always works.
- Four text tabs overflowed the tab row at 300 and 240 px (preview, 0.10.144): narrower padding under 360 px, the folder icon
  under 280 px, names shorten with an ellipsis rather than push Log and Settings out.

## Decisions
- Its own tab, named Folders (the user's choice of placement, 2026-11-22): DECISIONS 2026-11-22 ("Folders tab").

## Code map
- Panel: `panel/folderplan.js` (pure: list, labels, colours, order, relative paths, store format); `panel/folders.js` (the page,
  drop, Edit, open); tab and pane in `panel/index.html` (`tabFolders`, `paneFolders`); `main.js` mounts it and calls `shown()`;
  styles `.fd-*` and the colour tokens `--fd-*` in `panel/style.css`. Drop parsing reuses `dropfolder.partsOf` and
  `brandplan.droppedPaths`; Add folder… reuses `premiere-import.pickFolder`.
- Engine: `engine/asistent/reveal.py` (`open_command`, `open_folder`, `folders_exist`); endpoints `POST /folders/open`,
  `POST /folders/exist` in `server.py`.
- Host: none.

## Status
- Since 0.10.144 (2026-11-22): installed on the development Mac; tests pass; looked at in the browser preview at 240 / 300 / 420
  px. Not yet tried in Premiere (the user's look, a drop from Finder, a press). Windows: untested (`explorer.exe <folder>`).
- Open: TODO FLD.

## Tests
- `tests/folderplan.test.js`: paths, relative paths (down, up, other drive, network share), add without duplicates, rename,
  colour, move, remove, follows the project, the store format.
- `tests/test_exports.py`: the open command per platform, a missing folder or a file refused, which folders exist.
  `tests/test_colorlearn.py::test_folder_endpoints`: the two endpoints (Finder never opened by the tests).
- Preview scenarios `folders-empty`, `folders`, `folders-edit` (`preview/scenarios.js`).
