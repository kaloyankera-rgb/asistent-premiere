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

module.exports = { motion, screenPoint, attach, runs, boxFrom, toSeq, toMedia };
