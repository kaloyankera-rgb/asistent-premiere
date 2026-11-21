// The In & Out preview's pure part (panel/inoutpreview.js): plan rows -> box values, the loop's timeline, the caption.
const test = require("node:test");
const assert = require("node:assert");
const P = require("../panel/inoutpreview.js");
const U = require("../panel/inoutui.js");
const I = require("../panel/inoutplan.js");

const opts = (over) => U.view({ ...U.restore({}), ...over }).opts;
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test("styleOf: rest is the centred box; offsets are frame fractions, exit sides are exit distances", () => {
  const rest = P.styleOf(P.REST, 1);
  assert.deepStrictEqual(rest, { x: P.W / 2, y: P.H / 2, w: P.BOX_W, h: P.BOX_H, rot: 0, opacity: 1 });
  const s = P.styleOf({ dx: -0.25, dy: 0.5, s: 2, r: 30, o: 0.4 }, 1);
  near(s.x, P.W / 2 - 0.25 * P.W);
  near(s.y, P.H / 2 + 0.5 * P.H);
  near(s.w, P.BOX_W * 2);
  assert.strictEqual(s.rot, 30);
  assert.strictEqual(s.opacity, 0.4);
  const d = P.exitOf("left");                              // the box fully off to the left: centre at -half width
  near(P.styleOf({ dx: -1, dy: 0, s: 1, r: 0, o: 1 }, d).x, -P.BOX_W / 2);
  assert.strictEqual(P.styleOf({ dx: 0.1, dy: 0, s: 1, r: 0, o: 1 }, NaN).x, P.W / 2 + 0.1 * P.W);   // no distance = plain fractions
});

test("corners: four points, a turn of 90 degrees swaps the box's width and height, clockwise", () => {
  const flat = P.corners({ x: 50, y: 50, w: 40, h: 20, rot: 0, opacity: 1 });
  assert.strictEqual(flat, "30.0,40.0 70.0,40.0 70.0,60.0 30.0,60.0");
  const turned = P.corners({ x: 50, y: 50, w: 40, h: 20, rot: 90, opacity: 1 }).split(" ");
  assert.strictEqual(turned.length, 4);
  assert.strictEqual(turned[0], "60.0,30.0");                // top-left went to top-right: clockwise on screen
});

test("both None: a resting box, no steps, nothing animated", () => {
  const b = P.build(opts({}));
  assert.strictEqual(b.animated, false);
  assert.deepStrictEqual(b.steps, []);
  assert.deepStrictEqual(b.rest, P.styleOf(P.REST, 1));
  assert.strictEqual(b.error, null);
  assert.strictEqual(P.build(null).animated, false);
});

test("the loop: In, hold, Out, pause (lengths from the plan, not from a guess)", () => {
  const o = opts({ inPreset: "slide", outPreset: "fade" });
  const b = P.build(o);
  const nIn = I.defaultFrames("in", "slide");
  const nOut = I.defaultFrames("out", "fade");
  assert.strictEqual(b.animated, true);
  assert.deepStrictEqual(b.lens, { in: nIn + 1, hold: P.HOLD, out: nOut + 1, pause: P.PAUSE });
  assert.strictEqual(b.steps.length, nIn + 1 + P.HOLD + nOut + 1 + P.PAUSE);
  assert.deepStrictEqual(b.steps.map((s) => s.kind).filter((k, i, a) => i === 0 || k !== a[i - 1]), ["in", "hold", "out", "pause"]);
  assert.deepStrictEqual(b.steps[nIn + 1].style, b.rest);   // the hold is the resting box
  assert.deepStrictEqual(b.steps[nIn].style, b.rest);       // In ends at rest
  assert.deepStrictEqual(b.steps[b.steps.length - 1].style, b.steps[b.steps.length - 1 - P.PAUSE].style); // the pause holds the last picture
  assert.strictEqual(b.fps, P.FPS);
});

test("one side only: In then hold then pause; hold then Out then pause", () => {
  const a = P.build(opts({ inPreset: "pop" }));
  assert.deepStrictEqual(a.lens, { in: I.defaultFrames("in", "pop") + 1, hold: P.HOLD, out: 0, pause: P.PAUSE });
  const c = P.build(opts({ outPreset: "shrink" }));
  assert.deepStrictEqual(c.lens, { in: 0, hold: P.HOLD, out: I.defaultFrames("out", "shrink") + 1, pause: P.PAUSE });
  assert.strictEqual(c.steps[0].kind, "hold");
  assert.deepStrictEqual(c.steps[0].style, c.rest);
  assert.strictEqual(c.steps[c.steps.length - 1 - P.PAUSE].style.w < c.rest.w, true);   // Shrink ends small
});

test("typed frames set the lengths", () => {
  const b = P.build(opts({ inPreset: "slide", inFrames: 6, outPreset: "slide", outFrames: 30 }));
  assert.strictEqual(b.lens.in, 7);
  assert.strictEqual(b.lens.out, 31);
});

test("a directional preset: Slide In from the left starts off the frame on the left and ends at rest; the edge changes it", () => {
  const left = P.build(opts({ inPreset: "slide", direction: "left" }));
  const first = left.steps[0].style;
  assert.ok(first.x + first.w / 2 <= 0 + 1e-6, "the box starts fully off the left edge");
  near(first.y, P.H / 2);
  const top = P.build(opts({ inPreset: "slide", direction: "top" })).steps[0].style;
  assert.ok(top.y + top.h / 2 <= 1e-6, "from the top it starts above the frame");
  near(top.x, P.W / 2);
  const right = P.build(opts({ inPreset: "slide", direction: "right" })).steps[0].style;
  assert.ok(right.x - right.w / 2 >= P.W - 1e-6, "from the right it starts right of the frame");
  assert.deepStrictEqual(left.steps[I.defaultFrames("in", "slide")].style, left.rest);
});

test("Out Slide to the right ends fully off the frame", () => {
  const b = P.build(opts({ outPreset: "slide", direction: "right" }));
  const end = b.steps[b.steps.length - 1].style;
  assert.ok(end.x - end.w / 2 >= P.W - 1e-6);
});

test("a rotating preset: Spin In turns clockwise or counter-clockwise by the page's Turn, ending at 0", () => {
  const cw = P.build(opts({ inPreset: "spinIn", turn: "cw" }));
  const ccw = P.build(opts({ inPreset: "spinIn", turn: "ccw" }));
  assert.ok(cw.steps[0].style.rot !== 0);
  near(cw.steps[0].style.rot, -ccw.steps[0].style.rot);
  near(cw.steps[I.defaultFrames("in", "spinIn")].style.rot, 0);
  assert.ok(cw.steps.some((s) => Math.abs(s.style.rot) > 90));
});

test("Strength changes the result where it applies (Glide moves less, Pop starts smaller or larger)", () => {
  const glide = (strength) => P.build(opts({ inPreset: "glide", strength })).steps[0].style.x;
  assert.ok(Math.abs(glide(50) - P.W / 2) < Math.abs(glide(150) - P.W / 2));
  const pop = (strength) => P.build(opts({ inPreset: "pop", strength })).steps[0].style.w;
  assert.notStrictEqual(pop(50), pop(150));
  // and where it does not (Slide travels fully off the frame whatever the strength)
  const slide = (strength) => P.build(opts({ inPreset: "slide", strength })).steps[0].style.x;
  near(slide(50), slide(150));
});

test("opacity presets drive opacity, not the box's place", () => {
  const b = P.build(opts({ inPreset: "fade" }));
  assert.strictEqual(b.steps[0].style.opacity, 0);
  near(b.steps[0].style.x, P.W / 2);
  assert.strictEqual(b.steps[I.defaultFrames("in", "fade")].style.opacity, 1);
});

test("every preset of both sides builds a finite loop that rests where it should", () => {
  for (const side of ["in", "out"]) {
    for (const pr of side === "in" ? I.IN_PRESETS : I.OUT_PRESETS) {
      const b = P.build(opts(side === "in" ? { inPreset: pr.id } : { outPreset: pr.id }));
      assert.strictEqual(b.error, null, `${side} ${pr.id}`);
      for (const s of b.steps) assert.ok(Object.values(s.style).every(Number.isFinite), `${side} ${pr.id}`);
      assert.deepStrictEqual(b.steps[side === "in" ? b.lens.in : 0].style, b.rest, `${side} ${pr.id} rests`);
    }
  }
});

test("a plan error (too many keys) shows the resting box and says why", () => {
  const o = opts({ inPreset: "twistPop", inFrames: 1000, outPreset: "twistShrink", outFrames: 1000 });
  const b = P.build(o);
  assert.strictEqual(b.animated, false);
  assert.ok(b.error);
  const cap = P.caption(U.view({ ...U.restore({}), inPreset: "twistPop", inFrames: 1000, outPreset: "twistShrink", outFrames: 1000 }), b);
  assert.match(cap.tip, /Not previewed/);
});

test("caption: nothing picked, one side, both", () => {
  const v = (s) => U.view({ ...U.restore({}), ...s });
  assert.strictEqual(P.caption(v({}), P.build(v({}).opts)).text, "Nothing picked");
  const both = v({ inPreset: "slide", outPreset: "fade" });
  const c = P.caption(both, P.build(both.opts));
  assert.strictEqual(c.text, "In Slide · Out Fade");
  assert.match(c.tip, /In Slide, 12 frames; Out Fade, 10 frames/);
  assert.strictEqual(P.caption(v({ outPreset: "shrink" }), P.build(v({ outPreset: "shrink" }).opts)).text, "Out Shrink");
});

// 0.10.131: Premiere 26.5.3 crashed in its SVG painter (2026-11-21 18:18:44) when the loop removed the box and made a new one
// every frame. The shapes are made once and only their attributes change; this runs the real mount on a fake tree.
test("the running preview never removes or creates an SVG node after it is built", () => {
  let made = 0;
  let removed = 0;
  const node = () => ({
    children: [], attrs: {}, style: {},
    setAttribute(k, x) { this.attrs[k] = x; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() { removed += 1; },
    get firstChild() { return this.children[0]; },
    get childNodes() { return this.children; },
    set innerHTML(x) { /* the svg shell */ },
  });
  const back = node();
  const objs = node();
  const fill = node();
  const el = () => Object.assign(node(), { querySelector: (q) => (q === "#ioPvBack" ? back : q === "#ioPvObj" ? objs : fill) });
  const real = { document: global.document, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  let queued = null;
  global.document = { createElementNS: () => { made += 1; return node(); } };
  global.setTimeout = (fn) => { queued = fn; return 1; };
  global.clearTimeout = () => { queued = null; };
  try {
    const pv = P.mount({ host: node(), el, visible: () => true });
    assert.strictEqual(made, 2);                                   // the rest outline and the box
    const view = (over) => U.view({ ...U.restore({}), ...over });
    pv.set(view({ inPreset: "slide", outPreset: "fade" }));
    const seen = new Set();
    for (let i = 0; i < 400 && queued; i += 1) {
      const fn = queued;
      queued = null;
      fn();
      seen.add(objs.children[0].attrs.points);
    }
    assert.ok(seen.size > 5, "the box moves");
    pv.set(view({ inPreset: "pop" }));
    pv.set(view({}));                                              // both None: resting box
    assert.strictEqual(objs.children[0].attrs.points, P.corners(P.styleOf(P.REST, 1)));
    assert.strictEqual(made, 2);
    assert.strictEqual(removed, 0);
    assert.strictEqual(objs.children.length, 1);
    assert.strictEqual(back.children.length, 1);
    assert.strictEqual(pv.info().playing, false);
  } finally {
    Object.assign(global, real);
  }
});

test("caption: while the pointer rests on a tile it says Preview first (nothing picked stays as it is)", () => {
  const v = U.view({ ...U.restore({}), inPreset: "elastic" });
  assert.strictEqual(P.caption(v, P.build(v.opts), true).text, "Preview: In Elastic");
  assert.strictEqual(P.caption(v, P.build(v.opts), false).text, "In Elastic");
  const none = U.view(U.restore({}));
  assert.strictEqual(P.caption(none, P.build(none.opts), true).text, "Nothing picked");
});
