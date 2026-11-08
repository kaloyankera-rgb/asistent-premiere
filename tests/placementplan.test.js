// node --test tests/placementplan.test.js
const test = require("node:test");
const assert = require("node:assert");
const P = require("../panel/placementplan.js");

const face = (y, h, x = 0.4, w = 0.2) => ({ x, y, w, h });

test("the Bulgarian line's top sits 0.11 under the chin of the largest face", () => {
  const r = P.shotTop([[face(0.2, 0.15), face(0.1, 0.05, 0.8, 0.05)]]);      // chin 0.35, a small background face ignored
  assert.deepStrictEqual(r, { top: 0.46, why: "under the face" });
});

test("a low face puts the line above it", () => {
  const r = P.shotTop([[face(0.6, 0.2)]]);                                   // chin 0.8 -> 0.91 is below the limit
  assert.strictEqual(r.why, "above the face");
  assert.ok(Math.abs(r.top - (0.6 - 0.02 - 0.035)) < 1e-9);
});

test("no face: the middle; and the height stays within 0.16-0.72", () => {
  assert.deepStrictEqual(P.shotTop([[], []]), { top: 0.5, why: "no face" });
  assert.strictEqual(P.shotTop([[face(0.0, 0.03)]]).top, 0.16);             // chin 0.03 + 0.11 = 0.14 -> 0.16
});

test("several frames of a shot: the median chin", () => {
  const r = P.shotTop([[face(0.2, 0.1)], [face(0.3, 0.1)], [face(0.25, 0.1)]]);
  assert.strictEqual(r.top, 0.46);                                           // median chin 0.35
});

test("two graphics at the same times are a pair: the lower one is English", () => {
  const g = [{ id: 0, start: 1, end: 2, center: 0.6 }, { id: 1, start: 1, end: 2.02, center: 0.5 }, { id: 2, start: 3, end: 4, center: 0.5 }];
  assert.deepStrictEqual(P.roles(g), [{ id: 0, role: "en" }, { id: 1, role: "bg" }, { id: 2, role: "bg" }]);
});

test("one height per shot; English 0.035 under the Bulgarian centre; Motion keeps each layer's own offset", () => {
  const shots = [{ start: 0, end: 5 }, { start: 5, end: 10 }];
  const g = [{ id: 0, start: 1, end: 2, center: 0.5, motionY: 0.5 }, { id: 1, start: 1, end: 2, center: 0.55, motionY: 0.5 },
    { id: 2, start: 6, end: 7, center: 0.4, motionY: 0.45 }];
  const out = P.plan(g, shots, [[[face(0.2, 0.15)]], [[]]]);
  assert.strictEqual(out[0].targetCenter, 0.478);                            // top 0.46 + half a line
  assert.strictEqual(out[1].targetCenter, 0.513);                            // + 0.035 for English
  assert.strictEqual(out[1].role, "en");
  assert.strictEqual(out[2].why, "no face");
  assert.strictEqual(out[2].motionY, Math.round((0.45 + 0.5175 - 0.4) * 10000) / 10000);
});

test("the moments measured per shot: up to three line middles spread over the shot", () => {
  const shots = [{ start: 0, end: 10 }];
  const g = [0, 1, 2, 3, 4].map((k) => ({ start: k * 2, end: k * 2 + 1 }));
  assert.deepStrictEqual(P.moments(shots, g), [[0.5, 4.5, 8.5]]);
});

test("a graphic moved by hand or keyframed is left alone; Premiere's default or Asistent's own value may move", () => {
  assert.deepStrictEqual(P.movable({ motionX: 0.5, motionY: 0.5 }), { ok: true });
  assert.deepStrictEqual(P.movable({ motionX: 0.5, motionY: 0.62 }, { x: 0.5, y: 0.62 }), { ok: true });
  assert.deepStrictEqual(P.movable({ motionX: 0.5, motionY: 0.7 }, { x: 0.5, y: 0.62 }), { ok: false, why: "moved by hand" });
  assert.deepStrictEqual(P.movable({ animated: true, motionX: 0.5, motionY: 0.5 }), { ok: false, why: "Position has keyframes" });
});
