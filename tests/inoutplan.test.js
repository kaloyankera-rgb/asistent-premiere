// node --test tests/inoutplan.test.js
const test = require("node:test");
const assert = require("node:assert");
const I = require("../panel/inoutplan.js");
const K = require("../panel/keyframeplan.js");
const B = require("../panel/blurplan.js");

const CLIP = { frames: 100 };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const go = (o) => I.plan(Object.assign({ clip: CLIP }, o));
const ins = (id, o) => go(Object.assign({ inPreset: id }, o)).in;
const outs = (id, o) => go(Object.assign({ outPreset: id }, o)).out;
const sign = (v) => (Math.abs(v) < 1e-9 ? 0 : Math.sign(v));
const crossings = (vals) => {                       // how often the values pass from one side of rest (0) to the other
  let n = 0;
  let last = 0;
  for (const v of vals) {
    const s = sign(v);
    if (s && last && s !== last) n++;
    if (s) last = s;
  }
  return n;
};

test("the two tables are separate, ids are unique inside each, and rows have the documented shape", () => {
  assert.notStrictEqual(I.IN_PRESETS, I.OUT_PRESETS);
  for (const [name, table] of [["in", I.IN_PRESETS], ["out", I.OUT_PRESETS]]) {
    const ids = table.map((p) => p.id);
    assert.strictEqual(new Set(ids).size, ids.length, `${name} ids are unique`);
    for (const p of table) {
      assert.ok(p.name && I.GROUPS.some((g) => g.id === p.group), `${name}/${p.id} group`);
      assert.ok(Number.isInteger(p.frames) && p.frames >= 1, `${name}/${p.id} default frames`);
      assert.ok(p.props.length >= 1 && p.props.every((x) => I.PROP_NAMES.includes(x.prop)));
      assert.ok(I.animates(p).length >= 1);
    }
  }
  assert.deepStrictEqual(I.IN_PRESETS.map((p) => p.name), ["Slide", "Glide", "Whip", "Overshoot", "Elastic", "Bounce", "Drop",
    "Pop", "Pop Soft", "Pop Elastic", "Pop Bounce", "Slam", "Zoom In", "Spin In", "Swing", "Twist Pop", "Roll In", "Fade", "Slide Fade", "Pop Fade"]);
  assert.deepStrictEqual(I.OUT_PRESETS.map((p) => p.name), ["Slide", "Whip", "Anticipate", "Drop", "Shrink", "Pop Out", "Zoom Out",
    "Spin Out", "Twist Shrink", "Roll Out", "Swing Out", "Fade", "Slide Fade"]);
});

test("groups come in display order and the helpers answer for the page", () => {
  assert.deepStrictEqual(I.groups("in").map((g) => g.id), ["pos", "scale", "rot", "op"]);
  assert.deepStrictEqual(I.groups("out").map((g) => g.name), ["Position", "Scale", "Rotation", "Opacity"]);
  assert.strictEqual(I.groups("in").reduce((n, g) => n + g.presets.length, 0), I.IN_PRESETS.length);
  assert.deepStrictEqual(I.animates(I.find("in", "twistPop")), ["scale", "rot"]);
  assert.deepStrictEqual(I.animates(I.find("in", "slideFade")), ["pos", "op"]);
  assert.deepStrictEqual(I.needs(I.find("in", "slide")), { direction: true, turn: false, strength: false });
  assert.deepStrictEqual(I.needs(I.find("in", "spinIn")), { direction: false, turn: true, strength: true });
  assert.deepStrictEqual(I.needs(I.find("in", "drop")), { direction: false, turn: false, strength: true });
  assert.strictEqual(I.defaultFrames("out", "anticipate"), 16);
  assert.strictEqual(I.defaultFrames("in", "nope"), null);
});

test("every preset in both tables gives finite rows, one per frame, in the allowed ranges", () => {
  for (const side of ["in", "out"]) {
    for (const p of side === "in" ? I.IN_PRESETS : I.OUT_PRESETS) {
      for (const dir of I.DIRECTIONS) {
        for (const turn of I.TURNS) {
          const r = go(side === "in" ? { inPreset: p.id, direction: dir, turn } : { outPreset: p.id, direction: dir, turn });
          assert.ifError(r.error);
          const rows = r[side];
          assert.strictEqual(rows.length, p.frames + 1, `${side}/${p.id} one row per frame`);
          assert.strictEqual(r.frames[side], p.frames);
          rows.forEach((row, i) => {
            assert.deepStrictEqual(Object.keys(row), ["f", "dx", "dy", "s", "r", "o"]);
            assert.ok(Object.values(row).every(Number.isFinite), `${side}/${p.id} finite`);
            assert.ok(row.s >= I.SCALE_MIN && row.s <= I.SCALE_MAX && row.o >= 0 && row.o <= 1);
            if (i) assert.strictEqual(row.f, rows[i - 1].f + 1, "consecutive frames");
          });
        }
      }
    }
  }
});

test("In starts on the clip's first frame and ends exactly at rest, Out starts at rest and ends on the last frame", () => {
  for (const p of I.IN_PRESETS) {
    const rows = ins(p.id);
    assert.strictEqual(rows[0].f, 0);
    assert.deepStrictEqual(rows[rows.length - 1], { f: p.frames, dx: 0, dy: 0, s: 1, r: 0, o: 1 }, `In ${p.id} rests`);
    assert.ok(Object.is(rows[rows.length - 1].dx, 0), "no negative zero");
    const first = rows[0];
    assert.ok(first.dx !== 0 || first.dy !== 0 || first.s !== 1 || first.r !== 0 || first.o !== 1, `In ${p.id} starts away from rest`);
  }
  for (const p of I.OUT_PRESETS) {
    const rows = outs(p.id);
    assert.deepStrictEqual(rows[0], { f: 100 - 1 - p.frames, dx: 0, dy: 0, s: 1, r: 0, o: 1 }, `Out ${p.id} starts at rest`);
    assert.strictEqual(rows[rows.length - 1].f, 99);
    const last = rows[rows.length - 1];
    assert.ok(last.dx !== 0 || last.dy !== 0 || last.s !== 1 || last.r !== 0 || last.o !== 1, `Out ${p.id} ends away from rest`);
  }
});

test("only the animated properties leave rest, and exit presets say so", () => {
  for (const [side, table] of [["in", I.IN_PRESETS], ["out", I.OUT_PRESETS]]) {
    for (const p of table) {
      const r = go(side === "in" ? { inPreset: p.id } : { outPreset: p.id });
      const props = r.props[side];
      assert.deepStrictEqual(props, I.animates(p));
      for (const row of r[side]) {
        if (!props.includes("pos")) assert.ok(row.dx === 0 && row.dy === 0);
        if (!props.includes("scale")) assert.strictEqual(row.s, 1);
        if (!props.includes("rot")) assert.strictEqual(row.r, 0);
        if (!props.includes("op")) assert.strictEqual(row.o, 1);
      }
    }
  }
  assert.strictEqual(go({ inPreset: "slide" }).exit.in, true);
  assert.strictEqual(go({ inPreset: "glide" }).exit.in, false);
  assert.strictEqual(go({ outPreset: "fade" }).exit.out, false);
  const slide = ins("slide", { direction: "left" });
  assert.strictEqual(slide[0].dx, -1, "an exit anchor is exactly one exit distance");
});

test("Overshoot goes past rest and settles; Elastic crosses rest more than once; Bounce never passes rest", () => {
  const over = ins("overshoot", { direction: "left" }).map((r) => r.dx);   // from the left: negative before arriving, positive past rest
  assert.ok(Math.max(...over) > 0.03, "passes rest");
  assert.ok(near(over[over.length - 1], 0));
  const peak = over.indexOf(Math.max(...over));
  assert.ok(over.slice(peak).every((v, i, a) => !i || v <= a[i - 1] + 1e-9), "then settles back");

  const el = ins("elastic", { direction: "left" }).map((r) => r.dx);
  assert.ok(crossings(el) >= 2, `elastic crosses rest ${crossings(el)} times`);

  const bo = ins("bounce", { direction: "left" }).map((r) => r.dx);
  assert.ok(bo.every((v) => v <= 1e-9), "never past rest (never positive when coming from the left)");
  assert.ok(bo.slice(1).some((v, i) => v > bo[i] + 1e-6) && bo.slice(1).some((v, i) => v < bo[i] - 1e-6), "it does hop");
  const popB = ins("popBounce").map((r) => r.s);
  assert.ok(popB.every((v) => v <= 1 + 1e-9));
  assert.ok(Math.max(...ins("pop").map((r) => r.s)) > 1.02, "Pop overshoots");
  assert.ok(Math.max(...ins("popSoft").map((r) => r.s)) <= 1 + 1e-9, "Pop Soft does not");
  assert.ok(crossings(ins("popElastic").map((r) => r.s - 1)) >= 2);
});

test("Fade is monotonic and Slam / Slide come in with the shape of their curve", () => {
  const fi = ins("fade").map((r) => r.o);
  assert.ok(fi.every((v, i) => !i || v >= fi[i - 1]) && fi[0] === 0 && fi[fi.length - 1] === 1);
  const fo = outs("fade").map((r) => r.o);
  assert.ok(fo.every((v, i) => !i || v <= fo[i - 1]) && fo[0] === 1 && fo[fo.length - 1] === 0);
  const slam = ins("slam").map((r) => r.s);
  assert.ok(slam.every((v, i) => !i || v <= slam[i - 1]) && slam[0] > 2);
  const d = slam.map((v, i) => (i ? slam[i - 1] - v : 0));
  assert.ok(d[d.length - 1] > d[1], "a hard stop: fastest at the end");
  const sl = ins("slide", { direction: "left" }).map((r) => -r.dx);
  const sd = sl.map((v, i) => (i ? sl[i - 1] - v : 0));
  assert.ok(sd[1] > sd[sd.length - 1], "Slide eases out: fastest at the start");
});

test("Anticipate moves backward first, then out; Pop Out grows first, then collapses", () => {
  const rows = outs("anticipate", { direction: "left" });
  assert.ok(rows[1].dx > 0 && rows[3].dx > 0, "back towards the right when leaving to the left");
  assert.ok(rows.slice(0, 8).some((r) => r.dx > 0.05));
  assert.ok(near(rows[rows.length - 1].dx, -1), "ends fully off to the left");
  const min = Math.min(...rows.map((r) => r.dx));
  assert.strictEqual(min, rows[rows.length - 1].dx, "no wobble back on the way out");
  const pop = outs("popOut").map((r) => r.s);
  assert.ok(Math.max(...pop) > 1.05 && pop.indexOf(Math.max(...pop)) > 0 && pop.indexOf(Math.max(...pop)) < pop.length - 3);
  assert.ok(pop[pop.length - 1] < 0.01 && pop[pop.length - 1] >= I.SCALE_MIN);
  assert.ok(outs("zoomOut").every((r) => r.s >= 1) && outs("zoomOut").slice(-1)[0].o === 0);
});

test("direction picks the edge and flips the signs", () => {
  const first = (id, direction) => ins(id, { direction })[0];
  assert.deepStrictEqual([first("slide", "left").dx, first("slide", "left").dy], [-1, 0]);
  assert.deepStrictEqual([first("slide", "right").dx, first("slide", "right").dy], [1, 0]);
  assert.deepStrictEqual([first("slide", "top").dx, first("slide", "top").dy], [0, -1]);
  assert.deepStrictEqual([first("slide", "bottom").dx, first("slide", "bottom").dy], [0, 1]);
  const last = (d) => outs("slide", { direction: d }).slice(-1)[0];
  assert.deepStrictEqual([last("left").dx, last("right").dx, last("top").dy, last("bottom").dy], [-1, 1, -1, 1]);
  // Drop falls from the top in and to the bottom out, whatever the direction
  assert.strictEqual(ins("drop", { direction: "right" })[0].dy, -1);
  assert.strictEqual(outs("drop", { direction: "right" }).slice(-1)[0].dy, 1);
  assert.strictEqual(ins("drop", { direction: "right" })[0].dx, 0);
});

test("turn flips the rotation, a roll follows its travel instead", () => {
  const cw = ins("spinIn", { turn: "cw" });
  const ccw = ins("spinIn", { turn: "ccw" });
  assert.strictEqual(cw[0].r, -360);
  assert.strictEqual(ccw[0].r, 360);
  assert.ok(cw.every((r, i) => near(r.r, -ccw[i].r)));
  assert.ok(outs("spinOut", { turn: "cw" }).slice(-1)[0].r === 360 && outs("spinOut", { turn: "ccw" }).slice(-1)[0].r === -360);
  assert.ok(ins("swing", { turn: "cw" })[0].r < 0 && ins("swing", { turn: "ccw" })[0].r > 0);
  assert.ok(ins("twistPop", { turn: "ccw" })[0].r > 0);
  // roll in from the left moves right: clockwise (angle rises to 0); from the right: counter-clockwise; turn is ignored
  assert.ok(ins("rollIn", { direction: "left", turn: "ccw" })[0].r < 0);
  assert.ok(ins("rollIn", { direction: "right", turn: "cw" })[0].r > 0);
  assert.ok(outs("rollOut", { direction: "right" }).slice(-1)[0].r > 0);
  assert.ok(outs("rollOut", { direction: "left" }).slice(-1)[0].r < 0);
});

test("strength scales travel, overshoot, scale range and rotation, and is kept in range", () => {
  const glide = (s) => ins("glide", { direction: "left", strength: s })[0].dx;
  assert.ok(near(glide(100), -0.25) && near(glide(200), -0.5) && near(glide(50), -0.125));
  const pop = (s) => ins("pop", { strength: s })[0].s;
  assert.ok(near(pop(100), 0.6) && near(pop(50), 0.8));
  const spin = (s) => ins("spinIn", { strength: s })[0].r;
  assert.ok(near(spin(50), -180) && near(spin(200), -720));
  // opacity and a scale of 0 are always reached in full: Strength never leaves a fade half done or a shrink at 50 %
  for (const st of [25, 50, 200]) {
    assert.strictEqual(ins("fade", { strength: st })[0].o, 0);
    assert.strictEqual(outs("fade", { strength: st }).slice(-1)[0].o, 0);
    assert.strictEqual(outs("shrink", { strength: st }).slice(-1)[0].s, I.SCALE_MIN);
    assert.strictEqual(ins("zoomIn", { strength: st })[0].s, I.SCALE_MIN);
    assert.strictEqual(outs("popOut", { strength: st }).slice(-1)[0].s, I.SCALE_MIN);
  }
  const fadeRows = (st) => JSON.stringify(ins("fade", { strength: st }));
  assert.strictEqual(fadeRows(50), fadeRows(200), "a plain fade ignores Strength");
  assert.ok(near(ins("slideFade", { strength: 50 })[0].dx, -0.075) && ins("slideFade", { strength: 50 })[0].o === 0, "its slide scales, its fade does not");
  const bump = (st) => Math.max(...outs("popOut", { strength: st }).map((r) => r.s));
  assert.ok(near(bump(50), 1.06, 0.01) && bump(200) > bump(100), "Pop Out's bump still scales");
  // an exit anchor stays fully off screen at any strength; the overshoot after it is what scales
  assert.strictEqual(ins("overshoot", { direction: "left", strength: 50 })[0].dx, -1);
  const peak = (s) => Math.max(...ins("overshoot", { direction: "left", strength: s }).map((r) => r.dx));
  assert.ok(peak(50) > 0 && near(peak(50), peak(100) / 2, 0.02) && peak(200) > peak(100));
  assert.ok(Math.min(...outs("anticipate", { direction: "right", strength: 50 }).map((r) => r.dx)) > Math.min(...outs("anticipate", { direction: "right" }).map((r) => r.dx)) - 1e-9);
  // clamps
  assert.ok(near(glide(1), glide(I.STRENGTH_MIN)) && near(glide(9999), glide(I.STRENGTH_MAX)));
  assert.strictEqual(go({ inPreset: "pop", strength: 0 }).error, undefined);
});

test("Strength changes the hops of Bounce and Drop, row 0 stays put", () => {
  const depth = (rows, key) => Math.max(...rows.slice(Math.ceil(rows.length / 3)).map((r) => Math.abs(r[key])));
  for (const [id, key, o] of [["bounce", "dx", { direction: "left" }], ["drop", "dy", {}]]) {
    const at = (st) => ins(id, Object.assign({ strength: st }, o));
    const [lo, mid, hi] = [at(50), at(100), at(200)];
    assert.ok(depth(lo, key) < depth(mid, key) && depth(mid, key) < depth(hi, key), `${id} hops grow with strength`);
    assert.strictEqual(lo[0][key], mid[0][key]);
    assert.strictEqual(hi[0][key], mid[0][key]);
    assert.ok(hi.every((r) => r[key] * mid[0][key] >= -1e-9), `${id} still never passes rest`);
    assert.deepStrictEqual(hi[hi.length - 1], { f: hi.length - 1, dx: 0, dy: 0, s: 1, r: 0, o: 1 });
  }
});

test("needs().strength is false exactly when Strength gives identical rows", () => {
  const off = [];
  for (const side of ["in", "out"]) {
    for (const p of side === "in" ? I.IN_PRESETS : I.OUT_PRESETS) {
      const mk = (st) => JSON.stringify(go(side === "in" ? { inPreset: p.id, strength: st } : { outPreset: p.id, strength: st })[side]);
      assert.strictEqual(I.needs(p).strength, mk(50) !== mk(200), `${side}/${p.id}`);
      if (!I.needs(p).strength) off.push(`${side}/${p.id}`);
    }
  }
  assert.deepStrictEqual(off.sort(), ["in/fade", "in/slide", "in/whip", "in/zoomIn", "out/drop", "out/fade", "out/shrink", "out/slide", "out/whip"]);
});

test("scale is clamped: never above blurplan's limit, never exactly zero", () => {
  assert.strictEqual(I.SCALE_MAX, B.SCALE_MAX / 100);
  const slam = ins("slam", { strength: 200 }).map((r) => r.s);        // 2.2 -> 1 + 1.2 * 2 = 3.4 (inside) ...
  assert.ok(Math.max(...slam) <= I.SCALE_MAX);
  const zoom = outs("zoomOut", { strength: 200 }).map((r) => r.s);    // 1.8 -> 2.6
  assert.ok(Math.max(...zoom) <= I.SCALE_MAX);
  // a table row that asks for more is cut at the limit
  const real = I.IN_PRESETS.find((p) => p.id === "slam");
  const saved = real.props[0].from;
  try {
    real.props[0].from = 9;
    assert.ok(Math.max(...ins("slam").map((r) => r.s)) === I.SCALE_MAX);
  } finally { real.props[0].from = saved; }
  const z = ins("zoomIn");
  assert.ok(z[0].s === I.SCALE_MIN && z[0].s > 0);
});

test("In plus Out longer than the clip are shortened in proportion", () => {
  const r = I.plan({ clip: { frames: 21 }, inPreset: "slide", outPreset: "slide", inFrames: 30, outFrames: 10 });   // 40 asked, 20 fit
  assert.ifError(r.error);
  assert.strictEqual(r.frames.shortened, true);
  assert.deepStrictEqual([r.frames.in, r.frames.out], [15, 5]);
  assert.strictEqual(r.in[r.in.length - 1].f, 15);
  assert.strictEqual(r.out[0].f, 15, "they meet, never overlap");
  assert.strictEqual(r.out[r.out.length - 1].f, 20);
  const tiny = I.plan({ clip: { frames: 3 }, inPreset: "fade", outPreset: "fade", inFrames: 50, outFrames: 1 });
  assert.deepStrictEqual([tiny.frames.in, tiny.frames.out, tiny.frames.shortened], [1, 1, true]);
  assert.ok(tiny.in[tiny.in.length - 1].f <= tiny.out[0].f);
  const fits = I.plan({ clip: { frames: 100 }, inPreset: "fade", outPreset: "fade", inFrames: 10, outFrames: 10 });
  assert.strictEqual(fits.frames.shortened, false);
  assert.ok(I.plan({ clip: { frames: 2 }, inPreset: "fade", outPreset: "fade" }).error, "2 frames cannot carry both");
  const one = I.plan({ clip: { frames: 6 }, inPreset: "slide", inFrames: 50 });          // one side alone is cut to the clip
  assert.deepStrictEqual([one.frames.in, one.frames.shortened], [5, true]);
});

test("when In and Out meet on one frame there are no pins between them and the frame is counted once", () => {
  const r = I.plan({ clip: { frames: 3 }, inPreset: "fade", outPreset: "fade" });
  assert.deepStrictEqual([r.frames.in, r.frames.out, r.frames.meet, r.frames.shortened], [1, 1, true, true]);
  assert.strictEqual(r.in[r.in.length - 1].f, r.out[0].f);
  assert.deepStrictEqual(r.pins.map((p) => [p.side, p.like]), [["in", 0], ["out", 2]]);
  assert.ok(r.pins[0].f < 0 && r.pins[1].f > 2);
  assert.strictEqual(r.total, 2 + 2 + 2 - 1, "rows + pins, the shared fade key once");
  // different properties at the meeting frame are separate keys
  const m = I.plan({ clip: { frames: 3 }, inPreset: "slide", outPreset: "fade" });
  assert.strictEqual(m.total, (2 + 1) * 1 + (2 + 1) * 1, "In: 2 rows + start pin; Out: 2 rows + end pin; no shared prop");
  const apart = I.plan({ clip: { frames: 100 }, inPreset: "fade", outPreset: "fade", inFrames: 5, outFrames: 5 });
  assert.strictEqual(apart.frames.meet, false);
  assert.strictEqual(apart.pins.length, 4);
  // `like` is a frame number for both sides: the row whose f equals it exists
  for (const p of apart.pins) assert.ok([...apart.in, ...apart.out].some((row) => row.f === p.like));
  assert.deepStrictEqual(apart.pins.map((p) => p.like), [0, 5, 94, 99]);
});

test("In only, Out only and Both; null and \"none\" mean no animation", () => {
  const a = go({ inPreset: "fade", outPreset: null });
  assert.ok(a.in.length && a.out.length === 0 && a.frames.out === 0);
  const b = go({ inPreset: "none", outPreset: "fade" });
  assert.ok(b.out.length && b.in.length === 0 && b.frames.in === 0);
  const c = go({ inPreset: "fade", outPreset: "fade", inFrames: 6, outFrames: 8 });
  assert.deepStrictEqual([c.in.length, c.out.length], [7, 9]);
  assert.deepStrictEqual([c.frames.in, c.frames.out, c.frames.shortened], [6, 8, false]);
  assert.deepStrictEqual(c.pins.map((p) => p.side), ["in", "in", "out", "out"]);
  assert.deepStrictEqual(c.pins.map((p) => p.like), [0, 6, 100 - 1 - 8, 99]);
  assert.ok(c.pins[0].f === -I.PIN && near(c.pins[1].f, 6 + I.PIN) && near(c.pins[3].f, 99 + I.PIN));
  assert.strictEqual(go({ inPreset: "fade", inFrames: 3 }).pins.length, 2);
  assert.ok(go({}).error && go({ inPreset: "none", outPreset: null }).error);
  // total = every key Phase 2 would write: rows and pins once per animated property
  assert.strictEqual(go({ inPreset: "slideFade", inFrames: 10 }).total, (11 + 2) * 2);
  assert.strictEqual(c.total, (7 + 2) * 1 + (9 + 2) * 1);
});

test("a baked animation is the keyframeplan curve, one value per frame", () => {
  const n = 12;
  const rows = ins("pop", { inFrames: n });
  const prog = K.bake([{ t: 0, v: 0 }, { t: n, v: 1 }], K.PRESETS.find((c) => c.id === "overshoot").p, 1).add.map((x) => x.v);
  prog.forEach((p, i) => assert.ok(near(rows[i + 1].s, 0.6 + 0.4 * p)));
});

test("the key cap and every bad input are refused with an error and no rows", () => {
  const big = I.plan({ clip: { frames: 5000 }, inPreset: "slideFade", outPreset: "slideFade", inFrames: 1000, outFrames: 1000 });
  assert.match(big.error, /keyframes/);
  assert.ok(big.total === 0 && big.in.length === 0 && big.out.length === 0);
  const alone = I.plan({ clip: { frames: 5000 }, inPreset: "slideFade", inFrames: 1000 });   // one side: 2 * (1001 + 2) keys, inside the cap
  assert.ok(!alone.error && alone.total === 2006);
  assert.match(go({ inPreset: "nope" }).error, /unknown In preset/);
  assert.match(go({ outPreset: "overshoot" }).error, /unknown Out preset/, "Overshoot is an In preset only");
  assert.match(go({ inPreset: "fade", outPreset: "nope" }).error, /unknown Out preset/);
  assert.ok(I.plan({ clip: { frames: 1 }, inPreset: "fade" }).error);
  assert.ok(I.plan({ clip: { frames: NaN }, inPreset: "fade" }).error);
  assert.ok(I.plan({ clip: { frames: Infinity }, inPreset: "fade" }).error);
  assert.ok(I.plan({ inPreset: "fade" }).error);
  assert.ok(I.plan().error);
  assert.ok(go({ inPreset: "fade", inFrames: NaN }).error);
  assert.ok(go({ inPreset: "fade", outFrames: Infinity }).error);
  assert.ok(go({ inPreset: "fade", strength: NaN }).error);
  assert.ok(go({ inPreset: "slide", direction: "up" }).error);
  assert.ok(go({ inPreset: "spinIn", turn: "left" }).error);
});

test("frames are rounded and kept in range", () => {
  assert.strictEqual(go({ inPreset: "fade", inFrames: 7.4 }).frames.in, 7);
  assert.strictEqual(go({ inPreset: "fade", inFrames: 0 }).frames.in, I.FRAMES_MIN);
  assert.strictEqual(I.plan({ clip: { frames: 5000 }, inPreset: "fade", inFrames: 99999 }).frames.in, I.FRAMES_MAX);
});

test("times(): frame to media seconds on a trimmed and a sped-up clip", () => {
  const plain = I.times({ inPt: 0, speed: 1 }, 25);
  assert.ok(near(plain.step, 0.04) && near(plain.at(0), 0) && near(plain.at(25), 1));
  const trimmed = I.times({ inPt: 12.5, speed: 1 }, 25);
  assert.ok(near(trimmed.at(0), 12.5) && near(trimmed.at(50), 14.5));
  const fast = I.times({ inPt: 3, speed: 2 }, 25);                   // 2x: a sequence frame spans 2 frames of media
  // measured in Premiere (probe P7): a sped clip's In point is in timeline seconds, so the keys start at inPt * speed
  assert.ok(near(fast.step, 0.08) && near(fast.at(0), 6) && near(fast.at(10), 6.8));
  const slow = I.times({ inPt: 1, speed: 0.5 }, 30);
  assert.ok(near(slow.at(0), 0.5) && near(slow.at(30), 1));
  assert.ok(near(I.times({ inPt: 2 }, 25).at(25), 3), "no speed means normal speed");
  assert.ok(I.times({ inPt: 0, speed: 1, reversed: true }, 25).error);
  assert.ok(I.times({ inPt: 0, speed: -1 }, 25).error);
  assert.ok(I.times({ inPt: 0, speed: 1 }, 0).error && I.times({ inPt: 0, speed: 1 }, NaN).error);
  // the out rows land on the clip's last frame: first frame + (frames - 1) steps
  const r = I.plan({ clip: { frames: 50 }, outPreset: "fade", outFrames: 5 });
  assert.ok(near(fast.at(r.out[r.out.length - 1].f), 6 + 49 * 0.08));
});

// ---------------------------------------------------------------- Phase 5: own presets
const crypto = require("crypto");
const reset = () => { I.setCustom([]); I.setDraft("in", null); I.setDraft("out", null); };
const spec = (side, base, over) => Object.assign({ id: "mine1", v: 1, side, base, name: "Mine", frames: (I.find(side, base) || { frames: 12 }).frames, curves: {} }, over);
const pts = (...q) => ({ pts: q });
const EXTREME = pts([0.1, 1.5], [0.3, -0.5], [0.5, 1.5], [0.7, -0.5], [0.9, 1.5]);
const tableOf = (side) => (side === "in" ? I.IN_PRESETS : I.OUT_PRESETS);
const planFor = (side, id, o) => go(Object.assign({ [side === "in" ? "inPreset" : "outPreset"]: id }, o));
const rowsOf = (side, id, o) => planFor(side, id, o)[side];

test("built-in rows are unchanged by Phase 5", () => {
  // sha1 of plan() and needs() for all 33 built-ins at three strengths and two edge / turn pairs, computed from the code of
  // 0.10.134 (before own presets existed) and pinned: a built-in result must never change
  const PINNED = { 25: "1e503261977ff8b742a5c640b9a110443881ee5a", 100: "6fc3245d65428d8ad3add2445864705da97bf6f7", 200: "9614974f4e5b9a5bab58ffe96d94b3735908abba" };
  reset();
  for (const strength of [25, 100, 200]) {
    const all = [];
    for (const side of ["in", "out"]) {
      for (const p of tableOf(side)) {
        for (const [direction, turn] of [["left", "cw"], ["top", "ccw"]]) {
          all.push([side, p.id, direction, turn, planFor(side, p.id, { strength, direction, turn }), I.needs(p)]);
        }
      }
    }
    assert.strictEqual(all.length, 66);
    assert.strictEqual(crypto.createHash("sha1").update(JSON.stringify(all)).digest("hex"), PINNED[strength], `strength ${strength}`);
  }
});

test("a custom curve changes only its own property (Twist Pop)", () => {
  reset();
  const base = ins("twistPop");
  const row = I.setDraft("in", spec("in", "twistPop", { curves: { rot: pts([0.5, 0.2]) } }));
  assert.ok(row && row.custom && row.base === "twistPop" && row.id === I.DRAFT && row.side === "in");
  const mine = ins(I.DRAFT);
  assert.strictEqual(mine.length, base.length);
  let rotDiffers = false;
  mine.forEach((m, i) => {
    assert.strictEqual(m.f, base[i].f);
    for (const k of ["dx", "dy", "s", "o"]) assert.strictEqual(m[k], base[i][k], `${k} of frame ${i}`);
    if (m.r !== base[i].r) rotDiffers = true;
  });
  assert.ok(rotDiffers, "rotation follows the new curve");
  // the base table's own row is untouched
  assert.strictEqual(I.find("in", "twistPop").props[1].curve, "cubicOut");
  reset();
});

test("custom rows start and end where the base does", () => {
  for (const side of ["in", "out"]) {
    for (const p of tableOf(side)) {
      const curves = {};
      for (const e of I.editable(side, p.id)) if (e.ok) curves[e.prop] = pts([0.3, -0.5], [0.7, 1.5]);
      if (!Object.keys(curves).length) continue;
      reset();
      assert.ok(I.setDraft(side, spec(side, p.id, { curves })), `${side}/${p.id} resolves`);
      for (const strength of [25, 100, 200]) {
        const a = rowsOf(side, p.id, { strength });
        const b = rowsOf(side, I.DRAFT, { strength });
        assert.deepStrictEqual(b[0], a[0], `${side}/${p.id} first row at ${strength}`);
        assert.deepStrictEqual(b[b.length - 1], a[a.length - 1], `${side}/${p.id} last row at ${strength}`);
      }
    }
  }
  reset();
});

test("extreme points stay finite; scale in range; opacity 0..1", () => {
  for (const side of ["in", "out"]) {
    for (const p of tableOf(side)) {
      const curves = {};
      for (const e of I.editable(side, p.id)) if (e.ok) curves[e.prop] = EXTREME;
      reset();
      if (!Object.keys(curves).length) continue;
      I.setDraft(side, spec(side, p.id, { curves }));
      for (const strength of [25, 200]) {
        for (const r of rowsOf(side, I.DRAFT, { strength })) {
          for (const k of ["dx", "dy", "s", "r", "o"]) assert.ok(Number.isFinite(r[k]), `${side}/${p.id} ${k}`);
          assert.ok(r.s >= I.SCALE_MIN && r.s <= I.SCALE_MAX, `${side}/${p.id} scale ${r.s}`);
          assert.ok(r.o >= 0 && r.o <= 1, `${side}/${p.id} opacity ${r.o}`);
        }
      }
    }
  }
  reset();
});

test("an exit preset whose curve dips first is fully off on frame 0 and unscaled before arrival, at every strength", () => {
  // In Slide at Strength 100: dx = progress - 1, so the frames' own progress is 1 + dx. Arrival = the first frame at 0.995 or past it;
  // before it nothing is scaled, from it on every frame's distance from the target is k times the Strength-100 one (no frame left out).
  const curves = [
    [pts([0.15, -0.4], [0.6, 1.2]), null], [pts([0.1, -0.5], [0.5, 0.3], [0.8, 1.4]), null], [pts([0.5, -0.5], [0.99, -0.5]), null],
    [pts([0.01, 1.5], [0.5, 1.2]), 100], [pts([0.01, 1.5], [0.5, 1.2]), 200], [pts([0.012, 1.5], [0.03, 1.5], [0.5, 1.2]), 1000],   // steep: past the target at once
  ];
  let anyScaled = false;
  for (const [c, frames] of curves) {
    reset();
    const over = frames ? { curves: { pos: c }, frames } : { curves: { pos: c } };
    I.setDraft("in", spec("in", "slide", over));
    I.setDraft("out", spec("out", "slide", over));
    const clip = { clip: { frames: 3000 } };
    const ref = rowsOf("in", I.DRAFT, Object.assign({ strength: 100 }, clip));
    const n = ref.length - 1;
    let arrive = -1;
    for (let j = 1; j < n && arrive < 0; j++) if (1 + ref[j].dx >= 0.995) arrive = j;
    for (const strength of [25, 50, 150, 200]) {
      const k = strength / 100;
      const r = rowsOf("in", I.DRAFT, Object.assign({ strength }, clip));
      assert.strictEqual(r[0].dx, -1, `In frame 0 fully off at ${strength}`);
      for (let j = 1; j < n; j++) {
        if (arrive < 0 || j < arrive) assert.deepStrictEqual(r[j], ref[j], `In frame ${j} unscaled at ${strength}`);
        else {
          assert.ok(Math.abs(r[j].dx - ref[j].dx * k) < 1e-9, `In frame ${j} of ${n} scaled by ${k}: ${r[j].dx} against ${ref[j].dx}`);
          if (Math.abs(ref[j].dx) > 1e-6) anyScaled = true;
        }
      }
      assert.strictEqual(r[n].dx, 0, "In ends at rest");
      const o = rowsOf("out", I.DRAFT, Object.assign({ strength }, clip));
      assert.strictEqual(o[0].dx, 0);
      assert.strictEqual(o[o.length - 1].dx, -1, `Out last frame fully off at ${strength}`);
    }
  }
  assert.ok(anyScaled, "frames from the arrival on follow Strength");
  reset();
});

test("Strength is judged from the custom rows", () => {
  reset();
  const never = I.setDraft("in", spec("in", "slide", { curves: { pos: pts([0.5, 0.5]) } }));
  assert.strictEqual(I.needs(never).strength, false);
  const over = I.setDraft("in", spec("in", "slide", { curves: { pos: pts([0.3, 1.3], [0.6, 1.0]) } }));
  assert.strictEqual(I.needs(over).strength, true);
  // an Out row is judged as Out: a custom Out Slide that overshoots after arrival matters, one that never does not
  const outNever = I.setDraft("out", spec("out", "slide", { curves: { pos: pts([0.5, 0.5]) } }));
  const outOver = I.setDraft("out", spec("out", "slide", { curves: { pos: pts([0.3, 1.3], [0.6, 1.0]) } }));
  assert.strictEqual(I.needs(outOver).strength, true);
  assert.strictEqual(I.needs(outNever).strength, false);
  // built-ins are measured exactly as before
  assert.strictEqual(I.needs(I.find("in", "overshoot")).strength, true);
  assert.strictEqual(I.needs(I.find("in", "slide")).strength, false);
  reset();
});

test("resolve refuses: unknown base, wrong side, newer version, bad curves, bad points, bad frames, bad id, bad name", () => {
  reset();
  const refused = (s, id = "mine1") => { const r = I.resolve(s, id); assert.ok(r.error && !r.row, JSON.stringify(s)); return r.error; };
  assert.ok(I.resolve(spec("in", "slide"), "mine1").row, "a plain spec resolves");
  refused(spec("in", "nope"));
  refused(spec("in", "anticipate"));                                   // an Out base on the In side
  refused(spec("out", "overshoot"));
  refused(spec("in", "slide", { v: I.PRESET_V + 1 }));
  refused(spec("in", "slide", { v: undefined }));
  refused(spec("in", "slide", { side: "sideways" }));
  refused(spec("in", "slide", { curves: { rot: pts([0.5, 0.5]) } }));   // Slide does not animate rotation
  refused(spec("in", "slide", { curves: { nope: pts([0.5, 0.5]) } }));
  for (const [side, id, prop] of [["out", "anticipate", "pos"], ["out", "popOut", "scale"], ["out", "swingOut", "rot"]]) {
    refused(spec(side, id, { curves: { [prop]: pts([0.5, 0.5]) } }));
  }
  for (const bad of [pts([0.5, 2]), pts([0.5, -0.6]), pts([0.5, NaN]), pts([0.6, 0.5], [0.5, 0.5]), pts([0.001, 0.5]), pts([0.999, 0.5]),
    pts(), { pts: [] }, { pts: Array.from({ length: 17 }, (_, i) => [(i + 1) / 18, 0.5]) }, { pts: "x" }, {}, null]) {
    refused(spec("in", "slide", { curves: { pos: bad } }));
  }
  for (const f of [0, -3, 1001, 12.5, "12", NaN, null]) refused(spec("in", "slide", { frames: f }));
  for (const id of ["slide", "mine", "mineX", "mine1x", "draft1", "", null, undefined, 5]) assert.ok(I.resolve(spec("in", "slide"), id).error, `id ${id}`);
  assert.ok(I.resolve(spec("in", "slide"), I.DRAFT).row, "DRAFT is a valid id for resolve");
  for (const name of ["", "   ", "x".repeat(25), 7, null]) refused(spec("in", "slide", { name }));
  assert.ok(I.resolve(spec("in", "slide", { name: "x".repeat(24) }), "mine1").row);
  refused(null);
  refused("slide");
  // frames inside the module's range are accepted
  assert.ok(I.resolve(spec("in", "slide", { frames: I.FRAMES_MIN }), "mine1").row);
  assert.ok(I.resolve(spec("in", "slide", { frames: I.FRAMES_MAX }), "mine1").row);
  // a draft that does not resolve is not kept
  assert.strictEqual(I.setDraft("in", spec("in", "nope")), null);
  assert.strictEqual(I.find("in", I.DRAFT), null);
  assert.strictEqual(I.setDraft("in", spec("out", "slide")), null, "a spec of the other side is not a draft of this one");
  assert.strictEqual(I.setDraft("sideways", spec("in", "slide")), null);
  reset();
});

test("setCustom keeps the good rows and reports the dropped", () => {
  reset();
  const r = I.setCustom([
    spec("in", "pop", { id: "mine10", name: "Good in", curves: { scale: pts([0.4, 1.2]) } }),
    spec("out", "fade", { id: "mine11", name: "Good out" }),
    spec("in", "nope", { id: "mine12" }),
    spec("in", "pop", { id: "mine10", name: "Twice" }),
    spec("in", "pop", { id: "draft" }),
    spec("in", "pop", { id: "slide" }),
    spec("in", "pop", { id: "mine13", v: 2 }),
    spec("out", "popOut", { id: "mine14", curves: { scale: pts([0.5, 0.5]) } }),
    null,
    "text",
  ]);
  assert.strictEqual(r.kept, 2);
  assert.deepStrictEqual(r.dropped.map((d) => d.id), ["mine12", "mine10", "draft", "slide", "mine13", "mine14", "?", "?"]);
  assert.ok(r.dropped.every((d) => typeof d.why === "string" && d.why.length));
  assert.deepStrictEqual(I.customOf("in").map((x) => x.id), ["mine10"]);
  assert.deepStrictEqual(I.customOf("out").map((x) => x.id), ["mine11"]);
  assert.strictEqual(I.find("in", "mine10").name, "Good in", "the first of two equal ids is kept");
  assert.strictEqual(I.setCustom("not a list").kept, 0);
  assert.deepStrictEqual(I.customOf("in"), []);
  reset();
});

test("no built-in id is draft or mine<digits>; find prefers built-ins", () => {
  reset();
  for (const side of ["in", "out"]) {
    for (const p of tableOf(side)) assert.ok(p.id !== I.DRAFT && !/^mine\d+$/.test(p.id), `${side}/${p.id}`);
  }
  I.setCustom([spec("in", "slide", { id: "mine1" })]);
  I.setDraft("in", spec("in", "slide"));
  for (const side of ["in", "out"]) for (const p of tableOf(side)) assert.strictEqual(I.find(side, p.id), p);
  assert.strictEqual(I.find("in", "mine1").custom, true);
  assert.strictEqual(I.find("in", "nothing"), null);
  assert.strictEqual(I.find("sideways", "mine1"), null);
  reset();
});

test("In and Out own presets stay separate", () => {
  reset();
  const got = I.setCustom([spec("in", "pop", { id: "mine7", name: "In seven" }), spec("out", "fade", { id: "mine7", name: "Out seven" }), spec("out", "shrink", { id: "mine8" })]);
  assert.deepStrictEqual(got, { kept: 2, dropped: [{ id: "mine7", why: "id used twice" }] }, "an id is one row: delete and rename go by id alone");
  assert.strictEqual(I.find("in", "mine7").name, "In seven");
  assert.strictEqual(I.find("out", "mine7"), null, "an In row is never an Out row");
  assert.strictEqual(I.find("in", "mine8"), null, "an Out row is never an In row");
  assert.deepStrictEqual(I.customOf("in").map((x) => x.id), ["mine7"]);
  assert.deepStrictEqual(I.customOf("out").map((x) => x.id), ["mine8"]);
  I.setDraft("in", spec("in", "fade"));
  assert.ok(I.find("in", I.DRAFT));
  assert.strictEqual(I.find("out", I.DRAFT), null);
  assert.strictEqual(planFor("in", "mine8").error, 'unknown In preset "mine8"');
  assert.ok(!planFor("out", "mine8").error);
  assert.strictEqual(go({ inPreset: "mine7", outPreset: "mine8" }).error, undefined);
  reset();
});

test("a custom curve does not change the key total", () => {
  reset();
  for (const [side, id, frames] of [["in", "elastic", 24], ["in", "twistPop", 14], ["out", "swingOut", 16], ["out", "slideFade", 12]]) {
    const curves = {};
    for (const e of I.editable(side, id)) if (e.ok) curves[e.prop] = EXTREME;
    I.setDraft(side, spec(side, id, { curves }));
    for (const f of [undefined, 1, 5, 40]) {
      const o = f === undefined ? {} : { [side === "in" ? "inFrames" : "outFrames"]: f };
      assert.strictEqual(planFor(side, I.DRAFT, o).total, planFor(side, id, o).total, `${side}/${id} frames ${f}`);
    }
  }
  // the cap is the same: lengths that are too long are refused for both, with the same text
  const big = { clip: { frames: 5000 }, inFrames: 1000, outFrames: 1000 };
  I.setCustom([spec("in", "twistPop", { id: "mine1", frames: 1000, curves: { rot: EXTREME } }), spec("out", "swingOut", { id: "mine2", frames: 1000, curves: { op: EXTREME } })]);
  const own = I.plan(Object.assign({ inPreset: "mine1", outPreset: "mine2" }, big));
  const built = I.plan(Object.assign({ inPreset: "twistPop", outPreset: "swingOut" }, big));
  assert.ok(built.error && own.error === built.error, built.error);
  assert.ok(I.capCheck([2000, 2000]), "the per-press cap is unchanged");
  reset();
});

test("setCustom([]) and setDraft(side, null) clear", () => {
  reset();
  I.setCustom([spec("in", "pop", { id: "mine3" }), spec("out", "fade", { id: "mine4" })]);
  I.setDraft("in", spec("in", "pop"));
  I.setDraft("out", spec("out", "fade"));
  assert.ok(I.find("in", "mine3") && I.find("out", "mine4") && I.find("in", I.DRAFT) && I.find("out", I.DRAFT));
  assert.strictEqual(I.setDraft("in", null), null);
  assert.strictEqual(I.find("in", I.DRAFT), null);
  assert.ok(I.find("out", I.DRAFT), "the other side's draft stays");
  assert.deepStrictEqual(I.setCustom([]), { kept: 0, dropped: [] });
  assert.strictEqual(I.find("in", "mine3"), null);
  assert.strictEqual(I.find("out", "mine4"), null);
  assert.deepStrictEqual([I.customOf("in"), I.customOf("out")], [[], []]);
  assert.ok(I.find("out", I.DRAFT), "setCustom does not touch drafts");
  I.setDraft("out", null);
  assert.strictEqual(I.find("out", I.DRAFT), null);
  assert.ok(planFor("in", "pop").in.length, "built-ins still plan");
  reset();
});

test("editable() and curveFor() describe what can be dragged", () => {
  reset();
  const ok = (side, id) => I.editable(side, id).map((e) => `${e.prop}:${e.ok}`).join(",");
  assert.strictEqual(ok("in", "twistPop"), "scale:true,rot:true");
  assert.strictEqual(ok("out", "anticipate"), "pos:false");
  assert.strictEqual(ok("out", "popOut"), "scale:false");
  assert.strictEqual(ok("out", "swingOut"), "rot:false,op:true");
  assert.ok(I.editable("out", "anticipate")[0].why.length > 0);
  assert.deepStrictEqual(I.editable("in", "nothing"), []);
  assert.ok(K.pointsOk(I.curveFor("in", "slide", "pos")));
  assert.ok(K.pointsOk(I.curveFor("in", "elastic", "pos")));
  assert.strictEqual(I.curveFor("out", "anticipate", "pos"), null);
  assert.strictEqual(I.curveFor("in", "slide", "rot"), null);
  assert.strictEqual(I.curveFor("in", "nothing", "pos"), null);
  const mine = [[0.3, 0.8], [0.7, 1.1, 1]];
  I.setDraft("in", spec("in", "twistPop", { curves: { rot: { pts: mine } } }));
  assert.deepStrictEqual(I.curveFor("in", I.DRAFT, "rot"), mine);
  assert.notStrictEqual(I.curveFor("in", I.DRAFT, "rot")[0], mine[0], "a copy, not the stored array");
  assert.ok(K.pointsOk(I.curveFor("in", I.DRAFT, "scale")), "an unedited property gives the base curve as points");
  assert.deepStrictEqual(I.editable("in", I.DRAFT), I.editable("in", "twistPop"));
  assert.strictEqual(I.PRESET_V, 1);
  reset();
});
