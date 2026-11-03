// Correcting the words of finished subtitles by typing them right (pure logic, no Premiere, tested with node).
//
// The engine already has the editor's correction lines („heard => said“, corrections.py): the heard words are replaced
// BEFORE the alignment, so the new words are timed by the sound, not copied over the old times. This module turns what
// the user typed into a caption line into those lines: the smallest changed stretch, with one neighbouring word as an
// anchor when a word was only added or removed, or when the changed word is short and would match everywhere.

const SHORT = 3;                                   // letters: a changed word this short is anchored by a neighbour

const strip = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const key = (w) => strip(w).toLowerCase();
const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean);

/** Longest common subsequence of two word lists by normalised word -> [[i, j], ...] of matching positions. */
function matches(a, b) {
  const n = a.length;
  const m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) t[i][j] = key(a[i]) === key(b[j]) ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) {
      out.push([i, j]);
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/**
 * One caption's original and edited text -> [{heard, said}]: one pair per changed stretch. Changes in case or
 * punctuation only are not corrections.
 */
function pairsFor(original, edited) {
  const a = words(original);
  const b = words(edited);
  if (!a.length || !b.length) return [];
  // the changed stretches: a[i..mi) became b[j..mj)
  let stretches = [];
  let i = 0;
  let j = 0;
  for (const [mi, mj] of [...matches(a, b), [a.length, b.length]]) {
    if (mi > i || mj > j) stretches.push({ i, mi, j, mj });
    i = mi + 1;
    j = mj + 1;
  }
  // two changes with only one short word between them are one phrase that was corrected („ще чакай да бъде ти“)
  stretches = stretches.reduce((acc, x) => {
    const last = acc[acc.length - 1];
    if (last && x.i - last.mi === 1 && strip(a[last.mi]).length <= SHORT) acc[acc.length - 1] = { i: last.i, mi: x.mi, j: last.j, mj: x.mj };
    else acc.push(x);
    return acc;
  }, []);
  const out = [];
  for (const { i: i0, mi, j: j0, mj } of stretches) {
    let from = i0;
    let to = mi;
    let jf = j0;
    let jt = mj;
    const old = a.slice(i0, mi);
    const now = b.slice(j0, mj);
    const short = old.length + now.length <= 2 && [...old, ...now].every((w) => strip(w).length <= SHORT);
    if ((!old.length || !now.length || short) && (from > 0 || to < a.length)) {
      if (from > 0) {                               // anchor on the word before
        from -= 1;
        jf -= 1;
      } else {                                      // or the word after
        to += 1;
        jt += 1;
      }
    }
    const heard = strip(a.slice(from, to).join(" "));
    const said = strip(b.slice(jf, jt).join(" "));
    if (heard && said && key(heard) !== key(said)) out.push({ heard, said });
  }
  return out;
}

/**
 * Every edited caption -> the pairs to add. captions: [{text}], edited: [text] (same order). The caption text has line
 * breaks, which are spaces for the matching.
 */
function pairsFromEdits(captions, edited) {
  const out = [];
  const seen = new Set();
  captions.forEach((c, k) => {
    const text = edited[k];
    if (text === undefined || text === null) return;
    for (const p of pairsFor(String(c.text).replace(/\s+/g, " "), String(text).replace(/\s+/g, " "))) {
      const id = `${key(p.heard)}=>${p.said}`;
      if (!seen.has(id)) {
        seen.add(id);
        out.push(p);
      }
    }
  });
  return out;
}

/** The corrections box with the new pairs added; a line for the same heard words is replaced, the rest stays. */
function addToNotes(notes, pairs) {
  const lines = String(notes || "").trim() ? String(notes).split("\n") : [];
  for (const p of pairs) {
    const line = `${p.heard} => ${p.said}`;
    const at = lines.findIndex((l) => l.includes("=>") && key(l.split("=>")[0]) === key(p.heard));
    if (at >= 0) lines[at] = line;
    else lines.push(line);
  }
  return lines.join("\n").replace(/\n+$/, "");
}

module.exports = { pairsFor, pairsFromEdits, addToNotes, key };
