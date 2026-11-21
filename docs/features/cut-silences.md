# Cut silences

## What it does
The Silences row ("Cut silences", Tools > Run). It cuts dead air, and if chosen voices away from the microphone and
repeated takes, out of every selected camera and microphone at once, so they stay in sync. The result is a new
sequence "NO SILENCE – <sequence> vN" in the bin "No silence", a duplicate of the editor's own sequence with its
own clips cut. The editor's sequence is not touched. Preview shows what would go before anything is made.

## How to use it
1. Select the cameras and microphones in the timeline (Range can also be In to Out or the whole sequence).
2. Options (under the arrow, remembered): Cut = Silences only / Silences + off-mic (default) / AI rough cut;
   Detect = Automatic (default) / Manual dB / AI-assisted; Sensitivity; Pacing = Calm 1.3 s, Measured 0.87 s (default),
   Paced 0.65 s, Energetic 0.4 s, Custom; Remove short pauses; Remove hesitation sounds (needs AI-assisted);
   Result = Remove close the gaps / Remove keep the spaces / Split only / Mute the sound.
3. Preview: waveform and parts by kind. Tap a part to keep or cut it; unsure parts are kept and shown yellow.
4. Cut silences cuts exactly what the preview showed. Not what you wanted: delete the new sequence (the panel says so).

## Key points: do not break
- Never remove track items through UXP. The one approved removal (the user, 2026-11-15) is the host's, in the duplicate
  made by `as_cut_start` only, checked by id and name in every phase; the editor's sequence is never touched.
  `wiring.test.js` allows `.remove(` once in the host, in `as_cut_clean`. Never mute or reroute tracks: Mute and
  "keep the spaces" leave pieces out of the NEW sequence.
- Each sound clip is listened to on its own, and a moment is kept when anyone is heard (union). Never group microphones.
- Nothing unsure is cut: a voice within 2 dB above the off-mic line (`FLAG_BAND_DB`) and takes that are not a plain
  repeat are kept and flagged. Margins favour keeping speech.
- Manual dB is the level alone: no Silero, no main voice, in every mode. Silero never removes a loud stretch (it misses
  short loud words); it only helps in Automatic.
- Automatic cuts a phrase 8 dB under the clip's main voice (`QUIET_UNDER_DB`, 0.10.95; sensitivity 1-5 = 12/10/8/6.5/5 dB).
- Cut edges snap onto clip edges within a frame; a camera's few-frame flashes are dropped (`edl.align_to_edges`,
  `drop_flashes`, 0.10.110: no 1-frame slivers or gaps).
- Premiere 26.5.3 crashed in its UXP layer on many copies (0.10.99-0.10.107). Do not return to cutting through copies:
  the copies way stays only as a fallback without the host, at most 40 pieces (`HOST_FALLBACK_PIECES`).
- The host works in time-boxed rounds (`AS_CUT_BUDGET` 15 s) and refuses to razor unless the duplicate is in front.
- The preview and the cut share one code path; the editor's choices go back as time ranges (0.10.96).
- Repeated takes: matched with difflib, never on similarity alone; a plain repeat is cut (last full take stays), a take
  said differently (other number or content words) is only listed; takes over 90 s apart are not matched.
- AI-assisted words (hesitations, takes): ElevenLabs Scribe when its key is saved and the switch is on (`read_cloud`, 0.10.121),
  sharing the subtitles' cache key; else, and for any window it cannot read, local large-v3 (own cache keys `rough3-`).
  Never in a ReShape project (`is_reshape`, by folder and mount). Words decide what goes, the 10 ms level decides where.
  Automatic and Manual dB never use words and never send anything.

## Decisions
- AI words through ElevenLabs, ReShape local: DECISIONS 2026-11-21 (0.10.121).
- Silences replaces the rough cut in the panel, no recognition: DECISIONS 2026-11-12.
- Regions the editor can turn around; Manual dB is the level alone: DECISIONS 2026-11-15 (0.10.96).
- Auto cuts voices 8 dB under the main voice: DECISIONS 2026-11-15 (0.10.95).
- Cut by the host in a duplicate; the host may remove clips there only: DECISIONS 2026-11-15 (0.10.108).
- Clones in batches (superseded by the host cut, kept as fallback): DECISIONS 2026-11-15 (0.10.94).
- Built from clones, XML only makes the shell: DECISIONS 2026-11-11 (0.10.45); compression-ratio 3.0 for the cut reading: DECISIONS 2026-11-11.
- Older rough cut: FCP7 XML path "Rough cut build path (2026-11-03)"; takes by difflib, only listed (2026-11-03); plain repeats cut (2026-11-03).

## Code map
- Panel: `panel/silences.js` (options, preview, press), `silenceplan.js` (pure: options, columns, overrides),
  `roughcutplan.js` (pure: plan, report, verify), `premiere-roughcut.js` (touches Premiere: `readInput`, `hostPlan`,
  `hostCut`, `placeClones`, `place`); `engine.js` `startRoughcut`, `roughCut`, `roughLink`; `index.html` row `secRough`, button `rough`.
- Engine: `silence.py` (`measure`, `label_item`, `detect`, `plan`, `settings`), `roughcut_job.py` (`validate`, `run`,
  `run_silence`, `read_cloud`, `use_cloud`, `is_reshape`), `vad.py` (Silero), `edl.py`, `xmeml.py`, `takes.py`; `server.py` `POST /roughcut`, `/roughcut/cut`, `/roughcut/link`.
- Older Phase 8 (Safe / Smart: `speechmap.py`, `pauses.py`, branch of `roughcut_job.run`) is still in the engine but the
  panel no longer offers it; the Fast switch (`/roughcut/model/download`) is gone from the panel.
- Host: `host/host.jsx` `as_rough_cut` with `as_cut_start`, `as_cut_razor`, `as_cut_clean`, `as_cut_move`, `as_cut_finish`.

## Status
- Since 0.10.65 (Silences), rebuilt in 0.10.96, host cut since 0.10.108-0.10.109, ElevenLabs for AI words 0.10.121 (not installed yet;
  measured outside Premiere on IMG_9422: recognition 139 -> 34 s, one repeated take Whisper missed; not yet run by the user).
- Through the bridge in NEW TEST: 17 runs on 52 clips, 0 crashes, every piece verified; 0.10.110 checked on the user's
  v83 and SYNC sequences. The user ran 0.10.96 once (options showed and ran, 0.10.97); the 0.10.109/0.10.110 presses by
  the user, the preview look at panel width and the tooltips are unverified (TODO V96).
- Windows: untested.
- Limits (BUGS "Limits of Cut silences 0.10.96"): no audio crossfades or J/L cuts; Manual dB is one number for all
  microphones; hesitation sounds only when Whisper writes them; a take repeated without a pause is listed, not cut.
- Open: TODO V121, V96 (verify lists), TODO SIL (an empty channel blocks cuts, waiting for the user).

## Tests
- `tests/test_silence.py` (levels, Silero, modes, pacing, edges), `test_roughcut.py` (speech map, pauses, EDL, XML, job),
  `test_takes.py` (repeated takes), `test_silence_cloud.py` (ElevenLabs, ReShape by folder, fallback, shared reading).
- `tests/silenceplan.test.js`, `roughcutplan.test.js`, `roughcutclones.test.js` (copies in batches, `hostPlan`),
  `hostroughcut.test.js` (host cut against a model of Premiere), `wiring.test.js`, `tiptext.test.js` (tooltip rows).
