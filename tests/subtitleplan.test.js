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

test("duplicates are left to the engine: every eligible item is sent, in timeline order, with its track", () => {
  const p = planDialogue([
    item({ name: "POV2", track: 2, path: "/pov2.mp4" }),
    item({ name: "lav", track: 0, path: "/lav.wav" }),
    item({ name: "later", track: 1, start: 20, end: 30 }),
  ]);
  assert.deepStrictEqual(p.use.map((x) => [x.name, x.track]), [["lav", 0], ["POV2", 2], ["later", 1]]);
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
  const caps = Array.from({ length: 10 }, (_, i) => ({ start: 65 + i, end: 66 + i, text: i === 0 ? "Здравейте\nприятели" : "ред", flags: i === 1 ? [{ word: "нища,", p: 0.45, at: 66.4 }] : [] }));
  const r = describeResult({ counts: { captions: 10, words: 20, flagged: 1 }, preset: "short", fps: 29.97002997, cached: false,
    asr_seconds: 10.2, mix_seconds: 29, skipped: ["B (дублира A1)"], review: [{ at: 66.4, word: "нища,", reason: "месец в разговор за цени" }, { at: 0.3, end: 0.8, word: "", reason: "има говор без дума" }], readings: { windows: 2, seconds: 40, changed: 2, unsure: 1, changes: [{ from: "одяло,", to: "одеяло," }, { from: "одяло?", to: "одеяло?" }], commas: ["евро,"], second_opinions: [[11.9, "B"], [23.7, "A"]] },
    duplicates: [{ dropped: "C9013.MP4", kept: "fx39013.MP4", kept_snr_db: 45, dropped_snr_db: 20, kept_rest_seconds: 4 }], captions: caps, srt: "/p/Asistent_subtitles/x.srt" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, "Готово: 10 реда субтитри.");
  const all = r.lines.map((l) => l.text).join("\n");
  assert.match(all, /20 думи · вид кратки \(9:16\) · 29\.97 fps · разпознаване 10\.2 s за 29 s звук/);
  assert.match(all, /Провери 1 несигурна дума .*: 1:06\.4 „нища“ — месец в разговор за цени/);   // the word, its time and why
  assert.match(all, /Поправени по речника .*: „одяло“ → „одеяло“\./);                       // repairs are named, once each
  assert.match(all, /Добавена запетая .*„евро“/);
  assert.match(all, /Чуй 1 място с говор без дума .*: 0:00\.3–0:00\.8/);
  assert.match(all, /Втори прочит на 2 парчета .*за 1 е взет по-добрият/);
  assert.match(all, /Времена: от Whisper, може да са неточни с до 0,3 s \(подравняването не е инсталирано\)/);
  assert.match(all, /Пропуснат: B \(дублира A1\)/);
  assert.match(all, /C9013\.MP4 и fx39013\.MP4 чуват едно и също: взет е fx39013\.MP4 \(по-чист звук, 45 dB срещу 20 dB; 4 s от C9013\.MP4 са запазени/);
  assert.match(all, /1:05\.0  Здравейте \/ приятели/);
  assert.match(all, /1:06\.0  ред {2}\?/);                        // the flagged caption is marked
  assert.match(all, /още 2 реда/);
  assert.match(all, /\/p\/Asistent_subtitles\/x\.srt/);
});

test("describeResult: no speech is a warning, not a success", () => {
  const r = describeResult({ counts: { captions: 0, words: 0, flagged: 0 }, preset: "short", fps: 25, captions: [], skipped: [] });
  assert.strictEqual(r.ok, false);
});

test("describeResult: says whether the times were aligned to the sound, or why not", () => {
  const base = { counts: { captions: 1, words: 3, flagged: 0 }, preset: "short", fps: 25, asr_seconds: 1, mix_seconds: 2, skipped: [],
    captions: [{ start: 0, end: 1, text: "а", flags: [] }], srt: "/x.srt" };
  const text = (r) => describeResult(r).lines.map((l) => l.text).join("\n");
  assert.match(text({ ...base, timing: { method: "aligned", aligned: 59, weak: 6, error: null } }), /подравнени по звука \(59 думи, 6 слаби остават от Whisper\)/);
  assert.match(text({ ...base, timing: { method: "whisper", aligned: 0, weak: 0, error: "torch missing" } }), /подравняването не успя \(torch missing\)/);
});

test("describeResult: corrections and an unmatched correction", () => {
  const r = describeResult({ counts: { captions: 1, words: 3, flagged: 0 }, preset: "short", fps: 25, asr_seconds: 1, mix_seconds: 2, skipped: [],
    captions: [{ start: 1, end: 2, text: "ред", flags: [] }], srt: "/p/x.srt", timing: { method: "aligned", aligned: 3, weak: 0 },
    corrections: [{ heard: "раф", said: "рафт", applied: 1 }, { heard: "нещо друго", said: "x", applied: 0 }],
    correction_errors: ["ред 4: „х =>“ - трябва да е „чуто => казано“"] });
  const all = r.lines.map((l) => l.text).join("\n");
  assert.match(all, /Корекции \(1\): „раф“ → „рафт“; новите думи са подравнени по звука/);
  assert.match(all, /Корекцията „нещо друго“ → „x“ не намери тези думи/);
  assert.match(all, /Не разбирам: ред 4/);
});
