# Decisions (and the reasons behind them)

## Architecture
- **Hybrid: UXP panel + local Python engine.** UXP cannot run FFmpeg/NumPy/Whisper or spawn processes; a
  standalone app cannot import into bins or edit sequences. Rejected: CEP/ExtendScript (legacy, and the
  user's Quick Search already lives there), cloud services, databases, web frameworks.
- **Engine on `127.0.0.1:47390`, stdlib HTTP, header `X-Asistent: 1`.** A browser page cannot add a custom
  header without a CORS preflight, which is never approved; Host header checked against DNS rebinding.
  No token file (the panel could not read one reliably). Port chosen away from Quick Search (47231–47234).
- **Manifest network permission `"all"`.** `http://127.0.0.1:47390` (with port) was silently blocked by UXP in
  0.1.0; `"all"` works.
- **Engine data outside the Obsidian vault** (`~/Library/Application Support/Asistent`) so Syncthing does not
  copy the venv, caches and logs between Mac and PC.
- **LaunchAgent `ProcessType Interactive`.** `Background` put the engine on efficiency cores: 187 s vs 6.6 s for 28 clips.
- **Install without dialogs** with Adobe's UnifiedPluginInstallerAgent: `--remove "Asistent"` (reports −406
  but unloads the running panel) then `--install`; `--install` alone leaves the old panel loaded ("already exists").
- **Python 3.12 venv** (stable NumPy/SciPy wheels); Homebrew default 3.15 not used.

## Premiere API usage (26.0.2)
- **Call every method through `maybe()`/`has()`.** Adobe's types start at 26.2; 26.0.2 lacks e.g.
  `SequenceSettings.getVideoFrameRate` (use `sequence.getTimebase()`: ticks per frame).
- **Selection:** a clip is selected if it matches `sequence.getSelection().getTrackItems()` (by kind/start/end)
  OR `trackItem.getIsSelected()` (0.9.8; with only the first, a second POV was missed).
- **Times in whole frames as ticks** (`TickTime.createWithTicks`, 254016000000 ticks/s): an in-between time and a
  `ClipProjectItem` both gave „Invalid parameter“ for `createInsertProjectItemAction`; a plain `ProjectItem` works.
- **No track item removal through UXP.** Clone + remove crashed Premiere (SIGABRT in `dvascripting::Engine`,
  `EvalScriptAsync_ScriptingThread` → `napi_delete_reference` → `V8_Dcheck`): CEP panels running ExtendScript
  (Quick Search polls every 3 s; AutoCut, Mister Horse) free a UXP-held object after deletion.
- **One transaction per press**; Premiere clones a clip as it was BEFORE the transaction, so a split copy
  gets its own effect in a second step (max 2 Undo for any number of clips). A new `VideoFilterComponent`
  has no parameters until it sits on a clip, so a new Lumetri costs one step before the values are set.
- `exportSequenceFrame(seq, time, name, dir, w, h)` exists in 26.0.2 and adds `.png` itself: pass the name
  without extension.

## Sync
- **Timeline selection → new `SYNC – <sequence>` sequence** (user's choice after the crash). Rejected: in-place
  moves across tracks (needs removal → crash); Project-panel selection (user wants the timeline); multicam
  (not creatable via UXP).
- 5 ms agreement tolerance (cameras hear sources over different paths), independent non-overlapping windows,
  slope only over ≥ 60 s and ≤ 100 ppm, Tukey-tapered windows and no peak at the search edge (edge artefacts
  produced false matches), coverage ≥ 60 % of all windows for High. Timecode only as a hint (Sony record-run
  timecode is not shared between cameras); file dates never.
- Same-folder pairs are not compared (one camera cannot record two clips at once).

## Audio
- Routing only with Premiere's Fill effects (never summing channels → no phase cancellation); split = clone
  of the audio clip on the nearest empty audio track; „Раздели L/R“ refuses when both channels carry one sound
  (stereo camera mic, one voice heard twice) because it plays doubled.
- Level = clip Volume (Premiere scale 0.1778 = 0 dB, max +15 dB); target −17 LUFS, peak ≤ −6 dBFS (user rule),
  noise ≤ −55 dBFS; phrase leveling corrects only the excess beyond 4 dB natural dynamics, ±6 dB, ≥ 1 dB steps,
  ramps inside pauses.
- User rejected muting secondary cameras in SYNC („не мютвай нищо“): all tracks play.

## Auto import
- One folder belongs to one project and vice versa; a file is handed only to that project while it is open.
- A browser rename from a temp name is the completion signal (0.3 s); other copies wait 1.5 s of stable size;
  FFprobe must read the file. Import in place, never copy or rename. Long-poll (`wait=10`) instead of 4 s polling.

## Colour
- **Analysis in linear light, decided per clip**; never one correction per client (spec).
- Neutral reference = largest near-neutral bright group INSIDE the camera-cast range (±0.9 temp, ±0.5 tint in
  log2 chroma), checked against grey world on low-chroma mid-tones; plain grey world alone rejected (spec + tests:
  a green wall or warm wood would be "neutralised"). Skin found after the cast is removed (a warm grey wall looks like skin).
- Exposure from skin (target 0.62 encoded luma, within the spec's 45–75 IRE guidance), 0.5-stop steps, ±2
  (user: typical +0.5 … +2). The plain-gain highlight model is only a warning; the real Lumetri result must be
  measured on an exported frame (Lumetri rolls highlights off).
- S-Log3 decoded on legal-range code values (95/420 points); log footage is suggestion-only until colour
  management is verified.
- Preview Only by default; apply High confidence only („Приложи сигурните“), Medium on request.
- Colour work goes into **Asistent**, not Quick Search (first spec forbids touching Quick Search).

## Rejected / postponed
- Phase 5 postponed by the user (to be done in the office).
- Remotion/HyperFrames, ElevenLabs/TTS, paid plugins, cloud transcription: out by the user's rules.

## Highlight clipping: step back over 3 %, tolerate the final result up to 3.25 % (2026-11-01, 0.9.17)
The first render check steps Exposure back once whenever new clipping is over 3.00 % (measured with
`pullback_units`, validated on C0739: 4.42 % → 3.08 %). The user chose to keep this even when the first
result is inside the soft tolerance. The 0.25-point tolerance (`CLIP_SOFT_TOLERANCE`) only classifies the
final result (ACCEPTED_WITH_WARNING) and never triggers another correction: one more step would darken the
skin to win a few hundredths of a percent.
