# Learn from exports (colour)

## What it does
The "Learn from exports" row under Automatic, with a switch (on by default, kept in the panel's store as
`asistent.colorLearn`). When an export ends, Asistent notes each clip's Lumetri next to what Auto color would have set, per
client and camera, on this computer. It only reads: nothing in the project or the footage changes. "What the editors did"
(under the row's arrow) shows the result.

## How to use it
1. Leave the switch on and export a graded edit from the Export tab as usual. Nothing else to press.
2. Wait for the background analysis (about 33 s for 14 clips in the bridge test).
3. Open the row's arrow and press What the editors did. Per camera it shows the middle value of editors minus Auto color
   (exposure in stops, temperature, tint), how often Asistent's own correction was kept, how many clips have no correction,
   and how many were graded on an adjustment layer. A line says how many exports are still being analysed.
4. The bridge command `learn_export` runs the same step without a real export (a scripted export fires no event).

## Key points: do not break
- Read only. No transaction in Premiere, nothing written to the project, nothing on the office server (`/Volumes/Production`
  is read only; EL0, the learning folder per client there, still waits for the user's yes). Records stay in
  `<app>/learning/color/<client>.jsonl`.
- The panel reads at most 150 picture clips per export (`MAX` in `premiere-colorlearn.js`, `MAX_CLIPS` in `colorlearn.py`):
  the five Basic values, every other setting that differs from an untouched Lumetri (0.10.142, `colorplans.lumetriDiff` on the
  fingerprint already read: no extra Premiere calls; null when the untouched one was never seen), whether the Lumetri is still Asistent's own (`managed.json`), keyframes, Input LUT / Look, and a
  Lumetri on an adjustment layer above the clip (its values are added to the clip's).
- Runs on its own thread, one export at a time, never in the job pool, so a long analysis never delays Sync or subtitles.
- Several export events fire for one export: one run per 20 s, and never while a press is running (`learnFromExport`).
- Auto color's side is the file analysis (`color.analyze_clip`), not the value the frame check finally kept. The report counts
  only clips where Asistent was sure (high or medium) and nothing is keyframed. A re-export of a clip replaces its line.
- Camera and picture profile come from the Sony sidecar XML, else the clip's folder name. Client: the folder holding a
  "... Subtitle Learning" folder, else the folder under `01_CLIENTS`, else the project file's name before "КП-n" (0.10.142: a
  video folder mounted as its own volume filed clients under "Assets"), else the share's first folder. Older misfiled lines are
  re-filed once per engine run on the first report (`repair`, backup in `learning/color/backup/<time>/`, nothing dropped).
- Footage only (0.10.142, `footage`): stills, graphics and render / stock / transition / SFX / Downloads folders are not analysed
  or recorded, and old ones are left out of the report.
- Each line keeps what Auto color measured (`measured`: face / mid-tone brightness, casts, areas; `look`: black / white point,
  contrast, saturation), so targets can be fitted without the files. Record format 2.
- The report gives exposure in stops on both sides (the editors' Lumetri units converted with the probe curve at the measured
  brightness) and the editors' own Contrast and Saturation per camera.
- The record never changes a rule by itself. Turning it into a client colour target is a later step (TODO S, EL5).

## Decisions
- Records stay local until the user approves EL0, own thread, report compares with Auto color's file analysis: DECISIONS 2026-11-10 ("colour learning keeps its records on this computer").
- Colour findings per client are proposals only: `docs/CLIENT_COLOR/` (for example GStroy faces end about 0.47-0.49, Auto color aims 0.62).

## Code map
- Panel: `panel/premiere-colorlearn.js` (`gather`, `lutOf`; touches Premiere, read only); `panel/main.js` (`learnFromExport`,
  `onLearnReport`, `paintSwitches`, the export event listener); `panel/exportevents.js` (the event); markup `secLearn`,
  `colorLearnReport` in `panel/index.html`; `panel/premiere-color.js` `readLumetri` (also reads ownership).
- Engine: `engine/asistent/colorlearn.py` (`queue_export`, `record_now`, `suggestion`, `report`, `client_of`); endpoints in
  `server.py`: `POST /colorlearn/record`, `GET /colorlearn/report`, `GET /colorlearn/status`.
- Host: none.

## Status
- Since: 0.10.36 (2026-11-10), installed. Latest line: 0.10.142 (the colour audit's fixes), installed 2026-11-22, untested in Premiere.
- Verified through the bridge on NEW TEST (own Lumetri vs a hand change, cameras from sidecars, the report). Not verified: a real
  export from the Export tab starting it (the event is logged since 0.10.7; see exports.md for what is unverified).
- Windows: untested.
- Open: TODO COL (install 0.10.142, re-measure old records at the office, fit per-client targets), EL0 (office folders, waiting for the user), EL5 (report for Claude), the USER step of EL1 (export a graded
  client video, then press What the editors did). Nothing in `BUGS.md`.

## Tests
- `tests/test_colorlearn.py`: client from the path and from the project name, footage only, every changed setting, report in
  stops with Contrast / Saturation, the one-time re-filing with its backup, the kept measurements, record and report, an
  unreadable file, the queue and worker, the report endpoint. `tests/colorplans.test.js`: `lumetriDiff`.
- The panel readers (`premiere-colorlearn.js`, `learnFromExport`) have no node test; they were checked through the bridge.
