// Pre-export check (TODO I12, 0.10.35): what to look at before exporting. Pure (no Premiere), tested with node. Read only:
// the check never changes the sequence. Each part says whether it was measured ("ok" / "warn") or cannot be measured through
// Premiere's API ("unknown"), so a green line never claims more than was checked.
// The user's list (2026-11-10): offline media, black gaps, captions outside the safe area, the main mic over -6 dB.

const MIC_CEILING = -6;              // the user's rule: dialogue never peaks above -6 dBFS
const CLIP_DB = -1;                  // any clip this hot may distort after export

// Where text may sit, as fractions of the frame (0 = left / top). Vertical: the apps' buttons on the right and the caption
// and account name at the bottom cover the picture (common to TikTok, Reels and Shorts); otherwise the classic title-safe 90 %.
const SAFE = {
  vertical: { left: 0.06, right: 0.86, top: 0.10, bottom: 0.80 },
  other: { left: 0.05, right: 0.95, top: 0.05, bottom: 0.95 },
};

const { routeOf } = require("./channels.js");
const coverage = require("./coverage.js");

// which channel of the file a clip plays: Fix audio's L / R copies say it in their name ("C0728 L 0.00-18.52",
// "fx31031 0340a9 L 0.00-36.04"; host.jsx sets their Audio Channels to L/L or R/R), an older Fill Left / Right effect by
// its name (channels.js). Anything else: both channels count (the louder one decides).
function usedChannel(name, effects) {
  const m = / ([LR]) \d+\.\d{2}-\d+\.\d{2}$/.exec(String(name || ""));
  if (m) return m[1];
  const r = routeOf(effects || []);
  return r === "LL" ? "L" : r === "RR" ? "R" : null;
}

const clock = (s) => {
  const m = Math.floor(s / 60);
  const r = s - 60 * m;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
};

/**
 * A time as Premiere shows it in the Timeline and the Program Monitor (0.10.45, the user: the check "gives unclear info,
 * I need time stamps"): 00:00:29:08, or 00;00;29;08 with drop-frame counting at 29.97 / 59.94 fps (Premiere's default for
 * those rates, as in the user's screenshot). Without a frame rate: the plain 0:29.1 clock.
 */
function timecode(s, fps) {
  if (!(fps > 0) || !Number.isFinite(s)) return clock(s || 0);
  const nominal = Math.round(fps);
  const drop = Math.abs(fps - nominal) > 0.01 && (nominal === 30 || nominal === 60);
  let f = Math.round(Math.max(0, s) * fps);
  if (drop) {
    // SMPTE drop frame: skip 2 (4 at 59.94) frame numbers each minute, except every tenth minute
    const d = nominal === 60 ? 4 : 2;
    const per10 = nominal * 600 - 9 * d;
    const per1 = nominal * 60 - d;
    const tens = Math.floor(f / per10);
    const rem = f % per10;
    f += 9 * d * tens + (rem > d ? d * Math.floor((rem - d) / per1) : 0);
  }
  const ff = f % nominal;
  const total = Math.floor(f / nominal);
  const two = (n) => String(n).padStart(2, "0");
  const sep = drop ? ";" : ":";
  return [two(Math.floor(total / 3600)), two(Math.floor(total / 60) % 60), two(total % 60), two(ff)].join(sep);
}

/** Offline media: items [{kind, track, name, start, offline}] -> lines */
function offline(items, fps) {
  return items.filter((x) => x.offline).map((x) => ({ text: `${x.kind === "video" ? "V" : "A"}${x.track + 1} ${x.name} at ${timecode(x.start, fps)}`, at: x.start }));
}

// a part's lines: plain strings, and for the problems a time the panel can jump to and mark (0.10.45)
function part(id, title, status, lines) {
  return { id, title, status, lines: lines.map((l) => (typeof l === "string" ? l : l.text)),
    times: lines.map((l) => (typeof l === "string" || !Number.isFinite(l.at) ? null : l.at)) };
}

/**
 * Black: times between 0 and the end of the sequence where no picture shows. Picture = a video item that is switched on,
 * on a track whose eye is on, and not an adjustment layer. Gaps under half a frame are rounding, not black.
 * items: [{kind, start, end, unused, hidden, adjustment}], end: the sequence's end (s), fps -> [{from, to, frames}]
 */
function gaps(items, end, fps, from = 0) {
  const frame = 1 / (fps || 30);
  const pics = items.filter((x) => x.kind === "video" && !x.unused && !x.hidden && !x.adjustment && x.end > x.start)
    .map((x) => [x.start, x.end]).sort((a, b) => a[0] - b[0]);
  const out = [];
  let at = from;
  for (const [a, b] of pics) {
    if (b <= from) continue;
    if (a >= end) break;
    if (a - at >= frame / 2) out.push({ from: at, to: a });
    at = Math.max(at, b);
  }
  if (end - at >= frame / 2) out.push({ from: at, to: end });
  return out.map((g) => ({ ...g, frames: Math.round((g.to - g.from) / frame) }));
}

/**
 * What an export covers (0.10.45, the user's ReShape check said "0:58.1–2:23.9: 85.9 s of black": the music ran on after the
 * picture, past the Out point the user exports to). range: {from, to} the sequence's In / Out when set. Without one, the
 * export runs to the last clip of any kind: black after the last picture is then said as sound running on, not as a gap.
 * -> {from, to, tail: {from, to} | null}
 */
function span(items, end, range) {
  if (range && range.to > range.from) return { from: range.from, to: range.to, tail: null, ranged: true };
  const pics = items.filter((x) => x.kind === "video" && !x.unused && !x.hidden && !x.adjustment && x.end > x.start);
  const lastPic = Math.max(0, ...pics.map((x) => x.end));
  return { from: 0, to: pics.length ? lastPic : end, tail: pics.length && end - lastPic > 0.05 ? { from: lastPic, to: end } : null, ranged: false };
}

/** Caption lines of one track that overlap in time: lines [{start, end}] -> [{a, b}] (indexes in time order) */
function overlaps(lines, tol = 0.001) {
  const s = lines.map((l, i) => ({ ...l, i })).sort((x, y) => x.start - y.start);
  const out = [];
  for (let k = 1; k < s.length; k++) if (s[k].start < s[k - 1].end - tol) out.push({ a: s[k - 1], b: s[k] });
  return out;
}

/** Text graphics whose centre is outside the safe area: graphics [{name, start, x, y}], frame {width, height} */
function unsafe(graphics, frame) {
  const box = frame && frame.height > frame.width ? SAFE.vertical : SAFE.other;
  return graphics.filter((g) => g.x < box.left || g.x > box.right || g.y < box.top || g.y > box.bottom)
    .map((g) => ({ ...g, why: g.y > box.bottom ? "too low" : g.y < box.top ? "too high" : g.x > box.right ? "too far right" : "too far left" }));
}

/**
 * Loud clips: clips [{track, name, start, peakDb: [per channel] | null, gainDb, speech}] (peak of the file in the clip's range,
 * gainDb the highest Volume the clip reaches). -> { mic: [...], hot: [...], unmeasured: [...] }
 */
function loud(clips) {
  const mic = [];
  const hot = [];
  const unmeasured = [];
  for (const c of clips) {
    if (!c.peakDb || !c.peakDb.length) {
      unmeasured.push(c);
      continue;
    }
    const side = usedChannel(c.name, c.effects);
    const heard = side && c.peakDb.length >= 2 ? [c.peakDb[side === "L" ? 0 : 1]] : c.peakDb;
    const est = Math.max(...heard) + (Number.isFinite(c.gainDb) ? c.gainDb : 0);
    const x = { ...c, est: Math.round(est * 10) / 10 };
    if (c.speech && est > MIC_CEILING + 0.05) mic.push(x);
    else if (!c.speech && est > CLIP_DB) hot.push(x);
  }
  return { mic, hot, unmeasured };
}

/**
 * The whole report. -> [{id, title, status: "ok" | "warn" | "unknown", lines}]
 * input: {items, end, fps, frame, captions: [{index, name, lines}], graphics, clips (with peaks), fontsKnown: false}
 */
function report(input) {
  const out = [];
  const fps = input.fps;
  const tc = (t) => timecode(t, fps);
  const off = offline(input.items || [], fps);
  out.push(part("offline", "Offline media", off.length ? "warn" : "ok", off.length ? off : ["Every clip's file is online."]));

  const sp = span(input.items || [], input.end || 0, input.range);
  const g = gaps(input.items || [], sp.to, fps, sp.from);
  const syncSeq = /^SYNC – /.test(input.sequence || "");
  const where = sp.ranged ? `between the In (${tc(sp.from)}) and the Out (${tc(sp.to)})` : "between the start and the last picture";
  const black = g.map((x) => ({ at: x.from, text: `${tc(x.from)} – ${tc(x.to)}: ${x.frames <= 2 ? `${x.frames || 1} frame${x.frames > 1 ? "s" : ""} of black (a flash frame)` : `${(x.to - x.from).toFixed(1)} s of black`}` }));
  const tail = sp.tail ? [{ at: sp.tail.from, text: `${tc(sp.tail.from)} – ${tc(sp.tail.to)}: only sound after the last picture (${(sp.tail.to - sp.tail.from).toFixed(1)} s of black if you export the whole sequence: set an Out point at ${tc(sp.tail.from)} or trim the sound)` }] : [];
  out.push(part("black", "Black gaps", (g.length || tail.length) && !syncSeq ? "warn" : "ok",
    syncSeq && (g.length || tail.length) ? [`${g.length + tail.length} gaps: a SYNC sequence is a working sequence, not for export.`]
      : g.length || tail.length ? [...black, ...tail] : [`No black ${where}.`]));

  // 0.10.44: every video / photo clip fills the frame (the user: under-scaled B-roll shows black or the clip below)
  if (input.pictures && input.files && input.frame) {
    const all = (input.items || []).filter((x) => x.kind === "video");
    const inside = sp.ranged ? input.pictures.filter((p) => p.end > sp.from && p.start < sp.to) : input.pictures;
    const r = coverage.check(inside, input.files, input.frame, all, tc);
    const lines = r.bad.slice(0, 25).map((b) => ({ text: b.text, at: b.at }));
    if (r.bad.length > 25) lines.push(`… and ${r.bad.length - 25} more clips.`);
    const notes = [];
    if (r.skipped) notes.push(`${r.skipped} logo, graphic or transparent ${r.skipped === 1 ? "file was" : "files were"} not checked (smaller on purpose).`);
    const tr = input.pictures.filter((p) => p.transform).length;
    if (tr) notes.push(`${tr} ${tr === 1 ? "clip has" : "clips have"} a Transform effect: measured with Motion only.`);
    if (r.unknownFit) notes.push("Scale to Frame Size cannot be read in this Premiere: clips are measured as if it is off.");
    out.push(part("fill", "Picture fills the frame", r.bad.length ? "warn" : "ok",
      [...(r.bad.length ? lines : [`All ${r.looked} video and photo clips fill the ${input.frame.width}x${input.frame.height} frame.`]), ...notes]));
  }

  const capLines = [];
  for (const t of input.captions || []) {
    for (const o of overlaps(t.lines || [])) capLines.push({ at: o.b.start, text: `${t.name || `Captions ${t.index + 1}`}: lines at ${tc(o.a.start)} and ${tc(o.b.start)} overlap` });
  }
  const bad = unsafe(input.graphics || [], input.frame);
  for (const b of bad) capLines.push({ at: b.start, text: `text "${b.name}" at ${tc(b.start)} is ${b.why} (outside the ${input.frame && input.frame.height > input.frame.width ? "apps'" : "title"} safe area)` });
  const hasCaptions = (input.captions || []).some((t) => (t.lines || []).length);
  const notes = [];
  if (hasCaptions) notes.push("Caption tracks: Premiere does not tell a script where they sit on screen, so their place is not checked (only overlaps).");
  out.push(part("captions", "Captions and text", capLines.length ? "warn" : "ok",
    [...(capLines.length ? capLines : [`${(input.graphics || []).length} text graphics inside the safe area${hasCaptions ? ", caption lines without overlaps" : ""}.`]), ...notes]));

  const inRange = (c) => !sp.ranged || ((c.end === undefined || c.end > sp.from) && c.start < sp.to);
  const l = loud((input.clips || []).filter(inRange));
  const audio = [];
  for (const c of l.mic) audio.push({ at: c.start, text: `A${c.track + 1} ${c.name} at ${tc(c.start)}: peaks about ${c.est} dBFS (the microphone limit is ${MIC_CEILING})` });
  for (const c of l.hot) audio.push({ at: c.start, text: `A${c.track + 1} ${c.name} at ${tc(c.start)}: peaks about ${c.est} dBFS (not a microphone track: music or effects? it may distort)` });
  const speechCount = (input.clips || []).filter((c) => c.speech).length;
  if (!speechCount && (input.clips || []).length) audio.push("No camera or microphone track recognised: only clips near 0 dBFS were looked for.");
  if (l.unmeasured.length) audio.push(`${l.unmeasured.length} clips not measured (no file or no sound): ${l.unmeasured.slice(0, 3).map((c) => c.name).join(", ")}${l.unmeasured.length > 3 ? "…" : ""}`);
  audio.push("Measured per clip on its file with its Volume; track faders, Audio Gain, effects and clips sounding together are not included.");
  out.push(part("audio", "Microphone level", l.mic.length || l.hot.length ? "warn" : "ok",
    l.mic.length || l.hot.length ? audio : [`No microphone clip above ${MIC_CEILING} dBFS.`, ...audio]));

  out.push(part("fonts", "Missing fonts", "unknown",
    ["Premiere does not tell a script which fonts are missing; it shows them when the project opens and on export."]));
  if (sp.ranged) out[0].note = `Checked between the In (${tc(sp.from)}) and the Out (${tc(sp.to)}).`;
  return out;
}

/**
 * The problems as sequence markers (0.10.45, the user: "maybe added markers"): one per line that has a time, named by its
 * part, the line as the comment. Markers already there with the same name at the same time are not added again.
 * parts: report(); existing: [{name, at}] -> [{name, at, comment}]
 */
function markers(parts, existing = [], fps = 30) {
  const half = 0.5 / (fps || 30);
  const out = [];
  for (const p of parts) {
    if (p.status !== "warn") continue;
    p.lines.forEach((text, i) => {
      const at = p.times && p.times[i];
      if (!Number.isFinite(at)) return;
      const name = `Check: ${p.title}`;
      if ([...existing, ...out].some((m) => m.name === name && Math.abs(m.at - at) < half)) return;
      out.push({ name, at, comment: text });
    });
  }
  return out;
}

module.exports = { report, gaps, span, markers, timecode, overlaps, unsafe, loud, offline, usedChannel, SAFE, MIC_CEILING };
