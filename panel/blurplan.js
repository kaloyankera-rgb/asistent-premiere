// Keyframer motion blur (0.10.78, the user's reminder of 2026-11-15: "a motion blur on/off key" and an amount). Pure (no
// Premiere), tested with node; the panel's preview draws from the same functions.
//
// Premiere's Motion has no motion blur. Its Transform effect does: with "Use Composition's Shutter Angle" off it renders
// each frame as the average of its own positions over the shutter window, which starts at the frame and runs forward
// (measured in NEW TEST 2026-11-15: a 43.2 px/frame move gives a straight 21.6 px smear ahead of the frame at 180 degrees,
// 43 px at 360, the frame itself sharp). And it honours keys between frames (a key half a frame in gave its smear, the next
// frame stayed sharp). So the blur is carried by an Asistent Transform at the end of the clip's effects that is at rest
// (no change) at every frame and, inside each frame's shutter window, moves the picture exactly as Motion will move it
// between that frame and the moment u:
//   Rel(u) = Motion(t_k)^-1 · Motion(u)
// The editor's Motion keys are not touched; the picture at every frame is what it was; the smear is Premiere's own, so it
// follows the speed of every frame (fast frames long, slow frames short, still frames none) and the amount sets the
// shutter window. Position, Scale and Rotation of Motion all blur correctly (a Directional Blur could only blur a straight move).
//
// Geometry (as coverage.js and trackplan.js): a layer point p (pixels of the clip's picture) lands at
//   S(p) = Position + R(rotation) · diag(sw, sh) / 100 · fit · (p − Anchor)
// Position in fractions of the sequence frame, Anchor in fractions of the layer. Transform's Position and Anchor Point are
// fractions of the layer too (the Anchor page's measured rule).

const OPEN_MAX = 0.96;          // of a frame: the window's last key must come before the next frame's key at rest
const INNER = 2;                // keys inside each window: the motion there is drawn as two straight pieces...
const INNER_MAX = 8;            // ...or more where it curves (an overshoot's peak inside one frame)
const CHECKS = 16;              // moments in a window where the straight pieces are compared with the real motion
const BEND_PX = 0.5;            // how far (sequence pixels) the straight pieces may stray from it
const STILL_PX = 0.25;          // a frame whose picture moves less than this (sequence pixels) in the window gets no keys
// Premiere draws Position's path between keys as its own curve (auto Bezier; not settable through the API), so a jump back
// to rest after a window bends the window's ends (measured: a 100 % window came out 8 % short). A second key a hundredth of
// a frame outside each end of the window keeps the path straight inside it.
const PIN = 0.01;               // of a frame
// Premiere renders every frame of a Transform as a plain blend from the window's start to its end (no longer following the
// motion inside it) as soon as any of its Scale keys goes past about 4x (measured in NEW TEST 2026-11-15: 400 % rendered
// right, 460 % and more broke all the other frames; any Position jump and scales down to 5 % were fine). So a frame whose
// picture would grow more than that within its shutter time (the first frame of a pop from nothing) is left sharp.
const SCALE_MAX = 400;          // %
const ZERO_SCALE = 0.5;         // % : a frame at about scale 0 shows nothing, so it cannot carry a blur
const DEFAULT_AMOUNT = 50;      // % = a film camera's 180 degree shutter

const rad = (d) => (d * Math.PI) / 180;

/** amount 0..100 (%) -> the shutter window as a fraction of a frame (100 % = the whole frame, kept just short of it) */
function shutter(amount) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return 0;
  return Math.min(OPEN_MAX, a / 100);
}

/** Motion values with Premiere's defaults filled in: {x, y, ax, ay, sw, sh, rot} */
function motion(m = {}) {
  const sh = m.sh === undefined ? 100 : m.sh;
  return { x: m.x === undefined ? 0.5 : m.x, y: m.y === undefined ? 0.5 : m.y, ax: m.ax === undefined ? 0.5 : m.ax,
    ay: m.ay === undefined ? 0.5 : m.ay, sw: m.sw === undefined ? sh : m.sw, sh, rot: m.rot || 0 };
}

/** geo: {seq: {w, h}, layer: {w, h}, fit} -> the factor Scale to Frame Size puts on the layer (1 when off) */
function fitOf(geo) {
  if (!geo.fit) return 1;
  return Math.min(geo.seq.w / geo.layer.w, geo.seq.h / geo.layer.h);
}

/** where layer point (px, py) lands in the sequence (pixels) under Motion m */
function screen(px, py, m, geo) {
  const f = fitOf(geo);
  const qx = (px - m.ax * geo.layer.w) * (m.sw / 100) * f;
  const qy = (py - m.ay * geo.layer.h) * (m.sh / 100) * f;
  const r = rad(m.rot);
  return [m.x * geo.seq.w + Math.cos(r) * qx - Math.sin(r) * qy, m.y * geo.seq.h + Math.sin(r) * qx + Math.cos(r) * qy];
}

/** how far the picture moves between Motion a and b: the largest move of its four corners, sequence pixels */
function moved(a, b, geo) {
  let most = 0;
  for (const [px, py] of [[0, 0], [geo.layer.w, 0], [0, geo.layer.h], [geo.layer.w, geo.layer.h]]) {
    const p = screen(px, py, a, geo);
    const q = screen(px, py, b, geo);
    most = Math.max(most, Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  return most;
}

/** the Transform at rest under Motion m: no change to the picture */
function rest(m) {
  return { ax: m.ax, ay: m.ay, x: m.ax, y: m.ay, sw: 100, sh: 100, rot: 0 };
}

/**
 * The Transform that turns the picture Motion mk shows into the one Motion mu shows: Rel = Motion(mk)^-1 · Motion(mu).
 * Exact for any move, uniform scale and rotation; with a non-uniform scale that also turns, the small shear is left out.
 */
function rel(mk, mu, geo) {
  const f = fitOf(geo);
  const sxk = (mk.sw / 100) * f;
  const syk = (mk.sh / 100) * f;
  const dx = (mu.x - mk.x) * geo.seq.w;
  const dy = (mu.y - mk.y) * geo.seq.h;
  const r = rad(-mk.rot);
  const ox = (Math.cos(r) * dx - Math.sin(r) * dy) / sxk;          // the move, back in layer pixels
  const oy = (Math.sin(r) * dx + Math.cos(r) * dy) / syk;
  return { ax: mu.ax, ay: mu.ay, x: mk.ax + ox / geo.layer.w, y: mk.ay + oy / geo.layer.h,
    sw: (100 * mu.sw) / mk.sw, sh: (100 * mu.sh) / mk.sh, rot: mu.rot - mk.rot };
}

// a layer point through Transform T, then Motion m (sequence pixels)
function through(px, py, T, m, geo) {
  const ax = T.ax * geo.layer.w;
  const ay = T.ay * geo.layer.h;
  const qx = (px - ax) * T.sw / 100;
  const qy = (py - ay) * T.sh / 100;
  const r = rad(T.rot);
  return screen(T.x * geo.layer.w + Math.cos(r) * qx - Math.sin(r) * qy, T.y * geo.layer.h + Math.sin(r) * qx + Math.cos(r) * qy, m, geo);
}

// how far straight pieces between `keys` (Transform values, Premiere interpolates each one straight) stray from the real
// motion `fine` at its moments: the largest miss of the picture's four corners
function bend(keys, fine, mk, geo) {
  let worst = 0;
  const corners = [[0, 0], [geo.layer.w, 0], [0, geo.layer.h], [geo.layer.w, geo.layer.h]];
  for (const f of fine) {
    let i = 0;
    while (i + 2 < keys.length && keys[i + 1].t < f.t - 1e-12) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const w = b.t > a.t ? Math.min(1, Math.max(0, (f.t - a.t) / (b.t - a.t))) : 1;
    const T = {};
    for (const k of Object.keys(f.v)) T[k] = a.v[k] + (b.v[k] - a.v[k]) * w;
    for (const [px, py] of corners) {
      const p = through(px, py, T, mk, geo);
      const q = through(px, py, f.v, mk, geo);
      worst = Math.max(worst, Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
  }
  return worst;
}

/**
 * The blur Transform's keys. frames: media times to look at (one sequence frame apart); stateAt(t) -> Motion values at media
 * time t (the shaped animation between frames too); step: media seconds per sequence frame; open: shutter() of the amount.
 * -> { angle, moving, tooFast (frames left sharp: they grow past SCALE_MAX in the window), keys: {anchor, position, scale, scaleWidth, rotation} ([{t, v}] or null when it stays at rest),
 *      still: {anchor, position} (values when not keyed), uniform, total }
 * Per moving frame: keys at rest on the frame (and just before it), INNER keys inside its window (the last one again just
 * after it), and keys at rest on the next frame (and just before it).
 */
function blurKeys(frames, stateAt, step, open, geo, inner = INNER) {
  const out = { angle: 360 * open, moving: 0, tooFast: 0, keys: { anchor: null, position: null, scale: null, scaleWidth: null, rotation: null },
    still: null, uniform: true, total: 0 };
  if (!(open > 0) || !frames.length) return out;
  const rows = [];                                     // [{t, v: transform}] in time order
  const last = () => rows[rows.length - 1];
  const put = (t, v) => {
    if (last() && t < last().t + step * 1e-4) return;  // already there (the closing keys of the frame before)
    rows.push({ t, v });
  };
  const pin = PIN * step;
  let first = null;
  for (const t of frames) {
    const mk = motion(stateAt(t));
    if (!first) first = mk;
    if (Math.abs(mk.sw) < ZERO_SCALE || Math.abs(mk.sh) < ZERO_SCALE) continue;
    // the real motion in the window, finely; then the fewest straight pieces (Premiere joins the keys straight) that follow it
    const fine = [];
    let most = 0;
    for (let j = 0; j <= CHECKS; j++) {
      const u = t + (open * step * j) / CHECKS;
      const mu = motion(stateAt(u));
      most = Math.max(most, moved(mk, mu, geo));
      fine.push({ t: u, v: rel(mk, mu, geo) });
    }
    if (most < STILL_PX) continue;
    if (fine.some((r) => r.v.sw > SCALE_MAX || r.v.sh > SCALE_MAX)) {
      out.tooFast++;
      continue;
    }
    let inside = null;
    for (let n = inner; n <= INNER_MAX && !inside; n *= 2) {
      const keys = [{ t, v: rest(mk) }];
      for (let j = 1; j <= n; j++) keys.push(fine[(j * CHECKS) / n]);
      if (n >= INNER_MAX || bend(keys, fine, mk, geo) <= BEND_PX) inside = keys.slice(1);
    }
    out.moving++;
    put(t - pin, rest(mk));
    put(t, rest(mk));
    for (const r of inside) rows.push(r);
    rows.push({ t: inside[inside.length - 1].t + pin, v: inside[inside.length - 1].v });
    const next = rest(motion(stateAt(t + step)));
    rows.push({ t: t + step - pin, v: next });
    rows.push({ t: t + step, v: next });
  }
  out.still = rest(first || motion());
  if (!rows.length) return out;
  const same = (a, b) => Math.abs(a - b) < 1e-7;
  const varies = (get) => rows.some((r) => !same(get(r.v), get(rows[0].v)));
  const track = (get) => rows.map((r) => ({ t: r.t, v: get(r.v) }));
  if (varies((v) => v.ax) || varies((v) => v.ay)) out.keys.anchor = track((v) => [v.ax, v.ay]);
  out.keys.position = track((v) => [v.x, v.y]);
  out.uniform = rows.every((r) => Math.abs(r.v.sw - r.v.sh) < 1e-6);
  if (varies((v) => v.sh) || varies((v) => v.sw)) {
    out.keys.scale = track((v) => v.sh);
    if (!out.uniform) out.keys.scaleWidth = track((v) => v.sw);
  }
  if (varies((v) => v.rot)) out.keys.rotation = track((v) => v.rot);
  out.total = Object.values(out.keys).reduce((n, k) => n + (k ? k.length : 0), 0);
  return out;
}

/**
 * For the preview: the moments a frame's picture is averaged over, n of them, as Premiere's Transform places them: from just
 * after the frame to the end of the window (measured: the smear starts a sample after the frame's own place, reaches the
 * window's end, and its centre lies 8 % past the middle). open 0 -> just the frame.
 */
function samples(t, step, open, n = 8) {
  if (!(open > 0)) return [t];
  return Array.from({ length: n }, (_, i) => t + (open * step * (i + 1)) / n);
}

module.exports = { SCALE_MAX, OPEN_MAX, PIN, INNER, INNER_MAX, bend, through, STILL_PX, DEFAULT_AMOUNT, shutter, motion, screen, moved, rest, rel, blurKeys, samples };
