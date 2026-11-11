# Project status — Asistent 0.10.32 (2026-11-10, branch feature/keyframer off improvements/2026-11)

0.10.40 (2026-11-11, branch feature/roughcut-turbo, NOT installed: the user was editing): Fast rough cut switch (large-v3-turbo,
2.1x faster on 15 GStroy clips, but fewer repeated takes found: off by default). Turbo downloaded on this Mac. ReShape golden
identical. Panel switch and download button NOT verified in Premiere.

0.10.38 (2026-11-11, installed): Sync does Fix audio again on files that had Asistent's L / R copies, and leaves no gap
between recordings. NOT verified in Premiere yet (user to try in 4a1a mobilefox › B-Roll). Tests: 700 pytest + 24 skipped, node 238.

0.10.37 (2026-11-11, installed): Stash v1 on the Keyframer page (Cockpit A2): save the ticked properties' animation, apply
at the playhead with the same easing, client filter. VERIFIED through the bridge on NEW TEST (exact values, Undo last,
overwrite guard, playhead check). NOT yet: a thumbnail, rename in the panel, tried by the user. Tests: 700 pytest + 24
skipped, node 236.

0.10.36 (2026-11-10, installed): Colour learning at export (TODO EL1): local records per client and camera, the "What the
editors did" report in the Color card. VERIFIED through the bridge on NEW TEST (own vs hand Lumetri, cameras from sidecars,
report). NOT verified: a real export from the Export tab starting it (the event itself is seen in the log since 0.10.7).
Office folders (EL0) not created: waiting for the user. Tests: 697 pytest + 24 skipped, node 231.

0.10.35 (2026-11-10, installed): Before export check (TODO I12): offline, black / flash frames, text outside the safe area
and caption overlaps, microphone clips over -6 dBFS (true peak of the used range + Volume, played channel only), fonts "?".
Read only. VERIFIED through the bridge on NEW TEST (levels against FFmpeg, safe area with a moved graphic, SYNC gaps). NOT
seen live: offline media, caption overlaps. Tests: 692 pytest + 24 skipped, node 231.

0.10.34 (2026-11-10, installed): Track names (TODO I7), Tools card: POV 1 / POV 2 by track order, POV n audio, Mic n,
Subtitles BG / EN; editor names kept; optional camera label colours; Put names back; automatic after Sync and rough cut.
VERIFIED through the bridge on NEW TEST (names, renumbering, colours and their restore, Put names back, auto after Sync and
rough cut). NOT verified: one Cmd+Z (needs a person), caption tracks (NEW TEST's sequences have no Asistent caption record).
Tests: 689 pytest + 24 skipped, node 223.

0.10.33 (2026-11-10, installed): Keyframer Elastic / Bounce (at the end, start or both; bounces; overshoot or height) and
Ping-pong / Loop after the last keyframe (times or until the clip ends). VERIFIED through the bridge on NEW TEST C0738 (Elastic,
Ping-pong replacing it, Bounce + Loop replacing that, Undo last, Linear + repeat refused). NOT yet seen by the user on screen.
Tests: 689 pytest + 24 skipped, node 214.

0.10.32 (2026-11-10, installed): Keyframer page (Cockpit plan A1). VERIFIED in Premiere 26.5.2 through the bridge on NEW TEST
C0738 (bake, replace, Undo last, Premiere ease). NOT yet tried: a sped-up clip, the handles dragged by hand, Overshoot on
screen. Baseline kept: 689 pytest + 24 skipped, node 202 -> 208 (6 new), ReShape golden identical.

0.10.31 (2026-11-10, installed): same panel and engine as 0.10.29 (the Cockpit Phase 0 probe of 0.10.30 removed). Phase 0
report: docs/probes/cockpit-phase0.md. Next in TODO CP: A1 Keyframer.

0.10.26-0.10.29 (2026-11-10, installed on this Mac, Premiere 26.5.2): S-Log3 under a LUT adjustment layer. VERIFIED by the user
in the Pulse project (IVO7V9795): the LUT-only layer is looked through, the timeline is judged converted, exposure applied by
the face (high), white balance left alone (mixed light). The exposure landed 0.7 stops over (+2.15): 0.10.29 scales an
overshoot back once (NOT yet tried in Premiere). Settings load after an engine restart (0.10.27, seen working: the
reference Lumetri was found after the retry).

0.10.25 (2026-11-10, installed on this Mac; Premiere 26.5.2): the field bugs of TODO F. VERIFIED in Premiere by Claude through the
bridge: the host's L/R split on NEW TEST while TEST.prproj was in front (the Fix audio "No active sequence." cause). Measured on
real files, NOT tried in Premiere: iPhone AAC track used beside APAC (IMG_0357.MOV loads A1 L/R); S-Log3 under a LUT-only
adjustment layer measured through it (needs the panel reopened once, then a press on a Pulse clip under its LUT layer); rough
cut on one long clip 149 -> 60 s. The panel in Premiere still runs 0.10.24 until it is closed and opened again.

0.10.24 (2026-11-10, installed, NOT tried in Premiere): the install check reads Adobe's list per Premiere (2026 and 2027 are both on
this Mac now; Asistent is listed in both). Premiere 2027 (27.0.0) and 2026 26.5.2 are untested with Asistent (it was built and
tested on 26.0.2).

0.10.23 (2026-11-10, NOT tried in Premiere): every client style joins the article to an English name (IPHONE-А);
the client's own brand takes none (GStroy, CREDISSIMO); ReShape, short and standard unchanged.

0.10.22 (2026-11-10, NOT installed, NOT tried in Premiere): Subtitle Style "AULA" (docs/SUBTITLE_STYLES/AULA.md): green
keywords, English names in Latin capitals with the article joined (IPHONE-А), AULA.BG. Five client styles from one Submagic
template.

0.10.21 (2026-11-10, NOT installed, NOT tried in Premiere): Subtitle Style "Beauty Sector" (docs/SUBTITLE_STYLES/BEAUTY_SECTOR.md,
names in Latin capitals), GStroy written GStroy (two-word names joined), no lone dashes, no one-letter line. Four client styles
from one Submagic template (Montserrat Heavy).

0.10.20 (2026-11-10, NOT installed, NOT tried in Premiere): Subtitle Style "ЕКОПАК" (docs/SUBTITLE_STYLES/EKOPAK.md), CREDISSIMO
always in Latin, Montserrat Black installed by the setup, `measure_style.py pace`. Three client styles (GStroy, Credissimo,
ЕКОПАК) share one template; cross-client knowledge for all tools in the vault's `editing/client-styles.md`.

0.10.19 (2026-11-10, NOT installed, NOT tried in Premiere): Subtitle Style "Credissimo" (docs/SUBTITLE_STYLES/CREDISSIMO.md): GStroy's
look with even two-line cuts, up to 4 words, red keywords suggested (money words); `scripts/measure_style.py` for the next
client. Colour findings in docs/CLIENT_COLOR/CREDISSIMO.md (proposal only).

0.10.18 (2026-11-10, NOT installed, NOT tried in Premiere): Subtitle Style "GStroy" measured on the client's 9 exported videos
(docs/SUBTITLE_STYLES/GSTROY.md): capitals, no punctuation, stacked two-line chunks with the last word underneath, green
keywords suggested, usual 0.03 s lead; engine tests and ReShape checks green. The look (Montserrat Black, green #94D000, glow) is
a Track Style the editor makes once. Colour findings from the same exports in docs/CLIENT_COLOR/GSTROY.md (proposal only).

Branch `improvements/2026-11` (the user's implementation prompt of 2026-11-08, priorities 1-6; nothing installed or
pushed yet): protected backup done and verified (tag `backup/pre-improvements-2026-11-08`, private backup, `docs/ROLLBACK.md`);
ReShape baseline in place (guard script, byte-exact baseline test, golden full-job check on the client's recording:
identical on a second cold run). Native graphics probed: not scriptable in 26.0.2 (no text or style write; docs/NATIVE_GRAPHICS.md), so not built. Benchmark built (docs/BENCHMARK.md); its three Masterhaus references wait for the user's word-by-word check, so no accuracy numbers yet. Open from the user (2026-11-09): rough cut on a 10-min video too slow (CPU recognition, cancelled after 326 s) and the cut not good, see TODO A; timeline labels (I7) next after probes. 0.10.17: the panel's settings (Style, English line, typed English, Move off faces' positions…) are kept by the engine, so updates no longer erase them. 0.10.16: the result lists every shot (clip, time, face found or not). 0.10.15: lines over a cut change height at the cut (keyframes); per-shot heights with two POVs. 0.10.14 verified by the user on one shot (9 lines under the face, text read on 3). 0.10.14: Move off faces measures where each line's letters are (Mac text recognition on the exported frames, words from Asistent's SRTs); the first test placed lines ~25 % too low. 0.10.13: Move off faces' false "nothing changed" fixed (the first press in NEW TEST did move the 9 lines). 0.10.12: Move off faces for upgraded subtitle graphics (client's height per shot, one Undo). 0.10.11 installed: ▶ plays the line in Premiere's Program Monitor and stops after it (the user: the separate player was heard twice); checked through the engine in NEW TEST. 0.10.10: updates now leave exactly one panel version (before, Premiere kept loading an old copy: 0.10.7 and 0.10.8 never ran here). 0.10.9 checked in NEW TEST through the bridge (review loaded, Lines to check, ▶ moved the playhead and played); the user's own listen and Review helpers off still open. 0.10.9: Captions tab review helpers, reasons under the lines to check (words vs timing, original → shown), Lines to check, Play with 1.5 s around a line and the playhead moved there; switchable. whisper.cpp measured: 7.3x faster but an invented line and a unit error, not adopted until the references are verified (docs/BENCHMARK.md).

0.10.8: a covered clip measured on its file gets only high-confidence corrections (an unchecked +2 stops went in on fx31030 in
NEW TEST); same values are not rewritten. Verified in NEW TEST through the bridge by Claude: 0.10.0 selection by track and
switched-off clips left alone, 0.10.4 hidden track above, cut piece with Asistent's Lumetri, Fix audio labels and relabel,
0.9.89 quick Exposure presses. Still needs the user: Cancel during a job, right-click / long press, the Export tab export.

0.10.7: Show exports fixed for the user's report (no Finder, or up to ~30 s late): the watcher now starts on a folder as soon as
it exists (the office drive mounts after the engine starts; before, nothing was watched until a project switch), and the office's
export tree `Production/Exported Videos` is watched through this Mac's file events, so an export into a new plan folder is shown
without waiting for Premiere's preferences. Verified on this Mac with a real Premiere export (ExtendScript direct export from NEW
TEST into a test tree): Finder showed the file ~3 s after the export ended. Not yet seen: an export from the Export tab into the
real office drive; whether Premiere's UXP export events fire for the Export tab (they do not for an ExtendScript export). The
running panel in Premiere is still 0.10.6 until the panel is reopened (the engine-side fixes work without it).

0.10.6: every valid finding of the independent audit of 0.10.1 fixed (CHANGELOG 0.10.6: BUG-001…014, PERF-001/002, ARCH-001…004,
UX-001, SEC-001/002). Checked in NEW TEST through the bridge: caption pair replacement by line times and sequence guid, subtitles
not placed after a sequence switch, Fix audio refusing a keyframed clip (overwriteClip measured to drop Volume keyframes), a
plain split and subclip reuse with the media tag, Highlights-only grade treated as the editor's, keyframed Exposure left alone,
the untouched Lumetri snapshot stable across clips, rough cut and Sync checks without false alarms, per-clip Lumetri notes.
Tests only: English line failing (BUG-002), take safety (BUG-012), English word revocation (BUG-013), same-folder Sync (BUG-011),
cancel (BUG-014: a real subtitle job cancelled through the engine stopped in 6.8 s with no result and no file; the panel half by a node test; the bridge cannot deliver a Cancel press while a job runs, so the button itself is unchecked), right-click / long press in UXP (UX-001), update rollback (ARCH-002, private
app folder), CUDA pins on Windows. Speed: decode peak 1644 -> 724 MB on 20 min stereo, aligner ~2.1 -> 0.9 s per window, both
bit-identical.

0.10.5: Show exports seen on a real export (late, ~10 s, and missed by the user; an older same-name file counted first; downloads in
Assets shown): now Finder within ~2-3 s, only Premiere's export folder and added folders, an older same-name file never counted.
Show again verified (Finder came to the front over Premiere). The faster timing not yet seen on a real export.

0.10.4: colour no longer gives up when a track above the clip is hidden (the user's safety template) or a visible layer covers a
clip with no other colour effects; Asistent's own Lumetri is recognised on cut pieces of the same file; Fix audio's L/R copies keep
the clip's label (a cut piece no longer turns green; a new press relabels older copies). Tests only (node + pytest); not yet pressed
in Premiere.

0.10.3: Show exports (Export tab only, the user's choice): the engine reads Premiere's preferences for the Export tab's folder,
watches it and shows a finished export selected in Finder; a queue shows its last file; Log lists them with Show again. Off by
default, switched on on the user's Mac. Engine tests (26) and a dry run on the real preferences and the user's 12:38 export
(found, whole, 125.9 s); not yet seen working on a real export. Media Encoder and Quick Export: later.

0.10.2: subtitles about 1.7x faster on a first run (ReShape 256 -> 130 s, Beauty Sector 89 -> 53 s, cold, same output on
ReShape) and English words written in English (Beauty Sector, Space, workshop). Measured on saved jobs outside Premiere (a copy
of the ReShape learning folder, nothing written to the office); not yet run from the panel.

0.10.1: Exposure ±0.5 moves only Exposure in a hand-set Lumetri too (not recorded as Asistent's; keyframed Exposure left
alone); tests with a fake Lumetri; not yet pressed in Premiere. 0.10.0's selection fix seen working in the user's MASTERHAUS
log (one press on V1 read one clip).

0.10.0: the selection is matched by track as well as time, so a clip on V1 (or A1) no longer also selects the clip with the
same cut on V2 (or A2, A3); colour leaves switched-off clips alone. Fixes the user's MASTERHAUS report (Auto color corrected
the switched-off POV on V2). Node tests with a fake Premiere; not yet pressed in Premiere. Open from the same recording: after
that press the Program monitor showed the V2 clip; Asistent never switches a clip on (no `createSetDisabledAction` call), to be
checked in NEW TEST.

0.9.99: colour buttons and Match POVs apply on the first click (no Apply step), the user's request; the same apply and frame
check code as before, so only the flow changed. Seen in the browser preview; not yet pressed in Premiere.

0.9.98 (the user's review of 0.9.97 on the ReShape video): cut-out media between clips is silent for Whisper (restores
„Затова“), edge scraps left out (the final „На“), adverb + participle kept, English cut by each line's own translation, plain
words, learned English word fixes, search on Enter. Checked with a full run on the ReShape recording (outside the office
folder); the panel (search buttons, English word fixes) in the browser preview only. 0.9.97's pair replacement worked in the
real ReShape project („earlier pair C4, C5, 122 lines removed“).

0.9.97 (the user's requests after the first learning test): a new subtitle pair replaces Asistent's own earlier pair (its lines
removed in one step; VERIFIED in NEW TEST through the panel's own placement code, 3 presses, plus 13 removals of 60 lines under
ExtendScript load, no crash; the emptied tracks stay); a line waits for its cut; lines keep adjective + noun, „може да“ and
25-character ReShape phrases (checked on the ReShape and 12 Ludi Glavi runs); NLLB 1.3B English (downloaded on this Mac, the
other computers get it from the Download button); a search box in the Captions tab (browser preview). Not yet pressed by the
user in a real project: Apply and rebuild with Whisper, the search box, the translator offer on a computer with only 600M.

The learning test passed in Premiere (the user, 2026-11-04): „масоните => мастните“ fixed in the Captions tab of the ReShape
project was recorded in the office folder and shown in Learned.

Phases 5-8 of the subtitle learning (0.9.96): "Who speaks" per track, agreement marks, the Learned list, measuring. Engine
tests and one real-audio check (Ludi Glavi); the panel seen in the browser preview only. The user tests 0.9.93-0.9.96 in
Premiere at once.

Subtitles learn from the editors' fixes (0.9.95): recorded in the client's office folder
(`Production/ReShape/ReShape Subtitle Learning`), used in the next videos after the sound check; Bulgarian writing rules.
Engine-tested end to end on the real ReShape recording with a temporary folder; not yet used from Premiere, so nothing has been
written to the office folder yet; not tried on Windows (the folder is found from the project path, so a project opened from
`\\server\Production\…` or a drive letter mapped to Production works; one mapped deeper does not).

Captions tab with editable English lines and tooltips above text boxes (0.9.94); engine-tested on a reference, not pressed in Premiere.


Every button acts on the mouse press (0.9.93, Premiere's focus took first clicks); the toast sits over the header text. The panel
loads in Premiere (bridge ping); clicks not yet tried by the user.


Toast with a coloured face and plain Exposure wording (0.9.92); seen in the preview, not in Premiere yet.

Exposure ±0.5 act on the mouse press (0.9.91): clicks after a write were taken by Premiere's focus (user's screen recording).
Not pressed yet; the log now shows focus changes and which event each press came as.


Toast (0.9.90): every answer also shows for a few seconds under the header. Preview only; check in Premiere that it appears
and hides by itself.


## Exposure −0.5 / +0.5 (0.9.88, user's request 2026-11-04)
Two buttons in the Color card add a fixed Exposure step to the selected clips' Lumetri (new / neutral / Asistent's own only).
0.9.88 pressed by the user on Masterhaus C0728 (every press written; quick clicks were dropped, fixed in 0.9.89, not pressed yet): in NEW TEST select clips, press +0.5 twice, Cmd+Z
once, check Lumetri shows the right Exposure; a clip with a hand-made Lumetri must be listed as not touched.

## Updates and installs (0.9.87, user's request 2026-11-04)
Updater from the GitHub releases (panel line + Update button), engine in `<app>/current`, `install.py` for Mac and Windows, release
zip with double-click installers, translator download button. **Verified on this Mac**: an update to a local test release (0.9.88)
installed engine, host and panel and restarted the engine within a second; the Mac is back on 0.9.87. Release v0.9.87 is published
on GitHub and read by the engine. **Not verified**: the update line in Premiere itself (seen in the browser preview), an update
from a real GitHub release, and everything on Windows (`setup_win.ps1`, the
registry entries, UPIA `/install`, the detached restart): run `Install Asistent (Windows).cmd` on the PC and one update there.

Installed on the user's MacBook (Premiere Pro 26.0.2, macOS 15.7, M4 Max): panel 0.9.48 via
UnifiedPluginInstallerAgent, engine 0.9.48 as LaunchAgent `com.contentstudio.asistent` (starts at login).
0.9.49-0.9.51 are skipped (a foreign build labelled 0.9.51 was seen on another computer, not in this repo).
Git: `tools/asistent` repo, last commit see `git log`. Tests: 329 pytest + 70 node, all passing at 0.9.48.

Legend: **Done + verified in Premiere** · **Done, engine-tested, NOT verified in Premiere** · **Partial** · **Planned**

## Audio L/L + R/R (0.9.56, user's request 2026-11-03)
The button splits every stereo clip into L/L (original place) and R/R (track below) through subclips with their own source
channel mapping, linked to the video (see CHANGELOG). **Verified in TEST.prproj by the user** (Audio Channels dialog) and by
readback of the timeline (placement, In points, links, repeat press without duplicates). Not tried: clips with a speed change
(skipped by design), nested sequences, locked tracks beyond the refusal message, a project where the bin „Asistent L-R“ was
renamed or the subclips deleted by hand (the clip is then split again with new subclips).

**0.9.57: balance + limiter** (user's request 2026-11-03, reference video of Dynamics on the Mix track). Engine-tested (4 new pytest on
synthetic speakers, real Masterhaus clips) and verified in TEST.prproj by readback of the effect parameters (single clip, second
press, four clips). **Confirmed by the user by eye in Premiere's Dynamics panel: Limiter on, Threshold −6 dB** (the API reports the
normalised 0.9; the −1 dB default = 0.98333 fixes the scale). The limiter is per clip, not on the Mix track (not scriptable).

## Subtitles in the reference style (R, started 2026-11-04, in progress, nothing built into the panel yet)
Spec from the user's references in `docs/SUBTITLE_STYLE.md`; translator and font installed. 0.9.85: English line (translate.py, second
caption track, same times), engine-tested on the ReShape reference and placed in NEW TEST; button not pressed by the user yet.
0.9.86: the style measured on 7 of the client's videos (625 lines) and built as Style "ReShape" (lines, no punctuation, 0.18 s lead,
English without marks); the placement rule for "Move off faces" measured (one height per shot, 0.11 under the chin). Engine-tested on
the client's videos; not pressed in Premiere. Next: TODO "R".
Bridge probes added (test projects only): `graphic_text` (UXP cannot read or write a Premiere text graphic's text), `graphic_move`
(moving a graphic in one Undo step works).

## Subtitles: caption track again (0.9.81, 2026-11-04, uncommitted)
0.9.80 placed every line as a text graphic from Asistent's After Effects template (verified in NEW TEST: 25 lines in 2.0 s, identical);
0.9.81 goes back to the caption track because the user must restyle all lines at once in Properties, which only Premiere's captions
and own text graphics allow (DECISIONS). Caption placement checked in NEW TEST through the engine (25 items). Button not pressed yet.

## Speed with many clips (0.9.73-0.9.79, 2026-11-03/04, uncommitted)
Every change compared against the HEAD code on real footage: identical results. Measured in NEW TEST.prproj through the bridge
(24 clips): Auto color 23 s for the whole press (frames batched, one skipped export retried), Sync cameras 6.7 s (was 11.2 s);
rough cut replay 12.1 -> 2.8 s (not pressed in Premiere: the bridge selection failed in the SYNC sequence). Open: TODO "P".

## Panel redesign (0.9.68-0.9.72; 0.9.72: own buttons (div.btn) after the CSS probe in Premiere, bridge presses verified; 0.9.69-0.9.70 fix what the user's first look in Premiere showed, user's request and approved plan 2026-11-03)
New layout (answer at the bottom, compact feature cards with ⓘ, Developer card), colour tokens, unified buttons, inline SVG icons, CSS probe, browser preview with screenshots (see CHANGELOG). Checked in the browser preview at 240/300/420 px in ten states; installed in Premiere and the panel loads and answers the bridge (so `main.js` runs to the end with the new markup). **Not yet looked at in Premiere by the user**, and `css_probe` not yet run there (needs TEST.prproj open): open the panel, check every card, the ⓘ toggles, the Developer card, a run's answer at the bottom and Hide, and the icons.

## 0.9.67 (user's requests 2026-11-03: fix the bugs, correct words in the subtitles, a click-to-edit caption list)
Captions tab with one editable field per subtitle line (see CHANGELOG), muted/disabled audio left out of the rough cut, rotated files described upright in the rough-cut XML. All engine- and node-tested; **none of it seen in Premiere**: press Subtitles on a clip, open Captions, fix a word, Apply and rebuild; mute the camera-microphone track and press Rough cut; run the rough cut on the vertical Sony clips.

## Language (0.9.66, user's request 2026-11-03)
The whole tool is in English: panel, messages, names of what it creates in Premiere, scripts, README. The Bulgarian language data of the subtitles and the take finder stays. Tests pass; **not yet seen in Premiere** (open the panel: every button and tooltip English, then one press of each section in TEST.prproj). Button-name map in CHANGELOG 0.9.66. Older docs (PROGRESS, CHANGELOG entries before 0.9.66, plans) still use the old Bulgarian button names.

## Phase 8 rough cut (0.9.59-0.9.64, user's go-ahead 2026-11-03; plan `docs/ROUGHCUT_PLAN.md`)
M0 probes verified in TEST.prproj (XML import path). M1-M2 (speech map, pauses, EDL, XML, card, effect carry-over) were pressed by the user in TEST.prproj through several test rounds; "the cuts are better". Latest user report (0.9.63): the rows connect once the quiet, unused audio track (the camera's own mic, A1) is deleted; with it selected it counts as sound and leaves gaps in the other camera's row (open, BUGS.md). The user also says the effects of „Оправи звука“ still do not transfer; read back through the API on the new sequence's clips (TEST.prproj, 2026-11-03): Volume level (A2 -2.9 dB, A3 -10.2 dB, equal to the source) and Dynamics → Limiter -6 dB are there, the L/L and R/R channel routing cannot be read through any API, so what the user means is not yet known (BUGS.md).
M3 (0.9.64-0.9.65): `takes.py` finds repeated takes, false starts and restarts; 0.9.65 cuts a plain repeat in both modes (from the first take to the last full one, over short setup talk), lists a group said differently. 0.9.64 was pressed by the user (it only listed, "it kept all 3"); 0.9.65 replayed on that input by number, **not pressed in Premiere**. Open: vertical footage with a rotation flag comes in sideways (BUGS.md). Not built: the „Преглед“ view to pick another take and rebuild, the take score (M4), `scripts/eval_roughcut.py`.
Colour buttons: the user confirmed in Premiere 2026-11-03 that they are there and work.

## Colour buttons (0.9.58, user's request 2026-11-03, TODO B7)
Card ЦВЯТ: „Авто цвят“ (= the old „Бяло и експозиция“), „Бяло“ and „Експозиция“ (the same analysis and apply, narrowed to one
correction), and „Изравни POV-тата“ (= Auto Shot Match, renamed). No engine change. Contrast and Saturation have no single-clip
algorithm, so they are not separate buttons; they are matched inside „Изравни POV-тата“. Node-tested; **NOT yet tried in Premiere**
(press each new button in TEST.prproj: Бяло and Експозиция on a clip, a second press, Авто цвят afterwards, then Match POVs).

## Panel layout (0.9.55, user's request 2026-11-03)
Cards per feature (title, one-line purpose, buttons), tooltips on every button, three views: Инструменти / Дневник
(report + last 10 results) / Преди / след (colour previews with the Приложи buttons). Node-tested (wiring) and rendered
statically at 320 px in Chrome; NOT yet verified in Premiere (UXP: tooltip positioning, hover events, tabs).

## Phase 1 — architecture (Done + verified)
UXP panel + Python engine on localhost, setup/release scripts for Mac, engine autostart. Windows script
`scripts/setup_win.ps1` written but never run.

## Phase 2 — Smart Auto Sync (Done + verified)
- Engine `sync.py`/`groups.py`: per-channel GCC-PHAT + onset candidates, quick reject, independent windows,
  5 ms tolerance, drift ≤ 100 ppm only over ≥ 60 s, groups of High pairs, same-folder pairs skipped,
  parallel, audio cache. Real footage (GStroy 9x16, FX3 + FX30, 28 clips): 10 groups, 0 false, ~6.6 s.
- Panel: timeline selection → new sequence `SYNC – <sequence>` in bin `SYNC`, one track per camera folder,
  groups in timeline order; verified in Premiere 0.3.1 (28/28 clips placed, max 8.3 ms = half frame).
- 0.9.52: no markers are written into the SYNC sequence any more (they were labels only; the group list is in the panel).
  Node-tested; NOT yet verified in Premiere.
- 0.9.53: groups and unsynced clips in recording order (`chrono.py`: creation_time + camera clock difference learnt
  from the synced pairs; fallback to the editor's timeline order, reported). Engine-tested on the GStroy footage
  (FX30 clock 731 days behind FX3, 12 pairs within 2.1 s, lone clips interleaved); NOT yet verified in Premiere.
- 0.9.54: false „несигурно“ fixed for speakers at different distances (20 ms band rule) and confirmed/vetoed by the
  cameras' clocks. Engine-tested on Masterhaus (7 → 10 pairs, all clock-consistent within 0.8 s) and GStroy; the user's
  own pair fx39059/C9052 (GStroy КП-10) is not on this Mac, so it is NOT verified; panel text NOT verified in Premiere.
- Not done: manual sync for very short clips (< 8 s, only listed); sub-frame audio alignment.

## Phase 3 — Smart Audio (Partial verification)
- Engine `audio.py`: kinds one_channel, dual_mono, safety, phase_inverted, stereo_mic, same_voice, two_mics,
  uncertain, silent; loudness BS.1770 to −17 LUFS, peak ≤ −6 dBFS, noise cap −55 dBFS, ±30 dB; split refused
  when both channels carry one sound; phrase leveling with Volume keyframes (`phrase_plan`).
- Panel buttons: „Оправи звука“, „Раздели L/R“, „Раздели R/L“, „Само L“, „Само R“, „Само сила“, „Изравни фразите“.
- Verified in Premiere: Fill effects exist („Fill Left with Right“/„Fill Right with Left“), Volume Level uses
  Premiere's scale (0.1778 = 0 dB, max 1.0 = +15 dB), clone copies only the audio item.
- NOT verified: one Undo per press, „Раздели R/L“, „Изравни фразите“ keyframe positions. Level unit: always Premiere's scale since 0.9.9
  (the old guess misread a clip at +15 dB).

## Phase 4 — Auto import (Done + verified)
watchdog folder watching, browser-download completion (rename = ready after 0.3 s, copies 1.5 s), categories
MUSIC/SFX/BROLL/IMAGES/GRAPHICS/OTHER, one folder ↔ one project, no duplicates, long-poll to the panel,
import in place into bins. Verified 0.7.0 (Epidemic music/SFX, Shutterstock 4K B-roll). Speed-up of 0.7.1
not confirmed by the user.

## Phase 5 — client profiles + Prepare Project (Planned; postponed by the user to the office)
`engine/asistent/profiles.py` and `engine/asistent/prepare.py` exist as a first draft: not wired to the
server or panel, no tests. Basecamp text parsing not started.

## Phase 6 / colour engine (Partial)
Done, engine-tested (`tests/test_color.py`, 18 tests): `color.py` — frames read with rotation-aware size,
linear Rec.709 (BT.1886) and S-Log3/S-Gamut3.Cine (gamma from Sony sidecar XML), exposure from skin
(target 0.62 encoded luma) or mid-tones in 0.5-stop steps ±2, white balance from the largest near-neutral
group inside the camera-cast range checked against grey world, confidence rules, previews (720 px),
`check_render`, `Calibration` (Lumetri slider units), `probe_measure`.
Panel: „Цвят: бяло и експозиция“ → preview + „Приложи сигурните“/„Приложи и средните“ → appends Lumetri
(`AE.ADBE Lumetri`) and sets Exposure/Temperature/Tint; render check with `Exporter.exportSequenceFrame`.
„Проба на Lumetri (тестов проект)“ capability probe.
- Verified in Premiere: Lumetri appended on C0730 (0.9.4), 130 parameters enumerated, frames exported.
- **First real „Приложи“ (12:21, fx31032, 0.9.13):** +1.5 stops suggested, written as 1.5 units (pre-curve);
  render check worked: skin still 0.28 stop short (the Exposure shoulder), 3.95 % newly clipped → stepped back
  to 1.0 in a second step (3 Undo steps in all: append Lumetri, values, step-back); white residual 0.048
  (neutral). The same check learnt Temperature −84 (biased by the simultaneous Exposure change): removed,
  backup `lumetri.before-0.9.14.json`.
- 0.9.14: Exposure suggestions carry Lumetri units from the probe's curve (`exposure_curve` in `lumetri.json`,
  brightening only; darkening still 1:1, unmeasured); the panel writes units and shows stops = units.
  Probe values (`probe` in `lumetri.json`: temp −50, tint −66.67) are authoritative; a render check learns
  only an axis the probe never measured and never from a render that also changed Exposure.
- **Apply with the curve verified (12:29, fx31032, 0.9.15):** +1.5 stops → Exposure 1.7 units; skin 0.14 stop
  short (was 0.28 with 1:1 units), white residual 0.047 (neutral), Temperature −5.1 / Tint 2.4 from the probe
  values, nothing learnt (correct). 5.6 % newly clipped → stepped back a fixed 0.5 to 1.2 units: that final
  state is NOT re-checked (skin likely ~0.5 stop under again, clipping after the step unknown).
- 0.9.16: the step-back is measured: `pullback_units` (engine, from the before/after frames and the probe
  curve) takes Exposure back only as far as needed for ≤ 3 % new clipping (on the 12:29 frames: 0.35 units
  instead of the fixed 0.5); the panel then exports one more frame and reports the real clipping and how far
  the brightness is from the target. No further automatic step (Undo stays at 3 at most).
- **Step-back verified (12:40, C0739, 0.9.16):** +0.5 stops → 0.65 units, skin 0.007 stop from target;
  4.42 % newly clipped → pull-back 0.15 units → re-check 3.08 % (limit 3 %, the engine would have taken
  another 0.05), skin 0.10 stop dark (on target). The old fixed 0.5 would have left 0.15 units.
- 0.9.17: final clipping verdict (reporting only, the exposure path of c289c31 untouched): ACCEPTED ≤ 3.00 %,
  ACCEPTED_WITH_WARNING up to +0.25 points (`CLIP_SOFT_TOLERANCE`, per call `clip_tolerance`) or when the
  excess is only in areas already near white before (≥ 0.90: lamps, windows, sky), REVIEW_NEEDED above that
  or when skin TONES (skin-coloured, < 0.90 before) clip on > 1 % of the skin area; a first check followed by
  the step-back is STEP_BACK, not a verdict. Never triggers another correction. Replayed on the C0739 frames:
  first 4.42 % → 0.15 back (unchanged) → recheck 3.08 % ACCEPTED_WITH_WARNING with the specified message.
  Found while replaying: the skin box also catches warm near-white highlights (C0739: 189 scattered pixels at
  0.94-0.97), so skin clipping counts only skin tones below 0.90.
- 0.9.18: analysis on timeline renders (spec T13/T18). The panel exports 4 frames per clip from the sequence
  (720 px, evenly inside the clip, moments under an upper layer skipped, `moments.js`), the engine measures
  them as Rec.709 with any existing correction included, so a corrected clip measures as fine. Fewer than two
  usable frames (covered, export failed) → measured on the file, `status: REVIEW_NEEDED`, confidence low
  (shown, never applied). Log sources measured on the timeline: confidence low until the colour-management
  step shows whether Premiere converts them.
- 12:58 (C0739, 0.9.18): analysis measured on 4 timeline frames (verified); the clip had no correction (the
  12:40 one was undone), so +0.5 again was right and the apply reproduced 12:40 exactly. Bug found: the final
  re-check was labelled STEP_BACK. 0.9.19: the panel sends `final` on the re-check; the engine then gives the
  verdict only (replayed on the real frames: ACCEPTED_WITH_WARNING, the specified message).
- **Re-run on a corrected clip FAILED at 0.9.19 (13:08, C0739 with Exposure 0.5 on it):** suggested +0.5 again;
  the four 720 px timeline frames were byte-identical to the uncorrected ones from 12:58, while the 480 px
  check frames follow every change. 0.9.20: analysis exports at 480 px, plus one 720 px diagnostic of the
  first moment (log line `diag720`: mean luma at both sizes) to confirm whether the size is the cause.
- 13:12 (0.9.20): still +0.5. Size is NOT the cause (moment 0: 480 px 0.576, 720 px 0.5725 = the uncorrected
  12:58 value), and a fresh 480 px render is also uncorrected, so not a stale cache: Premiere renders the
  correction at the clip's middle (0.573 → 0.627 at 13:06) but not at the analysis moments. Suspected: the
  value written by „Приложи“ is time-dependent (keyframe). 0.9.21 logs the clip's Lumetri state
  (`diag lumetri`: value, isTimeVarying, keyframes, value at the moments) and the middle frame (`diag frames`).
- 13:16 (0.9.21): Premiere reported NO Lumetri on C0739 and the middle rendered uncorrected (0.5732): every
  re-run so far started from a clip whose correction had been undone, so the analysis was right each time and
  the keyframe theory is wrong (Exposure is a constant, stopwatch off). Idempotence still to be shown with one
  „Цвят“ press right after an apply. The diagnostics stay until then.
- 0.9.22 (user's rule: one static best-effort value per clip, no keyframes; a clip too far gone gets what is
  possible within the range and the work moves on): out-of-range clips say so („извън обхвата… не се гони“);
  one failing clip no longer stops the analysis or the apply of the others.
- **Re-run on a corrected clip VERIFIED (13:24, fx39026, 0.9.22):** with Asistent's Temperature −4.7 / Tint 12.5
  on the clip (diag lumetri confirms), the timeline analysis measured the white as balanced (cast 0.05/−0.008,
  was −0.094/+0.187) and suggested no new white correction; exposure +2 was still suggested because it had
  not been applied (exposure was medium confidence, „Приложи сигурните“ = high only).
- Gap found: „Приложи и средните“ afterwards was refused („вече има Lumetri с промени (temperature, tint)“):
  the never-touch-a-grade rule also blocks Asistent's OWN correction, so a missing exposure cannot be added.
  Needs managed correction ownership (TODO.md B6).
- Bug (user, fx39024 13:25): with a high white and a medium exposure only „Приложи сигурните“ was shown (buttons
  counted clips, 1 = 1), so the exposure could not be applied even on a clean clip. 0.9.23: `colorplans.js`
  counts corrections; „Приложи и средните“ appears whenever it adds one; „сигурните“ names what it left out
  (with the Undo hint until B6 exists).
- **Verified 13:34 (fx39024, 0.9.23):** both buttons shown; on the clean clip „Приложи и средните“ applied
  Exposure (+2 stops, capped: the clip measured +2.43) with Temperature/Tint; 1.74 % new clipping (ACCEPTED),
  white residual 0.05/−0.05 (neutral), skin still 0.68 stop under target (out-of-range clip: one capped pass,
  as the user wants). The first try at 13:34:17 was refused by Asistent's own earlier Lumetri (B6 gap again).
- 0.9.24: managed correction ownership (B6). After every write the panel fingerprints the whole Lumetri (all
  parameters) and the engine keeps the sha1 per clip (path + source in/out, `managed.json`, last 6 states, so
  an undone step-back still counts). An existing Lumetri is updated only when its fingerprint matches; then the
  new suggestion (a difference, measured on the timeline) is added to its current values; the render check
  gets the differences. Any manual change → not Asistent's → never touched. Lumetris written before 0.9.24 have
  no fingerprint and stay protected.
- **Ownership verified (16:12-16:13, fx39024, 0.9.24):** „сигурните“ wrote the white and recorded it; „средните“
  recognised Asistent's own Lumetri and added Exposure 2.1 to it; after the user moved Exposure to 1.9 by hand
  the next apply left the clip alone. Bug: step 2 also moved Temperature −4.9 → −0.2 and Tint 12.8 → 11.5: the
  render check called the white neutral (residual 0.096 < 0.1) but the re-analysis flags from 0.08 and
  „corrected" it back. 0.9.25: on Asistent's own Lumetri a white within the check's limits (0.1 / 0.06,
  `WHITE_OK`) is kept; the refine step uses the same limits. NOT verified in Premiere yet.
- 0.9.26: temporary diagnostics removed (4 timeline frames per clip again). Statuses + audit (B4): every clip of
  a press gets CORRECTED / ALREADY_BALANCED / REVIEW_NEEDED / REVERTED / PARTLY_REVERTED / BLOCKED / FAILED
  (shown next to the clip name) and one JSON line in `color_audit.jsonl`. Accept/revert (B5): every check
  measures before and after; a part (white, exposure) that ended measurably worse than before this press is
  put back to its previous value in one extra Undo step („Asistent: върни влошеното“). White: worse = outside
  the neutral limits AND further than before; exposure: further from the target by > 0.15 stop (overshoot).
  Clipping is never a revert gate (user's rule). A refined white now also gets the final re-check.
- **Verified 16:17-16:25 (0.9.26):** statuses and audit records written (fx39026 CORRECTED twice, gates white
  better / exposure better, no revert); ownership in real use: „сигурните“ (white) then „Цвят“ + „средните“
  added Exposure 2.1 to the same Lumetri in one Undo step, white kept (fx39024, fx39026). Found: a white refine
  wrote the same sliders again (−4.7/12.5: extra Undo step, identical re-check); the Undo hint was outdated; the
  second press showed no result line. 0.9.27: refine skipped when it would not change the sliders by ≥ 0.5,
  every check shows one result line, hint says „Цвят“ + „Приложи и средните“ (no Undo).
- Observation (fx39027 16:19): skin exactly on target (0.0005) but 6.4 % of the skin area clipped → REVIEW_NEEDED:
  the 0.62 skin target may be too bright for some faces (input for „exposure taste“, TODO.md B9). Attempt 12:26 on fx31031 was skipped: the
  clip already had a graded Lumetri (left alone by design); 0.9.15 no longer reports such a press as „Приложено“.
  Earlier probe runs 12:03-12:10 (0.9.10/0.9.11) were invalid (queued exports, reused file names); their calibration
  is kept aside in `lumetri.before-0.9.12.json`.
- **Probe VERIFIED at 0.9.13 (12:16, C0737, TEST.prproj):** 7 distinct frames written in order ~0.33 s apart;
  source and empty-Lumetri frames byte-identical (an untouched Lumetri changes nothing). Table: white balance,
  exposure, contrast, saturation SUPPORTED; skin tones PARTIAL (global only); colour management PARTIAL (clip
  input/embedded LUT readable, here none). Indices: Temperature 14, Tint 15, Saturation 16, Exposure 19,
  Contrast 20. Checked pixel by pixel on unclipped pixels:
  - Temperature +50 = pure channel gains R +0.41, G −0.09, B −0.59 stops (spread ±0.02) → −50 units per log2 B/R.
  - Tint +50 = R +0.49, G −0.26, B +0.49 stops → −66.7 units per log2 G/√(RB). Same values on C0729 → clip-independent.
    `lumetri.json` now holds only these (temp −50, tint −66.7).
  - Exposure +1 is NOT a plain gain: +1.00 stop in shadows (encoded luma < 0.2), +0.92 at 0.3–0.4, +0.79 at
    0.5–0.6, +0.68 at 0.6–0.7, +0.57 at 0.7–0.8 (soft highlight shoulder). Skin (target 0.62) gets ~0.7 stop per
    unit, so the planner must use this curve, not 1 stop/unit (next step).
- Not implemented from the colour plan: analysis on timeline renders, colour-management/double-transform
  check, statuses + audit log, contrast, saturation, skin tones, shot match, Auto Color, accept/revert,
  managed correction ownership. See `COLOR_CORRECTION_PLAN.md` and `TODO.md`.

## Test bridge (0.9.35, user asked 2026-11-01)
So that Claude can run Premiere tests itself: the panel long-polls `GET /dev/poll`, runs `ping`, `state`, `selection`,
`timeline`, `select`, `click <label>`, `wait_idle`, `frame`, `lumetri`, `chain`, `set_lumetri` (one clip, existing Lumetri only), `api` and answers via `POST /dev/result`;
`scripts/dev_cmd.py` is the developer side. Off unless `~/Library/Application Support/Asistent/devbridge.enabled`
exists (`dev_cmd.py on|off`); the panel refuses everything but `ping` unless the open project is TEST.prproj; localhost and
`X-Asistent` only; commands are logged. `select` (TrackItemSelection) is unverified on Premiere 26.0.2 (the classes exist).
First measurement through it (2026-11-01 18:40, TEST.prproj, fx39026 middle piece 125.6-131.4 s, Lumetri Exposure 4.3):
swept Exposure 0/1/2/3/4/5/2/4.3 with one exported frame after each: the export was byte-for-byte the same picture every
time (mean luma 0.456, p95 0.944), equal to the model at ~1.0-1.55 units at four moments of the piece, while the
neighbouring pieces (Exposure 2.1) matched the model (0.566/0.561 vs 0.571/0.569). The Lumetri readback was right every
time and there is only one Lumetri and no other effect on the piece: the frame Premiere exports for that piece is stale
(not the live render; suspected rendered preview files, not confirmed). Values restored to 4.3 afterwards. Consequence:
the render check cannot judge such a piece; 0.9.34 already says so for identical before/after frames, but a stale frame
that differs from „before“ (e.g. left from an older state) is not detectable by the engine.

## Phase 7 subtitles (in progress)
Plan `docs/SUBTITLES_PLAN.md` (user accepted the recommendations). M0 probes done at 0.9.39 (bridge commands
`srt_import`, `caption_place`, `transcript_export`): SRT import works, automatic caption placement does not, Premiere
transcript export needs a transcribed clip. The user dragged both test SRTs over the sequence: Cyrillic correct with and without BOM (writer: UTF-8 + BOM). M1 text core built at 0.9.40 by feature-builder (`bgtext.py`, `subtitles.py`, 29 tests, nothing wired, nothing verified in Premiere or on real Whisper output). Deviations: nominal 11 chars, soft limit 16; glued number phrases may exceed 2 words in the short preset (kept whole); case/punctuation as Whisper gives them. M2 ASR built at 0.9.41 (user approved the downloads 2026-11-01): `asr.py`, `requirements-asr.txt` (faster-whisper 1.2.1,
ctranslate2 4.8.4, tokenizers 0.23.3, huggingface_hub 2.4.0, onnxruntime 1.31.1, av 19.0.2; installed in the engine
venv, +~250 MB), model `Systran/faster-whisper-large-v3` 3.09 GB in `~/Library/Application Support/Asistent/models/whisper`,
`GET /subtitles/model`, job `POST /subtitles/model/download`, `--subtitles` / `-Subtitles` in the setup scripts.
Measured on this Mac (M4 Max, CPU int8): model load 1.8 s; 29 s of audio in 10.2 s and 54 s in 19.4 s (2.8x real time,
better than the plan's 20-60 s per minute); Bulgarian recognised (GStroy clips, sparse speech), 2 of 52 words below p 0.5.
Windows CUDA is untested.
**M3 built at 0.9.42** (dialogue mix + job + panel section; user verification in Premiere pending): `dialoguemix.py`
(selected audio items → one 16 kHz mono signal at sequence time; a one-sided lavalier uses its sound side, two mics are
summed, otherwise averaged; the buffer starts at the earliest item), `subtitle_job.py` + `POST /subtitles` (validates
at once, runs Whisper through `asr.py`, caches the words by mix + prompt in `cache/subtitles/` so a preset or fps change
does not run Whisper again, builds captions with `subtitles.build_captions`, writes `<project folder>/Asistent_subtitles/
<sequence> <date-time>.srt` + `.json`, nothing is sent to Premiere), pure `panel/subtitleplan.js` (selected audio items;
skips speed ≠ 1, reversed, offline/nested; an item covered ≥ 50 % by a lower-track item is a duplicate and named),
`panel/premiere-subtitles.js` (reads the selection, frame size and fps, project folder), panel section „СУБТИТРИ“ with
„Субтитри (български)“ and, only when the model is missing, a button naming the size („Свали модела (около 3,1 GB)“)
that is the only thing starting the download. Result in the panel: counts, uncertain words, skipped clips, first 8
captions, file path. Verified by tests: mix at the right sequence times with a silent gap, overlap sum clipped, request
validation, cache hit, auto preset by sequence shape, cancel writes nothing (16 + 1 pytest, 9 node + 1 wiring).
Verified end to end through the live engine on a real clip (fx39011, 11 s, Bulgarian): 4 captions / 8 words in 10.1 s
(2.8x real time), times start at the item's sequence position, second run (other preset) 0.2 s from the cache.
**Verified in Premiere (user, 2026-11-01 21:56, TEST.prproj, SYNC sequence 2160x3840 at 59.94 fps):** the section works:
4 selected audio items, 4 more skipped as „дублира A1“ (duplicate rule works), frame size read as 2160x3840 (so one of
`getVideoFrameRect`/`getVideoFrameSize` exists) → preset „кратки“, 34 captions / 60 words (8 uncertain) from 23.4 s of
mix in 19.7 s, SRT + JSON written in `<project folder>/Asistent_subtitles/`. Not yet judged by the user: Bulgarian
accuracy and caption timing against the picture. Observation: in the short preset glued function words give captions
longer than 2 words („и аз да видим“, „то и за граднината“); the M1 rule is „function words never end a line“, so this is
by design but may look too long for 9:16: ask the user. „Имена и термини“ (Whisper prompt) has no field yet.
**0.9.43: accuracy fix (user: „a lot of words are wrong“).** Cause found by running the same speech from every source
through Whisper (8 GStroy clips): the camera-mic copies on the lowest track (C90xx: speech −42…−53 dBFS, SNR 14–26 dB)
gave wrong words („Природа на мен“, „граднина“, „сършила“) while the other camera's close mic (fx390xx: −16…−25 dBFS,
SNR 38–51 dB) gave „Примерно на мен ми трябва“, „градината“, „свършила днеска“. Fix: duplicates are now decided by the
engine (`dialoguemix.py`), not by the lowest track: items that overlap ≥ 50 % of the shorter one AND follow the same
loudness envelope (correlation ≥ 0.5, lag ±0.25 s) are the same speech; the cleanest copy wins (speech level over
noise floor; within 3 dB the lowest track), and the part of a weaker item the winner does not cover is kept. The panel
now sends every eligible item with its track; the result lists each replaced copy with both SNRs. The result JSON
keeps `items` so a run can be reproduced. Also measured and rejected: a descriptive Whisper prompt (hallucinated
„Ремонт на български език за ремонт“, worse text), VAD filter (drops speech), `condition_on_previous_text=False`
(no gain, one hallucination), beam 10 (little gain, +20 % time). **Not verified in Premiere at 0.9.43; the user must
press the button again on the same selection.** Timing („a little off in many places“): not changed yet; Whisper's word
times are only about ±0.1–0.3 s accurate. A quick onset test on the clips was inconclusive (noise events), so no snap
was added blindly. Open: ask whether captions are early or late (a fixed offset would fix a systematic shift);
otherwise forced alignment (MMS_FA, torch, ~1–2 GB, needs the user's OK) per `docs/SUBTITLES_PLAN.md` M6.
**0.9.48 (user: C9025 took too long and had listed errors; guide `docs/BULGARIAN_TRANSCRIPTION_GUIDE.md` added).** Verified on C9025 in the LIVE engine from a cold cache: **230 s → 31 s** (91 s of audio read instead of 252 s; windows read in parallel). Every row of the user's list: „одяло“ ×2 → „одеяло“ ✓, „септември“ → „Само 20 евро.“ ✓ (the wide reading hears it; Whisper's language model had read a date), „одялоце“ → „одеялце“ ✓, „Взиваме“ → „Взимаме“ ✓ (vocabulary of the recording), „5 ,79“ → „5,79,“ ✓, comma before „я взимаме“ ✓ (grammar rule, no pause exists there: 0.04 s), „одялоците“ → „за одеялце, бе?“ (the wide reading hears „одеялце“) ✓. NOT changed on purpose: „го взима“ is now „го взимам“ (the sound supports a swallowed ending, forced-alignment scores 0.72/0.71/0.61 for взима/взимам/взимаме; the guide says verify), left as heard and not flagged because both are real words.
The nonsense at 00:19-00:22 was Whisper's language model hearing „двайсет евро“ as „2 септември“ with 2 s of context; with 4 s the price is right. The „repeated transcription“ at 00:26-00:34 is not a duplicate: the video repeats its pattern (item, price question, „Само 20 евро. Взимаме го.“) and the two sentences come from different clips (C0731 and C0733).
Timing on C9025 (`scripts/check_subtitles.py`): median 0.00 s, 13 of 19 words after a pause within 80 ms (the +1 s entries are the checker's own artefacts: „Колко“ really starts at 6.80 s). Measured cause of the earlier late „евро“ (0.3-0.5 s): numbers were never aligned (no letters) and the aligner's low confidence discarded good times; test on the lowest-scored words: aligner 57 % within 80 ms, Whisper 7 %.
Checked against Ludi Glavi again: pad 6 s merged windows read „Превърна мен“ for „Примерно на мен“ (too much of the other takes), pad 4 s is right; the acoustic-fit arbiter between a wide and a narrow reading chose correctly in only 4 of 7 disputes, so it is not used. Still wrong there: „той за градината“ (both are words: nothing flags it), the end phrase (no correction line given this time).
Left for the user to listen to (all marked in the panel): C9025 0:10.5 „Така.“ (quiet noise, no clear speech), voiced sound without a word at 0:00.3-0:00.9 and 0:12.3-0:12.8, „Ах,“ (cut by the clip start).
Guide items NOT implemented, with reasons: per-speaker male/female metadata (needs speaker separation; the user removed the global setting; first-person forms are only flagged when readings disagree), a clean-read mode, WER/CER against a human reference (no reference transcript exists).
**0.9.47 (user: more correct now, timing still a bit off in places; no speaker gender, both speak).** Speaker setting and `gender.py` removed. Measured where timing can still be off (final run, `scripts/check_subtitles.py`, plus a switch-vs-loudness-dip test): word starts after a pause median +0.01 s, 13/14 within 80 ms; at caption switches inside continuous speech the median is -0.005 s but 6 of 15 switches are 50-120 ms late („мога и един“ +0.085, „и накрая“ +0.081, „съм свършил“ +0.12, „А уж,“ +0.11) and 2 early („какво ще трябва“ -0.10, corrected „трябваше“ -0.13); aligner boundaries between touching words are within 50 ms of the nearest loudness dip in 46 % (Whisper: 20 %). The aligner has about ±40 ms resolution (20 ms frames). Tail hold cut 0.3 → 0.15 s (captions lingered ~0.4 s after the speech). Not done on purpose: snapping boundaries to loudness dips (the dip is not ground truth and the check would be circular). Needs the user's places (time + early/late) to go further.
**0.9.46 (user's list of 2026-11-02): corrections, gender, timing checks. Verified through the real panel in TEST.prproj (bridge): corrections matched, male form applied, 24 captions on C3, Premiere items equal the SRT cues within 0.033 s.**
User ground truth: „раф“ → „рафт“; „сума ти нища“ → „неща“; the end „ще чакай да бъде десом“ is „трябваше да боядисам“; speaker is male. Whisper reproduces the wrong end in every setting (beam 10, no fallback, float32 instead of int8, shorter windows); only a hint word steers it („боядисвам“). So the fix is the correction line, which re-times the new words (aligned by the sound), not a text swap.
- Checked against the audio (`scripts/check_subtitles.py`, final run): 0 stretches of voiced speech without a word (the two loud gaps are noise, centroid 3-4 kHz); onsets of words after a pause: median +0.01 s, 13/14 within 80 ms, worst 0.10 s („мога“); 0 captions over silence.
- Punctuation: the commas the user questioned have real pauses behind them („мен,“ 0.42 s, „А уж,“ 0.72 s); commas without a pause are list items. Left as written. „какво ще трябва“: the same in every reading (0.7/2/4 s of context), no evidence against it.
- Aligner score is NOT a correctness signal (correct short words score 0.44-0.47, the wrong „десом“ 0.59), so it is not used to flag words.
- The corrected „трябваше“ is the one word the aligner cannot find (score 0.00 in any window: spoken very fast); it is fitted between „стена“ (ends 22.62) and „да“ (22.94); „да боядисам“ aligns well (0.74/0.66). The audio has a dip at 22.65-22.72, so „трябваше“ may start up to 0.1 s later than shown.
- Still open: no automatic replacement of an old Asistent caption track (no API); „Я“ (0:07.0), „то и за градината“ and „свършил“ stay marked „?“ (readings disagree); Windows host install.

**0.9.45: one press = SRT + on the timeline (user's request 2026-11-01 night). Placement VERIFIED in Premiere (TEST.prproj 23:47: host loaded after one restart, 25 captions on caption track C2, read back by the panel: count and first/last time match). User: timing a lot better, some words corrected, spelling mistakes remain. Added after that: respelling by ear (`lexicon.respell`, „нища“ -> „неща“).**
Root causes found on the Ludi Glavi clips (measured, not guessed):
- *Missing first word:* Whisper's word starts are early (median 0.12 s); „Имаш“ (-0.34…0.18 s) had 35 % inside the piece and the 40 % rule dropped it. The speaker cut is inside „Имаш“ (energy jumps from -64 dB to -14 dB at 0.00 s). With the aligner the word sits at 0.02-0.28 s and is kept. Not a VAD problem (VAD is off) and not a chunk-boundary problem.
- *Loud gaps with no words (piece 3, 2.2 s):* checked, not speech: unvoiced, centroid 3.7 kHz vs 0.6 kHz for speech (noise). Whisper is right.
- *Wrong/unstable words:* „нища/неща“ flips with the context length (0.5 s „неща“, 2 s „нища“, 4 s „неща“, 8 s „нища“); the last word of the last piece is cut by the edit and changes with every reading („десом“, „ти своя“, „ти съм“). Whisper's probability (0.68) cannot tell. Fix: three readings + dictionary, uncertain words are listed, never guessed. **Still wrong in the output (flagged „?“):** „нища“ (probably „неща“), „десом“ (cut word), „свършила/свършил“, „Я“, „то и за градината“. M4 (text correction in the panel) is what fixes these for good.
- *Timing:* aligner installed (`~/Library/Application Support/Asistent/venv-align`, weights in `models/torch`), 59/65 words aligned, 8 s for 4 pieces; „Добре,“ onset 1.10-1.14 s in the audio, aligned 1.13 s, Whisper 0.88 s.
- *Placement:* UXP has no caption API (see `DECISIONS.md`); the CEP host `host/` (ExtendScript `createCaptionTrack`) does it. Installed in `~/Library/Application Support/Adobe/CEP/extensions/com.contentstudio.asistent.host`. `PlayerDebugMode=1` was already set (Quick Search needs it).
Open for the host (to settle in the first Premiere run, `dev_cmd.py host probe`): the exact caption-format constant, whether `createCaptionTrack` takes seconds, whether a caption track can be deleted safely from ExtendScript (Asistent itself never removes/mutes).

**0.9.44: words, timing and grouping (user: still wrong words, timing a little off, wants natural 2-3 word phrases).**
The original 4a1a method was found in `tools/autoedit` (`asr.py`, `autoedit.py`; proof of use: the Clash transcript with an
alignment score on every word): Whisper large-v3 (same model and settings as Asistent) + **MMS_FA forced alignment**
(torchaudio) + a prompt of names and a „spoken“ dictionary + a text correction pass, on one clean voice recording.
Findings on the Ludi Glavi test (GStroy clips):
- *Words:* the user's examples („я да видим“, „примерно на мен“) were wrong because the four cut pieces were joined into
  one signal; transcribed one by one with 2 s of real media around each, Whisper gives them correctly. Now per piece
  (`subtitle_job.piece_words`, `dialoguemix.read_segment`, words kept when ≥ 40 % inside the piece, seams de-duplicated).
- *Timing:* Whisper's word starts are early by a median 0.12 s (mean 0.2, up to 1 s; e.g. „я“ 1.40 s vs 1.93 s aligned).
  MMS_FA alignment fixes it (scores mostly 0.8-1.0). Built as an OPTIONAL step in its own environment (`align.py`,
  `align_worker.py`, `requirements-align.txt`, `setup_mac.sh --align`); without it Whisper times are kept and the result
  says so. **Not installed in the app folder yet** (about 0.9 GB venv + 1.2 GB weights) because the weights are
  **CC-BY-NC 4.0 (non-commercial)**: the user must decide (see `LICENSES.md`).
- *Grouping:* `subtitles._group_phrases` (short preset): dynamic programming over the words; prefers cuts at sentence ends,
  commas and real pauses, never ends a caption on a preposition/conjunction/particle/„един“, rarely starts on a clitic,
  2-3 words (4 only with function words or a number phrase), ≤ 22 characters, no sentence end or pause inside a caption.
  Timing: a caption appears one frame before its first word; in continuous speech it stays until the next one starts
  (no blink), in a pause it clears 0.3 s after the last word. The standard (16:9) preset keeps the old grouping.
- Real result at 0.9.44 on the same selection (alignment on): „Имаш идея?“ / „Добре,“ / „я да видим“ / „какво ще трябва.“ /
  „Примерно на мен“ / „ми трябва“ / „ето това.“; remaining Whisper errors: „нища“ (неща), „десом“.
**Not verified in Premiere at 0.9.44** (words and grouping engine-tested on the real clips; alignment only in a test
environment). Next: user presses the button again; decision on the aligner licence/install; M4 review + text correction
+ names field (Whisper prompt) + import into the bin („Внеси в проекта“, one Undo).

## Phases 7–9 (Planned)
7 Bulgarian subtitles (faster-whisper; reuse `tools/autoedit/asr.py` by copying), 8 rough-cut markers and
export QA, 9 Windows (run setup, silent install there, packaging for colleagues).

## Auto Shot Match (0.9.28, user's priority 2026-11-01; skin brightness and S-Log3 parked)
„Изравни камерите“ (ЦВЯТ): selected clips grouped into cameras (media folder, or file-name prefix when all
share one folder); for each clip 4 source moments, inside the timeline overlap with the other cameras when
there is one (same real moment), evenly otherwise. Engine `shotmatch.py`: anchors per frame, never average
RGB/luma: skin (brightness, hue, saturation), neutral surfaces (white), tone spread (contrast, only on common
moments). Lumetri simulated with models fitted from the C0737 probe frames: Temperature/Tint channel gains,
Exposure with the shoulder curve, Contrast slope 1 + 0.00229·c around 0.50 encoded, Saturation chroma ×
(1 + 0.0093·(S−100)). Reference: the chosen camera or the most reliable (skin, neutrals, exposure, clipping);
„Еталон: …“ buttons re-run against another camera. The fit gives ABSOLUTE values from the source (re-run =
same values, `changed` empty); unfitted/flagged/tiny components keep the clip's current value. Flags instead
of force: > 1.5 stops, white > 0.5/0.3, neutrals vs skin disagreeing, no anchor, contrast/saturation > 20.
Apply: only changed components, new or Asistent-owned Lumetri only (manual grade → BLOCKED); each clip
checked on a Premiere frame at a visible moment against the reference look, worse components put back in one
step; fully covered clips: model only (said). Log/S-Log clips skipped. Audit: `kind: shotmatch`.
First Premiere test (16:42, SYNC sequence, C9023 fx30 + fx39024 fx3): reference fx30 (auto); only Exposure 1.56
applied, white/saturation/contrast flagged; render check: exposure error 1.87 → 0.54. Cause: the broad skin box
took the OSB wood for skin (16–47 % of the frame, log2 B/R −1.9…−2.0, chroma 0.74–0.78) and whole-frame contrast
compared different framings (+94). The user also could not find how to choose the reference.
0.9.29: skin = only pixels in the real-skin range (log2 B/R −1.6…−0.6, chroma 0.30–0.68); white from neutrals,
skin only as a veto when real skin is on both; exposure from real skin, else from the neutral surfaces'
brightness on common moments; saturation only from real skin; contrast only on common moments with comparable
content (tone-histogram intersection ≥ 0.75); flags name the reason. Replay of the same pair: fx3 skin 2.3 %,
white −6.9/+14.1 (fx3 green removed), exposure 1.86 (error 1.44 → 0.02 stop), saturation 90, contrast flagged.
Reference choice: one button per camera, the current one ticked, with a one-line explanation.
NOT verified in Premiere at 0.9.29: measured afterwards on the same pair (2026-11-01 17:00-17:30) the colour box still
took the OSB boards for skin (16-31 % of the FX30 frames, 15 % of the corrected FX3 frame; face and wood have the same
hue and saturation, log2 B/R −2.05 and chroma 0.76 on the FX3), so the proposal (Exposure 1.14, Saturation 85) and the
render check ("exposure 0.96 stop off") rested on wood.

0.9.30 — face-aware skin (`faces.py`, YuNet via OpenCV `FaceDetectorYN`, model bundled, MIT, 233 KB, ~10 ms a frame):
skin exists only inside detected faces (central part of the box; clipped/dark pixels and outliers dropped; a "face"
without any skin colour is a false detection; background faces under 25 % of the biggest are ignored). No face → no
skin anchor (never a colour guess): exposure and white come from neutral surfaces on common moments (confidence
„средна“), then from mid-tones only on comparable content („ниска“), saturation is not touched. The panel says the
confidence next to every measurement. Same-moment pairs may differ up to 2.5 stops before a gap is called intent.
Render check: every component is compared only on an anchor the reference, the before frame AND the after frame all have;
the rest is reported as skipped with the reason and can neither count as an improvement nor revert anything; if nothing
is reliable it says so instead of „по-близо до еталона“. Faces are looked for on a 960 px decode, reduced to the 480 px
analysis frame; check frames (480 px exports) are enlarged 2× for the detector. Replay on C9023 + fx39024: exposure 1.9
(model error 1.87 → 0.01 stop), white −6.7/12.4, saturation unchanged; the saved 0.9.29 frames with saturation 85 now
read „по-далеч от еталона“ for saturation (0.07 → 0.25). Face (1.87) and neutral-surface (1.65) exposure gaps agree
within 0.25 stop. Tests: `tests/test_real_skin.py` (old mask reproduced: 16.5 % wood vs 0.6 % face skin), `test_shotmatch.py`.
First Premiere test of 0.9.30 (17:30-17:40): OSB pair fx39024: Exposure 2.04, Saturation 89, check on faces
„по-близо до еталона“ (faces found, wood no longer counted). Second pair (C9025 + fx39028) looked greener after the
match, for two reasons: (a) a press with fx3 as the REFERENCE (17:36:27) matched C9025 (fx30) to fx3's green cast
(Tint −8.8, Temp +2.8, Contrast −13, Sat 97: audit); (b) the white step of the fx3 clips was skipped: neutrals and
face disagreed on Temperature (the grey surfaces jump +0.3/−0.15 between frames) although both agree fx3 is greener on
the Tint axis by 0.10-0.16. 0.9.31: white is decided per axis (Temperature and Tint each fitted only when neutrals and
face agree on that axis, else left as it was and said); replay of the pair: Tint +9, Temperature untouched, white error
2.65 → 1.0 (was unchanged at 2.5). 0.9.31 in Premiere (17:43, C9025 + fx39028, ref fx30): Tint 9.6 / 9.4 written, white check better on the first piece
(3.41 → 2.98), the second piece's before and after PNGs were byte-identical, so its „същото“ meant nothing. 0.9.32: the
render check refuses to judge when the two frames are identical (all components skipped, summary says why).
Verified by the user in Premiere at 0.9.32 (2026-11-01, GStroy OSB pair and C9025 + fx39028): „изглеждат добре“.
0.9.33: the single-clip „Цвят“ (`color.py`) uses the same faces: `measure()` takes skin from `faces.skin_mask`
(detects on the frame itself; no face → mid-tones, never a colour box), `clipping_regions` counts burnt skin only on
faces, `check_render` compares exposure on one basis for both frames, confidence is never „high“ on a face under ~0.2 %
of the frame. Real clips (6 frames each, old colour box → faces): C9023 exposure 0.53 → +1.73 stops (colour box area
35.5 % → 0.6 %), C9025 1.15 → +1.27, fx39024 2.48 → +3.57 (capped at +2), fx39028 1.58 → +1.56. NOT verified in Premiere
at 0.9.33. First Premiere run of 0.9.33 (18:01, fx39026 two pieces + C9024): the second piece (5.49-19.0 s) rendered the same
brightness (mean luma 0.445) before and after Exposure +2.15 and +4.3 (byte-identical export, also the second piece of
fx39028 in the Shot Match run at 17:43), so the check said „2.3 стопа под целта“ and the next „Приложи и средните“
stacked 2.15 → 4.3. Cause of the invisible change not found (hidden under another layer, or Premiere returns the old
frame). 0.9.34: `check_render` returns NOT_VERIFIED (`render_unchanged`, no brightness verdict, no learning, no
step-back) for identical frames, and the panel refuses to stack another Exposure on a clip whose last correction was
unseen (in-memory, until the next press). The user also saw one POV a little darker after „Приложи и средните“:
which clip is not known yet.
Shot Match: other clients' footage not yet seen (the user will say if it is not okay). Limits: frontal/three-quarter faces only (back of head, profile, strong
hat/mask: no face → fallback); the face anchor is the only same-object anchor, neutral surfaces compare unlike
framings; Windows needs the OpenCV wheel (exists, not run); faces are the only skin anchor in „Цвят“ too (no face: mid-tones, medium/low confidence).
