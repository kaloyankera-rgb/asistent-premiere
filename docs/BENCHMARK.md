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

## Commands
```
python3 scripts/bench_asr.py hyp   --backend classic            # recognise all clips (app's Python); --backend whispercpp too
python3 scripts/bench_asr.py draft --from classic               # drafts for a person to correct
python3 scripts/bench_asr.py score --backend classic --set dev  # table (venv-bench), --json out.json for details
python3 scripts/bench_asr.py agree --a classic --b whispercpp   # difference between two backends, not accuracy
```
