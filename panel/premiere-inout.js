// In & Out animations, the Premiere side (docs/IN_OUT_PLAN.md Phase 2; measured in docs/probes/inout-phase0.md). The maths is
// inoutplan.js (plan, transformKeys); this file reads what it needs (the clips, their Motion and picture size), finds or adds
// Asistent's own Transform effect on each selected clip, writes the baked keys, and takes the effect off again.
//
// The effect is a Transform (AE.ADBE Geometry2) that acts after Motion, so the editor's Motion, Opacity and own keys are never
// touched. It is recognised by a TAG: Skew 0 and a static Skew Axis holding TAG (the picture does not change at rest, probe P1),
// and it is never the Transform the motion blur owns (premiere-blur.js findOwn). The record in the panel store only serves
// re-apply and the status line: two timeline uses of one media + In point share a clipKey, and the store can be lost.
//
// Undo: Premiere needs an added effect in a step of its own, so a first apply is 2 steps for all the clips at once (the add;
// the tag with every key), a re-apply is 1, remove is 1 (probe P8). Nothing here removes a track item: remove takes an effect off.
const ppro = require("premierepro");
const P = require("./premiere.js");
const store = require("./store.js");
const K = require("./keyframeplan.js");
const B = require("./blurplan.js");
const I = require("./inoutplan.js");
const PB = require("./premiere-blur.js");

const { UserError, transaction, maybe, debug, secs } = P;
const RECORD = "asistent.inout.v1";
const TAG = 17.25;                                   // Skew Axis of our Transform (a static value that changes no pixel)
const GROUP = "AE.ADBE Graphic Group";               // the layers of a graphic made in Premiere start here
const MOTION = "AE.ADBE Motion";
const PARAM = { position: 1, scale: 3, rotation: 7, opacity: 8 };   // Transform's parameter indices (probe P1)
const REST = { position: [0.5, 0.5], scale: 100, rotation: 0, opacity: 100 };
const SHUTTER = Math.min(180, B.OPEN_MAX * 360);     // degrees of the blur option: a film camera's, under what Premiere takes
const SETTLE = 80;                                   // ms after an add (probe P8's 80; the blur waits 60)
const NAMES = ["position", "scale", "rotation", "opacity"];

let keep = [];                                       // the created effects, referenced until the end of the press (as the blur does)

const norm = (s) => String(s || "").toLowerCase().trim();
const tick = (t) => ppro.TickTime.createWithSeconds(t);
const point = (v) => new ppro.PointF(v[0], v[1]);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- records
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

// lazy: premiere-keyframes.js requires this file (its readSelection hook), so it cannot be required at the top
const clipKey = (c) => require("./premiere-keyframes.js").clipKey(c);

// ---------------------------------------------------------------- recognising our Transform
async function paramList(comp) {
  const n = await comp.getParamCount();
  const list = [];
  for (let i = 0; i < n; i++) list.push(await comp.getParam(i));
  return list;
}

/** Is this component In/Out's Transform? -> its parameter list, or null. Never throws (a component that cannot be read is not ours) */
async function tagged(comp) {
  try {
    if (!PB.MATCHES.includes((await maybe(comp, "getMatchName")) || "")) return null;
    const l = await paramList(comp);
    if (l.length < 7 || !/skew axis/.test(norm(l[6].displayName))) return null;
    if ((await maybe(l[6], "isTimeVarying")) !== false || (await maybe(l[5], "isTimeVarying")) !== false) return null;
    if (Number(await PB.valueAt(l[5], 0)) !== 0) return null;
    return Math.abs(Number(await PB.valueAt(l[6], 0)) - TAG) < 1e-3 ? l : null;
  } catch (e) {
    return null;
  }
}

/** A Transform that was just added and nobody touched: no parameter has keys, Skew and Skew Axis read 0. A keyed Transform of the
 * editor's can never pass, even if the count check were fooled. */
async function pristine(comp) {
  try {
    const l = await paramList(comp);
    if (l.length < 7) return false;
    for (const p of l) if ((await maybe(p, "isTimeVarying")) === true) return false;
    return Number(await PB.valueAt(l[5], 0)) === 0 && Number(await PB.valueAt(l[6], 0)) === 0;
  } catch (e) {
    return false;
  }
}

/** for premiere-keyframes.js readSelection: the Keyframer must not list or reshape In/Out's keys (probe P6) */
async function isTagged(comp) {
  return !!(await tagged(comp));
}

/** every Transform of ours on the chain (the blur's own excluded), in chain order: [{comp, index, list}] */
async function oursOn(clip, chain, step) {
  let blurIndex = -1;
  try {
    const all = JSON.parse(store.getItem("asistent.keyframer.v1") || "{}") || {};
    const own = await PB.findOwn(chain, (all[clipKey(clip)] || {}).__blur, step / 4);
    if (own) blurIndex = own.index;
  } catch (e) { /* no blur record: nothing to exclude */ }
  const n = await chain.getComponentCount();
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i === blurIndex) continue;
    const comp = await chain.getComponentAtIndex(i);
    const list = await tagged(comp);
    if (list) out.push({ comp, index: i, list });
  }
  return out;
}

async function transformCount(chain) {
  const n = await chain.getComponentCount();
  let count = 0;
  for (let i = 0; i < n; i++) if (PB.MATCHES.includes((await maybe(await chain.getComponentAtIndex(i), "getMatchName")) || "")) count++;
  return count;
}

async function groupAt(chain) {
  const n = await chain.getComponentCount();
  for (let i = 0; i < n; i++) if (((await maybe(await chain.getComponentAtIndex(i), "getMatchName")) || "") === GROUP) return i;
  return -1;
}

// ---------------------------------------------------------------- the clip's Motion and picture
const MOTION_CHANNELS = ["Position", "Scale", "Scale Width", "Rotation", "Anchor Point", "Uniform Scale"];

/** the clip's Motion at media time t, as blurplan.motion takes it (defaults where there is no Motion) */
async function motionAt(chain, t) {
  const n = await chain.getComponentCount();
  let comp = null;
  for (let i = 0; i < n; i++) {
    const c = await chain.getComponentAtIndex(i);
    if (((await maybe(c, "getMatchName")) || "") === MOTION) comp = c;
  }
  if (!comp) return {};
  const by = {};
  const count = await comp.getParamCount();
  for (let i = 0; i < count; i++) {
    const prm = await comp.getParam(i);
    const name = MOTION_CHANNELS.find((c) => norm(c) === norm(prm.displayName));
    if (name && !by[name]) by[name] = prm;
  }
  const get = async (name) => (by[name] ? PB.valueAt(by[name], t) : undefined);
  const pos = await get("Position");
  const anchor = await get("Anchor Point");
  const scale = Number(await get("Scale"));
  const uniform = await get("Uniform Scale");
  const width = Number(await get("Scale Width"));
  return {
    x: pos && pos[0], y: pos && pos[1], ax: anchor && anchor[0], ay: anchor && anchor[1],
    sh: Number.isFinite(scale) ? scale : 100,
    sw: uniform === false && Number.isFinite(width) ? width : Number.isFinite(scale) ? scale : 100,
    rot: Number(await get("Rotation")) || 0,
  };
}

// ---------------------------------------------------------------- apply
function planOptions(opts) {
  return { inPreset: opts.inPreset, outPreset: opts.outPreset, inFrames: opts.inFrames, outFrames: opts.outFrames,
    direction: opts.direction, turn: opts.turn, strength: opts.strength };
}

/** the actions that write one clip's Transform, inside a transaction */
function writeActions(c, t, blur) {
  const set = (prm, v) => c.addAction(prm.createSetValueAction(prm.createKeyframe(v), true));
  const ps = t.ps;
  if (t.fresh) set(t.list[6], TAG);
  for (const name of NAMES) {
    const prm = ps[name] || t.list[PARAM[name]];
    const keys = t.keys[name].length ? t.keys[name] : null;
    const isPoint = name === "position";
    // start clean: every earlier key of ours goes; a parameter this preset leaves alone goes back to rest, static
    c.addAction(prm.createSetTimeVaryingAction(false));
    if (!keys) {
      set(prm, isPoint ? point(REST.position) : REST[name]);
      continue;
    }
    c.addAction(prm.createSetTimeVaryingAction(true));
    for (const k of keys) {
      const kf = prm.createKeyframe(isPoint ? point(k.v) : k.v);
      kf.position = tick(k.t);
      c.addAction(prm.createAddKeyframeAction(kf));
    }
    // in case Premiere puts a key of its own at media time 0 when keys are switched on (the blur's guard, measured)
    const before = keys[0].t - t.step / 8;
    if (before > 0) c.addAction(prm.createRemoveKeyframeRangeAction(tick(0), tick(before), true));
  }
  // New keys are Linear already; setting the interpolation adds a key at media time 0 (measured for the blur), so it is not set.
  set(ps.uniform, true);
  set(ps.compShutter, false);
  set(ps.angle, blur ? SHUTTER : 0);
}

/**
 * Writes the In / Out animations on every selected video clip, in one press (2 Undo steps the first time, 1 after).
 * opts: {inPreset, outPreset (ids; none / null = no animation on that side), inFrames, outFrames, direction, turn, strength, blur}
 * -> {clips, skipped: [{name, why}], steps, shortened: [names], notes: [text], keys}
 * Throws UserError when nothing can be applied. Reversed clips and clips too short for the animation are skipped, never guessed.
 */
async function apply(project, opts = {}) {
  const popts = planOptions(opts);
  const check = I.plan(Object.assign({ clip: { frames: 100000 } }, popts));      // the options themselves, whatever the clips
  if (check.error) throw new UserError(`${check.error[0].toUpperCase()}${check.error.slice(1)}.`);
  const timeline = await P.readTimeline(project);
  if (!(timeline.fps > 0)) throw new UserError("The sequence's frame rate is not known.");
  const picked = timeline.items.filter((x) => x.selected && x.kind === "video" && !x.unused);
  if (!picked.length) throw new UserError("Select one or more clips in the timeline first.");
  const size = await maybe(timeline.sequence, "getFrameSize");
  const frame = size && size.width > 0 ? { w: size.width, h: size.height } : null;
  const animatesPos = !!(check.props.in.includes("pos") || check.props.out.includes("pos"));
  if (animatesPos && !frame) throw new UserError("The sequence's frame size is not known.");

  const skipped = [];
  const shortened = [];
  const notes = [];
  const targets = [];
  const sizes = new Map();                                // a file's picture size once per press
  for (const x of picked) {
    const why = (text) => skipped.push({ name: x.name, why: text });
    if (x.reversed) {
      why("it plays in reverse");
      continue;
    }
    const tm = I.times(x, timeline.fps);
    if (tm.error) {
      why(tm.error);
      continue;
    }
    const frames = Math.round((x.end - x.start) * timeline.fps);
    const planned = I.plan(Object.assign({ clip: { frames } }, popts));
    if (planned.error) {
      why(planned.error);
      continue;
    }
    const chain = await maybe(x.ti, "getComponentChain");
    if (!chain) {
      why("Premiere did not hand over its effects");
      continue;
    }
    const ours = await oursOn(x, chain, tm.step);
    if (ours.length > 1) notes.push(`${x.name} has ${ours.length} In/Out effects (one is stale): the last one is used; Remove takes all of them off.`);
    const box = {};
    if (animatesPos) {
      // The clip's Motion at its first and last frame stands for the whole animation: a Motion that is keyframed or rotating
      // during the In / Out is approximated by this (the exit distance and the Position unit come from it).
      const key = x.path || `${x.name}`;
      if (!sizes.has(key)) sizes.set(key, await PB.layerSize(x, frame));
      const geo = { seq: frame, layer: sizes.get(key), fit: await PB.fitOf(x.ti) };
      let bad = null;
      for (const [side, f, label] of [["in", 0, "start"], ["out", frames - 1, "end"]]) {
        if (!planned.props[side].includes("pos")) continue;
        const m = await motionAt(chain, tm.at(f));
        box[side] = I.boxOf(geo, m);
        const u = I.boxUsable(box[side]);
        if (u === "size") bad = bad || "its picture size cannot be read";
        else if (u === "scale") bad = bad || `its Motion scale is 0 (or too small) at the ${label}`;
      }
      if (bad) {
        why(bad);
        continue;
      }
    }
    const graphic = (await groupAt(chain)) >= 0;
    if (graphic && (planned.props.in.concat(planned.props.out).some((n) => n === "scale" || n === "rot"))) {
      notes.push(`${x.name}: a graphic made in Premiere scales and turns around the centre of the frame, not around its own centre.`);
    }
    if (planned.frames.shortened) shortened.push(x.name);
    const built = I.transformKeys(planned, { at: tm.at, box, inPreset: popts.inPreset, outPreset: popts.outPreset, direction: popts.direction });
    if (built.error) {
      why(built.error);
      continue;
    }
    targets.push({ x, chain, ours: ours.length ? ours[ours.length - 1] : null, planned, built, keys: built.keys, step: tm.step, at: tm.at });
  }
  if (!targets.length) {
    const first = skipped[0];
    throw new UserError(skipped.length === 1 ? `${first.name}: ${first.why}.` : `Nothing could be applied: ${skipped.map((s) => `${s.name} (${s.why})`).join("; ")}.`);
  }
  // the keys really written (plan().total also counts pins on every property, Position alone gets them)
  const over = I.capCheck(targets.map((t) => t.built.total));
  if (over) throw new UserError(`${over[0].toUpperCase()}${over.slice(1)}.`);

  // 1. one step: the effect on every clip that lacks ours (before the Graphic group on a graphic)
  const fresh = targets.filter((t) => !t.ours);
  keep = [];
  let steps = 0;
  if (fresh.length) {
    for (const t of fresh) {
      t.before = await transformCount(t.chain);
      t.groupAt = await groupAt(t.chain);
      const comp = await ppro.VideoFilterFactory.createComponent(await PB.transformMatch());
      keep.push(comp);
      t.comp = comp;
    }
    transaction(project, "Asistent: In/Out animation (Transform)", (c) => {
      for (const t of fresh) c.addAction(t.groupAt >= 0 ? t.chain.createInsertComponentAction(t.comp, t.groupAt) : t.chain.createAppendComponentAction(t.comp));
    });
    steps++;
    // read again from a fresh handle after Premiere settled (reading straight after an add crashed Premiere once, for the blur)
    await pause(SETTLE);
    for (const t of fresh) {
      const chain = await maybe(t.x.ti, "getComponentChain");
      t.chain = chain || t.chain;
      let found = null;
      if (chain && (await transformCount(chain)) === t.before + 1) {
        const n = await chain.getComponentCount();
        // inserted: the slot of the Graphic group it was put before; appended: the last Transform. Either way it must be new (untagged)
        for (let i = t.groupAt >= 0 ? t.groupAt : n - 1; i >= 0 && i < n && !found; i--) {
          const comp = await chain.getComponentAtIndex(i);
          if (PB.MATCHES.includes((await maybe(comp, "getMatchName")) || "")) {
            if (!(await tagged(comp)) && (await pristine(comp))) found = { comp, index: i };
            break;
          }
          if (t.groupAt >= 0) break;
        }
      }
      if (!found) {
        t.failed = true;
        skipped.push({ name: t.x.name, why: "the Transform effect did not attach where expected: an untagged Transform may be left on it, take it off by hand if you see one" });
        continue;
      }
      t.ours = found;
      t.fresh = true;
    }
  }
  const go = targets.filter((t) => !t.failed);
  const undone = steps ? " One Undo step was already made (the effects were added): one Undo takes it back." : "";
  if (!go.length) throw new UserError(`Nothing could be applied: ${skipped.map((s) => `${s.name} (${s.why})`).join("; ")}.${undone}`);

  // 2. one step: the tag (new effects) and all the keys of all the clips
  try {
    for (const t of go) {
      t.ps = await PB.transformParams(t.ours.comp);
      t.list = t.ours.list || (await paramList(t.ours.comp));
    }
    transaction(project, "Asistent: In/Out animation", (c) => {
      for (const t of go) writeActions(c, t, !!opts.blur);
    });
  } catch (e) {
    keep = [];
    // the effects added in step 1 are untagged now: Remove cannot find them and the next Apply would add more
    const added = go.filter((t) => t.fresh).length;
    if (!added) throw e;
    throw new UserError(`The animation was not written (${(e && e.message) || e}). An empty Transform was added to ${added} ${added === 1 ? "clip" : "clips"}: one Undo takes it off.`);
  }
  steps++;

  // record and check what Premiere holds now
  const all = records();
  for (const t of go) {
    const counts = {};
    let first = Infinity;
    let last = -Infinity;
    for (const name of NAMES) {
      const times = ((await maybe(t.ps[name], "getKeyframeListAsTickTimes")) || []).map(secs).filter(Number.isFinite);
      counts[name] = times.length;
      if (times.length) {
        first = Math.min(first, ...times);
        last = Math.max(last, ...times);
      }
      if (times.length !== t.keys[name].length) notes.push(`${t.x.name}: ${name} should have ${t.keys[name].length} keyframes, the clip has ${times.length}: check it.`);
    }
    all[clipKey(t.x)] = { inPreset: popts.inPreset || null, outPreset: popts.outPreset || null, frames: t.planned.frames, direction: popts.direction || null,
      turn: popts.turn || null, strength: popts.strength || null, blur: !!opts.blur, keys: counts, first: Number.isFinite(first) ? first : null, last: Number.isFinite(last) ? last : null };
    debug(`in/out ${t.x.name}: in ${popts.inPreset || "-"} ${t.planned.frames.in}f, out ${popts.outPreset || "-"} ${t.planned.frames.out}f, keys ${JSON.stringify(counts)}, ${t.fresh ? "new" : "re-applied"} Transform at ${t.ours.index}`);
  }
  saveRecords(all);
  keep = [];
  return { clips: go.length, skipped, steps, shortened: shortened.filter((n) => go.some((t) => t.x.name === n)), notes, keys: go.reduce((n, t) => n + t.built.total, 0) };
}

// ---------------------------------------------------------------- remove and info
/** Takes In/Out's Transform off every selected video clip that has it, in one Undo step (an effect, never a track item) -> {clips, skipped, steps} */
async function remove(project) {
  const timeline = await P.readTimeline(project);
  const picked = timeline.items.filter((x) => x.selected && x.kind === "video");
  if (!picked.length) throw new UserError("Select one or more clips in the timeline first.");
  const jobs = [];
  const skipped = [];
  for (const x of picked) {
    const chain = await maybe(x.ti, "getComponentChain");
    const ours = chain ? await oursOn(x, chain, Math.abs(x.speed || 1) / (timeline.fps || 30)) : [];
    if (ours.length) jobs.push({ x, chain, ours });
    else skipped.push({ name: x.name, why: "it has no In/Out animation" });
  }
  if (jobs.length) {
    transaction(project, "Asistent: remove In/Out animation", (c) => {
      for (const j of jobs) for (const o of j.ours) c.addAction(j.chain.createRemoveComponentAction(o.comp));
    });
    const all = records();
    for (const j of jobs) delete all[clipKey(j.x)];
    saveRecords(all);
  }
  return { clips: jobs.length, skipped, steps: jobs.length ? 1 : 0 };
}

/** What each selected video clip carries, read only (the live tester, later the status line) */
async function info(project) {
  const timeline = await P.readTimeline(project);
  const all = records();
  const out = [];
  for (const x of timeline.items.filter((q) => q.selected && q.kind === "video")) {
    const chain = await maybe(x.ti, "getComponentChain");
    const rec = all[clipKey(x)] || null;
    // the record is shown only while our Transform is there; one left behind (an Undo took the effect off) is flagged, never deleted on a read
    const row = { name: x.name, ours: false, index: null, count: 0, record: null, stale: false, keys: null, first: null, last: null, chain: null };
    if (chain) {
      const n = await chain.getComponentCount();
      const sig = [];
      for (let i = 0; i < n; i++) sig.push((await maybe(await chain.getComponentAtIndex(i), "getMatchName")) || "?");
      row.chain = sig.join(" > ");
      const ours = await oursOn(x, chain, Math.abs(x.speed || 1) / (timeline.fps || 30));
      row.count = ours.length;
      if (ours.length) {
        const o = ours[ours.length - 1];
        row.ours = true;
        row.record = rec;
        row.index = o.index;
        row.keys = {};
        let first = Infinity;
        let last = -Infinity;
        for (const name of NAMES) {
          const list = ((await maybe(o.list[PARAM[name]], "getKeyframeListAsTickTimes")) || []).map(secs).filter(Number.isFinite);
          row.keys[name] = list.length;
          if (list.length) {
            first = Math.min(first, ...list);
            last = Math.max(last, ...list);
          }
        }
        row.first = Number.isFinite(first) ? first : null;
        row.last = Number.isFinite(last) ? last : null;
      }
    }
    row.stale = !row.ours && !!rec;
    out.push(row);
  }
  return { fps: timeline.fps, clips: out };
}

module.exports = { apply, remove, info, isTagged, TAG };
