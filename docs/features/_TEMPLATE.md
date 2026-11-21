# <Feature name>

<!-- One page per feature, at most ~80 lines. Read before changing the feature; update it in the same
commit as the change (status, key points, decisions, code map). Facts only: write "unknown" or
"unverified" instead of guessing. English, like the panel. -->

## What it does
Two or three lines, in the editor's words: which panel row or tab, what one press gives.

## How to use it
1. What the editor selects and presses, in order (3-6 steps). Options worth knowing.

## Key points: do not break
- The permanent rules from CLAUDE.md that apply here, measured limits and crashes to avoid, with the
  reason in a few words and the version where it was learned.

## Decisions
- One line per decision, with its `DECISIONS.md` heading date (e.g. "DECISIONS 2026-11-15").

## Code map
- Panel: `panel/<file>.js` what it holds (pure = node-tested, `premiere-*` = touches Premiere).
- Engine: `engine/asistent/<file>.py`, endpoint(s) in `server.py`.
- Host: `host/host.jsx` function, if any.

## Status
- Since: version. Verified in Premiere / through the bridge / outside Premiere only. Windows: tested or not.
- Open bugs and limits (`BUGS.md`), open TODO items (`TODO.md` section letter).

## Tests
- `tests/<file>`: what it covers.
