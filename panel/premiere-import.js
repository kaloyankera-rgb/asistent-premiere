// Smart Folder Sync in Premiere: import what the engine found for THIS project into the bin of its
// category, in place (no copy), only once, and check that it arrived. Never touches the timeline.
const ppro = require("premierepro");
const P = require("./premiere.js");
const engine = require("./engine.js");

const { maybe, debug } = P;

// macOS and Windows file systems ignore case by default
const norm = (p) => String(p || "").replace(/\\/g, "/").toLowerCase();

async function mediaPaths(project) {
  const out = new Set();
  const stack = [await project.getRootItem()];
  while (stack.length) {
    const folder = stack.pop();
    for (const item of (await folder.getItems()) || []) {
      const clip = ppro.ClipProjectItem.cast(item);
      if (clip) {
        const p = await maybe(clip, "getMediaFilePath");
        if (p) out.add(norm(p));
        continue;
      }
      const sub = ppro.FolderItem.cast(item);
      if (sub) stack.push(sub);
    }
  }
  return out;
}

async function binHas(bin, path) {
  for (const item of (await bin.getItems()) || []) {
    const clip = ppro.ClipProjectItem.cast(item);
    if (clip && norm(await maybe(clip, "getMediaFilePath")) === norm(path)) return true;
  }
  return false;
}

/** Import the engine's pending files for the open project. Returns [{ name, category, ok, note }]. */
async function importPending(project, pending) {
  const have = await mediaPaths(project);
  const done = [];
  for (const it of pending) {
    if (have.has(norm(it.path))) {
      await engine.importResult(it.id, true, "already in the project");
      done.push({ name: it.name, category: it.category, ok: true, note: "already in the project" });
      continue;
    }
    let ok = false;
    let note = "";
    try {
      const bin = await P.ensureBin(project, it.category);
      const target = ppro.ProjectItem.cast(bin) || bin;
      const accepted = await project.importFiles([it.path], true, target, false);
      ok = !!accepted && (await binHas(bin, it.path));
      if (!ok) note = accepted ? "did not appear in the bin" : "Premiere did not accept it";
    } catch (e) {
      note = (e && e.message) || String(e);
    }
    debug(`import ${it.name} -> ${it.category}: ${ok ? "ok" : note}`);
    await engine.importResult(it.id, ok, note);
    if (ok) have.add(norm(it.path));
    done.push({ name: it.name, category: it.category, ok, note });
  }
  return done;
}

// UXP folder picker (needs "localFileSystem": "request")
async function pickFolder() {
  const fs = require("uxp").storage.localFileSystem;
  const folder = await fs.getFolder();
  return folder ? folder.nativePath : null;
}

module.exports = { importPending, pickFolder };
