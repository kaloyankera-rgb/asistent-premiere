// node --test tests/folderplan.test.js — the Folders page's rules (0.10.144)
const test = require("node:test");
const assert = require("node:assert");
const FP = require("../panel/folderplan.js");

test("paths: one separator, no trailing slash, names and parents", () => {
  assert.strictEqual(FP.norm("C:\\Clients\\GStroy\\"), "C:/Clients/GStroy");
  assert.strictEqual(FP.norm("/Volumes/Production//GStroy/"), "/Volumes/Production/GStroy");
  assert.strictEqual(FP.norm("\\\\server\\share\\a"), "//server/share/a");
  assert.strictEqual(FP.basename("/a/b/Music/"), "Music");
  assert.strictEqual(FP.dirname("/a/b/p.prproj"), "/a/b");
  assert.strictEqual(FP.dirname("C:/p.prproj"), "C:/");
  assert.strictEqual(FP.projectDir("/x/Видео 7/Assets/Credissimo КП-14.prproj"), "/x/Видео 7/Assets");
  assert.strictEqual(FP.projectDir(""), null);                     // never saved
});

test("relative to the project: down, up, the same folder, another drive", () => {
  assert.strictEqual(FP.relativePath("/p/Видео 7/Assets", "/p/Видео 7/Assets/Music"), "Music");
  assert.strictEqual(FP.relativePath("/p/Видео 7/Assets", "/p/Видео 7/Кам 1"), "../Кам 1");
  assert.strictEqual(FP.relativePath("/p/a", "/p/a"), ".");
  assert.strictEqual(FP.relativePath("C:/p/a", "c:/p/b"), "../b");
  assert.strictEqual(FP.relativePath("C:/p", "D:/p"), null);
  assert.strictEqual(FP.relativePath("//srv/share/p", "//srv/share/q/r"), "../q/r");
  assert.strictEqual(FP.relativePath("//srv/share/p", "//srv/other/p"), null);
  assert.strictEqual(FP.join("/p/Видео 8/Assets", "../Кам 1"), "/p/Видео 8/Кам 1");
  assert.strictEqual(FP.join("/p", "../../.."), "/");                         // never above the root
  assert.strictEqual(FP.join("C:/p/a", "../b"), "C:/p/b");
  assert.strictEqual(FP.join("//Srv/Share/p", "q"), "//Srv/Share/p/q");     // the share keeps its case
});

test("add: the folder's name as the label, no duplicates", () => {
  let r = FP.add([], ["/Users/k/Downloads/", "/Volumes/Production/GStroy/Music"]);
  assert.deepStrictEqual(r.added, ["Downloads", "Music"]);
  assert.strictEqual(r.items[0].color, "none");
  assert.strictEqual(r.items[0].rel, null);
  r = FP.add(r.items, ["/users/k/downloads", "/x/SFX"]);
  assert.deepStrictEqual(r.already, ["Downloads"]);
  assert.deepStrictEqual(r.added, ["SFX"]);
  assert.strictEqual(new Set(r.items.map((i) => i.id)).size, 3);
});

test("rename, colour, move, remove", () => {
  let items = FP.add([], ["/a/One", "/a/Two", "/a/Three"]).items;
  const [a, b, c] = items.map((i) => i.id);
  items = FP.rename(items, a, "  Music   from   Epidemic ");
  assert.strictEqual(items[0].label, "Music from Epidemic");
  items = FP.rename(items, a, "   ");
  assert.strictEqual(items[0].label, "One");                                  // empty: back to the folder's name
  assert.strictEqual(FP.rename(items, a, "x".repeat(99))[0].label.length, FP.LABEL_MAX);
  items = FP.recolor(items, b, "green");
  assert.strictEqual(items[1].color, "green");
  assert.strictEqual(FP.recolor(items, b, "pink")[1].color, "none");
  assert.deepStrictEqual(FP.move(items, c, -1).map((i) => i.id), [a, c, b]);
  assert.deepStrictEqual(FP.move(items, a, -1).map((i) => i.id), [a, b, c]);  // the top stays
  assert.deepStrictEqual(FP.remove(items, b).map((i) => i.id), [a, c]);
});

test("follows the project: on needs a saved project on the same drive; the button then follows each project", () => {
  let items = FP.add([], ["/p/Видео 7/Assets/Music"]).items;
  const id = items[0].id;
  assert.ok(FP.setRelative(items, id, true, null).error);
  assert.ok(FP.setRelative(FP.add([], ["D:/x"]).items, "f1", true, "C:/p").error);
  const r = FP.setRelative(items, id, true, "/p/Видео 7/Assets");
  assert.strictEqual(r.error, null);
  items = r.items;
  assert.strictEqual(items[0].rel, "Music");
  assert.strictEqual(FP.resolve(items[0], "/p/Видео 8/Assets"), "/p/Видео 8/Assets/Music");
  assert.strictEqual(FP.resolve(items[0], null), null);
  assert.match(FP.tip(items[0], null), /open a saved project/);
  const off = FP.setRelative(items, id, false, "/p/Видео 8/Assets").items;   // off: fixed at where it points now
  assert.strictEqual(off[0].rel, null);
  assert.strictEqual(off[0].path, "/p/Видео 8/Assets/Music");
});

test("the store: saved and loaded back; broken values never break the page", () => {
  const items = FP.recolor(FP.add([], ["/a/One", "/a/Two"]).items, "f2", "blue");
  assert.deepStrictEqual(FP.load(FP.save(items)), items);
  assert.deepStrictEqual(FP.load(null), []);
  assert.deepStrictEqual(FP.load("{not json"), []);
  assert.deepStrictEqual(FP.load({ items: [{ path: "" }, null, { path: "/a/X", color: "pink", id: "f1" }, { path: "/a/Y", id: "f1" }] })
    .map((i) => [i.id, i.label, i.color]), [["f1", "X", "none"], ["f2", "Y", "none"]]);
});

// 0.10.145: the CEP Folders panel loads its own copy of the rules (the host bundle is installed apart from the UXP panel)
test("host/folderplan.js is an exact copy of panel/folderplan.js", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const a = fs.readFileSync(path.join(__dirname, "..", "panel", "folderplan.js"), "utf8");
  const b = fs.readFileSync(path.join(__dirname, "..", "host", "folderplan.js"), "utf8");
  assert.strictEqual(b, a, "copy panel/folderplan.js to host/folderplan.js after changing it");
});
