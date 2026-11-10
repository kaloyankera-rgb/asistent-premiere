// Timeline labels (TODO I7, 0.10.34): which name each track of a sequence gets. Pure (no Premiere), tested with node.
// The user's choice (2026-11-10): camera tracks are "POV 1", "POV 2" in track order. Only names Premiere gave
// ("Video 3", "Audio 2", "Subtitle") or that Asistent gave earlier are changed; a name the editor typed stays.
//
// What a track is, from its clips' files (the same rule as the SYNC layout: one folder = one camera). Real timelines are not
// clean (measured on NEW TEST 2026-11-10: a stray file on the camera track, Fix audio's L/R copies as new files in the
// camera's folder), so a track counts by its main folder when at least 80 % of its files are from there:
// - a video track whose main folder's sound is somewhere on an audio track = a camera, numbered in track order (graphics,
//   adjustment layers and empty tracks have no files and are skipped);
// - a video track with no main folder (B-roll, a finished edit) is left alone;
// - an audio track whose clips are mostly one camera's (by file, else by folder) = that camera's sound ("POV 1 audio"; a
//   second track of the same camera, e.g. the L/R split, "POV 1 audio 2");
// - an audio track whose main folder is on no video track = a recorder or lavalier ("Mic 1", "Mic 2" in track order);
// - Asistent's own caption tracks (the signature it recorded when placing them) = "Subtitles BG" / "Subtitles EN".
const { folderOf } = require("./layout.js");

const PREMIERE_DEFAULT = { video: /^Video \d+$/, audio: /^Audio \d+$/, caption: /^(Subtitle|Subtitles|Caption|Captions|CC1|Open Captions|Teletext)( \d+)?$/i };
const OURS = /^(POV \d+( audio( \d+)?)?|Mic \d+|Subtitles (BG|EN))$/;
const KIND_WORD = { video: "video", audio: "audio", caption: "caption" };

// Premiere's 16 label colours, in the order of its preferences (index = getColorLabelIndex). The names are Premiere's
// defaults; an editor may have renamed them in Preferences > Labels, the index stays the same.
const COLORS = ["Violet", "Iris", "Caribbean", "Lavender", "Cerulean", "Forest", "Rose", "Mango", "Purple", "Blue", "Teal",
  "Magenta", "Tan", "Green", "Brown", "Yellow"];

const MAIN = 0.8;                                             // share of a track's files that makes its main folder

// the value most of `xs` have, when at least MAIN of them have it (else undefined)
function main(xs) {
  const n = new Map();
  for (const x of xs) n.set(x, (n.get(x) || 0) + 1);
  let best;
  let most = 0;
  for (const [x, c] of n) if (c > most) { best = x; most = c; }
  return xs.length && most / xs.length >= MAIN ? best : undefined;
}

const isDefault = (kind, name) => PREMIERE_DEFAULT[kind].test(String(name || "").trim());
const isOurs = (name) => OURS.test(String(name || "").trim());

/**
 * tracks: { video: [{index, name, paths}], audio: [{index, name, paths}], caption: [{index, name}] } (paths: the media
 * files of the track's clips; offline media, graphics and nests have none). own: {bg, en}: indexes of Asistent's own caption
 * tracks (null when none or no longer its own).
 * -> { renames: [{kind, index, from, to}], kept: [{kind, index, name, why}], cameras: [{pov, index, paths}] }
 */
function plan(tracks, own = {}) {
  const renames = [];
  const kept = [];
  const cameras = [];
  const want = (kind, t, to) => {
    if (t.name === to) return;
    if (isDefault(kind, t.name) || isOurs(t.name)) renames.push({ kind, index: t.index, from: t.name, to });
    else kept.push({ kind, index: t.index, name: t.name, why: `named by the editor (would be ${to})` });
  };
  const audioFolders = new Set((tracks.audio || []).flatMap((t) => (t.paths || []).map(folderOf)));
  const povOf = new Map();                                      // path -> camera number
  const povsOfFolder = new Map();                               // folder -> camera numbers (two cameras may share one)
  const skippedFolders = new Set();                             // B-roll tracks' folders: their sound is not a microphone
  for (const t of [...(tracks.video || [])].sort((a, b) => a.index - b.index)) {
    const paths = t.paths || [];
    if (!paths.length) continue;                                // graphics, adjustment layers, nests, empty
    const folder = main(paths.map(folderOf));
    if (folder === undefined) {
      const n = new Set(paths.map(folderOf)).size;
      for (const p of paths) skippedFolders.add(folderOf(p));
      kept.push({ kind: "video", index: t.index, name: t.name, why: `files from ${n} folders (B-roll or an edit), not one camera` });
      continue;
    }
    if (!audioFolders.has(folder)) {
      skippedFolders.add(folder);
      kept.push({ kind: "video", index: t.index, name: t.name, why: "no sound of these files on an audio track, so not taken for a camera" });
      continue;
    }
    const pov = cameras.length + 1;
    const own = [...new Set(paths.filter((p) => folderOf(p) === folder))];
    cameras.push({ pov, index: t.index, paths: own, folder });
    for (const p of own) if (!povOf.has(p)) povOf.set(p, pov);
    povsOfFolder.set(folder, [...(povsOfFolder.get(folder) || []), pov]);
    want("video", t, `POV ${pov}`);
  }
  // a sound clip's camera: by its file, else by its folder when only one camera is from there
  const cameraOf = (p) => {
    if (povOf.has(p)) return povOf.get(p);
    const in1 = povsOfFolder.get(folderOf(p));
    if (in1 && in1.length === 1) return in1[0];
    return in1 ? "several" : null;
  };
  const perCamera = new Map();
  let mics = 0;
  for (const t of [...(tracks.audio || [])].sort((a, b) => a.index - b.index)) {
    const paths = t.paths || [];
    if (!paths.length) continue;
    const pov = main(paths.map(cameraOf));
    if (Number.isInteger(pov)) {
      const n = (perCamera.get(pov) || 0) + 1;
      perCamera.set(pov, n);
      want("audio", t, n === 1 ? `POV ${pov} audio` : `POV ${pov} audio ${n}`);
      continue;
    }
    const folder = main(paths.map(folderOf));
    if (pov === null && folder !== undefined && !skippedFolders.has(folder)) want("audio", t, `Mic ${++mics}`);
    else if (folder !== undefined && skippedFolders.has(folder)) kept.push({ kind: "audio", index: t.index, name: t.name, why: "the sound of B-roll or an edit, not one camera" });
    else kept.push({ kind: "audio", index: t.index, name: t.name, why: "sound from several cameras or microphones" });
  }
  for (const [key, to] of [["bg", "Subtitles BG"], ["en", "Subtitles EN"]]) {
    if (!Number.isInteger(own[key])) continue;
    const t = (tracks.caption || []).find((c) => c.index === own[key]);
    if (t) want("caption", t, to);
  }
  return { renames, kept, cameras };
}

/** What a press changed, as lines for the panel. */
function describe(p) {
  const lines = p.renames.map((r) => `${KIND_WORD[r.kind]} track ${r.index + 1}: ${r.from} → ${r.to}`);
  for (const k of p.kept) lines.push(`${KIND_WORD[k.kind]} track ${k.index + 1} "${k.name}" kept: ${k.why}`);
  return lines;
}

/**
 * The names to put back: only tracks that still carry the name Asistent gave (the editor may have renamed one since).
 * record: [{kind, index, from, to}], now: same shape as plan's tracks.
 */
function restore(record, now) {
  const out = [];
  for (const r of record || []) {
    const t = (now[r.kind] || []).find((x) => x.index === r.index);
    if (t && t.name === r.to) out.push({ kind: r.kind, index: r.index, from: r.to, to: r.from });
  }
  return out;
}

module.exports = { plan, describe, restore, isDefault, isOurs, COLORS };
