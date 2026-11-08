// node --test tests/ontap.test.js
// main.js onTap, taken out of the file and run with a fake button and clock (0.10.6, UX-001). UXP's own event order is
// checked in Premiere.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

function make() {
  const src = fs.readFileSync(path.join(__dirname, "..", "panel", "main.js"), "utf8");
  const body = src.slice(src.indexOf("function onTap("), src.indexOf("function show(id"));
  const clock = { now: 100000 };
  const onTap = new Function("state", "engine", "Date", `${body}; return onTap;`)({ settleUntil: 0 }, { log: () => {} }, { now: () => clock.now });
  const on = {};
  const button = { textContent: "Go", disabled: false, addEventListener: (k, f) => { on[k] = f; } };
  let n = 0;
  onTap(button, () => { n += 1; });
  return { on, clock, count: () => n };
}

test("a right or middle button press does nothing", () => {
  const t = make();
  t.on.pointerdown({ button: 2 });
  t.on.mousedown({ button: 2 });
  t.on.click({ button: 1 });
  assert.strictEqual(t.count(), 0);
});

test("a long press acts once, however long it is held", () => {
  const t = make();
  t.on.pointerdown({ button: 0 });
  t.on.mousedown({ button: 0 });
  t.clock.now += 3000;
  t.on.pointerup({ button: 0 });
  t.on.mouseup({ button: 0 });
  t.clock.now += 5;
  t.on.click({ button: 0 });
  assert.strictEqual(t.count(), 1);
});

test("a click without a release before it acts (the test bridge, Premiere's focus case)", () => {
  const t = make();
  t.on.click({});
  assert.strictEqual(t.count(), 1);
  t.on.mousedown({ button: 0 });                      // a press whose click Premiere's focus swallowed...
  t.clock.now += 1100;
  t.on.click({});                                     // ...and later the bridge's b.click(): acts
  assert.strictEqual(t.count(), 3);
});

test("runJob: a result that arrives after Cancel was pressed is never applied (0.10.6, BUG-014)", async () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "panel", "main.js"), "utf8");
  const body = src.slice(src.indexOf("async function runJob("), src.indexOf("function describe(result"));
  class UserError extends Error {}
  const state = { cancelRequested: false };
  let calls = 0;
  const engine = { job: async () => { calls += 1; if (calls === 2) state.cancelRequested = true; return { state: calls < 3 ? "running" : "done", progress: 0.5, message: "", result: { ok: 1 } }; } };
  const runJob = new Function("state", "engine", "progress", "premiere", "wait", `${body}; return runJob;`)(
    state, engine, () => {}, { UserError }, async () => {});
  await assert.rejects(runJob("abc"), /Cancelled\. Nothing was changed/);
  state.cancelRequested = false;
  calls = 2;
  assert.deepStrictEqual(await runJob("abc"), { ok: 1 });           // without Cancel the result is used
});
