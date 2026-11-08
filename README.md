# Asistent for Premiere Pro

A standalone helper for the technical side of editing: syncing cameras, lavalier audio, automatic import of files, white balance and exposure, a rough cut without pauses and repeated takes, and Bulgarian subtitles. Free, local only (nothing is uploaded anywhere), for Mac and Windows, with Premiere Pro 2026 (26.0+).

It has no connection to the Quick Search extension: a different ID (`com.contentstudio.asistent`), a different port (47390), its own data folder.

## How it is built

- **A panel in Premiere** (`Window > UXP Plugins > Asistent`): the only window. It reads the selected clips and makes the changes in the project through Adobe's official UXP API.
- **The engine** (Python, runs in the background): analyses sound and picture with FFmpeg and NumPy. It listens only on `127.0.0.1:47390` and accepts requests only from the panel.
- **The Asistent host**: an invisible helper inside Premiere for the few things UXP cannot do (the L/L and R/R audio copies, the caption track).
- Settings, logs and the Python environment live outside the project folder: Mac `~/Library/Application Support/Asistent/`, Windows `%LOCALAPPDATA%\Asistent\`.

## Installation (once per computer)

Download `Asistent-<version>.zip` from the newest release on GitHub (Releases, kaloyankera-rgb/asistent-premiere), unzip it and
double-click the installer for your system. It needs Python 3.12 and FFmpeg first:

- **Mac**: `brew install python@3.12 ffmpeg`, then double-click `Install Asistent (Mac).command` (the first time macOS may refuse
  a file from the internet: right-click it > Open). It creates the Python environment, puts Asistent in
  `~/Library/Application Support/Asistent/current`, installs the host and the font, installs the panel through Adobe's own
  installer (no dialog) and adds a LaunchAgent that starts the engine at every login.
- **Windows**: `winget install Python.Python.3.12` and `winget install Gyan.FFmpeg` (open a new window afterwards), then
  double-click `Install Asistent (Windows).cmd`. The same, in `%LOCALAPPDATA%\Asistent\current`, with a hidden shortcut in
  Startup; with an NVIDIA graphics card the speech recognition runs on it.

Then restart Premiere once (it loads the host and sees the Montserrat font) and open `Window > UXP Plugins > Asistent`. The
speech model (about 3.1 GB) and the English translator (about 1.4 GB) are downloaded with their own buttons in the Subtitles card.

## Updates

The panel asks GitHub for a newer release when it opens and every few hours. When there is one, a line at the top says
"Asistent X is available" with an **Update** button: it downloads the release, checks its checksum, installs new Python packages
only when they changed, replaces the engine, the host and the panel, and restarts the engine (about a minute; nothing in your
Premiere project is touched). The panel reloads by itself. Only a first install of the host needs one Premiere restart.
The update check is the only connection Asistent makes on its own: a download of a small file from github.com; nothing is sent.

For the developer: `scripts/release_mac.sh` installs the repo on the development Mac after every change;
`scripts/publish_release.sh` (after commit and push) publishes the version as a GitHub release, which every installed panel then
offers. To stop the engine and remove the automatic start on a Mac: `scripts/uninstall_mac.sh`.

## Sync cameras

1. Put everything from the shooting day into a sequence (all on V1 one after another is fine), select it in the timeline and press **Sync cameras**.
2. The engine compares the selected clips in pairs (clips from one folder, that is one camera, are not compared with each other) and gathers them into groups with surely shared sound. 28 clips take about 7 seconds.
3. The panel makes a new sequence `SYNC – <your sequence>` in the bin `SYNC`: each camera (folder) on its own track, the groups one after another in the order they were in the timeline, each with a marker, and the clips without shared sound at the end.
4. At the end the panel reads the new sequence and says "Done" only if every clip is exactly where it belongs.
5. The sound is not touched: all tracks play, nothing is muted. Levels are fixed in the audio step.

Your sequence is only read: nothing in it is moved or deleted. If you do not like the SYNC sequence, delete it.

## Fix audio

Select the clips in the timeline (their video or their audio) and press **Fix audio**. Every stereo clip is split the way an editor does it by hand: a copy with L/L (Modify Clip > Audio Channels) in place of the audio and a copy with R/R on the track below, both linked to the picture. A second press makes no new copies. Then the engine sets the level of each side towards −17 LUFS, keeps the sum of both sides under −6 dB peak, lowers the louder speaker when the two differ, and puts Dynamics → Limiter at −6 dB on every levelled clip (Premiere's scripts cannot reach the Mix track). If a quiet recording cannot be raised more because of the peaks or the room noise, the panel says how much is missing. A clipped recording is reported too.

**Manual ▸** has: **Split L/R**, **Split R/L** (the other way round), **L only**, **R only**, **Level only**, and **Even out phrases**: like Fix audio, plus Volume keyframes that bring each phrase more than 4 dB quieter or louder than the clip's average closer to it (only the excess over 4 dB, at most ±6 dB, with smooth 0.2 s changes in the pauses, never over −6 dB peak).

**Undo:** the levels and the limiter are one Cmd/Ctrl+Z step each; the split is separate Premiere steps (the copies and the link of each clip). The panel always says how many.

## Color

Select the video clips and press **Auto color** (white balance and exposure together), **White balance** or **Exposure**. One press measures and puts the correction into Lumetri at once; **Before / after** shows it, Cmd/Ctrl+Z undoes it.

- **Exposure** in steps of 0.5 up to ±2 stops: by the skin when there are faces, otherwise by the midtones (lower confidence). If the highlights may clip, the panel warns and checks on a real frame.
- **White balance**: by the largest group of light, nearly neutral surfaces, checked against the whole picture. With no neutral surfaces and warm light (a restaurant) the confidence is low and nothing is touched.
- High- and medium-confidence corrections are applied (low confidence is left alone and said). Only Exposure, Temperature and Tint are written; a manual Lumetri grade is never touched.
- After applying, the panel exports a frame from Premiere and the engine measures it: if the white is off or more than 3 % of the picture clipped, it is corrected once. The panel says how many Undo steps it took.
- **Match POVs** (after the corrections, clips from two cameras): matches the brightness, white balance, contrast and saturation of the other cameras to one reference camera, by faces and neutral surfaces, at once; a camera's button under the result matches to that camera instead.

## Rough cut

Select the cameras and the microphones with speech (the SYNC sequence works) and press **Rough cut**. A new sequence `ROUGH – <sequence> (<mode>) vN` is made in the bin `Rough cut`, with the same cuts on every selected camera and microphone, so the sync is kept. The original and older versions are never touched.

- **Safe** cuts long pauses that are surely silence; **Smart** shortens every pause to the **Tempo** (Calm, Normal, Tight).
- Repeated takes are found from the words: when the same passage is said again, the last full take stays and the earlier takes go, together with short setup talk between them. A take said with other numbers or different content is only listed for you to review. A start repeated inside a sentence is cut only in Smart.
- Time with no selected speech audio and empty space between clips are cut whole.
- Audio on a muted track (or a switched-off clip) is not used: it is left out of the cut and of the speech, as if you had deleted it. Use this for a quiet camera microphone next to your lavaliers; otherwise its sound counts as speech and the cameras' rows get gaps.
- The level, the limiter and the Lumetri values of the old clips are carried over to the new ones; other effects are listed as not carried.
- **Review markers** puts a marker at every place worth a look.

## Subtitles (Bulgarian)

Select the audio clips with speech and press **Subtitles (Bulgarian)**. The speech is recognised on this computer only (Whisper large-v3, about 3.1 GB, downloaded only with the **Download the model** button), checked against a Bulgarian dictionary, aligned to the sound, and saved as an .srt in `Asistent_subtitles` next to the project; the panel puts it on a new caption track. To restyle them, open the Properties panel, select all the captions on that track and change font, size, outline or shadow for all at once; save the look as a Track Style. Right-click > Upgrade Caption to Graphic turns them into text graphics if needed.

Fix a wrong word in the **Captions** tab and press **Apply and rebuild**: the fix is remembered and the next videos of the same client get it too, on every computer in the office. Nothing to press: a client folder on the server that holds a folder named "<Client> Subtitle Learning" (for example `ReShape/ReShape Subtitle Learning`) is where the fixes are shared; projects outside such a folder learn on that computer only. A word fix reaches the other editors after it was made in two projects; a fix is only used where the sound agrees with it; typing the original word back undoes it for everyone. Under the lines, **Learned** lists what was learned: **Remove** stops a fix for everyone. **Who speaks** (above the lines) sets a man or a woman per microphone track, so „доволен/доволна“ and „направил/направила“ follow the person; leave it on "not set / both" when two people share a microphone. **Review helpers** (on by default; uncheck to hide them): under each line to check, the reasons, Words or Timing, and what a word was changed from („масна“ → „масона“); **Lines to check** shows only those lines, the most important first (numbers, negations, names, a word that may be missing); **▶** plays the line with a second and a half around it on your computer and moves the playhead there. "Unsure" means the recognition said so; it is not an accuracy figure. The search box above the lines finds a word in the Bulgarian or the English lines: type it and press Enter (or Find); Clear shows all lines again. A word you change in an English line ("lipidemia" to "lipedema") is remembered for the client's next videos too. A rebuild replaces Asistent's earlier subtitles: their lines are removed (one Undo brings them back) and their empty tracks stay, to be deleted by hand if you like (right-click > Delete Track); a track you changed yourself is never touched.

## Auto import

Press **Watch Downloads** (or **Other folder…**) with a project open. From then on every file that is downloaded or copied into the folder (and its subfolders) goes into the project by itself:

1. The engine waits until the file is ready: no browser temp files (.crdownload, .part, Safari .download), a size that stopped growing, and FFprobe can read it.
2. It picks a category: first by the subfolder (MUSIC, SFX, B-roll, …), then by the name (whoosh, hit, riser → SFX; music, bpm → music; overlay, logo, lower third → graphics), the tags (artist), the length (up to 8 s → SFX; long with an artist → music) and transparency (video with alpha → graphics). If unclear: OTHER.
3. The panel imports it **in place** (no copy, no rename) into the bin MUSIC / SFX / BROLL / IMAGES / GRAPHICS / OTHER and checks it is there. Nothing is put on the timeline.

One folder belongs to one project; a file is imported only while that project is open; a file already in the project is not imported twice; files from before switching it on are left alone. The panel must be open (it may be hidden in a tab) to import.

## How the sync offset is found
- Each audio channel is looked at on its own (L and R separately, quiet and duplicated channels skipped), plus a temporarily levelled mix.
- The sound is filtered to 150–4000 Hz and searched across the whole recording with GCC-PHAT and with a curve of sound onsets (more robust when the two microphones sound different).
- Each candidate is checked in 3–10 separate, non-overlapping stretches. **High** confidence only if at least 60 % of all stretches (and at least 3) give the same offset within 5 ms, there is no equally good second offset, and the drift (the difference between the camera clocks) is under half a frame for the whole recording.
- Timecode is only an extra check, and only if it lets the clips overlap at all. The file date never.

## Tests

```bash
"$HOME/Library/Application Support/Asistent/venv/bin/pip" install -r tools/asistent/requirements-dev.txt
cd tools/asistent && "$HOME/Library/Application Support/Asistent/venv/bin/python" -m pytest tests -q
node --test tests/*.test.js
```
The tests make synthetic speech with a known offset (no voice synthesis, no client material). Tests with Premiere are separate and done by hand in a test project (see PROGRESS.md).

The panel's look can be checked in a browser before installing: `cd tools/asistent/preview && npm install && node shoot.js now` takes screenshots of ten panel states at 240, 300 and 420 px with the Chrome on this computer (`--compare <earlier label>` reports what changed). Development only; nothing in `preview/` goes into the panel.

## Limits (checked in Premiere 26's UXP API)
- UXP cannot change a clip's channel mapping or create a multicam clip (the host does the L/L and R/R copies through ExtendScript).
- In Premiere 26.0.2, removing a clip from the timeline through UXP crashed Premiere, so Asistent never deletes clips.
- Clips sit on whole frames in the sequence, so up to half a frame of difference remains (8 ms at 60 fps, 20 ms at 25 fps). The panel shows it.
- With VFR material (phones) Premiere may drift later in the clip. The panel warns.

Status and next phases: [PROJECT_STATUS.md](PROJECT_STATUS.md), [TODO.md](TODO.md).
