# Color: Auto color, Match POVs, Exposure -0.5 / +0.5, Before / after

## What it does
The Color row on the Tools tab. Auto color measures the selected video clips and puts white balance and exposure into
Lumetri in one press, then checks a frame and takes back whatever got worse. Under its arrow: White balance and Exposure
(the same press, one correction only), Match POVs (clips from two cameras made alike), and the editor's own Exposure
-0.5 / +0.5 steps. The Before / after tab appears after a run and shows the approximate pictures.

## How to use it
1. Select video clips on the timeline (switched-off clips are left alone).
2. Press Auto color, or open the arrow for White balance, Exposure or Match POVs.
3. Read the result: per clip a status (corrected, already fine, check by hand, reverted, not touched), the reasons, and how
   many Cmd/Ctrl+Z take the press back. Before / after shows the frames.
4. Match POVs needs clips from at least two cameras (folders, else the letters before the file number). The reference is
   chosen automatically; a button per camera under the result matches to that camera instead.
5. Exposure -0.5 / +0.5 add a fixed step to the selected clips at once, no measuring, no faces needed. Quick presses queue.

## Key points: do not break
- One press analyses and applies high and medium confidence; low confidence is never applied; zero correction is a valid
  result. There is no approval step (user, 2026-11-04, 0.9.99). The frame check takes back any part that got worse.
- Single-clip colour writes only Exposure, Temperature and Tint, one static value per clip. Match POVs also writes Contrast
  and Saturation (the reference camera defines the target). Never LUTs.
- Never touch a hand-made Lumetri. A Lumetri is Asistent's own only when its full fingerprint is in `managed.json`
  (`managed.py`; follows the media file, so a cut piece keeps it). "Untouched" means the whole Lumetri equals the snapshot
  Asistent learnt when it added one itself (0.10.6), never just five sliders at 0. An unreadable `managed.json` owns nothing.
- The one exception: Exposure -0.5 / +0.5 also move Exposure in a hand-set Lumetri (user, 2026-11-04, 0.10.1). Nothing else in
  it changes, a keyframed Exposure is refused, and the Lumetri is not recorded as Asistent's.
- A keyframed parameter is never written, by any button, read again just before the write (0.10.6).
- A clip under a visible layer is measured on its file; that counts only when the clip has nothing else changing its colour,
  and then only high confidence is applied (0.10.4, 0.10.8). A LUT-only adjustment layer is looked through (0.10.25, 0.10.48).
- One press is one Undo step as far as Premiere allows: a new Lumetri costs an extra step (append, then values), a step back
  or revert one more. The panel says how many. Never remove track items through UXP.
- A Lumetri added to a clip is read again only after 60 ms from a fresh handle (`attachedAll`): a freed object crashed Premiere
  26.5 when Exposure +0.5 was pressed twice fast (0.10.118, not yet tried in Premiere).
- Exposure shoulder and clipping: a first check that finds more than 3 % newly clipped steps Exposure back once (0.9.17).
- The cap is 2 stops either way. Skin is measured only inside faces found by YuNet (`faces.py`); no face means neutral
  surfaces or mid-tones with lower confidence.

## Decisions
- One static best-effort value per clip, no repeated attempts: DECISIONS 2026-11-01 ("one static best-effort value").
- Step back over 3 % clipping, tolerate the final result to 3.25 %: DECISIONS 2026-11-01 ("Highlight clipping").
- Update only Asistent's own, untouched Lumetri: DECISIONS 2026-11-01 ("Asistent may update only its own").
- Skin only from detected faces: DECISIONS 2026-11-01 ("Skin only from detected faces").
- Separate buttons only narrow the plans, no second code path: DECISIONS "Colour buttons (0.9.58)".
- Colour applies on the first click: DECISIONS 2026-11-04. Exposure +-0.5 in a hand grade: DECISIONS 2026-11-04.
- A covered clip measured on its file counts when nothing changes its colour: DECISIONS 2026-11-05. Ownership audit: 2026-11-08.

## Code map
- Panel: `panel/main.js` (`onColor`, `onShotMatch`, `onExposureNudge`, `applyColor`, `previewBlock`); `panel/premiere-color.js`
  (touches Premiere: `target`, `apply`, `applyShotMatch`, `nudgeExposure`, `revertWorse`, `attachedAll`, `timelineFrames`);
  `panel/colorplans.js` (pure: `plansFor`, `mergeValues`, `statusOf`, `lutOnlyDiff`); `panel/moments.js` (pure: where a clip
  can be measured, `cameras`, `shotMoments`); `panel/premiere-probe.js` (Lumetri probe, Settings tab); markup `secColor`,
  `panePreview` in `panel/index.html`.
- Engine: `engine/asistent/color.py` (`analyze_clip`, `check_render`, `Calibration`, `pullback_units`), `shotmatch.py`
  (`run`, `fit`, `check`), `faces.py`, `managed.py` (`ManagedStore`). Endpoints in `server.py`: `/color`, `/color/check`,
  `/color/sliders`, `/color/managed/check`, `/color/managed/record`, `/color/audit` (`color_audit.jsonl`), `/shotmatch`.
- No host function. Engine data: `lumetri.json` (slider calibration), `managed.json`. Plans: `COLOR_CORRECTION_PLAN.md`,
  `docs/color-spec/`, per client `docs/CLIENT_COLOR/` (proposals only).

## Status
- Since: Phase 6 engine 0.8.0, Lumetri apply 0.9.x, buttons split 0.9.58, one-click apply 0.9.99, +-0.5 steps 0.9.88 and 0.10.1.
  Latest line: 0.10.118 installed, untested in Premiere (CHANGELOG).
- Mac: Auto color and Match POVs used by the user in Premiere (Match POVs on the GStroy pairs at 0.9.32; S-Log3 under a LUT
  layer on Pulse at 0.10.26-0.10.29). Not yet tried: the 0.10.29 overshoot step back (TODO F), the 0.10.118 settle.
- Windows: untested; Shot Match and colour frames never run there (TODO W).
- Open: two anchors can differ by 2 stops on one clip, skin target 0.62 may be too bright (TODO A, B9); crash note in `BUGS.md`
  "Open bugs" (Exposure +0.5 twice fast); TODO B8 (test matrix `docs/color-spec/05_TEST_MATRIX.csv`) and I6.

## Tests
- `tests/test_color.py` (analysis, check, calibration), `test_shotmatch.py`, `test_managed.py`, `test_real_skin.py` (real
  footage, skipped without it).
- `tests/colorplans.test.js`, `moments.test.js`, `selection.test.js` (fake Premiere: selection, +-0.5 and ownership),
  `wiring.test.js` (queued presses, panel wiring).
