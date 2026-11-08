// node --test tests/reviewplan.test.js
const test = require("node:test");
const assert = require("node:assert");
const { reasonText, reasonRows, toCheck, summaryText, helpersOn, MAX_REASONS } = require("../panel/reviewplan.js");

test("a changed word shows what it was and why it changed", () => {
  assert.strictEqual(reasonText({ kind: "recognition", label: "changed by dictionary repair", from: "масна", to: "масона" }),
    "Words · „масна“ → „масона“ (dictionary repair)");
});

test("words and timing are told apart, and the meaning of the word is named", () => {
  assert.strictEqual(reasonText({ kind: "recognition", label: "the recognition was unsure of this word", word: "500", why: "number" }),
    "Words · the recognition was unsure of this word: „500“, number");
  assert.strictEqual(reasonText({ kind: "timing", label: "not clearly heard where it is placed", word: "на" }),
    "Timing · not clearly heard where it is placed: „на“");
});

test("no percentage is ever shown for an unsure word", () => {
  const text = reasonText({ kind: "recognition", label: "the recognition was unsure of this word", word: "дума", p: 0.31 });
  assert.ok(!/%|0\.31/.test(text));
});

test("at most three reasons, then how many more; meaning-changing ones are marked", () => {
  const items = [1, 2, 3, 4, 5].map((n) => ({ kind: n === 2 ? "timing" : "recognition", severity: n === 1 ? 3 : 2, label: "x", word: String(n) }));
  const rows = reasonRows(items);
  assert.strictEqual(rows.length, MAX_REASONS + 1);
  assert.strictEqual(rows[0].cls, "why meaning");
  assert.strictEqual(rows[1].cls, "why timing");
  assert.strictEqual(rows[3].text, "+2 more");
});

test("a line is one to check only with a medium or high reason", () => {
  const review = { lines: [[{ severity: 1 }], [{ severity: 2 }], []] };
  assert.deepStrictEqual([0, 1, 2, 3].map((i) => toCheck(review, i)), [false, true, false, false]);
  assert.strictEqual(toCheck(null, 0), false);
});

test("the summary counts lines and kinds and says unsure is not accuracy", () => {
  const text = summaryText({ summary: { lines_to_check: 3, meaning: 2, timing: 1 } }, 40);
  assert.match(text, /^3 of 40 lines to check: 2 about meaning/);
  assert.match(text, /not a measured accuracy/);
  assert.match(summaryText({ summary: { lines_to_check: 0 } }, 12), /^12 lines\. Nothing marked/);
});

test("review helpers are on unless switched off", () => {
  assert.strictEqual(helpersOn(null), true);
  assert.strictEqual(helpersOn("1"), true);
  assert.strictEqual(helpersOn("0"), false);
});
