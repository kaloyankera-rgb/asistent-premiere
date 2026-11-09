// "Move off faces" in Premiere (2026-11 improvements, TODO R.5): the selected subtitle graphics (after the editor's right-click >
// Upgrade Caption to Graphic) move to the client's height per shot, under the speaker's chin or above a low face, in one Undo
// step. Only Motion > Position is written (a PointF, verified 2026-11-04); text, style and timing are never touched, a graphic
// with Position keyframes or moved by hand is left alone. The rule itself is placementplan.js (pure, node-tested).
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

// the shots under the graphics: the visible clips with media seen during each line (two POVs cut against each other, or a
// new scene, split a line into pieces); one shot per clip. Sets g.pieces [{from, to, shot}] on every graphic.
function shotsUnder(timeline, graphics) {
  const clips = timeline.items.filter((x) => x.kind === "video" && x.path && !x.unused && !x.hidden);
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
    return JSON.parse(localStorage.getItem(writtenKey(seqKey)) || "{}");
  } catch (e) {
    return {};
  }
}

function saveWritten(seqKey, map) {
  try {
    localStorage.setItem(writtenKey(seqKey), JSON.stringify(map));
  } catch (e) {
    /* no storage: next time only Premiere's default position counts as Asistent's */
  }
}

const lineKey = (g) => `${g.track}|${g.start.toFixed(3)}|${g.end.toFixed(3)}`;

// -> {moved, kept: [{name, why}], shots: [{why}], noGraphics}
async function moveOffFaces(project, onProgress = () => {}) {
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

  const shots = shotsUnder(timeline, usable);
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
  // a keyframe's time counts from the clip's own start (its In point), not from the sequence
  const rel = (g, t) => t - g.start + g.inPt;
  if (changes.length) {
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
  const tops = shots.map((s, i) => placementplan.shotTop(facesPerShot[i]));
  return { moved: changes.length, unchanged: placed.length - changes.length, kept, shots: tops,
    pairs: placed.filter((p) => p.role === "en").length, measured: centers.size, estimated,
    overCuts: changes.filter((p) => p.keys).length };
}

module.exports = { moveOffFaces, point, number };
