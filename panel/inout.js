// The In & Out page (docs/IN_OUT_PLAN.md Phase 3, laid out compactly in 0.10.132): ready-made In and Out animations for the selected clips.
// A top card (the preview with the settings beside it), an In | Out switch with the one list of preset buttons it shows (None + the
// presets by what they move; hovering one plays it in the preview), and Apply / Remove with a one-line summary in a dock under the page (#ioDock, as the Keyframer's Apply). Nothing runs by itself: only Apply and Remove write anything.
// The presets and their maths are inoutplan.js, what the controls show and say is inoutui.js (Node-tested), Premiere is
// premiere-inout.js (one Transform effect per clip with baked keys). The choices are kept in the panel's store.
const store = require("./store.js");
const IO = require("./premiere-inout.js");
const I = require("./inoutplan.js");
const U = require("./inoutui.js");
const PV = require("./inoutpreview.js");

const KEY = "asistent.inout.ui";
const EDGES = [["left", "\u2190"], ["top", "\u2191"], ["bottom", "\u2193"], ["right", "\u2192"]];   // arrows: the edge the clip comes from / goes to
const TURNS = [["cw", "\u21BB"], ["ccw", "\u21BA"]];                                                  // clockwise, counter-clockwise

function readSaved() {
  try {
    return JSON.parse(store.getItem(KEY) || "null");
  } catch (e) {
    return null;                                           // the defaults
  }
}

function mount({ $, el, button, enable, bindTips, premiere }) {
  const root = $("paneInOut");
  const state = U.restore(readSaved());
  let busy = false;
  let result = null;                                         // the last press's lines; forgotten when the editor changes a choice
  const keep = () => store.setItem(KEY, JSON.stringify(U.snapshot(state)));
  // any change of a choice: remembered, and the old answer (or warning) no longer describes the page
  const changed = () => {
    result = null;
    keep();
    paint();
  };

  root.innerHTML = "";
  const card = () => {
    const c = el("div", "kf-card");
    root.appendChild(c);
    return c;
  };

  // ---- the top card (0.10.132): the preview at the left and the settings at its right; when the panel is too narrow for both, the
  // settings wrap under the preview. Every settings row is one compact line, no label wider than a word.
  const top = card();
  const host = top;                                          // where the dock goes if the page has no #ioDock
  const topRow = el("div", "row wrap io-top");
  top.appendChild(topRow);
  const pvCol = el("div", "io-pvcol");
  topRow.appendChild(pvCol);
  const setCol = el("div", "io-set");
  topRow.appendChild(setCol);

  // the preview (Phase 4): the picked animations played on a sample box from the rows Apply bakes (inoutpreview.js). It draws
  // only; its timer stops while this pane is hidden and starts again on the next pointer move over the pane (wake) or choice.
  const preview = PV.mount({ host: pvCol, el, visible: () => !root.hidden && root.offsetWidth > 0, debug: premiere.debug });
  const wake = () => { if (!busy) preview.wake(); };          // not while Apply or Remove writes
  root.addEventListener("pointerover", wake);
  root.addEventListener("mousemove", wake);
  root.addEventListener("mouseleave", () => {                 // a preset's own mouseleave can be lost when the pointer leaves the panel
    if (!hover) return;
    hover = null;
    showPreview();
  });

  // ---- the settings the picked presets ask for
  const line = (cls) => {
    const r = el("div", `row io-line${cls ? ` ${cls}` : ""}`);
    setCol.appendChild(r);
    return r;
  };
  // one control with its small label, in a row: the part greys (io-off) and carries the tip on its own
  const part = (r, label, tip, id) => {
    const p = el("div", "row io-pair");
    p.setAttribute("data-tip", tip);
    if (id) p.id = id;
    const l = el("div", "io-l", label);
    l.setAttribute("data-tip", tip);
    if (label) p.appendChild(l);
    r.appendChild(p);
    return { p, l };
  };
  const number = (id, pair, tip) => {
    const i = document.createElement("input");
    i.type = "text";
    i.id = id;
    i.className = "kf-num";
    i.setAttribute("data-tip", tip);
    pair.p.appendChild(i);
    return i;
  };
  const framesLine = line();
  const inPair = part(framesLine, "In", "How long the In animation takes, in sequence frames. Picking a preset fills in its own length; a number you type is kept for the next presets.", "ioInRow");
  const inBox = number("ioInFrames", inPair, `In animation length in frames, ${I.FRAMES_MIN}-${I.FRAMES_MAX} (type a number, Enter).`);
  const outPair = part(framesLine, "Out", "How long the Out animation takes, in sequence frames. Picking a preset fills in its own length; a number you type is kept for the next presets.", "ioOutRow");
  const outBox = number("ioOutFrames", outPair, `Out animation length in frames, ${I.FRAMES_MIN}-${I.FRAMES_MAX} (type a number, Enter).`);
  const strLine = line("wrap");
  const strengthPair = part(strLine, "Strength", "", "ioStrengthRow");
  const strengthBox = number("ioStrength", strengthPair, `Strength, ${I.STRENGTH_MIN}-${I.STRENGTH_MAX} % (type a number, Enter).`);
  strengthPair.p.appendChild(el("div", "kf-unit", "%"));
  const blurPair = part(strLine, "Blur", "Premiere's own motion blur on the animation: each frame is smeared along the way the clip moves, so fast frames blur more. " +
    "Off leaves the animation sharp.", "ioBlurRow");
  blurPair.p.className = "row io-pair io-blur";
  const blurSw = button("small sw", "", "Motion blur on or off (Apply writes it).", () => {
    if (busy) return;
    state.blur = !state.blur;
    changed();
  });
  blurSw.innerHTML = '<span class="knob"></span>';
  blurSw.id = "ioBlurSwitch";
  blurPair.p.appendChild(blurSw);

  // Edge and Turn: small glyph buttons; they share a line when both show and the column is wide enough, else wrap
  const segLine = line("wrap io-seg-line");
  const segment = (pair, items, idPrefix, tips, get, set) => {
    const btns = items.map(([id, glyph]) => {
      const b = button("small io-glyph", glyph, tips[id], () => {
        if (busy) return;
        set(id);
        changed();
      });
      b.id = `${idPrefix}-${id}`;
      b.setAttribute("data-id", id);
      pair.p.appendChild(b);
      return b;
    });
    return () => btns.forEach((b) => { b.className = `btn small io-glyph${b.getAttribute("data-id") === get() ? " on" : ""}`; });
  };
  const dirPair = part(segLine, "Edge", "The edge the clip comes in from, or leaves to. Used by the Slide, Whip, Roll and similar presets you picked.", "ioDirectionRow");
  const paintDir = segment(dirPair, EDGES, "ioDir", { left: "From / to the left edge.", top: "From / to the top edge.", bottom: "From / to the bottom edge.",
    right: "From / to the right edge." }, () => state.direction, (v) => { state.direction = v; });
  const turnPair = part(segLine, "Turn", "Which way the rotation turns. Used by the Spin, Swing and Twist presets you picked.", "ioTurnRow");
  const paintTurn = segment(turnPair, TURNS, "ioTurn", { cw: "The clip turns clockwise.", ccw: "The clip turns counter-clockwise." },
    () => state.turn, (v) => { state.turn = v; });

  // ---- the In | Out switch and the one preset list it shows. Both lists are always built (the bridge presses ioIn-* / ioOut-* by id);
  // the other one is hidden. Hovering a preset plays it in the preview without picking it.
  const listCard = card();
  const switchRow = el("div", "row io-switch");
  listCard.appendChild(switchRow);
  const segs = {};
  for (const side of ["in", "out"]) {
    const b = button("small io-seg", "", side === "in" ? "Show the In presets. The label is the current In pick." : "Show the Out presets. The label is the current Out pick.", () => {
      if (busy) return;
      state.side = side;
      keep();
      paint();
    });
    b.id = side === "in" ? "ioSideIn" : "ioSideOut";
    switchRow.appendChild(b);
    segs[side] = b;
  }
  let hover = null;                                          // {side, id} while the pointer rests on a preset button; never saved
  const lists = {};                                          // side -> container
  const sides = {};                                          // side -> its preset buttons
  function buildSide(side, title, tip) {
    const c = el("div", "io-list");
    listCard.appendChild(c);
    const buttons = [];
    const make = (name, id, help) => {
      const b = button("small", name, help, () => pick(side, id));
      b.id = `io${title}-${id}`;
      b.setAttribute("data-id", id);
      b.addEventListener("mouseenter", () => {
        if (busy) return;
        hover = { side, id };
        showPreview();
      });
      b.addEventListener("mouseleave", () => {
        if (!hover) return;
        hover = null;
        showPreview();
      });
      buttons.push(b);
      return b;
    };
    const first = el("div", "row wrap kf-presets");
    first.appendChild(make("None", U.NONE, tip));
    c.appendChild(first);
    for (const g of I.groups(side)) {
      c.appendChild(el("div", "io-group", g.name));
      const r = el("div", "row wrap kf-presets");
      for (const p of g.presets) r.appendChild(make(p.name, p.id, U.presetTip(side, p)));
      c.appendChild(r);
    }
    lists[side] = c;
    sides[side] = buttons;
  }
  buildSide("in", "In", "No In animation: the start of the clip stays as it is.");
  buildSide("out", "Out", "No Out animation: the end of the clip stays as it is.");

  // typed numbers: kept in range; an empty or junk frames box, or the default left as it was, means the preset's own length.
  // Each returns nothing and changes the page only when the value really changed (focus and leave must not clear the answer).
  const commitFrames = (side, box) => () => {
    if (busy) return;
    const next = U.framesAfterTyping(state, side, box.value);
    if (next === state[`${side}Frames`]) return paint();      // the box shows the clamped value again
    state[`${side}Frames`] = next;
    changed();
  };
  const commitStrength = () => {
    if (busy) return;
    const next = U.clampStrength(strengthBox.value);
    if (next === state.strength) return paint();
    state.strength = next;
    changed();
  };
  const commits = [commitFrames("in", inBox), commitFrames("out", outBox), commitStrength];
  for (const [box, commit] of [[inBox, commits[0]], [outBox, commits[1]], [strengthBox, commits[2]]]) {
    box.addEventListener("change", commit);
    box.addEventListener("blur", commit);
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
  }

  // ---- the dock: Apply, Remove and the answer
  const dock = $("ioDock") || host;
  dock.innerHTML = dock === host ? dock.innerHTML : "";
  const actions = el("div", "row buttons spaced kf-actions");
  dock.appendChild(actions);
  const sum = el("div", "io-sum");                           // what is picked, visible wherever the page is scrolled
  dock.appendChild(sum);
  const status = el("div", "kf-status");
  dock.appendChild(status);

  function say(lines) {
    result = [].concat(lines);
    paint();
  }
  function showStatus() {
    status.innerHTML = "";
    for (const l of U.statusFor(state, result)) status.appendChild(el("div", l.cls || "line", l.text));
  }

  async function guarded(fn) {
    if (busy) return;
    busy = true;
    hover = null;
    paint();
    try {
      await fn();
    } catch (e) {
      say({ text: (e && e.message) || String(e), cls: "warn" });
      if (!(e instanceof premiere.UserError)) premiere.debug(`inout: ${e && e.stack ? e.stack : e}`);
    } finally {
      busy = false;
      paint();
    }
  }

  const applyBtn = button("action", "Apply", "Writes the picked In and / or Out animation on every selected clip. Re-applying replaces Asistent's earlier animation on a clip. " +
    "The first Apply is two Cmd/Ctrl+Z steps, a re-apply one. Each clip gets one Asistent Transform effect with a keyframe on every frame; your own Motion and effects are not touched.", () => {
    for (const commit of commits) commit();                    // a number typed without Enter or leaving the box still counts (before busy: a commit does nothing while busy)
    return guarded(async () => {
    const v = U.view(state);
    if (!v.canApply) return say({ text: U.PICK_FIRST, cls: "line" });
    say({ text: "Writing the animation…", cls: "muted" });
    const res = await IO.apply(await premiere.activeProject(), v.opts);
    say(U.status("apply", res));
    });
  });
  applyBtn.id = "ioApply";
  const removeBtn = button("secondary", "Remove", "Takes Asistent's In & Out animation off the selected clips (only its own effect; your Motion and effects stay). One Cmd/Ctrl+Z.",
    () => guarded(async () => {
      const res = await IO.remove(await premiere.activeProject());
      say(U.status("remove", res));
    }));
  removeBtn.id = "ioRemove";
  actions.appendChild(applyBtn);
  actions.appendChild(removeBtn);

  // ---- what the controls show for the choices made
  // the preview plays the hovered preset when the pointer is on one, else the picks; never anything saved or written
  function showPreview() {
    if (busy) return preview.stop();                           // no redrawing while Apply or Remove writes
    if (hover && lists[hover.side].hidden) hover = null;       // its list went away under the pointer (a pick on the other side)
    preview.set(hover ? U.hoverView(state, hover.side, hover.id) : U.view(state));
  }

  function paint() {
    for (const side of ["in", "out"]) {
      const picked = state[`${side}Preset`];
      for (const b of sides[side]) b.className = `btn small${b.getAttribute("data-id") === picked ? " on" : ""}`;
    }
    const v = U.view(state);
    for (const side of ["in", "out"]) {
      lists[side].hidden = v.side !== side;
      segs[side].className = `btn small io-seg${v.side === side ? " on" : ""}`;
      segs[side].textContent = v.labels[side];
    }
    dirPair.p.hidden = !v.direction;
    turnPair.p.hidden = !v.turn;
    paintDir();
    paintTurn();
    for (const [box, pair, shown] of [[inBox, inPair.p, v.frames.in], [outBox, outPair.p, v.frames.out]]) {
      if (document.activeElement !== box) box.value = shown === null ? "" : String(shown);
      box.disabled = shown === null;
      pair.className = `row io-pair${shown === null ? " io-off" : ""}`;
    }
    if (document.activeElement !== strengthBox) strengthBox.value = String(state.strength);
    strengthBox.disabled = !v.strength;
    strengthPair.p.className = `row io-pair${v.strength ? "" : " io-off"}`;
    strengthPair.p.setAttribute("data-tip", v.strengthTip);
    strengthPair.l.setAttribute("data-tip", v.strengthTip);
    blurSw.className = state.blur ? "btn small sw on" : "btn small sw";
    sum.textContent = v.summary;
    sum.setAttribute("data-tip", `${v.summary}. The page's current picks, as Apply will write them.`);
    showPreview();
    enable(applyBtn, v.canApply && !busy);
    enable(removeBtn, !busy);
    showStatus();
  }

  function pick(side, id) {
    if (busy) return;
    state[`${side}Preset`] = id;
    state.side = side;                                         // the page follows the pick (a press by id, from the bridge, shows its side)
    changed();
  }

  paint();
  bindTips(root);
  bindTips(dock);
  return {
    // the store may load after the page was built (main.js applyRemembered)
    remembered: () => {
      Object.assign(state, U.restore(readSaved()));
      hover = null;
      paint();
    },
    wake: () => preview.wake(),                              // main.js openTab: the page is on screen again
    info: () => ({ ...U.snapshot(state), view: U.view(state), busy, preview: preview.info(), status: [...status.children].map((c) => c.textContent) }),
  };
}

module.exports = { mount };
