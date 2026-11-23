# Brand

## What it does
The Brand tab holds the client's brand kit inside Premiere: logos, graphics, video (intros, outros), sound, MOGRTs,
colours, fonts, references and notes. The client is found from the open project. One press puts an asset on the
timeline, copies a HEX, colours the selected clips, installs a font or opens a reference. Full reference (tables of every
press and its Premiere limits): [docs/BRAND_KIT.md](../BRAND_KIT.md), 113 lines. This page is only the summary.

## How to use it
1. Open the Brand tab. The client shows by itself (a kit's name in the project's name or folders, or a Brand Kit folder
   above the project); otherwise pick one in the dropdown (remembered per project). Nothing is guessed.
2. Add (at the playhead, on the track just above every clip there) or At end (an outro) for logos, video and sound.
   Presets: Add a MOGRT. Fonts: Install or Copy. References: Open.
3. Colours: a click in the Apply row colours the selected clips, a click in the Copy row copies the HEX without # (0.10.150),
   ready to paste into Premiere's colour fields (for part of a text: select the words, Properties > Fill, paste).
4. Manage: create, rename, duplicate, delete (moved to `_Deleted kits`), forget a client folder, library folder, add
   files with "Add files…" (a drop from Finder does not reach the panel: measured 2026-11-22, the page no longer offers it).

## Key points: do not break
- A kit is a folder: a library folder, a client folder, or `Brand Kit` above the project. `brand.json` is written by hand
  and Asistent only reads it. The editor's changes go to `asistent-kit.json` in the kit's folder.
- Nothing is erased: Delete moves the kit into `_Deleted kits`; Forget only stops showing a client folder.
- Placement never covers or cuts an editor's clip: the track just above everything that overlaps (`brandplan.placeOn`),
  a new top track through the host when none is free. Each placement is read back (new clip in place, earlier clips
  unmoved). One Cmd+Z, two when a track was added.
- Premiere is given the server's file while the server is reachable, never a local copy (an office project must not point
  at one computer's disk). The copy under `<app>/brandkits/cache` is for when the server is away ("relink later").
- Colour on text made in Premiere is a Tint inserted BEFORE the Graphic group (appended after the Text layer it draws
  nothing, 0.10.112). `ppro.Color` takes 0-1 values (`brandplan.COLOR_RANGE` = 1, measured 2026-11-15). After adding a
  Tint, wait 60 ms and read the effects from a fresh handle (crash on fast presses, 0.10.118).
- No script sets the font or fill of Premiere's own text, applies a `.prfpr` preset, or imports SVG / PDF: the tab says so
  at the press and shows the file instead.
- The clipboard goes through the engine (`pbcopy` / `clip`), so the panel needs no extra UXP permission. Nothing is sent
  anywhere: local only.
- The office server is read only for Claude and development scripts. Brand tests use a scratch folder.

## Decisions
- Kits are folders, `brand.json` read only, Delete = move, server file for Premiere (DECISIONS 2026-11-14).
- Brand colour on Premiere's own text is a Tint before the Graphic group (DECISIONS 2026-11-15).
- MOGRTs are placed for the brand kit; the earlier "no MOGRTs" decisions were about subtitles (DECISIONS 2026-11-14).

## Code map
- Panel: `panel/brand.js` the page (polls the kit's signature every 8 s while open); `panel/premiere-brand.js` import,
  `place`, `placeMogrt`, `tint`, `applyColor`; `panel/brandplan.js` (pure, node-tested) track choice, buttons per asset,
  quick list, search, colours; `panel/dropfolder.js` (pure) the paths a drop carries.
- Engine: `engine/asistent/brandkit.py` (`list_kits`, `detect`, `read_kit`, `resolve`, `manage`, `add_files`,
  `install_font`, thumbnails, offline index); `/brand/*` endpoints in `server.py`.
- Host: `host/host.jsx` `as_brand_mogrt` (importMGT), `as_brand_color` (a MOGRT's colour control); both listed in
  `hostbridge.COMMANDS`.
- Bridge commands for tests: `brand_info`, `brand_choose`, `brand_act`, `brand_color` (`panel/devbridge.js`).

## Status
- Since 0.10.71 (2026-11-14), installed on the development Mac. Tried through the test bridge in NEW TEST: the Tint on
  Premiere text (0.10.112, letters measured 232,28,40 for #ED1C24) and the colour range. The user has not confirmed the
  tab as a whole in Premiere. The rest of "Still to check" in BRAND_KIT.md (placement over clips, At end, MOGRT, drop,
  offline) is unverified.
- 0.10.150: Copy without #. Open (the user's reminders 2026-11-23): one Ctrl+Z for an Apply (today a clip without a Tint
  takes two: add the Tint, then its colour; probe `tint_one_step_probe` in the bridge, not run); colour only the selected part
  of a text is not possible by script (DECISIONS 2026-11-23).
- Latest: 0.10.115-0.10.116 colour Apply on text made in Premiere: confirmed fine by the user 2026-11-21. Latest release v0.10.118.
- Windows: untested (font install with the registry entry, `clip`, `explorer /select`).
- Limits: BUGS "Platform limitations" (Brand tab line). Open TODO: section BK (Premiere checks, user run, Windows, SVG to
  PNG later). `docs/BRAND_KIT.md` still says "not installed, not run" and `ppro.Color` unmeasured: outdated.

## Tests
- `tests/test_brandkit.py` (15): kits, detection, files, colours, fonts, manage, add. `tests/brandplan.test.js` (12):
  track choice, buttons, colours, drops. `tests/dropfolder.test.js`: dropped paths.
