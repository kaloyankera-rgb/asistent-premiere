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
  assert.ok(corrections(all) > corrections(sure));                // … but "the medium ones too" adds the exposure
  assert.strictEqual(sure[0].exposure, null);
  assert.strictEqual(all[0].exposure, 2.1);                       // Lumetri units, not stops
  assert.deepStrictEqual(sure[0].left, ["the exposure"]);         // and "the sure ones" says what it left out
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

const { statusOf, STATUS_BG } = require("../panel/colorplans.js");

test("statuses per clip", () => {
  assert.strictEqual(statusOf({ skipped: true, skipReason: "already has a Lumetri with changes (tint) that are not from Asistent" }), "BLOCKED");
  assert.strictEqual(statusOf({ skipped: true, skipReason: "did not work for this clip (x); the others go on" }), "FAILED");
  assert.strictEqual(statusOf({ nothing: true }), "ALREADY_BALANCED");
  const both = { applied: { exposure: 1, temperature: -5, tint: 2 } };
  assert.strictEqual(statusOf({ ...both, reverted: ["white", "exposure"] }), "REVERTED");
  assert.strictEqual(statusOf({ ...both, reverted: ["white"] }), "PARTLY_REVERTED");
  assert.strictEqual(statusOf({ ...both, reverted: [], finalChk: { clipping_status: "REVIEW_NEEDED" } }), "REVIEW_NEEDED");
  assert.strictEqual(statusOf({ ...both, reverted: [], finalChk: { clipping_status: "ACCEPTED_WITH_WARNING" } }), "CORRECTED");
  for (const k of ["CORRECTED", "ALREADY_BALANCED", "REVIEW_NEEDED", "REVERTED", "PARTLY_REVERTED", "BLOCKED", "FAILED"]) {
    assert.ok(STATUS_BG[k]);
  }
});

test("a revert is driven by the final check and costs one Undo step for all clips", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "panel", "premiere-color.js"), "utf8");
  assert.match(src, /steps \+= await revertWorse\(project, prepared\)/);
  assert.match(src, /transaction\(project, "Asistent: revert what got worse"/);
});

// ---- the separate buttons (0.9.58): the same plans narrowed to one correction; Auto Color is unchanged

// the plansFor of 0.9.57, kept here as the reference Auto Color must still match
function plansBefore(clips, results, level) {
  const ok = (c) => c === "high" || (level === "all" && c === "medium");
  const plans = [];
  clips.forEach((clip, i) => {
    const r = results[i];
    if (!r || r.error) return;
    const units = r.exposure.units ?? r.exposure.stops;
    const exposure = r.exposure.stops && ok(r.exposure.confidence) ? units : null;
    const wb = !r.white.balanced && ok(r.white.confidence);
    const left = [];
    if (level === "sure" && r.exposure.stops && r.exposure.confidence === "medium") left.push("the exposure");
    if (level === "sure" && !r.white.balanced && r.white.confidence === "medium") left.push("the white balance");
    if (exposure || wb) plans.push({ clip, res: r, exposure, wb, left });
  });
  return plans;
}

test("Auto Color (no part) gives exactly the plans the single button gave before", () => {
  const confs = ["high", "medium", "low"];
  for (const level of ["sure", "all"]) for (const ec of confs) for (const wc of confs) for (const bal of [true, false]) {
    for (const stops of [0, -1.2, 2]) {
      const clips = [{ name: "a" }], results = [res(stops, ec, bal, wc)];
      assert.deepStrictEqual(plansFor(clips, results, level), plansBefore(clips, results, level));
      assert.deepStrictEqual(plansFor(clips, results, level, null), plansBefore(clips, results, level));
    }
  }
});

test("White balance alone plans only the white; Exposure alone plans only the exposure", () => {
  const clips = [{ name: "fx39024.MP4" }];
  const results = [res(2, "high", false, "high")];
  const white = plansFor(clips, results, "sure", "white");
  const exposure = plansFor(clips, results, "sure", "exposure");
  assert.strictEqual(white.length, 1);
  assert.strictEqual(white[0].wb, true);
  assert.strictEqual(white[0].exposure, null);
  assert.strictEqual(exposure.length, 1);
  assert.strictEqual(exposure[0].wb, false);
  assert.strictEqual(exposure[0].exposure, 2.1);
  // the two together are Auto Color's two corrections, nothing more and nothing less
  assert.strictEqual(corrections(white) + corrections(exposure), corrections(plansFor(clips, results, "sure")));
});

test("a part with nothing to do is no plan, even when the other part has work", () => {
  const results = [res(2, "high", true, "high")];                  // white balanced, exposure needs +2
  assert.strictEqual(plansFor([{}], results, "all", "white").length, 0);
  assert.strictEqual(plansFor([{}], results, "all", "exposure").length, 1);
});

test("a medium correction of the other part is not reported as left out", () => {
  const results = [res(2, "medium", false, "high")];               // exposure medium, white high
  assert.deepStrictEqual(plansFor([{}], results, "sure", "white")[0].left, []);
  assert.strictEqual(plansFor([{}], results, "sure", "exposure").length, 0);
  assert.deepStrictEqual(plansFor([{}], results, "sure")[0].left, ["the exposure"]);
});
