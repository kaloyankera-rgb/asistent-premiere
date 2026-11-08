// node --test tests/hostsubclip.test.js
// host.jsx as_side_clip run in node with a fake bin and fake project items (it is ES3, nothing Premiere-only at load time):
// two cameras with the same file name and range never share a subclip, and a copy whose channels failed is never reused
// (0.10.6, BUG-004).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function host() {
  const ctx = { app: {}, ProjectItemType: { BIN: 2 } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "host", "host.jsx"), "utf8").replace(/^﻿/, ""), ctx);
  return ctx;
}

function makeBin() {
  const kids = [];
  const children = new Proxy({}, { get: (_, k) => (k === "numItems" ? kids.length : kids[Number(k)]) });
  return { kids, children };
}

function master(media, { mapOk = true } = {}) {
  return {
    name: "C0001.MP4",
    getMediaPath: () => media,
    createSubClip(name, inT, outT) {
      const sub = { name, media, inS: Number(inT) / 254016000000, outS: Number(outT) / 254016000000, getMediaPath: () => media,
        getInPoint() { return { seconds: this.inS }; }, getOutPoint() { return { seconds: this.outS }; },
        moveBin(b) { b.kids.push(sub); },
        getAudioChannelMapping: { setMappingForChannel: () => mapOk }, setAudioChannelMapping: () => mapOk };
      return sub;
    },
  };
}

const clipOn = (inS, outS) => ({ inPoint: { seconds: inS, ticks: String(Math.round(inS * 254016000000)) }, outPoint: { seconds: outS, ticks: String(Math.round(outS * 254016000000)) } });

test("C0001.MP4 of two cameras, same range: two different subclips, each of its own media", () => {
  const h = host();
  const b = makeBin();
  const c = clipOn(3.84, 13.28);
  const a = h.as_side_clip(b, master("/Shoot/кам1/C0001.MP4"), c, "L");
  const bb = h.as_side_clip(b, master("/Shoot/кам2/C0001.MP4"), c, "L");
  assert.notStrictEqual(a, bb);
  assert.strictEqual(bb.getMediaPath(), "/Shoot/кам2/C0001.MP4");
  assert.match(a.name, /\s(L|R)\s\d+\.\d{2}-\d+\.\d{2}$/);                 // still read as a side by audioplan.sideOf
  assert.strictEqual(h.as_side_clip(b, master("/Shoot/кам1/C0001.MP4"), c, "L"), a);   // the same media again: reused
  assert.strictEqual(b.kids.length, 2);
});

test("a copy whose channels Premiere refused is renamed and never reused", () => {
  const h = host();
  const b = makeBin();
  const c = clipOn(1, 2);
  assert.throws(() => h.as_side_clip(b, master("/m/C0001.MP4", { mapOk: false }), c, "R"), /did not accept the channels/);
  assert.match(b.kids[0].name, / FAILED$/);
  const ok = h.as_side_clip(b, master("/m/C0001.MP4"), c, "R");
  assert.notStrictEqual(ok, b.kids[0]);
});
