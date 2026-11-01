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

const { mergeValues } = require("../panel/colorplans.js");

test("new Lumetri: values are the suggestion itself", () => {
  const m = mergeValues({}, 2.1, { temperature: -4.9, tint: 12.8 });
  assert.deepStrictEqual(m.values, { exposure: 2.1, temperature: -4.9, tint: 12.8 });
  assert.deepStrictEqual(m.applied, { exposure: 2.1, temperature: -4.9, tint: 12.8 });
});

test("fx39024 case: exposure added on top of Asistent's own white, white kept", () => {
  const m = mergeValues({ exposure: 0, temperature: -4.9, tint: 12.8 }, 2.1, null);
  assert.deepStrictEqual(m.values, { exposure: 2.1 });            // temperature/tint stay as they are
  assert.deepStrictEqual(m.applied, { exposure: 2.1 });
});

test("a further difference is added to what is there", () => {
  const m = mergeValues({ exposure: 0.5, temperature: -4.9, tint: 12.8 }, 0.25, { temperature: -1.2, tint: 0.4 });
  assert.deepStrictEqual(m.values, { exposure: 0.75, temperature: -6.1, tint: 13.2 });
  assert.deepStrictEqual(m.applied, { exposure: 0.25, temperature: -1.2, tint: 0.4 });
});

test("nothing suggested: nothing written", () => {
  assert.deepStrictEqual(mergeValues({ exposure: 1 }, null, null), { values: {}, applied: {} });
});

const { whiteWithinCheck, WHITE_OK } = require("../panel/colorplans.js");

test("fx39024 16:12: a residual the render check calls neutral is kept on Asistent's own Lumetri", () => {
  // after Temperature −4.9 / Tint 12.8 the re-analysis wanted fix_temp −0.094, fix_tint +0.02
  assert.ok(whiteWithinCheck({ fix_temp: -0.094, fix_tint: 0.0195 }));
});

test("a real cast is still corrected", () => {
  assert.ok(!whiteWithinCheck({ fix_temp: -0.25, fix_tint: 0.0 }));
  assert.ok(!whiteWithinCheck({ fix_temp: 0.0, fix_tint: 0.09 }));
});

test("the limits are the render check's, used by the refine step too", () => {
  assert.deepStrictEqual(WHITE_OK, { temp: 0.1, tint: 0.06 });
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "panel", "premiere-color.js"), "utf8");
  assert.match(src, /chk\.residual\[0\]\) > WHITE_OK\.temp/);
  assert.match(src, /keptWhite = !t\.skip && t\.owned && pl\.wb && whiteWithinCheck/);
});
