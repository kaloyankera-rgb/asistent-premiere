// Pre-export check in Premiere (TODO I12, 0.10.35): reads the active sequence for exportcheck.js. Read only: no transaction,
// nothing written. Text graphics are found as Move off faces finds them (a Source Text and a Motion Position) and their
// centre is worked out the same way; caption tracks give only their lines' times (Premiere does not tell where they sit).
const P = require("./premiere.js");
const C = require("./premiere-captions.js");
const L = require("./premiere-labels.js");
const T = require("./tracknames.js");
const { sizeFrom } = require("./subtitleplan.js");
const { point, number } = require("./premiere-placement.js");

const { maybe } = P;
const secs = (t) => P.secs(t);

async function frameSize(sequence) {
  const settings = await maybe(sequence, "getSettings");
  for (const name of ["getVideoFrameRect", "getVideoFrameSize"]) {
    const size = sizeFrom(await maybe(settings, name));
    if (size) return size;
  }
  return null;
}

async function params(ti) {
  const chain = await maybe(ti, "getComponentChain");
  const out = {};
  const n = chain ? await chain.getComponentCount() : 0;
  for (let i = 0; i < n; i++) {
    const comp = await chain.getComponentAtIndex(i);
    const match = (await maybe(comp, "getMatchName")) || "";
    const name = (await maybe(comp, "getDisplayName")) || "";
    for (let j = 0; j < (await comp.getParamCount()); j++) {
      const prm = await comp.getParam(j);
      out[`${match}|${prm.displayName}`] = prm;
      out[`${name}|${prm.displayName}`] = prm;
    }
  }
  return out;
}

// where a text graphic's text sits (fractions of the frame), or null when it is not a text graphic
async function textCentre(ti) {
  const ps = await params(ti);
  if (!ps["AE.ADBE Text|Source Text"] || !ps["AE.ADBE Motion|Position"]) return null;
  const m = point(await ps["AE.ADBE Motion|Position"].getStartValue());
  if (!m) return null;
  const anchor = point(await maybe(ps["AE.ADBE Motion|Anchor Point"], "getStartValue")) || { x: 0.5, y: 0.5 };
  const scale = number(await maybe(ps["AE.ADBE Motion|Scale"], "getStartValue")) || 100;
  const text = point(await maybe(ps["AE.ADBE Text|Position"], "getStartValue")) || { x: 0.5, y: 0.5 };
  const vector = point(await maybe(ps["AE.ADBE Graphic Group|Position"], "getStartValue")) || { x: 0.5, y: 0.5 };
  const k = scale / 100;
  return { x: m.x + ((text.x - anchor.x) + (vector.x - 0.5)) * k, y: m.y + ((text.y - anchor.y) + (vector.y - 0.5)) * k };
}

// the highest Volume level an audio clip reaches, in dB (0 when untouched); Premiere's scale: 0.1778 = 0 dB, 1.0 = +15 dB.
// Also the names of its effects (a Fill Left / Right decides which channel is heard).
async function volumeDb(ti) {
  const ps = await params(ti);
  const effects = [...new Set(Object.keys(ps).map((k) => k.split("|")[0]))];
  return { gainDb: await levelDb(ps), effects };
}

async function levelDb(ps) {
  const lv = ps["Volume|Level"] || Object.entries(ps).find(([k]) => /volume\|level/i.test(k))?.[1];
  if (!lv) return 0;
  const vals = [];
  const read = (v) => number(v);
  if (await maybe(lv, "isTimeVarying")) {
    for (const t of (await maybe(lv, "getKeyframeListAsTickTimes")) || []) vals.push(read(await maybe(lv, "getValueAtTime", t)));
  }
  vals.push(read(await maybe(lv, "getStartValue")));
  const ok = vals.filter((v) => Number.isFinite(v) && v > 0);
  return ok.length ? Math.round((20 * Math.log10(Math.max(...ok)) + 15) * 100) / 100 : 0;
}

// ---- 0.10.44: does each clip's picture fill the frame (coverage.js does the maths) ----
const MOTION = "AE.ADBE Motion";
const GEOMETRY = /^AE\.ADBE Geometry/;                                // Transform effect (old and new)

function bool(v) {
  let o = v;
  for (let i = 0; i < 4 && o !== null && typeof o === "object"; i++) o = o.value;
  return typeof o === "boolean" ? o : typeof o === "number" ? o !== 0 : null;
}

// a parameter by match name or display name of its effect
const pick = (ps, names) => { for (const n of names) if (ps[n]) return ps[n]; return null; };

async function valueAt(prm, t, read) {
  if (!prm) return undefined;
  if (await maybe(prm, "isTimeVarying")) {
    const ppro = require("premierepro");
    const v = read(await maybe(prm, "getValueAtTime", ppro.TickTime.createWithSeconds(t)));
    if (v !== null && v !== undefined) return v;
  }
  const v = read(await maybe(prm, "getStartValue"));
  return v === null ? undefined : v;
}

/**
 * One clip's Motion and Crop at its start, its end and every keyframe, for coverage.check:
 * -> {samples: [{at (sequence s), m}], fitUnknown, transform}
 */
async function pictureSamples(x, fps) {
  const ps = await params(x.ti);
  const Q = {
    pos: pick(ps, [`${MOTION}|Position`, "Motion|Position"]),
    scale: pick(ps, [`${MOTION}|Scale`, "Motion|Scale", `${MOTION}|Scale Height`, "Motion|Scale Height"]),
    width: pick(ps, [`${MOTION}|Scale Width`, "Motion|Scale Width"]),
    uniform: pick(ps, [`${MOTION}|Uniform Scale`, "Motion|Uniform Scale"]),
    rot: pick(ps, [`${MOTION}|Rotation`, "Motion|Rotation"]),
    anchor: pick(ps, [`${MOTION}|Anchor Point`, "Motion|Anchor Point"]),
    cl: pick(ps, [`${MOTION}|Crop Left`, "Motion|Crop Left", "Crop|Left", "AE.ADBE AECrop|Left"]),
    ct: pick(ps, [`${MOTION}|Crop Top`, "Motion|Crop Top", "Crop|Top", "AE.ADBE AECrop|Top"]),
    cr: pick(ps, [`${MOTION}|Crop Right`, "Motion|Crop Right", "Crop|Right", "AE.ADBE AECrop|Right"]),
    cb: pick(ps, [`${MOTION}|Crop Bottom`, "Motion|Crop Bottom", "Crop|Bottom", "AE.ADBE AECrop|Bottom"]),
  };
  const transform = Object.keys(ps).some((k) => GEOMETRY.test(k.split("|")[0]) || k.split("|")[0] === "Transform");
  // keyframes are in media time (Phase 0 P-A2); the clip shows media inPt..outPt
  const inPt = x.inPt || 0;
  const speed = x.speed > 0 ? x.speed : 1;
  const outPt = Number.isFinite(x.outPt) ? x.outPt : inPt + (x.end - x.start) * speed;
  const times = new Set([inPt, Math.max(inPt, outPt - 1 / (fps || 30))]);
  for (const prm of Object.values(Q)) {
    if (!prm || !(await maybe(prm, "isTimeVarying"))) continue;
    for (const k of (await maybe(prm, "getKeyframeListAsTickTimes")) || []) {
      const t = secs(k);
      if (Number.isFinite(t) && t >= inPt - 1e-6 && t <= outPt + 1e-6) times.add(t);
    }
  }
  const samples = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    const pos = await valueAt(Q.pos, t, point);
    const anchor = await valueAt(Q.anchor, t, point);
    const scale = await valueAt(Q.scale, t, number);
    const uniform = Q.width ? await valueAt(Q.uniform, t, bool) : true;
    const width = Q.width ? await valueAt(Q.width, t, number) : undefined;
    const m = {
      x: pos ? pos.x : undefined, y: pos ? pos.y : undefined, ax: anchor ? anchor.x : undefined, ay: anchor ? anchor.y : undefined,
      sw: uniform === false && width !== undefined ? width : scale, sh: scale,
      rot: await valueAt(Q.rot, t, number),
      crop: { l: await valueAt(Q.cl, t, number), t: await valueAt(Q.ct, t, number), r: await valueAt(Q.cr, t, number), b: await valueAt(Q.cb, t, number) },
    };
    // Scale to Frame Size is a clip setting, not a parameter: read it where this Premiere offers it
    let fit;
    for (const name of ["isScaleToFrameSize", "getScaleToFrameSize", "isScaledToFrameSize"]) {
      const v = await maybe(x.ti, name);
      if (typeof v === "boolean") { fit = v; break; }
    }
    m.fit = !!fit;
    samples.push({ at: x.start + (t - inPt) / speed, m, fitKnown: fit !== undefined });
  }
  return { samples, fitUnknown: samples.some((s) => !s.fitKnown), transform };
}

/** Every video / photo clip with a file, with its samples (the engine adds each file's frame). */
async function pictures(items, fps) {
  const out = [];
  for (const x of items) {
    if (x.kind !== "video" || !x.path || x.unused || x.hidden || x.adjustment) continue;
    out.push({ name: x.name, track: x.track, start: x.start, end: x.end, path: x.path, kind: "video", ...(await pictureSamples(x, fps)) });
  }
  return out;
}

/** Everything the check needs except the peaks: -> { input, peakItems, clips } (clips[i] is measured by peakItems[i]) */
async function gather(project) {
  const t = await P.readTimeline(project);
  const sequence = t.sequence;
  const { tracks } = await L.read(sequence);
  const speech = new Set(T.plan(tracks, {}).speech);
  const items = t.items;
  const end = Math.max(0, ...items.map((x) => x.end || 0));
  const captions = (await C.readTracks(sequence)).map((c) => ({ index: c.index, name: c.name, lines: c.lines.map(([s, e]) => ({ start: s, end: e })) }));
  const graphics = [];
  for (const x of items) {
    if (x.kind !== "video" || x.path || x.unused || x.hidden || x.adjustment) continue;
    const c = await textCentre(x.ti);
    if (c) graphics.push({ name: x.name || "text", start: x.start, x: c.x, y: c.y });
  }
  const clips = [];
  const peakItems = [];
  for (const x of items) {
    if (x.kind !== "audio" || x.unused || x.offline) continue;
    const clip = { track: x.track, name: x.name, start: x.start, end: x.end, speech: speech.has(x.track), ...(await volumeDb(x.ti)), peakDb: null };
    clips.push(clip);
    peakItems.push(x.path ? { path: x.path, start: x.inPt || 0, end: Number.isFinite(x.outPt) ? x.outPt : null } : null);
  }
  // the In / Out when the editor set one (an export of In to Out covers only that: 0.10.45)
  const inPt = P.secs(await maybe(sequence, "getInPoint"));
  const outPt = P.secs(await maybe(sequence, "getOutPoint"));
  const range = Number.isFinite(inPt) && Number.isFinite(outPt) && outPt > inPt + 0.01 &&
    (inPt > 0.001 || outPt < end - 0.001) ? { from: inPt, to: outPt } : null;
  return {
    input: { items, end, range, fps: t.fps, frame: await frameSize(sequence), captions, graphics, clips, sequence: sequence.name,
      pictures: await pictures(items, t.fps) },
    peakItems, clips,
  };
}

// The sequence that was just exported, for the after-export check of the file (0.10.39, TODO I14): its name, frame size,
// frame rate, length and the In to Out length when an In / Out is set (an In / Out export is that long). The Export tab exports
// the active sequence; when the editor exported another one (a queue, Media Encoder), the check's words name the sequence it
// compared with. Read only, and only what is cheap: no clips are read while Premiere finishes the export.
async function exportedSequence(project) {
  const seq = await maybe(project, "getActiveSequence");
  if (!seq) return null;
  const size = await frameSize(seq);
  const duration = P.secs(await maybe(seq, "getEndTime"));
  const inPt = P.secs(await maybe(seq, "getInPoint"));
  const outPt = P.secs(await maybe(seq, "getOutPoint"));
  const range = Number.isFinite(inPt) && Number.isFinite(outPt) && outPt > inPt &&
    (inPt > 0.001 || (Number.isFinite(duration) && outPt < duration - 0.001)) ? outPt - inPt : null;
  return {
    name: seq.name || null, width: size ? size.width : null, height: size ? size.height : null,
    fps: (await P.frameRate(seq)) || null, duration: Number.isFinite(duration) && duration > 0 ? duration : null, range,
  };
}

// ---------------------------------------------------------------- 0.10.45: go to a problem, mark the problems
const ppro = require("premierepro");

/** The playhead to `at` (sequence seconds) in the active sequence. -> true when Premiere took it */
async function seek(project, at) {
  const seq = await maybe(project, "getActiveSequence");
  if (!seq || !P.has(seq, "setPlayerPosition")) return false;
  await seq.setPlayerPosition(ppro.TickTime.createWithSeconds(Math.max(0, at)));
  return true;
}

/** The sequence's markers as [{name, at}] (empty when this Premiere has no marker API). */
async function readMarkers(seq) {
  const M = ppro.Markers;
  if (!M || typeof M.getMarkers !== "function") return { markers: null, list: [] };
  const markers = await M.getMarkers(seq);
  const list = [];
  for (const m of (await maybe(markers, "getMarkers")) || []) {
    const name = (await maybe(m, "getName")) || m.name || "";
    const at = P.secs((await maybe(m, "getStart")) || m.start);
    if (Number.isFinite(at)) list.push({ name, at });
  }
  return { markers, list };
}

/** Adds the check's markers (exportcheck.markers) to the active sequence in ONE Undo step. -> {added, skipped} */
async function addMarkers(project, parts, fps) {
  const seq = await maybe(project, "getActiveSequence");
  if (!seq) throw new P.UserError("Open the sequence first.");
  const { markers, list } = await readMarkers(seq);
  if (!markers || !P.has(markers, "createAddMarkerAction")) throw new P.UserError("This Premiere version cannot add markers from a script.");
  const want = require("./exportcheck.js").markers(parts, list, fps);
  if (want.length) {
    P.transaction(project, "Asistent: Check markers", (c) => {
      for (const m of want) {
        c.addAction(markers.createAddMarkerAction(m.name, "Comment", ppro.TickTime.createWithSeconds(m.at),
          ppro.TickTime.createWithSeconds(0), m.comment));
      }
    });
  }
  P.debug(`check markers: ${want.length} added, ${list.length} were there`);
  return { added: want.length };
}

module.exports = { gather, textCentre, volumeDb, exportedSequence, seek, addMarkers };
