// The Folders page (0.10.144, the user 2026-11-22): favourite folders as buttons inside Premiere; a press opens the folder in
// Finder / Explorer (through the engine: UXP cannot). Folders come in by a drop from Finder / Explorer or "Add folder…"; Edit
// renames, colours, moves, deletes and switches "follows the project" (the path counted from the open project's folder, so
// one button opens each project's own folder). Read only: nothing in Premiere, nothing in the folders is changed. The list is
// kept in the panel's store (engine-backed, survives updates). Rules in folderplan.js (pure). Layout as the other pages:
// div buttons through onTap, no absolutely placed elements, no right-click menu (Premiere's UXP gives a panel none).
const store = require("./store.js");
const engine = require("./engine.js");
const FP = require("./folderplan.js");
const { partsOf } = require("./dropfolder.js");
const { droppedPaths } = require("./brandplan.js");

const KEY = "asistent.folders";
const CONFIRM_MS = 5000;

function mount({ $, el, button, enable, bindTips, premiere }) {
  const root = $("paneFolders");
  const state = { items: FP.load(store.getItem(KEY)), edit: false, projDir: null, exist: {}, confirm: { id: null, at: 0 }, busy: false };
  const app = (() => {
    try {
      return require("os").platform() === "win32" ? "Explorer" : "Finder";
    } catch (e) {
      return "Finder";
    }
  })();
  const keep = () => store.setItem(KEY, FP.save(state.items));
  const debug = (m) => {
    try {
      engine.log("info", m);
    } catch (e) { /* the log is best effort */ }
  };

  // ---------------------------------------------------------------- the answer line
  const status = el("div", "kf-status");
  function say(text, cls) {
    status.innerHTML = "";
    status.className = `kf-status${cls === "err" ? " err" : cls === "ok" ? " ok" : ""}`;
    if (text) status.appendChild(el("div", "", text));
  }

  async function projectDir() {
    try {
      const p = await premiere.activeProject();
      state.projDir = FP.projectDir(p && p.path);
    } catch (e) {
      state.projDir = null;
    }
    return state.projDir;
  }

  // which saved folders are there now (a gone or unmounted one is dimmed, its press says why)
  async function checkExist() {
    const paths = state.items.map((i) => FP.resolve(i, state.projDir)).filter(Boolean);
    if (!paths.length) return;
    try {
      const r = await engine.foldersExist(paths);
      const map = {};
      paths.forEach((p, k) => { map[p] = !!(r.exist || [])[k]; });
      state.exist = map;
      render();
    } catch (e) { /* the engine is away: nothing dimmed */ }
  }

  function change(items, text, cls) {
    state.items = items;
    keep();
    render();
    if (text !== undefined) say(text, cls);
    checkExist();
  }

  function addPaths(paths, how) {
    const r = FP.add(state.items, paths);
    const bits = [];
    if (r.added.length) bits.push(`Added ${r.added.join(", ")}.`);
    if (r.already.length) bits.push(`Already here: ${r.already.join(", ")}.`);
    debug(`folders: ${how}: ${paths.length} paths, added ${r.added.length}`);
    change(r.items, bits.join(" ") || "Nothing to add.", r.added.length ? "ok" : "");
  }

  async function open(item) {
    if (state.busy) return;
    state.busy = true;
    try {
      await projectDir();
      const where = FP.resolve(item, state.projDir);
      if (!where) {
        say(`${item.label} follows the project: open a saved project first.`, "err");
        return;
      }
      await engine.folderOpen(where);
      say(`Opened ${item.label} in ${app}.`, "ok");
    } catch (e) {
      say(e && e.message ? e.message : String(e), "err");
    } finally {
      state.busy = false;
    }
  }

  // ---------------------------------------------------------------- drawing
  function swatch(item, color) {
    const s = button(`fd-sw fd-c-${color}${item.color === color ? " on" : ""}`, "", color === "none" ? "No colour." : `Colour: ${color}.`,
      () => change(FP.recolor(state.items, item.id, color)));
    return s;
  }

  function editRow(item, k) {
    const row = el("div", "fd-edit");
    const top = el("div", "fd-line");
    const name = document.createElement("input");
    name.type = "text";
    name.className = "fd-name";
    name.value = item.label;
    name.maxLength = FP.LABEL_MAX;
    name.setAttribute("data-tip", "The button's name (the folder keeps its own).");
    const rename = () => {
      if (name.value.trim() !== item.label) change(FP.rename(state.items, item.id, name.value));
    };
    name.addEventListener("change", rename);
    name.addEventListener("blur", rename);
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") rename();
    });
    top.appendChild(name);
    const up = button("small", "↑", "One place up.", () => change(FP.move(state.items, item.id, -1)));
    const down = button("small", "↓", "One place down.", () => change(FP.move(state.items, item.id, 1)));
    enable(up, k > 0);                                        // the ends: nothing to move past (a press there changes nothing anyway)
    enable(down, k < state.items.length - 1);
    top.appendChild(up);
    top.appendChild(down);
    const armed = state.confirm.id === item.id && Date.now() - state.confirm.at < CONFIRM_MS;
    top.appendChild(button(`small${armed ? " danger" : ""}`, armed ? "Press again to delete" : "Delete",
      armed ? "Press again to take this button away (the folder itself is not touched)." : "Takes the button away; the folder stays where it is.", () => {
        if (state.confirm.id === item.id && Date.now() - state.confirm.at < CONFIRM_MS) {
          state.confirm = { id: null, at: 0 };
          change(FP.remove(state.items, item.id), `Removed ${item.label} (the folder is untouched).`);
        } else {
          state.confirm = { id: item.id, at: Date.now() };
          render();
          setTimeout(() => { if (state.confirm.id === item.id) { state.confirm = { id: null, at: 0 }; render(); } }, CONFIRM_MS + 50);
        }
      }));
    row.appendChild(top);

    const colours = el("div", "fd-line fd-colors");
    for (const c of FP.COLORS) colours.appendChild(swatch(item, c));
    row.appendChild(colours);

    const rel = el("div", "fd-line fd-rel");
    const relative = item.rel !== null && item.rel !== undefined;
    const sw = button(`small sw${relative ? " on" : ""}`, "", "Follows the project: the folder is counted from the open project's folder, so the button opens each project's own one.", async () => {
      await projectDir();
      const r = FP.setRelative(state.items, item.id, !relative, state.projDir);
      if (r.error) return say(r.error, "err");
      change(r.items, !relative ? `${item.label} now follows the project (${(r.items.find((i) => i.id === item.id) || {}).rel}).` : `${item.label} is a fixed folder again.`);
    });
    sw.appendChild(el("div", "knob"));
    rel.appendChild(sw);
    rel.appendChild(el("div", "muted fd-small", relative ? `Follows the project: ${item.rel}` : "Follows the project"));
    row.appendChild(rel);
    row.appendChild(el("div", "muted fd-path", FP.resolve(item, state.projDir) || `${item.rel} (no saved project open)`));
    return row;
  }

  function render() {
    root.innerHTML = "";
    const card = el("div", "card");
    const head = el("div", "cardhead");
    head.appendChild(el("div", "title fd-title", "Folders"));
    head.appendChild(button("small", "Add folder…", `Pick a folder: it gets a button that opens it in ${app}.`, async () => {
      try {
        const f = await require("./premiere-import.js").pickFolder();
        if (f) addPaths([f], "picked");
      } catch (e) {
        say(e && e.message ? e.message : String(e), "err");
      }
    }));
    if (state.items.length) {
      head.appendChild(button(`small${state.edit ? " on" : ""}`, state.edit ? "Done" : "Edit", state.edit ? "Back to the buttons." : "Rename, colour, move, delete, or make a folder follow the project.", () => {
        state.edit = !state.edit;
        state.confirm = { id: null, at: 0 };
        render();
      }));
    }
    card.appendChild(head);

    if (!state.items.length) {
      card.appendChild(el("div", "muted", `No folders yet. Press Add folder… to pick one, or drag folders from ${app} onto the Asistent Folders panel (Window > Extensions): each folder becomes a button that opens it in ${app}, here and there.`));
    } else if (state.edit) {
      state.items.forEach((it, k) => card.appendChild(editRow(it, k)));
    } else {
      const grid = el("div", "fd-grid");
      for (const it of state.items) {
        const where = FP.resolve(it, state.projDir);
        const gone = where && state.exist[where] === false;
        const b = button(`fd-btn fd-c-${it.color}${gone || !where ? " missing" : ""}`, it.label,
          gone ? `${where}\nNot there now (moved, renamed or the drive is not mounted).` : FP.tip(it, state.projDir) || it.label, () => open(it));
        grid.appendChild(b);
      }
      card.appendChild(grid);
    }
    card.appendChild(status);
    root.appendChild(card);
    if (bindTips) bindTips(root);
  }

  // ---------------------------------------------------------------- drop folders on the page
  const on = (e) => {
    try {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    } catch (err) { /* read-only in some hosts */ }
    if (!/ dropping\b/.test(` ${root.className}`)) root.className = `${root.className} dropping`;
  };
  const off = () => { root.className = root.className.replace(/\s*dropping\b/g, ""); };
  root.addEventListener("dragenter", on);
  root.addEventListener("dragover", on);
  root.addEventListener("dragleave", off);
  root.addEventListener("drop", async (e) => {
    try {
      e.preventDefault();
    } catch (err) { /* nothing to prevent */ }
    off();
    const parts = partsOf(e);
    const paths = droppedPaths(parts);
    debug(`folders drop: ${parts.note} -> ${paths.length} paths`);
    if (!paths.length) {
      // measured 2026-11-22 (Premiere 2026): a drag from Finder reaches a UXP panel empty (no files, links or text)
      say("Premiere does not hand dragged folders to this panel: drag them onto the Asistent Folders panel (Window > Extensions), or use Add folder….", "err");
      return;
    }
    let exist = [];
    try {
      exist = (await engine.foldersExist(paths)).exist || [];
    } catch (err) {
      say(err && err.message ? err.message : String(err), "err");
      return;
    }
    const folders = paths.filter((p, k) => exist[k]);
    if (!folders.length) {
      say("Only folders can be added: drop the folder, not the files in it.", "err");
      return;
    }
    addPaths(folders, "dropped");
    if (folders.length < paths.length) say(`${status.textContent} Files were left out: only folders get a button.`, "ok");
  });

  render();
  return {
    async shown() {
      // the list is shared with the Asistent Folders panel (CEP, 0.10.145), which writes the engine's store directly: read it fresh
      try {
        const fresh = ((await engine.panelStore()).values || {})[KEY];
        if (typeof fresh === "string" && fresh !== store.getItem(KEY)) store.setItem(KEY, fresh);
      } catch (e) { /* offline: the copy in memory */ }
      state.items = FP.load(store.getItem(KEY));
      await projectDir();
      render();
      checkExist();
    },
    state: () => ({ items: state.items, edit: state.edit, projDir: state.projDir }),
  };
}

module.exports = { mount };
