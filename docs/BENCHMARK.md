# Bulgarian recognition benchmark (development only)

Measures recognition backends against human-verified Bulgarian transcripts, so a change (a new backend, a setting) is
adopted only on evidence: fewer wrong words, especially the ones that change meaning, less correcting, or faster without a
quality loss. Code: `engine/asistent/bench/` (`normalize.py`, `metrics.py`), CLI `scripts/bench_asr.py`, tests
`tests/test_bench.py` (any venv) and `tests/test_bench_metrics.py` (needs jiwer).

## Setup (once)
- jiwer 4.0.0 lives in its own venv, never in the app's: `/opt/homebrew/bin/python3.12 -m venv "<app>/venv-bench" &&
  "<app>/venv-bench/bin/pip" install -r requirements-bench.txt` (done on the development Mac 2026-11-08).
- Private store (client speech, never committed): `~/Kaloyan/02_RESOURCES/Asistent benchmark/` with `manifest.json`,
  `refs/` and `results/<backend>/`. `bench_asr.py init` created it with the Masterhaus starter set.

## What is measured
| Measure | How |
|---|---|
| WER, CER | jiwer, in two views: raw (lower case, punctuation removed) and normalized (digits written as spoken, standard and colloquial numerals unified). ъ, ь, й, ѝ and hyphenated words are kept: ѝ is not и. Nothing is stemmed. |
| Numbers and prices | reference words that are digits or numerals/units; error = substituted or deleted |
| Negations | не, ни, нито, без, няма…, никога… (the take matcher's set); plus negations the result inserted |
| Names | capitalised reference words not starting a sentence, plus the clip's `names` in the manifest |
| Omissions | deleted reference words; runs of 3+ deleted words listed as dropped passages |
| Word timing | start error of matching words when both sides have word times (median, p90, share within 80 ms) |
| Correction effort | word edits (substitutions + deletions + insertions) |
| Time, memory | recognition seconds (model load apart), x real time, peak RSS of the backend's process |

Scores against an unverified draft are refused (or, with `--allow-unverified`, labelled "not accuracy"). Agreement between
two backends (`agree`) is reported as a difference, never as accuracy; two readings of the same model are not independent
confirmation.

## Reference sets
| Clip | Media (lavalier, right channel) | Split | Reference |
|---|---|---|---|
| mh-fx31028 | Masterhaus кам2 fx31028, 56.1 s | dev | draft only, NOT verified |
| mh-fx31031 | Masterhaus кам2 fx31031, 36.0 s | dev | draft only, NOT verified |
| mh-fx31032 | Masterhaus кам2 fx31032, 51.1 s | held-out | draft only, NOT verified |

The held-out clip is never used to tune anything, typed into corrections or learned from. More clips (ReShape, GStroy,
Ludi Glavi) are added the same way: a manifest entry, a reference a person checked word by word against the audio.

**To make a reference:** open `refs/<id>.draft.txt` (Classic's words), listen to the clip, correct every word exactly as
said (no tidying, keep fillers that are said), save as `refs/<id>.ref.txt` without the `#` lines, set `"verified": true`.

## Results so far (2026-11-08)
No accuracy numbers yet: no reference is verified. Measured without a reference (Classic = Asistent's own
`asr.transcribe`, faster-whisper large-v3 int8 beam 5 on the CPU of the M4 Max, whole clip in one call):

| Clip | Audio | Recognition | Model load | Peak memory |
|---|---|---|---|---|
| mh-fx31028 | 56.1 s | 103.6 s (0.5x real time) | 1.8 s | 6.6 GB |
| mh-fx31031 | 36.0 s | 21.6 s | (in run) | 4.3 GB |
| mh-fx31032 | 51.1 s | 27.0 s | (in run) | 4.8 GB |

fx31028 is slow on every run (103-108 s): the whole-file call spends its time on that clip's long non-speech parts (the
app's subtitle job reads speech windows instead, so its time differs). Total 152 s against the 123 s of the 2026-11-08
measurement on the same three files.

## whisper.cpp against Classic (2026-11-08; no verified reference yet, so differences, not accuracy)
whisper.cpp v1.9.5 (MIT; tag published 2026-10-06), built with Metal in `<app>/experiments/whisper.cpp` (outside the repo and
the app), model `ggml-large-v3.bin` (multilingual large-v3, SHA-256 `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`),
`-l bg -bs 5 -bo 5 -t 8 -ml 1 -sow` (beam 5 like Classic; one word per segment for word times).

| | Classic (faster-whisper int8, CPU) | whisper.cpp (Metal) |
|---|---|---|
| Recognition time, 3 clips (143 s) | 152.2 s (103.6 + 21.6 + 27.0) | 20.8 s (14.9 + 2.5 + 3.3): 7.3x faster |
| Model load | 1.8 s | 0.7 s |
| Peak memory (RSS) | 4.3-6.6 GB | 4.0-4.1 GB |
| Words differing from the other backend | 18-30 % (normalized) | (same comparison) |
| Word starts vs Asistent's MMS_FA-aligned times (fx31031, 27 matched words; machine alignment, not truth) | median 0.23 s, p90 0.91 s | median 0.53 s, p90 1.62 s |
| Cancel | per segment (asr.py) | TERM stops it in 0.04 s, no partial output |

Seen in the texts (read, not measured; to be scored once the references are verified): whisper.cpp ends fx31028 with an
invented „Абонирайте се!“ (the known Whisper hallucination from YouTube subtitles, not said), writes „500 млн.“ where Classic
has „500 мм“ (a measuring-tool size), „пусока“ for „посока“, and puts a dialogue dash before every sentence; it also kept
words Classic dropped („Много добре“). Classic misreads too („Ричу лице ви“, „хаоти“).

**Decision: not wired into Asistent.** Faster, but with an invented line, a unit error and rougher word times, and no
verified reference to show it makes fewer meaning errors. Next step: once the user verifies the three references, `score`
both; only if whisper.cpp has no more meaning errors (numbers, negations, names, invented or dropped passages) than Classic,
add it as an optional, experimental backend (setting `asr_backend`, default classic, never for ReShape, own cache key). A
hallucination guard (whisper.cpp's VAD with the Silero GGML model, or dropping known YouTube phrases) would be measured the
same way. MLX (greedy only, clearly worse words, 2026-11-08) is not re-run.

## The whole subtitle job against the editors' finished videos (2026-11-20, `scripts/bench_subtitles.py`)

`bench_asr.py` above scores the recogniser alone and still waits for references a person verified. The 2026-11-20 audit needed
something else: what the EDITOR gets, measured now, on many clients. The office's finished videos carry subtitles made in
another tool (Submagic) and corrected by an editor, so their text does not share Asistent's mistakes. They are the reference.

- `pick <client's export folder>`: vertical videos of 15-150 s with „субтитри“ in the name, two from each of the newest content
  plans, six per client; their sound is copied into the private store (`~/Kaloyan/02_RESOURCES/Asistent benchmark/exports/`), so a
  run needs no share. The chosen videos alternate **dev / heldout** per client: tune on dev, judge on heldout, never the reverse.
- `refs`: the burned-in subtitles read once with the Mac's text recognition at 8 frames a second (`measure_style.py`'s chunk
  reader). The frames are measured, never looked at, and deleted at once.
- `run --profile <name>`: the real `subtitle_job.run` in a child process whose HOME is the benchmark's own folder: no project,
  so no learning folder is read or written and no `Asistent_subtitles` folder is made anywhere. Readings are cached there, so a
  profile that changes only what happens to the words afterwards is scored in seconds. `--cold`: an empty HOME, for timing.
  - `strict`: the Auto style as shipped in 0.10.118, run from that version's code kept in the store (the baseline cannot move);
  - `now`: the Auto style of the working tree; `classic`: the same sound through the ReShape style's recognition;
  - `next`, or any name with `--next '{"second": "none", "level": -20}'`: the NEXT profile with those fields (`recognition.py`).
- `score --profile <name> --set dev|heldout`: per client, the word error rate of Whisper's **first reading** (`verbatim`) and of
  the **final text** (`words`), and every reference word right in one and wrong in the other, counted as right → wrong or
  wrong → right and given to its layer through the run's `edits`: `repair` (dictionary), `swap` (another reading replaced the
  piece), `writing`, `english`, `learned`, `speaker`, or `unlogged`. Also lines of 3+ words nobody said, and seconds of work per
  second of sound. The words behind the counts go to a private report in the store.

  More switches of `run`: `--pieces` cuts each video into clips of 3-9 s at its quiet points first, which is how an editor's
  timeline reaches the job (results under `<profile>+p`); `--jobs N` runs N videos at once (never while timing); `--clip` /
  `--client` / `--set` choose the videos; `--again` runs a video that already has a result; `--compute float32` and
  `--model-dir DIR` try another number format or another model without touching the app's code. A video whose reference is
  not what was said gets `"skip": "<why>"` in the store's `manifest.json` and is left out of every table.

**The office share is only read** (the user's rule, 2026-11-20). The script refuses to write under `/Volumes/` or into the repo.

**How to read the numbers.** Both sides are folded hard (`bench/layers.py`): й/ѝ → и, ь → ъ, a hyphen splits a word, digits are
compared as spoken, a word in Latin letters is one placeholder that is never counted (the editors write IPHONE-А for „айфона“),
and Cyrillic words the text recognition read in look-alike Latin capitals (XPAHATA) are put back when the result is a real word.
Even so the absolute rate is **pessimistic and not Asistent's accuracy**: the videos have music under the voice, editors tidy
what was said, and the text recognition misreads some letters. Use it to compare two configurations on the same sound.

### Results of 2026-11-20/21 (28 videos of GStroy, Credissimo, ЕКОПАК, Beauty Sector and AULA; ReShape not included)

Wrong = reference words that are missing or written as another word. Tuning = the 15 dev videos (2237 reference words),
held-back = the 13 heldout videos (1934 words; two more were skipped: a counting game and a screen recording, whose burned-in
text is not what is said).

| What ran | Wrong, tuning | Wrong, held-back | Work per second of sound |
|---|---|---|---|
| Auto as shipped in 0.10.118 (`strict`) | 315 (14.1 %) | 335 (17.3 %) | 3.1 s (short clips, cold) |
| Best local profile (full precision, careful and by-ear repair, one reading) | 281 (12.6 %) | 323 (16.7 %) | 2.1 s |
| **ElevenLabs Scribe v3, its own words (`cloud`)** | **138 (6.2 %)** | **227 (11.7 %)** | **0.16 s, upload included** |
| The whole job with Scribe, dictionary repair off (0.10.119, profile `cloud`) | 143 (6.4 %) | 231 (11.9 %) | about 0.2-0.4 s |
| ... with the careful and by-ear repair on | 147 | 232 | |

The whole job scores a few words under Scribe's own text because an English name written in Latin letters („Beauty Sector“
for „бюти сектор“) counts against the Cyrillic reference; the same happens in every local row.

Local experiments (tuning videos; none became a default, see `recognition.py`):

| What ran | Wrong | Kept? |
|---|---|---|
| No second and louder readings | 315 (held-back 335) | the same words as shipped for less reading |
| Model in full precision (float32) | 285 (held-back 326) | the only single local change above the noise |
| Dictionary repair: careful steps, then by ear | 309 (held-back 332): fixed 14 against 10, broke 3 against 3 | small, consistent |
| As short clips: one reading / piece read again alone, fewer words cannot win / the same without that rule | 284 / 279 / 302 | the rule is what makes a second reading safe |
| Read in parts of 30 s, as short clips, full precision | 302 against 284, 2.8x faster (1.1 s per second) | not decided: held-back runs stopped |
| Read in parts of 20 s | 341 | no |
| Level evened out to -20 dBFS | 313, more invented lines | no |
| No carry-over between 30 s stretches / voice detection / no temperature retries | 316 / 315 / 315 | no |
| Search width 10 instead of 5 | 306 for 1.4x the time | no |
| Bulgarian fine-tune of large-v3 (BuzzASR/bulgarian, converted locally) | 367 | no, removed |

What the numbers say:
- **Most wrong words are already wrong in Whisper's first reading.** The layers after it (dictionary repair, reading swaps,
  writing rules) broke 13 right words and fixed 13 wrong ones of 2237 in the shipped Auto. No local setting moves that far;
  another model does.
- **Differences under about 15 words between two readings are noise**: cutting the same videos at other points alone moves
  the count that much. Layers that work on the same readings are compared word by word instead (broke / fixed).
- **The material decides for every model**: clean talking heads are 3-6 % wrong locally and 1-3 % with Scribe; GStroy's
  held-back street interviews 36 % and 26.5 %.
- The absolute rates are pessimistic for every row (music, tidied text, misread letters in the reference).

## Commands
```
python3 scripts/bench_asr.py hyp   --backend classic            # recognise all clips (app's Python); --backend whispercpp too
python3 scripts/bench_asr.py draft --from classic               # drafts for a person to correct
python3 scripts/bench_asr.py score --backend classic --set dev  # table (venv-bench), --json out.json for details
python3 scripts/bench_asr.py agree --a classic --b whispercpp   # difference between two backends, not accuracy

python3 scripts/bench_subtitles.py pick "/Volumes/Production/Exported Videos/<client>"   # once per client (share only read)
python3 scripts/bench_subtitles.py refs                          # read the burned-in subtitles of the chosen videos
python3 scripts/bench_subtitles.py run   --profile strict --set dev
python3 scripts/bench_subtitles.py run   --profile noswap --set dev --next '{"second": "none"}'
python3 scripts/bench_subtitles.py score --profile noswap --set dev
python3 scripts/bench_subtitles.py run   --profile next --clip gstroy-kp9-v1 --pieces --cold --again   # timing: short clips, nothing cached
python3 scripts/bench_subtitles.py cloud --upload                    # Scribe alone on the same sound (UPLOADS it: only on the user's yes)
python3 scripts/bench_subtitles.py run   --profile cloud --upload     # the whole job with Scribe reading; key in ~/.config/asistent/elevenlabs.key
```
