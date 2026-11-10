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

/** [{index, name, count, start, end, lines: [[start, end], ...]}] of every caption track (seconds; lines in time order) */
async function readTracks(sequence) {
  const n = (await P.maybe(sequence, "getCaptionTrackCount")) || 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const tr = await sequence.getCaptionTrack(i);
    const items = (await P.maybe(tr, "getTrackItems", ppro.Constants.TrackItemType.CLIP, false)) || [];
    const lines = [];
    for (const ti of items) lines.push([P.secs(await ti.getStartTime()), P.secs(await ti.getEndTime())]);
    lines.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const start = lines.length ? Math.min(...lines.map((l) => l[0])) : 0;
    const end = lines.length ? Math.max(...lines.map((l) => l[1])) : 0;
    out.push({ index: i, name: tr.name || "", count: items.length, start, end, lines });
  }
  return out;
}

/**
 * A sequence's lasting identity: its guid (Premiere 26.0.2 has `Sequence.guid`, probed 2026-11-08), else its name. Caption
 * records are kept under it, so a renamed or a same-named sequence is not mistaken for another (0.10.6).
 */
function seqKey(sequence) {
  try {
    const g = sequence && sequence.guid;
    const s = g && (typeof g.toString === "function" ? g.toString() : String(g));
    if (s && !/^\[object/.test(s)) return `guid:${s}`;
  } catch (e) {
    // no guid in this Premiere: the name below
  }
  return (sequence && sequence.name) || "";
}

/** The sequence's guid as text for the host (ExtendScript calls it `sequenceID`), or null (0.10.25). */
function seqGuid(sequence) {
  const k = seqKey(sequence);
  return k.startsWith("guid:") ? k.slice(5) : null;
}

/** Is `now` the same sequence as `then`? (guid when both have one, else the name) */
function sameSequence(then, now) {
  if (!then || !now) return false;
  const a = seqKey(then);
  const b = seqKey(now);
  if (a.startsWith("guid:") && b.startsWith("guid:")) return a === b;
  return (then.name || "") === (now.name || "");
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

/** The record for this sequence: under its guid, else (records from before 0.10.6) under its name. */
async function readRecord(project, sequence) {
  const key = seqKey(sequence);
  const has = (r) => r && Number.isInteger(r.index);
  const byKey = await engine.captionsState(project.path, key);
  if (has(byKey) || key === (sequence.name || "")) return { key, sig: has(byKey) ? byKey : null };
  const byName = await engine.captionsState(project.path, sequence.name || "");
  return { key, sig: has(byName) ? byName : null };
}

/**
 * result: the engine's /subtitles result; sequence: the sequence the subtitles were made from (read at the start of the job).
 * -> { status, ... } for captionplan.describePlacement.
 * Nothing is recorded and nothing is removed unless the WHOLE new pair is placed and verified (0.10.6: an English line the
 * host refused used to leave the new pair half done while the earlier English track was removed).
 */
async function place(project, sequence, result, opts = {}) {
  const name = sequence.name || "";
  const active = await project.getActiveSequence();
  if (!sameSequence(sequence, active)) {
    return { status: "moved", sequence: name,
      message: `The subtitles are for "${name}", but "${(active && active.name) || "no sequence"}" is open now. Nothing was put on it.` };
  }
  const before = await readTracks(sequence);
  const { key, sig } = await readRecord(project, sequence);
  engine.log("info", `captions: sequence key ${key}, earlier record ${sig ? (Array.isArray(sig.lines) ? "with line times" : "from before 0.10.6") : "none"}`);
  const own = sig && sig.kind !== "graphics" ? plan.findOwn(sig, before) : null;
  const ownEnglish = own && sig.english ? plan.findOwn(sig.english, before) : null;
  const legacy = !own && sig && sig.kind !== "graphics"
    ? [plan.findUnverified(sig, before), sig.english && plan.findUnverified(sig.english, before)].filter(Boolean) : [];
  let answer;
  try {
    answer = await engine.placeCaptions({ srt: result.srt, sequence: name, guid: seqGuid(sequence), project: project.path });
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
    try {
      const en = await engine.placeCaptions({ srt: result.srt_en, sequence: name, guid: seqGuid(sequence), project: project.path });
      if (en && en.ok) {
        english = plan.addedTrack(before2, await readTracks(sequence));
        for (const x of plan.problems(english, result.captions)) problems.push(`English line: ${x}`);
      } else {
        problems.push(`the English line was not placed: ${(en && en.msg) || "Premiere refused"}`);
      }
    } catch (e) {
      problems.push(`the English line was not placed: ${(e && e.message) || e}`);
    }
  }
  const complete = !problems.length && (!result.srt_en || !!english);
  const keptAll = [own, ownEnglish, ...legacy].filter(Boolean);
  if (!complete) {
    // the earlier pair stays and stays recorded; the new tracks are named so the editor can decide
    engine.log("info", `captions: new pair incomplete (${problems.join("; ")}): nothing recorded, nothing removed`);
    return { status: "placed", track, english, problems, replaces: keptAll.length ? keptAll : null, removed: null,
      keptWhy: "the new pair is not complete, so the earlier one was kept" };
  }
  await engine.recordCaptions(project.path, key, { ...plan.mark(track), srt: result.srt, ...(english ? { english: plan.mark(english) } : {}) });
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
  const stillThere = [...(own && !(removed && removed.count) ? [own] : []), ...legacy];
  return { status: "placed", track, english, problems, replaces: stillThere.length ? stillThere : null, removed,
    keptWhy: legacy.length ? "they are from an older Asistent, which cannot tell whether you changed them" : null };
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
      preset: result.preset, sequence: name, guid: seqGuid(sequence), project: project.path });
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

module.exports = { readTracks, readVideoTracks, seqKey, seqGuid, sameSequence, place, placeGraphics, removeLines };
