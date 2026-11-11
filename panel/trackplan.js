// Motion tracker (COCKPIT_PLAN.md A3, 0.10.51): the maths between the engine's track and Premiere's keys. Pure (no Premiere),
// tested with node.
//
// The engine tracks a point in the FILE (pixels of the upright picture) with its scale and angle against the boxed frame. On
// the timeline that point lands where the source clip's Motion puts it (coverage.js uses the same geometry):
//   S = Position + R(rotation) · scale · fit · (p − Anchor)          (sequence pixels; Position fractions of the frame,
//                                                                     Anchor fractions of the file, fit = Scale to Frame Size)
// "Attach" makes another clip (a text, a logo) keep its offset from that point, as After Effects applies a track to a layer:
//   P(t) = S(t) + R(Δangle) · ratio · (P0 − S0)       Δangle and ratio only when Rotation / Scale are asked for
// so the editor first puts the text where it belongs on the boxed frame, then attaches it. Lost frames get no key (Premiere
// moves straight between the keys around them).

const rad = (d) => (d * Math.PI) / 180;

/** Motion values with Premiere's defaults filled in. */
function motion(m = {}) {
  return {
    x: m.x === undefined ? 0.5 : m.x, y: m.y === undefined ? 0.5 : m.y,
    ax: m.ax === undefined ? 0.5 : m.ax, ay: m.ay === undefined ? 0.5 : m.ay,
    sw: m.sw === undefined ? 100 : m.sw, sh: m.sh === undefined ? (m.sw === undefined ? 100 : m.sw) : m.sh,
    rot: m.rot || 0, fit: !!m.fit,
  };
}

/** Where file point (px, py) of a clip with Motion m lands in the sequence frame, in sequence pixels. */
function screenPoint(px, py, file, m0, frame) {
  const m = motion(m0);
  const fit = m.fit ? Math.min(frame.width / file.width, frame.height / file.height) : 1;
  const qx = (px - m.ax * file.width) * (m.sw / 100) * fit;
  const qy = (py - m.ay * file.height) * (m.sh / 100) * fit;
  const r = rad(m.rot);
  return [m.x * frame.width + Math.cos(r) * qx - Math.sin(r) * qy, m.y * frame.height + Math.sin(r) * qx + Math.cos(r) * qy];
}

/** Sequence seconds of a clip's media time, and back. clip: {start, inPt, speed} */
const toSeq = (c, t) => c.start + (t - (c.inPt || 0)) / (c.speed || 1);
const toMedia = (c, T) => (c.inPt || 0) + (T - c.start) * (c.speed || 1);

/**
 * The attached clip's keys.
 * track: {frames: [{t, x, y, s, a, state}], width, height, k0} (engine); src: {start, inPt, speed}; motions[i]: the source's
 * Motion at frame i (one object for all frames when it does not move); target: {start, end, inPt, speed, x, y (fractions),
 * scale, rot} at the boxed frame; frame {width, height}; opts {scale, rotation}.
 * -> {keys: [{t (target media), x, y, scale?, rot?}], lost, outside, ref} or {error}
 */
function attach(track, src, motions, target, frame, opts = {}) {
  const fr = track.frames || [];
  const k0 = Math.min(Math.max(0, track.k0 || 0), fr.length - 1);
  if (!fr.length || !fr[k0]) return { error: "Track the object first." };
  const file = { width: track.width, height: track.height };
  const mAt = (i) => motion(Array.isArray(motions) ? motions[Math.min(i, motions.length - 1)] : motions);
  const S = (i) => screenPoint(fr[i].x, fr[i].y, file, mAt(i), frame);
  const [s0x, s0y] = S(k0);
  const m0 = mAt(k0);
  const dx = target.x * frame.width - s0x;
  const dy = target.y * frame.height - s0y;
  const keys = [];
  let lost = 0;
  let outside = 0;
  const T0 = toSeq(src, fr[k0].t);
  if (T0 < target.start - 1e-6 || T0 >= target.end - 1e-6) {
    return { error: "The clip to attach must be on the timeline at the frame you boxed (park the playhead there and place it)." };
  }
  for (let i = 0; i < fr.length; i++) {
    const f = fr[i];
    if (f.state === "lost") {
      lost++;
      continue;
    }
    const T = toSeq(src, f.t);
    if (T < target.start - 1e-6 || T >= target.end - 1e-6) {
      outside++;
      continue;
    }
    const m = mAt(i);
    // the object's own turn and growth, plus the source clip's (a keyframed punch-in or turn of the source moves it too)
    const turn = opts.rotation ? (f.a - fr[k0].a) + (m.rot - m0.rot) : 0;
    const grow = opts.scale ? (f.s / fr[k0].s) * (m.sh / m0.sh) : 1;
    const [sx, sy] = S(i);
    const r = rad(turn);
    const px = sx + grow * (Math.cos(r) * dx - Math.sin(r) * dy);
    const py = sy + grow * (Math.sin(r) * dx + Math.cos(r) * dy);
    const k = { t: Math.round(toMedia(target, T) * 1e6) / 1e6, x: px / frame.width, y: py / frame.height };
    if (opts.scale) k.scale = target.scale * grow;
    if (opts.rotation) k.rot = target.rot + turn;
    keys.push(k);
  }
  if (!keys.length) return { error: "No tracked frame falls inside the clip to attach." };
  return { keys, lost, outside, ref: { x: s0x, y: s0y } };
}

/** The confidence strip: runs of frames with the same state. -> [{from, to, state}] (frame indexes, to exclusive) */
function runs(frames) {
  const out = [];
  for (let i = 0; i < frames.length; i++) {
    const st = frames[i] ? frames[i].state : "lost";
    if (out.length && out[out.length - 1].state === st) out[out.length - 1].to = i + 1;
    else out.push({ from: i, to: i + 1, state: st });
  }
  return out;
}

/** A box dragged on the preview (preview pixels, any corner order) as fractions of the picture, kept inside it. */
function boxFrom(x0, y0, x1, y1, w, h) {
  const l = Math.max(0, Math.min(x0, x1));
  const t = Math.max(0, Math.min(y0, y1));
  const r = Math.min(w, Math.max(x0, x1));
  const b = Math.min(h, Math.max(y0, y1));
  if (r - l < 4 || b - t < 4) return null;
  return [l / w, t / h, (r - l) / w, (b - t) / h];
}

// ---------------------------------------------------------------- Lock to it (0.10.54)
// The user (2026-11-11, a dribbled basketball): "I wanna track the ball's movement so it's locked in on it instead of
// keyframing". The TRACKED clip itself gets Position keys so the object stays put on screen (where it is on the boxed frame,
// or in the centre). From screenPoint: S = Position + v with v = R(rot)·scale·fit·(p − Anchor), so Position = T − v.
// A rigid lock shakes the whole picture with every bounce; Smooth follows a Gaussian-smoothed path instead (a camera
// operator). Moving the clip uncovers the frame's edges, so the smallest zoom (Scale × z) that keeps every frame covered is
// worked out (coverage.gap, as the pre-export check): the clip may be zoomed by it in the same press.

function gaussian(values, sigma) {
  const n = values.length;
  const r = Math.max(1, Math.ceil(3 * sigma));
  const w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let ws = 0;
    for (let k = -r; k <= r; k++) {
      let j = i + k;
      if (j < 0) j = -j;                                // mirrored at the ends (no pull towards zero)
      if (j >= n) j = 2 * (n - 1) - j;
      j = Math.min(n - 1, Math.max(0, j));
      s += w[k + r] * values[j];
      ws += w[k + r];
    }
    out[i] = s / ws;
  }
  return out;
}

// lost frames filled in straight between their neighbours (only for smoothing; a rigid lock writes no key there)
function filled(vals, ok) {
  const out = vals.slice();
  const idx = ok.map((o, i) => (o ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return null;
  for (let i = 0; i < out.length; i++) {
    if (ok[i]) continue;
    const a = idx.filter((j) => j < i).pop();
    const b = idx.find((j) => j > i);
    if (a === undefined) out[i] = out[b];
    else if (b === undefined) out[i] = out[a];
    else out[i] = out[a] + ((out[b] - out[a]) * (i - a)) / (b - a);
  }
  return out;
}

/**
 * track (engine), motions (the tracked clip's Motion per frame or one object), frame {width, height},
 * opts {centre, smooth (frames of Gaussian sigma, 0 = rigid), zoom (true: zoom by what hides the edges)}.
 * -> {keys: [{t (the clip's media time), x, y}], zoom, scale, uncovered, lost} or {error}
 */
function lock(track, motions, frame, opts = {}) {
  const fr = track.frames || [];
  const k0 = Math.min(Math.max(0, track.k0 || 0), fr.length - 1);
  if (!fr.length || !fr[k0]) return { error: "Track the object first." };
  const C = require("./coverage.js");
  const file = { width: track.width, height: track.height, rotation: 0 };
  const mAt = (i) => motion(Array.isArray(motions) ? motions[Math.min(i, motions.length - 1)] : motions);
  if (Array.isArray(motions) && new Set(motions.map((m) => `${m.sw}|${m.sh}`)).size > 1 && opts.zoom) {
    opts = { ...opts, zoom: false, keyedScale: true };
  }
  const ok = fr.map((f) => f.state !== "lost");
  if (!ok.some(Boolean)) return { error: "Every frame was lost: track again with a box on something with more detail." };
  // v at zoom 1, per frame (pixels)
  const v = fr.map((f, i) => {
    const m = mAt(i);
    const fit = m.fit ? Math.min(frame.width / file.width, frame.height / file.height) : 1;
    const qx = (f.x - m.ax * file.width) * (m.sw / 100) * fit;
    const qy = (f.y - m.ay * file.height) * (m.sh / 100) * fit;
    const r = rad(m.rot);
    return [Math.cos(r) * qx - Math.sin(r) * qy, Math.sin(r) * qx + Math.cos(r) * qy];
  });
  const m0 = mAt(k0);
  const T = opts.centre ? [frame.width / 2, frame.height / 2] : [m0.x * frame.width + v[k0][0], m0.y * frame.height + v[k0][1]];
  let vx = v.map((p) => p[0]);
  let vy = v.map((p) => p[1]);
  const smooth = Number(opts.smooth) > 0;
  if (smooth) {
    vx = gaussian(filled(vx, ok), Number(opts.smooth));
    vy = gaussian(filled(vy, ok), Number(opts.smooth));
  }
  const use = fr.map((_, i) => smooth || ok[i]);
  const posAt = (i, z) => [(T[0] - z * vx[i]) / frame.width, (T[1] - z * vy[i]) / frame.height];
  const coveredAt = (z) => {
    let bad = 0;
    for (let i = 0; i < fr.length; i++) {
      if (!use[i]) continue;
      const m = mAt(i);
      const [x, y] = posAt(i, z);
      const g = C.gap(file, { ...m, sw: m.sw * z, sh: m.sh * z, x, y }, frame);
      if (g && !g.covered) bad++;
    }
    return bad;
  };
  const uncovered = coveredAt(1);
  let need = 1;
  if (uncovered) {
    need = null;
    for (let z = 1.005; z <= 4.0001; z += 0.005) {
      if (!coveredAt(z)) {
        need = Math.round(z * 1000) / 1000;
        break;
      }
    }
  }
  const z = opts.zoom && need ? need : 1;
  const keys = [];
  for (let i = 0; i < fr.length; i++) {
    if (!use[i]) continue;
    const [x, y] = posAt(i, z);
    keys.push({ t: fr[i].t, x, y });
  }
  return { keys, zoom: z, need, scale: z !== 1 ? Math.round(m0.sh * z * 10) / 10 : null, needScale: need ? Math.round(m0.sh * need * 10) / 10 : null,
    uncovered: z !== 1 ? 0 : uncovered, lost: ok.filter((o) => !o).length, smooth, keyedScale: !!opts.keyedScale };
}

// ---------------------------------------------------------------- the Tracker page's viewer and timeline (0.10.55)

/** The tracked box on frame f as four corners (file pixels): box [x, y, w, h] of the boxed frame, grown by f.s, turned by f.a. */
function corners(f, box) {
  const hw = (box[2] * f.s) / 2;
  const hh = (box[3] * f.s) / 2;
  const r = rad(f.a);
  const c = Math.cos(r);
  const n = Math.sin(r);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [f.x + c * x - n * y, f.y + n * x + c * y]);
}

/** The first frame of the next (dir 1) or previous (dir -1) run that is not sure, seen from frame i; -1 when none. */
function problem(frames, i, dir) {
  const bad = (k) => frames[k] && frames[k].state !== "sure";
  let k = i;
  if (dir > 0) {
    while (k < frames.length && bad(k)) k++;                     // out of the run we are in
    while (k < frames.length && !bad(k)) k++;
    return k < frames.length ? k : -1;
  }
  while (k >= 0 && bad(k)) k--;
  while (k >= 0 && !bad(k)) k--;
  if (k < 0) return -1;
  while (k > 0 && bad(k - 1)) k--;                               // the start of that run
  return k;
}

/**
 * A part tracked again from a new box (a frame the editor fixed) put into the track. part: the engine's answer for frames
 * offset.. offset+n-1 (its own scale and angle start at 1 / 0 on its boxed frame). Scale and angle continue from the
 * nearest sure frame of the old track next to the fixed one (a box drawn a little tighter must not make the attached text
 * jump in size); with no sure frame left, the scale comes from the new box against the first one.
 */
function merge(track, part, offset, newBox) {
  const old = track.frames;
  const j = offset + (part.k0 || 0);
  let ratio = Math.sqrt((newBox[2] * newBox[3]) / (track.box[2] * track.box[3]));
  let base = 0;
  for (let d = 1; d < old.length; d++) {
    const a = old[j - d];
    const b = old[j + d];
    const near = a && a.state === "sure" ? a : b && b.state === "sure" ? b : null;
    if (near) {
      ratio = near.s;
      base = near.a;
      break;
    }
  }
  const frames = old.slice();
  part.frames.forEach((f, i) => {
    if (offset + i < frames.length) frames[offset + i] = { ...f, s: f.s * ratio, a: f.a + base, fixed: true };
  });
  return { ...track, frames };
}

/** Marks for the timeline: one per second of the clip's own time (every 5 s when long). -> [{i, label}] */
function ticks(frames, inPt) {
  if (!frames.length) return [];
  const t0 = frames[0].t;
  const span = frames[frames.length - 1].t - t0;
  const every = span > 40 ? 10 : span > 12 ? 5 : 1;
  const out = [];
  for (let s = Math.ceil((t0 - (inPt || 0)) / every) * every; s <= span + (t0 - (inPt || 0)) + 1e-6; s += every) {
    const t = (inPt || 0) + s;
    const i = frames.findIndex((f) => f.t >= t - 1e-6);
    if (i >= 0) out.push({ i, label: `${s}s` });
  }
  return out;
}

module.exports = { motion, screenPoint, attach, lock, gaussian, runs, boxFrom, toSeq, toMedia, corners, problem, merge, ticks };
