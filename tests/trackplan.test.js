// Motion tracker (0.10.51): from the engine's track to the attached clip's keys
const test = require("node:test");
const assert = require("node:assert");
const P = require("../panel/trackplan.js");

const frame = { width: 1080, height: 1920 };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("screenPoint: a 4K file scaled 50 % into a 1080x1920 frame, then moved and turned", () => {
  const file = { width: 2160, height: 3840 };
  // centre of the file lands at Position
  assert.deepStrictEqual(P.screenPoint(1080, 1920, file, { sw: 50 }, frame), [540, 960]);
  // a point 200 px right of the centre: 100 px at 50 %
  const [x, y] = P.screenPoint(1280, 1920, file, { sw: 50 }, frame);
  assert.ok(near(x, 640) && near(y, 960));
  // turned 90 degrees clockwise: right of the centre goes below it
  const [x2, y2] = P.screenPoint(1280, 1920, file, { sw: 50, rot: 90 }, frame);
  assert.ok(near(x2, 540) && near(y2, 1060));
  // Scale to Frame Size: the file fits the frame (0.5) and Scale multiplies it
  const [x3] = P.screenPoint(1280, 1920, file, { sw: 100, fit: true }, frame);
  assert.ok(near(x3, 640));
  // anchor and position as fractions
  const [x4, y4] = P.screenPoint(0, 0, file, { sw: 50, ax: 0, ay: 0, x: 0.25, y: 0.25 }, frame);
  assert.ok(near(x4, 270) && near(y4, 480));
});

function track(frames, k0 = 0) {
  return { frames, width: 1080, height: 1920, k0 };
}

test("attach: the text keeps its offset from the point; lost frames and frames outside the text get no key", () => {
  const src = { start: 10, inPt: 2, speed: 1 };
  const fr = [0, 1, 2, 3].map((i) => ({ t: 2 + i / 30, x: 540 + 10 * i, y: 960, s: 1, a: 0, state: i === 2 ? "lost" : "sure" }));
  // the text sits 100 px above the object on the boxed frame (k0 = 1: x 550)
  const target = { start: 10, end: 10 + 3.5 / 30, inPt: 0, speed: 1, x: 550 / 1080, y: 860 / 1920, scale: 100, rot: 0 };
  const r = P.attach(track(fr, 1), src, {}, target, frame);
  assert.strictEqual(r.lost, 1);
  assert.deepStrictEqual(r.keys.map((k) => Math.round(k.x * 1080)), [540, 550, 570]);
  assert.ok(r.keys.every((k) => near(k.y * 1920, 860)));
  assert.ok(near(r.keys[2].t, 3 / 30));          // the text's own media time
  // a text that starts later: the frames before it are outside
  const late = P.attach(track(fr, 1), src, {}, { ...target, start: 10 + 0.5 / 30 }, frame);
  assert.strictEqual(late.outside, 1);
});

test("attach with Scale and Rotation: the offset turns and grows with the object", () => {
  const src = { start: 0, inPt: 0, speed: 1 };
  const fr = [{ t: 0, x: 540, y: 960, s: 1, a: 0, state: "sure" }, { t: 1 / 30, x: 540, y: 960, s: 2, a: 90, state: "sure" }];
  const target = { start: 0, end: 1, inPt: 0, speed: 1, x: 640 / 1080, y: 960 / 1920, scale: 80, rot: 5 };
  const r = P.attach(track(fr), src, {}, target, frame, { scale: true, rotation: true });
  const k = r.keys[1];
  // 100 px to the right, turned 90 clockwise and doubled: 200 px below
  assert.ok(near(k.x * 1080, 540) && near(k.y * 1920, 1160));
  assert.ok(near(k.scale, 160) && near(k.rot, 95));
  // without them only the place follows
  const plain = P.attach(track(fr), src, {}, target, frame).keys[1];
  assert.ok(near(plain.x * 1080, 640) && plain.scale === undefined && plain.rot === undefined);
});

test("attach on a slowed source and through the source's own keyframed punch-in", () => {
  const src = { start: 5, inPt: 1, speed: 0.5 };          // 50 %: media runs half as fast as the timeline
  const fr = [0, 1, 2].map((i) => ({ t: 1 + i * 0.5 / 30, x: 540, y: 960 + 100, s: 1, a: 0, state: "sure" }));
  // the source grows from 100 % to 120 % around its centre: a point 100 px below the centre moves to 120 px below
  const motions = [{ sw: 100 }, { sw: 110 }, { sw: 120 }];
  const target = { start: 5, end: 6, inPt: 0, speed: 1, x: 0.5, y: 1060 / 1920, scale: 100, rot: 0 };
  const r = P.attach(track(fr), src, motions, target, frame);
  assert.deepStrictEqual(r.keys.map((k) => Math.round(k.y * 1920)), [1060, 1070, 1080]);
  assert.deepStrictEqual(r.keys.map((k) => Math.round(k.t * 30)), [0, 1, 2]);   // one key per timeline frame
});

test("attach refuses a text that is not on the timeline at the boxed frame", () => {
  const fr = [{ t: 0, x: 1, y: 1, s: 1, a: 0, state: "sure" }];
  assert.ok(P.attach(track(fr), { start: 0, inPt: 0, speed: 1 }, {}, { start: 2, end: 3, inPt: 0, x: 0, y: 0 }, frame).error);
  assert.ok(P.attach(track([]), { start: 0 }, {}, {}, frame).error);
});

test("runs and boxFrom", () => {
  const st = ["sure", "sure", "lost", "unsure", "unsure"].map((state) => ({ state }));
  assert.deepStrictEqual(P.runs(st), [{ from: 0, to: 2, state: "sure" }, { from: 2, to: 3, state: "lost" }, { from: 3, to: 5, state: "unsure" }]);
  assert.deepStrictEqual(P.boxFrom(300, 200, 100, 100, 400, 400), [0.25, 0.25, 0.5, 0.25]);
  assert.deepStrictEqual(P.boxFrom(-50, -10, 100, 100, 200, 200), [0, 0, 0.5, 0.5]);
  assert.strictEqual(P.boxFrom(10, 10, 12, 50, 200, 200), null);
});
