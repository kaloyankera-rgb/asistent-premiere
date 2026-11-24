// node --test tests/silencespanel.test.js
// panel/silences.js mounted on a fake page (0.10.122): the Manual dB guard asks for a second press, a pending option change is flushed
// before a Cut, Suggest says why it did nothing, Cancel reaches the host cut, and the options line says who reads the words.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const Module = require("node:module");

class UserError extends Error {}
const DEFAULTS = { roughMode: "offmic", roughMethod: "auto", roughDb: "-30", roughPacing: "measured", roughMinSilence: "0.87", roughMinSpeech: "0.15",
  roughBefore: "0.15", roughAfter: "0.22", roughSensitivity: "3", roughShortMin: "0.25", roughShortMax: "0.5", roughRange: "selection", roughAction: "remove" };
const SELECTS = ["roughMode", "roughMethod", "roughPacing", "roughSensitivity", "roughRange", "roughAction"];

function setup({ cloud = { key: true, enabled: true, on: true }, results = [], readInput } = {}) {
  const els = {};
  const node = (id) => {
    const e = { id, value: DEFAULTS[id] || "", checked: false, hidden: false, textContent: "", disabled: false, style: {}, children: [], listeners: {},
      tagName: SELECTS.includes(id) ? "SELECT" : "DIV", options: [], firstChild: null, appendChild(c) { e.children.push(c); e.firstChild = e.children[0]; },
      removeChild() { e.children.pop(); e.firstChild = e.children[0] || null; }, addEventListener(t, f) { e.listeners[t] = f; }, setAttribute() {}, removeAttribute() {} };
    return e;
  };
  const $ = (id) => (els[id] = els[id] || node(id));
  const calls = { start: [], place: [], finish: [], log: [] };
  const state = { busy: false, online: true, jobId: null, cancelRequested: false };
  const engine = { startRoughcut: async (p) => { calls.start.push(p); return { job: results.shift() }; }, log: (...a) => calls.log.push(a.join(" ")), cloud: async () => cloud };
  const premiere = { UserError, activeProject: async () => ({ path: "/p" }), trace: () => {} };
  const input = { payload: { layout: [{ kind: "audio", track: 0, path: "/a.wav", start: 0, end: 60, inPt: 0 }], items: [{ track: 0, path: "/a.wav", at: 0, start: 0 }] }, meta: [], plan: {}, sequence: {} };
  const premiereRough = {
    readInput: readInput || (async () => input),
    withOptions: (inp, opts, extra) => ({ opts, extra }),
    place: async (...args) => { calls.place.push(args); return { problems: [], notes: [] }; },
  };
  const taps = {};
  const orig = Module._load;
  Module._load = function (req, parent, ...rest) {
    if (req === "./store.js") return { getItem: () => null, setItem: () => {} };
    if (req === "./engine.js") return engine;
    return orig.call(this, req, parent, ...rest);
  };
  const file = path.join(__dirname, "..", "panel", "silences.js");
  delete require.cache[require.resolve(file)];
  const mod = require(file);
  Module._load = orig;
  const page = mod.mount({ $, el: (t, c, text) => ({ ...node("x"), textContent: text || "", cls: c }), button: () => node("b"), onTap: (e, f) => { taps[e.id] = f; },
    enable: (e, on) => { e.disabled = !on; }, bindTips: () => {}, premiere, premiereRough, state,
    setBusy: (b) => { state.busy = b; }, progress: () => {}, finish: (text, ok) => calls.finish.push({ text, ok }), show: (id, v) => { $(id).hidden = !v; },
    runJob: async (job) => job, autoLabels: async () => "" });
  const change = (id, value) => { if (value !== undefined) $(id).value = value; $(id).listeners.change(); };
  return { page, $, taps, calls, state, change };
}

const manual = (saved) => ({ mode: "silence", what: "silence", method: "manual", action: "remove", before_s: 60, saved_s: saved, name: "NO SILENCE – S v1",
  regions: [], t_start: 0, t_end: 60, env: { hop: 0.01, db: [] }, tracks: [0], counts: { cuts: 1 }, speech: { listened: [] }, skipped: [], by_kind: {} });

test("Manual dB that removes 98 %: the first press stops BEFORE the real job (a preview run only), the same press repeated runs the real job once", async () => {
  const t = setup({ results: [manual(59), manual(59), manual(10), manual(10)] });
  t.change("roughMethod", "manual");
  await t.taps.rough();
  assert.strictEqual(t.calls.place.length, 0);
  assert.strictEqual(t.calls.start.length, 1);
  assert.strictEqual(t.calls.start[0].extra.preview, true, "only a preview ran: nothing written into the project folder");
  assert.match(t.calls.finish[0].text, /^This removes 98 % of the selected time: .*Press Cut silences again to go on, or use Suggest/);
  assert.strictEqual(t.calls.finish[0].ok, false);
  await t.taps.rough();
  assert.strictEqual(t.calls.start.length, 2, "the confirmed press runs the real job once, without another look");
  assert.strictEqual(t.calls.start[1].extra.preview, undefined);
  assert.strictEqual(t.calls.place.length, 1);
  // the cancel check is handed to the host cut
  t.state.cancelRequested = true;
  assert.strictEqual(t.calls.place[0][5](), true);
  // a gentle cut is never held back: one preview look, then the real job
  await t.taps.rough();
  assert.strictEqual(t.calls.start.length, 4);
  assert.strictEqual(t.calls.place.length, 2);
});

test("with a preview on screen that is this cut's, the guard uses it and starts no extra job", async () => {
  const shown = { ...manual(59), preview: true, threshold: -30, regions: [{ start: 0, end: 59, kind: "below", cut: true, flag: false }] };
  const t = setup({ results: [shown, manual(59)] });
  t.change("roughMethod", "manual");
  await t.taps.roughPreview();
  assert.strictEqual(t.calls.start.length, 1);
  await t.taps.rough();
  assert.strictEqual(t.calls.start.length, 1, "no job started, no file written");
  assert.match(t.calls.finish[0].text, /^This removes 98 %/);
  await t.taps.rough();
  assert.strictEqual(t.calls.start.length, 2);
  assert.strictEqual(t.calls.place.length, 1);
});

test("a changed level after the stop asks again (the repeated press must be the same cut)", async () => {
  const t = setup({ results: [manual(59), manual(59)] });
  t.change("roughMethod", "manual");
  await t.taps.rough();
  t.change("roughDb", "-28");
  await t.taps.rough();
  assert.strictEqual(t.calls.place.length, 0);
  assert.strictEqual(t.calls.finish.length, 2);
  assert.ok(t.calls.start.every((c) => c.extra.preview === true), "never a real job while it is held back");
});

test("an option changed a moment before Cut: the preview is brought up to the options first", async () => {
  const preview = { ...manual(5), method: "auto", preview: true };
  const t = setup({ results: [{ ...preview }, { ...preview }, { ...manual(5), method: "auto" }] });
  await t.taps.roughPreview();                                   // a preview is on screen
  assert.strictEqual(t.calls.start.length, 1);
  t.change("roughSensitivity", "4");                              // schedules the update in 450 ms
  assert.ok(t.page.state.timer);
  await t.taps.rough();                                           // pressed before the timer fired
  assert.strictEqual(t.page.state.timer, null);
  assert.strictEqual(t.calls.start.length, 3, "the update ran first, then the cut");
  assert.strictEqual(t.calls.start[1].extra.preview, true);
  assert.strictEqual(t.calls.start[1].opts.sensitivity, 4);
  assert.strictEqual(t.calls.start[2].extra.preview, undefined);
  assert.strictEqual(t.calls.start[2].opts.sensitivity, 4);
  assert.strictEqual(t.calls.place.length, 1);
});

test("Suggest says why it did nothing: nothing selected, busy, or no engine", async () => {
  const t = setup({ readInput: async () => { throw new UserError("Select the clips in the timeline: the cameras and the microphones."); } });
  await t.taps.roughSuggest();
  assert.strictEqual(t.$("roughPreviewNote").textContent, "Suggest did nothing: Select the clips in the timeline: the cameras and the microphones.");
  t.state.busy = true;
  await t.taps.roughSuggest();
  assert.match(t.$("roughPreviewNote").textContent, /^Suggest did nothing: Asistent is busy/);
  t.state.busy = false;
  t.state.online = false;
  await t.taps.roughSuggest();
  assert.match(t.$("roughPreviewNote").textContent, /^Suggest did nothing: no connection to the engine/);
});

test("the options line says who reads the words, only when the choices read them", async () => {
  const on = setup();
  await on.page.refreshWords();
  assert.strictEqual(on.$("roughWords").hidden, true);                        // Silences + off-mic reads no words
  on.change("roughMode", "ai");
  assert.strictEqual(on.$("roughWords").hidden, false);
  assert.strictEqual(on.$("roughWords").textContent, "Words: ElevenLabs Scribe (sends the sound of the selected clips; ReShape projects stay on this computer)");
  on.change("roughMode", "silence");
  assert.strictEqual(on.$("roughWords").hidden, true);
  const off = setup({ cloud: { key: false, enabled: true, on: false } });
  await off.page.refreshWords();
  off.change("roughMode", "ai");
  assert.strictEqual(off.$("roughWords").textContent, "Words: read on this computer (slower)");
});

test("hesitation sounds can be ticked when Detect = AI-assisted or Cut = AI rough cut, and not otherwise", () => {
  const t = setup();
  assert.strictEqual(t.$("roughFillers").disabled, true);
  t.change("roughMethod", "ai");
  assert.strictEqual(t.$("roughFillers").disabled, false);
  t.change("roughMethod", "manual");
  assert.strictEqual(t.$("roughFillers").disabled, true);
  t.change("roughMode", "ai");                                   // AI rough cut with Manual dB
  assert.strictEqual(t.$("roughFillers").disabled, false);
  t.change("roughMode", "offmic");
  assert.strictEqual(t.$("roughFillers").disabled, true);
});

test("Simple puts the other options away and says the words are read; leaving it brings them back (0.10.157)", async () => {
  const t = setup();
  await t.page.refreshWords();
  t.change("roughMode", "simple");
  assert.deepStrictEqual([t.$("roughSimpleNote").hidden, t.$("roughAdvanced").hidden, t.$("roughActionRow").hidden], [false, true, true]);
  assert.match(t.$("roughWords").textContent, /^Words: ElevenLabs Scribe/);
  t.change("roughMode", "offmic");
  assert.deepStrictEqual([t.$("roughSimpleNote").hidden, t.$("roughAdvanced").hidden, t.$("roughActionRow").hidden], [true, false, false]);
  assert.strictEqual(t.$("roughWords").hidden, true);
  t.$("roughMarkTakes").checked = true;                          // the box alone has the words read too
  t.change("roughMarkTakes", "");
  assert.strictEqual(t.$("roughWords").hidden, false);
});
