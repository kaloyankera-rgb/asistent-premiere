// node --test tests/store.test.js
const test = require("node:test");
const assert = require("node:assert");
const store = require("../panel/store.js");

function fakeStorage(init) {
  const m = new Map(Object.entries(init));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)) };
}

test("settings come from the engine; what only the old panel storage has is copied to the engine once", async () => {
  const puts = [];
  const engine = { panelStore: async () => ({ values: { "asistent.subtitleStyle": "reshape" } }),
    panelStorePut: async (k, v) => puts.push([k, v]) };
  store.use(engine, fakeStorage({ "asistent.subtitleEnglish": "1", "asistent.subtitleStyle": "auto", "other": "x" }));
  assert.strictEqual(await store.load(), true);
  assert.strictEqual(store.getItem("asistent.subtitleStyle"), "reshape");          // the engine's copy wins
  assert.strictEqual(store.getItem("asistent.subtitleEnglish"), "1");
  await store.setItem("asistent.reviewHelpers", "0");
  assert.deepStrictEqual(puts, [["asistent.subtitleEnglish", "1"], ["asistent.reviewHelpers", "0"]]);
});

test("engine offline: the old storage still answers", async () => {
  store.use({ panelStore: async () => { throw new Error("offline"); }, panelStorePut: async () => {} }, fakeStorage({ "asistent.x": "1" }));
  assert.strictEqual(await store.load(), false);
  assert.strictEqual(store.getItem("asistent.x"), "1");
});

test("a panel that opened while the engine restarted loads its settings once the engine answers (0.10.26)", async () => {
  let up = false;
  const engine = { panelStore: async () => { if (!up) throw new Error("offline"); return { values: { "asistent.lumetriFresh.v1": "snap", "asistent.subtitleStyle": "gstroy" } }; },
    panelStorePut: async () => {} };
  store.use(engine, fakeStorage({}));
  assert.strictEqual(await store.load(), false);
  assert.strictEqual(store.loaded(), false);
  assert.strictEqual(store.getItem("asistent.lumetriFresh.v1"), null);
  await store.setItem("asistent.subtitleStyle", "aula");                          // chosen while the engine was down
  up = true;
  assert.strictEqual(await store.load(), true);
  assert.strictEqual(store.loaded(), true);
  assert.strictEqual(store.getItem("asistent.lumetriFresh.v1"), "snap");          // the untouched Lumetri is known again
  assert.strictEqual(store.getItem("asistent.subtitleStyle"), "aula");            // the newer choice stays
});
