// Pre-export: does each clip's picture fill the frame (panel/coverage.js, 0.10.44)
const test = require("node:test");
const assert = require("node:assert");
const C = require("../panel/coverage.js");

const V = { width: 1080, height: 1920 };
const UHD = { width: 3840, height: 2160, rotation: 0 };

test("a 4K B-roll at 100 % fills a vertical frame; at 88 % it leaves about 10 px at the top and bottom", () => {
  assert.equal(C.gap(UHD, { sw: 100 }, V).covered, true);
  const g = C.gap(UHD, { sw: 88 }, V);
  assert.equal(g.covered, false);
  assert.equal(g.top, 10);
  assert.equal(g.bottom, 10);
  assert.equal(g.left, 0);
  assert.equal(C.sides(g), "10 px at the top and bottom uncovered");
});

test("a 1080p horizontal clip at 100 % in a vertical frame: big bars; a phone's sideways file with rotation 90 fits exactly", () => {
  const g = C.gap({ width: 1920, height: 1080 }, { sw: 100 }, V);
  assert.equal(g.top, 420);
  assert.equal(C.gap({ width: 1920, height: 1080, rotation: 90 }, { sw: 100 }, V).covered, true);
});

test("Position, Anchor Point and Crop move the edges", () => {
  const exact = { width: 1080, height: 1920 };
  assert.equal(C.gap(exact, { sw: 100, x: (540 + 20) / 1080 }, V).left, 20);
  assert.equal(C.gap(exact, { sw: 100, ay: 0.51 }, V).bottom, 19);
  assert.equal(C.gap(exact, { sw: 100, crop: { b: 2 } }, V).bottom, 38);
  assert.equal(C.gap(exact, { sw: 100, x: 0.5 + 0.2 / 1080 }, V).covered, true);   // under half a pixel: rounding
});

test("Scale to Frame Size fits the whole file inside the frame first", () => {
  const g = C.gap(UHD, { sw: 100, fit: true }, V);
  assert.equal(g.covered, false);
  assert.equal(g.top, 656);
  assert.equal(C.gap(UHD, { sw: 316.1, fit: true }, V).covered, true);
});

test("non-uniform scale and rotation", () => {
  const exact = { width: 1080, height: 1920 };
  assert.equal(C.gap(exact, { sw: 100, sh: 98 }, V).top, 19);
  const r = C.gap(exact, { sw: 100, rot: 5 }, V);
  assert.equal(r.covered, false);
  assert.equal(r.rotated, true);
  assert.equal(C.gap(exact, { sw: 125, rot: 5 }, V).covered, true);
});

test("which clips are checked: video and photo files; not PNG logos, transparent files, graphics or switched-off clips", () => {
  const f = { width: 10, height: 10 };
  assert.equal(C.checked({ path: "/a/b.mp4" }, f), true);
  assert.equal(C.checked({ path: "/a/photo.JPG" }, f), true);
  assert.equal(C.checked({ path: "/a/logo.png" }, f), false);
  assert.equal(C.checked({ path: "/a/alpha.mov" }, { ...f, alpha: true }), false);
  assert.equal(C.checked({ path: null }, f), false);
  assert.equal(C.checked({ path: "/a/b.mp4", unused: true }, f), false);
  assert.equal(C.checked({ path: "/a/b.mp4", adjustment: true }, f), false);
});

test("the report says where, how much and what shows through, at the worst moment of a scale animation", () => {
  const talk = { name: "C0728.MP4", track: 0, start: 0, end: 30, path: "/m/C0728.MP4", kind: "video", samples: [{ at: 0, m: { sw: 100 } }] };
  const broll = { name: "broll.mp4", track: 1, start: 10, end: 14, path: "/m/broll.mp4", kind: "video",
    samples: [{ at: 10, m: { sw: 100 } }, { at: 13.5, m: { sw: 88 } }] };
  const lonely = { name: "end.mp4", track: 1, start: 40, end: 42, path: "/m/end.mp4", kind: "video", samples: [{ at: 40, m: { sw: 85 } }] };
  const files = { "/m/C0728.MP4": { width: 1080, height: 1920 }, "/m/broll.mp4": UHD, "/m/end.mp4": UHD };
  const r = C.check([talk, broll, lonely], files, V);
  assert.equal(r.looked, 3);
  assert.equal(r.bad.length, 2);
  assert.match(r.bad[0].text, /^V2 broll\.mp4 at 0:13\.5: 10 px at the top and bottom uncovered \(scale 88 %\); V1 C0728\.MP4 shows through$/);
  assert.match(r.bad[1].text, /black shows$/);
});
