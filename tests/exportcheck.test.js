// Pre-export check (TODO I12, 0.10.35)
const test = require("node:test");
const assert = require("node:assert");
const X = require("../panel/exportcheck.js");

const v = (start, end, o = {}) => ({ kind: "video", track: 0, name: "C1.MP4", start, end, ...o });

test("black: a flash frame, a long gap, black at the start and at the end; hidden tracks, switched-off clips and adjustment layers show nothing", () => {
  const fps = 30;
  const items = [v(0.5, 2), v(2 + 1 / 30, 5), v(5, 8, { hidden: true }), v(5, 6), v(6, 7, { unused: true }), v(6, 9, { adjustment: true }), v(7, 10)];
  const g = X.gaps(items, 10.5, fps);
  assert.deepStrictEqual(g.map((x) => [+x.from.toFixed(3), +x.to.toFixed(3), x.frames]), [[0, 0.5, 15], [2, 2.033, 1], [6, 7, 30], [10, 10.5, 15]]);
});

test("black: clips that touch or overlap leave no gap; under half a frame is rounding", () => {
  assert.deepStrictEqual(X.gaps([v(0, 3), v(2, 5), v(5.01, 8)], 8, 30), []);
});

test("caption overlaps by time, in any order", () => {
  const o = X.overlaps([{ start: 3, end: 4 }, { start: 0, end: 2.5 }, { start: 2, end: 3 }]);
  assert.deepStrictEqual(o.map((p) => [p.a.start, p.b.start]), [[0, 2]]);
});

test("safe area: vertical frames keep text off the apps' buttons and caption; 16:9 uses title safe", () => {
  const g = [{ name: "a", start: 0, x: 0.5, y: 0.5 }, { name: "b", start: 1, x: 0.5, y: 0.86 }, { name: "c", start: 2, x: 0.9, y: 0.5 }];
  assert.deepStrictEqual(X.unsafe(g, { width: 1080, height: 1920 }).map((x) => [x.name, x.why]), [["b", "too low"], ["c", "too far right"]]);
  assert.deepStrictEqual(X.unsafe(g, { width: 1920, height: 1080 }).map((x) => x.name), []);
});

test("level: a microphone clip over -6 dBFS with its Volume; music only near 0 dBFS; unmeasured listed", () => {
  const l = X.loud([
    { track: 0, name: "mic", start: 0, peakDb: [-9, -12], gainDb: 4, speech: true },       // -5: over
    { track: 0, name: "mic ok", start: 5, peakDb: [-9], gainDb: 2, speech: true },          // -7: fine
    { track: 2, name: "song", start: 0, peakDb: [-3], gainDb: 0, speech: false },          // -3: fine for music
    { track: 2, name: "loud song", start: 9, peakDb: [-0.5], gainDb: 0, speech: false },   // -0.5: hot
    { track: 1, name: "gone", start: 0, peakDb: null, speech: true },
  ]);
  assert.deepStrictEqual(l.mic.map((c) => [c.name, c.est]), [["mic", -5]]);
  assert.deepStrictEqual(l.hot.map((c) => c.name), ["loud song"]);
  assert.deepStrictEqual(l.unmeasured.map((c) => c.name), ["gone"]);
});

test("the report: each part ok, warn or unknown; fonts are never claimed as checked", () => {
  const r = X.report({ items: [v(0, 10), { kind: "audio", track: 0, name: "Z.WAV", start: 1, end: 9, offline: true }], end: 10, fps: 30,
    frame: { width: 1080, height: 1920 }, captions: [{ index: 0, name: "Subtitles BG", lines: [{ start: 0, end: 2 }, { start: 1.5, end: 3 }] }],
    graphics: [], clips: [{ track: 0, name: "Z.WAV", start: 1, peakDb: [-10], gainDb: 0, speech: true }] });
  assert.deepStrictEqual(r.map((s) => [s.id, s.status]), [["offline", "warn"], ["black", "ok"], ["captions", "warn"], ["audio", "ok"], ["fonts", "unknown"]]);
  assert.match(r[0].lines[0], /A1 Z.WAV at 0:01.0/);
  assert.match(r[2].lines.join(" "), /overlap/);
  assert.match(r[2].lines.join(" "), /does not tell a script where they sit/);
});

test("Fix audio's L / R copies and Fill effects: only the channel the clip plays counts (NEW TEST C0728 L, 2026-11-10)", () => {
  assert.strictEqual(X.usedChannel("C0728 L 0.00-18.52", []), "L");
  assert.strictEqual(X.usedChannel("fx31031 0340a9 R 0.00-36.04", []), "R");
  assert.strictEqual(X.usedChannel("C0728.MP4", ["Volume", "Fill Left with Right"]), "R");
  assert.strictEqual(X.usedChannel("C0728.MP4", ["Volume"]), null);
  // measured: L -6.2, R -1.6 in the range; Volume -2.9 dB; the copy plays L only: about -9, not -4.4
  const l = X.loud([{ track: 1, name: "C0728 L 0.00-18.52", start: 34.3, peakDb: [-6.2, -1.6], gainDb: -2.9, speech: true, effects: ["Volume"] },
    { track: 1, name: "C0728.MP4", start: 0, peakDb: [-6.2, -1.6], gainDb: -2.9, speech: true, effects: ["Volume"] }]);
  assert.deepStrictEqual(l.mic.map((c) => [c.name, c.est]), [["C0728.MP4", -4.5]]);
});

test("a SYNC sequence's gaps between groups are not reported as black to fix", () => {
  const r = X.report({ items: [v(0, 2), v(4, 6)], end: 6, fps: 30, sequence: "SYNC – кам2", clips: [] });
  assert.strictEqual(r.find((s) => s.id === "black").status, "ok");
  assert.match(r.find((s) => s.id === "black").lines[0], /working sequence/);
});
