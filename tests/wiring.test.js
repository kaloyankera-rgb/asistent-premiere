// node --test tests/wiring.test.js
// The panel has no DOM in tests, so the wiring is checked on the source: only the audio buttons may start
// „Оправи звука“ (0.9.9 and earlier ran it from the probe and the import buttons too).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const panel = path.join(__dirname, "..", "panel");
const html = fs.readFileSync(path.join(panel, "index.html"), "utf8");
const main = fs.readFileSync(path.join(panel, "main.js"), "utf8");

function audioBlock() {
  const start = html.indexOf('<div class="title">ЗВУК</div>');
  const end = html.indexOf('<div class="block">', start);
  assert.ok(start > 0 && end > start, "раздел ЗВУК не е намерен");
  return html.slice(start, end);
}

test("data-force only on buttons of the audio section", () => {
  const all = html.match(/<button[^>]*data-force=/g) || [];
  const inAudio = audioBlock().match(/<button[^>]*data-force=/g) || [];
  assert.ok(all.length > 0);
  assert.strictEqual(all.length, inAudio.length);
});

test("onAudio is bound only to the audio buttons", () => {
  const binds = main.split("\n").filter((l) => /querySelectorAll\(/.test(l) && /onAudio\(/.test(l));
  assert.strictEqual(binds.length, 1);
  assert.match(binds[0], /querySelectorAll\("button\.small\[data-force\]"\)/);
});

test("the probe and import buttons have their own handlers", () => {
  for (const id of ["probe", "importToggle", "importFolder"]) {
    assert.match(html, new RegExp(`<button id="${id}"(?![^>]*data-force)`));
    assert.match(main, new RegExp(`\\$\\("${id}"\\)\\.addEventListener\\("click"`));
  }
});
