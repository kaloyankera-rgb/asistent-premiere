# Anchor

## What it does
Motion tab > Anchor (Anchor Studio, the user's own panel brought in at 0.10.69). One click on one of nine points moves
the selected clips' anchor point to a corner, an edge or the centre of the clip, the sequence or the selection. Position
is compensated, so the picture stays where it is. A Scale or Rotation pop then grows from that point.

## How to use it
1. Select one or more clips. For a text made in Premiere, select the text and park the playhead where it is fully visible.
2. Choose the Effect (Motion or Transform) and the Box (Clip, Sequence or Selection).
3. Click one of the nine points, or type X and Y percentages and press Apply. One Undo step.
4. "Use alpha" puts the anchor on the visible part of a PNG, TIFF or WebP logo, not its transparent margin (cutoff
   1, 10, 25, 50, 75 or 90 %). "Save" remembers a sequence point and "Use saved" sets other clips to it.
5. A text made in Premiere is measured from two renders (about 0.3 s the first time). Later clicks on the same text use
   the kept box and need no render. The done line says when the box was measured.

## Key points: do not break
- Every selected clip is read and checked before any write. The anchor and the compensating Position go in one
  transaction inside `lockedAccess` and are read back. Anything unsupported makes zero writes.
- Position keys keep their times and all get the same offset (linear and hold keys too). Rotated and non-uniform
  Motion are handled. Animated Anchor Point is refused; skew, retiming and several Motion or Transform effects are refused.
- Animated Scale or Rotation is allowed (0.10.90). The offset is read at the playhead, so the picture stays put there.
  The playhead must be on the clip and Scale must not be 0 there (a pop's first frame): 0.10.89 moved nothing for that reason.
- A text made in Premiere has no project item and no readable text box (Source Text reads null in UXP). It counts as the
  size of the sequence frame. Its letters' box is the pixels that differ between a render and a render with the graphic's
  Opacity at 0 for a moment (`/anchor/drawn`). Premiere lists two extra steps (hide, show) that cancel out.
  Refused when every Opacity is animated; Sequence mode is not measured; Use alpha is refused on such a graphic.
- The kept box is per clip and measured again when the clip moves or is trimmed, or a layer transform or the text's length
  changes. A same-length rewording keeps the old box until the panel reloads (0.10.93).
- The Transform target needs exactly one Transform effect on each clip and is the less tried path (see Status).
- No absolutely placed element on the page (UXP paints it over everything, 0.10.59). Choices live in the panel store
  `asistent.anchor`, not localStorage (erased by updates, 0.10.17).
- anchor-studio is a PRIVATE repo and Asistent's is PUBLIC: a push makes its code public, so ask before pushing (TODO N).

## Decisions
- No DECISIONS.md heading covers Anchor. The reasons are in CHANGELOG 0.10.69 (Use alpha read by the engine, no file
  dialog), 0.10.90 (text as the sequence frame), 0.10.91 (letters' box from two renders) and 0.10.93 (kept box).

## Code map
- Panel: `panel/anchor.js` the page. Pure, node-tested: `panel/anchorplan.js` (geometry, from Anchor Studio's core.js).
- Panel Premiere: `panel/premiere-anchor.js` `inspect`, `apply`, `save`, `unwrap`, `paramsOf`. Alpha bounds: `panel/anchoralpha.js` `bounds`.
- Engine: `engine/asistent/anchoralpha.py` `bounds`, `drawn`, `ready`; endpoints `POST /anchor/alpha`, `POST /anchor/drawn`
  in `server.py`; client calls `anchorAlpha`, `anchorDrawn` in `panel/engine.js`. Frames come from `/frames/wait`.
- Host: none.

## Status
- Since 0.10.69; text and animated Scale / Rotation 0.10.90; letters' box 0.10.91; kept box and faster first click 0.10.93.
  Current build 0.10.120.
- Anchor Studio's own Motion placement was confirmed by the user in Premiere at its version 0.1.2. The text work was
  measured on frames Premiere rendered in NEW TEST through the bridge and followed the user's screen recording of
  2026-11-15. The Transform target is still untested in Premiere. Latest status line: PROJECT_STATUS 0.10.90 and
  CHANGELOG 0.10.93.
- Windows: untested.
- BUGS: "Fixed in 0.10.90" entry only. TODO: section N lines for 0.10.69 and 0.10.90 (user checks).

## Tests
- `tests/anchorplan.test.js` geometry: nine points, rotation, key offsets, visible bounds, Transform and Motion together.
- `tests/premiere-anchor.test.js` the Premiere side: one transaction, refusals, Transform, animated Scale, text box, kept box.
- `tests/test_anchoralpha.py` the engine: alpha bounds, 16 bit, palette, `drawn`, `ready`.
