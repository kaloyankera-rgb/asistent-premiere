// ROUGH CUT as pure logic (no Premiere here, so node can test it): which selected items are cut, why the others are
// left out, how the engine's answer is told, and how the sequence Premiere made from the XML is checked against it.

const { planDialogue } = require("./subtitleplan.js");

const MODE_LABEL = { safe: "safe", smart: "smart" };

/**
 * items: panel items from premiere.readTimeline(). Every SELECTED video and audio item with a media file, speed 1 and
 * not reversed is cut by the same ranges (the cameras and the microphones). Audio on a muted track or switched off (`unused`) is left out of the cut and of the speech, as if it were deleted. Returns
 * { layout: [{kind, track, path, start, end, inPt, name}], dialogue: [...] (planDialogue's audio items), skipped, selected }.
 */
function planRoughCut(items) {
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

/** Remove silences (0.10.65): what was cut, how it listened, each microphone's levels in the tooltip-free lines. */
function describeSilences(r, placed) {
  const c = r.counts || {};
  const pct = r.before_s > 0 ? Math.round((100 * (r.before_s - r.after_s)) / r.before_s) : 0;
  const st = r.settings || {};
  const lines = [];
  lines.push({ cls: "line", text: `${c.cuts} ${c.cuts === 1 ? "silence" : "silences"} cut, ${r.saved_s.toFixed(1)} s taken out. Pauses ${r.tempo_label || r.tempo}` +
    (st.min_silence ? ` (over ${st.min_silence} s; ${st.before} s kept before speech, ${st.after} s after)` : "") + "." });
  const sp = r.speech || {};
  const mics = sp.listened || [];
  lines.push({ cls: "line", text: r.threshold === null || r.threshold === undefined
    ? `Listened to ${mics.length} sound ${mics.length === 1 ? "clip" : "clips"}, each with its own threshold${sp.vad ? "; Silero kept quiet speech and dropped clicks" : " (Silero is not available: the level alone)"}.`
    : `Threshold ${r.threshold} dB on all ${mics.length} sound ${mics.length === 1 ? "clip" : "clips"}: under it is silence.` });
  for (const m of mics.slice(0, 6)) {
    if (m.floor === null || m.floor === undefined) continue;
    lines.push({ cls: "reason", text: `${m.name}: noise ${m.floor} dB, voice ${m.voice} dB, speech from ${m.open} dB; ${m.speech_s} s of speech heard.` });
  }
  if (mics.length > 6) lines.push({ cls: "reason", text: `…and ${mics.length - 6} more.` });
  for (const s of r.skipped || []) lines.push({ cls: "warn", text: `Skipped: ${s}.` });
  if (r.no_sound_s > 0.05) lines.push({ cls: "line", text: `${r.no_sound_s.toFixed(1)} s with no selected sound at all were taken out (for example a camera rolling before anyone speaks, or empty timeline).` });
  if (r.flashes_dropped > 0) lines.push({ cls: "line", text: `${r.flashes_dropped} pieces of a few frames taken out at the end of a clip while the other camera goes on.` });
  for (const l of (placed && placed.notes) || []) lines.push(l);
  if (placed && placed.problems && placed.problems.length) for (const p of placed.problems) lines.push({ cls: "warn", text: p });
  return { text: `Done: ${clock(r.before_s)} → ${clock(r.after_s)} (−${pct} %). Sequence: ${r.name}.`, lines };
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

module.exports = { planRoughCut, describeResult, verify, verifyPieces, clock, MODE_LABEL };
