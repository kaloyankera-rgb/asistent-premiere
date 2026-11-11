// Motion tracker in Premiere (COCKPIT_PLAN.md A3, 0.10.51): which clip is tracked, its Motion per frame, and the keys written
// on the attached clip (a text, a logo) in one Undo step. trackplan.js does the maths; the engine (tracker.py) tracks.
// Safety: the source clip is only read; on the attached clip only Motion's Position (and Scale / Rotation when asked) get
// keys, never over keyframes of the editor's own in that time (the tracker's own earlier keys are replaced, by its record).
const ppro = require("premierepro");
const P = require("./premiere.js");
const TP = require("./trackplan.js");
const store = require("./store.js");
const KF = require("./premiere-keyframes.js");
const { point, number } = require("./premiere-placement.js");

const { UserError, transaction, maybe, debug, secs } = P;
const MOTION = "AE.ADBE Motion";
const RECORD = "asistent.tracker.v1";

function records() {
  try {
    return JSON.parse(store.getItem(RECORD) || "{}") || {};
  } catch (e) {
    return {};
  }
}

// Motion's parameters of a clip by display name ("Position", "Scale", "Scale Width", "Uniform Scale", "Rotation", "Anchor Point")
async function motionParams(ti) {
  const chain = await maybe(ti, "getComponentChain");
  const n = chain ? await chain.getComponentCount() : 0;
  for (let i = 0; i < n; i++) {
    const comp = await chain.getComponentAtIndex(i);
    const match = (await maybe(comp, "getMatchName")) || "";
    const name = (await maybe(comp, "getDisplayName")) || "";
    if (match !== MOTION && name !== "Motion") continue;
    const out = {};
    for (let j = 0; j < (await comp.getParamCount()); j++) {
      const prm = await comp.getParam(j);
      out[prm.displayName] = prm;
    }
    return out;
  }
  return null;
}

function bool(v) {
  let o = v;
  for (let i = 0; i < 4 && o !== null && typeof o === "object"; i++) o = o.value;
  return typeof o === "boolean" ? o : typeof o === "number" ? o !== 0 : null;
}

async function valueAt(prm, t, read) {
  if (!prm) return undefined;
  if (await maybe(prm, "isTimeVarying")) {
    const v = read(await maybe(prm, "getValueAtTime", ppro.TickTime.createWithSeconds(t)));
    if (v !== null && v !== undefined) return v;
  }
  const v = read(await maybe(prm, "getStartValue"));
  return v === null ? undefined : v;
}

async function fitOf(ti) {
  for (const name of ["isScaleToFrameSize", "getScaleToFrameSize", "isScaledToFrameSize"]) {
    const v = await maybe(ti, name);
    if (typeof v === "boolean") return v;
  }
  return false;
}

/** Motion of a clip at media time t as trackplan wants it. */
async function motionAt(ps, t, fit) {
  const pos = await valueAt(ps.Position, t, point);
  const anchor = await valueAt(ps["Anchor Point"], t, point);
  const scale = await valueAt(ps.Scale || ps["Scale Height"], t, number);
  const uniform = ps["Scale Width"] ? await valueAt(ps["Uniform Scale"], t, bool) : true;
  const width = ps["Scale Width"] ? await valueAt(ps["Scale Width"], t, number) : undefined;
  return { x: pos && pos.x, y: pos && pos.y, ax: anchor && anchor.x, ay: anchor && anchor.y,
    sw: uniform === false && width !== undefined ? width : scale, sh: scale, rot: await valueAt(ps.Rotation, t, number), fit };
}

async function frameSize(sequence) {
  const { sizeFrom } = require("./subtitleplan.js");
  const settings = await maybe(sequence, "getSettings");
  for (const name of ["getVideoFrameRect", "getVideoFrameSize"]) {
    const size = sizeFrom(await maybe(settings, name));
    if (size) return size;
  }
  return null;
}

const sameClip = (a, b) => a && b && a.kind === b.kind && a.track === b.track && Math.abs(a.start - b.start) < 1e-3 && a.path === b.path;

/** The clip to track (the selected clip with a file on the lowest track) and the boxed moment at the playhead. */
async function readSource(project) {
  const timeline = await P.readTimeline(project);
  const picked = timeline.items.filter((x) => x.selected && x.kind === "video" && !x.unused && x.path);
  if (!picked.length) throw new UserError("Select the clip with the moving object (a clip with a file) and park the playhead on a clear frame of it.");
  const clip = picked.sort((a, b) => a.track - b.track)[0];
  if (clip.reversed) throw new UserError(`${clip.name} plays in reverse: the tracker does not follow reversed clips.`);
  const fps = timeline.fps || 30;
  const speed = Math.abs(clip.speed || 1);
  const step = speed / fps;
  const playhead = secs(await maybe(timeline.sequence, "getPlayerPosition"));
  if (!Number.isFinite(playhead)) throw new UserError("Premiere did not say where the playhead is.");
  if (playhead < clip.start - 1e-3 || playhead >= clip.end) {
    throw new UserError(`Park the playhead over ${clip.name} (it runs ${clip.start.toFixed(2)}-${clip.end.toFixed(2)} s) on a frame where the object is clear.`);
  }
  const inPt = clip.inPt || 0;
  const outPt = Number.isFinite(clip.outPt) ? clip.outPt : inPt + (clip.end - clip.start) * speed;
  const k0 = Math.min(Math.round(((inPt + (playhead - clip.start) * speed) - inPt) / step), Math.floor((outPt - inPt) / step + 1e-6) - 1);
  const t0 = inPt + Math.max(0, k0) * step;
  return { clip: { name: clip.name, path: clip.path, track: clip.track, start: clip.start, end: clip.end, inPt, outPt, speed, kind: clip.kind },
    fps, step, t0, from: inPt, to: outPt, at: clip.start + Math.max(0, k0) * step / speed, sequence: timeline.sequence.name };
}

/** The source's Motion for every tracked frame (one object when nothing in it is keyframed). */
async function sourceMotion(project, source, frames) {
  const timeline = await P.readTimeline(project);
  const x = timeline.items.find((i) => sameClip(i, source.clip));
  if (!x) throw new UserError(`${source.clip.name} is not where it was when it was tracked: track it again.`);
  const ps = (await motionParams(x.ti)) || {};
  const fit = await fitOf(x.ti);
  const moving = [];
  for (const k of ["Position", "Scale", "Scale Width", "Rotation", "Anchor Point"]) if (ps[k] && (await maybe(ps[k], "isTimeVarying"))) moving.push(k);
  if (!moving.length) return { motions: await motionAt(ps, source.t0, fit), timeline, moving };
  const motions = [];
  for (const f of frames) motions.push(await motionAt(ps, f.t, fit));
  return { motions, timeline, moving };
}

/** Writes the attached clip's keys. -> {written, lines, clip} */
async function attach(project, source, track, opts) {
  const { motions, timeline, moving } = await sourceMotion(project, source, track.frames);
  const picked = timeline.items.filter((x) => x.selected && x.kind === "video" && !x.unused && !sameClip(x, source.clip));
  if (!picked.length) throw new UserError("Select the text, logo or clip to attach (on a track above the tracked clip), placed where it belongs on the boxed frame.");
  const target = picked.sort((a, b) => b.track - a.track)[0];
  if (target.reversed) throw new UserError(`${target.name} plays in reverse: not attached.`);
  const ps = await motionParams(target.ti);
  if (!ps || !ps.Position) throw new UserError(`${target.name} has no Motion to move.`);
  const frame = await frameSize(timeline.sequence);
  if (!frame) throw new UserError("Premiere did not say the sequence's frame size.");
  const tSpeed = Math.abs(target.speed || 1);
  const at = TP.toMedia({ start: target.start, inPt: target.inPt || 0, speed: tSpeed }, source.at);
  const fit = await fitOf(target.ti);
  const m = await motionAt(ps, at, fit);
  const want = { position: true, scale: !!opts.scale && !!ps.Scale, rotation: !!opts.rotation && !!ps.Rotation };
  const plan = TP.attach(track, { start: source.clip.start, inPt: source.clip.inPt, speed: source.clip.speed }, motions,
    { start: target.start, end: target.end, inPt: target.inPt || 0, speed: tSpeed, x: m.x === undefined ? 0.5 : m.x, y: m.y === undefined ? 0.5 : m.y,
      scale: m.sh === undefined ? 100 : m.sh, rot: m.rot || 0 }, frame, { scale: want.scale, rotation: want.rotation });
  if (plan.error) throw new UserError(plan.error);
  if (plan.keys.length > 3000) throw new UserError(`That would add ${plan.keys.length} keyframes on each property (more than 3000): track a shorter part.`);
  // never over the editor's own keys: only the tracker's earlier keys on this clip (its record) may be in the way
  const key = KF.clipKey(target);
  const all = records();
  const mine = all[key] || {};
  const first = plan.keys[0].t;
  const last = plan.keys[plan.keys.length - 1].t;
  const tol = 0.25 * (source.step / source.clip.speed) * tSpeed;
  const jobs = [["Position", (k) => new ppro.PointF(k.x, k.y)]];
  if (want.scale) jobs.push(["Scale", (k) => k.scale]);
  if (want.rotation) jobs.push(["Rotation", (k) => k.rot]);
  const old = {};
  const animated = {};
  for (const [name] of jobs) {
    const prm = ps[name];
    animated[name] = !!(await maybe(prm, "isTimeVarying"));
    const times = animated[name] ? ((await maybe(prm, "getKeyframeListAsTickTimes")) || []).map(secs).filter(Number.isFinite) : [];
    const ours = new Set((mine[name] || []).filter((t) => times.some((x) => Math.abs(x - t) < tol)));
    const theirs = times.filter((t) => t >= first - tol && t <= last + tol && ![...ours].some((o) => Math.abs(o - t) < tol));
    if (theirs.length) {
      throw new UserError(`${target.name} already has ${theirs.length} ${name} keyframe${theirs.length > 1 ? "s" : ""} of its own in that time: ` +
        "remove them first (or nest the clip, or put the text in a nest), then attach. Nothing was changed.");
    }
    old[name] = [...ours];
  }
  transaction(project, `Asistent: Attach ${target.name || "clip"} to the track`, (c) => {
    for (const [name, value] of jobs) {
      const prm = ps[name];
      for (const t of old[name]) {
        c.addAction(prm.createRemoveKeyframeRangeAction(ppro.TickTime.createWithSeconds(t - tol), ppro.TickTime.createWithSeconds(t + tol), true));
      }
    }
    for (const [name, value] of jobs) {
      const prm = ps[name];
      if (!animated[name]) c.addAction(prm.createSetTimeVaryingAction(true));
      for (const k of plan.keys) {
        const kf = prm.createKeyframe(value(k));
        kf.position = ppro.TickTime.createWithSeconds(k.t);
        c.addAction(prm.createAddKeyframeAction(kf));
      }
    }
  });
  const lines = [];
  const rec = {};
  for (const [name] of jobs) {
    const got = ((await maybe(ps[name], "getKeyframeListAsTickTimes")) || []).map(secs).filter((t) => t >= first - tol && t <= last + tol).length;
    rec[name] = plan.keys.map((k) => k.t);
    lines.push(`${name}: ${plan.keys.length} keyframes${got === plan.keys.length ? "" : ` (expected ${plan.keys.length}, the clip has ${got} there: check it)`}`);
  }
  all[key] = rec;
  store.setItem(RECORD, JSON.stringify(all));
  if (plan.lost) lines.push(`${plan.lost} lost frame${plan.lost > 1 ? "s" : ""} got no key (Premiere moves straight across them): check those.`);
  if (plan.outside) lines.push(`${plan.outside} tracked frame${plan.outside > 1 ? "s are" : " is"} outside ${target.name}: no keys there.`);
  if (moving.length) lines.push(`Followed ${source.clip.name}'s own keyframed ${moving.join(", ")} as well.`);
  debug(`tracker attach ${target.name} V${target.track + 1} to ${source.clip.name}: ${plan.keys.length} keys, ${jobs.map((j) => j[0]).join("+")}, lost ${plan.lost}, outside ${plan.outside}, replaced ${Object.values(old).flat().length}`);
  return { written: plan.keys.length, lines, clip: target.name };
}

/** Takes the tracker's keys off the selected clip (only those still where it put them), one Undo step. */
async function detach(project) {
  const timeline = await P.readTimeline(project);
  const picked = timeline.items.filter((x) => x.selected && x.kind === "video" && !x.unused);
  const all = records();
  const target = picked.find((x) => all[KF.clipKey(x)]);
  if (!target) return { removed: 0 };
  const ps = (await motionParams(target.ti)) || {};
  const rec = all[KF.clipKey(target)];
  const tol = 0.25 / (timeline.fps || 30);
  const jobs = [];
  for (const [name, times] of Object.entries(rec)) {
    const prm = ps[name];
    if (!prm) continue;
    const now = (await maybe(prm, "isTimeVarying")) ? ((await maybe(prm, "getKeyframeListAsTickTimes")) || []).map(secs) : [];
    const there = times.filter((t) => now.some((x) => Math.abs(x - t) < tol));
    if (there.length) jobs.push({ prm, there });
  }
  if (jobs.length) {
    transaction(project, "Asistent: Detach from the track", (c) => {
      for (const { prm, there } of jobs) {
        for (const t of there) c.addAction(prm.createRemoveKeyframeRangeAction(ppro.TickTime.createWithSeconds(t - tol), ppro.TickTime.createWithSeconds(t + tol), true));
      }
    });
  }
  delete all[KF.clipKey(target)];
  store.setItem(RECORD, JSON.stringify(all));
  return { removed: jobs.reduce((n, j) => n + j.there.length, 0), clip: target.name };
}

async function seek(project, at) {
  const seq = await maybe(project, "getActiveSequence");
  if (!seq || !P.has(seq, "setPlayerPosition")) return false;
  await seq.setPlayerPosition(ppro.TickTime.createWithSeconds(Math.max(0, at)));
  return true;
}

module.exports = { readSource, attach, detach, seek, motionParams };
