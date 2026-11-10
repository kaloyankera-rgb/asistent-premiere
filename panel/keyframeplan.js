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

// ---------------------------------------------------------------- elastic and bounce (0.10.33, the user's request)
// Our own motion functions, not a copy of any script: a damped spring (Elastic) and a ball dropped on the target (Bounce).
// Both go from 0 to 1 over the move. "end" puts the effect at the end of the move (a title that wobbles or bounces into
// place), "start" at its start (mirrored), "both" at both ends.

// Elastic: the move speeds up into the target, then wobbles around it exactly `n` times and settles; the first overshoot is
// `over` (0.2 = 20 % of the move), each later one smaller (the last about a fifth of the first). Designed rather than a pure
// spring: in a spring the overshoot and the number of visible wobbles are tied (3 wobbles at 10 % left two invisible).
// The speed is continuous where the arrival meets the wobble.
const ELASTIC = new Map();
function elasticShape(n, over) {
  const key = `${n}|${over}`;
  if (ELASTIC.has(key)) return ELASTIC.get(key);
  const mu = n > 1 ? (Math.log(5) * n) / (n - 1) : 1;
  const wob = (u) => Math.exp(-mu * u) * (1 - u) * Math.sin(2 * Math.PI * n * u);
  let first = 0;                                                  // the first lobe's peak, to scale it to `over`
  for (let i = 1; i <= 400; i++) first = Math.max(first, wob(i / (800 * n)));
  const S = over / first;
  // arrival t^K (starts from rest) ending with the wobble's speed: K = xa * v, with v = S 2 pi n / (1 - xa); K = 2.5
  const c = 2.5 / (S * 2 * Math.PI * n);
  const xa = c <= 0.25 ? (1 - Math.sqrt(1 - 4 * c)) / 2 : 0.5;
  const K = Math.max(1.5, (xa * S * 2 * Math.PI * n) / (1 - xa));
  const shape = { S, mu, xa, K, wob };
  ELASTIC.set(key, shape);
  return shape;
}

function elasticOut(x, n, over) {
  const e = elasticShape(n, over);
  if (x <= e.xa) return Math.pow(x / e.xa, e.K);
  return 1 + e.S * e.wob((x - e.xa) / (1 - e.xa));
}

// Bounce: falls onto the target, then `n` hops, each `h` (0.5 = half) as high as the one before; never past the target.
function bounceOut(x, n, h) {
  const e = Math.sqrt(Math.min(0.9, Math.max(0.05, h)));      // a hop's duration scales with the root of its height
  let total = 1;
  for (let k = 1; k <= n; k++) total += 2 * Math.pow(e, k);
  const t0 = 1 / total;                                         // the first fall
  if (x <= t0) return (x / t0) * (x / t0);
  let start = t0;
  for (let k = 1; k <= n; k++) {
    const width = 2 * t0 * Math.pow(e, k);
    if (x <= start + width || k === n) {
      const u = Math.min(1, (x - start) / width) * 2 - 1;      // -1 .. 1 across the hop
      return 1 - Math.pow(e, 2 * k) * (1 - u * u);
    }
    start += width;
  }
  return 1;
}

function shaped(out, dir, x) {
  if (dir === "start") return 1 - out(1 - x);
  if (dir === "both") return x < 0.5 ? (1 - out(1 - 2 * x)) / 2 : 0.5 + out(2 * x - 1) / 2;
  return out(x);
}

/** progress (0..1, may overshoot) at time x of any curve: {kind: "bezier", p} | {kind: "elastic", dir, n, over} |
 * {kind: "bounce", dir, n, h}; a plain [x1, y1, x2, y2] is a bezier */
function ease(curve, x) {
  if (Array.isArray(curve)) return progress(curve, x);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (curve.kind === "elastic") return shaped((t) => elasticOut(t, curve.n, curve.over), curve.dir, x);
  if (curve.kind === "bounce") return shaped((t) => bounceOut(t, curve.n, curve.h), curve.dir, x);
  return progress(curve.p, x);
}

function curveOk(c) {
  if (Array.isArray(c)) return validCurve(c);
  if (!c) return false;
  if (c.kind === "elastic") return Number.isInteger(c.n) && c.n >= 1 && c.n <= 8 && c.over > 0 && c.over < 1;
  if (c.kind === "bounce") return Number.isInteger(c.n) && c.n >= 1 && c.n <= 8 && c.h > 0 && c.h < 1;
  return validCurve(c.p);
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
      add.push({ t, v: lerp(a.v, b.v, ease(p, (t - a.t) / (b.t - a.t))) });
    }
  }
  return { add, segments };
}

// the shaped animation at media time t (between the first and the last anchor)
function valueAt(anchors, curve, t) {
  if (t <= anchors[0].t) return anchors[0].v;
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (t <= b.t) return lerp(a.v, b.v, ease(curve, (t - a.t) / (b.t - a.t)));
  }
  return anchors[anchors.length - 1].v;
}

/**
 * Keys after the last anchor that repeat the whole shaped animation: "pingpong" plays it backwards, then forwards, and so on;
 * "loop" jumps back to the start (one frame) and plays it again. `times` repeats, or as many whole ones as fit before
 * `until` (the clip's out point, media seconds) when times is 0. One key per frame plus each repeat's end.
 */
function repeatKeys(anchors, curve, step, repeat, until) {
  const first = anchors[0].t;
  const last = anchors[anchors.length - 1].t;
  const span = last - first;
  if (!repeat || !repeat.mode || repeat.mode === "off" || span < 2 * step) return [];
  let times = repeat.times || 0;
  if (!times) times = Number.isFinite(until) ? Math.floor((until - last + step / 2) / span) : 0;
  const out = [];
  for (let k = 1; k <= times; k++) {
    const from = last + (k - 1) * span;
    const back = repeat.mode === "pingpong" && k % 2 === 1;
    const frames = Math.round(span / step);
    for (let f = 1; f <= frames; f++) {
      const local = f === frames ? span : f * step;
      const src = back ? last - local : first + local;
      if (repeat.mode === "loop" && f === 1) out.push({ t: from + step, v: valueAt(anchors, curve, first) });
      else out.push({ t: from + local, v: valueAt(anchors, curve, src) });
    }
  }
  return out;
}

/**
 * The whole press. props: [{id, keys: [{t, v}], earlier?: {anchors: [t], added: [t]}}] (earlier = Asistent's last bake on that
 * property: its keys are taken out first and the editor's own keys are the anchors again, so a new curve replaces the old one).
 * curve: {p} for a custom curve or {mode} for Premiere's own interpolation. -> { props: [{id, remove, add, anchors, segments,
 * mode?}], total, error? }
 */
function plan(props, curve, step, opts = {}) {
  if (!(step > 0)) return { props: [], total: 0, error: "the sequence frame rate is not known" };
  if (!curve || (!curve.mode && !curveOk(curve.kind ? curve : curve.p))) return { props: [], total: 0, error: "choose a curve" };
  const repeat = opts.repeat && opts.repeat.mode && opts.repeat.mode !== "off" ? opts.repeat : null;
  if (repeat && curve.mode) return { props: [], total: 0, error: "Ping-pong and Loop work with the curves, not with Premiere's own interpolation" };
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
    const shape = curve.kind ? curve : curve.p;
    const b = bake(anchors, shape, step);
    // repeats never run over a key of the editor's after the last anchor (there is none by definition) nor past the clip
    const more = repeat ? repeatKeys(anchors, shape, step, repeat, opts.until).filter((k) => !Number.isFinite(opts.until) || k.t <= opts.until + step / 2) : [];
    total += b.add.length + more.length;
    out.push({ id: pr.id, remove, add: [...b.add, ...more], anchors, segments: b.segments, repeated: more.length });
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

// any curve as a polyline (elastic and bounce are not beziers)
function samplePath(curve, size, pad, n = 120) {
  const span = size - 2 * pad;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    pts.push(`${(pad + x * span).toFixed(1)} ${(size - pad - ease(curve, x) * span).toFixed(1)}`);
  }
  return `M ${pts.join(" L ")}`;
}

module.exports = { PRESETS, NATIVE, MAX_KEYS, progress, ease, curveOk, validCurve, lerp, bake, plan, valueAt, repeatKeys, curvePath, samplePath };
