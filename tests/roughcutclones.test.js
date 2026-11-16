// node --test tests/roughcutclones.test.js
// premiere-roughcut.cloneInto() on a faked timeline that applies clone, trim and move the way Premiere 26 does. The case
// from 2026-11-15: Cut silences at -30 dB made 101 cuts of an 8-minute clip (204 pieces with its audio); the whole-clip
// copies used to reach 28.6 hours of timeline and Premiere crashed. Now the copies go in batches that stay short.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const Module = require("node:module");

const TPS = 254016000000n;                 // ticks per second
const FPS = 30;
const TPF = TPS / BigInt(FPS);
const DAY = 24n * 3600n * TPS;

function setup(opts = {}) {
  const state = { items: [], maxEnd: 0n, transactions: 0, clones: 0 };
  const mk = (kind, track, start, end, inn) => {
    const it = { kind, track, start, end, inn };
    it.ti = {
      getStartTime: async () => ({ ticks: String(it.start) }),
      getEndTime: async () => ({ ticks: String(it.end) }),
      getInPoint: async () => ({ ticks: String(it.inn) }),
      // a head trim moves the start with it, as in Premiere; cloneInto reads the start again after the trim
      createSetInPointAction: (t) => () => { const v = BigInt(t.ticks); it.start += v - it.inn; it.inn = v; },
      createSetOutPointAction: (t) => () => { it.end = it.start + (BigInt(t.ticks) - it.inn); },
      createMoveAction: (t) => () => { const d = BigInt(t.ticks); it.start += d; it.end += d; },
    };
    state.items.push(it);
    state.maxEnd = state.maxEnd > end ? state.maxEnd : end;
    return it;
  };
  const editor = {
    createCloneTrackItemAction: (ti, t) => {
      if (opts.noAction && opts.noAction(ti, t)) return undefined;      // Premiere gave nothing ("Illegal Parameter type")
      return () => {
        const src = state.items.find((x) => x.ti === ti);
        const off = BigInt(t.ticks);
        const it = mk(src.kind, src.track, src.start + off, src.end + off, src.inn);
        state.clones++;
        if (opts.staleTrim && opts.staleTrim(state.clones)) {
          it.ti.createSetInPointAction = () => { throw new Error("The script object is no longer valid."); };
        }
      };
    },
  };
  const ppro = {
    SequenceEditor: { getEditor: () => editor },
    TickTime: { createWithTicks: (s) => ({ ticks: s }) },
  };
  const P = {
    has: (o, n) => !!o && typeof o[n] === "function",
    maybe: async (o, n) => (n === "getTimebase" ? String(TPF) : undefined),
    debug: () => {},
    trace: () => {},
    transaction: (project, label, build) => {
      state.transactions++;
      const acts = [];
      build({ addAction: (a) => acts.push(a) });
      state.most = Math.max(state.most || 0, acts.length);
      for (const a of acts) a();
      for (const it of state.items) state.maxEnd = state.maxEnd > it.end ? state.maxEnd : it.end;
    },
    readItems: async () => ({ items: state.items.map((it) => ({ kind: it.kind, track: it.track, ti: it.ti })) }),
  };
  const orig = Module._load;
  Module._load = function (req, parent, ...rest) {
    if (req === "premierepro") return ppro;
    if (req === "./premiere.js") return P;
    if (req === "./engine.js") return { roughLink: async () => ({ linked: 0 }), log: () => {} };
    return orig.call(this, req, parent, ...rest);
  };
  const file = path.join(__dirname, "..", "panel", "premiere-roughcut.js");
  delete require.cache[require.resolve(file)];
  // the project as cloneInto uses it: the lock, and a transaction that runs the actions it was given
  state.project = {
    lockedAccess: (fn) => fn(),
    executeTransaction: (build) => {
      state.transactions++;
      const acts = [];
      build({ addAction: (a) => acts.push(a) });
      state.most = Math.max(state.most || 0, acts.length);
      for (const a of acts) a();
      for (const it of state.items) state.maxEnd = state.maxEnd > it.end ? state.maxEnd : it.end;
      return true;
    },
  };
  const rc = require(file);
  rc._quiet(0);
  Module._load = orig;
  return { rc, state, mk };
}

test("204 pieces of an 8-minute clip: the copies never reach 24 hours and every piece lands in place", async () => {
  const { rc, state, mk } = setup();
  const clipFrames = Math.round(492.8 * FPS);
  const v = mk("video", 0, 0n, BigInt(clipFrames) * TPF, 0n);
  const a = mk("audio", 0, 0n, BigInt(clipFrames) * TPF, 0n);
  const original = new Set(state.items);
  const pieces = [];
  let at = 0;
  for (let k = 0; k < 102; k++) {
    const src_in = k * 144, src_out = src_in + 40;            // 102 kept moments of 40 frames, 101 cuts between them
    for (const [item, kind] of [[0, "video"], [1, "audio"]]) pieces.push({ item, kind, track: 0, src_in, src_out, start: at, end: at + 40, path: "/m.mov" });
    at += 40;
  }
  const result = { check: { fps: FPS, frames: at }, pieces };
  const r = await rc.cloneInto(state.project, { name: "S" }, result, [{ ti: v.ti }, { ti: a.ti }]);
  assert.strictEqual(r.pieces, 204);
  assert.strictEqual(r.placed, 204);
  assert.strictEqual(r.missing, 0);
  assert.ok(r.batches > 1, "the copies were made in batches");
  assert.ok(state.maxEnd < DAY, `the timeline reached ${Number(state.maxEnd / TPS) / 3600} hours`);
  assert.ok(state.maxEnd < 3n * 3600n * TPS, "a batch stays within about two hours after the end");
  const copies = state.items.filter((it) => !original.has(it));
  for (const p of pieces) {
    const hit = copies.filter((c) => c.kind === p.kind && c.start === BigInt(p.start) * TPF && c.end === BigInt(p.end) * TPF &&
      c.inn === BigInt(p.src_in) * TPF);
    assert.strictEqual(hit.length, 1, `piece ${p.kind} at frame ${p.start}`);
  }
  assert.strictEqual(state.transactions, 2 * r.batches);      // the copies; the trim and the move together (0.10.104)
});

test("a short cut still goes in one batch of two steps", async () => {
  const { rc, state, mk } = setup();
  const v = mk("video", 0, 0n, BigInt(60 * FPS) * TPF, 0n);
  const pieces = [{ item: 0, kind: "video", track: 0, src_in: 0, src_out: 300, start: 0, end: 300 },
    { item: 0, kind: "video", track: 0, src_in: 600, src_out: 900, start: 300, end: 600 }];
  const r = await rc.cloneInto(state.project, { name: "S" }, { check: { fps: FPS, frames: 600 }, pieces }, [{ ti: v.ti }]);
  assert.strictEqual(r.batches, 1);
  assert.strictEqual(r.placed, 2);
  assert.strictEqual(state.transactions, 2);
});

test("a piece Premiere refuses is skipped and reported; nothing throws out of a transaction and the rest is placed", async () => {
  // 0.10.95: "Illegal Parameter type" from addAction (05:52:05) and "The script object is no longer valid" on a trim
  // (05:52:15) threw out of the middle of a transaction; the actions before it were kept and the next press crashed Premiere
  let audioClones = 0;
  const { rc, state, mk } = setup({
    staleTrim: (n) => n === 3,                                          // the third copy cannot be trimmed
    noAction: (ti) => ti === audioTi && ++audioClones === 4,            // the last audio copy gets no action at all
  });
  const v = mk("video", 0, 0n, BigInt(60 * FPS) * TPF, 0n);
  const a = mk("audio", 0, 0n, BigInt(60 * FPS) * TPF, 0n);
  const audioTi = a.ti;
  const pieces = [];
  for (let k = 0; k < 4; k++) {
    for (const [item, kind] of [[0, "video"], [1, "audio"]]) {
      pieces.push({ item, kind, track: 0, src_in: k * 300, src_out: k * 300 + 100, start: k * 100, end: k * 100 + 100, path: "/m.mov" });
    }
  }
  const r = await rc.cloneInto(state.project, { name: "S" }, { check: { fps: FPS, frames: 400 }, pieces }, [{ ti: v.ti }, { ti: a.ti }]);
  assert.strictEqual(r.pieces, 8);
  // the copy that cannot be trimmed is tried again with a handle read anew (four tries in all), then given up
  assert.deepStrictEqual(r.failed.map((f) => f.step).sort(), ["copy", "place"]);
  assert.strictEqual(r.placed, 6);
  assert.strictEqual(r.missing, 2);
  assert.strictEqual(state.transactions, 2, "the copies, then the trim and the move of the six: each committed whole");
});

test("many short clips: a batch is at most 20 pieces, however little timeline they need (0.10.98)", async () => {
  // the user's crash of 2026-11-15 15:33: 133 pieces of 49 short clips fitted two hours of scratch, so all went in one transaction
  const { rc, state, mk } = setup();
  const refs = [];
  const pieces = [];
  let at = 0;
  for (let k = 0; k < 49; k++) {
    const it = mk(k % 2 ? "audio" : "video", k % 4, BigInt(k * 7 * FPS) * TPF, BigInt((k * 7 + 6) * FPS) * TPF, 0n);     // 6 s clips
    refs.push({ ti: it.ti });
    for (let j = 0; j < (k % 3) + 2; j++) {
      pieces.push({ item: k, kind: k % 2 ? "audio" : "video", track: k % 4, src_in: j * 40, src_out: j * 40 + 30, start: at, end: at + 30, path: `/c${k}.mp4` });
      at += 30;
    }
  }
  // (the test keeps the editor's clips and the copies in one list: the scratch area starts after both)
  const r = await rc.cloneInto(state.project, { name: "S" }, { check: { fps: FPS, frames: Math.max(at, 400 * FPS) }, pieces }, refs);
  assert.strictEqual(r.placed, pieces.length);
  assert.strictEqual(r.batches, Math.ceil(pieces.length / 20));
  assert.ok(state.most <= 60, `a transaction held ${state.most} actions`);       // 20 copies, or 20 pieces' In, Out and move
});

// 0.10.108: what the host gets for its cut in a duplicate (hostPlan, pure)
test("hostPlan: cuts only inside clips, Mute cuts only the sound, pieces keep their output place", () => {
  const { rc } = setup();
  const layout = [{ kind: "video", track: 0, start: 4, end: 10 }, { kind: "audio", track: 0, start: 4, end: 10 }];
  // 25 fps: the clip lies at frames 100-250; 130-150 goes (Remove) -> every piece of both tracks, cut at 130 and 150
  const result = { check: { fps: 25 }, pieces: [
    { kind: "video", track: 0, item: 0, seq_in: 100, seq_out: 130, start: 0 }, { kind: "audio", track: 0, item: 1, seq_in: 100, seq_out: 130, start: 0 },
    { kind: "video", track: 0, item: 0, seq_in: 150, seq_out: 250, start: 30 }, { kind: "audio", track: 0, item: 1, seq_in: 150, seq_out: 250, start: 30 }] };
  const plan = rc.hostPlan(result, layout);
  assert.deepStrictEqual(plan.cuts, [{ f: 130, only: "" }, { f: 150, only: "" }]);
  assert.strictEqual(plan.moves, 4);
  assert.deepStrictEqual(plan.pieces[0], { k: "v", t: 0, f: 100, e: 130, at: 0 });
  // Mute: the picture whole, the sound cut -> the cuts are for the sound only
  const mute = rc.hostPlan({ check: { fps: 25 }, pieces: [
    { kind: "video", track: 0, item: 0, seq_in: 100, seq_out: 250, start: 0 },
    { kind: "audio", track: 0, item: 1, seq_in: 100, seq_out: 130, start: 0 }, { kind: "audio", track: 0, item: 1, seq_in: 150, seq_out: 250, start: 50 }] }, layout);
  assert.deepStrictEqual(mute.cuts, [{ f: 130, only: "a" }, { f: 150, only: "a" }]);
  // In to Out: the engine saw only 4-8 s of the clip; the clip's true end (from the timeline, ticks) makes 200 a cut too
  const TPF25 = 10160640000n;
  const refs = [{ tk: { start: 100n * TPF25, end: 250n * TPF25 } }, { tk: { start: 100n * TPF25, end: 250n * TPF25 } }];
  const io = rc.hostPlan({ check: { fps: 25 }, pieces: [{ kind: "video", track: 0, item: 0, seq_in: 100, seq_out: 200, start: 0 }] },
    [{ kind: "video", track: 0, start: 4, end: 8 }], refs, Number(TPF25));
  assert.deepStrictEqual(io.cuts, [{ f: 200, only: "" }]);
  // an engine without the source places: no host plan (the copies way)
  assert.strictEqual(rc.hostPlan({ check: { fps: 25 }, pieces: [{ kind: "video", track: 0, item: 0, start: 0 }] }, layout), null);
});
