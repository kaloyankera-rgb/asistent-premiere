#!/usr/bin/env python3
"""Which files of the protected ReShape subtitle path changed since the baseline (committed or not).

  reshape_guard.py [--base <git ref>]      (default: the local tag backup/pre-improvements-2026-11-08)

The ReShape preset (recognition, corrections, learned terms, English, timing, grouping, look, placement) is protected
(the user, 2026-11-08). New features live in new modules and read the subtitle results; they do not edit these files.
Exit 0: none of them changed. Exit 1: the changed files are listed; such a change is allowed only when
`scripts/reshape_golden.py check` still reports the ReShape output identical and the change is recorded in DECISIONS.md.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "backup/pre-improvements-2026-11-08"
# the files that make ReShape's words, times, lines, English and placement
PROTECTED = [
    "engine/asistent/subtitles.py", "engine/asistent/subtitle_job.py", "engine/asistent/translate.py",
    "engine/asistent/corrections.py", "engine/asistent/learning.py", "engine/asistent/audiocheck.py",
    "engine/asistent/consensus.py", "engine/asistent/lexicon.py", "engine/asistent/bgnorm.py", "engine/asistent/bgtext.py",
    "engine/asistent/english.py", "engine/asistent/align.py", "engine/asistent/align_worker.py",
    "engine/asistent/suspects.py", "engine/asistent/agreement.py", "engine/asistent/numbers.py", "engine/asistent/asr.py",
    "engine/asistent/dialoguemix.py", "engine/asistent/subtitle_settings.py", "engine/asistent/captionstate.py",
    "engine/asistent/hostbridge.py", "engine/asistent/models/english_bg.json.gz",
    "panel/premiere-captions.js", "panel/premiere-subtitles.js", "panel/captionplan.js", "panel/captionedit.js",
    "host/host.jsx",
]


def changed(base: str) -> list[str]:
    out = subprocess.run(["git", "-C", REPO, "diff", "--name-only", base, "--", *PROTECTED],
                         capture_output=True, text=True, check=True).stdout
    return sorted(set(out.split()))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--base", default=BASE)
    args = ap.parse_args()
    missing = [p for p in PROTECTED if not os.path.exists(os.path.join(REPO, p))]
    files = changed(args.base)
    if missing:
        print("Protected files missing from the tree:\n  " + "\n  ".join(missing))
    if files:
        print(f"Protected ReShape files changed since {args.base}:\n  " + "\n  ".join(files))
        print("Allowed only with `scripts/reshape_golden.py check` identical and a DECISIONS.md entry.")
    if missing or files:
        return 1
    print(f"ReShape guard: none of the {len(PROTECTED)} protected files changed since {args.base}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
