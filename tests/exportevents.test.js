// Premiere's export events (panel/exportevents.js, 0.10.7): attached to every event this Premiere offers, the file's path
// taken from the event when it carries one, never a throw when the API is missing.
const test = require("node:test");
const assert = require("node:assert");
const { listen, pathIn, fieldsOf } = require("../panel/exportevents.js");

test("pathIn finds an absolute media path in any field", () => {
  assert.strictEqual(pathIn({ a: 1, outputFilePath: "/Volumes/Production/Exported Videos/X/Видео 1.mp4" }),
    "/Volumes/Production/Exported Videos/X/Видео 1.mp4");
  assert.strictEqual(pathIn({ file: "C:\\\\Exports\\\\a.mov" }), "C:\\\\Exports\\\\a.mov");
  assert.strictEqual(pathIn({ name: "a.mp4", preset: "/presets/x.epr", t: "RenderCompleteEvent" }), null);
  assert.strictEqual(pathIn(null), null);
});

test("fieldsOf reads prototype getters and skips functions", () => {
  class Ev { get outputFile() { return "/a/b.mp4"; } get bad() { throw new Error("no"); } method() {} }
  const f = fieldsOf(new Ev());
  assert.strictEqual(f.outputFile, "/a/b.mp4");
  assert.ok(String(f.bad).startsWith("?"));
  assert.ok(!("method" in f));
});

test("listen attaches globally and on the manager, and passes kind and path", async () => {
  const handlers = {};
  const manager = {};
  const ppro = {
    EncoderManager: { EVENT_RENDER_COMPLETE: "RenderCompleteEvent", EVENT_RENDER_ERROR: "RenderErrorEvent",
      EVENT_RENDER_CANCEL: "RenderCancelEvent", getManager: async () => manager },
    OperationCompleteEvent: { EVENT_EXPORT_MEDIA_COMPLETE: "OperationCompleteEvent.ExportMediaComplete" },
    EventManager: {
      addGlobalEventListener: async (v, h) => { (handlers[v] = handlers[v] || []).push(h); },
      addEventListener: async (target, v, h) => { assert.strictEqual(target, manager); (handlers[v] = handlers[v] || []).push(h); },
    },
  };
  const got = [];
  const attached = await listen(ppro, (kind, path, name) => got.push([kind, path, name]));
  assert.deepStrictEqual(attached, ["EncoderManager.EVENT_RENDER_COMPLETE", "EncoderManager.EVENT_RENDER_COMPLETE (manager)",
    "EncoderManager.EVENT_RENDER_ERROR", "EncoderManager.EVENT_RENDER_ERROR (manager)", "EncoderManager.EVENT_RENDER_CANCEL",
    "EncoderManager.EVENT_RENDER_CANCEL (manager)", "OperationCompleteEvent.EVENT_EXPORT_MEDIA_COMPLETE"]);
  handlers.RenderCompleteEvent[0]({ outputFile: "/x/final.mp4" });
  handlers["OperationCompleteEvent.ExportMediaComplete"][0]({});
  handlers.RenderCancelEvent[0]({});
  assert.deepStrictEqual(got, [["complete", "/x/final.mp4", "EncoderManager.EVENT_RENDER_COMPLETE"],
    ["complete", null, "OperationCompleteEvent.EVENT_EXPORT_MEDIA_COMPLETE"], ["cancel", null, "EncoderManager.EVENT_RENDER_CANCEL"]]);
});

test("listen without the API attaches nothing and does not throw", async () => {
  assert.deepStrictEqual(await listen({}, () => {}), []);
  const failing = { EncoderManager: { EVENT_RENDER_COMPLETE: "R" },
    EventManager: { addGlobalEventListener: async () => { throw new Error("nope"); } } };
  const logs = [];
  assert.deepStrictEqual(await listen(failing, () => {}, (m) => logs.push(m)), []);
  assert.strictEqual(logs.length, 1);
});
