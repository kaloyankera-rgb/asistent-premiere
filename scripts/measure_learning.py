"""How right are the subtitle rules and the learned fixes? (The Smart Subtitle Correction plan, phase 8.)

    python3 scripts/measure_learning.py report <project.prproj | learning folder>
        every learned fix of the client: in how many projects it was made, used, typed back (a wrong use) or removed;
        the share of uses that stayed, against the target (98 %) before anything is widened
    python3 scripts/measure_learning.py dry <subtitles .json> ...
        what the writing rules, the speaker forms and the agreement marks would do to saved runs (Asistent_subtitles/*.json):
        every change and mark with its words around it, to be read by a person; nothing is written

Run it with the engine's Python (the dictionary): "$HOME/Library/Application Support/Asistent/venv/bin/python" -I …
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "engine"))

from asistent import agreement, bgnorm, learning, lexicon  # noqa: E402

TARGET = 0.98


def report(where: str) -> int:
    if where.endswith(".prproj"):
        found = learning.find_folder(where)
        if not found:
            print("No client learning folder above this project.")
            return 1
        client, folder = found
    else:
        client, folder = os.path.basename(os.path.dirname(where)), where
    rules = learning.build(learning.read_events(folder))[0]
    used = reverted = 0
    print(f"{client}: {len(rules)} learned fixes in {folder}\n")
    print(f"{'fix':44} {'made':>5} {'used':>5} {'back':>5}  state")
    for r in sorted(rules.values(), key=lambda r: (-len(r.used), r.key)):
        state = "removed" if r.removed else ("in use" if r.projects else "undone")
        print(f"{(r.heard + ' -> ' + r.said)[:44]:44} {len(r.projects):5} {len(r.used):5} {r.reverted:5}  {state}")
        used += len(r.used)
        reverted += r.reverted
    if used:
        right = (used - reverted) / used
        print(f"\n{used} uses, {reverted} typed back: {right:.1%} right (target {TARGET:.0%}): "
              f"{'met' if right >= TARGET else 'NOT met, keep the thresholds'}")
    else:
        print("\nNo learned fix has been used yet.")
    return 0


def _around(words, i, n=4):
    return " ".join(w["word"] for w in words[max(0, i - n):i + n + 1])


def dry(paths: list[str]) -> int:
    if not lexicon.available():
        print("Without the dictionary only part of the rules run; use the engine's Python.")
    totals = {"writing": 0, "speaker": 0, "agreement": 0}
    for p in paths:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        words = d.get("verbatim") or d.get("words") or []
        print(f"\n== {os.path.basename(p)} ({len(words)} words)")
        _, changes = bgnorm.apply(words)
        for c in changes:
            print(f"  writing    {c['rule']:13} {c['from']} -> {c['to']}")
        for i, g in agreement.speaker_forms(words):
            print(f"  speaker    {'man' if g == 'm' else 'woman':13} {words[i]['word']}   ({_around(words, i)})")
        marks = agreement.mismatches(words)
        for i, reason in marks:
            print(f"  agreement  {'mark':13} {reason}   ({_around(words, i)})")
        totals["writing"] += len(changes)
        totals["speaker"] += len(agreement.speaker_forms(words))
        totals["agreement"] += len(marks)
    print(f"\n{len(paths)} runs: {totals['writing']} writing changes, {totals['speaker']} first-person forms "
          f"(changed only when the track's speaker is set), {totals['agreement']} agreement marks")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] not in ("report", "dry"):
        print(__doc__)
        sys.exit(2)
    sys.exit(report(sys.argv[2]) if sys.argv[1] == "report" else dry(sys.argv[2:]))
