// ROUGH CUT as pure logic (no Premiere here, so node can test it): which selected items are cut, why the others are
// left out, how the engine's answer is told, and how the sequence Premiere made from the XML is checked against it.

const { planDialogue } = require("./subtitleplan.js");
const { recognizerNote, wordsRead } = require("./silenceplan.js");

const MODE_LABEL = { safe: "safe", smart: "smart" };

/**
 * 0.10.96: what is cut. range: { kind: "selection" } (the selected clips, as before), { kind: "all" } (every clip of the
 * sequence) or { kind: "inout", from, to } (what lies between the sequence's In and Out: clips that reach over an edge
 * are taken from the edge on, the rest of them is not touched or listened to).
 */
function inRange(items, range) {
  if (!range || range.kind === "selection" || !range.kind) return items;
  if (range.kind === "all") return items.map((x) => ({ ...x, selected: true }));
  const { from, to } = range;
  const out = [];
  for (const x of items) {
    const s = Math.max(x.start, from);
    const e = Math.min(x.end, to);
    if (!(e - s > 0.07)) continue;                     // a frame or two of the next clip under the Out point is not a clip to cut
    out.push({ ...x, selected: true, start: s, end: e, inPt: (x.inPt || 0) + (s - x.start) });
  }
  return out;
}

/**
 * items: panel items from premiere.readTimeline(). Every SELECTED video and audio item with a media file, speed 1 and
 * not reversed is cut by the same ranges (the cameras and the microphones). Audio on a muted track or switched off (`unused`) is left out of the cut and of the speech, as if it were deleted. Returns
 * { layout: [{kind, track, path, start, end, inPt, name}], dialogue: [...] (planDialogue's audio items), skipped, selected }.
 */
function planRoughCut(items, range) {
  items = inRange(items, range);
  const picked = items.filter((x) => x.selected);
  const skipped = [];
  const unused = {};                                 // audio on a muted track or switched off: not used, left out like a deleted clip
  const layout = [];
  const refs = [];                                   // the panel item of each layout entry (effects are read from it)
  for (const x of picked) {
    const name = x.name || "clip";
    if (x.kind === "audio" && x.unused) unused[x.track + 1] = (unused[x.track + 1] || 0) + 1;
    // 0.10.6 (BUG-009): a switched-off clip or a track with its eye off shows nothing; in the new sequence (all tracks and
    // clips on) it would show, e.g. a POV the editor hid. Left out, and named.
    else if (x.kind === "video" && x.unused) skipped.push(`${name} (switched off, left out)`);
    else if (x.kind === "video" && x.hidden) skipped.push(`${name} (on V${x.track + 1}, whose output is off: left out)`);
    else if (!x.path) skipped.push(`${name} (offline media, nested sequence or graphic)`);
    else if (Math.abs((x.speed || 1) - 1) >= 0.01) skipped.push(`${name} (changed speed)`);
    else if (x.reversed) skipped.push(`${name} (reversed)`);
    else if (!(x.end > x.start)) skipped.push(`${name} (no length)`);
    else {
      layout.push({ kind: x.kind, track: x.track, path: x.path, start: x.start, end: x.end, inPt: x.inPt || 0, name });
      refs.push(x);
    }
  }
  for (const [t, n] of Object.entries(unused)) skipped.push(`A${t}: ${n} audio ${n === 1 ? "clip" : "clips"} on a muted track or switched off, not used`);
  const dialogue = planDialogue(items.filter((x) => x.kind === "audio" && !x.unused)).use;
  return { layout, refs, dialogue, skipped, selected: picked.length };
}

function clock(t) {
  const m = Math.floor(t / 60);
  const s = Math.round(t - m * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${s < 10 ? "0" : ""}${s}`;
}

const TAKE_LINES = 8;

/** Repeated takes and false starts: what went (the losing takes of a plain repeat), and what only waits for a look. */
function takeLines(r) {
  const found = r.takes || [];
  if (!found.length) return (r.speech || {}).asr ? [{ cls: "reason", text: "Found no repeated takes or false starts." }] : [];
  const cut = found.filter((g) => g.applied);
  const lines = [{ cls: "line", text: `Said again: ${found.length} ${found.length === 1 ? "place" : "places"}` +
    `${cut.length ? `, ${cut.length} cut (${(r.takes_cut_s || 0).toFixed(1)} s)` : ", nothing cut"}.` }];
  const short = (t) => (t.length > 70 ? `${t.slice(0, 70)}…` : t);
  for (const g of found.slice(0, TAKE_LINES)) {
    const best = g.takes[g.recommended];
    const n = g.takes.length;
    let text;
    if (g.applied) text = `${clock(g.out_at)}: ${g.kind_label} ×${n}; kept #${g.recommended + 1} "${short(best.text)}", ${n === 2 ? "the other was cut" : "the others were cut"} (${g.cut_s.toFixed(1)} s).`;
    else if (!g.safe) text = `${clock(g.out_at)}: ${g.kind_label} ×${n}, said differently (${g.lost.slice(0, 4).join(", ")}): nothing cut, review it. Best is #${g.recommended + 1} (${clock(best.start)} in the original).`;
    else if (g.kind === "restart") text = `${clock(g.out_at)}: ${g.kind_label} "${short(g.takes[0].text)}": cut only in Smart mode.`;
    else text = `${clock(g.out_at)}: ${g.kind_label} ×${n}: nothing cut (the last one is not complete), review it.`;
    lines.push({ cls: g.applied ? "reason" : "warn", text });
  }
  if (found.length > TAKE_LINES) lines.push({ cls: "reason", text: `…and ${found.length - TAKE_LINES} more.` });
  return lines;
}

const WHAT_LABEL = { silence: "silences", offmic: "silences and off-mic voices", ai: "AI rough cut" };
const DONE_LABEL = { remove: "taken out", gaps: "taken out, the spaces kept", split: "cut apart, nothing removed", mute: "muted, the timing unchanged" };
const KIND_WORDS = [["silence", "silence"], ["nosound", "no sound clip"], ["offmic", "off-mic voices"], ["below", "under your dB"],
  ["short", "short pauses"], ["filler", "hesitation sounds"], ["take", "repeated takes"]];

/** Cut silences (0.10.65; 0.10.96 modes, methods, actions): what went, how it listened, each microphone's levels. */
function describeSilences(r, placed) {
  const c = r.counts || {};
  const pct = r.before_s > 0 ? Math.round((100 * (r.before_s - r.after_s)) / r.before_s) : 0;
  const st = r.settings || {};
  const action = r.action || "remove";
  const lines = [];
  lines.push({ cls: "line", text: `${c.cuts} ${c.cuts === 1 ? "part" : "parts"} ${DONE_LABEL[action]}, ${r.saved_s.toFixed(1)} s. ` +
    `${r.what ? `Cut: ${WHAT_LABEL[r.what] || r.what}. ` : ""}Pacing ${r.tempo_label || r.tempo}` +
    (st.min_silence ? ` (pauses from ${st.min_silence} s; ${st.before} s kept before speech, ${st.after} s after)` : "") + "." });
  const by = r.by_kind || {};
  const kinds = KIND_WORDS.filter(([k]) => by[k] > 0.05).map(([k, w]) => `${w} ${by[k].toFixed(1)} s`);
  if (kinds.length > 1 || (kinds.length === 1 && !by.silence)) lines.push({ cls: "reason", text: kinds.join(" · ") });
  const sp = r.speech || {};
  const mics = sp.listened || [];
  const manual = r.threshold !== null && r.threshold !== undefined;
  lines.push({ cls: "line", text: !manual
    ? `Listened to ${mics.length} sound ${mics.length === 1 ? "clip" : "clips"}, each with its own threshold${sp.vad ? "; Silero kept quiet speech and dropped clicks" : " (Silero is not available: the level alone)"}` +
      `${wordsRead(r) && sp.asr ? `; ${sp.words} words recognised${sp.recognizer ? ` by ${sp.recognizer.name}` : ""}` : ""}.`
    : `Threshold ${r.threshold} dB on all ${mics.length} sound ${mics.length === 1 ? "clip" : "clips"}: what stays under it goes, speech or not.` });
  // AI rough cut with Manual dB (0.10.122): the level still decides what is quiet, and the words are read for the repeated takes
  if (manual && wordsRead(r) && sp.asr) lines.push({ cls: "reason", text: `${sp.words} words recognised${sp.recognizer ? ` by ${sp.recognizer.name}` : ""}: used to find repeated takes${r.fillers ? " and hesitation sounds" : ""}; your dB still decides what is quiet.` });
  if (wordsRead(r) && !sp.asr) lines.push({ cls: "warn", text: sp.note || "No speech model: detected without recognition." });
  const cloudNote = recognizerNote(sp.recognizer);
  if (wordsRead(r) && cloudNote) lines.push({ cls: "warn", text: cloudNote });
  for (const m of mics.slice(0, 6)) {
    if (m.floor === null || m.floor === undefined) continue;
    lines.push({ cls: "reason", text: `${m.name}: noise ${m.floor} dB` + (m.voice !== null && m.voice !== undefined ? `, voice ${m.voice} dB` : "") +
      `, ${manual ? "kept" : "speech"} from ${m.open} dB` +
      (m.main !== null && m.main !== undefined ? `, main voice ${m.main} dB` : "") + `; ${m.speech_s} s of speech kept.` });
  }
  if (mics.length > 6) lines.push({ cls: "reason", text: `…and ${mics.length - 6} more.` });
  // the voices away from the microphone: cut (0.10.95), or kept because the editor chose Silences only
  const q = r.quiet;
  if (q && q.cut && q.seconds > 0.05) lines.push({ cls: "line", text: `${q.seconds.toFixed(1)} s of off-mic voices cut (more than ${q.under_db} dB under the main voice of their microphone). To keep them: Options > Cut > Silences only.` });
  else if (r.what === "silence" && !manual) lines.push({ cls: "line", text: "Every voice was kept, also the quiet ones (Options > Cut > Silences + off-mic cuts voices away from the microphone)." });
  if (r.flagged > 0) lines.push({ cls: "warn", text: `${r.flagged} ${r.flagged === 1 ? "part was" : "parts were"} not sure and kept (a voice near the line, or takes that differ): Preview shows them in yellow.` });
  if (r.restored > 0) lines.push({ cls: "line", text: `${r.restored} ${r.restored === 1 ? "part" : "parts"} kept by your choice in the preview.` });
  // AI rough cut: the repeated takes that went, and the ones only listed (said differently, or no pause to cut at)
  const found = r.takes || [];
  for (const g of found.slice(0, TAKE_LINES)) {
    const best = g.takes[g.recommended];
    const n = g.takes.length;
    const said = best.text.length > 70 ? `${best.text.slice(0, 70)}…` : best.text;
    lines.push(g.applied
      ? { cls: "reason", text: `${clock(g.out_at)}: ${g.kind_label} ×${n}; kept #${g.recommended + 1} "${said}", ${n === 2 ? "the other was cut" : "the others were cut"} (${g.cut_s.toFixed(1)} s).` }
      : { cls: "warn", text: `${clock(g.out_at)}: ${g.kind_label} ×${n}: nothing cut (${!g.safe ? "said differently" : "no clean pause to cut at"}), review it. Best is #${g.recommended + 1} "${said}".` });
  }
  if (found.length > TAKE_LINES) lines.push({ cls: "reason", text: `…and ${found.length - TAKE_LINES} more repeated takes.` });
  // 0.10.122: what is not cut is not in the new sequence at all (the host removes it from the duplicate): say so, with the kinds
  for (const s of r.skipped || []) lines.push({ cls: "warn", text: `Not in the new sequence: ${s}.` });
  lines.push({ cls: "reason", text: "Not in the new sequence: clips you did not select, and selected clips that are nested sequences, graphics, offline, speed-changed or reversed." });
  if (r.no_sound_s > 0.05) lines.push({ cls: "line", text: `${r.no_sound_s.toFixed(1)} s with no selected sound at all were taken out (for example a camera rolling before anyone speaks, or empty timeline).` });
  if (r.flashes_dropped > 0) lines.push({ cls: "line", text: `${r.flashes_dropped} pieces of a few frames taken out at the end of a clip while the other camera goes on.` });
  for (const l of (placed && placed.notes) || []) lines.push(l);
  if (placed && placed.problems && placed.problems.length) for (const p of placed.problems) lines.push({ cls: "warn", text: p });
  // 0.10.122: a cut the host stopped, or whose check found problems, is not "Done" (it used to say "Done: … (−40 %)" over a half-made sequence)
  const planned = action === "remove" ? `${clock(r.before_s)} → ${clock(r.after_s)} (−${pct} %)` : `${clock(r.before_s)}, ${DONE_LABEL[action]}`;
  if (placed && placed.stopped) return { text: `Stopped at ${placed.stopped}: the new sequence is unfinished; yours is unchanged. Unfinished sequence: ${r.name}.`, lines };
  const bad = placed && placed.problems && placed.problems.length;
  const head = bad ? `Made, but the check found ${placed.problems.length === 1 ? "a problem" : `${placed.problems.length} problems`} (planned ${planned}).` : `Done: ${planned}.`;
  return { text: `${head} Sequence: ${r.name}.`, lines };
}

/** The engine's /roughcut result -> { text, lines: [{cls, text}] }. */
function describeResult(r, placed) {
  if (r.mode === "silence") return describeSilences(r, placed);
  const c = r.counts || {};
  const pct = r.before_s > 0 ? Math.round((100 * (r.before_s - r.after_s)) / r.before_s) : 0;
  const lines = [];
  lines.push({ cls: "line", text: `${c.cuts} ${c.cuts === 1 ? "cut" : "cuts"} from ${c.pauses_seen} ${c.pauses_seen === 1 ? "pause" : "pauses"}, ${r.saved_s.toFixed(1)} s taken out. Mode ${MODE_LABEL[r.mode]}, tempo ${r.tempo_label || r.tempo}.` });
  const sp = r.speech || {};
  if (!sp.asr) lines.push({ cls: "warn", text: sp.note || "The pauses were found without speech recognition." });
  else lines.push({ cls: "line", text: `${sp.words} words${sp.cached ? " (recognised earlier)" : ""}${sp.vad ? "" : "; Silero is not available, the pauses come from the sound level"}.` });
  if (!sp.vad && sp.asr) lines.push({ cls: "warn", text: "Silero is not available: the pauses were found from the words and the sound level." });
  for (const x of r.review || []) lines.push({ cls: "warn", text: `${clock(x.at)}: ${x.text}` });
  for (const s of r.skipped || []) lines.push({ cls: "warn", text: `Skipped: ${s}.` });
  if (r.no_sound_s > 0.05) lines.push({ cls: "line", text: `${r.no_sound_s.toFixed(1)} s taken out where no selected audio with speech exists (for example the other camera before the first words).` });
  if (r.empty_s > 0.05) lines.push({ cls: "line", text: `${r.empty_s.toFixed(1)} s of empty space between clips closed.` });
  if (r.hole_speech_s > 0.05) lines.push({ cls: "warn", text: `${r.hole_speech_s.toFixed(1)} s have only one camera: the other is not recording, but someone speaks. Kept (otherwise speech would be cut): that camera's row has an empty space.` });
  if (r.flashes_dropped > 0) lines.push({ cls: "line", text: `${r.flashes_dropped} pieces of a few frames taken out at the end of a clip while the other camera goes on.` });
  lines.push(...takeLines(r));
  for (const l of (placed && placed.notes) || []) lines.push(l);
  if (placed && placed.problems && placed.problems.length) for (const p of placed.problems) lines.push({ cls: "warn", text: p });
  const text = `Done: ${clock(r.before_s)} → ${clock(r.after_s)} (−${pct} %). Sequence: ${r.name}.`;
  return { text, lines };
}

/**
 * Premiere's sequence against the engine's check: pieces per track, and the length. got: { video: {track: n}, audio: {track: n},
 * end: seconds }, want: result.check. -> [problem text] (empty = as written).
 */
function verify(want, got) {
  const problems = [];
  for (const kind of ["video", "audio"]) {
    for (const [t, n] of Object.entries(want[kind] || {})) {
      const have = (got[kind] || {})[t] || 0;
      if (have !== n) problems.push(`${kind === "video" ? "Video" : "Audio"} track ${t}: the sequence has ${have} pieces, it should have ${n}.`);
    }
  }
  // 0.10.6 (ARCH-004): a track the engine did not write that holds clips is a problem too (it used to pass)
  for (const kind of ["video", "audio"]) {
    for (const [t, n] of Object.entries(got[kind] || {})) {
      if (n > 0 && !(want[kind] || {})[t]) problems.push(`${kind === "video" ? "Video" : "Audio"} track ${t} has ${n} pieces that were not in the plan.`);
    }
  }
  const expected = want.frames / want.fps;
  if (Math.abs((got.end || 0) - expected) > 1 / want.fps) {
    problems.push(`Length ${got.end.toFixed(2)} s, it should be ${expected.toFixed(2)} s.`);
  }
  return problems;
}

const normPath = (p) => String(p || "").replace(/\\/g, "/").toLowerCase();

/**
 * Every piece the engine wrote against what Premiere made (0.10.6, ARCH-004: counts and length could not tell a wrong file,
 * a wrong source range or a shifted piece). pieces: result.pieces ({kind, track, path, src_in, start} in frames); items:
 * premiere.readItems of the new sequence (seconds). Half a frame of tolerance (Premiere's import rounds to its own ticks).
 * -> [problem text], at most `limit` named and the rest counted.
 */
function verifyPieces(pieces, items, fps, limit = 5) {
  const tol = 0.5 / fps + 0.002;
  const bad = [];
  for (const p of pieces || []) {
    const at = p.start / fps;
    const hit = items.find((x) => x.kind === p.kind && x.track === p.track && Math.abs(x.start - at) < tol);
    const where = `${p.kind === "video" ? "V" : "A"}${p.track + 1} at ${clock(at)}`;
    if (!hit) bad.push(`${where}: the piece is missing`);
    else if (hit.path && p.path && normPath(hit.path) !== normPath(p.path)) bad.push(`${where}: another file (${String(hit.path).split(/[\\/]/).pop()})`);
    else if (Number.isFinite(hit.inPt) && Math.abs(hit.inPt - p.src_in / fps) > tol) bad.push(`${where}: another part of the file (starts at ${hit.inPt.toFixed(2)} s instead of ${(p.src_in / fps).toFixed(2)} s)`);
  }
  if (bad.length > limit) return [...bad.slice(0, limit), `…and ${bad.length - limit} more pieces differ.`];
  return bad;
}

module.exports = { planRoughCut, inRange, describeResult, verify, verifyPieces, clock, MODE_LABEL };
