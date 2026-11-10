// Timeline labels (TODO I7, 0.10.34): names the tracks of the active sequence (tracknames.js decides) and, when the editor
// chose colours, gives each camera's files a label colour. One press = one transaction = one Cmd+Z. Probed in Premiere
// 26.5.2 (2026-11-10): VideoTrack, AudioTrack and CaptionTrack have createSetNameAction; a label colour exists only on the
// project item (createSetColorLabelAction), so it colours that file everywhere it is used, which is why it is off by default.
// Nothing is removed, muted, moved or re-routed; only names (and the chosen colours).
const P = require("./premiere.js");
const T = require("./tracknames.js");
const C = require("./premiere-captions.js");
const plan = require("./captionplan.js");
const engine = require("./engine.js");
const store = require("./store.js");

const { UserError, transaction, maybe, debug } = P;
const RECORD = "asistent.labels.v1";                 // per sequence: what the last press changed, for Put names back

function records() {
  try {
    return JSON.parse(store.getItem(RECORD) || "{}") || {};
  } catch (e) {
    return {};
  }
}

// every track's name, its object and its files (the shared reader: offline media, graphics and nests have no path)
async function read(sequence) {
  const { counts, items } = await P.readItems(sequence);
  const objs = { video: [], audio: [], caption: [] };
  const tracks = { video: [], audio: [], caption: [] };
  for (const [kind, n, get] of [["video", counts.video, (i) => sequence.getVideoTrack(i)], ["audio", counts.audio, (i) => sequence.getAudioTrack(i)]]) {
    for (let i = 0; i < n; i++) {
      const tr = await get(i);
      objs[kind].push(tr);
      tracks[kind].push({ index: i, name: tr.name || "", paths: items.filter((x) => x.kind === kind && x.track === i && x.path).map((x) => x.path) });
    }
  }
  const nc = (await maybe(sequence, "getCaptionTrackCount")) || 0;
  for (let i = 0; i < nc; i++) {
    const tr = await sequence.getCaptionTrack(i);
    objs.caption.push(tr);
    tracks.caption.push({ index: i, name: tr.name || "" });
  }
  return { tracks, objs, items };
}

// Asistent's own caption tracks: the signature recorded when it placed them, checked against the track now (the same
// check the Subtitles button uses before it replaces its own track); a track the editor changed is not "own" any more
async function ownCaptions(project, sequence) {
  try {
    const key = C.seqKey(sequence);
    let sig = await engine.captionsState(project.path, key);
    if (!(sig && Number.isInteger(sig.index)) && key !== (sequence.name || "")) sig = await engine.captionsState(project.path, sequence.name || "");
    if (!(sig && Number.isInteger(sig.index)) || sig.kind === "graphics") return {};
    const before = await C.readTracks(sequence);
    const bg = plan.findOwn(sig, before);
    const en = sig.english ? plan.findOwn(sig.english, before) : null;
    return { bg: bg ? bg.index : null, en: en ? en.index : null };
  } catch (e) {
    debug(`labels: caption record not read: ${e && e.message ? e.message : e}`);
    return {};
  }
}

/**
 * Names the tracks of the active sequence. colors: {1: index, 2: index, ...} label colour per camera (none = keep).
 * -> { sequence, lines, renamed, colored }
 */
async function nameTracks(project, colors = {}) {
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new UserError("Open a sequence first.");
  const { tracks, objs, items } = await read(sequence);
  const own = await ownCaptions(project, sequence);
  const p = T.plan(tracks, own);
  // colours: every project item of a camera's files, once; only where the colour differs
  const paint = [];
  for (const cam of p.cameras) {
    const want = colors[cam.pov];
    if (!Number.isInteger(want)) continue;
    const seen = new Set();
    for (const x of items) {
      if (!x.projectItem || !cam.paths.includes(x.path) || seen.has(x.path)) continue;
      seen.add(x.path);
      const from = await maybe(x.projectItem, "getColorLabelIndex");
      if (from !== want && P.has(x.projectItem, "createSetColorLabelAction")) paint.push({ item: x.projectItem, path: x.path, from, to: want });
    }
  }
  const renames = p.renames.filter((r) => P.has(objs[r.kind][r.index], "createSetNameAction"));
  const lines = T.describe(p);
  if (renames.length < p.renames.length) lines.push(`${p.renames.length - renames.length} tracks cannot be renamed in this Premiere version`);
  if (!renames.length && !paint.length) {
    return { sequence: sequence.name, renamed: 0, colored: 0, lines: lines.length ? lines : ["Every track already has its name."] };
  }
  transaction(project, "Asistent: Name the tracks", (c) => {
    for (const r of renames) c.addAction(objs[r.kind][r.index].createSetNameAction(r.to));
    for (const x of paint) c.addAction(x.item.createSetColorLabelAction(x.to));
  });
  const all = records();
  const key = C.seqKey(sequence);
  const prev = all[key] || { renames: [], colors: [] };
  // merged with the earlier press, so Put names back always returns to the editor's names, not to Asistent's earlier ones
  const merged = prev.renames.filter((r) => !renames.some((n) => n.kind === r.kind && n.index === r.index));
  for (const r of renames) {
    const was = prev.renames.find((q) => q.kind === r.kind && q.index === r.index);
    merged.push({ ...r, from: was ? was.from : r.from });
  }
  const colorsRec = prev.colors.filter((q) => !paint.some((x) => x.path === q.path));
  for (const x of paint) {
    const was = prev.colors.find((q) => q.path === x.path);
    colorsRec.push({ path: x.path, from: was ? was.from : x.from, to: x.to });
  }
  all[key] = { renames: merged, colors: colorsRec, sequence: sequence.name };
  store.setItem(RECORD, JSON.stringify(all));
  // the check: the names as Premiere has them now
  const after = await read(sequence);
  const wrong = renames.filter((r) => after.tracks[r.kind][r.index].name !== r.to);
  for (const r of wrong) lines.push(`${r.kind} track ${r.index + 1} still reads "${after.tracks[r.kind][r.index].name}": check it`);
  if (paint.length) lines.push(`${paint.length} camera files given a label colour`);
  debug(`labels ${sequence.name}: renamed ${renames.length} (${wrong.length} not confirmed), coloured ${paint.length}, kept ${p.kept.length}`);
  return { sequence: sequence.name, renamed: renames.length - wrong.length, colored: paint.length, lines };
}

/** Puts back the names (and colours) the last presses changed, where they are still as Asistent left them. One Undo step. */
async function putBack(project) {
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new UserError("Open a sequence first.");
  const all = records();
  const key = C.seqKey(sequence);
  const rec = all[key];
  if (!rec) return { renamed: 0, colored: 0 };
  const { tracks, objs, items } = await read(sequence);
  const back = T.restore(rec.renames, tracks).filter((r) => P.has(objs[r.kind][r.index], "createSetNameAction"));
  const paint = [];
  for (const q of rec.colors || []) {
    const x = items.find((i) => i.path === q.path && i.projectItem);
    if (x && Number.isInteger(q.from) && (await maybe(x.projectItem, "getColorLabelIndex")) === q.to) paint.push({ item: x.projectItem, to: q.from });
  }
  if (back.length || paint.length) {
    transaction(project, "Asistent: Put track names back", (c) => {
      for (const r of back) c.addAction(objs[r.kind][r.index].createSetNameAction(r.to));
      for (const x of paint) c.addAction(x.item.createSetColorLabelAction(x.to));
    });
  }
  delete all[key];
  store.setItem(RECORD, JSON.stringify(all));
  return { renamed: back.length, colored: paint.length };
}

module.exports = { nameTracks, putBack, read };
