// The Brand page (0.10.71): the client's brand kit inside Premiere. The client comes from the open project (a Brand Kit folder
// above it, or the kit's name in the project's name or folders: engine brandkit.detect), or the editor picks one; every asset
// is one press away: logos and graphics onto the timeline at the playhead, an outro after the last clip, a MOGRT placed, a
// colour copied or put on the selected clips, a font installed, a reference opened. The kit is read again by itself when its
// folder changes (its signature is polled while the page is open), and files dropped on the page are copied into the kit.
// Layout and controls as the other pages: cards, div buttons through onTap (Premiere paints <button> grey), no absolutely
// placed elements (UXP paints them over everything, CLAUDE.md 0.10.59), choices kept in the panel's store.
const store = require("./store.js");
const engine = require("./engine.js");
const BP = require("./brandplan.js");
const { partsOf } = require("./dropfolder.js");

const KEY = "asistent.brand";
const POLL_MS = 8000;
const THUMB_KINDS = new Set(["image", "video", "vector"]);
const CAT_HELP = {
  logos: "The client's logos. Add puts one at the playhead above everything there; Import only puts it in the bin.",
  graphics: "Mascots, icons, overlays and campaign graphics.",
  video: "Intros, outros, overlays and other reusable clips. At end puts one after the last clip (an outro).",
  audio: "Sound logos, jingles and other reusable sound.",
  presets: "MOGRTs, effect presets, LUTs and the client's subtitle style.",
  references: "Brand books, palettes, approved videos and other references: Open shows them in their own app.",
  other: "Files Asistent does not sort.",
};

function mount({ $, el, button, bindTips, premiere, hooks = {} }) {
  const root = $("paneBrand");
  const PB = require("./premiere-brand.js");
  const saved = (() => {
    try {
      return JSON.parse(store.getItem(KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  })();
  const state = {
    project: null, kits: [], detected: null, why: "", roots: [], missing: [], kitId: null, how: "none", kit: null,
    open: saved.open && typeof saved.open === "object" ? saved.open : { colors: true, logos: true, video: true },
    choice: saved.choice && typeof saved.choice === "object" ? saved.choice : {},
    addCat: typeof saved.addCat === "string" ? saved.addCat : "",
    query: "", busy: false, thumbs: {}, hex: null, controls: [], manage: false, confirmDelete: 0, expanded: null,
    loading: false, error: "", tick: 0, lastAnswer: null,
  };
  const keep = () => store.setItem(KEY, JSON.stringify({ open: state.open, choice: state.choice, addCat: state.addCat }));
  const kitName = () => (state.kit ? state.kit.name : "");
  const bin = () => BP.binName(kitName());

  // ---------------------------------------------------------------- the answer line
  const status = el("div", "kf-status");
  function say(text, cls, lines) {
    state.lastAnswer = { text, cls, lines: lines || [] };
    status.innerHTML = "";
    status.className = `kf-status${cls === "err" ? " err" : cls === "ok" ? " ok" : ""}`;
    status.appendChild(el("div", "", text || ""));
    for (const l of lines || []) status.appendChild(el("div", "bk-line", l));
    if (hooks.toast && text && cls) hooks.toast(text, cls === "ok");
  }

  async function run(label, fn) {
    if (state.busy) return;
    state.busy = true;
    say(label);
    try {
      await fn();
    } catch (e) {
      say(e && e.message ? e.message : String(e), "err");
      if (!(e instanceof premiere.UserError)) premiere.debug(`brand: ${e && e.stack ? e.stack : e}`);
    } finally {
      state.busy = false;
    }
  }

  // ---------------------------------------------------------------- loading
  async function projectPath() {
    try {
      const p = await premiere.activeProject();
      return p.path || "";
    } catch (e) {
      return null;
    }
  }

  async function loadKits(keepKit) {
    state.loading = true;
    try {
      state.project = await projectPath();
      const r = await engine.brandKits(state.project || "");
      state.kits = r.kits || [];
      state.detected = r.detected || null;
      state.why = r.why || "";
      state.roots = r.roots || [];
      state.missing = r.missing || [];
      state.error = "";
      const pick = BP.chooseKit(state.kits, state.detected, state.choice[state.project || ""]);
      state.how = pick.how;
      if (pick.id !== state.kitId || !keepKit || !state.kit) {
        state.kitId = pick.id;
        state.kit = null;
        state.hex = null;
        state.controls = [];
        if (pick.id) await loadKit();
      }
    } catch (e) {
      state.error = e && e.message ? e.message : String(e);
    } finally {
      state.loading = false;
    }
    render();
  }

  async function loadKit(sig) {
    if (!state.kitId) return false;
    const r = await engine.brandKit(state.kitId, state.project || "", sig);
    if (r.unchanged) return false;
    state.kit = r;
    return true;
  }

  // ---------------------------------------------------------------- actions on one asset
  function rowOf(a) {
    return { ...a, duration: a.duration || null };
  }

  async function act(verb, a) {
    const kid = state.kitId;
    if (verb === "show") return run(`Showing ${a.name}…`, async () => {
      await engine.brandReveal(kid, a.rel, state.project);
      say(`${a.name}: shown in ${navigatorName()}.`, "ok", a.why ? [a.why] : []);
    });
    if (verb === "open") return run(`Opening ${a.name}…`, async () => {
      await engine.brandOpen(kid, a.rel, state.project);
      say(`${a.name}: opened.`, "ok");
    });
    const label = verb === "import" ? `Importing ${a.name}…` : `Adding ${a.name}…`;
    return run(label, async () => {
      const project = await premiere.activeProject();
      const res = await engine.brandResolve(kid, a.rel, project.path);
      const extra = res.note ? [res.note] : [];
      if (verb === "import") {
        const r = await PB.importOnly(project, res.path, bin());
        say(r.imported ? `${a.name} imported into the bin "${bin()}".` : `${a.name} is already in the bin "${bin()}".`, "ok", extra);
      } else if (verb === "mogrt") {
        const r = await PB.placeMogrt(project, rowOf(a), res.path, { mode: "playhead" });
        say(`${a.name} placed on ${r.track} at ${clock(r.at)}.${r.ok ? undoText(r.steps) : ""}`, r.ok ? "ok" : "err", [...r.lines, ...extra]);
      } else {
        const r = await PB.place(project, rowOf(a), res.path, { bin: bin(), mode: verb === "end" ? "end" : "playhead" });
        say(`${a.name} on ${r.track} at ${clock(r.at)}${r.imported ? " (imported into the bin)" : ""}.${r.ok ? undoText(r.steps) : ""}`,
          r.ok ? "ok" : "err", [...r.lines, ...extra]);
      }
      bump(a);
    });
  }

  const undoText = (n) => (n > 1 ? ` ${n} Cmd/Ctrl+Z take it off (one for the added track).` : " One Cmd/Ctrl+Z takes it off.");

  function bump(a) {
    a.uses = (a.uses || 0) + 1;
    render();
  }

  async function star(a) {
    a.fav = !a.fav;
    render();
    try {
      await engine.brandFavorite(state.kitId, a.rel, a.fav);
    } catch (e) {
      a.fav = !a.fav;
      say(e.message, "err");
      render();
    }
  }

  async function copyHex(c) {
    state.hex = c.hex;
    state.controls = [];
    render();
    try {
      await engine.brandCopy(c.hex);
      say(`${c.hex} copied${c.name && c.name !== c.hex ? ` (${c.name})` : ""}.`, "ok");
    } catch (e) {
      say(`Could not copy ${c.hex}: ${e.message}`, "err");
    }
  }

  function applyHex(index = 0) {
    const hex = state.hex;
    if (!hex) return;
    run(`Putting ${hex} on the selected clips…`, async () => {
      engine.brandCopy(hex).catch(() => {});
      const project = await premiere.activeProject();
      const r = await PB.applyColor(project, hex, { index });
      state.controls = r.controls.length > 1 ? r.controls : [];
      const undo = r.steps > 1 ? ` ${r.steps} Cmd/Ctrl+Z take it back.` : r.steps === 1 ? " One Cmd/Ctrl+Z takes it back." : "";
      say(r.coloured ? `${hex} on ${r.coloured} clip${r.coloured > 1 ? "s" : ""}.${undo}` : `Nothing was coloured (${hex} is copied).`,
        r.coloured ? "ok" : "err", r.lines);
      render();
    });
  }

  function navigatorName() {
    try {
      return require("os").platform() === "win32" ? "Explorer" : "Finder";
    } catch (e) {
      return "Finder";
    }
  }

  // ---------------------------------------------------------------- drawing
  const clock = (s) => {
    const t = Math.max(0, s || 0);
    return `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
  };

  function card(cls = "") {
    const c = el("div", `kf-card bk-card${cls ? ` ${cls}` : ""}`);
    root.appendChild(c);
    return c;
  }

  function btn(label, help, fn, cls = "") {
    const b = button(`bk-b${cls ? ` ${cls}` : ""}`, label, help, () => {
      if (!state.busy) fn();
    });
    return b;
  }

  function head(parent, title, count, key, help) {
    const r = el("div", "row bk-head");
    const t = el("div", "title", title);
    if (help) t.setAttribute("data-tip", help);
    r.appendChild(t);
    if (count !== undefined) r.appendChild(el("span", "bk-count", String(count)));
    if (key) {
      const open = !!state.open[key];
      const chev = button(`more${open ? " open" : ""}`, "", open ? "Hide" : "Show", () => {
        state.open[key] = !state.open[key];
        keep();
        render();
      });
      chev.innerHTML = `<svg class="i" width="14" height="14" viewBox="0 0 24 24"><path d="${open ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"}"/></svg>`;
      r.appendChild(chev);
      t.className = "title bk-click";
      t.addEventListener("pointerdown", () => {
        state.open[key] = !state.open[key];
        keep();
        render();
      });
    }
    parent.appendChild(r);
    return r;
  }

  // with `fn` the box is a button (through onTap: logged, and ignored right after the panel changed, like every press)
  function thumbBox(a, fn, tip) {
    const box = fn ? button(`bk-th${a.kind === "video" ? " vid" : ""}`, "", tip || "", () => { if (!state.busy) fn(); })
      : el("div", `bk-th${a.kind === "video" ? " vid" : ""}`);
    const key = `${state.kitId}|${a.rel}`;
    const data = state.thumbs[key];
    if (data) {
      const img = document.createElement("img");
      img.className = "bk-img";
      img.src = data;
      img.addEventListener("error", () => {
        box.innerHTML = "";
        box.appendChild(el("span", "bk-ext", a.ext.toUpperCase()));
      });
      box.appendChild(img);
    } else {
      box.appendChild(el("span", "bk-ext", a.ext.toUpperCase()));
      if (data === undefined && THUMB_KINDS.has(a.kind)) box.setAttribute("data-thumb", a.rel);
    }
    return box;
  }

  function meta(a) {
    const bits = [`${a.fav ? "★ " : ""}${a.ext.toUpperCase()}`];
    if (a.variant) bits.push(a.variant);
    if (a.role) bits.push(a.role);
    const d = BP.duration(a.duration);
    if (d) bits.push(d);
    if (a.alts && a.alts.length) bits.push(`also ${a.alts.map((x) => x.ext.toUpperCase()).join(", ")}`);
    if (a.cached) bits.push("copy here");
    return bits.join(" · ");
  }

  function assetRow(parent, a) {
    const ac = BP.actionsFor(a);
    const row = el("div", `row bk-asset${state.expanded === a.rel ? " open" : ""}`);
    const primary = () => act(ac.primary, a);
    row.appendChild(thumbBox(a, primary, ac.why || BP.VERB_TIP[ac.primary]));
    const text = el("div", "bk-text");
    const nm = el("div", "bk-name", a.name);
    nm.setAttribute("data-tip", `${a.rel}${ac.why ? `\n${ac.why}` : ""}`);
    text.appendChild(nm);
    text.appendChild(el("div", "bk-meta", meta(a)));
    row.appendChild(text);
    const main = btn(BP.VERB[ac.primary], ac.why || BP.VERB_TIP[ac.primary], primary, ac.primary === "show" ? "" : "hot");
    row.appendChild(main);
    // the rest (and the star for Quick) under ⋯, so a narrow panel keeps room for the name
    const more = button(`more${state.expanded === a.rel ? " open" : ""}`, "", "More for this file: the other actions and Star (Quick).", () => {
      state.expanded = state.expanded === a.rel ? null : a.rel;
      render();
    });
    more.innerHTML = '<svg class="i" width="14" height="14" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>';
    row.appendChild(more);
    parent.appendChild(row);
    if (state.expanded === a.rel) {
      const r2 = el("div", "row wrap bk-more");
      for (const v of ac.more) r2.appendChild(btn(BP.VERB[v], BP.VERB_TIP[v], () => act(v, a)));
      r2.appendChild(btn(a.fav ? "★ Unstar" : "☆ Star", a.fav ? "Takes it off the Quick row." : "Puts it on the Quick row at the top (one press).", () => star(a), a.fav ? "on" : ""));
      parent.appendChild(r2);
    }
  }

  function renderTop() {
    const c = card("bk-top");
    const r = el("div", "row bk-pick");
    const sel = document.createElement("select");
    sel.id = "brandKit";
    const det = state.kits.find((k) => k.id === state.detected);
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = det ? `Auto: ${det.name}` : "Auto (none found)";
    sel.appendChild(auto);
    for (const k of state.kits) {
      const o = document.createElement("option");
      o.value = k.id;
      o.textContent = `${k.name}${k.online ? "" : " (offline)"}${k.source === "project" ? " · project" : ""}`;
      sel.appendChild(o);
    }
    sel.value = state.how === "chosen" ? state.kitId || "" : "";
    sel.addEventListener("change", () => {
      const key = state.project || "";
      if (sel.value) state.choice[key] = sel.value;
      else delete state.choice[key];
      keep();
      state.kit = null;
      loadKits(false);
    });
    r.appendChild(sel);
    const refresh = btn("↻", "Reads the kits again (a kit also refreshes by itself when its files change).", () => {
      state.thumbs = {};
      loadKits(false).then(() => say("Read again.", "ok"));
    }, "icon");
    r.appendChild(refresh);
    r.appendChild(btn(state.manage ? "Done" : "Manage", "Create, rename, duplicate or delete kits, add files and colours, choose where kits are.", () => {
      state.manage = !state.manage;
      state.confirmDelete = 0;
      render();
    }, state.manage ? "on" : ""));
    c.appendChild(r);
    const line = el("div", "bk-status");
    const k = state.kit;
    if (state.error) {
      line.textContent = `Asistent could not read the kits: ${state.error}`;
      line.className = "bk-status err";
    } else if (state.project === null) {
      line.textContent = "Open a project in Premiere.";
    } else if (!state.kits.length) {
      line.textContent = state.roots.length ? "No kits in the library folder yet: create one in Manage." : "No kits yet: choose where they are in Manage (Library folder…).";
    } else if (!state.kitId) {
      line.textContent = "No kit matches this project: choose the client above (remembered for this project).";
    } else if (k) {
      const how = state.how === "chosen" ? "chosen for this project" : `found from ${state.why}`;
      line.textContent = `${how}${k.online ? "" : " · offline copy"}${k.remote ? " · on the server" : ""}`;
      line.setAttribute("data-tip", `${k.folder}\nRead ${k.read_at}${k.status ? `\nStatus: ${k.status}` : ""}`);
      if (!k.online && k.note) {
        c.appendChild(line);
        c.appendChild(el("div", "warn bk-warn", k.note));
        return;
      }
    } else if (state.loading) {
      line.textContent = "Reading…";
    }
    c.appendChild(line);
    for (const m of state.missing) c.appendChild(el("div", "warn bk-warn", `Not reachable: ${m}`));
    if (k) {
      const s = document.createElement("input");
      s.id = "brandSearch";
      s.className = "bk-search";
      s.placeholder = "Search the kit";
      s.value = state.query;
      s.setAttribute("data-tip", "Type part of a name (logo white, outro, mascot): only matching files stay.");
      s.addEventListener("input", () => {
        state.query = s.value;
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => render(true), 250);
      });
      c.appendChild(s);
    }
  }

  function renderQuick(k) {
    const list = BP.quick(k);
    if (!list.length || state.query) return;
    const c = card();
    head(c, "Quick", undefined, null, "Your starred files first, then the ones used most on this computer: one press puts each at the playhead.");
    const r = el("div", "row wrap bk-quick");
    for (const a of list) {
      const ac = BP.actionsFor(a);
      const t = button("bk-tile", "", `${a.name}: ${ac.why || BP.VERB_TIP[ac.primary]}`, () => { if (!state.busy) act(ac.primary, a); });
      t.appendChild(thumbBox(a));
      t.appendChild(el("div", "bk-tname", a.name));
      r.appendChild(t);
    }
    c.appendChild(r);
  }

  function renderColors(k) {
    if (!k.colors || !k.colors.length || state.query) return;
    const c = card();
    head(c, "Colours", k.colors.reduce((n, g) => n + g.items.length, 0), "colors",
      "Click a colour to copy its HEX. Then Apply puts it on the selected clips: a logo or graphic file gets a Tint, a MOGRT gets it in its colour control.");
    if (!state.open.colors) return;
    for (const g of k.colors) {
      c.appendChild(el("div", "bk-group", g.group));
      const r = el("div", "row wrap bk-swatches");
      for (const it of g.items) {
        const sw = button(`bk-sw${state.hex === it.hex ? " on" : ""}`, "",
          `${it.hex}${it.name && it.name !== it.hex ? ` · ${it.name}` : ""}${it.note ? `\n${it.note}` : ""}\nClick to copy.`, () => copyHex(it));
        sw.style.backgroundColor = it.hex;
        const lab = el("div", "bk-hex", it.hex.slice(1));
        lab.style.color = BP.textOn(it.hex);
        sw.appendChild(lab);
        r.appendChild(sw);
      }
      c.appendChild(r);
    }
    if (state.hex) {
      const r = el("div", "row wrap bk-apply");
      const chip = el("div", "bk-chip");
      chip.style.backgroundColor = state.hex;
      r.appendChild(chip);
      r.appendChild(el("span", "bk-applyhex", state.hex));
      r.appendChild(btn("Apply to selected", "Puts this colour on the clips selected in the timeline.\nLogos and graphic files: a Tint, the whole picture in this colour, transparency kept.\nText made in Premiere: a Tint, white letters in exactly this colour, a dark outline or shadow stays dark.\nMOGRTs: their first colour control; the others appear as buttons after the first press.\nCaptions on a caption track cannot be coloured: the HEX is copied for Properties.", () => applyHex(0), "hot"));
      c.appendChild(r);
      if (state.controls.length) {
        const r2 = el("div", "row wrap bk-more");
        r2.appendChild(el("span", "muted bk-ctl", "Into:"));
        state.controls.forEach((name, i) => r2.appendChild(btn(name, `Put ${state.hex} into the MOGRT's "${name}" instead.`, () => applyHex(i))));
        c.appendChild(r2);
      }
    }
  }

  function renderCategory(k, cat) {
    const all = (k.assets && k.assets[cat]) || [];
    const list = BP.filter(all, state.query);
    if (!list.length) return;
    const c = card();
    head(c, BP.LABELS[cat], list.length, state.query ? null : cat, CAT_HELP[cat]);
    if (!state.open[cat] && !state.query) return;
    for (const a of list) assetRow(c, a);
  }

  function renderPresets(k) {
    const list = BP.filter((k.assets && k.assets.presets) || [], state.query);
    const values = hooks.subtitleValues ? hooks.subtitleValues() : [];
    const preset = BP.presetFor(k, values);
    if (!list.length && !preset && !(k.subtitle && k.subtitle.name)) return;
    const c = card();
    head(c, "Presets", list.length + (k.subtitle && k.subtitle.name ? 1 : 0), state.query ? null : "presets", CAT_HELP.presets);
    if (!state.open.presets && !state.query) return;
    if (k.subtitle && k.subtitle.name) {
      const r = el("div", "row bk-asset");
      const box = el("div", "bk-th");
      box.appendChild(el("span", "bk-ext", "CC"));
      r.appendChild(box);
      const t = el("div", "bk-text");
      t.appendChild(el("div", "bk-name", `Subtitles: ${k.subtitle.name}`));
      t.appendChild(el("div", "bk-meta", [k.subtitle.font, k.subtitle.case].filter(Boolean).join(" · ") || "Asistent's subtitle style"));
      r.appendChild(t);
      if (preset) {
        r.appendChild(btn("Use", "Sets Tools > Subtitles > Style to this client's measured style (Make subtitles then cuts and times the lines like the client's videos).", () => {
          const ok = hooks.setSubtitleStyle && hooks.setSubtitleStyle(preset);
          say(ok ? `Subtitles will use the ${k.subtitle.name} style (Tools > Subtitles).` : "The Subtitles row has no such style.", ok ? "ok" : "err");
        }, "hot"));
      } else {
        r.appendChild(el("span", "muted bk-note", "no Asistent style yet"));
      }
      c.appendChild(r);
    }
    for (const a of list) assetRow(c, a);
  }

  function renderFonts(k) {
    const list = (k.fonts || []).filter((f) => !state.query || BP.filter([{ name: f.family, rel: f.family, ext: "" }], state.query).length);
    if (!list.length) return;
    const c = card();
    head(c, "Fonts", list.length, state.query ? null : "fonts", "The client's fonts: Install copies the kit's TTF / OTF into your fonts (Premiere sees them after a restart); Copy puts the name on the clipboard for Essential Graphics.");
    if (!state.open.fonts && !state.query) return;
    for (const f of list) {
      const r = el("div", "row bk-asset");
      const box = el("div", "bk-th");
      box.appendChild(el("span", "bk-ext bk-aa", "Aa"));
      r.appendChild(box);
      const t = el("div", "bk-text");
      t.appendChild(el("div", "bk-name", f.family));
      const usable = f.files.filter((x) => x.usable);
      const styles = [...new Set(f.files.map((x) => x.style))].slice(0, 6).join(", ");
      const st = f.installed === "yes" ? "installed" : f.installed === "partly" ? "partly installed"
        : !f.files.length ? "not in the kit" : !usable.length ? "web font only" : "not installed";
      const m = el("div", `bk-meta${f.installed === "yes" ? " ok" : ""}`, [f.role, st, styles].filter(Boolean).join(" · "));
      if (f.missing) m.setAttribute("data-tip", f.missing);
      t.appendChild(m);
      r.appendChild(t);
      if (usable.length && f.installed !== "yes") {
        r.appendChild(btn("Install", "Copies the kit's TTF / OTF files of this family into your fonts (no admin rights). Premiere shows a new font after it restarts.", () => run(`Installing ${f.family}…`, async () => {
          const res = await engine.brandFont(state.kitId, f.family, state.project);
          say(res.msg, "ok");
          await loadKit();
          render();
        }), "hot"));
      }
      r.appendChild(btn("Copy", "Copies the font's name, to paste in Essential Graphics or the Properties panel.", () => run("Copying…", async () => {
        await engine.brandCopy(f.family);
        say(`"${f.family}" copied.`, "ok");
      })));
      c.appendChild(r);
    }
  }

  function renderNotes(k) {
    if (!k.notes || !k.notes.length || state.query) return;
    const c = card();
    head(c, "Notes", k.notes.length, "notes", "The editing rules from the kit's brand.json.");
    if (!state.open.notes) return;
    for (const n of k.notes) c.appendChild(el("div", "bk-noteline", n));
  }

  function field(parent, id, placeholder, value) {
    const i = document.createElement("input");
    i.id = id;
    i.className = "bk-field";
    i.placeholder = placeholder;
    i.value = value || "";
    parent.appendChild(i);
    return i;
  }

  function manageAction(label, action, body, after) {
    return run(label, async () => {
      const r = await engine.brandManage(action, { ...body, project: state.project });
      if (after) await after(r);
      await loadKits(true);
    });
  }

  async function pickFolder() {
    const fs = require("uxp").storage.localFileSystem;
    const f = await fs.getFolder();
    return f ? f.nativePath : null;
  }

  async function addPaths(paths) {
    if (!state.kitId || !paths.length) return;
    await run(`Copying ${paths.length} file${paths.length > 1 ? "s" : ""} into ${kitName()}…`, async () => {
      const r = await engine.brandAdd(state.kitId, paths, state.addCat, state.project);
      for (let i = 0; i < 1200; i++) {
        const j = await engine.job(r.job);
        if (j.state === "done") {
          const n = (j.result && j.result.added) || [];
          say(`${n.length} file${n.length !== 1 ? "s" : ""} copied into ${kitName()}.`, "ok", n.slice(0, 8));
          break;
        }
        if (j.state === "error" || j.state === "cancelled") throw new Error(j.error || j.message || "Copying stopped.");
        status.firstChild.textContent = j.message || "Copying…";
        await new Promise((res) => setTimeout(res, 400));
      }
      await loadKit();
      render();
    });
  }

  function labelled(text, tip) {
    const r = el("div", "row bk-form");
    const l = el("span", "bk-flabel", text);
    if (tip) l.setAttribute("data-tip", tip);
    r.appendChild(l);
    return r;
  }

  function renderManage(k) {
    if (!state.manage) return;
    const c = card("bk-manage");
    head(c, "Manage", undefined, null, "Changes made here go into the kit's folder (asistent-kit.json and its files), so everyone using that folder sees them. brand.json is never rewritten.");
    if (k) {
      c.appendChild(el("div", "bk-group", `This kit: ${k.name}`));
      let r = labelled("Name");
      const nm = field(r, "brandRename", "Name", k.name);
      r.appendChild(btn("Rename", "Changes the name shown in Asistent (the folder keeps its name).", () => manageAction("Renaming…", "rename", { id: k.id, name: nm.value })));
      c.appendChild(r);
      r = labelled("Also", "Other names of this client in project files and folders.");
      const al = field(r, "brandAliases", "Other names, comma between", (k.aliases || []).join(", "));
      al.setAttribute("data-tip", "Names in project files and folders that mean this client (Dr.Denkov for ReShape): the kit is found from them.");
      r.appendChild(btn("Save", "Saves the other names.", () => manageAction("Saving…", "aliases", { id: k.id, aliases: al.value.split(",") })));
      c.appendChild(r);
      r = labelled("Colour");
      const cn = field(r, "brandColorName", "Name", "");
      const ch = field(r, "brandColorHex", "#RRGGBB", "");
      ch.className = "bk-field bk-hexin";
      r.appendChild(btn("Add", "Adds a colour to the kit (group Added).", () => manageAction("Adding the colour…", "color_add", { id: k.id, name: cn.value, hex: ch.value })));
      c.appendChild(r);
      if (state.hex) {
        r = el("div", "row bk-form");
        r.appendChild(btn(`Hide ${state.hex}`, "Takes the chosen colour out of this kit's list (a colour from brand.json is only hidden; the file is not changed).", () => manageAction("Hiding…", "color_remove", { id: k.id, hex: state.hex })));
        c.appendChild(r);
      }
      const values = hooks.subtitleValues ? hooks.subtitleValues() : [];
      if (values.length) {
        r = labelled("Subtitles");
        const s = document.createElement("select");
        s.id = "brandSubtitle";
        for (const v of ["", ...values.filter((x) => x !== "auto")]) {
          const o = document.createElement("option");
          o.value = v;
          o.textContent = v ? (hooks.subtitleLabel ? hooks.subtitleLabel(v) : v) : "None";
          s.appendChild(o);
        }
        s.value = values.includes(k.subtitle && k.subtitle.preset) ? k.subtitle.preset : "";
        r.appendChild(s);
        r.appendChild(btn("Save", "Which of Asistent's subtitle styles belongs to this client (Presets > Subtitles > Use).", () => manageAction("Saving…", "subtitle", { id: k.id, preset: s.value })));
        c.appendChild(r);
      }
      r = labelled("Files");
      const cat = document.createElement("select");
      cat.id = "brandAddCat";
      for (const [v, l] of [["", "Sort by type"], ...BP.ORDER.map((x) => [x, BP.LABELS[x]]), ["fonts", "Fonts"]]) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = l;
        cat.appendChild(o);
      }
      cat.value = state.addCat;
      cat.setAttribute("data-tip", "Where added files go. Sort by type: by the file (fonts, MOGRTs, videos, pictures).");
      cat.addEventListener("change", () => {
        state.addCat = cat.value;
        keep();
      });
      r.appendChild(cat);
      r.appendChild(btn("Add files…", "Copies the files you pick into this kit (also: drop files from Finder / Explorer anywhere on this page). Nothing is moved.", async () => {
        try {
          const fs = require("uxp").storage.localFileSystem;
          const files = await fs.getFileForOpening({ allowMultiple: true });
          const paths = (Array.isArray(files) ? files : files ? [files] : []).map((f) => f.nativePath).filter(Boolean);
          if (paths.length) addPaths(paths);
        } catch (e) {
          say(e.message, "err");
        }
      }));
      c.appendChild(r);
      r = labelled("Copy");
      const dn = field(r, "brandDupName", "Name of the copy", `${k.name} copy`);
      r.appendChild(btn("Duplicate", "Copies the whole kit folder under the new name, next to it.", () => manageAction("Duplicating…", "duplicate", { id: k.id, name: dn.value }, async (res) => {
        state.choice[state.project || ""] = res.id;
        keep();
      })));
      c.appendChild(r);
      r = el("div", "row wrap bk-form");
      r.appendChild(btn("Show folder", "Shows the kit's folder in Finder / Explorer.", () => run("Showing…", async () => {
        await engine.brandReveal(k.id, "", state.project);
        say("Shown.", "ok");
      })));
      if (k.deletable) {
        const armed = Date.now() - state.confirmDelete < 5000;
        r.appendChild(btn(armed ? "Press again to delete" : "Delete kit", "Moves the kit's folder into \"_Deleted kits\" in the same library (nothing is erased; move it back to restore). Press twice.", () => {
          if (!armed) {
            state.confirmDelete = Date.now();
            render();
            return;
          }
          state.confirmDelete = 0;
          manageAction("Deleting…", "delete", { id: k.id }, async (res) => {
            delete state.choice[state.project || ""];
            keep();
            say(`Moved to ${res.moved_to}.`, "ok");
          });
        }, armed ? "danger" : ""));
      } else if (state.kits.find((x) => x.id === k.id && x.source === "folder")) {
        r.appendChild(btn("Forget folder", "Asistent stops showing this folder as a kit; its files stay where they are.", () => manageAction("Forgetting…", "forget", { id: k.id }, async () => {
          delete state.choice[state.project || ""];
          keep();
        })));
      }
      c.appendChild(r);
    }
    c.appendChild(el("div", "bk-group", "Kits"));
    let r = labelled("New");
    const nn = field(r, "brandNewName", "Client name", "");
    r.appendChild(btn("Create", "Makes a new kit folder (with logo, fonts, video, graphics, presets and reference folders) in the first library folder.", () => manageAction("Creating…", "create", { name: nn.value }, async (res) => {
      state.choice[state.project || ""] = res.id;
      keep();
    })));
    c.appendChild(r);
    r = el("div", "row wrap bk-form");
    r.appendChild(btn("Library folder…", "The folder that holds one sub-folder per client (on the office server, or Content Studio's brand-kits). New kits are made in the first one.", async () => {
      const p = await pickFolder();
      if (p) manageAction("Adding the library…", "set_root", { path: p });
    }));
    r.appendChild(btn("Client folder…", "One client's kit anywhere (for example its Brand Kit folder on the server): added as a kit of its own.", async () => {
      const p = await pickFolder();
      if (p) manageAction("Adding the folder…", "add_folder", { path: p }, async (res) => {
        state.choice[state.project || ""] = res.id;
        keep();
      });
    }));
    c.appendChild(r);
    for (const p of state.roots) {
      const rr = el("div", "row bk-root");
      rr.appendChild(el("div", "bk-path", p));
      rr.appendChild(btn("Remove", "Stops reading this library folder (nothing in it is touched).", () => manageAction("Removing…", "remove_root", { path: p }), "icon"));
      c.appendChild(rr);
    }
  }

  function render(keepFocus) {
    const app = $("app");
    const top = app ? app.scrollTop : 0;
    const focus = keepFocus && document.activeElement && document.activeElement.id;
    root.innerHTML = "";
    renderTop();
    const k = state.kit;
    renderManage(k);                                          // right under the picker: it opens where it was asked for
    if (k) {
      renderQuick(k);
      renderColors(k);
      for (const cat of ["logos", "graphics", "video", "audio"]) renderCategory(k, cat);
      renderFonts(k);
      renderPresets(k);
      renderCategory(k, "references");
      renderCategory(k, "other");
      renderNotes(k);
      const total = Object.values(k.counts || {}).reduce((n, v) => n + v, 0) + (k.colors || []).length;
      if (!total) card().appendChild(el("div", "muted", "This kit is empty: add files in Manage, or drop them here."));
      else if (state.query && !root.querySelector(".bk-asset")) card().appendChild(el("div", "muted", "Nothing in the kit matches."));
    }
    root.appendChild(status);
    root.appendChild(el("div", "bk-drop", state.kit ? "Drop files here to copy them into the kit." : ""));
    bindTips(root);
    if (app) app.scrollTop = top;
    if (focus && $(focus)) {
      try {
        $(focus).focus();
      } catch (e) { /* not focusable */ }
    }
    loadThumbs();
  }

  // thumbnails: asked for the files on screen, in batches, kept per kit and file
  async function loadThumbs() {
    if (state.thumbsBusy || !state.kitId) return;
    const want = [...root.querySelectorAll("[data-thumb]")].map((n) => n.getAttribute("data-thumb"));
    const rels = [...new Set(want)].filter((r) => state.thumbs[`${state.kitId}|${r}`] === undefined).slice(0, 30);
    if (!rels.length) return;
    state.thumbsBusy = true;
    const kid = state.kitId;
    try {
      const r = await engine.brandThumbs(kid, rels, state.project);
      for (const rel of rels) state.thumbs[`${kid}|${rel}`] = (r.thumbs || {})[rel] || null;
    } catch (e) {
      for (const rel of rels) state.thumbs[`${kid}|${rel}`] = null;
    } finally {
      state.thumbsBusy = false;
    }
    if (kid === state.kitId && !state.busy) render(true);
  }

  // ---------------------------------------------------------------- drop files on the page
  const on = (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (state.kit && !/ dropping\b/.test(` ${root.className}`)) root.className = `${root.className} dropping`;
  };
  const off = () => { root.className = root.className.replace(/\s*dropping\b/g, ""); };
  root.addEventListener("dragenter", on);
  root.addEventListener("dragover", on);
  root.addEventListener("dragleave", off);
  root.addEventListener("drop", (e) => {
    e.preventDefault();
    off();
    const parts = partsOf(e);
    const paths = BP.droppedPaths(parts);
    premiere.debug(`brand drop: ${parts.note} -> ${paths.length} paths`);
    if (!state.kit) return say("Choose a kit first, then drop the files.", "err");
    if (!paths.length) return say("Premiere did not pass the dropped files to the panel: use Manage > Add files….", "err");
    addPaths(paths);
  });

  // ---------------------------------------------------------------- keeping up to date
  async function tick() {
    if (root.hidden || state.busy || state.loading) return;
    state.tick++;
    const p = await projectPath();
    if (p !== state.project) {
      if (hooks.settle) hooks.settle();
      return loadKits(false);
    }
    if (state.tick % 4 === 0) return loadKits(true);
    if (!state.kit || !state.kit.online) return;
    try {
      if (await loadKit(state.kit.sig)) {
        if (hooks.settle) hooks.settle();
        render(true);
      }
    } catch (e) {
      loadKits(true);
    }
  }
  setInterval(() => { tick().catch(() => {}); }, POLL_MS);

  render();
  return {
    shown: () => loadKits(true),
    info: () => ({ project: state.project, kits: state.kits.map((k) => k.name), detected: state.detected, why: state.why, how: state.how,
      kit: state.kit && { name: state.kit.name, online: state.kit.online, counts: state.kit.counts, sig: state.kit.sig },
      busy: state.busy, answer: state.lastAnswer }),
    act: async (verb, rel) => {
      const k = state.kit;
      const a = k && Object.values(k.assets).flat().find((x) => x.rel === rel);
      if (!a) throw new Error(`No asset ${rel}`);
      await act(verb, a);
      return state.lastAnswer;
    },
    choose: async (nameOrId) => {                       // the test bridge: pick a kit for this project, as the dropdown does
      const k = state.kits.find((x) => x.id === nameOrId || x.name === nameOrId) || (await loadKits(true), state.kits.find((x) => x.id === nameOrId || x.name === nameOrId));
      if (!k) throw new Error(`No kit ${nameOrId}`);
      state.choice[state.project || ""] = k.id;
      keep();
      await loadKits(false);
      return { kit: state.kit && state.kit.name, counts: state.kit && state.kit.counts };
    },
    color: async (hex, index = 0) => {
      state.hex = hex;
      applyHex(index);
      while (state.busy) await new Promise((r) => setTimeout(r, 200));
      return state.lastAnswer;
    },
    demo: (s) => {                                         // browser preview only
      Object.assign(state, s);
      render();
    },
  };
}

module.exports = { mount };
