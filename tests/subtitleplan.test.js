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
  assert.deepStrictEqual(p.skipped, ["fast (changed speed)", "back (reversed)", "nested (offline media or nested sequence)",
    "empty (no length)"]);
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
    asr_seconds: 10.2, mix_seconds: 29, skipped: ["B (дублира A1)"], review: [{ at: 66.4, word: "нища,", reason: "a month in a talk about prices" }, { at: 0.3, end: 0.8, word: "", reason: "speech without a word" }], readings: { windows: 2, seconds: 40, changed: 2, unsure: 1, changes: [{ from: "одяло,", to: "одеяло," }, { from: "одяло?", to: "одеяло?" }], commas: ["евро,"], second_opinions: [[11.9, "B"], [23.7, "A"]] },
    duplicates: [{ dropped: "C9013.MP4", kept: "fx39013.MP4", kept_snr_db: 45, dropped_snr_db: 20, kept_rest_seconds: 4 }], captions: caps, srt: "/p/Asistent_subtitles/x.srt" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, "Done: 10 subtitle lines.");
  const all = r.lines.map((l) => l.text).join("\n");
  assert.match(all, /20 words · style short \(9:16\) · 29\.97 fps · recognition 10\.2 s for 29 s of sound/);
  assert.match(all, /Check 1 uncertain word .*: 1:06\.4 "нища" — a month in a talk about prices/);   // the word, its time and why
  assert.match(all, /Corrected by the dictionary .*: "одяло" → "одеяло"\./);                       // repairs are named, once each
  assert.match(all, /Comma added .*"евро"/);
  assert.match(all, /Listen to 1 place with speech without a word .*: 0:00\.3–0:00\.8/);
  assert.match(all, /A second reading of 2 pieces .*the better one was taken for 1/);
  assert.match(all, /Timing: from Whisper, may be off by up to 0\.3 s \(the aligner is not installed\)/);
  assert.match(all, /Skipped: B \(дублира A1\)/);
  assert.match(all, /C9013\.MP4 and fx39013\.MP4 hear the same: fx39013\.MP4 was taken \(cleaner sound, 45 dB against 20 dB; 4 s of C9013\.MP4 are kept/);
  assert.match(all, /1:05\.0  Здравейте \/ приятели/);
  assert.match(all, /1:06\.0  ред {2}\?/);                        // the flagged caption is marked
  assert.match(all, /2 more lines/);
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
  assert.match(text({ ...base, timing: { method: "aligned", aligned: 59, weak: 6, error: null } }), /aligned to the sound \(59 words, 6 weak ones keep Whisper's timing\)/);
  assert.match(text({ ...base, timing: { method: "whisper", aligned: 0, weak: 0, error: "torch missing" } }), /the alignment failed \(torch missing\)/);
});

test("describeResult: corrections and an unmatched correction", () => {
  const r = describeResult({ counts: { captions: 1, words: 3, flagged: 0 }, preset: "short", fps: 25, asr_seconds: 1, mix_seconds: 2, skipped: [],
    captions: [{ start: 1, end: 2, text: "ред", flags: [] }], srt: "/p/x.srt", timing: { method: "aligned", aligned: 3, weak: 0 },
    corrections: [{ heard: "раф", said: "рафт", applied: 1 }, { heard: "нещо друго", said: "x", applied: 0 }],
    correction_errors: ["line 4: \"х =>\" - must be \"heard => said\""] });
  const all = r.lines.map((l) => l.text).join("\n");
  assert.match(all, /Corrections \(1\): "раф" → "рафт"; the new words are aligned to the sound/);
  assert.match(all, /The correction "нещо друго" → "x" did not find these words/);
  assert.match(all, /Not understood: line 4/);
});

test("switched-off or muted audio is not recognised, and a side copy says which channel it plays (0.10.6, BUG-008)", () => {
  const p = planDialogue([
    item({ name: "off", unused: true }),
    item({ name: "C0001 3fa2b1 L 3.84-13.28", track: 1 }),
    item({ name: "plain", track: 2, start: 20, end: 30 }),
  ]);
  assert.deepStrictEqual(p.skipped, ["off (switched off or on a muted track: not used)"]);
  assert.deepStrictEqual(p.use.map((x) => x.side || null), ["L", null]);
});
