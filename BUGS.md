# Known bugs, limitations and warnings

- **Test bridge `fill` on a checkbox (Premiere 26.5.2, 2026-11-11):** `dispatchEvent(new Event("change"))` throws "Cannot read
  properties of undefined (reading 'detail')"; the box is set before it, the change handler does not run (a stored preference is
  not saved). Bridge only; the editor clicking a box is not affected. Fix: dispatch in try/catch or call the handler.
> Open bugs, limits and warnings only. A fixed bug goes into `CHANGELOG.md` and leaves this file; the fixed entries moved
> out on 2026-11-21 are in [docs/history/BUGS_fixed_to_0.10.120.md](docs/history/BUGS_fixed_to_0.10.120.md). Per feature:
> the Status section of its page in `docs/features/` ([docs/INDEX.md](docs/INDEX.md)).

## Keyframer on a clip that is both trimmed and sped up (found 2026-11-21, not measured in the Keyframer itself)
- The In/Out probe P7 measured that keys on a sped clip sit at `inPt × |speed| + …`, because Premiere reports the In point in
  timeline seconds. `premiere-keyframes.js` reads existing keys (so shaping between them is right) but anything it places
  from `inPt` alone, and the blur's window, may be off on such a clip. To check with the probe sequence in NEW TEST.

## In & Out animations, Phase 3 page (0.10.129, open, not fixed; found in the bridge tests of 2026-11-21)
- The header refresh in `panel/main.js` re-enables every action button, so Apply can look enabled while both sides are None. Pressing
  it shows "Pick an In or an Out animation first." and writes nothing. The Keyframer behaves the same way.

## In & Out animations, Phase 2 (0.10.127, open, not fixed; found in the bridge tests of 2026-11-21)
- After ONE Undo of a first Apply, an empty untagged Transform remains on the clip; the next Apply adds a second one (it never
  adopts an untagged Transform, by design). Two Undos are needed, as the status line says.
- A clip whose start is off the sequence frame grid (e.g. head-trimmed by a round number of seconds at 29.97) shows a 1-3 px sliver
  of the picture on frame 0 of a slide; the keys ignore the fractional offset.
- Graphics made in Premiere scale and turn around the frame's centre, not their own (the result carries a note); UXP exposes no text box.
- Inserting the Transform before a Graphic group shifts the chain indices that Keyframer records ("c:i") point at for that graphic.
- The Anchor page's Transform target would edit In/Out's Transform when it is the only Transform on the clip (`premiere-anchor.js`).
  Only a Basic Title MOGRT was tested, not a type-tool text clip.

## Limits of subtitles by ElevenLabs (0.10.119; also Cut silences' AI words since 0.10.121)
- The sound of the selected clips leaves the computer. ElevenLabs keeps uploads by default; Asistent deletes each transcript
  after use, but their docs do not say that this also removes their copy of the sound (no-retention is an enterprise feature).
- Fast talk between several people and street sound stay hard: GStroy's held-back interviews 26.5 % wrong (36 % locally).
- The names an editor types for a project do not reach Scribe (its "keyterms" are a paid add-on, not used); a wrongly heard
  name is fixed with a `чуто => казано` line as before.
- The dictionary repair is off after Scribe, so a by-ear spelling it makes stays and is only marked.
- A window read here because ElevenLabs failed uses the 0.10.118 recognition (slow); the result line says so.

## Premiere names its recovery copy as the open project for a moment (2026-11-15, Premiere 26.5.3)
- While it auto-saves, `Project.getActiveProject().path` can read …/Adobe Premiere Pro Auto-Save/RecoveryProjects/<name>--<id>.prproj.
  Auto import ignores such a path (0.10.114); other features that key on the project path (Show exports, Subtitle Learning) may
  see it for one poll.

## Open: Cut silences on a sequence with an odd frame rate (found in the logs 2026-11-21)
- "4a1a lokali" (IMG_9422, iPhone, 59.97361 fps), 2026-11-16 06:27 and 06:28, 0.10.115: the host razor reported no refusal but
  cut in the wrong places, clean answered "Premiere did not cut the new sequence ... where it was asked to" and an uncut "NO
  SILENCE ..." copy stayed each time. Likely the timecode string given to QE `razor` (probed only at 29.97). 0.10.122 checks the
  razor and stops with the rate named, before anything is removed. 2026-11-21 13:09, "Lokal 2": frame 16058 was asked as
  "00:08:55:08" (30 to the second), the razor read 60 and cut at twice the time; 0.10.123 writes the string itself, not yet
  confirmed by a press (TODO V122). The copies path's
  shell XML writes 59.94 for the same sequence (`xmeml.py`).
- Words for hesitations and takes are read from both microphones of a split L / R clip (TODO AUD).

## Limits of Cut silences 0.10.96 (known, by design or not built)
- No audio crossfade at the cuts and no J / L cuts: UXP 26 has no audio-transition action; the host (QE) route is not probed.
- Manual dB is one number for every microphone: with two microphones recorded at different levels it cannot fit both; Automatic can.
- Hesitation sounds go only when they stand alone between two pauses, and only those the recognizer writes down (Whisper often
  leaves them out; Scribe wrote two that Whisper missed on IMG_9422, both glued to speech, so neither went).
- A repeated take said again without a pause is listed, never cut. Takes more than 90 s apart are not matched (`takes.WINDOW_S`).
- The preview's dynamic checkboxes and text-field `change` events were never run in UXP (browser preview only).

## Stray presses and the scroll boxes (0.10.130, open, not fixed; found in review of the fix)
- The stray-press net (`strayPresses()` in `panel/main.js`) skips a button under a hidden pane (fixed in 0.10.130), but it checks
  scrolled-out buttons only against `#app`. `#work` and `#result` (max-height 240 px, scrolling, outside `#app`) can still have a
  scrolled-out button pressed by a stray press.
- Platform limit (Premiere 26.5.3 UXP): a button inside a hidden pane keeps the rectangle it had when the pane was last shown, so
  rectangle tests alone cannot tell what is on screen. The net therefore also reads the `hidden` property up the tree.

## In & Out preview (0.10.130-0.10.132, limits)
- Seen once through the bridge (0.10.131): on the very first visit to In & Out after the panel loads, the preview with remembered picks did not start; later visits did. A pointer move over the page or a new pick starts it. Not reproduced, cause not looked into (possibly the pane has no width yet when `openTab` wakes it).
- The bridge has no hook for the page's `preview.info()`; the 0.10.131 test read the DOM instead.
- 0.10.130 crashed Premiere 26.5.3 in the SVG painter (`SvgGeometryNode::prePaint`) while the preview looped. Rule since 0.10.131: a looping SVG animation in the panel never removes or creates nodes per frame, it only changes attributes. The Keyframer preview still recreates nodes but plays once per press; no crash from it is known.
- The preview frame is a fixed 104 x 72 px with a 36 x 26 px box since 0.10.132 (148 x 104 and 52 x 36 before): it shows the motion, not the clip's real size.
- Unknown until the user looks in Premiere (0.10.132): whether the arrow glyphs ← ↑ ↓ → ↻ ↺ on the Edge and Turn buttons render in UXP's font. If not, they become inline SVG icons. Seen only in Chrome.
- Unknown (0.10.132): whether a 300 px panel really gets the side-by-side layout (preview beside the settings) in UXP. The browser harness measured the page at 240, 300 and 420 px only; UXP's real layout width is not known.
- Unknown (0.10.132): the hover preview's behaviour in Premiere (pointing at a preset plays it without picking it). Not seen in Premiere.
- The preview does not draw motion blur (the blur is applied by Premiere only).
- UXP can report a hidden pane as visible for a while (stale sizes): the loop then runs up to 8 plays before it rests.

## Open bugs
- **Limit (0.10.88):** motion blur leaves a frame sharp when the picture grows more than 4x within the shutter time (Premiere
  then blends every frame's blur straight from start to end); typically the first frame of a pop from scale 0.
- **Fixed in 0.10.71 (2026-11-14):** Adobe's installer listed only 0.10.71 but Premiere's own plugin list
  (`UXP/PluginsInfo/v1/premierepro.json`) kept 0.10.70 first, and Premiere loaded 0.10.70 even after a restart. `install_panel`
  now also reads that list and does the remove + install cycle when it holds another version. The case below is the same bug.
- **Was open (2026-11-10, Premiere 26.5.2):** after `release_mac.sh` the old panel can stay loaded even when the panel is closed
  and opened ("Failed to add plugin as it already exists" in UXPLogs; 0.10.29 kept running after 0.10.30 installed). Removing
  the plugin with UnifiedPluginInstallerAgent `--remove "Asistent"` before `--install` made Premiere load the new one at once.
  Not changed yet (the installer is frozen during the Cockpit work): candidate fix for `install.py` / `release_mac.sh`.
- **Fixed in 0.10.25 (TODO F, the user's field reports 2026-11-10):** Fix audio "No active sequence." with several projects open
  (the host read ExtendScript's front project; verified in 26.5.2); Sync on an iPhone clip with spatial audio (APAC); colour on
  S-Log3 under a LUT adjustment layer (measured, not tried in Premiere). Still open: subtitles first run slow (one long window
  uses one reader of three: a split would change words, the user's decision), rough cut slow on many clips (recognition speed).
- **Fixed in 0.10.17:** every update erased the panel's settings (UXP localStorage is deleted with the panel).
- **Fixed in 0.10.10:** after an update Premiere kept running an old panel (Adobe kept older copies enabled; Premiere loads the first).
- **Open (seen 2026-11-08 after a Premiere restart):** the test bridge's `select` set no selection in NEW TEST (0 selected,
  no error); the user selected by hand. Worked in earlier sessions; look at it before the next bridge-driven test.
  2026-11-12: `select` worked every time in NEW TEST on Premiere 26.5.2 (C0737, C0738); 0 selected once only because the
  active sequence was the new ROUGH sequence (the clip was not in it). Not reproduced.

- **Fixed in 0.10.8: a covered clip measured on its file got a medium-confidence +2 stops with no frame check.** Open: the file
  and the timeline give different answers for the same clip (exposure by different anchors, Temperature 24.3 vs 18): see TODO.
- **Test project leftovers (2026-11-08, 0.10.7-0.10.8 tests, NEW TEST.prproj):** "ROUGH – SYNC – кам2 (safe) v1": V1 fx31030 razor-cut
  at 8 s, its Lumetri changed (Exposure 0.6, Temperature 24.3/18); "кам2": C0735 on A1 split into L/L (A1) + R/R (A2) with levels
  and limiters; subclips in "Asistent L-R".

- **Fixed in 0.10.7: Show exports watched nothing after the engine started before the office drive was mounted**, and an export
  into a new plan folder waited for Premiere's preferences (+10 s). Limits that stay: an export into a brand-new folder OUTSIDE
  the learned tree (and outside Premiere's last export folder) is still found only through the preferences; the tree is
  learned only after exports of 3 clients were seen; Windows has no tree (share notifications include other computers).

- **Audit of 0.10.1 (2026-11-08): all valid findings fixed in 0.10.6** (CHANGELOG). Still open from it: sync pair pruning (no
  criterion proven safe: camera clocks can be years off), caption TEXT edits that keep every line's time are not seen (no API
  reads caption text in 26.0.2; timing edits are), Windows CUDA pins and the Windows lock file untried, UXP right-click/long
  press not observed in Premiere.
- **Test bridge: a command sent while a job runs reaches the panel only when the job ends** (2026-11-08: `click "Cancel" now` waited
  ~40 s); the panel's long polls seem to queue behind each other in UXP. Development only; the real Cancel button is a DOM event.
- **Test project leftovers (2026-11-08, NEW TEST.prproj):** a subclip "overwrite test" in the root bin (the overwriteClip
  measurement), empty caption tracks C23-C25, test audio on A1/A2 at 117 s, 420 s and 470 s, a Highlights 20 grade on fx31036,
  Exposure keyframes on fx31030, sequences "ROUGH – SYNC – кам2 (safe) v1" and "SYNC – ROUGH – …": nothing was deleted (rule).

- **Fixed in 0.10.0: a selected clip also selected every clip with the same cut on another track** (after Sync: Auto color on
  V1 corrected the switched-off V2 clip; A1 also took A2 and A3). Unverified in Premiere. Still open from the same recording:
  after the press the Program monitor showed the switched-off V2 clip (check in NEW TEST whether adding Lumetri to a
  switched-off clip turns it on in Premiere 26.0.2).
- **Subtitles: wrong words are corrected by the editor since 0.9.67 (Captions tab).** The recognition itself still misreads far-microphone speech at random (see CHANGELOG 0.9.67).
- **Subtitles 0.9.48:** valid-word mis-hearings are invisible to the checks („той за градината“ for „то и за градината“, „Превърна“ at 6 s context); „го взимам“ may be a swallowed „взимаме“; a clip that starts inside a word keeps only the rest of it; the panel's flag list can contain false alarms (breath, hum). Older: **Subtitles 0.9.47:** timing can still be 50-120 ms off at some caption switches inside continuous speech (aligner resolution); an old Asistent caption track must be deleted by hand before a new run can be placed (no API to delete one; since 0.9.97 its lines are removed and only the empty track is left). „трябваше“ (corrected) is timed from its neighbours, not found by the aligner. „Я“, „то и за градината“, „свършил“ remain marked „?“.
- **Subtitles 0.9.97 (fixed 0.9.98): a word right at a cut could vanish** when a cut-out retake of it was close before the clip (the aligner placed it there); the media between clips is now silent for Whisper.
- **Subtitles 0.9.97: every rebuild leaves the earlier pair's two caption tracks empty** (their lines are removed; no script can delete a caption track). Right-click > Delete Track by hand.
- **Subtitles 0.9.45: some words stay wrong** (Whisper cannot hear them; listed as „?“ with time): „нища“ (neща), „десом“ (cut word at the end of the last piece), „свършила/свършил“. Fix path: M4 text correction.
- Subtitles: the aligner's weights are CC-BY-NC 4.0 (non-commercial); installed at the user's request (the 4a1a autoedit tool already uses them), see `LICENSES.md`.
- The older P2 note „caption placement does not work“ is about UXP only; since 0.9.45 the CEP host does it.
(Fixed in 0.9.9: Volume level always in Premiere's scale, no guess from the current value; `/color/probe` documented. Fixed in 0.9.10: every small button, including „Проба на Lumetri“ and the two import buttons, also ran „Оправи звука“ (Fill effects, split copies); now only the audio buttons do, `tests/wiring.test.js`. Fixed in 0.9.11: since 0.9.5 every frame export threw „File Format is not supported“ because the name was given without „.png“ (Premiere takes the format from the name); the name carries „.png“ again and the engine accepts x.png or x.png.png. Fixed in 0.9.12: a second click on a moved panel hit „Оправи звука“; every press is logged and ignored for 0.7 s after the panel changes, the probe asks under its own button. Fixed in 0.9.13: frame exports are queued by Premiere, so every frame has a unique name and the panel waits for the finished file (`/frames/wait`) before changing anything; a probe whose frames are all identical is UNVERIFIED and learns nothing. Fixed in 0.9.14: Exposure units ignored the highlight shoulder (skin got ~0.7 stop per unit); the render check learnt a biased Temperature (−84) from a render that also changed Exposure.)
1. ~~Colour analysis reads the source file, not the timeline~~ fixed in 0.9.18 (timeline renders; file only as REVIEW_NEEDED fallback).
2. **Render check confirmed once (12:21).** Earlier: 0.9.5-0.9.10 never exported a frame, and before 0.9.13 the „before“ frame could be rendered after the correction (queued export); so `/color/check` and the slider
   calibration (`lumetri.json`) are unproven. First apply will use the guess 60/80 slider units per log2.

### Keyframer's record cannot tell Premiere's graphics apart (found 2026-11-14, 0.10.72)
`premiere-keyframes.clipKey` is media + In point; every graphic made in Premiere has no media path, the name "Graphic" and
In 3600 s, so two graphics share one record ("shaped by Asistent", Undo last). Undo last only takes out keys still where
Asistent put them, so nothing wrong is removed, but the record of one graphic can be replaced by another's. Live updates
(0.10.72) use track + start as well. Fix the record key the same way (keeping old records readable) when Keyframer is next changed.

## Not verified in Premiere (implemented)
- 0.10.71 Brand tab: installed 2026-11-14, not yet tried by the user (docs/BRAND_KIT.md "Still to check"). `ppro.Color`'s
  range was measured in 0.10.111-0.10.115 (0-1, `brandplan.COLOR_RANGE` = 1 is right; CHANGELOG). Still open: whether `getOutPoint` gives a
  still's length, whether Premiere passes dropped files to the panel, `insertMogrtFromPath` (not used: the host's importMGT is).
0.10.45-0.10.47: the SYNC clips' own POV colour on the timeline (scripts cannot read a clip's label; the files are coloured), Bounce Back, the clone rough cut on footage with a rotation flag (the clones keep the original project item, so the flag stays).
Subtitles M3 (0.9.42): verified working in Premiere on 2026-11-01 (see `PROJECT_STATUS.md`); still unjudged: Bulgarian accuracy and caption timing against the picture, behaviour with an unsaved project (refused with a message, not tried).
Fixed in 0.9.43: wrong words because the noisiest duplicate microphone was recognised (see `PROJECT_STATUS.md`); to be confirmed by the user in Premiere. Open: caption timing is only as exact as Whisper's word times (±0.1-0.3 s), direction of the error unknown.
Fixed in 0.9.44 (engine-tested, not yet in Premiere): words wrong at the cuts (joined mix), word starts early (alignment, optional), 3-4 word captions across sentence ends.
Open: the aligner's MMS_FA weights are CC-BY-NC 4.0 (see `LICENSES.md`); Whisper still misreads some words („неща“ as „нища“): needs the names field and the correction step (M4).
Open observation: in the short preset captions can be 3-4 words when function words are glued (see `TODO.md` C2).
One Undo per press (audio), „Раздели R/L“, „Изравни фразите“ keyframe positions (media time vs clip time;
identical for untrimmed clips), auto-import speed after 0.7.1, colour values set + read back, render check,
probe, `scripts/setup_win.ps1` (never run), Windows overall.

## Platform limitations (Premiere 26.0.2 UXP)
- Brand tab (0.10.71): no script sets the colour or font of text made in Premiere (Type tool, upgraded captions); effect
  presets (.prfpr) cannot be applied or imported by script; Premiere does not import SVG or PDF; new fonts show after a
  Premiere restart. The tab says each of these at the press.
- The Mix (master) track and its effects cannot be reached by script (QE: Audio 1-N only), so the Dynamics limiter of „Оправи звука“ is per clip.
- No audio channel mapping through UXP (ExtendScript can set it on bin clips only: used by the host for the L/L + R/R copies), no multicam creation, no track creation except by insert/overwrite past the last track.
- Removing track items while CEP panels run ExtendScript crashes Premiere → never remove.
- Clones capture the clip as it was before the transaction; new effects have no parameters until applied.
- Working/output colour space are not exposed (`getColorSettings` only gives graphics white luminance);
  only the clip's input/embedded LUT IDs and `getCompositeInLinearColor` are readable.
- Clip Volume max +15 dB. `exportSequenceFrame` needs the name with `.png` (without it: „File Format is not supported“) and may save it as `x.png.png`. It only queues the export and returns at once: wait for the file before changing the sequence.
- Adobe's published types start at 26.2; several methods are missing on 26.0.2.
- Lumetri Scopes are UI only (no scope data API): scope-like measurements must be computed from exported frames.
- No local masks/HSL-by-region through the API known so far (skin tones can only be global unless the probe shows otherwise).

## Algorithm limitations
- Sync: clips shorter than ~8 s or nearly silent stay Low (listed for manual work); frame-snapped placement
  leaves up to half a frame (8.3 ms at 59.94); VFR footage may drift later in the clip.
- Audio: two-mic detection needs both channels with ≥ 15 % speech and ≥ 15 % lead; borderline cases ask.
- Colour: the plain-gain clipping estimate is pessimistic (real check needed); skin target 0.62 may be brighter
  than the user's taste (to calibrate from their own corrected clips); REVO S-Log3 measured magenta −0.3 with
  few neutrals (likely stage light) → suggestion only.

## Warnings
- Never test in a client project; never close Premiere without asking; save first (osascript quit hangs with a project open).
- Do not delete track items via UXP; do not reintroduce muting.
- Panel results appear at the top and the panel scrolls (`#app`); new UI must keep that.
- `tests/test_real_footage.py` depends on `~/Kaloyan/01_CLIENTS/The Pact/GStroy/Media/GStroy brand/9x16`.
- **Fixed in 0.10.38 (not yet verified in Premiere): Sync dropped Fix audio's L / R copies and left 2 s between recordings**
  (4a1a mobilefox, 2026-11-11). Sync builds from whole files; it now redoes Fix audio on the new sequence, GAP 0.
