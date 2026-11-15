// node --test tests/brandplan.test.js
// The Brand page's decisions (0.10.71): where an asset goes, its buttons, the quick list, search, colours, the kit shown.
const test = require("node:test");
const assert = require("node:assert");
const BP = require("../panel/brandplan.js");

const v = (track, start, end) => ({ kind: "video", track, start, end });
const a = (track, start, end) => ({ kind: "audio", track, start, end });

test("an asset goes just above every video clip it would overlap, never onto one", () => {
  const items = [v(0, 0, 10), v(1, 2, 4), v(2, 8, 9), a(0, 0, 10)];
  // 3 s for 2 s: V1 and V2 are busy there (V3 starts later) -> V3
  assert.deepStrictEqual(BP.placeOn(items, { video: 3, audio: 2 }, 3, 2), { video: 2, audio: 0, addVideo: 0, addAudio: 0, end: 5 });
  // 3 s for 6 s reaches V3's clip at 8 s -> above it, a new track
  const p = BP.placeOn(items, { video: 3, audio: 2 }, 3, 6);
  assert.strictEqual(p.video, 3);
  assert.strictEqual(p.addVideo, 1);
});

test("an empty spot goes on V1; an unknown length counts everything after the playhead", () => {
  assert.strictEqual(BP.placeOn([v(0, 0, 5)], { video: 1, audio: 1 }, 6, 3).video, 0);
  const p = BP.placeOn([v(0, 0, 5), v(1, 20, 25)], { video: 2, audio: 1 }, 6, null);
  assert.strictEqual(p.video, 2);
  assert.strictEqual(p.addVideo, 1);
  assert.strictEqual(p.end, Infinity);
});

test("touching clips do not count as overlapping (a clip that ends at the playhead)", () => {
  assert.strictEqual(BP.placeOn([v(0, 0, 5)], { video: 1, audio: 0 }, 5, 2).video, 0);
});

test("sound goes on the lowest free audio track, or a new one", () => {
  const items = [a(0, 0, 10), a(1, 0, 3)];
  assert.strictEqual(BP.placeOn(items, { video: 1, audio: 3 }, 4, 2, { audio: true }).audio, 1);
  const full = BP.placeOn([a(0, 0, 10), a(1, 0, 10)], { video: 1, audio: 2 }, 4, 2, { audio: true });
  assert.deepStrictEqual([full.audio, full.addAudio], [2, 1]);
  const only = BP.placeOn([v(0, 0, 10)], { video: 1, audio: 1 }, 4, 2, { video: false, audio: true });
  assert.deepStrictEqual([only.video, only.addVideo, only.audio], [0, 0, 0]);
});

test("the end of the sequence is the latest clip end on any track", () => {
  assert.strictEqual(BP.sequenceEnd([v(0, 0, 10), a(2, 3, 12.5)]), 12.5);
  assert.strictEqual(BP.sequenceEnd([]), 0);
});

test("colours: hex to rgb, the Color arguments, text on a swatch", () => {
  assert.deepStrictEqual(BP.hexToRgb("#98D100"), [152, 209, 0]);
  assert.strictEqual(BP.hexToRgb("98d100").join(), "152,209,0");
  assert.strictEqual(BP.hexToRgb("#98D1"), null);
  assert.deepStrictEqual(BP.colorArgs("#FF0000", 255), [255, 0, 0, 255]);
  assert.deepStrictEqual(BP.colorArgs("#FF8000", 1), [1, 0.502, 0, 1]);
  assert.strictEqual(BP.textOn("#FFFFFF"), "#111216");
  assert.strictEqual(BP.textOn("#251F20"), "#ffffff");
  assert.strictEqual(BP.textOn("#98D100"), "#111216");
});

test("buttons: pictures and clips are added, MOGRTs placed, references opened, the rest shown with the reason", () => {
  assert.deepStrictEqual(BP.actionsFor({ kind: "image", cat: "logos", importable: true }), { primary: "place", more: ["import", "show"] });
  assert.deepStrictEqual(BP.actionsFor({ kind: "video", cat: "video", importable: true }).more, ["end", "import", "show"]);
  assert.strictEqual(BP.actionsFor({ kind: "mogrt", cat: "presets", importable: false }).primary, "mogrt");
  assert.strictEqual(BP.actionsFor({ kind: "doc", cat: "references", importable: false }).primary, "open");
  const svg = BP.actionsFor({ kind: "vector", cat: "logos", importable: false, why: "Premiere does not import SVG: use the PNG version." });
  assert.deepStrictEqual([svg.primary, svg.why], ["show", "Premiere does not import SVG: use the PNG version."]);
  assert.match(BP.actionsFor({ kind: "effect", cat: "presets", importable: false }).why, /Import Presets/);
});

test("quick: favourites first, then the most used, no duplicates", () => {
  const kit = { assets: { logos: [{ rel: "a", fav: false, uses: 1 }, { rel: "b", fav: true, uses: 0 }], video: [{ rel: "c", fav: false, uses: 5 }, { rel: "d", uses: 0 }] } };
  assert.deepStrictEqual(BP.quick(kit).map((x) => x.rel), ["b", "c", "a"]);
  assert.deepStrictEqual(BP.quick({}), []);
});

test("search matches every word in name, folder, type and variant, ignoring case and accents", () => {
  const list = [{ name: "gstroy-logo-horizontal-white", rel: "assets/logo/gstroy-logo-horizontal-white.png", ext: "png", variant: "for dark backgrounds" },
    { name: "outro", rel: "assets/intro-outro/AULA outro.mp4", ext: "mp4", role: "outro" }];
  assert.strictEqual(BP.filter(list, "LOGO white").length, 1);
  assert.strictEqual(BP.filter(list, "dark").length, 1);
  assert.strictEqual(BP.filter(list, "mp4 outro").length, 1);
  assert.strictEqual(BP.filter(list, "").length, 2);
  assert.strictEqual(BP.filter([{ name: "Café", rel: "x", ext: "png" }], "cafe").length, 1);
});

test("the kit shown: the editor's choice when it still exists, else the detected one", () => {
  const kits = [{ id: "a" }, { id: "b" }];
  assert.deepStrictEqual(BP.chooseKit(kits, "a", "b"), { id: "b", how: "chosen" });
  assert.deepStrictEqual(BP.chooseKit(kits, "a", "gone"), { id: "a", how: "detected" });
  assert.deepStrictEqual(BP.chooseKit(kits, null, null), { id: null, how: "none" });
});

test("subtitle preset only when the Subtitles row has it; durations; bin names", () => {
  assert.strictEqual(BP.presetFor({ subtitle: { preset: "gstroy" } }, ["auto", "gstroy"]), "gstroy");
  assert.strictEqual(BP.presetFor({ subtitle: { preset: "fornetti" } }, ["auto", "gstroy"]), null);
  assert.strictEqual(BP.duration(4.4), "0:04");
  assert.strictEqual(BP.duration(75), "1:15");
  assert.strictEqual(BP.duration(null), "");
  assert.strictEqual(BP.binName("RE/SHAPE"), "Brand Kit - RE SHAPE");
});

test("a drop carries every file: the files list first, else uri-list lines, else text paths", () => {
  assert.deepStrictEqual(BP.droppedPaths({ files: [{ nativePath: "/a/x.png" }, { path: "/a/y.mov" }] }), ["/a/x.png", "/a/y.mov"]);
  assert.deepStrictEqual(BP.droppedPaths({ files: [], uriList: "# c\nfile:///Users/a/My%20Logo.png\nfile:///C:/k/o.mp4" }), ["/Users/a/My Logo.png", "C:/k/o.mp4"]);
  assert.deepStrictEqual(BP.droppedPaths({ files: [], text: "/a/b.png\nhello" }), ["/a/b.png"]);
  assert.deepStrictEqual(BP.droppedPaths({}), []);
});
