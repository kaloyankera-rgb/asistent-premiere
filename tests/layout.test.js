// node --test tests/layout.test.js
const test = require("node:test");
const assert = require("node:assert");
const { syncLayout, mainCamera, folderOf, GAP } = require("../panel/layout.js");

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

// the editor's timeline: the FX30 on V1 (the main POV), the FX3 on V2
const MAIN = { tracks: Object.fromEntries(E.clips.map((c) => [c.path, folderOf(c.path) === "/m/fx30" ? 0 : 1])) };

test("groups keep the timeline order, first clip opens the sequence on V1 at 0", () => {
  const { placements, cameras } = syncLayout(E, ORDER, MAIN);
  assert.strictEqual(placements[0].name, "C9013.MP4");
  assert.strictEqual(placements[0].zero, 0);
  assert.strictEqual(placements[0].track, 0);
  assert.deepStrictEqual(cameras, ["/m/fx30", "/m/fx3"]);
  assert.strictEqual(syncLayout(E, ORDER, MAIN).seed, 0);
});

test("offsets inside a group are kept exactly", () => {
  const { placements } = syncLayout(E, ORDER, MAIN);
  const z = Object.fromEntries(placements.map((p) => [p.name, p.zero]));
  assert.ok(Math.abs((z["fx39013.MP4"] - z["C9013.MP4"]) - 0.0265) < 1e-9);
  assert.ok(Math.abs((z["fx39028.MP4"] - z["C9025.MP4"]) - 23.6952) < 1e-9);
  assert.ok(Math.abs((z["fx39029.MP4"] - z["fx39027.MP4"]) - (39.3416 - 1.1375)) < 1e-9);
});

test("one track per camera and nothing overlaps on a track", () => {
  const { placements } = syncLayout(E, ORDER, MAIN);
  for (const p of placements) assert.strictEqual(p.track, folderOf(p.path) === "/m/fx30" ? 0 : 1);
  for (const a of placements) {
    for (const b of placements) {
      if (a === b || a.track !== b.track) continue;
      const overlap = Math.min(a.zero + a.duration, b.zero + b.duration) - Math.max(a.zero, b.zero);
      assert.ok(overlap <= 1e-9, `${a.name} overlaps ${b.name}`);
    }
  }
});

test("without recording times the file numbers decide; entries follow each other with the gap; no markers", () => {
  // 2026-11-23: fx39025 is numbered between fx39013 (first group) and fx39027 (second group), so it sits between them,
  // although the editor's timeline had it last
  const lay = syncLayout(E, ORDER, MAIN);
  const { placements } = lay;
  assert.deepStrictEqual(placements.map((p) => p.name),
    ["C9013.MP4", "fx39013.MP4", "fx39025.MP4", "C9025.MP4", "fx39027.MP4", "fx39028.MP4", "fx39029.MP4"]);
  const g1end = Math.max(...placements.filter((p) => p.group === 1).map((p) => p.zero + p.duration));
  const lone = placements.find((p) => p.name === "fx39025.MP4");
  assert.strictEqual(lone.group, null);
  assert.ok(Math.abs(lone.zero - (g1end + GAP)) < 1e-9);
  const g2start = Math.min(...placements.filter((p) => p.group === 2).map((p) => p.zero));
  assert.ok(Math.abs(g2start - (lone.zero + lone.duration + GAP)) < 1e-9);
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
  assert.match(uncertain[0].reason, /by its file number/);
});

test("a clip without a recording time and without a file number keeps its timeline neighbour", () => {
  const e = engineOf([["/m/A/intro.mp4", 60], ["/m/A/a2.mp4", 60], ["/m/A/a3.mp4", 60], ["/m/B/b2.mp4", 50]],
    [{ anchor: 1, members: [{ clip: 1, offset: 0 }, { clip: 3, offset: 4 }] }], [0, 2]);
  withTimes(e, [null, T(10, 5), T(10, 15), T(10, 5) + 4], ["no recording time"]);
  const order = { "/m/A/a2.mp4": 0, "/m/B/b2.mp4": 0, "/m/A/intro.mp4": 100, "/m/A/a3.mp4": 200 };
  const { placements, uncertain } = syncLayout(e, order);
  assert.deepStrictEqual(placements.map((p) => p.name), ["a2.mp4", "b2.mp4", "intro.mp4", "a3.mp4"]);
  assert.match(uncertain[0].reason, /by the timeline/);
});

test("an unchecked clock is reported but the file numbers win over it (2026-11-23)", () => {
  // a1's clock says 10:20, after a3, but camera A numbered it first: a1 a2 a3
  const e = withTimes(chronoEngine(), [T(10, 20), null, T(10, 15), T(10, 5) + 4],
    ["this camera's clock is not checked"]);
  const { placements, uncertain } = syncLayout(e, {});
  assert.deepStrictEqual(placements.map((p) => p.name), ["a1.mp4", "a2.mp4", "b2.mp4", "a3.mp4"]);
  assert.deepStrictEqual(uncertain.map((u) => u.name), ["a1.mp4"]);
});

// The user's MASTERHAUS case (2026-11-23): two FX30s, fx306xx on POV 1 and fx30-3-20xx on POV 2. A learnt clock put
// fx30668/669 before fx30661; the file numbers must decide within each camera, with synced partners kept together.
test("MASTERHAUS: each camera follows its file numbers, synced pairs stay together, the clock only interleaves", () => {
  const A = "/v/POV 1";
  const B = "/v/POV 2";
  const e = engineOf([[`${A}/fx30668.MP4`, 20], [`${A}/fx30669.MP4`, 10], [`${A}/fx30661.MP4`, 15], [`${A}/fx30662.MP4`, 15],
    [`${A}/fx30677.MP4`, 12], [`${B}/fx30-3-2032.MP4`, 14], [`${B}/fx30-3-2033.MP4`, 14], [`${B}/fx30-3-2036.MP4`, 9]],
  [{ anchor: 2, members: [{ clip: 2, offset: 0 }, { clip: 5, offset: 0.5 }] },
    { anchor: 3, members: [{ clip: 3, offset: 0 }, { clip: 6, offset: 0.4 }] }], [0, 1, 4, 7]);
  // the wrong clock: 668 and 669 look earliest; 2036 (no partner) lies between 669 and 677 by its own clock
  withTimes(e, [100, 130, 500, 600, 900, 500.5, 600.4, 800]);
  const { placements, uncertain } = syncLayout(e, {});
  assert.deepStrictEqual(placements.map((p) => p.name), ["fx30661.MP4", "fx30-3-2032.MP4", "fx30662.MP4", "fx30-3-2033.MP4",
    "fx30668.MP4", "fx30669.MP4", "fx30-3-2036.MP4", "fx30677.MP4"]);
  assert.strictEqual(placements[0].zero, 0);
  assert.deepStrictEqual(uncertain, []);
  for (const p of placements) assert.strictEqual(p.track, p.path.startsWith(A) ? 0 : 1);
});

test("two cameras in one folder keep their own counters (folder + name before the number)", () => {
  const D = "/v/all";
  const e = engineOf([[`${D}/fx30-3-2033.MP4`, 10], [`${D}/fx30661.MP4`, 10], [`${D}/fx30-3-2032.MP4`, 10], [`${D}/fx30662.MP4`, 10]],
    [], [0, 1, 2, 3]);
  withTimes(e, [10, 20, 30, 40]);
  const names = syncLayout(e, {}).placements.map((p) => p.name);
  assert.ok(names.indexOf("fx30-3-2032.MP4") < names.indexOf("fx30-3-2033.MP4"));
  assert.ok(names.indexOf("fx30661.MP4") < names.indexOf("fx30662.MP4"));
  // camera fx30-3- is free to start (its first file 2032 is at 30 s, 661 at 20 s): 661 goes first by the clock
  assert.deepStrictEqual(names, ["fx30661.MP4", "fx30-3-2032.MP4", "fx30-3-2033.MP4", "fx30662.MP4"]);
});

test("0.10.154: the second POV's file numbers never move a main clip", () => {
  // a1+b2 and a2+b1 are synced: B's numbers say the other order, the main POV's (A) decide, and nothing is uncertain
  const e = engineOf([["/v/A/a1.mp4", 10], ["/v/A/a2.mp4", 10], ["/v/B/b1.mp4", 10], ["/v/B/b2.mp4", 10]],
    [{ anchor: 0, members: [{ clip: 0, offset: 0 }, { clip: 3, offset: 0 }] },
      { anchor: 1, members: [{ clip: 1, offset: 0 }, { clip: 2, offset: 0 }] }], []);
  withTimes(e, [10, 50, 50, 10]);
  const lay = syncLayout(e, {});
  assert.strictEqual(lay.main, "/v/A");
  assert.deepStrictEqual(lay.placements.map((p) => p.name), ["a1.mp4", "b2.mp4", "a2.mp4", "b1.mp4"]);
  assert.deepStrictEqual(lay.uncertain, []);
});

test("0.10.154: the main POV is the camera on the lowest video track, and it gets V1 and the order", () => {
  // the user's report: the main POV's clips ended up at the back because the second POV's files were laid out first.
  // B holds more clips and comes first in the timeline, but A is on V1: A's numbers make the order, B hangs on it
  const A = "/v/A";
  const B = "/v/B";
  const e = engineOf([[`${B}/b1.mp4`, 10], [`${B}/b2.mp4`, 10], [`${B}/b3.mp4`, 10], [`${B}/b4.mp4`, 10],
    [`${A}/a1.mp4`, 12], [`${A}/a2.mp4`, 12], [`${A}/a3.mp4`, 12]],
  [{ anchor: 5, members: [{ clip: 5, offset: 0 }, { clip: 1, offset: 1 }] },
    { anchor: 6, members: [{ clip: 6, offset: 0 }, { clip: 3, offset: 2 }] }], [0, 2, 4]);
  // B's clock was never checked against A's for b1 and b3 (no times): the old order put a1 after them
  withTimes(e, [null, 201, null, 301, 100, 200, 300]);
  const tracks = Object.fromEntries(e.clips.map((c) => [c.path, c.path.startsWith(A) ? 0 : 1]));
  const order = Object.fromEntries(e.clips.map((c, i) => [c.path, i * 100]));
  const lay = syncLayout(e, order, { tracks });
  assert.strictEqual(lay.main, A);
  assert.deepStrictEqual(lay.cameras, [A, B]);
  // b1 is numbered before b2 (a2's partner): anywhere before a2, and by the timeline it comes first; b3 between b2 and b4
  assert.deepStrictEqual(lay.placements.map((p) => p.name),
    ["b1.mp4", "a1.mp4", "a2.mp4", "b2.mp4", "b3.mp4", "a3.mp4", "b4.mp4"]);
  for (const p of lay.placements) assert.strictEqual(p.track, p.path.startsWith(A) ? 0 : 1);
  assert.strictEqual(lay.placements[lay.seed].name, "a1.mp4");
  const mains = lay.placements.filter((p) => p.track === 0).map((p) => p.name);
  assert.deepStrictEqual(mains, ["a1.mp4", "a2.mp4", "a3.mp4"]);
});

test("0.10.154: a second-POV clip alone goes where the clock puts it between its numbered neighbours", () => {
  const A = "/v/A";
  const B = "/v/B";
  const e = engineOf([[`${A}/a1.mp4`, 10], [`${A}/a2.mp4`, 10], [`${A}/a3.mp4`, 10], [`${A}/a4.mp4`, 10],
    [`${B}/b1.mp4`, 10], [`${B}/b2.mp4`, 5], [`${B}/b3.mp4`, 10]],
  [{ anchor: 0, members: [{ clip: 0, offset: 0 }, { clip: 4, offset: 0 }] },
    { anchor: 3, members: [{ clip: 3, offset: 0 }, { clip: 6, offset: 0 }] }], [1, 2, 5]);
  withTimes(e, [100, 200, 300, 400, 100, 250, 400]);          // b2 was recorded between a2 and a3
  const lay = syncLayout(e, {}, { tracks: Object.fromEntries(e.clips.map((c) => [c.path, c.path.startsWith(A) ? 0 : 1])) });
  assert.deepStrictEqual(lay.placements.map((p) => p.name), ["a1.mp4", "b1.mp4", "a2.mp4", "b2.mp4", "a3.mp4", "a4.mp4", "b3.mp4"]);
  assert.deepStrictEqual(lay.uncertain, []);
});

test("0.10.154: a lone second-POV clip whose number contradicts the main order is placed by the clock and reported", () => {
  const A = "/v/A";
  const B = "/v/B";
  // a1+b5 and a2+b3 are synced, so B's numbers run against A's; b4 (alone) cannot sit between b3 and b5 without moving a clip
  const e = engineOf([[`${A}/a1.mp4`, 10], [`${A}/a2.mp4`, 10], [`${B}/b5.mp4`, 10], [`${B}/b3.mp4`, 10], [`${B}/b4.mp4`, 10]],
    [{ anchor: 0, members: [{ clip: 0, offset: 0 }, { clip: 2, offset: 0 }] },
      { anchor: 1, members: [{ clip: 1, offset: 0 }, { clip: 3, offset: 0 }] }], [4]);
  withTimes(e, [100, 200, 100, 200, 150]);
  const lay = syncLayout(e, {}, { tracks: Object.fromEntries(e.clips.map((c) => [c.path, c.path.startsWith(A) ? 0 : 1])) });
  assert.deepStrictEqual(lay.placements.map((p) => p.name), ["a1.mp4", "b5.mp4", "b4.mp4", "a2.mp4", "b3.mp4"]);
  assert.deepStrictEqual(lay.uncertain.map((u) => u.name), ["b4.mp4"]);
  assert.match(lay.uncertain[0].reason, /file numbers and the sync disagree/);
});

test("0.10.154: mainCamera, with everything on one track the camera with the most clips, then the most footage", () => {
  const clips = [{ path: "/a/1.mp4", duration: 10 }, { path: "/a/2.mp4", duration: 10 }, { path: "/b/1.mp4", duration: 50 },
    { path: "/z/rec.wav", duration: 500, has_video: false }];
  const cam = (i) => folderOf(clips[i].path);
  const when = (i) => i;
  assert.strictEqual(mainCamera(clips, cam, when, { "/a/1.mp4": 0, "/a/2.mp4": 0, "/b/1.mp4": 0 }), "/a");   // more clips
  assert.strictEqual(mainCamera(clips, cam, when, { "/a/1.mp4": 1, "/a/2.mp4": 1, "/b/1.mp4": 0 }), "/b");   // lowest track
  assert.strictEqual(mainCamera(clips.slice(1), (i) => folderOf(clips[i + 1].path), when, null), "/b");      // 1 clip each: more footage
  assert.strictEqual(mainCamera([clips[3]], () => "/z", when, null), null);                                   // sound only
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


test("two cameras whose files share one folder never overlap on one track (0.10.6, BUG-011)", () => {
  const one = engineOf([["/m/all/A001.MP4", 20], ["/m/all/B001.MP4", 20], ["/m/all/A002.MP4", 10]],
    [{ anchor: 0, members: [{ clip: 0, offset: 0 }, { clip: 1, offset: 2 }] }], [2]);
  const { placements, uncertain } = syncLayout(one, {});
  const byTrack = {};
  for (const p of placements) (byTrack[p.track] = byTrack[p.track] || []).push([p.zero, p.zero + p.duration]);
  for (const spans of Object.values(byTrack)) {
    spans.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1] - 1e-9);
  }
  assert.deepStrictEqual(placements.filter((p) => p.group === 1).map((p) => p.track).sort(), [0, 1]);
  assert.ok(uncertain.some((u) => /shares a folder/.test(u.reason)));
});

test("the user's Credissimo case (2026-11-11): an iPhone clip on the second track, C0932 straight after C0930, no gap", () => {
  const D = "/dl", I = "/dl/CREDISSIMO/5 Nov 2026";
  const eng = { clips: [{ path: `${D}/C0930.MP4`, name: "C0930.MP4", duration: 393.12, has_video: true, rec_time: 1793879892.0 },
    { path: `${D}/C0932.MP4`, name: "C0932.MP4", duration: 256.32, has_video: true, rec_time: 1793880465.0 },
    { path: `${I}/IMG_0357.MOV`, name: "IMG_0357.MOV", duration: 95.755, has_video: true, rec_time: 1793879938.302695 }],
  groups: [{ anchor: 0, members: [{ clip: 0, offset: 0 }, { clip: 2, offset: 46.302695 }] }], unsynced: [1] };
  const r = syncLayout(eng, { [`${D}/C0930.MP4`]: 0, [`${D}/C0932.MP4`]: 393.12, [`${I}/IMG_0357.MOV`]: 46.3 });
  const at = Object.fromEntries(r.placements.map((p) => [p.name, [p.track, +p.zero.toFixed(3)]]));
  assert.deepStrictEqual(at, { "C0930.MP4": [0, 0], "IMG_0357.MOV": [1, 46.303], "C0932.MP4": [0, 393.12] });
});

test("0.10.45: two cameras put their sound on every other audio track; one camera stays on A1", () => {
  const two = syncLayout({ clips: [{ path: "/a/1.mp4", name: "1", duration: 10, has_video: true },
    { path: "/b/2.mp4", name: "2", duration: 10, has_video: true }],
  groups: [{ anchor: 0, members: [{ clip: 0, offset: 0 }, { clip: 1, offset: 1 }] }], unsynced: [] }, null);
  assert.deepStrictEqual(two.placements.map((p) => [p.track, p.audioTrack]).sort(), [[0, 0], [1, 2]]);
  const one = syncLayout({ clips: [{ path: "/a/1.mp4", name: "1", duration: 10, has_video: true },
    { path: "/a/2.mp4", name: "2", duration: 10, has_video: true }], groups: [], unsynced: [0, 1] }, null);
  assert.ok(one.placements.every((p) => p.audioTrack === p.track));
});

test("0.10.149: the engine's camera key puts two cameras from one folder on their own tracks", () => {
  const D = "/v/СКЕЧ";
  const e = engineOf([[`${D}/fx30661.MP4`, 20], [`${D}/fx30-3-2032.MP4`, 15], [`${D}/fx30663.MP4`, 10], [`${D}/fx30-3-2036.MP4`, 9]],
    [{ anchor: 0, members: [{ clip: 0, offset: 0 }, { clip: 1, offset: 2.57 }] }], [2, 3]);
  e.clips.forEach((c) => { c.camera = `${D}|${c.name.startsWith("fx30-3-") ? "fx30-3-" : "fx"}`; });
  withTimes(e, [100, 102.57, 200, 300]);
  const { placements, uncertain } = syncLayout(e, {});
  for (const p of placements) assert.strictEqual(p.track, p.name.startsWith("fx30-3-") ? 1 : 0, p.name);
  assert.ok(!uncertain.some((u) => /shares a folder/.test(u.reason)));
});
