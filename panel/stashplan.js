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

module.exports = { capture, place, sampleAt, nameFor, FORMAT, MAX_FRAMES };
