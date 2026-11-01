// node --test tests/moments.test.js
const test = require("node:test");
const assert = require("node:assert");
const { analysisMoments } = require("../panel/moments.js");

const clip = { kind: "video", track: 0, start: 10, end: 20 };

test("four moments evenly inside the clip, away from both cuts", () => {
  assert.deepStrictEqual(analysisMoments({ items: [clip] }, clip), [12, 14, 16, 18]);
});

test("moments under a title on an upper track are skipped", () => {
  const title = { kind: "video", track: 1, start: 13, end: 17 };
  assert.deepStrictEqual(analysisMoments({ items: [clip, title] }, clip), [12, 18]);
});

test("audio and lower tracks do not cover the picture", () => {
  const items = [clip, { kind: "audio", track: 3, start: 0, end: 30 }, { kind: "video", track: 0, start: 0, end: 30 }];
  assert.strictEqual(analysisMoments({ items }, clip).length, 4);
});

test("a clip fully under an adjustment layer has nothing to measure (engine falls back, REVIEW_NEEDED)", () => {
  const adj = { kind: "video", track: 2, start: 0, end: 60 };
  assert.deepStrictEqual(analysisMoments({ items: [clip, adj] }, clip), []);
});

const { cameras, shotMoments } = require("../panel/moments.js");

test("cameras by folder, as Sync uses them", () => {
  const c = cameras([{ path: "/m/fx3/fx31031.MP4" }, { path: "/m/кам1/C0731.MP4" }, { path: "/m/fx3/fx31032.MP4" }]);
  assert.deepStrictEqual(c, ["fx3", "кам1", "fx3"]);
});

test("cameras by file name when everything is in one folder", () => {
  const c = cameras([{ path: "/m/all/fx31031.MP4" }, { path: "/m/all/C0731.MP4" }]);
  assert.deepStrictEqual(c, ["fx", "C"]);
});

test("synced POVs: the moments are inside the overlap with the other camera", () => {
  const clip = { start: 10, end: 30 };
  const m = shotMoments(clip, [{ start: 20, end: 40 }]);
  assert.strictEqual(m.overlap, true);
  assert.deepStrictEqual(m.times, [22, 24, 26, 28]);
});

test("overlap split over two clips of the other camera", () => {
  const m = shotMoments({ start: 0, end: 20 }, [{ start: 2, end: 6 }, { start: 14, end: 18 }]);
  assert.strictEqual(m.overlap, true);
  for (const t of m.times) assert.ok((t >= 2 && t <= 6) || (t >= 14 && t <= 18), `${t} outside the overlap`);
});

test("no overlap (cut between POVs): evenly across the clip", () => {
  const m = shotMoments({ start: 0, end: 10 }, [{ start: 10, end: 20 }]);
  assert.strictEqual(m.overlap, false);
  assert.deepStrictEqual(m.times, [2, 4, 6, 8]);
});
