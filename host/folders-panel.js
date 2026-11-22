// Asistent Folders, the CEP panel (0.10.145). Premiere's UXP panels get an empty drop from Finder (measured 2026-11-22), and a
// CEP panel gets the dropped folder with its path (measured the same day: "Tik Tok Sounds", dir true), so drag and drop lives
// here, next to the Folders tab of the Asistent panel. Both show the same list: the engine's panel store, key asistent.folders,
// read again every few seconds. Rules in folderplan.js, an exact copy of panel/folderplan.js (a test keeps them identical).
// Read only: a press opens the folder in Finder / Explorer through the engine; nothing in Premiere or in the folders changes.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const ROOT = (() => {
  try {
    const raw = decodeURI(window.__adobe_cep__.getSystemPath("extension"));
    return path.normalize(raw.replace(/^file:\/\//, "").replace(/^\/(?=[A-Za-z]:)/, ""));
  } catch (e) {
    return window.__folderRoot || ".";                    // the browser preview sets it
  }
})();
const FP = require(path.join(ROOT, "folderplan.js"));

const KEY = "asistent.folders";
const POLL_MS = 3000;
const APP = process.platform === "win32" ? "Explorer" : "Finder";
const LOG = path.join(os.homedir(), process.platform === "darwin" ? "Library/Application Support/Asistent" : "AppData/Local/Asistent", "logs", "host.log");
const DRAG_TYPE = "application/x-asistent-folder";

const state = { items: [], raw: null, projDir: null, renaming: null, confirm: null, menu: null };
const $ = (id) => document.getElementById(id);

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `${new Date().toISOString()} folders panel: ${msg}\n`);
  } catch (e) { /* the log is a convenience */ }
}

function call(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request({ host: "127.0.0.1", port: 47390, method, path: url, timeout: 8000,
      headers: Object.assign({ "X-Asistent": "1" }, data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let j = {};
        try { j = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (e) { /* not JSON */ }
        if (res.statusCode >= 400) reject(new Error(j.error || `Engine: HTTP ${res.statusCode}`));
        else resolve(j);
      });
    });
    req.on("timeout", () => req.destroy(new Error("The Asistent engine does not answer.")));
    req.on("error", () => reject(new Error("The Asistent engine does not answer (is Asistent installed and running?).")));
    if (data) req.write(data);
    req.end();
  });
}

function say(text, cls) {
  const s = $("status");
  s.textContent = text || "";
  s.className = cls || "";
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

// the open project's folder (ExtendScript: app.project.path), for buttons that follow the project
function readProject() {
  return new Promise((resolve) => {
    try {
      window.__adobe_cep__.evalScript("app.project ? app.project.path : ''", (r) => resolve(FP.projectDir(r && r !== "EvalScript error." ? r : "")));
    } catch (e) {
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------- the shared list
async function pull() {
  try {
    const r = await call("GET", "/panel/store");
    const raw = ((r && r.values) || {})[KEY] || null;
    if (raw !== state.raw) {
      state.raw = raw;
      state.items = FP.load(raw);
      return true;
    }
  } catch (e) { /* offline: keep what is shown */ }
  return false;
}

async function save(items, text, cls) {
  state.items = items;
  state.raw = FP.save(items);
  render();
  if (text !== undefined) say(text, cls);
  try {
    await call("POST", "/panel/store", { key: KEY, value: state.raw });
  } catch (e) {
    say(`Not saved: ${e.message}`, "err");
  }
}

function addPaths(paths, how) {
  const r = FP.add(state.items, paths);
  const bits = [];
  if (r.added.length) bits.push(`Added ${r.added.join(", ")}.`);
  if (r.already.length) bits.push(`Already here: ${r.already.join(", ")}.`);
  log(`${how}: ${paths.length} folders, added ${r.added.length}`);
  save(r.items, bits.join(" ") || "Nothing to add.", r.added.length ? "ok" : "");
}

async function open(item) {
  state.projDir = await readProject();
  const where = FP.resolve(item, state.projDir);
  if (!where) return say(`${item.label} follows the project: open a saved project first.`, "err");
  try {
    await call("POST", "/folders/open", { path: where });
    say(`Opened ${item.label} in ${APP}.`, "ok");
  } catch (e) {
    say(e.message, "err");
  }
}

// ---------------------------------------------------------------- drawing
function render() {
  const list = $("list");
  list.innerHTML = "";
  if (!state.items.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = `No folders yet. Drag a folder from ${APP} here, or press Add folder…. Each one becomes a button that opens it in ${APP}.`;
    list.appendChild(e);
    return;
  }
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const it of state.items) {
    const where = FP.resolve(it, state.projDir);
    const b = document.createElement("div");
    b.className = `f c-${it.color}${!where || !isDir(where) ? " missing" : ""}`;
    b.title = !where ? FP.tip(it, null) : isDir(where) ? FP.tip(it, state.projDir) : `${where}\nNot there now (moved, renamed or the drive is not mounted).`;
    if (state.renaming === it.id) {
      const input = document.createElement("input");
      input.value = it.label;
      input.maxLength = FP.LABEL_MAX;
      const done = (keep) => {
        if (state.renaming !== it.id) return;
        state.renaming = null;
        if (keep && input.value.trim() !== it.label) save(FP.rename(state.items, it.id, input.value));
        else render();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") done(true);
        if (e.key === "Escape") done(false);
      });
      input.addEventListener("blur", () => done(true));
      b.appendChild(input);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    } else {
      b.textContent = it.label;
      b.draggable = true;
      b.addEventListener("click", () => open(it));
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showMenu(it, e.clientX, e.clientY);
      });
      // drag a button onto another to move it there (an internal drag, told apart from a drop from Finder by its type)
      b.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(DRAG_TYPE, it.id);
        e.dataTransfer.effectAllowed = "move";
      });
      b.addEventListener("dragover", (e) => {
        if ([...e.dataTransfer.types].includes(DRAG_TYPE)) {
          e.preventDefault();
          b.classList.add("target");
        }
      });
      b.addEventListener("dragleave", () => b.classList.remove("target"));
      b.addEventListener("drop", (e) => {
        const from = e.dataTransfer.getData(DRAG_TYPE);
        if (!from) return;                                  // a drop from Finder: the page handles it
        e.preventDefault();
        e.stopPropagation();
        b.classList.remove("target");
        save(moveTo(state.items, from, it.id));
      });
    }
    grid.appendChild(b);
  }
  list.appendChild(grid);
}

// `from` takes the place of `to` (the others shift), as dragging in a list does
function moveTo(items, from, to) {
  const a = items.findIndex((i) => i.id === from);
  const b = items.findIndex((i) => i.id === to);
  if (a < 0 || b < 0 || a === b) return items;
  const out = items.slice();
  const [x] = out.splice(a, 1);
  out.splice(b, 0, x);
  return out;
}

// ---------------------------------------------------------------- the right-click menu
function closeMenu() {
  if (state.menu) state.menu.remove();
  state.menu = null;
}

function showMenu(it, x, y) {
  closeMenu();
  const m = document.createElement("div");
  m.className = "menu";
  const item = (label, fn, cls) => {
    const d = document.createElement("div");
    d.className = `it${cls ? ` ${cls}` : ""}`;
    d.textContent = label;
    if (fn) d.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    m.appendChild(d);
    return d;
  };
  const sep = () => { const d = document.createElement("div"); d.className = "sep"; m.appendChild(d); };
  item("Open", () => { closeMenu(); open(it); });
  item("Rename", () => { closeMenu(); state.renaming = it.id; render(); });
  const sw = document.createElement("div");
  sw.className = "sw";
  for (const c of FP.COLORS) {
    const d = document.createElement("div");
    d.className = it.color === c ? "on" : "";
    d.style.background = c === "none" ? "var(--control)" : `var(--${c})`;
    d.title = c === "none" ? "No colour" : c;
    d.addEventListener("click", (e) => { e.stopPropagation(); closeMenu(); save(FP.recolor(state.items, it.id, c)); });
    sw.appendChild(d);
  }
  m.appendChild(sw);
  const relative = it.rel !== null && it.rel !== undefined;
  item(`${relative ? "✓ " : ""}Follows the project`, async () => {
    closeMenu();
    state.projDir = await readProject();
    const r = FP.setRelative(state.items, it.id, !relative, state.projDir);
    if (r.error) return say(r.error, "err");
    save(r.items, !relative ? `${it.label} now follows the project (${(r.items.find((i) => i.id === it.id) || {}).rel}).` : `${it.label} is a fixed folder again.`);
  });
  sep();
  const k = state.items.findIndex((i) => i.id === it.id);
  item("Move left", k > 0 ? () => { closeMenu(); save(FP.move(state.items, it.id, -1)); } : null, k > 0 ? "" : "off");
  item("Move right", k < state.items.length - 1 ? () => { closeMenu(); save(FP.move(state.items, it.id, 1)); } : null,
    k < state.items.length - 1 ? "" : "off");
  sep();
  const del = item("Delete button", () => {
    if (state.confirm !== it.id) {
      state.confirm = it.id;
      del.textContent = "Click again to delete";
      return;
    }
    state.confirm = null;
    closeMenu();
    save(FP.remove(state.items, it.id), `Removed ${it.label} (the folder is untouched).`);
  }, "danger");
  document.body.appendChild(m);
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  m.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
  m.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
  state.menu = m;
  state.confirm = null;
}

document.addEventListener("click", (e) => { if (state.menu && !state.menu.contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
window.addEventListener("blur", closeMenu);

// ---------------------------------------------------------------- drop folders from Finder / Explorer anywhere
const fromFinder = (e) => e.dataTransfer && ![...e.dataTransfer.types].includes(DRAG_TYPE);
document.addEventListener("dragover", (e) => {
  e.preventDefault();                                     // a drop must never open the folder as a page
  if (fromFinder(e)) {
    e.dataTransfer.dropEffect = "copy";
    document.body.classList.add("over");
  }
});
document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("over"); });
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("over");
  if (!fromFinder(e)) return;
  const paths = [];
  try {
    for (const f of e.dataTransfer.files || []) if (f.path) paths.push(f.path);
  } catch (err) { /* no files list */ }
  log(`drop: ${paths.length} paths ${JSON.stringify(paths).slice(0, 300)}`);
  const folders = paths.filter(isDir);
  if (!folders.length) return say(paths.length ? "Only folders get a button: drag the folder, not the files in it." : "No folder came with this drop.", "err");
  addPaths(folders, "dropped");
  if (folders.length < paths.length) say(`${$("status").textContent} Files were left out.`, "ok");
});

$("add").addEventListener("click", () => {
  try {
    const r = window.cep.fs.showOpenDialogEx(true, true, "Add folders", "");
    const picked = (r && r.data) || [];
    const plain = (p) => (/^file:/i.test(String(p)) ? decodeURI(String(p).replace(/^file:\/\/(localhost)?/i, "")) : String(p));
    if (picked.length) addPaths(picked.map(plain), "picked");
  } catch (e) {
    say(`The folder picker did not open: ${e.message || e}`, "err");
  }
});

// ---------------------------------------------------------------- start, and stay in step with the Folders tab
(async function start() {
  await pull();
  state.projDir = await readProject();
  render();
  log("opened");
  setInterval(async () => {
    if (state.renaming || state.menu) return;             // never redraw under the editor's hands
    const changed = await pull();
    // Premiere is asked for the project only when a button follows it (an ExtendScript call every few seconds otherwise)
    const dir = state.items.some((i) => i.rel !== null && i.rel !== undefined) ? await readProject() : state.projDir;
    if (changed || dir !== state.projDir) {
      state.projDir = dir;
      render();
    }
  }, POLL_MS);
})();
