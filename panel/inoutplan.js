// In & Out animations (docs/IN_OUT_PLAN.md, Phase 1): the preset tables and the maths of a baked animation at the start and
// the end of a clip. Pure (no Premiere), tested with node. Premiere's UXP API cannot set bezier handles (Phase 0 of the
// Keyframer, docs/probes/cockpit-phase0.md), so every animation is baked: one row per sequence frame, shaped by the curves
// of keyframeplan.js (reused, not copied).
//
// UNIT-NEUTRAL on purpose (the live probe of Transform's units has not run yet): this module knows frames and
// screen-relative amounts, never Premiere's units or seconds. What Phase 2 must turn into Premiere values:
//   dx, dy  offset as a fraction of the sequence frame (0 at rest, x right, y down). When `exit.<side>` is true the unit is
//           instead "one exit distance" (1 = the clip's box just fully off the picture towards that edge, resolved by Phase 2
//           from the clip's real box); the small pull-backs and overshoots around it are fractions of that distance.
//   s       scale multiplier (1 at rest), kept inside [SCALE_MIN, blurplan.SCALE_MAX / 100]
//   r       degrees added to the rotation (0 at rest, positive = clockwise as in Premiere)
//   o       opacity multiplier 0..1 (1 at rest)
//   f       frame index counted from the clip's first sequence frame (In starts at 0, Out ends at frames - 1)

const K = require("./keyframeplan.js");
const B = require("./blurplan.js");

const PIN = B.PIN || 0.01;                   // of a frame: the pins sit this far outside each end (as the blur's second key)
const SCALE_MAX = (B.SCALE_MAX || 400) / 100; // Premiere breaks blending of a Transform above about 400 % (measured, blurplan.js)
// 0.5 %: a frame at about scale 0 shows nothing; never exactly 0. blurplan.js has the same floor as ZERO_SCALE but does not
// export it, so the value is repeated here (keep the two equal).
const SCALE_MIN = 0.005;
const STRENGTH_DEFAULT = 100;
const STRENGTH_MIN = 25;
const STRENGTH_MAX = 200;
const FRAMES_MIN = 1;
const FRAMES_MAX = 1000;                      // generous: MAX_KEYS is the real guard, the clip's length the practical one
const DIRECTIONS = ["left", "right", "top", "bottom"];
const TURNS = ["cw", "ccw"];
const REST = { pos: 0, scale: 1, rot: 0, op: 1 };
const PROP_NAMES = ["pos", "scale", "rot", "op"];

// groups in the order the page shows them
const GROUPS = [
  { id: "pos", name: "Position" },
  { id: "scale", name: "Scale" },
  { id: "rot", name: "Rotation" },
  { id: "op", name: "Opacity" },
];

// ---------------------------------------------------------------- curves
// A curve is the id of a keyframeplan.PRESETS bezier, one of the extra beziers below, or an elastic / bounce object (the
// kinds keyframeplan.ease understands). The extra ones are the ease-IN family the Out presets need (keyframeplan has only
// one plain ease-in): objects never mirror an In, each Out names its own.
const EXTRA = {
  cubicOut: [0.33, 1, 0.68, 1],
  cubicIn: [0.32, 0, 0.67, 0],               // gravity-like acceleration (an object falling, a hard exit)
  expoIn: [0.7, 0, 0.84, 0],                 // a whip: almost nothing, then gone
  slam: [0.7, 0, 1, 1],                      // accelerates all the way into a hard stop
};
const E = (n, over) => ({ kind: "elastic", dir: "end", n, over });  // wobbles around the target n times, settles
const Bn = (n, h) => ({ kind: "bounce", dir: "end", n, h });         // falls on the target, n hops, never past it

function curveOf(c) {
  if (typeof c !== "string") return c;
  if (EXTRA[c]) return EXTRA[c];
  const p = K.PRESETS.find((x) => x.id === c);
  if (!p) throw new Error(`inoutplan: unknown curve "${c}"`);
  return p.p;
}

// ---------------------------------------------------------------- the tables
// One preset = one row: {id, name, group, frames (default length), directional (asks for an edge), turns (asks for a turn
// direction), props: [...]}. A prop is {prop: "pos"|"scale"|"rot"|"op", curve, and one of
//   from: v          In: the value it starts at, ending at rest        to: v    Out: starts at rest, ends at v
//   path: [{at, v, curve, exit}]   more than two anchors (Anticipate, Pop Out): `at` 0..1 of the animation, the first one at
//                                  0, each curve shapes the piece that ENDS at that anchor
// Values are deviations in the prop's own terms: pos = distance towards the picked edge (`edge` fixes the edge instead,
// for a drop); scale / opacity = multiplier; rot = signed degrees, mirrored when the turn is counter-clockwise. `exit: true`
// marks a pos anchor that must be fully off the picture; Phase 2 resolves its real distance. `follow: true` (a roll) turns
// with the travel direction instead of asking for a turn.
const IN_PRESETS = [
  // position
  { id: "slide", name: "Slide", group: "pos", frames: 12, directional: true, props: [{ prop: "pos", from: 1, exit: true, curve: "cubicOut" }] },
  { id: "glide", name: "Glide", group: "pos", frames: 18, directional: true, props: [{ prop: "pos", from: 0.25, curve: "easeOut" }] },
  { id: "whip", name: "Whip", group: "pos", frames: 8, directional: true, props: [{ prop: "pos", from: 1, exit: true, curve: "expoOut" }] },
  { id: "overshoot", name: "Overshoot", group: "pos", frames: 14, directional: true, props: [{ prop: "pos", from: 1, exit: true, curve: "overshoot" }] },
  { id: "elastic", name: "Elastic", group: "pos", frames: 24, directional: true, props: [{ prop: "pos", from: 1, exit: true, curve: E(3, 0.2) }] },
  { id: "bounce", name: "Bounce", group: "pos", frames: 24, directional: true, props: [{ prop: "pos", from: 1, exit: true, curve: Bn(3, 0.5) }] },
  { id: "drop", name: "Drop", group: "pos", frames: 22, directional: false, props: [{ prop: "pos", from: 1, exit: true, edge: "top", curve: Bn(2, 0.4) }] },
  // scale (pop)
  { id: "pop", name: "Pop", group: "scale", frames: 12, props: [{ prop: "scale", from: 0.6, curve: "overshoot" }] },
  { id: "popSoft", name: "Pop Soft", group: "scale", frames: 10, props: [{ prop: "scale", from: 0.85, curve: "easeOut" }] },
  { id: "popElastic", name: "Pop Elastic", group: "scale", frames: 20, props: [{ prop: "scale", from: 0.5, curve: E(3, 0.2) }] },
  { id: "popBounce", name: "Pop Bounce", group: "scale", frames: 20, props: [{ prop: "scale", from: 0.5, curve: Bn(2, 0.5) }] },
  { id: "slam", name: "Slam", group: "scale", frames: 8, props: [{ prop: "scale", from: 2.2, curve: "slam" }] },
  { id: "zoomIn", name: "Zoom In", group: "scale", frames: 14, props: [{ prop: "scale", from: 0, curve: "expoOut" }] },
  // rotation
  { id: "spinIn", name: "Spin In", group: "rot", frames: 18, turns: true, props: [{ prop: "rot", from: -360, curve: "cubicOut" }] },
  { id: "swing", name: "Swing", group: "rot", frames: 16, turns: true, props: [{ prop: "rot", from: -12, curve: "overshoot" }] },
  { id: "twistPop", name: "Twist Pop", group: "rot", frames: 14, turns: true,
    props: [{ prop: "scale", from: 0.6, curve: "overshoot" }, { prop: "rot", from: -90, curve: "cubicOut" }] },
  { id: "rollIn", name: "Roll In", group: "rot", frames: 18, directional: true,
    props: [{ prop: "pos", from: 1, exit: true, curve: "cubicOut" }, { prop: "rot", from: -360, follow: true, curve: "cubicOut" }] },
  // opacity
  { id: "fade", name: "Fade", group: "op", frames: 10, props: [{ prop: "op", from: 0, curve: "easeOut" }] },
  { id: "slideFade", name: "Slide Fade", group: "op", frames: 12, directional: true,
    props: [{ prop: "pos", from: 0.15, curve: "cubicOut" }, { prop: "op", from: 0, curve: "easeOut" }] },
  { id: "popFade", name: "Pop Fade", group: "op", frames: 12,
    props: [{ prop: "scale", from: 0.8, curve: "overshoot" }, { prop: "op", from: 0, curve: "easeOut" }] },
];

const OUT_PRESETS = [
  // position
  { id: "slide", name: "Slide", group: "pos", frames: 12, directional: true, props: [{ prop: "pos", to: 1, exit: true, curve: "cubicIn" }] },
  { id: "whip", name: "Whip", group: "pos", frames: 8, directional: true, props: [{ prop: "pos", to: 1, exit: true, curve: "expoIn" }] },
  { id: "anticipate", name: "Anticipate", group: "pos", frames: 16, directional: true, props: [{ prop: "pos", path: [
    { at: 0, v: 0 }, { at: 0.3, v: -0.08, curve: "cubicOut" }, { at: 1, v: 1, exit: true, curve: "cubicIn" }] }] },
  { id: "drop", name: "Drop", group: "pos", frames: 14, directional: false, props: [{ prop: "pos", to: 1, exit: true, edge: "bottom", curve: "cubicIn" }] },
  // scale
  { id: "shrink", name: "Shrink", group: "scale", frames: 12, props: [{ prop: "scale", to: 0, curve: "cubicIn" }] },
  { id: "popOut", name: "Pop Out", group: "scale", frames: 14, props: [{ prop: "scale", path: [
    { at: 0, v: 1 }, { at: 0.25, v: 1.12, curve: "cubicOut" }, { at: 1, v: 0, curve: "cubicIn" }] }] },
  { id: "zoomOut", name: "Zoom Out", group: "scale", frames: 14,
    props: [{ prop: "scale", to: 1.8, curve: "cubicIn" }, { prop: "op", to: 0, curve: "cubicIn" }] },
  // rotation
  { id: "spinOut", name: "Spin Out", group: "rot", frames: 18, turns: true, props: [{ prop: "rot", to: 360, curve: "cubicIn" }] },
  { id: "twistShrink", name: "Twist Shrink", group: "rot", frames: 14, turns: true,
    props: [{ prop: "scale", to: 0, curve: "cubicIn" }, { prop: "rot", to: 90, curve: "cubicIn" }] },
  { id: "rollOut", name: "Roll Out", group: "rot", frames: 18, directional: true,
    props: [{ prop: "pos", to: 1, exit: true, curve: "cubicIn" }, { prop: "rot", to: 360, follow: true, curve: "cubicIn" }] },
  { id: "swingOut", name: "Swing Out", group: "rot", frames: 16, turns: true,
    props: [{ prop: "rot", path: [{ at: 0, v: 0 }, { at: 0.3, v: -10, curve: "cubicOut" }, { at: 1, v: 24, curve: "cubicIn" }] },
      { prop: "op", to: 0, curve: "cubicIn" }] },
  // opacity
  { id: "fade", name: "Fade", group: "op", frames: 10, props: [{ prop: "op", to: 0, curve: "easeIn" }] },
  { id: "slideFade", name: "Slide Fade", group: "op", frames: 12, directional: true,
    props: [{ prop: "pos", to: 0.15, curve: "cubicIn" }, { prop: "op", to: 0, curve: "easeIn" }] },
];

const TABLES = { in: IN_PRESETS, out: OUT_PRESETS };

// ---------------------------------------------------------------- helpers for the page
/** the preset of `side` ("in" | "out") with this id, or null */
function find(side, id) {
  return (TABLES[side] || []).find((p) => p.id === id) || null;
}

/** [{id, name, presets: [row]}] in display order, empty groups left out */
function groups(side) {
  return GROUPS.map((g) => ({ id: g.id, name: g.name, presets: (TABLES[side] || []).filter((p) => p.group === g.id) })).filter((g) => g.presets.length);
}

/** which properties a preset animates, in a fixed order: the page's icons, and the only ones Phase 2 keys */
function animates(preset) {
  const set = new Set(preset.props.map((x) => x.prop));
  return PROP_NAMES.filter((n) => set.has(n));
}

const STRENGTH_FREE = new WeakMap();
// Does Strength change anything on this preset? Measured from the rows themselves (STRENGTH_MIN against STRENGTH_MAX at the preset's own
// length), not a hand list, so a new table row is judged correctly with no code change.
function strengthMatters(preset) {
  if (!STRENGTH_FREE.has(preset)) {
    const side = IN_PRESETS.includes(preset) ? "in" : "out";
    const at = (strength) => JSON.stringify(rows(side, preset, preset.frames, 0, { strength, direction: "left", turn: "cw" }).rows);
    STRENGTH_FREE.set(preset, at(STRENGTH_MIN) !== at(STRENGTH_MAX));
  }
  return STRENGTH_FREE.get(preset);
}

/** what the page must ask for when this preset is picked: {direction, turn, strength (false: the control changes nothing, grey it)} */
function needs(preset) {
  return { direction: !!preset.directional, turn: !!preset.turns, strength: strengthMatters(preset) };
}

function defaultFrames(side, id) {
  const p = find(side, id);
  return p ? p.frames : null;
}

// ---------------------------------------------------------------- the maths
const EDGE = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const nz = (v) => v + 0;                                              // -0 becomes 0

// A prop's anchors as one list [{at, v, curve, exit}], the first at 0: In `from` ends at rest, Out `to` starts there.
function anchorsOf(side, pr) {
  if (pr.path) return pr.path.map((a) => ({ at: a.at, v: a.v, curve: a.curve ? curveOf(a.curve) : null, exit: !!a.exit }));
  const rest = REST[pr.prop];
  const curve = curveOf(pr.curve);
  if (side === "in") return [{ at: 0, v: pr.from, curve: null, exit: !!pr.exit }, { at: 1, v: rest, curve, exit: false }];
  return [{ at: 0, v: rest, curve: null, exit: false }, { at: 1, v: pr.to, curve, exit: !!pr.exit }];
}

// One prop of one side as n + 1 raw values (frame 0..n) in the prop's own terms (before the edge / turn mapping).
// `k` = strength / 100. Deviations from rest scale with k, except the anchors that must always be reached in full: an `exit`
// anchor (fully off the picture), a scale of 0 (to / from nothing) and every opacity anchor (a fade always runs the whole way).
// Where an animation has such an anchor, the strength scales what happens AFTER the move first arrives (overshoot, wobble,
// hops) instead.
function sample(side, pr, n, k) {
  const anchors = anchorsOf(side, pr);
  // frames of the anchors; an anchor that falls on the same frame as the one before is dropped (short animations)
  const pts = [];
  for (const a of anchors) {
    const fr = a === anchors[anchors.length - 1] ? n : Math.round(a.at * n);
    if (pts.length && fr <= pts[pts.length - 1].fr) {
      if (a === anchors[anchors.length - 1]) pts[pts.length - 1] = Object.assign({}, a, { fr });
      continue;
    }
    pts.push(Object.assign({}, a, { fr }));
  }
  const fixed = (a) => a.exit || pr.prop === "op" || (pr.prop === "scale" && a.v === 0);
  const dev = (a) => (fixed(a) ? a.v : REST[pr.prop] + (a.v - REST[pr.prop]) * k);
  const hasFixed = anchors.some((a) => fixed(a) && a.v !== REST[pr.prop]);
  const out = [dev(pts[0])];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = b.fr - a.fr;
    // progress per frame of the piece, from the shared bake (values 0 -> 1 at step 1: time is in frames)
    const p = [0, ...K.bake([{ t: 0, v: 0 }, { t: len, v: 1 }], b.curve, 1).add.map((x) => x.v), 1];
    let arrived = false;
    for (let j = 1; j <= len; j++) {
      let pj = p[j];
      if (hasFixed && j < len) {
        // arrival = the first frame at the target, or the first one that has already turned back (a bounce touches the
        // target between two frames and never shows exactly 1)
        if (!arrived && (pj >= 1 - 1e-9 || pj < p[j - 1] - 1e-12)) arrived = true;
        if (arrived) pj = 1 + (pj - 1) * k;
      }
      out.push(j === len ? dev(b) : K.lerp(dev(a), dev(b), pj));
    }
  }
  return out;
}

// the rows of one side: n + 1 rows, f0 = the frame of the first one
function rows(side, preset, n, f0, opts) {
  const k = opts.strength / STRENGTH_DEFAULT;
  const edgeName = (pr) => pr.edge || opts.direction;
  const series = {};
  let exit = false;
  for (const pr of preset.props) {
    series[pr.prop] = { pr, v: sample(side, pr, n, k) };
    if (pr.prop === "pos" && (pr.exit || (pr.path && pr.path.some((a) => a.exit)))) exit = true;
  }
  const out = [];
  for (let i = 0; i <= n; i++) {
    const row = { f: f0 + i, dx: 0, dy: 0, s: 1, r: 0, o: 1 };
    if (series.pos) {
      const e = EDGE[edgeName(series.pos.pr)];
      row.dx = nz(e[0] * series.pos.v[i]);
      row.dy = nz(e[1] * series.pos.v[i]);
    }
    if (series.scale) row.s = nz(clamp(series.scale.v[i], SCALE_MIN, SCALE_MAX));
    if (series.rot) {
      let sign = opts.turn === "ccw" ? -1 : 1;
      if (series.rot.pr.follow) {
        // a roll turns with its travel: coming from the left it moves right (clockwise), leaving to the right it moves right too
        const e = EDGE[edgeName(series.pos ? series.pos.pr : {})];
        sign = (side === "in" ? -1 : 1) * (e[0] !== 0 ? e[0] : e[1]);
      }
      row.r = nz(sign * series.rot.v[i]);
    }
    if (series.op) row.o = nz(clamp(series.op.v[i], 0, 1));
    out.push(row);
  }
  return { rows: out, exit };
}

function failure(error) {
  return { in: [], out: [], pins: [], frames: { in: 0, out: 0, shortened: false, meet: false }, exit: { in: false, out: false }, props: { in: [], out: [] }, total: 0, error };
}

const isNone = (id) => id === null || id === undefined || id === "" || id === "none";
const given = (v) => v !== null && v !== undefined;

// n for one side: the asked frames (rounded, kept in range) or the preset's own default
function wanted(side, preset, asked) {
  if (!given(asked)) return preset.frames;
  return clamp(Math.round(asked), FRAMES_MIN, FRAMES_MAX);
}

/**
 * The animation to write on one clip.
 * {clip: {frames}, inPreset, outPreset (ids, null / "none" = no animation on that side), inFrames, outFrames (default: the
 * preset's), direction ("left" | "right" | "top" | "bottom": the edge it comes from / leaves to), turn ("cw" | "ccw"),
 * strength (percent, 100 = default, kept in STRENGTH_MIN..STRENGTH_MAX)}
 * -> {in: [{f, dx, dy, s, r, o}], out: [...], pins: [{f, side, like}], frames: {in, out, shortened, meet}, exit: {in, out},
 *     props: {in: ["pos"|"scale"|"rot"|"op"], out}, total, error}
 * One row per sequence frame: In = rows f 0..frames.in (the last at rest), Out = rows f (clip - 1 - frames.out)..clip - 1 (the
 * first at rest; `frames.meet`: they share one frame, both rows at rest there, written once). A pin is a key a hundredth of a
 * frame outside the end of a side that repeats the values of the row whose f equals `like` (the blur's trick against Premiere
 * bending Position's path at the ends); Phase 2 decides how, and whether, to write them.
 * `total` counts every key Phase 2 would add (rows and pins, once per animated property); above K.MAX_KEYS nothing is
 * returned but `error`.
 */
function plan(opts) {
  opts = opts || {};
  const clip = opts.clip || {};
  const frames = clip.frames;
  if (typeof frames !== "number" || !Number.isFinite(frames)) return failure("the clip's length is not known");
  const len = Math.floor(frames);
  if (len < 2) return failure("the clip is shorter than 2 frames");
  const strengthIn = given(opts.strength) ? opts.strength : STRENGTH_DEFAULT;
  if (typeof strengthIn !== "number" || !Number.isFinite(strengthIn)) return failure("strength is not a number");
  const strength = clamp(strengthIn, STRENGTH_MIN, STRENGTH_MAX);
  if (given(opts.direction) && !DIRECTIONS.includes(opts.direction)) return failure(`unknown direction "${opts.direction}"`);
  if (given(opts.turn) && !TURNS.includes(opts.turn)) return failure(`unknown turn "${opts.turn}"`);
  for (const [name, v] of [["inFrames", opts.inFrames], ["outFrames", opts.outFrames]]) {
    if (given(v) && (typeof v !== "number" || !Number.isFinite(v))) return failure(`${name} is not a number`);
  }
  const inP = isNone(opts.inPreset) ? null : find("in", opts.inPreset);
  const outP = isNone(opts.outPreset) ? null : find("out", opts.outPreset);
  if (!isNone(opts.inPreset) && !inP) return failure(`unknown In preset "${opts.inPreset}"`);
  if (!isNone(opts.outPreset) && !outP) return failure(`unknown Out preset "${opts.outPreset}"`);
  if (!inP && !outP) return failure("pick an In or an Out animation");

  // In ends on frame nIn, Out starts on frame len - 1 - nOut: together at most len - 1 frames (they may meet on one frame)
  const room = len - 1;
  let nIn = inP ? wanted("in", inP, opts.inFrames) : 0;
  let nOut = outP ? wanted("out", outP, opts.outFrames) : 0;
  let shortened = false;
  if (inP && outP) {
    if (room < 2) return failure("the clip is too short for both an In and an Out animation");
    if (nIn + nOut > room) {
      shortened = true;
      const scale = room / (nIn + nOut);
      nIn = Math.max(1, Math.floor(nIn * scale));
      nOut = Math.max(1, Math.floor(nOut * scale));
      while (nIn + nOut > room) { if (nIn >= nOut && nIn > 1) nIn--; else nOut--; }
    }
  } else if (nIn + nOut > room) {
    shortened = true;
    nIn = Math.min(nIn, room);
    nOut = Math.min(nOut, room);
  }

  const propsIn = inP ? animates(inP) : [];
  const propsOut = outP ? animates(outP) : [];
  const outStart = len - 1 - nOut;
  // Pins: a key PIN outside each end of a side, repeating the values of the row whose f equals `like` (a frame number, the
  // same for In and Out). The In's first pin sits at f = -PIN, before the clip's first frame: Phase 2 decides what to do when
  // the clip's In point is 0. When In ends on the frame Out starts on, the pins between them would lie inside the other side's
  // rows and are left out.
  const meet = !!(inP && outP) && outStart <= nIn;
  const pins = [];
  if (inP) {
    pins.push({ f: -PIN, side: "in", like: 0 });
    if (!meet) pins.push({ f: nIn + PIN, side: "in", like: nIn });
  }
  if (outP) {
    if (!meet) pins.push({ f: outStart - PIN, side: "out", like: outStart });
    pins.push({ f: len - 1 + PIN, side: "out", like: len - 1 });
  }
  // Every key Phase 2 would write. The frame where In and Out meet is one key per property (both rows are at rest there), so a
  // property both animate is counted once. Per clip: a multi-clip apply must sum the totals of one press against the cap.
  const per = (side) => pins.filter((x) => x.side === side).length;
  let total = (inP ? (nIn + 1 + per("in")) * propsIn.length : 0) + (outP ? (nOut + 1 + per("out")) * propsOut.length : 0);
  if (meet) total -= propsIn.filter((x) => propsOut.includes(x)).length;
  if (total > K.MAX_KEYS) return failure(`that would add ${total} keyframes (more than ${K.MAX_KEYS}): use shorter animations`);

  const o = { strength, direction: opts.direction || "left", turn: opts.turn || "cw" };
  const a = inP ? rows("in", inP, nIn, 0, o) : { rows: [], exit: false };
  const b = outP ? rows("out", outP, nOut, outStart, o) : { rows: [], exit: false };
  return { in: a.rows, out: b.rows, pins, frames: { in: inP ? nIn : 0, out: outP ? nOut : 0, shortened, meet }, exit: { in: a.exit, out: b.exit },
    props: { in: propsIn, out: propsOut }, total };
}

// ---------------------------------------------------------------- adapters (constants pending the Phase 0 probe)
// These are the only places that may need a correction once the probe has measured Premiere; everything above is unit-free.

/**
 * Frame f (counted from the clip's first sequence frame) -> media seconds: inPt + f * |speed| / fps, the maths of
 * premiere-keyframes.js (readSelection: step = |speed| / fps, keys at media time). PENDING PHASE 0: the sped-up clip's key
 * times have not been measured in Premiere yet (docs/features/keyframer.md), so this is the Keyframer's assumption.
 * clip: {inPt (media seconds), speed (1 = normal; negative = reversed, refused)} -> {step, at(f), error}
 */
function times(clip, fps) {
  const c = clip || {};
  const speed = Number.isFinite(c.speed) && c.speed !== 0 ? c.speed : 1;
  if (!Number.isFinite(fps) || fps <= 0) return { step: NaN, at: null, error: "the sequence frame rate is not known" };
  if (c.reversed || speed < 0) return { step: NaN, at: null, error: "the clip plays in reverse" };
  const inPt = Number.isFinite(c.inPt) ? c.inPt : 0;
  const step = Math.abs(speed) / fps;
  return { step, at: (f) => inPt + f * step };
}

// Transform units (Position / Rotation / Opacity of AE.ADBE Geometry2) are NOT adapted yet: they are unmeasured. The intended
// route for Position, Scale and Rotation is blurplan.rel (the Transform that shows the same picture as the clip's Motion),
// with dx / dy times the sequence size (or the exit distance when plan().exit says so) as the offset.

module.exports = {
  IN_PRESETS, OUT_PRESETS, GROUPS, DIRECTIONS, TURNS, REST, PROP_NAMES,
  STRENGTH_DEFAULT, STRENGTH_MIN, STRENGTH_MAX, FRAMES_MIN, FRAMES_MAX, SCALE_MAX, SCALE_MIN, PIN,
  plan, times, find, groups, animates, needs, defaultFrames,
};
