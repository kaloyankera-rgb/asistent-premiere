# Folders: favourite folders one press away

## What it does
The editor's favourite folders as buttons; a press opens the folder in Finder / Explorer. Two places show the same list: the
Folders tab of the Asistent panel (next to Brand; a folder icon at the narrowest widths) and the Asistent Folders panel
(Window > Extensions, 0.10.146), a separate CEP panel that takes folders dragged from Finder, which the Asistent panel cannot.

## How to use it
1. Drag folders from Finder onto the Asistent Folders panel (Window > Extensions > Asistent Folders), or press Add folder… there
   (several at once) or on the Folders tab (one). The Asistent panel cannot take a drag (see below).
2. Press a button: the folder opens in Finder / Explorer. A dimmed button's folder is not there now (moved, renamed, a drive
   that is not mounted); its tooltip says where it pointed.
3. Asistent Folders panel: right-click a button for Rename, a colour, Follows the project, Move left / right, Delete (click twice);
   drag a button onto another to move it. Folders tab: Edit gives the same (name, colour, ↑ / ↓, Delete twice).
4. "Follows the project" (in Edit): the folder is counted from the open project's folder ("Assets", "../Кам 1"), so one button
   opens each project's own folder when projects share a folder structure. Needs a saved project on the same drive.

## Key points: do not break
- Read only: nothing in Premiere, nothing in the folders is written, moved or renamed; Delete removes only the button. Office
  server folders are only opened (CLAUDE.md: the server is read only).
- UXP cannot open Finder: the engine does it (`reveal.open_folder`, `open <folder>` / `explorer.exe <folder>`), and only for an
  existing folder (a file or a missing path is refused with 404).
- The list lives in the panel's store (`asistent.folders`, engine-backed `panelstore`), so an update does not lose it.
- Drag from Finder, measured 2026-11-22 in Premiere 2026 (26.5.3): the UXP panel gets an empty drop (no files, links or text); a CEP
  panel gets the folder with its path (`File.path`, "Tik Tok Sounds", dir true). Hence the second, CEP panel. Both log drops
  ("folders drop" in engine.log, "folders panel" in host.log).
- One list: the engine's panel store, key `asistent.folders`. The CEP panel reads it every 3 s (and asks Premiere for the project
  folder only when a button follows the project); the tab reads it fresh each time it is shown. Last write wins.
- The CEP panel loads `host/folderplan.js`, an exact copy of `panel/folderplan.js` (a test fails when they differ: copy after a change).
- Folders tab: no right-click menu (Premiere's UXP gives a panel none): Edit mode, ↑ / ↓. The CEP panel has a right-click menu
  and drag to reorder.
- Four text tabs overflowed the tab row at 300 and 240 px (preview, 0.10.144): narrower padding under 360 px, the folder icon
  under 280 px, names shorten with an ellipsis rather than push Log and Settings out.

## Decisions
- Its own tab, named Folders (the user's choice of placement, 2026-11-22): DECISIONS 2026-11-22 ("Folders tab").
- A separate CEP panel for drag and drop (the user's choice after the UXP drop measured empty): DECISIONS 2026-11-22 ("Asistent
  Folders panel").

## Code map
- Panel: `panel/folderplan.js` (pure: list, labels, colours, order, relative paths, store format); `panel/folders.js` (the page,
  drop, Edit, open); tab and pane in `panel/index.html` (`tabFolders`, `paneFolders`); `main.js` mounts it and calls `shown()`;
  styles `.fd-*` and the colour tokens `--fd-*` in `panel/style.css`. Drop parsing reuses `dropfolder.partsOf` and
  `brandplan.droppedPaths`; Add folder… reuses `premiere-import.pickFolder`.
- Engine: `engine/asistent/reveal.py` (`open_command`, `open_folder`, `folders_exist`); endpoints `POST /folders/open`,
  `POST /folders/exist` in `server.py`.
- Host (CEP bundle `host/`, installed with the helper by `install.install_host`): `host/folders.html` + `host/folders-panel.js`
  (the Asistent Folders panel: grid, drop, right-click menu, drag to reorder, shared list, project folder through
  `app.project.path`), `host/folderplan.js` (copy), the second `<Extension>` in `host/CSXS/manifest.xml`.

## Status
- Since 0.10.144 (2026-11-22): installed on the development Mac; tests pass; looked at in the browser preview at 240 / 300 / 420
  px. Not yet tried in Premiere (the user's look, a drop from Finder, a press). Windows: untested (`explorer.exe <folder>`).
- Open: TODO FLD.

## Tests
- `tests/folderplan.test.js`: paths, relative paths (down, up, other drive, network share), add without duplicates, rename,
  colour, move, remove, follows the project, the store format.
- `tests/test_exports.py`: the open command per platform, a missing folder or a file refused, which folders exist.
  `tests/test_colorlearn.py::test_folder_endpoints`: the two endpoints (Finder never opened by the tests).
- `tests/folderplan.test.js` also checks that `host/folderplan.js` is an exact copy.
- Preview scenarios `folders-empty`, `folders`, `folders-edit` (`preview/scenarios.js`); the CEP page has no harness in the repo
  (rendered once with stand-ins for Node and CEP, 2026-11-22).
