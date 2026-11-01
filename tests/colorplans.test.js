// node --test tests/colorplans.test.js
const test = require("node:test");
const assert = require("node:assert");
const { plansFor, corrections } = require("../panel/colorplans.js");

const res = (expStops, expConf, balanced, wbConf) => ({
  exposure: { stops: expStops, units: expStops ? expStops + 0.1 : 0, confidence: expConf },
  white: { balanced, confidence: wbConf },
});

test("fx39024: high white + medium exposure shows both buttons (counted per correction)", () => {
  const clips = [{ name: "fx39024.MP4" }];
  const results = [res(2, "medium", false, "high")];
  const sure = plansFor(clips, results, "sure");
  const all = plansFor(clips, results, "all");
  assert.strictEqual(sure.length, 1);
  assert.strictEqual(all.length, 1);                              // same number of clips …
  assert.ok(corrections(all) > corrections(sure));                // … but „и средните“ adds the exposure
  assert.strictEqual(sure[0].exposure, null);
  assert.strictEqual(all[0].exposure, 2.1);                       // Lumetri units, not stops
  assert.deepStrictEqual(sure[0].left, ["експозицията"]);         // and „сигурните“ says what it left out
});

test("everything high: one button, nothing left out", () => {
  const p = plansFor([{}], [res(0.5, "high", false, "high")], "sure");
  assert.strictEqual(corrections(p), corrections(plansFor([{}], [res(0.5, "high", false, "high")], "all")));
  assert.deepStrictEqual(p[0].left, []);
});

test("low confidence is never applied by either button", () => {
  const r = [res(1.5, "low", false, "low")];
  assert.strictEqual(plansFor([{}], r, "all").length, 0);
});

test("a balanced white and no exposure change is no plan at all", () => {
  assert.strictEqual(plansFor([{}], [res(0, "high", true, "high")], "all").length, 0);
});

test("errors are skipped, other clips still planned", () => {
  const p = plansFor([{}, {}], [{ error: "x" }, res(0.5, "high", true, "high")], "sure");
  assert.strictEqual(p.length, 1);
});
