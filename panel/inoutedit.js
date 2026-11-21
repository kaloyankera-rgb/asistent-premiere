// The In & Out curve editor (docs/IN_OUT_PLAN.md Phase 5, step 5): press "Curves" on the page, reshape the curve of each property of the
// picked preset on a graph, and save the result as a preset of your own. Two halves:
//   * the pure part (Node-tested): what an edit, a reset and a save make of the page's drafts (state.drafts[side]), the spec handed to
//     inoutplan.setDraft, and what Save sends to inoutpresets.added;
//   * mount(): the editor's DOM and the store reads / writes of Save, Rename and Delete.
// It never reaches Premiere (nothing is applied from here: Apply and Remove stay the page's only writes), it has
// no timer, and it creates no SVG node: the one graph is mounted ONCE by curvegraph.js (a fixed pool, the 0.10.130 crash) and is reused
// for every property and side through graph.set().
const I = require("./inoutplan.js");
const U = require("./inoutui.js");
const P = require("./inoutpresets.js");
const K = require("./keyframeplan.js");

const PROPS = I.PROP_NAMES;                              // the page's order: pos, scale, rot, op
const GRAPH_W = 208;
const GRAPH_H = 160;
const HINT = "Add · drag · double press removes";
const HINT_TIP = "Press empty space on the graph to add a point. Drag a point to move it. Press a point twice quickly to remove it. " +
  "Alt + press makes a point a sharp corner (again: smooth). The preview above plays your edit; nothing is written to the clip until you press Apply.";
const NO_EDIT = "Nothing to edit: every motion of this preset has several steps, which one curve cannot replace.";

const sideOf = (side) => (side === "out" ? "out" : "in");
const copyPts = (pts) => pts.map((q) => q.slice());
const copyCurves = (curves) => {
  const out = {};
  for (const [prop, c] of Object.entries(curves || {})) out[prop] = { pts: copyPts(c.pts) };
  return out;
};
// two sets of curves are the same when they name the same properties with the same points (the order they were made in does not matter)
const sameCurves = (a, b) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && JSON.stringify(a[k].pts) === JSON.stringify(b[k].pts));
};

// ---------------------------------------------------------------- pure
/** the state's drafts, both empty, and the registry told so (the page's start, and the stored choices read again) */
function clearDrafts(state) {
  state.drafts = { in: null, out: null };
  I.setDraft("in", null);
  I.setDraft("out", null);
}

const pickOf = (state, side) => {
  const id = state[`${side}Preset`];
  return id && id !== U.NONE ? I.find(side, id) : null;
};
const draftOf = (state, side) => (state.drafts && state.drafts[side]) || null;

/** the curves a pick already has as its own: an own preset's point curves, none for a built-in */
function baseline(pick) {
  const out = {};
  if (pick && pick.custom) for (const pr of pick.props) if (pr.curve && pr.curve.kind === "points") out[pr.prop] = { pts: copyPts(pr.curve.pts) };
  return out;
}

/** the length the editor's work would have now: the length typed for the side, else the pick's own */
function effectiveFrames(state, side, pick) {
  const typed = state[`${side}Frames`];
  return typed !== null && typed !== undefined ? typed : I.defaultFrames(side, pick.id);
}

/** a draft for `pick` with these curves; its name is only what the preview's caption says ("Pop (edited)"): the saved name is typed at Save */
function makeDraft(state, side, pick, curves) {
  const base = pick.custom ? pick.base : pick.id;
  const built = I.find(side, base);
  return { base, name: P.cleanName(`${built ? built.name : pick.name} (edited)`), frames: effectiveFrames(state, side, pick), curves };
}

/** the draft this pick has now, as the starting point of an edit: the page's draft when it is of this pick, else the pick's own curves */
function curvesOfPick(state, side, pick) {
  const old = draftOf(state, side);
  return old && old.base === (pick.custom ? pick.base : pick.id) ? copyCurves(old.curves) : baseline(pick);
}

/**
 * The draft after `prop` of the side's pick was set to `pts` (a legal curve) -> the new draft, or null when this cannot be edited
 * (nothing picked, the property is not one the preset animates as one piece, the points are not legal). The pick's own curves are
 * kept, so an own preset's other edited properties survive. A built-in's other properties keep the base's curve (they are not in
 * `curves`).
 */
function editDraft(state, side, prop, pts) {
  const s = sideOf(side);
  const pick = pickOf(state, s);
  if (!pick || !K.pointsOk(pts)) return null;
  const e = I.editable(s, pick.id).find((x) => x.prop === prop);
  if (!e || !e.ok) return null;
  const curves = curvesOfPick(state, s, pick);
  curves[prop] = { pts: copyPts(pts) };
  return makeDraft(state, s, pick, curves);
}

/**
 * The draft after "reset" of `prop` (back to the base's curve) -> the new draft, or null when what is left is exactly what the pick
 * already has (a built-in: its last edited property was reset). An own preset whose only curve is reset keeps a draft with no curves
 * (the base, unsaved), so the graph shows the base curve and not the saved one. Nothing to reset -> the draft as it was.
 */
function resetDraft(state, side, prop) {
  const s = sideOf(side);
  const pick = pickOf(state, s);
  const old = draftOf(state, s);
  if (!pick) return old;
  const curves = curvesOfPick(state, s, pick);
  if (!curves[prop]) return old;
  delete curves[prop];
  return sameCurves(curves, baseline(pick)) ? null : makeDraft(state, s, pick, curves);
}

/** which properties show as edited (a dot): the draft's curves, else an own preset's own */
function editedOf(state, side) {
  const s = sideOf(side);
  const d = draftOf(state, s);
  if (d) return Object.keys(d.curves);
  return Object.keys(baseline(pickOf(state, s)));
}

/**
 * the points the graph shows for a property: the draft's; else, with a draft, the base's curve (an own preset reset to its base shows
 * the base, not its saved curve); else the pick's. null when it cannot be edited
 */
function pointsFor(state, side, prop) {
  const s = sideOf(side);
  const d = draftOf(state, s);
  if (d && d.curves[prop]) return copyPts(d.curves[prop].pts);
  const pick = pickOf(state, s);
  if (!pick) return null;
  return I.curveFor(s, d && d.base === (pick.custom ? pick.base : pick.id) ? d.base : pick.id, prop);
}

/** the name for Save as new: the typed one cleaned, and made unique among that side's own names ("Snappy", "Snappy 2", ...; the suffix survives the cut) */
function uniqueName(raw, side, typed) {
  const taken = new Set();
  for (const r of Array.isArray(raw) ? raw : []) if (r && r.v === P.V && r.side === side && typeof r.name === "string") taken.add(r.name.toLowerCase());
  const base = P.cleanName(typed);
  if (!base) return "";
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` ${n}`;
    const name = P.cleanName(base.slice(0, P.NAME_MAX - suffix.length) + suffix);
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** the draft as the spec inoutplan.setDraft reads */
function specOf(side, draft) {
  return { v: I.PRESET_V, side: sideOf(side), base: draft.base, name: draft.name, frames: draft.frames, curves: copyCurves(draft.curves) };
}

/**
 * The registry follows the page's drafts (call it after EVERY change of state.drafts, before U.view / U.hoverView / U.editorView read
 * the registry): the frames follow the length typed since, a draft the maths refuses is dropped. -> the sides whose draft was dropped.
 */
function syncDrafts(state) {
  const dropped = [];
  for (const side of ["in", "out"]) {
    const d = draftOf(state, side);
    const pick = pickOf(state, side);
    if (!d || !pick) {
      if (d) state.drafts[side] = null;
      I.setDraft(side, null);
      continue;
    }
    d.frames = effectiveFrames(state, side, pick);
    if (!I.setDraft(side, specOf(side, d))) {
      state.drafts[side] = null;
      dropped.push(side);
    }
  }
  return dropped;
}

/** what Save sends to inoutpresets.added: { side, base, name, frames, curves }, or null when there is no draft */
function saveSpec(state, side, name) {
  const s = sideOf(side);
  const d = draftOf(state, s);
  const pick = pickOf(state, s);
  if (!d || !pick) return null;
  return { side: s, base: d.base, name, frames: effectiveFrames(state, s, pick), curves: copyCurves(d.curves) };
}

// ---------------------------------------------------------------- the DOM
/**
 * Builds the editor into `host` (the page, under the switch) and its "Curves" button into `entryHost` (the dock's summary line).
 * {host, entryHost, el, button, enable, bindTips, store (the page's store: getItem / setItem), graph (curvegraph.js), getState (the page's
 * state, mutated in place), hooks: { refresh () (clear the old answer, repaint), changed () (as refresh, and remember the choices),
 * pick (side, id) (a tile's own path), refill (side) (rebuild that side's tiles), showSide (side), say (lines), isBusy (), debug (text) }}
 * -> { paint (), isOpen (), syncDrafts (), clearDrafts (), disarm (), edit (side, prop, pts), info () }
 */
const STILL_LOADING = "Your presets are still loading. Try again in a moment.";

function mount({ host, entryHost, el, button, enable, bindTips, store, graph, getState, hooks }) {
  let open = false;
  let prop = null;                                        // the property shown
  let armed = null;                                       // "<side>:<id>" while Delete waits for its second press
  let nameKey = "";                                       // the context the name box was last filled for

  const raw = () => P.parse(store.getItem(P.KEY));
  // Until the panel store has loaded from the engine it answers with an empty list: a Save, Rename or Delete then would write that
  // list over the presets saved earlier (store.load never replaces a key already set). So none of the three acts before the load.
  const ready = () => typeof store.loaded !== "function" || store.loaded();
  const notReady = () => {
    if (ready()) return false;
    say(STILL_LOADING, "warn");
    return true;
  };
  const view = () => U.editorView(getState(), raw());
  const busy = () => !!hooks.isBusy();

  const editBtn = button("small io-edbtn", "Curves", "", () => {
    if (hooks.isBusy() || view().none) return;            // setBusy re-enables every small button: the press checks again
    disarm();
    open = true;
    hooks.refresh();
  });
  editBtn.id = "ioEdit";
  entryHost.appendChild(editBtn);

  const box = el("div", "io-ed");
  box.id = "ioEd";
  box.hidden = true;
  host.appendChild(box);

  const top = el("div", "row io-edtop");
  box.appendChild(top);
  const back = button("small io-edback", "Presets", "Back to the preset tiles. An unsaved curve edit stays on the picked preset until you pick another one.", () => {
    disarm();
    open = false;
    hooks.refresh();
  });
  back.id = "ioEdBack";
  top.appendChild(back);
  const reset = button("small io-edreset", "Reset", "", () => {
    if (hooks.isBusy() || !prop) return;
    disarm();
    const st = getState();
    const side = sideOf(st.side);
    st.drafts[side] = resetDraft(st, side, prop);
    afterDraftChange(side);
  });
  reset.id = "ioEdReset";
  top.appendChild(reset);

  const propRow = el("div", "row wrap io-edprops");
  box.appendChild(propRow);
  const chips = {};
  for (const p of PROPS) {
    const b = button("small io-chip io-edchip", U.PROP_LABEL[p], `Edit the ${U.PROP_LABEL[p]} curve of the picked preset.`, () => {
      if (hooks.isBusy() || b.disabled) return;
      disarm();
      prop = p;
      paint();
    });
    b.id = `ioEdProp-${p}`;
    b.setAttribute("data-id", p);
    propRow.appendChild(b);
    chips[p] = b;
  }

  const gwrap = el("div", "row io-edgraph");
  gwrap.setAttribute("data-tip", HINT_TIP);
  box.appendChild(gwrap);
  const g = graph.mount({ host: gwrap, el, width: GRAPH_W, height: GRAPH_H });            // the one mount: every property and side reuse it
  g.onChange((pts, dragging) => commit(pts, dragging));
  const hint = el("div", "io-edhint", HINT);
  hint.setAttribute("data-tip", HINT_TIP);
  box.appendChild(hint);

  const nameRow = el("div", "row io-edname");
  box.appendChild(nameRow);
  const nameBox = document.createElement("input");
  nameBox.type = "text";
  nameBox.id = "ioEdName";
  nameBox.className = "io-name";
  nameBox.maxLength = P.NAME_MAX;
  nameBox.setAttribute("data-tip", `The name of the preset, up to ${P.NAME_MAX} characters. Save as new and Rename both use it.`);
  nameRow.appendChild(nameBox);
  const save = button("small io-edsave", "Save as new", "", () => onSave());
  save.id = "ioEdSave";
  nameRow.appendChild(save);

  const ownRow = el("div", "row io-edown");
  box.appendChild(ownRow);
  const rename = button("small io-edrename", "Rename", "Gives the picked preset of yours the name in the box. Its curves stay as they are.", () => onRename());
  rename.id = "ioEdRename";
  ownRow.appendChild(rename);
  const del = button("small io-eddelete", "Delete", "", () => onDelete());
  del.id = "ioEdDelete";
  ownRow.appendChild(del);

  // after any change of a side's draft: the registry follows (before anything reads it), then the page repaints
  function afterDraftChange(side) {
    const st = getState();
    if (syncDrafts(st).includes(side)) hooks.debug(`inout editor: the maths refused the ${side} draft, it was dropped`);
    hooks.refresh();
  }

  // the graph's change: during a drag only the draft, the registry and this editor's own marks follow (the preview replays when the
  // press is released, not on every move); a release, an add, a remove or a corner repaints the page
  function commit(pts, dragging) {
    if (hooks.isBusy() || !prop) return;
    const st = getState();
    const side = sideOf(st.side);
    const next = editDraft(st, side, prop, pts);
    if (!next) return;
    const wasArmed = !!armed;
    disarm();                                              // "any other press cancels": a press on the graph is one
    st.drafts[side] = next;
    if (!dragging) return afterDraftChange(side);
    if (wasArmed) paint();
    if (syncDrafts(st).includes(side)) return;
    marks(st, side);
  }

  function disarm() {
    armed = null;
  }

  function say(text, cls) {
    hooks.say({ text, cls: cls || "line" });
  }

  // the stored list changed: remember it, tell the maths (a row it drops is only logged), rebuild that side's tiles
  function stored(list, side) {
    store.setItem(P.KEY, JSON.stringify(list));
    const r = I.setCustom(list);
    if (r.dropped.length) hooks.debug(`inout editor: own presets dropped: ${JSON.stringify(r.dropped)}`);
    hooks.refill(side);
  }

  function onSave() {
    const st = getState();
    const e = U.editorView(st, raw());
    if (hooks.isBusy() || e.none || !e.canSave || notReady()) return;
    disarm();
    const side = e.side;
    const spec = saveSpec(st, side, uniqueName(raw(), side, nameBox.value));
    const made = spec ? P.added(raw(), spec, Date.now()) : { error: "There is nothing to save yet." };
    if (made.error) return say(made.error, "warn");
    st.drafts[side] = null;
    I.setDraft(side, null);
    stored(made.raw, side);
    hooks.pick(side, made.id);                              // the same path a tile press takes, so it is remembered and shown
    say(`Saved "${P.cleanName(spec.name)}" as a new ${side === "in" ? "In" : "Out"} preset. It is with your own tiles, right after None.`);
  }

  function onRename() {
    const st = getState();
    const e = U.editorView(st, raw());
    if (hooks.isBusy() || e.none || !e.isOwn || notReady()) return;
    disarm();
    const done = P.renamed(raw(), e.id, nameBox.value);
    if (done.error) return say(done.error, "warn");
    stored(done.raw, e.side);
    say(`Renamed to "${P.cleanName(nameBox.value)}".`);
  }

  function onDelete() {
    const st = getState();
    const e = U.editorView(st, raw());
    if (hooks.isBusy() || e.none || !e.isOwn || notReady()) return;
    const key = `${e.side}:${e.id}`;
    if (armed !== key) {                                     // the first press only asks
      armed = key;
      paint();
      return;
    }
    disarm();
    const row = raw().find((r) => r && r.id === e.id);
    const base = row && typeof row.base === "string" ? row.base : e.base;
    const gone = P.removed(raw(), e.id);
    stored(gone.raw, e.side);
    Object.assign(st, U.afterDelete(st, e.side, e.id, base));
    syncDrafts(st);
    hooks.changed();
    say(`Deleted. ${e.baseName} is picked again.`);
  }

  // the name box is filled again only when the context changed (another preset, another side, the list grew): never under a typing hand
  function paintName(e, list) {
    const key = `${e.side}|${e.id}|${list.length}`;
    if (key !== nameKey && document.activeElement !== nameBox) {
      nameKey = key;
      nameBox.value = e.isOwn ? (I.find(e.side, e.id) || {}).name || e.defaultName : e.defaultName;   // an own preset's box starts with its own name, so Rename changes nothing by itself
    }
  }

  // this editor's own controls for the draft as it is now (cheap: no page repaint, safe during a drag)
  function marks(st, side) {
    const edited = editedOf(st, side);
    for (const p of PROPS) chips[p].textContent = `${U.PROP_LABEL[p]}${edited.includes(p) ? " •" : ""}`;
    enable(save, U.editorView(st, raw()).canSave && !busy() && ready());
    enable(reset, !!prop && edited.includes(prop) && !busy());
  }

  function paint() {
    const st = getState();
    const list = raw();
    const e = U.editorView(st, list);
    const canOpen = !e.none && !busy();
    enable(editBtn, canOpen && !open);
    editBtn.setAttribute("data-tip", open ? "The curve editor is open: use Presets to go back to the tiles."
      : e.none ? "Pick an In or an Out preset first: the editor reshapes the preset that is picked on the side showing."
        : `Open the curve editor for ${e.baseName}${e.isOwn ? " (yours)" : ""}: reshape how each property moves, then save it as a preset of your own.`);
    if (open && e.none) open = false;                       // a side with nothing picked has nothing to edit: the editor closes
    box.hidden = !open;
    if (!open) {
      disarm();
      return;
    }
    if (armed && (busy() || armed !== `${e.side}:${e.id}`)) disarm();
    const edited = editedOf(st, e.side);
    // the property shown: the one chosen if this preset animates it as one piece, else the first that it does
    const usable = e.props.filter((x) => x.ok);
    if (!usable.some((x) => x.prop === prop)) prop = usable.length ? usable[0].prop : null;
    for (const p of PROPS) {
      const entry = e.props.find((x) => x.prop === p);
      const b = chips[p];
      b.hidden = !entry;
      if (!entry) continue;
      b.className = `btn small io-chip io-edchip${p === prop ? " on" : ""}`;
      b.textContent = `${entry.label}${edited.includes(p) ? " •" : ""}`;
      enable(b, entry.ok && !busy());
      b.setAttribute("data-tip", entry.ok ? `Edit the ${entry.label} curve of ${e.baseName}.${edited.includes(p) ? " A dot means it is changed." : ""}`
        : `${entry.label} cannot be edited: ${entry.why}.`);
    }
    enable(reset, !!prop && edited.includes(prop) && !busy());
    reset.setAttribute("data-tip", "Puts the shown property back to the built-in curve of the preset this one is based on.");
    const pts = prop ? pointsFor(st, e.side, prop) : null;
    g.set(pts || [[0.5, 0.5]], !!pts && !busy());           // the same points as just reported are no change: a drag is never ended from here
    hint.textContent = usable.length ? HINT : NO_EDIT;
    paintName(e, list);
    enable(save, e.canSave && !busy() && ready());
    save.setAttribute("data-tip", e.canSave ? `Saves the edited curves as a new ${e.side === "in" ? "In" : "Out"} preset of your own, the tile after None. ` +
      `${e.baseName} itself is never changed.` : "Change a curve first: there is nothing to save yet.");
    ownRow.hidden = !e.isOwn;
    enable(rename, e.isOwn && !busy() && ready());
    enable(del, e.isOwn && !busy() && ready());
    del.textContent = armed ? "Press again to delete" : "Delete";
    del.setAttribute("data-tip", armed ? "Deletes your preset for good. Any other press cancels. The built-in preset it is based on stays."
      : "Deletes this preset of yours (press twice to confirm). The built-in preset it is based on stays.");
  }

  // the bridge's "as if dragged and released": open on that side and property, set the curve
  function edit(side, p, pts) {
    const st = getState();
    if (hooks.isBusy()) return { error: "The page is busy." };
    if (side !== "in" && side !== "out") return { error: "side must be in or out." };
    if (!PROPS.includes(p)) return { error: `prop must be one of ${PROPS.join(", ")}.` };
    if (!K.pointsOk(pts)) return { error: "pts is not a legal curve." };
    if (!pickOf(st, side)) return { error: `Pick a preset on the ${side} side first.` };
    if (sideOf(st.side) !== side) hooks.showSide(side);
    const e = view();
    const entry = e.props.find((x) => x.prop === p);
    if (!entry) return { error: `${e.baseName} does not animate ${p}.` };
    if (!entry.ok) return { error: `${p} cannot be edited: ${entry.why}.` };
    disarm();
    open = true;
    prop = p;
    const next = editDraft(st, side, p, pts);
    if (!next) return { error: "The edit was refused." };
    st.drafts[side] = next;
    afterDraftChange(side);
    return draftOf(st, side) ? { ok: true, side, prop: p, canSave: view().canSave } : { error: "The maths refused the draft." };
  }

  bindTips(box);
  bindTips(entryHost);
  return {
    paint,
    isOpen: () => open,
    syncDrafts: () => syncDrafts(getState()),
    clearDrafts: () => clearDrafts(getState()),
    disarm,
    edit,
    info: () => {
      const st = getState();
      const e = U.editorView(st, raw());
      return {
        editing: open, side: e.side, prop, name: nameBox.value, canSave: e.canSave, isOwn: e.isOwn, confirming: !!armed,
        own: { in: I.customOf("in").length, out: I.customOf("out").length },
        draft: { in: !!draftOf(st, "in"), out: !!draftOf(st, "out") },
        curve: prop ? pointsFor(st, e.side, prop) : null,
        props: e.props.map((x) => ({ prop: x.prop, ok: x.ok, edited: editedOf(st, e.side).includes(x.prop) })),
        graph: g.info(),
      };
    },
  };
}

module.exports = {
  STILL_LOADING, GRAPH_W, GRAPH_H, clearDrafts, uniqueName, baseline, effectiveFrames, editDraft, resetDraft, editedOf, pointsFor, specOf, syncDrafts, saveSpec, mount };
