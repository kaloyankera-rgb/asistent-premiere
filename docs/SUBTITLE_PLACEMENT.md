# Where subtitles sit: measured on 25 client videos (Move off faces, 0.10.141)

Measured 2026-11-22 for the rebuild of "Move off faces". Source: 25 finished, subtitled 9:16 videos the user downloaded
(Aula 3, Beauty Sector 4, Cineland 1, Credissimo 3, Ergon 1, Fornetti 3, GStroy 2, MASTERHAUS 1, Pulse Fitness 1,
RoboHubPro 1, TEODOR 1, ЕКОПАК 2, Ники Трифонов 1, one unnamed), 2022 subtitle chunks, 1795 s. No 16:9 video was in the
set. Numbers only: the frames were never looked at. The per-chunk data stays private outside the repo
(`<app>/dev/placement/`); the tools are `scripts/measure_style.py placement | placement-report`
(`placement_measure.py`, `placement_report.py`, `placement_vision.swift`) and `scripts/placement_replay.py`
(fits the lanes and replays the panel's own rule through `placement_rule_cli.js`).

All heights are fractions of the frame height (0 top, 1 bottom).

## What the editors do
- **A lane.** The line's centre sits at 0.488 (p10 0.421, p90 0.564); per client 0.41-0.54. Always centred horizontally.
  The **top of the first line** is the stable anchor: a second line grows downward.
- **They avoid faces and other on-screen text.** Their subtitles cover a face in 0.3 % of chunks, against 3.0 % for a line
  fixed at the client's median (face, big hand or other text: 2.0 % against 8.3 %).
- **Under a face, never above it.** Where the median lane would hit a face (59 chunks) they moved the line down in 58, by
  0.11 (p10 0.04, p90 0.22). A chin at 0.45-0.55 puts the line centre near 0.60, at 0.55-0.65 near 0.73.
- **Other text: either side.** 30 moves down, 32 up; screen recordings (Aula) still collide in 17 %.
- **They do not follow zooms.** A line moves inside its chunk in 45 of 1955; over a zoom "follow the chin" is further from
  the editors (error 0.030) than "stay" (0.013), at punch-ins 0.049 against 0.019. Height changes happen at 59 % of hard
  cuts, 20 % of punch-ins, 14 % of same-shot zooms, 10 % of same-shot pairs without a zoom.
- **Most large differences are framing, not avoidance:** 78 % of chunks more than 0.05 off the median had nothing at the
  median position (screen recordings, B-roll).
- **Hands, products, bodies:** no avoidance measurable (the hand detector is unreliable, salient and body boxes cover most
  of the frame). Not used.

## The rule in the button (panel/placementplan.js `LANES`, `planLanes`)
- A lane per Style (top of the first line), fitted on half the videos: default (Auto and every client without a Style)
  0.460, GStroy 0.458, Credissimo 0.468, ЕКОПАК 0.468, Beauty Sector 0.418, AULA 0.490. Per-client fits for the clients
  without a Style (one video each, so they use the default): Fornetti 0.496, Pulse Fitness 0.408, TEODOR 0.524,
  Ники Трифонов 0.462.
- A shot's base is max(lane, chin + 0.05); a line drops further only when a face (every face at least 0.03 of the frame
  tall) or other on-screen text would be covered on its own frames, down under the chin, never above; other text: the
  nearest free side. From the line where a zoom (or a face moving in) causes the collision, until it is free again
  (margin 0.03). A line with no free place is left where it was and listed.
- ReShape keeps its own rule (chin + 0.11 from up to 3 frames per shot, above a low face) as the base and gets the same
  collision moves (the user, 2026-11-22).

## Replay on the 12 held-out videos (981 chunks; the rule never saw them)
| | editors | line fixed at the lane | new rule |
|---|---|---|---|
| covers a face | 0.3 % | 2.3 % | 0.0 % |
| covers a face or other text | 1.3 % | 9.3 % | 0.8 % |
| line above a face (not flagged) | (4) | 1 | 0 |
| centre error on chunks with a face | 0 | 0.046 | 0.037 (target 0.033: missed) |
| same-shot height changes | 13 % | 0 % | 7.7 % (target 10-15 %: moves less) |
| no free place (left, listed) | | | 0.9 % |

About 89 % of lines stay in the lane, as with the editors; per Style the rule is closer to the editors than a fixed lane
(AULA, Beauty Sector, Credissimo, ЕКОПАК; GStroy had no face chunks held out).

## Open
- 16:9: no data; 16:9 sequences keep the old rule until a few 16:9 videos are measured.
- More GStroy videos (one of its two files was a flat grey picture).
- Profile faces: YuNet misses them (TODO); such shots stay in the lane.
