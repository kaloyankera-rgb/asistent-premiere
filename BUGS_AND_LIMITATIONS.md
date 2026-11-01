# Known bugs, limitations and warnings (0.9.8)

## Open bugs
1. **Volume level unit detection misreads a clip already at +15 dB** (`panel/premiere-audio.js`, `levelParam`).
   The unit is guessed from the current value; at the Premiere maximum the value is exactly 1.0, which the code
   reads as "linear". Log 11:43:19: `level fx31033.MP4: was 1 (linear), 15.5 dB` → wrong value requested.
   Premiere's scale is confirmed (0.1778 = 0 dB, 1.0 = +15 dB): use it always, drop the guess.
2. **Colour analysis reads the source file, not the timeline** (`engine/asistent/color.py`, `read_frames`).
   Re-running on a corrected clip suggests the same correction again (not idempotent, spec T13/T18). Applying
   twice does not stack only because a Lumetri with non-zero Exposure/Temperature/Tint is skipped.
3. **Render check never confirmed.** Before 0.9.5 the exported files were looked for under the wrong name
   (`x.png` vs `x.png.png`); after the fix no apply has been logged, so `/color/check` and the slider
   calibration (`lumetri.json`) are unproven. First apply will use the guess 60/80 slider units per log2.
4. `server.py` docstring does not list `POST /color/probe` (endpoint exists).

## Not verified in Premiere (implemented)
One Undo per press (audio), „Раздели R/L“, „Изравни фразите“ keyframe positions (media time vs clip time;
identical for untrimmed clips), auto-import speed after 0.7.1, colour values set + read back, render check,
probe, `scripts/setup_win.ps1` (never run), Windows overall.

## Platform limitations (Premiere 26.0.2 UXP)
- No audio channel mapping, no multicam creation, no track creation except by insert/overwrite past the last track.
- Removing track items while CEP panels run ExtendScript crashes Premiere → never remove.
- Clones capture the clip as it was before the transaction; new effects have no parameters until applied.
- Working/output colour space are not exposed (`getColorSettings` only gives graphics white luminance);
  only the clip's input/embedded LUT IDs and `getCompositeInLinearColor` are readable.
- Clip Volume max +15 dB. `exportSequenceFrame` appends `.png`.
- Adobe's published types start at 26.2; several methods are missing on 26.0.2.
- Lumetri Scopes are UI only (no scope data API): scope-like measurements must be computed from exported frames.
- No local masks/HSL-by-region through the API known so far (skin tones can only be global unless the probe shows otherwise).

## Algorithm limitations
- Sync: clips shorter than ~8 s or nearly silent stay Low (listed for manual work); frame-snapped placement
  leaves up to half a frame (8.3 ms at 59.94); VFR footage may drift later in the clip.
- Audio: two-mic detection needs both channels with ≥ 15 % speech and ≥ 15 % lead; borderline cases ask.
- Colour: the plain-gain clipping estimate is pessimistic (real check needed); skin target 0.62 may be brighter
  than the user's taste (to calibrate from their own corrected clips); REVO S-Log3 measured magenta −0.3 with
  few neutrals (likely stage light) → suggestion only.

## Warnings
- Never test in a client project; never close Premiere without asking; save first (osascript quit hangs with a project open).
- Do not delete track items via UXP; do not reintroduce muting.
- Panel results appear at the top and the panel scrolls (`#app`); new UI must keep that.
- `tests/test_real_footage.py` depends on `~/Kaloyan/01_CLIENTS/The Pact/GStroy/Media/GStroy brand/9x16`.
