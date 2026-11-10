// node --test tests/hosttarget.test.js
// host.jsx as_target (0.10.25): the project is found by its path among the open ones and the sequence by its id, never by
// what ExtendScript has in front. Probed in Premiere 26.5.2 with TEST and NEW TEST open: `app.project` is the front project
// and `activeSequence` read from ANY project object is the front one's sequence (field report 2026-11-10: Fix audio said
// "No active sequence." 5 times out of 6).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function list(items, count) {
  return new Proxy({}, { get: (_, k) => (k === count ? items.length : items[Number(k)]) });
}

function host(projects, frontIndex, frontSeq) {
  const ps = projects.map((p) => ({ name: p.name, path: p.path, sequences: list(p.seqs, "numSequences") }));
  // Premiere's one active sequence, answered by every project object alike
  for (const p of ps) Object.defineProperty(p, "activeSequence", { get: () => frontSeq });
  const app = { projects: list(ps, "numProjects"), project: ps[frontIndex] };
  const ctx = { app, ProjectItemType: { BIN: 2 } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "host", "host.jsx"), "utf8").replace(/^﻿/, ""), ctx);
  return { ctx, ps };
}

const seq = (name, id) => ({ name, sequenceID: id });
const A = "/Users/k/Projects/NEW TEST.prproj";
const B = "/Users/k/Projects/TEST.prproj";

test("the panel's project is behind another one: its sequence is found by id", () => {
  const mine = seq("SYNC – кам2", "g-new");
  const theirs = seq("SYNC – кам2", "g-test");          // the same name in the front project
  const { ctx, ps } = host([{ name: "NEW TEST.prproj", path: A, seqs: [mine] }, { name: "TEST.prproj", path: B, seqs: [theirs] }], 1, theirs);
  const t = ctx.as_target({ project: A, guid: "g-new", sequence: "SYNC – кам2" });
  assert.strictEqual(t.error, undefined);
  assert.strictEqual(t.seq, mine);
  assert.strictEqual(t.project, ps[0]);
  assert.strictEqual(t.front, false);
});

test("without an id, the front project's sequence of the same name is never taken for the panel's", () => {
  const mine = seq("Main", "g-new");
  const theirs = seq("Main", "g-test");
  const { ctx } = host([{ name: "NEW TEST.prproj", path: A, seqs: [mine] }, { name: "TEST.prproj", path: B, seqs: [theirs] }], 1, theirs);
  assert.strictEqual(ctx.as_target({ project: A, sequence: "Main" }).seq, mine);
});

test("the front project with nothing open no longer reads as 'No active sequence.'", () => {
  const mine = seq("fx30 edit", "g-1");
  const { ctx } = host([{ name: "Credissimo.prproj", path: A, seqs: [mine] }, { name: "ReShape.prproj", path: B, seqs: [] }], 1, null);
  assert.strictEqual(ctx.as_target({ project: A, guid: "g-1", sequence: "fx30 edit" }).seq, mine);
});

test("a project that is not open, an unknown sequence and two same-named ones are refused in words", () => {
  const { ctx } = host([{ name: "NEW TEST.prproj", path: A, seqs: [seq("X", "1"), seq("X", "2")] }], 0, null);
  assert.match(ctx.as_target({ project: "/a/Other.prproj", sequence: "X" }).error, /Other\.prproj as open/);
  assert.match(ctx.as_target({ project: A, sequence: "Nope" }).error, /did not find the sequence "Nope"/);
  assert.match(ctx.as_target({ project: A, sequence: "X" }).error, /2 sequences named "X"/);
  assert.strictEqual(ctx.as_target({ project: A, guid: "2", sequence: "X" }).seq.sequenceID, "2");
});

test("paths compare without case and slash differences (Windows)", () => {
  const mine = seq("S", "g");
  const { ctx } = host([{ name: "P.prproj", path: "C:\\Work\\P.prproj", seqs: [mine] }], 0, mine);
  assert.strictEqual(ctx.as_target({ project: "c:/work/p.prproj", sequence: "S" }).seq, mine);
});
