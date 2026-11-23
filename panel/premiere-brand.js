// The Brand page in Premiere (0.10.71): a kit file into the client's bin (once: a second press finds it there), onto the
// active sequence at the playhead or after the last clip, a MOGRT placed through the host, and a brand colour put on the
// selected clips. Placement never covers or cuts a clip: the track is the one just above everything at that time
// (brandplan.placeOn), added on top through the host when the sequence has no such track (as Stash clips does). Every
// placement is checked afterwards: the new clip where it was planned, every earlier clip still where it was.
const ppro = require("premierepro");
const P = require("./premiere.js");
const engine = require("./engine.js");
const BP = require("./brandplan.js");

const { UserError, transaction, maybe, debug, secs } = P;
const TPS = 254016000000;
const TINT = "AE.ADBE Tint";
const TEXT = "AE.ADBE Text";                             // the component of text made in Premiere (0.10.111-0.10.112)
const GROUP = "AE.ADBE Graphic Group";                   // the layers of a graphic made in Premiere start here
const norm = (p) => String(p || "").replace(/\\/g, "/").toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findIn(folder, path, depth = 0) {
  for (const item of (await folder.getItems()) || []) {
    const clip = ppro.ClipProjectItem.cast(item);
    if (clip) {
      if (norm(await maybe(clip, "getMediaFilePath")) === norm(path)) return { item, clip };
      continue;
    }
    const sub = depth < 3 ? ppro.FolderItem.cast(item) : null;
    if (sub) {
      const hit = await findIn(sub, path, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** The project item of `path` in the client's bin, imported there the first time. -> {item, clip, imported} */
async function ensureItem(project, path, binName) {
  const bin = await P.ensureBin(project, binName);
  const have = await findIn(bin, path);
  if (have) return { ...have, imported: false };
  const target = ppro.ProjectItem.cast(bin) || bin;
  const accepted = await project.importFiles([path], true, target, false);
  let hit = null;
  for (let i = 0; i < 20 && !hit; i++) {
    hit = await findIn(bin, path);
    if (!hit) await sleep(150);
  }
  const name = path.replace(/^.*[\\/]/, "");
  debug(`brand import ${name} -> ${binName}: accepted ${accepted}, in the bin ${!!hit}`);
  if (!hit) {
    throw new UserError(accepted ? `${name} was imported but did not appear in the bin "${binName}".`
      : `Premiere did not import ${name} (a format it does not read?).`);
  }
  return { ...hit, imported: true };
}

async function timeAt(sequence, s) {
  const tpf = Number(await maybe(sequence, "getTimebase"));
  return tpf > 0 ? ppro.TickTime.createWithTicks((BigInt(Math.round((s * TPS) / tpf)) * BigInt(Math.round(tpf))).toString())
    : ppro.TickTime.createWithSeconds(s);
}

// how long the item lasts on the timeline (a still: Premiere's default still length), when Premiere says
async function itemSeconds(clip) {
  const V = ppro.Constants && ppro.Constants.MediaType ? ppro.Constants.MediaType.VIDEO : undefined;
  const i = secs(await maybe(clip, "getInPoint", V));
  const o = secs(await maybe(clip, "getOutPoint", V));
  return Number.isFinite(o) && o > (i || 0) + 0.01 && o < 1e6 ? o - (i || 0) : null;
}

async function addTracks(project, sequence, video, audio) {
  const guid = require("./premiere-captions.js").seqGuid(sequence);
  const r = await engine.addTracks({ sequence: sequence.name, guid, project: project.path, video, audio });
  if (!r.ok) throw new UserError(`No free track there and Premiere did not add one: ${r.msg}`);
}

async function where(sequence, items, mode, fps) {
  let at = mode === "end" ? BP.sequenceEnd(items) : secs(await maybe(sequence, "getPlayerPosition"));
  if (!Number.isFinite(at)) throw new UserError("Premiere did not say where the playhead is.");
  return Math.round(Math.max(0, at) * fps) / fps;
}

function moved(before, after, tol) {
  return before.filter((b) => !after.some((a) => a.kind === b.kind && a.track === b.track && Math.abs(a.start - b.start) < tol && Math.abs(a.end - b.end) < tol));
}

const trackName = (kind, t) => `${kind === "video" ? "V" : "A"}${t + 1}`;

/**
 * Put a kit file on the active sequence. asset: {name, kind, duration?, has_audio?}; opts: {bin, mode: "playhead"|"end", at?}.
 * -> {lines, ok, track, at, imported}
 */
async function place(project, asset, path, opts) {
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new UserError("Open a sequence first: the file goes into the active sequence.");
  const got = await ensureItem(project, path, opts.bin);
  const fps = (await P.frameRate(sequence)) || 30;
  const before = await P.readItems(sequence);
  // 0.10.153: the Tracker's marker clip goes at a given time (the tracked clip's start), not at the playhead
  const at = Number.isFinite(opts.at) ? Math.round(Math.max(0, opts.at) * fps) / fps : await where(sequence, before.items, opts.mode, fps);
  const hasVideo = asset.kind !== "audio" && asset.has_video !== false;
  const hasAudio = asset.kind === "audio" || (asset.kind === "video" && !!asset.has_audio);
  const dur = (await itemSeconds(got.clip)) || asset.duration || null;
  const plan = BP.placeOn(before.items, before.counts, at, dur, { video: hasVideo, audio: hasAudio });
  const lines = [];
  if (plan.addVideo || plan.addAudio) {
    await addTracks(project, sequence, plan.addVideo, plan.addAudio);
    lines.push(`Added ${[plan.addVideo ? `${plan.addVideo} video` : "", plan.addAudio ? `${plan.addAudio} audio` : ""].filter(Boolean).join(" and ")} track on top: no free one there.`);
  }
  const editor = ppro.SequenceEditor.getEditor(sequence);
  const time = await timeAt(sequence, at);
  let err = null;
  let done = false;
  for (const it of [got.item, got.clip]) {
    try {
      transaction(project, `Asistent: ${asset.name}`, (c) => c.addAction(editor.createOverwriteItemAction(it, time, plan.video, plan.audio)));
      done = true;
      break;
    } catch (e) {
      err = e;
      debug(`brand place ${asset.name}: overwrite refused (${e && e.message ? e.message : e})`);
    }
  }
  if (!done) throw new UserError(`Premiere did not place ${asset.name}: ${err && err.message ? err.message : err}. It is in the bin "${opts.bin}".`);
  const after = await P.readItems(sequence);
  const tol = 0.5 / fps + 0.002;
  const kind = hasVideo ? "video" : "audio";
  const track = hasVideo ? plan.video : plan.audio;
  const hit = after.items.find((x) => x.kind === kind && x.track === track && Math.abs(x.start - at) < tol && norm(x.path) === norm(path));
  const lost = moved(before.items, after.items, tol);
  debug(`brand place ${asset.name} at ${at.toFixed(3)} ${trackName(kind, track)}${hasAudio && hasVideo ? ` + ${trackName("audio", plan.audio)}` : ""}: ` +
    `found ${!!hit}${hit ? ` ${hit.start.toFixed(2)}-${hit.end.toFixed(2)}` : ""}, earlier clips changed ${lost.length}, duration known ${dur || "no"}`);
  if (!hit) lines.push(`Check the timeline: the new clip was not found on ${trackName(kind, track)} at ${at.toFixed(2)} s.`);
  if (lost.length) lines.push(`Check ${lost.length} clip${lost.length > 1 ? "s" : ""} on the timeline: not where ${lost.length > 1 ? "they were" : "it was"} before (Cmd/Ctrl+Z takes the placement back).`);
  const steps = 1 + (plan.addVideo || plan.addAudio ? 1 : 0);      // adding a track (the host) is a step of its own
  return { ok: !!hit && !lost.length, at, track: trackName(kind, track), imported: got.imported, end: hit ? hit.end : null, lines, steps };
}

/** Import only (into the client's bin). */
async function importOnly(project, path, bin) {
  const got = await ensureItem(project, path, bin);
  return { imported: got.imported };
}

/** A MOGRT at the playhead through the host (ExtendScript importMGT, proven for the subtitle graphics). */
async function placeMogrt(project, asset, path, opts) {
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new UserError("Open a sequence first: the MOGRT goes into the active sequence.");
  const fps = (await P.frameRate(sequence)) || 30;
  const before = await P.readItems(sequence);
  const at = await where(sequence, before.items, opts.mode, fps);
  // its length is unknown before it is placed: the track is free from `at` to the end of everything
  const plan = BP.placeOn(before.items, before.counts, at, null, { video: true, audio: true });
  const lines = [];
  if (plan.addVideo || plan.addAudio) {
    await addTracks(project, sequence, plan.addVideo, plan.addAudio);
    lines.push("Added a track on top: no free one there.");
  }
  const guid = require("./premiere-captions.js").seqGuid(sequence);
  const r = await engine.brandMogrt({ path, sequence: sequence.name, guid, project: project.path, seconds: at, video: plan.video, audio: plan.audio });
  if (!r.ok) throw new UserError(r.msg || "Premiere did not place the MOGRT.");
  const after = await P.readItems(sequence);
  const tol = 0.5 / fps + 0.002;
  const hit = after.items.find((x) => x.kind === "video" && x.track === plan.video && Math.abs(x.start - at) < tol);
  const lost = moved(before.items, after.items, tol);
  debug(`brand mogrt ${asset.name} at ${at.toFixed(3)} V${plan.video + 1}: host ${JSON.stringify(r)}, found ${!!hit}, earlier clips changed ${lost.length}`);
  if (!hit) lines.push(`Check the timeline: the MOGRT was not found on V${plan.video + 1} at ${at.toFixed(2)} s.`);
  if (lost.length) lines.push(`Check ${lost.length} clip${lost.length > 1 ? "s" : ""}: not where before.`);
  if (r.controls > 0) lines.push(`It has ${r.controls} control${r.controls > 1 ? "s" : ""} in Essential Graphics.`);
  return { ok: !!hit && !lost.length, at, track: `V${plan.video + 1}`, lines, steps: 1 + (plan.addVideo || plan.addAudio ? 1 : 0) };
}

async function paramsOf(comp) {
  const out = { byName: {}, list: [] };
  const n = await comp.getParamCount();
  for (let i = 0; i < n; i++) {
    const p = await comp.getParam(i);
    out.list.push(p);
    out.byName[p.displayName] = p;
  }
  return out;
}

async function lastTint(chain) {
  let comp = null;
  const n = await chain.getComponentCount();
  for (let i = 0; i < n; i++) {
    const co = await chain.getComponentAtIndex(i);
    if (((await maybe(co, "getMatchName")) || "") === TINT) comp = co;
  }
  return comp;
}

// A graphic made in Premiere lists its own layers after Opacity and Motion: the Graphic group, then each layer (Text, a shape).
// Premiere draws the clip's effects only when they come BEFORE that group: a Tint appended at the end lands after the Text
// layer and draws nothing (measured 2026-11-15 in NEW TEST, Premiere 26.5.3: 0 pixels changed appended, 578 inserted before
// the group, the white letters turned red). -> the group's index, or -1 for a clip without one (a file: append as before).
async function graphicGroupAt(chain) {
  const n = await chain.getComponentCount();
  for (let i = 0; i < n; i++) {
    const co = await chain.getComponentAtIndex(i);
    if (((await maybe(co, "getMatchName")) || "") === GROUP) return i;
  }
  return -1;
}

function makeColor(hex) {
  const a = BP.colorArgs(hex);
  return new ppro.Color(a[0], a[1], a[2], a[3]);
}

// Logos and graphics that are files: Premiere's Tint (Map Black To and Map White To the colour, Amount 100 %) turns the
// picture one colour and keeps its transparency, the "colour a logo" of the Cockpit probe (P-A3). A Tint already on the clip
// is reused; a new one needs its own step first (a detached effect shows no parameters).
// keepDark (0.10.111, text made in Premiere): only Map White To takes the colour and Map Black To stays black, so white
// letters become exactly the colour while a dark outline or shadow stays dark.
async function tint(project, clips, hex, { keepDark = false } = {}) {
  const targets = [];
  const lines = [];
  for (const c of clips) {
    const chain = await maybe(c.ti, "getComponentChain");
    if (!chain) {
      lines.push(`${c.name}: Premiere did not hand over its effects.`);
      continue;
    }
    const comp = await lastTint(chain);
    targets.push({ c, chain, comp, isNew: !comp });
  }
  const fresh = targets.filter((t) => t.isNew);
  let steps = 0;
  if (fresh.length) {
    for (const t of fresh) {
      t.comp = await ppro.VideoFilterFactory.createComponent(TINT);
      t.at = await graphicGroupAt(t.chain);
    }
    transaction(project, "Asistent: brand colour (Tint)", (c) => {
      for (const t of fresh) c.addAction(t.at >= 0 ? t.chain.createInsertComponentAction(t.comp, t.at) : t.chain.createAppendComponentAction(t.comp));
    });
    steps++;
    // the effects read again only after Premiere settled and from a fresh handle, the created Tint kept referenced: reading
    // them straight after an add can hand the script a freed object and crash Premiere (premiere-color.js attached)
    await new Promise((r) => setTimeout(r, 60));
    for (const t of fresh) {
      t.created = t.comp;
      t.chain = (await maybe(t.c.ti, "getComponentChain")) || t.chain;
      t.comp = await lastTint(t.chain);
    }
  }
  const acts = [];
  let done = 0;
  for (const t of targets) {
    if (!t.comp) {
      lines.push(`${t.c.name}: the Tint did not attach.`);
      continue;
    }
    const ps = await paramsOf(t.comp);
    const black = ps.byName["Map Black To"] || ps.list[0];
    const white = ps.byName["Map White To"] || ps.list[1];
    const amount = ps.byName["Amount to Tint"] || ps.list[2];
    const keyed = [];
    for (const [p, v] of [[black, keepDark ? "#000000" : hex], [white, hex], [amount, 100]]) {
      if (!p) continue;
      if (await maybe(p, "isTimeVarying")) {
        keyed.push(p.displayName);
        continue;
      }
      acts.push(() => p.createSetValueAction(p.createKeyframe(typeof v === "string" ? makeColor(v) : v), true));
    }
    if (keyed.length) lines.push(`${t.c.name}: ${keyed.join(", ")} has keyframes, left alone.`);
    done++;
  }
  if (acts.length) {
    transaction(project, `Asistent: brand colour ${hex}`, (c) => {
      for (const a of acts) c.addAction(a());
    });
    steps++;
  }
  debug(`brand tint ${hex}: ${targets.length} clips (${fresh.length} new Tint), ${acts.length} values written, range ${BP.COLOR_RANGE}`);
  return { done, fresh: fresh.length, steps, lines };
}

// Text made in Premiere (Type tool, Essential Graphics, captions upgraded to graphics): its clip carries Premiere's Text
// component. Premiere 26.5.3 still exposes no fill, font or size on it (probed again 2026-11-15, NATIVE_GRAPHICS.md), but a
// Tint on the clip colours what it draws (0.10.111, the user: "the colour presets ... should be able to be applied to text").
async function isNativeText(ti) {
  const chain = await maybe(ti, "getComponentChain");
  if (!chain) return false;
  const n = await chain.getComponentCount();
  for (let i = 0; i < n; i++) {
    const co = await chain.getComponentAtIndex(i);
    if (((await maybe(co, "getMatchName")) || "") === TEXT) return true;
  }
  return false;
}

/**
 * The colour on the selected clips: image and video files get a Tint, MOGRTs get the colour in a colour control (the host),
 * text made in Premiere gets a Tint that colours its light letters and keeps a dark outline (0.10.111-0.10.112). Captions on a caption
 * track are not clips and stay as they are. The hex is copied as well.
 * -> {lines, steps, controls}
 */
async function applyColor(project, hex, opts = {}) {
  const timeline = await P.readTimeline(project);
  const picked = timeline.items.filter((x) => x.selected && x.kind === "video" && !x.unused);
  if (!picked.length) throw new UserError("Select the logos, graphics or MOGRTs to colour in the timeline, then press again.");
  const files = picked.filter((x) => x.path && !x.adjustment);
  const graphics = picked.filter((x) => !x.path && !x.adjustment);
  const lines = [];
  let steps = 0;
  let controls = [];
  let coloured = 0;
  if (files.length) {
    const r = await tint(project, files, hex);
    steps += r.steps;
    coloured += r.done;
    if (r.done) lines.push(`${r.done} clip${r.done > 1 ? "s" : ""} tinted ${hex}${r.fresh ? ` (Tint added to ${r.fresh})` : " (its Tint changed)"}.`);
    lines.push(...r.lines);
  }
  if (graphics.length) {
    const guid = require("./premiere-captions.js").seqGuid(timeline.sequence);
    const r = await engine.brandColor({ hex, sequence: timeline.sequence.name, guid, project: project.path, index: opts.index || 0 });
    if (!r.ok) throw new UserError(r.msg || "Premiere did not set the colour.");
    controls = r.controls || [];
    if (r.set) {
      steps += r.set;
      coloured += r.set;
      lines.push(`${r.set} MOGRT${r.set > 1 ? "s" : ""}: ${controls[Math.min(opts.index || 0, controls.length - 1)] || "colour"} set to ${hex}.`);
    }
    for (const s of r.skipped || []) lines.push(s);
    // the clips the host found without a MOGRT: the text ones get the Tint, anything else (a nested sequence, a colour
    // matte) is left alone and said
    const others = graphics.filter((x) => (r.others || []).some((o) => o.name === x.name && Math.abs(o.start - x.start) < 0.002));
    const texts = [];
    for (const x of others) if (await isNativeText(x.ti)) texts.push(x);
    if (texts.length) {
      const t = await tint(project, texts, hex, { keepDark: true });
      steps += t.steps;
      coloured += t.done;
      if (t.done) lines.push(`${t.done} text${t.done > 1 ? "s" : ""} made in Premiere coloured ${hex} with a Tint: white letters take the colour exactly, a dark outline or shadow stays dark.`);
      lines.push(...t.lines);
    }
    const rest = (r.other || 0) - texts.length;
    if (rest > 0) lines.push(`${rest} graphic clip${rest > 1 ? "s" : ""} without text or a colour control left alone (${hex} is copied).`);
  }
  if (picked.some((x) => x.adjustment)) lines.push("Adjustment layers were left alone.");
  return { coloured, steps, lines, controls };
}

module.exports = { ensureItem, place, importOnly, placeMogrt, applyColor, tint };
