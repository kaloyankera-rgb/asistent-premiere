// A folder dropped on the Auto import row (0.10.67): which path a drop carries
const test = require("node:test");
const assert = require("node:assert");
const D = require("../panel/dropfolder.js");

test("a file:// link (macOS and Windows), escaped spaces and a trailing slash", () => {
  assert.strictEqual(D.fromUri("file:///Users/k/My%20Downloads/"), "/Users/k/My Downloads/");
  assert.strictEqual(D.fromUri("file://localhost/Users/k/x"), "/Users/k/x");
  assert.strictEqual(D.fromUri("file:///C:/Users/k/Изтегляния"), "C:/Users/k/Изтегляния");
  assert.strictEqual(D.droppedPath({ uriList: "# comment\nfile:///Users/k/My%20Downloads/\nfile:///other" }), "/Users/k/My Downloads");
});

test("the files list wins (nativePath, then path); plain text only when it is a path", () => {
  assert.strictEqual(D.droppedPath({ files: [{ nativePath: "/Volumes/Production/Client/" }], uriList: "file:///x" }), "/Volumes/Production/Client");
  assert.strictEqual(D.droppedPath({ files: [{ name: "x" }, { path: "C:\\Users\\k\\Footage\\" }] }), "C:\\Users\\k\\Footage");
  assert.strictEqual(D.droppedPath({ text: "/Users/k/Footage\n" }), "/Users/k/Footage");
  assert.strictEqual(D.droppedPath({ text: "hello" }), null);
  assert.strictEqual(D.droppedPath({}), null);
  assert.strictEqual(D.droppedPath({ text: "C:\\" }), "C:\\");                    // a drive root keeps its slash
});

test("the drop event's parts, with a note for the log", () => {
  const e = { dataTransfer: { types: ["Files", "text/uri-list"], files: [{ nativePath: "/a/b" }], getData: (t) => (t === "text/uri-list" ? "file:///a/b" : "") } };
  const p = D.partsOf(e);
  assert.strictEqual(D.droppedPath(p), "/a/b");
  assert.match(p.note, /types Files,text\/uri-list, files 1 \(\/a\/b\), uri file:\/\/\/a\/b, text none/);
  assert.match(D.partsOf({}).note, /no dataTransfer/);
});
