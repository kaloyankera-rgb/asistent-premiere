// „ГРУБ МОНТАЖ“ as pure logic (no Premiere here, so node can test it): which selected items are cut, why the others are
// left out, how the engine's answer is told, and how the sequence Premiere made from the XML is checked against it.

const { planDialogue } = require("./subtitleplan.js");

const MODE_BG = { safe: "внимателно", smart: "умно" };

/**
 * items: panel items from premiere.readTimeline(). Every SELECTED video and audio item with a media file, speed 1 and
 * not reversed is cut by the same ranges (the cameras and the microphones). Returns
 * { layout: [{kind, track, path, start, end, inPt, name}], dialogue: [...] (planDialogue's audio items), skipped, selected }.
 */
function planRoughCut(items) {
  const picked = items.filter((x) => x.selected);
  const skipped = [];
  const layout = [];
  const refs = [];                                   // the panel item of each layout entry (effects are read from it)
  for (const x of picked) {
    const name = x.name || "клип";
    if (!x.path) skipped.push(`${name} (офлайн медия, вложена секвенция или графика)`);
    else if (Math.abs((x.speed || 1) - 1) >= 0.01) skipped.push(`${name} (променена скорост)`);
    else if (x.reversed) skipped.push(`${name} (обърнат)`);
    else if (!(x.end > x.start)) skipped.push(`${name} (без дължина)`);
    else {
      layout.push({ kind: x.kind, track: x.track, path: x.path, start: x.start, end: x.end, inPt: x.inPt || 0, name });
      refs.push(x);
    }
  }
  const dialogue = planDialogue(items.filter((x) => x.kind === "audio")).use;
  return { layout, refs, dialogue, skipped, selected: picked.length };
}

function clock(t) {
  const m = Math.floor(t / 60);
  const s = Math.round(t - m * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${s < 10 ? "0" : ""}${s}`;
}

/** The engine's /roughcut result -> { text, lines: [{cls, text}] }. */
function describeResult(r, placed) {
  const c = r.counts || {};
  const pct = r.before_s > 0 ? Math.round((100 * (r.before_s - r.after_s)) / r.before_s) : 0;
  const lines = [];
  lines.push({ cls: "line", text: `${c.cuts} ${c.cuts === 1 ? "рязане" : "рязания"} от ${c.pauses_seen} ${c.pauses_seen === 1 ? "пауза" : "паузи"}, махнати ${r.saved_s.toFixed(1)} s. Режим ${MODE_BG[r.mode]}, темпо ${r.tempo_bg || r.tempo}.` });
  const sp = r.speech || {};
  if (!sp.asr) lines.push({ cls: "warn", text: sp.note || "Паузите са намерени без разпознаване на реч." });
  else lines.push({ cls: "line", text: `${sp.words} думи${sp.cached ? " (разпознаването е от преди)" : ""}${sp.vad ? "" : "; Silero не е наличен, паузите са по силата на звука"}.` });
  if (!sp.vad && sp.asr) lines.push({ cls: "warn", text: "Silero не е наличен: паузите са намерени по думите и силата на звука." });
  for (const x of r.review || []) lines.push({ cls: "warn", text: `${clock(x.at)}: ${x.text}` });
  for (const s of r.skipped || []) lines.push({ cls: "warn", text: `Пропуснат: ${s}.` });
  if (r.no_sound_s > 0.05) lines.push({ cls: "line", text: `Махнати ${r.no_sound_s.toFixed(1)} s, в които няма маркиран звук с говор (например другата камера преди първите думи).` });
  if (r.empty_s > 0.05) lines.push({ cls: "line", text: `Затворени ${r.empty_s.toFixed(1)} s празно място между клиповете.` });
  if (r.hole_speech_s > 0.05) lines.push({ cls: "warn", text: `${r.hole_speech_s.toFixed(1)} s са с една камера: другата не записва, но се говори. Оставени са (иначе се реже говор): в реда на тази камера има празно място.` });
  if (r.flashes_dropped > 0) lines.push({ cls: "line", text: `Махнати ${r.flashes_dropped} парчета по няколко кадъра в края на клип, докато другата камера продължава.` });
  lines.push({ cls: "reason", text: "Дублите и сбърканите начала още не се търсят: нищо не е махнато за повторение." });
  for (const l of (placed && placed.notes) || []) lines.push(l);
  if (placed && placed.problems && placed.problems.length) for (const p of placed.problems) lines.push({ cls: "warn", text: p });
  const text = `Готово: ${clock(r.before_s)} → ${clock(r.after_s)} (−${pct} %). Секвенция: ${r.name}.`;
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
      if (have !== n) problems.push(`${kind === "video" ? "Видео" : "Аудио"} писта ${t}: в секвенцията има ${have} части, а трябваше ${n}.`);
    }
  }
  const expected = want.frames / want.fps;
  if (Math.abs((got.end || 0) - expected) > 1 / want.fps) {
    problems.push(`Дължина ${got.end.toFixed(2)} s, а трябваше ${expected.toFixed(2)} s.`);
  }
  return problems;
}

module.exports = { planRoughCut, describeResult, verify, clock, MODE_BG };
