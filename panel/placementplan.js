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
function calibrate(graphics, measured, lineCount) {
  if (lineCount) return calibrateByCount(graphics, measured, lineCount);
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


// ---------------------------------------------------------------------------------------------------------------------
// Lane placement (2026-11-22, the user's decisions): every client has a LANE, the height its editors keep, and a line leaves
// it only when something is in the way. Measured on 25 editor-finished videos (scripts/placement_replay.py; lanes fitted
// on the odd videos, checked on the even ones). All numbers are fractions of the frame height; a line is placed by the TOP
// of its first line (a chunk of two lines grows downward).
//
//   base of a shot = max(L, chin + k)        the lane, or just under the worst-case chin of the shot's faces
//   per line       the base, unless a face or other text in that line's own frames collides with it:
//                  a face: down, below its chin + k; other text: the nearest free height (both ways without a face,
//                  never above chin + k with one); no free place: the line stays and is flagged
//   back to base   when the base is free again with a margin (hysteresis), never a slide, only between lines and at cuts

// measured lanes (scripts/placement_replay.py --emit-lanes): top of the first line and chin clearance per Asistent Style,
// fitted on 13 training videos (odd tags) of the 25; n = training chunks. k is 0.05 everywhere ("lane + collision only": a
// per-client k fitted on one or two videos did not carry over to the client's other videos, and a pooled fitted k of 0.10
// followed the chin more than the editors do). "default" is the fit on all clients and serves every style without its own lane
// (Auto, ReShape's own rule aside, Fornetti, MASTERHAUS, TEODOR, Cineland, Ergon, Ники Трифонов, ...).
const LANES = {
  default: { top: 0.46, k: 0.05, n: 974 },
  gstroy: { top: 0.458, k: 0.05, n: 57 },
  credissimo: { top: 0.468, k: 0.05, n: 237 },
  ekopak: { top: 0.468, k: 0.05, n: 92 },
  beautysector: { top: 0.418, k: 0.05, n: 153 },
  aula: { top: 0.49, k: 0.05, n: 177 },
};

const LANE_RULE = {
  lineHeight: 0.035,       // one line, Premiere cannot report it (the same setting as RULE.lineHeight)
  faceGap: 0.012,          // a line closer than this under a chin collides with the face
  textGap: 0.01,           // the same for other text, above and below
  margin: 0.03,            // hysteresis: the base must be free by this much before a dropped line goes back to it
  maxBottom: 0.76,         // the bottom of a line never goes lower (the lower third is for platform buttons and captions)
  minTop: 0.12,
  reach: 0.26,             // a collision move stays within this of the base (the editors' p90 move is 0.22)
  minFace: 0.03,           // faces smaller than this are not obstacles. The plan said 0.08, but the small faces of wide shots (3-4 % of
                           // the height) are real people the editors avoid: at 0.08 the held-out face overlap was 0.7-1.1 %, at 0.03 it is 0.0-0.1 %
  minConfidence: 0.5,      // text recognition below this is noise
};

// the lane for a Style value (panel select #subtitleStyle); anything without its own lane gets the pooled one
function laneFor(preset) {
  const key = String(preset === undefined || preset === null ? "" : preset).toLowerCase();
  return Object.prototype.hasOwnProperty.call(LANES, key) ? LANES[key] : LANES.default;
}

const r3 = (v) => Math.round(v * 1000) / 1000;

function overlapLen(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0); }

// is this recognised text box (centre inside it, or most of it inside) one of the line's own words?
function isOwnText(t, own) {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const area = Math.max(t.w * t.h, 1e-9);
  return own.some((o) => {
    if (cx >= o.x - 0.012 && cx <= o.x + o.w + 0.012 && cy >= o.y - 0.012 && cy <= o.y + o.h + 0.012) return true;
    return Math.max(overlapLen(t.x, t.x + t.w, o.x, o.x + o.w), 0) * Math.max(overlapLen(t.y, t.y + t.h, o.y, o.y + o.h), 0) / area >= 0.5;
  });
}

// what is in the way of one line in one frame: every face of height >= minFace (not only the largest), and the recognised
// text that is not the line's own words (ownBoxes [{x, y, w, h}]), confidence >= 0.5, overlapping the line's horizontal
// span (span {x0, x1}; default: the own boxes' extent; none known: nothing is dropped for being beside the line)
function obstacles(frameFaces, frameText, ownBoxes, span, minFace = LANE_RULE.minFace) {
  const own = (ownBoxes || []).filter((o) => o && o.w > 0 && o.h > 0);
  const sp = span || (own.length ? { x0: Math.min(...own.map((o) => o.x)), x1: Math.max(...own.map((o) => o.x + o.w)) } : null);
  const out = [];
  for (const f of frameFaces || []) {
    if (!f || !(f.w > 0) || !(f.h >= minFace)) continue;
    if (sp && !(overlapLen(f.x, f.x + f.w, sp.x0, sp.x1) > 0)) continue;
    out.push({ kind: "face", x: f.x, y: f.y, w: f.w, h: f.h, chin: f.y + f.h });
  }
  for (const t of frameText || []) {
    if (!t || !(t.w > 0) || !(t.h > 0)) continue;
    if (t.confidence !== undefined && t.confidence < LANE_RULE.minConfidence) continue;
    if (typeof t.text === "string" && t.text.trim().length < 2) continue;
    if (sp && !(overlapLen(t.x, t.x + t.w, sp.x0, sp.x1) > 0)) continue;
    if (own.length && isOwnText(t, own)) continue;
    out.push({ kind: "text", x: t.x, y: t.y, w: t.w, h: t.h });
  }
  return out;
}

// the worst-case (lowest) chin of the faces in these frames [[faces per frame]]; null with no face
function shotChin(frames, minFace = LANE_RULE.minFace) {
  let chin = null;
  for (const fr of frames || []) {
    for (const f of fr || []) {
      if (!f || !(f.w > 0) || !(f.h >= minFace)) continue;
      const c = f.y + f.h;
      if (chin === null || c > chin) chin = c;
    }
  }
  return chin;
}

// the frames of a shot [[faces per frame]], the lane {top, k} -> {top, why, flag, chin}: the lane, or under the lowest chin
// + k, never above a face; where that would put the line past maxBottom it stays in the lane and is flagged
function shotBase(frames, lane, minFace = LANE_RULE.minFace) {
  const L = lane || LANES.default;
  const chin = shotChin(frames, minFace);
  if (chin === null) return { top: L.top, why: "lane", flag: false, chin: null };
  const pushed = chin + L.k;
  if (pushed <= L.top) return { top: L.top, why: "lane", flag: false, chin: r3(chin) };
  if (pushed + LANE_RULE.lineHeight > LANE_RULE.maxBottom) return { top: L.top, why: "no free place", flag: true, chin: r3(chin) };
  return { top: r3(pushed), why: "under a face", flag: false, chin: r3(chin) };
}

// one line's height: its base, moved only when something in the line's own frames collides with it.
// lineFrames [{faces, text, own}] (measured at the line's moments), box {x0, x1, h} (the line's span and height),
// lane {top, k} (opts.reshape: {k, minTop, maxTop} from ReShape's rule: collisions are then plain overlaps, so a line the rule
// put above a low face is not "colliding" with it), prev = the height this shot's earlier line was dropped to (null: at base).
// -> {y, reason, flag, moved}. A line that is free at its base stays (or, after a drop, returns when it is free by the
// margin); a face moves it down below the lowest colliding chin + k; text moves it to the nearest free height.
function lineHeight(base, lineFrames, box, lane, prev = null, opts = {}) {
  const R = LANE_RULE;
  const reshape = !!opts.reshape;
  const H = (box && box.h) || R.lineHeight;
  const baseReason = opts.baseReason || "lane";
  const keep = { y: base, reason: baseReason, flag: !!opts.baseFlag, moved: false };
  const span = box && Number.isFinite(box.x0) && Number.isFinite(box.x1) ? { x0: box.x0, x1: box.x1 } : null;
  const obs = [];
  for (const fr of lineFrames || []) obs.push(...obstacles(fr.faces, fr.text, fr.own, span, opts.minFace === undefined ? LANE_RULE.minFace : opts.minFace));
  if (!obs.length) return keep;
  const minTop = reshape ? lane.minTop : R.minTop;
  const maxTop = reshape ? lane.maxTop : R.maxBottom - H;
  const lo = Math.max(minTop, base - R.reach);
  const hi = Math.min(maxTop, base + R.reach);
  // ReShape mode: the Bulgarian and the English line are separate boxes (box.parts [{off, h}], the English one under the
  // Bulgarian by the client's own spacing). A face is tested against the Bulgarian box only: the rule puts that line above a low
  // face and the English line then follows it as in the client's own videos, so the pair is not one box that "touches" the face.
  const Hf = reshape ? (box && box.hBg) || H : H;
  const parts = reshape && box && box.parts ? box.parts : null;
  const collides = (o, y, pad) => {
    if (o.kind === "face") {
      if (!reshape) return y < o.chin + R.faceGap + pad;                 // a line must sit under every face it spans
      return y < o.chin + R.faceGap + pad && y + Hf > o.y - R.faceGap - pad;
    }
    if (parts) return parts.some((pt) => y + pt.off < o.y + o.h + R.textGap + pad && y + pt.off + pt.h > o.y - R.textGap - pad);
    return y < o.y + o.h + R.textGap + pad && y + H > o.y - R.textGap - pad;
  };
  const free = (y, pad) => !obs.some((o) => collides(o, y, pad));
  const faces = obs.filter((o) => o.kind === "face");
  const faceHit = faces.some((o) => collides(o, base, 0));
  const textHit = obs.some((o) => o.kind === "text" && collides(o, base, 0));
  // back to the base: free, and by the margin when the line was dropped
  if (free(base, prev === null ? 0 : R.margin)) return keep;
  // a dropped line stays where it is while that is still free
  if (prev !== null && prev >= lo - 1e-9 && prev <= hi + 1e-9 && free(prev, 0)) {
    return { y: prev, reason: opts.prevReason || "zoom brought a face", flag: false, moved: true };
  }
  // otherwise the nearest free height: under a chin + k, or just above / below a text box
  const kk = lane.k;
  const floorFaces = faces.filter((o) => !reshape || o.y < base + Hf);      // ReShape: a face wholly under the line is no floor
  const floor = floorFaces.length ? Math.max(...floorFaces.map((o) => o.chin + kk)) : -Infinity;
  const cands = new Set([base]);
  for (const o of faces) cands.add(o.chin + kk);
  for (const o of obs) {
    if (o.kind !== "text") continue;
    cands.add(o.y - R.textGap - H - 0.001);
    cands.add(o.y + o.h + R.textGap + 0.001);
  }
  const ok = [...cands].filter((y) => y >= lo - 1e-9 && y <= hi + 1e-9 && (y === base || y >= floor - 1e-9) && free(y, 0));
  if (!ok.length) return { y: base, reason: "no free place", flag: true, moved: false };
  ok.sort((a, b) => Math.abs(a - base) - Math.abs(b - base) || b - a);
  const y = ok[0];
  if (y === base) return keep;
  return { y: r3(y), reason: faceHit || (!textHit && faces.length) ? "zoom brought a face" : "off text", flag: false, moved: true };
}

// the moments to measure, one list per line (not per shot): the middle of each line (of each piece of it over a cut), and its
// start and end too when it is longer than 1.2 s or a zoom keyframe time falls inside it. English lines are not measured: they
// sit with their Bulgarian line. The cap is HARD (never more than `cap` frames, whatever the input), filled in this order:
// (a) the middle of every line next to a zoom keyframe time or a cut (the zoom or the new shot is where a face can come in: the
// line over a cut, the first line of a new shot, a line with a zoom time between its neighbours' middles), thinned evenly only if
// these alone are over the cap; (b) the middles of the other lines, thinned evenly over each shot to what is left (a left-out line
// keeps the height of the line before it); (c) start and end frames, only while under the cap, zoom-adjacent lines first.
// graphics [{id, start, end, center, pieces}], zoomTimes [seconds] -> [{id, t, kind: "mid" | "start" | "end"}] sorted by time.
function momentsPerLine(graphics, zoomTimes = [], cap = 240) {
  const rl = new Map(roles(graphics).map((r) => [r.id, r.role]));
  const bg = graphics.filter((g) => rl.get(g.id) === "bg").sort((a, b) => a.start - b.start);
  const zooms = (zoomTimes || []).slice().sort((a, b) => a - b);
  const inside = (a, b) => zooms.some((z) => z > a && z < b);
  const edge = 0.05;
  const piecesOf = (g) => (g.pieces && g.pieces.length ? g.pieces : [{ from: g.start, to: g.end, shot: -1 }]);
  const mids = bg.map((g) => piecesOf(g).map((p) => (p.from + p.to) / 2));
  const calm = bg.map((g, i) => {
    const before = i > 0 ? mids[i - 1][0] : g.start;
    const after = i + 1 < bg.length ? mids[i + 1][mids[i + 1].length - 1] : g.end;
    return !inside(Math.min(before, g.start), Math.max(after, g.end)) && !(g.pieces && g.pieces.length > 1);
  });
  const firstShot = (i) => piecesOf(bg[i])[0].shot;
  const lastShot = (i) => { const p = piecesOf(bg[i]); return p[p.length - 1].shot; };
  const urgent = bg.map((g, i) => !calm[i] || (i > 0 && firstShot(i) !== lastShot(i - 1)));
  const evenly = (list, n) => {                                // n of the list, spread over it (n = 1: the middle one)
    if (n >= list.length) return list.slice();
    if (n <= 0) return [];
    if (n === 1) return [list[Math.floor((list.length - 1) / 2)]];
    return Array.from({ length: n }, (_, k) => list[Math.round((k * (list.length - 1)) / (n - 1))]);
  };
  const midItems = (i) => piecesOf(bg[i]).map((p) => ({ id: bg[i].id, t: r3((p.from + p.to) / 2), kind: "mid", line: i }));
  const byTime = (a, b) => a.t - b.t;
  const A = bg.flatMap((g, i) => (urgent[i] ? midItems(i) : [])).sort(byTime);
  let chosen = evenly(A, cap);
  if (A.length <= cap) {
    const B = bg.map((g, i) => i).filter((i) => !urgent[i]);
    const left = cap - A.length;
    const groups = new Map();                                  // shot -> [line index]
    for (const i of B) { const k = firstShot(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
    if (B.length <= left) chosen = chosen.concat(B.flatMap(midItems));
    else {
      const quota = new Map();
      let used = 0;
      for (const [k, list] of groups) { const q = Math.floor((left * list.length) / B.length); quota.set(k, q); used += q; }
      const order = [...groups].map(([k, list]) => [k, (left * list.length) / B.length - quota.get(k)]).sort((a, b) => b[1] - a[1]);
      for (let n = 0; used < left && n < order.length; n++, used++) quota.set(order[n][0], quota.get(order[n][0]) + 1);
      for (const [k, list] of groups) chosen = chosen.concat(evenly(list, quota.get(k)).flatMap(midItems));
    }
    // (c) start and end of a long line or one crossing a zoom time, while the cap has room for both
    const have = new Set(chosen.map((m) => m.line));
    const extras = [];
    for (const i of [...bg.keys()].sort((a, b) => (urgent[b] ? 1 : 0) - (urgent[a] ? 1 : 0) || a - b)) {
      if (!have.has(i)) continue;
      for (const p of piecesOf(bg[i])) {
        if (p.to - p.from > 1.2 || inside(p.from, p.to)) extras.push([{ id: bg[i].id, t: r3(p.from + edge), kind: "start", line: i }, { id: bg[i].id, t: r3(p.to - edge), kind: "end", line: i }]);
      }
    }
    for (const pair of extras) if (chosen.length + 2 <= cap) chosen = chosen.concat(pair);
  }
  return chosen.sort(byTime).map(({ id, t, kind }) => ({ id, t, kind }));
}

// graphics [{id, start, end, center, motionY, lines?, span?, pieces: [{from, to, shot}]}], shots, perLine (Map or object:
// graphic id -> [{t, faces, text, own}], the line's frames at its moments), lane {top, k} from laneFor() -- or
// {reshape: true, rule?} for ReShape -- frame -> plan()'s output shape ({id, role, why, targetCenter, motionY, keys?}) plus
// `reason` (lane | under a face | off text | zoom brought a face | no free place), `flag` (a line with no free place), and
// `top` (`tops` per piece over a cut) and `chin` (the shot's worst-case chin, null with none; the fit in scripts/placement_replay.py reads it). A line over a cut gets keys as in plan(): its shot's height until one frame before
// the cut, the next shot's from it. ReShape mode: the base is shotTop() unchanged, then the same per-line collision moves;
// where nothing collides the output equals plan()'s. opts.base: "first" (default; the base is worked out from the first
// measured line of the shot, so a later zoom is a collision of that line, not a lower shot) | "all" (every measured frame).
function planLanes(graphics, shots, perLine, lane, frame = 1 / 30, opts = {}) {
  const reshape = !!(lane && lane.reshape);
  const rule = reshape ? (lane.rule || RULE) : RULE;
  const L = reshape ? null : (lane || LANES.default);
  const lh = reshape ? rule.lineHeight : LANE_RULE.lineHeight;
  const framesOf = (id) => (perLine instanceof Map ? perLine.get(id) : perLine ? perLine[id] : null) || [];
  const rl = new Map(roles(graphics).map((r) => [r.id, r.role]));
  const mate = new Map();                                                // Bulgarian id -> its English graphic
  for (const g of graphics) {
    if (rl.get(g.id) !== "en") continue;
    const bg = graphics.find((h) => rl.get(h.id) === "bg" && !mate.has(h.id) && Math.abs(h.start - g.start) <= SAME_TIME && Math.abs(h.end - g.end) <= SAME_TIME);
    if (bg) mate.set(bg.id, g);
  }
  const piecesOf = (g) => (g.pieces && g.pieces.length ? g.pieces : [{ from: g.start, to: g.end, shot: -1 }]);
  const bgs = graphics.filter((g) => rl.get(g.id) === "bg");
  const items = [];                                                      // every piece of every Bulgarian line
  for (const g of bgs) piecesOf(g).forEach((p, pi) => {
    const fr = framesOf(g.id).filter((f) => f.t >= p.from && f.t < p.to);
    items.push({ g, p, pi, fr });
  });
  items.sort((a, b) => a.p.from - b.p.from || a.pi - b.pi);

  // the base of every shot
  const bases = shots.map((s, i) => {
    const mine = items.filter((it) => it.p.shot === i && it.fr.length);
    // ReShape: opts.shotFaces [[faces per frame]] per shot = the frames of the older rule (moments(): up to 3 per shot), so the
    // shot's base height is exactly what shotTop() gave there; the per-line frames then only feed the collision checks
    if (reshape) return shotTop(opts.shotFaces ? opts.shotFaces[i] : mine.flatMap((it) => it.fr.map((f) => f.faces || [])), rule);
    const use = opts.base === "all" ? mine : mine.slice(0, 1);
    return shotBase(use.flatMap((it) => it.fr.map((f) => f.faces || [])), L, opts.minFace === undefined ? LANE_RULE.minFace : opts.minFace);
  });
  // the first measured frame of each shot: the base is taken there, so a zoom keyframe after it (and up to the line) explains a drop
  const baseT = shots.map((s, i) => {
    const mine = items.filter((it) => it.p.shot === i && it.fr.length);
    return mine.length ? Math.min(...mine[0].fr.map((f) => f.t)) : undefined;
  });
  const noClip = reshape ? { top: rule.middle, why: "no clip under the line" } : { top: L.top, why: "lane" };

  const res = new Map();                                                 // `${id}:${piece}` -> {top, reason, flag}
  const drop = new Map();                                                // shot -> {y, reason} while a line is dropped
  for (const it of items) {
    const { g, p, pi, fr } = it;
    const b = p.shot >= 0 ? bases[p.shot] : noClip;
    const nBg = g.lines || 1;
    const nEn = mate.has(g.id) ? (mate.get(g.id).lines || 1) : 0;
    const box = { x0: g.span ? g.span.x0 : undefined, x1: g.span ? g.span.x1 : undefined, h: (nBg + nEn) * lh };
    if (reshape) {
      box.hBg = nBg * lh;
      if (nEn) box.parts = [{ off: 0, h: nBg * lh }, { off: (nBg - 1) * lh + rule.englishGap, h: nEn * lh }];
    }
    if (!g.span && fr.length) {
      const own = fr.flatMap((f) => f.own || []);
      if (own.length) { box.x0 = Math.min(...own.map((o) => o.x)); box.x1 = Math.max(...own.map((o) => o.x + o.w)); }
    }
    const st = p.shot >= 0 ? drop.get(p.shot) || null : null;
    let r;
    if (p.shot < 0 || !fr.length) {
      r = st ? { y: st.y, reason: st.reason, flag: false, moved: true } : { y: b.top, reason: b.why, flag: !!b.flag, moved: false };
    } else {
      const lp = reshape ? { k: rule.underChin, minTop: rule.top, maxTop: rule.bottom } : L;
      r = lineHeight(b.top, fr, box, lp, st ? st.y : null, { reshape, baseReason: b.why, baseFlag: b.flag, prevReason: st ? st.reason : undefined, minFace: opts.minFace });
    }
    // a face that came into the lane is "a zoom's" only when a zoom keyframe lies within the line or between the shot's base frame
    // and the line (opts.zooms, seconds); otherwise the person moved. Without opts.zooms the reason stays as lineHeight() gave it.
    if (opts.zooms && r.moved && r.reason === "zoom brought a face" && p.shot >= 0) {
      const lo = Math.min(baseT[p.shot] === undefined ? p.from : baseT[p.shot], p.from);
      if (!opts.zooms.some((z) => z >= lo - 1e-6 && z <= p.to + 1e-6)) r = { ...r, reason: "face moved in" };
    }
    if (p.shot >= 0) {
      if (r.moved) drop.set(p.shot, { y: r.y, reason: r.reason });
      else drop.delete(p.shot);
    }
    res.set(`${g.id}:${pi}`, { top: r.y, reason: r.reason, flag: !!r.flag, why: b.why, chin: b.chin === undefined ? null : b.chin });
  }

  const r4 = (v) => Math.round(v * 10000) / 10000;
  return graphics.map((g) => {
    const role = rl.get(g.id) || "bg";
    const bgG = role === "en" ? [...mate.entries()].find(([, e]) => e.id === g.id) : null;
    const owner = role === "en" ? (bgG ? graphics.find((h) => h.id === bgG[0]) : g) : g;
    const nBg = owner.lines || 1;
    const nMine = g.lines || 1;
    const pieces = piecesOf(g);
    const ownerPieces = piecesOf(owner);
    const ys = pieces.map((p, i) => {
      const o = res.get(`${owner.id}:${Math.min(i, ownerPieces.length - 1)}`) || { top: noClip.top, reason: noClip.why, flag: false, why: noClip.why };
      const first = o.top + lh / 2;
      const target = role === "en" ? first + (nBg - 1) * lh + rule.englishGap + (nMine - 1) * lh / 2 : first + (nMine - 1) * lh / 2;
      return { target, why: o.why, reason: o.reason, flag: o.flag, top: o.top, chin: o.chin === undefined ? null : o.chin, y: r4(g.motionY + target - g.center) };
    });
    const out = { id: g.id, role, why: ys[0].why, targetCenter: Math.round(ys[0].target * 1000) / 1000, motionY: ys[0].y, reason: ys[0].reason, flag: ys.some((v) => v.flag), top: ys[0].top, chin: ys[0].chin };
    if (pieces.length > 1) out.tops = ys.map((v) => v.top);
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

// calibrate() with the line count: offsets per role AND number of lines (a chunk of two lines is centred lower than one of
// one line), falling back to the role's median, then to the Bulgarian lines'. lineCount: Map id -> 1 | 2
function calibrateByCount(graphics, measured, lineCount) {
  const seen = graphics.map((g) => ({ ...g, center: measured.has(g.id) ? measured.get(g.id) : g.center }));
  const role = new Map(roles(seen).map((r) => [r.id, r.role]));
  const cnt = (id) => (lineCount.get(id) >= 2 ? 2 : 1);
  const byKey = {};
  const byRole = { bg: [], en: [] };
  for (const g of graphics) {
    if (!measured.has(g.id)) continue;
    const o = measured.get(g.id) - g.motionY;
    const key = `${role.get(g.id)}${cnt(g.id)}`;
    (byKey[key] = byKey[key] || []).push(o);
    byRole[role.get(g.id)].push(o);
  }
  const medKey = {};
  for (const k of Object.keys(byKey)) medKey[k] = median(byKey[k]);
  const medRole = { bg: median(byRole.bg), en: median(byRole.en) };
  return seen.map((g) => {
    if (measured.has(g.id)) return { ...g, est: false };
    const r = role.get(g.id);
    let o = medKey[`${r}${cnt(g.id)}`];
    if (o === undefined) o = medRole[r];
    if (o === null || o === undefined) o = medRole.bg;
    return o === null || o === undefined ? { ...g, est: true } : { ...g, center: g.motionY + o, est: false };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The press (premiere-placement.js): which rule runs, zoom times, the result text. All pure.

// a clip's keyframe times (seconds in the clip's own media time, as Premiere reports them: Phase 0 P-A2 of the pre-export check)
// -> sequence seconds strictly inside the clip's span. clip {start, end, inPt, speed, reversed}.
function keySeconds(clip, keys) {
  const speed = clip.speed > 0 ? clip.speed : 1;
  const inPt = clip.inPt || 0;
  // a reversed clip plays its media backwards: its In point is at the clip's END, so a keyframe is placed from the out side
  const at = clip.reversed ? (t) => clip.end - (t - inPt) / speed : (t) => clip.start + (t - inPt) / speed;
  return (keys || []).map(at).filter((t) => Number.isFinite(t) && t > clip.start + 1e-6 && t < clip.end - 1e-6);
}

// several lists of seconds -> one sorted list, times closer than `tol` counted once
function mergeTimes(lists, tol = 0.001) {
  const all = lists.flat().filter(Number.isFinite).sort((a, b) => a - b);
  const out = [];
  for (const t of all) if (!out.length || t - out[out.length - 1] > tol) out.push(r3(t));
  return out;
}

// the zoom times of a sequence: clips [{start, end, inPt, speed, keys: [media seconds]}] (the clips under the lines and the
// adjustment layers over them, each with the keyframe times of its Scale / Position / Transform) -> sequence seconds
function zoomSeconds(clips) {
  return mergeTimes((clips || []).map((c) => keySeconds(c, c.keys)));
}

// how many rows each graphic's SRT block has (a chunk of two rows is centred lower than one of one row), from the engine's
// `lines` ({graphic id: {bg: [rows], en: [rows]}}, known for every graphic sent, measured or not) and the roles
// -> Map id -> 1 | 2, only for graphics whose rows are known
function lineCountsOf(graphics, rows) {
  const role = new Map(roles(graphics).map((r) => [r.id, r.role]));
  const out = new Map();
  for (const g of graphics) {
    const r = rows instanceof Map ? rows.get(g.id) : rows ? rows[g.id] : null;
    if (!r) continue;
    const n = (r[role.get(g.id)] || r.bg || r.en || []).length;
    if (n > 0) out.set(g.id, n >= 2 ? 2 : 1);
  }
  return out;
}

const LANE_LABELS = { gstroy: "GStroy", credissimo: "Credissimo", ekopak: "ЕКОПАК", beautysector: "Beauty Sector", aula: "AULA" };

// the Style's lane name: its own, or "default" (Auto, ReShape's rule aside, and every style without a lane)
function laneName(preset) {
  const key = String(preset === undefined || preset === null ? "" : preset).toLowerCase();
  return Object.prototype.hasOwnProperty.call(LANES, key) && key !== "default" ? key : "default";
}

// which rule a press runs. 16:9 (wider than high) and an unknown frame size keep today's rule (plan(), unchanged: there is no
// 16:9 data for lanes yet). Otherwise the style is the newest run's (the engine reads it from the run JSON) or, without a run,
// the panel's Style; ReShape (the engine says so, or the style is reshape) keeps its own base rule with the same per-line
// collision moves; every other style gets its lane. o {width, height, preset (the run's), style (the panel's), reshape}
// -> {path: "legacy" | "reshape" | "lanes", why, preset, lane?, name?}
function choosePath(o = {}) {
  const w = Number(o.width);
  const h = Number(o.height);
  if (!(w > 0) || !(h > 0)) return { path: "legacy", why: "unknown size" };
  if (w > h) return { path: "legacy", why: "16:9" };
  const preset = String(o.preset || o.style || "").toLowerCase();
  if (o.reshape || preset === "reshape") return { path: "reshape", why: "ReShape", preset: "reshape" };
  const name = laneName(preset);
  return { path: "lanes", why: "lane", preset, name, label: LANE_LABELS[name] || "default", lane: laneFor(name) };
}

// planLanes()'s output + the graphics as they are now (Map id -> {motionY, animated}) -> {changes, stuck, unchanged}: what is
// written, the lines with no free place (left exactly where they are: not written, not counted as moved; nothing uncertain is
// applied), and how many were already in place
function selectChanges(placed, current) {
  const stuck = placed.filter((p) => p.flag);
  const changes = placed.filter((p) => {
    if (p.flag) return false;
    const c = current.get(p.id);
    return !!(p.keys || (c && c.animated) || (c && Math.abs(p.motionY - c.motionY) >= 0.001));
  });
  return { changes, stuck, unchanged: placed.length - changes.length - stuck.length };
}

// planLanes()'s output (+ graphics [{id, start}]) -> counts of the Bulgarian lines per reason, and the times of the two
// kinds the editor must look at
function reasonCounts(placed, graphics) {
  const start = new Map((graphics || []).map((g) => [g.id, g.start]));
  const out = { lane: 0, underFace: 0, offText: 0, zoom: 0, faceIn: 0, noPlace: 0, zoomAt: [], faceInAt: [], noPlaceAt: [] };
  for (const p of placed || []) {
    if (p.role === "en") continue;
    const t = start.get(p.id);
    if (p.flag || p.reason === "no free place") { out.noPlace++; if (t !== undefined) out.noPlaceAt.push(r3(t)); }
    else if (p.reason === "zoom brought a face") { out.zoom++; if (t !== undefined) out.zoomAt.push(r3(t)); }
    else if (p.reason === "face moved in") { out.faceIn++; if (t !== undefined) out.faceInAt.push(r3(t)); }
    else if (p.reason === "off text") out.offText++;
    else if (p.reason === "under a face") out.underFace++;
    else out.lane++;
  }
  out.zoomAt.sort((a, b) => a - b);
  out.faceInAt.sort((a, b) => a - b);
  out.noPlaceAt.sort((a, b) => a - b);
  return out;
}

const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const some = (times, n = 5) => `${times.slice(0, n).map(clock).join(", ")}${times.length > n ? `, and ${times.length - n} more` : ""}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// the result of a lane or ReShape press (premiere-placement.js moveOffFaces) -> {headline, lines: [{cls, text}]}
// r {mode: "lanes" | "reshape", moved, total, label, laneTop, reasons, kept, shots, unchanged, measured, estimated, ocr, overCuts, pairs}
function describe(r) {
  const lines = [];
  const c = { lane: 0, underFace: 0, offText: 0, zoom: 0, faceIn: 0, noPlace: 0, zoomAt: [], faceInAt: [], noPlaceAt: [], ...(r.reasons || {}) };
  const pct = (v) => `${Math.round(v * 100)}%`;
  if (r.nothingMeasured) return { headline: "Nothing was measured: no line moved.", lines: [{ cls: "warn", text: "No frame could be exported and read, so nothing was written. Try again; the log has the details." }] };
  const headline = r.moved ? `Moved ${r.moved} of ${r.total} lines. One Cmd/Ctrl+Z undoes it.` : "Nothing to move.";
  if (r.mode === "reshape") lines.push({ cls: "muted", text: "ReShape: its own height under the speaker, with the same moves off a face or on-screen text." });
  if (c.lane) lines.push({ cls: "", text: r.mode === "reshape" ? `${plural(c.lane, "line", "lines")} at the shot's own height.`
    : `${plural(c.lane, "line", "lines")} in the ${r.label} lane (top ${pct(r.laneTop)}).` });
  if (c.underFace) lines.push({ cls: "", text: `${plural(c.underFace, "line", "lines")} under a face.` });
  if (c.offText) lines.push({ cls: "", text: `${plural(c.offText, "line", "lines")} moved off on-screen text.` });
  if (c.zoom) lines.push({ cls: "", text: `${plural(c.zoom, "line", "lines")} dropped because a zoom brought a face into the lane (${some(c.zoomAt)}).` });
  if (c.faceIn) lines.push({ cls: "", text: `${plural(c.faceIn, "line", "lines")} dropped because a face moved into the lane (${some(c.faceInAt)}).` });
  if (c.noPlace) lines.push({ cls: "warn", text: `${plural(c.noPlace, "line", "lines")} with no free place: left where they were, check (${some(c.noPlaceAt)}).` });
  if (r.moved && r.moved <= r.total / 2 && c.lane) lines.push({ cls: "muted", text: `The lane was free on ${plural(c.lane, "line", "lines")}.` });
  if ((r.kept || []).length) {
    const by = {};
    for (const k of r.kept) by[k.why] = (by[k.why] || 0) + 1;
    lines.push({ cls: "warn", text: `Left alone: ${Object.entries(by).map(([k, n]) => `${n} ${k === "moved by hand" ? "moved by hand" : k === "Position has keyframes" ? "keyframed" : k}`).join(", ")}.` });
  }
  for (const s of (r.shots || []).slice(0, 8)) {
    const seen = s.frames ? `face in ${s.withFace} of ${s.frames} frames` : "no frames measured";
    lines.push({ cls: "muted", text: `${s.name}, ${clock(s.start)}–${clock(s.end)}: ${s.why}, ${seen}, ${plural(s.lines, "line", "lines")}.` });
  }
  if ((r.shots || []).length > 8) lines.push({ cls: "muted", text: `…and ${r.shots.length - 8} more shots (all in the log).` });
  if (r.pairs) lines.push({ cls: "", text: `${r.pairs} English lines kept under their Bulgarian lines.` });
  if (r.overCuts) lines.push({ cls: "", text: `${r.overCuts} lines run over a cut: they change height at the cut (Position keyframes).` });
  if (r.unchanged) lines.push({ cls: "muted", text: `${r.unchanged} lines were already in place.` });
  if (r.ocr === false) lines.push({ cls: "warn", text: "Text recognition is not available here: only faces were checked, not on-screen text." });
  if (r.estimated) lines.push({ cls: "warn", text: `Where the text sits could not be read on the frames: ${r.estimated} lines placed by an estimate (check them).` });
  else if (r.measured) lines.push({ cls: "muted", text: `Text position read on ${r.measured} lines (the others follow them).` });
  lines.push({ cls: "muted", text: "Hands and products are not detected." });
  return { headline, lines };
}

module.exports = {
  RULE, mainFace, shotTop, roles, cover, moments, plan, movable, median, calibrate,
  LANES, LANE_RULE, laneFor, obstacles, shotChin, shotBase, lineHeight, momentsPerLine, planLanes,
  keySeconds, mergeTimes, zoomSeconds, lineCountsOf, selectChanges, laneName, choosePath, reasonCounts, describe, LANE_LABELS,
};
