"""Development benchmark for Bulgarian recognition quality (not part of the running app; the engine only reuses the word
classes of `metrics` in review.py). Scores a backend's words against human-verified reference transcripts: WER, CER, names, numbers, negations,
omissions, word timing, time and memory. jiwer is needed only by `metrics` and lives in its own venv (requirements-bench.txt)."""
