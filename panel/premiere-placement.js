// "Move off faces" in Premiere (2026-11 improvements, TODO R.5): the selected subtitle graphics (after the editor's right-click >
// Upgrade Caption to Graphic) move to the client's height per shot, under the speaker's chin or above a low face, in one Undo
// step. Only Motion > Position is written (a PointF, verified 2026-11-04); text, style and timing are never touched, a graphic
// with Position keyframes or moved by hand is left alone. The rule itself is placementplan.js (pure, node-tested).
// Two rules (2026-11-22): 9:16 and other non-landscape sequences use the client's LANE (the Style's height, a line moves only when a
// face or other on-screen text collides with it, also after a zoom; ReShape keeps its own base height plus the same collision
// moves); 16:9 sequences keep the older per-shot rule (moveLegacy, unchanged: there is no 16:9 data for lanes yet).
const store = require("./store.js");
const ppro = require("premierepro");
const { transaction, maybe, readTimeline } = require("./premiere.js");
const { exportFrames } = require("./premiere-color.js");
const engine = require("./engine.js");
const placementplan = require("./placementplan.js");

// a parameter value as {x, y}: 26.0.2 hands Position back wrapped once or twice ({value: {value: [x, y]}})
function point(v) {
  let o = v;
  for (let i = 0; i < 4 && o && !Array.isArray(o) && o.x === undefined; i++) o = o.value;
  if (Array.isArray(o)) return { x: Number(o[0]), y: Number(o[1]) };
  if (o && o.x !== undefined) return { x: Number(o.x), y: Number(o.y) };
  return null;
}

function number(v) {
  let o = v;
  for (let i = 0; i < 4 && o !== null && typeof o === "object"; i++) o = o.value;
  return typeof o === "number" ? o : null;
}

async function paramsOf(ti) {
  const chain = await ti.getComponentChain();
  const out = {};
  for (let i = 0; i < (await chain.getComponentCount()); i++) {
    const comp = await chain.getComponentAtIndex(i);
    const match = (await maybe(comp, "getMatchName")) || "";
    for (let j = 0; j < (await comp.getParamCount()); j++) {
      const prm = await comp.getParam(j);
      out[`${match}|${prm.displayName}`] = prm;
    }
  }
  return out;
}

// the selected text graphics with their place: {id, ti, start, end, track, motion (param), motionX/Y, center, animated}
async function selectedGraphics(timeline) {
  const out = [];
  for (const it of timeline.items) {
    if (it.kind !== "video" || !it.selected || it.path) continue;
    const ps = await paramsOf(it.ti);
    if (!ps["AE.ADBE Text|Source Text"] || !ps["AE.ADBE Motion|Position"]) continue;          // not a text graphic
    const motion = ps["AE.ADBE Motion|Position"];
    const m = point(await motion.getStartValue());
    const anchor = point(await maybe(ps["AE.ADBE Motion|Anchor Point"], "getStartValue")) || { x: 0.5, y: 0.5 };
    const scale = number(await maybe(ps["AE.ADBE Motion|Scale"], "getStartValue")) || 100;
    const text = point(await maybe(ps["AE.ADBE Text|Position"], "getStartValue")) || { x: 0.5, y: 0.5 };
    const vector = point(await maybe(ps["AE.ADBE Graphic Group|Position"], "getStartValue")) || { x: 0.5, y: 0.5 };
    if (!m) continue;
    // where the text sits on screen: the layer's own offsets carried by Motion (Premiere does not tell a script the text's box;
    // measured on the probe title: estimate 0.377, drawn centre 0.368 of the height)
    const center = m.y + ((text.y - anchor.y) + (vector.y - 0.5)) * (scale / 100);
    const animated = !!(await maybe(motion, "isTimeVarying"));
    const keyTimes = animated ? ((await maybe(motion, "getKeyframeListAsTickTimes")) || []).map((t) => Number(t.seconds) || 0) : null;
    out.push({ id: out.length, ti: it.ti, name: it.name, start: it.start, end: it.end, track: it.track, inPt: it.inPt || 0, motion,
      motionX: m.x, motionY: m.y, center, animated, keyTimes });
  }
  return out;
}

// the visible clips with media that are the picture: a file with transparency (a safe-zone template, a logo, a graphic) is a layer
// over the shot, not a shot (placementplan.pictureClips, 0.10.148). The engine reads the files' transparency (read only); if it
// cannot, every clip counts as before.
async function pictureClips(timeline) {
  const clips = timeline.items.filter((x) => x.kind === "video" && x.path && !x.unused && !x.hidden);
  let files = [];
  try {
    files = ((await engine.exportFrames([...new Set(clips.map((c) => c.path))])) || {}).items || [];
  } catch (e) {
    engine.log("warn", `move off faces: transparency of the clips not read (${e && e.message ? e.message : e}): every clip counts as a shot`);
  }
  const r = placementplan.pictureClips(clips, files);
  for (const name of new Set(r.overlays.map((c) => c.name))) engine.log("info", `move off faces: ${name} has transparency: a layer over the shots, not a shot`);
  return r.clips;
}

// the shots under the graphics: the picture clips seen during each line (two POVs cut against each other, or a new scene,
// split a line into pieces); one shot per clip. Sets g.pieces [{from, to, shot}] on every graphic.
function shotsUnder(clips, graphics) {
  const shots = [];
  for (const g of graphics) {
    g.pieces = placementplan.cover(g.start, g.end, clips).map((p) => {
      let shot = -1;
      if (p.clip) {
        shot = shots.indexOf(p.clip);
        if (shot < 0) shot = shots.push(p.clip) - 1;
      }
      return { from: p.from, to: p.to, shot };
    });
  }
  return shots.map((c) => ({ start: c.start, end: c.end, track: c.track, name: c.name }));
}

function writtenKey(seqKey) {
  return `asistent.placed.${seqKey}`;
}

function loadWritten(seqKey) {
  try {
    return JSON.parse(store.getItem(writtenKey(seqKey)) || "{}");
  } catch (e) {
    return {};
  }
}

function saveWritten(seqKey, map) {
  try {
    store.setItem(writtenKey(seqKey), JSON.stringify(map));
  } catch (e) {
    /* no storage: next time only Premiere's default position counts as Asistent's */
  }
}

const lineKey = (g) => `${g.track}|${g.start.toFixed(3)}|${g.end.toFixed(3)}`;

// the keyframe times of one clip's Scale / Position (Motion) and of any Transform effect (AE.ADBE Geometry2), in the clip's own time;
// read only, nothing that cannot be read breaks the press
const ZOOM_PARAM = /scale|position|rotation|anchor/i;
const ZOOM_COMP = /^AE\.ADBE (Motion|Geometry)/;

async function keyTimesOf(ti) {
  const out = [];
  const chain = await maybe(ti, "getComponentChain");
  if (!chain) return out;
  const count = (await maybe(chain, "getComponentCount")) || 0;
  for (let i = 0; i < count; i++) {
    const comp = await maybe(chain, "getComponentAtIndex", i);
    if (!comp) continue;
    const match = (await maybe(comp, "getMatchName")) || "";
    if (!ZOOM_COMP.test(match)) continue;
    const n = (await maybe(comp, "getParamCount")) || 0;
    for (let j = 0; j < n; j++) {
      const prm = await maybe(comp, "getParam", j);
      if (!prm || !ZOOM_PARAM.test(prm.displayName || "") || !(await maybe(prm, "isTimeVarying"))) continue;
      for (const t of (await maybe(prm, "getKeyframeListAsTickTimes")) || []) out.push(Number(t.seconds));
    }
  }
  return out.filter(Number.isFinite);
}

// the times (sequence seconds) where a zoom moves the picture under the lines: keyframes of the clip under each line (shots,
// from shotsUnder) and of the adjustment layers above it that overlap it
async function zoomTimes(timeline, shots) {
  const clips = [];
  const seen = new Set();
  const take = async (x) => {
    if (seen.has(x)) return;
    seen.add(x);
    const keys = await keyTimesOf(x.ti);
    if (keys.length) clips.push({ start: x.start, end: x.end, inPt: x.inPt || 0, speed: x.speed, reversed: !!x.reversed, keys });
  };
  for (const s of shots) {
    const clip = timeline.items.find((x) => x.kind === "video" && x.path && x.track === s.track
      && Math.abs(x.start - s.start) < 1e-6 && Math.abs(x.end - s.end) < 1e-6);
    if (clip) await take(clip);
    for (const a of timeline.items) {
      if (a.kind === "video" && a.adjustment && !a.unused && !a.hidden && a.track > s.track && a.start < s.end && a.end > s.start) await take(a);
    }
  }
  return placementplan.zoomSeconds(clips);
}

async function sequenceSize(sequence) {
  const f = await maybe(sequence, "getFrameSize");
  return { width: Number(f && f.width) || 0, height: Number(f && f.height) || 0 };
}

// opts: {style: the panel's Style value (used when the project has no subtitle run)}
// -> {moved, kept: [{name, why}], shots: [{why}], noGraphics} for the older rule (mode "legacy"); for a lane or ReShape press
// {mode, moved, total, label, laneTop, reasons, kept, shots, ...} (placementplan.describe makes the text)
async function moveOffFaces(project, onProgress = () => {}, opts = {}) {
  const timeline = await readTimeline(project);
  const graphics = await selectedGraphics(timeline);
  if (!graphics.length) return { noGraphics: true };
  const seqKey = (await maybe(timeline.sequence, "guid")) || timeline.sequence.guid || timeline.sequence.name || "sequence";
  const written = loadWritten(String(seqKey));
  const kept = [];
  const usable = graphics.filter((g) => {
    const m = placementplan.movable(g, written[lineKey(g)]);
    if (!m.ok) kept.push({ name: g.name, start: g.start, why: m.why });
    return m.ok;
  });
  if (!usable.length) return { moved: 0, kept, shots: [] };
  const size = await sequenceSize(timeline.sequence);
  const first = placementplan.choosePath({ ...size, style: opts.style });
  const ctx = { timeline, usable, kept, written, seqKey };
  if (first.path === "legacy") {
    const r = await moveLegacy(project, onProgress, ctx);
    return { ...r, mode: "legacy", note: first.why === "16:9" ? "16:9 sequence: the older rule was used (no 16:9 data for lanes yet)." : "The sequence size could not be read: the older rule was used." };
  }
  return moveLanes(project, onProgress, ctx, size, opts);
}

// a keyframe's time counts from the clip's own start (its In point), not from the sequence
const rel = (g, t) => t - g.start + g.inPt;

// the single transaction (one Undo) that writes the changes, the `written` record and the read-back log of a line over a cut
async function writeChanges(project, changes, byId, written, seqKey) {
  if (!changes.length) return;
  // transaction() throws when Premiere refuses (it returns nothing): 0.10.12 read the missing return value as a refusal and
  // reported "nothing changed" after the lines had moved (NEW TEST, 2026-11-09)
  transaction(project, "Asistent: move subtitles off faces", (c) => {
    for (const p of changes) {
      const g = byId.get(p.id);
      if (g.animated) c.addAction(g.motion.createSetTimeVaryingAction(false));      // Asistent's own earlier keyframes go
      if (p.keys) {                                                                // a line over a cut: its height per shot
        c.addAction(g.motion.createSetTimeVaryingAction(true));
        for (const [t, y] of p.keys) {
          const kf = g.motion.createKeyframe(new ppro.PointF(g.motionX, y));
          kf.position = ppro.TickTime.createWithSeconds(rel(g, t));
          c.addAction(g.motion.createAddKeyframeAction(kf));
        }
      } else {
        c.addAction(g.motion.createSetValueAction(g.motion.createKeyframe(new ppro.PointF(g.motionX, p.motionY)), true));
      }
    }
  });
  for (const p of changes) {
    const g = byId.get(p.id);
    written[lineKey(g)] = p.keys ? { x: g.motionX, keys: p.keys.map(([t]) => Math.round(rel(g, t) * 1000) / 1000) }
      : { x: g.motionX, y: p.motionY };
  }
  // read back the keyframes of one line over a cut (time base check, logged)
  const keyed = changes.find((p) => p.keys);
  if (keyed) {
    const g = byId.get(keyed.id);
    const got = ((await maybe(g.motion, "getKeyframeListAsTickTimes")) || []).map((t) => (Number(t.seconds) || 0).toFixed(3));
    engine.log("info", `move off faces: keyframes asked ${keyed.keys.map(([t]) => rel(g, t).toFixed(3)).join(", ")}, got ${got.join(", ")} (In ${g.inPt.toFixed(3)})`);
  }
  saveWritten(String(seqKey), written);
}

async function moveLegacy(project, onProgress, ctx) {
  const { timeline, usable, kept, written, seqKey } = ctx;
  const shots = shotsUnder(await pictureClips(timeline), usable);
  const when = placementplan.moments(shots, usable);
  const frames = [];
  when.forEach((list, i) => list.forEach((seconds, k) => frames.push({ shot: i, name: `face_${i}_${k}.png`, seconds })));
  onProgress(0.2, `Looking for faces in ${shots.length} shots…`);
  const dir = (await engine.status()).frames_dir;
  // 1080 px on the long side: the subtitle's letters must be readable for the text recognition (faces are found at any size)
  const paths = frames.length ? await exportFrames(timeline.sequence, frames, dir, null, 1080) : [];
  const sent = paths.map((p, i) => (p ? { path: p, t: frames[i].seconds } : null)).filter(Boolean);
  const measured = sent.length ? (await engine.captionFaces(sent, project.path,
    usable.map((g) => ({ id: g.id, start: g.start, end: g.end })))).frames : [];
  const facesPerShot = shots.map(() => []);
  const centers = new Map();
  const found = new Map();
  let m = 0;
  paths.forEach((p, i) => {
    if (!p) return;
    const r = measured[m++];
    if (r && r.faces) facesPerShot[frames[i].shot].push(r.faces);
    for (const [id, ys] of Object.entries((r && r.text) || {})) if (!found.has(Number(id))) found.set(Number(id), ys);
  });
  // each graphic's own line: alone at its times it is the Bulgarian line (or the English one if only that was found); in a
  // Bulgarian/English pair the roles decide (the lower one, else the higher track, is English)
  const role = new Map(placementplan.roles(usable).map((x) => [x.id, x.role]));
  for (const [id, ys] of found) {
    const g = usable.find((x) => x.id === id);
    const paired = usable.some((x) => x.id !== id && Math.abs(x.start - g.start) <= 0.05 && Math.abs(x.end - g.end) <= 0.05);
    const y = paired ? ys[role.get(id)] : (ys.bg !== undefined ? ys.bg : ys.en);
    if (typeof y === "number") centers.set(id, y);
  }

  onProgress(0.8, "Moving the lines…");
  // where the letters really are (an upgraded caption keeps its text near the bottom whatever Position says): measured
  const calibrated = placementplan.calibrate(usable, centers);
  const estimated = calibrated.filter((g) => g.est).length;
  for (const g of calibrated) g.pieces = usable.find((u) => u.id === g.id).pieces;
  const placed = placementplan.plan(calibrated, shots, facesPerShot, placementplan.RULE, 1 / (timeline.fps || 30));
  const byId = new Map(usable.map((g) => [g.id, g]));
  const changes = placed.filter((p) => p.keys || byId.get(p.id).animated || Math.abs(p.motionY - byId.get(p.id).motionY) >= 0.001);
  await writeChanges(project, changes, byId, written, seqKey);
  const framesPerShot = shots.map((s, i) => frames.filter((f) => f.shot === i).length);
  const tops = shots.map((s, i) => ({ ...placementplan.shotTop(facesPerShot[i]), name: s.name, start: s.start, end: s.end,
    frames: framesPerShot[i], withFace: facesPerShot[i].filter((f) => (f || []).length).length,
    lines: usable.filter((g) => (g.pieces || []).some((p) => p.shot === i)).length }));
  for (const t of tops) {
    engine.log("info", `move off faces: shot ${t.name} ${t.start.toFixed(2)}-${t.end.toFixed(2)}: ${t.why}, top ${t.top}, ` +
      `face in ${t.withFace} of ${t.frames} frames, ${t.lines} lines`);
  }
  return { moved: changes.length, unchanged: placed.length - changes.length, kept, shots: tops,
    pairs: placed.filter((p) => p.role === "en").length, measured: centers.size, estimated,
    overCuts: changes.filter((p) => p.keys).length };
}

// the engine's boxes of one graphic's own lines {bg|en: {top, bottom, x, w}} -> [{x, y, w, h}]
function ownBoxes(b) {
  return Object.values(b || {}).filter((o) => o && o.bottom > o.top && o.w > 0).map((o) => ({ x: o.x, y: o.top, w: o.w, h: o.bottom - o.top }));
}

// the lane (or ReShape) press: every line stays in its lane (ReShape: at its shot's own height) and moves only where a face or other
// on-screen text collides with it in its own frames, also after a zoom (placementplan.planLanes). Frames are the lines' own
// moments (momentsPerLine), exported once at 1080 px; one transaction, one Undo, as the older rule.
async function moveLanes(project, onProgress, ctx, size, opts) {
  const { timeline, usable, kept, written, seqKey } = ctx;
  const shots = shotsUnder(await pictureClips(timeline), usable);
  onProgress(0.1, "Reading the zooms…");
  const zooms = await zoomTimes(timeline, shots);
  const graphicsArg = usable.map((g) => ({ id: g.id, start: g.start, end: g.end }));
  // no frames yet: the engine only says which style the newest subtitle run had, whether this is a ReShape project, whether text
  // recognition exists, and the SRT rows of every graphic. The rule must be known BEFORE the frames are chosen.
  let info = {};
  try {
    info = (await engine.captionFaces([], project.path, graphicsArg)) || {};
  } catch (e) {
    engine.log("warn", `move off faces: the run's style could not be read (${e && e.message ? e.message : e}); the panel's Style is used`);
  }
  const pick = placementplan.choosePath({ ...size, preset: info.preset, style: opts.style, reshape: info.reshape });
  const reshape = pick.path === "reshape";

  // the frames: ReShape's shot base comes from the frames of the older rule (moments(): up to 3 per shot) so a shot's base height
  // is exactly shotTop's; the lines' own frames (a hard cap in all) feed the collision checks
  const CAP = 240;
  const frames = [];
  if (reshape) {
    placementplan.moments(shots, usable).forEach((list, i) => list.forEach((seconds, k) => frames.push({ kind: "base", shot: i, seconds, name: `face_${i}_${k}.png` })));
  }
  placementplan.momentsPerLine(usable, zooms, Math.max(0, CAP - frames.length))
    .forEach((mo, k) => frames.push({ kind: "line", id: mo.id, seconds: mo.t, name: `lane_${mo.id}_${k}.png` }));
  onProgress(0.2, `Looking for faces and text in ${frames.length} frames…`);
  const dir = (await engine.status()).frames_dir;
  const t0 = Date.now();
  // 1080 px on the long side: the subtitle's letters must be readable for the text recognition (faces are found at any size)
  const paths = frames.length ? await exportFrames(timeline.sequence, frames, dir, null, 1080) : [];
  const sent = paths.map((p, i) => (p ? { path: p, t: frames[i].seconds } : null)).filter(Boolean);
  const reply = sent.length ? await engine.captionFaces(sent, project.path, graphicsArg) : { frames: [] };
  const measured = reply.frames || [];

  const perLine = new Map();
  const ownSeen = new Set();
  const found = new Map();
  const rowsOf = {};
  const shotFaces = shots.map(() => []);
  const shotOf = (f) => {
    if (f.kind === "base") return f.shot;
    const g = usable.find((x) => x.id === f.id);
    const piece = ((g && g.pieces) || []).find((q) => q.from <= f.seconds && f.seconds < q.to);
    return piece ? piece.shot : -1;
  };
  const shotFrames = shots.map(() => ({ frames: 0, withFace: 0 }));
  let m = 0;
  let good = 0;
  paths.forEach((p, i) => {
    if (!p) return;
    const r = measured[m++];
    if (!r || r.error) return;
    good++;
    const f = frames[i];
    if (f.kind === "base") shotFaces[f.shot].push(r.faces || []);
    else {
      const own = ownBoxes(r.boxes && r.boxes[String(f.id)]);
      if (own.length) ownSeen.add(f.id);
      if (!perLine.has(f.id)) perLine.set(f.id, []);
      perLine.get(f.id).push({ t: f.seconds, faces: r.faces || [], text: r.other || [], own });
    }
    const sh = shotOf(f);
    if (sh >= 0) { shotFrames[sh].frames++; if ((r.faces || []).length) shotFrames[sh].withFace++; }
    for (const [gid, ys] of Object.entries(r.text || {})) if (!found.has(Number(gid))) found.set(Number(gid), ys);
    for (const [gid, rows] of Object.entries(r.lines || {})) if (!(gid in rowsOf)) rowsOf[gid] = rows;
  });
  engine.log("info", `move off faces: ${frames.length} frames (${sent.length} exported, ${good} measured) in ${((Date.now() - t0) / 1000).toFixed(1)} s, ` +
    `${zooms.length} zoom times, run style "${info.preset || ""}" (panel "${opts.style || ""}"), ReShape ${reshape ? "yes" : "no"}, ` +
    `text recognition ${info.ocr === false ? "off" : "on"}`);
  if (!good) {                                           // nothing measured: nothing is written (no guess is applied)
    engine.log("warn", "move off faces: nothing was measured, no line moved");
    return { mode: pick.path, nothingMeasured: true, moved: 0, total: usable.length, kept, shots: [] };
  }

  // each graphic's own line (a Bulgarian/English pair: the roles decide) and how many rows it has (from the SRT, every graphic)
  const role = new Map(placementplan.roles(usable).map((x) => [x.id, x.role]));
  const centers = new Map();
  for (const [id, ys] of found) {
    const g = usable.find((x) => x.id === id);
    if (!g) continue;
    const paired = usable.some((x) => x.id !== id && Math.abs(x.start - g.start) <= 0.05 && Math.abs(x.end - g.end) <= 0.05);
    const y = paired ? ys[role.get(id)] : (ys.bg !== undefined ? ys.bg : ys.en);
    if (typeof y === "number") centers.set(id, y);
  }
  const lineCount = placementplan.lineCountsOf(usable, { ...rowsOf, ...(info.lines || {}), ...(reply.lines || {}) });

  onProgress(0.8, "Moving the lines…");
  const calibrated = placementplan.calibrate(usable, centers, lineCount);
  const estimated = calibrated.filter((g) => g.est).length;
  for (const g of calibrated) {
    const u = usable.find((x) => x.id === g.id);
    g.pieces = u.pieces;
    g.lines = lineCount.get(g.id) || 1;
    // the line's own box was not read in any frame: the horizontal reach is unknown, take the middle of the frame
    if (role.get(g.id) === "bg" && !ownSeen.has(g.id)) g.span = { x0: 0.15, x1: 0.85 };
  }
  const lane = reshape ? { reshape: true } : pick.lane;
  const placed = placementplan.planLanes(calibrated, shots, perLine, lane, 1 / (timeline.fps || 30), { zooms, ...(reshape ? { shotFaces } : {}) });
  const byId = new Map(usable.map((g) => [g.id, g]));
  // a line with no free place is left exactly where it is (not written, not counted as moved): nothing uncertain is applied
  const { changes, unchanged } = placementplan.selectChanges(placed, byId);
  await writeChanges(project, changes, byId, written, seqKey);

  const reasons = placementplan.reasonCounts(placed, usable);
  const bgPlaced = new Map(placed.filter((p) => p.role === "bg").map((p) => [p.id, p]));
  const rows = shots.map((s, i) => {
    const mine = usable.filter((g) => bgPlaced.has(g.id) && (g.pieces || []).some((q) => q.shot === i));
    const first = mine.length ? bgPlaced.get(mine.sort((a, b) => a.start - b.start)[0].id) : null;
    return { name: s.name, start: s.start, end: s.end, why: first ? first.why : "lane", frames: shotFrames[i].frames,
      withFace: shotFrames[i].withFace, lines: mine.length };
  });
  const label = reshape ? "ReShape" : pick.label;
  engine.log("info", `move off faces: ${reshape ? "ReShape rule" : `${label} lane (top ${pick.lane.top}, k ${pick.lane.k})`}: ` +
    `${reasons.lane} in the lane, ${reasons.underFace} under a face, ${reasons.offText} off text, ${reasons.zoom} dropped by a zoom, ` +
    `${reasons.faceIn} dropped by a face that moved in, ${reasons.noPlace} with no free place (left untouched); moved ${changes.length} of ${usable.length}`);
  for (const t of reasons.zoomAt) engine.log("info", `move off faces: a zoom brought a face into the lane: line at ${t.toFixed(2)} s dropped`);
  for (const t of reasons.faceInAt) engine.log("info", `move off faces: a face moved into the lane: line at ${t.toFixed(2)} s dropped`);
  for (const t of reasons.noPlaceAt) engine.log("info", `move off faces: no free place for the line at ${t.toFixed(2)} s: left untouched, check`);
  for (const t of rows) {
    engine.log("info", `move off faces: shot ${t.name} ${t.start.toFixed(2)}-${t.end.toFixed(2)}: ${t.why}, ` +
      `face in ${t.withFace} of ${t.frames} frames, ${t.lines} lines`);
  }
  return { mode: pick.path, moved: changes.length, total: usable.length, unchanged, kept, shots: rows,
    label, laneTop: reshape ? null : pick.lane.top, reasons, pairs: placed.filter((p) => p.role === "en").length,
    measured: centers.size, estimated, ocr: info.ocr === undefined ? reply.ocr : info.ocr, overCuts: changes.filter((p) => p.keys).length, preset: pick.preset };
}

module.exports = { moveOffFaces, zoomTimes, shotsUnder, point, number };
