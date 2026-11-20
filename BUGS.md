# Known bugs, limitations and warnings

- **Test bridge `fill` on a checkbox (Premiere 26.5.2, 2026-11-11):** `dispatchEvent(new Event("change"))` throws "Cannot read
  properties of undefined (reading 'detail')"; the box is set before it, the change handler does not run (a stored preference is
  not saved). Bridge only; the editor clicking a box is not affected. Fix: dispatch in try/catch or call the handler.
> Last fully reviewed at 0.9.18. Later findings (0.9.19-0.9.41) are in `PROJECT_STATUS.md` and `PROGRESS.md`; folding them in is open task T1 in `TODO.md`.

## Limits of subtitles by ElevenLabs (0.10.119)
- The sound of the selected clips leaves the computer. ElevenLabs keeps uploads by default; Asistent deletes each transcript
  after use, but their docs do not say that this also removes their copy of the sound (no-retention is an enterprise feature).
- Fast talk between several people and street sound stay hard: GStroy's held-back interviews 26.5 % wrong (36 % locally).
- The names an editor types for a project do not reach Scribe (its "keyterms" are a paid add-on, not used); a wrongly heard
  name is fixed with a `чуто => казано` line as before.
- The dictionary repair is off after Scribe, so a by-ear spelling it makes stays and is only marked.
- A window read here because ElevenLabs failed uses the 0.10.118 recognition (slow); the result line says so.

## FIXED (0.10.112): a Tint on text made in Premiere drew nothing
- Appended to the clip's effects it lands after the graphic's Text layer, where Premiere does not draw it; inserted before the
  Graphic group it colours the text. CHANGELOG 0.10.111-0.10.115.

## Premiere names its recovery copy as the open project for a moment (2026-11-15, Premiere 26.5.3)
- While it auto-saves, `Project.getActiveProject().path` can read …/Adobe Premiere Pro Auto-Save/RecoveryProjects/<name>--<id>.prproj.
  Auto import ignores such a path (0.10.114); other features that key on the project path (Show exports, Subtitle Learning) may
  see it for one poll.

## FIXED (0.10.110): Cut silences left 1-frame slivers and gaps between the clips
- The 10 ms plan edges rounded to the frame before a sound clip's first frame: one camera kept a frame the others did not. Cut
  edges now snap onto clip edges within a frame; keep-the-spaces drops flashes. CHANGELOG 0.10.110.

## FIXED (0.10.108): Cut silences crashed Premiere 26.5.3 on many clips (52 clips, 85 pieces)
- The crash was inside Premiere's UXP layer while it handed the panel a copy of a clip. The host now cuts a duplicate of the sequence instead (no copies): 17 runs, 0 crashes. CHANGELOG 0.10.108-0.10.109. The copies way remains only as a fallback without the host for at most 40 pieces.
- NEW TEST now holds about 75 "NO SILENCE – SYNC – кам2 (4) vN" sequences and one "HOSTPROBE" from these runs (the user may delete them); it held about 60 "NO SILENCE – SYNC – кам2 (4) vN" sequences from these runs: delete them.

## Superseded: the 0.10.98 batch limit (kept, harmless)
- Many short clips (49 clips, 94 and 133 pieces) went into one batch; Premiere 26.5.3 crashed in UXP's transaction callback. Batches are now at most 20 pieces. The exact limit is not known (58 worked, 94 crashed).

## Limits of Cut silences 0.10.96 (known, by design or not built)
- No audio crossfade at the cuts and no J / L cuts: UXP 26 has no audio-transition action; the host (QE) route is not probed.
- Manual dB is one number for every microphone: with two microphones recorded at different levels it cannot fit both; Automatic can.
- Hesitation sounds go only when they stand alone between two pauses, and only those Whisper writes down (it often leaves them out).
- A repeated take said again without a pause is listed, never cut. Takes more than 90 s apart are not matched (`takes.WINDOW_S`).
- The preview's dynamic checkboxes and text-field `change` events were never run in UXP (browser preview only).

## Fixed in 0.10.95, not yet confirmed: Cut silences kept people talking further away; clone errors half-ran
See CHANGELOG 0.10.95. The 0.10.94 crash fix worked (05:49: 202 pieces in 15 batches); three later presses on the "Lokali" clip
hit "Illegal Parameter type" / "script object is no longer valid" and then a crash (05:52:40). The refusal's cause is unknown;
a refused piece is now skipped and named. Still open: „съседание“ for „състезание“ (Whisper hears it so every time).

## Fixed in 0.10.94, not yet confirmed by the user: Cut silences crashed Premiere on a long clip with many cuts
Three crashes 2026-11-15 05:09-05:10 (4a1a ALPHA, IMG_9423.MOV 492.8 s, -30 dB, 101 cuts): the whole-clip clones reached 28.6
hours of timeline. Now in batches within 2 hours (CHANGELOG 0.10.94). The exact limit was not reproduced (the user's Premiere was
open; no crash test there): if it happens again with batches, the next suspect is the number of clones per transaction.

## Fixed in 0.10.94: the dictionary turned heard words into different words („съседни“, „Кара“)
See CHANGELOG 0.10.94. Still possible: a same-syllable near-miss (асимулатор -> асимилатор), listed among the changed words.

## Fixed in 0.10.90: Anchor refused a text made in Premiere ("source media is unavailable") and animated Scale / Rotation
- A Type-tool graphic has no project item; it now counts as the sequence frame. Limit: Premiere gives no script the text's box
  (Source Text is null / binary), 0.10.91 measures the letters from two renders instead (two extra Undo steps that cancel out; refused when every Opacity is animated).

## Fixed 2026-11-12: the translator crashed pytest (and macOS reported "Python quit unexpectedly")
sentencepiece is built with SWIG, which warns on Python 3.12 while it sets itself up; under the test command's `-W error` the
warning became an error inside its C code and left it half set up, so Python crashed while loading the model or when unloading
it at exit (5 crash reports 2026-11-11/12, all from test runs started in the terminal, none from the engine, which never runs
with -W error). `tests/conftest.py` imports it once with only that warning ignored; the real-model tests run again (12 pass).

## Fixed in 0.10.70: Auto import took files from deep inside the watched folder (the vault's screenshots)
See CHANGELOG 0.10.70. NEW TEST still holds the 928 imported screenshots (bin MUSIC): delete them by hand.

## Open bugs
- **Premiere crashed on Exposure +0.5 pressed twice fast (2026-11-18 11:48, the user's GStroy project, 26.5.3):** two clips
  without a Lumetri; no crash report written. Treated as the same Premiere fault as the Keyframer crash below; 0.10.118 settles
  60 ms and reads the effects from a fresh handle after every Lumetri / Tint add and between queued presses. If it happens
  again, note the time and whether the clips already had a Lumetri.
- **Premiere crashed once while testing 0.10.86 (2026-11-15 04:07, NEW TEST, recovered on relaunch):** inside UXP, turning a
  Premiere object into JavaScript (`napi_wrap` from `CallProperty`; the pointer read was text: a freed object), right after
  the Keyframer added its motion blur Transform. The same step ran fine about ten times before and after; Lumetri and Tint
  add effects the same way. 0.10.87 keeps the new effect referenced, waits 60 ms and reads the chain from a fresh handle. If
  it happens again, the crash report is in `~/Library/Logs/DiagnosticReports/Adobe Premiere Pro 2026-*.ips`.
- **Limit (0.10.88):** motion blur leaves a frame sharp when the picture grows more than 4x within the shutter time (Premiere
  then blends every frame's blur straight from start to end); typically the first frame of a pop from scale 0.
- **Fixed in 0.10.77, not yet confirmed by the user (2026-11-15):** Track and Stop in the Tracker needed several clicks (the
  user's screen recording): Track's tooltip stayed up while it was clicked and only the last press reached the log. Likely the
  picture kept the pointer captured after the box was drawn. Captures are released by hand now, and a press landing on a button
  but delivered elsewhere presses that button (log: "press for ... arrived at ..."); if that line never shows and presses are
  still lost, the cause is elsewhere.
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
- **Rough cut: vertical footage comes in sideways (2026-11-03, 0.9.64; 0.9.67 describes rotated files upright in the XML, UNVERIFIED).** The Masterhaus files (fx31033, C0736: 3840×2160, display matrix `rotation=90`) are upright in the source sequence (Premiere reads the flag on a normal import) but sideways and letterboxed in the rough cut, with no rotation in Effect Controls: the XML's `<file>` says 3840×2160 and the master clips the import makes do not take the flag. Probe XMLs (A as now, B 2160×3840, C no `<media>` in `<file>`) in the session scratchpad; the fix waits for TEST.prproj.

- **Rough cut: an unused quiet audio track counts as sound (2026-11-03, 0.9.63; 0.9.67 leaves out audio on a muted track or a disabled clip, UNVERIFIED: needs `isMuted`/`isDisabled` in Premiere 26.0.2).** The camera's own mic (A1) selected next to the lavalier tracks makes the stretches where only that camera records look like speech; they stay and leave gaps in the other camera's row (44.8 s in the last run, more with A1 selected). Workaround: delete (or do not select) the unused track; then the time no selected audio covers is cut whole (162 s in that run; the result says so). Proposed fix, not built: audio on a muted or disabled track is ignored for speech and left out of the rough cut.
- **Rough cut: the user says the effects of „Оправи звука“ do not transfer (2026-11-03, 0.9.63).** Read back on the new sequence in TEST.prproj: Volume level and Dynamics → Limiter -6 dB are on every piece and match the source. Not checked and not readable by any API: the L/L and R/R channel routing (the new clips use the full media file through the XML, not the „… L …“/„… R …“ subclips). The user was asked which effect is missing.
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
- 0.10.71 Brand tab: not installed, not run in Premiere (docs/BRAND_KIT.md "Still to check"). `ppro.Color`'s range is not
  measured (`brandplan.COLOR_RANGE` = 1 assumed): a tinted logo may come out black until it is. Whether `getOutPoint` gives a
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
