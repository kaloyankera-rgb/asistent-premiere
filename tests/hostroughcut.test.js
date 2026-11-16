// node --test tests/hostroughcut.test.js
// host.jsx as_rough_cut (0.10.108): the cut is made in a DUPLICATE of the editor's sequence (clone, razor, remove what is
// not a kept piece, move the pieces together). A small model of Premiere stands in: tracks of clips, a sequence razor that
// cuts every unlocked track, remove and move on one clip. The editor's own sequence must come out untouched.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const TPF = 10;                                              // ticks per frame in the model
const list = (items, count) => new Proxy({}, { get: (_, k) => (k === count ? items.length : items[Number(k)]) });

function track(clips) {
  const t = { items: [], locked: false, setLocked: (v) => { t.locked = !!v; }, isLocked: () => t.locked };
  t.add = (f, e, name) => {
    const c = { name, start: { ticks: String(f * TPF) }, end: { ticks: String(e * TPF) } };
    c.remove = () => { t.items.splice(t.items.indexOf(c), 1); return true; };
    c.move = (tm) => { c.start = { ticks: String(Number(c.start.ticks) + Number(tm.ticks)) }; c.end = { ticks: String(Number(c.end.ticks) + Number(tm.ticks)) }; t.items.sort((x, y) => Number(x.start.ticks) - Number(y.start.ticks)); };
    t.items.push(c);
    t.items.sort((x, y) => Number(x.start.ticks) - Number(y.start.ticks));
  };
  for (const [f, e, name] of clips) t.add(f, e, name);
  t.clips = new Proxy({}, { get: (_, k) => (k === "numItems" ? t.items.length : t.items[Number(k)]) });
  return t;
}

function sequence(proj, name, id, video, audio, zero = 0) {
  const s = { name, sequenceID: id, timebase: String(TPF), zeroPoint: String(zero), v: video.map(track), a: audio.map(track), marks: [] };
  s.videoTracks = list(s.v, "numTracks");
  s.audioTracks = list(s.a, "numTracks");
  s.getSettings = () => ({ videoFrameRate: {}, videoDisplayFormat: 102 });
  s.projectItem = { moveBin: (b) => { s.bin = b.name; } };
  s.setPlayerPosition = () => {};
  s.setInPoint = (sec) => { s.inPt = sec; };
  s.setOutPoint = (sec) => { s.outPt = sec; };
  s.end = "0";
  s.getSelection = () => [];
  s.markers = { getFirstMarker: () => s.marks[0], getNextMarker: (m) => s.marks[s.marks.indexOf(m) + 1],
    deleteMarker: (m) => s.marks.splice(s.marks.indexOf(m), 1), createMarker: (sec) => { const m = { sec }; s.marks.push(m); return m; } };
  s.clone = () => {
    const dump = (ts) => ts.map((t) => t.items.map((c) => [Number(c.start.ticks) / TPF, Number(c.end.ticks) / TPF, c.name]));
    const c = sequence(proj, `${name} Copy`, `${id}-copy${proj.seqs.length}`, dump(s.v), dump(s.a), zero);
    c.marks = s.marks.map((m) => ({ ...m }));
    proj.seqs.push(c);
    return true;
  };
  return s;
}

function host() {
  const proj = { name: "NEW TEST.prproj", path: "/p/NEW TEST.prproj", seqs: [], bins: [], active: null };
  proj.sequences = list(proj.seqs, "numSequences");
  proj.rootItem = { children: list(proj.bins, "numItems"), createBin: (name) => { const b = { name, type: 2 }; proj.bins.push(b); return b; } };
  proj.openSequence = (id) => { proj.active = proj.seqs.find((s) => s.sequenceID === id) || proj.active; return true; };
  Object.defineProperty(proj, "activeSequence", { get: () => proj.active });
  const razored = [];
  const qe = { project: { getActiveSequence: () => ({ name: proj.active.name, razor: (tc) => {
    const at = Number(tc) - Number(proj.active.zeroPoint);                 // the model's "timecode" is the tick with the start offset
    razored.push(proj.active.name);
    for (const t of [...proj.active.v, ...proj.active.a]) {
      if (t.locked) continue;
      const c = t.items.find((x) => Number(x.start.ticks) < at && at < Number(x.end.ticks));
      if (!c) continue;
      const end = Number(c.end.ticks) / TPF;
      c.end = { ticks: String(at) };
      t.add(at / TPF, end, c.name);
    }
    return true;
  } }) } };
  function Time() { this.ticks = "0"; }
  Time.prototype.getFormatted = function () { return this.ticks; };
  const app = { projects: list([proj], "numProjects"), project: proj, enableQE: () => {} };
  const ctx = { app, qe, Time, ProjectItemType: { BIN: 2 } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "host", "host.jsx"), "utf8").replace(/^﻿/, ""), ctx);
  // the host answers in JSON text (as_result), as it does to the engine
  const raw = ctx.as_run;
  ctx.run = (name, args) => JSON.parse(raw(name, args));
  return { ctx, proj, razored };
}

const shape = (s) => ({ v: s.v.map((t) => t.items.map((c) => `${Number(c.start.ticks) / TPF}-${Number(c.end.ticks) / TPF}`)),
  a: s.a.map((t) => t.items.map((c) => `${Number(c.start.ticks) / TPF}-${Number(c.end.ticks) / TPF}`)) });

function run(h, base, pieces, cuts, marks) {
  const made = h.ctx.run("rough_cut", { ...base, phase: "start" });
  assert.strictEqual(made.ok, true, made.msg);
  const call = (phase, extra) => {
    const r = h.ctx.run("rough_cut", { ...base, cut: made.cut, phase, ...extra });
    assert.strictEqual(r.ok, true, r.msg);
    return r;
  };
  const out = { made };
  out.razor = call("razor", { cuts, i: 0 });
  out.clean = call("clean", { pieces });
  out.move = call("move", { pieces, i: 0 });
  out.finish = call("finish", { pieces, marks: marks || [], i: pieces.some((p) => p.at !== p.f) ? 1 : 0 });
  return out;
}

test("Remove: the duplicate holds exactly the kept pieces, closed up; the editor's sequence is untouched", () => {
  const h = host();
  const src = sequence(h.proj, "SYNC", "g1", [[[100, 200, "cam"]], [[120, 160, "not selected"]]], [[[100, 200, "mic"]]]);
  src.marks.push({ sec: 1 });
  h.proj.seqs.push(src);
  h.proj.active = src;
  const before = JSON.stringify(shape(src));
  // 130-150 goes; the output starts at 0
  const pieces = [{ k: "v", t: 0, f: 100, e: 130, at: 0 }, { k: "a", t: 0, f: 100, e: 130, at: 0 }, { k: "v", t: 0, f: 150, e: 200, at: 30 }, { k: "a", t: 0, f: 150, e: 200, at: 30 }];
  const out = run(h, { sequence: "SYNC", guid: "g1", project: h.proj.path, name: "NO SILENCE – SYNC v1", bin: "No silence" }, pieces,
    [{ f: 130, only: "" }, { f: 150, only: "" }], [{ frame: 30, name: "Review", comment: "look" }]);
  assert.strictEqual(JSON.stringify(shape(src)), before, "the editor's sequence changed");
  assert.strictEqual(src.marks.length, 1);
  const made = h.proj.seqs.find((s) => s.sequenceID === out.made.cut);
  assert.strictEqual(made.name, "NO SILENCE – SYNC v1");
  assert.strictEqual(made.bin, "No silence");
  assert.deepStrictEqual(shape(made), { v: [["0-30", "30-80"], []], a: [["0-30", "30-80"]] });
  assert.deepStrictEqual(h.razored, ["NO SILENCE – SYNC v1", "NO SILENCE – SYNC v1"], "the razor ran on another sequence");
  assert.strictEqual(out.finish.there, 4);
  assert.strictEqual(out.finish.clips, 4);
  assert.strictEqual(made.marks.length, 1);                                // the copied marker went, the review marker came
  assert.strictEqual(made.marks[0].name, "Review");
  assert.strictEqual(made.inPt, 0);                                        // the editor's In / Out do not come along
  assert.strictEqual(made.outPt, 0);
});

test("Mute: only the sound is cut and removed, the picture stays whole", () => {
  const h = host();
  const src = sequence(h.proj, "S", "g1", [[[0, 100, "cam"]]], [[[0, 100, "mic"]]]);
  h.proj.seqs.push(src);
  h.proj.active = src;
  const pieces = [{ k: "v", t: 0, f: 0, e: 100, at: 0 }, { k: "a", t: 0, f: 0, e: 40, at: 0 }, { k: "a", t: 0, f: 60, e: 100, at: 60 }];
  const out = run(h, { sequence: "S", guid: "g1", project: h.proj.path, name: "NO SILENCE – S v1" }, pieces, [{ f: 40, only: "a" }, { f: 60, only: "a" }]);
  const made = h.proj.seqs.find((s) => s.sequenceID === out.made.cut);
  assert.deepStrictEqual(shape(made), { v: [["0-100"]], a: [["0-40", "60-100"]] });
  assert.ok(made.v.every((t) => !t.locked) && made.a.every((t) => !t.locked), "a track was left locked");
  assert.strictEqual(out.move.moved, 0);
});

test("a sequence that starts at another timecode is cut at the same frames", () => {
  const h = host();
  const src = sequence(h.proj, "S", "g1", [[[0, 100, "cam"]]], [], 36000);
  h.proj.seqs.push(src);
  h.proj.active = src;
  const pieces = [{ k: "v", t: 0, f: 0, e: 40, at: 0 }, { k: "v", t: 0, f: 60, e: 100, at: 40 }];
  const out = run(h, { sequence: "S", guid: "g1", project: h.proj.path, name: "N v1" }, pieces, [{ f: 40, only: "" }, { f: 60, only: "" }]);
  assert.deepStrictEqual(shape(h.proj.seqs.find((s) => s.sequenceID === out.made.cut)).v, [["0-40", "40-80"]]);
});

test("the razor did not cut: nothing is removed and the editor is told", () => {
  const h = host();
  const src = sequence(h.proj, "S", "g1", [[[0, 100, "cam"]]], []);
  h.proj.seqs.push(src);
  h.proj.active = src;
  const base = { sequence: "S", guid: "g1", project: h.proj.path, name: "N v1" };
  const made = h.ctx.run("rough_cut", { ...base, phase: "start" });
  const r = h.ctx.run("rough_cut", { ...base, cut: made.cut, phase: "clean", pieces: [{ k: "v", t: 0, f: 0, e: 40, at: 0 }] });
  assert.strictEqual(r.ok, false);
  assert.match(r.msg, /did not cut/);
  assert.strictEqual(h.proj.seqs.find((s) => s.sequenceID === made.cut).v[0].items.length, 1);
});

test("a phase never works on a sequence that is not the duplicate it made", () => {
  const h = host();
  const src = sequence(h.proj, "S", "g1", [[[0, 100, "cam"]]], []);
  h.proj.seqs.push(src);
  h.proj.active = src;
  const before = JSON.stringify(shape(src));
  // the editor's own sequence given as the one to cut: refused, by its name
  for (const phase of ["razor", "clean", "move", "finish"]) {
    const r = h.ctx.run("rough_cut", { sequence: "S", guid: "g1", project: h.proj.path, name: "N v1", cut: "g1", phase, cuts: [{ f: 50, only: "" }], pieces: [] });
    assert.strictEqual(r.ok, false, phase);
  }
  assert.strictEqual(JSON.stringify(shape(src)), before);
  // the name is taken: nothing is made
  const taken = h.ctx.run("rough_cut", { sequence: "S", guid: "g1", project: h.proj.path, name: "S", phase: "start" });
  assert.strictEqual(taken.ok, false);
  assert.strictEqual(h.proj.seqs.length, 1);
});

test("the time budget: a phase stops, says where, and goes on from there", () => {
  const h = host();
  const src = sequence(h.proj, "S", "g1", [[[0, 1000, "cam"]]], []);
  h.proj.seqs.push(src);
  h.proj.active = src;
  const base = { sequence: "S", guid: "g1", project: h.proj.path, name: "N v1" };
  const made = h.ctx.run("rough_cut", { ...base, phase: "start" });
  const cuts = [];
  for (let f = 100; f < 1000; f += 100) cuts.push({ f, only: "" });
  h.ctx.AS_CUT_BUDGET = -1;                                                // every call is out of time at once
  const r0 = h.ctx.run("rough_cut", { ...base, cut: made.cut, phase: "razor", cuts, i: 0 });
  assert.strictEqual(r0.done, false);
  assert.strictEqual(r0.i, 0);
  h.ctx.AS_CUT_BUDGET = 15000;
  const r1 = h.ctx.run("rough_cut", { ...base, cut: made.cut, phase: "razor", cuts, i: 4 });
  assert.strictEqual(r1.done, true);
  assert.strictEqual(h.proj.seqs.find((s) => s.sequenceID === made.cut).v[0].items.length, 6);   // cuts 4..8 of 9
});
