// Keyframer (COCKPIT_PLAN.md A1, 0.10.32): reads the keyframed properties of the selected clip and writes a plan from
// keyframeplan.js in one Undo step. Only keys between the editor's own two keys are added; only keys Asistent added itself
// (its record, re-checked on the clip) are ever removed. Keyframe times are media seconds (Phase 0: a key asked at In + 0.5 s
// lands there on a trimmed clip). Interpolation modes are Premiere's own (createSetInterpolationAtKeyframeAction).
const ppro = require("premierepro");
const P = require("./premiere.js");
const store = require("./store.js");
const PB = require("./premiere-blur.js");

const { UserError, transaction, maybe, debug, secs } = P;
const RECORD = "asistent.keyframer.v1";

// a value as the planner takes it: a number, or [x, y] for a point (Position, Anchor Point); anything else is not shaped
function plain(v) {
  const raw = v && v.value !== undefined ? (v.value.value ?? v.value) : v;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return [raw.x, raw.y];
  if (raw && raw[0] !== undefined && Number.isFinite(Number(raw[0])) && Number.isFinite(Number(raw[1]))) return [Number(raw[0]), Number(raw[1])];
  return null;
}

function make(param, v) {
  return param.createKeyframe(Array.isArray(v) ? new ppro.PointF(v[0], v[1]) : v);
}

// the clip, as the record knows it: its media and In point (keys are in media time, so moving the clip keeps them)
function clipKey(c) {
  return `${c.path || c.name}|${(c.inPt || 0).toFixed(3)}`;
}

function records() {
  try {
    return JSON.parse(store.getItem(RECORD) || "{}") || {};
  } catch (e) {
    return {};
  }
}

function saveRecords(r) {
  store.setItem(RECORD, JSON.stringify(r));
}

/** The one selected video clip (graphics too) and its keyframed properties. -> { clip, timeline, step, props, others } */
async function readSelection(project) {
  const timeline = await P.readTimeline(project);
  const picked = timeline.items.filter((x) => x.selected && x.kind === "video" && !x.unused);
  if (!picked.length) throw new UserError("Select one clip with keyframes in the timeline.");
  const clip = picked[0];
  if (clip.reversed) throw new UserError(`${clip.name} plays in reverse: the Keyframer does not shape reversed clips.`);
  const step = (Math.abs(clip.speed || 1)) / (timeline.fps || 30);
  const chain = await clip.ti.getComponentChain();
  const n = await chain.getComponentCount();
  const rec = records()[clipKey(clip)] || {};
  // 0.10.78: Asistent's own motion blur Transform is not one of the clip's animations (its keys are the blur's)
  const own = await PB.findOwn(chain, rec.__blur, step / 4).catch(() => null);
  const props = [];
  for (let c = 0; c < n; c++) {
    if (own && own.index === c) continue;
    const comp = await chain.getComponentAtIndex(c);
    const compMatch = (await maybe(comp, "getMatchName")) || "";
    const compName = (await maybe(comp, "getDisplayName")) || compMatch || "Effect";
    const count = await comp.getParamCount();
    for (let i = 0; i < count; i++) {
      const param = await comp.getParam(i);
      if (!(await maybe(param, "isTimeVarying"))) continue;
      const times = ((await maybe(param, "getKeyframeListAsTickTimes")) || []).map(secs).filter(Number.isFinite).sort((a, b) => a - b);
      const keys = [];
      for (const t of times) {
        const v = plain(await maybe(param, "getValueAtTime", ppro.TickTime.createWithSeconds(t)));
        if (v === null) break;
        keys.push({ t, v });
      }
      const id = `${c}:${i}`;
      if (keys.length !== times.length) {
        debug(`keyframer: ${compName} › ${param.displayName}: values of this kind are not shaped`);
        continue;
      }
      props.push({ id, param, label: `${compName} › ${param.displayName}`, keys, earlier: rec[id] || null, comp: compMatch, paramName: param.displayName });
    }
  }
  const size = await maybe(timeline.sequence, "getFrameSize");
  const frame = size && size.width > 0 ? { w: size.width, h: size.height } : { w: 1920, h: 1080 };
  return { clip, timeline, step, props, others: picked.length - 1, frame, blurOn: !!own };
}

/**
 * Writes one plan (keyframeplan.plan) on the clip in one Undo step, records what was added, and checks the result.
 * opts (0.10.78): {blur: {on, amount}, curve, repeat, until}: the motion blur of the shaped Motion, carried by Asistent's own
 * Transform (premiere-blur.js), written in the same step; blur off takes that Transform off again.
 */
async function apply(project, sel, planned, opts = {}) {
  const byId = new Map(sel.props.map((p) => [p.id, p]));
  const todo = planned.props.filter((p) => !p.skip && (p.add.length || p.remove.length || p.mode));
  const key = clipKey(sel.clip);
  const blur = opts.blur ? await PB.prepare(sel, planned, opts.blur, opts.curve, { repeat: opts.repeat, until: opts.until }, (records()[key] || {}).__blur) : null;
  if (blur && blur.fns && !blur.late) await PB.read(blur);
  const wants = !!(blur && blur.fns && (blur.late || blur.result.total > 0));
  const drop = !!(blur && blur.own && !wants);
  if (!todo.length && !wants && !drop) return { written: 0, steps: 0, lines: ["nothing to change"] };
  let steps = 1;
  if (wants && !blur.own) {
    await PB.addOwn(project, blur, sel.clip.ti);
    steps++;
  }
  const tol = sel.step / 4;
  transaction(project, "Asistent: Keyframer", (c) => {
    if (wants && !blur.late) PB.actions(c, blur);
    if (drop) PB.remove(c, blur);
    for (const p of todo) {
      const param = byId.get(p.id).param;
      for (const t of p.remove) {
        // exactly that key (a window of a quarter frame around it): never a key of the editor's in between
        c.addAction(param.createRemoveKeyframeRangeAction(ppro.TickTime.createWithSeconds(t - tol), ppro.TickTime.createWithSeconds(t + tol), true));
      }
      for (const k of p.add) {
        const kf = make(param, k.v);
        kf.position = ppro.TickTime.createWithSeconds(k.t);
        c.addAction(param.createAddKeyframeAction(kf));
      }
      if (p.mode) {
        const mode = ppro.Constants.InterpolationMode[p.mode];
        for (const k of p.anchors) c.addAction(param.createSetInterpolationAtKeyframeAction(ppro.TickTime.createWithSeconds(k.t), mode, true));
      }
    }
  });
  let blurLine = null;
  if (wants && blur.late) {
    // Premiere's ease: its values between the keys exist now; the blur goes in a step of its own
    await PB.read(blur);
    transaction(project, "Asistent: Keyframer motion blur", (c) => (blur.result.total ? PB.actions(c, blur) : PB.remove(c, blur)));
    steps++;
  }
  const all = records();
  const rec = all[key] || {};
  if (wants && blur.result.total) {
    rec.__blur = PB.record(blur);
    blurLine = `Motion blur: ${Math.round(blur.result.angle)}° shutter on ${blur.result.moving} moving ${blur.result.moving === 1 ? "frame" : "frames"} ` +
      "(Asistent's Transform, last in the clip's effects)" +
      (blur.result.tooFast ? `; ${blur.result.tooFast} ${blur.result.tooFast === 1 ? "frame" : "frames"} left sharp: the picture grows more than 4x there within the shutter time, which Premiere's blur cannot take` : "");
  } else if (blur && (drop || (wants && !blur.result.total))) {
    delete rec.__blur;
    blurLine = blur.off ? "Motion blur off: Asistent's Transform taken off." : `No motion blur: ${blur.none || "nothing moves fast enough to smear"}.`;
  } else if (blur && blur.none) blurLine = `No motion blur: ${blur.none}.`;
  const lines = [];
  let written = 0;
  for (const p of todo) {
    const param = byId.get(p.id).param;
    const got = ((await maybe(param, "getKeyframeListAsTickTimes")) || []).length;
    const want = p.anchors.length + p.add.length;
    written += p.add.length;
    if (p.add.length) rec[p.id] = { anchors: p.anchors.map((k) => k.t), added: p.add.map((k) => k.t), label: byId.get(p.id).label };
    else delete rec[p.id];
    lines.push(`${byId.get(p.id).label}: ${p.mode ? `${p.anchors.length} keyframes set to ${p.mode.toLowerCase()}` : `${p.add.length} keyframes baked into ${p.segments.length} ${p.segments.length === 1 ? "move" : "moves"}${p.repeated ? ` (${p.repeated} of them repeat it after your last keyframe)` : ""}`}` +
      (got === want ? "" : ` (expected ${want} keyframes, the clip has ${got}: check it)`));
    debug(`keyframer ${sel.clip.name} ${byId.get(p.id).label}: removed ${p.remove.length}, added ${p.add.length}, mode ${p.mode || "-"}, keys now ${got}/${want}`);
  }
  all[key] = rec;
  saveRecords(all);
  if (blurLine) lines.push(blurLine);
  return { written, lines, steps, blur: blur && blur.result ? { angle: blur.result.angle, moving: blur.result.moving, keys: blur.result.total } : null };
}

/** Remembers keys Asistent wrote on a clip outside a Keyframer press (a stash, 0.10.37), so Undo last and a new curve treat
 * them as Asistent's: entries {id: {anchors: [t], added: [t], label}} */
function remember(clip, entries) {
  const all = records();
  const key = clipKey(clip);
  all[key] = { ...(all[key] || {}), ...entries };
  saveRecords(all);
}

/** Takes out the keys the last bake added on this clip (only those still where Asistent put them), one Undo step. */
async function undo(project, sel) {
  const key = clipKey(sel.clip);
  const all = records();
  const rec = all[key] || {};
  const tol = sel.step / 4;
  const jobs = [];
  for (const p of sel.props) {
    const r = rec[p.id];
    if (!r) continue;
    const there = r.added.filter((t) => p.keys.some((k) => Math.abs(k.t - t) < tol));
    if (there.length) jobs.push({ p, there });
  }
  // 0.10.78: Asistent's motion blur Transform goes with the keys it blurred
  const chain = await sel.clip.ti.getComponentChain();
  const own = await PB.findOwn(chain, rec.__blur, tol).catch(() => null);
  if (!jobs.length && !own) return { removed: 0 };
  transaction(project, "Asistent: Keyframer undo", (c) => {
    if (own) c.addAction(chain.createRemoveComponentAction(own.comp));
    for (const { p, there } of jobs) {
      for (const t of there) c.addAction(p.param.createRemoveKeyframeRangeAction(ppro.TickTime.createWithSeconds(t - tol), ppro.TickTime.createWithSeconds(t + tol), true));
    }
  });
  for (const { p } of jobs) delete rec[p.id];
  delete rec.__blur;
  all[key] = rec;
  saveRecords(all);
  return { removed: jobs.reduce((n, j) => n + j.there.length, 0), blur: !!own };
}

module.exports = { readSelection, apply, undo, clipKey, plain, remember };
