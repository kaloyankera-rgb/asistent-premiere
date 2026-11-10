// Stash v1 (COCKPIT_PLAN.md A2, 0.10.37)
const test = require("node:test");
const assert = require("node:assert");
const S = require("../panel/stashplan.js");
const K = require("../panel/keyframeplan.js");

const fps = 30;
const step = 1 / fps;
// a Position move 0.3 -> 0.7 over 1 s eased (Ease In-Out), sampled every frame, plus Scale 100 -> 120 starting 0.5 s later
function source() {
  const pos = { label: "Motion › Position", comp: "AE.ADBE Motion", param: "Position", keys: [{ t: 4.4, v: [0.3, 0.5] }, { t: 5.4, v: [0.7, 0.5] }] };
  pos.samples = Array.from({ length: 31 }, (_, f) => ({ t: 4.4 + f * step, v: K.lerp([0.3, 0.5], [0.7, 0.5], K.ease([0.42, 0, 0.58, 1], f / 30)) }));
  const sc = { label: "Motion › Scale", comp: "AE.ADBE Motion", param: "Scale", keys: [{ t: 4.9, v: 100 }, { t: 5.9, v: 120 }] };
  sc.samples = Array.from({ length: 31 }, (_, f) => ({ t: 4.9 + f * step, v: 100 + 20 * (f / 30) }));
  return [pos, sc];
}

test("capture: one origin for every property, so their timing against each other is kept", () => {
  const s = S.capture(source(), { name: "x" });
  assert.strictEqual(s.format, 1);
  assert.deepStrictEqual(s.props.map((p) => [p.anchors[0].dt, p.anchors[1].dt]), [[0, 1], [0.5, 1.5]]);
  assert.strictEqual(s.span, 1.5);
  assert.strictEqual(s.props[0].frames.length, 31);
});

test("place: the same eased motion from the playhead, the editor's keys as keys, the frames between as added keys", () => {
  const s = S.capture(source());
  const r = S.place(s, 10, step, 20);
  const pos = r.props[0];
  assert.deepStrictEqual(pos.anchors.map((k) => +k.t.toFixed(3)), [10, 11]);
  assert.strictEqual(pos.add.length, 29);
  const mid = pos.add[14];                                         // frame 15 of 30: exactly halfway in an ease-in-out
  assert.ok(Math.abs(mid.v[0] - 0.5) < 1e-6);
  assert.ok(pos.add[2].v[0] - 0.3 < 0.01, "slow at the start");
  assert.deepStrictEqual(r.props[1].anchors.map((k) => +k.t.toFixed(3)), [10.5, 11.5]);
  assert.strictEqual(r.skipped.length, 0);
});

test("place at another frame rate: resampled, still exact at the keys and halfway", () => {
  const s = S.capture(source());
  const r = S.place(s, 0, 1 / 25, 10);
  assert.strictEqual(r.props[0].add.length, 24);
  assert.ok(Math.abs(S.sampleAt(s.props[0].frames, 0.5)[0] - 0.5) < 1e-6);
});

test("never over the editor's keys; cut at the clip's end; too short to hold two keys is skipped", () => {
  const s = S.capture(source());
  const r = S.place(s, 10, step, 11.2, { "Motion › Position": [10.5], "Motion › Scale": [3] });
  assert.deepStrictEqual(r.skipped.map((x) => x.label), ["Motion › Position", "Motion › Scale"]);
  assert.match(r.skipped[0].why, /1 keyframe of its own/);
  assert.match(r.skipped[1].why, /ends before/, "Scale runs 10.5-11.5, the clip ends at 11.2: one key left");
  assert.strictEqual(r.props.length, 0);
  const r2 = S.place(s, 10, step, 10.8);
  assert.ok(r2.skipped.every((x) => /ends before/.test(x.why)));
});

test("capture refuses nothing to save and a too long animation; names say what moves", () => {
  assert.ok(S.capture([{ label: "a", keys: [{ t: 0, v: 1 }] }]).error);
  const long = { label: "a", comp: "c", param: "p", keys: [{ t: 0, v: 0 }, { t: 200, v: 1 }], samples: Array.from({ length: 6001 }, (_, i) => ({ t: i / 30, v: 0 })) };
  assert.match(S.capture([long]).error, /too long/);
  assert.strictEqual(S.nameFor("C0738.MP4", ["Motion › Position", "Motion › Scale"]), "C0738 · Position, Scale");
});
