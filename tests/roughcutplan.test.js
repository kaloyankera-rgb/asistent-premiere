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
  assert.ok(p.skipped.some((s) => /changed speed/.test(s)) && p.skipped.some((s) => /reversed/.test(s)) && p.skipped.some((s) => /offline/.test(s)));
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

test("audio on a muted track or switched off is left out of the layout and the speech, and said once per track", () => {
  const mic = { kind: "audio", track: 1, path: "/m/lav.mp4", start: 0, end: 10, inPt: 0, name: "lav", speed: 1, selected: true };
  const scratch = (k) => ({ kind: "audio", track: 0, path: "/m/cam.mp4", start: k * 10, end: k * 10 + 10, inPt: 0, name: `cam${k}`, speed: 1, selected: true, unused: true });
  const p = planRoughCut([item({}), mic, scratch(0), scratch(1)]);
  assert.deepStrictEqual(p.layout.map((x) => x.name), ["a", "lav"]);
  assert.deepStrictEqual(p.dialogue.map((x) => x.name), ["lav"]);
  assert.deepStrictEqual(p.skipped, ["A1: 2 audio clips on a muted track or switched off, not used"]);
  assert.strictEqual(planRoughCut([item({}), { ...mic, unused: false }]).skipped.length, 0);
});

test("verify: pieces per track and the length must match what the engine wrote", () => {
  const want = { video: { 1: 3, 2: 3 }, audio: { 1: 3 }, frames: 300, fps: 30 };
  assert.deepStrictEqual(verify(want, { video: { 1: 3, 2: 3 }, audio: { 1: 3 }, end: 10 }), []);
  const bad = verify(want, { video: { 1: 3, 2: 2 }, audio: {}, end: 12 });
  assert.strictEqual(bad.length, 3);
  assert.match(bad.join(" "), /Video track 2: the sequence has 2 pieces, it should have 3/);
});

test("the summary says how much was taken out and what was not done", () => {
  const r = { name: "ROUGH – x (safe) v1", mode: "safe", tempo: "normal", tempo_label: "normal", before_s: 690, after_s: 408, saved_s: 282,
    counts: { cuts: 58, pauses_seen: 80 }, speech: { asr: true, words: 900, vad: true }, review: [{ at: 75, text: "Speech without a word" }], skipped: ["x (reversed)"] };
  const out = describeResult(r, { problems: [] });
  assert.match(out.text, /11:30 → 6:48 \(−41 %\)/);
  assert.ok(out.lines.some((l) => /58 cuts from 80 pauses/.test(l.text)));
  assert.ok(out.lines.some((l) => /Found no repeated takes or false starts/.test(l.text)));
  assert.ok(out.lines.some((l) => l.cls === "warn" && /1:15/.test(l.text)));
  const noModel = describeResult({ ...r, speech: { asr: false, note: "No speech model" } }, { problems: ["Video track 1: ..."] });
  assert.ok(noModel.lines.some((l) => /No speech model/.test(l.text)) && noModel.lines.some((l) => /Video track 1/.test(l.text)));
});

test("repeated takes: what went, what waits for a look, what only Smart takes", () => {
  const take = (start, text) => ({ start, end: start + 4, text, n_words: 6, ends: true });
  const r = { name: "ROUGH – x v1", mode: "safe", tempo: "normal", before_s: 100, after_s: 80, saved_s: 20, counts: { cuts: 3, pauses_seen: 5 },
    speech: { asr: true, words: 90, vad: true }, review: [], skipped: [], takes_cut_s: 19.6,
    takes: [{ kind: "exact", kind_label: "repeated take", recommended: 1, safe: true, applied: true, cut_s: 19.6, out_at: 12, lost: [],
      takes: [take(10, "Днес ще ви покажа три неща."), take(30, "Днес ще ви покажа три неща.")] },
    { kind: "near", kind_label: "repeated take (nearly the same)", recommended: 0, safe: false, applied: false, cut_s: 0, out_at: 50, lost: ["300"],
      takes: [take(70, "Под 200 евро."), take(90, "Под 300 евро.")] },
    { kind: "restart", kind_label: "repeated start", recommended: 1, safe: true, applied: false, cut_s: 0, out_at: 60, lost: [],
      takes: [take(95, "днес ще ви"), take(96, "днес ще ви")] }] };
  const out = describeResult(r, { problems: [] });
  assert.ok(out.lines.some((l) => /Said again: 3 places, 1 cut \(19\.6 s\)/.test(l.text)));
  assert.ok(out.lines.some((l) => l.cls === "reason" && /0:12: repeated take ×2; kept #2 "Днес ще ви покажа три неща\.", the other was cut \(19\.6 s\)/.test(l.text)));
  assert.ok(out.lines.some((l) => l.cls === "warn" && /said differently \(300\): nothing cut/.test(l.text)));
  assert.ok(out.lines.some((l) => /cut only in Smart mode/.test(l.text)));
  const none = describeResult({ ...r, takes: [], speech: { asr: false } }, { problems: [] });
  assert.ok(!none.lines.some((l) => /Said again|repeated takes/.test(l.text)));
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
  const r = { name: "n", mode: "safe", tempo: "normal", tempo_label: "normal", before_s: 100, after_s: 40, saved_s: 60, no_sound_s: 37.5, empty_s: 4,
    counts: { cuts: 3, pauses_seen: 5 }, speech: { asr: true, words: 10, vad: true }, review: [], skipped: [] };
  const out = describeResult(r, { problems: [], notes: [{ cls: "line", text: "Carried over from the old clips: audio: level." }] });
  assert.ok(out.lines.some((l) => /37\.5 s taken out where no selected audio/.test(l.text)));
  assert.ok(out.lines.some((l) => /4\.0 s of empty space/.test(l.text)));
  assert.ok(out.lines.some((l) => /Carried over from the old clips/.test(l.text)));
  const holes = describeResult({ ...r, hole_speech_s: 6.5 }, { problems: [] });
  assert.ok(holes.lines.some((l) => l.cls === "warn" && /6\.5 s have only one camera/.test(l.text)));
});

test("rough cut: a track the plan did not have fails the check, and every piece is checked (0.10.6, ARCH-004)", () => {
  const { verifyPieces } = require("../panel/roughcutplan.js");
  const want = { video: { 1: 1 }, audio: { 1: 1 }, frames: 250, fps: 25 };
  assert.match(verify(want, { video: { 1: 1, 3: 9 }, audio: { 1: 1 }, end: 10 }).join(), /Video track 3 has 9 pieces/);
  const pieces = [{ kind: "video", track: 0, path: "/m/a.mp4", src_in: 50, start: 0 }, { kind: "audio", track: 0, path: "/m/a.mp4", src_in: 50, start: 0 }];
  const ok = [{ kind: "video", track: 0, path: "/m/a.mp4", inPt: 2, start: 0 }, { kind: "audio", track: 0, path: "/m/a.mp4", inPt: 2, start: 0 }];
  assert.deepStrictEqual(verifyPieces(pieces, ok, 25), []);
  const wrong = [{ ...ok[0], path: "/m/b.mp4" }, { ...ok[1], inPt: 3 }];
  const bad = verifyPieces(pieces, wrong, 25);
  assert.match(bad[0], /V1 at 0:00: another file \(b\.mp4\)/);
  assert.match(bad[1], /A1 at 0:00: another part of the file/);
  assert.match(verifyPieces(pieces, [], 25)[0], /missing/);
});

test("rough cut: a switched-off clip or a hidden video track is left out and named (0.10.6, BUG-009)", () => {
  const items = [
    { kind: "video", track: 0, path: "/a.mp4", start: 0, end: 5, inPt: 0, name: "A", selected: true, speed: 1 },
    { kind: "video", track: 1, path: "/b.mp4", start: 0, end: 5, inPt: 0, name: "B", selected: true, speed: 1, unused: true },
    { kind: "video", track: 2, path: "/c.mp4", start: 0, end: 5, inPt: 0, name: "C", selected: true, speed: 1, hidden: true },
    { kind: "audio", track: 0, path: "/a.mp4", start: 0, end: 5, inPt: 0, name: "A", selected: true, speed: 1 },
  ];
  const p = planRoughCut(items);
  assert.deepStrictEqual(p.layout.map((x) => x.name), ["A", "A"]);
  assert.ok(p.skipped.some((s) => /B \(switched off/.test(s)) && p.skipped.some((s) => /C \(on V3, whose output is off/.test(s)));
});

test("Cut silences: the result says what went, how it listened and each microphone's levels", () => {
  const R = require("../panel/roughcutplan.js");
  const r = { mode: "silence", what: "offmic", method: "auto", action: "remove", tempo: "measured", tempo_label: "measured", threshold: null,
    settings: { min_silence: 0.87, before: 0.15, after: 0.22 }, by_kind: { silence: 18, offmic: 12 }, flagged: 1, restored: 2, takes: [],
    quiet: { cut: true, under_db: 8, seconds: 12 },
    before_s: 100, after_s: 70, saved_s: 30, name: "NO SILENCE – SYNC v1", counts: { cuts: 12 }, no_sound_s: 4.2, flashes_dropped: 0,
    speech: { asr: false, vad: true, listened: [{ name: "C0737.MP4", floor: -63, voice: -33, open: -46, main: -22.3, speech_s: 51.2 }] }, skipped: [] };
  const d = R.describeResult(r, { notes: [], problems: [] });
  assert.match(d.text, /^Done: 1:40 → 1:10 \(−30 %\)\. Sequence: NO SILENCE – SYNC v1\.$/);
  const all = d.lines.map((l) => l.text).join("\n");
  assert.match(all, /12 parts taken out, 30\.0 s\. Cut: silences and off-mic voices\. Pacing measured \(pauses from 0\.87 s; 0\.15 s kept before speech, 0\.22 s after\)/);
  assert.match(all, /silence 18\.0 s · off-mic voices 12\.0 s/);
  assert.match(all, /each with its own threshold; Silero kept quiet speech/);
  assert.match(all, /C0737\.MP4: noise -63 dB, voice -33 dB, speech from -46 dB, main voice -22\.3 dB/);
  assert.match(all, /12\.0 s of off-mic voices cut \(more than 8 dB under the main voice/);
  assert.match(all, /1 part was not sure and kept/);
  assert.match(all, /2 parts kept by your choice in the preview/);
  assert.match(all, /4\.2 s with no selected sound/);
  assert.ok(!/recogni|\bwords?\b/i.test(all), all);
  // Silences only says that every voice stayed; Manual dB says the number decided
  const plain = R.describeResult({ ...r, what: "silence", quiet: { cut: false, seconds: 0 }, by_kind: { silence: 30 }, flagged: 0, restored: 0 }, null);
  assert.match(plain.lines.map((l) => l.text).join("\n"), /Every voice was kept, also the quiet ones/);
  const fixed = R.describeResult({ ...r, threshold: -30, method: "manual", by_kind: { silence: 10, below: 20 }, quiet: { cut: false, seconds: 0 } }, null);
  const ft = fixed.lines.map((l) => l.text).join("\n");
  assert.match(ft, /Threshold -30 dB on all 1 sound clip: what stays under it goes, speech or not\./);
  assert.match(ft, /silence 10\.0 s · under your dB 20\.0 s/);
  // the three results that move nothing say so instead of a shorter length
  assert.match(R.describeResult({ ...r, action: "mute", after_s: 100 }, null).text, /^Done: 1:40, muted, the timing unchanged\. Sequence:/);
  assert.match(R.describeResult({ ...r, action: "split", after_s: 100 }, null).lines[0].text, /12 parts cut apart, nothing removed/);
  // AI rough cut: a take that went and one only listed
  const ai = R.describeResult({ ...r, what: "ai", method: "ai", speech: { ...r.speech, asr: true, words: 420 }, takes: [
    { kind_label: "repeated take", applied: true, safe: true, recommended: 1, cut_s: 3.2, out_at: 12, takes: [{ text: "Добър ден" }, { text: "Добър ден на всички" }] },
    { kind_label: "repeated take (nearly the same)", applied: false, safe: false, recommended: 1, cut_s: 0, out_at: 40, takes: [{ text: "под 200 евро" }, { text: "под 300 евро" }] }] }, null);
  const at = ai.lines.map((l) => l.text).join("\n");
  assert.match(at, /420 words recognised/);
  assert.match(at, /0:12: repeated take ×2; kept #2 "Добър ден на всички", the other was cut \(3\.2 s\)/);
  assert.match(at, /0:40: repeated take \(nearly the same\) ×2: nothing cut \(said differently\), review it/);
});

test("Cut silences (0.10.96): the range is the selection, In to Out, or the whole sequence", () => {
  const R = require("../panel/roughcutplan.js");
  const items = [{ kind: "video", track: 0, path: "/a.mp4", start: 0, end: 10, inPt: 5, name: "a", selected: false, ti: { id: 1 } },
    { kind: "audio", track: 0, path: "/a.mp4", start: 0, end: 10, inPt: 5, name: "a", selected: true, ti: { id: 2 } },
    { kind: "audio", track: 1, path: "/b.wav", start: 12, end: 20, inPt: 0, name: "b", selected: false, ti: { id: 3 } }];
  assert.strictEqual(R.planRoughCut(items).layout.length, 1);                                  // only the selected clip, as before
  assert.strictEqual(R.planRoughCut(items, { kind: "selection" }).layout.length, 1);
  const all = R.planRoughCut(items, { kind: "all" });
  assert.strictEqual(all.layout.length, 3);
  assert.strictEqual(all.dialogue.length, 2);
  const io = R.planRoughCut(items, { kind: "inout", from: 4, to: 14 });
  assert.deepStrictEqual(io.layout.map((x) => [x.kind, x.start, x.end, x.inPt]), [["video", 4, 10, 9], ["audio", 4, 10, 9], ["audio", 12, 14, 0]]);
  assert.deepStrictEqual(io.dialogue.map((x) => [x.start, x.end, x.at]), [[9, 15, 4], [0, 2, 12]]);     // the sound is read from the edge on
  assert.strictEqual(io.refs[0].ti.id, 1);                                                       // the copies are made from the editor's own clips
  assert.strictEqual(items[0].start, 0);                                                         // the timeline's items are not changed
  assert.strictEqual(R.planRoughCut(items, { kind: "inout", from: 10.5, to: 11.5 }).selected, 0);
  // one frame of the next clip under the Out point is left out (it was a 30 ms clip the engine choked on)
  assert.deepStrictEqual(R.planRoughCut(items, { kind: "inout", from: 2, to: 12.033 }).layout.map((x) => x.name), ["a", "a"]);
});
