> Status (2026-11-13): PLAN ONLY, not built. The user, 2026-11-12: "Keep it as a plan for now, we will come back to this later. Save it". Copied from the plan file of that session.

# Smart Export Destination (Asistent): investigation and proposal

## Context
On every export the user browses the office server by hand to `Exported Videos/<client>/Контент план N`. The goal is for
Premiere's own Export window to already point at the right folder for the open project, with no extra clicks and no
separate export system. The user decided: **never create a missing folder**; **for now, only for the user** (their Mac;
off by default on everyone else's Asistent).

## Hard rule: find only, never create
Asistent **only finds** the existing export folder and points Premiere at it. On the office server it **never creates,
renames, moves, copies or deletes anything**: no folders, no files, no marker or cache files, no "Create" button. The
feature's server access is read-only (`os.path.isdir` / `os.listdir`). The only thing it writes is Premiere's own export
location (a preference inside Premiere) and its own local settings in the engine data folder on this Mac. When the right
folder is not there, it does nothing and says why. Enforced in code and tests: `exportdest.py` imports no write calls,
and a test runs `resolve()` on a read-only fake server tree (permissions removed) and checks that nothing changed.

## What the investigation found

**Confirmed (read on this Mac, 2026-11-12)**
- Real layout: `/Volumes/Production/<Client>/Контент план N/<Видео …>/Assets/<Client> КП-N - Видео M - ….prproj` and
  `/Volumes/Production/Exported Videos/<Client>/Контент план N/`. The *project path* names client and plan, even where
  the filename does not (`ReShape - Анестезия … .prproj` sits in `ReShape/Контент план 6/`).
- Projects are sometimes opened through a deep mount (`/Volumes/Видео 6 - …/Assets/…`), which hides the client folder.
  `learning._alternatives()` (engine/asistent/learning.py) already maps that back to the full `Production/…` path.
- Close names exist side by side in Exported Videos (Pulse / Pulse Fitness / Pulse Max, The Pact / ThePact, MoE / МоЕ,
  Velizar / Velizar V): only an exact folder-name match is safe.
- Premiere's Export mode remembers its location in its preferences: `MZ.Prefs.Export.Media.Path` (a folder) and
  `ExportSettings.Info.SaveAsFile` (JSON, `OutPath` = last file). Asistent already reads both (`exports.py`
  `read_prefs` / `PremierePrefs`) for Show exports. Today they say `…/Exported Videos/Pulse Fitness/Контент план 5/`.
- Asistent already has every piece around it: the panel reports the active project to the engine every 3 s
  (`exportsLoop`, panel/main.js); the engine reads the server; the always-loaded CEP host runs fixed ExtendScript
  commands per Premiere version (lane) (`hostbridge.py`, host/host.jsx); the export watcher sees every finished export
  and where it landed (`exports.py`).
- Path comparison without case / Unicode form: `exports.same()` / `exports.inside()`.

**Needs testing (could not probe: a client project was open in Premiere 2026; the bridge refuses outside test projects)**
- Whether ExtendScript `app.properties.getProperty / setProperty("MZ.Prefs.Export.Media.Path", …)` reaches these keys,
  and whether Export mode **picks up a changed value while Premiere runs** (on its next opening), or only after a restart.
- Which key Export mode actually uses for Location (the folder key, or the folder of `SaveAsFile.OutPath`), and whether
  the File name stays the sequence's own name (it must not change).
- Whether Send to Media Encoder and Quick Export follow the same location.
- Whether UXP has a preferences call of its own (not in the recorded API probes).

**Not supported**
- No UXP or ExtendScript event for "the Export window opened", and no API to drive the Export window's controls.
  Detecting it would need OS-level automation (macOS Accessibility permission, fragile across Premiere versions): not
  recommended, and not needed if the preference works.

## Proposed design (minimal, no new permissions, no new background process)

1. **Probe first (Premiere 2026, NEW TEST only, via the bridge `host eval`)**: read both keys; set the folder key to a
   test folder; open Export mode and read what Location shows (the user's look, the bridge cannot see the window);
   check File name; restore the old value. The result decides step 3's mechanism and goes to DECISIONS.md.
   **If no preference write takes effect while Premiere runs, stop and come back to the user** with the fallback below.
2. **Engine: `engine/asistent/exportdest.py`** `resolve(project) -> {status, client, plan, dest, why}`:
   - For each path from `learning._alternatives(project)`, walk up to the folder that has an `Exported Videos` child (the
     server root; no address in the code). Below it, `<client>/<plan folder>`; the plan number comes from the plan
     folder's name (`Контент план N`). Filename `КП-N` / client prefix, when present, must agree, otherwise `ambiguous`.
   - Destination `root/Exported Videos/<client>/<same plan folder>`, accepted only when both folders exist under an
     exact name match (`exports.same`). Statuses: `ok`, `not_on_server` (local project: do nothing), `offline` (server
     not mounted), `no_client_folder`, `no_plan_folder` (never created, user's choice), `ambiguous`. Only `ok` acts.
   - Endpoint `GET /exports/destination?project=…`; result cached per project with a short TTL (the server can drop).
3. **Setting it in Premiere**: a new fixed host command `export_dest` (host.jsx + `hostbridge.COMMANDS`) that sets only
   the key the probe proved, then reads it back. If `SaveAsFile.OutPath` must change, only its folder part changes; the
   file name, preset and every other field stay as they are. Sent **once per project activation** (when `exportsLoop`
   sees a new project path): if the editor then picks another folder by hand, Asistent leaves it alone until the next
   project switch. Nothing is written when the status isn't `ok`.
4. **Panel (Export tab)**: a card "Export folder" with a switch, **off by default** (on for the user's Mac only), and a
   status line: `GStroy · КП-11 → Exported Videos/GStroy/Контент план 11` or the reason it did nothing ("Контент план 13
   is missing in Exported Videos/GStroy", "Server not connected", "Project is not on the server").
5. **Safety net (reuses the export watcher)**: when a finished export lands outside the expected folder, the Log/Export
   tab says so ("Exported to …, this project's folder is …"). A message only: the file is never moved, copied or renamed.

**Fallback if the probe fails** (to propose to the user then, not built now): a "Copy folder path" button (UXP clipboard
permission in the manifest; in the Location dialog: Cmd+Shift+G, Cmd+V, Enter), plus the safety-net warning. An own
Export button (`EncoderManager.exportSequence` with a preset file) only if the user asks: it would not use the Export
window's current settings.

## Limits
- macOS: SMB mounts (`/Volumes/Production`), deep mounts, Unicode forms in Cyrillic names (handled); network-volume
  access for the engine is already granted (it reads the server for learning and exports). Two Premieres side by side:
  each has its own preferences; the lane sends the command to the right one.
- Windows: not built or tested now (the user: only for me). The resolver is path-based, so drive letters / UNC paths
  would work later, but the host command and preference behaviour need their own test on a PC.
- The preference key is internal to Premiere: a future version may rename it. The read-back after writing and the
  safety net make that visible instead of silent.

## Files
- New: `engine/asistent/exportdest.py`, `tests/test_exportdest.py` (fake server trees: exact match, Pulse vs Pulse
  Fitness, missing plan, deep mount, filename/path disagreement, offline; and the read-only tree check that nothing on
  the "server" is created or changed).
- CLAUDE.md: the "find only, never create" rule added to the rules section, so later work keeps it.
- Changed: `engine/asistent/server.py` (endpoint), `engine/asistent/hostbridge.py` + `host/host.jsx` (`export_dest`),
  `panel/engine.js`, `panel/main.js` (`exportsLoop` hook, card), `panel/index.html`, docs (CHANGELOG, PROJECT_STATUS,
  TODO, DECISIONS with the probe result, docs/EXPORT_REVEAL_PLAN.md).

## Verification
- pytest `tests/test_exportdest.py` + full suite; `node --test tests/`.
- Bridge in Premiere 2026 / NEW TEST (only when no client project is open): project switch → host read-back shows the
  folder; the user opens Export mode once and confirms Location and File name; one real export lands in the folder and
  the watcher reports no mismatch. Then in Premiere 2027 after a restart, on a real client project (the user's look).
