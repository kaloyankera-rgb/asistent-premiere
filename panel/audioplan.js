// Fix audio as pure logic (no Premiere here, so node can test it): what the engine is asked for each clip,
// which clips the host splits through their own channels, and which clip on the timeline gets which level.
//
// The user's workflow (reference video 2026-11-03): the audio is duplicated onto the track below, the upper clip
// plays L/L and the lower one R/R (Modify Clip > Audio Channels), never the Fill effects. Every stereo clip is
// split ("split_all"): the user splits even clips the analysis calls one voice on two mics (C0737 in their
// video), so the analysis only informs and sets the two levels. A mono file has nothing to split.

// a side clip Asistent made (host.jsx as_side_clip): "<file name> L 3.84-13.28"
const SIDE = /\s(L|R)\s\d+\.\d{2}-\d+\.\d{2}$/;
function sideOf(name) {
  const m = SIDE.exec(name || "");
  return m ? m[1] : null;
}

const FROM_FILL = { LL: "use_left", RR: "use_right" };
const FROM_SIDE = { L: "use_left", R: "use_right" };

/**
 * What the engine is asked for one clip. A clip that is already one side (Asistent's, or a Fill effect from
 * earlier versions or by hand) keeps it and only gets its level. Otherwise the button's choice: the main button,
 * Even out phrases and both Split buttons split every stereo clip.
 */
function forceFor(it, force) {
  if (it.side) return FROM_SIDE[it.side];
  if (it.route) return FROM_FILL[it.route];
  if (!force || force === "phrases" || force === "split" || force === "split_rl") return "split_all";
  return force;
}

/**
 * The engine's work list: one entry per clip, except that the two sides of one clip that is already split (by
 * Asistent, or with the Fill effects of earlier versions; same file, same place) are measured together as one split, so a second press sets the same levels as the first (the sum
 * of both tracks under the ceiling). -> { jobs: [{path, start, end, force}], index: [job of each item] }
 */
function engineJobs(items, force) {
  const jobs = [];
  const index = [];
  const pair = {};
  const key = (it) => `${it.path}|${it.start.toFixed(3)}|${it.end.toFixed(3)}`;
  // a side: Asistent's own (L/R in the name) or an older Fill-effect split (LL/RR)
  const sideOfItem = (it) => it.side || (it.route === "LL" ? "L" : it.route === "RR" ? "R" : null);
  const sides = {};
  for (const it of items) if (sideOfItem(it)) (sides[key(it)] = sides[key(it)] || new Set()).add(sideOfItem(it));
  for (const it of items) {
    const both = !!sideOfItem(it) && sides[key(it)].size === 2;
    if (both && pair[key(it)] !== undefined) {
      index.push(pair[key(it)]);
      continue;
    }
    index.push(jobs.length);
    if (both) pair[key(it)] = jobs.length;
    jobs.push({ path: it.path, start: it.inPt, end: it.outPt, force: both ? "split_all" : forceFor(it, force) });
  }
  return { jobs, index };
}

/** The host's routing for the engine's answer, or null (nothing to route: level only, or ask). */
function routeFor(it, res, force) {
  if (it.side || it.route || !res || res.error) return null;
  if (res.action === "split") return force === "split_rl" ? "split_rl" : "split";
  if (res.action === "use_left" || res.action === "use_right") return res.action;
  return null;
}

const OUT_OF_SIDE = { L: "LL", R: "RR" };

/**
 * Which clip on the timeline gets which level, after the host has routed. plans: [{it, res, routed}], where
 * routed is the host's answer for that clip (or null when it was not routed). -> [{plan, track, start, out, who}]
 */
function levelTargets(plans) {
  const out = [];
  for (const p of plans) {
    if (!p.res || p.res.error || p.res.action === "ask") continue;
    const outs = Object.fromEntries((p.res.outputs || []).map((o) => [o.route, o]));
    const r = p.routed;
    if (r && r.ok && r.status === "done") {
      out.push({ plan: p, track: r.upper.track, start: r.upper.start, out: outs[OUT_OF_SIDE[r.upperSide]],
        who: `${r.upperSide}/${r.upperSide} (A${r.upper.track + 1})` });
      if (r.lower) {
        out.push({ plan: p, track: r.lower.track, start: r.lower.start, out: outs[OUT_OF_SIDE[r.lowerSide]],
          who: `${r.lowerSide}/${r.lowerSide} (A${r.lower.track + 1})` });
      }
      continue;
    }
    if (r && !r.ok) continue;                       // the split failed: nothing changed, nothing to level
    const it = p.it;
    const route = it.side ? OUT_OF_SIDE[it.side] : it.route || (r && r.status === "already" && r.side ? OUT_OF_SIDE[r.side] : "as_is");
    out.push({ plan: p, track: it.track, start: it.start, out: outs[route] || outs.as_is, who: it.name });
  }
  return out.filter((t) => t.out);
}

/** One line per routed clip for the report. */
function routeLine(r) {
  if (!r) return null;
  if (!r.ok) return `Not split: ${r.msg}.`;
  if (r.status === "already") return "Already split by Asistent: level only.";
  const sides = r.lower ? `${r.upperSide}/${r.upperSide} on A${r.upper.track + 1}, ${r.lowerSide}/${r.lowerSide} on A${r.lower.track + 1}`
    : `only ${r.upperSide}/${r.upperSide} on A${r.upper.track + 1}`;
  const link = r.linked ? ", linked to the picture" : r.relinked ? ", NOT linked to the picture (link them by hand)" : "";
  return `Channels: ${sides} (Audio Channels on a copy of the clip${link}).`;
}

// ---------------------------------------------------------------- the limiter (Dynamics > Limiter, -6 dB)
// The user's reference video (2026-11-03) puts Dynamics on the Mix track, ticks only Limiter and changes its
// Threshold from the default -1 dB to -6 dB. A script cannot reach the Mix track in Premiere 26.0.2 (QE has only the
// numbered tracks, the sequence has no master), so the same Dynamics goes on every clip that was levelled, and the sum
// of both sides is kept under -6 dB by the gains themselves (engine: audio.py, the true peak of the sum).
//
// Dynamics' parameters are normalised: Limiter Threshold 0.98333 is the default -1 dB, i.e. value = (dB + 60) / 60.
const LIMITER_DB = -6;
const dynValue = (db) => (db + 60) / 60;
const SAME = 0.004;                                     // 0.24 dB: a threshold this close counts as -6 dB

/**
 * What to do with the Dynamics effects already on a clip. dynamics: [{ params: { "Limiter Enabled": 0|1, ... } }]
 * -> "add" (none: append one), "configure" (one untouched Dynamics: switch the limiter on), "ok" (already
 * Limiter on at -6 dB), "foreign" (somebody else's settings or several Dynamics: left alone, said).
 */
function limiterState(dynamics, db = LIMITER_DB) {
  if (!dynamics.length) return { state: "add" };
  if (dynamics.length > 1) return { state: "foreign", why: "the clip has several Dynamics" };
  const p = dynamics[0].params;
  const on = (k) => Number(p[k]) >= 0.5;
  const others = ["AutoGate Enabled", "Compressor Enabled", "Expander Enabled"].filter(on);
  if (on("Limiter Enabled")) {
    if (Math.abs(Number(p["Limiter Threshold"]) - dynValue(db)) <= SAME && !others.length) return { state: "ok" };
    if (Math.abs(Number(p["Limiter Threshold"]) - dynValue(db)) <= SAME) return { state: "foreign", why: "Dynamics has other processors on too" };
    return { state: "foreign", why: `Dynamics already has a limiter with another threshold (${(Number(p["Limiter Threshold"]) * 60 - 60).toFixed(1)} dB)` };
  }
  if (others.length) return { state: "foreign", why: "Dynamics is already set with other processors" };
  return { state: "configure" };
}

module.exports = { sideOf, forceFor, engineJobs, routeFor, levelTargets, routeLine, limiterState, dynValue, LIMITER_DB };
