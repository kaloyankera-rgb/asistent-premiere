// node --test tests/hostcutflow.test.js
// premiere-roughcut.hostCut / place (0.10.122): the panel's side of the host cut against a fake engine and host: Cancel between rounds,
// a stopped cut told as stopped, the progress driven by what is left to remove, the older copies way never silent, the Undo count.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const Module = require("node:module");

class UserError extends Error {}

function load(fake, pieces) {
  const log = [];
  const engine = { roughCut: fake, log: (lvl, msg) => log.push(`${lvl}: ${msg}`), roughLink: async () => ({ linked: 0 }) };
  const P = { UserError, debug: () => {}, trace: () => {}, has: () => false, maybe: async (o, n) => (n === "getSequences" ? [{ name: "N v1" }] : undefined),
    readItems: async () => ({ items: (pieces || []).map((p) => ({ kind: p.kind, track: p.track, start: p.start / 25, path: p.path, inPt: p.seq_in / 25 })) }), ensureBin: async () => ({}) };
  const orig = Module._load;
  Module._load = function (req, parent, ...rest) {
    if (req === "premierepro") return { SequenceEditor: {}, ProjectItem: { cast: (x) => x } };
    if (req === "./premiere.js") return P;
    if (req === "./engine.js") return engine;
    if (req === "./premiere-audio.js" || req === "./premiere-color.js") return {};
    if (req === "./premiere-captions.js") return { seqGuid: () => "g1" };
    return orig.call(this, req, parent, ...rest);
  };
  const file = path.join(__dirname, "..", "panel", "premiere-roughcut.js");
  delete require.cache[require.resolve(file)];
  const rc = require(file);
  Module._load = orig;
  return { rc, log };
}

const piece = (k, f, e, at) => ({ kind: k === "v" ? "video" : "audio", track: 0, item: k === "v" ? 0 : 1, seq_in: f, seq_out: e, start: at, path: "/m.mov" });
const result = (n = 2) => ({ name: "N v1", check: { fps: 25, frames: 100 }, marks: [],
  pieces: Array.from({ length: n }, (_, i) => piece("v", i * 100, i * 100 + 40, i * 40)) });
const input = { sequence: { name: "S" }, plan: { layout: [{ kind: "video", track: 0, start: 0, end: 20 }, { kind: "audio", track: 0, start: 0, end: 20 }], refs: [] } };

// a host that does everything at once; `rounds` makes razor and clean take several calls
function fakeHost(opt = {}) {
  const calls = [];
  const fn = async (body) => {
    calls.push(`${body.phase}${body.i !== undefined && body.phase !== "start" ? `@${body.i}` : ""}`);
    if (opt.onCall) opt.onCall(body, calls);
    if (body.phase === "start") return opt.start || { ok: true, cut: "g1-copy", tpf: 10 };
    if (body.phase === "razor") {
      const n = (body.cuts || []).length, step = opt.razorStep || n || 1, i = Math.min(n, (body.i || 0) + step);
      if (opt.razorFails) return { ok: false, msg: opt.razorFails };
      return { ok: true, i, done: i >= n, refused: 0, ...(body.i === 0 ? { tc: "00;00;04;00", rate: "59.974 fps", before: 3, after_first: 5 } : {}) };
    }
    if (body.phase === "clean") {
      opt.left = opt.left === undefined ? (opt.cleanRounds || 1) - 1 : opt.left - 1;
      return { ok: true, done: opt.left <= 0, removed: 4, refused: 0, left: Math.max(0, opt.left) * 4, overlap: opt.overlap || 0 };
    }
    if (body.phase === "move") return { ok: true, i: body.pieces.length, done: true, moved: 3, missing: 0 };
    return { ok: true, there: (body.pieces || []).length - (opt.notThere || 0), clips: (body.pieces || []).length, relocked: 0 };
  };
  fn.calls = calls;
  return fn;
}

test("a clean host cut: the notes say how many Undo steps it took, and the first razor's evidence is in the engine log", async () => {
  const host = fakeHost();
  const res = result();
  const { rc, log } = load(host, res.pieces);
  const r = await rc.hostCut({ path: "/p.prproj" }, res, input, () => {}, () => false);
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.stopped, undefined);
  assert.deepStrictEqual(host.calls.map((c) => c.split("@")[0]), ["start", "razor", "clean", "move", "finish"]);
  // 2 cuts (130 and 100 are inside clips) + 4 removed + 3 moved + 1: told as "about", never as a measured number
  assert.match(r.notes[1].text, /Undo, which would take about \d+ steps \(every cut, removal and move is its own\)/);
  assert.ok(log.some((l) => /first razor at "00;00;04;00" on a 59\.974 fps sequence: 3 clips before it, 5 after/.test(l)), log.join("\n"));
});

test("Cancel is looked at before the start and between rounds: the cut stops, says where, and says the sequence can be deleted", async () => {
  // before anything: nothing was made
  let { rc } = load(fakeHost());
  await assert.rejects(rc.hostCut({ path: "/p" }, result(), input, () => {}, () => true), /Cancelled\. Nothing was changed in Premiere\./);
  // after the razor's first round: stopped at cutting, no clean, no finish
  let n = 0;
  const host = fakeHost({ razorStep: 1 });
  ({ rc } = load(host));
  const r = await rc.hostCut({ path: "/p" }, result(), input, () => {}, () => host.calls.filter((c) => c.startsWith("razor")).length >= 1 && ++n > 0);
  assert.strictEqual(r.stopped, "cutting");
  assert.match(r.problems[0], /Stopped: you pressed Cancel\. The unfinished sequence "N v1" can be deleted; your own sequence was not changed\./);
  assert.ok(!host.calls.some((c) => c.startsWith("clean") || c.startsWith("finish")), host.calls.join(","));
});

test("a host step that fails is a stopped cut at that step, and its own message is not told twice", async () => {
  const msg = "Premiere did not cut the new sequence \"N v1\" where it was asked to: there is no clip edge at 2 of 2 cut frames (the sequence runs at 59.974 fps). Nothing was removed. The unfinished sequence \"N v1\" can be deleted; your own sequence was not changed.";
  const { rc } = load(fakeHost({ razorFails: msg }));
  const r = await rc.hostCut({ path: "/p" }, result(), input, () => {}, () => false);
  assert.strictEqual(r.stopped, "cutting");
  assert.deepStrictEqual(r.problems, [msg]);
});

test("Removing is driven by what is left, not by a total of zero", async () => {
  const said = [];
  const res = result();
  const { rc } = load(fakeHost({ cleanRounds: 3 }), res.pieces);
  const r = await rc.hostCut({ path: "/p" }, res, input, (m) => said.push(m), () => false);
  assert.deepStrictEqual(r.problems, []);
  const removing = said.filter((m) => /^Removing \d+ %/.test(m));
  assert.deepStrictEqual(removing, ["Removing 33 %…", "Removing 67 %…"]);
  assert.ok(!said.some((m) => m === "Removing 0 %…"));
});

test("clips that overlap a kept piece and stayed are reported as a problem", async () => {
  const { rc } = load(fakeHost({ overlap: 2 }));
  const r = await rc.hostCut({ path: "/p" }, result(), input, () => {}, () => false);
  assert.ok(r.problems.some((p) => /2 clips that overlap a kept piece were left/.test(p)), r.problems.join("|"));
});

test("a host that will not start: more than HOST_FALLBACK_PIECES pieces are refused, fewer fall back and say so", async () => {
  const start = { ok: false, msg: "Another project is in front in Premiere: bring this one to the front and press again. Nothing was made." };
  let { rc } = load(fakeHost({ start }));
  await assert.rejects(rc.hostCut({ path: "/p" }, result(41), input, () => {}, () => false), /Another project is in front.* Nothing was cut\./);
  const few = await rc.hostCut({ path: "/p" }, result(5), input, () => {}, () => false);
  assert.deepStrictEqual(Object.keys(few), ["fallback"]);
  assert.match(few.fallback, /Another project is in front in Premiere: bring this one to the front and press again\.$/);
  // no source places from the engine: refused when there are many pieces, a fallback otherwise
  const noPlaces = { ...result(50), pieces: result(50).pieces.map((p) => ({ ...p, seq_in: undefined })) };
  await assert.rejects(rc.hostCut({ path: "/p" }, noPlaces, input, () => {}, () => false), /did not say where the 50 pieces lie/);
  const few2 = await rc.hostCut({ path: "/p" }, { ...result(3), pieces: result(3).pieces.map((p) => ({ ...p, seq_in: undefined })) }, input, () => {}, () => false);
  assert.match(few2.fallback, /no source places/);
});

test("place: when the host did not make the cut, the older way says so in the result", async () => {
  const start = { ok: false, msg: "Another project is in front in Premiere: bring this one to the front and press again. Nothing was made." };
  const res = { ...result(3), xml: "/x.xml", check: { fps: 25, frames: 120, video: { 1: 3 }, audio: {} } };
  const { rc } = load(fakeHost({ start }), res.pieces);
  const project = { path: "/p", importFiles: async () => true };
  const placed = await rc.place(project, res, [], input, () => {}, () => false);
  assert.ok(placed.notes.some((n) => n.cls === "warn" && /The Asistent host did not make this cut \(Another project is in front/.test(n.text) && /older way was used/.test(n.text)), JSON.stringify(placed.notes));
});

test("a razor that needs several rounds still logs the first round's evidence", async () => {
  const res = result(3);
  const host = fakeHost({ razorStep: 1 });
  const { rc, log } = load(host, res.pieces);
  const r = await rc.hostCut({ path: "/p" }, res, input, () => {}, () => false);
  assert.ok(host.calls.filter((c) => c.startsWith("razor")).length >= 3, host.calls.join(","));
  assert.deepStrictEqual(r.problems, []);
  assert.ok(log.some((l) => /first razor at "00;00;04;00" on a 59\.974 fps sequence: 3 clips before it, 5 after/.test(l)), log.join("\n"));
});
