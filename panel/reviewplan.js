// What the Captions tab shows under a line to check (2026-11 improvements): the engine's review items (engine review.py) as
// short reasons, words first or timing first as the item says, and which lines stay visible with "Lines to check". Pure: no
// Premiere, no engine; node-tested. Probabilities are never shown as percentages ("unsure" is what the recognition said).

const KIND = { recognition: "Words", timing: "Timing" };
const WHY = { number: "number", negation: "negation", name: "name" };
const MAX_REASONS = 3;

function quote(word) {
  const w = String(word || "").trim();
  return w ? `„${w}“` : "";
}

// one review item -> one short line of text
function reasonText(item) {
  if (item.from !== undefined && item.to !== undefined) {
    return `${KIND[item.kind] || "Words"} · ${quote(item.from)} → ${quote(item.to)} (${String(item.label).replace(/^changed by /, "")})`;
  }
  const why = item.why && WHY[item.why] ? `, ${WHY[item.why]}` : "";
  const word = quote(item.word);
  return `${KIND[item.kind] || "Words"} · ${item.label}${word ? `: ${word}` : ""}${why}`;
}

// the items of one line -> [{text, cls}] (at most MAX_REASONS, then "+N more"); cls marks what changes meaning
function reasonRows(items) {
  const list = items || [];
  const rows = list.slice(0, MAX_REASONS).map((x) => ({
    text: reasonText(x),
    cls: x.severity >= 3 ? "why meaning" : x.kind === "timing" ? "why timing" : "why",
  }));
  if (list.length > MAX_REASONS) rows.push({ text: `+${list.length - MAX_REASONS} more`, cls: "why" });
  return rows;
}

// is line i one to check (a medium or high item)?
function toCheck(review, i) {
  const items = review && review.lines && review.lines[i];
  return !!items && items.some((x) => x.severity >= 2);
}

// the line under the list: how many lines to check and what kind, plus the reminder about same-model readings
function summaryText(review, lines) {
  const s = (review && review.summary) || null;
  if (!s) return "";
  if (!s.lines_to_check) return `${lines} lines. Nothing marked to check (the recognition was sure; listen anyway where it matters).`;
  return `${s.lines_to_check} of ${lines} lines to check: ${s.meaning} about meaning (numbers, negations, names, missing or changed words), `
    + `${s.timing} about timing. "Unsure" is what the recognition reported, not a measured accuracy.`;
}

// the review helpers are on unless the editor switched them off (remembered on this computer)
function helpersOn(stored) {
  return stored !== "0";
}

module.exports = { reasonText, reasonRows, toCheck, summaryText, helpersOn, MAX_REASONS };
