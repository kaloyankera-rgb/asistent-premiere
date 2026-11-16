# Brand Kit (0.10.71)

The **Brand** tab: the client's brand kit inside Premiere, every asset one press away. Built 2026-11-14 from the user's
spec (Brand Kit system: per-client kits on the office server, auto-detected from the project, quick actions, management).
It replaces the deferred Cockpit item A4 "Brand profiles" (`tools/COCKPIT_PLAN.md`).

Status: engine and panel built and tested outside Premiere (pytest, node, the browser preview, the engine's HTTP endpoints
against the real `brand-kits/` folder). **Not yet installed and not yet run in Premiere**: see "Still to check in Premiere".

## Where kits are

A kit is a folder. Asistent finds them in three ways (all read the same way):

| Source | What | Set where |
|---|---|---|
| Library folder | each sub-folder is one client's kit (Content Studio's `brand-kits/`, or an office server folder) | Brand > Manage > Library folder… (per computer); `/Volumes/Production/Brand Kits` (and `Brand kits`, `_Brand Kits`) are read too when they exist; `ASISTENT_BRANDKITS` env for development |
| Client folder | one client's kit anywhere: the "custom server path" per client | Brand > Manage > Client folder… |
| Brand Kit folder above the project | `Production/<client>/Brand Kit` found by walking up from the open project (names: Brand Kit, BrandKit, brand-kit, brand_kit) | nothing: automatic |

Inside a kit, files are sorted by **folder words** (logo/лого, intro/outro, overlay/mascot/icons/campaigns, fonts,
presets/mogrt/templates, reference/design/brandbook, audio/sfx) and then by **type** (fonts, `.mogrt`, `.prfpr`, LUTs, video,
sound, pictures, documents). Logo `x.png` + `x.svg` + `x.ai` in one folder show as one row (the PNG), the others listed as
"also SVG, AI". Hidden files, `_…` folders and `_Deleted kits` are skipped; at most 3000 files, 6 levels deep.

Two optional files in a kit:
- `brand.json`: the hand-written machine version of the office kits (`brand-kits/<client>/brand.json`, see the vault's
  `brand-kits/README.md`). Asistent reads the colours (every `colors` group that holds `hex` values, except website/UI,
  notes and sources), the declared font families (with the `missing` note), the subtitle style name and colours, the name
  rule, slogan and editing notes. **Asistent never writes it.**
- `asistent-kit.json`: what the editor changed in Asistent: name, other names (aliases), added colours, hidden colours,
  subtitle preset. Written by Manage, in the kit's folder, so everyone using that folder sees it.

## The client from the project

`brandkit.detect`: a Brand Kit folder above the project wins; otherwise a kit's name, folder name or alias (compared
across scripts: ЕКОПАК = EKOPAK, RE/SHAPE = ReShape) inside the project's file name (100), else equal to (80) or inside
(60) one of the 8 folders above it, nearer folders first. No match: nothing is guessed. The editor's choice in the
dropdown is remembered per project (panel store `asistent.brand`).

## What each press does, and what Premiere allows

| Action | How | Undo | Limits |
|---|---|---|---|
| **Add** (logo, graphic, video, sound) | imported once into the bin `Brand Kit - <client>` (found there by its path the next time), then `createOverwriteItemAction` at the playhead on the video track just above every clip that overlaps it (`brandplan.placeOn`), sound on the lowest free audio track; no free track: the host adds one on top (QE, as Stash clips) | one Cmd+Z (two when a track was added); the bin item stays | the length of a still is read from Premiere before placing; if Premiere does not say, the track must be free to the end of everything |
| **At end** (video, sound) | the same, after the last clip of the sequence (an outro, an end card) | as Add | |
| **Import** | into the client's bin only | Premiere's | |
| **MOGRT** | the host's ExtendScript `Sequence.importMGT` (the call proven for the subtitle graphics, 0.9.80) at the playhead, on a track free from there to the end | Premiere's | the MOGRT must suit this Premiere / After Effects. Earlier "no MOGRTs" decisions were about subtitles (DECISIONS 2026-11-08); the user's brand kit asks for MOGRTs explicitly |
| **Colour: click** | the HEX copied (engine: `pbcopy` / `clip`, no extra UXP permission) | | |
| **Colour: Apply to selected** | picture and video files: Premiere's **Tint** (Map Black To = Map White To = the colour, Amount 100 %: one colour, transparency kept), an existing Tint reused; MOGRTs: the host sets the first colour control (`getColorValue` / `setColorValue`), the other controls offered as buttons after the first press | one Cmd+Z per step: a new Tint is two (a detached effect shows no parameters), a MOGRT one per clip | text made in Premiere (Type tool, captions upgraded to graphics) has no scriptable fill (NATIVE_GRAPHICS.md): since 0.10.112 it gets a Tint inserted before its Graphic group (Map White To = the colour, Map Black To = black: white letters in the colour, a dark outline stays; measured 232,28,40 for #ED1C24); captions on a caption track cannot be coloured; the HEX is on the clipboard. Keyframed parameters are never written |
| **Subtitles: Use** | sets Tools > Subtitles > Style to the client's measured style (gstroy, credissimo, ekopak, beautysector, aula, reshape) | | only for clients that have a measured style |
| **Fonts: Install** | copies the kit's TTF / OTF into the user's fonts (`~/Library/Fonts`; Windows `%LOCALAPPDATA%\Microsoft\Windows\Fonts` + the HKCU registry entry, as `install.py`) | | Premiere sees new fonts after a restart; web fonts (WOFF/WOFF2) are listed but cannot be installed for Premiere |
| **Fonts: Copy** | the family name to the clipboard | | no script can set a native text graphic's font |
| **Effect presets (.prfpr), LUTs** | Show in Finder / Explorer with the manual step | | Premiere cannot apply or import a preset by script (Quick Search findings); a LUT goes into Lumetri by hand |
| **References** | Open in the file's own app; pictures and videos can also be imported | | |
| **SVG, PDF, design files** | Show only, with the reason | | Premiere does not import SVG or PDF |

Every placement is checked: the new clip where it was planned and every earlier clip of the sequence still where it was;
anything else is reported with the number of Undo steps.

## Quick row, refresh, cache, offline

- **Quick**: starred files first, then the most used on this computer (`<app>/brandkits/settings.json`).
- **Refresh by itself**: while the Brand tab is open the panel polls the kit's signature (names, sizes and dates of its
  files, `brand.json`, `asistent-kit.json`) every 8 s and redraws when it changed; the kit list every 32 s and when the
  project changes.
- **Local copies**: a file on a network share (`is_remote`: an SMB/AFP mount on the Mac, a UNC path or network drive on
  Windows) is copied to `<app>/brandkits/cache/<kit>/` from its second use, refreshed when the server's file changes,
  oldest first out above 2 GB. Premiere is always given the **server's** file while the server is reachable (an office
  project must not point at one computer's disk); the local copy is used only when the server is away, and the panel says
  so ("relink later").
- **Offline**: the last full reading of each kit is kept in `<app>/brandkits/index/<id>.json`. With the server away the kit
  still shows (marked offline), copied files still work. A kit whose library is reachable but whose folder is gone is
  treated as deleted, not offline.
- **Thumbnails**: FFmpeg, 160 px, kept in `<app>/brandkits/thumbs/` by file, size and date; SVG goes to the panel as it is
  (an icon when UXP cannot draw it).

## Managing kits (Brand > Manage)

Create (a folder with `assets/logo, fonts, video, graphics, presets, reference` in the first library), Rename (the shown
name; the folder keeps its name), Duplicate (the whole folder copied next to it), **Delete = moved into `_Deleted kits`**
in the same library (nothing erased), Forget (a client folder: Asistent stops showing it, files stay), other names, add /
hide colours, subtitle style, **Add files…** or **drop files from Finder / Explorer on the page**: copied (never moved) into
the kit's existing folder for that kind (or `assets/<kind>`), a name that exists gets " (2)"; large copies run as a job.

## Files

- Engine: `engine/asistent/brandkit.py` (everything above), endpoints `/brand/*` in `server.py`, host commands
  `brand_mogrt` and `brand_color` (`hostbridge.COMMANDS`, `host/host.jsx` `as_brand_mogrt`, `as_brand_color`).
- Panel: `brandplan.js` (pure: track choice, buttons per asset, quick list, search, colours, drops), `premiere-brand.js`
  (import, place, MOGRT, Tint), `brand.js` (the page). Bridge commands: `brand_info`, `brand_choose {kit}`,
  `brand_act {verb, rel}`, `brand_color {hex, index}`.
- Tests: `tests/test_brandkit.py` (15), `tests/brandplan.test.js` (12). Preview scenarios `brand`, `brand-manage`,
  `brand-offline` (`node preview/shoot.js <label> --only brand,brand-manage,brand-offline`).

## Still to check in Premiere (NEW TEST, Premiere 2026)

Not run yet: installing with `scripts/release_mac.sh` was stopped by Claude Code's permission check on 2026-11-14
(it reinstalls the panel in the user's Premiere and restarts the engine): the user installs, or allows it.

1. **`ppro.Color` range (decides `brandplan.COLOR_RANGE`)**. Place the test kit's white PNG, select it, Apply `#FF0000`,
   export a frame (`dev_cmd.py frame`) and read the logo's pixels: about (255, 0, 0) means 0-1 is right; near black means
   Premiere wants 0-255 (set `COLOR_RANGE = 255`). Until then a tinted logo may come out black.
2. Add a PNG at the playhead over a clip (goes one track above), on an empty stretch (V1), with every track busy (a track is
   added: two Undo steps), and check the still's length came from Premiere (engine log "duration known").
3. At end with a video that has sound (video above, sound on a free audio track, linked or not: note which).
4. MOGRT (Premiere's own Basic Title in the test kit) at the playhead; then Apply a colour to it and check which control
   changed; a native Type-tool text selected: the "cannot be coloured" line.
5. Drop files from Finder on the page (Premiere may not pass the paths: then Add files…), and the Quick row after two uses.
6. Turn the network off with a server kit open: offline note, a copied file still adds.
7. Windows (PC session): fonts install with the registry entry, `clip` for copying, `explorer /select` for Show.

The test kit used for this lives outside the repo (built in a scratch folder: a transparent white PNG, a 4 s 1080x1920 clip
with a 440 Hz tone, Premiere's Basic Title MOGRT, two colours); add it with Manage > Client folder….
