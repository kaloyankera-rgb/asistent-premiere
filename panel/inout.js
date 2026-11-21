// The In & Out page (docs/IN_OUT_PLAN.md Phase 3): ready-made In and Out animations for the selected clips. Two cards of preset
// buttons (None + the presets by what they move), the settings the picked presets ask for, and Apply / Remove in a dock under
// the page (#ioDock, as the Keyframer's Apply). Nothing runs by itself: only Apply and Remove write anything.
// The presets and their maths are inoutplan.js, what the controls show and say is inoutui.js (Node-tested), Premiere is
// premiere-inout.js (one Transform effect per clip with baked keys). The choices are kept in the panel's store.
const store = require("./store.js");
const IO = require("./premiere-inout.js");
const I = require("./inoutplan.js");
const U = require("./inoutui.js");

const KEY = "asistent.inout.ui";
const EDGES = [["left", "Left"], ["top", "Top"], ["bottom", "Bottom"], ["right", "Right"]];
const TURNS = [["cw", "Clockwise"], ["ccw", "Counter-clockwise"]];

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
  const brief = (line, full) => {
    const p = el("p", "desc brief", line);
    p.setAttribute("data-tip", full);
    return p;
  };

  let host = card();
  host.appendChild(brief("Ready-made In and Out animations for the selected clips.", "Select one or more clips, pick an In animation, an Out animation or both, " +
    "and press Apply. Each clip gets one Asistent Transform effect with a keyframe on every frame, so the motion is as smooth as in After Effects; your own Motion " +
    "and effects are not touched. Apply again to change it, Remove takes it off. The first Apply is two Cmd/Ctrl+Z steps (Premiere adds an effect in a step of " +
    "its own), a re-apply and Remove are one."));

  // ---- the two preset lists
  const sides = {};                                          // side -> {row of None + presets' buttons}
  function buildSide(side, title, tip) {
    const c = card();
    c.appendChild(el("div", "title", title));
    const none = button("small", "None", tip, () => pick(side, U.NONE));
    none.id = `io${title}-none`;
    none.setAttribute("data-id", U.NONE);
    const noneRow = el("div", "row wrap kf-presets");
    noneRow.appendChild(none);
    c.appendChild(noneRow);
    const buttons = [none];
    for (const g of I.groups(side)) {
      c.appendChild(el("div", "io-group", g.name));
      const r = el("div", "row wrap kf-presets");
      for (const p of g.presets) {
        const b = button("small", p.name, U.presetTip(side, p), () => pick(side, p.id));
        b.id = `io${title}-${p.id}`;
        b.setAttribute("data-id", p.id);
        r.appendChild(b);
        buttons.push(b);
      }
      c.appendChild(r);
    }
    sides[side] = buttons;
  }
  buildSide("in", "In", "No In animation: the start of the clip stays as it is.");
  buildSide("out", "Out", "No Out animation: the end of the clip stays as it is.");

  // ---- the settings the picked presets ask for
  host = card();
  host.appendChild(el("div", "title", "Settings"));
  const row = (label, help, id) => {
    const r = el("div", "row wrap options io-row");
    const l = el("div", "kf-label", label);
    l.setAttribute("data-tip", help);
    r.appendChild(l);
    r.setAttribute("data-tip", help);
    if (id) r.id = id;
    host.appendChild(r);
    return { r, l };
  };
  const segment = (r, items, idPrefix, tips, get, set) => {
    const btns = items.map(([id, name]) => {
      const b = button("small", name, tips[id], () => {
        if (busy) return;
        set(id);
        changed();
      });
      b.id = `${idPrefix}-${id}`;
      b.setAttribute("data-id", id);
      r.appendChild(b);
      return b;
    });
    return () => btns.forEach((b) => { b.className = `btn small${b.getAttribute("data-id") === get() ? " on" : ""}`; });
  };
  const dirRow = row("Edge", "The edge the clip comes in from, or leaves to. Used by the Slide, Whip, Roll and similar presets you picked.", "ioDirectionRow");
  const paintDir = segment(dirRow.r, EDGES, "ioDir", { left: "From / to the left edge.", top: "From / to the top edge.", bottom: "From / to the bottom edge.",
    right: "From / to the right edge." }, () => state.direction, (v) => { state.direction = v; });
  const turnRow = row("Turn", "Which way the rotation turns. Used by the Spin, Swing and Twist presets you picked.", "ioTurnRow");
  const paintTurn = segment(turnRow.r, TURNS, "ioTurn", { cw: "The clip turns clockwise.", ccw: "The clip turns counter-clockwise." },
    () => state.turn, (v) => { state.turn = v; });

  const number = (id, rowObj, tip) => {
    const i = document.createElement("input");
    i.type = "text";
    i.id = id;
    i.className = "kf-num";
    i.setAttribute("data-tip", tip);
    rowObj.r.appendChild(i);
    return i;
  };
  const inRow = row("In frames", "How long the In animation takes, in sequence frames. Picking a preset fills in its own length; a number you type is kept for the next presets.", "ioInRow");
  const inBox = number("ioInFrames", inRow, `In animation length in frames, ${I.FRAMES_MIN}-${I.FRAMES_MAX} (type a number, Enter).`);
  const outRow = row("Out frames", "How long the Out animation takes, in sequence frames. Picking a preset fills in its own length; a number you type is kept for the next presets.", "ioOutRow");
  const outBox = number("ioOutFrames", outRow, `Out animation length in frames, ${I.FRAMES_MIN}-${I.FRAMES_MAX} (type a number, Enter).`);
  const strengthRow = row("Strength", "", "ioStrengthRow");
  const strengthBox = number("ioStrength", strengthRow, `Strength, ${I.STRENGTH_MIN}-${I.STRENGTH_MAX} % (type a number, Enter).`);
  strengthRow.r.appendChild(el("div", "kf-unit", "%"));
  const blurRow = row("Motion blur", "Premiere's own motion blur on the animation: each frame is smeared along the way the clip moves, so fast frames blur more. " +
    "Off leaves the animation sharp.", "ioBlurRow");
  const blurSw = button("small sw", "", "Motion blur on or off (Apply writes it).", () => {
    if (busy) return;
    state.blur = !state.blur;
    changed();
  });
  blurSw.innerHTML = '<span class="knob"></span>';
  blurSw.id = "ioBlurSwitch";
  blurRow.r.appendChild(blurSw);

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
    "The first Apply is two Cmd/Ctrl+Z steps, a re-apply one.", () => guarded(async () => {
    for (const commit of commits) commit();                    // a number typed without Enter or leaving the box still counts
    const v = U.view(state);
    if (!v.canApply) return say({ text: U.PICK_FIRST, cls: "line" });
    say({ text: "Writing the animation…", cls: "muted" });
    const res = await IO.apply(await premiere.activeProject(), v.opts);
    say(U.status("apply", res));
  }));
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
  function paint() {
    for (const side of ["in", "out"]) {
      const picked = state[`${side}Preset`];
      for (const b of sides[side]) b.className = `btn small${b.getAttribute("data-id") === picked ? " on" : ""}`;
    }
    const v = U.view(state);
    dirRow.r.hidden = !v.direction;
    turnRow.r.hidden = !v.turn;
    paintDir();
    paintTurn();
    for (const [box, r, shown] of [[inBox, inRow.r, v.frames.in], [outBox, outRow.r, v.frames.out]]) {
      if (document.activeElement !== box) box.value = shown === null ? "" : String(shown);
      box.disabled = shown === null;
      r.className = `row wrap options io-row${shown === null ? " io-off" : ""}`;
    }
    if (document.activeElement !== strengthBox) strengthBox.value = String(state.strength);
    strengthBox.disabled = !v.strength;
    strengthRow.r.className = `row wrap options io-row${v.strength ? "" : " io-off"}`;
    strengthRow.r.setAttribute("data-tip", v.strengthTip);
    strengthRow.l.setAttribute("data-tip", v.strengthTip);
    blurSw.className = state.blur ? "btn small sw on" : "btn small sw";
    enable(applyBtn, v.canApply && !busy);
    enable(removeBtn, !busy);
    showStatus();
  }

  function pick(side, id) {
    if (busy) return;
    state[`${side}Preset`] = id;
    changed();
  }

  paint();
  bindTips(root);
  bindTips(dock);
  return {
    // the store may load after the page was built (main.js applyRemembered)
    remembered: () => {
      Object.assign(state, U.restore(readSaved()));
      paint();
    },
    info: () => ({ ...U.snapshot(state), view: U.view(state), busy, status: [...status.children].map((c) => c.textContent) }),
  };
}

module.exports = { mount };
