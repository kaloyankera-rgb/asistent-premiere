// Keyframer motion blur, the Premiere side (0.10.78). The maths is blurplan.js; this file reads what it needs (the clip's
// Motion between frames, the picture's size), finds or adds Asistent's own Transform effect and builds its actions inside the
// Keyframer's transaction, so the bake and its blur are one Undo step (the very first time two: Premiere adds an effect in
// a step of its own).
//
// Asistent's Transform is recognised by its keys: the record (premiere-keyframes.js, per clip) keeps the times of its
// Position keys, and only a Transform whose Position keys are exactly those is ever changed or taken off. A Transform of the
// editor's own is never touched.
const ppro = require("premierepro");
const P = require("./premiere.js");
const B = require("./blurplan.js");
const K = require("./keyframeplan.js");

const { maybe, debug, secs } = P;
const MATCHES = ["AE.ADBE Geometry2", "AE.ADBE Geometry"];       // Distort > Transform (the second: older Premieres)
const CHANNELS = ["Position", "Scale", "Scale Width", "Rotation", "Anchor Point", "Uniform Scale"];

const norm = (s) => String(s || "").toLowerCase().replace(/[‘’]/g, "'").trim();

function unwrap(v) {
  for (let i = 0; i < 4 && v && typeof v === "object" && "value" in v; i++) v = v.value;
  if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return [v.x, v.y];
  return v;
}

async function valueAt(param, t) {
  if (await maybe(param, "isTimeVarying")) return unwrap(await maybe(param, "getValueAtTime", ppro.TickTime.createWithSeconds(t)));
  return unwrap(await maybe(param, "getStartValue"));
}

let match = null;
async function transformMatch() {
  if (match) return match;
  const all = (await maybe(ppro.VideoFilterFactory, "getMatchNames")) || [];
  match = MATCHES.find((m) => all.includes(m)) || null;
  debug(`motion blur: Transform effects here: ${all.filter((n) => /geometry|transform/i.test(n)).join(" | ") || "none"}; using ${match}`);
  if (!match) throw new P.UserError("Cannot find the Transform effect in this Premiere: motion blur needs it.");
  return match;
}

/** Transform's parameters by name (Adobe's order as the fallback for the moving ones, as the Anchor page does) */
async function transformParams(comp) {
  const n = await comp.getParamCount();
  const list = [];
  for (let i = 0; i < n; i++) list.push(await comp.getParam(i));
  const by = (name) => list.find((p) => norm(p.displayName) === name);
  const ps = {
    anchor: by("anchor point") || list[0], position: by("position") || list[1], uniform: by("uniform scale") || list[2],
    scale: by("scale height") || by("scale") || list[3], scaleWidth: by("scale width") || list[4], rotation: by("rotation") || list[7],
    opacity: by("opacity"),
    // ExtendScript calls them "Use Composition’s Shutter Angle" and "Shutter Angle"; UXP's names may differ in a letter
    compShutter: list.find((p) => /composition/.test(norm(p.displayName)) && /shutter/.test(norm(p.displayName))),
    angle: list.find((p) => /shutter angle/.test(norm(p.displayName)) && !/composition/.test(norm(p.displayName))),
  };
  // Adobe's order (the same in ExtendScript): ... Rotation, Opacity, Use Composition's Shutter Angle, Shutter Angle, Sampling
  const rot = list.indexOf(ps.rotation);
  if (!ps.compShutter && rot >= 0 && list[rot + 2]) ps.compShutter = list[rot + 2];
  if (!ps.angle && rot >= 0 && list[rot + 3]) ps.angle = list[rot + 3];
  debug(`motion blur: Transform's parameters: ${list.map((p, i) => `${i} ${JSON.stringify(p.displayName)}`).join(", ")}`);
  if (!ps.compShutter || !ps.angle) {
    debug(`motion blur: Transform's parameters: ${list.map((p, i) => `${i} ${JSON.stringify(p.displayName)}`).join(", ")}`);
    throw new P.UserError("This Premiere's Transform effect has no Shutter Angle: motion blur cannot be set.");
  }
  return ps;
}

const near = (a, b, tol) => Math.abs(a - b) < tol;

/** Asistent's own Transform on the clip: the one whose Position keys are exactly the recorded ones -> {comp, index} | null */
async function findOwn(chain, rec, tol) {
  if (!rec || !Array.isArray(rec.times) || !rec.times.length) return null;
  const n = await chain.getComponentCount();
  for (let i = n - 1; i >= 0; i--) {
    const comp = await chain.getComponentAtIndex(i);
    if (!MATCHES.includes((await maybe(comp, "getMatchName")) || "")) continue;
    const ps = await transformParams(comp).catch(() => null);
    if (!ps) continue;
    const times = ((await maybe(ps.position, "getKeyframeListAsTickTimes")) || []).map(secs).filter(Number.isFinite).sort((a, b) => a - b);
    if (times.length === rec.times.length && times.every((t, k) => near(t, rec.times[k], tol))) return { comp, index: i, ps };
  }
  return null;
}

/** the picture's size Motion works on: the file (upright), a nested sequence's frame, or the sequence frame (graphics) */
async function layerSize(clip, seq) {
  if (clip.path) {
    try {
      const engine = require("./engine.js");
      const r = await engine.exportFrames([clip.path]);
      const f = (r.items || [])[0];
      if (f && f.width > 0 && f.height > 0) {
        const turned = ((f.rotation || 0) % 180 + 180) % 180 === 90;
        return { w: turned ? f.height : f.width, h: turned ? f.width : f.height, from: "file" };
      }
    } catch (e) {
      debug(`motion blur: the file's size was not read (${e && e.message ? e.message : e})`);
    }
  }
  try {
    const item = await maybe(clip.ti, "getProjectItem");
    const cp = item && ppro.ClipProjectItem.cast(item);
    if (cp && (await maybe(cp, "isSequence"))) {
      const nested = await cp.getSequence();
      const f = await nested.getFrameSize();
      if (f && f.width > 0) return { w: f.width, h: f.height, from: "nested sequence" };
    }
  } catch (e) { /* the sequence frame below */ }
  return { w: seq.w, h: seq.h, from: "sequence" };
}

async function fitOf(ti) {
  for (const name of ["isScaleToFrameSize", "getScaleToFrameSize", "isScaledToFrameSize"]) {
    const v = await maybe(ti, name);
    if (typeof v === "boolean") return v;
  }
  return false;
}

/**
 * Everything the blur needs, read before the transaction. sel: readSelection(); planned: keyframeplan.plan(); blur: {on,
 * amount}; curve, repeat, until as given to plan(). -> { off } | { none: why } | { keys, geo, own, chain, frames, open, late? }
 */
async function prepare(sel, planned, blur, curve, opts, rec) {
  const chain = await sel.clip.ti.getComponentChain();
  const tol = sel.step / 4;
  const own = await findOwn(chain, rec, tol);
  const open = blur && blur.on ? B.shutter(blur.amount) : 0;
  if (!open) return { off: true, own, chain };
  // the clip's Motion
  const n = await chain.getComponentCount();
  let motion = null;
  for (let i = 0; i < n; i++) {
    const comp = await chain.getComponentAtIndex(i);
    if (((await maybe(comp, "getMatchName")) || "") === "AE.ADBE Motion") motion = { comp, index: i };
  }
  if (!motion) return { none: "the clip has no Motion to blur", own, chain };
  const params = {};
  const count = await motion.comp.getParamCount();
  for (let i = 0; i < count; i++) {
    const prm = await motion.comp.getParam(i);
    const name = CHANNELS.find((c) => norm(c) === norm(prm.displayName));
    if (name && !params[name]) params[name] = { prm, id: `${motion.index}:${i}` };
  }
  const shaped = planned.props.filter((p) => !p.skip && sel.props.some((q) => q.id === p.id && q.id.startsWith(`${motion.index}:`)));
  if (!shaped.length) return { none: "motion blur follows Motion's Position, Scale and Rotation, and none of them is ticked", own, chain };
  // where it moves: from the first key to the last key written (the tail or the repeats), one frame more
  let from = Infinity;
  let to = -Infinity;
  for (const p of shaped) {
    for (const k of [...p.anchors, ...p.add]) {
      from = Math.min(from, k.t);
      to = Math.max(to, k.t);
    }
  }
  const lo = sel.clip.inPt || 0;
  const hi = Number.isFinite(sel.clip.outPt) ? sel.clip.outPt : Infinity;
  from = Math.max(from, lo);
  to = Math.min(to + sel.step, hi);
  const frames = [];
  for (let k = 0; from + k * sel.step <= to + 1e-9 && frames.length < K.MAX_KEYS; k++) frames.push(from + k * sel.step);
  // each channel as a function of time: the shaped curve itself, else Premiere's values (read at the moments needed)
  const wanted = new Set();
  for (const t of frames) {
    wanted.add(t);
    for (let j = 1; j <= B.INNER; j++) wanted.add(t + (open * sel.step * j) / B.INNER);
    wanted.add(t + sel.step);
  }
  const times = [...wanted].sort((a, b) => a - b);
  const fns = {};
  let late = false;
  for (const name of CHANNELS) {
    const ch = params[name];
    if (!ch) continue;
    const p = shaped.find((q) => q.id === ch.id);
    if (p) {
      const fn = K.shapedFn(p.anchors, curve, sel.step, opts);
      if (fn) {
        fns[name] = fn;
        continue;
      }
      late = true;                                   // Premiere's ease: its values exist only after the transaction
    }
    fns[name] = { prm: ch.prm, varying: !!(await maybe(ch.prm, "isTimeVarying")) };
  }
  const geo = { seq: sel.frame, layer: await layerSize(sel.clip, sel.frame), fit: await fitOf(sel.clip.ti) };
  return { own, chain, frames, times, fns, open, geo, late, step: sel.step };
}

/** Reads Premiere's values for the channels that are not shaped curves (after the transaction for Premiere's ease). */
async function read(prep) {
  const tables = {};
  for (const [name, f] of Object.entries(prep.fns)) {
    if (typeof f === "function") continue;
    if (!f.varying) {
      const v = await valueAt(f.prm, prep.frames[0]);
      tables[name] = () => v;
      continue;
    }
    const vals = [];
    for (const t of prep.times) vals.push(await valueAt(f.prm, t));
    tables[name] = (u) => {
      let i = 0;
      while (i + 1 < prep.times.length && prep.times[i + 1] <= u + 1e-9) i++;
      return vals[i];
    };
  }
  const get = (name, u) => {
    const f = prep.fns[name];
    if (!f) return undefined;
    return typeof f === "function" ? f(u) : tables[name](u);
  };
  const stateAt = (u) => {
    const pos = get("Position", u);
    const anchor = get("Anchor Point", u);
    const scale = Number(get("Scale", u));
    const uniform = get("Uniform Scale", u);
    const width = Number(get("Scale Width", u));
    return {
      x: pos && pos[0], y: pos && pos[1], ax: anchor && anchor[0], ay: anchor && anchor[1],
      sh: Number.isFinite(scale) ? scale : 100,
      sw: uniform === false && Number.isFinite(width) ? width : Number.isFinite(scale) ? scale : 100,
      rot: Number(get("Rotation", u)) || 0,
    };
  };
  prep.result = B.blurKeys(prep.frames, stateAt, prep.step, prep.open, prep.geo);
  debug(`motion blur: ${prep.result.moving} moving frames of ${prep.frames.length}, ${prep.result.total} keys, shutter ${Math.round(prep.result.angle)}°, ` +
    `layer ${prep.geo.layer.w}x${prep.geo.layer.h} (${prep.geo.layer.from})${prep.geo.fit ? ", scaled to frame size" : ""}`);
  return prep.result;
}

async function countTransforms(chain) {
  const n = await chain.getComponentCount();
  let count = 0;
  for (let i = 0; i < n; i++) if (MATCHES.includes((await maybe(await chain.getComponentAtIndex(i), "getMatchName")) || "")) count++;
  return count;
}

/** Adds Asistent's Transform at the end of the clip's effects (its own Undo step: Premiere needs it there first). */
async function addOwn(project, prep, ti) {
  const comp = await ppro.VideoFilterFactory.createComponent(await transformMatch());
  prep.created = comp;                       // kept referenced until the end of the press (Premiere took it over)
  // In/Out's tagged Transform may be on the clip (premiere-inout.js): the add must raise the Transform count by exactly one, or
  // "the last Transform" below could be the In/Out's or the editor's, and its keys would be wiped (lazy require: no cycle)
  const IO = require("./premiere-inout.js");
  const countBefore = await countTransforms(prep.chain);
  P.transaction(project, "Asistent: Keyframer motion blur (Transform)", (c) => c.addAction(prep.chain.createAppendComponentAction(comp)));
  // Premiere crashed once (NEW TEST 2026-11-15, inside UXP turning an object into JavaScript) right after this step: the
  // effects are read again from a new handle, after Premiere has settled
  await new Promise((r) => setTimeout(r, 60));
  prep.chain = await ti.getComponentChain();
  const n = await prep.chain.getComponentCount();
  if ((await countTransforms(prep.chain)) !== countBefore + 1) throw new Error("the Transform effect did not attach");
  for (let i = n - 1; i >= 0; i--) {
    const last = await prep.chain.getComponentAtIndex(i);
    if (MATCHES.includes((await maybe(last, "getMatchName")) || "")) {
      if (await IO.isTagged(last)) throw new Error("the Transform effect did not attach");
      prep.own = { comp: last, index: i, ps: await transformParams(last), fresh: true };
      return prep.own;
    }
  }
  throw new Error("the Transform effect did not attach");
}

const point = (v) => new ppro.PointF(v[0], v[1]);

/** The blur's actions, inside a transaction (keys and actions are created here, as Premiere 26.3+ wants). */
function actions(c, prep) {
  const r = prep.result;
  const ps = prep.own.ps;
  const set = (prm, v) => c.addAction(prm.createSetValueAction(prm.createKeyframe(v), true));
  for (const [prm, keys, isPoint, still] of [
    [ps.anchor, r.keys.anchor, true, [r.still.ax, r.still.ay]],
    [ps.position, r.keys.position, true, [r.still.x, r.still.y]],
    [ps.scale, r.keys.scale, false, 100],
    [ps.scaleWidth, r.keys.scaleWidth, false, 100],
    [ps.rotation, r.keys.rotation, false, 0],
  ]) {
    // start clean: Asistent's own effect, so every earlier key of its goes
    c.addAction(prm.createSetTimeVaryingAction(false));
    if (!keys) {
      set(prm, isPoint ? point(still) : still);
      continue;
    }
    c.addAction(prm.createSetTimeVaryingAction(true));
    for (const k of keys) {
      const kf = prm.createKeyframe(isPoint ? point(k.v) : k.v);
      kf.position = ppro.TickTime.createWithSeconds(k.t);
      c.addAction(prm.createAddKeyframeAction(kf));
    }
    // in case Premiere puts one of its own at media time 0 when keys are switched on: nothing of ours is there
    const before = keys[0].t - prep.step / 8;
    if (before > 0) c.addAction(prm.createRemoveKeyframeRangeAction(ppro.TickTime.createWithSeconds(0), ppro.TickTime.createWithSeconds(before), true));
  }
  // New keys are Linear already (measured: a quarter of the way between two keys is a quarter of the change). Setting it
  // again in this step made Premiere add a key at media time 0 (measured in NEW TEST 2026-11-15), so it is left as it is.
  // Position's path between keys is Premiere's own curve, not settable here: measured, it bends a window's move by 2 % at most.
  set(ps.uniform, r.uniform);
  set(ps.compShutter, false);
  set(ps.angle, r.angle);
}

/** Takes Asistent's Transform off, inside a transaction. */
function remove(c, prep) {
  c.addAction(prep.chain.createRemoveComponentAction(prep.own.comp));
}

/** What the record keeps: the Position keys' times (how the effect is recognised next time). */
function record(prep) {
  const r = prep.result;
  return { times: r.keys.position.map((k) => k.t), angle: r.angle, moving: r.moving };
}

// transformParams, layerSize, fitOf, valueAt and MATCHES: also used by premiere-inout.js (In/Out animations)
module.exports = { prepare, read, addOwn, actions, remove, record, findOwn, transformMatch, transformParams, layerSize, fitOf, valueAt, MATCHES };
