// Does each clip's picture fill the frame? (0.10.44, the user 2026-11-11: "I often make the mistake for the B-Rolls to not be
// fully scaled and you can see either black bars or a little bit of the video that is below"). Pure (no Premiere), tested with
// node. The pre-export check reads each clip's Motion (Position, Scale, Rotation, Anchor Point, Crop) and the file's frame
// (engine /export/frames) and asks here which part of the sequence frame stays uncovered, at the clip's start and end and at
// every keyframe. Read only: nothing is changed.
//
// Geometry, in sequence pixels: a point p of the file (pixels, after the display rotation) lands at
//   Position + R(rotation) · scale · fit · (p − Anchor)
// fit = Scale to Frame Size (the file shrunk or grown to fit inside the frame, aspect kept) or 1. Crop (Motion's Crop or the
// Crop effect, % of the file) cuts the picture before the move. The frame is covered when all four corners of the frame lie
// inside the moved picture; for an unrotated picture the uncovered strip on each side is measured in pixels.

const TOL = 0.5;                       // pixels: rounding, not a strip
const OVERLAY_EXT = /\.(png|psd|ai|eps|svg|gif)$/i;   // logos and graphics: smaller than the frame on purpose

/**
 * One moment of one clip.
 * file: {width, height, rotation} (pixels as stored, rotation 0/90/180/270 from the file's display matrix)
 * m: {x, y} Position as fractions of the frame; ax, ay Anchor Point as fractions of the file; sw, sh Scale % (width, height);
 *    rot degrees; crop {l, t, r, b} %; fit true when Scale to Frame Size is on
 * frame: {width, height} of the sequence
 * -> {covered, left, right, top, bottom} (uncovered pixels per side; null sides when rotated: only covered is known)
 */
function gap(file, m, frame) {
  const turned = ((file.rotation || 0) % 180 + 180) % 180 === 90;
  const W = turned ? file.height : file.width;
  const H = turned ? file.width : file.height;
  const FW = frame.width;
  const FH = frame.height;
  if (!(W > 0 && H > 0 && FW > 0 && FH > 0)) return null;
  const fit = m.fit ? Math.min(FW / W, FH / H) : 1;
  const sx = ((m.sw === undefined ? 100 : m.sw) / 100) * fit;
  const sy = ((m.sh === undefined ? m.sw === undefined ? 100 : m.sw : m.sh) / 100) * fit;
  const c = m.crop || {};
  const x0 = W * (c.l || 0) / 100;
  const x1 = W * (1 - (c.r || 0) / 100);
  const y0 = H * (c.t || 0) / 100;
  const y1 = H * (1 - (c.b || 0) / 100);
  const ax = (m.ax === undefined ? 0.5 : m.ax) * W;
  const ay = (m.ay === undefined ? 0.5 : m.ay) * H;
  const px = (m.x === undefined ? 0.5 : m.x) * FW;
  const py = (m.y === undefined ? 0.5 : m.y) * FH;
  const rot = (((m.rot || 0) % 360) + 360) % 360;
  if (x1 <= x0 || y1 <= y0 || sx <= 0 || sy <= 0) return { covered: false, left: FW, right: FW, top: FH, bottom: FH, empty: true };

  if (rot < 1e-6 || Math.abs(rot - 360) < 1e-6) {
    const L = px + sx * (x0 - ax);
    const R = px + sx * (x1 - ax);
    const T = py + sy * (y0 - ay);
    const B = py + sy * (y1 - ay);
    const g = { left: Math.max(0, L), right: Math.max(0, FW - R), top: Math.max(0, T), bottom: Math.max(0, FH - B) };
    for (const k of Object.keys(g)) g[k] = g[k] > TOL ? Math.round(Math.min(g[k], k === "left" || k === "right" ? FW : FH)) : 0;
    return { covered: !g.left && !g.right && !g.top && !g.bottom, ...g };
  }
  // rotated: back-project each frame corner into the file and see whether it falls inside the cropped picture
  const a = (rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const inside = ([fx, fy]) => {
    const dx = fx - px;
    const dy = fy - py;
    const u = (cos * dx + sin * dy) / sx + ax;              // R(-a)
    const v = (-sin * dx + cos * dy) / sy + ay;
    return u >= x0 - TOL / sx && u <= x1 + TOL / sx && v >= y0 - TOL / sy && v <= y1 + TOL / sy;
  };
  const covered = [[0, 0], [FW, 0], [0, FH], [FW, FH]].every(inside);
  return { covered, left: null, right: null, top: null, bottom: null, rotated: true };
}

/** Which clips the check looks at: pictures meant to fill the frame (video and photo files), not graphics or overlays. */
function checked(clip, file) {
  if (!clip.path || clip.unused || clip.hidden || clip.adjustment) return false;
  if (OVERLAY_EXT.test(clip.path)) return false;
  if (!file || file.error || file.alpha) return false;                 // a transparent file is an overlay by design
  return true;
}

const clock = (s) => {
  const mm = Math.floor(s / 60);
  const r = s - 60 * mm;
  return `${mm}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
};

function sides(g) {
  if (g.rotated) return "rotated so that a corner of the frame is uncovered";
  const parts = [];
  if (g.top && g.bottom) parts.push(g.top === g.bottom ? `${g.top} px at the top and bottom` : `${g.top} px at the top, ${g.bottom} px at the bottom`);
  else if (g.top) parts.push(`${g.top} px at the top`);
  else if (g.bottom) parts.push(`${g.bottom} px at the bottom`);
  if (g.left && g.right) parts.push(g.left === g.right ? `${g.left} px left and right` : `${g.left} px on the left, ${g.right} px on the right`);
  else if (g.left) parts.push(`${g.left} px on the left`);
  else if (g.right) parts.push(`${g.right} px on the right`);
  return parts.join(", ") + " uncovered";
}

/** What shows through the strip: the highest picture below the clip at that time, or black. */
function below(clip, all, at) {
  const under = all.filter((x) => x.kind === "video" && !x.unused && !x.hidden && !x.adjustment && x.track < clip.track &&
    x.start <= at + 1e-6 && x.end > at + 1e-6).sort((p, q) => q.track - p.track)[0];
  return under ? `V${under.track + 1} ${under.name} shows through` : "black shows";
}

/**
 * clips: [{name, track, start, end, path, unused, hidden, adjustment, samples: [{at, m}]}] (at: sequence seconds of a sample;
 * m as in gap()), files: {path: {width, height, rotation, alpha, error}}, frame, all: every video item (for what shows
 * through) -> {bad: [{clip, at, g, text}], looked: n, skipped: n, unknownFit: n}
 */
function check(clips, files, frame, all = clips) {
  const bad = [];
  let looked = 0;
  let skipped = 0;
  let unknownFit = 0;
  for (const c of clips) {
    const f = files[c.path];
    if (!checked(c, f)) {
      if (c.path && !c.unused && !c.hidden && !c.adjustment) skipped++;
      continue;
    }
    looked++;
    if (c.fitUnknown) unknownFit++;
    let worst = null;
    for (const s of c.samples || []) {
      const g = gap(f, s.m, frame);
      if (!g || g.covered) continue;
      const size = g.rotated ? Infinity : g.left + g.right + g.top + g.bottom;
      if (!worst || size > worst.size) worst = { g, at: s.at, size, m: s.m };
    }
    if (worst) {
      const sc = worst.m.sw === undefined ? null : worst.m.sh !== undefined && worst.m.sh !== worst.m.sw
        ? `scale ${+worst.m.sw.toFixed(1)} / ${+worst.m.sh.toFixed(1)} %` : `scale ${+worst.m.sw.toFixed(1)} %`;
      bad.push({ clip: c, at: worst.at, g: worst.g,
        text: `V${c.track + 1} ${c.name} at ${clock(worst.at)}: ${sides(worst.g)}${sc ? ` (${sc})` : ""}; ${below(c, all, worst.at)}` });
    }
  }
  return { bad, looked, skipped, unknownFit };
}

module.exports = { gap, check, checked, sides, below, OVERLAY_EXT, TOL };
