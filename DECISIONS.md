# Decisions (and the reasons behind them)

## Architecture
- **Hybrid: UXP panel + local Python engine.** UXP cannot run FFmpeg/NumPy/Whisper or spawn processes; a
  standalone app cannot import into bins or edit sequences. Rejected: CEP/ExtendScript as the main side (legacy, and the
  user's Quick Search already lives there; one exception since 0.9.45, see „Captions on the timeline“), cloud services, databases, web frameworks.
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

## Colour buttons (0.9.58)
- **Separate buttons narrow the plans, they do not fork the code.** „Бяло“ and „Експозиция“ run the one analysis and the one apply of „Авто цвят“; only `plansFor(..., only)` drops the other correction. Reason: the user's rule was to keep every calibrated value and check as it was; a second code path would have to be kept equal by hand.
- **No Contrast/Saturation button for one clip.** The single-clip engine never had such a measure (a target for contrast or saturation is a taste, not a measurement). Shot Match has them because the reference camera defines the target. Exposing them alone would mean inventing the algorithm.
- **„Изравни POV-тата“ is Auto Shot Match, not a second feature.** It already starts from the clip's current Lumetri values and writes absolute values for the components it changes, so previous corrections are kept and a repeat press gives the same result.

## Rough cut build path (2026-11-03)
- **Engine-written FCP7 XML imported with UXP `importFiles`**, one new sequence per run, never edits the source sequence. Probed in TEST.prproj (see `docs/ROUGHCUT_PLAN.md`, M0 results): frame-exact, linked, markers possible. Rejected as the primary path: cloning the sequence and deleting (removal through UXP crashes 26.0.2) and UXP additive trimming (unprobed, fragile on 26.0.2).

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

## Colour: one static best-effort value per clip (2026-11-01, user)
Every corrected parameter is one constant value across the whole clip, the best overall from the measured
moments; no keyframes. A clip that burns too much or is otherwise beyond the range gets one capped pass (what
is possible) and the work moves on: no repeated attempts, and one failing clip never stops the others.

## Colour: Asistent may update only its own, untouched Lumetri (2026-11-01, user, 0.9.24)
A Lumetri is Asistent's when the fingerprint of all its parameters matches one Asistent recorded after
writing it (`managed.json`, per clip source range). Then a new press adds the new differences to it. Any
manual change to any parameter makes it the user's grade, and it is never touched again. Unknown (older)
Lumetris are treated as manual.

## Skin only from detected faces, confidence-based fallback (2026-11-01, user, 0.9.30)
Colour cannot separate skin from OSB, plywood or pale walls (same hue and saturation on the FX3/FX30), and area or
camera-difference thresholds are no fix (close-ups). Skin is therefore measured only inside faces found by YuNet
(OpenCV `FaceDetectorYN`, MIT model bundled, CPU, ~10 ms a frame; chosen over Haar cascades, which OpenCV 5 no longer
ships, and over MediaPipe, which is much heavier). No face → neutral surfaces on common moments, then mid-tones on
comparable content; saturation only from faces. Every measurement carries a confidence, and the render check
compares only on anchors all frames share and reports what it skipped.

## Subtitles go in as an SRT the user drags (2026-11-01, M0 probes, 0.9.39)
Premiere 26.0.2 imports an .srt as a project item (`importFiles`), but neither `createOverwriteItemAction` nor
`createInsertProjectItemAction` places it (no error, nothing appears, no caption track), and there is no API to create a
caption track. So Asistent imports the SRT into a bin and the user drags it over the sequence once; our line breaks
survive. Premiere's own transcript (`Transcript`) is not used for now: its export rejects a clip without a transcript and
its own captions would re-break the lines.

## Subtitles 0.9.44 (2026-11-01)
- **Original 4a1a method:** Whisper large-v3 + MMS_FA forced alignment + names prompt + `spoken` dictionary + a correction pass (`tools/autoedit`). Same model as Asistent; the alignment and the correction pass are what Asistent lacked.
- **Per piece, not one mix:** measured to give correct words where the joined mix did not.
- **Aligner is optional and isolated** (own venv, subprocess, falls back to Whisper times) because torch is about 0.9 GB and the MMS_FA weights are CC-BY-NC 4.0: installing them for client work is the user's decision.
- **Grouping by cost, not by a word count:** 2-3 words is the target, the cuts follow pauses, punctuation and function words; the old „max 2 words“ rule of the 4a1a burned-in captions (`caption_max_words` 2) is no longer the short preset's limit (user, 2026-11-01).

## Subtitles M3 (2026-11-01, 0.9.42)
- **Duplicate audio rule (replaced in 0.9.43):** the first version dropped an item covered ≥ 50 % by a lower-track item („lowest track wins“, the plan's rule). Measured on 8 GStroy clips it picked the noisy camera mic and produced wrong words. Now the engine decides: items that overlap ≥ 50 % of the shorter one AND whose loudness envelopes correlate (≥ 0.5, lag ±0.25 s) are the same speech; the cleanest copy wins (speech level over noise floor, quiet copies penalised; within 3 dB the lowest track wins) and the part of a weaker item the winner does not cover is kept. Two different people talking at once do not correlate, so both stay.
- **Whisper settings stay default (2026-11-01):** a descriptive `initial_prompt`, VAD, `condition_on_previous_text=False` and beam 10 were each tried on the real clips and gave no reliable gain (worse text, dropped speech, one hallucination, +20 % time). Better input audio was the real lever. A prompt of the user's own names and terms is still planned (M4).
- **Channels for recognition:** the same classification as „Оправи звука“ (one-sided clip → its sound side, two microphones summed, otherwise averaged); never a polarity-inverted sum.
- **Mix origin** is the earliest item, not sequence 0, so silence before the first speech costs no recognition time; word times are shifted back by that origin.
- **Preset `auto`** follows the sequence shape (landscape → standard, else short); if the frame size cannot be read it falls back to short and logs it.
- **Whisper words are cached** by mix + prompt + model; presets and fps are applied after the cache, so changing them does not run Whisper again.
- **Download never automatic:** only the button that names the size starts it (checked by a wiring test); a missing model or backend is an instruction in Bulgarian, not a download.

## Captions on the timeline: a small CEP host (2026-11-01, 0.9.45; reverses „CEP rejected“ for this one job)
The user asked that one press puts the subtitles on the timeline. UXP in Premiere 26.0.2 cannot: `Sequence` has no
`createCaptionTrack` (method list read through the bridge), `createOverwriteItemAction`/`createInsertProjectItemAction` do
nothing for an SRT (M0), `SequenceEditor.createAddItemAction(s)` need more parameters than a project item and are for
track items. ExtendScript has `Sequence.createCaptionTrack(projectItem, startAtTime, captionFormat)`. So `host/` is a tiny
invisible CEP extension (same pattern as Quick Search's background extension, which has run under Premiere 26 for hours):
it long-polls the engine, runs `host.jsx`, posts the answer. It listens on no port, carries only fixed commands, is a
separate extension from Quick Search (which Asistent still never imports, calls or modifies).
- **No removal, no muting.** The permanent rules stay: nothing is removed through UXP (crash) and no track is muted or
  rearranged on the user's behalf. So a second press does not replace the first track: the engine remembers the
  signature of the track it placed (`captionstate.py`: index, item count, first/last time); if the sequence still holds
  that track, the panel says so and tells the editor to delete it. A track the editor changed no longer matches and is
  not touched. Automating that delete is possible only if ExtendScript offers a safe call (to probe, needs the user's OK).
- **Verification belongs to the panel:** it reads the caption tracks back (UXP, read only) and compares count and
  first/last time with the SRT; a mismatch is shown, not hidden.
- **Needs one Premiere restart** to load the extension, and `PlayerDebugMode=1` (set for CSXS 10-13; already needed by
  Quick Search). Unsigned CEP could stop working in a later Premiere: then the SRT is still made and the panel says to
  import it by hand.

## Subtitle words: readings + dictionary, never a guess (2026-11-01, 0.9.45)
Whisper's probability cannot tell a wrong word from a right one, and the same piece read with different context gives
different words. So each piece is read three times (0.7 s, 2 s, 4 s of surrounding sound); the 2 s reading is aligned and
gives the words and times; the other two only vote. A word changes only if two readings agree AND the Bulgarian
dictionary knows the new word and not the old one (voting alone turned „градината“ into „градвината“). Everything the
readings or the dictionary doubt is reported by word and time. Cost: three times the recognition time (cached per
context). The dictionary is GPL v2 data downloaded at setup, not stored in the repository.

## Speed, context and the Bulgarian transcription guide (2026-11-02, 0.9.48)
- **One reading per stretch of a file, 4 s of context, windows merged** (not 3 readings per piece with 0.7/2/4 s): 252 s of audio → 91 s. 2 s of context was too little (prices read as dates), 6 s pulled in the neighbouring takes („Превърна мен“). A second, narrow reading is taken only for a piece that still has an unknown word or a first-person „съм …л/ла“ form, and the reading with fewer doubts wins.
- **Parallelism, not threads:** one reading with 10 threads was slower than with 4 on the M4 Max (efficiency cores); several readings at once are faster (5 × 2 threads: 3.8× real time against 1.8×). `asr._parallelism` sizes it by cores; a GPU takes one reading at a time.
- **The aligner's confidence is not a reason to discard a time** (lowest-scored words: 57 % within 80 ms against Whisper's 7 %); a word is distrusted only when squeezed into too little time for its letters. Numbers are aligned through their spoken form (`numbers.py`).
- **Words outside sound are marked, not deleted** (guide §7): no speech-like sound under the word (`align.unheard`), or voiced sound without a word (`align.uncovered_speech`). Deleting would be a guess as well.
- **Guide vs the user's decision on gender:** the guide proposes per-speaker male/female/auto metadata; the user removed the global setting because both speakers are in one edit, and the guide itself says never one global conversion. So forms are never converted; a disagreement between two readings is flagged (`agreement.py`).
- **Not built:** an acoustic-fit arbiter between readings (right 4 of 7 times), changing „взима“ to „взимаме“ without evidence (guide §3), automatic month-to-price rewriting (guide §5: mark it).
- The guide is the permanent reference (`docs/BULGARIAN_TRANSCRIPTION_GUIDE.md`, linked from CLAUDE.md and docs/INDEX.md); its §10 table is `tests/test_guide_regressions.py`.

## Corrections, gender, alignment choice (2026-11-02, 0.9.46)
- **Corrections re-time.** The editor's `чуто => казано` lines are applied to the heard words before the forced alignment, so the new words get times from the sound. Replacing text over the old timestamps (the first idea) leaves the phrase where the wrong words were. Names/terms (lines without `=>`) go to Whisper's prompt only. Rejected for now: fuzzy snapping to terms (a legitimate word could be turned into a term).
- **large-v2 tested as a second opinion and rejected (2026-11-02).** Same four pieces, same settings: it fixed „неща“ but broke „Примерно на мен“ („Прилива на мен“), „то и за градината“ („той за градината“) and made the end phrase worse („ще чакам да бойдиш с вън“). The 2.9 GB test model was deleted. large-v3 stays.
- **Whisper cannot be tuned out of its mistake** (beam 10, no temperature fallback, float32, hotwords off, short windows all give the same wrong end phrase), and a prompt that contains the answer would be cheating. A different ASR model (e.g. large-v2) was not tried: it is a ~3 GB download for the user to approve.
- **Gender setting: tried in 0.9.46, removed in 0.9.47.** The user's edits mix both speakers, so any gender rule would rewrite correct forms. Pitch had been measured and rejected (150-258 Hz for one speaker in one clip). A form the readings disagree on is marked „?“ and left as heard.
- **MMS_FA stays the aligner.** stable-ts 2.19.1 (MIT, Whisper attention + silence suppression) measured worse on the same 13 post-pause words (median -0.10 s, 5/13 within 80 ms vs +0.04 s, 11/13). Its licence advantage does not pay for that.
- **Silence trim:** thresholds as shares of the way from noise floor to speech level, because a quiet microphone has a small gap (a fixed „35 dB under“ missed „Ей,“ on a −19 dB piece).
- **No caption track deletion.** ExtendScript has `createCaptionTrack` only (probed: no caption track object, QE removes only video/audio tracks). Unchanged rule: refuse to stack, tell the editor what to delete.

## 2026-11-03: L/L and R/R through subclips with their own channel mapping, never Fill effects
The user wants the result of their manual workflow (duplicate audio below, Modify Clip > Audio Channels L/L and R/R). No Premiere API sets the channels of a clip already on the timeline (UXP has none; ExtendScript `setAudioChannelMapping` works on a project item). So each side is an audio-only subclip of exactly the media range the clip uses, mapped L/L or R/R, overwriting the original audio (upper) and placed on the free track below (lower), then relinked. Chosen by the user over re-placing the source clip (which would replace the video too) and over doing it only inside the SYNC build. Probed and verified in TEST.prproj before release; the panel never removes anything, an overwrite replaces the original audio clip in place.

## 2026-11-03: limiter per clip instead of on the Mix track; balance only lowers
The user's video puts Dynamics (Limiter -6 dB) on the Mix track. Not reachable by any script API in 26.0.2, so each levelled clip gets the same Dynamics and the engine keeps the SUM of both sides under -6 dB by the gains. Balancing between two speakers only ever lowers the louder side (max 12 dB, tolerance 2 dB) and ignores a channel without its own speaker: lifting the quieter side would lift its noise or bleed. Existing Dynamics with the user's own settings is never modified.
