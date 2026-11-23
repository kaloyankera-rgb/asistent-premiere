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

// ---------------------------------------------------------------- Lock to it (0.10.54)
test("lock: the clip moves against the object so it stays where it was on the boxed frame", () => {
  // a 1080x1920 file at 100 % in a 1080x1920 frame; the ball goes 0, +40, +80 px to the right
  const fr = [0, 1, 2].map((i) => ({ t: i / 30, x: 540 + 40 * i, y: 960, s: 1, a: 0, state: "sure" }));
  const r = P.lock({ frames: fr, width: 1080, height: 1920, k0: 0 }, {}, frame, {});
  assert.deepStrictEqual(r.keys.map((k) => Math.round(k.x * 1080)), [540, 500, 460]);
  // every frame puts the ball back at 540
  for (let i = 0; i < 3; i++) {
    const [sx] = P.screenPoint(fr[i].x, fr[i].y, { width: 1080, height: 1920 }, { x: r.keys[i].x, y: r.keys[i].y }, frame);
    assert.ok(near(sx, 540));
  }
  // moving the clip shows the edge: 80 px of 1080 -> zoom about 1.15 hides it
  assert.strictEqual(r.uncovered, 2);
  assert.ok(r.need > 1.07 && r.need < 1.2, String(r.need));
});

test("lock with zoom: every frame covered, the ball still in its place; centre puts it in the middle", () => {
  const fr = [0, 1, 2, 3].map((i) => ({ t: i / 30, x: 300 + 60 * i, y: 700 + 30 * i, s: 1, a: 0, state: i === 2 ? "lost" : "sure" }));
  const tr = { frames: fr, width: 1080, height: 1920, k0: 1 };
  const r = P.lock(tr, { sw: 100 }, frame, { zoom: true, centre: true });
  assert.ok(r.zoom > 1 && r.uncovered === 0 && r.scale === Math.round(100 * r.zoom * 10) / 10);
  assert.strictEqual(r.keys.length, 3);              // rigid: no key on the lost frame
  const C = require("../panel/coverage.js");
  for (const k of r.keys) {
    const i = Math.round(k.t * 30);
    const m = { sw: 100 * r.zoom, x: k.x, y: k.y };
    const [sx, sy] = P.screenPoint(fr[i].x, fr[i].y, { width: 1080, height: 1920 }, m, frame);
    assert.ok(near(sx, 540, 1e-6) && near(sy, 960, 1e-6));
    assert.ok(C.gap({ width: 1080, height: 1920 }, m, frame).covered);
  }
});

test("lock smooth: a bouncing ball gives a calm path that still follows it; lost frames are bridged", () => {
  const fr = Array.from({ length: 90 }, (_, i) => ({ t: i / 30, x: 300 + 4 * i, y: 1200 + 150 * Math.abs(Math.sin(i / 3)), s: 1, a: 0, state: i === 40 ? "lost" : "sure" }));
  const tr = { frames: fr, width: 1080, height: 1920, k0: 0 };
  const rigid = P.lock(tr, {}, frame, {});
  const soft = P.lock(tr, {}, frame, { smooth: 6 });
  assert.strictEqual(soft.keys.length, 90);
  assert.strictEqual(rigid.keys.length, 89);
  const jump = (ks) => Math.max(...ks.slice(1).map((k, i) => Math.abs(k.y - ks[i].y) * 1920));
  assert.ok(jump(soft.keys) < jump(rigid.keys) / 3);
  // it still follows the sideways walk: the clip ends about 356 px further left
  assert.ok(Math.abs((soft.keys[89].x - soft.keys[0].x) * 1080 + 356) < 40);
});

// ---------------------------------------------------------------- viewer and timeline helpers (0.10.55)
test("corners: the box grows and turns with the track", () => {
  const c = P.corners({ x: 100, y: 100, s: 2, a: 90 }, [0, 0, 20, 10]);
  // 20 x 10 doubled -> 40 x 20, turned 90: the first corner (-20, -10) goes to (10, -20)
  assert.ok(near(c[0][0], 110) && near(c[0][1], 80));
});

test("problem: next and previous runs that are not sure", () => {
  const st = "ssuulsssls".split("").map((c) => ({ state: { s: "sure", u: "unsure", l: "lost" }[c] }));
  assert.strictEqual(P.problem(st, 0, 1), 2);
  assert.strictEqual(P.problem(st, 2, 1), 8);       // from inside a bad run: the next one after it
  assert.strictEqual(P.problem(st, 9, -1), 8);
  assert.strictEqual(P.problem(st, 7, -1), 2);      // the start of the earlier run
  assert.strictEqual(P.problem(st, 1, -1), -1);
  assert.strictEqual(P.problem(st, 9, 1), -1);
});

test("merge: a re-tracked part replaces its frames and continues the scale and the angle from the old track", () => {
  const fr = Array.from({ length: 6 }, (_, i) => ({ t: i, x: i, y: 0, s: 1.5, a: 10, state: i >= 3 ? "lost" : "sure" }));
  const track = { frames: fr, box: [0, 0, 100, 100], k0: 0 };
  const part = { k0: 0, frames: [3, 4, 5].map((i) => ({ t: i, x: 50 + i, y: 1, s: 1 + 0.1 * (i - 3), a: 2, state: "sure" })) };
  const m = P.merge(track, part, 3, [0, 0, 140, 140]);      // a box drawn tighter: the scale still continues from 1.5
  assert.deepStrictEqual(m.frames.map((f) => f.state), ["sure", "sure", "sure", "sure", "sure", "sure"]);
  assert.ok(near(m.frames[3].s, 1.5) && near(m.frames[4].s, 1.65) && near(m.frames[5].a, 12));
  assert.strictEqual(track.frames[3].state, "lost");     // the old track is not changed in place
  // nothing sure left in the old track: the new box against the first one gives the scale
  const allLost = { ...track, frames: fr.map((f) => ({ ...f, state: "lost" })) };
  assert.ok(near(P.merge(allLost, part, 3, [0, 0, 150, 150]).frames[3].s, 1.5));
});

test("ticks: one per second from the clip's In", () => {
  const fr = Array.from({ length: 91 }, (_, i) => ({ t: 2 + i / 30 }));
  assert.deepStrictEqual(P.ticks(fr, 2).map((t) => [t.i, t.label]), [[0, "0s"], [30, "1s"], [60, "2s"], [90, "3s"]]);
});

// 0.10.63: a range, Stop and going on from a tracked frame
test("attach: frames not tracked (outside the range, after Stop) get no key and are not counted as lost", () => {
  const src = { start: 10, inPt: 2, speed: 1 };
  const fr = [0, 1, 2, 3, 4].map((i) => ({ t: 2 + i / 30, x: 540 + 10 * i, y: 960, s: 1, a: 0, state: i >= 3 ? "none" : "sure" }));
  const target = { start: 10, end: 11, inPt: 0, speed: 1, x: 0.5, y: 0.5, scale: 100, rot: 0 };
  const r = P.attach(track(fr, 1), src, {}, target, frame);
  assert.strictEqual(r.keys.length, 3);
  assert.strictEqual(r.lost, 0);
  assert.strictEqual(P.problem(fr, 0, 1), -1);              // a stretch not tracked is not a "problem" to jump to
  assert.ok(P.usable(fr[0]) && !P.usable(fr[3]) && !P.usable({ state: "lost" }));
});

test("going on from a tracked frame: its box, and the part continues its scale and angle", () => {
  const t = { width: 1000, height: 500, k0: 0, box: [100, 100, 100, 50], id: "x",
    frames: [{ t: 0, x: 150, y: 125, s: 1, a: 0, state: "sure" }, { t: 1, x: 300, y: 200, s: 2, a: 10, state: "sure" },
      { t: 2, x: 300, y: 200, s: 2, a: 10, state: "none" }] };
  const b = P.boxAt(t, t.frames[1]);
  assert.ok(near(b[0], 0.2) && near(b[1], 0.3) && near(b[2], 0.2) && near(b[3], 0.2));
  // the part was tracked from frame 1 with that box: its own scale starts at 1, angle at 0
  const part = { k0: 1, box: [200, 150, 200, 100], frames: [{ state: "none" }, { t: 1, x: 300, y: 200, s: 1, a: 0, state: "sure" },
    { t: 2, x: 320, y: 210, s: 1.5, a: 5, state: "sure" }] };
  const m = P.merge(t, part, 0, null);
  assert.strictEqual(m.frames[0].x, 150);                   // "none" in the part leaves the old frame alone
  assert.ok(near(m.frames[2].s, 3) && near(m.frames[2].a, 15) && m.frames[2].state === "sure");
});

// ---- the viewer's zoom (0.10.73)
test("viewport: zoom 1 shows the whole frame, unshifted", () => {
  const a = P.viewport({ z: 1, cx: 0.9, cy: 0.1 }, 200, 356);
  assert.deepEqual([a.cw, a.ch, a.px, a.py], [200, 356, 0, 0]);
});

test("viewport: the shift is kept inside the frame", () => {
  const a = P.viewport({ z: 2, cx: 1, cy: 0 }, 200, 300);
  assert.deepEqual([a.cw, a.ch, a.px, a.py], [400, 600, 200, 0]);
  assert.equal(a.cx, 0.75);
  assert.equal(a.cy, 0.25);
});

test("zoomAt keeps the frame point under the mouse in place", () => {
  const w = 240, h = 420;
  const v0 = { z: 1.5, cx: 0.4, cy: 0.6 };
  const a = P.viewport(v0, w, h);
  const [vx, vy] = [70, 300];
  const fx = (vx + a.px) / a.cw, fy = (vy + a.py) / a.ch;
  const b = P.viewport(P.zoomAt(v0, 3, vx, vy, w, h), w, h);
  assert.ok(Math.abs(fx * b.cw - b.px - vx) <= 1);
  assert.ok(Math.abs(fy * b.ch - b.py - vy) <= 1);
  assert.equal(b.z, 3);
});

test("zoomStep goes through the steps and stops at the ends", () => {
  assert.equal(P.zoomStep(1, 1), 1.5);
  assert.equal(P.zoomStep(2.4, 1), 3);
  assert.equal(P.zoomStep(8, 1), 8);
  assert.equal(P.zoomStep(2.4, -1), 2);
  assert.equal(P.zoomStep(1, -1), 1);
});

test("panBy moves the view and stops at the frame's edge", () => {
  const v = P.panBy({ z: 2, cx: 0.5, cy: 0.5 }, 50, 0, 200, 200);
  assert.equal(P.viewport(v, 200, 200).px, 150);
  const far = P.panBy(v, 1000, -1000, 200, 200);
  assert.deepEqual([P.viewport(far, 200, 200).px, P.viewport(far, 200, 200).py], [200, 0]);
});

test("follow moves the view only when the point nears an edge", () => {
  const v = { z: 4, cx: 0.5, cy: 0.5 };
  assert.deepEqual(P.follow(v, 0.52, 0.5, 200, 200), P.zoomAt(v, 4, 100, 100, 200, 200));
  const moved = P.follow(v, 0.7, 0.5, 200, 200);
  assert.ok(Math.abs(moved.cx - 0.7) < 0.01);
  assert.deepEqual(P.follow({ z: 1, cx: 0.5, cy: 0.5 }, 0.9, 0.9, 200, 200), { z: 1, cx: 0.5, cy: 0.5 });
});

// ---- layout by the clip's shape (0.10.75)
test("layoutFor: a vertical clip in a wide, short panel goes side by side and gets much bigger", () => {
  const L = P.layoutFor(2160, 3840, 760, 480);
  assert.equal(L.side, true);
  assert.ok(L.h >= 380, `h ${L.h}`);
  assert.ok(Math.abs(L.w / L.h - 9 / 16) < 0.01);
});

test("layoutFor: 16:9 in the same panel stays stacked, full width or full allowed height", () => {
  const L = P.layoutFor(3840, 2160, 760, 480);
  assert.equal(L.side, false);
  assert.ok(L.w <= 760 && L.h <= 250);
  assert.ok(Math.abs(L.w / L.h - 16 / 9) < 0.01);
});

test("layoutFor: a narrow panel always stacks; the shape is never stretched", () => {
  for (const [fw, fh] of [[1080, 1920], [1920, 1080], [1080, 1080], [1440, 1080], [1080, 1350]]) {
    const L = P.layoutFor(fw, fh, 300, 700);
    assert.equal(L.side, false);
    assert.ok(L.w <= 300);
    assert.ok(Math.abs(L.w / L.h - fw / fh) < 0.02, `${fw}x${fh}: ${L.w}x${L.h}`);
  }
});

test("layoutFor: a square clip in a wide panel picks the bigger picture", () => {
  const L = P.layoutFor(1080, 1080, 1000, 700);
  const stacked = Math.min(1000, Math.round(700 * 0.52)) ** 2;
  assert.ok(L.w * L.h >= stacked);
});

test("aspectName names the usual shapes", () => {
  assert.equal(P.aspectName(2160, 3840), "9:16");
  assert.equal(P.aspectName(3840, 2160), "16:9");
  assert.equal(P.aspectName(1080, 1080), "1:1");
  assert.equal(P.aspectName(1440, 1080), "4:3");
  assert.equal(P.aspectName(1080, 1350), "4:5");
  assert.equal(P.aspectName(1000, 300), "3.33:1");
});

test("layoutFor: landscape stacks even in a big panel (the timeline keeps the full width)", () => {
  assert.equal(P.layoutFor(1920, 1080, 1000, 640).side, false);
  assert.equal(P.layoutFor(1440, 1080, 1400, 900).side, false);
});

// ---------------------------------------------------------------- saved tracks (0.10.152)
test("a saved track's clip is found where it was, where it moved, or said missing (never guessed between two)", () => {
  const clip = { name: "C1.MP4", path: "/m/C1.MP4", track: 0, start: 4, end: 10, inPt: 2, speed: 1, kind: "video" };
  const at = (track, start, extra = {}) => ({ kind: "video", path: "/m/C1.MP4", track, start, end: start + 6, inPt: 2, speed: 1, ...extra });
  assert.strictEqual(P.relocate(clip, [at(0, 4)]).how, "same");
  const moved = P.relocate(clip, [at(1, 12.5)]);
  assert.strictEqual(moved.how, "moved");
  assert.deepStrictEqual([moved.clip.track, moved.clip.start, moved.clip.end], [1, 12.5, 18.5]);
  assert.strictEqual(P.relocate(clip, [at(1, 12.5), at(2, 20)]).how, "missing");               // two candidates: not guessed
  assert.strictEqual(P.relocate(clip, [at(1, 12.5, { inPt: 3 })]).how, "missing");            // trimmed: another range of the file
  assert.strictEqual(P.relocate(clip, [at(1, 12.5, { speed: 0.5 })]).how, "missing");
  assert.strictEqual(P.relocate(clip, [{ ...at(0, 4), kind: "audio" }]).how, "missing");
  assert.strictEqual(P.relocate(clip, []).how, "missing");
  const src = { clip, at: 5.2, t0: 3.2 };
  assert.strictEqual(P.movedSource(src, moved.clip).at, 13.7);                                  // the boxed moment moves with it
});

test("saved tracks: the name, the list line and which ones are shown", () => {
  assert.strictEqual(P.savedName({ clip: { name: "C1.MP4" }, at: 5.234 }), "C1.MP4 · 5.23 s");
  const now = Date.UTC(2026, 10, 23, 18, 0, 0);
  const item = { track: 1, sequence: "MAIN", frames: 120, counts: { sure: 100, unsure: 5, lost: 5, none: 10 }, saved: now / 1000 - 3 * 3600 };
  assert.strictEqual(P.savedLine(item, now), "V2  ·  MAIN  ·  110 frames, 5 lost  ·  3 h ago");
  assert.match(P.savedLine({ ...item, saved: now / 1000 - 20 }, now), /just now$/);
  assert.match(P.savedLine({ ...item, saved: now / 1000 - 26 * 3600 }, now), /yesterday$/);
  const items = [{ id: "a", here: true }, { id: "b", here: false }];
  assert.deepStrictEqual(P.savedShown(items, false).map((x) => x.id), ["a"]);
  assert.deepStrictEqual(P.savedShown(items, true).map((x) => x.id), ["a", "b"]);
  assert.deepStrictEqual(P.savedShown([{ id: "b", here: false }], false).map((x) => x.id), ["b"]);   // none here: all of them
});

test("the Tracker page saves every finished track and part, and opens one again with its pictures", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../panel/tracker.js"), "utf8");
  assert.strictEqual((src.match(/const kept = await autoSave\(\);/g) || []).length, 2);        // after Track and after a part
  assert.match(src, /engine\.trackerSave\(\{ id: t\.id,/);
  assert.match(src, /async function openSaved[\s\S]*?TR\.findSource\(project, rec\.source\)[\s\S]*?engine\.trackerReopen\(x\.id\)[\s\S]*?fetchThumbs\(t\.id, res\.from, res\.to\)/);
});

// ---------------------------------------------------------------- TRACK clips (0.10.153)
test("a TRACK clip's file names its track; other files and lookalikes do not", () => {
  const mac = "/Users/x/Library/Application Support/Asistent/tracks/markers/abc123def456/TRACK 2 · C0412.mov";
  const win = "C:\\Users\\x\\AppData\\Local\\Asistent\\tracks\\markers\\abc123def456\\TRACK 2 · C0412.mov";
  assert.strictEqual(P.markerId(mac), "abc123def456");
  assert.strictEqual(P.markerId(win), "abc123def456");
  assert.strictEqual(P.markerId("/Volumes/Production/tracks/C0412.mov"), null);
  assert.strictEqual(P.markerId("/x/tracks/markers/abc123def456/TRACK 2.mp4"), null);
  assert.strictEqual(P.markerId(""), null);
  // a TRACK clip is never taken for the tracked clip it marks
  const clip = { name: "m.mov", path: mac, track: 0, start: 4, end: 10, inPt: 0, speed: 1, kind: "video" };
  assert.strictEqual(P.relocate(clip, [{ kind: "video", path: mac, track: 0, start: 4, end: 10, inPt: 0, speed: 1 }]).how, "missing");
});

test("the Tracker page has Track / Saved tabs, marks a new track, and a selected TRACK clip picks its track", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "../panel/tracker.js"), "utf8");
  assert.match(src, /const kept = await autoSave\(\);\s*const marked = state\.mark \? await markIt\(false\) : "";/);   // after Track only
  assert.strictEqual((src.match(/await markIt\(/g) || []).length, 2);                            // Track and Mark now
  assert.strictEqual((src.match(/const using = await trackFromSelection\(project\);/g) || []).length, 2);   // Attach and Lock
  const pt = fs.readFileSync(path.join(__dirname, "../panel/premiere-tracker.js"), "utf8");
  assert.match(pt, /!sameClip\(x, source\.clip\) && !TP\.markerId\(x\.path\)/);                    // a TRACK clip never gets keys
  assert.match(pt, /x\.path && !TP\.markerId\(x\.path\)\);/);                                      // nor is tracked
  assert.match(pt, /\{ bin: "Asistent tracks", at: c\.start \}/);
});
