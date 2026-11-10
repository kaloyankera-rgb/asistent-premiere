// node --test tests/keyframeplan.test.js
const test = require("node:test");
const assert = require("node:assert");
const K = require("../panel/keyframeplan.js");

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test("curves start at 0, end at 1, and ease where they should", () => {
  for (const c of K.PRESETS) {
    assert.ok(near(K.progress(c.p, 0), 0) && near(K.progress(c.p, 1), 1), c.name);
  }
  const p = (id) => K.PRESETS.find((c) => c.id === id).p;
  assert.ok(near(K.progress(p("easeInOut"), 0.5), 0.5, 1e-3));          // symmetric
  assert.ok(K.progress(p("easeIn"), 0.25) < 0.25);                          // slow start
  assert.ok(K.progress(p("easeOut"), 0.25) > 0.25);                         // fast start
  assert.ok(K.progress(p("expoOut"), 0.2) > 0.6);
  const peak = Math.max(...Array.from({ length: 99 }, (_, i) => K.progress(p("overshoot"), (i + 1) / 100)));
  assert.ok(peak > 1.05, "Overshoot goes past the end and comes back");
  assert.ok(near(K.progress([0, 0, 1, 1], 0.3), 0.3, 1e-4));               // linear
});

test("baking puts one key per frame between the editor's keys, the ends untouched", () => {
  const step = 1 / 25;
  const keys = [{ t: 4, v: [0.5, 0.5] }, { t: 5, v: [0.8, 0.2] }];
  const b = K.bake(keys, [0.42, 0, 0.58, 1], step);
  assert.strictEqual(b.segments[0].frames, 25);
  assert.strictEqual(b.add.length, 24);                                     // frames 1..24, not the two ends
  assert.ok(b.add.every((k) => k.t > 4 && k.t < 5));
  const mid = b.add[11];                                                     // t = 4.48: about halfway on an ease-in-out
  assert.ok(mid.v[0] > 0.6 && mid.v[0] < 0.7 && mid.v[1] > 0.3 && mid.v[1] < 0.4, JSON.stringify(mid));
  assert.ok(b.add[0].v[0] - 0.5 < 0.005, "eases out of the first key");
});

test("a sped-up clip bakes one key per sequence frame in media time", () => {
  // speed 2: one sequence frame is 2/25 s of media
  const b = K.bake([{ t: 0, v: 0 }, { t: 2, v: 100 }], [0, 0, 1, 1], 2 / 25);
  assert.strictEqual(b.segments[0].frames, 25);
  assert.strictEqual(b.add.length, 24);
  assert.ok(near(b.add[0].t, 0.08) && near(b.add[0].v, 4, 1e-3));
});

test("a second press replaces Asistent's earlier bake instead of baking the baked keys", () => {
  const step = 1 / 25;
  const first = K.plan([{ id: "pos", keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }], { p: [0.42, 0, 0.58, 1] }, step);
  const added = first.props[0].add;
  const now = [{ t: 0, v: 0 }, ...added, { t: 1, v: 100 }];
  const again = K.plan([{ id: "pos", keys: now, earlier: { anchors: [0, 1], added: added.map((k) => k.t) } }], { p: [0.16, 1, 0.3, 1] }, step);
  const pr = again.props[0];
  assert.strictEqual(pr.remove.length, added.length);
  assert.deepStrictEqual(pr.anchors.map((k) => k.t), [0, 1]);
  assert.strictEqual(pr.add.length, 24);
  // the editor added or moved keys since: the record no longer matches, nothing is removed
  const changed = K.plan([{ id: "pos", keys: now.filter((k, i) => i !== 5), earlier: { anchors: [0, 1], added: added.map((k) => k.t) } }], { p: [0.16, 1, 0.3, 1] }, step);
  assert.strictEqual(changed.props[0].remove.length, 0);
});

test("Premiere's own interpolation adds no keys; refusals say why", () => {
  const step = 1 / 30;
  const r = K.plan([{ id: "a", keys: [{ t: 0, v: 1 }, { t: 1, v: 2 }, { t: 2, v: 3 }] }, { id: "b", keys: [{ t: 0, v: 1 }] }], { mode: "BEZIER" }, step);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.props[0].mode, "BEZIER");
  assert.strictEqual(r.props[0].segments.length, 2);
  assert.strictEqual(r.props[1].skip, "fewer than two keyframes");
  assert.match(K.plan([], { p: [2, 0, 0, 1] }, step).error, /choose a curve/);
  assert.match(K.plan([], { p: [0, 0, 1, 1] }, 0).error, /frame rate/);
  const long = K.plan([{ id: "a", keys: [{ t: 0, v: 0 }, { t: 200, v: 1 }] }], { p: [0, 0, 1, 1] }, 1 / 25);
  assert.match(long.error, /more than 3000/);
});

test("the curve path for the editor box", () => {
  assert.strictEqual(K.curvePath([0.42, 0, 0.58, 1], 100, 10), "M 10 90 C 43.6 90, 56.4 10, 90 10");
});

test("Elastic lands exactly, overshoots by about what was asked, as many times as asked (0.10.33)", () => {
  for (const [n, over] of [[1, 0.2], [2, 0.2], [3, 0.1], [2, 0.4]]) {
    const c = { kind: "elastic", dir: "end", n, over };
    assert.ok(near(K.ease(c, 0), 0) && near(K.ease(c, 1), 1), JSON.stringify(c));
    const xs = Array.from({ length: 2001 }, (_, i) => i / 2000);
    const ys = xs.map((x) => K.ease(c, x));
    const peak = Math.max(...ys);
    assert.ok(Math.abs(peak - 1 - over) < 0.06, `${JSON.stringify(c)} peak ${peak}`);
    let peaks = 0;                                            // local maxima above the target = the overshoots
    for (let i = 1; i < ys.length - 1; i++) if (ys[i] > 1.002 && ys[i] >= ys[i - 1] && ys[i] > ys[i + 1]) peaks++;
    assert.strictEqual(peaks, n, `${JSON.stringify(c)} overshoots`);
    assert.ok(K.ease(c, 0.01) < 0.05, "starts from rest");
  }
});

test("Bounce never passes the target, touches it once per hop, each hop lower", () => {
  const c = { kind: "bounce", dir: "end", n: 3, h: 0.5 };
  const ys = Array.from({ length: 4001 }, (_, i) => K.ease(c, i / 4000));
  assert.ok(Math.max(...ys) <= 1 + 1e-9);
  assert.ok(near(ys[0], 0) && near(ys[ys.length - 1], 1));
  const dips = [];
  for (let i = 1; i < ys.length - 1; i++) if (ys[i] < ys[i - 1] && ys[i] <= ys[i + 1] && ys[i] < 0.999) dips.push(1 - ys[i]);
  assert.strictEqual(dips.length, 3);
  assert.ok(dips[0] > dips[1] && dips[1] > dips[2]);
  assert.ok(Math.abs(dips[0] - 0.5) < 0.02, `first hop half as high: ${dips[0]}`);
});

test("at the start is the mirror of at the end; both is symmetric", () => {
  const end = { kind: "elastic", dir: "end", n: 2, over: 0.2 };
  const start = { ...end, dir: "start" };
  for (const x of [0.1, 0.3, 0.7]) assert.ok(near(K.ease(start, x), 1 - K.ease(end, 1 - x)));
  const both = { kind: "bounce", dir: "both", n: 2, h: 0.4 };
  assert.ok(near(K.ease(both, 0.5), 0.5, 1e-9));
  assert.ok(near(K.ease(both, 0.25), 1 - K.ease(both, 0.75)));
});

test("ping-pong plays the shaped move back and forth after the last key, until the clip ends", () => {
  const step = 1 / 25;
  const keys = [{ t: 0, v: 0 }, { t: 1, v: 100 }];
  const r = K.plan([{ id: "x", keys }], { kind: "elastic", dir: "end", n: 2, over: 0.2 }, step, { repeat: { mode: "pingpong", times: 0 }, until: 3.5 });
  const add = r.props[0].add;
  assert.strictEqual(r.props[0].repeated, 50);                         // two whole repeats fit (1-2 back, 2-3 forth)
  const at = (t) => add.find((k) => Math.abs(k.t - t) < 1e-6).v;
  assert.ok(near(at(2), 0, 1e-6) && near(at(3), 100, 1e-6));          // back at the start, then at the end again
  assert.ok(near(at(1.6), K.valueAt(keys, { kind: "elastic", dir: "end", n: 2, over: 0.2 }, 0.4)));   // mirrored in time
  assert.ok(add.every((k) => k.t <= 3.5));
});

test("loop jumps back to the start in one frame and plays again; repeats need a curve", () => {
  const step = 1 / 25;
  const r = K.plan([{ id: "x", keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }], { p: [0, 0, 1, 1] }, step, { repeat: { mode: "loop", times: 2 } });
  const add = r.props[0].add.filter((k) => k.t > 1);
  assert.strictEqual(add.length, 50);
  assert.ok(near(add[0].t, 1 + step) && near(add[0].v, 0));
  assert.ok(near(add[24].t, 2) && near(add[24].v, 100));
  assert.match(K.plan([{ id: "x", keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }], { mode: "LINEAR" }, step, { repeat: { mode: "pingpong", times: 1 } }).error, /curves/);
});

test("the sampled path of a curve for the editor box", () => {
  const d = K.samplePath({ kind: "bounce", dir: "end", n: 2, h: 0.5 }, 100, 10, 4);
  assert.match(d, /^M 10\.0 90\.0 L /);
  assert.match(d, /L 90\.0 10\.0$/);
});
