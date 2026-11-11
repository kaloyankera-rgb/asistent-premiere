// Stash v1 (COCKPIT_PLAN.md A2, 0.10.37): an animation saved as data and written again on another clip at the playhead.
// Pure (no Premiere), tested with node. The easing is kept exactly by sampling: the value at every sequence frame between
// the first and the last key is stored (Premiere's own Bezier handles cannot be read or written by a script, Phase 0), and
// written back like a Keyframer bake: the editor's keys as keys, the frames between them as Asistent's keys (so the
// Keyframer's Undo last and a new curve work on an applied stash too).
const K = require("./keyframeplan.js");

const FORMAT = 1;
const MAX_FRAMES = 3000;

/**
 * props: [{label, comp, param, keys: [{t, v}], samples: [{t, v}]}] (media seconds; samples = the value every frame from the
 * first to the last key, keys included). One origin for all properties, so their timing against each other is kept.
 * -> {format, span, props: [{label, comp, param, anchors: [{dt, v}], frames: [{dt, v}]}]} or {error}
 */
function capture(props, meta = {}) {
  const used = props.filter((p) => p.keys && p.keys.length >= 2);
  if (!used.length) return { error: "Tick at least one property with two or more keyframes." };
  const t0 = Math.min(...used.map((p) => p.keys[0].t));
  const r = (x) => Math.round(x * 100000) / 100000;
  const out = used.map((p) => ({
    label: p.label, comp: p.comp, param: p.param,
    anchors: p.keys.map((k) => ({ dt: r(k.t - t0), v: k.v })),
    frames: (p.samples || []).map((k) => ({ dt: r(k.t - t0), v: k.v })),
  }));
  const frames = out.reduce((n, p) => n + p.frames.length, 0);
  if (frames > MAX_FRAMES) return { error: `That animation is too long to keep (${frames} frames, at most ${MAX_FRAMES}).` };
  return { format: FORMAT, span: Math.max(...out.map((p) => p.anchors[p.anchors.length - 1].dt)), props: out, ...meta };
}

// the stored animation's value `dt` after its start: between stored frames, a straight line (they are one frame apart)
function sampleAt(frames, dt) {
  if (!frames.length) return null;
  if (dt <= frames[0].dt) return frames[0].v;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (dt <= b.dt) return K.lerp(a.v, b.v, b.dt > a.dt ? (dt - a.dt) / (b.dt - a.dt) : 1);
  }
  return frames[frames.length - 1].v;
}

/**
 * Where the stash goes on the target clip: start `t0` (media seconds on the target), `step` its media seconds per sequence
 * frame, `until` its out point (media seconds), `existing`: per prop label the target's own key times. A property whose
 * range already holds a key of the editor's is not written (never overwritten); keys past the clip's end are cut.
 * -> {props: [{label, comp, param, anchors: [{t, v}], add: [{t, v}], cut}], skipped: [{label, why}], total}
 */
function place(stash, t0, step, until, existing = {}) {
  const props = [];
  const skipped = [];
  let total = 0;
  for (const p of stash.props || []) {
    const from = t0 + p.anchors[0].dt;
    const to = t0 + p.anchors[p.anchors.length - 1].dt;
    const theirs = (existing[p.label] || []).filter((t) => t >= from - step / 2 && t <= to + step / 2);
    if (theirs.length) {
      skipped.push({ label: p.label, why: `the clip already has ${theirs.length} keyframe${theirs.length > 1 ? "s" : ""} of its own there` });
      continue;
    }
    const end = Number.isFinite(until) ? until + step / 2 : Infinity;
    const anchors = p.anchors.map((k) => ({ t: t0 + k.dt, v: k.v })).filter((k) => k.t <= end);
    if (anchors.length < 2) {
      skipped.push({ label: p.label, why: "the clip ends before its second keyframe" });
      continue;
    }
    const add = [];
    for (let i = 0; i + 1 < anchors.length; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      const n = Math.round((b.t - a.t) / step);
      for (let f = 1; f < n; f++) {
        const t = a.t + f * step;
        if (t >= b.t - step / 2) break;
        add.push({ t, v: p.frames.length ? sampleAt(p.frames, t - t0) : K.lerp(a.v, b.v, f / n) });
      }
    }
    const cut = anchors.length < p.anchors.length;
    total += anchors.length + add.length;
    props.push({ label: p.label, comp: p.comp, param: p.param, anchors, add, cut });
  }
  return { props, skipped, total };
}

/** A short name for a new stash: the clip and what moves ("C0738 · Position, Scale") */
function nameFor(clip, labels) {
  const parts = [...new Set(labels.map((l) => String(l).split(" › ").pop()))];
  const base = String(clip || "Animation").replace(/\.[A-Za-z0-9]{2,4}$/, "");
  return `${base} · ${parts.slice(0, 3).join(", ")}${parts.length > 3 ? "…" : ""}`;
}

// ---------------------------------------------------------------- Stash clips (v2, 0.10.50)
// A small group of clips (a logo on V2 over its background on V1, a title with its sound) kept as a Premiere project and
// copied again at the playhead. Here only the plan: what the selection becomes, and where the copies can go without
// covering anything (a copy never overwrites: Asistent does not remove or cut the editor's clips).

const MAX_CLIPS = 60;
const MAX_SHIFT = 12;                                         // tracks a group may move up to find room

/**
 * items: the selected track items {kind, track, start, end, name, path} (sequence seconds).
 * -> {kind: "clips", span, video, audio, items: [{kind, track, start, end, name, label, group}], name} or {error}
 * Times are from the selection's start; tracks stay as they were (a group comes back on the same tracks when they are free).
 * group: clips of one file over the same time on video and audio (a clip and its sound): linked again after Apply.
 */
function captureClips(items, fps = 30) {
  const sel = items.filter((x) => x && (x.kind === "video" || x.kind === "audio") && x.end > x.start);
  if (!sel.length) return { error: "Select the clips to keep in the timeline (for example a logo on V2 and its background on V1)." };
  if (sel.length > MAX_CLIPS) return { error: `${sel.length} clips are selected: a stash keeps up to ${MAX_CLIPS}.` };
  const t0 = Math.min(...sel.map((x) => x.start));
  const t1 = Math.max(...sel.map((x) => x.end));
  const f = (x) => Math.round(x * fps) / fps;
  const groups = new Map();
  const out = sel.map((x) => {
    const start = f(x.start - t0);
    const end = f(x.end - t0);
    const key = x.path ? `${x.path}|${start}|${end}` : null;
    if (key && !groups.has(key)) groups.set(key, groups.size + 1);
    return { kind: x.kind, track: x.track, start, end, name: x.name || "", label: `${x.kind === "video" ? "V" : "A"}${x.track + 1} ${x.name || ""}`.trim(),
      group: key ? groups.get(key) : 0 };
  });
  // a group is a link only when it holds more than one clip
  const sizes = {};
  for (const x of out) if (x.group) sizes[x.group] = (sizes[x.group] || 0) + 1;
  for (const x of out) if (x.group && sizes[x.group] < 2) x.group = 0;
  out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "video" ? -1 : 1) || b.track - a.track || a.start - b.start);
  const vids = out.filter((x) => x.kind === "video");
  const top = vids[0] || out[0];
  const base = String(top.name || "Clips").replace(/\.[A-Za-z0-9]{2,4}$/, "");
  return { kind: "clips", span: f(t1 - t0), items: out, name: `${base}${out.length > 1 ? ` + ${out.length - 1}` : ""}`,
    video: vids.length ? Math.max(...vids.map((x) => x.track)) + 1 : 0,
    audio: out.some((x) => x.kind === "audio") ? Math.max(...out.filter((x) => x.kind === "audio").map((x) => x.track)) + 1 : 0 };
}

/**
 * Where a clips stash goes at `at` (sequence seconds) in a sequence holding `existing` items {kind, track, start, end} with
 * `counts` {video, audio} tracks: the same tracks when they are free there, else moved up (video) / down (audio) by the
 * smallest shift that is free over the whole time of each kind. Never over another clip.
 * -> {dv, da, add: {video, audio}, ranges} (add = tracks to add first) or {error}
 */
function fitClips(stash, at, existing, counts, fps = 30) {
  const tol = 0.5 / fps;
  const busy = (kind, track, a, b) => existing.some((x) => x.kind === kind && x.track === track && x.start < b - tol && x.end > a + tol);
  const pick = (kind) => {
    const mine = stash.items.filter((x) => x.kind === kind);
    if (!mine.length) return { shift: 0, add: 0 };
    for (let d = 0; d <= MAX_SHIFT; d++) {
      if (mine.every((x) => !busy(kind, x.track + d, at + x.start, at + x.end))) {
        const need = Math.max(...mine.map((x) => x.track + d)) + 1;
        return { shift: d, add: Math.max(0, need - (counts[kind] || 0)) };
      }
    }
    return null;
  };
  const v = pick("video");
  const a = pick("audio");
  if (!v || !a) return { error: `No free room for the stash at ${at.toFixed(2)} s within ${MAX_SHIFT} tracks: park the playhead elsewhere.` };
  const ranges = stash.items.map((x) => ({ kind: x.kind, track: x.track + (x.kind === "video" ? v.shift : a.shift),
    start: at + x.start, end: at + x.end, group: x.group, label: x.label }));
  return { dv: v.shift, da: a.shift, add: { video: v.add, audio: a.add }, ranges };
}

/** The link groups of placed ranges, as host.jsx as_link wants them: [[{kind, track, start, end}]]. */
function linkGroups(ranges) {
  const g = new Map();
  for (const r of ranges) {
    if (!r.group) continue;
    if (!g.has(r.group)) g.set(r.group, []);
    g.get(r.group).push({ kind: r.kind, track: r.track, start: r.start, end: r.end });
  }
  return [...g.values()].filter((x) => x.length > 1);
}

module.exports = { capture, place, sampleAt, nameFor, captureClips, fitClips, linkGroups, FORMAT, MAX_FRAMES, MAX_CLIPS, MAX_SHIFT };
