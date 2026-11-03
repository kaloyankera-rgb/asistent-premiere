// node --test tests/layout.test.js
const test = require("node:test");
const assert = require("node:assert");
const { syncLayout, folderOf, GAP } = require("../panel/layout.js");

function engineOf(clips, groups, unsynced) {
  return { clips: clips.map(([path, duration, has_video = true]) => ({ path, name: path.split("/").pop(), duration, has_video })),
    groups, unsynced };
}

// GStroy-like: FX3 + FX30, one long FX30 take holding three FX3 takes, plus a lone clip
const E = engineOf([
  ["/m/fx30/C9025.MP4", 54.1], ["/m/fx3/fx39027.MP4", 15], ["/m/fx3/fx39028.MP4", 10.5], ["/m/fx3/fx39029.MP4", 14],
  ["/m/fx30/C9013.MP4", 30], ["/m/fx3/fx39013.MP4", 29], ["/m/fx3/fx39025.MP4", 1.5],
], [
  { anchor: 0, members: [{ clip: 0, offset: 0 }, { clip: 1, offset: 1.1375 }, { clip: 2, offset: 23.6952 }, { clip: 3, offset: 39.3416 }] },
  { anchor: 4, members: [{ clip: 4, offset: 0 }, { clip: 5, offset: 0.0265 }] },
], [6]);
const ORDER = { "/m/fx3/fx39013.MP4": 0, "/m/fx30/C9013.MP4": 100, "/m/fx3/fx39027.MP4": 200, "/m/fx30/C9025.MP4": 300,
  "/m/fx3/fx39025.MP4": 400 };

test("groups keep the timeline order, first clip opens the sequence on V1 at 0", () => {
  const { placements, cameras } = syncLayout(E, ORDER);
  assert.strictEqual(placements[0].name, "C9013.MP4");
  assert.strictEqual(placements[0].zero, 0);
  assert.strictEqual(placements[0].track, 0);
  assert.deepStrictEqual(cameras, ["/m/fx30", "/m/fx3"]);
  assert.strictEqual(syncLayout(E, ORDER).seed, 0);
});

test("offsets inside a group are kept exactly", () => {
  const { placements } = syncLayout(E, ORDER);
  const z = Object.fromEntries(placements.map((p) => [p.name, p.zero]));
  assert.ok(Math.abs((z["fx39013.MP4"] - z["C9013.MP4"]) - 0.0265) < 1e-9);
  assert.ok(Math.abs((z["fx39028.MP4"] - z["C9025.MP4"]) - 23.6952) < 1e-9);
  assert.ok(Math.abs((z["fx39029.MP4"] - z["fx39027.MP4"]) - (39.3416 - 1.1375)) < 1e-9);
});

test("one track per camera and nothing overlaps on a track", () => {
  const { placements } = syncLayout(E, ORDER);
  for (const p of placements) assert.strictEqual(p.track, folderOf(p.path) === "/m/fx30" ? 0 : 1);
  for (const a of placements) {
    for (const b of placements) {
      if (a === b || a.track !== b.track) continue;
      const overlap = Math.min(a.zero + a.duration, b.zero + b.duration) - Math.max(a.zero, b.zero);
      assert.ok(overlap <= 1e-9, `${a.name} overlaps ${b.name}`);
    }
  }
});

test("without recording times the timeline order decides; the gap separates everything; no markers", () => {
  const lay = syncLayout(E, ORDER);
  const { placements } = lay;
  const g1end = Math.max(...placements.filter((p) => p.group === 1).map((p) => p.zero + p.duration));
  const g2start = Math.min(...placements.filter((p) => p.group === 2).map((p) => p.zero));
  assert.ok(Math.abs(g2start - (g1end + GAP)) < 1e-9);
  const last = placements[placements.length - 1];
  assert.strictEqual(last.name, "fx39025.MP4");
  assert.strictEqual(last.group, null);
  assert.strictEqual(lay.markers, undefined);
});

// The user's example (2026-11-03): camera A at 10:00, 10:05, 10:15, camera B only at 10:05 (synced with A).
// rec_time is already on one clock (the engine's chrono.py corrected camera B's clock).
const T = (hh, mm) => Date.UTC(2026, 10, 3, hh, mm) / 1000;
function chronoEngine() {
  return engineOf([["/m/A/a1.mp4", 60], ["/m/A/a2.mp4", 60], ["/m/A/a3.mp4", 60], ["/m/B/b2.mp4", 50]],
    [{ anchor: 1, members: [{ clip: 1, offset: 0 }, { clip: 3, offset: 4 }] }], [0, 2]);
}
function withTimes(e, times, notes = []) {
  e.clips.forEach((c, i) => { c.rec_time = times[i]; c.rec_note = notes[i] || null; });
  return e;
}

test("unmatched clips stay in recording order instead of going to the end", () => {
  // the editor's timeline has camera A's clips first, then camera B: that order must not matter
  const order = { "/m/A/a3.mp4": 0, "/m/A/a1.mp4": 100, "/m/A/a2.mp4": 200, "/m/B/b2.mp4": 300 };
  const e = withTimes(chronoEngine(), [T(10, 0), T(10, 5), T(10, 15), T(10, 5) + 4]);
  const { placements, uncertain } = syncLayout(e, order);
  assert.deepStrictEqual(placements.map((p) => p.name), ["a1.mp4", "a2.mp4", "b2.mp4", "a3.mp4"]);
  const z = Object.fromEntries(placements.map((p) => [p.name, p.zero]));
  assert.strictEqual(z["a1.mp4"], 0);
  assert.strictEqual(z["a2.mp4"], 60 + GAP);
  assert.ok(Math.abs(z["b2.mp4"] - z["a2.mp4"] - 4) < 1e-9);             // synced offset kept exactly
  assert.strictEqual(z["a3.mp4"], 60 + GAP + 60 + GAP);
  assert.deepStrictEqual(placements.map((p) => p.group), [null, 1, 1, null]);
  assert.deepStrictEqual(uncertain, []);
});

test("a clip without a recording time keeps its timeline neighbour and is reported", () => {
  const order = { "/m/A/a1.mp4": 0, "/m/A/a2.mp4": 100, "/m/B/b2.mp4": 100, "/m/A/a3.mp4": 200 };
  const e = withTimes(chronoEngine(), [null, T(10, 5), T(10, 15), T(10, 5) + 4], ["no recording time"]);
  const { placements, uncertain } = syncLayout(e, order);
  // a1 is first in the timeline and has no time: it stays first
  assert.deepStrictEqual(placements.map((p) => p.name), ["a1.mp4", "a2.mp4", "b2.mp4", "a3.mp4"]);
  assert.deepStrictEqual(uncertain.map((u) => u.name), ["a1.mp4"]);
  assert.match(uncertain[0].reason, /by the timeline/);
});

test("an unchecked clock is used but reported; a group with one timed member is still ordered", () => {
  const e = withTimes(chronoEngine(), [T(10, 20), null, T(10, 15), T(10, 5) + 4],
    ["this camera's clock is not checked"]);
  const { placements, uncertain } = syncLayout(e, {});
  assert.deepStrictEqual(placements.map((p) => p.name), ["a2.mp4", "b2.mp4", "a3.mp4", "a1.mp4"]);
  assert.deepStrictEqual(uncertain.map((u) => u.name), ["a1.mp4"]);
});

test("Windows paths split cameras by folder too", () => {
  assert.strictEqual(folderOf("C:\\Users\\GRIGS\\fx3\\a.MP4"), "C:\\Users\\GRIGS\\fx3");
});

test("an audio-only recorder gets its own track", () => {
  const e = engineOf([["/m/camA/a.mp4", 20], ["/m/zoom/z.wav", 25, false]],
    [{ anchor: 1, members: [{ clip: 1, offset: 0 }, { clip: 0, offset: 2 }] }], []);
  const { placements, seed } = syncLayout(e, {});
  // the sequence is built from the camera clip (picture settings), so the camera is track 0
  assert.deepStrictEqual(placements.map((p) => [p.name, p.track, p.hasVideo]), [["z.wav", 1, false], ["a.mp4", 0, true]]);
  assert.strictEqual(placements[seed].name, "a.mp4");
  assert.strictEqual(placements[seed].zero, 2);
});

