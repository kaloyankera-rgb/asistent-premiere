// node --test tests/blurplan.test.js
const test = require("node:test");
const assert = require("node:assert");
const B = require("../panel/blurplan.js");
const K = require("../panel/keyframeplan.js");

const rad = (d) => (d * Math.PI) / 180;
// what Premiere's Transform does to a layer point (layer pixels), its Position / Anchor Point in fractions of the layer
function transform(p, T, geo) {
  const ax = T.ax * geo.layer.w;
  const ay = T.ay * geo.layer.h;
  const qx = (p[0] - ax) * T.sw / 100;
  const qy = (p[1] - ay) * T.sh / 100;
  const r = rad(T.rot);
  return [T.x * geo.layer.w + Math.cos(r) * qx - Math.sin(r) * qy, T.y * geo.layer.h + Math.sin(r) * qx + Math.cos(r) * qy];
}
const close = (a, b, e = 1e-6) => Math.abs(a[0] - b[0]) < e && Math.abs(a[1] - b[1]) < e;

test("the blur Transform turns the frame's picture into the later moment's picture exactly", () => {
  const geos = [
    { seq: { w: 1920, h: 1080 }, layer: { w: 1920, h: 1080 } },
    { seq: { w: 2160, h: 3840 }, layer: { w: 1000, h: 600 } },
    { seq: { w: 1080, h: 1920 }, layer: { w: 3840, h: 2160 }, fit: true },
  ];
  const moments = [
    [{ x: 0.5, y: 0.5 }, { x: 0.62, y: 0.47 }],                                                  // a move
    [{ x: 0.3, y: 0.6, sh: 80 }, { x: 0.3, y: 0.6, sh: 115 }],                                    // a scale
    [{ x: 0.4, y: 0.4, rot: 10 }, { x: 0.45, y: 0.38, rot: 31 }],                                 // a turn and a move
    [{ x: 0.5, y: 0.5, sh: 140, rot: -25, ax: 0.3, ay: 0.7 }, { x: 0.58, y: 0.52, sh: 95, rot: 5, ax: 0.3, ay: 0.7 }],
    [{ x: 0.5, y: 0.5, sw: 120, sh: 80 }, { x: 0.52, y: 0.5, sw: 60, sh: 90 }],                   // non-uniform, no turn
  ];
  for (const geo of geos) {
    for (const [a, b] of moments) {
      const mk = B.motion(a);
      const mu = B.motion(b);
      const T = B.rel(mk, mu, geo);
      for (const p of [[0, 0], [geo.layer.w, 0], [geo.layer.w * 0.3, geo.layer.h * 0.8], [geo.layer.w, geo.layer.h]]) {
        const want = B.screen(p[0], p[1], mu, geo);
        const got = B.screen(...transform(p, T, geo), mk, geo);
        assert.ok(close(got, want, 1e-6), `${JSON.stringify([a, b, geo.layer])}: ${got} vs ${want}`);
      }
      // at rest it changes nothing
      const R = B.rest(mk);
      assert.ok(close(transform([123, 45], R, geo), [123, 45]));
    }
  }
});

test("amount: 0 is off, 50 % is a 180 degree shutter, 100 % stays just short of the next frame", () => {
  assert.strictEqual(B.shutter(0), 0);
  assert.strictEqual(B.shutter(-5), 0);
  assert.strictEqual(B.shutter("x"), 0);
  assert.strictEqual(B.shutter(50), 0.5);
  assert.strictEqual(B.shutter(25), 0.25);
  assert.strictEqual(B.shutter(100), B.OPEN_MAX);
  assert.ok(B.OPEN_MAX < 1);
});

const geo = { seq: { w: 1920, h: 1080 }, layer: { w: 1920, h: 1080 } };
const step = 1 / 30;

test("keys follow the speed: a faster frame gets a longer window move, still frames none", () => {
  // x eases in: slow at first, fast later, then still after 1 s
  const at = (t) => ({ x: 0.2 + 0.6 * Math.min(1, t) ** 2, y: 0.5 });
  const frames = Array.from({ length: 40 }, (_, i) => i * step);
  const r = B.blurKeys(frames, at, step, 0.5, geo);
  assert.ok(r.moving > 25 && r.moving <= 30, String(r.moving));
  assert.strictEqual(r.keys.scale, null);
  assert.strictEqual(r.keys.rotation, null);
  const pos = r.keys.position;
  // every key either at rest (x == anchor 0.5) on a frame, or inside a window
  const off = (k) => Math.abs(k.v[0] - 0.5) * 1920;
  const early = pos.filter((k) => k.t > 0.1 && k.t < 0.2).map(off);
  const late = pos.filter((k) => k.t > 0.85 && k.t < 0.95).map(off);
  assert.ok(Math.max(...late) > 4 * Math.max(...early), `${Math.max(...early)} ${Math.max(...late)}`);
  for (const k of pos) {
    const frac = (k.t / step) - Math.floor(k.t / step + 1e-9);
    if (frac < 1e-6 || frac > 1 - B.PIN - 1e-6) assert.ok(off(k) < 1e-6, `frame key at rest at ${k.t}`);
    else assert.ok(frac > 0 && frac <= 0.5 + B.PIN + 1e-9, `window key inside the first half: ${frac}`);
  }
  // keys in time order, never two at one moment, and the window's ends pinned
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i].t > pos[i - 1].t, `order at ${i}`);
  assert.ok(B.OPEN_MAX + 2 * B.PIN < 1, "the window's pin stays before the next frame's");
  assert.ok(pos.every((k) => k.t < 1.0 + 2 * step), "nothing after the move stops");
  // the window's last key is the whole move over half a frame, in layer fractions
  const k = pos.find((q) => Math.abs(q.t - (0.5 + 0.5 * step)) < 1e-9);
  const want = at(0.5 + 0.5 * step).x - at(0.5).x;
  assert.ok(Math.abs(k.v[0] - 0.5 - want) < 1e-9);
});

test("more amount, longer smear; zero amount, no keys", () => {
  const at = (t) => ({ x: 0.2 + 0.3 * t, y: 0.5 });
  const frames = Array.from({ length: 10 }, (_, i) => i * step);
  const off = (r) => Math.max(...r.keys.position.map((k) => Math.abs(k.v[0] - 0.5)));
  const a = B.blurKeys(frames, at, step, B.shutter(25), geo);
  const b = B.blurKeys(frames, at, step, B.shutter(100), geo);
  assert.ok(Math.abs(off(b) / off(a) - B.OPEN_MAX / 0.25) < 1e-6);
  assert.strictEqual(B.blurKeys(frames, at, step, 0, geo).total, 0);
  assert.strictEqual(Math.round(a.angle), 90);
});

test("a scale pop: scale keys, no blur on the frame at scale 0, uniform kept", () => {
  const at = (t) => ({ x: 0.5, y: 0.5, sh: 100 * Math.min(1, t / 0.2) });
  const frames = Array.from({ length: 10 }, (_, i) => i * step);
  const r = B.blurKeys(frames, at, step, 0.5, geo);
  assert.ok(r.keys.scale && r.uniform && r.keys.scaleWidth === null);
  assert.ok(Math.abs(r.keys.scale[0].t - (step - B.PIN * step)) < 1e-12, "frame 0 (scale 0) carries nothing");
  const frac = (k) => k.t / step - Math.floor(k.t / step + 1e-9);
  const inside = r.keys.scale.filter((k) => frac(k) > 1e-6 && frac(k) < 1 - B.PIN - 1e-6);
  assert.ok(inside.every((k) => k.v > 100), "it grows inside every window");
});

test("the preview samples a frame's window as Premiere does: forward from the frame", () => {
  assert.deepStrictEqual(B.samples(1, 0.1, 0), [1]);
  const s = B.samples(1, 0.1, 0.5, 4);
  assert.strictEqual(s.length, 4);
  assert.ok(s[0] > 1 && Math.abs(s[3] - 1.05) < 1e-12);
});

// ---------------------------------------------------------------- the shaped animation between frames (keyframeplan.shapedFn)

const anchors = [{ t: 10, v: 0 }, { t: 10.5, v: 100 }, { t: 11, v: 40 }];
const curves = [
  { p: [0.42, 0, 0.58, 1] },
  [0.16, 1, 0.3, 1],                                    // a plain bezier (shapedFn takes it as {p})
  { kind: "elastic", dir: "end", n: 2, over: 0.2 },
  { kind: "bounce", dir: "end", n: 3, h: 0.5 },
  { kind: "points", pts: [[0.3, 0.8, 1], [0.6, 0.4]] },
  { kind: "overshoot", amp: 50, freq: 2, decay: 4 },
  { kind: "bounceBack", elast: 50, grav: 50, max: 10 },
];

test("between frames the shaped animation is the curve, and on every frame it is the baked key", () => {
  const repeats = [null, { mode: "pingpong", times: 3 }, { mode: "loop", times: 2 }];
  for (const curve of curves) {
    for (const repeat of repeats) {
      if (repeat && !Array.isArray(curve) && K.AFTER_KINDS.has(curve.kind)) continue;
      const opts = { repeat, until: 14 };
      const pl = K.plan([{ id: "a", keys: anchors }], Array.isArray(curve) ? { p: curve } : curve, step, opts);
      assert.ok(!pl.error, pl.error);
      const fn = K.shapedFn(anchors, curve, step, opts);
      for (const k of pl.props[0].add) assert.ok(Math.abs(fn(k.t) - k.v) < 1e-6, `${JSON.stringify(curve)} ${JSON.stringify(repeat)} at ${k.t}: ${fn(k.t)} vs ${k.v}`);
      for (const a of anchors) assert.ok(Math.abs(fn(a.t) - a.v) < 1e-6);
      // after the last key it holds the last key's value
      const keys = [...anchors, ...pl.props[0].add].sort((a, b) => a.t - b.t);
      const end = keys[keys.length - 1];
      assert.ok(Math.abs(fn(end.t + 0.5) - end.v) < 0.25, `${JSON.stringify(curve)} ${JSON.stringify(repeat)} holds ${fn(end.t + 0.5)} vs ${end.v}`);
    }
  }
});

test("a loop's jump back is not a move: the frame before it keeps the last value through its window", () => {
  const fn = K.shapedFn(anchors, { p: [0, 0, 1, 1] }, step, { repeat: { mode: "loop", times: 1 } });
  assert.strictEqual(fn(11 + 0.4 * step), 40);
  assert.ok(Math.abs(fn(11 + step)) < 1e-6);
});

test("Premiere's own modes: Linear and Hold known, Premiere's ease read from Premiere", () => {
  assert.strictEqual(K.shapedFn(anchors, { mode: "LINEAR" }, step)(10.25), 50);
  assert.strictEqual(K.shapedFn(anchors, { mode: "HOLD" }, step)(10.49), 0);
  assert.strictEqual(K.shapedFn(anchors, { mode: "HOLD" }, step)(10.5), 100);
  assert.strictEqual(K.shapedFn(anchors, { mode: "BEZIER" }, step), null);
});

test("points [x, y] (Position) are shaped like numbers", () => {
  const two = [{ t: 0, v: [0.2, 0.5] }, { t: 1, v: [0.8, 0.3] }];
  const fn = K.shapedFn(two, { kind: "bounce", dir: "end", n: 2, h: 0.5 }, step);
  const v = fn(0.5);
  assert.ok(Array.isArray(v) && v.length === 2 && v[0] > 0.2 && v[0] < 0.8);
});

test("a window gets more keys only where the motion curves inside it, and then follows it within half a pixel", () => {
  const sq = { seq: { w: 2160, h: 3840 }, layer: { w: 2160, h: 3840 } };
  const frames = Array.from({ length: 10 }, (_, i) => i * step);
  const windowKeys = (r) => {
    const per = new Map();
    for (const k of r.keys.position || r.keys.scale) {
      const f = Math.floor(k.t / step + 1e-9);
      const frac = k.t / step - f;
      if (frac > 1e-6 && frac < 0.5 + 1e-6) per.set(f, (per.get(f) || 0) + 1);
    }
    return per;
  };
  // a straight, even move: two keys in every window
  const straight = B.blurKeys(frames, (t) => ({ x: 0.3 + 2 * t, y: 0.5 }), step, 0.5, sq);
  assert.ok([...windowKeys(straight).values()].every((n) => n === 2));
  // Elastic scale pop 0 -> 100 over 6 frames (the NEW TEST clip): its overshoot peaks inside frame 3's window
  const fn = K.shapedFn([{ t: 0, v: 0 }, { t: 6 * step, v: 100 }], { kind: "elastic", dir: "end", n: 2, over: 0.2 }, step, {});
  const at = (t) => ({ x: 0.5, y: 0.5, sh: fn(t) });
  const pop = B.blurKeys(frames, at, step, 0.5, sq);
  const counts = windowKeys(pop);
  assert.ok(counts.get(3) > 2, JSON.stringify([...counts]));
  // every window's straight pieces stay within half a pixel of the real motion at 16 moments
  for (const f of counts.keys()) {
    const t = f * step;
    const mk = B.motion(at(t));
    const keys = [{ t, v: B.rest(mk) }].concat(pop.keys.scale.filter((k) => k.t > t + 1e-9 && k.t < t + 0.5 * step + 1e-9)
      .map((k) => ({ t: k.t, v: { ...B.rest(mk), sw: k.v, sh: k.v } })));
    const fine = Array.from({ length: 17 }, (_, j) => ({ t: t + (0.5 * step * j) / 16, v: B.rel(mk, B.motion(at(t + (0.5 * step * j) / 16)), sq) }));
    assert.ok(B.bend(keys, fine, mk, sq) <= 0.5 + 1e-9 || keys.length - 1 === B.INNER_MAX, `frame ${f}`);
  }
});

test("a frame whose picture would grow past 4x in its shutter time is left sharp (Premiere breaks every frame's blur then)", () => {
  const sq = { seq: { w: 2160, h: 3840 }, layer: { w: 2160, h: 3840 } };
  const fn = K.shapedFn([{ t: 0, v: 0 }, { t: 6 * step, v: 100 }], { kind: "elastic", dir: "end", n: 2, over: 0.2 }, step, {});
  const r = B.blurKeys(Array.from({ length: 10 }, (_, i) => i * step), (t) => ({ x: 0.5, y: 0.5, sh: fn(t) }), step, 0.5, sq);
  assert.ok(r.tooFast >= 1, String(r.tooFast));
  assert.ok(r.keys.scale.every((k) => k.v <= B.SCALE_MAX), "no Scale key past the limit");
  assert.ok(r.moving >= 3, "the other frames still blur");
});
