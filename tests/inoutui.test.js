// node --test tests/inoutui.test.js
// What the In & Out page shows and says (panel/inoutui.js): pure, no DOM.
const test = require("node:test");
const assert = require("node:assert");
const I = require("../panel/inoutplan.js");
const U = require("../panel/inoutui.js");

const st = (o) => Object.assign(U.restore(null), o);
const texts = (lines) => lines.map((l) => l.text);

test("restore: defaults, junk and unknown ids become safe values", () => {
  assert.deepStrictEqual(U.restore(null), { inPreset: "none", outPreset: "none", inFrames: null, outFrames: null, direction: "left", turn: "cw", strength: 100, blur: false, side: "in", filter: "all" });
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

test("filter: remembered with the other UI choices, one for both sides; saved values without it open on All", () => {
  assert.strictEqual(U.restore({ inPreset: "pop" }).filter, "all");                // saved before 0.10.133: no field
  assert.strictEqual(U.restore({ filter: "spin" }).filter, "spin");
  assert.strictEqual(U.restore({ filter: "sideways" }).filter, "all");
  assert.strictEqual(U.snapshot(st({ filter: "fade" })).filter, "fade");
  assert.strictEqual(U.snapshot(st({ filter: "nope" })).filter, "all");
  assert.deepStrictEqual(U.restore(U.snapshot(st({ filter: "scale", side: "out" }))), st({ filter: "scale", side: "out" }));
  assert.strictEqual(U.view(st({ filter: "move" })).filter, "move");
  assert.deepStrictEqual(U.FILTERS.map(([id]) => id), ["all", "move", "scale", "spin", "fade"]);
});

test("tiles: None first, then the presets by group; the filter shows one group and always None, both sides listed in view()", () => {
  for (const side of ["in", "out"]) {
    const all = U.tiles(side);
    assert.strictEqual(all[0].id, U.NONE);
    assert.strictEqual(all.length, (side === "in" ? I.IN_PRESETS : I.OUT_PRESETS).length + 1);   // every preset has a tile
    assert.deepStrictEqual(U.shownTiles(side, "all"), all.map((t) => t.id));
    let shownTotal = 0;
    for (const [f] of U.FILTERS.slice(1)) {
      const ids = U.shownTiles(side, f);
      assert.ok(ids.includes(U.NONE), "None is shown whatever the filter");
      assert.ok(ids.length > 1, `${side} ${f} shows some presets`);
      assert.ok(U.tiles(side).filter((t) => ids.includes(t.id) && t.preset).every((t) => t.filter === f));
      shownTotal += ids.length - 1;
    }
    assert.strictEqual(shownTotal, all.length - 1);                                  // the four filters together cover every preset once
  }
  assert.deepStrictEqual(U.shownTiles("in", "scale").slice(0, 2), [U.NONE, "pop"]);
  assert.ok(U.shownTiles("out", "move").includes("anticipate") && !U.shownTiles("out", "move").includes("fade"));
  assert.deepStrictEqual(U.shownTiles("in", "junk"), U.shownTiles("in", "all"));       // an unknown filter is All
  const v = U.view(st({ filter: "fade" }));
  assert.deepStrictEqual(v.shown.in, U.shownTiles("in", "fade"));
  assert.deepStrictEqual(v.shown.out, U.shownTiles("out", "fade"));
});

const noDrafts = { in: null, out: null };
test("afterPick: the pick shows its side; a filtered-out tile sends the filter back to All, a shown one and None keep it", () => {
  const s = st({ side: "in", filter: "scale" });
  assert.deepStrictEqual(U.afterPick(s, "out", "shrink"), { outPreset: "shrink", side: "out", filter: "scale", drafts: noDrafts });
  assert.deepStrictEqual(U.afterPick(s, "out", "fade"), { outPreset: "fade", side: "out", filter: "all", drafts: noDrafts });   // Fade is not in Scale
  assert.deepStrictEqual(U.afterPick(s, "in", U.NONE), { inPreset: U.NONE, side: "in", filter: "scale", drafts: noDrafts });
  assert.deepStrictEqual(U.afterPick(st({ filter: "all" }), "in", "slide"), { inPreset: "slide", side: "in", filter: "all", drafts: noDrafts });
});

// ---------------------------------------------------------------- Phase 5: own presets and the unsaved draft
const reset = () => { I.setCustom([]); I.setDraft("in", null); I.setDraft("out", null); };
const pts = (...q) => ({ pts: q });
const own = (id, side, base, name, extra) => Object.assign({ id, v: 1, side, base, name, frames: I.find(side, base).frames, curves: { [I.animates(I.find(side, base))[0]]: pts([0.5, 0.5]) } }, extra);
const draftSpec = (side, base, curves) => ({ v: 1, side, base, name: "My draft", frames: I.find(side, base).frames, curves });
const withOwn = (fn) => () => { reset(); try { fn(); } finally { reset(); } };

test("with no own presets tiles() is unchanged", withOwn(() => {
  for (const side of ["in", "out"]) {
    const expected = [{ id: U.NONE, name: "None", filter: "", preset: null }];
    const F = { pos: "move", scale: "scale", rot: "spin", op: "fade" };
    for (const g of I.groups(side)) for (const p of g.presets) expected.push({ id: p.id, name: p.name, filter: F[g.id], preset: p });
    assert.deepStrictEqual(U.tiles(side), expected);
  }
  assert.deepStrictEqual(U.view(st({ inPreset: "slide", outPreset: "fade" })).shown.in.slice(0, 2), [U.NONE, "slide"]);
}));

test("own tiles sit right after None with the base's icon and filter", withOwn(() => {
  I.setCustom([own("mine1", "in", "pop", "My Pop"), own("mine2", "in", "slideFade", "Soft"), own("mine3", "out", "shrink", "Out mine")]);
  const t = U.tiles("in");
  assert.deepStrictEqual(t.slice(0, 3).map((x) => x.id), [U.NONE, "mine1", "mine2"]);
  assert.strictEqual(t.length, I.IN_PRESETS.length + 3);                           // None, two own, every built-in
  assert.deepStrictEqual([t[1].name, t[1].filter, t[1].mine, t[1].base], ["My Pop", "scale", true, "pop"]);   // Pop's group is Scale
  assert.strictEqual(t[1].filter, t.find((x) => x.id === "pop").filter);          // the page draws the icon from `filter`: the base's
  assert.strictEqual(t[2].filter, "fade");                                          // Slide Fade is in the Opacity group
  assert.strictEqual(t[1].preset.id, "mine1");
  assert.ok(t.slice(3).every((x) => !x.mine));
  assert.deepStrictEqual(U.tiles("out").slice(0, 2).map((x) => x.id), [U.NONE, "mine3"]);   // the other side's own row stays on its side
  assert.ok(U.shownTiles("in", "all").includes("mine1") && U.shownTiles("in", "all").includes("mine2"));
  assert.ok(U.shownTiles("in", "scale").includes("mine1") && !U.shownTiles("in", "scale").includes("mine2"));   // an own tile follows its base's filter
  assert.ok(U.shownTiles("in", "fade").includes("mine2") && !U.shownTiles("in", "fade").includes("mine1"));
  assert.deepStrictEqual(U.afterPick(st({ filter: "scale" }), "in", "mine2").filter, "all");   // a pick that the filter hides resets it
  assert.deepStrictEqual(U.afterPick(st({ filter: "scale" }), "in", "mine1").filter, "scale");
}));

test("a draft sends DRAFT to preview and Apply and says (edited)", withOwn(() => {
  I.setDraft("in", draftSpec("in", "pop", { scale: pts([0.4, 0.8]) }));
  const s = st({ inPreset: "pop", outPreset: "fade", drafts: { in: { base: "pop" }, out: null } });
  const v = U.view(s);
  assert.strictEqual(v.opts.inPreset, I.DRAFT);
  assert.strictEqual(v.opts.outPreset, "fade");                                     // the other side keeps its pick
  assert.strictEqual(v.labels.in, "In · Pop (edited)");
  assert.strictEqual(v.labels.out, "Out · Fade");
  assert.strictEqual(v.summary, "In Pop (edited) 12f · Out Fade 10f");
  assert.strictEqual(v.mode, "both");
  assert.strictEqual(v.frames.in, 12);                                              // the draft's own length when none is typed
  assert.strictEqual(U.hoverView(s, "out", "fade").opts.inPreset, I.DRAFT);         // hovering the other side still shows the edit
  assert.strictEqual(U.hoverView(s, "in", "pop").opts.inPreset, I.DRAFT);           // and so does hovering the tile being edited
  assert.strictEqual(U.hoverView(s, "in", "slide").opts.inPreset, "slide");         // another tile plays as itself
  assert.strictEqual(U.hoverView(s, "in", U.NONE).opts.inPreset, null);
  assert.strictEqual(s.drafts.in.base, "pop");                                      // never changed
  const noDraft = U.view(st({ inPreset: "pop", outPreset: "fade" }));               // without drafts: as before
  assert.strictEqual(noDraft.opts.inPreset, "pop");
  assert.strictEqual(noDraft.labels.in, "In · Pop");
  assert.deepStrictEqual(U.view(st({ inPreset: "pop", drafts: noDrafts })), U.view(st({ inPreset: "pop" })));
  I.setDraft("in", null);                                                           // the page did not sync the registry: the pick is shown
  assert.strictEqual(U.view(s).opts.inPreset, "pop");
  const noneSide = st({ inPreset: "none", drafts: { in: { base: "pop" }, out: null } });   // a draft on a None side is ignored
  assert.strictEqual(U.view(noneSide).opts.inPreset, null);
}));

test("a draft on an own preset names the base and the label stays short", withOwn(() => {
  I.setCustom([own("mine7", "out", "shrink", "Back and out")]);
  I.setDraft("out", draftSpec("out", "shrink", { scale: pts([0.5, 0.2]) }));
  const v = U.view(st({ outPreset: "mine7", side: "out", drafts: { in: null, out: { base: "shrink" } } }));
  assert.strictEqual(v.labels.out, "Out · Shrink (edited)");
  assert.strictEqual(v.opts.outPreset, I.DRAFT);
  assert.strictEqual(U.view(st({ outPreset: "mine7" })).labels.out, "Out · Back and out");   // saved: its own name
  assert.strictEqual(U.view(st({ outPreset: "mine7" })).opts.outPreset, "mine7");
}));

test("editorView lists only animated props and greys the multi-piece ones", withOwn(() => {
  const e = U.editorView(st({ inPreset: "twistPop", side: "in" }), []);
  assert.deepStrictEqual(e.props.map((p) => [p.prop, p.label, p.ok, p.edited]), [["scale", "Scale", true, false], ["rot", "Rotation", true, false]]);
  assert.deepStrictEqual([e.side, e.id, e.base, e.isOwn, e.none, e.canSave], ["in", "twistPop", "twistPop", false, false, false]);
  const o = U.editorView(st({ outPreset: "anticipate", side: "out" }), []);
  assert.deepStrictEqual(o.props.map((p) => [p.prop, p.ok]), [["pos", false]]);     // Anticipate's position is a multi-step path
  assert.ok(o.props[0].why.length > 10);
  const sw = U.editorView(st({ outPreset: "swingOut", side: "out" }), []);
  assert.deepStrictEqual(sw.props.map((p) => [p.prop, p.ok]), [["rot", false], ["op", true]]);
  assert.strictEqual(sw.props.find((p) => p.prop === "op").why, "");
  assert.deepStrictEqual(U.editorView(st({ inPreset: "rollIn", side: "in" }), []).props.map((p) => p.prop), ["pos", "rot"]);   // the page's order
  assert.strictEqual(U.editorView(st({ inPreset: "pop", outPreset: "fade", side: "out" }), []).id, "fade");   // the side showing
}));

test("editorView: None cannot open, defaultName is the next free My <Base>, an own pick shows isOwn and its base", withOwn(() => {
  const none = U.editorView(st({ side: "in" }), []);
  assert.deepStrictEqual([none.none, none.props, none.canSave, none.isOwn, none.id], [true, [], false, false, "none"]);
  assert.strictEqual(U.editorView(st({ inPreset: "pop" }), []).defaultName, "My Pop");
  assert.strictEqual(U.editorView(st({ inPreset: "pop" })).defaultName, "My Pop");           // no list yet
  const raw = [{ id: "mine1", v: 1, side: "in", base: "pop", name: "My Pop", frames: 12, curves: {} }];
  assert.strictEqual(U.editorView(st({ inPreset: "pop" }), raw).defaultName, "My Pop 2");
  assert.strictEqual(U.editorView(st({ outPreset: "shrink", side: "out" }), raw).defaultName, "My Shrink");   // names are per side
  I.setCustom([own("mine1", "in", "popFade", "Mine")]);
  const e = U.editorView(st({ inPreset: "mine1" }), raw);
  assert.deepStrictEqual([e.isOwn, e.base, e.baseName, e.none], [true, "popFade", "Pop Fade", false]);
  assert.deepStrictEqual(e.props.map((p) => p.prop), ["scale", "op"]);
  assert.strictEqual(e.defaultName, "My Pop Fade");                                           // from the base's name, not "My Mine"
  assert.strictEqual(U.editorView(st({ inPreset: "mine404" }), raw).none, true);              // an id the registry lost
}));

test("canSave needs an edited curve", withOwn(() => {
  const base = { inPreset: "twistPop", side: "in" };
  assert.strictEqual(U.editorView(st(base), []).canSave, false);                               // no draft
  assert.strictEqual(U.editorView(st({ ...base, drafts: { in: { base: "twistPop", curves: {} }, out: null } }), []).canSave, false);
  assert.strictEqual(U.editorView(st({ ...base, drafts: { in: { base: "twistPop" }, out: null } }), []).canSave, false);
  const e = U.editorView(st({ ...base, drafts: { in: { base: "twistPop", curves: { rot: pts([0.5, 0.5]) } }, out: null } }), []);
  assert.strictEqual(e.canSave, true);
  assert.deepStrictEqual(e.props.map((p) => [p.prop, p.edited]), [["scale", false], ["rot", true]]);
  const other = U.editorView(st({ ...base, drafts: { in: null, out: { base: "fade", curves: { op: pts([0.5, 0.5]) } } } }), []);
  assert.strictEqual(other.canSave, false);                                                    // the other side's draft does not count
}));

test("afterDelete falls back to the base", withOwn(() => {
  const s = st({ inPreset: "mine1", outPreset: "mine2", drafts: { in: { base: "pop" }, out: { base: "shrink" } } });
  const p = U.afterDelete(s, "in", "mine1", "pop");
  assert.strictEqual(p.inPreset, "pop");                                                       // the base, not None
  assert.strictEqual(p.outPreset, undefined);                                                  // the other side is untouched
  assert.deepStrictEqual(p.drafts, { in: null, out: { base: "shrink" } });                    // its draft is dropped, the other side's stays
  const other = U.afterDelete(st({ inPreset: "slide", outPreset: "mine2", drafts: { in: { base: "slide" }, out: null } }), "in", "mine1", "pop");
  assert.deepStrictEqual(other, { drafts: { in: { base: "slide" }, out: null } });           // that side had another pick: nothing changes
  assert.strictEqual(U.afterDelete(st({ outPreset: "mine2" }), "out", "mine2", "popOut").outPreset, "popOut");
  assert.strictEqual(U.afterDelete(st({ inPreset: "mine1" }), "in", "mine1", "nope").inPreset, "none");   // a base this version lost reads as None
  assert.deepStrictEqual(Object.assign(st({ inPreset: "mine1" }), U.afterDelete(st({ inPreset: "mine1" }), "in", "mine1", "pop")).inPreset, "pop");
}));

test("a pick ends that side's draft only", withOwn(() => {
  const s = st({ inPreset: "pop", outPreset: "fade", drafts: { in: { base: "pop" }, out: { base: "fade" } } });
  assert.deepStrictEqual(U.afterPick(s, "in", "slide").drafts, { in: null, out: { base: "fade" } });
  assert.deepStrictEqual(U.afterPick(s, "out", "shrink").drafts, { in: { base: "pop" }, out: null });
  assert.deepStrictEqual(U.afterPick(s, "in", U.NONE).drafts, { in: null, out: { base: "fade" } });
  assert.deepStrictEqual(U.afterPick(s, "in", "pop").drafts, { in: null, out: { base: "fade" } });   // re-picking the same tile also ends it
  assert.deepStrictEqual(U.afterPick(st({}), "in", "pop").drafts, noDrafts);                // a state with no drafts field at all
}));

test("snapshot never stores a draft", withOwn(() => {
  const snap = U.snapshot(st({ inPreset: "pop", drafts: { in: { base: "pop", curves: {} }, out: null } }));
  assert.ok(!("drafts" in snap));
  assert.ok(!JSON.stringify(snap).includes("draft"));
  assert.deepStrictEqual(Object.keys(snap).sort(), ["blur", "direction", "filter", "inFrames", "inPreset", "outFrames", "outPreset", "side", "strength", "turn"]);
  assert.ok(!("drafts" in U.restore(snap)));                                                  // and restore adds none
}));

test("an own pick is remembered by id; a deleted pick restores as None", withOwn(() => {
  I.setCustom([own("mine5", "in", "pop", "My Pop")]);
  const snap = U.snapshot(st({ inPreset: "mine5" }));
  assert.strictEqual(snap.inPreset, "mine5");
  assert.strictEqual(U.restore(snap).inPreset, "mine5");
  assert.strictEqual(U.restore({ outPreset: "mine5" }).outPreset, "none");                    // an own id of the other side is not found
  I.setCustom([]);                                                                            // the row is gone
  assert.strictEqual(U.restore(snap).inPreset, "none");
  assert.strictEqual(U.restore({ inPreset: "mine999", outPreset: "mine1" }).outPreset, "none");
}));

test("a stored draft id restores as None", withOwn(() => {
  assert.strictEqual(U.restore({ inPreset: "draft" }).inPreset, "none");
  I.setDraft("in", draftSpec("in", "pop", { scale: pts([0.4, 0.8]) }));                       // even while the registry holds a draft
  assert.strictEqual(U.restore({ inPreset: "draft", outPreset: "draft" }).inPreset, "none");
  assert.strictEqual(U.restore({ outPreset: "draft" }).outPreset, "none");
  assert.strictEqual(U.hoverView(st({}), "in", "draft").opts.inPreset, null);                 // nor can a hover play the draft by id
}));

test("presetTip for an own preset names it and its base, then what the base moves", withOwn(() => {
  I.setCustom([own("mine1", "in", "slideFade", "Soft Slide", { frames: 20 }), own("mine2", "out", "twistShrink", "Spin away")]);
  const tip = U.presetTip("in", I.find("in", "mine1"));
  assert.strictEqual(tip, "Your preset Soft Slide, based on Slide Fade. Animates Position and Opacity. Also choose the edge below. Default length 20 frames.");
  assert.match(U.presetTip("out", I.find("out", "mine2")), /^Your preset Spin away, based on Twist Shrink\. Animates Scale and Rotation\. Also choose the turn below\./);
  assert.match(U.presetTip("in", I.find("in", "pop")), /^Pop \(in\): animates Scale\./);          // a built-in tip is as before
  assert.ok(U.tiles("in").filter((t) => t.mine).every((t) => /^Your preset /.test(U.presetTip("in", t.preset))));
}));

test("hoverView: hovering an own tile plays it like any tile", withOwn(() => {
  I.setCustom([own("mine1", "in", "pop", "My Pop", { frames: 17 })]);
  const s = st({ inPreset: "slide", outPreset: "fade" });
  const h = U.hoverView(s, "in", "mine1");
  assert.strictEqual(h.opts.inPreset, "mine1");
  assert.strictEqual(h.opts.inFrames, 17);                                                   // its own length
  assert.strictEqual(h.opts.outPreset, "fade");
  assert.strictEqual(s.inPreset, "slide");
}));

test("a draft of another preset is not shown: the pick changed behind the editor", () => {
  I.setCustom([]);
  const d = { base: "pop", name: "x", frames: 12, curves: { scale: { pts: [[0.3, 1.2]] } } };
  I.setDraft("in", Object.assign({ v: 1, side: "in" }, d));
  const state = Object.assign(U.restore({ inPreset: "pop" }), { drafts: { in: d, out: null } });
  assert.strictEqual(U.view(state).opts.inPreset, I.DRAFT);
  assert.strictEqual(U.view(Object.assign({}, state, { inPreset: "slide" })).opts.inPreset, "slide");
  assert.strictEqual(U.view(Object.assign({}, state, { inPreset: "slide" })).labels.in, "In · Slide");
  I.setDraft("in", null);
});
