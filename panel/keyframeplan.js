// Keyframer (COCKPIT_PLAN.md A1, 0.10.32): the maths of shaping the motion between keyframes. Pure (no Premiere), tested
// with node. Premiere's UXP API sets a keyframe's interpolation (Bezier, Linear, Hold) but not its bezier handles (Phase 0,
// docs/probes/cockpit-phase0.md), so a custom curve is baked: one key per sequence frame between two of the editor's keys.

// Curves as CSS-style cubic beziers (x1, y1, x2, y2): x is time 0..1, y is progress (may leave 0..1: Overshoot).
const PRESETS = [
  { id: "easeInOut", name: "Ease In-Out", p: [0.42, 0, 0.58, 1] },
  { id: "easeIn", name: "Ease In", p: [0.42, 0, 1, 1] },
  { id: "easeOut", name: "Ease Out", p: [0, 0, 0.58, 1] },
  { id: "cubic", name: "Cubic", p: [0.65, 0, 0.35, 1] },
  { id: "expoOut", name: "Expo Out", p: [0.16, 1, 0.3, 1] },
  { id: "overshoot", name: "Overshoot", p: [0.34, 1.56, 0.64, 1] },
];
// Premiere's own interpolation, set on the editor's keys (no keys added, everything stays editable in Effect Controls)
const NATIVE = [
  { id: "linear", name: "Linear", mode: "LINEAR" },
  { id: "bezier", name: "Premiere ease", mode: "BEZIER" },
  { id: "hold", name: "Hold", mode: "HOLD" },
];
const MAX_KEYS = 3000;                 // per press: a longer bake is refused (a slip in the time base must not flood a clip)

function bez(a, b, t) {               // one coordinate of a cubic bezier from (0,0) to (1,1)
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
}

// progress at time x (0..1) on curve p: solve x(t) = x (x(t) is monotonic for x1, x2 in 0..1), then y(t)
function progress(p, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = p;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 60; i++) {
    const cx = bez(x1, x2, t);
    if (Math.abs(cx - x) < 1e-9) break;
    if (cx < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return bez(y1, y2, t);
}

function validCurve(p) {
  return Array.isArray(p) && p.length === 4 && p.every(Number.isFinite) && p[0] >= 0 && p[0] <= 1 && p[2] >= 0 && p[2] <= 1;
}

// a value between two keyframe values: numbers, or points [x, y] (Position, Anchor Point)
function lerp(a, b, f) {
  if (Array.isArray(a)) return a.map((v, i) => v + (b[i] - v) * f);
  return a + (b - a) * f;
}

/**
 * The keys to add for one property: between every two neighbouring keys of `keys` ([{t, v}], media seconds, sorted), one
 * key per sequence frame shaped by curve `p`. `step`: media seconds per sequence frame (1/fps for a clip at normal speed,
 * speed/fps when it is sped up). Ends are the editor's own keys and are not added again.
 * -> { add: [{t, v}], segments: [{from, to, frames}] }
 */
function bake(keys, p, step) {
  const add = [];
  const segments = [];
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    const frames = Math.round((b.t - a.t) / step);
    segments.push({ from: a.t, to: b.t, frames });
    for (let k = 1; k < frames; k++) {
      const t = a.t + k * step;
      if (t >= b.t - step / 2) break;
      add.push({ t, v: lerp(a.v, b.v, progress(p, (t - a.t) / (b.t - a.t))) });
    }
  }
  return { add, segments };
}

/**
 * The whole press. props: [{id, keys: [{t, v}], earlier?: {anchors: [t], added: [t]}}] (earlier = Asistent's last bake on that
 * property: its keys are taken out first and the editor's own keys are the anchors again, so a new curve replaces the old one).
 * curve: {p} for a custom curve or {mode} for Premiere's own interpolation. -> { props: [{id, remove, add, anchors, segments,
 * mode?}], total, error? }
 */
function plan(props, curve, step) {
  if (!(step > 0)) return { props: [], total: 0, error: "the sequence frame rate is not known" };
  if (!curve || (!curve.mode && !validCurve(curve.p))) return { props: [], total: 0, error: "choose a curve" };
  const out = [];
  let total = 0;
  for (const pr of props) {
    const near = (a, b) => Math.abs(a - b) < step / 4;
    const earlier = pr.earlier && pr.earlier.added.length && pr.earlier.added.every((t) => pr.keys.some((k) => near(k.t, t)))
      ? pr.earlier : null;
    const remove = earlier ? pr.keys.filter((k) => earlier.added.some((t) => near(k.t, t))).map((k) => k.t) : [];
    const anchors = pr.keys.filter((k) => !remove.some((t) => near(k.t, t)));
    if (anchors.length < 2) {
      out.push({ id: pr.id, skip: "fewer than two keyframes" });
      continue;
    }
    if (curve.mode) {
      out.push({ id: pr.id, remove, add: [], anchors, mode: curve.mode, segments: anchors.slice(1).map((b, i) => ({ from: anchors[i].t, to: b.t, frames: Math.round((b.t - anchors[i].t) / step) })) });
      continue;
    }
    const b = bake(anchors, curve.p, step);
    total += b.add.length;
    out.push({ id: pr.id, remove, add: b.add, anchors, segments: b.segments });
  }
  if (total > MAX_KEYS) return { props: out, total, error: `that would add ${total} keyframes (more than ${MAX_KEYS}): tick fewer properties or use shorter moves` };
  return { props: out, total };
}

// the curve as an SVG path in a box of `size` (y up), with room for overshoot
function curvePath(p, size, pad) {
  const span = size - 2 * pad;
  const X = (x) => pad + x * span;
  const Y = (y) => size - pad - y * span;
  return `M ${X(0)} ${Y(0)} C ${X(p[0])} ${Y(p[1])}, ${X(p[2])} ${Y(p[3])}, ${X(1)} ${Y(1)}`;
}

module.exports = { PRESETS, NATIVE, MAX_KEYS, progress, validCurve, lerp, bake, plan, curvePath };
