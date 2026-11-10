# Licenses of what Asistent uses

| Component | License | How it is used |
|---|---|---|
| NumPy | BSD-3-Clause | Python dependency (engine) |
| SciPy | BSD-3-Clause | Python dependency (engine): FFT, filters, resampling |
| watchdog | Apache-2.0 | Python dependency (engine): folder watching (FSEvents on Mac, ReadDirectoryChangesW on Windows) |
| OpenCV (`opencv-python-headless`) | Apache-2.0 | Python dependency (engine): runs the face detector (`FaceDetectorYN`) on the CPU |
| YuNet `face_detection_yunet_2023mar.onnx` | MIT (OpenCV Zoo, from libfacedetection by Shiqi Yu) | 233 KB model bundled in `engine/asistent/models/` (sha256 8f2383e4…2fa4); finds faces so Shot Match measures skin only on faces |
| faster-whisper, CTranslate2 | MIT | optional (`requirements-asr.txt`): speech recognition for subtitles (Phase 7) |
| Whisper large-v3 weights (OpenAI), CTranslate2 conversion `Systran/faster-whisper-large-v3` | MIT | ~3 GB model, downloaded from the panel after the user confirms; stored in `<app folder>/models/whisper` |
| NLLB-200 distilled 1.3B (Meta), CTranslate2 int8 conversion `JustFrederik/nllb-200-distilled-1.3B-ct2-int8` | CC-BY-NC 4.0 (non-commercial, like the aligner) | 1.38 GB model in `<app folder>/models/nllb-1.3b-int8`, downloaded 2026-11-04 with the user's OK; Bulgarian -> English for the English subtitle line (since 0.9.97) |
| NLLB-200 distilled 600M (Meta), CTranslate2 int8 conversion `JustFrederik/nllb-200-distilled-600M-ct2-int8` | CC-BY-NC 4.0 (non-commercial, like the aligner) | 623 MB model in `<app folder>/models/nllb-600m-int8`, downloaded 2026-11-04 with the user's OK; used until the 1.3B one is downloaded |
| sentencepiece | Apache-2.0 | optional (`requirements-asr.txt`): tokenizer of the translator |
| Montserrat (Julieta Ulanovsky) | SIL Open Font License 1.1 | Bold, SemiBold, ExtraBold installed in the user's Fonts folder 2026-11-04 (user's OK): the Bulgarian subtitle line of the reference style. Montserrat Bold and (0.10.20, the GStroy and Credissimo subtitles) Montserrat Black ship in `fonts/` with the licence `fonts/OFL.txt` (redistribution allowed) and are installed into the user's fonts by the setup |
| huggingface_hub, tokenizers | Apache-2.0 | optional: model download and text tokens |
| onnxruntime | MIT | optional: voice activity detection used by faster-whisper |
| PyAV | BSD-3-Clause (bundles LGPL FFmpeg libraries) | optional: dependency of faster-whisper |
| torch, torchaudio | BSD-3-Clause / BSD-2-Clause | optional (`requirements-align.txt`, own environment `venv-align`): runs the aligner |
| MMS_FA weights (Meta, *Scaling Speech Technology to 1,000+ Languages*) | **CC-BY-NC 4.0 (non-commercial)** | optional: `align_worker.py` places each word where it is pronounced; the licence text is in torchaudio's `MMS_FA` documentation. Using it for paid client work is a decision for the user; without it Asistent keeps Whisper's word times |
| spylls | MIT | optional (`requirements-asr.txt`): pure-Python Hunspell reader for the Bulgarian word check (`lexicon.py`) |
| Bulgarian dictionary `bg_BG` (LibreOffice `dictionaries`, Radostin Radnev et al.) | GPL v2 | optional: downloaded by `setup_mac.sh --subtitles` into `<app folder>/models/lexicon` (not in this repository, not redistributed); used only to tell a real word from a mis-heard one |
| CMU Pronouncing Dictionary (Carnegie Mellon University) | BSD-2-Clause | `engine/asistent/models/english_bg.json.gz` (381 KB) is derived from it by `scripts/build_english_index.py` together with the en_US Hunspell list in spylls and Whisper's tokenizer: how a Bulgarian writes each common English word, so English words said in Bulgarian speech are written in English (`english.py`, 0.10.2). Copyright (C) 1993-2015 Carnegie Mellon University; the BSD notice is in `engine/asistent/models/english_bg.LICENSE.txt` |
| Asistent host (`host/`, CEP extension) | own code | runs ExtendScript inside Premiere to put the SRT on a caption track; needs CEP `PlayerDebugMode=1` (already set for Quick Search) |
| pytest | MIT | development only |
| FFmpeg / FFprobe | LGPL-2.1+ / GPL (depends on build) | separate program called as a subprocess; not linked or redistributed |
| Adobe Premiere Pro UXP API | Adobe developer terms | the panel calls the `premierepro` module inside Premiere |

No code was copied from other projects. The sync algorithm was written for Asistent; the idea of an
onset curve is shared with Quick Search (`tools/premiere-barzo/.../sync.js`, same author) and with
`tools/_vendor/wearenocode/youtube-edit/scripts/sync-tracks.py` (MIT), neither of which is imported.

Later phases will add, after a license check at that time: faster-whisper (MIT).

| Apple Vision (macOS) | part of macOS | text recognition for Move off faces (`ocr.swift`, compiled locally with the command line tools) |

## Development only (never installed for editors)
| Component | License | How it is used |
|---|---|---|
| jiwer 4.0.0 | Apache-2.0 | recognition benchmark scoring, in `<app>/venv-bench` (`requirements-bench.txt`) |
| RapidFuzz 3.14.6 | MIT | jiwer's edit-distance backend, same venv |
| click 8.5.1 | BSD-3-Clause | jiwer's dependency, same venv |
| whisper.cpp v1.9.5 | MIT | recognition backend experiment, built in `<app>/experiments/whisper.cpp`, not part of the app |
| `ggml-large-v3.bin` | MIT (OpenAI Whisper weights, GGML conversion by the whisper.cpp project) | its model, same folder |
