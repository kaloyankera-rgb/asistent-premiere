// Capability probe (spec 01): what this Premiere really exposes for colour, measured, not assumed.
// Run it on a TEST project with one video clip selected: it lists the Lumetri parameters, reads the
// colour-management information the API gives, then writes ONE parameter at a time, exports a frame
// from the timeline, and puts the value back. The engine measures the frames: units and directions.
const ppro = require("premierepro");
const P = require("./premiere.js");
const engine = require("./engine.js");
const { exportFrame } = require("./premiere-color.js");

const { UserError, transaction, has, maybe, debug } = P;

async function methodsOf(o) {
  const out = {};
  for (let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const n of Object.getOwnPropertyNames(p)) {
      if (!/^(get|is)[A-Z]/.test(n) || typeof o[n] !== "function" || o[n].length > 0) continue;
      try {
        const v = await o[n]();
        out[n] = v && typeof v === "object" ? (v.value ?? v.seconds ?? JSON.stringify(v)) : v;
      } catch (e) {
        out[n] = `error: ${e.message || e}`;
      }
    }
  }
  return out;
}

async function paramInfo(comp) {
  const list = [];
  const n = await comp.getParamCount();
  for (let i = 0; i < n; i++) {
    const p = await comp.getParam(i);
    const start = await maybe(p, "getStartValue");
    const v = start && start.value !== undefined ? (start.value.value ?? start.value) : undefined;
    list.push({ index: i, name: (p && p.displayName) || "", type: v === undefined ? "?" : typeof v,
      value: typeof v === "object" ? JSON.stringify(v) : v, keyframes: await maybe(p, "areKeyframesSupported"),
      timeVarying: await maybe(p, "isTimeVarying"), p });
  }
  return list;
}

// the parameters we try, by display name; test delta added to the parameter's own default
const TRIES = [
  ["exposure", /^exposure$/i, 1.0],
  ["temperature", /^temperature$/i, 50],
  ["tint", /^tint$/i, 50],
  ["contrast", /^contrast$/i, 50],
  ["saturation", /^saturation$/i, 50],
];

async function run(project) {
  const report = { started: new Date().toISOString() };
  try {
    report.host = require("uxp").host;
    report.host = { name: report.host.name, version: report.host.version, uiLocale: report.host.uiLocale };
  } catch (e) {
    report.host = null;
  }
  try {
    report.os = { platform: require("os").platform(), release: require("os").release() };
  } catch (e) {
    report.os = null;
  }
  const t = await P.readTimeline(project);
  const clips = t.items.filter((x) => x.selected && x.kind === "video" && x.path);
  if (clips.length !== 1) throw new UserError("За пробата маркирай точно един видео клип (в тестов проект).");
  const clip = clips[0];
  report.clip = { name: clip.name, path: clip.path, inPt: clip.inPt, start: clip.start, end: clip.end, track: clip.track };

  // colour management as far as the API shows it
  report.colorManagement = {
    project: await methodsOf(await maybe(project, "getColorSettings")),
    sequence: await methodsOf(await maybe(t.sequence, "getSettings")),
    clipInputLUT: await maybe(clip.clip, "getInputLUTID"),
    clipEmbeddedLUT: await maybe(clip.clip, "getEmbeddedLUTID"),
    footage: await methodsOf(await maybe(clip.clip, "getFootageInterpretation")),
  };

  // effects already on the clip
  const chain = await clip.ti.getComponentChain();
  report.existing = [];
  for (let i = 0; i < (await chain.getComponentCount()); i++) {
    const c = await chain.getComponentAtIndex(i);
    report.existing.push({ index: i, match: await maybe(c, "getMatchName"), name: await maybe(c, "getDisplayName"),
      params: await c.getParamCount() });
  }
  if (report.existing.some((c) => /lumetri/i.test(c.match || ""))) {
    throw new UserError("Клипът вече има Lumetri: за пробата маркирай клип без Lumetri.");
  }

  // write one parameter at a time on the test clip, export the frame, put it back
  const status = await engine.status();
  const dir = status.frames_dir;
  const mid = clip.start + (clip.end - clip.start) / 2;
  // each frame is waited for before the next value is written (exports are queued in 26.0.2)
  const shoot = (name) => exportFrame(t.sequence, mid, name, dir, (msg) => {
    report.exportError = msg;
  });
  // Lumetri parameters
  const matches = (await maybe(ppro.VideoFilterFactory, "getMatchNames")) || [];
  report.lumetriMatch = matches.find((n) => /lumetri/i.test(n)) || null;
  if (!report.lumetriMatch) throw new UserError("Не намирам Lumetri в този Premiere.");
  const comp = await ppro.VideoFilterFactory.createComponent(report.lumetriMatch);
  // a fresh effect has no parameters until it sits on a clip (26.0): note what it offers, then append
  report.freshComponentMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(comp) || {}).join(",");
  report.exporter = has(ppro.Exporter, "exportSequenceFrame");

  const source = report.exporter ? await shoot("probe_source.png") : null;   // timeline as it was
  transaction(project, "Asistent: проба (Lumetri)", (c) => c.addAction(chain.createAppendComponentAction(comp)));
  let placed = null;
  for (let i = (await chain.getComponentCount()) - 1; i >= 0; i--) {
    const c = await chain.getComponentAtIndex(i);
    if (/lumetri/i.test((await maybe(c, "getMatchName")) || "")) {
      placed = c;
      break;
    }
  }
  if (!placed) throw new Error("Lumetri не се появи на клипа.");
  const params = await paramInfo(placed);
  report.lumetriParams = params.map(({ p, ...rest }) => rest);
  if (!report.exporter) {
    report.result = await engine.colorProbe(report, null, []);
    return report;
  }
  const baseline = await shoot("probe_baseline.png");                   // with an untouched Lumetri
  const frames = [];
  for (const [key, re, delta] of TRIES) {
    const info = params.find((x) => re.test(x.name));
    if (!info) {
      frames.push({ param: key, missing: true });
      continue;
    }
    const from = Number(info.value) || 0;
    const to = from + delta;
    const rec = { param: key, index: info.index, name: info.name, from, to };
    try {
      transaction(project, `Asistent: проба ${key}`, (c) => c.addAction(info.p.createSetValueAction(info.p.createKeyframe(to), true)));
      const back = await maybe(info.p, "getStartValue");
      rec.readBack = back && back.value !== undefined ? (back.value.value ?? back.value) : null;
      rec.path = await shoot(`probe_${key}.png`);
      transaction(project, `Asistent: проба ${key} обратно`, (c) => c.addAction(info.p.createSetValueAction(info.p.createKeyframe(from), true)));
      const restored = await maybe(info.p, "getStartValue");
      rec.restored = restored && restored.value !== undefined ? (restored.value.value ?? restored.value) : null;
    } catch (e) {
      rec.error = e.message || String(e);
    }
    frames.push(rec);
    debug(`probe ${key}: ${JSON.stringify({ ...rec, path: !!rec.path })}`);
  }
  report.leftOnClip = "празен Lumetri (всички стойности върнати); може да се изтрие или Cmd+Z";
  report.result = await engine.colorProbe(report, { source, baseline }, frames);
  return report;
}

module.exports = { run };
