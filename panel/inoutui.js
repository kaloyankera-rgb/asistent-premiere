// What the In & Out page shows and says, as pure functions (Node-tested, no DOM): which controls a pair of picked presets needs,
// the remembered choices cleaned up, the tooltip of a preset and the status sentences of a result. The page is inout.js, the
// Premiere side premiere-inout.js, the presets and their maths inoutplan.js.
const I = require("./inoutplan.js");

const NONE = "none";
const PROP_LABEL = { pos: "Position", scale: "Scale", rot: "Rotation", op: "Opacity" };
// the filter chips above the tiles (0.10.133): the plan's groups under shorter names, one filter for both sides
const FILTERS = [["all", "All"], ["move", "Move"], ["scale", "Scale"], ["spin", "Spin"], ["fade", "Fade"]];
const GROUP_FILTER = { pos: "move", scale: "scale", rot: "spin", op: "fade" };
const SHOWN_SKIPS = 4;                                  // the status line lists this many skipped clips, then "and N more"

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const whole = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};

/** frames typed by the editor -> an integer in FRAMES_MIN..FRAMES_MAX, or null when it is not a number (the field is empty / junk) */
function clampFrames(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = whole(v);
  return n === null ? null : clamp(n, I.FRAMES_MIN, I.FRAMES_MAX);
}

/** Strength typed by the editor -> an integer in STRENGTH_MIN..STRENGTH_MAX (the default when it is not a number) */
function clampStrength(v) {
  const n = whole(v);
  return n === null ? I.STRENGTH_DEFAULT : clamp(n, I.STRENGTH_MIN, I.STRENGTH_MAX);
}

const validFilter = (f) => (FILTERS.some(([id]) => id === f) ? f : "all");
const validPreset = (side, id) => (id && I.find(side, id) ? id : NONE);

/**
 * The remembered choices (a stored object, anything) -> a complete state. inFrames / outFrames are null until the editor typed a
 * value for that side: then the page shows the picked preset's own default length.
 */
function restore(saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  return {
    inPreset: validPreset("in", s.inPreset),
    outPreset: validPreset("out", s.outPreset),
    inFrames: clampFrames(s.inFrames),
    outFrames: clampFrames(s.outFrames),
    direction: I.DIRECTIONS.includes(s.direction) ? s.direction : "left",
    turn: I.TURNS.includes(s.turn) ? s.turn : "cw",
    strength: s.strength === undefined || s.strength === null ? I.STRENGTH_DEFAULT : clampStrength(s.strength),
    blur: !!s.blur,
    side: s.side === "out" ? "out" : "in",                // which preset list shows (a UI choice; saved values from before 0.10.132 have none)
    filter: validFilter(s.filter),                         // which group of tiles shows (0.10.133; none saved before: All)
  };
}

/** what to store: the same fields, nothing else */
function snapshot(state) {
  return { inPreset: state.inPreset, outPreset: state.outPreset, inFrames: state.inFrames, outFrames: state.outFrames,
    direction: state.direction, turn: state.turn, strength: state.strength, blur: !!state.blur, side: state.side === "out" ? "out" : "in",
    filter: validFilter(state.filter) };
}

/** a side's tiles in display order: None first, then the presets by group: [{id, name, filter ("" for None), preset}] */
function tiles(side) {
  const out = [{ id: NONE, name: "None", filter: "", preset: null }];
  for (const g of I.groups(side)) for (const p of g.presets) out.push({ id: p.id, name: p.name, filter: GROUP_FILTER[g.id] || "", preset: p });
  return out;
}

/** the ids of the tiles a filter shows on a side (None always); the page hides the rest, they stay in the page for the bridge */
function shownTiles(side, filter) {
  const f = validFilter(filter);
  return tiles(side).filter((t) => f === "all" || t.filter === "" || t.filter === f).map((t) => t.id);
}

/**
 * What a pick of tile `id` on `side` changes in the state (a patch): the preset, the side the page follows to, and the filter, which
 * goes back to All when the picked tile is filtered out (a pick by id from the bridge must be seen).
 */
function afterPick(state, side, id) {
  const s = side === "out" ? "out" : "in";
  const shown = shownTiles(s, state.filter).includes(id);
  return { [`${s}Preset`]: id, side: s, filter: shown ? validFilter(state.filter) : "all" };
}

/**
 * What the controls show for this state:
 * {side (the list showing), filter, shown: {in, out} (the ids of the tiles the filter shows), labels: {in, out} (the In | Out switch's texts: "In · Slide", "Out · None"), summary (the dock's one line),
 * mode: "in" | "out" | "both" | null, canApply, direction, turn, strength (enabled), strengthTip, frames: {in, out} (what the boxes show:
 * the typed value, else the preset's default, null while the side is None), opts: what Apply sends to premiere-inout.apply}
 */
function view(state) {
  const inP = state.inPreset !== NONE ? I.find("in", state.inPreset) : null;
  const outP = state.outPreset !== NONE ? I.find("out", state.outPreset) : null;
  const needs = [inP, outP].filter(Boolean).map((p) => I.needs(p));
  const strength = needs.some((n) => n.strength);
  const frames = {
    in: inP ? (state.inFrames !== null ? state.inFrames : I.defaultFrames("in", inP.id)) : null,
    out: outP ? (state.outFrames !== null ? state.outFrames : I.defaultFrames("out", outP.id)) : null,
  };
  const mode = inP && outP ? "both" : inP ? "in" : outP ? "out" : null;
  const part = (label, p, n) => `${label} ${p.name} ${n}f`;
  return {
    side: state.side === "out" ? "out" : "in",
    filter: validFilter(state.filter),
    shown: { in: shownTiles("in", state.filter), out: shownTiles("out", state.filter) },
    labels: { in: `In · ${inP ? inP.name : "None"}`, out: `Out · ${outP ? outP.name : "None"}` },
    summary: mode ? [inP ? part("In", inP, frames.in) : "", outP ? part("Out", outP, frames.out) : ""].filter(Boolean).join(" · ") : "Nothing picked",
    mode,
    canApply: !!mode,
    direction: needs.some((n) => n.direction),
    turn: needs.some((n) => n.turn),
    strength,
    strengthTip: !mode ? "Pick an In or an Out animation first."
      : strength ? `How far, how big and how strong the animation goes: ${I.STRENGTH_MIN}-${I.STRENGTH_MAX} %, 100 is the preset's own size.`
        : "Strength does not change this animation",
    frames,
    opts: {
      inPreset: inP ? inP.id : null, outPreset: outP ? outP.id : null,
      inFrames: frames.in === null ? undefined : frames.in, outFrames: frames.out === null ? undefined : frames.out,
      direction: state.direction, turn: state.turn, strength: state.strength, blur: !!state.blur,
    },
  };
}

/**
 * The view while the pointer rests on a preset button (`side`, `id`): the picks as they are, but that side showing `id` (None allowed),
 * so the preview can play it. Never stored, never written; the page goes back to view(state) when the pointer leaves.
 */
function hoverView(state, side, id) {
  const key = side === "out" ? "outPreset" : "inPreset";
  return view({ ...state, [key]: validPreset(side === "out" ? "out" : "in", id) });
}

/**
 * What a typed frames box means for the state: the value to keep for `side` ("in" | "out"), null = "the preset's own length".
 * An empty or junk box is null; so is a number equal to the length the box was already showing as the preset's default (focusing the
 * box and leaving it must not pin the default as something the editor typed).
 */
function framesAfterTyping(state, side, raw) {
  const n = clampFrames(raw);
  if (n === null) return null;
  const key = `${side}Frames`;
  if (state[key] === null && n === view(state).frames[side]) return null;
  return n;
}

/** the line shown while both sides are None: Apply is disabled and this says why */
const PICK_FIRST = "Pick an In or an Out animation first.";

/**
 * The status lines to show now: the result of the last press when there is one (the page forgets it as soon as a choice changes),
 * else the reason Apply is disabled while both sides are None, else nothing.
 */
function statusFor(state, result) {
  if (result && result.length) return result;
  return view(state).canApply ? [] : [{ text: PICK_FIRST, cls: "line" }];
}

/** a preset button's tooltip: what it animates and what else it asks for */
function presetTip(side, preset) {
  const names = I.animates(preset).map((p) => PROP_LABEL[p]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const need = I.needs(preset);
  const asks = [need.direction ? "choose the edge below" : "", need.turn ? "choose the turn below" : ""].filter(Boolean).join(" and ");
  return `${preset.name} (${side}): animates ${list}.${asks ? ` Also ${asks}.` : ""} Default length ${preset.frames} frames.`;
}

const plural = (n, one, many) => (n === 1 ? one : many);
const sentence = (t) => (/[.!?]$/.test(t) ? t : `${t}.`);

/** the Undo wording the Keyframer uses: "Cmd/Ctrl+Z takes it back." / "Cmd/Ctrl+Z 2 times takes it back (...)." */
function undoLine(steps) {
  return steps > 1 ? `Cmd/Ctrl+Z ${steps} times takes it back (Premiere adds an effect in a step of its own).` : "Cmd/Ctrl+Z takes it back.";
}

function skipLines(skipped) {
  const out = (skipped || []).slice(0, SHOWN_SKIPS).map((s) => ({ text: `Skipped ${s.name}: ${sentence(s.why)}`, cls: "warn" }));
  if ((skipped || []).length > SHOWN_SKIPS) out.push({ text: `And ${skipped.length - SHOWN_SKIPS} more skipped.`, cls: "warn" });
  return out;
}

/**
 * The status lines after a press: [{text, cls}] ("line" normal, "warn" something the editor should read).
 * kind "apply": result of premiere-inout.apply {clips, skipped, steps, shortened, notes, keys}; kind "remove": {clips, skipped, steps}.
 */
function status(kind, res) {
  const r = res || {};
  const lines = [];
  if (kind === "remove") {
    if (r.clips) lines.push({ text: `Removed the In & Out animation from ${r.clips} ${plural(r.clips, "clip", "clips")}. ${undoLine(r.steps || 1)}`, cls: "line" });
    else lines.push({ text: "Nothing removed: none of the selected clips has an In & Out animation.", cls: "warn" });
    return lines.concat(skipLines(r.clips ? r.skipped : []));
  }
  if (r.clips) {
    const keys = r.keys ? `, ${r.keys} keyframes` : "";
    lines.push({ text: `Done: ${r.clips} ${plural(r.clips, "clip", "clips")} animated${keys}. ${undoLine(r.steps || 1)}`, cls: "line" });
  } else {
    lines.push({ text: "Nothing was applied.", cls: "warn" });
  }
  if ((r.shortened || []).length) {
    lines.push({ text: `Shortened to fit the clip: ${r.shortened.join(", ")}.`, cls: "line" });
  }
  lines.push(...skipLines(r.skipped));
  for (const n of r.notes || []) lines.push({ text: sentence(n), cls: "warn" });
  return lines;
}

module.exports = { FILTERS, tiles, shownTiles, afterPick, NONE, PROP_LABEL, PICK_FIRST, clampFrames, clampStrength, framesAfterTyping, restore, snapshot, view, hoverView, presetTip, undoLine, status, statusFor };
