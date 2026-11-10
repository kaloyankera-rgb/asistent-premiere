// Stash v1 in Premiere (COCKPIT_PLAN.md A2, 0.10.37): sample the ticked properties of the read clip into a stash, and write a
// stash on the selected clip from the playhead in one Undo step. Only parameters the clip already has are written (an effect
// is never added); a property whose time already holds a key of the editor's is left alone (stashplan.place).
const ppro = require("premierepro");
const P = require("./premiere.js");
const KF = require("./premiere-keyframes.js");
const S = require("./stashplan.js");

const { UserError, transaction, maybe, debug, secs } = P;

/** The ticked properties of a read clip as a stash (every frame between its first and last key sampled). */
async function capture(sel, ids, name) {
  const props = [];
  for (const p of sel.props.filter((x) => ids.has(x.id))) {
    const first = p.keys[0].t;
    const last = p.keys[p.keys.length - 1].t;
    const samples = [];
    for (let t = first; t < last - sel.step / 2; t += sel.step) {
      const v = KF.plain(await maybe(p.param, "getValueAtTime", ppro.TickTime.createWithSeconds(t)));
      if (v !== null) samples.push({ t, v });
    }
    samples.push({ t: last, v: p.keys[p.keys.length - 1].v });
    // keys the Keyframer baked are the easing, not the editor's: only the editor's own keys are kept as keys
    const own = p.earlier ? p.keys.filter((k) => p.earlier.anchors.some((a) => Math.abs(a - k.t) < sel.step / 4)) : p.keys;
    props.push({ label: p.label, comp: p.comp, param: p.paramName, keys: own.length >= 2 ? own : p.keys, samples });
  }
  return S.capture(props, { name: name || S.nameFor(sel.clip.name, props.map((p) => p.label)), fps: Math.round(sel.step > 0 ? (Math.abs(sel.clip.speed || 1) / sel.step) * 1000 : 0) / 1000, from: sel.clip.name });
}

// the clip's parameter by effect match name and parameter name -> {param, id ("c:i" as the Keyframer counts)}
async function findParam(ti, comp, name) {
  const chain = await ti.getComponentChain();
  const n = await chain.getComponentCount();
  for (let c = 0; c < n; c++) {
    const co = await chain.getComponentAtIndex(c);
    if (((await maybe(co, "getMatchName")) || "") !== comp) continue;
    for (let i = 0; i < (await co.getParamCount()); i++) {
      const prm = await co.getParam(i);
      if (prm.displayName === name) return { param: prm, id: `${c}:${i}` };
    }
  }
  return null;
}

function make(param, v) {
  return param.createKeyframe(Array.isArray(v) ? new ppro.PointF(v[0], v[1]) : v);
}

/** Writes `stash` on the selected clip from the playhead. -> {written, lines} */
async function apply(project, stash) {
  const timeline = await P.readTimeline(project);
  const picked = timeline.items.filter((x) => x.selected && x.kind === "video" && !x.unused);
  if (!picked.length) throw new UserError("Select the clip to put the animation on, and park the playhead where it should start.");
  const clip = picked[0];
  if (clip.reversed) throw new UserError(`${clip.name} plays in reverse: a stash is not put on reversed clips.`);
  const playhead = secs(await maybe(timeline.sequence, "getPlayerPosition"));
  if (!Number.isFinite(playhead)) throw new UserError("Premiere did not say where the playhead is.");
  if (playhead < clip.start - 0.001 || playhead >= clip.end) throw new UserError(`Park the playhead over ${clip.name} (it runs ${clip.start.toFixed(2)}-${clip.end.toFixed(2)} s).`);
  const speed = Math.abs(clip.speed || 1);
  const step = speed / (timeline.fps || 30);
  const t0 = (clip.inPt || 0) + (playhead - clip.start) * speed;
  const found = {};
  const existing = {};
  const missing = [];
  for (const p of stash.props) {
    const f = await findParam(clip.ti, p.comp, p.param);
    if (!f) {
      missing.push(`${p.label}: ${clip.name} has no ${p.label.split(" › ")[0]} (not added)`);
      continue;
    }
    found[p.label] = f;
    const animated = !!(await maybe(f.param, "isTimeVarying"));
    f.animated = animated;
    existing[p.label] = animated ? ((await maybe(f.param, "getKeyframeListAsTickTimes")) || []).map(secs).filter(Number.isFinite) : [];
  }
  const plan = S.place({ ...stash, props: stash.props.filter((p) => found[p.label]) }, t0, step, clip.outPt, existing);
  const lines = [...missing, ...plan.skipped.map((s) => `${s.label}: not written, ${s.why}`)];
  if (!plan.props.length) return { written: 0, lines: lines.length ? lines : ["nothing to write"] };
  if (plan.total > 3000) throw new UserError(`That would add ${plan.total} keyframes (more than 3000).`);
  transaction(project, `Asistent: Stash ${stash.name || ""}`.trim(), (c) => {
    for (const p of plan.props) {
      const f = found[p.label];
      if (!f.animated) c.addAction(f.param.createSetTimeVaryingAction(true));
      for (const k of [...p.anchors, ...p.add]) {
        const kf = make(f.param, k.v);
        kf.position = ppro.TickTime.createWithSeconds(k.t);
        c.addAction(f.param.createAddKeyframeAction(kf));
      }
    }
  });
  const rec = {};
  let written = 0;
  for (const p of plan.props) {
    const f = found[p.label];
    const got = ((await maybe(f.param, "getKeyframeListAsTickTimes")) || []).length;
    const want = existing[p.label].length + p.anchors.length + p.add.length;
    written += p.anchors.length + p.add.length;
    if (p.add.length) rec[f.id] = { anchors: p.anchors.map((k) => k.t), added: p.add.map((k) => k.t), label: p.label };
    lines.push(`${p.label}: ${p.anchors.length + p.add.length} keyframes from ${playhead.toFixed(2)} s${p.cut ? " (cut at the clip's end)" : ""}` +
      (got === want ? "" : ` (expected ${want} keyframes, the clip has ${got}: check it)`));
    debug(`stash ${stash.name} on ${clip.name} ${p.label}: ${p.anchors.length}+${p.add.length} keys, now ${got}/${want}`);
  }
  KF.remember(clip, rec);
  return { written, lines, clip: clip.name };
}

module.exports = { capture, apply, findParam };
