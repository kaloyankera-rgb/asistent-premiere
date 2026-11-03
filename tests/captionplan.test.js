// node --test tests/captionplan.test.js
const test = require("node:test");
const assert = require("node:assert");
const { findOwn, addedTrack, problems, describePlacement } = require("../panel/captionplan.js");

const track = (o) => ({ index: 0, name: "Subtitle", count: 25, start: 0.0, end: 23.7, ...o });
const sig = { index: 0, count: 25, first: 0.0, last: 23.7, srt: "/a.srt" };

test("an earlier Asistent track is recognised by index, item count and first/last time", () => {
  assert.strictEqual(findOwn(sig, [track()]).index, 0);
  assert.strictEqual(findOwn(sig, [track({ end: 23.75 })]).index, 0);
});

test("a track the editor changed, or a different one at that index, is not taken for Asistent's", () => {
  assert.strictEqual(findOwn(sig, [track({ count: 24 })]), null);
  assert.strictEqual(findOwn(sig, [track({ start: 1.0 })]), null);
  assert.strictEqual(findOwn(sig, [track({ end: 30 })]), null);
  assert.strictEqual(findOwn(sig, []), null);
  assert.strictEqual(findOwn(null, [track()]), null);
  assert.strictEqual(findOwn({ index: "0" }, [track()]), null);
});

test("the added track is the one that was not there before; none or several is not a placement", () => {
  const a = track({ index: 0 });
  const b = track({ index: 1, name: "Subtitle 2" });
  assert.strictEqual(addedTrack([a], [a, b]).index, 1);
  assert.strictEqual(addedTrack([a], [a]), null);
  assert.strictEqual(addedTrack([], [a, b]), null);
});

const captions = [{ start: 0.0, end: 0.9 }, { start: 1.1, end: 23.7 }];

test("a placement is verified by item count and by the first and last time", () => {
  assert.deepStrictEqual(problems(track({ count: 2 }), captions), []);
  assert.deepStrictEqual(problems(null, captions), ["Premiere did not add a new subtitle track."]);
  const bad = problems(track({ count: 1, start: 2, end: 20 }), captions);
  assert.strictEqual(bad.length, 3);
  assert.match(bad[0], /1 lines instead of 2/);
});

test("the result box says where the captions are and what to check", () => {
  const ok = describePlacement({ status: "placed", track: track({ index: 1, count: 2 }), problems: [] }, "/a.srt");
  assert.strictEqual(ok.ok, true);
  assert.match(ok.lines[0].text, /track C2: 2 lines/);
  const warn = describePlacement({ status: "placed", track: track({ index: 1, count: 2 }), problems: ["the track has 1 lines instead of 2"] }, "/a.srt");
  assert.strictEqual(warn.ok, false);
  assert.ok(warn.lines.some((l) => l.cls === "warn" && /Check/.test(l.text)));
});

test("an existing Asistent track is reported with the steps, never stacked or removed", () => {
  const r = describePlacement({ status: "exists", track: track({ index: 0 }) }, "/new.srt");
  assert.strictEqual(r.ok, false);
  assert.match(r.lines.map((l) => l.text).join("\n"), /Delete Track/);
  assert.match(r.lines.map((l) => l.text).join("\n"), /\/new\.srt/);
});

test("when the host is away or Premiere refuses, the file path is still given", () => {
  for (const status of ["nohost", "error"]) {
    const r = describePlacement({ status, message: "a reason" }, "/a.srt");
    assert.strictEqual(r.ok, false);
    assert.ok(r.lines.some((l) => /a reason/.test(l.text)));
    assert.ok(r.lines.some((l) => /\/a\.srt/.test(l.text)));
  }
});

test("corrected subtitles on a new track say the old track must go", () => {
  const r = describePlacement({ status: "placed", track: track({ index: 1, count: 2 }), problems: [], replaces: track({ index: 0, count: 2 }) }, "/a.srt", true);
  assert.ok(r.lines.some((l) => l.cls === "warn" && /earlier subtitles are still on track C1: delete that track/.test(l.text)));
  const plain = describePlacement({ status: "placed", track: track({ index: 0, count: 2 }), problems: [] }, "/a.srt");
  assert.ok(!plain.lines.some((l) => /earlier subtitles/.test(l.text)));
});
