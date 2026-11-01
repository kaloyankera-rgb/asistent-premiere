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
