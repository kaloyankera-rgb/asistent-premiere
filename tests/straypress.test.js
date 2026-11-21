// 0.10.130: the stray-press safety net must never press a button that is not on screen.
// Measured 2026-11-21 in Premiere 26.5.3: buttons inside a hidden pane keep their old rectangle, so the rectangle alone
// cannot say whether a button is under the mouse. The net is cut out of main.js and run here against fake elements.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const main = fs.readFileSync(path.join(__dirname, "..", "panel", "main.js"), "utf8");
const start = main.indexOf("function strayPresses()");
const end = main.indexOf("\nfunction show(", start);
const source = main.slice(start, end);

function world() {
  const document = { listeners: {}, buttons: [] };
  document.addEventListener = (type, fn) => { document.listeners[type] = fn; };
  document.querySelectorAll = () => document.buttons;
  const node = (parent, extra) => Object.assign({ parentNode: parent || document, hidden: false, classList: { contains: () => false } }, extra);
  const rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
  const pressed = [];
  const button = (parent, name) => {
    const b = node(parent, { textContent: name, getBoundingClientRect: () => rect, _press: () => pressed.push(name) });
    document.buttons.push(b);
    return b;
  };
  const engine = { log() {} };
  const $ = () => null;
  new Function("document", "engine", "$", `${source}\nstrayPresses();`)(document, engine, $);
  const click = (target) => document.listeners.pointerdown({ target, button: 0, clientX: 50, clientY: 50 });
  return { document, node, button, pressed, click };
}

test("the net is found in main.js", () => {
  assert.ok(start > 0 && end > start);
});

test("a press on a label never presses a button of a hidden pane, even though it still reports a rectangle", () => {
  const w = world();
  const hiddenPane = w.node(null, { hidden: true });
  const row = w.node(hiddenPane);
  w.button(row, "Fix audio");
  const label = w.node(w.node(null));
  w.click(label);
  assert.deepStrictEqual(w.pressed, []);
});

test("a hidden button itself is skipped too", () => {
  const w = world();
  const b = w.button(w.node(null), "Hand");
  b.hidden = true;
  w.click(w.node(null));
  assert.deepStrictEqual(w.pressed, []);
});

test("the 0.10.77 case still works: a press delivered to another element presses the visible button under it", () => {
  const w = world();
  const pane = w.node(null);
  w.button(w.node(null, { hidden: true }), "Fix audio");
  w.button(pane, "Track");
  w.click(w.node(pane));
  assert.deepStrictEqual(w.pressed, ["Track"]);
});
