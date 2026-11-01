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
  if (!lumetri) throw new UserError("Не намирам Lumetri Color в този Premiere.");
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

// Selected video clips on the active sequence.
async function readVideoSelection(project) {
  const t = await P.readTimeline(project);
  const clips = t.items.filter((x) => x.selected && x.kind === "video" && x.path);
  return { timeline: t, clips };
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

// the clip as a source range: survives moving the clip on the timeline, not trimming it (then: manual)
function clipKey(clip) {
  return `${clip.path}|${(clip.inPt || 0).toFixed(3)}|${(clip.outPt || 0).toFixed(3)}`;
}

// Lumetri of the clip that we may set: an existing one still at 0 on our three sliders, Asistent's own one
// exactly as it left it (managed correction, updated with the new differences), or a new one. A Lumetri
// with any other changes is someone's grade and is never touched.
async function target(clip) {
  const chain = await maybe(clip.ti, "getComponentChain");
  if (!chain) throw new Error(`Няма ефекти на ${clip.name}.`);
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
    return { skip: `вече има Lumetri с промени (${used.join(", ")}), които не са от Асистент или са пипани на ръка: не е пипано`,
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
      t = { skip: `не стана за този клип (${err && err.message ? err.message : err}); другите продължават` };
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
      pl.lines.push("вече съвпада с еталона: нищо за прилагане");
      continue;
    }
    Object.assign(pl, { t, values, applied: values, moment: analysisMoments(timeline, e.clip)[0] ?? null });
    prepared.push(pl);
  }
  let steps = 0;
  if (!prepared.length) return { steps, plans };
  if (dir) {
    for (const [i, pl] of prepared.entries()) {
      if (pl.moment !== null) pl.before = await exportFrame(timeline.sequence, pl.moment, `match_before_${i}.png`, dir);
    }
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
    if (miss.length) pl.lines.push(`липсва параметър в Lumetri: ${miss.join(", ")}`);
  }
  transaction(project, "Asistent: изравни камерите", (c) => {
    for (const pl of prepared) for (const make of setActions(pl.t, pl.values)) c.addAction(make());
  });
  steps++;
  for (const pl of prepared) {
    if (pl.t.owned) pl.lines.push("обновена е предишната поправка на Асистент");
    pl.lines.push(Object.entries(pl.values).map(([k, v]) => `${NAMES[k]} ${v}${pl.t.current[k] !== DEFAULTS[k] ? ` (беше ${pl.t.current[k]})` : ""}`).join(" · "));
    pl.final = { ...pl.values };
    await remember(pl);
  }
  // the match on Premiere's own frames; worse components go back in one step
  const acts = [];
  for (const [i, pl] of prepared.entries()) {
    pl.reverted = [];
    if (!pl.before) {
      pl.lines.push(pl.moment === null ? "проверено само по модела: клипът е покрит от друг слой навсякъде"
        : "без проверка на кадър (кадърът не се изнесе)");
      continue;
    }
    const after = await exportFrame(timeline.sequence, pl.moment, `match_after_${i}.png`, dir);
    let chk = null;
    for (let n = 0; n < 10 && after && !chk; n++) {
      chk = await engine.shotMatchCheck(jobId, pl.before, after, pl.clip.name).catch(() => null);
      if (!chk) await new Promise((r) => setTimeout(r, 300));
    }
    if (!chk) {
      pl.lines.push("проверката не успя");
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
      pl.lines.push(`върнато както беше (изравняването стана по-лошо): ${pl.reverted.map((p) => PART_BG[p]).join(", ")}`);
    } else {
      pl.lines.push("проверено на кадър: по-близо до еталона или същото");
    }
  }
  if (acts.length) {
    transaction(project, "Asistent: върни влошеното", (c) => {
      for (const make of acts) c.addAction(make());
    });
    steps++;
    for (const pl of prepared) if (pl.reverted && pl.reverted.length) await remember(pl);
  }
  return { steps, plans };
}

const NAMES = { exposure: "Exposure", temperature: "Temperature", tint: "Tint", contrast: "Contrast", saturation: "Saturation" };
const PART_BG = { white: "бялото", exposure: "яркостта", saturation: "наситеността", contrast: "контрастът" };

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
  throw new Error("Lumetri не се появи на клипа.");
}

function setActions(t, values) {
  const acts = [];
  for (const [k, v] of Object.entries(values)) {
    if (t.ps[k] && v !== undefined && v !== null) acts.push(() => t.ps[k].createSetValueAction(t.ps[k].createKeyframe(v), true));
  }
  return acts;
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
    if (ok === false) throw new Error("exportSequenceFrame върна false");
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    debug(`exportSequenceFrame failed: ${msg}`);
    if (onError) onError(msg);
    return null;
  }
  const got = await engine.waitFrame(`${dir}/${unique}`).catch(() => null);
  if (!got || !got.path) {
    debug(`frame ${unique}: not written within the wait`);
    if (onError) onError("Premiere не записа кадъра навреме");
    return null;
  }
  return got.path;
}


// What the viewer sees of the clip: frames exported from the sequence (any correction already on the clip
// included), 480 px like the render checks. Fewer than two usable moments: the engine falls back to the file.
// (A 720 px experiment and a Lumetri readout lived here in 0.9.20-0.9.25 while a „correction not seen" report
// was chased: every case turned out to be a correction undone before the re-run.)
async function timelineFrames(timeline, clip, dir, index) {
  const frames = [];
  for (const [k, t] of analysisMoments(timeline, clip).entries()) {
    const f = await exportFrame(timeline.sequence, t, `analyse_${index}_${k}.png`, dir);
    if (f) frames.push(f);
  }
  return { frames };
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
      // hysteresis: on Asistent's own Lumetri a white the render check calls neutral stays as it is
      pl.keptWhite = !t.skip && t.owned && pl.wb && whiteWithinCheck(pl.res.white);
      if (!t.skip && pl.wb && !pl.keptWhite) sliders = await engine.colorSliders(pl.res.white.fix_temp, pl.res.white.fix_tint);
    } catch (e) {
      t = { skip: `не стана за този клип (${e && e.message ? e.message : e}); другите продължават` };
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
      pl.lines = [pl.keptWhite ? "бялото вече е неутрално (в границата на проверката): нищо за прилагане" : "нищо за прилагане"];
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
    for (const [i, pl] of prepared.entries()) {
      if (!covered(timeline, pl.clip, pl.mid)) pl.before = await exportFrame(timeline.sequence, pl.mid, `before_${i}.png`, dir);
    }
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
    pl.lines.push(`липсва параметър в Lumetri: ${Object.keys(pl.values).filter((k) => !pl.t.ps[k]).join(", ")}`);
  }
  transaction(project, "Asistent: поправи цвета", (c) => {
    for (const pl of prepared) for (const make of setActions(pl.t, pl.values)) c.addAction(make());
  });
  steps++;
  for (const pl of prepared) {
    const v = pl.values;
    const was = (k) => (pl.t.owned && pl.t.current[k] ? ` (беше ${pl.t.current[k]})` : "");
    if (pl.t.owned) pl.lines.push("обновена е предишната поправка на Асистент");
    pl.lines.push([v.exposure !== undefined ? `Exposure ${v.exposure > 0 ? "+" : ""}${v.exposure}${was("exposure")}` : null,
      v.temperature !== undefined ? `Temperature ${v.temperature}${was("temperature")}` : null,
      v.tint !== undefined ? `Tint ${v.tint}${was("tint")}` : null].filter(Boolean).join(" · "));
    if (pl.keptWhite) pl.lines.push("бялото е оставено: вече е неутрално в границата на проверката");
    pl.final = { ...pl.values };
    await remember(pl);                    // this state is Asistent's (also if the step back is undone later)
  }

  // check on Premiere's own render; correct once if the slider guess was off or highlights burnt
  if (!dir || !has(ppro.Exporter, "exportSequenceFrame")) {
    for (const pl of prepared) pl.lines.push("без проверка на кадър (тази версия на Premiere не изнася кадри)");
    return { steps };
  }
  const second = [];
  for (const [i, pl] of prepared.entries()) {
    if (!pl.before) {
      pl.lines.push("без проверка: върху клипа има друг слой или кадърът не се изнесе");
      continue;
    }
    const after = await exportFrame(timeline.sequence, pl.mid, `after_${i}.png`, dir);
    const chk = after && (await checkWithRetry(pl.before, after, pl.applied, pl.res.white));
    if (!chk) {
      pl.lines.push("проверката не успя");
      continue;
    }
    debug(`color check ${pl.clip.name}: ${JSON.stringify(chk)}`);
    pl.firstChk = chk;
    pl.finalChk = chk;
    const fixValues = {};
    if (pl.values.exposure && chk.new_clipping > 0.03) {
      // as far back as the clipping needs (engine, from the frames and the probe curve); older engines: 0.5
      const back = chk.pullback_units || 0.5;
      fixValues.exposure = Math.max(0, Math.round((pl.values.exposure - back) * 100) / 100);
      pl.lines.push(`изгоряха ${(chk.new_clipping * 100).toFixed(1)}%: експозицията свалена с ${back} на ${fixValues.exposure}`);
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
        pl.lines.push(`бялото доуточнено: Temperature ${temp}, Tint ${tint}`);
      } else {
        pl.lines.push("бялото: близо до неутрално, по-нататъшно уточнение не би променило нищо");
      }
    } else if (pl.wb && !pl.keptWhite && chk.residual) {
      pl.lines.push("проверено на кадър: бялото е неутрално");
    }
    // a step back or a refined white is measured once more (the re-check); otherwise this check is final
    pl.recheck = Object.keys(fixValues).length > 0;
    if (!pl.recheck && chk.clipping_status) pl.lines.push(`резултат: ${finalLine(chk)}`);   // always one result line
    if (pl.recheck) second.push(...setActions(pl.t, fixValues));
    pl.final = { ...pl.values, ...fixValues };
  }
  if (second.length) {
    transaction(project, "Asistent: поправи цвета (уточнение)", (c) => {
      for (const make of second) c.addAction(make());
    });
    steps++;
    for (const pl of prepared) if (pl.recheck) await remember(pl);
  }
  // the second step is measured once more on a new frame: report where it really landed, change nothing more
  for (const [i, pl] of prepared.entries()) {
    if (!pl.recheck) continue;
    const after2 = await exportFrame(timeline.sequence, pl.mid, `after2_${i}.png`, dir);
    const chk2 = after2 && (await checkWithRetry(pl.before, after2, sinceBefore(pl), pl.res.white, true));
    if (!chk2) {
      pl.lines.push("след уточнението: проверката не успя");
      pl.finalChk = null;
      continue;
    }
    debug(`color recheck ${pl.clip.name}: ${JSON.stringify(chk2)}`);
    pl.finalChk = chk2;
    pl.lines.push(`след ${pl.final.exposure !== pl.values.exposure ? "свалянето" : "уточнението"}: ${finalLine(chk2)}`);
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
    const why = { white: "бялото стана по-далеч от неутрално", exposure: "яркостта отиде по-далеч от целта" };
    pl.lines.push(`върнато както беше: ${g.revert.map((p) => why[p]).join("; ")}`);
  }
  if (!acts.length) return 0;
  transaction(project, "Asistent: върни влошеното", (c) => {
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
  const msg = chk.clipping_message_bg || (chk.new_clipping > 0.03 ? `изгорели ${pct}` : `изгорели ${pct}, в границата`);
  const stops = chk.exposure_after;
  if (typeof stops !== "number" || /Кожата е запазена/.test(msg)) return msg;
  if (Math.abs(stops) < 0.2) return `${msg} Яркостта е в целта.`;
  return `${msg} Яркостта е ${Math.abs(stops).toFixed(1)} стопа ${stops > 0 ? "под" : "над"} целта.`;
}

module.exports = { readVideoSelection, apply, exportFrame, timelineFrames, lumetriState, applyShotMatch };
