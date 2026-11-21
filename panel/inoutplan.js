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

// ---------------------------------------------------------------- own presets (Phase 5)
// An own preset is a built-in row whose per-property curves are replaced by point curves (keyframeplan's {kind: "points"}), and
// its own name and length. Only the spec is stored (by inoutpresets.js); the row is rebuilt from the base every time, so values,
// exit, edge, follow, directional and turns can never drift from the base. Rows live in a registry behind find(), so the preview
// and Apply (both go through find / plan) need no change. The registry is per side: a row of the other side is never found.
const PRESET_V = 1;                            // the spec version this module reads; a higher one is refused, never guessed at
const DRAFT = "draft";                         // the id of the one unsaved draft per side
const OWN_ID = /^mine\d+$/;
const NAME_MAX = 24;
const REGISTRY = { in: new Map(), out: new Map() };   // saved own rows by id
const DRAFTS = { in: null, out: null };

const isPoints = (c) => !!c && typeof c === "object" && !Array.isArray(c) && c.kind === "points";

/** the preset of `side` ("in" | "out") with this id, or null: built-ins first, then that side's own rows and its draft */
function find(side, id) {
  const table = TABLES[side];
  if (!table) return null;
  const built = table.find((p) => p.id === id);
  if (built) return built;
  if (id === DRAFT) return DRAFTS[side];
  return REGISTRY[side].get(id) || null;
}

// A property can be edited as one point curve only when it is one piece (from / to). A `path` property (Anticipate's position,
// Pop Out's scale, Swing Out's rotation) is several pieces with their own curves: one curve cannot stand for it.
const WHY_PATH = "a multi-step motion (pull-back or overshoot): one curve cannot replace it";

function editableOf(preset) {
  return animates(preset).map((n) => {
    const pr = preset.props.find((x) => x.prop === n);
    return pr.path ? { prop: n, ok: false, why: WHY_PATH } : { prop: n, ok: true, why: "" };
  });
}

/** which properties of a preset (built-in or own) can be edited: [{prop, ok, why}] in the page's order, [] when unknown */
function editable(side, id) {
  const p = find(side, id);
  return p ? editableOf(p) : [];
}

/** the points of one property's curve: the stored ones, else the base curve as points to drag; null when it cannot be edited */
function curveFor(side, id, prop) {
  const p = find(side, id);
  const pr = p && p.props.find((x) => x.prop === prop);
  if (!pr || pr.path) return null;
  const c = curveOf(pr.curve);
  return isPoints(c) ? c.pts.map((q) => q.slice()) : K.toPoints(c);
}

/**
 * A spec -> {row} (a clone of the base row with the edited curves) or {error: "why"}. `id` is the row's id: "mine<digits>" for a
 * saved one, DRAFT for the unsaved one.
 */
function resolve(spec, id) {
  if (!spec || typeof spec !== "object") return { error: "not a preset" };
  if (id !== DRAFT && !(typeof id === "string" && OWN_ID.test(id))) return { error: "bad id" };
  if (!Number.isInteger(spec.v) || spec.v < 1) return { error: "no version" };
  if (spec.v > PRESET_V) return { error: `made by a newer version (${spec.v})` };
  const side = spec.side;
  if (side !== "in" && side !== "out") return { error: "bad side" };
  const base = TABLES[side].find((p) => p.id === spec.base);
  if (!base) return { error: `unknown base "${spec.base}" on the ${side} side` };
  if (typeof spec.name !== "string" || !spec.name.trim() || spec.name.length > NAME_MAX) return { error: `the name must be 1-${NAME_MAX} characters` };
  if (!Number.isInteger(spec.frames) || spec.frames < FRAMES_MIN || spec.frames > FRAMES_MAX) return { error: "bad frames" };
  const curves = spec.curves === undefined || spec.curves === null ? {} : spec.curves;
  if (typeof curves !== "object" || Array.isArray(curves)) return { error: "bad curves" };
  const ed = editableOf(base);
  const props = base.props.map((pr) => Object.assign({}, pr));
  for (const name of Object.keys(curves)) {
    const e = ed.find((x) => x.prop === name);
    if (!e) return { error: `${base.name} does not animate ${name}` };
    if (!e.ok) return { error: `${name} of ${base.name} cannot be edited: ${e.why}` };
    const c = curves[name];
    if (!c || !K.pointsOk(c.pts)) return { error: `the points of ${name} are not valid` };
    props.find((x) => x.prop === name).curve = { kind: "points", pts: c.pts.map((q) => q.slice()) };
  }
  const row = Object.assign({}, base, { id, name: spec.name, frames: spec.frames, side, custom: true, base: base.id, props });
  return { row };
}

/**
 * Replace the saved own presets with these specs -> {kept (how many), dropped: [{id, why}]}. A spec that does not resolve, an id
 * that is not mine<digits> or is used twice (on either side) is dropped with a reason, the rest is kept. [] clears.
 */
function setCustom(rawList) {
  const next = { in: new Map(), out: new Map() };
  const dropped = [];
  let kept = 0;
  for (const spec of Array.isArray(rawList) ? rawList : []) {
    const id = spec && typeof spec === "object" && typeof spec.id === "string" ? spec.id : "?";
    const r = OWN_ID.test(id) ? resolve(spec, id) : { error: "bad id" };
    if (r.error) { dropped.push({ id, why: r.error }); continue; }
    if (next.in.has(id) || next.out.has(id)) { dropped.push({ id, why: "id used twice" }); continue; }
    next[r.row.side].set(id, r.row);
    kept++;
  }
  REGISTRY.in = next.in;
  REGISTRY.out = next.out;
  return { kept, dropped };
}

/** the one unsaved draft of a side (id DRAFT), or null to clear it -> the row; null when the spec does not resolve (the draft is cleared too) */
function setDraft(side, spec) {
  if (side !== "in" && side !== "out") return null;
  DRAFTS[side] = null;
  if (spec === null || spec === undefined) return null;
  const r = spec.side === side ? resolve(spec, DRAFT) : { error: "wrong side" };
  if (r.error) return null;
  DRAFTS[side] = r.row;
  return r.row;
}

/** the saved own rows of a side, in the order they were given */
function customOf(side) {
  return REGISTRY[side] ? [...REGISTRY[side].values()] : [];
}

// ---------------------------------------------------------------- helpers for the page
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
    const side = preset.side || (IN_PRESETS.includes(preset) ? "in" : "out");   // own rows carry their side
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
    // An own point curve may dip before it moves, and "turned back" would then mean frame 1: it has arrived on the first
    // frame that is within 0.5 % of the target or past it. That frame and every later one is scaled (judged on the frames
    // themselves, so no frame past the target is ever left at full size between two scaled ones).
    const own = isPoints(b.curve);
    for (let j = 1; j <= len; j++) {
      let pj = p[j];
      if (hasFixed && j < len) {
        // arrival = the first frame at the target, or the first one that has already turned back (a bounce touches the
        // target between two frames and never shows exactly 1)
        if (own) arrived = arrived || pj >= 0.995;
        else if (!arrived && (pj >= 1 - 1e-9 || pj < p[j - 1] - 1e-12)) arrived = true;
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

// ---------------------------------------------------------------- adapters (measured by the Phase 0 probe, 2026-11-21)
// The only places that know anything about Premiere; everything above is unit-free. docs/probes/inout-phase0.md has the numbers.

/**
 * Frame f (counted from the clip's first sequence frame) -> the key's time: inPt * |speed| + f * |speed| / fps.
 * Measured (probe P7): the step |speed| / fps is right at 200 % and 50 %, and the base is inPt * |speed|, because Premiere
 * reports a sped clip's In point in timeline seconds (outPt - inPt always equals end - start) while keys sit at media
 * time. With inPt alone, every key of a trimmed 200 % clip landed before the visible media.
 * clip: {inPt (as readTimeline gives it), speed (1 = normal; negative = reversed, refused)} -> {step, at(f), error}
 */
function times(clip, fps) {
  const c = clip || {};
  const speed = Number.isFinite(c.speed) && c.speed !== 0 ? c.speed : 1;
  if (!Number.isFinite(fps) || fps <= 0) return { step: NaN, at: null, error: "the sequence frame rate is not known" };
  if (c.reversed || speed < 0) return { step: NaN, at: null, error: "the clip plays in reverse" };
  const inPt = Number.isFinite(c.inPt) ? c.inPt : 0;
  const step = Math.abs(speed) / fps;
  const base = inPt * Math.abs(speed);
  return { step, at: (f) => base + f * step };
}

// Transform units (AE.ADBE Geometry2), measured (probes P2-P4, P9), for premiere-inout.js: Position is a fraction of the
// layer and the effect acts after Motion around the clip's visible centre, so dx / dy (fractions of the frame) are divided by
// the clip's on-screen size as a fraction of the frame; Scale = s * 100; Rotation = r in degrees, clockwise positive;
// Opacity = o * 100. On a text graphic the Transform goes BEFORE the Graphic group and pivots on the frame's centre, so the
// Anchor Point has to move to the text for scale and rotation presets.

// ---------------------------------------------------------------- Transform values (the pure half of premiere-inout.js)
// Rows (frame fractions, multipliers, degrees) -> the values Premiere's Transform takes, one key list per parameter. Needs the
// clip's on-screen box (boxOf) but no Premiere, so it is tested with node.
const EXIT_FLOOR = 0.02;                       // a clip already (almost) off the picture still travels this far (frame fractions)
const POSITION_REST = 0.5;                     // Position = Anchor Point = the layer's centre (measured, probe P1)

/** the edge a side's position animation goes to / comes from: the preset's own (a drop), else the picked direction */
function edgeOf(side, presetId, direction) {
  const p = find(side, presetId);
  const pr = p && p.props.find((x) => x.prop === "pos");
  return (pr && pr.edge) || direction || "left";
}

/**
 * The clip's picture on the sequence frame under its Motion. geo: {seq: {w, h}, layer: {w, h}, fit}, m: Motion values as
 * blurplan.motion takes them. -> {cx, cy, hw, hh (centre and half sizes of the box that holds the picture, rotation
 * included, as fractions of the frame), wf, hf (the picture's own width and height as fractions of the frame, rotation left
 * out: the unit Transform's Position is measured in, probe P4), rot (Motion Rotation in radians, clockwise), ar (frame width /
 * height)}
 */
function boxOf(geo, m) {
  m = B.motion(m);
  const fit = geo.fit ? Math.min(geo.seq.w / geo.layer.w, geo.seq.h / geo.layer.h) : 1;
  const W = geo.layer.w * fit * (m.sw / 100);
  const H = geo.layer.h * fit * (m.sh / 100);
  const c = B.screen(geo.layer.w / 2, geo.layer.h / 2, m, geo);
  const r = (m.rot * Math.PI) / 180;
  const co = Math.abs(Math.cos(r));
  const si = Math.abs(Math.sin(r));
  return { cx: c[0] / geo.seq.w, cy: c[1] / geo.seq.h, hw: (co * W + si * H) / 2 / geo.seq.w, hh: (si * W + co * H) / 2 / geo.seq.h,
    wf: W / geo.seq.w, hf: H / geo.seq.h, rot: r, ar: geo.seq.w / geo.seq.h };
}

// A picture smaller than this fraction of the frame (Motion scale 2 % of a frame-size layer) is not animated by position: Position
// is the offset divided by that size, so a 0 gives Infinity and 0.001 gives keys 50000 away.
const MIN_SIZE = 0.02;

/** can this box carry a position animation? -> null (yes), "size" (not a finite box: a size that cannot be read) or "scale" (0 or too small) */
function boxUsable(box) {
  if (!box || ![box.cx, box.cy, box.hw, box.hh, box.wf, box.hf, box.rot === undefined ? 0 : box.rot, box.ar === undefined ? 1 : box.ar].every(Number.isFinite)) return "size";
  return box.wf >= MIN_SIZE && box.hf >= MIN_SIZE ? null : "scale";
}

/** how far (frame fractions) the box must move towards `edge` to be fully off the picture: the "1" of an exit animation */
function exitDistance(box, edge) {
  const d = edge === "left" ? box.cx + box.hw : edge === "right" ? 1 - box.cx + box.hw : edge === "top" ? box.cy + box.hh : 1 - box.cy + box.hh;
  return Math.max(d, EXIT_FLOOR);
}

/**
 * plan() -> Transform key lists. ctx: {at (frame -> key time, times().at), box: {in, out} (boxOf, only the sides that move
 * position need one), inPreset, outPreset, direction}.
 * -> {keys: {position: [{f, t, v: [x, y]}], scale (percent), rotation (degrees), opacity (0-100)} (each ascending by f, an
 *     empty list = the parameter is not animated), total (keys written), error}; `error` (and no keys) when a position side's box is
 * unusable (boxUsable) or any key would not be a finite number
 * Units, measured (docs/probes/inout-phase0.md): Position = 0.5 + offset / (the picture's size as a fraction of the frame),
 * the offset being dx / dy in frame fractions, or dx / dy x the exit distance when plan().exit says the side is in exit
 * distances; Scale = s x 100; Rotation = r (clockwise positive); Opacity = o x 100. Only Position gets pins (a pin whose time
 * is before media time 0 is left out); the row where In and Out meet is written once.
 */
function transformKeys(planned, ctx) {
  const keys = { position: [], scale: [], rotation: [], opacity: [] };
  const presetOf = { in: ctx.inPreset, out: ctx.outPreset };
  const failed = (error) => ({ keys: { position: [], scale: [], rotation: [], opacity: [] }, total: 0, error });
  for (const side of ["in", "out"]) {
    if (planned.props[side].includes("pos") && boxUsable(ctx.box && ctx.box[side])) return failed(`the picture's size on the frame cannot be used for the ${side} side (Motion scale 0 or too small, or not readable)`);
  }
  const pos = (side, row) => {
    const box = ctx.box[side];
    let ox = row.dx;
    let oy = row.dy;
    if (planned.exit[side]) {
      const d = exitDistance(box, edgeOf(side, presetOf[side], ctx.direction));
      ox *= d;
      oy *= d;
    }
    // Transform's Position is in the LAYER's own axes (they turn with Motion Rotation) and in fractions of the picture's own,
    // unrotated width and height (measured: Motion Scale 50, Rotation 30: Position x +0.25 moved the picture 0.25 x its width
    // along its turned x axis, y likewise). So the wanted screen offset (frame fractions) is turned by -rot into the clip's axes,
    // in frame-width units for x and frame-height units for y (the frame is not square), then divided by wf / hf. At rotation 0
    // cos = 1 and sin = 0 exactly, so this is the plain ox / wf, oy / hf.
    const co = Math.cos(box.rot || 0);
    const si = Math.sin(box.rot || 0);
    const ar = box.ar || 1;
    const ux = ox * co + oy * (1 / ar) * si;
    const uy = -ox * ar * si + oy * co;
    return [POSITION_REST + ux / box.wf, POSITION_REST + uy / box.hf];
  };
  for (const side of ["in", "out"]) {
    const has = (n) => planned.props[side].includes(n);
    for (const row of planned[side]) {
      const t = ctx.at(row.f);
      if (has("pos")) keys.position.push({ f: row.f, t, v: pos(side, row) });
      // plan() already keeps s in range; the clamp is the last guard before a value reaches Premiere (400 % breaks its blending)
      if (has("scale")) keys.scale.push({ f: row.f, t, v: Math.min(SCALE_MAX, Math.max(SCALE_MIN, row.s)) * 100 });
      if (has("rot")) keys.rotation.push({ f: row.f, t, v: row.r });
      if (has("op")) keys.opacity.push({ f: row.f, t, v: row.o * 100 });
    }
  }
  for (const pin of planned.pins) {
    if (!planned.props[pin.side].includes("pos")) continue;
    const t = ctx.at(pin.f);
    if (t < 0) continue;
    const row = planned[pin.side].find((r) => r.f === pin.like);
    if (row) keys.position.push({ f: pin.f, t, v: pos(pin.side, row) });
  }
  let total = 0;
  for (const name of Object.keys(keys)) {
    keys[name].sort((a, b) => a.f - b.f);
    keys[name] = keys[name].filter((k, i, a) => i === 0 || k.f !== a[i - 1].f);
    total += keys[name].length;
  }
  // nothing that is not a finite number is ever handed back
  for (const list of Object.values(keys)) for (const k of list) if (!Number.isFinite(k.t) || ![].concat(k.v).every(Number.isFinite)) return failed("a keyframe value or time is not a number");
  return { keys, total };
}

/** one press over several clips: the sum of every clip's plan().total against the per-press cap -> an error text or null */
function capCheck(totals) {
  const sum = totals.reduce((a, b) => a + b, 0);
  return sum > K.MAX_KEYS ? `that would add ${sum} keyframes in one press (more than ${K.MAX_KEYS}): select fewer clips or use shorter animations` : null;
}

module.exports = {
  boxOf, boxUsable, exitDistance, edgeOf, transformKeys, capCheck, EXIT_FLOOR, MIN_SIZE, POSITION_REST,
  IN_PRESETS, OUT_PRESETS, GROUPS, DIRECTIONS, TURNS, REST, PROP_NAMES,
  STRENGTH_DEFAULT, STRENGTH_MIN, STRENGTH_MAX, FRAMES_MIN, FRAMES_MAX, SCALE_MAX, SCALE_MIN, PIN,
  plan, times, find, groups, animates, needs, defaultFrames,
  DRAFT, PRESET_V, setCustom, setDraft, resolve, customOf, editable, curveFor,
};
