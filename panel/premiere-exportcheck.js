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
    const clip = { track: x.track, name: x.name, start: x.start, speech: speech.has(x.track), ...(await volumeDb(x.ti)), peakDb: null };
    clips.push(clip);
    peakItems.push(x.path ? { path: x.path, start: x.inPt || 0, end: Number.isFinite(x.outPt) ? x.outPt : null } : null);
  }
  return {
    input: { items, end, fps: t.fps, frame: await frameSize(sequence), captions, graphics, clips, sequence: sequence.name },
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

module.exports = { gather, textCentre, volumeDb, exportedSequence };
