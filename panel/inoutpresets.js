// The editor's own In & Out presets as pure rules (Node-tested, no DOM, no store, no Premiere): the list kept in the panel store
// under KEY as a JSON array. The page only does getItem / setItem and passes plain values through these functions. A row is
//   { id: "mine<ms>", v: 1, side: "in"|"out", base: <built-in id of that side>, name, frames, curves: { <pos|scale|rot|op>: { pts } } }
// Rows this version does not understand (another v, foreign shapes) are never dropped or edited: every function hands them back
// untouched, in place, because a newer or older build may own them.
const I = require("./inoutplan.js");
const K = require("./keyframeplan.js");

const KEY = "asistent.inout.presets";
const V = 1;
const NAME_MAX = 24;
const CUSTOM_MAX = 60;                                  // rows this version understands; the list stays a short, scannable set

const isRow = (r) => !!r && typeof r === "object" && !Array.isArray(r);
const mine = (r) => isRow(r) && r.v === V && typeof r.id === "string";
const round3 = (n) => Math.round(n * 1000) / 1000;

/** stored text -> the raw array (junk, null, non-arrays -> []); rows are NOT filtered, see the top of the file */
function parse(text) {
  try {
    const v = typeof text === "string" ? JSON.parse(text) : text;
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

/** a typed name -> trimmed, inner whitespace collapsed, cut to NAME_MAX ("" when there is nothing usable) */
function cleanName(text) {
  if (typeof text !== "string" && typeof text !== "number") return "";
  return String(text).replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
}

/** "My Pop", then "My Pop 2", "My Pop 3" ... unique among that side's names (case ignored), always within NAME_MAX */
function nextName(raw, side, baseName) {
  const taken = new Set();
  for (const r of Array.isArray(raw) ? raw : []) if (mine(r) && r.side === side && typeof r.name === "string") taken.add(r.name.toLowerCase());
  const base = cleanName(`My ${cleanName(baseName) || "preset"}`);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` ${n}`;
    const name = cleanName(base.slice(0, NAME_MAX - suffix.length) + suffix);   // the suffix always survives the cut
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** curves from the page -> clean curves (pts rounded to 3 decimals, corner flag kept), or null when anything is not usable */
function cleanCurves(curves) {
  if (!isRow(curves)) return null;
  const keys = Object.keys(curves);
  if (!keys.length) return null;
  const out = {};
  for (const prop of keys) {
    const c = curves[prop];
    if (!I.PROP_NAMES.includes(prop) || !isRow(c) || !K.pointsOk(c.pts)) return null;
    const pts = c.pts.map((q) => [round3(q[0]), round3(q[1]), ...(q[2] === 1 ? [1] : [])]);
    if (!K.pointsOk(pts)) return null;                  // rounding must not squeeze two points together
    out[prop] = { pts };
  }
  return out;
}

/** a new row from spec { side, base, name, frames, curves } -> { raw, id } or { error }; the input is never changed */
function added(raw, spec, now) {
  const list = Array.isArray(raw) ? raw : [];
  const s = isRow(spec) ? spec : {};
  if (list.filter(mine).length >= CUSTOM_MAX) return { error: `You can keep up to ${CUSTOM_MAX} presets of your own. Delete one to save another.` };
  if (s.side !== "in" && s.side !== "out") return { error: "Choose In or Out for this preset." };
  if (typeof s.base !== "string" || !I.find(s.side, s.base)) return { error: "Pick one of the built-in presets as the starting point." };
  const name = cleanName(s.name);
  if (!name) return { error: "Give the preset a name." };
  const frames = Math.round(Number(s.frames));
  if (s.frames === "" || s.frames === null || s.frames === undefined || !Number.isFinite(frames)) return { error: "Set how many frames the preset lasts." };
  const curves = cleanCurves(s.curves);
  if (!curves) return { error: "This preset needs at least one valid curve." };
  const stamp = Number.isSafeInteger(Math.floor(Number(now))) && Number(now) >= 0 ? Math.floor(Number(now)) : Date.now();
  const used = new Set(list.filter(isRow).map((r) => r.id));
  let n = stamp;
  while (used.has(`mine${n}`)) n++;                     // unique even for two saves in the same millisecond
  const id = `mine${n}`;
  const row = { id, v: V, side: s.side, base: s.base, name, frames: Math.max(I.FRAMES_MIN, Math.min(I.FRAMES_MAX, frames)), curves };
  // the maths has the last word (a base that is not built-in, a property the base does not animate or cannot be edited as one
  // curve): a row it would drop on the next load is never saved
  const ok = I.resolve(row, id);
  if (ok.error) return { error: `This preset cannot be saved: ${ok.error}.` };
  return { raw: [...list, row], id };
}

/** change one row's name only (same id, same place) -> { raw } or { error } */
function renamed(raw, id, name) {
  const list = Array.isArray(raw) ? raw : [];
  const i = list.findIndex((r) => mine(r) && r.id === id);
  if (i < 0) return { error: "That preset is no longer in your list." };
  const clean = cleanName(name);
  if (!clean) return { error: "Give the preset a name." };
  const next = list.slice();
  next[i] = Object.assign({}, list[i], { name: clean });
  return { raw: next };
}

/** the list without that row (an unknown id changes nothing; rows this version does not understand always stay) */
function removed(raw, id) {
  const list = Array.isArray(raw) ? raw : [];
  return { raw: list.filter((r) => !(mine(r) && r.id === id)) };
}

module.exports = { KEY, V, NAME_MAX, CUSTOM_MAX, parse, cleanName, nextName, added, renamed, removed };
