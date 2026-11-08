// node --test tests/captionplace.test.js
// premiere-captions.place() with Premiere, the engine and the host faked: what is recorded and what is removed when the new
// pair is placed only in part, when the sequence changed during the job, and when the earlier record is from before 0.10.6.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const Module = require("node:module");

function setup({ tracks, record, english = "ok", activeGuid = "G1", guid = "G1" }) {
  const state = { tracks: tracks.map((t) => ({ ...t })), recorded: [], removedTx: 0, calls: 0, selected: [] };
  const engine = {
    captionsState: async (proj, key) => (record && record[key]) || {},
    placeCaptions: async (p) => {
      state.calls++;
      const isEn = /\.en\.srt$/.test(p.srt);
      if (isEn && english === "refused") return { ok: false, msg: "host refused" };
      if (isEn && english === "throws") throw new Error("Premiere did not answer in time");
      state.tracks.push({ count: 3, lines: [[0.5, 1.4], [1.5, 2.4], [2.5, 4.0]] });
      return { ok: true };
    },
    recordCaptions: async (proj, key, sig) => state.recorded.push({ key, sig }),
    log: () => {},
  };
  const P = {
    maybe: async (obj, m) => (m === "getCaptionTrackCount" ? state.tracks.length : m === "getTrackItems" ? obj.items : undefined),
    secs: (x) => x,
    transaction: () => { state.removedTx++; },
  };
  const ppro = {
    Constants: { TrackItemType: { CLIP: 1 }, MediaType: { ANY: 0 } },
    SequenceEditor: { getEditor: () => ({ createRemoveItemsAction: () => ({}) }) },
    TrackItemSelection: { createEmptySelection: async (fn) => fn({ addItem: (ti) => state.selected.push(ti) }) },
  };
  const orig = Module._load;
  Module._load = function (req, parent, ...rest) {
    if (req === "premierepro") return ppro;
    if (req === "./engine.js") return engine;
    if (req === "./premiere.js") return P;
    return orig.call(this, req, parent, ...rest);
  };
  const file = path.join(__dirname, "..", "panel", "premiere-captions.js");
  delete require.cache[require.resolve(file)];
  delete require.cache[require.resolve(path.join(__dirname, "..", "panel", "captionplan.js"))];
  const pc = require(file);
  Module._load = orig;
  const sequence = {
    name: "A", guid: { toString: () => guid },
    getCaptionTrack: async (i) => ({ name: "", items: state.tracks[i].lines.map(([a, b]) => ({ getStartTime: async () => a, getEndTime: async () => b })) }),
  };
  const project = { path: "/p.prproj", getActiveSequence: async () => ({ name: "A", guid: { toString: () => activeGuid } }) };
  return { pc, state, sequence, project };
}

const OLD = [[0.5, 1.4], [1.5, 2.4], [2.5, 4.0]];
const sigOf = (index) => ({ index, count: 3, first: 0.5, last: 4.0, lines: OLD });
const RESULT = { srt: "/x.srt", srt_en: "/x.en.srt", captions: [{ start: 0.5, end: 1.4 }, { start: 1.5, end: 2.4 }, { start: 2.5, end: 4.0 }] };

test("the English line refused: the earlier pair is kept and still recorded, nothing removed (BUG-002)", async () => {
  const { pc, state, sequence, project } = setup({ tracks: [{ lines: OLD, count: 3 }, { lines: OLD, count: 3 }],
    record: { "guid:G1": { ...sigOf(0), english: sigOf(1) } }, english: "refused" });
  const r = await pc.place(project, sequence, RESULT);
  assert.strictEqual(state.removedTx, 0);
  assert.strictEqual(state.recorded.length, 0);
  assert.ok(r.problems.some((p) => /English line was not placed: host refused/.test(p)));
  assert.deepStrictEqual(r.replaces.map((t) => t.index), [0, 1]);
});

test("the English line timed out: the same, nothing removed", async () => {
  const { pc, state, sequence, project } = setup({ tracks: [{ lines: OLD, count: 3 }, { lines: OLD, count: 3 }],
    record: { "guid:G1": { ...sigOf(0), english: sigOf(1) } }, english: "throws" });
  const r = await pc.place(project, sequence, RESULT);
  assert.strictEqual(state.removedTx, 0);
  assert.strictEqual(state.recorded.length, 0);
  assert.ok(r.problems.length);
});

test("a complete new pair: recorded under the sequence guid with every line, then the earlier pair removed in one step", async () => {
  const { pc, state, sequence, project } = setup({ tracks: [{ lines: OLD, count: 3 }, { lines: OLD, count: 3 }],
    record: { "guid:G1": { ...sigOf(0), english: sigOf(1) } } });
  const r = await pc.place(project, sequence, RESULT);
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(state.recorded[0].key, "guid:G1");
  assert.strictEqual(state.recorded[0].sig.lines.length, 3);
  assert.strictEqual(state.recorded[0].sig.english.lines.length, 3);
  assert.strictEqual(state.removedTx, 1);
  assert.deepStrictEqual(r.removed.tracks.map((t) => t.index), [0, 1]);
});

test("another sequence is open when the job ends: nothing is placed (BUG-003)", async () => {
  const { pc, state, sequence, project } = setup({ tracks: [], record: {}, activeGuid: "G2" });
  const r = await pc.place(project, sequence, RESULT);
  assert.strictEqual(r.status, "moved");
  assert.strictEqual(state.calls, 0);
});

test("a record from before 0.10.6 (by name, no line times) is never removed; it is named", async () => {
  const legacy = { index: 0, count: 3, first: 0.5, last: 4.0 };
  const { pc, state, sequence, project } = setup({ tracks: [{ lines: OLD, count: 3 }], record: { A: legacy }, english: "ok" });
  const r = await pc.place(project, sequence, { ...RESULT, srt_en: null });
  assert.strictEqual(state.removedTx, 0);
  assert.deepStrictEqual(r.replaces.map((t) => t.index), [0]);
  assert.match(r.keptWhy, /older Asistent/);
  assert.strictEqual(state.recorded[0].key, "guid:G1");
});
