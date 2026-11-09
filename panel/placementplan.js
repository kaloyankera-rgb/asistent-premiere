// "Move off faces" (2026-11 improvements, TODO R.5): where each subtitle graphic goes, from the faces in its shot. Pure: no
// Premiere, no engine; node-tested. All heights are fractions of the frame height (0 = top, 1 = bottom).
//
// The client's own placement, measured on 7 ReShape videos (docs/SUBTITLE_STYLE.md, 625 lines):
// - one height per shot, changed at a cut (79 of 90 changes were at a cut);
// - the top of the Bulgarian line 0.11 under the speaker's chin (median; predicts the height within 0.028);
// - above the face when the face is low in the frame; never higher than ~0.16 or lower than ~0.72;
// - no face (B-roll, drawings): around the middle (0.50);
// - the English line's centre 0.035 under the Bulgarian line's centre.
// Premiere cannot tell a script how tall a text graphic is (docs/NATIVE_GRAPHICS.md), so the line height is a setting.

const RULE = { underChin: 0.11, top: 0.16, bottom: 0.72, middle: 0.50, englishGap: 0.035, lineHeight: 0.035, aboveGap: 0.02 };
const SAME_TIME = 0.05;              // two graphics with the same start and end (within this) are a Bulgarian/English pair

// the faces of one frame -> the main face: the largest (the speaker is the biggest face in a talking shot)
function mainFace(faces) {
  const list = (faces || []).filter((f) => f && f.w > 0 && f.h > 0);
  return list.length ? list.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)) : null;
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null;
}

// the frames of one shot (each a list of faces {x, y, w, h}) -> {top of the Bulgarian line, why}
function shotTop(frames, rule = RULE) {
  const mains = (frames || []).map((f) => mainFace(f)).filter(Boolean);
  if (!mains.length) return { top: rule.middle, why: "no face" };
  const chin = median(mains.map((f) => f.y + f.h));
  const faceTop = median(mains.map((f) => f.y));
  let top = chin + rule.underChin;
  let why = "under the face";
  if (top > rule.bottom) {                                  // the face is low: the line goes above it
    top = faceTop - rule.aboveGap - rule.lineHeight;
    why = "above the face";
  }
  top = Math.min(rule.bottom, Math.max(rule.top, top));
  return { top: Math.round(top * 1000) / 1000, why };
}

// graphics [{id, start, end, center}] -> [{id, role: "bg" | "en"}]: two at the same times are a pair, the lower one English
function roles(graphics) {
  const out = new Map();
  const used = new Set();
  for (const g of graphics) {
    if (used.has(g.id)) continue;
    const mate = graphics.find((h) => h.id !== g.id && !used.has(h.id)
      && Math.abs(h.start - g.start) <= SAME_TIME && Math.abs(h.end - g.end) <= SAME_TIME);
    used.add(g.id);
    if (!mate) {
      out.set(g.id, "bg");
      continue;
    }
    used.add(mate.id);
    // the English line is the lower one; the same height (both still where the upgrade put them): the higher track
    const lower = Math.abs(mate.center - g.center) > 0.001 ? mate.center > g.center : (mate.track || 0) > (g.track || 0);
    const [bg, en] = lower ? [g, mate] : [mate, g];
    out.set(bg.id, "bg");
    out.set(en.id, "en");
  }
  return graphics.map((g) => ({ id: g.id, role: out.get(g.id) || "bg" }));
}

// which shot a line belongs to: the shot whose span holds the line's middle
function shotOf(shots, g) {
  const mid = (g.start + g.end) / 2;
  return shots.findIndex((s) => mid >= s.start && mid < s.end);
}

// the moments to measure in each shot: the middles of up to `per` of its lines, spread over the shot
function moments(shots, graphics, per = 3) {
  return shots.map((s, i) => {
    const mids = graphics.filter((g) => shotOf(shots, g) === i).map((g) => (g.start + g.end) / 2).sort((a, b) => a - b);
    if (mids.length <= per) return mids;
    return Array.from({ length: per }, (_, k) => mids[Math.round((k * (mids.length - 1)) / (per - 1))]);
  });
}

// graphics [{id, start, end, center, motionY}], shots [{start, end}], faces per shot [[faces per frame]] ->
// [{id, role, shot, why, targetCenter, motionY (new)}]. The move keeps each graphic's own offset inside its layer:
// new Motion Y = old Motion Y + (target centre - current centre).
function plan(graphics, shots, facesPerShot, rule = RULE) {
  const tops = shots.map((s, i) => shotTop(facesPerShot[i], rule));
  const role = new Map(roles(graphics).map((r) => [r.id, r.role]));
  return graphics.map((g) => {
    const i = shotOf(shots, g);
    const t = i >= 0 ? tops[i] : { top: rule.middle, why: "no shot under the line" };
    const bgCenter = t.top + rule.lineHeight / 2;
    const target = role.get(g.id) === "en" ? bgCenter + rule.englishGap : bgCenter;
    return { id: g.id, role: role.get(g.id), shot: i, why: t.why, targetCenter: Math.round(target * 1000) / 1000,
      motionY: Math.round((g.motionY + target - g.center) * 10000) / 10000 };
  });
}

// where each graphic's text really is: measured centres (text recognition on the exported frames, engine framefaces.py) for
// the lines that were measured, and for the others their Motion Y plus the median offset measured on lines of the same role
// (all lines of one caption track share one style). Nothing measured: the estimate stays (est: true).
// graphics [{id, start, end, center (estimate), motionY}], measured Map id -> centre -> graphics with `center` replaced.
function calibrate(graphics, measured) {
  const seen = graphics.map((g) => ({ ...g, center: measured.has(g.id) ? measured.get(g.id) : g.center }));
  const role = new Map(roles(seen).map((r) => [r.id, r.role]));
  const off = { bg: [], en: [] };
  for (const g of graphics) if (measured.has(g.id)) off[role.get(g.id)].push(measured.get(g.id) - g.motionY);
  const med = { bg: median(off.bg), en: median(off.en) };
  return seen.map((g) => {
    if (measured.has(g.id)) return { ...g, est: false };
    const o = med[role.get(g.id)] !== null ? med[role.get(g.id)] : med.bg;
    return o === null ? { ...g, est: true } : { ...g, center: g.motionY + o, est: false };
  });
}

// may Asistent move this graphic? Not when its Position is keyframed, and not when the editor moved it: its Motion Position
// must still be Premiere's default after the upgrade (0.5, 0.5) or the value Asistent itself wrote last time.
function movable(g, written) {
  if (g.animated) return { ok: false, why: "Position has keyframes" };
  const near = (a, b) => Math.abs(a - b) < 0.0015;
  if (near(g.motionX, 0.5) && near(g.motionY, 0.5)) return { ok: true };
  if (written && near(g.motionY, written.y) && near(g.motionX, written.x)) return { ok: true };
  return { ok: false, why: "moved by hand" };
}

module.exports = { RULE, mainFace, shotTop, roles, shotOf, moments, plan, movable, median, calibrate };
