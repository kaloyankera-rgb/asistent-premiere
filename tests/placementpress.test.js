// node --test tests/placementpress.test.js
// The press of "Move off faces" (2026-11-22): zoom times, which rule runs, the result text. The Premiere reading of zoomTimes is
// run on simulated clips (read only); everything else is pure (panel/placementplan.js).
const test = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");
const P = require("../panel/placementplan.js");

test("a clip's keyframe times become sequence seconds: In point and speed counted, the clip's own edges left out", () => {
  const clip = { start: 10, end: 20, inPt: 5, speed: 1 };
  assert.deepStrictEqual(P.keySeconds(clip, [5, 7, 9.5, 15, 16]), [12, 14.5]);        // 5 = the clip's start (the cut itself), 15+ is past its end
  assert.deepStrictEqual(P.keySeconds({ start: 10, end: 20, inPt: 0, speed: 2 }, [2, 8]), [11, 14]);
  assert.deepStrictEqual(P.keySeconds({ start: 0, end: 5, inPt: 0 }, undefined), []);
});

test("zoom times of several clips: merged, sorted, near duplicates counted once", () => {
  const clips = [{ start: 10, end: 20, inPt: 5, speed: 1, keys: [7, 9] }, { start: 0, end: 30, inPt: 0, speed: 1, keys: [12.0004, 25] }, { start: 5, end: 6, inPt: 0, speed: 1, keys: [] }];
  assert.deepStrictEqual(P.zoomSeconds(clips), [12, 14, 25]);
  assert.deepStrictEqual(P.zoomSeconds([]), []);
});

test("which rule runs: 16:9 and unknown sizes keep the older rule; ReShape its own; every other style its lane", () => {
  assert.deepStrictEqual(P.choosePath({ width: 1920, height: 1080, style: "gstroy" }), { path: "legacy", why: "16:9" });
  assert.deepStrictEqual(P.choosePath({ width: 3840, height: 2160, reshape: true }), { path: "legacy", why: "16:9" });
  assert.strictEqual(P.choosePath({ style: "aula" }).path, "legacy");
  assert.strictEqual(P.choosePath({ width: 0, height: 1920 }).why, "unknown size");
  const reshape = P.choosePath({ width: 1080, height: 1920, style: "gstroy", reshape: true });
  assert.strictEqual(reshape.path, "reshape");
  assert.strictEqual(P.choosePath({ width: 1080, height: 1920, preset: "reshape" }).path, "reshape");
  assert.strictEqual(P.choosePath({ width: 1080, height: 1920, style: "reshape" }).path, "reshape");         // no run yet: the panel's Style
  const g = P.choosePath({ width: 1080, height: 1920, preset: "gstroy", style: "aula" });                    // the run's style wins over the panel's
  assert.deepStrictEqual([g.path, g.name, g.label, g.lane.top], ["lanes", "gstroy", "GStroy", 0.458]);
  assert.strictEqual(P.choosePath({ width: 1080, height: 1920, style: "aula" }).lane.top, 0.49);
  for (const style of ["auto", "standard", "short", "fornetti", "", undefined]) {
    const d = P.choosePath({ width: 1080, height: 1920, style });
    assert.deepStrictEqual([d.path, d.name, d.label, d.lane.top], ["lanes", "default", "default", 0.46]);
  }
  assert.strictEqual(P.choosePath({ width: 1080, height: 1080, style: "gstroy" }).path, "lanes");           // square is not 16:9
});

const placed = [
  { id: 0, role: "bg", reason: "lane", flag: false }, { id: 1, role: "en", reason: "lane", flag: false },
  { id: 2, role: "bg", reason: "under a face", flag: false }, { id: 3, role: "bg", reason: "off text", flag: false },
  { id: 4, role: "bg", reason: "zoom brought a face", flag: false }, { id: 5, role: "bg", reason: "zoom brought a face", flag: false },
  { id: 6, role: "bg", reason: "no free place", flag: true }, { id: 7, role: "bg", reason: "lane", flag: true },
];
const gfx = [0, 1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, start: id * 10 + 1.04 }));

test("reasons are counted on the Bulgarian lines only, with the times of zoom drops and of lines with no free place", () => {
  const c = P.reasonCounts(placed, gfx);
  assert.deepStrictEqual([c.lane, c.underFace, c.offText, c.zoom, c.noPlace], [1, 1, 1, 2, 2]);
  assert.deepStrictEqual(c.zoomAt, [41.04, 51.04]);
  assert.deepStrictEqual(c.noPlaceAt, [61.04, 71.04]);
});

test("the result text: headline, one row per reason, times, Left alone, hands and products", () => {
  const reasons = P.reasonCounts(placed, gfx);
  const d = P.describe({ mode: "lanes", moved: 5, total: 8, label: "GStroy", laneTop: 0.458, reasons, kept: [{ why: "moved by hand" }, { why: "Position has keyframes" }, { why: "moved by hand" }],
    shots: [{ name: "A.MP4", start: 0, end: 12.5, why: "lane", frames: 4, withFace: 3, lines: 6 }], measured: 6, estimated: 0, ocr: true });
  assert.strictEqual(d.headline, "Moved 5 of 8 lines. One Cmd/Ctrl+Z undoes it.");
  const t = d.lines.map((l) => l.text);
  assert.ok(t.includes("1 line in the GStroy lane (top 46%)."));
  assert.ok(t.includes("1 line under a face."));
  assert.ok(t.includes("1 line moved off on-screen text."));
  assert.ok(t.includes("2 lines dropped because a zoom brought a face into the lane (0:41.0, 0:51.0)."));
  assert.ok(t.some((x) => x.startsWith("2 lines with no free place: left where they were, check (1:01.0, 1:11.0)")));
  assert.ok(t.includes("Left alone: 2 moved by hand, 1 keyframed."));
  assert.ok(t.includes("A.MP4, 0:00.0–0:12.5: lane, face in 3 of 4 frames, 6 lines."));
  assert.ok(t.includes("Hands and products are not detected."));
  assert.ok(!t.some((x) => x.includes("lane was free")));                  // 5 of 8 moved: not few
  assert.strictEqual(d.lines.find((l) => l.text.includes("no free place")).cls, "warn");
});

test("few moved: the lane was free on X lines; nothing moved; zoom times beyond the first few are counted; no recognition is said", () => {
  const reasons = { lane: 9, underFace: 0, offText: 0, zoom: 8, noPlace: 0, zoomAt: [1, 2, 3, 4, 5, 6, 7, 8], noPlaceAt: [] };
  const d = P.describe({ mode: "lanes", moved: 2, total: 20, label: "default", laneTop: 0.46, reasons, kept: [], shots: [], ocr: false, estimated: 3 });
  const t = d.lines.map((l) => l.text);
  assert.ok(t.includes("The lane was free on 9 lines."));
  assert.ok(t.includes("8 lines dropped because a zoom brought a face into the lane (0:01.0, 0:02.0, 0:03.0, 0:04.0, 0:05.0, and 3 more)."));
  assert.ok(t.some((x) => x.startsWith("Text recognition is not available here")));
  assert.ok(t.includes("Where the text sits could not be read on the frames: 3 lines placed by an estimate (check them)."));
  assert.strictEqual(P.describe({ mode: "reshape", moved: 0, total: 3, reasons, kept: [], shots: [] }).headline, "Nothing to move.");
  const rs = P.describe({ mode: "reshape", moved: 3, total: 3, reasons: { ...reasons, lane: 3 }, kept: [], shots: [] }).lines.map((l) => l.text);
  assert.ok(rs.includes("3 lines at the shot's own height.") && rs[0].startsWith("ReShape:"));
});

// ---- zoomTimes on simulated Premiere clips (read only) ----
function load() {
  const real = Module._load;
  const stubs = {
    premierepro: {}, "./store.js": {}, "./engine.js": {}, "./premiere-color.js": { exportFrames: async () => [] },
    "./premiere.js": { transaction() {}, readTimeline: async () => ({}), maybe: async (o, name, ...a) => { if (!o || typeof o[name] !== "function") return undefined; try { return await o[name](...a); } catch (e) { return undefined; } } },
  };
  Module._load = function (request, ...rest) { return Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : real.call(this, request, ...rest); };
  try {
    delete require.cache[require.resolve("../panel/premiere-placement.js")];
    return require("../panel/premiere-placement.js");
  } finally { Module._load = real; }
}

function ti(components) {
  return { getComponentChain: async () => ({ getComponentCount: () => components.length, getComponentAtIndex: (i) => components[i] }) };
}
const comp = (match, params) => ({ getMatchName: async () => match, getParamCount: () => params.length, getParam: (i) => params[i] });
const prm = (displayName, keys) => ({ displayName, isTimeVarying: async () => !!keys, getKeyframeListAsTickTimes: async () => (keys || []).map((seconds) => ({ seconds })) });

test("zoomTimes reads Motion Scale/Position, Transform and adjustment layers over the clip, converted to sequence time; touches nothing else", async () => {
  const P2 = load();
  const footage = { kind: "video", path: "/a.mp4", track: 0, start: 10, end: 30, inPt: 100, speed: 1,
    ti: ti([comp("AE.ADBE Motion", [prm("Position", null), prm("Scale", [104, 108]), prm("Opacity", [101])]), comp("AE.ADBE Lumetri", [prm("Exposure", [102])])]) };
  const adj = { kind: "video", adjustment: true, track: 2, start: 15, end: 25, inPt: 0, speed: 1,
    ti: ti([comp("AE.ADBE Geometry2", [prm("Scale", [1, 3]), prm("Skew", [2])])]) };
  const below = { kind: "video", adjustment: true, track: 0, start: 12, end: 20, inPt: 0, speed: 1, ti: ti([comp("AE.ADBE Geometry2", [prm("Scale", [1.5])])]) };
  const elsewhere = { kind: "video", path: "/b.mp4", track: 0, start: 40, end: 50, inPt: 0, speed: 1, ti: ti([comp("AE.ADBE Motion", [prm("Scale", [41])])]) };
  const timeline = { items: [footage, adj, below, elsewhere] };
  const zooms = await P2.zoomTimes(timeline, [{ start: 10, end: 30, track: 0, name: "a" }]);
  // footage keys 104, 108 (media time, In 100) -> 14, 18; the adjustment layer's 1, 3 -> 16, 18 (merged with 18); the layer below and the clip elsewhere are not read
  assert.deepStrictEqual(zooms, [14, 16, 18]);
});

test("zoomTimes: a clip or layer that cannot be read gives no zoom times, never an error", async () => {
  const P2 = load();
  const bad = { kind: "video", path: "/a.mp4", track: 0, start: 0, end: 10, inPt: 0, speed: 1, ti: { getComponentChain: async () => { throw new Error("no"); } } };
  assert.deepStrictEqual(await P2.zoomTimes({ items: [bad] }, [{ start: 0, end: 10, track: 0 }]), []);
  assert.deepStrictEqual(await P2.zoomTimes({ items: [] }, [{ start: 0, end: 10, track: 0 }]), []);
});

// ---- the audit fixes (2026-11-22) ----
const line = (k, len = 1, shot = 0, gap = 2) => ({ id: k, start: k * gap, end: k * gap + len, center: 0.5, motionY: 0.5, pieces: [{ from: k * gap, to: k * gap + len, shot }] });
const midOf = (k, len = 1, gap = 2) => k * gap + len / 2;

test("the frame cap is hard: 300 short lines each with a zoom key, 600 calm lines, 150 lines of 1.5 s", () => {
  const zoomy = Array.from({ length: 300 }, (_, k) => line(k));
  const z = P.momentsPerLine(zoomy, zoomy.map((g) => g.start + 0.5), 240);
  assert.ok(z.length <= 240 && z.length > 200, `zoomy ${z.length}`);
  const calm = Array.from({ length: 600 }, (_, k) => line(k));
  const c = P.momentsPerLine(calm, [], 240);
  assert.ok(c.length <= 240 && c.length >= 239 && c.every((m) => m.kind === "mid"), `calm ${c.length}`);
  const long = Array.from({ length: 150 }, (_, k) => line(k, 1.5, 0, 3));
  const l = P.momentsPerLine(long, [], 240);
  assert.ok(l.length <= 240, `long ${l.length}`);
  assert.strictEqual(l.filter((m) => m.kind === "mid").length, 150);                     // every middle first, start / end only while there is room
  assert.strictEqual(l.length, 240);
  for (const cap of [0, 1, 7, 50]) assert.ok(P.momentsPerLine(zoomy, zoomy.map((g) => g.start + 0.5), cap).length <= cap);
  const many = Array.from({ length: 40 }, (_, k) => ({ ...line(k, 1, 0, 2), pieces: [{ from: k * 2, to: k * 2 + 0.5, shot: 0 }, { from: k * 2 + 0.5, to: k * 2 + 1, shot: 1 }] }));
  assert.ok(P.momentsPerLine(many, [], 30).length <= 30);                                  // lines over cuts: two middles each, still capped
});

test("lines next to a zoom time or a cut keep their middle frame first; the others are thinned evenly over each shot", () => {
  const g = Array.from({ length: 600 }, (_, k) => line(k, 1, k < 300 ? 0 : 1));
  const zoomAt = midOf(120) + 1;                                                          // between lines 120 and 121: both are next to it
  const out = P.momentsPerLine(g, [zoomAt], 40);
  assert.ok(out.length <= 40);
  for (const k of [120, 121, 300]) assert.ok(out.some((m) => m.id === k && m.kind === "mid"), `line ${k}`);   // 300 = the first line of a new shot
  const calmOnes = out.filter((m) => ![120, 121, 300].includes(m.id));
  assert.ok(calmOnes.some((m) => m.id < 300) && calmOnes.some((m) => m.id > 300));         // both shots keep frames
  const firstShot = calmOnes.filter((m) => m.id < 300).length;
  assert.ok(Math.abs(firstShot - calmOnes.filter((m) => m.id > 300).length) <= 3);         // evenly: both shots have the same share
  const over = P.momentsPerLine(g, g.map((x) => x.start + 0.5), 10);                       // the urgent ones alone are over the cap: thinned evenly
  assert.strictEqual(over.length, 10);
  assert.ok(over[0].t < 100 && over[9].t > 1000);
});

const faceBox = (y, h, x = 0.4, w = 0.2) => ({ x, y, w, h });
const SHOT = [{ start: 0, end: 20 }];
const mk = (id, from, to, extra = {}) => ({ id, start: from, end: to, center: 0.5, motionY: 0.5, span: { x0: 0.3, x1: 0.7 }, pieces: [{ from, to, shot: 0 }], ...extra });

test("a line with no free place is not written and not counted as moved", () => {
  const placedLines = [{ id: 0, motionY: 0.4, keys: undefined, flag: false }, { id: 1, motionY: 0.3, flag: true }, { id: 2, motionY: 0.5, flag: false }, { id: 3, motionY: 0.2, flag: true, keys: [[0, 0.2]] }];
  const cur = new Map([[0, { motionY: 0.5 }], [1, { motionY: 0.5 }], [2, { motionY: 0.5 }], [3, { motionY: 0.5 }]]);
  const r = P.selectChanges(placedLines, cur);
  assert.deepStrictEqual(r.changes.map((p) => p.id), [0]);
  assert.deepStrictEqual(r.stuck.map((p) => p.id), [1, 3]);
  assert.strictEqual(r.unchanged, 1);
  // and a real planLanes case: text on both sides of the lane leaves the line flagged, so it would not be written
  const g = [mk(0, 1, 2)];
  const text = [{ x: 0.3, y: 0.15, w: 0.4, h: 0.62, confidence: 0.9, text: "ЦЕНА" }];
  const out = P.planLanes(g, SHOT, { 0: [{ t: 1.5, faces: [], text, own: [] }] }, P.LANES.default);
  assert.ok(out[0].flag);
  assert.strictEqual(P.selectChanges(out, new Map([[0, { motionY: 0.5 }]])).changes.length, 0);
});

test("ReShape: with no collision the output equals the older plan(); the base comes from the older frames, not the per-line ones", () => {
  const faces = [faceBox(0.2, 0.15)];
  const g = [mk(0, 1, 2), mk(1, 1, 2, { center: 0.55 }), mk(2, 4, 5)];                     // 0 and 1 are a Bulgarian/English pair
  const old = P.plan(g, SHOT, [[faces, faces, faces]]);
  const per = { 0: [{ t: 1.5, faces, text: [], own: [] }], 2: [{ t: 4.5, faces, text: [], own: [] }] };
  const out = P.planLanes(g, SHOT, per, { reshape: true }, 1 / 30, { shotFaces: [[faces, faces, faces]] });
  const pick = (o) => ({ id: o.id, role: o.role, why: o.why, targetCenter: o.targetCenter, motionY: o.motionY, keys: o.keys });
  assert.deepStrictEqual(out.map(pick), old.map(pick));
  assert.ok(out.every((o) => !o.flag));
  const lowerOnLine = { 0: [{ t: 1.5, faces: [faceBox(0.3, 0.2)], text: [], own: [] }] };            // a different face in the line's own frame
  const withBase = P.planLanes([mk(0, 1, 2)], SHOT, lowerOnLine, { reshape: true }, 1 / 30, { shotFaces: [[faces]] });
  assert.strictEqual(withBase[0].why, "under the face");                                         // base = the older frames' shotTop
});

test("ReShape: a pair placed above a low face by the rule is not 'no free place' because the pair's box touches the face", () => {
  const faces = [faceBox(0.6, 0.2)];                                                             // chin 0.8: the line goes above the face
  const g = [mk(0, 1, 2), mk(1, 1, 2, { center: 0.55 })];
  const out = P.planLanes(g, SHOT, { 0: [{ t: 1.5, faces, text: [], own: [] }] }, { reshape: true }, 1 / 30, { shotFaces: [[faces]] });
  assert.ok(out.every((o) => !o.flag && o.reason !== "no free place"), JSON.stringify(out));
  assert.strictEqual(out[0].why, "above the face");
  assert.ok(Math.abs(out[0].top - (0.6 - 0.02 - 0.035)) < 1e-9);
  const text = [{ x: 0.3, y: 0.6, w: 0.4, h: 0.02, confidence: 0.9, text: "ЦЕНА 12" }];            // on the English row, not on the Bulgarian one
  const moved = P.planLanes(g, SHOT, { 0: [{ t: 1.5, faces: [], text, own: [] }] }, { reshape: true }, 1 / 30, { shotFaces: [[faces]] });
  assert.strictEqual(moved[0].reason, "off text");
});

test("'zoom brought a face' only with a zoom time within the line or between the base frame and the line; else 'face moved in'", () => {
  const g = [mk(0, 1, 2), mk(1, 5, 6), mk(2, 9, 10)];
  const per = { 0: [{ t: 1.5, faces: [faceBox(0.2, 0.15)], text: [], own: [] }],
    1: [{ t: 5.5, faces: [faceBox(0.35, 0.15)], text: [], own: [] }], 2: [{ t: 9.5, faces: [faceBox(0.35, 0.15)], text: [], own: [] }] };
  const run = (zooms) => P.planLanes(g, SHOT, per, P.LANES.default, 1 / 30, zooms ? { zooms } : {});
  assert.strictEqual(run([3])[1].reason, "zoom brought a face");                                 // a zoom between the base frame (1.5) and the line
  assert.strictEqual(run([5.2])[1].reason, "zoom brought a face");                               // within the line
  assert.strictEqual(run([])[1].reason, "face moved in");                                        // no zoom anywhere
  assert.strictEqual(run([12])[1].reason, "face moved in");                                      // a zoom after the line
  assert.strictEqual(run([0.5])[1].reason, "face moved in");                                     // a zoom before the base frame
  assert.strictEqual(run(null)[1].reason, "zoom brought a face");                                // no zoom list given: as before
  assert.strictEqual(run([])[2].reason, "face moved in");                                        // the drop holds while the face stays
  const c = P.reasonCounts(run([]), g);
  assert.deepStrictEqual([c.zoom, c.faceIn, c.faceInAt], [0, 2, [5, 9]]);
  const text = P.describe({ mode: "lanes", moved: 3, total: 3, label: "default", laneTop: 0.46, reasons: c, kept: [], shots: [] }).lines.map((l) => l.text);
  assert.ok(text.includes("2 lines dropped because a face moved into the lane (0:05.0, 0:09.0)."));
  assert.ok(!text.some((x) => x.includes("a zoom brought")));
});

test("rows come from the SRT for every graphic: a two-row chunk that was not measured still counts as two rows", () => {
  const g = [{ id: 0, start: 1, end: 2, center: 0.5 }, { id: 1, start: 1, end: 2, center: 0.55 }, { id: 2, start: 4, end: 5, center: 0.5 }, { id: 3, start: 7, end: 8, center: 0.5 }];
  const rows = { 0: { bg: ["a", "b"], en: ["x"] }, 1: { bg: ["a", "b"], en: ["x"] }, 2: { bg: ["c", "d"] } };
  const n = P.lineCountsOf(g, rows);
  assert.deepStrictEqual([...n], [[0, 2], [1, 1], [2, 2]]);                                      // the English twin is one row; graphic 3 unknown
  const measured = new Map([[0, 0.52], [3, 0.6]]);                                               // graphic 0 (two rows, +.02) and 3 (+.1) measured
  const cal = P.calibrate(g.map((x) => ({ ...x, motionY: 0.5 })), measured, n);
  assert.strictEqual(Math.round(cal[2].center * 1000) / 1000, 0.52);                             // the unmeasured two-row line takes the two-row offset
});

test("keySeconds on a reversed clip counts from the clip's out side", () => {
  assert.deepStrictEqual(P.keySeconds({ start: 10, end: 20, inPt: 100, speed: 1, reversed: true }, [102, 108, 111]).sort((a, b) => a - b), [12, 18]);
  assert.deepStrictEqual(P.keySeconds({ start: 10, end: 20, inPt: 100, speed: 2, reversed: true }, [104]), [18]);
  assert.deepStrictEqual(P.keySeconds({ start: 10, end: 20, inPt: 100, speed: 1 }, [102]), [12]);
});

test("the press with nothing measured writes nothing and says so", () => {
  const d = P.describe({ mode: "reshape", nothingMeasured: true, moved: 0, total: 5 });
  assert.strictEqual(d.headline, "Nothing was measured: no line moved.");
});

// ---- the whole press on simulated Premiere and engine objects ----
function press({ size, engineFrames, preset = "gstroy", reshape = false }) {
  const real = Module._load;
  const calls = { transactions: 0, values: [], captionFaces: [], logs: [] };
  const prm = (name, start) => ({ displayName: name, getStartValue: async () => ({ value: { value: start } }), isTimeVarying: async () => false,
    createKeyframe: (v) => ({ v }), createSetValueAction: (k) => ({ set: k.v }) });
  const motion = prm("Position", [0.5, 0.5]);
  const graphicTi = { getComponentChain: async () => ({ getComponentCount: () => 2, getComponentAtIndex: (i) => [
    { getMatchName: async () => "AE.ADBE Text", getParamCount: () => 2, getParam: (j) => [prm("Source Text", "x"), prm("Position", [0.5, 0.5])][j] },
    { getMatchName: async () => "AE.ADBE Motion", getParamCount: () => 3, getParam: (j) => [motion, prm("Anchor Point", [0.5, 0.5]), prm("Scale", 100)][j] }][i] }) };
  const clip = { kind: "video", path: "/a.mp4", track: 0, start: 0, end: 10, inPt: 0, speed: 1, name: "A.MP4", ti: { getComponentChain: async () => ({ getComponentCount: () => 0 }) } };
  const graphic = { kind: "video", selected: true, track: 1, start: 1, end: 2, inPt: 0, speed: 1, name: "Graphic", ti: graphicTi };
  // a safe-zone template with transparency left on above everything (the user's SAFETY.png, 2026-11-22): a layer, not a shot
  const overlay = { kind: "video", path: "/SAFETY.png", track: 3, start: 0, end: 10, inPt: 0, speed: 1, name: "SAFETY.png", ti: { getComponentChain: async () => ({ getComponentCount: () => 0 }) } };
  const stubs = {
    premierepro: { PointF: class { constructor(x, y) { this.x = x; this.y = y; } }, TickTime: { createWithSeconds: (s) => ({ seconds: s }) } },
    "./store.js": { getItem: () => null, setItem() {} },
    "./engine.js": {
      status: async () => ({ frames_dir: "/frames" }),
      exportFrames: async (paths) => ({ items: paths.map((p) => ({ path: p, alpha: p.endsWith(".png") })) }),
      log: (level, msg) => calls.logs.push(msg),
      captionFaces: async (sent, project, g) => { calls.captionFaces.push(sent.length); return sent.length ? { frames: engineFrames, preset, reshape, ocr: true, lines: { 0: { bg: ["a"] } } } : { frames: [], preset, reshape, ocr: true, lines: { 0: { bg: ["a"] } } }; },
    },
    "./premiere-color.js": { exportFrames: async (seq, list) => list.map((f, i) => `/frames/f${i}.png`) },
    "./premiere.js": {
      transaction: (project, label, build) => { calls.transactions++; build({ addAction: (a) => { if (a && a.set) calls.values.push(a.set.y); } }); },
      readTimeline: async () => ({ sequence: { guid: "s", getFrameSize: async () => size }, items: [clip, graphic, overlay], fps: 30 }),
      maybe: async (o, name, ...a) => { if (!o || typeof o[name] !== "function") return undefined; try { return await o[name](...a); } catch (e) { return undefined; } },
    },
  };
  Module._load = function (request, ...rest) { return Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : real.call(this, request, ...rest); };
  try {
    delete require.cache[require.resolve("../panel/premiere-placement.js")];
    return { mod: require("../panel/premiere-placement.js"), calls };
  } finally { Module._load = real; }
}

test("the press, 9:16: the style comes from the engine before any frame, one write in the lane, the line count from the SRT", async () => {
  const { mod, calls } = press({ size: { width: 1080, height: 1920 }, engineFrames: [{ faces: [], text: { 0: { bg: 0.8 } }, boxes: { 0: { bg: { top: 0.78, bottom: 0.82, x: 0.3, w: 0.4 } } }, other: [] }] });
  const r = await mod.moveOffFaces({ path: "/p/A.prproj" }, () => {}, { style: "aula" });
  assert.strictEqual(r.mode, "lanes");
  assert.strictEqual(r.label, "GStroy");                                                           // the run's style, not the panel's
  assert.strictEqual(calls.captionFaces[0], 0);                                                    // the first engine call has no frames
  assert.strictEqual(calls.transactions, 1);
  assert.strictEqual(r.moved, 1);
  assert.ok(Math.abs(calls.values[0] - (0.5 + 0.458 + 0.0175 - 0.8)) < 1e-3, String(calls.values));
  assert.deepStrictEqual(r.shots.map((s) => s.name), ["A.MP4"]);                                  // the PNG over it is not a shot
  assert.ok(calls.logs.some((l) => /SAFETY\.png has transparency/.test(l)), calls.logs.join("\n"));
});

test("the press, nothing measured: nothing is written and it says so", async () => {
  const { mod, calls } = press({ size: { width: 1080, height: 1920 }, engineFrames: [{ error: "the frame was not written" }], reshape: true });
  const r = await mod.moveOffFaces({ path: "/p/A.prproj" }, () => {}, {});
  assert.strictEqual(r.nothingMeasured, true);
  assert.strictEqual(r.mode, "reshape");
  assert.strictEqual(calls.transactions, 0);
  assert.strictEqual(P.describe(r).headline, "Nothing was measured: no line moved.");
});

test("the press, 16:9: the older rule runs unchanged, with its note", async () => {
  const { mod, calls } = press({ size: { width: 1920, height: 1080 }, engineFrames: [{ faces: [], text: { 0: { bg: 0.8 } } }] });
  const r = await mod.moveOffFaces({ path: "/p/A.prproj" }, () => {}, { style: "gstroy" });
  assert.strictEqual(r.mode, "legacy");
  assert.ok(/16:9/.test(r.note));
  assert.strictEqual(calls.transactions, 1);
  assert.ok(Math.abs(calls.values[0] - (0.5 + 0.5 + 0.0175 - 0.8)) < 1e-3, String(calls.values));   // no face: the middle (0.50)
});
