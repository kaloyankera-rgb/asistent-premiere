// Puts the finished SRT on a caption track of the active sequence. Reading the caption tracks is UXP; creating the track is
// the engine's host (host/, ExtendScript), because UXP has no way to do it (probed on Premiere 26.0.2). Since 0.9.97 a new
// pair replaces Asistent's own earlier pair: its lines are removed (the one removal the rules allow, see removeLines).
// Captions, not graphics (the user, 2026-11-04): all of them can be selected and restyled at once in the Properties panel
// (font, size, outline, shadow, background) and saved as a Track Style; Asistent's After Effects template graphics
// (placeGraphics, 0.9.80) expose only their text there, and Premiere's own text graphics cannot be written by a script.
const ppro = require("premierepro");
const P = require("./premiere.js");
const engine = require("./engine.js");
const plan = require("./captionplan.js");

/** [{index, name, count, start, end}] of every caption track (seconds) */
async function readTracks(sequence) {
  const n = (await P.maybe(sequence, "getCaptionTrackCount")) || 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const tr = await sequence.getCaptionTrack(i);
    const items = (await P.maybe(tr, "getTrackItems", ppro.Constants.TrackItemType.CLIP, false)) || [];
    let start = Infinity;
    let end = 0;
    for (const ti of items) {
      start = Math.min(start, P.secs(await ti.getStartTime()));
      end = Math.max(end, P.secs(await ti.getEndTime()));
    }
    out.push({ index: i, name: tr.name || "", count: items.length, start: items.length ? start : 0, end });
  }
  return out;
}

/** [{index, label, name, count, start, end}] of every video track (seconds) */
async function readVideoTracks(sequence) {
  const n = (await P.maybe(sequence, "getVideoTrackCount")) || 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const tr = await sequence.getVideoTrack(i);
    const items = (await P.maybe(tr, "getTrackItems", ppro.Constants.TrackItemType.CLIP, false)) || [];
    let start = Infinity;
    let end = 0;
    for (const ti of items) {
      start = Math.min(start, P.secs(await ti.getStartTime()));
      end = Math.max(end, P.secs(await ti.getEndTime()));
    }
    out.push({ index: i, label: `V${i + 1}`, name: tr.name || "", count: items.length, start: items.length ? start : 0, end });
  }
  return out;
}

/**
 * Removes every line of these caption tracks in one step (one Undo). The user's request (2026-11-04): a new pair replaces
 * Asistent's earlier one. Removing track items through UXP crashed Premiere 26.0.2 as clone + remove while CEP panels ran
 * ExtendScript (DECISIONS); removing caption lines was tested in NEW TEST (13 tracks of 60 lines, ExtendScript running the
 * whole time, 2026-11-04) without a crash. The references are dropped at once. The empty tracks stay: no script deletes a
 * caption track. Only for tracks findOwn recognises (placed by Asistent, unchanged since).
 */
async function removeLines(project, sequence, indexes) {
  let items = [];
  for (const i of indexes) items.push(...((await P.maybe(await sequence.getCaptionTrack(i), "getTrackItems", ppro.Constants.TrackItemType.CLIP, false)) || []));
  const count = items.length;
  if (!count) return 0;
  const editor = ppro.SequenceEditor.getEditor(sequence);
  let error = null;
  await ppro.TrackItemSelection.createEmptySelection((sel) => {
    try {
      for (const ti of items) sel.addItem(ti, true);
      P.transaction(project, "Asistent: remove the earlier subtitles", (c) => c.addAction(editor.createRemoveItemsAction(sel, false, ppro.Constants.MediaType.ANY)));
    } catch (e) {
      error = e;
    }
  });
  items = null;
  if (error) throw error;
  return count;
}

/** result: the engine's /subtitles result. -> { status, ... } for captionplan.describePlacement */
async function place(project, sequence, result, opts = {}) {
  const name = sequence.name || "";
  const before = await readTracks(sequence);
  const sig = await engine.captionsState(project.path, name);
  const own = sig && sig.kind !== "graphics" ? plan.findOwn(sig, before) : null;
  const ownEnglish = own && sig.english ? plan.findOwn(sig.english, before) : null;
  let answer;
  try {
    answer = await engine.placeCaptions({ srt: result.srt, sequence: name, project: project.path });
  } catch (e) {
    const message = (e && e.message) || String(e);
    return { status: /not running/.test(message) ? "nohost" : "error", message };
  }
  if (!answer.ok) return { status: "error", message: answer.msg || "Premiere refused." };
  const after = await readTracks(sequence);
  const track = plan.addedTrack(before, after);
  const problems = plan.problems(track, result.captions);
  engine.log("info", `captions: placed on C${track ? track.index + 1 : "?"}, ${track ? track.count : 0} items, problems: ${problems.join("; ") || "none"}`);
  if (!track) return { status: "error", message: problems[0] };
  // the English line: its own caption track, the same number of lines at the same times
  let english = null;
  if (result.srt_en) {
    const before2 = await readTracks(sequence);
    let ok = false;
    try {
      ok = !!(await engine.placeCaptions({ srt: result.srt_en, sequence: name, project: project.path })).ok;
    } catch (e) {
      problems.push(`the English line was not placed: ${(e && e.message) || e}`);
    }
    if (ok) {
      english = plan.addedTrack(before2, await readTracks(sequence));
      for (const x of plan.problems(english, result.captions)) problems.push(`English line: ${x}`);
    }
  }
  const mark = (t) => ({ index: t.index, count: t.count, first: t.start, last: t.end });
  await engine.recordCaptions(project.path, name, { ...mark(track), srt: result.srt, ...(english ? { english: mark(english) } : {}) });
  // the new pair is in place: now the earlier one goes (read again, so only a track that is still exactly Asistent's is touched)
  let removed = null;
  if (own) {
    const now = await readTracks(sequence);
    const old = [plan.findOwn(sig, now), ownEnglish && plan.findOwn(sig.english, now)].filter((t) => t && t.index !== track.index && (!english || t.index !== english.index));
    try {
      removed = { tracks: old, count: old.length ? await removeLines(project, sequence, old.map((t) => t.index)) : 0 };
    } catch (e) {
      problems.push(`the earlier subtitles were not removed: ${(e && e.message) || e}`);
    }
    engine.log("info", `captions: earlier pair ${old.map((t) => `C${t.index + 1}`).join(", ") || "not found"}, ${removed ? removed.count : 0} lines removed`);
  }
  return { status: "placed", track, english, problems, replaces: own && !(removed && removed.count) ? own : null, removed };
}

/** Every line as a text graphic from Asistent's After Effects template (0.9.80, tested in NEW TEST; not used by the panel since the
 * user needs to restyle all lines at once in Properties, which only captions allow). Same answer shape as place(). */
async function placeGraphics(project, sequence, result, opts = {}) {
  const name = sequence.name || "";
  const before = await readVideoTracks(sequence);
  const sig = await engine.captionsState(project.path, name);
  const own = sig && sig.kind === "graphics" ? plan.findOwn(sig, before) : null;
  if (own && !opts.again) return { status: "exists", track: own };       // "again": the user corrected words, the new set goes on a new track (graphics are not removed)
  let answer;
  try {
    answer = await engine.placeGraphics({ captions: result.captions.map((c) => ({ start: c.start, end: c.end, text: c.text })),
      preset: result.preset, sequence: name, project: project.path });
  } catch (e) {
    const message = (e && e.message) || String(e);
    return { status: /not running/.test(message) ? "nohost" : "error", message };
  }
  if (!answer.ok && !answer.placed) return { status: "error", message: answer.msg || "Premiere refused." };
  const after = await readVideoTracks(sequence);
  const track = plan.addedTrack(before, after);
  const problems = plan.problems(track, result.captions);
  if (!answer.ok) problems.push(answer.msg);
  if (track) {
    await engine.recordCaptions(project.path, name, { kind: "graphics", index: track.index, count: track.count, first: track.start, last: track.end, srt: result.srt });
  }
  engine.log("info", `captions: graphics on ${track ? track.label : "?"}, ${track ? track.count : 0} items in ${answer.ms} ms (scale ${answer.scale}), problems: ${problems.join("; ") || "none"}`);
  return track ? { status: "placed", track, problems, replaces: own || null, graphics: true } : { status: "error", message: problems[0] };
}

module.exports = { readTracks, readVideoTracks, place, placeGraphics, removeLines };
