// CUT SILENCES as pure logic (0.10.96; no Premiere and no DOM here, so node can test it): the editor's options as the engine
// wants them, the preview's waveform as columns, a region turned around by the editor, and what the preview says.
// The engine decides what goes (engine/asistent/silence.py); this only reads the controls and shows the plan.

// The engine's pacing presets (silence.PACING), repeated here so Custom can start from the chosen one's numbers.
const PACING = {
  calm: { min_silence: 1.3, min_speech: 0.15, before: 0.2, after: 0.3, short: false },
  measured: { min_silence: 0.87, min_speech: 0.15, before: 0.15, after: 0.22, short: false },
  paced: { min_silence: 0.65, min_speech: 0.15, before: 0.15, after: 0.2, short: false },
  energetic: { min_silence: 0.4, min_speech: 0.15, before: 0.1, after: 0.14, short: true },
};
const MODES = ["simple", "silence", "offmic", "ai"];
// 0.10.157 Simple (the user: "a simple option to remove all these without any hassle"): one choice instead of the options.
// Dead air and the quiet stretches between the lines go (Silences + off-mic as Automatic measures it), repeated lines get
// markers and stay. Only the panel knows the word: the engine gets these choices.
const SIMPLE = { mode: "offmic", method: "auto", pacing: "measured", sensitivity: 3, short: false, fillers: false, action: "remove", mark_takes: true };
const METHODS = ["auto", "manual", "ai"];
const ACTIONS = ["remove", "gaps", "split", "mute"];
const RANGES = ["selection", "inout", "all"];
const MODE_LABEL = { simple: "simple", silence: "silences", offmic: "silences and off-mic voices", ai: "AI rough cut" };
const METHOD_LABEL = { auto: "automatic", manual: "manual dB", ai: "AI-assisted" };
const ACTION_LABEL = { remove: "removed, gaps closed", gaps: "removed, spaces kept", split: "split only, nothing removed", mute: "sound muted, timing unchanged" };
const KIND_LABEL = { silence: "silence", nosound: "no sound clip", offmic: "off-mic voice", below: "under your dB", short: "short pause", filler: "hesitation sound", take: "repeated take" };
const KIND_ORDER = ["silence", "nosound", "offmic", "below", "short", "filler", "take"];

function num(v, what, lo, hi) {
  const x = Number(String(v === undefined || v === null ? "" : v).replace(",", ".").trim());
  if (String(v).trim() === "" || !Number.isFinite(x)) return { error: `Type a number for ${what}.` };
  if (x < lo || x > hi) return { error: `${what[0].toUpperCase()}${what.slice(1)} must be between ${lo} and ${hi}.` };
  return { value: x };
}

/**
 * The controls' values -> { opts } (what readInput and the engine get) or { error } (what to fix, said before anything runs).
 * v: { mode, method, db, pacing, minSilence, minSpeech, before, after, sensitivity, short, shortMin, shortMax, fillers, markTakes, range, action }.
 * Cut = Simple is the SIMPLE choices whatever the other controls say (they are hidden then).
 * AI rough cut always detects with the words; hesitation sounds need the words too (Detect = AI-assisted or Cut = AI rough cut).
 */
function readOptions(v) {
  if (v.mode === "simple") return { opts: { ...SIMPLE, range: RANGES.includes(v.range) ? v.range : "selection", threshold: null } };
  const mode = MODES.includes(v.mode) ? v.mode : "offmic";
  let method = METHODS.includes(v.method) ? v.method : "auto";
  if (mode === "ai" && method === "auto") method = "ai";
  const o = { mode, method, pacing: PACING[v.pacing] || v.pacing === "custom" ? v.pacing : "measured",
    sensitivity: Math.min(5, Math.max(1, Math.round(Number(v.sensitivity) || 3))), short: !!v.short,
    fillers: !!v.fillers && (method === "ai" || mode === "ai"), action: ACTIONS.includes(v.action) ? v.action : "remove",
    range: RANGES.includes(v.range) ? v.range : "selection", threshold: null, mark_takes: !!v.markTakes };
  if (method === "manual") {
    const d = num(v.db, "the dB threshold", -80, -10);
    if (d.error) return { error: `${d.error} Speech into the microphone is usually around -12 to -20 dB; Suggest finds a start.` };
    o.threshold = d.value;
  }
  if (o.pacing === "custom") {
    for (const [key, from, what, lo, hi] of [["min_silence", "minSilence", "the minimum silence", 0.1, 10], ["min_speech", "minSpeech", "the minimum speech", 0, 2],
      ["before", "before", "the padding before speech", 0, 1], ["after", "after", "the padding after speech", 0, 1]]) {
      const x = num(v[from], what, lo, hi);
      if (x.error) return { error: x.error };
      o[key] = x.value;
    }
  }
  if (o.short) {
    const a = num(v.shortMin, "the shortest pause", 0.1, 2);
    const b = num(v.shortMax, "the longest short pause", 0.1, 3);
    if (a.error || b.error) return { error: a.error || b.error };
    if (b.value < a.value) return { error: "Short pauses: the first number must be the smaller one." };
    o.short_min = a.value;
    o.short_max = b.value;
  }
  return { opts: o };
}

/** What goes to the engine on top of the clips: the options, the editor's review choices and the tracks to listen to. */
function payloadOptions(opts, extra = {}) {
  const p = { mode: opts.mode, method: opts.method, threshold: opts.threshold, pacing: opts.pacing, sensitivity: opts.sensitivity,
    short: opts.short, fillers: opts.fillers, action: opts.action };
  for (const k of ["min_silence", "min_speech", "before", "after", "short_min", "short_max"]) if (opts[k] !== undefined) p[k] = opts[k];
  if (opts.mark_takes) p.mark_takes = true;
  if (extra.overrides && extra.overrides.length) p.overrides = extra.overrides;
  if (Array.isArray(extra.listen)) p.listen = extra.listen;
  if (extra.preview) p.preview = true;
  return p;
}

/** What was listened to and laid out, as one string: a review belongs to the selection it was made on. */
function signature(payload) {
  // the source In point is part of it (0.10.122): the same clip trimmed differently is other sound, and a review made on the
  // old trim belongs to other seconds
  const part = (x) => `${x.kind || "a"}${x.track}|${x.path}|${Number(x.start).toFixed(3)}|${Number(x.end).toFixed(3)}|${Number(x.inPt || 0).toFixed(3)}`;
  return [...(payload.layout || []).map(part), "#", ...(payload.items || []).map((x) => `${x.track}|${x.path}|${Number(x.at).toFixed(3)}|${Number(x.start || 0).toFixed(3)}`)].join(";");
}

function clock(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t - m * 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/** The part of the preview on screen: zoom 1 shows everything, 2 half of it, and so on; `from` is clamped into the range. */
function view(result, zoom, from) {
  const total = Math.max(0.001, result.t_end - result.t_start);
  const z = Math.min(64, Math.max(1, zoom || 1));
  const span = total / z;
  const start = Math.min(Math.max(result.t_start, Number.isFinite(from) ? from : result.t_start), result.t_end - span);
  return { from: start, to: start + span, span, zoom: z };
}

/** A zoom step around the middle of what is on screen (or around `at`, a moment the editor just touched). */
function zoomed(result, v, factor, at) {
  const z = Math.min(64, Math.max(1, v.zoom * factor));
  const mid = Number.isFinite(at) ? at : v.from + v.span / 2;
  const span = (result.t_end - result.t_start) / z;
  return view(result, z, mid - span / 2);
}

function scrolled(result, v, dir) {
  return view(result, v.zoom, v.from + dir * v.span * 0.5);
}

/**
 * The waveform as `n` columns of the view: [{ h: 0..1 (the loudest sound in it), kind: "keep" | a region's kind, cut, flag,
 * region: index of the region that fills most of it, or -1 }]. A region that fills less than a third of a column leaves
 * it "keep" (zoom in to see it).
 */
function columns(result, regions, v, n) {
  const hop = result.env.hop;
  const db = result.env.db;
  const out = [];
  const step = v.span / n;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const a = v.from + i * step;
    const b = a + step;
    const i0 = Math.max(0, Math.floor((a - result.t_start) / hop));
    const i1 = Math.min(db.length, Math.max(i0 + 1, Math.ceil((b - result.t_start) / hop)));
    let top = -90;
    for (let j = i0; j < i1; j++) if (db[j] > top) top = db[j];
    while (k < regions.length && regions[k].end <= a) k++;
    let best = -1;
    let most = 0;
    for (let j = k; j < regions.length && regions[j].start < b; j++) {
      const inside = Math.min(b, regions[j].end) - Math.max(a, regions[j].start);
      if (inside > most) {
        most = inside;
        best = j;
      }
    }
    const r = best >= 0 && most >= step / 3 ? regions[best] : null;
    out.push({ h: Math.min(1, Math.max(0.03, (top + 60) / 60)), kind: r ? r.kind : "keep", cut: !!(r && r.cut), flag: !!(r && r.flag), region: r ? best : -1 });
  }
  return out;
}

/** The editor turned region `i` around (cut <-> keep) -> the regions with that one changed. */
function toggled(regions, i) {
  return regions.map((r, j) => (j === i ? { ...r, cut: !r.cut, by: "you" } : r));
}

/** The editor's choices for the engine: every region that is not as the engine planned it. */
function overridesOf(regions) {
  return regions.filter((r) => r.by === "you").map((r) => ({ start: r.start, end: r.end, cut: r.cut }));
}

/** Seconds that go, by kind, and what waits for a look. */
function totals(regions) {
  const by = {};
  let cut = 0;
  let flagged = 0;
  let restored = 0;
  let count = 0;
  for (const r of regions) {
    if (r.cut) {
      by[r.kind] = (by[r.kind] || 0) + (r.end - r.start);
      cut += r.end - r.start;
      count++;
    } else if (r.flag) flagged++;
    else restored++;
  }
  return { cut, by, flagged, restored, count };
}

function kindsLine(by) {
  return KIND_ORDER.filter((k) => by[k] > 0.05).map((k) => `${KIND_LABEL[k]} ${by[k].toFixed(1)} s`).join(" · ");
}

/**
 * 0.10.122: will these choices have the words read? Hesitation sounds need them, and so does AI rough cut (repeated takes),
 * whatever Detect says: AI rough cut with Manual dB still reads them, the dB only decides what is quiet. `r` is the options
 * ({ mode, method, fillers }) or the engine's result ({ mode, what, method, fillers }); an older engine's plain AI-assisted counts too.
 */
function wordsRead(r) {
  return !!r && (r.mode === "ai" || r.what === "ai" || r.method === "ai" || !!r.fillers || !!r.mark_takes);
}

/** The Options line about who reads the words (null when these choices read none). cloud: engine.cloud()'s answer, or null when unknown. */
function wordsLine(opts, cloud) {
  if (!(opts && (opts.mode === "ai" || opts.fillers || opts.mark_takes)) || !cloud) return null;
  return cloud.on ? "Words: ElevenLabs Scribe (sends the sound of the selected clips; ReShape projects stay on this computer)"
    : "Words: read on this computer (slower)";
}

// A Manual dB that removes most of what was selected is nearly always a level set too high (0.10.122: -30 dB on a quiet
// lavalier cut 98 %): the press goes on only when it is repeated.
const MANUAL_GUARD_PCT = 60;

/** The share (percent) of the selected time that goes, for the guard: null unless it is a Manual dB cut that removes. */
function removedShare(result, regions) {
  if (!result || result.method !== "manual" || result.action === "split" || !(result.before_s > 0)) return null;
  const cut = regions ? totals(regions).cut : result.saved_s;
  return Math.round((100 * cut) / result.before_s);
}

/** The preview's own warning, worded for before any press: the stop comes with the first press of Cut silences. */
function guardPreviewText(pct) {
  return `Manual dB would remove ${pct} % of the selected time: the level may be too high. Cut silences will ask you to press it twice to go on; Suggest proposes a level from your clips.`;
}

/** What the panel says when the guard stops a press (the press repeated goes on). */
function guardText(pct) {
  return `This removes ${pct} % of the selected time: the dB level may be too high. Press Cut silences again to go on, or use Suggest for a level from your clips.`;
}

/** What the preview says above the waveform -> [{cls, text}]. */
function describePreview(result, regions) {
  const t = totals(regions);
  const before = result.before_s;
  const after = result.action === "remove" ? Math.max(0, before - t.cut) : before;
  const pct = before > 0 ? Math.round((100 * t.cut) / before) : 0;
  const lines = [];
  lines.push({ cls: "line", text: result.action === "remove"
    ? `${clock(before)} → ${clock(after)} (−${pct} %): ${t.count} ${t.count === 1 ? "part goes" : "parts go"}, ${t.cut.toFixed(1)} s.`
    : `${t.count} ${t.count === 1 ? "part" : "parts"}, ${t.cut.toFixed(1)} s (${pct} %): ${ACTION_LABEL[result.action]}.` });
  const kinds = kindsLine(t.by);
  if (kinds) lines.push({ cls: "reason", text: kinds });
  if (t.flagged) lines.push({ cls: "warn", text: `${t.flagged} ${t.flagged === 1 ? "part is" : "parts are"} not sure and kept (yellow): tap one to cut it.` });
  if (t.restored) lines.push({ cls: "reason", text: `${t.restored} kept by you.` });
  const marks = marksLine(result, false);
  if (marks) lines.push(marks);
  const share = removedShare(result, regions);
  if (share !== null && share > MANUAL_GUARD_PCT) lines.push({ cls: "warn", text: guardPreviewText(share) });
  const sp = result.speech || {};
  if (wordsRead(result) && !sp.asr) lines.push({ cls: "warn", text: sp.note || "No speech model: detected without recognition." });
  if (wordsRead(result) && sp.asr && sp.recognizer) lines.push({ cls: "reason", text: `${sp.words} words recognised by ${sp.recognizer.name}.` });
  const cloudNote = recognizerNote(sp.recognizer);
  if (wordsRead(result) && cloudNote) lines.push({ cls: "warn", text: cloudNote });
  return lines;
}

/**
 * 0.10.157: the line about the repeated lines' markers (null when they were not asked for, or no words were read: the
 * words' own warning says that). done: after the cut ("got"), else before it ("will get").
 */
function marksLine(result, done) {
  if (!result || !result.mark_takes || !(result.speech || {}).asr) return null;
  const n = (result.marks || []).length;
  if (!n) return { cls: "reason", text: "No repeated lines found: no markers." };
  const g = result.marked || 0;
  return { cls: "line", text: `${g} repeated ${g === 1 ? "line" : "lines"}: ${n} markers (Repeat 1/2, Repeat 2/2…) ${done ? "in the new sequence" : "will be put in the new sequence"}, ` +
    "one on each take. Nothing of them is cut; each marker's comment says which take Asistent would keep." };
}

/**
 * 0.10.121: what the result says when ElevenLabs could not read some of the speech (null when it read all of it, or was not
 * asked). `rec` is the engine's speech.recognizer: { name, windows, local, missed, fallback: [reasons] }.
 */
function recognizerNote(rec) {
  if (!rec || !(rec.local || rec.missed)) return null;
  const n = rec.local + rec.missed;
  const part = n >= rec.windows ? "the speech" : `${n} of ${rec.windows} parts of the speech`;
  const why = (rec.fallback || []).length ? `: ${rec.fallback.join("; ")}` : "";
  return `${rec.name} could not read ${part}${why}. ` + (rec.missed ? "No words there (no speech model on this computer)." : "Read on this computer instead.");
}

/** One region in words: "1:02–1:14 · off-mic voice · a voice 12 dB under the main voice · goes". */
function describeRegion(r) {
  const len = r.end - r.start;
  return `${clock(r.start)}–${clock(r.end)} (${len < 10 ? len.toFixed(1) : Math.round(len)} s) · ${r.text || KIND_LABEL[r.kind] || r.kind} · ${r.cut ? "goes" : "stays"}${r.by === "you" ? " (your choice)" : ""}`;
}

/** Each microphone's levels for the preview, and the dB Manual could start from. */
function micLines(result) {
  const lines = [];
  for (const m of ((result.speech || {}).listened || []).slice(0, 6)) {
    const parts = [];
    if (m.floor !== null && m.floor !== undefined) parts.push(`noise ${m.floor} dB`);
    if (m.main !== null && m.main !== undefined) parts.push(`main voice ${m.main} dB`);
    if (result.method === "manual") parts.push(`kept from ${m.open} dB`);
    else if (m.open !== null && m.open !== undefined) parts.push(`speech from ${m.open} dB`);
    lines.push({ cls: "reason", text: `A${(m.track || 0) + 1} ${m.name}: ${parts.join(", ")}.` });
  }
  return lines;
}

module.exports = { SIMPLE, marksLine, recognizerNote, wordsRead, wordsLine, removedShare, guardText, guardPreviewText, MANUAL_GUARD_PCT, PACING, MODES, METHODS, ACTIONS, RANGES, MODE_LABEL, METHOD_LABEL, ACTION_LABEL, KIND_LABEL, readOptions, payloadOptions, signature,
  clock, view, zoomed, scrolled, columns, toggled, overridesOf, totals, kindsLine, describePreview, describeRegion, micLines };
