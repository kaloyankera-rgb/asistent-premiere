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
  if (curve.kind === "points") return pointsAt(curve.pts, x);
  if (curve.kind === "elastic") return shaped((t) => elasticOut(t, curve.n, curve.over), curve.dir, x);
  if (curve.kind === "bounce") return shaped((t) => bounceOut(t, curve.n, curve.h), curve.dir, x);
  return progress(curve.p, x);
}

// ---------------------------------------------------------------- after the keyframe (0.10.45, the user's reference)
// The user's reference (references/Screen Recording 2026-11-11 at 10.36.45.mov): After Effects with the BOUNCr plugin on a
// title's Scale, keys 0 -> 100 a few frames apart, linear. Unlike Elastic and Bounce above, nothing happens between the keys:
// the move arrives at full speed and the motion carries on AFTER the key, driven by that speed. Measured frame by frame on
// the recording (text width):
// - Overshoot+ (Amplitude 50, Frequency 2, Decay 4): 100 -> 135 % -> 83 % -> 104 % -> settled after about 1 s; peaks
//   0.25-0.28 s apart, so a 2 Hz sine fading as e^(-4 t): value + v * (amplitude / 1000) * sin(2 pi f t) / e^(decay t),
//   v = the speed the move arrives with (units per second). The amplitude / 1000 fits the measured first peak (0.047).
// - Bounce Back (Elasticity 50, Gravity 50, Max Bounces 10): 100 -> back to 56 % -> 100 -> 88 % -> 100, never past the
//   target: a ball thrown back at elasticity x the arriving speed, falling to the target under gravity, each bounce e times
//   as fast. Gravity is taken per unit of the move (so Scale and Position behave alike): 50 -> 33.5 moves / s^2 measured
//   (first bounce 0.367 s, 0.56 of the move deep).
const AFTER_KINDS = new Set(["overshoot", "bounceBack"]);
const GRAVITY_PER_UNIT = 33.5 / 50;
const AFTER_MAX = 3;                     // s: the longest tail after a key
const AFTER_SMALL = 0.002;               // of the move: smaller than this is still (a fifth of a pixel on a 100 px move)

function norm(d) {
  return Array.isArray(d) ? Math.hypot(...d) : Math.abs(d);
}

// the offset `t` seconds after a key that the move arrived at with speed `v` (units / s, a number or [x, y]); size = |move|
function afterOffset(curve, v, size, t) {
  if (!(t > 0) || !(size > 0)) return Array.isArray(v) ? v.map(() => 0) : 0;
  if (curve.kind === "overshoot") {
    const k = (curve.amp / 1000) * Math.sin(2 * Math.PI * curve.freq * t) * Math.exp(-curve.decay * t);
    return Array.isArray(v) ? v.map((x) => x * k) : v * k;
  }
  // bounce back: thrown back along -v at e*|v|, gravity g pulls it to the target; each landing loses a factor e
  const e = curve.elast / 100;
  const g = GRAVITY_PER_UNIT * curve.grav * size;
  let speed = e * norm(v);
  if (!(speed > 0) || !(g > 0)) return Array.isArray(v) ? v.map(() => 0) : 0;
  let start = 0;
  let dur = (2 * speed) / g;
  for (let n = 1; n <= curve.max; n++) {
    if (t < start + dur) {
      const d = t - start;
      const h = d * (speed - (g * d) / 2);                     // height above the target, along -v
      const unit = Array.isArray(v) ? v.map((x) => -x / norm(v)) : -Math.sign(v);
      return Array.isArray(v) ? unit.map((u) => u * h) : unit * h;
    }
    start += dur;
    speed *= e;
    dur *= e;
  }
  return Array.isArray(v) ? v.map(() => 0) : 0;
}

// how long the tail lasts before it is still (never more than AFTER_MAX)
function afterLength(curve, v, size) {
  const speed = norm(v);
  if (!(speed > 0) || !(size > 0)) return 0;
  if (curve.kind === "overshoot") {
    const t = Math.log(Math.max(1, (speed * curve.amp / 1000) / (AFTER_SMALL * size))) / curve.decay;
    return Math.min(AFTER_MAX, t);
  }
  const e = curve.elast / 100;
  const g = GRAVITY_PER_UNIT * curve.grav * size;
  let s = e * speed;
  let total = 0;
  for (let n = 1; n <= curve.max && (s * s) / (2 * g) > AFTER_SMALL * size; n++) {
    total += (2 * s) / g;
    s *= e;
  }
  return Math.min(AFTER_MAX, total);
}

/**
 * The animation with the motion after each key: linear between the editor's keys (as in the reference), plus the tail of
 * the last key passed, driven by the speed it was reached with. The first key has none (nothing moved before it).
 */
function afterValueAt(anchors, curve, t) {
  let i = 0;
  while (i + 1 < anchors.length && anchors[i + 1].t <= t) i++;
  const a = anchors[i];
  const b = anchors[i + 1];
  const base = b ? lerp(a.v, b.v, (t - a.t) / (b.t - a.t)) : a.v;
  if (i === 0) return base;
  const p = anchors[i - 1];
  const dt = a.t - p.t;
  const delta = Array.isArray(a.v) ? a.v.map((x, k) => x - p.v[k]) : a.v - p.v;
  const v = Array.isArray(delta) ? delta.map((x) => x / dt) : delta / dt;
  const off = afterOffset(curve, v, norm(delta), t - a.t);
  return Array.isArray(base) ? base.map((x, k) => x + off[k]) : base + off;
}

/** Keys, one per frame, from the first anchor until the last tail is still (or `until`). Anchors are the editor's own. */
function afterKeys(anchors, curve, step, until) {
  const last = anchors[anchors.length - 1];
  const prev = anchors[anchors.length - 2];
  const delta = Array.isArray(last.v) ? last.v.map((x, k) => x - prev.v[k]) : last.v - prev.v;
  const dt = last.t - prev.t;
  const v = Array.isArray(delta) ? delta.map((x) => x / dt) : delta / dt;
  let end = last.t + afterLength(curve, v, norm(delta));
  if (Number.isFinite(until)) end = Math.min(end, until);
  const add = [];
  const near = (t) => anchors.some((a) => Math.abs(a.t - t) < step / 2);
  for (let t = anchors[0].t + step; t < end + step / 2; t += step) {
    if (near(t)) continue;
    add.push({ t, v: afterValueAt(anchors, curve, t) });
  }
  // the tail ends on its rest value, so nothing jumps after the last baked frame
  if (add.length && add[add.length - 1].t > last.t) add.push({ t: add[add.length - 1].t + step, v: last.v });
  return add;
}

// ---------------------------------------------------------------- custom curves from points (0.10.68)
// The user (2026-11-12): "we need to be able to move and make custom motion curves not only see them as a preview from the
// presets". A curve through points the editor places and drags: from (0, 0) to (1, 1) through 1..MAX_POINTS (16) points
// [x, y] (x = time, strictly forward; y = progress, may overshoot to -0.5 .. 1.5), smooth (cubic Hermite, Catmull-Rom
// slopes, flat-free one-sided slopes at the ends). It is a function of time, so a frame's value needs no solving.
const MAX_POINTS = 16;
const MIN_GAP = 0.01;

function pointsOk(pts) {
  if (!Array.isArray(pts) || pts.length < 1 || pts.length > MAX_POINTS) return false;
  let last = 0;
  for (const q of pts) {
    if (!Array.isArray(q) || (q.length !== 2 && q.length !== 3) || !q.slice(0, 2).every(Number.isFinite)) return false;
    if (q.length === 3 && q[2] !== 1 && q[2] !== 0) return false;
    if (q[0] < last + MIN_GAP || q[0] > 1 - MIN_GAP || q[1] < -0.5 || q[1] > 1.5) return false;
    last = q[0];
  }
  return true;
}

function pointsAt(pts, x) {
  const k = [[0, 0], ...pts, [1, 1]];
  let i = 0;
  while (i < k.length - 2 && x > k[i + 1][0]) i++;
  // a point's slope: smooth (Catmull-Rom), or at a corner ([x, y, 1]: a bounce's hit) the slope of the side being drawn
  const slope = (j, side) => {
    const corner = k[j].length === 3 && k[j][2] === 1;
    const a = k[Math.max(0, corner && side > 0 ? j : j - 1)];
    const b = k[Math.min(k.length - 1, corner && side < 0 ? j : j + 1)];
    return (b[1] - a[1]) / (b[0] - a[0]);
  };
  const [x0, y0] = k[i];
  const [x1, y1] = k[i + 1];
  const h = x1 - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * slope(i, 1) + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * slope(i + 1, -1);
}

/** Any between-keys curve as points to drag ("Edit as points"): the fewest points (at most `most`: few enough to drag;
 * the editor may add up to MAX_POINTS) whose curve stays within `tol` of the original at 200 samples, corners first. */
function toPoints(curve, tol = 0.02, most = null) {
  const n = 200;
  const xs = Array.from({ length: n + 1 }, (_, i) => i / n);
  const ys = xs.map((x) => ease(curve, x));
  const keep = new Set([0, n]);
  // a corner where the direction jumps (a bounce hitting the target): the slopes on its two sides differ a lot
  const d = (i) => (ys[i + 1] - ys[i]) * n;
  // (a smooth peak, as Elastic's, is nearly flat on both sides; a hit is steep on both)
  const corner = (i) => i > 1 && i < n - 1 && Math.sign(d(i)) !== Math.sign(d(i - 1)) && Math.min(Math.abs(d(i)), Math.abs(d(i - 1))) > 0.3;
  const corners = [];
  for (let i = 2; i < n - 1; i++) if (corner(i)) corners.push(i);
  // few enough to drag: 10, more for a curve with many hits (two points per hop keep its shape)
  most = most || Math.min(MAX_POINTS, Math.max(10, 2 * corners.length + 4));
  for (const i of corners.slice(0, most)) keep.add(i);                                       // every corner first
  const worst = () => {
    const pts = [...keep].sort((a, b) => a - b).filter((i) => i !== 0 && i !== n).map((i) => (corner(i) ? [xs[i], ys[i], 1] : [xs[i], ys[i]]));
    let at = -1;
    let err = 0;
    for (let i = 1; i < n; i++) {
      const e = Math.abs((pts.length ? pointsAt(pts, xs[i]) : xs[i]) - ys[i]);
      if (e > err) {
        err = e;
        at = i;
      }
    }
    return { at, err, pts };
  };
  let w = worst();
  while (w.err > tol && keep.size - 2 < most && w.at > 0) {
    keep.add(w.at);
    w = worst();
  }
  const pts = w.pts.length ? w.pts : [[0.5, ease(curve, 0.5)]];
  const out = [];
  for (const q of pts.map((r) => [Math.round(r[0] * 1000) / 1000, Math.round(Math.max(-0.5, Math.min(1.5, r[1])) * 1000) / 1000, ...(r[2] ? [1] : [])])) {
    const prev = out[out.length - 1];
    if (prev && q[0] < prev[0] + MIN_GAP) {                // two points too close: a corner wins (a bounce's hit stays sharp)
      if (q[2] && !prev[2]) out[out.length - 1] = q;
      continue;
    }
    out.push(q);
  }
  return out;
}

function curveOk(c) {
  if (Array.isArray(c)) return validCurve(c);
  if (!c) return false;
  if (c.kind === "points") return pointsOk(c.pts);
  if (c.kind === "overshoot") return c.amp > 0 && c.amp <= 500 && c.freq > 0 && c.freq <= 20 && c.decay > 0 && c.decay <= 50;
  if (c.kind === "bounceBack") return c.elast > 0 && c.elast < 100 && c.grav > 0 && c.grav <= 500 && Number.isInteger(c.max) && c.max >= 1 && c.max <= 30;
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
  if (repeat && AFTER_KINDS.has(curve.kind)) return { props: [], total: 0, error: "Overshoot+ and Bounce Back already move after the last keyframe: switch Repeat off" };
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
    if (AFTER_KINDS.has(curve.kind)) {
      // linear between the keys, the motion after each key (keys go past the last anchor, up to the clip's end)
      const add = afterKeys(anchors, curve, step, opts.until).filter((k) => !Number.isFinite(opts.until) || k.t <= opts.until + step / 2);
      total += add.length;
      out.push({ id: pr.id, remove, add, anchors, segments: anchors.slice(1).map((b, i) => ({ from: anchors[i].t, to: b.t, frames: Math.round((b.t - anchors[i].t) / step) })) });
      continue;
    }
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

// any curve as a polyline (elastic and bounce are not beziers). Overshoot+ / Bounce Back: a 0 -> 1 move in PREVIEW_MOVE s,
// as in the reference, then its motion, over PREVIEW_SPAN s
const PREVIEW_MOVE = 0.08;
const PREVIEW_SPAN = 1.2;
function samplePath(curve, size, pad, n = 120) {
  const span = size - 2 * pad;
  const pts = [];
  const after = curve && AFTER_KINDS.has(curve.kind);
  const anchors = [{ t: 0, v: 0 }, { t: PREVIEW_MOVE, v: 1 }];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    const y = after ? afterValueAt(anchors, curve, x * PREVIEW_SPAN) : ease(curve, x);
    // the box shows 0..1 with room above; the after kinds are drawn at 2/3 height so a 35 % overshoot fits
    const shown = after ? y * 0.66 : y;
    pts.push(`${(pad + x * span).toFixed(1)} ${(size - pad - shown * span).toFixed(1)}`);
  }
  return `M ${pts.join(" L ")}`;
}

module.exports = { MAX_POINTS, pointsOk, pointsAt, toPoints, afterOffset, afterValueAt, afterKeys, afterLength, AFTER_KINDS, PRESETS, NATIVE, MAX_KEYS, progress, ease, curveOk, validCurve, lerp, bake, plan, valueAt, repeatKeys, curvePath, samplePath };
