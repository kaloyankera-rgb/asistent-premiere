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

// ---------------------------------------------------------------- Stash clips (v2, 0.10.50)
// Save: the selected clips are COPIED (createCloneTrackItemAction, the rough cut's way: the same project items, every effect,
// Motion, keyframe and Fix audio's L/R copy) into a new empty sequence "Stash - <name> <id>" in the bin "Asistent stash", and the
// host saves that sequence as a small project file in the engine's stash folder. The editor's sequence is only read.
// Apply: the stash's sequence (still in this project, or imported again from its project file in another project) is copied
// into the active sequence at the playhead, on the same tracks when they are free there, otherwise moved to free ones
// (stashplan.fitClips); a copy never covers or cuts a clip. The stash sequences stay in the bin "Asistent stash": Asistent
// deletes nothing in a project (the editor may delete the bin).
const engine = require("./engine.js");
const STASH_BIN = "Asistent stash";

async function frameSize(sequence) {
  const { sizeFrom } = require("./subtitleplan.js");
  const settings = await maybe(sequence, "getSettings");
  for (const name of ["getVideoFrameRect", "getVideoFrameSize"]) {
    const size = sizeFrom(await maybe(settings, name));
    if (size) return size;
  }
  return null;
}

async function findSequence(project, name) {
  for (const s of (await maybe(project, "getSequences")) || []) if (s.name === name) return s;
  return null;
}

async function importInto(project, file, name) {
  const bin = await P.ensureBin(project, STASH_BIN);
  const target = ppro.ProjectItem.cast(bin) || bin;
  const accepted = await project.importFiles([file], true, target, false);
  if (accepted === false) return null;
  for (let i = 0; i < 40; i++) {
    const s = await findSequence(project, name);
    if (s) return s;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

const ticks = (t) => (t && t.ticks !== undefined ? BigInt(String(t.ticks)) : null);

function guidOf(sequence) {
  return require("./premiere-captions.js").seqGuid(sequence);
}

/** Save the selected clips as a clips stash. -> {name, count, lines} */
async function saveClips(project) {
  const t = await P.readTimeline(project);
  const picked = t.items.filter((x) => x.selected);
  const plan = S.captureClips(picked, t.fps || 30);
  if (plan.error) throw new UserError(plan.error);
  if (!ppro.SequenceEditor || !P.has(ppro.SequenceEditor.getEditor(t.sequence), "createCloneTrackItemAction")) {
    throw new UserError("This Premiere version cannot copy clips between sequences, so clips cannot be stashed.");
  }
  const size = await frameSize(t.sequence);
  if (!size) throw new UserError("Premiere did not say the sequence's frame size.");
  const begun = await engine.stashClipsBegin({ name: plan.name, fps: t.fps || 30, width: size.width, height: size.height,
    video: plan.video, audio: plan.audio, seconds: plan.span });
  const seq = await importInto(project, begun.shell, begun.sequence);
  if (!seq) throw new UserError(`The stash sequence did not appear in the project (its file: ${begun.shell}).`);
  const counts = { video: await seq.getVideoTrackCount(), audio: await seq.getAudioTrackCount() };
  if (counts.video < plan.video || counts.audio < plan.audio) {
    throw new UserError(`The stash sequence came with ${counts.video} video / ${counts.audio} audio tracks, ${plan.video} / ${plan.audio} were needed. Nothing was saved.`);
  }
  // every clip copied whole, the earliest to 0 s, on its own track
  let first = null;
  for (const x of picked) {
    const k = ticks(await x.ti.getStartTime());
    if (k !== null && (first === null || k < first)) first = k;
  }
  const editor = ppro.SequenceEditor.getEditor(seq);
  transaction(project, "Asistent: Stash clips (copy)", (c) => {
    for (const x of picked) c.addAction(editor.createCloneTrackItemAction(x.ti, ppro.TickTime.createWithTicks((-first).toString()), 0, 0, true, false));
  });
  const got = (await P.readItems(seq)).items;
  debug(`stash clips ${begun.sequence}: ${picked.length} selected, ${got.length} copied: ${got.map((x) => `${x.kind[0]}${x.track + 1} ${x.name} ${x.start.toFixed(2)}-${x.end.toFixed(2)}`).join(" | ")}`);
  if (got.length !== picked.length) {
    throw new UserError(`Only ${got.length} of ${picked.length} clips were copied into ${begun.sequence}: not saved. That sequence is in the bin "${STASH_BIN}".`);
  }
  const ex = await engine.stashClipsExport({ id: begun.id, sequence: begun.sequence, guid: guidOf(seq), project: project.path });
  if (!ex.ok) throw new UserError(`Premiere did not save the stash: ${ex.msg || "no answer"}.`);
  const r = await engine.stashSave({ kind: "clips", id: begun.id, name: plan.name, sequence: begun.sequence, span: plan.span,
    fps: t.fps, size, items: plan.items, video: plan.video, audio: plan.audio }, project.path);
  return { name: r.name, client: r.client, count: plan.items.length,
    lines: [`${plan.items.length} clips, ${plan.span.toFixed(2)} s: ${plan.items.map((x) => x.label).join(", ")}.`,
      `Its sequence ${begun.sequence} is in the bin "${STASH_BIN}"; Premiere's file is kept on this computer (${Math.max(1, Math.round((ex.bytes || 0) / 1024))} KB).`] };
}

/** Copy a clips stash into the active sequence at the playhead. -> {placed, lines, steps} */
async function applyClips(project, stash) {
  const timeline = await P.readTimeline(project);
  const target = timeline.sequence;
  if (String(target.name || "").startsWith("Stash - ")) throw new UserError("Open the sequence to put the stash in (this one is a stash's own).");
  const playhead = secs(await maybe(target, "getPlayerPosition"));
  if (!Number.isFinite(playhead)) throw new UserError("Premiere did not say where the playhead is.");
  const fps = timeline.fps || 30;
  const at = Math.round(playhead * fps) / fps;
  const lines = [];
  let source = await findSequence(project, stash.sequence);
  if (!source) {
    source = await importInto(project, stash.file, stash.sequence);
    if (!source) throw new UserError(`Premiere did not bring in the stash's project file (${stash.file}).`);
    lines.push(`Brought in from its project file: the stash's sequence and media items are in the bin "${STASH_BIN}".`);
  }
  const src = (await P.readItems(source)).items;
  if (!src.length) throw new UserError(`The stash sequence ${stash.sequence} has no clips.`);
  const fit = S.fitClips(stash, at, timeline.items, timeline.counts, fps);
  if (fit.error) throw new UserError(fit.error);
  if (fit.add.video || fit.add.audio) {
    const r = await engine.addTracks({ sequence: target.name, guid: guidOf(target), project: project.path, video: fit.add.video, audio: fit.add.audio });
    if (!r.ok) throw new UserError(`No free tracks for the stash and Premiere did not add any: ${r.msg}`);
    lines.push(`Added ${[fit.add.video ? `${fit.add.video} video` : "", fit.add.audio ? `${fit.add.audio} audio` : ""].filter(Boolean).join(" and ")} track${fit.add.video + fit.add.audio > 1 ? "s" : ""} on top.`);
  }
  const tpf = BigInt(Math.round(Number(await maybe(target, "getTimebase")) || 0));
  const offset = tpf > 0n ? BigInt(Math.round(at * fps)) * tpf : BigInt(Math.round(at * 254016000000));
  const editor = ppro.SequenceEditor.getEditor(target);
  transaction(project, `Asistent: Stash ${stash.name || ""}`.trim(), (c) => {
    for (const x of src) c.addAction(editor.createCloneTrackItemAction(x.ti, ppro.TickTime.createWithTicks(offset.toString()), fit.dv, fit.da, true, false));
  });
  // check every copy is where the plan says, then link a clip with its sound again (the host, one more Undo step)
  const after = (await P.readItems(target)).items;
  const tol = 0.5 / fps;
  const missing = fit.ranges.filter((r) => !after.some((x) => x.kind === r.kind && x.track === r.track && Math.abs(x.start - r.start) < tol && Math.abs(x.end - r.end) < tol));
  const groups = S.linkGroups(fit.ranges);
  let steps = 1;
  if (groups.length) {
    try {
      const l = await engine.roughLink({ sequence: target.name, guid: guidOf(target), project: project.path, groups });
      if (l.ok && l.linked) steps++;
      if (!l.ok || l.linked < groups.length) lines.push(`Linked ${l.linked || 0} of ${groups.length} clip${groups.length > 1 ? "s" : ""} with ${groups.length > 1 ? "their" : "its"} sound.`);
    } catch (e) {
      lines.push(`The copies are placed but not linked with their sound: ${e && e.message ? e.message : e}`);
    }
  }
  if (fit.dv || fit.da) lines.push(`Its tracks were busy at the playhead, so it went ${fit.dv ? `${fit.dv} video track${fit.dv > 1 ? "s" : ""} up` : ""}${fit.dv && fit.da ? " and " : ""}${fit.da ? `${fit.da} audio track${fit.da > 1 ? "s" : ""} down` : ""}.`);
  if (missing.length) lines.push(`Not where planned (check them): ${missing.map((r) => `${r.kind === "video" ? "V" : "A"}${r.track + 1} at ${r.start.toFixed(2)} s`).join(", ")}.`);
  debug(`stash clips ${stash.name} at ${at.toFixed(3)} on ${target.name}: ${src.length} copies, dv ${fit.dv}, da ${fit.da}, missing ${missing.length}, groups ${groups.length}`);
  return { placed: src.length - missing.length, total: src.length, at, lines, steps };
}

module.exports = { capture, apply, findParam, saveClips, applyClips, STASH_BIN };
