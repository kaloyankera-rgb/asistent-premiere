// Pure logic of the SUBTITLES section (no Premiere here, so node can test it): which selected audio items are sent
// to the engine, why the others are left out, how the sequence frame size is read, and how the engine's answer is
// shown. Duplicates (several cameras hearing the same speech) are decided by the engine, which can listen: it keeps
// the cleanest copy (dialoguemix.py), not the one on the lowest track.

/**
 * items: panel items from premiere.readTimeline() ({kind, track, start, end, inPt, path, name, speed, reversed,
 * selected}, seconds). Returns { use: [{path, start, end, at, name, track}], skipped: [text], selected: n }.
 * `start`/`end` are the media in/out seconds, `at` the sequence second where the item starts.
 */
const SIDE = /\s(L|R)\s\d+\.\d{2}-\d+\.\d{2}$/;      // an Asistent side copy (host.jsx as_side_clip; audioplan.sideOf)

function planDialogue(items) {
  const picked = items.filter((x) => x.kind === "audio" && x.selected);
  const skipped = [];
  const usable = [];
  for (const x of picked) {
    const name = x.name || "clip";
    if (x.unused) skipped.push(`${name} (switched off or on a muted track: not used)`);      // 0.10.6, as the rough cut
    else if (!x.path) skipped.push(`${name} (offline media or nested sequence)`);
    else if (Math.abs((x.speed || 1) - 1) >= 0.01) skipped.push(`${name} (changed speed)`);
    else if (x.reversed) skipped.push(`${name} (reversed)`);
    else if (!(x.end > x.start)) skipped.push(`${name} (no length)`);
    else usable.push(x);
  }
  usable.sort((a, b) => a.start - b.start || a.track - b.track);
  // an Asistent L/L or R/R copy plays one channel of the file: the engine must hear only that one (0.10.6)
  const use = usable.map((x) => {
    const side = SIDE.exec(x.name || "");
    return { path: x.path, start: x.inPt || 0, end: (x.inPt || 0) + (x.end - x.start), at: x.start, name: x.name || "clip", track: x.track,
      ...(side ? { side: side[1] } : {}) };
  });
  return { use, skipped, selected: picked.length };
}

/** Whatever Premiere's sequence settings return for the frame size -> { width, height } or null. */
function sizeFrom(v) {
  if (!v || typeof v !== "object") return null;
  let w;
  let h;
  if (Number.isFinite(v.width) && Number.isFinite(v.height)) {
    w = v.width;
    h = v.height;
  } else if ([v.left, v.right, v.top, v.bottom].every(Number.isFinite)) {
    w = v.right - v.left;
    h = v.bottom - v.top;
  } else if (Array.isArray(v) && v.length >= 2) {
    [w, h] = v;
  }
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { width: Math.round(w), height: Math.round(h) } : null;
}

/** Folder of a project file path (either slash). */
function dirOf(p) {
  const m = /^(.*)[\\/][^\\/]*$/.exec(p || "");
  return m && m[1] ? m[1] : null;
}

function clock(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

const PRESET_NAME = { short: "short (9:16)", standard: "standard (16:9)", reshape: "ReShape", gstroy: "GStroy", credissimo: "Credissimo", ekopak: "ЕКОПАК" };
const ACCENT_NAME = { gstroy: "Green", credissimo: "Red", ekopak: "Green" };   // the client's accent colour

/** The engine's /subtitles result -> { text, ok, lines: [{cls, text}] } for the result box. */
function describeResult(r) {
  const c = r.counts || {};
  const lines = [];
  if (!c.captions) {
    return { ok: false, text: "No speech recognised in the selected clips.", lines: [{ cls: "warn", text: "Check that the clips with speech are selected." }] };
  }
  lines.push({ cls: "line", text: `${c.words} words · style ${PRESET_NAME[r.preset] || r.preset} · ${r.fps.toFixed(3).replace(/\.?0+$/, "")} fps` +
    ` · ${r.cached ? "recognised earlier" : `recognition ${r.asr_seconds} s for ${r.mix_seconds} s of sound`}` });
  const t = r.timing || {};
  if (t.method === "aligned") {
    lines.push({ cls: "line", text: `Timing: aligned to the sound (${t.aligned} words${t.weak ? `, ${t.weak} weak ones keep Whisper's timing` : ""}).` });
  } else {
    const why = t.error && !/not installed/.test(t.error) ? `the alignment failed (${t.error})` : "the aligner is not installed";
    lines.push({ cls: "warn", text: `Timing: from Whisper, may be off by up to 0.3 s (${why}).` });
  }
  const unsure = [];
  const why = (at) => {
    const hit = (r.review || []).find((x) => Math.abs(x.at - at) <= 0.06);
    return hit ? ` — ${hit.reason}` : "";
  };
  for (const cap of r.captions || []) for (const f of cap.flags || []) unsure.push(`${clock(f.at)} "${String(f.word).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")}"${why(f.at)}`);
  if (unsure.length) {
    lines.push({ cls: "warn", text: `Check ${unsure.length === 1 ? "1 uncertain word" : `${unsure.length} uncertain words`} (listen to them in the original; nothing was guessed): ${unsure.slice(0, 10).join("; ")}${unsure.length > 10 ? "; …" : ""}.` });
  }
  const silent = (r.review || []).filter((x) => !x.word);
  if (silent.length) {
    lines.push({ cls: "warn", text: `Listen to ${silent.length === 1 ? "1 place" : `${silent.length} places`} with speech without a word (a word may be missing, or it is breathing): ${silent.slice(0, 8).map((x) => `${clock(x.at)}–${clock(x.end)}`).join("; ")}.` });
  }
  for (const e of r.correction_errors || []) lines.push({ cls: "warn", text: `Not understood: ${e}.` });
  const fixes = r.corrections || [];
  const done = fixes.filter((f) => f.applied);
  if (done.length) lines.push({ cls: "line", text: `Corrections (${done.length}): ${done.map((f) => `"${f.heard}" → "${f.said}"`).join(", ")}; the new words are aligned to the sound.` });
  for (const f of fixes.filter((x) => !x.applied)) {
    lines.push({ cls: "warn", text: `The correction "${f.heard}" → "${f.said}" did not find these words in the recognised text (write them as they appear in the subtitles).` });
  }
  const rd = r.readings || {};
  const strip = (w) => String(w).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const fixed = (rd.changes || []).map((c) => `"${strip(c.from)}" → "${strip(c.to)}"`);
  if (fixed.length) lines.push({ cls: "line", text: `Corrected by the dictionary (words written as they sound): ${[...new Set(fixed)].join(", ")}.` });
  if ((rd.commas || []).length) lines.push({ cls: "line", text: `Comma added after the end of the conditional clause: ${rd.commas.map((x) => `"${strip(x)}"`).join(", ")}.` });
  const second = rd.second_opinions || [];
  if (second.length) {
    const better = second.filter((x) => x[1] === "B").length;
    lines.push({ cls: "hint", text: `A second reading of ${second.length} ${second.length === 1 ? "piece" : "pieces"} with unknown words${better ? `; the better one was taken for ${better}` : ""}.` });
  }
  for (const d of r.duplicates || []) {
    const rest = d.kept_rest_seconds ? `; ${d.kept_rest_seconds} s of ${d.dropped} are kept, the other does not hear there` : "";
    lines.push({ cls: "line", text: `${d.dropped} and ${d.kept} hear the same: ${d.kept} was taken (cleaner sound, ${d.kept_snr_db} dB against ${d.dropped_snr_db} dB${rest}).` });
  }
  for (const s of r.skipped || []) lines.push({ cls: "warn", text: `Skipped: ${s}.` });
  // a client style with an accent colour (GStroy's green, Credissimo's red keyword): the suggested words, which the editor colours
  const accents = (r.captions || []).filter((cap) => cap.accent);
  if (accents.length) {
    lines.push({ cls: "hint", text: `${ACCENT_NAME[r.preset] || "Accent"} keywords suggested on ${accents.length} of ${r.captions.length} lines (the client's editors pick them by meaning; change any): ` +
      `${accents.slice(0, 12).map((cap) => `${clock(cap.start)} ${cap.accent}`).join("; ")}${accents.length > 12 ? "; …" : ""}.` });
  }
  for (const cap of (r.captions || []).slice(0, 8)) {
    const unsure = (cap.flags || []).length ? "  ?" : "";
    lines.push({ cls: "line", text: `${clock(cap.start)}  ${String(cap.text).replace(/\n/g, " / ")}${unsure}` });
  }
  if (r.captions.length > 8) lines.push({ cls: "hint", text: `… ${r.captions.length - 8} more lines in the file.` });
  lines.push({ cls: "hint", text: `File: ${r.srt}` });
  return { ok: true, text: `Done: ${c.captions} subtitle lines.`, lines };
}

module.exports = { planDialogue, sizeFrom, dirOf, describeResult };
