# Asistent Phase 8: AI Auto Rough Cut (research and implementation plan)

## Context
Every short-form video starts with the same slow job: taking 5 to 30 minutes of raw talking-head footage, often two synced POVs plus lavaliers, and cutting out dead air, repeated takes and false starts until a first rough cut exists. Asistent already does the steps around this job: Sync builds `SYNC – <seq>`, and audio, colour and subtitles come after it. The rough cut is the missing link between them. Phase 8 was only a placeholder ("rough-cut markers + export QA", TODO.md:51). The goal is one press that builds a new, fully editable sequence and never touches the original. There are two modes. **Внимателно** (Safe Cut) cuts only certain silence and flags everything else. **Умно** (Smart Cut) also removes repeated takes and false starts when confidence is high. Everything runs locally, costs nothing and uses no cloud, following the permanent rules in `tools/asistent/CLAUDE.md`.

**This document is planning only.** Nothing has been implemented, installed or changed. The first implementation step is to save this plan as `tools/asistent/docs/ROUGHCUT_PLAN.md`, the counterpart of `docs/SUBTITLES_PLAN.md`.

---

## 1. Current architecture assessment (what is reused, what is new)

| Need | Already exists (reuse) | Gap |
|---|---|---|
| Read the selection at sequence time | `panel/premiere.js` `readTimeline` (L110), `readItems` (L95), `readItem` (L65), `frameRate` (L56); `panel/subtitleplan.js` `planDialogue` (eligibility rules: speed ≠ 1, reversed, nested, offline) | none |
| One dialogue signal per moment, cleanest mic | `engine/asistent/dialoguemix.py` `build_mix` (L119), `same_speech` (L68), `_winner` (L112), `quality` (L57), `read_segment` (L193) | none |
| Words with timestamps (bg/en) | `asr.py` `transcribe` (L158, faster-whisper large-v3, word_timestamps, CPU int8 / CUDA fp16, `language` parameter); `subtitle_job.py` `plan_windows` (L145, 4 s context, same-file windows ≤ 120 s), `read_window` (L161), `window_words` (L248, second opinion); cache `cache/subtitles/` keyed by audio bytes (`_words_key` L100) | a word cache per media file, so a re-run with a different selection still hits (see §12) |
| Better word boundaries | `align.py` / `align_worker.py` MMS_FA (optional venv, weights CC-BY-NC); `align.speech_frames` (L161), `trim_silence` (L123), `uncovered_speech` (L205) | none |
| Speech and silence energy | `audio.py` `_frames_db` (L124), `_activity` (L133), `_phrases` (L279); `align.speech_frames` (voiced + centroid < 1800 Hz) | a VAD vote: Silero v6 is **already in the venv** at `faster_whisper/assets/silero_vad_v6.onnx`, and onnxruntime 1.31.1 is installed, so it needs no new dependency |
| Cut polishing on the audio | `tools/autoedit/cutcheck.py` (tighten, sliver, edges, dead_air, guard, lost_sound; adaptive thresholds L49–58). Used on real 4a1a work | to be copied into the engine (Asistent is an independent repo; `asr.py` was handled the same way) |
| Sentences, repeats, false starts | `tools/autoedit/edit.py` `sentences` (L12), `suggest_retakes` (L28, difflib ≥ 0.6, prefix false start, keeps the last take), `keep_ranges` (L48), `to_frames` (L66) | ranking of takes, restarts inside a sentence, correction cues, confidence gates |
| Premiere XML | `tools/autoedit/export.py` `write_xmeml` (L235), `write_timeline` (L131, multi-track, exploded stereo, NTSC `_rate` L81, `_pathurl` L87). Four import bugs were fixed and **confirmed by the user in Premiere** (2026-10-24) | automatic import (today it is File > Import by hand) |
| Background jobs | `jobs.py` `JOBS.submit`, progress/message, `job.cancelled`; `server.py` `_start_*` helpers, `GET /jobs/<id>`, `POST /jobs/<id>/cancel` | new endpoints only |
| Multi-POV alignment | the `SYNC – <seq>` sequence already holds the cameras aligned on tracks (`buildSyncSequence` L186); `groups.sync_groups` offsets; `chrono.py` | none: the rough cut works on the synced sequence (§9) |
| Building a new sequence | UXP: `createSequenceFromMedia`, `createInsertProjectItemAction` (whole frames as ticks, plain `ProjectItem`), one transaction is one Undo step. Host (ExtendScript): `importFiles`, `createSubClip`, `overwriteClip` (exact to the tick), `linkSelection` | trimming of track items was never used; XML import from code was never probed; markers were never probed |
| UI | card pattern (`index.html` `.card` + `.title` + `.desc` + `button.action[data-tip]`), `main.js` `button` (L83), `runJob` (L221), `finish` (L159), views Инструменти / Дневник / Преди·след, `onSync` (L271) as the flow template | the card „ГРУБ МОНТАЖ“ and a review list |
| Tests | 18 pytest files, `tests/synth.py` (talker, scene, mic, write_mp4), `test_real_footage.py` (GStroy), node tests for pure panel modules, `wiring.test.js` (zip list, tooltips, no removal), `scripts/dev_cmd.py` `timeline`/`selection`/`click`/`host eval` | an evaluation harness against manual reference edits |

**Hard constraints from DECISIONS.md and BUGS.md that shape the design:**
- **No track item removal through UXP.** Clone + remove crashed Premiere 26.0.2 (DECISIONS.md:31). The host removes nothing unless the user approves it. So the rough cut can never be built as "duplicate the sequence, then delete the bad parts". It has to be built **additively** into a new sequence.
- Premiere 26.0.2 is older than Adobe's published types (26.2+). `createSubClipAction` (26.3), `ClipProjectItem.createSetInPointAction` (fixed only in 26.5), `transcribeClipProjectItem` (26.5) and `ProjectConverter` (26.2, export only) **cannot be relied on**. Every call goes through `maybe()`/`has()`.
- There is no multicam creation, no razor in UXP, and the QE razor is reported broken in 26.0.2.
- New track items carry no effects from the original. Lumetri, Volume, the L/R subclips and the limiter therefore stay behind, so the rough cut belongs right after Sync and before audio, colour and subtitles. The panel says this when the selected items carry effects.

---

## 2. Open-source research (verified 2026-11-03)

| Project | What it gives Asistent | Maintained | Licence (code / weights) | Mac / Win | Use |
|---|---|---|---|---|---|
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Words + timestamps; ships Silero v6 | v1.2.1, 2025-10 (slowing) | MIT / Whisper MIT | Mac CPU only (CTranslate2 has no Metal); CUDA on Win | **Keep** (already installed and tuned for Bulgarian) |
| [mlx-whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) | Same large-v3 weights on the Apple GPU, word timestamps, about 5–7× faster than CPU int8 in a third-party M4 test | 0.4.3, 2025-08 | MIT / MIT | Mac only | **Optional later** backend, only after a Bulgarian A/B against the current text |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | Metal / Core ML, built-in VAD | v1.9.5, 2026-10 | MIT | both | Not used: its word timestamps are "experimental" |
| [Silero VAD](https://github.com/snakers4/silero-vad) | Speech probability every 32 ms, about 2 MB, under 1 ms per chunk | v6.2.3, 2026-09 | MIT (LICENSE file; the README's NC badge is out of date) | both, ONNX | **Use** as one vote in the silence decision (the asset is already installed) |
| [auto-editor](https://github.com/WyattBlue/auto-editor) | Loudness/motion cutting, Premiere XML export, `--margin` | 31.8.0, 2026-10-30, very active; now Nim binaries, no pip | Unlicense | both | **Reference only**: it does not understand words, so it cannot find takes |
| [WhisperX](https://github.com/m-bain/whisperX) | ASR + wav2vec2 alignment + pyannote | v3.8.6, 2026-05 | BSD-2; diarization models gated | Mac CPU | Not used: no Bulgarian aligner by default, heavy torch/pyannote chain |
| [stable-ts](https://github.com/jianfch/stable-ts) | Silence-suppressed timestamps, `refine()` | **archived**, last 2.19.1 (2025-08) | MIT | both | Ideas only (snapping word edges to silence) |
| [CrisperWhisper](https://github.com/nyrahealth/CrisperWhisper) | Verbatim fillers, stutters and false starts | v2, 2026-07/09 | MIT / **non-commercial weights** | fast path is NVIDIA/Linux | **Rejected**: weights licence, and Bulgarian is unproven |
| [pyannote.audio](https://github.com/pyannote/pyannote-audio) | Diarization, overlap detection | 4.0.7, 2026-06 | MIT; community-1 CC-BY-4.0, gated via HF token | MPS unofficial | **Later, optional** (off-camera speaker detection) |
| [TEN VAD](https://github.com/TEN-framework/ten-vad) / [WebRTC VAD](https://github.com/wiseman/py-webrtcvad) | VAD | active / stale | Apache + anti-competition clause / BSD | both | Rejected (TEN: licence conditions; WebRTC: triggers on breaths and noise) |
| [RapidFuzz](https://github.com/rapidfuzz/RapidFuzz) | Fast Levenshtein, partial/token ratios, opcodes; handles Cyrillic | 3.14.6, 2026-08 | MIT | both, wheels | **Use** for take matching (small wheel; stdlib `difflib` is the fallback) |
| [sentence-transformers](https://github.com/UKPLab/sentence-transformers) + `intfloat/multilingual-e5-small` or `paraphrase-multilingual-MiniLM-L12-v2` | Meaning-level similarity for reworded takes; both tagged `bg` | 6.2.0, 2026-10 | Apache / MIT or Apache | both (CPU fine) | **Optional M5**, only if lexical matching misses real reworded takes. Needs a download of roughly 120–470 MB, so it waits for the user's OK |
| [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) + [otio-fcp-adapter](https://github.com/OpenTimelineIO/otio-fcp-adapter) | FCP7 XML writer | 0.18.1 / adapter 1.0.0 (2023, 11 stars) | Apache | both | Not used: autoedit's own `xmeml` writer is already proven in Premiere |
| DNSMOS ([DNS-Challenge](https://github.com/microsoft/DNS-Challenge)) | Reference-free speech quality (signal, background, overall), ONNX | repo | CC-BY-4.0 (to re-check before use) | both | Optional tie-breaker between takes (M5) |
| NISQA, torchaudio SQUIM, MMS_FA | quality / alignment | — | NISQA weights NC-SA; SQUIM uncertain; MMS_FA NC | — | NISQA and SQUIM not used. MMS_FA stays the optional aligner, which is the user's pending licence decision |
| `classla/wav2vecbert2-filledPause` | Filled-pause frames (South Slavic training) | 2024 | Apache | both, but 600M parameters | Research option only; not tested on Bulgarian |

**Repeated-take detection, the honest state of open source:** no mature project exists. Small repos (`Dassuvam/scriptcutter`, `mrbuslov/capcut-ai-editor`, `rafcopy/auto-cut-agent`, `asawyers/jumpcut`) all do the same three things: word timestamps, then grouping of similar sentences, then keeping the last one. None publishes an evaluation. FireCut documents the same approach (minimum phrase length, tolerance, search radius, consecutive repeats only, "last take" suggested). Asistent builds its own, starting from autoedit's `suggest_retakes`. It adds non-consecutive matching, restarts inside a sentence, correction cues and a scored, gated choice instead of "always the last one".

---

## 3. Recommended technology stack
- **ASR:** the existing `asr.py` (faster-whisper large-v3, `language` = `bg` or `en`, chosen in the card; default bg). There is no new model.
- **Word edges:** Whisper times, snapped to the audio by the copied cutcheck passes. MMS_FA is used if the user has installed it (`align.py`, already optional).
- **Speech map:** a frame label every 10 ms from three independent signals: word coverage, energy above an adaptive floor (`align.speech_frames`), and the Silero v6 probability (onnxruntime, the asset already in the venv).
- **Take matching:** RapidFuzz plus Bulgarian normalisation (lowercase, `bgtext` spelling, numbers through `numbers.py` spoken forms). Meaning-level embeddings are optional later.
- **Timeline:** an FCP7 `xmeml` written by the engine (a port of `tools/autoedit/export.py`), imported as one new sequence. The UXP additive build is the fallback (§8). Which one wins is decided by the M0 probes.
- **New dependency:** `rapidfuzz` only (MIT, about 3 MB wheel), added to `requirements.txt` and `LICENSES.md`, installed with the user's OK.

---

## 4. Proposed system architecture

```
Panel (UXP)                                Engine (Python, 127.0.0.1:47390)
───────────                                ─────────────────────────────────
card ГРУБ МОНТАЖ
 readTimeline() ──► roughcutplan.js ──POST /roughcut──► roughcut_job.run(job)
 (selected items,     (eligible items,                    1 dialoguemix.build_mix      (sequence time)
  fps, seq name,       tracks, warnings)                  2 words: subtitle_job windows + wordcache
  frame size)                                             3 speechmap: words ∪ energy ∪ Silero → 10 ms labels
                                                          4 pauses.plan   (silence ranges + pause budget)
 runJob() progress ◄──────────── job.progress            5 takes.find    (sentences, repeats, false starts, restarts)
                                                          6 takescore.rank(groups) → decisions + confidence
 review list ◄──── decisions.json (mode applied)          7 cutpolish (cutcheck port: edges, guard, dead_air)
                                                          8 edl.build: kept ranges in SEQUENCE time, frame-snapped
 „Построй“ ──POST /roughcut/build {overrides}──►          9 xmeml.write(edl × every selected item)
 host import_xml ◄──── xml path                          10 report + JSON in <project>/Asistent_roughcut/
 verify via readItems() ──► finish(summary)
```

**New engine modules** (flat, like the existing ones): `speechmap.py`, `vad.py` (Silero through onnxruntime), `pauses.py`, `takes.py`, `takescore.py`, `cutpolish.py` (cutcheck port), `edl.py`, `xmeml.py` (export port), `wordcache.py`, `roughcut_job.py`. Server: `POST /roughcut` (analyse plus the mode's decisions), `POST /roughcut/build` (decisions plus overrides, then XML), `GET /roughcut/last`.

**New panel modules:** `roughcutplan.js` (pure: eligibility, track map, effect warnings), `premiere-roughcut.js` (read, then import or build, then read back and verify). Host: command `import_xml` in `host.jsx` `as_run` plus `hostbridge.COMMANDS`. Add both panel modules to the zip list in `scripts/package_ccx.sh` (a wiring test checks this).

**Key principle: one decision list in sequence time.** Every cut is a range on the *source sequence's* timeline. It is applied identically to every selected item that crosses it: each camera, each mic, both channels. Sync therefore cannot break, because no track is cut on its own (§9).

**Output files:** `<project folder>/Asistent_roughcut/<seq> <date-time>.json` holds all evidence and decisions, so a run can be reproduced and reviewed. Next to it go `.xml` and `.md`, a readable report in Bulgarian.

---

## 5. Silence detection strategy

1. **Labels every 10 ms.**
   - **WORD:** covered by a recognised word plus padding.
   - **VOICED:** energy above the adaptive speech threshold (cutcheck L49–58: floor = 5th percentile, voice = median of frames above 4× the floor, threshold = voice × 0.23) **and** Silero ≥ 0.35, but no word. This covers laughter, reactions, sighs, "ъъ", and quiet words that Whisper missed.
   - **BREATH/LOW:** above the floor but below the speech threshold.
   - **SILENT:** everything else.
2. **A range is cut only when all three signals agree** that there is no speech: no word, Silero < 0.2, and energy below the threshold. VOICED frames are **never cut automatically**. In Safe they are kept and flagged when they last longer than 0.6 s. In Smart they are kept unless they sit inside a take that loses. This handles quiet speech, laughter and reactions. It also answers the earlier finding that VAD drops speech: here VAD only gets a veto on cutting, never a vote for it.
3. **Pause budget instead of deletion.** A gap is shortened, never closed to zero.
   - Target pause = tempo preset. **Спокойно** keeps 0.45 s after a sentence and 0.30 s inside one. **Нормално** keeps 0.35 and 0.22. **Стегнато** keeps 0.25 and 0.12, which matches the 4a1a `edit-style.json` values 0.06 / 0.10 / 0.25.
   - Each cut keeps a lead-in of 0.08 s and a tail of 0.10 s. Up to 0.08 s of breath may stay (cutcheck `dead_air` rules).
4. **Dramatic pauses.**
   - **Safe** shortens only gaps longer than 0.8 s (Спокойно 1.2 s), and only to the budget.
   - **Smart** treats a gap that is followed by a sentence ending in `?`/`!`, a number or a punchline-like short sentence of 1–4 words, or that comes after a rising pitch, as "intentional?". It shortens it at most to 0.6 s, and it is listed.
   - Prosody features already exist in autoedit `asr.prosody` (loudness and pitch per word) and can be copied.
5. **Cut placement.** The copied cutcheck passes then do the placement:
   - `edges` moves each cut to the quietest 10 ms within ±40 ms;
   - `guard` restores any word whose midpoint was cut;
   - `sliver` drops pieces under 0.5 s that contain no word;
   - `lost_sound` lists loud audio that was cut but held no word.
6. **Frame snap.** A cut point is snapped to the sequence frame grid by choosing, among the 2 nearest frame boundaries, the one with less energy. Pieces that overlap after rounding are merged (`edit.to_frames`). A cut that lands inside a word after snapping moves outward by one frame.
7. **Options exposed:** tempo (3 presets) only. The thresholds sit in `roughcut_settings` per project, like `subtitle_settings.py`, for later tuning, but have no UI.

---

## 6. Repeated-take detection strategy

1. **Sentences.** A sentence ends on `.?!…`, on a pause over 0.5 s, or on a comma followed by a pause over 0.25 s (`edit.sentences`). Text is normalised: lowercase, punctuation stripped, Bulgarian spelling via `bgtext`, numbers as spoken words (`numbers.py`), fillers removed for comparison only (a list for bg and en: „ъъ“, „ами“, „ммм“, „така де“, "uh", "um", "like").
2. **Candidate pairs.** Each sentence is compared with every later sentence within **90 s or 12 sentences**. Non-consecutive repeats are found, which FireCut cannot do.
3. **Similarity, layered:**
   - `exact`: normalised word lists are equal.
   - `near`: RapidFuzz word-level ratio ≥ 0.75, or `token_set_ratio` ≥ 0.85 with a length ratio of 0.6–1.6.
   - `false_start` (prefix): the earlier sentence has ≤ 6 words, or ends without punctuation or is cut by a pause, **and** its first ≥ 2 content words equal the start of the later one.
   - `restart inside a sentence`: a repeated n-gram (n ≥ 2) with a pause or filler between the copies, as in „днес ще ви… днес ще ви покажа“. Only the first copy is the candidate cut.
   - `correction cue`: the repeat follows a cue such as „не, чакай“, „отначало“, „пак“, „давай пак“, „искам да кажа“, „тоест“, "sorry", "again", "let me start over", "take two", or a clap or slate (a short broadband transient). The cue itself and the take before it become candidates. The cue words are cut too, when they stand alone.
   - `reworded` (optional M5): embedding cosine ≥ 0.88 plus a shared content noun or number. Review only, never applied automatically.
4. **Take groups.** Union-find over the matched pairs gives groups `[t1, t2, … tn]` in time order. Each take spans from its first word to its last word, plus the attached cue and filler words.
5. **Content-safety rule.** If a non-winning take contains content words or numbers that the winner lacks (more than 2 such words, or any number), the group is downgraded to **review**. A different price or a fact said only once must not disappear.

---

## 7. Best-take selection strategy
The user's own rule from `client-edit` is *the last full and clean take*. That rule is the **prior**, not the verdict. Each take gets a score from the following features (weights in `takescore.py`, tuned on the evaluation set, §13):

| Feature | Measure | Source |
|---|---|---|
| Completeness | Ends with sentence punctuation or a falling energy end; not cut by the clip boundary; covers the group's union of content words (coverage ratio) | words, `edit.sentences`, clip bounds |
| Fluency | Fillers per word, restarts inside the take, internal pauses over 0.7 s, speech-rate variance | words + speechmap |
| Recognition confidence | Mean and minimum word probability; second-opinion agreement (`window_words`); count of `suspects`/`agreement` flags | `asr.py`, `subtitle_job.py` |
| Audio | Speech-to-noise ratio (`dialoguemix.quality`), clipping or true peak (`audio.true_peak`), a bump or handling noise (short broadband transient inside the take) | dialoguemix, audio |
| Position prior | +0.15 for the last take, +0.05 for the second to last | user rule |
| Interruption | Another voice or loud VOICED frames overlapping the take (laughter from the side, an off-camera question) | speechmap + mix sources |

**Decision gate (Smart):**
- The winner is applied automatically only if (a) it is complete, (b) its score beats the runner-up by ≥ 0.15, (c) the group is not downgraded by the content-safety rule, and (d) the group's match type is `exact`, `near` or `false_start`.
- Otherwise the group is placed in review. The prior choice (the last complete take) is pre-selected in the review list, but nothing is cut until the user confirms.
- **Safe never removes a take.** It keeps all takes in the sequence and lists them in review with the recommended one marked.

---

## 8. Premiere Pro integration approach
The plan offers two build paths behind one builder interface (`premiere-roughcut.js` → `build(edl)`). **M0 probes in TEST.prproj decide which is primary;** the result is recorded in `DECISIONS.md`.

**Path A (expected primary): engine-written FCP7 XML, imported as one new sequence.**
- The engine writes `xmeml` v4 with the port of `export.write_timeline`:
  - every selected item keeps its track index;
  - stereo is exploded the way Premiere's own export does it;
  - NTSC rates are written as `ntsc TRUE`;
  - every clip piece is linked V↔A;
  - sequence size and fps are taken from the source sequence.
- Import options, in order:
  - (A1) UXP `project.importFiles([xml], true, bin)`, which needs no host;
  - (A2) the host's `app.project.importFiles` (ExtendScript, proven for SRT).
- Sequence name `ГРУБ – <seq> (внимателно|умно) vN`, bin `Груб монтаж`.
- The import is one Undo step and removes nothing.
- Pros: frame-exact, identical on Windows, already proven to import cleanly (autoedit), and no subclip clutter.
- **To probe:**
  1. Does import from code create the sequence without a dialog?
  2. Does Premiere relink to the existing project items, or create duplicate master clips? Duplicates are acceptable only if put in a sub-bin.
  3. Are channel layouts and the L/R subclips' mapping kept? If they are not, the rough cut must come before L/R.
  4. Do 59.94 and 2160×3840 settings match?

**Path B (fallback): UXP additive build, the same mechanism as SYNC.**
- `createSequenceFromMedia`, then for each kept piece `createInsertProjectItemAction(projectItem, t, v, a)` at the running output time, followed by `trackItem.createSetInPointAction` and `createSetOutPointAction` (these exist on 26.0.2 per the logged method lists, but are unused so far).
- **To probe:**
  1. Do trims inside the same transaction apply to the inserted item? Clones are known to capture the pre-transaction state, so this may need a two-pass layout: first insert at widely spaced slots, then trim, then move.
  2. Does linked audio follow?
  3. How many Undo steps does it cost?
- Pro: it uses the same project items (keeps subclips and channel mapping).
- Con: more steps and fragile on 26.0.2.

**Review markers.** Uncertain places can be written as markers in the new sequence. In Path A they go straight into the XML, so no API is needed; in Path B they need `Markers.createAddMarkerAction`, which is unprobed. The user removed markers from SYNC because they wanted a clean timeline, so markers here are **opt-in** (a checkbox, default off) and appear only in the rough-cut sequence.

**Verification after every build.**
- The panel reads the new sequence back with `readItems` and compares it with the EDL: piece count, the start and end of every piece (within half a frame), and the source In points.
- It checks that every item kept its original `(source time − sequence time)` relation between cameras. That is the sync check.
- A mismatch is reported, never "fixed" silently.

**Never:** modifying the source sequence, removing items, muting, re-routing tracks, or applying anything that is uncertain.

---

## 9. Multi-POV editing approach
- **Input** is the `SYNC – <seq>` sequence, or any sequence where the cameras and mics are already aligned, with the A-roll items selected: all cameras plus the lavaliers. B-roll, music and graphics should not be selected. If they are, the panel names them and leaves them out, because cutting music at every silence would wreck it.
- **Analysis audio** comes from `dialoguemix.build_mix`. It already picks the cleanest mic per moment and recognises duplicate copies of the same speech.
- **Cuts** are ranges in sequence time. For every kept range `[a, b]` and every selected item that intersects it, there is one output piece with:
  - `source_in = item.inPt + (max(a, item.start) − item.start)`;
  - the same track index;
  - output time = the running sum of the kept durations.

  All tracks are therefore cut at exactly the same sequence times. Sync is preserved by construction and confirmed by the verification in §8.
- **Gaps and partial coverage** (one camera starts later, or a camera stopped) produce gaps on that track only. Gaps never shift other tracks.
- **Angle choice is not in scope.** All cameras stay stacked as in SYNC, and the editor picks angles. Suggesting an angle per sentence (from autoedit's prosody) is a possible Phase 8+ item.
- **Clips with existing edits.** Items with speed ≠ 1, reversed or nested items, and items crossing a cut that already exists are handled: each item is cut independently by the same ranges. Refusals use the `subtitleplan` rules and are named in the result. Items carrying effects get the warning from §1.

---

## 10. Safe Cut / Smart Cut workflow

| Step | Внимателно (Safe) | Умно (Smart) |
|---|---|---|
| Silence | Gaps over 0.8 s are shortened to the tempo budget | Every gap over its budget is shortened |
| Intentional pauses | Untouched | Shortened at most to 0.6 s and listed |
| VOICED without words (laughter, reactions) | Kept; listed if over 0.6 s | Kept unless inside a losing take |
| Repeated takes | All kept; listed with the recommended take | The winner is applied when the gate passes; otherwise listed |
| False starts / restarts | Listed | Removed when the gate passes (`false_start`, `restart`, `correction cue`) |
| Reworded or contradicting takes | Listed | Listed (never automatic) |
| Output | New sequence + review list (+ optional markers) | Same |

**Flow:**
1. One press of „Груб монтаж“ analyses and builds the sequence with the chosen mode, then opens it.
2. The review list in „Преглед“ shows every listed decision. The user can flip any of them: keep or cut, or choose take 2 instead of take 3.
3. „Построй отново“ writes a **new** version (`vN+1`). Earlier versions and the source sequence stay as they are.
4. Re-analysis is cached (§12), so a rebuild takes seconds.

---

## 11. UI/UX proposal (all texts in Bulgarian, the existing card style)

**The card „ГРУБ МОНТАЖ“** sits after СИНХРОН, in the Инструменти view.
- One-line purpose: „Изрязва паузите и повторените дубли в нова секвенция. Оригиналът не се пипа.“
- A segmented choice **Внимателно | Умно**. The tooltip explains each in one sentence. The default is Внимателно the first time; after that it remembers the last choice per project.
- A row of small selects: **Темпо** (Спокойно / Нормално / Стегнато) and **Език** (Български / English).
- One checkbox, „Маркери за прегледа“ (off by default).
- One main button, **„Груб монтаж“**.

**Progress** uses the existing `#work` bar and `#cancel`, with named stages: „Чета звука…“, „Разпознавам речта 3/12…“, „Търся паузите…“, „Търся повторенията…“, „Сглобявам секвенцията…“. Cancel writes nothing.

**Summary,** shown by `finish`:
> „Готово: 11:30 → 6:48 (−41 %). 58 паузи скъсени, 6 повторени дубъла и 3 сбъркани начала махнати, 4 места за преглед. Секвенция: ГРУБ – Ludi Glavi (умно) v1.“

**The view „Преглед“** is a fourth tab, shown only once a rough cut exists. Each row has:
- the time in the source sequence;
- the kind, with a pill: пауза / дубъл / сбъркано начало / смях-реакция / различен текст;
- the text of each take, with the chosen one highlighted and the reason in one line (for example „последният пълен, по-малко запъвания“);
- two buttons: „Задръж“ / „Изрежи“, or the take numbers;
- „Отиди“, if `setPlayerPosition` exists (probe; otherwise the time is shown to copy).

The footer has „Построй отново (vN+1)“.

**Дневник** gets the full report (counts per type, thresholds used, skipped items, the build check).

---

## 12. Performance strategy
- **Transcription dominates.** On the M4 Max, CPU int8 runs at about 2.8× real time, so 20 minutes of A-roll takes about 7 minutes. Three ways to bring this down:
  1. **Word cache per media file** (`wordcache.py`): words stored in *file* time, keyed by `(path, size, mtime, range, model, language, prompt)`. Any later run, with another selection, mode or tempo, or a rebuild, reuses them, and the subtitle job can adopt the same cache later without re-running Whisper. The existing `cache/subtitles` scheme stays as it is until then.
  2. Only speech regions are transcribed: the Silero + energy pre-pass skips long silences, then the existing same-file windows (≤ 120 s, 4 s context) run in parallel (`asr._parallelism`).
  3. Optional Apple GPU backend (mlx-whisper, the same large-v3 weights) behind a setting, **only after** an A/B on the Ludi Glavi, C9025 and Masterhaus clips shows equal Bulgarian text. On Windows, CUDA fp16 is already supported by `asr._device` (still untested there).
- **Silero** runs at about 1 ms per 32 ms chunk, so about 40 s of CPU for a 1-hour mix. Energy frames are vectorised numpy. Take matching is O(n·window) on sentences, negligible.
- **Memory.** A 16 kHz float32 mono mix is 230 MB per hour. Mixes over 60 minutes are processed in 10-minute blocks with 5 s of overlap. The decoded-audio cache (`cache.py`, 2 GB, LRU) is reused.
- **Incremental runs:** stages 3–9 rerun from the cached words and speech map in well under 10 s, so mode, tempo and override changes feel instant.
- **Trade-off:** speed knobs (beam 5 → 2, a smaller model) are **not** offered. Bulgarian accuracy problems were already measured and solved at large-v3 + beam 5, and wrong words would create false take matches.

---

## 13. Testing and validation plan

**Unit tests (pytest, `tests/test_roughcut_*.py`):**
- speechmap labels on `synth.talker` with known pauses, added noise (`synth.mic`) and a quiet voice;
- the pause budget per tempo;
- frame snap at 25 / 29.97 / 59.94;
- the EDL across 3 tracks with partial coverage;
- the xmeml round trip (parse it back and compare frames);
- take finding and scoring on **hand-written word JSON fixtures**, for bg and en:
  - exact repeat;
  - reworded repeat;
  - false start;
  - restart inside a sentence;
  - correction cue;
  - different price in a later take (must go to review);
  - a missing piece in the last take (must choose the earlier one);
- cancel writes nothing;
- caching.

**Node tests:** `roughcutplan.test.js` (eligibility, effect warnings, track map); `wiring.test.js` (new modules zipped, tooltips, no removal calls).

**Real footage, measured with numbers only, never viewed as images:**
- GStroy Ludi Glavi (bg, 2 POV + lav, retakes);
- C9025 (bg prices, the repeated pattern from different clips, which must *not* be called a duplicate);
- Masterhaus (two speakers, different distances);
- one 4a1a raw (tight tempo);
- **one English talking-head clip from the user** (ask at M2);
- a noisy outdoor clip;
- a clip with laughter and a dramatic pause.

**Reference comparison (`scripts/eval_roughcut.py`):**
- The user exports their own finished rough cut of the same footage as FCP XML (File > Export). The harness turns both cuts into 10 ms keep-masks in source time and reports:
  - **Harm:** words kept by the reference but cut by Asistent. Target: **0 in Safe**, ≤ 1 per 10 minutes in Smart.
  - **Silence recall:** the share of reference-removed non-speech that Asistent also removed. Target ≥ 80 % in Safe, ≥ 90 % in Smart.
  - **Boundary error:** cut points matched within 300 ms. Target median ≤ 40 ms, p95 ≤ 120 ms.
  - **Take agreement:** in groups Smart decided automatically, the chosen take equals the reference ≥ 95 % (precision); across all groups the recommendation equals the reference ≥ 80 %.
  - **Review load:** listed items per 10 minutes ≤ 8.
  - **Time saved:** the user's own stopwatch, manual rough cut against Asistent plus review.
- Gate weights and thresholds are tuned only on these sets and frozen in `DECISIONS.md` with the numbers.

**Premiere (TEST.prproj via `dev_cmd.py`):**
- `click "Груб монтаж"`, then `wait_idle`, then `timeline` on the new sequence: compare with the EDL JSON, check the camera offsets are unchanged, check the source sequence is byte-equal in its `timeline` dump before and after;
- the Undo count;
- a rebuild creates v2;
- 59.94 fps, 2160×3840.
- The user then watches the result once per milestone.

---

## 14. Technical risks and limitations
- **XML import from code is unverified.** It may show a dialog or duplicate master clips. Mitigation: the M0 probes, and Path B as the fallback.
- **Effects do not carry over** to new items (Lumetri, Volume, L/R subclips if XML loses the mapping). Mitigation: rough cut before polish; a warning in the panel.
- **Whisper errors become cut errors** (a missed quiet word, words timed up to 0.3 s off). Mitigation: VOICED frames are never cut, the `guard` pass, the three-signal agreement, Safe as the default.
- **Bulgarian take matching** depends on correct words. Similar-sounding wrong readings can hide a repeat or invent one. Mitigation: normalisation, the second opinion, and the content-safety rule pushing doubt to review.
- **The difference between "repeat" and "deliberate repetition"** (rhetorical repeats, the C9025 pattern of similar lines from different clips) cannot be solved by text alone. Mitigation: only an automatic cut inside 90 s *and* within the same continuous recording; matches across different source files go to review.
- **Reworded or corrected statements** ("20, не, 25 евро") are semantic. They are never removed automatically.
- **Off-camera talk** needs speaker separation (pyannote, gated model, HF token). It is out of scope at first, with only a heuristic flag (speech heard only on a camera mic at low level).
- **Licences:** MMS_FA (NC) stays optional and is the user's decision. No NC weights are added (CrisperWhisper, NISQA, TEN VAD rejected).
- **Premiere 26.0.2 API drift.** Newer methods (26.3+) may appear after an update, so every call goes through `has()` and `maybe()`. ExtendScript is frozen; its long-term removal is a risk for Path A2.
- **Windows** is untested for the whole engine. The XML path is the same there.
- **Frame-snapped audio cuts** can click on very loud continuous sound. Mitigation: snap to the quieter boundary; optional 2-frame audio crossfades in the XML are a later option, not the default.

---

## 15. Step-by-step implementation (each milestone follows the definition of done in `tools/asistent/CLAUDE.md`)
Agents follow `tools/DEV_WORKFLOW.md`: `architecture-planner` for M0 and for the decision gates, `feature-builder` for M1–M4, `test-runner` after each.

1. **M0: docs and probes (no feature code).**
   - Save this plan as `docs/ROUGHCUT_PLAN.md` and link it in `docs/INDEX.md` and `TODO.md`.
   - In TEST.prproj via `dev_cmd.py`:
     - (a) a two-camera + lav xmeml written by hand from autoedit's writer, imported through UXP `importFiles`, then through the host. Check: dialog, relink vs duplicates, channels, fps and size, linking, Undo;
     - (b) Path B: insert plus `createSetInPointAction`/`createSetOutPointAction` on one item, in one transaction and in two;
     - (c) a marker in the XML;
     - (d) whether `setPlayerPosition` exists.
   - Record the chosen path in `DECISIONS.md`.
2. **M1: speech map.** `speechmap.py`, `vad.py` (Silero ONNX from the faster_whisper assets), `wordcache.py`, with tests on synthetic and real clips. Nothing wired.
3. **M2: Safe Cut, silence only, end to end.**
   - Modules: `pauses.py`, `cutpolish.py` (cutcheck port with its tests), `edl.py`, `xmeml.py` (export port), `roughcut_job.py`, `POST /roughcut`, host or UXP import.
   - Panel: card „ГРУБ МОНТАЖ“, `roughcutplan.js`, `premiere-roughcut.js`, build verification.
   - `scripts/eval_roughcut.py`.
   - Verify on single camera and on SYNC multi-POV in TEST.prproj. **First usable release.**
4. **M3: takes and review.** `takes.py` (all matchers, content-safety rule), the „Преглед“ view, overrides, `POST /roughcut/build` with vN+1. Safe now lists takes.
5. **M4: Smart Cut.** `takescore.py`, the decision gate, intentional-pause rule; tune it on the reference edits and freeze the numbers in `DECISIONS.md`.
6. **M5 (optional, each needs the user's OK):** meaning-level embeddings (download), mlx-whisper backend after the Bulgarian A/B, DNSMOS tie-break, off-camera flag, opt-in markers polish, migrating the subtitle job onto `wordcache`.
7. **M6: Windows** run of the whole pipeline (with Phase 9).

**Defaults the user can change before M3** (my recommendation, no answer needed now): markers off by default, review in the panel, and every rebuild as a new version instead of replacing the old one.

---

## Verification of this plan's implementation (end to end)
- `"$HOME/Library/Application Support/Asistent/venv/bin/python" -m pytest tests -q -W error -p no:cacheprovider` and `node --test tests/*.test.js` all pass, including the new roughcut tests.
- `scripts/eval_roughcut.py <asistent json> <reference.xml>` reports the §13 metrics on at least the Ludi Glavi and one 4a1a set, within the targets.
- In TEST.prproj: `dev_cmd.py on`; `click "Груб монтаж"`; `wait_idle`; `timeline`. Check:
  - the new sequence's pieces equal the EDL within half a frame;
  - the camera offsets are unchanged;
  - the source sequence's timeline dump is identical before and after;
  - the reported Undo count is right.
- The user watches one Safe and one Smart result and confirms them; review overrides produce v2 without touching v1.

## M0 results (2026-11-03, TEST.prproj, Premiere 26.0.2) - Path A (XML import) is the build path
Probed with a two-camera XML written by autoedit's `export.write_timeline` (Masterhaus clips fx31028 + C0728, two kept ranges, 2160x3840 at 29.97):
- **UXP `project.importFiles([xml], true, bin)` creates the sequence without any host and returned `accepted: true`.** The sequence has the right size (2160x3840) and rate, V1/V2 and A1/A2, every piece frame-exact (4.004 s = 120 frames), source In points as written, and the camera offset intact (fx31028 In 36.0026 vs C0728 In 1.6683: difference 34.3343 = the original offset). V and A of each piece are linked (`getLinkedItems` = 2). No host (ExtendScript) import is needed, so the path is the same on Windows.
- **Master clips**: the first import makes new project items for the media in the target bin (duplicates of the existing master clips, same media path); a second import reused them. Put the sequence and its clips in the bin „Груб монтаж“.
- **Markers inside the XML work**, Cyrillic names and comments included (`<marker>` before `<timecode>`: two markers at 2.002 s and 5.005 s, type Comment). No marker API is needed.
- **`sequence.setPlayerPosition` exists** (a „Отиди“ button in the review list is possible).
- Not probed, not needed now: Path B (UXP additive build with trims), the Undo count of the import, whether Premiere showed any dialog during the import (none seen by the script).
