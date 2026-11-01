// Smart White Balance + exposure in Premiere: Lumetri Exposure, Temperature and Tint only.
// A freshly created Lumetri has no parameters in Premiere 26.0 (VideoFilterComponent is an empty object
// until it sits on a clip), so a new Lumetri costs one step (append, no visible change) before the
// step that sets the values; an existing untouched Lumetri needs only the second. If the render check
// shows the result is off (slider calibration still being learnt, or burnt highlights), one more step.
const ppro = require("premierepro");
const { TickTime, Constants } = ppro;
const P = require("./premiere.js");
const engine = require("./engine.js");

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
    for (const [key, re] of [["exposure", /^exposure$/i], ["temperature", /^temperature$/i], ["tint", /^tint$/i]]) {
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

// Lumetri of the clip that we may set: an existing one still at 0 on our three sliders, or a new one.
async function target(clip) {
  const chain = await maybe(clip.ti, "getComponentChain");
  if (!chain) throw new Error(`Няма ефекти на ${clip.name}.`);
  const count = await chain.getComponentCount();
  for (let i = 0; i < count; i++) {
    const comp = await chain.getComponentAtIndex(i);
    const match = (await maybe(comp, "getMatchName")) || "";
    if (!/lumetri/i.test(match)) continue;
    const ps = await params(comp);
    const used = [];
    for (const k of ["exposure", "temperature", "tint"]) if (ps[k] && Math.abs(await value(ps[k])) > 1e-6) used.push(k);
    if (used.length) return { skip: `вече има Lumetri с промени (${used.join(", ")}): не е пипано` };
    return { chain, comp, ps, isNew: false };
  }
  const comp = await ppro.VideoFilterFactory.createComponent(await lumetriMatch());
  return { chain, comp, ps: null, isNew: true };
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

async function frameSize(sequence) {
  const r = await maybe(sequence, "getFrameSize");
  const w = (r && r.width) || 1920;
  const h = (r && r.height) || 1080;
  const s = 480 / Math.max(w, h);
  return { w: Math.round((w * s) / 2) * 2, h: Math.round((h * s) / 2) * 2 };
}

// The exported frame as a file that is really there, or null; `onError` gets Premiere's message.
// exportSequenceFrame only queues the export and returns at once (26.0.2: seven probe frames came out
// together after every value was already restored, byte-identical), so nothing may change in the sequence
// until the engine has seen the finished file. Every export gets its own name: a frame left by an earlier
// run must never be measured as this one.
let exportCount = 0;
async function exportFrame(sequence, seconds, name, dir, onError) {
  if (!has(ppro.Exporter, "exportSequenceFrame")) return null;
  const { w, h } = await frameSize(sequence);
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

// a picture with something on top of the clip (a title, a logo) cannot be measured
function covered(timeline, clip, t) {
  return timeline.items.some((x) => x.kind === "video" && x.track > clip.track && x.start <= t && x.end > t);
}

async function checkWithRetry(before, after, applied, fix) {
  for (let i = 0; i < 10; i++) {
    try {
      return await engine.colorCheck(before, after, applied, fix);
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
    const t = await target(pl.clip);
    if (t.skip) {
      pl.lines = [t.skip];
      pl.skipped = true;
      debug(`color apply ${pl.clip.name}: skipped, ${t.skip}`);
      continue;
    }
    const values = {};
    if (pl.exposure) values.exposure = pl.exposure;
    if (pl.wb) {
      const s = await engine.colorSliders(pl.res.white.fix_temp, pl.res.white.fix_tint);
      values.temperature = s.temperature;
      values.tint = s.tint;
    }
    if (!Object.keys(values).length) {
      pl.lines = ["нищо за прилагане"];
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
    pl.lines.push([v.exposure ? `Exposure ${v.exposure > 0 ? "+" : ""}${v.exposure}` : null,
      v.temperature !== undefined ? `Temperature ${v.temperature}` : null,
      v.tint !== undefined ? `Tint ${v.tint}` : null].filter(Boolean).join(" · "));
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
    const chk = after && (await checkWithRetry(pl.before, after, pl.values, pl.res.white));
    if (!chk) {
      pl.lines.push("проверката не успя");
      continue;
    }
    debug(`color check ${pl.clip.name}: ${JSON.stringify(chk)}`);
    const fixValues = {};
    if (pl.values.exposure && chk.new_clipping > 0.03) {
      // as far back as the clipping needs (engine, from the frames and the probe curve); older engines: 0.5
      const back = chk.pullback_units || 0.5;
      fixValues.exposure = Math.max(0, Math.round((pl.values.exposure - back) * 100) / 100);
      pl.lines.push(`изгоряха ${(chk.new_clipping * 100).toFixed(1)}%: експозицията свалена с ${back} на ${fixValues.exposure}`);
      pl.recheck = true;
    }
    if (pl.wb && chk.residual && (Math.abs(chk.residual[0]) > 0.1 || Math.abs(chk.residual[1]) > 0.06) && chk.sliders_now) {
      fixValues.temperature = chk.sliders_now.temperature;
      fixValues.tint = chk.sliders_now.tint;
      pl.lines.push(`бялото доуточнено: Temperature ${fixValues.temperature}, Tint ${fixValues.tint}`);
    } else if (pl.wb && chk.residual) {
      pl.lines.push("проверено на кадър: бялото е неутрално");
    }
    if (!pl.recheck && chk.clipping_status && chk.clipping_status !== "ACCEPTED") pl.lines.push(finalLine(chk));
    if (Object.keys(fixValues).length) second.push(...setActions(pl.t, fixValues));
    pl.final = { ...pl.values, ...fixValues };
  }
  if (second.length) {
    transaction(project, "Asistent: поправи цвета (уточнение)", (c) => {
      for (const make of second) c.addAction(make());
    });
    steps++;
  }
  // the step back is measured once more on a new frame: report where it really landed, change nothing more
  for (const [i, pl] of prepared.entries()) {
    if (!pl.recheck) continue;
    const after2 = await exportFrame(timeline.sequence, pl.mid, `after2_${i}.png`, dir);
    const chk2 = after2 && (await checkWithRetry(pl.before, after2, pl.final, pl.res.white));
    if (!chk2) {
      pl.lines.push("след свалянето: проверката не успя");
      continue;
    }
    debug(`color recheck ${pl.clip.name}: ${JSON.stringify(chk2)}`);
    pl.lines.push(`след свалянето: ${finalLine(chk2)}`);
  }
  return { steps };
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

module.exports = { readVideoSelection, apply, exportFrame };
