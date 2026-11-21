// node --test tests/curvegraph.test.js
// The points-curve editor (panel/curvegraph.js, In & Out Phase 5 step 3): the Keyframer's point rules as pure functions, the one-time
// SVG build, and a run of the real mount() on a fake tree (no node is made or removed after the build: Premiere 26.5.3 crashed in its
// SVG painter in 0.10.130 when a drawing made nodes per frame).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const K = require("../panel/keyframeplan.js");
const C = require("../panel/curvegraph.js");

const src = fs.readFileSync(path.join(__dirname, "..", "panel", "curvegraph.js"), "utf8");
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

// ---------------------------------------------------------------- the pure rules
test("the limits are the Keyframer's own numbers", () => {
  assert.strictEqual(C.GRAB, 12);
  assert.strictEqual(C.POOL, K.MAX_POINTS);
  assert.strictEqual(C.POOL, 16);
  assert.strictEqual(C.GAP_ADD, 0.015);
  assert.strictEqual(C.GAP_MOVE, 0.012);
  assert.strictEqual(C.DOUBLE_MS, 350);
  assert.strictEqual(C.Y_MIN, -0.5);
  assert.strictEqual(C.Y_MAX, 1.5);
});

test("geometry: curve space and pixels map both ways", () => {
  const g = C.geometry(208, 120);
  for (const x of [0, 0.25, 0.5, 1]) near(g.tx(g.fx(x)), x);
  for (const y of [-0.5, 0, 0.3, 1, 1.5]) near(g.ty(g.fy(y)), y);
  near(g.fy(1.5), 0);                                    // the top of the drawing is y 1.5, the bottom y -0.5
  near(g.fy(-0.5), 120);
  near(g.fx(0), C.PAD_X);
  near(g.fx(1), 208 - C.PAD_X);
  assert.deepStrictEqual(g.frame, { x: C.PAD_X, y: 30, width: 208 - 2 * C.PAD_X, height: 60 });   // the unit square
  const big = C.geometry(400, 300);
  near(big.tx(big.fx(0.37)), 0.37);
  near(big.ty(big.fy(0.91)), 0.91);
});

test("nearest: within 12 px, the closest one wins, beyond it -1", () => {
  const g = C.geometry(208, 120);
  const pts = [[0.3, 0.2], [0.6, 0.8]];
  const at = (q) => [g.fx(q[0]), g.fy(q[1])];
  const [x0, y0] = at(pts[0]);
  assert.strictEqual(C.nearest(pts, x0, y0, g), 0);
  assert.strictEqual(C.nearest(pts, x0 + 11.9, y0, g), 0);
  assert.strictEqual(C.nearest(pts, x0, y0 - 11.9, g), 0);
  assert.strictEqual(C.nearest(pts, x0 + 12, y0, g), -1);                 // exactly 12 is out (the Keyframer's `e < d`)
  assert.strictEqual(C.nearest(pts, x0 + 30, y0 + 30, g), -1);
  const [x1, y1] = at(pts[1]);
  assert.strictEqual(C.nearest(pts, x1 - 5, y1 + 5, g), 1);
  const close = [[0.5, 0.5], [0.52, 0.5]];                                 // 0.02 * 184 = 3.7 px apart
  const px = g.fx(0.52) - 1;
  assert.strictEqual(C.nearest(close, px, g.fy(0.5), g), 1);
  assert.strictEqual(C.nearest([], 10, 10, g), -1);
});

test("add: sorted, clamped in y, one gap of 0.015, x inside (0.02, 0.98), at most 16", () => {
  const base = [[0.3, 0.2], [0.7, 0.9]];
  const frozen = JSON.stringify(base);
  const r = C.add(base, 0.5, 0.4);
  assert.deepStrictEqual(r, [[0.3, 0.2], [0.5, 0.4], [0.7, 0.9]]);
  assert.strictEqual(JSON.stringify(base), frozen);                       // the input is never changed
  assert.notStrictEqual(r, base);
  assert.deepStrictEqual(C.add(base, 0.1, 0.5)[0], [0.1, 0.5]);            // sorted to the front
  assert.deepStrictEqual(C.add(base, 0.9, 0.5)[2], [0.9, 0.5]);
  assert.deepStrictEqual(C.add(base, 0.5, 9)[1], [0.5, 1.5]);              // y clamped
  assert.deepStrictEqual(C.add(base, 0.5, -9)[1], [0.5, -0.5]);
  assert.strictEqual(C.add(base, 0.02, 0.5), base);                        // not at the ends (strictly inside)
  assert.strictEqual(C.add(base, 0.98, 0.5), base);
  assert.strictEqual(C.add(base, 0.0, 0.5), base);
  assert.strictEqual(C.add(base, 1.2, 0.5), base);
  assert.strictEqual(C.add(base, 0.3 + 0.0149, 0.5), base);                // too close to a neighbour
  assert.strictEqual(C.add(base, 0.3 - 0.0149, 0.5), base);
  assert.notStrictEqual(C.add(base, 0.3 + 0.0151, 0.5), base);
  assert.strictEqual(C.add(base, NaN, 0.5), base);
  const full = Array.from({ length: 16 }, (_, i) => [0.05 + i * 0.055, 0.5]);
  assert.ok(K.pointsOk(full));
  assert.strictEqual(C.add(full, 0.032, 0.5), full);                       // 16 is the most
  const fifteen = full.slice(0, 15);
  assert.strictEqual(C.add(fifteen, 0.95 - 0.001, 0.5).length, 16);
});

test("move: keeps 0.012 from the neighbours and inside 0.012..0.988, y clamped, a corner stays a corner", () => {
  const base = [[0.3, 0.2], [0.5, 0.5, 1], [0.7, 0.9]];
  const frozen = JSON.stringify(base);
  const r = C.move(base, 0, 0.35, 0.6);
  assert.deepStrictEqual(r[0], [0.35, 0.6]);
  assert.strictEqual(JSON.stringify(base), frozen);
  near(C.move(base, 0, 0.9, 0.2)[0][0], 0.5 - 0.012);                      // cannot pass its right neighbour
  near(C.move(base, 2, 0.1, 0.2)[2][0], 0.5 + 0.012);
  near(C.move(base, 0, -3, 0.2)[0][0], 0.012);                             // the first point stops 0.012 from the start
  near(C.move(base, 2, 7, 0.2)[2][0], 0.988);                              // the last 0.012 from the end
  assert.strictEqual(C.move(base, 0, 0.3, 9)[0][1], 1.5);
  assert.strictEqual(C.move(base, 0, 0.3, -9)[0][1], -0.5);
  assert.deepStrictEqual(C.move(base, 1, 0.55, 0.1)[1], [0.55, 0.1, 1]);   // still a corner
  assert.strictEqual(C.move(base, 5, 0.5, 0.5), base);
  assert.strictEqual(C.move(base, -1, 0.5, 0.5), base);
  assert.strictEqual(C.move(base, 0, NaN, 0.5), base);
  for (const x of [-1, 0, 0.2, 0.49, 0.5, 0.9, 2]) assert.ok(K.pointsOk(C.move(base, 0, x, 0.5)));
});

test("remove: one point out, the last one stays", () => {
  const base = [[0.3, 0.2], [0.7, 0.9]];
  const frozen = JSON.stringify(base);
  assert.deepStrictEqual(C.remove(base, 0), [[0.7, 0.9]]);
  assert.deepStrictEqual(C.remove(base, 1), [[0.3, 0.2]]);
  assert.strictEqual(JSON.stringify(base), frozen);
  const one = [[0.5, 0.5]];
  assert.strictEqual(C.remove(one, 0), one);                               // at least one point
  assert.strictEqual(C.remove(base, 2), base);
  assert.strictEqual(C.remove(base, -1), base);
});

test("corner: toggles the third element, sharp then smooth again", () => {
  const base = [[0.3, 0.2], [0.7, 0.9]];
  const frozen = JSON.stringify(base);
  const a = C.corner(base, 1);
  assert.deepStrictEqual(a, [[0.3, 0.2], [0.7, 0.9, 1]]);
  assert.strictEqual(JSON.stringify(base), frozen);
  assert.deepStrictEqual(C.corner(a, 1), base);
  assert.strictEqual(C.corner(base, 3), base);
  assert.ok(K.pointsOk(a));
});

test("every rule returns a sorted list that passes pointsOk, and never changes its input", () => {
  let pts = [[0.5, 0.5]];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 600; n++) {
    const before = JSON.stringify(pts);
    const pick = rnd();
    const i = Math.floor(rnd() * (pts.length + 1)) - (rnd() < 0.05 ? 3 : 0);
    const next = pick < 0.4 ? C.add(pts, rnd() * 1.2 - 0.1, rnd() * 3 - 1)
      : pick < 0.7 ? C.move(pts, i, rnd() * 1.4 - 0.2, rnd() * 4 - 1.5)
        : pick < 0.85 ? C.remove(pts, i) : C.corner(pts, i);
    assert.strictEqual(JSON.stringify(pts), before);
    assert.ok(K.pointsOk(next), JSON.stringify(next));
    assert.ok(next.length >= 1 && next.length <= 16);
    for (let k = 1; k < next.length; k++) assert.ok(next[k][0] > next[k - 1][0]);
    pts = next;
  }
});

// ---------------------------------------------------------------- the source
const body = (name) => {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  const end = src.indexOf("\n}\n", start);
  return { start, end: end + 3, text: src.slice(start, end + 3) };
};
const outsideBuild = () => {
  const b = body("build");
  return src.slice(0, b.start) + src.slice(b.end);
};
const code = (s) => s.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

test("source: nodes are made only inside the one build function", () => {
  assert.match(body("build").text, /createElementNS/);
  assert.doesNotMatch(code(outsideBuild()), /createElementNS|createElement\(|innerHTML|appendChild|insertBefore|cloneNode/);
  assert.strictEqual((src.match(/\bbuild\(host/g) || []).length, 2);        // its definition and the single call in mount()
});

test("source: nothing is removed, no timer runs", () => {
  assert.doesNotMatch(code(src), /removeChild|\.remove\(\)|replaceChild|replaceChildren|textContent\s*=\s*["']{2}|style\.display/);
  assert.doesNotMatch(code(src), /setTimeout|setInterval|requestAnimationFrame/);
});

test("source: the pointer is released by hand, and nothing else is needed from the page", () => {
  assert.match(src, /releasePointerCapture/);
  assert.match(src, /release\(svg, e\)/);
  assert.match(src, /addEventListener\("pointerup"/);
  assert.match(src, /addEventListener\("pointercancel"/);
  assert.match(src, /require\("\.\/keyframeplan\.js"\)/);
  assert.doesNotMatch(src, /require\("\.\/(premiere|engine|store)/);        // pure panel module: no Premiere, no engine
});

// ---------------------------------------------------------------- the DOM on a fake tree
function fakeDom() {
  const stats = { made: 0, removed: 0 };
  const node = (tag) => ({
    tag, children: [], attrs: {}, style: {}, handlers: {}, captured: [], released: [],
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() { stats.removed += 1; },
    get childNodes() { return this.children; },
    addEventListener(t, fn) { this.handlers[t] = fn; },
    setPointerCapture(id) { this.captured.push(id); },
    releasePointerCapture(id) { this.released.push(id); },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
  });
  const svg = node("svg");
  const frame = node("rect");
  const curve = node("path");
  const group = node("g");
  svg.children.push(frame, curve, group);
  const el = () => {
    const w = node("div");
    w.querySelector = (q) => (q === "svg" ? svg : q === "path" ? curve : group);
    return w;
  };
  const real = global.document;
  global.document = { createElementNS: (ns, tag) => { stats.made += 1; return node(tag); } };
  return { svg, curve, group, el, stats, restore: () => { global.document = real; } };
}

const visible = (n) => (n.tag === "circle" ? Number(n.attrs.r) > 0 : Number(n.attrs.width) > 0);
const down = (svg, x, y, extra) => svg.handlers.pointerdown({ clientX: x, clientY: y, pointerId: 1, timeStamp: 1000, ...extra });
const mv = (svg, x, y) => svg.handlers.pointermove({ clientX: x, clientY: y, pointerId: 1 });
const up = (svg) => svg.handlers.pointerup({ pointerId: 1 });

test("mount: 16 circles and 16 squares are made once; 20 set() calls change no node count", () => {
  const d = fakeDom();
  try {
    const ed = C.mount({ host: d.el(), el: d.el, width: 208, height: 120 });
    assert.strictEqual(d.stats.made, 32);
    const nodes = ed.info().nodes;
    assert.strictEqual(nodes, 1 + 3 + 32);
    assert.strictEqual(d.group.children.filter((n) => n.tag === "circle").length, 16);
    assert.strictEqual(d.group.children.filter((n) => n.tag === "rect").length, 16);
    for (let k = 0; k < 20; k++) {
      const count = 1 + (k % 16);
      const pts = Array.from({ length: count }, (_, i) => [(i + 1) / (count + 1), (i % 3) / 2, ...(i % 4 === 3 ? [1] : [])]);
      ed.set(pts, k % 2 === 0);
      assert.strictEqual(ed.info().nodes, nodes);
      assert.strictEqual(ed.info().points, count);
      assert.strictEqual(ed.info().shown, count);
      assert.strictEqual(d.group.children.filter(visible).length, count);   // the rest are hidden by r / width 0
      assert.strictEqual(ed.info().enabled, k % 2 === 0);
    }
    assert.strictEqual(d.stats.made, 32);
    assert.strictEqual(d.stats.removed, 0);
    assert.deepStrictEqual([ed.info().width, ed.info().height], [208, 120]);
    assert.match(d.curve.attrs.d, /^M /);
  } finally {
    d.restore();
  }
});

test("mount: a corner is drawn as a square, a smooth point as a circle", () => {
  const d = fakeDom();
  try {
    const ed = C.mount({ host: d.el(), el: d.el, width: 208, height: 120 });
    ed.set([[0.3, 0.2], [0.6, 0.7, 1]], true);
    const circles = d.group.children.filter((n) => n.tag === "circle" && visible(n));
    const squares = d.group.children.filter((n) => n.tag === "rect" && visible(n));
    assert.strictEqual(circles.length, 1);
    assert.strictEqual(squares.length, 1);
    assert.strictEqual(squares[0].attrs.width, "10");
  } finally {
    d.restore();
  }
});

test("mount: press adds, drag moves (true), release commits (false); the pointer is released by hand", () => {
  const d = fakeDom();
  try {
    const ed = C.mount({ host: d.el(), el: d.el, width: 208, height: 120 });
    const g = C.geometry(208, 120);
    const calls = [];
    ed.onChange((pts, dragging) => calls.push([pts, dragging]));
    ed.set([[0.5, 0.5]], true);
    assert.strictEqual(calls.length, 0);                                   // set() does not call back
    down(d.svg, g.fx(0.25), g.fy(0.8));                                    // empty place: a new point
    assert.strictEqual(ed.info().points, 2);
    assert.deepStrictEqual(calls.map((c) => c[1]), [false]);
    assert.strictEqual(d.svg.captured.length, 1);
    mv(d.svg, g.fx(0.3), g.fy(0.9));
    mv(d.svg, g.fx(0.35), g.fy(1.0));
    assert.deepStrictEqual(calls.map((c) => c[1]), [false, true, true]);
    up(d.svg);
    assert.deepStrictEqual(calls.map((c) => c[1]), [false, true, true, false]);
    assert.deepStrictEqual(d.svg.released, [1]);
    near(ed.get()[0][0], 0.35, 1e-6);
    near(ed.get()[0][1], 1.0, 1e-6);
    assert.ok(K.pointsOk(calls[calls.length - 1][0]));
    mv(d.svg, g.fx(0.1), g.fy(0.1));                                       // not dragging any more
    assert.strictEqual(calls.length, 4);
    // a plain press and release on a point changes nothing and reports nothing
    down(d.svg, g.fx(0.5), g.fy(0.5), { timeStamp: 5000 });
    up(d.svg);
    assert.strictEqual(calls.length, 4);
    assert.deepStrictEqual(d.svg.released, [1, 1]);
    assert.strictEqual(ed.info().nodes, 1 + 3 + 32);
    assert.strictEqual(d.stats.made, 32);
  } finally {
    d.restore();
  }
});

test("mount: a double press within 350 ms removes a point, a slow one does not; Alt toggles a corner", () => {
  const d = fakeDom();
  try {
    const ed = C.mount({ host: d.el(), el: d.el, width: 208, height: 120 });
    const g = C.geometry(208, 120);
    const calls = [];
    ed.onChange((pts, dragging) => calls.push(dragging));
    ed.set([[0.3, 0.3], [0.7, 0.7]], true);
    down(d.svg, g.fx(0.3), g.fy(0.3), { timeStamp: 1000 });
    up(d.svg);
    down(d.svg, g.fx(0.3), g.fy(0.3), { timeStamp: 1349 });
    assert.strictEqual(ed.info().points, 1);
    assert.deepStrictEqual(calls, [false]);
    up(d.svg);
    down(d.svg, g.fx(0.7), g.fy(0.7), { timeStamp: 3000 });                // the last point: two presses leave it
    up(d.svg);
    down(d.svg, g.fx(0.7), g.fy(0.7), { timeStamp: 3100 });
    assert.strictEqual(ed.info().points, 1);
    up(d.svg);
    ed.set([[0.3, 0.3], [0.7, 0.7]], true);
    down(d.svg, g.fx(0.3), g.fy(0.3), { timeStamp: 1000 });
    up(d.svg);
    down(d.svg, g.fx(0.3), g.fy(0.3), { timeStamp: 1350 });                // 350 ms is already too slow
    assert.strictEqual(ed.info().points, 2);
    up(d.svg);
    calls.length = 0;
    const grabbed = d.svg.captured.length;
    down(d.svg, g.fx(0.7), g.fy(0.7), { altKey: true, timeStamp: 9000 });
    assert.deepStrictEqual(ed.get()[1], [0.7, 0.7, 1]);
    assert.deepStrictEqual(calls, [false]);
    assert.strictEqual(d.svg.captured.length, grabbed);                    // Alt does not start a drag
  } finally {
    d.restore();
  }
});

test("mount: set(pts, false) shows the curve and ignores presses", () => {
  const d = fakeDom();
  try {
    const ed = C.mount({ host: d.el(), el: d.el, width: 208, height: 120 });
    const g = C.geometry(208, 120);
    let n = 0;
    ed.onChange(() => { n += 1; });
    ed.set([[0.3, 0.3], [0.7, 0.7]], false);
    down(d.svg, g.fx(0.5), g.fy(0.9));
    down(d.svg, g.fx(0.3), g.fy(0.3), { altKey: true });
    mv(d.svg, g.fx(0.4), g.fy(0.4));
    assert.strictEqual(n, 0);
    assert.deepStrictEqual(ed.get(), [[0.3, 0.3], [0.7, 0.7]]);
    assert.strictEqual(ed.info().enabled, false);
    assert.strictEqual(ed.info().shown, 2);
    ed.set([[2, 2]], true);                                                // not a legal curve: the default point, never a throw
    assert.deepStrictEqual(ed.get(), [[0.5, 0.5]]);
    const out = ed.get();
    out[0][0] = 0.9;
    assert.strictEqual(ed.get()[0][0], 0.5);                               // get() is a copy
  } finally {
    d.restore();
  }
});

test("mount: a move with no button down ends the drag; set() with the same points keeps it, new points end it", () => {
  const d = fakeDom();
  try {
    const ed = C.mount({ host: d.el(), el: d.el, width: 208, height: 120 });
    const g = C.geometry(208, 120);
    const calls = [];
    ed.set([[0.5, 0.5]], true);
    ed.onChange((pts, dragging) => { calls.push(dragging); ed.set(pts, true); });   // a page that hands the points straight back
    down(d.svg, g.fx(0.5), g.fy(0.5), { buttons: 1 });
    mv(d.svg, g.fx(0.5), g.fy(0.8));
    mv(d.svg, g.fx(0.5), g.fy(0.9));
    assert.deepStrictEqual(calls, [true, true], "the echo did not end the drag");
    assert.ok(Math.abs(ed.get()[0][1] - 0.9) < 0.02);
    // the release was missed: the next move arrives with no button
    d.svg.handlers.pointermove({ clientX: g.fx(0.5), clientY: g.fy(0.2), pointerId: 1, buttons: 0 });
    assert.deepStrictEqual(calls, [true, true, false], "the drag is closed once");
    assert.ok(Math.abs(ed.get()[0][1] - 0.9) < 0.02, "and the hover moved nothing");
    mv(d.svg, g.fx(0.5), g.fy(0.1));
    assert.strictEqual(calls.length, 3);
    // a host whose press shows no button (buttons 0 or missing) never loses a drag to that check
    down(d.svg, g.fx(0.5), g.fy(0.9), { timeStamp: 5000, buttons: 0 });
    d.svg.handlers.pointermove({ clientX: g.fx(0.5), clientY: g.fy(0.6), pointerId: 1, buttons: 0 });
    assert.ok(Math.abs(ed.get()[0][1] - 0.6) < 0.02, "still dragging");
    up(d.svg);
    assert.strictEqual(calls.length, 5);
    calls.length = 3;
    ed.set([[0.5, 0.9]], true);
    // new points from outside end a drag without a word
    down(d.svg, g.fx(0.5), g.fy(0.9), { timeStamp: 9000 });
    ed.set([[0.3, 0.3]], true);
    mv(d.svg, g.fx(0.3), g.fy(0.7));
    assert.deepStrictEqual(ed.get(), [[0.3, 0.3]]);
    assert.strictEqual(calls.length, 3);
  } finally {
    d.restore();
  }
});
