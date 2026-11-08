"""Development benchmark for Bulgarian recognition quality (not part of the running app; nothing here is imported by the
engine). Scores a backend's words against human-verified reference transcripts: WER, CER, names, numbers, negations,
omissions, word timing, time and memory. jiwer is needed only by `metrics` and lives in its own venv (requirements-bench.txt)."""
