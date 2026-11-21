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
  const one = (shot, x, y) => [{ from: x, to: y, shot }];
  const g = [{ id: 0, start: 1, end: 2, center: 0.5, motionY: 0.5, pieces: one(0, 1, 2) },
    { id: 1, start: 1, end: 2, center: 0.55, motionY: 0.5, pieces: one(0, 1, 2) },
    { id: 2, start: 6, end: 7, center: 0.4, motionY: 0.45, pieces: one(1, 6, 7) }];
  const out = P.plan(g, shots, [[[face(0.2, 0.15)]], [[]]]);
  assert.strictEqual(out[0].targetCenter, 0.478);                            // top 0.46 + half a line
  assert.strictEqual(out[1].targetCenter, 0.513);                            // + 0.035 for English
  assert.strictEqual(out[1].role, "en");
  assert.strictEqual(out[2].why, "no face");
  assert.strictEqual(out[2].motionY, Math.round((0.45 + 0.5175 - 0.4) * 10000) / 10000);
  assert.ok(!out[0].keys && !out[2].keys);
});

test("a line over a cut keeps its shot's height until one frame before the cut, then the next shot's", () => {
  const shots = [{ start: 0, end: 5 }, { start: 5, end: 10 }];
  const g = [{ id: 0, start: 4, end: 6, center: 0.5, motionY: 0.5, pieces: [{ from: 4, to: 5, shot: 0 }, { from: 5, to: 6, shot: 1 }] }];
  const out = P.plan(g, shots, [[[face(0.2, 0.15)]], [[]]], P.RULE, 0.04);
  assert.deepStrictEqual(out[0].keys, [[4, 0.4775], [4.96, 0.4775], [5, 0.5175]]);
});

test("cover: the top visible clip per stretch; a cut splits the line; a sliver joins its neighbour", () => {
  const A = { start: 0, end: 5, track: 0 };
  const B = { start: 5, end: 10, track: 1 };
  const name = (p) => [p.from, p.to, p.clip === A ? "A" : "B"];
  assert.deepStrictEqual(P.cover(4, 6, [A, B]).map(name), [[4, 5, "A"], [5, 6, "B"]]);
  assert.deepStrictEqual(P.cover(4, 5.05, [A, B]).map(name), [[4, 5.05, "A"]]);
  const V2 = { start: 0, end: 10, track: 1 };                                // a POV stacked over another: the top one is seen
  assert.strictEqual(P.cover(1, 2, [A, V2])[0].clip, V2);
  assert.deepStrictEqual(P.cover(1, 2, []), [{ from: 1, to: 2, clip: null }]);
});

test("the moments measured per shot: up to three piece middles spread over the shot", () => {
  const shots = [{ start: 0, end: 10 }];
  const g = [0, 1, 2, 3, 4].map((k) => ({ start: k * 2, end: k * 2 + 1, pieces: [{ from: k * 2, to: k * 2 + 1, shot: 0 }] }));
  assert.deepStrictEqual(P.moments(shots, g), [[0.5, 4.5, 8.5]]);
});

test("a graphic moved by hand or keyframed is left alone; Premiere's default or Asistent's own value may move", () => {
  assert.deepStrictEqual(P.movable({ motionX: 0.5, motionY: 0.5 }), { ok: true });
  assert.deepStrictEqual(P.movable({ motionX: 0.5, motionY: 0.62 }, { x: 0.5, y: 0.62 }), { ok: true });
  assert.deepStrictEqual(P.movable({ motionX: 0.5, motionY: 0.7 }, { x: 0.5, y: 0.62 }), { ok: false, why: "moved by hand" });
  assert.deepStrictEqual(P.movable({ animated: true, motionX: 0.5, motionY: 0.5 }), { ok: false, why: "Position has keyframes" });
  assert.deepStrictEqual(P.movable({ animated: true, keyTimes: [0, 0.96, 1] }, { keys: [0, 0.96, 1] }), { ok: true, own: true });
  assert.deepStrictEqual(P.movable({ animated: true, keyTimes: [0, 0.5] }, { keys: [0, 0.96, 1] }), { ok: false, why: "Position has keyframes" });
});

test("transaction() returns nothing and throws on a refusal: no caller reads its return value (0.10.12 reported a false failure)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const f of fs.readdirSync(path.join(__dirname, "..", "panel")).filter((n) => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(__dirname, "..", "panel", f), "utf8");
    assert.ok(!/=\s*(P\.|premiere\.)?transaction\(/.test(src), `${f} reads transaction()'s return value`);
  }
});

test("measured text centres replace the estimate; unmeasured lines follow the median offset of their role", () => {
  const g = [{ id: 0, start: 1, end: 2, center: 0.65, motionY: 0.5 }, { id: 1, start: 3, end: 4, center: 0.65, motionY: 0.5 },
    { id: 2, start: 5, end: 6, center: 0.65, motionY: 0.4 }];
  const out = P.calibrate(g, new Map([[0, 0.89]]));
  assert.deepStrictEqual(out.map((x) => [Math.round(x.center * 1000) / 1000, x.est]), [[0.89, false], [0.89, false], [0.79, false]]);
});

test("nothing measured: the estimate stays and is marked", () => {
  const out = P.calibrate([{ id: 0, start: 1, end: 2, center: 0.65, motionY: 0.5 }], new Map());
  assert.deepStrictEqual([out[0].center, out[0].est], [0.65, true]);
});

test("a pair at the same height: the graphic on the higher track is English", () => {
  const g = [{ id: 0, start: 1, end: 2, center: 0.65, track: 5 }, { id: 1, start: 1, end: 2, center: 0.65, track: 4 }];
  assert.deepStrictEqual(P.roles(g), [{ id: 0, role: "en" }, { id: 1, role: "bg" }]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Lane placement (planLanes and its parts)

const LANE = { top: 0.47, k: 0.1 };
const box = (y, h = 0.03, x = 0.3, w = 0.4) => ({ x, y, w, h, confidence: 0.9, text: "xx" });
const line = (id, shot = 0, over = {}) => ({ id, start: id * 2, end: id * 2 + 1, center: 0.5, motionY: 0.5, pieces: [{ from: id * 2, to: id * 2 + 1, shot }], span: { x0: 0.3, x1: 0.7 }, ...over });
const at = (id, faces = [], text = [], own = [{ x: 0.3, y: 0.47, w: 0.4, h: 0.03 }]) => [{ t: id * 2 + 0.5, faces, text, own }];
const SHOTS = [{ start: 0, end: 20 }];

test("shot base: the lane, or under the worst-case chin + k; never above a face; no room: stays in the lane, flagged", () => {
  assert.deepStrictEqual(P.shotBase([[face(0.2, 0.15)]], LANE), { top: 0.47, why: "lane", flag: false, chin: 0.35 });   // chin .35 -> .45 < lane
  const mid = P.shotBase([[face(0.3, 0.2)]], LANE);                                                                     // chin .50
  assert.strictEqual(mid.top, 0.6);
  assert.ok(Math.abs(mid.top + 0.035 / 2 - 0.6175) < 1e-9);                                                             // centre about .62
  assert.strictEqual(P.shotBase([[face(0.4, 0.2)]], LANE).top, 0.7);                                                    // chin .60 -> centre .7175
  assert.deepStrictEqual(P.shotBase([[face(0.5, 0.2)]], LANE), { top: 0.47, why: "no free place", flag: true, chin: 0.7 });
  for (const chin of [0.3, 0.4, 0.45, 0.5, 0.55, 0.6]) {                                                                // never above a face
    const b = P.shotBase([[face(chin - 0.15, 0.15)]], LANE);
    assert.ok(b.top >= chin + LANE.k - 1e-9 || b.top === LANE.top, `chin ${chin}`);
  }
  assert.strictEqual(P.shotBase([[face(0.2, 0.1)], [face(0.3, 0.2)], []], LANE).top, 0.6);                              // the worst chin over the frames
  assert.deepStrictEqual(P.shotBase([[], []], LANE), { top: 0.47, why: "lane", flag: false, chin: null });
});

test("obstacles: every face of enough height, not the line's own words, text with confidence over the span", () => {
  const faces = [face(0.2, 0.15), face(0.3, 0.1, 0.1, 0.1), face(0.5, 0.01, 0.4, 0.05)];
  const text = [{ x: 0.32, y: 0.47, w: 0.3, h: 0.03, confidence: 0.9, text: "own words" },      // the line itself
    { x: 0.35, y: 0.7, w: 0.2, h: 0.03, confidence: 0.9, text: "price" },
    { x: 0.35, y: 0.8, w: 0.2, h: 0.03, confidence: 0.3, text: "noise" },                         // too unsure
    { x: 0.0, y: 0.8, w: 0.1, h: 0.03, confidence: 0.9, text: "corner" },                         // beside the span
    { x: 0.4, y: 0.9, w: 0.1, h: 0.03, confidence: 0.9, text: "a" }];                             // one character
  const out = P.obstacles(faces, text, [{ x: 0.3, y: 0.47, w: 0.4, h: 0.03 }], { x0: 0.3, x1: 0.7 });
  assert.deepStrictEqual(out.map((o) => o.kind), ["face", "text"]);                               // the second face is beside the span
  assert.strictEqual(out[1].y, 0.7);
  assert.strictEqual(P.obstacles(faces, [], [], null).filter((o) => o.kind === "face").length, 2);   // no span known: both faces, the tiny one never
});

test("line height: text and no face goes to the nearest free height on either side; with a face only down to chin + k and below", () => {
  const fr = (faces, text) => [{ faces, text, own: [] }];
  const b = { x0: 0.3, x1: 0.7, h: 0.035 };
  const up = P.lineHeight(0.47, fr([], [box(0.5)]), b, LANE);                                      // text just under the lane: the nearer way is up
  assert.ok(up.y < 0.47 && up.reason === "off text" && up.moved);
  const down = P.lineHeight(0.47, fr([], [box(0.45)]), b, LANE);                                   // text just above: down
  assert.ok(down.y > 0.47 && down.reason === "off text");
  // a face above at chin .38 -> floor .48: going up to .454 is not allowed, the line goes below the text
  const withFace = P.lineHeight(0.48, fr([face(0.25, 0.13)], [box(0.5)]), b, LANE);
  assert.ok(withFace.y > 0.5, `y ${withFace.y}`);
  const none = P.lineHeight(0.47, fr([], []), b, LANE);
  assert.deepStrictEqual([none.y, none.reason, none.flag, none.moved], [0.47, "lane", false, false]);
  const stuck = P.lineHeight(0.47, fr([], [box(0.2, 0.6)]), b, LANE);                              // text from .20 to .80: nowhere within .26 and above .76
  assert.deepStrictEqual([stuck.y, stuck.reason, stuck.flag], [0.47, "no free place", true]);
});

test("a zoom grows the face at line 3: only line 3 on drops, it stays down while that is free, and returns after the margin", () => {
  const chins = [0.35, 0.35, 0.5, 0.5, 0.44, 0.4];
  const g = chins.map((c, i) => line(i));
  const per = {};
  chins.forEach((c, i) => { per[i] = at(i, [face(c - 0.15, 0.15)]); });
  const out = P.planLanes(g, SHOTS, per, LANE);
  assert.deepStrictEqual(out.map((o) => o.top), [0.47, 0.47, 0.6, 0.6, 0.6, 0.47]);               // line 4 stays dropped: .44 + .012 + .03 > .47
  assert.deepStrictEqual(out.map((o) => o.reason), ["lane", "lane", "zoom brought a face", "zoom brought a face", "zoom brought a face", "lane"]);
  assert.ok(out.every((o) => !o.flag && !o.keys));
});

test("a chin at .70 leaves the line in the lane and flags it", () => {
  const out = P.planLanes([line(0)], SHOTS, { 0: at(0, [face(0.5, 0.2)]) }, LANE);
  assert.deepStrictEqual([out[0].top, out[0].reason, out[0].flag], [0.47, "no free place", true]);
});

test("a chunk of two lines keeps the top of its first line (it grows downward)", () => {
  const f = { 0: at(0, [face(0.2, 0.15)]), 1: at(1, [face(0.2, 0.15)]) };
  const out = P.planLanes([line(0, 0, { lines: 1 }), line(1, 0, { lines: 2 })], SHOTS, f, LANE);
  assert.strictEqual(out[0].top, out[1].top);
  assert.ok(Math.abs(out[1].targetCenter - out[0].targetCenter - 0.0175) < 0.001);              // the centre is half a line lower
});

test("an unknown Style gets the pooled lane; the known ones their own", () => {
  assert.strictEqual(P.laneFor("short"), P.LANES.default);
  assert.strictEqual(P.laneFor(undefined), P.LANES.default);
  assert.strictEqual(P.laneFor("reshape"), P.LANES.default);
  for (const s of ["gstroy", "credissimo", "ekopak", "beautysector", "aula"]) assert.strictEqual(P.laneFor(s), P.LANES[s]);
  assert.strictEqual(P.laneFor("AULA"), P.LANES.aula);
  assert.strictEqual(P.laneFor("constructor"), P.LANES.default);
});

test("ReShape mode with no text and no collision equals plan()", () => {
  const shots = [{ start: 0, end: 5 }, { start: 5, end: 10 }];
  const g = [{ id: 0, start: 1, end: 2, center: 0.5, motionY: 0.5, pieces: [{ from: 1, to: 2, shot: 0 }] },
    { id: 1, start: 1, end: 2, center: 0.55, motionY: 0.5, pieces: [{ from: 1, to: 2, shot: 0 }] },
    { id: 2, start: 4, end: 6, center: 0.4, motionY: 0.45, pieces: [{ from: 4, to: 5, shot: 0 }, { from: 5, to: 6, shot: 1 }] },
    { id: 3, start: 7, end: 8, center: 0.4, motionY: 0.45, pieces: [{ from: 7, to: 8, shot: 1 }] }];
  const faces0 = [[face(0.2, 0.15)], [face(0.21, 0.15)]];
  const faces1 = [[face(0.6, 0.2)]];                                                              // a low face: the line goes above it
  const per = {
    0: [{ t: 1.5, faces: faces0[0], text: [], own: [] }], 2: [{ t: 4.5, faces: faces0[1], text: [], own: [] }, { t: 5.5, faces: faces1[0], text: [], own: [] }],
    3: [{ t: 7.5, faces: faces1[0], text: [], own: [] }],
  };
  const a = P.plan(g, shots, [faces0, faces1], P.RULE, 0.04);
  const b = P.planLanes(g, shots, per, { reshape: true }, 0.04);
  const pick = (o) => ({ id: o.id, role: o.role, why: o.why, targetCenter: o.targetCenter, motionY: o.motionY, keys: o.keys });
  assert.deepStrictEqual(b.map(pick), a.map(pick));
  assert.ok(b.every((o) => !o.flag));
});

test("ReShape mode: text on the line's own frame moves it off the text; the rule's own height stays the base", () => {
  const shots = [{ start: 0, end: 10 }];
  const g = [{ id: 0, start: 1, end: 2, center: 0.5, motionY: 0.5, span: { x0: 0.3, x1: 0.7 }, pieces: [{ from: 1, to: 2, shot: 0 }] }];
  const faces = [face(0.2, 0.15)];                                                                // chin .35 -> top .46
  const clear = P.planLanes(g, shots, { 0: [{ t: 1.5, faces, text: [], own: [] }] }, { reshape: true });
  assert.strictEqual(clear[0].top, 0.46);
  const text = [box(0.47, 0.03)];
  const moved = P.planLanes(g, shots, { 0: [{ t: 1.5, faces, text, own: [] }] }, { reshape: true });
  assert.strictEqual(moved[0].reason, "off text");
  assert.ok(moved[0].top > 0.5 || moved[0].top + 0.035 < 0.47 - 0.009);
  assert.ok(Math.abs(moved[0].top - 0.46) > 0.02);
});

test("a hand-moved or keyframed line is still skipped by movable()", () => {
  assert.strictEqual(P.movable({ motionX: 0.5, motionY: 0.48 }).ok, false);
  assert.strictEqual(P.movable({ animated: true, keyTimes: [1, 2] }).ok, false);
  assert.strictEqual(P.movable({ motionX: 0.5, motionY: 0.5 }).ok, true);
});

test("a line over a cut: the lane height on both sides is one value, the next shot's face moves only its own piece", () => {
  const shots = [{ start: 0, end: 5 }, { start: 5, end: 10 }];
  const g = [{ id: 0, start: 4, end: 6, center: 0.5, motionY: 0.5, span: { x0: 0.3, x1: 0.7 }, pieces: [{ from: 4, to: 5, shot: 0 }, { from: 5, to: 6, shot: 1 }] }];
  const per = { 0: [{ t: 4.5, faces: [face(0.2, 0.15)], text: [], own: [] }, { t: 5.5, faces: [face(0.35, 0.15)], text: [], own: [] }] };
  const out = P.planLanes(g, shots, per, LANE, 0.04);
  assert.deepStrictEqual(out[0].tops, [0.47, 0.6]);                                              // chin .35 -> lane; chin .50 -> .60
  assert.strictEqual(out[0].keys.length, 3);
  assert.strictEqual(out[0].keys[2][0], 5);
});

test("moments per line: the middle of each; start and end of a long line or one crossing a zoom time; thinned over the cap", () => {
  const g = [0, 1, 2, 3].map((k) => ({ id: k, start: k * 3, end: k * 3 + 1, center: 0.5, pieces: [{ from: k * 3, to: k * 3 + 1, shot: 0 }] }));
  g[1].end = 4 + 0.6; g[1].pieces = [{ from: 3, to: 4.6, shot: 0 }];                              // 1.6 s: long
  const plain = P.momentsPerLine(g, []);
  assert.deepStrictEqual(plain.map((m) => [m.id, m.kind]), [[0, "mid"], [1, "start"], [1, "mid"], [1, "end"], [2, "mid"], [3, "mid"]]);
  const zoomed = P.momentsPerLine(g, [6.5]);                                                      // inside line 2 (6..7)
  assert.deepStrictEqual(zoomed.filter((m) => m.id === 2).map((m) => m.kind), ["start", "mid", "end"]);
  const many = Array.from({ length: 10 }, (_, k) => ({ id: k, start: k * 3, end: k * 3 + 1, center: 0.5, pieces: [{ from: k * 3, to: k * 3 + 1, shot: 0 }] }));
  const thin = P.momentsPerLine(many, [], 6);
  assert.ok(thin.length <= 6 && thin.length >= 5);
  assert.ok(thin.every((m) => m.kind === "mid"));
  assert.strictEqual(P.momentsPerLine(many, [], 240).length, 10);
  const pair = [{ id: 0, start: 1, end: 2, center: 0.5 }, { id: 1, start: 1, end: 2, center: 0.55 }];   // an English twin is not measured
  assert.deepStrictEqual(P.momentsPerLine(pair, []).map((m) => m.id), [0]);
});

test("calibrate with a line count keeps offsets per role and number of lines; without it, as before", () => {
  const g = [{ id: 0, start: 1, end: 2, center: 0.6, motionY: 0.5 }, { id: 1, start: 3, end: 4, center: 0.6, motionY: 0.5 },
    { id: 2, start: 5, end: 6, center: 0.6, motionY: 0.5 }, { id: 3, start: 7, end: 8, center: 0.6, motionY: 0.5 }];
  const measured = new Map([[0, 0.52], [1, 0.55]]);                                               // offsets +.02 (one line) and +.05 (two lines)
  const counts = new Map([[0, 1], [1, 2], [2, 1], [3, 2]]);
  const out = P.calibrate(g, measured, counts);
  assert.deepStrictEqual(out.map((x) => [Math.round(x.center * 1000) / 1000, x.est]), [[0.52, false], [0.55, false], [0.52, false], [0.55, false]]);
  const old = P.calibrate(g, measured);
  assert.deepStrictEqual(old.map((x) => Math.round(x.center * 1000) / 1000), [0.52, 0.55, 0.535, 0.535]);
});
