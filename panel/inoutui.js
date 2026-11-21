// What the In & Out page shows and says, as pure functions (Node-tested, no DOM): which controls a pair of picked presets needs,
// the remembered choices cleaned up, the tooltip of a preset and the status sentences of a result. The page is inout.js, the
// Premiere side premiere-inout.js, the presets and their maths inoutplan.js.
const I = require("./inoutplan.js");

const NONE = "none";
const PROP_LABEL = { pos: "Position", scale: "Scale", rot: "Rotation", op: "Opacity" };
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
  };
}

/** what to store: the same fields, nothing else */
function snapshot(state) {
  return { inPreset: state.inPreset, outPreset: state.outPreset, inFrames: state.inFrames, outFrames: state.outFrames,
    direction: state.direction, turn: state.turn, strength: state.strength, blur: !!state.blur };
}

/**
 * What the controls show for this state:
 * {mode: "in" | "out" | "both" | null, canApply, direction, turn, strength (enabled), strengthTip, frames: {in, out} (what the boxes show:
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
  return {
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

module.exports = { NONE, PROP_LABEL, PICK_FIRST, clampFrames, clampStrength, framesAfterTyping, restore, snapshot, view, presetTip, undoLine, status, statusFor };
