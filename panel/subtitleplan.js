// Pure logic of the „СУБТИТРИ“ section (no Premiere here, so node can test it): which selected audio items are sent
// to the engine, why the others are left out, how the sequence frame size is read, and how the engine's answer is
// shown. Duplicates (several cameras hearing the same speech) are decided by the engine, which can listen: it keeps
// the cleanest copy (dialoguemix.py), not the one on the lowest track.

/**
 * items: panel items from premiere.readTimeline() ({kind, track, start, end, inPt, path, name, speed, reversed,
 * selected}, seconds). Returns { use: [{path, start, end, at, name, track}], skipped: [text], selected: n }.
 * `start`/`end` are the media in/out seconds, `at` the sequence second where the item starts.
 */
function planDialogue(items) {
  const picked = items.filter((x) => x.kind === "audio" && x.selected);
  const skipped = [];
  const usable = [];
  for (const x of picked) {
    const name = x.name || "клип";
    if (!x.path) skipped.push(`${name} (офлайн медия или вложена секвенция)`);
    else if (Math.abs((x.speed || 1) - 1) >= 0.01) skipped.push(`${name} (променена скорост)`);
    else if (x.reversed) skipped.push(`${name} (обърнат)`);
    else if (!(x.end > x.start)) skipped.push(`${name} (без дължина)`);
    else usable.push(x);
  }
  usable.sort((a, b) => a.start - b.start || a.track - b.track);
  const use = usable.map((x) => ({ path: x.path, start: x.inPt || 0, end: (x.inPt || 0) + (x.end - x.start), at: x.start,
    name: x.name || "клип", track: x.track }));
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

const PRESET_NAME = { short: "кратки (9:16)", standard: "стандартни (16:9)" };

/** The engine's /subtitles result -> { text, ok, lines: [{cls, text}] } for the result box. */
function describeResult(r) {
  const c = r.counts || {};
  const lines = [];
  if (!c.captions) {
    return { ok: false, text: "Не разпознах реч в маркираните клипове.", lines: [{ cls: "warn", text: "Провери дали са избрани клиповете с говор." }] };
  }
  lines.push({ cls: "line", text: `${c.words} думи · вид ${PRESET_NAME[r.preset] || r.preset} · ${r.fps.toFixed(3).replace(/\.?0+$/, "")} fps` +
    ` · ${r.cached ? "разпознаването е от преди" : `разпознаване ${r.asr_seconds} s за ${r.mix_seconds} s звук`}` });
  const t = r.timing || {};
  if (t.method === "aligned") {
    lines.push({ cls: "line", text: `Времена: подравнени по звука (${t.aligned} думи${t.weak ? `, ${t.weak} слаби остават от Whisper` : ""}).` });
  } else {
    const why = t.error && !/не е инсталирано/.test(t.error) ? `подравняването не успя (${t.error})` : "подравняването не е инсталирано";
    lines.push({ cls: "warn", text: `Времена: от Whisper, може да са неточни с до 0,3 s (${why}).` });
  }
  const unsure = [];
  for (const cap of r.captions || []) for (const f of cap.flags || []) unsure.push(`${clock(f.at)} „${String(f.word).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")}“`);
  if (unsure.length) {
    lines.push({ cls: "warn", text: `Провери ${unsure.length === 1 ? "1 несигурна дума" : `${unsure.length} несигурни думи`} (прочетени различно или непознати за речника): ${unsure.slice(0, 10).join(", ")}${unsure.length > 10 ? ", …" : ""}.` });
  }
  const rd = r.readings;
  if (rd && rd.changed) lines.push({ cls: "line", text: `${rd.changed} ${rd.changed === 1 ? "дума е сменена" : "думи са сменени"}, защото повечето четения и речникът са за друга дума.` });
  for (const d of r.duplicates || []) {
    const rest = d.kept_rest_seconds ? `; ${d.kept_rest_seconds} s от ${d.dropped} са запазени, там другият не чува` : "";
    lines.push({ cls: "line", text: `${d.dropped} и ${d.kept} чуват едно и също: взет е ${d.kept} (по-чист звук, ${d.kept_snr_db} dB срещу ${d.dropped_snr_db} dB${rest}).` });
  }
  for (const s of r.skipped || []) lines.push({ cls: "warn", text: `Пропуснат: ${s}.` });
  for (const cap of (r.captions || []).slice(0, 8)) {
    const unsure = (cap.flags || []).length ? "  ?" : "";
    lines.push({ cls: "line", text: `${clock(cap.start)}  ${String(cap.text).replace(/\n/g, " / ")}${unsure}` });
  }
  if (r.captions.length > 8) lines.push({ cls: "hint", text: `… още ${r.captions.length - 8} реда в файла.` });
  lines.push({ cls: "hint", text: `Файл: ${r.srt}` });
  return { ok: true, text: `Готово: ${c.captions} реда субтитри.`, lines };
}

module.exports = { planDialogue, sizeFrom, dirOf, describeResult };
