# Show the exported file: plan

Status (2026-11-05): the Export tab is built in 0.10.3 (CHANGELOG), with one change to this plan: the folder comes from
Premiere's preferences (`ExportSettings.Info.SaveAsFile`, `MZ.Prefs.Export.Media.Path`), because the office exports into its
own tree, not the project's folder (DECISIONS 2026-11-05). Media Encoder and Quick Export (phase 0 events) come later.

## Goal
When an export of a video finishes, Asistent opens the folder it was written to, with the new file selected:
Finder on the Mac, Explorer on Windows. It covers File > Export > Media (Export mode in Premiere, rendering inside
Premiere), "Send to Media Encoder" and Quick Export. It does not count timeline preview renders (Sequence > Render,
the red/green bar) or Asistent's own frame exports.

## What Asistent can do today
Nothing in Asistent listens to exports yet. Three parts can carry this feature:
- the UXP panel (`require("premierepro")`): Adobe's API has an `EncoderManager` with render-complete events, but the
  Premiere 26.0.2 API differs from the published types (CLAUDE.md), so whether they exist and fire for exports the
  editor starts by hand is unknown. The panel only runs while it is loaded;
- the invisible CEP host (`host/host.jsx`, ExtendScript): always loaded with Premiere. ExtendScript has
  `app.encoder.bind(...)` events, documented for jobs a script queued; for exports started by hand, unknown;
- the Python engine: always running, already watches folders (`importer.py`, watchdog, with the "is this file really
  finished" checks), and can run `open -R` / `explorer /select` (UXP cannot select a file in Finder).

So the work starts with probes, and the engine does the revealing in every design.

## Phase 0: probes in NEW TEST.prproj (through the bridge, nothing changed in the project)
Result 2026-11-08 (0.10.7): Premiere 26.0.2 offers `EncoderManager.EVENT_RENDER_COMPLETE / _ERROR / _CANCEL / _QUEUE /
_PROGRESS` and `OperationCompleteEvent.EVENT_EXPORT_MEDIA_COMPLETE`; listeners attach globally and on the manager. An
ExtendScript `exportAsMediaDirect` fired none of them. The panel now listens anyway and logs every event; the Export tab,
Media Encoder and Quick Export are still to be tried by hand.
1. **UXP events**: log what `ppro.EncoderManager` and `ppro.EventManager` expose in 26.0.2 (method and constant
   names), attach a listener for every render-complete/error/cancel event found, then export a short sequence three
   ways: Export mode in Premiere, Send to Media Encoder, Quick Export. Record which events fire and whether the payload
   carries the output path.
2. **ExtendScript events** (host, `scripts/dev_cmd.py host eval`): the same for `app.encoder.bind` and any app-level
   export events, the same three exports.
3. **The file on disk during an export**: watch the target folder and log every create/rename/size change: does
   Premiere or Media Encoder write the final name from the start or a temp name, when does FFprobe first read it (an MP4
   is readable only once its index is written at the end), and what is left after a cancelled export.

Decision after the probes, written into `DECISIONS.md`:
- an event fires for hand-started exports and gives the path → **event first**, the folder watcher only as backup;
- an event fires but without a path → the event says "an export finished", the watcher finds which file;
- no event fires → **folder watcher only**.
The plan below assumes the hybrid, since the watcher is needed in all three cases.

## Phase 1: engine
- `engine/asistent/exports.py`, `ExportWatcher`:
  - which folders: the project file's folder, watched automatically (the user, 2026-11-04), folders learned from
    earlier exports of that project (kept in `exports.json` in the engine data folder, outside the vault), and folders
    the editor adds in the panel;
  - what counts: video files (`importer.VIDEO`, optionally audio-only exports) that appeared after the watcher started,
    are finished (size and time stopped changing, the file opens, FFprobe reads a duration), and are not in Premiere's
    preview, Auto-Save or Media Cache folders or in Asistent's own data folder;
  - the "finished" checks are moved out of `importer.py` into one shared helper used by both, not copied;
  - several exports finishing within about 5 s (a queue): only the last one finished is shown, one window (the user,
    2026-11-04); the others are still listed in the Log.
- `engine/asistent/reveal.py`: `reveal(path)`, one file. Mac: `open -R <file>`. Windows: `explorer.exe /select,"<file>"`.
  Only reveals: never opens, plays, moves or renames a file.
- Endpoints in `server.py`: `GET/POST /exports/settings` (on/off, extra folders), `POST /exports/done` (the panel or
  host reports an export event, with the path if the event gives one), `GET /exports/recent` (for the Log tab),
  `POST /exports/reveal {id}` (show again from the log). The engine reveals only files its own watcher or an event
  confirmed, never any path a request sends.

## Phase 2: panel and host
- The event listener from Phase 0 goes where it fired: in the host if ExtendScript events work (it is always
  loaded), otherwise in the panel (then it works only while the panel is loaded; the watcher still covers the rest).
- Panel: one setting, "Show exported file in Finder" ("in Explorer" on Windows), OFF by default (the user,
  2026-11-04): while it is off the watcher does not run at all; an "Add export
  folder" choice; a Log line per export ("Exported X.mp4, shown in Finder") with a "Show again" button. Made with
  `button()`/`enable()` and the `style.css` tokens, checked in the browser preview first.

## Phase 3: tests, release, verification
- pytest: the readiness checks and ignore rules (preview folders, old files, temp names, a file still growing), a
  queue showing only its last file, nothing shown while the setting is off, the reveal commands built for Mac and Windows (subprocess mocked); `tests/wiring.test.js` for
  the new setting; a new panel module goes into `scripts/package_ccx.sh`.
- Version bump in `panel/manifest.json` and `engine/asistent/config.py`, `scripts/release_mac.sh`.
- The user checks in NEW TEST.prproj: one export inside Premiere, two queued in Media Encoder, one cancelled (no
  window), one Quick Export, the setting switched off (no window), a timeline preview render (no window).
- Docs per the definition of done (CHANGELOG, PROJECT_STATUS, TODO, BUGS, PROGRESS, DECISIONS), one commit, push only
  after the user says so. Windows stays marked untested until it is tried on the PC.

Agents (`../DEV_WORKFLOW.md`): probes and building `feature-builder` (Sonnet), checks `test-runner` (Sonnet); the
planner is not needed unless the probes show no usable event and no reliable file signal.

## The user's answers (2026-11-04)
1. Off by default: the editor switches it on in the panel.
2. A queue of several exports: show only the last one.
3. The engine watches the project file's folder on its own.

## Risks and limits
- Finder comes to the front over Premiere after every export once the setting is on: that is the feature.
- Network drives and some external disks may not send file events: the watcher then checks those folders every few
  seconds instead.
- If no event works and the export goes to a folder Asistent does not know yet, the first export there is missed;
  after "Add export folder", or once an event has shown the folder, it is caught.
