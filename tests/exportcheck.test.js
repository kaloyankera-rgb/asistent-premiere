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
  assert.match(r[0].lines[0], /A1 Z.WAV at 00:00:01:00/);
  assert.deepStrictEqual(r[0].times, [1]);
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

test("0.10.44: the report has a 'Picture fills the frame' part when the clips' frames are known", () => {
  const { report } = require("../panel/exportcheck.js");
  const items = [{ kind: "video", track: 0, name: "talk.mp4", start: 0, end: 20, path: "/m/talk.mp4" },
    { kind: "video", track: 1, name: "broll.mp4", start: 5, end: 9, path: "/m/broll.mp4" }];
  const pictures = [
    { name: "talk.mp4", track: 0, start: 0, end: 20, path: "/m/talk.mp4", kind: "video", samples: [{ at: 0, m: { sw: 100 } }] },
    { name: "broll.mp4", track: 1, start: 5, end: 9, path: "/m/broll.mp4", kind: "video", samples: [{ at: 5, m: { sw: 88 } }] },
    { name: "logo.png", track: 2, start: 0, end: 20, path: "/m/logo.png", kind: "video", samples: [{ at: 0, m: { sw: 20 } }] },
  ];
  const files = { "/m/talk.mp4": { width: 1080, height: 1920 }, "/m/broll.mp4": { width: 3840, height: 2160 }, "/m/logo.png": { width: 500, height: 500, alpha: true } };
  const parts = report({ items, end: 20, fps: 30, frame: { width: 1080, height: 1920 }, pictures, files });
  const fill = parts.find((p) => p.id === "fill");
  assert.equal(fill.status, "warn");
  assert.match(fill.lines[0], /^V2 broll\.mp4 at 00:00:05:00: 10 px at the top and bottom uncovered \(scale 88 %\); V1 talk\.mp4 shows through$/);
  assert.ok(fill.lines.some((l) => /1 logo, graphic or transparent file was not checked/.test(l)));
  assert.equal(report({ items, end: 20, fps: 30, frame: { width: 1080, height: 1920 } }).some((p) => p.id === "fill"), false);
});


// ---- 0.10.45: the user's ReShape check ("0:58.1–2:23.9: 85.9 s of black"; "I need time stamps maybe added markers")

test("timecode as Premiere shows it: drop frame at 59.94 / 29.97, plain at whole rates", () => {
  assert.strictEqual(X.timecode(1748 / 59.94005994005994, 59.94005994005994), "00;00;29;08");
  assert.strictEqual(X.timecode(5, 30), "00:00:05:00");
  assert.strictEqual(X.timecode(1800 / 29.97002997, 29.97002997), "00;01;00;02");          // frame numbers 00 and 01 are skipped at a minute
  assert.strictEqual(X.timecode(17982 / 29.97002997, 29.97002997), "00;10;00;00");         // but not at every tenth minute
  assert.strictEqual(X.timecode(3.25, 0), "0:03.3");
});

test("music running on after the picture is not black inside the export: it is said as a sound-only tail", () => {
  const items = [v(0, 58.1), { kind: "audio", track: 3, name: "music.mp3", start: 0, end: 143.9 }];
  const r = X.report({ items, end: 143.9, fps: 30, clips: [] });
  const black = r.find((s) => s.id === "black");
  assert.strictEqual(black.lines.length, 1);
  assert.match(black.lines[0], /only sound after the last picture/);
  assert.match(black.lines[0], /set an Out point at 00:00:58:03/);
  assert.strictEqual(black.times[0], 58.1);
  // with an Out point at the end of the picture there is nothing to say
  const ranged = X.report({ items, end: 143.9, fps: 30, clips: [], range: { from: 0, to: 58.1 } });
  assert.strictEqual(ranged.find((s) => s.id === "black").status, "ok");
  assert.match(ranged[0].note, /Out \(00:00:58:03\)/);
});

test("a gap inside the In / Out is found; one outside it is not", () => {
  const items = [v(0, 10), v(12, 30), v(40, 50)];
  const r = X.report({ items, end: 50, fps: 30, clips: [], range: { from: 0, to: 30 } });
  const black = r.find((s) => s.id === "black");
  assert.deepStrictEqual(black.times, [10]);
});

test("markers: one per timed problem, never twice at the same place", () => {
  const items = [v(0, 10), v(12, 20), { kind: "audio", track: 0, name: "Z.WAV", start: 1, end: 9, offline: true }];
  const parts = X.report({ items, end: 20, fps: 30, clips: [] });
  const m = X.markers(parts, [], 30);
  assert.deepStrictEqual(m.map((x) => [x.name, x.at]), [["Check: Offline media", 1], ["Check: Black gaps", 10]]);
  assert.deepStrictEqual(X.markers(parts, [{ name: "Check: Black gaps", at: 10.001 }], 30).map((x) => x.at), [1]);
});
