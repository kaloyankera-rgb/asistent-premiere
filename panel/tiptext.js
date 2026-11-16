// A tooltip's text as lines (0.10.110, pure: node tests it). The user (2026-11-15): "more clear instructions and more organized
// when you hover over different settings". A tip is one short summary line, then one line per choice: "Name: what it does".
// The first line stays plain; a later line that starts with a short name and a colon shows that name in bold, so a list of
// choices reads as a list. A tip without line breaks is one plain paragraph, as before.

const LABEL = /^([^:]{1,28}):\s+(.+)$/;

/** "Lead\nName: text\n…" -> [{ lead: true, text } | { label, text } | { text }] (empty lines dropped). */
function tipLines(tip) {
  const lines = String(tip || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return lines.map((line, i) => {
    if (i === 0) return { lead: lines.length > 1, text: line };
    const m = LABEL.exec(line);
    return m ? { label: m[1], text: m[2] } : { text: line };
  });
}

module.exports = { tipLines };
