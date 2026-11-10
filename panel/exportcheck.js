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

/** Offline media: items [{kind, track, name, start, offline}] -> lines */
function offline(items) {
  return items.filter((x) => x.offline).map((x) => `${x.kind === "video" ? "V" : "A"}${x.track + 1} ${x.name} at ${clock(x.start)}`);
}

/**
 * Black: times between 0 and the end of the sequence where no picture shows. Picture = a video item that is switched on,
 * on a track whose eye is on, and not an adjustment layer. Gaps under half a frame are rounding, not black.
 * items: [{kind, start, end, unused, hidden, adjustment}], end: the sequence's end (s), fps -> [{from, to, frames}]
 */
function gaps(items, end, fps) {
  const frame = 1 / (fps || 30);
  const pics = items.filter((x) => x.kind === "video" && !x.unused && !x.hidden && !x.adjustment && x.end > x.start)
    .map((x) => [x.start, x.end]).sort((a, b) => a[0] - b[0]);
  const out = [];
  let at = 0;
  for (const [a, b] of pics) {
    if (a - at >= frame / 2) out.push({ from: at, to: a });
    at = Math.max(at, b);
  }
  if (end - at >= frame / 2) out.push({ from: at, to: end });
  return out.map((g) => ({ ...g, frames: Math.round((g.to - g.from) / frame) }));
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
  const off = offline(input.items || []);
  out.push({ id: "offline", title: "Offline media", status: off.length ? "warn" : "ok",
    lines: off.length ? off : ["Every clip's file is online."] });

  const g = gaps(input.items || [], input.end || 0, input.fps);
  const syncSeq = /^SYNC – /.test(input.sequence || "");
  out.push({ id: "black", title: "Black gaps", status: g.length && !syncSeq ? "warn" : "ok",
    lines: g.length && syncSeq ? [`${g.length} gaps: a SYNC sequence keeps 2 s between groups on purpose (not for export).`] : g.length ? g.map((x) => `${clock(x.from)}–${clock(x.to)}: ${x.frames <= 2 ? `${x.frames || 1} frame${x.frames > 1 ? "s" : ""} of black (a flash frame)` : `${(x.to - x.from).toFixed(1)} s of black`}`)
      : ["No black between the start and the end."] });

  const capLines = [];
  for (const t of input.captions || []) {
    for (const o of overlaps(t.lines || [])) capLines.push(`${t.name || `Captions ${t.index + 1}`}: lines at ${clock(o.a.start)} and ${clock(o.b.start)} overlap`);
  }
  const bad = unsafe(input.graphics || [], input.frame);
  for (const b of bad) capLines.push(`text "${b.name}" at ${clock(b.start)} is ${b.why} (outside the ${input.frame && input.frame.height > input.frame.width ? "apps'" : "title"} safe area)`);
  const hasCaptions = (input.captions || []).some((t) => (t.lines || []).length);
  const status = capLines.length ? "warn" : "ok";
  const notes = [];
  if (hasCaptions) notes.push("Caption tracks: Premiere does not tell a script where they sit on screen, so their place is not checked (only overlaps).");
  out.push({ id: "captions", title: "Captions and text", status,
    lines: [...(capLines.length ? capLines : [`${(input.graphics || []).length} text graphics inside the safe area${hasCaptions ? ", caption lines without overlaps" : ""}.`]), ...notes] });

  const l = loud(input.clips || []);
  const audio = [];
  for (const c of l.mic) audio.push(`A${c.track + 1} ${c.name} at ${clock(c.start)}: peaks about ${c.est} dBFS (the microphone limit is ${MIC_CEILING})`);
  for (const c of l.hot) audio.push(`A${c.track + 1} ${c.name} at ${clock(c.start)}: peaks about ${c.est} dBFS (not a microphone track: music or effects? it may distort)`);
  const speechCount = (input.clips || []).filter((c) => c.speech).length;
  if (!speechCount && (input.clips || []).length) audio.push("No camera or microphone track recognised: only clips near 0 dBFS were looked for.");
  if (l.unmeasured.length) audio.push(`${l.unmeasured.length} clips not measured (no file or no sound): ${l.unmeasured.slice(0, 3).map((c) => c.name).join(", ")}${l.unmeasured.length > 3 ? "…" : ""}`);
  audio.push("Measured per clip on its file with its Volume; track faders, Audio Gain, effects and clips sounding together are not included.");
  out.push({ id: "audio", title: "Microphone level", status: l.mic.length || l.hot.length ? "warn" : "ok",
    lines: l.mic.length || l.hot.length ? audio : [`No microphone clip above ${MIC_CEILING} dBFS.`, ...audio] });

  out.push({ id: "fonts", title: "Missing fonts", status: "unknown",
    lines: ["Premiere does not tell a script which fonts are missing; it shows them when the project opens and on export."] });
  return out;
}

module.exports = { report, gaps, overlaps, unsafe, loud, offline, usedChannel, SAFE, MIC_CEILING };
