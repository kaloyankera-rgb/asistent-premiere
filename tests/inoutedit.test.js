// node --test tests/inoutedit.test.js
// The In & Out curve editor's decisions (panel/inoutedit.js): what an edit, a reset and a save make of the page's drafts, the spec handed
// to inoutplan.setDraft, and what Save sends to inoutpresets.added. Pure, no DOM.
const test = require("node:test");
const assert = require("node:assert");
const I = require("../panel/inoutplan.js");
const U = require("../panel/inoutui.js");
const P = require("../panel/inoutpresets.js");
const E = require("../panel/inoutedit.js");

const pts = (...q) => q.map((p) => p.slice());
const st = (o) => {
  const s = Object.assign(U.restore(null), o);
  s.drafts = { in: null, out: null };
  return s;
};
const reset = () => { I.setCustom([]); I.setDraft("in", null); I.setDraft("out", null); };
const own = (id, side, base, name, curves, frames) => ({ id, v: 1, side, base, name, frames: frames || I.find(side, base).frames, curves });
// a page change of a side's draft: the draft, then the registry (what the page does after every change)
const edit = (s, side, prop, p) => {
  s.drafts[side] = E.editDraft(s, side, prop, p);
  E.syncDrafts(s);
  return s.drafts[side];
};

test("an edit of a built-in makes a draft: base, a caption name, the pick's length, only the edited curve", () => {
  reset();
  const s = st({ inPreset: "pop" });
  const d = E.editDraft(s, "in", "scale", pts([0.3, 0.8], [0.6, 1.2]));
  assert.deepStrictEqual(d, { base: "pop", name: "Pop (edited)", frames: I.find("in", "pop").frames, curves: { scale: { pts: [[0.3, 0.8], [0.6, 1.2]] } } });
  const again = E.editDraft(Object.assign(s, { drafts: { in: d, out: null } }), "in", "scale", pts([0.5, 1]));
  assert.deepStrictEqual(again.curves, { scale: { pts: [[0.5, 1]] } });
});

test("the typed length wins over the preset's own, and the draft follows a length typed after the edit", () => {
  reset();
  const s = st({ inPreset: "pop", inFrames: 20 });
  assert.strictEqual(edit(s, "in", "scale", pts([0.5, 1])).frames, 20);
  s.inFrames = null;                                                               // the editor cleared the box
  E.syncDrafts(s);
  assert.strictEqual(s.drafts.in.frames, I.find("in", "pop").frames);
  assert.strictEqual(I.find("in", I.DRAFT).frames, I.find("in", "pop").frames);     // the registry holds the same
  assert.strictEqual(U.view(s).frames.in, I.find("in", "pop").frames);
});

test("an edit nothing can be made of is refused: nothing picked, a property the preset does not animate, a multi-step motion, junk points", () => {
  reset();
  assert.strictEqual(E.editDraft(st({}), "in", "scale", pts([0.5, 1])), null);                    // None
  assert.strictEqual(E.editDraft(st({ inPreset: "pop" }), "in", "pos", pts([0.5, 1])), null);     // Pop does not move
  assert.strictEqual(E.editDraft(st({ inPreset: "pop" }), "in", "scale", pts([2, 1])), null);
  assert.strictEqual(E.editDraft(st({ inPreset: "pop" }), "in", "scale", []), null);
  assert.strictEqual(E.editDraft(st({ outPreset: "anticipate" }), "out", "pos", pts([0.5, 1])), null);   // Anticipate's position is several pieces
});

test("syncDrafts hands setDraft the spec { v, side, base, name, frames, curves } and the page then reads the draft through U.view", () => {
  reset();
  const s = st({ inPreset: "pop", outPreset: "shrink" });
  edit(s, "in", "scale", pts([0.4, 0.9]));
  assert.deepStrictEqual(E.specOf("in", s.drafts.in), { v: 1, side: "in", base: "pop", name: "Pop (edited)", frames: 12, curves: { scale: { pts: [[0.4, 0.9]] } } });
  assert.strictEqual(I.find("in", I.DRAFT).base, "pop");
  assert.strictEqual(I.find("out", I.DRAFT), null);                                // the other side has none
  const v = U.view(s);
  assert.strictEqual(v.opts.inPreset, "draft");
  assert.strictEqual(v.opts.outPreset, "shrink");
  assert.strictEqual(v.labels.in, "In · Pop (edited)");
  assert.strictEqual(U.editorView(s, []).canSave, true);
});

test("syncDrafts drops a draft whose pick is gone or that the maths refuses, and clears the registry", () => {
  reset();
  const s = st({ inPreset: "pop" });
  edit(s, "in", "scale", pts([0.4, 0.9]));
  s.inPreset = "none";                                                             // the pick changed behind the editor's back
  assert.deepStrictEqual(E.syncDrafts(s), []);
  assert.strictEqual(s.drafts.in, null);
  assert.strictEqual(I.find("in", I.DRAFT), null);
  s.inPreset = "pop";
  s.drafts.in = { base: "pop", name: "x".repeat(40), frames: 12, curves: { scale: { pts: [[0.4, 0.9]] } } };            // a bad name
  assert.deepStrictEqual(E.syncDrafts(s), ["in"]);
  assert.strictEqual(s.drafts.in, null);
  assert.strictEqual(I.find("in", I.DRAFT), null);
  E.clearDrafts(s);
  assert.deepStrictEqual(s.drafts, { in: null, out: null });
});

test("reset of the last edited property clears the draft of a built-in; with two edited ones only that one goes", () => {
  reset();
  const s = st({ inPreset: "rollIn" });                                             // Roll In moves and turns
  edit(s, "in", "rot", pts([0.5, 0.5]));
  edit(s, "in", "pos", pts([0.5, 0.6]));
  assert.deepStrictEqual(E.editedOf(s, "in"), ["rot", "pos"]);
  s.drafts.in = E.resetDraft(s, "in", "rot");
  E.syncDrafts(s);
  assert.deepStrictEqual(Object.keys(s.drafts.in.curves), ["pos"]);
  s.drafts.in = E.resetDraft(s, "in", "pos");
  E.syncDrafts(s);
  assert.strictEqual(s.drafts.in, null);
  assert.strictEqual(I.find("in", I.DRAFT), null);
  assert.strictEqual(E.resetDraft(s, "in", "pos"), null);                           // nothing to reset: nothing changes
});

test("an own preset: an edit starts from its curves, so its other edited properties are kept", () => {
  reset();
  I.setCustom([own("mine1", "in", "rollIn", "Mine", { rot: { pts: [[0.4, 0.5]] } })]);
  const s = st({ inPreset: "mine1" });
  assert.deepStrictEqual(E.editedOf(s, "in"), ["rot"]);                              // a dot with no draft: it is the preset's own
  const d = edit(s, "in", "pos", pts([0.5, 0.7]));
  assert.strictEqual(d.base, "rollIn");
  assert.deepStrictEqual(d.curves, { rot: { pts: [[0.4, 0.5]] }, pos: { pts: [[0.5, 0.7]] } });
  assert.strictEqual(d.frames, I.find("in", "rollIn").frames);
  assert.strictEqual(U.view(s).opts.inPreset, "draft");
  assert.strictEqual(U.editorView(s, []).isOwn, true);
});

test("reset on an own preset goes to the base curve: its only curve reset keeps an empty draft that shows the base, and cannot be saved", () => {
  reset();
  I.setCustom([own("mine1", "in", "pop", "Mine", { scale: { pts: [[0.3, 0.6]] } })]);
  const s = st({ inPreset: "mine1" });
  assert.deepStrictEqual(E.pointsFor(s, "in", "scale"), [[0.3, 0.6]]);                // the own curve
  s.drafts.in = E.resetDraft(s, "in", "scale");
  E.syncDrafts(s);
  assert.deepStrictEqual(s.drafts.in.curves, {});
  assert.deepStrictEqual(E.pointsFor(s, "in", "scale"), I.curveFor("in", "pop", "scale"));   // the base, not the saved curve
  assert.deepStrictEqual(E.editedOf(s, "in"), []);
  assert.strictEqual(U.editorView(s, []).canSave, false);
  assert.strictEqual(E.saveSpec(s, "in", "x").curves && Object.keys(E.saveSpec(s, "in", "x").curves).length, 0);
  assert.ok(P.added([], E.saveSpec(s, "in", "x"), 1).error);                          // inoutpresets refuses a preset with no curve
});

test("editing back to exactly the own preset's curves through a reset leaves no draft", () => {
  reset();
  I.setCustom([own("mine1", "in", "rollIn", "Mine", { rot: { pts: [[0.4, 0.5]] } })]);
  const s = st({ inPreset: "mine1" });
  edit(s, "in", "pos", pts([0.5, 0.7]));
  s.drafts.in = E.resetDraft(s, "in", "pos");                                        // what is left equals the preset's own
  assert.strictEqual(s.drafts.in, null);
});

test("pointsFor: the draft's points, else the pick's curve as points; null for a multi-step motion", () => {
  reset();
  const s = st({ inPreset: "pop" });
  assert.deepStrictEqual(E.pointsFor(s, "in", "scale"), I.curveFor("in", "pop", "scale"));
  edit(s, "in", "scale", pts([0.5, 1]));
  assert.deepStrictEqual(E.pointsFor(s, "in", "scale"), [[0.5, 1]]);
  assert.strictEqual(E.pointsFor(st({ outPreset: "anticipate" }), "out", "pos"), null);
  assert.strictEqual(E.pointsFor(st({}), "in", "scale"), null);
  const own1 = E.pointsFor(s, "in", "scale");
  own1[0][0] = 0.9;                                                                  // a copy: the draft is not changed through it
  assert.deepStrictEqual(s.drafts.in.curves.scale.pts, [[0.5, 1]]);
});

test("every editable property of every built-in preset gives legal points to draw (the graph's pool is 16)", () => {
  reset();
  for (const side of ["in", "out"]) {
    for (const p of side === "in" ? I.IN_PRESETS : I.OUT_PRESETS) {
      const s = st({ [`${side}Preset`]: p.id, side });
      for (const e of I.editable(side, p.id)) {
        const q = E.pointsFor(s, side, e.prop);
        if (!e.ok) assert.strictEqual(q, null, `${p.id} ${e.prop}`);
        else {
          assert.ok(Array.isArray(q) && q.length >= 1 && q.length <= 16, `${p.id} ${e.prop}`);
          assert.ok(E.editDraft(s, side, e.prop, q), `${p.id} ${e.prop} edits back to itself`);
        }
      }
    }
  }
});

test("Save sends P.added { side, base, name, frames, curves }; the typed length is what is saved; the row becomes a tile and resolves", () => {
  reset();
  const s = st({ inPreset: "pop", inFrames: 15 });
  edit(s, "in", "scale", pts([0.3, 0.8], [0.6, 1.2]));
  const spec = E.saveSpec(s, "in", "Snappy");
  assert.deepStrictEqual(spec, { side: "in", base: "pop", name: "Snappy", frames: 15, curves: { scale: { pts: [[0.3, 0.8], [0.6, 1.2]] } } });
  const made = P.added([], spec, 1234);
  assert.strictEqual(made.id, "mine1234");
  assert.strictEqual(I.setCustom(made.raw).kept, 1);
  assert.deepStrictEqual(U.tiles("in").slice(0, 2).map((t) => [t.id, !!t.mine]), [["none", false], ["mine1234", true]]);
  assert.strictEqual(E.saveSpec(st({ inPreset: "pop" }), "in", "x"), null);          // no draft: nothing to save
});

test("after a save the page ends the draft and picks the new id; after a delete the base comes back, with the other side's draft kept", () => {
  reset();
  const s = st({ inPreset: "pop", outPreset: "shrink" });
  edit(s, "in", "scale", pts([0.3, 0.8]));
  edit(s, "out", "scale", pts([0.5, 0.2]));
  const made = P.added([], E.saveSpec(s, "in", "Snappy"), 7);
  I.setCustom(made.raw);
  s.drafts.in = null;
  I.setDraft("in", null);
  Object.assign(s, U.afterPick(s, "in", made.id));
  E.syncDrafts(s);
  assert.strictEqual(s.inPreset, "mine7");
  assert.strictEqual(s.drafts.in, null);
  assert.ok(s.drafts.out && I.find("out", I.DRAFT));                                 // the other side's edit stays
  const gone = P.removed(made.raw, "mine7");
  I.setCustom(gone.raw);
  Object.assign(s, U.afterDelete(s, "in", "mine7", "pop"));
  E.syncDrafts(s);
  assert.strictEqual(s.inPreset, "pop");
  assert.ok(s.drafts.out);
});

test("Save as new keeps names unique among that side's own presets (case ignored), within 24 characters", () => {
  const raw = [own("mine1", "in", "pop", "Snappy"), own("mine2", "in", "pop", "Snappy 2"), own("mine3", "out", "shrink", "Other")];
  assert.strictEqual(E.uniqueName(raw, "in", "Fresh"), "Fresh");
  assert.strictEqual(E.uniqueName(raw, "in", "  snappy "), "snappy 3");
  assert.strictEqual(E.uniqueName(raw, "out", "Snappy"), "Snappy");                    // the other side's names do not count
  assert.strictEqual(E.uniqueName(raw, "out", "other"), "other 2");
  assert.strictEqual(E.uniqueName(raw, "in", "   "), "");
  const long = "x".repeat(24);
  assert.strictEqual(E.uniqueName([own("mine1", "in", "pop", long)], "in", long), `${"x".repeat(22)} 2`);
});
