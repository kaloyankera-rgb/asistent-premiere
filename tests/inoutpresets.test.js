// node --test tests/inoutpresets.test.js
// The editor's own In & Out presets (panel/inoutpresets.js): pure list rules, no store.
const test = require("node:test");
const assert = require("node:assert");
const P = require("../panel/inoutpresets.js");
const I = require("../panel/inoutplan.js");

const spec = (o) => Object.assign({ side: "in", base: "pop", name: "Mine", frames: 10, curves: { scale: { pts: [[0.3, 0.9], [0.6, 1.1, 1]] } } }, o);
const FOREIGN = [{ id: "mine5", v: 2, side: "in", base: "pop", name: "Future", frames: 3, curves: { x: 1 }, extra: [1, 2] }, "junk", null, 7, { id: "x" }];
const dump = (rows) => rows.map((r) => JSON.stringify(r));

test("parse: junk, null and non-arrays become []; unknown rows stay", () => {
  for (const t of [null, undefined, "", "not json", "{}", "42", "null", '"x"', 5, {}]) assert.deepStrictEqual(P.parse(t), []);
  const raw = JSON.stringify(FOREIGN);
  assert.deepStrictEqual(P.parse(raw), FOREIGN);
  assert.strictEqual(P.KEY, "asistent.inout.presets");
});

test("added: builds the row, id from now, pts rounded to 3 decimals, corner flag kept", () => {
  const r = P.added([], spec({ curves: { scale: { pts: [[0.12345, 0.98765], [0.5551, 1.0004, 1], [0.8, 1.0, 0]] }, op: { pts: [[0.5, 0.5]] } }, name: "  Soft   pop ", base: "popFade" }), 1000);
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(r.id, "mine1000");
  assert.deepStrictEqual(r.raw, [{ id: "mine1000", v: 1, side: "in", base: "popFade", name: "Soft pop", frames: 10,
    curves: { scale: { pts: [[0.123, 0.988], [0.555, 1, 1], [0.8, 1]] }, op: { pts: [[0.5, 0.5]] } } }]);
});

test("added: ids stay unique within one millisecond and next to foreign ids", () => {
  let raw = [];
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = P.added(raw, spec(), 2000);
    ids.push(r.id);
    raw = r.raw;
  }
  assert.deepStrictEqual(ids, ["mine2000", "mine2001", "mine2002"]);
  assert.strictEqual(P.added(FOREIGN, spec(), 5).id, "mine6");                    // mine5 belongs to a v:2 row
});

test("the cap counts only rows this version understands", () => {
  let raw = [];
  for (let i = 0; i < P.CUSTOM_MAX; i++) raw = P.added(raw, spec({ name: `n${i}` }), 1).raw;
  assert.strictEqual(raw.length, 60);
  const e = P.added(raw, spec(), 99);
  assert.match(e.error, /60/);
  assert.ok(/^[A-Z].*\.$/.test(e.error));
  const withForeign = [...FOREIGN, ...raw.slice(1)];                                // 59 understood + foreign
  assert.strictEqual(P.added(withForeign, spec(), 99).error, undefined);
});

test("foreign and v:2 rows survive add, rename and delete byte for byte", () => {
  const a = P.added(FOREIGN, spec(), 10);
  assert.deepStrictEqual(dump(a.raw.slice(0, FOREIGN.length)), dump(FOREIGN));
  const rn = P.renamed(a.raw, a.id, "Other");
  assert.deepStrictEqual(dump(rn.raw.slice(0, FOREIGN.length)), dump(FOREIGN));
  assert.strictEqual(rn.raw[FOREIGN.length].name, "Other");
  const rm = P.removed(a.raw, a.id);
  assert.deepStrictEqual(dump(rm.raw), dump(FOREIGN));
  // a v:2 row with the same id as a request is not renamed or removed
  assert.ok(P.renamed(FOREIGN, "mine5", "X").error);
  assert.deepStrictEqual(dump(P.removed(FOREIGN, "mine5").raw), dump(FOREIGN));
});

test("cleanName: trimmed, whitespace collapsed, cut to 24", () => {
  assert.strictEqual(P.cleanName("  a \t b\n c  "), "a b c");
  assert.strictEqual(P.cleanName("x".repeat(40)), "x".repeat(24));
  assert.strictEqual(P.cleanName("abcdefghijklmnopqrstuvw yz"), "abcdefghijklmnopqrstuvw");  // no trailing space after the cut
  assert.strictEqual(P.cleanName("   "), "");
  assert.strictEqual(P.cleanName(null), "");
  assert.strictEqual(P.cleanName({}), "");
});

test("nextName: My Pop, My Pop 2, My Pop 3, per side, within the limit", () => {
  let raw = [];
  assert.strictEqual(P.nextName(raw, "in", "Pop"), "My Pop");
  raw = P.added(raw, spec({ name: "My Pop" }), 1).raw;
  assert.strictEqual(P.nextName(raw, "in", "Pop"), "My Pop 2");
  raw = P.added(raw, spec({ name: "My Pop 2" }), 2).raw;
  assert.strictEqual(P.nextName(raw, "in", "Pop"), "My Pop 3");
  assert.strictEqual(P.nextName(raw, "out", "Pop"), "My Pop");                       // the other side has its own names
  const long = "Extraordinarily Long Name";
  const first = P.nextName([], "in", long);
  assert.ok(first.length <= P.NAME_MAX);
  const second = P.nextName([{ id: "a", v: 1, side: "in", name: first }], "in", long);
  assert.ok(second.length <= P.NAME_MAX && second.endsWith(" 2") && second !== first);
});

test("added: each refusal is a readable sentence and nothing is returned", () => {
  const bad = [
    spec({ side: "up" }), spec({ side: undefined }), spec({ base: "nope" }), spec({ base: "pop", side: "out" }), spec({ name: "   " }), spec({ name: null }),
    spec({ frames: "abc" }), spec({ frames: null }),
    spec({ curves: {} }), spec({ curves: null }), spec({ curves: { scale: { pts: [] } } }), spec({ curves: { scale: { pts: [[0.5, 5]] } } }),
    spec({ curves: { scale: { pts: [[0.6, 1], [0.4, 1]] } } }), spec({ curves: { scale: { pts: [[0.5, 1, 7]] } } }), spec({ curves: { zoom: { pts: [[0.5, 1]] } } }),
    spec({ curves: { scale: { pts: [[0.5, 1]] }, op: {} } }), null,
  ];
  for (const s of bad) {
    const r = P.added([], s, 1);
    assert.ok(typeof r.error === "string" && /^[A-Z].*\.$/.test(r.error), JSON.stringify(s));
    assert.strictEqual(r.raw, undefined);
    assert.strictEqual(r.id, undefined);
  }
});

test("added: frames are rounded and kept inside the plan's limits", () => {
  assert.strictEqual(P.added([], spec({ frames: 7.6 }), 1).raw[0].frames, 8);
  assert.strictEqual(P.added([], spec({ frames: 99999 }), 1).raw[0].frames, 1000);
  assert.strictEqual(P.added([], spec({ frames: 0 }), 1).raw[0].frames, 1);
});

test("inputs are not mutated", () => {
  const raw = [{ id: "mine1", v: 1, side: "in", base: "pop", name: "A", frames: 5, curves: { scale: { pts: [[0.5, 1]] } } }, ...FOREIGN];
  const s = spec({ name: "  B  " });
  const rawBefore = JSON.stringify(raw);
  const sBefore = JSON.stringify(s);
  const a = P.added(raw, s, 1);
  P.renamed(raw, "mine1", "Z");
  P.removed(raw, "mine1");
  P.nextName(raw, "in", "Pop");
  assert.strictEqual(JSON.stringify(raw), rawBefore);
  assert.strictEqual(JSON.stringify(s), sBefore);
  a.raw[a.raw.length - 1].curves.scale.pts[0][0] = 0.9;                              // the new row shares nothing with the spec
  assert.strictEqual(JSON.stringify(s), sBefore);
});

test("renamed: changes the name only, same id and position; refusals", () => {
  let raw = [];
  for (const n of ["A", "B", "C"]) raw = P.added(raw, spec({ name: n }), 100).raw;
  const id = raw[1].id;
  const r = P.renamed(raw, id, "  New   name ");
  assert.deepStrictEqual(r.raw.map((x) => x.id), raw.map((x) => x.id));
  assert.strictEqual(r.raw[1].name, "New name");
  assert.deepStrictEqual(Object.assign({}, r.raw[1], { name: "B" }), raw[1]);
  assert.strictEqual(raw[1].name, "B");
  assert.deepStrictEqual(Object.keys(r.raw[1]), Object.keys(raw[1]));
  assert.ok(/\.$/.test(P.renamed(raw, id, "   ").error));
  assert.ok(/\.$/.test(P.renamed(raw, "mine-nope", "X").error));
});

test("removed: drops that row; an unknown id changes nothing", () => {
  let raw = [];
  for (const n of ["A", "B", "C"]) raw = P.added(raw, spec({ name: n }), 100).raw;
  const r = P.removed(raw, raw[1].id);
  assert.deepStrictEqual(r.raw.map((x) => x.name), ["A", "C"]);
  assert.deepStrictEqual(dump(P.removed(raw, "mine-nope").raw), dump(raw));
  assert.deepStrictEqual(P.removed(null, "x").raw, []);
});

test("added never saves a row the maths would drop on the next load", () => {
  const curve = { pts: [[0.3, 1.2], [0.6, 0.9]] };
  // every editable property of every built-in saves, and what is saved resolves
  for (const side of ["in", "out"]) {
    for (const p of side === "in" ? I.IN_PRESETS : I.OUT_PRESETS) {
      for (const e of I.editable(side, p.id)) {
        const r = P.added([], { side, base: p.id, name: "x", frames: p.frames, curves: { [e.prop]: e.ok ? { pts: I.curveFor(side, p.id, e.prop) } : curve } }, 5);
        if (e.ok) assert.ok(!r.error && !I.resolve(r.raw[0], r.id).error, `${side}/${p.id}/${e.prop}`);
        else assert.ok(/^This preset cannot be saved: .*\.$/.test(r.error), `${side}/${p.id}/${e.prop} is refused`);
      }
    }
  }
  // a property the base does not animate
  assert.ok(P.added([], { side: "in", base: "slide", name: "x", frames: 12, curves: { rot: curve } }, 5).error);
  // an own preset or the draft as the base: only a built-in is a base
  const own = P.added([], { side: "in", base: "pop", name: "x", frames: 12, curves: { scale: curve } }, 5);
  I.setCustom(own.raw);
  I.setDraft("in", Object.assign({}, own.raw[0]));
  assert.ok(P.added(own.raw, { side: "in", base: own.id, name: "y", frames: 12, curves: { scale: curve } }, 6).error);
  assert.ok(P.added(own.raw, { side: "in", base: I.DRAFT, name: "y", frames: 12, curves: { scale: curve } }, 6).error);
  I.setCustom([]);
  I.setDraft("in", null);
  // a stamp that would not make a mine<digits> id
  for (const now of [-3, 1e21, NaN, "x", 1.5]) {
    const r = P.added([], { side: "in", base: "pop", name: "x", frames: 12, curves: { scale: curve } }, now);
    assert.ok(!r.error && /^mine\d+$/.test(r.id), `${now} -> ${r.id}`);
    assert.ok(!I.resolve(r.raw[0], r.id).error);
  }
});
