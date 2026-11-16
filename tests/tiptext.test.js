const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { tipLines } = require("../panel/tiptext.js");

test("a tip is a summary, then one row per choice with its name apart", () => {
  const l = tipLines("How speech is found.\nAutomatic: measures each microphone.\nManual dB: your level decides: what is under it goes.\nPlain line");
  assert.deepStrictEqual(l[0], { lead: true, text: "How speech is found." });
  assert.deepStrictEqual(l[1], { label: "Automatic", text: "measures each microphone." });
  assert.deepStrictEqual(l[2], { label: "Manual dB", text: "your level decides: what is under it goes." });
  assert.deepStrictEqual(l[3], { text: "Plain line" });
  assert.deepStrictEqual(tipLines("One paragraph: as before."), [{ lead: false, text: "One paragraph: as before." }]);
  assert.deepStrictEqual(tipLines(null), []);
});

test("every Silences option explains itself as a summary and rows (the user, 2026-11-15)", () => {
  const html = fs.readFileSync(path.join(__dirname, "../panel/index.html"), "utf8");
  const block = html.slice(html.indexOf('id="optRough"'), html.indexOf('id="silPreview"'));
  const tips = [...block.matchAll(/data-tip="([^"]*)"/g)].map((m) => m[1].replace(/&#10;/g, "\n"));
  assert.strictEqual(tips.length, 16);
  for (const t of tips) assert.ok(tipLines(t).length >= 2, t);
  const result = tipLines(tips.find((t) => t.startsWith("What happens to the parts that go")));
  assert.deepStrictEqual(result.slice(1).map((l) => l.label), ["Remove, close the gaps", "Remove, keep the spaces", "Split only", "Mute the sound"]);
});
