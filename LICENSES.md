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
| huggingface_hub, tokenizers | Apache-2.0 | optional: model download and text tokens |
| onnxruntime | MIT | optional: voice activity detection used by faster-whisper |
| PyAV | BSD-3-Clause (bundles LGPL FFmpeg libraries) | optional: dependency of faster-whisper |
| pytest | MIT | development only |
| FFmpeg / FFprobe | LGPL-2.1+ / GPL (depends on build) | separate program called as a subprocess; not linked or redistributed |
| Adobe Premiere Pro UXP API | Adobe developer terms | the panel calls the `premierepro` module inside Premiere |

No code was copied from other projects. The sync algorithm was written for Asistent; the idea of an
onset curve is shared with Quick Search (`tools/premiere-barzo/.../sync.js`, same author) and with
`tools/_vendor/wearenocode/youtube-edit/scripts/sync-tracks.py` (MIT), neither of which is imported.

Later phases will add, after a license check at that time: faster-whisper (MIT).
