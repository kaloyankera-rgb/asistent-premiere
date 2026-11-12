// A folder dropped on the Auto import row (0.10.67, the user 2026-11-12: "another way of syncing folders ... just dragging the
// folder and dropping it on top of the area"). Pure: which path a drop carries. What Premiere's UXP hands a panel for a drag
// from Finder / Explorer is not documented for Premiere, so every way is read: the files list (a nativePath or path), the
// file:// links of text/uri-list, and plain text. The engine then checks the path is a folder (importer.bind).

/** "file:///Users/a/My%20Folder/" or "file://localhost/C:/x" -> "/Users/a/My Folder" / "C:/x"; anything else unchanged. */
function fromUri(s) {
  let t = String(s || "").trim();
  if (!/^file:/i.test(t)) return t;
  t = t.replace(/^file:\/\/(localhost)?/i, "");
  try {
    t = decodeURIComponent(t);
  } catch (e) { /* a % that is not an escape: keep it */ }
  if (/^\/[A-Za-z]:\//.test(t)) t = t.slice(1);                   // file:///C:/x on Windows
  return t;
}

/** One path from a drop's parts: {files: [{nativePath?, path?, name?}], uriList?: string, text?: string} -> path or null. */
function droppedPath(parts) {
  for (const f of parts.files || []) {
    const p = f && (f.nativePath || f.path);
    if (p) return trimSlash(String(p));
  }
  const uris = String(parts.uriList || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (uris.length) return trimSlash(fromUri(uris[0]));
  const text = String(parts.text || "").trim().split(/\r?\n/)[0];
  if (/^(file:|\/|[A-Za-z]:[\\/]|\\\\)/.test(text)) return trimSlash(fromUri(text));
  return null;
}

function trimSlash(p) {
  return p.length > 1 && /[\\/]$/.test(p) && !/^[A-Za-z]:[\\/]$/.test(p) ? p.slice(0, -1) : p;
}

/** The drop event -> the parts droppedPath reads (and a short note for the log: what the event carried). */
function partsOf(e) {
  const dt = e && e.dataTransfer;
  const parts = { files: [], uriList: "", text: "", note: "" };
  if (!dt) return { ...parts, note: "no dataTransfer" };
  const get = (type) => {
    try {
      return dt.getData(type) || "";
    } catch (err) {
      return "";
    }
  };
  try {
    for (const f of dt.files || []) parts.files.push({ nativePath: f.nativePath, path: f.path, name: f.name });
  } catch (err) { /* no files list */ }
  parts.uriList = get("text/uri-list");
  parts.text = get("text/plain") || get("text");
  let types = [];
  try {
    types = [...(dt.types || [])];
  } catch (err) { /* no types */ }
  parts.note = `types ${types.join(",") || "none"}, files ${parts.files.length}${parts.files.length ? ` (${parts.files.map((f) => f.nativePath || f.path || f.name).join(" | ")})` : ""}` +
    `, uri ${parts.uriList ? parts.uriList.slice(0, 120) : "none"}, text ${parts.text ? parts.text.slice(0, 120) : "none"}`;
  return parts;
}

module.exports = { fromUri, droppedPath, partsOf };
