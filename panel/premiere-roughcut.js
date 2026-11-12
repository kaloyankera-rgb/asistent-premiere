// ROUGH CUT: reads the selected items (read only), then imports the engine's XML as ONE NEW sequence and checks it.
// Nothing in the source sequence is changed or removed (removing track items through UXP crashed Premiere 26.0.2).
// Why XML: probed in TEST.prproj, UXP importFiles makes the sequence without a dialog, frame exact and linked
// (docs/ROUGHCUT_PLAN.md, M0 results).
const ppro = require("premierepro");
const P = require("./premiere.js");
const engine = require("./engine.js");
const premiereAudio = require("./premiere-audio.js");
const premiereColor = require("./premiere-color.js");
const { planRoughCut, verify, verifyPieces } = require("./roughcutplan.js");
const { sideOf } = require("./audioplan.js");
const { sizeFrom, dirOf } = require("./subtitleplan.js");
const C = require("./premiere-captions.js");

async function frameSize(sequence) {
  const settings = await P.maybe(sequence, "getSettings");
  for (const name of ["getVideoFrameRect", "getVideoFrameSize"]) {
    const size = sizeFrom(await P.maybe(settings, name));
    if (size) return size;
  }
  return null;
}

/** -> { payload, plan } or throws P.UserError with what to fix. */
async function readInput(project, opts) {
  const t = await P.readTimeline(project);
  const plan = planRoughCut(t.items);
  if (!plan.selected) throw new P.UserError("Select the clips in the timeline: the cameras and the microphones.");
  if (!plan.dialogue.length) throw new P.UserError(`Select the audio clips too: the silences are found from the sound. ${plan.skipped.join("; ")}`);
  if (!plan.layout.length) throw new P.UserError(`No suitable clip. ${plan.skipped.join("; ")}`);
  const folder = dirOf(project.path);
  if (!folder) throw new P.UserError("Save the project (Cmd/Ctrl+S): the files of the new sequence go into its folder.");
  const size = await frameSize(t.sequence);
  // what the new pieces must carry over: an Asistent split clip's channel (L/L, R/R) and the level go into the XML; the
  // limiter and the colour are put on the new pieces after the import (carry below)
  const meta = [];
  for (const [i, x] of plan.refs.entries()) {
    const m = { gain_db: null, limiter: false, lum: null, others: [], keyframed: false };
    try {
      if (x.kind === "audio") {
        const side = sideOf(x.name);
        if (side) plan.layout[i].channel = side === "L" ? 1 : 2;
        const fx = await premiereAudio.readEffects(x.ti);
        if (fx.gain_db !== null) plan.layout[i].gain_db = fx.gain_db;
        Object.assign(m, { gain_db: fx.gain_db, limiter: fx.limiter, others: fx.others, keyframed: fx.keyframed, side });
      } else {
        const lum = await premiereColor.readLumetri(x);
        if (lum) Object.assign(m, { lum: lum.values ? lum : null, others: lum.others, lumExtra: lum.extra, lumAnimated: lum.animated, name: x.name });
      }
    } catch (e) {
      engine.log("warn", `roughcut: effects of ${x.name} not read: ${e && e.message ? e.message : e}`);
    }
    meta.push(m);
  }
  const payload = { items: plan.dialogue, layout: plan.layout, out_dir: folder, name: t.sequence.name || "sequence", fps: t.fps || 25,
    width: size && size.width, height: size && size.height, mode: opts.mode, tempo: opts.tempo, markers: !!opts.markers, fast: !!opts.fast,
    threshold: opts.threshold === undefined ? null : opts.threshold, skipped: plan.skipped };
  engine.log("info", `roughcut: ${plan.layout.length} items (${plan.layout.map((x) => `${x.kind[0].toUpperCase()}${x.track + 1} ${x.name}`).join(" | ")}), ` +
    `${plan.dialogue.length} for the sound, ${plan.skipped.length} skipped, ${t.fps} fps, ${opts.mode}/${opts.tempo}${opts.threshold === null || opts.threshold === undefined ? "" : ` ${opts.threshold} dB`}`);
  return { payload, plan, meta, sequence: t.sequence };
}

async function findSequence(project, name) {
  for (const s of (await P.maybe(project, "getSequences")) || []) if (s.name === name) return s;
  return null;
}

// ---------------------------------------------------------------- 0.10.45: the rough cut from clones of the editor's clips
// The user (2026-11-11): the rough cut "changes the rotation of the videos and also removes the Fix audio appliances".
// Measured in the Pulse Fitness project: the XML import makes NEW master clips, and Premiere 26.5.2 switched off their
// rotation flag (IsOverridenImageOrientationType: the FX3's vertical shots came in sideways) and dropped their S-Log3
// colour space; Fix audio's L/R copies came in as plain stereo. So the XML now only makes the empty sequence (size, rate,
// tracks, review markers; xmeml.write shell) and every piece is a CLONE of the editor's own clip, trimmed and moved into
// place: same file and project item, every effect, Motion, colour and Fix audio's L/R copy as it was. Probed in NEW TEST
// (2026-11-11, bridge rough_probe): a clone lands on the same track, In / Out trim it, a move puts it exactly in place;
// a clone is one track item (its linked audio does not come along), so the parts are cloned one by one and linked again
// through the host (as Fix audio relinks its copies).
const SCRATCH_GAP = 10;                                     // s between clones while they wait to be trimmed

async function ticksOf(t) {
  return t && t.ticks !== undefined ? BigInt(String(t.ticks)) : null;
}

async function cloneInto(project, sequence, result, refs) {
  const fps = result.check.fps;
  const editor = ppro.SequenceEditor.getEditor(sequence);
  if (!P.has(editor, "createCloneTrackItemAction")) return null;
  const tpf = BigInt(Math.round(Number(await P.maybe(sequence, "getTimebase")) || 0));
  if (tpf <= 0n) return null;
  const T = (ticks) => ppro.TickTime.createWithTicks(ticks.toString());
  const frameTicks = (frames) => BigInt(Math.round(frames)) * tpf;
  // 1. every piece's clip, cloned whole, far after the end (each in its own place, nothing overlaps)
  let slot = frameTicks(result.check.frames + 60 * Math.round(fps));
  const jobs = [];
  for (const p of result.pieces || []) {
    const ref = refs[p.item];
    if (!ref || !ref.ti) continue;
    const start = await ticksOf(await ref.ti.getStartTime());
    const end = await ticksOf(await ref.ti.getEndTime());
    if (start === null || end === null) continue;
    jobs.push({ p, ref, slot, offset: slot - start });
    slot += (end - start) + frameTicks(SCRATCH_GAP * Math.round(fps));
    slot = (slot / tpf) * tpf;                                 // on a frame
  }
  P.transaction(project, "Asistent: Remove silences (copies)", (c) => {
    for (const j of jobs) c.addAction(editor.createCloneTrackItemAction(j.ref.ti, T(j.offset), 0, 0, true, false));
  });
  // 2. find each copy, trim it to its piece
  const half = Number(tpf) / 2;
  const find = async () => {
    const out = [];
    for (const x of (await P.readItems(sequence)).items) out.push({ x, start: await ticksOf(await x.ti.getStartTime()) });
    return out;
  };
  let now = await find();
  for (const j of jobs) {
    const hit = now.find((n) => n.x.kind === j.p.kind && n.x.track === j.p.track && n.start !== null &&
      Math.abs(Number(n.start - j.slot)) < half && !jobs.some((o) => o !== j && o.copy === n.x));
    j.copy = hit ? hit.x : null;
  }
  const placed = jobs.filter((j) => j.copy);
  P.transaction(project, "Asistent: Remove silences (trim)", (c) => {
    for (const j of placed) {
      c.addAction(j.copy.ti.createSetInPointAction(T(frameTicks(j.p.src_in))));
      c.addAction(j.copy.ti.createSetOutPointAction(T(frameTicks(j.p.src_out))));
    }
  });
  // 3. move each trimmed copy into its place (it starts where its copy now starts; the scratch area ends up empty)
  for (const j of placed) j.at = await ticksOf(await j.copy.ti.getStartTime());
  P.transaction(project, "Asistent: Remove silences (place)", (c) => {
    for (const j of placed) if (j.at !== null) c.addAction(j.copy.ti.createMoveAction(T(frameTicks(j.p.start) - j.at)));
  });
  P.debug(`roughcut clones: ${jobs.length} pieces, ${placed.length} copies found`);
  // 4. the video and audio of one moment of one file are linked again (host: one step per group)
  const groups = new Map();
  for (const j of placed) {
    const key = `${j.p.path}|${j.p.src_in}|${j.p.start}|${j.p.end}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ kind: j.p.kind, track: j.p.track, start: j.p.start / fps, end: j.p.end / fps });
  }
  const linkable = [...groups.values()].filter((g) => g.length > 1);
  let link = { linked: 0, groups: 0 };
  if (linkable.length) {
    await P.maybe(project, "openSequence", sequence);
    try {
      link = await engine.roughLink({ sequence: sequence.name, guid: C.seqGuid(sequence), project: project.path, groups: linkable });
    } catch (e) {
      link = { linked: 0, groups: linkable.length, error: e && e.message ? e.message : String(e) };
    }
  }
  return { pieces: jobs.length, placed: placed.length, missing: (result.pieces || []).length - placed.length, link, groups: linkable.length };
}

async function importSequence(project, file, name) {
  const bin = await P.ensureBin(project, "No silence");
  const target = ppro.ProjectItem.cast(bin) || bin;
  const accepted = await project.importFiles([file], true, target, false);
  if (accepted === false) return null;
  for (let i = 0; i < 20; i++) {
    const s = await findSequence(project, name);
    if (s) return s;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/** The rough cut from clones (above); null when this Premiere cannot clone (then the XML with clips is used). */
async function placeClones(project, result, input) {
  const editorApi = ppro.SequenceEditor && typeof ppro.SequenceEditor.getEditor === "function";
  if (!result.shell || !input || !input.plan || !editorApi) return null;
  const sequence = await importSequence(project, result.shell, result.name);
  if (!sequence) return { problems: [`The sequence "${result.name}" did not appear in the project. The XML is in the Asistent_roughcut folder: File > Import.`], notes: [] };
  const r = await cloneInto(project, sequence, result, input.plan.refs);
  if (!r) return { problems: ["This Premiere version cannot copy clips between sequences: import the XML with clips from the Asistent_roughcut folder (File > Import)."], notes: [] };
  const { items } = await P.readItems(sequence);
  const problems = verifyPieces(result.pieces, items, result.check.fps);
  if (r.missing > 0) problems.unshift(`${r.missing} of ${r.pieces} pieces could not be placed.`);
  if (r.link.error) problems.push(`The pieces were placed but not linked (video with its audio): ${r.link.error}`);
  P.debug(`roughcut verify ${result.name} (clones): ${problems.length ? problems.join(" | ") : "as written"}; linked ${r.link.linked} of ${r.groups}`);
  await P.maybe(project, "openSequence", sequence);
  const notes = [{ cls: "line", text: "Made from copies of your own clips: rotation, Motion, colour, effects and Fix audio's L / R copies are as they were." },
    { cls: "hint", text: `Undo: Cmd/Ctrl+Z takes it back in ${3 + (r.groups ? 1 : 0)}+ steps (the copies, the trim, the placing${r.groups ? ", the links" : ""}); deleting the sequence is quicker.` }];
  return { problems, notes };
}

/** Import the XML into the bin "Rough cut", find the new sequence, check it against the engine's EDL, carry the effects
 *  over, open it. -> { problems: [text], notes: [{cls, text}] }. input (0.10.45): readInput's answer: the copies way. */
async function place(project, result, meta, input) {
  const cloned = await placeClones(project, result, input);
  if (cloned) return cloned;
  const bin = await P.ensureBin(project, "No silence");
  const target = ppro.ProjectItem.cast(bin) || bin;
  const accepted = await project.importFiles([result.xml], true, target, false);
  if (accepted === false) return { problems: ["Premiere did not accept the XML file. It is in the Asistent_roughcut folder: File > Import."], notes: [] };
  let sequence = null;
  for (let i = 0; i < 20 && !sequence; i++) {
    sequence = await findSequence(project, result.name);
    if (!sequence) await new Promise((r) => setTimeout(r, 250));
  }
  if (!sequence) return { problems: [`The sequence "${result.name}" did not appear in the project. The XML is in the Asistent_roughcut folder: File > Import.`], notes: [] };
  const { items } = await P.readItems(sequence);
  const got = { video: {}, audio: {}, end: 0 };
  for (const it of items) {
    const key = String(it.track + 1);
    got[it.kind][key] = (got[it.kind][key] || 0) + 1;
    got.end = Math.max(got.end, it.end);
  }
  const problems = [...verify(result.check, got), ...verifyPieces(result.pieces, items, result.check.fps)];
  P.debug(`roughcut verify ${result.name}: ${problems.length ? problems.join(" | ") : "as written"}`);
  const notes = [];
  try {
    notes.push(...(await carry(project, sequence, result, meta || [])));
  } catch (e) {
    P.debug(`roughcut carry failed: ${e && e.stack ? e.stack : e}`);
    problems.push(`The effects were not fully carried over: ${e && e.message ? e.message : e}`);
  }
  await P.maybe(project, "openSequence", sequence);
  return { problems, notes };
}

// The new sequence has no effects of its own (it is built from the media). What Asistent writes is put back on the new
// pieces: the channel (L/L, R/R) and the level came through the XML (the level is checked and set again when the import
// did not take it), then Dynamics > Limiter −6 dB and the Lumetri values. Everything else on the old clips is said, not hidden.
async function carry(project, sequence, result, meta) {
  const fps = result.check.fps;
  const { items } = await P.readItems(sequence);
  const find = (p) => items.find((n) => n.kind === p.kind && n.track === p.track && Math.abs(n.start - p.start / fps) < 0.002);
  const targets = [];
  const pairs = [];
  const plans = [];
  let levelFixed = 0;
  for (const p of result.pieces || []) {
    const m = meta[p.item];
    const ni = m && find(p);
    if (!ni) continue;
    if (p.kind === "audio") {
      const plan = { lines: [], problems: [] };
      plans.push(plan);
      const now = m.gain_db === null ? null : await premiereAudio.readLevelDb(ni.ti);
      const needLevel = m.gain_db !== null && !m.keyframed && (now === null || Math.abs(now - m.gain_db) > 0.3);
      if (!needLevel && !m.limiter) continue;
      const out = needLevel ? { lufs: 0, gain_db: m.gain_db, result_lufs: 0, result_peak_db: 0, keyframes: [] } : { lufs: null, note: "" };
      if (needLevel) levelFixed++;
      targets.push({ plan, track: ni.track, start: ni.start, out, who: `A${ni.track + 1}`, noLimiter: !m.limiter });
    } else if (m.lum && m.lum.values) {
      pairs.push({ clip: ni, values: m.lum.values, owned: m.lum.owned });
    }
  }
  const notes = [];
  let limited = 0;
  if (targets.length) {
    await premiereAudio.applyLevels(project, sequence, targets);
    limited = targets.filter((t) => !t.noLimiter).length;
    for (const pl of plans) for (const x of pl.problems) notes.push({ cls: "warn", text: x });
  }
  let coloured = 0;
  if (pairs.length) {
    for (const d of await premiereColor.copyLumetri(project, pairs)) {
      if (d.problem) notes.push({ cls: "warn", text: `Color: ${d.problem}` });
      else coloured++;
    }
  }
  const said = [];
  const has = { audio: false, video: false, gain: false };
  for (const m of meta) {
    if (m.limiter) has.audio = true;
    if (m.gain_db !== null) has.gain = true;
  }
  if (has.audio || has.gain) said.push(`audio: ${has.gain ? "level" : ""}${has.gain && has.audio ? ", " : ""}${has.audio ? `limiter −6 dB (${limited} pieces)` : ""}${levelFixed ? `; the level was set again on ${levelFixed}` : ""}`);
  if (coloured) said.push(`color: Lumetri on ${coloured} pieces`);
  if (said.length) notes.push({ cls: "line", text: `Carried over from the old clips: ${said.join("; ")}.` });
  const others = [...new Set(meta.flatMap((m) => m.others || []))];
  if (others.length) notes.push({ cls: "warn", text: `Not carried over (not possible through XML): ${others.join(", ")}.` });
  if (meta.some((m) => m.keyframed)) notes.push({ cls: "warn", text: "The level keyframes (Even out phrases) were not carried over: apply them again on the new sequence." });
  // per clip, what of its Lumetri did not arrive (0.10.6: a Highlights-only grade used to vanish without a word)
  for (const m of meta) {
    if (m.lumExtra) {
      notes.push({ cls: "warn", text: `${m.name}: ${m.lum ? "only Exposure, Temperature, Tint, Contrast and Saturation of its Lumetri were carried over" : "its Lumetri was not carried over"}; any other Lumetri settings (Highlights, Curves, a LUT…) were not.` });
    }
    if (m.lumAnimated && m.lumAnimated.length) notes.push({ cls: "warn", text: `${m.name}: its Lumetri keyframes (${m.lumAnimated.join(", ")}) were not carried over, only the first value.` });
  }
  return notes;
}

module.exports = { readInput, place };
