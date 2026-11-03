// ROUGH CUT: reads the selected items (read only), then imports the engine's XML as ONE NEW sequence and checks it.
// Nothing in the source sequence is changed or removed (removing track items through UXP crashed Premiere 26.0.2).
// Why XML: probed in TEST.prproj, UXP importFiles makes the sequence without a dialog, frame exact and linked
// (docs/ROUGHCUT_PLAN.md, M0 results).
const ppro = require("premierepro");
const P = require("./premiere.js");
const engine = require("./engine.js");
const premiereAudio = require("./premiere-audio.js");
const premiereColor = require("./premiere-color.js");
const { planRoughCut, verify } = require("./roughcutplan.js");
const { sideOf } = require("./audioplan.js");
const { sizeFrom, dirOf } = require("./subtitleplan.js");

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
  if (!plan.selected) throw new P.UserError("Select the clips for the rough cut in the timeline: the cameras and the microphones with speech.");
  if (!plan.dialogue.length) throw new P.UserError(`Select the audio clip with speech too: the pauses are found from the sound. ${plan.skipped.join("; ")}`);
  if (!plan.layout.length) throw new P.UserError(`No suitable clip. ${plan.skipped.join("; ")}`);
  const folder = dirOf(project.path);
  if (!folder) throw new P.UserError("Save the project (Cmd/Ctrl+S): the rough cut files go into its folder.");
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
        if (lum) Object.assign(m, { lum: lum.values ? lum : null, others: lum.others });
      }
    } catch (e) {
      engine.log("warn", `roughcut: effects of ${x.name} not read: ${e && e.message ? e.message : e}`);
    }
    meta.push(m);
  }
  const payload = { items: plan.dialogue, layout: plan.layout, out_dir: folder, name: t.sequence.name || "sequence", fps: t.fps || 25,
    width: size && size.width, height: size && size.height, mode: opts.mode, tempo: opts.tempo, markers: !!opts.markers, skipped: plan.skipped };
  engine.log("info", `roughcut: ${plan.layout.length} items (${plan.layout.map((x) => `${x.kind[0].toUpperCase()}${x.track + 1} ${x.name}`).join(" | ")}), ` +
    `${plan.dialogue.length} for the sound, ${plan.skipped.length} skipped, ${t.fps} fps, ${opts.mode}/${opts.tempo}`);
  return { payload, plan, meta, sequence: t.sequence };
}

async function findSequence(project, name) {
  for (const s of (await P.maybe(project, "getSequences")) || []) if (s.name === name) return s;
  return null;
}

/** Import the XML into the bin "Rough cut", find the new sequence, check it against the engine's EDL, carry the effects
 *  over, open it. -> { problems: [text], notes: [{cls, text}] } */
async function place(project, result, meta) {
  const bin = await P.ensureBin(project, "Rough cut");
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
  const problems = verify(result.check, got);
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
  if (meta.some((m) => m.lum && !m.lum.owned)) notes.push({ cls: "warn", text: "A clip has a manual Lumetri grade: only Exposure, Temperature, Tint, Contrast and Saturation were carried over; the other settings were not." });
  return notes;
}

module.exports = { readInput, place };
