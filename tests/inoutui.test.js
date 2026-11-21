// node --test tests/inoutui.test.js
// What the In & Out page shows and says (panel/inoutui.js): pure, no DOM.
const test = require("node:test");
const assert = require("node:assert");
const I = require("../panel/inoutplan.js");
const U = require("../panel/inoutui.js");

const st = (o) => Object.assign(U.restore(null), o);
const texts = (lines) => lines.map((l) => l.text);

test("restore: defaults, junk and unknown ids become safe values", () => {
  assert.deepStrictEqual(U.restore(null), { inPreset: "none", outPreset: "none", inFrames: null, outFrames: null, direction: "left", turn: "cw", strength: 100, blur: false, side: "in" });
  const r = U.restore({ inPreset: "nope", outPreset: "fade", inFrames: "7.4", outFrames: 99999, direction: "up", turn: "x", strength: 1, blur: 1 });
  assert.strictEqual(r.inPreset, "none");
  assert.strictEqual(r.outPreset, "fade");
  assert.strictEqual(r.inFrames, 7);
  assert.strictEqual(r.outFrames, I.FRAMES_MAX);
  assert.strictEqual(r.direction, "left");
  assert.strictEqual(r.turn, "cw");
  assert.strictEqual(r.strength, I.STRENGTH_MIN);
  assert.strictEqual(r.blur, true);
  assert.strictEqual(U.restore("junk").inPreset, "none");
  assert.deepStrictEqual(U.restore(U.snapshot(r)), r);                       // what is stored comes back the same
});

test("clamps: frames and strength stay in range, empty frames means the preset's own", () => {
  assert.strictEqual(U.clampFrames("0"), I.FRAMES_MIN);
  assert.strictEqual(U.clampFrames("5000"), I.FRAMES_MAX);
  assert.strictEqual(U.clampFrames("12"), 12);
  assert.strictEqual(U.clampFrames(""), null);
  assert.strictEqual(U.clampFrames("abc"), null);
  assert.strictEqual(U.clampStrength("10"), I.STRENGTH_MIN);
  assert.strictEqual(U.clampStrength("900"), I.STRENGTH_MAX);
  assert.strictEqual(U.clampStrength("abc"), I.STRENGTH_DEFAULT);
});

test("view: nothing picked disables Apply and shows no extra control", () => {
  const v = U.view(st({}));
  assert.strictEqual(v.mode, null);
  assert.strictEqual(v.canApply, false);
  assert.strictEqual(v.direction || v.turn || v.strength, false);
  assert.strictEqual(v.frames.in, null);
  assert.strictEqual(v.frames.out, null);
});

test("view: the mode follows which rows are not None, and what is sent is the picked pair", () => {
  assert.strictEqual(U.view(st({ inPreset: "pop" })).mode, "in");
  assert.strictEqual(U.view(st({ outPreset: "shrink" })).mode, "out");
  const both = U.view(st({ inPreset: "slide", outPreset: "fade", direction: "top", turn: "ccw", strength: 150, blur: true }));
  assert.strictEqual(both.mode, "both");
  assert.strictEqual(both.canApply, true);
  assert.deepStrictEqual(both.opts, { inPreset: "slide", outPreset: "fade", inFrames: 12, outFrames: 10, direction: "top", turn: "ccw", strength: 150, blur: true });
  const onlyOut = U.view(st({ outPreset: "shrink" })).opts;
  assert.strictEqual(onlyOut.inPreset, null);
  assert.strictEqual(onlyOut.inFrames, undefined);                            // nothing sent for a side that is None
});

test("view: direction and turn only when a picked preset asks, on either side", () => {
  assert.strictEqual(U.view(st({ inPreset: "slide" })).direction, true);
  assert.strictEqual(U.view(st({ outPreset: "anticipate" })).direction, true);
  assert.strictEqual(U.view(st({ inPreset: "pop", outPreset: "shrink" })).direction, false);
  assert.strictEqual(U.view(st({ inPreset: "spinIn" })).turn, true);
  assert.strictEqual(U.view(st({ outPreset: "swingOut" })).turn, true);
  assert.strictEqual(U.view(st({ inPreset: "pop", outPreset: "fade" })).turn, false);
  const mixed = U.view(st({ inPreset: "pop", outPreset: "spinOut" }));
  assert.strictEqual(mixed.turn, true);
  assert.strictEqual(mixed.direction, false);
  assert.strictEqual(U.view(st({ inPreset: "rollIn" })).direction, true);       // a roll asks for the edge, not the turn
  assert.strictEqual(U.view(st({ inPreset: "rollIn" })).turn, false);
});

test("view: Strength is greyed with the exact tooltip when no picked preset uses it", () => {
  const off = U.view(st({ inPreset: "fade", outPreset: "slide" }));
  assert.strictEqual(off.strength, false);
  assert.strictEqual(off.strengthTip, "Strength does not change this animation");
  const on = U.view(st({ inPreset: "fade", outPreset: "anticipate" }));          // one side that uses it is enough
  assert.strictEqual(on.strength, true);
  assert.notStrictEqual(on.strengthTip, "Strength does not change this animation");
  assert.strictEqual(U.view(st({ inPreset: "pop" })).strength, I.needs(I.find("in", "pop")).strength);
});

test("view: frames show the typed value, else the preset's default; a typed value outlives a preset change", () => {
  const typed = st({ inPreset: "slide", inFrames: 20 });
  assert.strictEqual(U.view(typed).frames.in, 20);
  typed.inPreset = "pop";
  assert.strictEqual(U.view(typed).frames.in, 20);
  const fresh = st({ inPreset: "slide", outPreset: "whip" });
  assert.strictEqual(U.view(fresh).frames.in, I.defaultFrames("in", "slide"));
  fresh.inPreset = "elastic";
  assert.strictEqual(U.view(fresh).frames.in, I.defaultFrames("in", "elastic"));
  assert.strictEqual(U.view(fresh).frames.out, I.defaultFrames("out", "whip"));
});

test("presetTip names what the preset animates and what it asks for", () => {
  assert.match(U.presetTip("in", I.find("in", "slideFade")), /Slide Fade \(in\): animates Position and Opacity\. Also choose the edge below\./);
  assert.match(U.presetTip("out", I.find("out", "twistShrink")), /animates Scale and Rotation\. Also choose the turn below\./);
  assert.match(U.presetTip("in", I.find("in", "fade")), /animates Opacity\. Default length 10 frames\./);
  for (const side of ["in", "out"]) for (const p of (side === "in" ? I.IN_PRESETS : I.OUT_PRESETS)) assert.ok(U.presetTip(side, p).length > 20);
});

test("status: one clip, first apply = 2 Undo steps", () => {
  const l = U.status("apply", { clips: 1, skipped: [], steps: 2, shortened: [], notes: [], keys: 40 });
  assert.deepStrictEqual(texts(l), ["Done: 1 clip animated, 40 keyframes. Cmd/Ctrl+Z 2 times takes it back (Premiere adds an effect in a step of its own)."]);
  assert.strictEqual(l[0].cls, "line");
});

test("status: three clips re-applied = 1 Undo step", () => {
  const l = U.status("apply", { clips: 3, skipped: [], steps: 1, shortened: [], notes: [], keys: 0 });
  assert.deepStrictEqual(texts(l), ["Done: 3 clips animated. Cmd/Ctrl+Z takes it back."]);
});

test("status: skipped, shortened and a note all show", () => {
  const l = U.status("apply", {
    clips: 2, steps: 2, keys: 120, shortened: ["Interview A"],
    skipped: [{ name: "Clip B", why: "it is reversed" }, { name: "Clip C", why: "the clip is shorter than 2 frames." }],
    notes: ["Interview A: position should have 30 keyframes, the clip has 28: check it"],
  });
  assert.deepStrictEqual(texts(l), [
    "Done: 2 clips animated, 120 keyframes. Cmd/Ctrl+Z 2 times takes it back (Premiere adds an effect in a step of its own).",
    "Shortened to fit the clip: Interview A.",
    "Skipped Clip B: it is reversed.",
    "Skipped Clip C: the clip is shorter than 2 frames.",
    "Interview A: position should have 30 keyframes, the clip has 28: check it.",
  ]);
  assert.deepStrictEqual(l.map((x) => x.cls), ["line", "line", "warn", "warn", "warn"]);
});

test("status: a long skipped list is cut", () => {
  const skipped = Array.from({ length: 7 }, (_, i) => ({ name: `C${i}`, why: "x" }));
  const l = U.status("apply", { clips: 1, skipped, steps: 1 });
  assert.strictEqual(l.length, 1 + 4 + 1);
  assert.strictEqual(l[l.length - 1].text, "And 3 more skipped.");
});

test("status: remove, and nothing removed", () => {
  assert.deepStrictEqual(texts(U.status("remove", { clips: 2, skipped: [{ name: "C", why: "it has no In/Out animation" }], steps: 1 })),
    ["Removed the In & Out animation from 2 clips. Cmd/Ctrl+Z takes it back.", "Skipped C: it has no In/Out animation."]);
  assert.deepStrictEqual(texts(U.status("remove", { clips: 1, skipped: [], steps: 1 })), ["Removed the In & Out animation from 1 clip. Cmd/Ctrl+Z takes it back."]);
  const none = U.status("remove", { clips: 0, skipped: [{ name: "A", why: "it has no In/Out animation" }], steps: 0 });
  assert.deepStrictEqual(texts(none), ["Nothing removed: none of the selected clips has an In & Out animation."]);
  assert.strictEqual(none[0].cls, "warn");
});

test("framesAfterTyping: leaving a box on the preset's default does not pin it; a different number does", () => {
  const s = st({ inPreset: "slide" });                                       // shows 12 (Slide's own length)
  assert.strictEqual(U.framesAfterTyping(s, "in", "12"), null);
  assert.strictEqual(U.framesAfterTyping(s, "in", " 12 "), null);
  assert.strictEqual(U.framesAfterTyping(s, "in", "13"), 13);
  assert.strictEqual(U.framesAfterTyping(s, "in", ""), null);
  assert.strictEqual(U.framesAfterTyping(s, "in", "junk"), null);
  assert.strictEqual(U.framesAfterTyping(s, "in", "99999"), I.FRAMES_MAX);
  const typed = st({ inPreset: "slide", inFrames: 20 });                      // already typed: typing the default is a choice
  assert.strictEqual(U.framesAfterTyping(typed, "in", "12"), 12);
  const out = st({ outPreset: "fade" });
  assert.strictEqual(U.framesAfterTyping(out, "out", "10"), null);
  assert.strictEqual(U.framesAfterTyping(st({}), "out", "10"), 10);           // side is None: nothing shown, so a number is a choice
});

test("statusFor: the reason Apply is off while both are None, a press result otherwise, nothing when ready", () => {
  const none = U.statusFor(st({}), null);
  assert.deepStrictEqual(none, [{ text: "Pick an In or an Out animation first.", cls: "line" }]);
  assert.strictEqual(none[0].cls, "line");                                    // a plain line, not a warning
  assert.deepStrictEqual(U.statusFor(st({ inPreset: "pop" }), null), []);       // goes away when a preset is picked
  const res = [{ text: "Select one or more clips in the timeline first.", cls: "warn" }];
  assert.strictEqual(U.statusFor(st({ inPreset: "pop" }), res), res);           // a result stays until the page forgets it
  assert.strictEqual(U.statusFor(st({}), res), res);                            // and wins over the hint (a Remove with both None)
  assert.deepStrictEqual(U.statusFor(st({ inPreset: "pop" }), []), []);
});

test("side: the list showing is remembered, an old saved value without it opens on In, junk too", () => {
  assert.strictEqual(U.restore({ inPreset: "pop" }).side, "in");                  // saved before 0.10.132: no field
  assert.strictEqual(U.restore({ side: "out" }).side, "out");
  assert.strictEqual(U.restore({ side: "sideways" }).side, "in");
  assert.strictEqual(U.snapshot(st({ side: "out" })).side, "out");
  assert.deepStrictEqual(U.restore(U.snapshot(st({ side: "out", outPreset: "fade" }))), st({ side: "out", outPreset: "fade" }));
  assert.strictEqual(U.view(st({ side: "out" })).side, "out");
  assert.strictEqual(U.view(st({})).side, "in");
});

test("view: the switch labels show each side's pick, the summary is one short line", () => {
  assert.deepStrictEqual(U.view(st({})).labels, { in: "In · None", out: "Out · None" });
  assert.strictEqual(U.view(st({})).summary, "Nothing picked");
  const v = U.view(st({ inPreset: "slide", outPreset: "anticipate", outFrames: 16 }));
  assert.deepStrictEqual(v.labels, { in: "In · Slide", out: "Out · Anticipate" });
  assert.strictEqual(v.summary, "In Slide 12f · Out Anticipate 16f");
  assert.strictEqual(U.view(st({ outPreset: "fade" })).summary, "Out Fade 10f");     // a None side is left out
  assert.strictEqual(U.view(st({ inPreset: "pop", inFrames: 20 })).summary, "In Pop 20f");
});

test("hoverView: the hovered preset replaces that side only, nothing in the state changes", () => {
  const s = st({ inPreset: "slide", outPreset: "fade", strength: 150, inFrames: 9, outFrames: null, direction: "top" });
  const before = JSON.stringify(s);
  const h = U.hoverView(s, "out", "anticipate");
  assert.strictEqual(h.opts.outPreset, "anticipate");
  assert.strictEqual(h.opts.inPreset, "slide");                                     // the other side keeps its pick
  assert.strictEqual(h.opts.inFrames, 9);                                           // typed frames and settings carry over
  assert.strictEqual(h.opts.outFrames, I.defaultFrames("out", "anticipate"));       // the hovered preset's own length
  assert.strictEqual(h.opts.strength, 150);
  assert.strictEqual(h.opts.direction, "top");
  assert.strictEqual(JSON.stringify(s), before);                                    // never stored: the state is untouched
  assert.strictEqual(U.hoverView(s, "in", U.NONE).opts.inPreset, null);             // hovering None shows a side without animation
  assert.strictEqual(U.hoverView(s, "in", "nope").opts.inPreset, null);             // an unknown id is None
  assert.deepStrictEqual(U.hoverView(s, "in", "slide"), U.view(s));                 // hovering the picked one changes nothing
});
