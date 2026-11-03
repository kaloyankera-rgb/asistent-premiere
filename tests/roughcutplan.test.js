// node --test tests/roughcutplan.test.js
const test = require("node:test");
const assert = require("node:assert");
const { planRoughCut, describeResult, verify, clock } = require("../panel/roughcutplan.js");

const item = (o) => ({ kind: "video", track: 0, start: 0, end: 10, inPt: 0, path: "/m/a.mp4", name: "a", speed: 1, reversed: false, selected: true, ...o });

test("selected video and audio items with a file are cut; the rest is named, not silently dropped", () => {
  const items = [item({}), item({ kind: "audio", track: 1 }), item({ name: "slow", speed: 0.5 }), item({ name: "rev", reversed: true }),
    item({ name: "title", path: null }), item({ name: "other", selected: false })];
  const p = planRoughCut(items);
  assert.strictEqual(p.layout.length, 2);
  assert.strictEqual(p.selected, 5);
  assert.strictEqual(p.skipped.length, 3);
  assert.ok(p.skipped.some((s) => /променена скорост/.test(s)) && p.skipped.some((s) => /обърнат/.test(s)) && p.skipped.some((s) => /офлайн/.test(s)));
});

test("the sound for the pauses comes from the selected audio items only", () => {
  const p = planRoughCut([item({}), item({ kind: "audio", track: 2, start: 1, end: 6, inPt: 3, name: "mic" })]);
  assert.deepStrictEqual(p.dialogue, [{ path: "/m/a.mp4", start: 3, end: 8, at: 1, name: "mic", track: 2 }]);
  assert.strictEqual(planRoughCut([item({})]).dialogue.length, 0);
});

test("the layout keeps the media In point so every piece can be cut from the right place", () => {
  const p = planRoughCut([item({ inPt: 12.5, start: 4, end: 9 })]);
  assert.deepStrictEqual(p.layout[0], { kind: "video", track: 0, path: "/m/a.mp4", start: 4, end: 9, inPt: 12.5, name: "a" });
});

test("verify: pieces per track and the length must match what the engine wrote", () => {
  const want = { video: { 1: 3, 2: 3 }, audio: { 1: 3 }, frames: 300, fps: 30 };
  assert.deepStrictEqual(verify(want, { video: { 1: 3, 2: 3 }, audio: { 1: 3 }, end: 10 }), []);
  const bad = verify(want, { video: { 1: 3, 2: 2 }, audio: {}, end: 12 });
  assert.strictEqual(bad.length, 3);
  assert.match(bad.join(" "), /Видео писта 2: в секвенцията има 2 части, а трябваше 3/);
});

test("the summary says how much was taken out and what was not done", () => {
  const r = { name: "ГРУБ – x (внимателно) v1", mode: "safe", tempo: "normal", tempo_bg: "нормално", before_s: 690, after_s: 408, saved_s: 282,
    counts: { cuts: 58, pauses_seen: 80 }, speech: { asr: true, words: 900, vad: true }, review: [{ at: 75, text: "Говор без дума" }], skipped: ["x (обърнат)"] };
  const out = describeResult(r, { problems: [] });
  assert.match(out.text, /11:30 → 6:48 \(−41 %\)/);
  assert.ok(out.lines.some((l) => /58 рязания от 80 паузи/.test(l.text)));
  assert.ok(out.lines.some((l) => /Дублите и сбърканите начала още не се търсят/.test(l.text)));
  assert.ok(out.lines.some((l) => l.cls === "warn" && /1:15/.test(l.text)));
  const noModel = describeResult({ ...r, speech: { asr: false, note: "Няма модел за реч" } }, { problems: ["Видео писта 1: ..."] });
  assert.ok(noModel.lines.some((l) => /Няма модел за реч/.test(l.text)) && noModel.lines.some((l) => /Видео писта 1/.test(l.text)));
});

test("clock rounds to whole seconds without 0:60", () => {
  assert.strictEqual(clock(59.7), "1:00");
  assert.strictEqual(clock(65), "1:05");
});

test("each layout entry keeps its panel item, so its effects can be read and carried", () => {
  const a = item({ name: "a" }), b = item({ kind: "audio", track: 1, name: "b L 0.00-5.00" });
  const p = planRoughCut([a, b, item({ selected: false })]);
  assert.deepStrictEqual(p.refs, [a, b]);
  assert.strictEqual(p.refs.length, p.layout.length);
});

test("the summary names time removed for lack of sound, closed gaps and what was carried over", () => {
  const r = { name: "n", mode: "safe", tempo: "normal", tempo_bg: "нормално", before_s: 100, after_s: 40, saved_s: 60, no_sound_s: 37.5, empty_s: 4,
    counts: { cuts: 3, pauses_seen: 5 }, speech: { asr: true, words: 10, vad: true }, review: [], skipped: [] };
  const out = describeResult(r, { problems: [], notes: [{ cls: "line", text: "Пренесено от старите клипове: звук: сила." }] });
  assert.ok(out.lines.some((l) => /Махнати 37\.5 s, в които няма маркиран звук/.test(l.text)));
  assert.ok(out.lines.some((l) => /Затворени 4\.0 s празно място/.test(l.text)));
  assert.ok(out.lines.some((l) => /Пренесено от старите клипове/.test(l.text)));
  const holes = describeResult({ ...r, hole_speech_s: 6.5 }, { problems: [] });
  assert.ok(holes.lines.some((l) => l.cls === "warn" && /6\.5 s са с една камера/.test(l.text)));
});
