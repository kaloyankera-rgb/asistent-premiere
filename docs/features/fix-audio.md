# Fix audio

## What it does
The Audio row (Tools > Run, button "Fix audio"). For every selected stereo clip it makes a copy that plays only
the left channel (L/L) in place of the audio and a copy that plays only the right channel (R/R) on the track below,
linked to the picture. Since 0.10.151 that is all: the Volume is not changed and no limiter is added. Levelling is under the
arrow: Level only (and Even out phrases) levels each side on its own: loudness to -17 LUFS, the peak kept under -6 dBFS, and a
Dynamics Limiter at -6 dB. Since 0.10.143 nothing balances the two speakers against each other.

## How to use it
1. Select the clips in the timeline (the video or the audio; a selected video clip brings its own audio).
2. Press Fix audio. The result lists each clip with its reasons and the channels placed.
3. A second press makes no new copies: it only relabels the old ones.
4. Options under the arrow (Manual): Split L/R, Split R/L, L only, R only (no levels, like Fix audio), Level only and
   Even out phrases (the levels, plus keyframes that even out quiet and loud sentences).

## Key points: do not break
- Fix audio, Split L/R, Split R/L, L only, R only and Sync's redo never touch Volume or Dynamics (0.10.151, the user
  2026-11-23); only Level only and Even out phrases level (`audioplan.levelsFor`).
- Main microphone peak at most -6 dBFS (`audio.PEAK_CEILING`); the SUM of both sides is held under it by the gains.
  Boosts may not lift the room noise above -55 dBFS (`NOISE_MAX`); gain limited to +-30 dB.
- The channels are never done with Fill effects (0.9.56). The host makes audio-only subclips with their own channel
  mapping in the bin "Asistent L-R" and overwrites the original audio, so nothing is removed or muted.
- A clip with effects or keyframes (Volume, Channel Volume, Panner, other effects, a Dynamics with the editor's own
  settings) is NOT split: overwriteClip drops them (measured 2026-11-08, 0.10.6). The result names the reason.
- Never mute, reroute or rearrange tracks. Each source track's second side goes to ONE shared track below (A1+A2,
  A3+A4); a new track is added by the host when none is free (`audioplan.lowerTracks`, 0.10.45).
- Level is the clip Volume in Premiere's scale (0.1778 = 0 dB, max 1.0 = +15 dB, `LEVEL_MAX_DB`). A clip whose Volume is
  keyframed is not touched. Clips with changed speed or reversed are skipped.
- No speaker balance (0.10.143, the user's decision 2026-11-22): each side is levelled to the target by itself; nothing is
  lowered to match the other speaker. `audio.balance` (lowers the louder side, leaves a bleed-only side unraised) is kept but
  off: only `balance_tol` / `"balance_db"` turns it on, and the panel never sends it.
- Limiter: Dynamics with only Limiter on at -6 dB goes on every levelled clip (the Mix track is unreachable by script).
  An existing Dynamics with other settings is left alone and said.
- The host finds the panel's project and sequence by path and id, not by what is in front (`as_target`, 0.10.25).
- Copies keep the clip's label colour; a repeat press over old copies only relabels them (0.10.4).
- Undo: levels are one step, the limiter a second, the splitting separate Premiere steps. The result says so.
- Sync runs this again on its new sequence for files that had the copies (`fixAudio` shared with Sync, 0.10.38).

## Decisions
- Fix audio does not set levels: DECISIONS 2026-11-23.
- L/L and R/R through subclips with their own channel mapping, never Fill effects: DECISIONS 2026-11-03.
- Limiter per clip instead of on the Mix track; balance only lowers: DECISIONS 2026-11-03.
- Speaker balance off by default (one person ended up much quieter): DECISIONS 2026-11-22.
- Routing/level rules (never sum channels, Volume scale, -17 LUFS, phrase leveling limits): DECISIONS "Audio" section (undated).
- Every stereo clip is split, the analysis only informs the levels (CHANGELOG 0.9.56; supersedes the "split refused
  when both channels carry one sound" line of the "Audio" section).
- Sync redoes Fix audio instead of copying the clips: DECISIONS 2026-11-11.

## Code map
- Panel: `panel/main.js` `onAudio`, `fixAudio` (flow, shared with Sync); `panel/audioplan.js` (pure: jobs, routes,
  `lowerTracks`, `levelTargets`, limiter state); `panel/premiere-audio.js` (touches Premiere: `readAudioSelection`,
  `routeBlockers`, `applyLevels`, limiter); `panel/channels.js` `routeOf` (reads old Fill effects); `panel/engine.js`
  `startAudio`, `routeAudio`; `panel/index.html` row `secAudio`, button `audio`, block `optAudio`.
- Engine: `engine/asistent/audio.py` (`analyze_items`, `classify`, `gain_for`, `balance`, `phrase_plan`);
  `server.py` `POST /audio`, `POST /audio/route`; `hostbridge.py` `route_audio`.
- Host: `host/host.jsx` `as_audio_route`, `as_route_one`, `as_side_clip`, `as_add_audio_track`, `as_target`.

## Status
- 0.10.151: Fix audio only splits, levels only from Level only / Even out phrases; not tried in Premiere.
- 0.10.143: speaker balance off; awaiting the user's check on a two-person video.
- Since 0.9.56 (split) and 0.9.57 (balance, limiter), Phase 3 "Partial verification". Verified in Premiere by the user:
  Audio Channels A1 L/L, A2 R/R (0.9.56). Several projects open: verified in 26.5.2 (0.10.25). Track order A1+A2 /
  A3+A4 verified through the bridge (0.10.47).
- Not verified: one Undo per press, "Split R/L", "Even out phrases" keyframe positions (BUGS "Not verified", TODO C).
- Latest docs status touching it: 0.10.38 Sync + Fix audio again (not verified by the user, TODO F).
- Windows: untested.
- Limits: no Mix-track limiter; no clip with effects or keyframes is split; two-mic detection needs both channels with
  at least 15 % speech and 15 % lead, borderline cases ask (BUGS "Algorithm limitations").

## Tests
- `tests/test_audio.py` (loudness, classes, gain with the -6 dB ceiling, phrases), `test_server.py` (`/audio`, route guard).
- `tests/audioplan.test.js`, `channels.test.js`, `routeguard.test.js` (effects/keyframes block the split),
  `hostsubclip.test.js` (subclip reuse), `hosttarget.test.js` (project and sequence found by path and id),
  `wiring.test.js` (buttons call `fixAudio`).
