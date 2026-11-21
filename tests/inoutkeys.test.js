// node --test tests/inoutkeys.test.js
// In & Out animations, Phase 2: the pure half of premiere-inout.js (rows -> Transform values) and the wiring of its hooks.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const I = require("../panel/inoutplan.js");
const K = require("../panel/keyframeplan.js");

const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const FRAME = { w: 1080, h: 1920 };
const FULL = I.boxOf({ seq: FRAME, layer: FRAME, fit: false }, {});                          // fills the frame
const HALF = I.boxOf({ seq: FRAME, layer: FRAME, fit: false }, { sh: 50, sw: 50 });          // half size, centred
const keys = (opts, ctx, frames = 100) => {
  const planned = I.plan(Object.assign({ clip: { frames } }, opts));
  assert.ifError(planned.error);
  const at = ctx.at || ((f) => f / 25);
  return { planned, out: I.transformKeys(planned, Object.assign({ at, box: { in: FULL, out: FULL }, inPreset: opts.inPreset, outPreset: opts.outPreset, direction: opts.direction }, ctx)) };
};

test("boxOf: a full-frame clip and a half-scale clip", () => {
  assert.ok(near(FULL.wf, 1) && near(FULL.hf, 1) && near(FULL.cx, 0.5) && near(FULL.hw, 0.5) && near(FULL.hh, 0.5));
  assert.ok(near(HALF.wf, 0.5) && near(HALF.hf, 0.5) && near(HALF.hw, 0.25) && near(HALF.cx, 0.5));
  // scale to frame size: a 2160x3840 file in a 1080x1920 frame fills it; a wide file letterboxes
  const fit = I.boxOf({ seq: FRAME, layer: { w: 2160, h: 3840 }, fit: true }, {});
  assert.ok(near(fit.wf, 1) && near(fit.hf, 1));
  const wide = I.boxOf({ seq: FRAME, layer: { w: 1920, h: 1080 }, fit: true }, {});
  assert.ok(near(wide.wf, 1) && near(wide.hf, 1080 * (1080 / 1920) / 1920));
  // a turned clip: the box that holds it
  const turned = I.boxOf({ seq: { w: 1000, h: 1000 }, layer: { w: 500, h: 250 }, fit: false }, { rot: 90 });
  assert.ok(near(turned.hw, 0.125) && near(turned.hh, 0.25) && near(turned.wf, 0.5));
});

test("exitDistance: per edge, for a clip that is not centred", () => {
  const box = { cx: 0.3, cy: 0.6, hw: 0.1, hh: 0.2, wf: 0.2, hf: 0.4 };
  assert.ok(near(I.exitDistance(box, "left"), 0.4));
  assert.ok(near(I.exitDistance(box, "right"), 0.8));
  assert.ok(near(I.exitDistance(box, "top"), 0.8));
  assert.ok(near(I.exitDistance(box, "bottom"), 0.6));
  assert.ok(near(I.exitDistance(FULL, "left"), 1) && near(I.exitDistance(HALF, "left"), 0.75));
  // already off the picture: still a small move, never zero or negative
  assert.strictEqual(I.exitDistance({ cx: -2, cy: 0.5, hw: 0.1, hh: 0.1, wf: 0.2, hf: 0.2 }, "left"), I.EXIT_FLOOR);
});

test("edgeOf: a drop has its own edge, the others follow the picked direction", () => {
  assert.strictEqual(I.edgeOf("in", "drop", "right"), "top");
  assert.strictEqual(I.edgeOf("out", "drop", "right"), "bottom");
  assert.strictEqual(I.edgeOf("in", "slide", "right"), "right");
  assert.strictEqual(I.edgeOf("in", "slide"), "left");
});

test("Position: an offset in frame fractions divided by the picture's own size, full-frame and half-scale", () => {
  // Glide (not an exit): 0.25 of the frame from the left
  const full = keys({ inPreset: "glide", direction: "left" }, {}).out.keys.position;
  assert.ok(near(full[0].v[0], 0.5 - 0.25) && near(full[0].v[1], 0.5), "full frame: 0.25 of the frame = 0.25 of the layer");
  const half = keys({ inPreset: "glide", direction: "left" }, { box: { in: HALF } }).out.keys.position;
  assert.ok(near(half[0].v[0], 0.5 - 0.5), "half scale: the same move is 0.5 of the picture");
  assert.ok(near(full[full.length - 1].v[0], 0.5) && near(half[half.length - 1].v[1], 0.5), "rests on the layer's centre");
});

test("Position: an exit animation travels the clip's own exit distance", () => {
  const f = keys({ inPreset: "slide", direction: "left" }, {}).out.keys.position;
  assert.ok(near(f[0].v[0], 0.5 - 1.0), "full frame: one frame width, picture just off");
  const h = keys({ inPreset: "slide", direction: "left" }, { box: { in: HALF } }).out.keys.position;
  // 0.75 of the frame to leave through the left edge, in layer units of a half-size picture: 0.75 / 0.5 = 1.5
  assert.ok(near(h[0].v[0], 0.5 - 1.5));
  const r = keys({ inPreset: "slide", direction: "right" }, { box: { in: HALF } }).out.keys.position;
  assert.ok(near(r[0].v[0], 0.5 + 1.5) && near(r[0].v[1], 0.5));
  const t = keys({ inPreset: "slide", direction: "top" }, { box: { in: HALF } }).out.keys.position;
  assert.ok(near(t[0].v[1], 0.5 - 1.5) && near(t[0].v[0], 0.5));
  // Drop comes from the top whatever the direction; the Out leaves through the bottom
  const o = keys({ outPreset: "drop", direction: "left" }, {}).out.keys.position;
  const last = o.filter((k) => k.f === 99)[0];
  assert.ok(near(last.v[1], 1.5) && near(last.v[0], 0.5), "the Out Drop ends one exit distance below, whatever the direction");
});

test("Position under Motion Rotation: the measured case (scale 50, rotation 30, 270x480 export)", () => {
  const frame = { w: 270, h: 480 };
  const box = I.boxOf({ seq: frame, layer: frame, fit: false }, { sh: 50, sw: 50, rot: 30 });
  assert.ok(near(box.wf, 0.5) && near(box.hf, 0.5), "wf / hf are the unrotated picture (135 x 240 px)");
  // a position-only move, driven through a hand-made one-row plan: the wanted screen offset in px -> frame fractions
  const at = (px, py) => {
    const planned = { in: [{ f: 0, dx: px / frame.w, dy: py / frame.h, s: 1, r: 0, o: 1 }], out: [], pins: [], exit: { in: false, out: false }, props: { in: ["pos"], out: [] }, total: 1 };
    return I.transformKeys(planned, { at: (f) => f, box: { in: box } }).keys.position[0].v;
  };
  const x = at(29.4, 17.0);
  assert.ok(Math.abs(x[0] - 0.75) < 1 / 135 && Math.abs(x[1] - 0.5) < 1 / 240, `Position x +0.25 moved the centre by (+29.4, +17.0) px: ${x}`);
  const y = at(-30.0, 52.0);
  assert.ok(Math.abs(y[0] - 0.5) < 1 / 135 && Math.abs(y[1] - 0.75) < 1 / 240, `Position y +0.25 moved it by (-30.0, +52.0) px: ${y}`);
  // the other direction round: Position x +0.25 along the turned axis is 34 px at 30 degrees below screen x
  assert.ok(near(Math.hypot(29.4, 17.0), 33.96, 0.01));
});

test("Position at rotation 0 is exactly the plain offset over the picture's size (the live-verified numbers)", () => {
  for (const frame of [{ w: 1080, h: 1920 }, { w: 270, h: 480 }, { w: 1920, h: 1080 }]) {
    for (const m of [{}, { sh: 50, sw: 50 }, { sh: 37, sw: 61, x: 0.3, y: 0.7 }]) {
      const box = I.boxOf({ seq: frame, layer: frame, fit: false }, m);
      for (const opts of [{ inPreset: "glide", direction: "right" }, { inPreset: "slide", direction: "top" }, { outPreset: "anticipate", direction: "left" }]) {
        const planned = I.plan(Object.assign({ clip: { frames: 100 } }, opts));
        const out = I.transformKeys(planned, { at: (f) => f / 25, box: { in: box, out: box }, inPreset: opts.inPreset, outPreset: opts.outPreset, direction: opts.direction }).keys.position;
        const side = opts.inPreset ? "in" : "out";
        for (const row of planned[side]) {
          const k = out.find((q) => q.f === row.f);
          const d = planned.exit[side] ? I.exitDistance(box, I.edgeOf(side, opts.inPreset || opts.outPreset, opts.direction)) : 1;
          assert.strictEqual(k.v[0], 0.5 + (row.dx * d) / box.wf);
          assert.strictEqual(k.v[1], 0.5 + (row.dy * d) / box.hf);
        }
      }
    }
  }
});

test("Position on a rotated Motion box, with the numbers", () => {
  // 500x250 layer turned 90 degrees in a 1000x1000 frame: picture 0.5 x 0.25 of the frame, its box 0.25 wide and 0.5 tall
  const box = I.boxOf({ seq: { w: 1000, h: 1000 }, layer: { w: 500, h: 250 }, fit: false }, { rot: 90 });
  // the exit distance comes from the rotated bounding box; the move is then turned into the clip's own axes (turned 90 degrees
  // clockwise, its y axis points to the screen's left and its x axis down)
  const left = keys({ inPreset: "slide", direction: "left" }, { box: { in: box } }).out.keys.position;
  assert.ok(near(left[0].v[0], 0.5, 1e-9) && near(left[0].v[1], 0.5 + 0.625 / 0.25, 1e-9), "0.625 of the frame to the left = 2.5 picture heights along y");
  const top = keys({ inPreset: "slide", direction: "top" }, { box: { in: box } }).out.keys.position;
  assert.ok(near(top[0].v[0], 0.5 - 0.75 / 0.5, 1e-9) && near(top[0].v[1], 0.5, 1e-9), "0.75 of the frame up = -1.5 picture widths along x");
});

test("Opacity x 100, Scale x 100 under the cap, Rotation in degrees with the clockwise sign", () => {
  const fade = keys({ inPreset: "fade" }, {}).out.keys;
  assert.ok(near(fade.opacity[0].v, 0) && near(fade.opacity[fade.opacity.length - 1].v, 100));
  assert.strictEqual(fade.position.length + fade.scale.length + fade.rotation.length, 0, "only what the preset animates");
  const slam = keys({ inPreset: "slam", strength: 200 }, {}).out.keys.scale;
  assert.ok(slam.every((k) => k.v <= I.SCALE_MAX * 100 + 1e-9 && k.v >= I.SCALE_MIN * 100 - 1e-9));
  assert.ok(near(Math.max(...slam.map((k) => k.v)), 340), "2.2 grown by strength 200 % = 3.4, x 100");
  assert.ok(near(slam[slam.length - 1].v, 100));
  // the last guard in transformKeys itself: a row above the cap (or at 0) is clamped
  const hand = { in: [{ f: 0, dx: 0, dy: 0, s: 6, r: 0, o: 1 }, { f: 1, dx: 0, dy: 0, s: 0, r: 0, o: 1 }], out: [], pins: [], exit: { in: false, out: false }, props: { in: ["scale"], out: [] }, total: 2 };
  const clamped = I.transformKeys(hand, { at: (f) => f, box: {} }).keys.scale;
  assert.ok(near(clamped[0].v, I.SCALE_MAX * 100) && near(clamped[1].v, I.SCALE_MIN * 100));
  const cw = keys({ inPreset: "spinIn", turn: "cw" }, {}).out.keys.rotation;
  const ccw = keys({ inPreset: "spinIn", turn: "ccw" }, {}).out.keys.rotation;
  assert.ok(near(cw[0].v, -360) && near(ccw[0].v, 360) && near(cw[cw.length - 1].v, 0));
  const out = keys({ outPreset: "spinOut", turn: "cw" }, {}).out.keys.rotation;
  assert.ok(near(out[out.length - 1].v, 360), "an Out turns clockwise (positive) to its end");
});

test("pins: only Position, none before media time 0, none duplicated where In and Out meet", () => {
  // In Slide 12 frames from the clip start: media time 0 = frame 0, so the pin before it would be negative
  const a = keys({ inPreset: "slide", direction: "left" }, { at: (f) => f / 25 }).out;
  assert.strictEqual(a.keys.position.length, 12 + 1 + 1, "13 rows and the pin after the last row, none before time 0");
  assert.ok(a.keys.position.every((k) => k.t >= 0));
  // a clip trimmed 5 s in: both pins exist
  const b = keys({ inPreset: "slide", direction: "left" }, { at: (f) => 5 + f / 25 }).out;
  assert.strictEqual(b.keys.position.length, 12 + 1 + 2);
  assert.ok(near(b.keys.position[0].t, 5 - I.PIN / 25) && near(b.keys.position[0].f, -I.PIN));
  assert.ok(near(b.keys.position[0].v[0], b.keys.position[1].v[0]), "a pin repeats its end's value");
  // Out Slide: the pin after the last frame
  const c = keys({ outPreset: "slide", direction: "right" }, { at: (f) => 5 + f / 25 }).out.keys.position;
  assert.ok(near(c[c.length - 1].f, 99 + I.PIN) && near(c[c.length - 1].v[0], c[c.length - 2].v[0]));
  // other properties never get a pin
  const d = keys({ inPreset: "fade", outPreset: "fade" }, { at: (f) => 5 + f / 25 }).out.keys;
  assert.strictEqual(d.opacity.length, 11 + 11);
  // In and Out meet on one frame: both rows are at rest there, written once, no pin between them
  const { planned, out } = keys({ inPreset: "slide", outPreset: "slide", direction: "left", inFrames: 5, outFrames: 6 }, { at: (f) => 5 + f / 25 }, 12);
  assert.strictEqual(planned.frames.meet, true);
  const p = out.keys.position;
  assert.strictEqual(p.length, 6 + 7 - 1 + 2, "12 rows (one shared) and the two outer pins");
  assert.strictEqual(p.length, planned.total);
  assert.ok(p.every((k, i) => i === 0 || k.f > p[i - 1].f && k.t > p[i - 1].t), "strictly ascending, no duplicate time");
  assert.strictEqual(p.filter((k) => k.f === 5).length, 1);
});

test("a shortened In and Out that do not meet", () => {
  const { planned, out } = keys({ inPreset: "slide", outPreset: "slide", direction: "left", inFrames: 8, outFrames: 8 }, { at: (f) => 5 + f / 25 }, 12);
  assert.strictEqual(planned.frames.shortened, true);
  assert.strictEqual(planned.frames.meet, false);
  assert.deepStrictEqual([planned.frames.in, planned.frames.out], [5, 5]);
  const p = out.keys.position;
  assert.strictEqual(p.length, 6 + 6 + 4, "6 rows and 2 pins per side");
  assert.strictEqual(p.length, planned.total);
  assert.deepStrictEqual(p.map((k) => k.f), [-I.PIN, 0, 1, 2, 3, 4, 5, 5 + I.PIN, 6 - I.PIN, 6, 7, 8, 9, 10, 11, 11 + I.PIN]);
  assert.ok(near(p[7].v[0], 0.5) && near(p[8].v[0], 0.5), "the pins between the sides hold rest");
});

test("an unusable picture size is refused, never turned into NaN or Infinity keys", () => {
  const geo = { seq: FRAME, layer: FRAME, fit: false };
  assert.strictEqual(I.boxUsable(FULL), null);
  assert.strictEqual(I.boxUsable(I.boxOf(geo, { sh: 0, sw: 0 })), "scale", "Motion scale 0");
  assert.strictEqual(I.boxUsable(I.boxOf(geo, { sh: 0.1, sw: 0.1 })), "scale", "Motion scale 0.1 %");
  assert.strictEqual(I.boxUsable(I.boxOf(geo, { sh: 100, sw: 0 })), "scale", "Scale Width 0");
  assert.strictEqual(I.boxUsable(I.boxOf(geo, { sh: I.MIN_SIZE * 100, sw: I.MIN_SIZE * 100 })), null, "the lower bound itself is allowed");
  assert.strictEqual(I.boxUsable(I.boxOf({ seq: FRAME, layer: { w: 0, h: 0 }, fit: false }, {})), "scale", "a 0 x 0 layer has no picture");
  assert.strictEqual(I.boxUsable(I.boxOf({ seq: FRAME, layer: { w: 0, h: 0 }, fit: true }, {})), "size", "scale to frame size of 0 x 0 divides by zero");
  assert.strictEqual(I.boxUsable(I.boxOf({ seq: FRAME, layer: { w: NaN, h: 100 }, fit: false }, {})), "size");
  assert.strictEqual(I.boxUsable(Object.assign({}, FULL, { cx: NaN })), "size");
  assert.strictEqual(I.boxUsable(null), "size");
  assert.ok(!Number.isFinite(I.exitDistance({ cx: NaN, cy: 0.5, hw: 0.5, hh: 0.5, wf: 1, hf: 1 }, "left")), "a NaN box gives no distance");
  for (const m of [{ sh: 0, sw: 0 }, { sh: 0.001, sw: 0.001 }, { sh: 100, sw: 0 }]) {
    for (const opts of [{ inPreset: "slide", direction: "left" }, { inPreset: "glide", direction: "left" }, { outPreset: "slide", direction: "top" }]) {
      const planned = I.plan(Object.assign({ clip: { frames: 100 } }, opts));
      const box = I.boxOf(geo, m);
      const r = I.transformKeys(planned, { at: (f) => f / 25, box: { in: box, out: box }, inPreset: opts.inPreset, outPreset: opts.outPreset, direction: opts.direction });
      assert.ok(r.error, JSON.stringify([m, opts]));
      assert.strictEqual(r.total, 0);
      assert.ok(Object.values(r.keys).every((l) => l.length === 0));
    }
  }
  const nan = I.boxOf({ seq: FRAME, layer: { w: 0, h: 0 }, fit: false }, {});
  assert.ok(I.transformKeys(I.plan({ clip: { frames: 100 }, inPreset: "slide" }), { at: (f) => f, box: { in: nan }, inPreset: "slide" }).error);
  assert.ok(I.transformKeys(I.plan({ clip: { frames: 100 }, inPreset: "slide" }), { at: (f) => f, box: {}, inPreset: "slide" }).error, "no box at all");
  // presets that do not move position do not need a box, so a clip with Motion scale 0 still takes them
  const zero = I.boxOf(geo, { sh: 0, sw: 0 });
  const fade = I.transformKeys(I.plan({ clip: { frames: 100 }, inPreset: "fade" }), { at: (f) => f / 25, box: { in: zero }, inPreset: "fade" });
  assert.ifError(fade.error);
  assert.ok(fade.total > 0);
  // a time that is not a number
  const nanTime = I.transformKeys(I.plan({ clip: { frames: 100 }, inPreset: "fade" }), { at: () => NaN, box: {}, inPreset: "fade" });
  assert.ok(nanTime.error && nanTime.total === 0);
  // just inside the bound the Position is large but finite
  const small = I.boxOf(geo, { sh: I.MIN_SIZE * 100, sw: I.MIN_SIZE * 100 });
  const ok = I.transformKeys(I.plan({ clip: { frames: 100 }, inPreset: "slide", direction: "left" }), { at: (f) => f / 25, box: { in: small }, inPreset: "slide", direction: "left" });
  assert.ifError(ok.error);
  assert.ok(ok.keys.position.every((k) => k.v.every(Number.isFinite)));
});

test("key times on a sped-up, trimmed clip", () => {
  const clip = { inPt: 2, speed: 2 };
  const tm = I.times(clip, 25);
  const p = I.plan({ clip: { frames: 60 }, inPreset: "glide", direction: "left" });
  const k = I.transformKeys(p, { at: tm.at, box: { in: FULL }, inPreset: "glide", direction: "left" }).keys.position;
  assert.ok(near(k[0].t, 2 * 2 - I.PIN * 0.08), "base = In x |speed|, minus the pin's hundredth of a frame");
  assert.ok(near(k[1].t, 4) && near(k[2].t - k[1].t, 0.08), "one key per sequence frame = 2 / 25 s of media");
  assert.ok(near(k.filter((x) => x.f === 18)[0].t, 4 + 18 * 0.08));
});

test("capCheck: the keys of one press add up across clips", () => {
  const one = I.plan({ clip: { frames: 100 }, inPreset: "elastic", outPreset: "anticipate" }).total;
  assert.ok(one > 0 && one < K.MAX_KEYS);
  assert.strictEqual(I.capCheck([one, one]), null);
  const many = new Array(Math.floor(K.MAX_KEYS / one) + 1).fill(one);
  assert.match(I.capCheck(many), /more than 3000/);
  assert.strictEqual(I.capCheck([]), null);
});

test("every preset turns into keys on a centred and an off-centre clip without NaN", () => {
  const off = I.boxOf({ seq: FRAME, layer: FRAME, fit: false }, { x: 0.3, y: 0.7, sh: 40, sw: 40, rot: 20 });
  for (const side of ["in", "out"]) {
    for (const p of side === "in" ? I.IN_PRESETS : I.OUT_PRESETS) {
      for (const box of [FULL, HALF, off]) {
        const planned = I.plan(Object.assign({ clip: { frames: 120 }, direction: "bottom", turn: "ccw" }, side === "in" ? { inPreset: p.id } : { outPreset: p.id }));
        assert.ifError(planned.error);
        const r = I.transformKeys(planned, { at: (f) => f / 30, box: { in: box, out: box }, inPreset: p.id, outPreset: p.id, direction: "bottom" });
        for (const list of Object.values(r.keys)) for (const k of list) assert.ok([].concat(k.v).every(Number.isFinite), `${side}/${p.id}`);
        assert.ok(r.total > 0);
      }
    }
  }
});

// ---------------------------------------------------------------- wiring
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("the new modules are packed, and the hooks sit where they should", () => {
  const pack = read("scripts/package_ccx.sh");
  assert.match(pack, /blurplan\.js premiere-blur\.js inoutplan\.js premiere-inout\.js premiere-keyframes\.js/);
  assert.match(read("panel/premiere-keyframes.js"), /if \(await IO\.isTagged\(comp\)\) continue;/);
  const blur = read("panel/premiere-blur.js");
  assert.match(blur, /countTransforms\(prep\.chain\)\) !== countBefore \+ 1\) throw new Error\("the Transform effect did not attach"\)/);
  assert.match(blur, /if \(await IO\.isTagged\(last\)\) throw new Error\("the Transform effect did not attach"\)/);
  const io = read("panel/premiere-inout.js");
  assert.doesNotMatch(io, /createRemoveItemsAction|createRemoveItemAction|setMute|createSetDisabledAction/, "an effect off, never a track item");
  assert.doesNotMatch(io, /createSetInterpolationAtKeyframeAction/, "setting the interpolation adds a key at media time 0");
  assert.match(io, /createInsertComponentAction/);
  assert.match(io, /"Asistent: In\/Out animation \(Transform\)"/);
  assert.match(io, /"Asistent: In\/Out animation"/);
  assert.match(io, /"Asistent: remove In\/Out animation"/);
});

test("the bridge's In/Out commands are refused outside the test projects", async () => {
  const { createBridge } = require("../panel/devbridge.js");
  const doc = { getElementById: () => ({ hidden: true, textContent: "", children: [], className: "" }), querySelectorAll: () => [] };
  const b = createBridge({ premiere: { activeProject: async () => ({ name: "Client.prproj", path: "/c/Client.prproj" }) }, premiereColor: {}, doc, version: "x", sleep: () => Promise.resolve() });
  for (const name of ["inout_info", "inout_apply", "inout_remove"]) {
    assert.ok(b.commands[name], name);
    const r = await b.run({ id: "1", name, args: {} });
    assert.strictEqual(r.ok, false);
    assert.match(r.data.error, /Test projects only/);
  }
});

test("premiere-inout.js loads with a stubbed Premiere and exports what the bridge and the Keyframer call", () => {
  const Module = require("node:module");
  class UserError extends Error {}
  const P = { UserError, debug: () => {}, maybe: async () => undefined, secs: (t) => (t && t.seconds), transaction: () => {}, readTimeline: async () => ({ items: [] }) };
  const mem = new Map();
  const orig = Module._load;
  Module._load = function (req, parent, ...rest) {
    if (req === "premierepro") return { TickTime: {}, PointF: function PointF() {}, VideoFilterFactory: {} };
    if (req === "./premiere.js") return P;
    if (req === "./store.js") return { getItem: (k) => mem.get(k) || null, setItem: (k, v) => mem.set(k, v) };
    if (req === "./engine.js") return { log: () => {} };
    return orig.call(this, req, parent, ...rest);
  };
  try {
    for (const f of ["premiere-blur.js", "premiere-inout.js"]) delete require.cache[require.resolve(path.join(__dirname, "..", "panel", f))];
    const IO = require("../panel/premiere-inout.js");
    for (const n of ["apply", "remove", "info", "isTagged"]) assert.strictEqual(typeof IO[n], "function", n);
    assert.strictEqual(IO.TAG, 17.25);
  } finally {
    Module._load = orig;
  }
});
