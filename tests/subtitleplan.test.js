// node --test tests/subtitleplan.test.js
const test = require("node:test");
const assert = require("node:assert");
const { planDialogue, sizeFrom, dirOf, describeResult } = require("../panel/subtitleplan.js");

const item = (o) => ({ kind: "audio", track: 0, start: 0, end: 10, inPt: 0, path: "/a.wav", name: "A", speed: 1,
  reversed: false, selected: true, ...o });

test("only selected audio items with a file make the dialogue; media in/out and sequence start are kept", () => {
  const p = planDialogue([
    item({ name: "A", start: 4, end: 9, inPt: 12 }),
    item({ name: "video", kind: "video" }),
    item({ name: "not selected", selected: false, track: 1 }),
  ]);
  assert.strictEqual(p.selected, 1);
  assert.deepStrictEqual(p.use, [{ path: "/a.wav", start: 12, end: 17, at: 4, name: "A", track: 0 }]);
  assert.deepStrictEqual(p.skipped, []);
});

test("speed, reversed, offline and empty items are skipped and named with the reason", () => {
  const p = planDialogue([
    item({ name: "fast", speed: 2 }),
    item({ name: "back", reversed: true, track: 1 }),
    item({ name: "nested", path: null, track: 2 }),
    item({ name: "empty", start: 5, end: 5, track: 3 }),
    item({ name: "ok", track: 4, start: 20, end: 30 }),
  ]);
  assert.deepStrictEqual(p.use.map((x) => x.name), ["ok"]);
  assert.deepStrictEqual(p.skipped, ["fast (променена скорост)", "back (обърнат)", "nested (офлайн медия или вложена секвенция)",
    "empty (без дължина)"]);
});

test("the same speech on two tracks is transcribed once: the lowest track wins", () => {
  const p = planDialogue([
    item({ name: "POV2", track: 2, path: "/pov2.mp4" }),
    item({ name: "lav", track: 0, path: "/lav.wav" }),
    item({ name: "POV1", track: 1, path: "/pov1.mp4", start: 1, end: 11 }),       // 90 % covered by A1
  ]);
  assert.deepStrictEqual(p.use.map((x) => x.name), ["lav"]);
  assert.deepStrictEqual(p.skipped, ["POV1 (пропуснат, дублира A1)", "POV2 (пропуснат, дублира A1)"]);
});

test("items that only touch, or overlap by less than half, are both kept; same track never duplicates itself", () => {
  const p = planDialogue([
    item({ name: "one", track: 0, start: 0, end: 10 }),
    item({ name: "two", track: 1, start: 8, end: 20 }),                           // overlap 2 of 12 s
    item({ name: "three", track: 0, start: 10, end: 14 }),
  ]);
  assert.deepStrictEqual(p.use.map((x) => x.name), ["one", "two", "three"]);
  assert.deepStrictEqual(p.skipped, []);
});

test("nothing selected is reported as selected = 0", () => {
  assert.strictEqual(planDialogue([item({ selected: false })]).selected, 0);
});

test("sizeFrom understands width/height, a rect and a pair, and refuses anything else", () => {
  assert.deepStrictEqual(sizeFrom({ width: 1080, height: 1920 }), { width: 1080, height: 1920 });
  assert.deepStrictEqual(sizeFrom({ left: 0, top: 0, right: 1920, bottom: 1080 }), { width: 1920, height: 1080 });
  assert.deepStrictEqual(sizeFrom([1080, 1080]), { width: 1080, height: 1080 });
  for (const bad of [null, undefined, 5, {}, { width: 0, height: 10 }, { width: "1", height: "2" }]) assert.strictEqual(sizeFrom(bad), null);
});

test("dirOf takes the folder of a project path on both systems", () => {
  assert.strictEqual(dirOf("/Users/a/Projects/x.prproj"), "/Users/a/Projects");
  assert.strictEqual(dirOf("C:\\Projects\\x.prproj"), "C:\\Projects");
  assert.strictEqual(dirOf("x.prproj"), null);
  assert.strictEqual(dirOf(""), null);
});

test("describeResult: counts, uncertain words, skipped clips, first captions, file", () => {
  const caps = Array.from({ length: 10 }, (_, i) => ({ start: 65 + i, end: 66 + i, text: i === 0 ? "Здравейте\nприятели" : "ред", flags: i === 1 ? [{}] : [] }));
  const r = describeResult({ counts: { captions: 10, words: 20, flagged: 1 }, preset: "short", fps: 29.97002997, cached: false,
    asr_seconds: 10.2, mix_seconds: 29, skipped: ["B (дублира A1)"], captions: caps, srt: "/p/Asistent_subtitles/x.srt" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, "Готово: 10 реда субтитри.");
  const all = r.lines.map((l) => l.text).join("\n");
  assert.match(all, /20 думи · вид кратки \(9:16\) · 29\.97 fps · разпознаване 10\.2 s за 29 s звук/);
  assert.match(all, /1 несигурни думи/);
  assert.match(all, /Пропуснат: B \(дублира A1\)/);
  assert.match(all, /1:05\.0  Здравейте \/ приятели/);
  assert.match(all, /1:06\.0  ред {2}\?/);                        // the flagged caption is marked
  assert.match(all, /още 2 реда/);
  assert.match(all, /\/p\/Asistent_subtitles\/x\.srt/);
});

test("describeResult: no speech is a warning, not a success", () => {
  const r = describeResult({ counts: { captions: 0, words: 0, flagged: 0 }, preset: "short", fps: 25, captions: [], skipped: [] });
  assert.strictEqual(r.ok, false);
});
