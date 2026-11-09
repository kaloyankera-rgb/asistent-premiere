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

const MIN_PIECE = 0.1;               // a piece of a line shorter than this over another shot is not given its own height

// which clip is seen during [start, end): clips [{start, end, track}] (visible ones with media) -> [{from, to, clip}],
// the top clip in each stretch; a stretch shorter than MIN_PIECE joins its neighbour. Two POVs cut against each other, or a
// new scene, give a line two pieces: the client's height changes at the cut (one height per shot).
function cover(start, end, clips) {
  const cuts = [...new Set([start, end, ...clips.flatMap((c) => [c.start, c.end]).filter((t) => t > start && t < end)])].sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2;
    const top = clips.filter((c) => c.start <= mid && mid < c.end).sort((a, b) => b.track - a.track)[0] || null;
    const last = pieces[pieces.length - 1];
    if (last && last.clip === top) last.to = cuts[i + 1];
    else pieces.push({ from: cuts[i], to: cuts[i + 1], clip: top });
  }
  for (let i = 0; i < pieces.length && pieces.length > 1;) {          // slivers join the neighbour (the longer one)
    const p = pieces[i];
    if (p.to - p.from >= MIN_PIECE) { i++; continue; }
    const into = i === 0 ? 1 : (i === pieces.length - 1 ? i - 1 : (pieces[i - 1].to - pieces[i - 1].from >= pieces[i + 1].to - pieces[i + 1].from ? i - 1 : i + 1));
    pieces[into].from = Math.min(pieces[into].from, p.from);
    pieces[into].to = Math.max(pieces[into].to, p.to);
    pieces.splice(i, 1);
  }
  return pieces;
}

// the moments to measure in each shot: the middles of up to `per` line pieces over it, spread over the shot.
// graphics carry `pieces` [{from, to, shot}].
function moments(shots, graphics, per = 3) {
  return shots.map((s, i) => {
    const mids = graphics.flatMap((g) => (g.pieces || []).filter((p) => p.shot === i).map((p) => (p.from + p.to) / 2)).sort((a, b) => a - b);
    if (mids.length <= per) return mids;
    return Array.from({ length: per }, (_, k) => mids[Math.round((k * (mids.length - 1)) / (per - 1))]);
  });
}

// graphics [{id, start, end, center, motionY, pieces: [{from, to, shot}]}], faces per shot [[faces per frame]] ->
// [{id, role, why, targetCenter, motionY}] for a line over one shot, or with `keys` [[sequence time, Motion Y]] for a line
// over a cut: its shot's height until one frame before the cut, the next shot's height from the cut (at most one frame of
// movement, no slide). The move keeps each graphic's own offset inside its layer: Motion Y + (target centre - centre).
function plan(graphics, shots, facesPerShot, rule = RULE, frame = 1 / 30) {
  const tops = shots.map((s, i) => shotTop(facesPerShot[i], rule));
  const role = new Map(roles(graphics).map((r) => [r.id, r.role]));
  const r4 = (v) => Math.round(v * 10000) / 10000;
  return graphics.map((g) => {
    const pieces = g.pieces && g.pieces.length ? g.pieces : [{ from: g.start, to: g.end, shot: -1 }];
    const ys = pieces.map((p) => {
      const t = p.shot >= 0 ? tops[p.shot] : { top: rule.middle, why: "no clip under the line" };
      const bgCenter = t.top + rule.lineHeight / 2;
      const target = role.get(g.id) === "en" ? bgCenter + rule.englishGap : bgCenter;
      return { target, why: t.why, y: r4(g.motionY + target - g.center) };
    });
    const out = { id: g.id, role: role.get(g.id), why: ys[0].why, targetCenter: Math.round(ys[0].target * 1000) / 1000, motionY: ys[0].y };
    if (pieces.length > 1 && ys.some((v) => Math.abs(v.y - ys[0].y) >= 0.001)) {
      const keys = [[g.start, ys[0].y]];
      for (let i = 1; i < pieces.length; i++) {
        keys.push([Math.max(pieces[i].from - frame, keys[keys.length - 1][0] + 0.001), ys[i - 1].y]);
        keys.push([pieces[i].from, ys[i].y]);
      }
      out.keys = keys;
    }
    return out;
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
  if (g.animated) {
    // Asistent's own keyframes (a line over a cut, written by an earlier press) may be rewritten: same count and times
    const mine = written && written.keys && g.keyTimes && written.keys.length === g.keyTimes.length
      && written.keys.every((t, i) => Math.abs(t - g.keyTimes[i]) < 0.002);
    return mine ? { ok: true, own: true } : { ok: false, why: "Position has keyframes" };
  }
  const near = (a, b) => Math.abs(a - b) < 0.0015;
  if (near(g.motionX, 0.5) && near(g.motionY, 0.5)) return { ok: true };
  if (written && near(g.motionY, written.y) && near(g.motionX, written.x)) return { ok: true };
  return { ok: false, why: "moved by hand" };
}

module.exports = { RULE, mainFace, shotTop, roles, cover, moments, plan, movable, median, calibrate };
