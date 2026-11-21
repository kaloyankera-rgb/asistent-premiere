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
const { payloadOptions } = require("./silenceplan.js");
const C = require("./premiere-captions.js");

async function frameSize(sequence) {
  const settings = await P.maybe(sequence, "getSettings");
  for (const name of ["getVideoFrameRect", "getVideoFrameSize"]) {
    const size = sizeFrom(await P.maybe(settings, name));
    if (size) return size;
  }
  return null;
}

// 0.10.96: what is cut is the selection, what lies between the sequence's In and Out, or the whole sequence
async function rangeOf(sequence, items, kind) {
  if (kind === "all") return { kind: "all" };
  if (kind !== "inout") return { kind: "selection" };
  const end = items.reduce((m, x) => Math.max(m, x.end), 0);
  const from = P.secs(await P.maybe(sequence, "getInPoint"));
  const to = P.secs(await P.maybe(sequence, "getOutPoint"));
  if (!(Number.isFinite(from) && Number.isFinite(to) && to > from + 0.01) || (from <= 0.001 && to >= end - 0.001)) {
    throw new P.UserError("Set an In and an Out point in the sequence (I and O), or choose Selected clips or Whole sequence in the options.");
  }
  return { kind: "inout", from, to };
}

/** -> { payload, plan } or throws P.UserError with what to fix. */
async function readInput(project, opts) {
  P.trace("readInput>");
  const t = await P.readTimeline(project);
  P.trace("timeline read");
  const range = await rangeOf(t.sequence, t.items, opts.range);
  const plan = planRoughCut(t.items, range);
  if (!plan.selected) {
    throw new P.UserError(range.kind === "selection" ? "Select the clips in the timeline: the cameras and the microphones."
      : range.kind === "inout" ? "No clip lies between the In and the Out point." : "The sequence has no clips.");
  }
  if (!plan.dialogue.length) throw new P.UserError(`${range.kind === "selection" ? "Select the audio clips too" : "No usable audio clip there"}: the silences are found from the sound. ${plan.skipped.join("; ")}`);
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
  // the placing works from where each clip is, as numbers; the handles are let go here (see churn below)
  for (const x of plan.refs) {
    if (!x.ti) continue;
    x.tk = { start: await ticksOf(await x.ti.getStartTime()), end: await ticksOf(await x.ti.getEndTime()), inn: await ticksOf(await x.ti.getInPoint()) };
    x.ti = null;
  }
  P.trace("effects read");
  const payload = { items: plan.dialogue, layout: plan.layout, out_dir: folder, name: t.sequence.name || "sequence", fps: t.fps || 25,
    width: size && size.width, height: size && size.height, fast: !!opts.fast, skipped: plan.skipped, ...payloadOptions(opts) };
  engine.log("info", `roughcut: ${plan.layout.length} items (${plan.layout.map((x) => `${x.kind[0].toUpperCase()}${x.track + 1} ${x.name}`).join(" | ")}), ` +
    `${plan.dialogue.length} for the sound, ${plan.skipped.length} skipped, ${t.fps} fps, ${range.kind}, ${opts.mode}/${opts.method}/${opts.pacing}/${opts.action}` +
    `${opts.threshold === null || opts.threshold === undefined ? "" : ` ${opts.threshold} dB`}`);
  for (const x of t.items) x.ti = null;
  return { payload, plan, meta, sequence: t.sequence };
}

/** The same clips with other options or the editor's review choices (the preview after a changed setting: Premiere is not read again). */
function withOptions(input, opts, extra) {
  const keep = {};
  for (const k of ["items", "layout", "out_dir", "name", "fps", "width", "height", "skipped"]) keep[k] = input.payload[k];
  return { ...keep, fast: !!opts.fast, ...payloadOptions(opts, extra) };
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
// 0.10.94 (the user, 2026-11-15: Premiere crashed three times on Cut silences at -30 dB): every clone is the WHOLE clip,
// each in its own slot after the end, so 101 cuts of an 8-minute clip laid 204 whole copies out to 28.6 hours, past
// Premiere's 24-hour timeline, and Premiere crashed inside the clone transaction (crash reports 2026-11-15 05:09-05:10;
// the run before, 58 pieces reaching 4.1 hours, worked). The pieces now go through in batches whose scratch area stays
// within SCRATCH_SPAN; each batch is trimmed and moved into place before the next one reuses the same empty area.
const SCRATCH_SPAN = 2 * 3600;                              // s of timeline after the end that one batch may use
// 0.10.98 (the user, 2026-11-15 15:32 and 15:33, NEW TEST: "crashes when I select a sequence of POVs around 5 minutes; on a
// short selected clip it didn't"): many SHORT clips all fit the two hours, so 94 and 133 copies went into one transaction and
// Premiere crashed inside it (crash reports 15:32:40 and 15:33:57: a bad pointer in UXP's callback into the script, as on
// 05:09 with 204 copies). Every run that worked had at most 58 copies in one transaction (41, 9, 58; batched: 14-20), every
// crash had 94 or more. So a batch is also at most this many pieces, well under what is known to work.
const BATCH_PIECES = 20;

// 0.10.95 (engine log 2026-11-15 05:52, three presses on the "Lokali" clip): one action Premiere refused inside a transaction
// ("Illegal Parameter type" from addAction, then "The script object is no longer valid" on a trim) threw out of the middle of
// it; the actions added before it were kept (whole copies left after the end of v7 and v8, no audio), and the next press
// crashed Premiere inside a call on what was left (crash report 05:52:40). Each piece's actions are now made and added one
// piece at a time; a piece Premiere refuses is skipped and reported, the others go on, and nothing throws out of the transaction.
function actions(project, label, jobs, failed, step, make, stale) {
  // 0.10.99: every object Premiere hands out (the times, the actions) is made before the transaction starts, inside the
  // project lock (outside it Premiere answers "The script object is no longer valid" to every create...Action: probed in
  // NEW TEST 2026-11-15); inside the transaction only addAction runs. The crash reports of 2026-11-15 (05:52, 15:32, 15:33,
  // 15:42) all end where Premiere wraps a new object for the script inside a callback, and the same 82 pieces crashed
  // once and worked once, so it is not the size alone.
  if (!jobs.length) return;
  let ok = true;
  let any = false;
  P.trace(`act> ${step} ${jobs.length}`);
  project.lockedAccess(() => {
    const ready = [];
    for (const j of jobs) {
      try {
        const list = make(j);
        if (list.some((a) => !a)) throw new Error("Premiere gave no action");
        ready.push([j, list]);
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (stale && /no longer valid/i.test(msg)) stale.push(j);       // a handle Premiere replaced: read again, once more
        else {
          j.err = msg;
          failed.push({ step, p: j.p, err: j.err });
        }
      }
    }
    if (!ready.length) return;
    any = true;
    ok = project.executeTransaction((c) => {
      for (const [j, list] of ready) {
        try {
          for (const a of list) c.addAction(a);
        } catch (e) {
          j.err = e && e.message ? e.message : String(e);
          failed.push({ step, p: j.p, err: j.err });
        }
      }
    }, label);
  });
  P.trace(`act< ${step}`);
  if (any && !ok) throw new Error(`Premiere refused the operation: ${label}`);
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// EXPERIMENT 0.10.107. Premiere hands the script the same object for a clip every time it is asked, also after it has
// stopped being valid, for as long as the script still holds it anywhere. So the panel keeps no clip handle between
// steps, and makes and drops some memory here so that the dropped ones are really collected before the clips are read again.
function churn() {
  let junk = null;
  for (let i = 0; i < 12; i++) junk = new Array(200000).fill(i);
  return junk.length;
}
// After an edit Premiere releases, on its own thread, the objects it had handed the script for the clips it changed, while
// the script's thread makes new ones: the two collide inside Premiere (crash report 2026-11-15 16:50: the same bad pointer
// while the panel only wrote a text file). So after every transaction the panel does nothing at all for this long.
const QUIET_MS = 1000;
let quietMs = QUIET_MS;                                     // the tests do not wait

async function ticksOf(t) {
  return t && t.ticks !== undefined ? BigInt(String(t.ticks)) : null;
}

async function cloneInto(project, sequence, result, refs, source) {
  P.trace("cloneInto>");
  const fps = result.check.fps;
  const editor = ppro.SequenceEditor.getEditor(sequence);
  if (!P.has(editor, "createCloneTrackItemAction")) return null;
  const tpf = BigInt(Math.round(Number(await P.maybe(sequence, "getTimebase")) || 0));
  if (tpf <= 0n) return null;
  const T = (ticks) => ppro.TickTime.createWithTicks(ticks.toString());
  const frameTicks = (frames) => BigInt(Math.round(frames)) * tpf;
  // 1. every piece's clip, cloned whole, far after the end (each in its own place, nothing overlaps), in batches
  const base = frameTicks(result.check.frames + 60 * Math.round(fps));
  const span = frameTicks(SCRATCH_SPAN * Math.round(fps));
  const gap = frameTicks(SCRATCH_GAP * Math.round(fps));
  const jobs = [];
  const batches = [];
  let slot = base;
  for (const p of result.pieces || []) {
    const ref = refs[p.item];
    if (!ref || (!ref.tk && !ref.ti)) continue;
    // where the editor's clip is, as numbers (readInput took them and let the handle go); a caller that still has the
    // handle and no numbers (the tests) is asked here
    const tk = ref.tk || { start: await ticksOf(await ref.ti.getStartTime()), end: await ticksOf(await ref.ti.getEndTime()),
      inn: await ticksOf(await ref.ti.getInPoint()) };
    const { start, end } = tk;
    if (start === null || end === null) continue;
    // a batch always takes its first piece, however long the clip; the next piece that would go past the span starts a new one
    if (!batches.length || batches[batches.length - 1].length >= BATCH_PIECES || (slot !== base && slot + (end - start) > base + span)) {
      batches.push([]);
      slot = base;
    }
    const refIn = tk.inn;
    if (refIn === null) continue;
    const j = { p, ref, slot, offset: slot - start, refIn, srcStart: start, srcKind: ref.kind, srcTrack: ref.track };
    jobs.push(j);
    batches[batches.length - 1].push(j);
    slot += (end - start) + gap;
    slot = (slot / tpf) * tpf;                                 // on a frame
  }
  P.trace(`batches ${batches.length} jobs ${jobs.length}`);
  const half = Number(tpf) / 2;
  // 0.10.103, found with breadcrumbs on disk in NEW TEST (2026-11-15, eight crashes): after an edit Premiere goes on working
  // for a moment and REPLACES the objects it hands the script for the clips it touched. A handle read too early is dead a
  // moment later: used then, Premiere answers "The script object is no longer valid" or crashes (a bad pointer while it
  // wraps the next object). So before every step the panel waits (QUIET_MS), reads the clips once, uses the handles at
  // once, and a handle that is refused all the same is read again and tried again.
  const read = async (seq) => {
    const out = [];
    for (const x of (await P.readItems(seq)).items) out.push({ x, start: await ticksOf(await x.ti.getStartTime()) });
    return out;
  };
  // Premiere is left alone for a moment after every edit, then the clips are read ONCE and used at once
  const settled = async (seq) => {
    churn();
    await pause(quietMs);
    return read(seq);
  };
  const failed = [];
  // one step of a batch: the handles are taken when Premiere is quiet, used at once, and what was refused as stale is tried
  // again with new ones (three more times)
  const step = async (label, name, todo, acquire, make) => {
    for (let attempt = 0; attempt < 4 && todo.length; attempt++) {
      const ready = await acquire(todo);
      const stale = [];
      actions(project, label, ready, failed, name, make, stale);
      if (stale.length) P.trace(`stale ${name} ${stale.length}, attempt ${attempt + 1}`);
      todo = stale;
    }
    for (const j of todo) {
      j.err = "The script object is no longer valid.";
      failed.push({ step: name, p: j.p, err: j.err });
    }
  };
  // each copy among what the new sequence holds now, by its track and where it must start
  const locate = (list, now, at) => {
    const taken = new Set();
    for (const j of list) {
      const want = at(j);
      const hit = now.find((n) => n.x.kind === j.p.kind && n.x.track === j.p.track && n.start !== null &&
        Math.abs(Number(n.start - want)) < half && !taken.has(n.x));
      if (hit) taken.add(hit.x);
      j.copy = hit ? hit.x : null;
    }
    return list.filter((j) => j.copy);
  };
  const placed = [];
  for (const batch of batches) {
    // 1. the copies, whole, after the end. The editor's own clips are read again too (source: their sequence)
    let ed = null;
    await step("Asistent: Remove silences (copies)", "copy", batch, async (list) => {
      const fresh = source ? await settled(source) : null;
      for (const j of list) {
        const hit = fresh ? fresh.find((n) => n.x.kind === j.srcKind && n.x.track === j.srcTrack && n.start === j.srcStart) : { x: j.ref };
        j.src = hit ? hit.x.ti : null;
        j.t0 = T(j.offset);
      }
      ed = null;
      return list.filter((j) => j.src);
    }, (j) => {
      if (!ed) ed = ppro.SequenceEditor.getEditor(sequence);       // asked for anew for every transaction, inside the lock
      return [ed.createCloneTrackItemAction(j.src, j.t0, 0, 0, true, false)];
    });
    for (const j of batch) j.src = null;
    // 2. each copy trimmed to its piece and moved into its place, in ONE transaction and with one handle (0.10.104: a
    // transaction less per batch, and no second generation of handles). A head trim moves the copy's start along, so it
    // then starts where it was put plus what was trimmed off; the move counts from there.
    const copied = batch.filter((j) => !j.err);
    for (const j of copied) j.at = j.slot + (frameTicks(j.p.src_in) - j.refIn);
    await step("Asistent: Remove silences (trim and place)", "place", copied, async (list) => {
      const got = locate(list, await settled(sequence), (j) => j.slot);
      for (const j of got) [j.t1, j.t2, j.t3] = [T(frameTicks(j.p.src_in)), T(frameTicks(j.p.src_out)), T(frameTicks(j.p.start) - j.at)];
      return got;
    }, (j) => [j.copy.ti.createSetInPointAction(j.t1), j.copy.ti.createSetOutPointAction(j.t2), j.copy.ti.createMoveAction(j.t3)]);
    const trimmed = copied.filter((j) => !j.err && j.copy);
    placed.push(...trimmed.filter((j) => !j.err && j.copy));
    for (const j of batch) j.copy = null;                      // nothing is held across batches
  }
  await settled(sequence);                                     // before the links and the check
  P.debug(`roughcut clones: ${jobs.length} pieces in ${batches.length} batch${batches.length === 1 ? "" : "es"}, ${placed.length} placed` +
    (failed.length ? `; ${failed.length} refused by Premiere (first: ${failed[0].step} ${failed[0].p.kind} ${failed[0].p.track + 1}: ${failed[0].err})` : ""));
  // 4. the video and audio of one moment of one file are linked again (host: one step per group)
  const groups = new Map();
  for (const j of placed) {
    const key = `${j.p.path}|${j.p.src_in}|${j.p.start}|${j.p.end}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ kind: j.p.kind, track: j.p.track, start: j.p.start / fps, end: j.p.end / fps });
  }
  P.trace("link>");
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
  return { pieces: jobs.length, placed: placed.length, missing: (result.pieces || []).length - placed.length, link, groups: linkable.length,
    batches: batches.length, failed };
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
  P.trace("import>");
  const sequence = await importSequence(project, result.shell, result.name);
  P.trace(`import< ${!!sequence}`);
  if (!sequence) return { problems: [`The sequence "${result.name}" did not appear in the project. The XML is in the Asistent_roughcut folder: File > Import.`], notes: [] };
  await pause(quietMs);                                        // the import has just changed the project
  const r = await cloneInto(project, sequence, result, input.plan.refs, input.sequence);
  if (!r) return { problems: ["This Premiere version cannot copy clips between sequences: import the XML with clips from the Asistent_roughcut folder (File > Import)."], notes: [] };
  P.trace("cloneInto<");
  const { items } = await P.readItems(sequence);
  const problems = verifyPieces(result.pieces, items, result.check.fps);
  if (r.missing > 0) problems.unshift(`${r.missing} of ${r.pieces} pieces could not be placed` +
    (r.failed && r.failed.length ? ` (Premiere refused ${r.failed.length}: ${r.failed[0].err}). Copies it left after the end of the new sequence can be deleted.` : "."));
  if (r.link.error) problems.push(`The pieces were placed but not linked (video with its audio): ${r.link.error}`);
  P.debug(`roughcut verify ${result.name} (clones): ${problems.length ? problems.join(" | ") : "as written"}; linked ${r.link.linked} of ${r.groups}`);
  await P.maybe(project, "openSequence", sequence);
  const notes = [{ cls: "line", text: "Made from copies of your own clips: rotation, Motion, colour, effects and Fix audio's L / R copies are as they were." },
    { cls: "hint", text: `Undo: Cmd/Ctrl+Z takes it back in ${3 * (r.batches || 1) + (r.groups ? 1 : 0)}+ steps (the copies, the trim, the placing${(r.batches || 1) > 1 ? `, in ${r.batches} batches so the timeline stays short` : ""}${r.groups ? ", the links" : ""}); deleting the sequence is quicker.` }];
  return { problems, notes };
}

// ---------------------------------------------------------------- 0.10.108: the cut made by the host in a duplicate
// The copies above crash Premiere 26.5.3 on long selections (inside Premiere, where it hands the panel a copy of a clip:
// 2 of 8 runs on 85 pieces after every change tried here, see BUGS). So the cutting is done by the Asistent host
// (ExtendScript, host.jsx as_rough_cut), which does not go through that layer: it duplicates the editor's sequence, razors
// the duplicate at the cut frames, removes from it what is not a kept piece and moves the pieces together. The panel only
// says where (pure: hostPlan) and checks the result. The editor's own sequence is not touched.
const HOST_FALLBACK_PIECES = 40;                            // without the host: the copies, only while they are few

/** What the host needs, from the engine's pieces and the editor's clips (pure). pieces: [{k, t, f, e, at}] by where they
 *  lie in the source sequence (frames); cuts: [{f, only}] the frames to razor, `only` "v" / "a" when just the picture or
 *  just the sound is cut there (Mute). A frame is razored only where a piece ends INSIDE its clip: a clip's own edge is
 *  no cut, and a razor there would split the clips of other tracks. -> null when the engine gave no source places. */
function hostPlan(result, layout, refs, tpf) {
  const fps = result.check.fps;
  // where each clip really starts and ends (In to Out hands the engine only the part inside the range, and the range's
  // edge inside a clip is a cut like any other)
  const bounds = (i) => {
    const tk = refs && refs[i] && refs[i].tk;
    if (tk && tpf > 0 && tk.start !== null && tk.end !== null) return [Math.round(Number(tk.start) / tpf), Math.round(Number(tk.end) / tpf)];
    return [Math.round(layout[i].start * fps), Math.round(layout[i].end * fps)];
  };
  const pieces = [];
  const edges = { v: new Set(), a: new Set() };
  for (const p of result.pieces || []) {
    if (!Number.isFinite(p.seq_in) || !Number.isFinite(p.seq_out)) return null;
    const it = layout[p.item];
    if (!it) return null;
    const k = p.kind === "video" ? "v" : "a";
    pieces.push({ k, t: p.track, f: p.seq_in, e: p.seq_out, at: p.start });
    const [from, to] = bounds(p.item);
    if (p.seq_in > from) edges[k].add(p.seq_in);
    if (p.seq_out < to) edges[k].add(p.seq_out);
  }
  pieces.sort((x, y) => x.f - y.f);
  const cuts = [...new Set([...edges.v, ...edges.a])].map((f) => ({ f, only: edges.v.has(f) && edges.a.has(f) ? "" : edges.v.has(f) ? "v" : "a" }));
  // no sound clip at all (or no picture): nothing of the other kind can be cut by mistake, so no locking is needed
  const kinds = new Set(pieces.map((p) => p.k));
  if (kinds.size < 2) for (const c of cuts) c.only = "";
  cuts.sort((x, y) => (x.only < y.only ? -1 : x.only > y.only ? 1 : x.f - y.f));
  return { pieces, cuts, moves: pieces.filter((p) => p.at !== p.f).length };
}

/** The cut through the host. -> { problems, notes } (also `stopped`: the step the host stopped at, when it did not finish),
 *  or { fallback: why } when the host cannot start it and the copies may try (at most HOST_FALLBACK_PIECES pieces: more
 *  pieces are refused here, because the copies crashed Premiere on long selections).
 *  cancelled: () => true once the editor pressed Cancel; it is asked before every step and every round (0.10.122). */
async function hostCut(project, result, input, say, cancelled) {
  const count = (result.pieces || []).length;
  const stop = typeof cancelled === "function" ? cancelled : () => false;
  if (!count || !result.pieces.every((p) => Number.isFinite(p.seq_in) && Number.isFinite(p.seq_out))) {
    if (count > HOST_FALLBACK_PIECES) {
      throw new P.UserError(`The engine did not say where the ${count} pieces lie in your sequence, and the older copying way is only used for up to ${HOST_FALLBACK_PIECES} pieces. ` +
        "Nothing was cut. Update Asistent's engine and press again.");
    }
    return { fallback: "the engine gave no source places for the pieces" };
  }
  const src = input.sequence;
  const base = { sequence: src.name, guid: C.seqGuid(src), project: project.path, name: result.name };
  const tell = (m) => { if (say) say(m); };
  if (stop()) throw new P.UserError("Cancelled. Nothing was changed in Premiere.");
  let made;
  try {
    made = await engine.roughCut({ ...base, phase: "start" });
  } catch (e) {
    made = { ok: false, msg: e && e.message ? e.message : String(e) };
  }
  if (!made.ok) {
    engine.log("warn", `roughcut host: not started: ${made.msg}`);
    if (count <= HOST_FALLBACK_PIECES && !/already has a sequence/.test(made.msg || "")) return { fallback: String(made.msg || "it did not start").replace(/\s*Nothing was made\.?$/, "") };
    throw new P.UserError(`${made.msg} Nothing was cut.`);
  }
  const plan = hostPlan(result, input.plan.layout, input.plan.refs, Number(made.tpf) || 0);
  const left = `The unfinished sequence "${result.name}" can be deleted; your own sequence was not changed.`;
  let at = "the start";                                      // where the host is, for the message when it stops
  const phase = async (name, body, label, total, human) => {
    at = human;
    let i = 0;
    const sum = { moved: 0, missing: 0, removed: 0, refused: 0 };
    const first = {};                                       // the razor's evidence comes with its first round only: kept for the last answer
    for (let round = 0; round < 400; round++) {
      if (stop()) throw new Error("Stopped: you pressed Cancel.");
      const r = await engine.roughCut({ ...base, cut: made.cut, phase: name, i, ...body });
      if (!r.ok) throw new Error(r.msg || `Premiere refused the step "${name}".`);
      for (const k of Object.keys(sum)) sum[k] += r[k] || 0;
      for (const k of ["tc", "before", "after_first", "rate"]) if (r[k] !== undefined && first[k] === undefined) first[k] = r[k];
      if (r.done !== false) return { ...r, ...first, ...sum };
      i = r.i === undefined ? i : r.i;
      // Removing has no list to count through: it is driven by what is left to remove (a step that reports `left`)
      const did = r.left !== undefined ? sum.removed + sum.refused : (r.i === undefined ? 0 : r.i);
      const all = r.left !== undefined ? did + r.left : total;
      tell(`${label} ${all ? Math.min(99, Math.round((100 * did) / all)) : 0} %…`);
    }
    throw new Error(`The step "${name}" did not finish.`);
  };
  let moved = { moved: 0, missing: 0 };
  let done;
  let clean = { removed: 0, refused: 0, overlap: 0 };
  let cut = { refused: 0 };
  try {
    if (!plan) throw new Error("The cut plan does not fit the clips.");
    tell(`Cutting the duplicate (${plan.cuts.length} cuts)…`);
    cut = await phase("razor", { cuts: plan.cuts }, "Cutting", plan.cuts.length, "cutting");
    // the evidence for the odd-frame-rate probe (host.jsx as_cut_razor): what was handed to the razor and what it did
    if (cut.tc !== undefined) engine.log("info", `roughcut host: first razor at "${cut.tc}" on a ${cut.rate} sequence: ${cut.before} clips before it, ${cut.after_first} after (${plan.cuts.length} cuts, ${cut.refused || 0} refused)`);
    tell("Removing what goes…");
    clean = await phase("clean", { pieces: plan.pieces }, "Removing", 0, "removing");
    if (plan.moves) {
      tell(`Closing the gaps (${plan.moves} pieces)…`);
      moved = await phase("move", { pieces: plan.pieces }, "Closing the gaps", plan.pieces.length, "closing the gaps");
    }
    at = "the last step";
    if (stop()) throw new Error("Stopped: you pressed Cancel.");
    done = await engine.roughCut({ ...base, cut: made.cut, phase: "finish", i: plan.moves ? 1 : 0, pieces: plan.pieces, marks: result.marks || [] });
    if (!done.ok) throw new Error(done.msg || "Premiere refused the last step.");
    P.debug(`roughcut host: ${plan.cuts.length} cuts (${cut.refused || 0} refused), ${clean.removed} removed (${clean.refused || 0} refused), ` +
      `${moved.moved} moved (${moved.missing} missing), ${done.there} of ${plan.pieces.length} pieces in place, ${done.clips} clips`);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    engine.log("error", `roughcut host: stopped at ${at}: ${msg}`);
    // a message that already says the sequence can be deleted (the host's own) is not told twice
    return { problems: [/can be deleted/.test(msg) ? msg : `${msg} ${left}`], notes: [], stopped: at };
  }
  const problems = [];
  if (done.there < plan.pieces.length) problems.push(`${plan.pieces.length - done.there} of ${plan.pieces.length} pieces are not where they should be.`);
  if (done.clips > plan.pieces.length) problems.push(`${done.clips - plan.pieces.length} clips that should have gone are still in the new sequence.`);
  if (clean.overlap > 0) problems.push(`${clean.overlap} clips that overlap a kept piece were left in the new sequence, because removing them would have cost speech.`);
  // the panel's own look at the new sequence (read only), as after every rough cut
  try {
    const sequence = await findSequence(project, result.name);
    if (!sequence) problems.push(`The sequence "${result.name}" was made but the panel does not see it yet: it is in the bin "No silence".`);
    else {
      const { items } = await P.readItems(sequence);
      for (const x of verifyPieces(result.pieces, items, result.check.fps)) problems.push(x);
      for (const x of items) x.ti = null;
      await P.maybe(project, "openSequence", sequence);
    }
  } catch (e) {
    engine.log("warn", `roughcut host: the check could not read the new sequence: ${e && e.message ? e.message : e}`);
  }
  P.debug(`roughcut verify ${result.name} (host): ${problems.length ? problems.join(" | ") : "as written"}`);
  // How many Undo steps it took: Premiere's razor, removals and moves are each their own step, and the host cannot make
  // them one (the rule: when it cannot be one, the panel says how many). A count from what was done, not read from Premiere.
  const steps = plan.cuts.length + (clean.removed || 0) + (moved.moved || 0) + 1;
  const notes = [{ cls: "line", text: "Cut in a duplicate of your sequence: every piece is your own clip with its rotation, Motion, colour, effects, links and Fix audio's L / R copies. Your sequence was not changed." },
    { cls: "hint", text: `Not what you wanted? Delete the new sequence (bin "No silence"): quicker than Undo, which would take about ${steps} steps (every cut, removal and move is its own).` }];
  return { problems, notes };
}

/** Import the XML into the bin "Rough cut", find the new sequence, check it against the engine's EDL, carry the effects
 *  over, open it. -> { problems: [text], notes: [{cls, text}] }. input (0.10.45): readInput's answer: the copies way.
 *  0.10.108: first the host's cut in a duplicate; the copies only when the host is away and the pieces are few. */
async function place(project, result, meta, input, say, cancelled) {
  let why = null;
  if (input && input.plan && input.sequence) {
    const cut = await hostCut(project, result, input, say, cancelled);
    if (cut && !cut.fallback) return cut;
    if (cut) why = cut.fallback;
  }
  // 0.10.122: the older way is never silent: the result says the host did not make this cut and why
  const said = (r) => {
    if (why) r.notes.unshift({ cls: "warn", text: `The Asistent host did not make this cut (${why}), so the older way was used: copies of your clips. Premiere can be unstable with many copies.` });
    return r;
  };
  const cloned = await placeClones(project, result, input);
  if (cloned) return said(cloned);
  const bin = await P.ensureBin(project, "No silence");
  const target = ppro.ProjectItem.cast(bin) || bin;
  const accepted = await project.importFiles([result.xml], true, target, false);
  if (accepted === false) return said({ problems: ["Premiere did not accept the XML file. It is in the Asistent_roughcut folder: File > Import."], notes: [] });
  let sequence = null;
  for (let i = 0; i < 20 && !sequence; i++) {
    sequence = await findSequence(project, result.name);
    if (!sequence) await new Promise((r) => setTimeout(r, 250));
  }
  if (!sequence) return said({ problems: [`The sequence "${result.name}" did not appear in the project. The XML is in the Asistent_roughcut folder: File > Import.`], notes: [] });
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
  return said({ problems, notes });
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

module.exports = { readInput, withOptions, place, cloneInto, hostPlan, hostCut, _quiet: (ms) => { quietMs = ms; } };
