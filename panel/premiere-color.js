// Smart White Balance + exposure in Premiere: Lumetri Exposure, Temperature and Tint only.
// A freshly created Lumetri has no parameters in Premiere 26.0 (VideoFilterComponent is an empty object
// until it sits on a clip), so a new Lumetri costs one step (append, no visible change) before the
// step that sets the values; an existing untouched Lumetri needs only the second. If the render check
// shows the result is off (slider calibration still being learnt, or burnt highlights), one more step.
const ppro = require("premierepro");
const { TickTime, Constants } = ppro;
const P = require("./premiere.js");
const engine = require("./engine.js");
const { covered, analysisMoments } = require("./moments.js");
const { mergeValues, whiteWithinCheck, WHITE_OK } = require("./colorplans.js");

const { UserError, transaction, has, maybe, debug } = P;

let lumetri = null;
async function lumetriMatch() {
  if (lumetri) return lumetri;
  const all = (await maybe(ppro.VideoFilterFactory, "getMatchNames")) || [];
  lumetri = all.find((n) => /lumetri/i.test(n)) || null;
  debug(`video effects with lumetri: ${all.filter((n) => /lumetri|color/i.test(n)).join(" | ")}`);
  if (!lumetri) throw new UserError("Cannot find Lumetri Color in this Premiere.");
  return lumetri;
}

let logged = false;
async function params(comp) {
  const out = {};
  const names = [];
  const n = await comp.getParamCount();
  for (let i = 0; i < n; i++) {
    const p = await comp.getParam(i);
    const name = (p && p.displayName) || "";
    names.push(name);
    // the first match is Basic Correction (Creative has its own Saturation further down)
    for (const [key, re] of [["exposure", /^exposure$/i], ["temperature", /^temperature$/i], ["tint", /^tint$/i],
      ["contrast", /^contrast$/i], ["saturation", /^saturation$/i]]) {
      if (!out[key] && re.test(name)) out[key] = p;
    }
  }
  if (!logged) {
    logged = true;
    debug(`lumetri params (${n}): ${names.slice(0, 40).join(" | ")}`);
  }
  return out;
}

async function value(p) {
  const v = await maybe(p, "getStartValue");
  return Number(v && v.value !== undefined ? (v.value.value ?? v.value) : NaN);
}

// Selected video clips on the active sequence. A switched-off clip (Clip > Enable unticked) is left alone: the editor does
// not use it, and the frame check cannot see a correction on it.
async function readVideoSelection(project) {
  const t = await P.readTimeline(project);
  const all = t.items.filter((x) => x.selected && x.kind === "video" && x.path);
  const clips = all.filter((x) => !x.unused);
  const off = all.filter((x) => x.unused).map((x) => x.name);
  if (off.length) debug(`color: switched off, left alone: ${off.join(", ")}`);
  if (!clips.length && off.length) {
    throw new P.UserError(`${off.join(", ")} ${off.length === 1 ? "is" : "are"} switched off: Asistent corrects only clips that are on (Clip > Enable).`);
  }
  return { timeline: t, clips, off };
}

// Every parameter of a Lumetri as text: the fingerprint that tells Asistent's own correction from a grade
// someone touched by hand (any change to any parameter changes it).
async function snapshot(comp) {
  const n = await comp.getParamCount();
  const parts = [];
  for (let i = 0; i < n; i++) {
    const p = await comp.getParam(i);
    const v = await maybe(p, "getStartValue");
    const raw = v && v.value !== undefined ? (v.value.value ?? v.value) : v;
    const val = typeof raw === "number" ? raw.toFixed(4) : JSON.stringify(raw ?? null);
    parts.push(`${i}:${(p && p.displayName) || ""}=${val}${(await maybe(p, "isTimeVarying")) ? "~" : ""}`);
  }
  return parts.join("|");
}

// clips whose last correction the render check could not see (identical frames); remembered until the next press
const unseen = new Set();

// the clip as a source range: survives moving the clip on the timeline, not trimming it (then: manual)
function clipKey(clip) {
  return `${clip.path}|${(clip.inPt || 0).toFixed(3)}|${(clip.outPt || 0).toFixed(3)}`;
}

// Lumetri of the clip that we may set: an existing one still at 0 on our three sliders, Asistent's own one
// exactly as it left it (managed correction, updated with the new differences), or a new one. A Lumetri
// with any other changes is someone's grade and is never touched.
async function target(clip) {
  const chain = await maybe(clip.ti, "getComponentChain");
  if (!chain) throw new Error(`${clip.name} has no effects.`);
  const count = await chain.getComponentCount();
  for (let i = 0; i < count; i++) {
    const comp = await chain.getComponentAtIndex(i);
    const match = (await maybe(comp, "getMatchName")) || "";
    if (!/lumetri/i.test(match)) continue;
    const ps = await params(comp);
    const current = {};
    for (const k of Object.keys(DEFAULTS)) current[k] = ps[k] ? await value(ps[k]) : DEFAULTS[k];
    const used = Object.keys(current).filter((k) => Math.abs(current[k] - DEFAULTS[k]) > 1e-6);
    if (!used.length) return { chain, comp, ps, isNew: false, current };
    const own = await engine.managedCheck(clipKey(clip), await snapshot(comp)).catch(() => null);
    debug(`color target ${clip.name}: Lumetri with ${used.join(", ")}, Asistent's own: ${!!(own && own.owned)}`);
    if (own && own.owned) return { chain, comp, ps, isNew: false, current, owned: true };
    return { skip: `already has a Lumetri with changes (${used.join(", ")}) that are not from Asistent or were changed by hand: not touched`,
      current };
  }
  const comp = await ppro.VideoFilterFactory.createComponent(await lumetriMatch());
  return { chain, comp, ps: null, isNew: true, current: { ...DEFAULTS } };
}

// Lumetri neutral values of the parameters Asistent writes
const DEFAULTS = { exposure: 0, temperature: 0, tint: 0, contrast: 0, saturation: 100 };

// Shot Match: what is on the clip now (its values are simulated on the source by the engine) and whose it is
async function lumetriState(clip) {
  const t = await target(clip);
  return { lumetri: t.skip ? "manual" : t.owned ? "own" : "none", current: { ...DEFAULTS, ...(t.current || {}) } };
}

// Shot Match apply: the engine's absolute values (only the components it changed) into a new or Asistent-owned
// Lumetri, then each clip checked on Premiere's own frame against the reference; a component that made the
// match worse is put back to the value it had before. Clips covered by another layer everywhere can only be
// checked against the model (said so).
const SHOT_PARTS = { white: ["temperature", "tint"], exposure: ["exposure"], saturation: ["saturation"], contrast: ["contrast"] };

async function applyShotMatch(project, timeline, jobId, entries) {
  const status = await engine.status();
  const dir = status && status.frames_dir;
  const plans = [];
  const prepared = [];
  for (const e of entries) {
    const pl = { clip: e.clip, res: e.r, lines: [] };
    plans.push(pl);
    let t;
    try {
      t = await target(e.clip);
    } catch (err) {
      t = { skip: `did not work for this clip (${err && err.message ? err.message : err}); the others go on` };
    }
    if (t.skip) {
      Object.assign(pl, { skipped: true, skipReason: t.skip });
      pl.lines.push(t.skip);
      continue;
    }
    const values = {};
    for (const k of e.r.changed || []) values[k] = e.r.proposal[k];
    if (!Object.keys(values).length) {
      pl.nothing = true;
      pl.lines.push("already matches the reference: nothing to apply");
      continue;
    }
    Object.assign(pl, { t, values, applied: values, moment: analysisMoments(timeline, e.clip)[0] ?? null });
    prepared.push(pl);
  }
  let steps = 0;
  if (!prepared.length) return { steps, plans };
  if (dir) {
    const want = prepared.map((pl, i) => ({ pl, i })).filter(({ pl }) => pl.moment !== null);
    const got = await exportFrames(timeline.sequence, want.map(({ pl, i }) => ({ seconds: pl.moment, name: `match_before_${i}.png` })), dir);
    want.forEach(({ pl }, k) => { pl.before = got[k]; });
  }
  const fresh = prepared.filter((pl) => pl.t.isNew);
  if (fresh.length) {
    transaction(project, "Asistent: Lumetri", (c) => {
      for (const pl of fresh) c.addAction(pl.t.chain.createAppendComponentAction(pl.t.comp));
    });
    steps++;
    for (const pl of fresh) await attached(pl.t);
  }
  for (const pl of prepared) {
    const miss = Object.keys(pl.values).filter((k) => !pl.t.ps[k]);
    if (miss.length) pl.lines.push(`a Lumetri parameter is missing: ${miss.join(", ")}`);
  }
  transaction(project, "Asistent: match cameras", (c) => {
    for (const pl of prepared) for (const make of setActions(pl.t, pl.values)) c.addAction(make());
  });
  steps++;
  for (const pl of prepared) {
    if (pl.t.owned) pl.lines.push("Asistent's earlier correction was updated");
    pl.lines.push(Object.entries(pl.values).map(([k, v]) => `${NAMES[k]} ${v}${pl.t.current[k] !== DEFAULTS[k] ? ` (was ${pl.t.current[k]})` : ""}`).join(" · "));
    pl.final = { ...pl.values };
    await remember(pl);
  }
  // the match on Premiere's own frames; worse components go back in one step
  const acts = [];
  const checked = prepared.filter((pl) => pl.before);
  const afters = await exportFrames(timeline.sequence, checked.map((pl) => ({ seconds: pl.moment, name: `match_after_${prepared.indexOf(pl)}.png` })), dir);
  const afterOf = new Map(checked.map((pl, k) => [pl, afters[k]]));
  for (const pl of prepared) {
    pl.reverted = [];
    if (!pl.before) {
      pl.lines.push(pl.moment === null ? "checked by the model only: the clip is covered by another layer everywhere"
        : "no check on a frame (the frame was not exported)");
      continue;
    }
    const after = afterOf.get(pl);
    let chk = null;
    for (let n = 0; n < 10 && after && !chk; n++) {
      chk = await engine.shotMatchCheck(jobId, pl.before, after, pl.clip.name).catch(() => null);
      if (!chk) await new Promise((r) => setTimeout(r, 300));
    }
    if (!chk) {
      pl.lines.push("the check failed");
      continue;
    }
    debug(`shot match check ${pl.clip.name}: ${JSON.stringify(chk)}`);
    pl.check = chk;
    const back = {};
    for (const part of chk.revert || []) for (const k of SHOT_PARTS[part]) if (k in pl.final) back[k] = pl.t.current[k];
    if (Object.keys(back).length) {
      acts.push(...setActions(pl.t, back));
      pl.final = { ...pl.final, ...back };
      pl.reverted = (chk.revert || []).filter((part) => SHOT_PARTS[part].some((k) => k in back));
      pl.lines.push(`reverted to how it was (the match made it worse): ${pl.reverted.map((p) => PART_BG[p]).join(", ")}`);
    } else {
      pl.lines.push(chk.summary || "checked on a frame: closer to the reference or the same");
    }
    // which measurements the check could rely on and which it skipped (engine 0.9.30+), never hidden
    for (const l of chk.report || []) pl.lines.push(`check: ${l}`);
  }
  if (acts.length) {
    transaction(project, "Asistent: revert what got worse", (c) => {
      for (const make of acts) c.addAction(make());
    });
    steps++;
    for (const pl of prepared) if (pl.reverted && pl.reverted.length) await remember(pl);
  }
  return { steps, plans };
}

const NAMES = { exposure: "Exposure", temperature: "Temperature", tint: "Tint", contrast: "Contrast", saturation: "Saturation" };
const PART_BG = { white: "white balance", exposure: "brightness", saturation: "saturation", contrast: "contrast" };

// remember the Lumetri as Asistent left it, so a later press may update it (and only it)
async function remember(pl) {
  try {
    await engine.managedRecord(clipKey(pl.clip), await snapshot(pl.t.comp), pl.final || pl.values);
  } catch (e) {
    debug(`color managed record failed on ${pl.clip.name}: ${e && e.message ? e.message : e}`);
  }
}

// after the append: the Lumetri as a real component of the clip (now it has parameters)
async function attached(t) {
  const count = await t.chain.getComponentCount();
  for (let i = count - 1; i >= 0; i--) {
    const comp = await t.chain.getComponentAtIndex(i);
    if (/lumetri/i.test((await maybe(comp, "getMatchName")) || "")) {
      t.comp = comp;
      t.ps = await params(comp);
      t.isNew = false;
      return t;
    }
  }
  throw new Error("Lumetri did not appear on the clip.");
}

function setActions(t, values) {
  const acts = [];
  for (const [k, v] of Object.entries(values)) {
    if (t.ps[k] && v !== undefined && v !== null) acts.push(() => t.ps[k].createSetValueAction(t.ps[k].createKeyframe(v), true));
  }
  return acts;
}

// ---------------------------------------------------------------- the editor's own ±0.5 on Exposure

// The user, 2026-11-04 (a robot video with no faces: the measured Exposure was too careful): a fixed step added to the
// Exposure slider of every selected clip, exactly what an editor types into Lumetri. Only a Lumetri Asistent may touch
// (target(): a new one, a neutral one or Asistent's own; a hand grade is never touched), recorded as Asistent's like any
// correction so Auto color can update it later. One Undo step (two when a Lumetri has to be added first). No render check:
// the editor sees the result at once and presses again or Cmd+Z.
async function nudgeExposure(project, clips, delta) {
  const prepared = [];
  const results = [];
  for (const clip of clips) {
    let t;
    try {
      t = await target(clip);
    } catch (e) {
      t = { skip: `did not work for this clip (${e && e.message ? e.message : e})` };
    }
    if (t.skip) results.push({ clip, skipped: true, line: t.skip });
    else prepared.push({ clip, t });
  }
  let steps = 0;
  const fresh = prepared.filter((pl) => pl.t.isNew);
  if (fresh.length) {
    transaction(project, "Asistent: Lumetri", (c) => {
      for (const pl of fresh) c.addAction(pl.t.chain.createAppendComponentAction(pl.t.comp));
    });
    steps++;
    for (const pl of fresh) await attached(pl.t);
  }
  const ready = [];
  for (const pl of prepared) {
    if (!pl.t.ps.exposure) results.push({ clip: pl.clip, skipped: true, line: "this Lumetri has no Exposure parameter" });
    else ready.push(pl);
  }
  if (!ready.length) return { steps, results };
  for (const pl of ready) pl.values = { exposure: Math.round(((pl.t.current.exposure || 0) + delta) * 100) / 100 };
  transaction(project, `Asistent: Exposure ${delta > 0 ? "+" : ""}${delta}`, (c) => {
    for (const pl of ready) for (const make of setActions(pl.t, pl.values)) c.addAction(make());
  });
  steps++;
  for (const pl of ready) {
    const was = pl.t.current.exposure || 0;
    const now = await value(pl.t.ps.exposure);
    const shown = Number.isFinite(now) ? Math.round(now * 100) / 100 : pl.values.exposure;
    pl.final = { ...pl.t.current, exposure: shown };
    await remember(pl);
    results.push({ clip: pl.clip, was, now: shown, line: `Exposure ${was > 0 ? "+" : ""}${was} → ${shown > 0 ? "+" : ""}${shown}` });
  }
  return { steps, results };
}

// ---------------------------------------------------------------- render check (Premiere's own frames)

async function frameSize(sequence, long = 480) {
  const r = await maybe(sequence, "getFrameSize");
  const w = (r && r.width) || 1920;
  const h = (r && r.height) || 1080;
  const s = long / Math.max(w, h);
  return { w: Math.round((w * s) / 2) * 2, h: Math.round((h * s) / 2) * 2 };
}

// The exported frame as a file that is really there, or null; `onError` gets Premiere's message.
// exportSequenceFrame only queues the export and returns at once (26.0.2: seven probe frames came out
// together after every value was already restored, byte-identical), so nothing may change in the sequence
// until the engine has seen the finished file. Every export gets its own name: a frame left by an earlier
// run must never be measured as this one.
let exportCount = 0;
async function exportFrame(sequence, seconds, name, dir, onError, long = 480) {
  if (!has(ppro.Exporter, "exportSequenceFrame")) return null;
  const { w, h } = await frameSize(sequence, long);
  // the name must end in ".png": Premiere takes the format from it ("x" alone throws "File Format is not
  // supported", 0.9.5-0.9.10). It may add the extension once more (x.png.png): the engine looks for both.
  const unique = `${Date.now().toString(36)}_${++exportCount}_${name}`;
  try {
    const ok = await ppro.Exporter.exportSequenceFrame(sequence, TickTime.createWithSeconds(seconds), unique, dir, w, h);
    if (ok === false) throw new Error("exportSequenceFrame returned false");
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    debug(`exportSequenceFrame failed: ${msg}`);
    if (onError) onError(msg);
    return null;
  }
  const got = await engine.waitFrame(`${dir}/${unique}`).catch(() => null);
  if (!got || !got.path) {
    debug(`frame ${unique}: not written within the wait`);
    if (onError) onError("Premiere did not write the frame in time");
    return null;
  }
  return got.path;
}


// Many frames of ONE timeline state: every export is queued first, then all are waited for together (2026-11-03, speed).
// 26.0.2 only queues an export and returns at once, and waiting for each file before queueing the next cost ~0.3 s a
// frame (4 frames × 20 clips ≈ 26 s). Only for frames between which nothing on the timeline changes: the probe still
// waits for each frame because it changes a value between them. shots: [{ seconds, name }] -> [path | null], same order.
const FRAME_BATCH = 16;
const BATCH_WAIT_S = 5;                // a batch's frames arrive within ~2 s; a missing one is retried, not waited for

async function exportFrames(sequence, shots, dir, onBatch) {
  const out = new Array(shots.length).fill(null);
  if (!has(ppro.Exporter, "exportSequenceFrame")) return out;
  const { w, h } = await frameSize(sequence, 480);
  for (let s = 0; s < shots.length; s += FRAME_BATCH) {
    const batch = shots.slice(s, s + FRAME_BATCH);
    const names = [];
    for (const shot of batch) {
      const unique = `${Date.now().toString(36)}_${++exportCount}_${shot.name}`;
      try {
        const ok = await ppro.Exporter.exportSequenceFrame(sequence, TickTime.createWithSeconds(shot.seconds), unique, dir, w, h);
        names.push(ok === false ? null : unique);
      } catch (e) {
        debug(`exportSequenceFrame failed: ${e && e.message ? e.message : e}`);
        names.push(null);
      }
    }
    const got = await Promise.all(names.map((n) => (n ? engine.waitFrame(`${dir}/${n}`, BATCH_WAIT_S).catch(() => null) : null)));
    for (const [i, g] of got.entries()) {
      out[s + i] = g && g.path ? g.path : null;
      if (out[s + i]) continue;
      // Premiere skipped this export (3 of 84 on 2026-11-03, each held its batch for the full 20 s): once more on its own
      debug(`frame ${names[i] || batch[i].name}: not written in a batch, exported again on its own`);
      out[s + i] = await exportFrame(sequence, batch[i].seconds, `again_${batch[i].name}`, dir);
    }
    if (onBatch) onBatch(Math.min(s + FRAME_BATCH, shots.length), shots.length);
  }
  return out;
}

// What the viewer sees of each clip: frames exported from the sequence (any correction already on the clip
// included), 480 px like the render checks. Fewer than two usable moments: the engine falls back to the file.
// (A 720 px experiment and a Lumetri readout lived here in 0.9.20-0.9.25 while a „correction not seen" report
// was chased: every case turned out to be a correction undone before the re-run.)
// clips -> [{ frames: [path] }] in the clips' order, each clip's frames in time order.
async function timelineFrames(timeline, clips, dir, onBatch) {
  const shots = [];
  clips.forEach((clip, index) => analysisMoments(timeline, clip).forEach((t, k) => shots.push({ index, seconds: t, name: `analyse_${index}_${k}.png` })));
  const paths = await exportFrames(timeline.sequence, shots, dir, onBatch);
  const out = clips.map(() => ({ frames: [] }));
  shots.forEach((shot, i) => {
    if (paths[i]) out[shot.index].frames.push(paths[i]);
  });
  return out;
}

// final: the re-check after the one step back. The engine then gives its verdict and never proposes another step
async function checkWithRetry(before, after, applied, fix, final = false) {
  for (let i = 0; i < 10; i++) {
    try {
      return await engine.colorCheck(before, after, applied, fix, final);
    } catch (e) {
      await new Promise((r) => setTimeout(r, 300));          // Premiere may still be writing the file
    }
  }
  return null;
}

/**
 * Apply the plans: [{ clip, res, exposure (Lumetri Exposure units or null), wb (true/false) }]. Returns per clip lines and
 * how many Undo steps it took.
 */
async function apply(project, timeline, plans) {
  const status = await engine.status();
  const dir = status && status.frames_dir;
  const prepared = [];
  for (const pl of plans) {
    // one clip that cannot be prepared is reported and skipped; the others still get their correction
    let t;
    let sliders = null;
    try {
      t = await target(pl.clip);
      if (!t.skip && t.owned && (t.current.exposure || 0) > 0 && unseen.has(clipKey(pl.clip))) {
        // the render check could not see the last correction on this clip (identical frames): stacking another one
        // on a measurement that does not show it doubled Exposure 2.15 → 4.3 (fx39026, 2026-11-01)
        t = { skip: "the earlier correction does not show on the timeline (the frame does not change): adding nothing more. "
          + "Check whether the clip is under another layer, then press again." };
        unseen.delete(clipKey(pl.clip));
      }
      // hysteresis: on Asistent's own Lumetri a white the render check calls neutral stays as it is
      pl.keptWhite = !t.skip && t.owned && pl.wb && whiteWithinCheck(pl.res.white);
      if (!t.skip && pl.wb && !pl.keptWhite) sliders = await engine.colorSliders(pl.res.white.fix_temp, pl.res.white.fix_tint);
    } catch (e) {
      t = { skip: `did not work for this clip (${e && e.message ? e.message : e}); the others go on` };
    }
    if (t.skip) {
      pl.lines = [t.skip];
      pl.skipped = true;
      pl.skipReason = t.skip;
      debug(`color apply ${pl.clip.name}: skipped, ${t.skip}`);
      continue;
    }
    const { values, applied } = mergeValues(t.current, pl.exposure, sliders);
    pl.applied = applied;
    if (!Object.keys(values).length) {
      pl.nothing = true;
      pl.lines = [pl.keptWhite ? "the white balance is already neutral (within the check's limit): nothing to apply" : "nothing to apply"];
      continue;
    }
    pl.t = t;
    pl.values = values;
    pl.mid = pl.clip.start + (pl.clip.end - pl.clip.start) / 2;
    pl.lines = [];
    prepared.push(pl);
  }
  if (!prepared.length) return { steps: 0 };

  // frames before, for the check
  if (dir) {
    const want = prepared.map((pl, i) => ({ pl, i })).filter(({ pl }) => !covered(timeline, pl.clip, pl.mid));
    const got = await exportFrames(timeline.sequence, want.map(({ pl, i }) => ({ seconds: pl.mid, name: `before_${i}.png` })), dir);
    want.forEach(({ pl }, k) => { pl.before = got[k]; });
  }
  let steps = 0;
  const fresh = prepared.filter((pl) => pl.t.isNew);
  if (fresh.length) {
    transaction(project, "Asistent: Lumetri", (c) => {
      for (const pl of fresh) c.addAction(pl.t.chain.createAppendComponentAction(pl.t.comp));
    });
    steps++;
    for (const pl of fresh) await attached(pl.t);
  }
  const missing = prepared.filter((pl) => Object.keys(pl.values).some((k) => !pl.t.ps[k]));
  for (const pl of missing) {
    pl.lines.push(`a Lumetri parameter is missing: ${Object.keys(pl.values).filter((k) => !pl.t.ps[k]).join(", ")}`);
  }
  transaction(project, "Asistent: correct color", (c) => {
    for (const pl of prepared) for (const make of setActions(pl.t, pl.values)) c.addAction(make());
  });
  steps++;
  for (const pl of prepared) {
    const v = pl.values;
    const was = (k) => (pl.t.owned && pl.t.current[k] ? ` (was ${pl.t.current[k]})` : "");
    if (pl.t.owned) pl.lines.push("Asistent's earlier correction was updated");
    pl.lines.push([v.exposure !== undefined ? `Exposure ${v.exposure > 0 ? "+" : ""}${v.exposure}${was("exposure")}` : null,
      v.temperature !== undefined ? `Temperature ${v.temperature}${was("temperature")}` : null,
      v.tint !== undefined ? `Tint ${v.tint}${was("tint")}` : null].filter(Boolean).join(" · "));
    if (pl.keptWhite) pl.lines.push("white balance left alone: already neutral within the check's limit");
    pl.final = { ...pl.values };
    await remember(pl);                    // this state is Asistent's (also if the step back is undone later)
  }

  // check on Premiere's own render; correct once if the slider guess was off or highlights burnt
  if (!dir || !has(ppro.Exporter, "exportSequenceFrame")) {
    for (const pl of prepared) pl.lines.push("no check on a frame (this Premiere version does not export frames)");
    return { steps };
  }
  const second = [];
  // every clip's frame after the change, queued together (one timeline state), then checked one by one
  const checked = prepared.filter((pl) => pl.before);
  const afters = await exportFrames(timeline.sequence, checked.map((pl) => ({ seconds: pl.mid, name: `after_${prepared.indexOf(pl)}.png` })), dir);
  const afterOf = new Map(checked.map((pl, k) => [pl, afters[k]]));
  for (const pl of prepared) {
    if (!pl.before) {
      pl.lines.push("no check: another layer is over the clip or the frame was not exported");
      continue;
    }
    const after = afterOf.get(pl);
    const chk = after && (await checkWithRetry(pl.before, after, pl.applied, pl.res.white));
    if (!chk) {
      pl.lines.push("the check failed");
      continue;
    }
    debug(`color check ${pl.clip.name}: ${JSON.stringify(chk)}`);
    if (chk.render_unchanged) unseen.add(clipKey(pl.clip)); else unseen.delete(clipKey(pl.clip));
    pl.firstChk = chk;
    pl.finalChk = chk;
    const fixValues = {};
    if (pl.values.exposure && chk.new_clipping > 0.03) {
      // as far back as the clipping needs (engine, from the frames and the probe curve); older engines: 0.5
      const back = chk.pullback_units || 0.5;
      fixValues.exposure = Math.max(0, Math.round((pl.values.exposure - back) * 100) / 100);
      pl.lines.push(`${(chk.new_clipping * 100).toFixed(1)}% clipped: exposure lowered by ${back} to ${fixValues.exposure}`);
    }
    const offWhite = pl.wb && !pl.keptWhite && chk.residual && (Math.abs(chk.residual[0]) > WHITE_OK.temp ||
      Math.abs(chk.residual[1]) > WHITE_OK.tint);
    if (offWhite && chk.sliders_now) {
      // on Asistent's own earlier Lumetri the refined white is added to what was there before this press
      const temp = Math.round(((pl.t.current.temperature || 0) + chk.sliders_now.temperature) * 10) / 10;
      const tint = Math.round(((pl.t.current.tint || 0) + chk.sliders_now.tint) * 10) / 10;
      // with the probe's fixed calibration the refined sliders are usually the ones just written (fx39026
      // 16:24: −4.7/12.5 again): writing them again only cost an Undo step and an identical re-check
      if (Math.abs(temp - pl.values.temperature) >= 0.5 || Math.abs(tint - pl.values.tint) >= 0.5) {
        fixValues.temperature = temp;
        fixValues.tint = tint;
        pl.lines.push(`white balance refined: Temperature ${temp}, Tint ${tint}`);
      } else {
        pl.lines.push("white balance: close to neutral, refining further would change nothing");
      }
    } else if (pl.wb && !pl.keptWhite && chk.residual) {
      pl.lines.push("checked on a frame: the white balance is neutral");
    }
    // a step back or a refined white is measured once more (the re-check); otherwise this check is final
    pl.recheck = Object.keys(fixValues).length > 0;
    if (!pl.recheck && chk.clipping_status) pl.lines.push(`result: ${finalLine(chk)}`);   // always one result line
    if (pl.recheck) second.push(...setActions(pl.t, fixValues));
    pl.final = { ...pl.values, ...fixValues };
  }
  if (second.length) {
    transaction(project, "Asistent: correct color (refinement)", (c) => {
      for (const make of second) c.addAction(make());
    });
    steps++;
    for (const pl of prepared) if (pl.recheck) await remember(pl);
  }
  // the second step is measured once more on a new frame: report where it really landed, change nothing more
  const again = prepared.map((pl, i) => ({ pl, i })).filter(({ pl }) => pl.recheck);
  const after2s = await exportFrames(timeline.sequence, again.map(({ pl, i }) => ({ seconds: pl.mid, name: `after2_${i}.png` })), dir);
  for (const [k, { pl }] of again.entries()) {
    const after2 = after2s[k];
    const chk2 = after2 && (await checkWithRetry(pl.before, after2, sinceBefore(pl), pl.res.white, true));
    if (!chk2) {
      pl.lines.push("after the refinement: the check failed");
      pl.finalChk = null;
      continue;
    }
    debug(`color recheck ${pl.clip.name}: ${JSON.stringify(chk2)}`);
    pl.finalChk = chk2;
    pl.lines.push(`after the ${pl.final.exposure !== pl.values.exposure ? "lowering" : "refinement"}: ${finalLine(chk2)}`);
  }
  steps += await revertWorse(project, prepared);
  return { steps };
}

// what this press changed compared with the frame before it (the render check measures these differences)
function sinceBefore(pl) {
  const out = {};
  for (const [k, v] of Object.entries(pl.final || pl.values)) out[k] = Math.round((v - (pl.t.current[k] || 0)) * 100) / 100;
  return out;
}

// Accept / revert (colour plan B5): a part that left the picture measurably worse than before this press is
// put back to the value it had before (0 on a new Lumetri, which then changes nothing). One Undo step for all.
const REVERT_KEYS = { white: ["temperature", "tint"], exposure: ["exposure"] };

async function revertWorse(project, prepared) {
  const acts = [];
  for (const pl of prepared) {
    const g = pl.finalChk && pl.finalChk.gates;
    pl.reverted = [];
    if (!g || !g.revert || !g.revert.length) continue;
    const back = {};
    for (const part of g.revert) for (const k of REVERT_KEYS[part]) if (k in pl.final) back[k] = pl.t.current[k] || 0;
    if (!Object.keys(back).length) continue;
    acts.push(...setActions(pl.t, back));
    pl.final = { ...pl.final, ...back };
    pl.reverted = g.revert;
    const why = { white: "the white balance moved further from neutral", exposure: "the brightness moved further from the target" };
    pl.lines.push(`reverted to how it was: ${g.revert.map((p) => why[p]).join("; ")}`);
  }
  if (!acts.length) return 0;
  transaction(project, "Asistent: revert what got worse", (c) => {
    for (const make of acts) c.addAction(make());
  });
  for (const pl of prepared) if (pl.reverted.length) await remember(pl);
  return 1;
}

// The engine's verdict on the final clipping (ACCEPTED / ACCEPTED_WITH_WARNING / REVIEW_NEEDED) in its
// Bulgarian wording, plus how far the brightness is from the target when that is not already said.
// It only reports: no status ever triggers another correction.
function finalLine(chk) {
  const pct = `${(chk.new_clipping * 100).toFixed(2)}%`;
  const msg = chk.clipping_message || (chk.new_clipping > 0.03 ? `clipped ${pct}` : `clipped ${pct}, within the limit`);
  const stops = chk.exposure_after;
  if (typeof stops !== "number" || /Skin exposure is preserved/.test(msg)) return msg;
  if (Math.abs(stops) < 0.2) return `${msg} The brightness is on target.`;
  return `${msg} The brightness is ${Math.abs(stops).toFixed(1)} stops ${stops > 0 ? "under" : "over"} the target.`;
}

// Test bridge only (devbridge.js, TEST.prproj): write values into the clip's EXISTING Lumetri, whoever's it is, in one
// Undo step, and read back what it holds. Never creates a Lumetri.
async function devWrite(project, clip, values) {
  const chain = await maybe(clip.ti, "getComponentChain");
  if (!chain) throw new Error(`${clip.name} has no effects.`);
  const count = await chain.getComponentCount();
  for (let i = 0; i < count; i++) {
    const comp = await chain.getComponentAtIndex(i);
    if (!/lumetri/i.test((await maybe(comp, "getMatchName")) || "")) continue;
    const t = { chain, comp, ps: await params(comp) };
    transaction(project, "Asistent: Lumetri test", (c) => {
      for (const make of setActions(t, values)) c.addAction(make());
    });
    const now = {};
    for (const k of Object.keys(DEFAULTS)) now[k] = t.ps[k] ? await value(t.ps[k]) : DEFAULTS[k];
    return now;
  }
  throw new Error(`${clip.name} has no Lumetri: the test does not create one.`);
}

// Test bridge only: every effect on the clip in chain order (match name, name, enabled) and the Lumetri values of each
// Lumetri, to see what really acts on the picture (a second Lumetri, another effect, a disabled one).
async function devChain(clip) {
  const chain = await maybe(clip.ti, "getComponentChain");
  if (!chain) return [];
  const out = [];
  const count = await chain.getComponentCount();
  for (let i = 0; i < count; i++) {
    const comp = await chain.getComponentAtIndex(i);
    const match = (await maybe(comp, "getMatchName")) || "";
    const row = { index: i, match, name: (await maybe(comp, "getDisplayName")) || (comp && comp.displayName) || "",
      disabled: await maybe(comp, "getEnabled").then((v) => (v === undefined ? null : !v)) };
    if (/lumetri/i.test(match)) {
      const ps = await params(comp);
      row.values = {};
      for (const k of Object.keys(DEFAULTS)) row.values[k] = ps[k] ? await value(ps[k]) : DEFAULTS[k];
    }
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------- rough cut: carry a clip's colour to its new pieces

const KNOWN_VIDEO = /^(lumetri color|motion|opacity)$/i;

// The Lumetri values Asistent handles on a clip (any Lumetri, its own or a hand grade: the five Basic Correction values only),
// whether the correction is Asistent's own, and the names of the other effects (not carried). null = no Lumetri and no effects.
async function readLumetri(clip) {
  const chain = await maybe(clip.ti, "getComponentChain");
  if (!chain) return null;
  const count = await chain.getComponentCount();
  const out = { values: null, owned: false, others: [] };
  for (let i = 0; i < count; i++) {
    const comp = await chain.getComponentAtIndex(i);
    const match = (await maybe(comp, "getMatchName")) || "";
    const name = (await maybe(comp, "getDisplayName")) || "";
    if (!/lumetri/i.test(match)) {
      if (!KNOWN_VIDEO.test(name)) out.others.push(name || match);
      continue;
    }
    if (out.values) {
      out.others.push("a second Lumetri");
      continue;
    }
    const ps = await params(comp);
    const values = {};
    for (const k of Object.keys(DEFAULTS)) values[k] = ps[k] ? await value(ps[k]) : DEFAULTS[k];
    if (Object.keys(values).some((k) => Math.abs(values[k] - DEFAULTS[k]) > 1e-6)) {
      out.values = values;
      const own = await engine.managedCheck(clipKey(clip), await snapshot(comp)).catch(() => null);
      out.owned = !!(own && own.owned);
    }
  }
  return out.values || out.others.length ? out : null;
}

// Put those values on the new pieces: a new Lumetri (one step), then the values (one step). A piece of a clip whose
// correction was Asistent's own is recorded as Asistent's own again, so the colour buttons keep updating it.
async function copyLumetri(project, pairs) {
  const done = [];
  const fresh = [];
  for (const pr of pairs) {
    try {
      const t = await target(pr.clip);
      if (t.skip || !t.isNew) {
        done.push({ pr, problem: t.skip || "the new piece already has a Lumetri" });
        continue;
      }
      fresh.push({ pr, t });
    } catch (e) {
      done.push({ pr, problem: e && e.message ? e.message : String(e) });
    }
  }
  if (fresh.length) {
    transaction(project, "Asistent: Lumetri on the rough cut", (c) => {
      for (const { t } of fresh) c.addAction(t.chain.createAppendComponentAction(t.comp));
    });
    for (const f of fresh) await attached(f.t);
    transaction(project, "Asistent: color on the rough cut", (c) => {
      for (const { pr, t } of fresh) {
        const values = {};
        for (const k of Object.keys(pr.values)) if (Math.abs(pr.values[k] - DEFAULTS[k]) > 1e-6) values[k] = pr.values[k];
        pr.written = values;
        for (const make of setActions(t, values)) c.addAction(make());
      }
    });
    for (const { pr, t } of fresh) {
      if (pr.owned) await remember({ clip: pr.clip, t, final: pr.written, values: pr.written });
      done.push({ pr });
    }
  }
  return done;
}

module.exports = { readVideoSelection, apply, nudgeExposure, exportFrame, exportFrames, timelineFrames, lumetriState, applyShotMatch, readLumetri, copyLumetri, devWrite, devChain };
