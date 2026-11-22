// The Folders page's rules (0.10.144, the user 2026-11-22: favourite folders one press away inside Premiere). Pure: the list
// the panel's store keeps, labels, colours, order, and paths relative to the open project. Nothing here touches Premiere,
// the disk or the engine; folders.js does, and the engine opens a folder in Finder / Explorer (reveal.open_folder).
//
// An item: { id, label, path, rel, color }. `path` is the absolute folder as last known; `rel` (only when "relative to the
// project" is on) is the way from the open project's folder to it ("Assets", "../Music"), so one button opens each project's
// own folder when the projects share a folder structure.

const COLORS = ["none", "red", "orange", "yellow", "green", "blue", "purple"];
const LABEL_MAX = 40;

// "C:\a\b\" -> "C:/a/b"; "/a/b/" -> "/a/b". One separator inside, so paths can be compared and joined.
function norm(p) {
  let s = String(p || "").trim().replace(/\\/g, "/");
  const unc = s.startsWith("//");
  s = s.replace(/\/{2,}/g, "/");
  if (unc) s = `/${s}`;
  if (s.length > 1 && s.endsWith("/") && !/^[A-Za-z]:\/$/.test(s)) s = s.slice(0, -1);
  return s;
}

function basename(p) {
  const s = norm(p);
  const i = s.lastIndexOf("/");
  return i >= 0 && i < s.length - 1 ? s.slice(i + 1) : s;
}

function dirname(p) {
  const s = norm(p);
  const i = s.lastIndexOf("/");
  if (i < 0) return "";
  if (i === 0) return "/";
  if (/^[A-Za-z]:$/.test(s.slice(0, i))) return `${s.slice(0, i)}/`;
  return s.slice(0, i);
}

// the root a path starts on ("/" on Mac, "C:" on Windows, "//server/share" for a network path): relative only within one
function rootOf(p) {
  const s = norm(p);
  const drive = /^([A-Za-z]:)/.exec(s);
  if (drive) return drive[1].toUpperCase();
  const unc = /^(\/\/[^/]+\/[^/]+)/.exec(s);
  if (unc) return unc[1].toLowerCase();
  return s.startsWith("/") ? "/" : "";
}

function parts(p) {
  return norm(p).split("/").filter(Boolean);
}

// Windows and macOS's own volumes ignore case: compare case-blind; a path that differs only in case is the same folder
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/** From `base` (a folder) to `target`: "Assets", "../Music", "." — or null when they are on different drives / volumes. */
function relativePath(base, target) {
  if (!base || !target || rootOf(base) !== rootOf(target) || !rootOf(base)) return null;
  const a = parts(base);
  const b = parts(target);
  if (rootOf(base).startsWith("//")) {                      // the server and share are the root, not steps
    a.splice(0, 2);
    b.splice(0, 2);
  } else if (/^[A-Z]:$/.test(rootOf(base))) {
    a.shift();
    b.shift();
  }
  let k = 0;
  while (k < a.length && k < b.length && same(a[k], b[k])) k++;
  const up = a.length - k;
  const out = [...Array(up).fill(".."), ...b.slice(k)];
  return out.length ? out.join("/") : ".";
}

/** `rel` from the folder `base` -> an absolute path ("." and ".." resolved; never above the root). */
function join(base, rel) {
  const b = norm(base);
  const unc = /^(\/\/[^/]+\/[^/]+)/.exec(b);
  const drive = /^([A-Za-z]:)/.exec(b);
  const head = unc ? unc[1] : drive ? drive[1] : "";        // kept as written (a share's name keeps its case)
  const steps = parts(b.slice(head.length));
  for (const s of parts(rel)) {
    if (s === ".") continue;
    if (s === "..") steps.pop();                              // never above the root: pop on an empty list does nothing
    else steps.push(s);
  }
  return `${head}/${steps.join("/")}`;
}

/** The open project's folder from its .prproj path, or null when the project was never saved. */
function projectDir(projectPath) {
  return projectPath && /\.prproj$/i.test(projectPath) ? dirname(projectPath) : null;
}

/** Where a button points now: relative ones follow the open project (null when no saved project is open). */
function resolve(item, projDir) {
  if (item.rel !== undefined && item.rel !== null) return projDir ? join(projDir, item.rel) : null;
  return item.path;
}

function cleanLabel(s, fallback) {
  const t = String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
  return t || fallback;
}

/** What the store holds -> a clean list (a broken or old value never breaks the page). */
function load(raw) {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch (e) {
      v = null;
    }
  }
  const items = v && Array.isArray(v.items) ? v.items : [];
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || typeof it.path !== "string" || !it.path.trim()) continue;
    const id = typeof it.id === "string" && it.id && !seen.has(it.id) ? it.id : newId(out);
    seen.add(id);
    out.push({
      id,
      label: cleanLabel(it.label, basename(it.path)),
      path: norm(it.path),
      rel: typeof it.rel === "string" ? it.rel : null,
      color: COLORS.includes(it.color) ? it.color : "none",
    });
  }
  return out;
}

function save(items) {
  return JSON.stringify({ items: items.map(({ id, label, path, rel, color }) => ({ id, label, path, rel, color })) });
}

function newId(items) {
  let n = items.length + 1;
  const ids = new Set(items.map((i) => i.id));
  while (ids.has(`f${n}`)) n++;
  return `f${n}`;
}

/** Add folders (absolute paths). -> { items, added: [labels], already: [labels] }; a folder already in the list is not added twice. */
function add(items, paths) {
  const out = items.slice();
  const added = [];
  const already = [];
  for (const p of paths || []) {
    const path = norm(p);
    if (!path) continue;
    const dup = out.find((i) => same(i.path, path) && (i.rel === null || i.rel === undefined));
    if (dup) {
      already.push(dup.label);
      continue;
    }
    const item = { id: newId(out), label: cleanLabel("", basename(path)), path, rel: null, color: "none" };
    out.push(item);
    added.push(item.label);
  }
  return { items: out, added, already };
}

function update(items, id, fn) {
  return items.map((i) => (i.id === id ? fn({ ...i }) : i));
}

const rename = (items, id, label) => update(items, id, (i) => ({ ...i, label: cleanLabel(label, basename(i.path)) }));
const recolor = (items, id, color) => update(items, id, (i) => ({ ...i, color: COLORS.includes(color) ? color : "none" }));
const remove = (items, id) => items.filter((i) => i.id !== id);

/** One place up (-1) or down (+1); the ends stay. */
function move(items, id, step) {
  const k = items.findIndex((i) => i.id === id);
  const j = k + step;
  if (k < 0 || j < 0 || j >= items.length) return items;
  const out = items.slice();
  [out[k], out[j]] = [out[j], out[k]];
  return out;
}

/** Relative to the project on / off. -> { items, error }: on needs a saved project on the same drive as the folder. */
function setRelative(items, id, on, projDir) {
  const it = items.find((i) => i.id === id);
  if (!it) return { items, error: null };
  if (!on) {
    const abs = resolve(it, projDir) || it.path;
    return { items: update(items, id, (i) => ({ ...i, path: abs, rel: null })), error: null };
  }
  if (!projDir) return { items, error: "Save the project first: a relative folder is counted from the project's folder." };
  const rel = relativePath(projDir, it.path);
  if (rel === null) return { items, error: "This folder is on another drive than the project: it cannot follow the project." };
  return { items: update(items, id, (i) => ({ ...i, rel })), error: null };
}

/** The button's tooltip: where it goes now, and how. */
function tip(item, projDir) {
  const where = resolve(item, projDir);
  if (item.rel !== null && item.rel !== undefined) {
    return where ? `${where}\nRelative to the project (${item.rel}).` : `Relative to the project (${item.rel}): open a saved project first.`;
  }
  return where;
}

module.exports = { COLORS, LABEL_MAX, norm, basename, dirname, relativePath, join, projectDir, resolve, load, save, add, rename,
  recolor, remove, move, setRelative, tip };
