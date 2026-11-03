// Test bridge (panel side) with a fake document and fake Premiere: guard, button pressing, waiting, unknown commands.
const test = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");

// the bridge requires ./engine.js (fetch) and, only inside `select`/`api`, premierepro: neither is touched here
const { createBridge } = require("../panel/devbridge.js");

function el(text, extra = {}) {
  return { textContent: text, hidden: false, disabled: false, className: "", children: [], clicked: 0, click() { this.clicked++; }, ...extra };
}

function fakeDoc(buttonsList, over = {}) {
  const nodes = { work: el("", { hidden: true }), message: el(""), summary: el("Done", { className: "ok" }),
    result: el("", { hidden: false }), details: el("", { children: [el("", { children: [el("fx39024.MP4 · matched"), el("Exposure 2.04")] })] }) };
  Object.assign(nodes, over);
  return { getElementById: (id) => nodes[id], querySelectorAll: () => buttonsList, nodes };
}

const sleep = () => Promise.resolve();
const premiereOk = { activeProject: async () => ({ name: "TEST.prproj", path: "/Users/x/Projects/TEST.prproj" }) };

test("ping works in any project and says whether it is the test project", async () => {
  const b = createBridge({ premiere: { activeProject: async () => ({ name: "Client.prproj", path: "/c/Client.prproj" }) },
    premiereColor: {}, doc: fakeDoc([]), version: "9.9.9", sleep });
  const r = await b.run({ id: "1", name: "ping" });
  assert.ok(r.ok && r.data.test_project === false && r.data.project === "Client.prproj" && r.data.panel === "9.9.9");
});

test("every other command is refused outside TEST.prproj and presses nothing", async () => {
  const btn = el("Auto color");
  const b = createBridge({ premiere: { activeProject: async () => ({ name: "Client.prproj", path: "/c/Client.prproj" }) },
    premiereColor: {}, doc: fakeDoc([btn]), version: "x", sleep });
  for (const name of ["click", "selection", "state", "frame", "lumetri", "select", "timeline", "api", "wait_idle", "set_lumetri", "chain", "srt_import", "caption_place", "transcript_export"]) {
    const r = await b.run({ id: "1", name, args: { text: "Auto color" } });
    assert.strictEqual(r.ok, false, name);
    assert.match(r.data.error, /TEST\.prproj only/);
  }
  assert.strictEqual(btn.clicked, 0);
});

test("click finds a button by its label (exact first, then part of it) and presses it once", async () => {
  const a = el("Auto color"), c = el("Match POVs"), apply = el("Apply the match (1)");
  const b = createBridge({ premiere: premiereOk, premiereColor: {}, doc: fakeDoc([a, c, apply]), version: "x", sleep });
  const r = await b.run({ id: "1", name: "click", args: { text: "apply the match" } });
  assert.deepStrictEqual(r, { ok: true, data: { clicked: "Apply the match (1)" } });
  assert.deepStrictEqual([a.clicked, c.clicked, apply.clicked], [0, 0, 1]);
});

test("click says what buttons exist when none matches, and refuses a disabled one", async () => {
  const dis = el("Fix audio", { disabled: true });
  const b = createBridge({ premiere: premiereOk, premiereColor: {}, doc: fakeDoc([dis, el("Auto color")]), version: "x", sleep });
  const none = await b.run({ id: "1", name: "click", args: { text: "Sync cameras" } });
  assert.strictEqual(none.ok, false);
  assert.match(none.data.error, /Fix audio \| Auto color/);
  const off = await b.run({ id: "2", name: "click", args: { text: "Fix audio" } });
  assert.strictEqual(off.ok, false);
  assert.match(off.data.error, /disabled/);
  assert.strictEqual(dis.clicked, 0);
});

test("state reads the panel's own answer: summary, blocks of lines, buttons", async () => {
  const b = createBridge({ premiere: premiereOk, premiereColor: {}, doc: fakeDoc([el("Auto color")]), version: "x", sleep });
  const r = await b.run({ id: "1", name: "state" });
  assert.ok(r.ok);
  assert.strictEqual(r.data.summary, "Done");
  assert.deepStrictEqual(r.data.blocks, [["fx39024.MP4 · matched", "Exposure 2.04"]]);
  assert.deepStrictEqual(r.data.buttons, [{ text: "Auto color", disabled: false }]);
  assert.strictEqual(r.data.busy, false);
});

test("wait_idle returns once the work box is hidden again", async () => {
  const doc = fakeDoc([], { work: el("", { hidden: false }) });
  let n = 0;
  const b = createBridge({ premiere: premiereOk, premiereColor: {}, doc, version: "x",
    sleep: async () => { if (++n === 3) doc.nodes.work.hidden = true; } });
  const r = await b.run({ id: "1", name: "wait_idle", args: { timeout: 30 } });
  assert.ok(r.ok && r.data.busy === false && n >= 3);
});

test("an unknown command is reported with the known ones", async () => {
  const b = createBridge({ premiere: premiereOk, premiereColor: {}, doc: fakeDoc([]), version: "x", sleep });
  const r = await b.run({ id: "1", name: "rm -rf" });
  assert.strictEqual(r.ok, false);
  assert.ok(r.data.known.includes("click") && r.data.known.includes("ping"));
});

test("the loop sleeps while the bridge is off, answers a command when one arrives", async () => {
  const sent = [];
  let polls = 0;
  const engineApi = {
    devPoll: async () => { polls++; if (polls === 1) throw new Error("off"); if (polls === 2) return { id: "abc", name: "ping", args: {} }; throw new Error("stop"); },
    devResult: async (id, ok, data) => { sent.push({ id, ok, data }); },
  };
  let slept = 0;
  const b = createBridge({ premiere: premiereOk, premiereColor: {}, doc: fakeDoc([]), version: "7", engineApi,
    sleep: async () => { if (++slept > 3) throw new Error("end"); } });
  await b.loop().catch(() => {});
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual([sent[0].id, sent[0].ok, sent[0].data.panel], ["abc", true, "7"]);
  assert.ok(slept >= 1);
});

test("set_lumetri needs exactly one clip and only the known Lumetri keys", async () => {
  const item = (name, start) => ({ name, kind: "video", track: 1, start, end: start + 5, ti: {}, inPt: 0, outPt: 5, selected: false, speed: 1 });
  const written = [];
  const premiere = { ...premiereOk, readTimeline: async () => ({ items: [item("a.MP4", 0), item("a.MP4", 5), item("b.MP4", 10)] }), has: () => true };
  const premiereColor = { lumetriState: async () => ({ current: { exposure: 1 } }), devWrite: async (p, c, v) => { written.push(v); return v; } };
  const b = createBridge({ premiere, premiereColor, doc: fakeDoc([]), version: "x", sleep });
  const many = await b.run({ id: "1", name: "set_lumetri", args: { names: ["a.MP4"], values: { exposure: 2 } } });
  assert.strictEqual(many.ok, false);
  assert.match(many.data.error, /Exactly one clip is needed, found 2/);
  const bad = await b.run({ id: "2", name: "set_lumetri", args: { names: ["b.MP4"], values: { lut: 1 } } });
  assert.strictEqual(bad.ok, false);
  const ok = await b.run({ id: "3", name: "set_lumetri", args: { names: ["b.MP4"], values: { exposure: 2 } } });
  assert.ok(ok.ok);
  assert.deepStrictEqual(ok.data.before, { exposure: 1 });
  assert.deepStrictEqual(written, [{ exposure: 2 }]);
});
