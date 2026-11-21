// The In & Out page (docs/IN_OUT_PLAN.md Phase 3; laid out as tiles in 0.10.133, the user's choice "A · Tiles"): ready-made In and Out
// animations for the selected clips. The page: the preview (a frame as wide as the page), the In | Out switch, filter chips, and the
// active side's presets as tiles (a small icon of what they move over the name; hovering one plays it in the preview). A dock under
// the page (#ioDock, as the Keyframer's Apply) holds the controls for the picks (length, edge, turn, strength, blur), Apply / Remove
// and a one-line summary. Nothing runs by itself: only Apply and Remove write anything.
// The presets and their maths are inoutplan.js, what the controls show and say is inoutui.js (Node-tested), Premiere is
// premiere-inout.js (one Transform effect per clip with baked keys). The choices are kept in the panel's store.
const store = require("./store.js");
const IO = require("./premiere-inout.js");
const I = require("./inoutplan.js");
const U = require("./inoutui.js");
const PV = require("./inoutpreview.js");

const KEY = "asistent.inout.ui";
// icons are 16 x 16 viewBox outlines; their colour and width come from CSS (svg.io-ico path), as UXP ignores the stroke attribute
const ICO = {
  move: "M2 8h10M8 4l4 4-4 4", scale: "M3 3h10v10H3zM6 6h4v4H6z", spin: "M13 8a5 5 0 1 1-2-4M11 1v3h3", fade: "M8 2a6 6 0 1 0 0 12zM8 2a6 6 0 0 1 0 12",
  "": "M4 8h8",
  left: "M12 8H4M7 5L4 8l3 3", top: "M8 12V4M5 7l3-3 3 3", bottom: "M8 4v8M5 9l3 3 3-3", right: "M4 8h8M9 5l3 3-3 3",
  cw: "M13 8a5 5 0 1 1-2-4M11 1v3h3", ccw: "M3 8a5 5 0 1 0 2-4M5 1v3H2",
};
const icon = (path, size) => `<svg class="io-ico" width="${size || 16}" height="${size || 16}" viewBox="0 0 16 16"><path d="${path}"/></svg>`;
const EDGES = ["left", "top", "bottom", "right"];                                                   // the edge the clip comes from / goes to
const TURNS = ["cw", "ccw"];                                                                        // clockwise, counter-clockwise
const FILTER_TIP = { all: "Show every preset.", move: "Show the presets that move the clip (position).", scale: "Show the presets that change the clip's size.",
  spin: "Show the presets that turn the clip.", fade: "Show the presets that fade the clip (opacity)." };

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
  let hover = null;                                          // {side, id} while the pointer rests on a tile; never saved
  let result = null;                                         // the last press's lines; forgotten when the editor changes a choice
  const keep = () => store.setItem(KEY, JSON.stringify(U.snapshot(state)));
  // any change of a choice: remembered, and the old answer (or warning) no longer describes the page
  const changed = () => {
    result = null;
    keep();
    paint();
  };

  root.innerHTML = "";
  const host = root;                                         // where the dock goes if the page has no #ioDock

  // ---- the preview (Phase 4): the picked animations played on a sample box from the rows Apply bakes (inoutpreview.js). It draws
  // only; its timer stops while this pane is hidden and starts again on the next pointer move over the pane (wake) or choice.
  const preview = PV.mount({ host: root, el, visible: () => !root.hidden && root.offsetWidth > 0, debug: premiere.debug });
  const wake = () => { if (!busy) preview.wake(); };          // not while Apply or Remove writes
  root.addEventListener("pointerover", wake);
  root.addEventListener("mousemove", wake);
  root.addEventListener("mouseleave", () => {                 // a tile's own mouseleave can be lost when the pointer leaves the panel
    if (!hover) return;
    hover = null;
    showPreview();
  });

  // ---- the In | Out switch, the filter chips, and the tiles of the side showing. Both sides' tiles are always built (the bridge
  // presses ioIn-* / ioOut-* by id); the other side's container and the filtered-out tiles are hidden with the `hidden` property.
  const switchRow = el("div", "row io-switch");
  root.appendChild(switchRow);
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
  const chipRow = el("div", "row io-chips");
  root.appendChild(chipRow);
  const chips = {};
  for (const [id, name] of U.FILTERS) {
    const b = button("small io-chip", name, `${FILTER_TIP[id]} The choice is kept for both sides.`, () => {
      if (busy) return;
      state.filter = id;
      changed();
    });
    b.id = `ioFilter-${id}`;
    chipRow.appendChild(b);
    chips[id] = b;
  }
  const lists = {};                                          // side -> container
  const sides = {};                                          // side -> its tiles [{b, id}]
  function buildSide(side, title, tip) {
    const c = el("div", "row wrap io-tiles");
    root.appendChild(c);
    const buttons = [];
    for (const t of U.tiles(side)) {
      const b = button("small io-tile", "", t.preset ? U.presetTip(side, t.preset) : tip, () => pick(side, t.id));
      b.id = `io${title}-${t.id}`;
      b.setAttribute("data-id", t.id);
      b.innerHTML = icon(ICO[t.filter]);
      b.appendChild(el("div", "io-tn", t.name));
      b.addEventListener("mouseenter", () => {
        if (busy) return;
        hover = { side, id: t.id };
        showPreview();
      });
      b.addEventListener("mouseleave", () => {
        if (!hover) return;
        hover = null;
        showPreview();
      });
      buttons.push(b);
      c.appendChild(b);
    }
    lists[side] = c;
    sides[side] = buttons;
  }
  buildSide("in", "In", "No In animation: the start of the clip stays as it is.");
  buildSide("out", "Out", "No Out animation: the end of the clip stays as it is.");

  // ---- the dock: the controls for the picks, Apply and Remove, the summary and the answer
  const dock = $("ioDock") || host;
  dock.innerHTML = dock === host ? dock.innerHTML : "";
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
    pair.appendChild(i);
    return i;
  };
  const glyph = (parent, svgPath, text, tip, fn) => {
    const b = button("small io-glyph", text, tip, fn);
    if (svgPath) b.innerHTML = icon(svgPath, 14);
    parent.appendChild(b);
    return b;
  };

  // row a: the active side's length as a stepper, then Edge and Turn when a picked preset asks for them (they wrap under when narrow)
  const ctl = el("div", "row wrap io-ctl");
  dock.appendChild(ctl);
  const step = part(ctl, "In", "How long the animation of the side showing takes, in sequence frames. Picking a preset fills in its own length; a number you type is kept for the next presets.", "ioStepRow");
  const nudge = (dir) => {
    if (busy) return;
    const side = U.view(state).side;
    if (U.view(state).frames[side] === null) return;            // that side is None: nothing to step, and its remembered length stays
    const box = side === "in" ? inBox : outBox;
    commitFrames(side, box)();                                  // a number typed first counts first
    const cur = U.view(state).frames[side];
    if (cur === null) return;
    const next = U.framesAfterTyping(state, side, String(cur + dir));
    if (next !== state[`${side}Frames`]) state[`${side}Frames`] = next;
    // paint() leaves a focused box alone, and the box's own blur / Enter / Apply would then read the old number back
    box.value = String(U.view(state).frames[side]);
    changed();
  };
  const minusBtn = glyph(step.p, null, "\u2212", `One frame shorter (${I.FRAMES_MIN} at the least).`, () => nudge(-1));
  minusBtn.id = "ioFramesMinus";
  const inBox = number("ioInFrames", step.p, `In animation length in frames, ${I.FRAMES_MIN}-${I.FRAMES_MAX} (type a number, Enter).`);
  const outBox = number("ioOutFrames", step.p, `Out animation length in frames, ${I.FRAMES_MIN}-${I.FRAMES_MAX} (type a number, Enter).`);
  const plusBtn = glyph(step.p, null, "+", `One frame longer (${I.FRAMES_MAX} at the most).`, () => nudge(1));
  plusBtn.id = "ioFramesPlus";
  step.p.appendChild(el("div", "kf-unit", "f"));

  // Edge and Turn: small icon buttons
  const segment = (pair, items, idPrefix, tips, get, set) => {
    const btns = items.map((id) => {
      const b = glyph(pair.p, ICO[id], "", tips[id], () => {
        if (busy) return;
        set(id);
        changed();
      });
      b.id = `${idPrefix}-${id}`;
      b.setAttribute("data-id", id);
      return b;
    });
    return () => btns.forEach((b) => { b.className = `btn small io-glyph${b.getAttribute("data-id") === get() ? " on" : ""}`; });
  };
  const dirPair = part(ctl, "", "The edge the clip comes in from, or leaves to. Used by the Slide, Whip, Roll and similar presets you picked.", "ioDirectionRow");
  const paintDir = segment(dirPair, EDGES, "ioDir", { left: "From / to the left edge.", top: "From / to the top edge.", bottom: "From / to the bottom edge.",
    right: "From / to the right edge." }, () => state.direction, (v) => { state.direction = v; });
  const turnPair = part(ctl, "", "Which way the rotation turns. Used by the Spin, Swing and Twist presets you picked.", "ioTurnRow");
  const paintTurn = segment(turnPair, TURNS, "ioTurn", { cw: "The clip turns clockwise.", ccw: "The clip turns counter-clockwise." },
    () => state.turn, (v) => { state.turn = v; });

  // row b: Strength (greyed where it changes nothing) and the Blur pill at the right
  const strLine = el("div", "row io-line");
  dock.appendChild(strLine);
  const strengthPair = part(strLine, "Strength", "", "ioStrengthRow");
  const strengthBox = number("ioStrength", strengthPair.p, `Strength, ${I.STRENGTH_MIN}-${I.STRENGTH_MAX} % (type a number, Enter).`);
  strengthPair.p.appendChild(el("div", "kf-unit", "%"));
  const blurPair = part(strLine, "", "Premiere's own motion blur on the animation: each frame is smeared along the way the clip moves, so fast frames blur more. " +
    "Off leaves the animation sharp.", "ioBlurRow");
  blurPair.p.className = "row io-pair io-blur";
  const blurSw = button("small io-pill", "Blur off", "Motion blur on or off (Apply writes it).", () => {
    if (busy) return;
    state.blur = !state.blur;
    changed();
  });
  blurSw.id = "ioBlurSwitch";
  blurPair.p.appendChild(blurSw);

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

  // row c: Apply (wide) and Remove; then the summary and the answer
  const actions = el("div", "row io-act");
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
  const removeBtn = button("secondary io-rm", "Remove", "Takes Asistent's In & Out animation off the selected clips (only its own effect; your Motion and effects stay). One Cmd/Ctrl+Z.",
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
    // its side or its tile went away under the pointer (a pick on the other side, a filter)
    if (hover && (lists[hover.side].hidden || !U.view(state).shown[hover.side].includes(hover.id))) hover = null;
    preview.set(hover ? U.hoverView(state, hover.side, hover.id) : U.view(state), !!hover);
  }

  function paint() {
    const v = U.view(state);
    for (const side of ["in", "out"]) {
      const picked = state[`${side}Preset`];
      const shown = v.shown[side];
      let n = 0;                                               // the visible tile's place: the last of each row of three (or two when narrow) has no right margin
      for (const b of sides[side]) {
        const id = b.getAttribute("data-id");
        const show = shown.includes(id);
        b.hidden = !show;
        b.className = `btn small io-tile${id === picked ? " on" : ""}${show && n % 3 === 2 ? " e3" : ""}${show && n % 2 === 1 ? " e2" : ""}`;
        if (show) n++;
      }
      lists[side].hidden = v.side !== side;
      segs[side].className = `btn small io-seg${v.side === side ? " on" : ""}`;
      segs[side].textContent = v.labels[side];
    }
    for (const [id, b] of Object.entries(chips)) b.className = `btn small io-chip${v.filter === id ? " on" : ""}`;
    dirPair.p.hidden = !v.direction;
    turnPair.p.hidden = !v.turn;
    paintDir();
    paintTurn();
    // the stepper shows the side showing: its box, its length; it greys (and its buttons stop) while that side is None
    const shownFrames = v.frames[v.side];
    step.l.textContent = v.side === "in" ? "In" : "Out";
    for (const [box, side] of [[inBox, "in"], [outBox, "out"]]) {
      box.hidden = v.side !== side;
      if (document.activeElement !== box) box.value = v.frames[side] === null ? "" : String(v.frames[side]);
      box.disabled = v.frames[side] === null;
    }
    step.p.className = `row io-pair${shownFrames === null ? " io-off" : ""}`;
    enable(minusBtn, shownFrames !== null && !busy);
    enable(plusBtn, shownFrames !== null && !busy);
    if (document.activeElement !== strengthBox) strengthBox.value = String(state.strength);
    strengthBox.disabled = !v.strength;
    strengthPair.p.className = `row io-pair${v.strength ? "" : " io-off"}`;
    strengthPair.p.setAttribute("data-tip", v.strengthTip);
    strengthPair.l.setAttribute("data-tip", v.strengthTip);
    blurSw.className = state.blur ? "btn small io-pill on" : "btn small io-pill";
    blurSw.textContent = state.blur ? "Blur on" : "Blur off";
    sum.textContent = v.summary;
    sum.setAttribute("data-tip", `${v.summary}. The page's current picks, as Apply will write them.`);
    showPreview();
    enable(applyBtn, v.canApply && !busy);
    enable(removeBtn, !busy);
    showStatus();
  }

  function pick(side, id) {
    if (busy) return;
    Object.assign(state, U.afterPick(state, side, id));        // the page follows the pick to its side; a filtered-out tile goes back to All so it shows
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
