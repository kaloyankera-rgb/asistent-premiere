// „Оправи звука“ as pure logic (no Premiere here, so node can test it): what the engine is asked for each clip,
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
 * „Изравни фразите“ and both „Раздели“ split every stereo clip.
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
  if (!r.ok) return `Не е разделено: ${r.msg}.`;
  if (r.status === "already") return "Вече е разделен от Asistent: само силата.";
  const sides = r.lower ? `${r.upperSide}/${r.upperSide} на A${r.upper.track + 1}, ${r.lowerSide}/${r.lowerSide} на A${r.lower.track + 1}`
    : `само ${r.upperSide}/${r.upperSide} на A${r.upper.track + 1}`;
  const link = r.linked ? ", свързани с картината" : r.relinked ? ", НЕ са свързани с картината (свържи ги ръчно)" : "";
  return `Каналите: ${sides} (Audio Channels на копие от клипа${link}).`;
}

module.exports = { sideOf, forceFor, engineJobs, routeFor, levelTargets, routeLine };
