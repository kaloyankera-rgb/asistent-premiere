# Known bugs, limitations and warnings

> Last fully reviewed at 0.9.18. Later findings (0.9.19-0.9.41) are in `PROJECT_STATUS.md` and `PROGRESS.md`; folding them in is open task T1 in `TODO.md`.

## Open bugs
- **Subtitles 0.9.48:** valid-word mis-hearings are invisible to the checks („той за градината“ for „то и за градината“, „Превърна“ at 6 s context); „го взимам“ may be a swallowed „взимаме“; a clip that starts inside a word keeps only the rest of it; the panel's flag list can contain false alarms (breath, hum). Older: **Subtitles 0.9.47:** timing can still be 50-120 ms off at some caption switches inside continuous speech (aligner resolution); an old Asistent caption track must be deleted by hand before a new run can be placed (no API to delete one). „трябваше“ (corrected) is timed from its neighbours, not found by the aligner. „Я“, „то и за градината“, „свършил“ remain marked „?“.
- **Subtitles 0.9.45: placement on the timeline not verified in Premiere** (host needs one Premiere restart); a second press with the first Asistent caption track still there is refused with instructions (no removal/mute by rule).
- **Subtitles 0.9.45: some words stay wrong** (Whisper cannot hear them; listed as „?“ with time): „нища“ (neща), „десом“ (cut word at the end of the last piece), „свършила/свършил“. Fix path: M4 text correction.
- Subtitles: the aligner's weights are CC-BY-NC 4.0 (non-commercial); installed at the user's request (the 4a1a autoedit tool already uses them), see `LICENSES.md`.
- The older P2 note „caption placement does not work“ is about UXP only; since 0.9.45 the CEP host does it.
(Fixed in 0.9.9: Volume level always in Premiere's scale, no guess from the current value; `/color/probe` documented. Fixed in 0.9.10: every small button, including „Проба на Lumetri“ and the two import buttons, also ran „Оправи звука“ (Fill effects, split copies); now only the audio buttons do, `tests/wiring.test.js`. Fixed in 0.9.11: since 0.9.5 every frame export threw „File Format is not supported“ because the name was given without „.png“ (Premiere takes the format from the name); the name carries „.png“ again and the engine accepts x.png or x.png.png. Fixed in 0.9.12: a second click on a moved panel hit „Оправи звука“; every press is logged and ignored for 0.7 s after the panel changes, the probe asks under its own button. Fixed in 0.9.13: frame exports are queued by Premiere, so every frame has a unique name and the panel waits for the finished file (`/frames/wait`) before changing anything; a probe whose frames are all identical is UNVERIFIED and learns nothing. Fixed in 0.9.14: Exposure units ignored the highlight shoulder (skin got ~0.7 stop per unit); the render check learnt a biased Temperature (−84) from a render that also changed Exposure.)
1. ~~Colour analysis reads the source file, not the timeline~~ fixed in 0.9.18 (timeline renders; file only as REVIEW_NEEDED fallback).
2. **Render check confirmed once (12:21).** Earlier: 0.9.5-0.9.10 never exported a frame, and before 0.9.13 the „before“ frame could be rendered after the correction (queued export); so `/color/check` and the slider
   calibration (`lumetri.json`) are unproven. First apply will use the guess 60/80 slider units per log2.

## Not verified in Premiere (implemented)
Subtitles M3 (0.9.42): verified working in Premiere on 2026-11-01 (see `PROJECT_STATUS.md`); still unjudged: Bulgarian accuracy and caption timing against the picture, behaviour with an unsaved project (refused with a message, not tried).
Fixed in 0.9.43: wrong words because the noisiest duplicate microphone was recognised (see `PROJECT_STATUS.md`); to be confirmed by the user in Premiere. Open: caption timing is only as exact as Whisper's word times (±0.1-0.3 s), direction of the error unknown.
Fixed in 0.9.44 (engine-tested, not yet in Premiere): words wrong at the cuts (joined mix), word starts early (alignment, optional), 3-4 word captions across sentence ends.
Open: the aligner's MMS_FA weights are CC-BY-NC 4.0 (see `LICENSES.md`); Whisper still misreads some words („неща“ as „нища“): needs the names field and the correction step (M4).
Open observation: in the short preset captions can be 3-4 words when function words are glued (see `TODO.md` C2).
One Undo per press (audio), „Раздели R/L“, „Изравни фразите“ keyframe positions (media time vs clip time;
identical for untrimmed clips), auto-import speed after 0.7.1, colour values set + read back, render check,
probe, `scripts/setup_win.ps1` (never run), Windows overall.

## Platform limitations (Premiere 26.0.2 UXP)
- The Mix (master) track and its effects cannot be reached by script (QE: Audio 1-N only), so the Dynamics limiter of „Оправи звука“ is per clip.
- No audio channel mapping through UXP (ExtendScript can set it on bin clips only: used by the host for the L/L + R/R copies), no multicam creation, no track creation except by insert/overwrite past the last track.
- Removing track items while CEP panels run ExtendScript crashes Premiere → never remove.
- Clones capture the clip as it was before the transaction; new effects have no parameters until applied.
- Working/output colour space are not exposed (`getColorSettings` only gives graphics white luminance);
  only the clip's input/embedded LUT IDs and `getCompositeInLinearColor` are readable.
- Clip Volume max +15 dB. `exportSequenceFrame` needs the name with `.png` (without it: „File Format is not supported“) and may save it as `x.png.png`. It only queues the export and returns at once: wait for the file before changing the sequence.
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
