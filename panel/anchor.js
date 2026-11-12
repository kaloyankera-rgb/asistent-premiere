// The Anchor page (0.10.69): Anchor Studio (the user's own panel, github kaloyankera-rgb/anchor-studio 0.3.1) brought into
// Asistent's Motion tab next to Keyframer and Tracker. Click one of nine points (or drag between them) and the selected clips'
// anchor point goes there, with Position compensated so the picture stays where it is; one Undo step.
// The geometry is anchorplan.js and Premiere is premiere-anchor.js, both Anchor Studio's code with its tests. This page is
// rebuilt in Asistent's look: div buttons (Premiere paints <button> and Spectrum widgets its own way), no absolutely placed
// marker (UXP paints absolute elements over everything: CLAUDE.md, 0.10.59), the choices kept in the panel's store (UXP's
// localStorage is erased by every update, 0.10.17). Use alpha reads the visible pixels through the engine: no file dialog.
const store = require("./store.js");

const KEY = "asistent.anchor";
const POINTS = [[0, 0, "Top left"], [0.5, 0, "Top centre"], [1, 0, "Top right"], [0, 0.5, "Middle left"], [0.5, 0.5, "Centre"],
  [1, 0.5, "Middle right"], [0, 1, "Bottom left"], [0.5, 1, "Bottom centre"], [1, 1, "Bottom right"]];
const CUTOFFS = [1, 10, 25, 50, 75, 90];

function mount({ $, el, button, enable, bindTips, premiere }) {
  const root = $("paneAnchor");
  const AP = require("./premiere-anchor.js");
  const saved = (() => {
    try {
      return JSON.parse(store.getItem(KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  })();
  const state = {
    target: saved.target === "transform" ? "transform" : "motion",
    mode: ["clip", "sequence", "selection"].includes(saved.mode) ? saved.mode : "clip",
    alpha: !!saved.alpha, cutoff: CUTOFFS.includes(saved.cutoff) ? saved.cutoff : 1,
    point: [0.5, 0.5], saved: saved.anchor && Array.isArray(saved.anchor.world) ? saved.anchor : null, busy: false,
  };
  const keep = () => store.setItem(KEY, JSON.stringify({ target: state.target, mode: state.mode, alpha: state.alpha, cutoff: state.cutoff, anchor: state.saved }));

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
  host.appendChild(brief("Moves the anchor point; the picture stays where it is.", "Select one or more clips, then click one of the nine " +
    "points (or drag between them): the anchor point of each clip goes there and Position is compensated, so nothing moves on " +
    "screen, but Scale and Rotation now work around that point. Relative to: each clip's own picture, the sequence frame, or " +
    "the box around all selected clips. Use alpha: the visible part of a PNG, TIFF or WebP (not its transparent margin). " +
    "One Cmd/Ctrl+Z takes it back."));
  const selLine = el("div", "muted", "Select clips, then click a point.");
  host.appendChild(selLine);

  const row = (label, help) => {
    const r = el("div", "row wrap options anchor-row");
    const l = el("div", "kf-label", label);
    l.setAttribute("data-tip", help);
    r.appendChild(l);
    host.appendChild(r);
    return r;
  };
  const targetRow = row("Effect", "Motion: the clip's own Motion. Transform: an existing Transform effect on each clip (add it first; Asistent never adds one).");
  const modeRow = row("Box", "What the nine points refer to. Clip: each clip's own picture. Sequence: the sequence frame. Selection: the box around all selected clips.");
  const segment = (r, items, get, set) => {
    const btns = items.map(([id, name, tip]) => {
      const b = button("small", name, tip, () => {
        if (state.busy) return;
        set(id);
        keep();
        draw();
      });
      b.setAttribute("data-id", id);
      r.appendChild(b);
      return b;
    });
    return () => btns.forEach((b) => { b.className = `btn small${b.getAttribute("data-id") === get() ? " on" : ""}`; });
  };
  const drawTarget = segment(targetRow, [["motion", "Motion", "The clip's Motion: Anchor Point and Position."],
    ["transform", "Transform", "An existing Transform effect's Anchor Point and Position (Motion is left alone)."]], () => state.target, (v) => { state.target = v; });
  const drawMode = segment(modeRow, [["clip", "Clip", "Each clip's own picture."], ["sequence", "Sequence", "The sequence frame."],
    ["selection", "Selection", "The box around all selected clips."]], () => state.mode, (v) => { state.mode = v; });

  // the grid: three rows of three points; pressing between them (and dragging) chooses any point
  host = card();
  const board = el("div", "anchor-board");
  board.setAttribute("data-tip", "Click a point, or press between points and drag: the anchor goes where you let go.");
  host.appendChild(board);
  const pts = [];
  for (let r = 0; r < 3; r++) {
    const line = el("div", "row anchor-line");
    board.appendChild(line);
    for (let c = 0; c < 3; c++) {
      const [x, y, name] = POINTS[r * 3 + c];
      const b = button("small anchor-pt", "", name, () => place([x, y]));
      b.setAttribute("data-x", x);
      b.setAttribute("data-y", y);
      pts.push(b);
      line.appendChild(b);
    }
  }
  const where = el("div", "muted anchor-where", "");
  host.appendChild(where);

  const alphaRow = el("div", "row wrap options anchor-row");
  host.appendChild(alphaRow);
  const alphaBtn = button("small", "Use alpha", "The visible part of a still with transparency (PNG, TIFF, WebP), not its transparent margin. Read by Asistent: no file to pick.", () => {
    if (state.busy || state.mode === "sequence") return;
    state.alpha = !state.alpha;
    keep();
    draw();
  });
  alphaRow.appendChild(alphaBtn);
  const cutoffLabel = el("label", "muted", "Cutoff");
  cutoffLabel.setAttribute("for", "anchorCutoff");
  cutoffLabel.setAttribute("data-tip", "How visible a pixel must be to count: 1 % takes soft shadows and glows in, 50 % or more leaves them out.");
  const cutoff = document.createElement("select");
  cutoff.id = "anchorCutoff";
  for (const v of CUTOFFS) {
    const o = document.createElement("option");
    o.value = String(v);
    o.textContent = `${v} %`;
    cutoff.appendChild(o);
  }
  cutoff.value = String(state.cutoff);
  cutoff.addEventListener("change", () => {
    state.cutoff = Number(cutoff.value);
    keep();
  });
  alphaRow.appendChild(cutoffLabel);
  alphaRow.appendChild(cutoff);

  const xyRow = el("div", "row wrap options anchor-row");
  host.appendChild(xyRow);
  const field = (id, label) => {
    const l = el("span", "muted anchor-xy", label);           // a span: the options row gives a label a fixed width
    const i = document.createElement("input");
    i.id = id;
    i.className = "anchor-num";
    i.value = "50";
    xyRow.appendChild(l);
    xyRow.appendChild(i);
    return i;
  };
  const xIn = field("anchorX", "X");
  const yIn = field("anchorY", "Y");
  xyRow.appendChild(button("small", "Apply", "Puts the anchor at these percentages of the chosen box (0 = left / top, 100 = right / bottom; 48,5 works too).", () => {
    try {
      const AM = require("./anchorplan.js");
      const p = [AM.decimal(xIn.value) / 100, AM.decimal(yIn.value) / 100];
      if (p.some((v) => v < 0 || v > 1)) throw new Error("Enter a percentage between 0 and 100.");
      place(p);
    } catch (e) {
      say(e.message, "err");
    }
  }));

  host = card();
  host.appendChild(el("div", "title spaced", "Saved anchor"));
  const saveRow = el("div", "row buttons");
  host.appendChild(saveRow);
  const saveBtn = button("small", "Save", "Remembers where the selected clip's anchor is in the sequence (select one clip).", () => run(async () => {
    const s = await AP.save({ target: state.target });
    state.saved = { world: s.world, frame: s.frame, name: s.name };
    keep();
    say(`Saved: ${Math.round(s.world[0])}, ${Math.round(s.world[1])} in the ${s.frame[0]} × ${s.frame[1]} sequence (${s.name}).`, "ok");
  }));
  const useBtn = button("small", "Use saved", "Puts the selected clips' anchor on the saved point (a sequence of the same size).", () => run(async () => {
    const info = await AP.inspect({ target: state.target });
    if (info.frame[0] !== state.saved.frame[0] || info.frame[1] !== state.saved.frame[1]) {
      throw new Error("The saved anchor is from a sequence of another size: save one in this sequence first.");
    }
    await apply({ mode: "saved", world: state.saved.world });
  }));
  saveRow.appendChild(saveBtn);
  saveRow.appendChild(useBtn);
  const savedLine = el("div", "muted", "");
  host.appendChild(savedLine);

  const status = el("div", "kf-status");
  root.appendChild(status);

  function say(text, cls) {
    status.textContent = text || "";
    status.className = `kf-status${cls === "err" ? " err" : cls === "ok" ? " ok" : ""}`;
  }

  function draw() {
    drawTarget();
    drawMode();
    for (const b of pts) {
      const on = Math.abs(Number(b.getAttribute("data-x")) - state.point[0]) < 0.001 && Math.abs(Number(b.getAttribute("data-y")) - state.point[1]) < 0.001;
      b.className = `btn small anchor-pt${on ? " on" : ""}`;
    }
    xIn.value = String(Math.round(state.point[0] * 1000) / 10);
    yIn.value = String(Math.round(state.point[1] * 1000) / 10);
    where.textContent = `${state.mode === "sequence" ? "Sequence frame" : state.mode === "selection" ? "Selection" : "Clip"}` +
      `${state.alpha && state.mode !== "sequence" ? " (visible pixels)" : ""}: X ${xIn.value} %, Y ${yIn.value} %`;
    const usable = state.mode !== "sequence";
    alphaBtn.className = `btn small${state.alpha && usable ? " on" : ""}`;
    enable(alphaBtn, usable && !state.busy);
    cutoff.disabled = !(state.alpha && usable);
    cutoffLabel.hidden = cutoff.hidden = !(state.alpha && usable);
    enable(useBtn, !!state.saved && !state.busy);
    savedLine.textContent = state.saved ? `Saved: ${Math.round(state.saved.world[0])}, ${Math.round(state.saved.world[1])} (${state.saved.frame[0]} × ${state.saved.frame[1]}, ${state.saved.name})` : "Nothing saved yet.";
  }

  async function run(fn) {
    if (state.busy) return;
    state.busy = true;
    draw();
    try {
      await fn();
    } catch (e) {
      say(e.message || String(e), "err");
      if (!(e instanceof premiere.UserError)) premiere.debug(`anchor: ${e && e.stack ? e.stack : e}`);
    } finally {
      state.busy = false;
      draw();
    }
  }

  async function apply(request) {
    request.target = state.target;
    request.alpha = state.alpha && state.mode !== "sequence" && request.mode !== "saved";
    if (request.alpha) request.threshold = state.cutoff;
    request.onProgress = (m) => say(m);
    say("Moving the anchor…");
    const r = await AP.apply(request);
    say(`Done: ${r.count} ${r.count === 1 ? "clip" : "clips"}, ${r.target === "transform" ? "Transform" : "Motion"}` +
      `${r.alpha ? ", visible pixels" : ""}${r.keys ? `, ${r.keys} Position keyframes moved with it` : ""}. Cmd/Ctrl+Z takes it back.`, "ok");
    const info = await AP.inspect({ target: state.target }).catch(() => null);
    if (info) selLine.textContent = info.clips.length === 1 ? `${info.clips[0].name} · ${info.frame[0]} × ${info.frame[1]}` : `${info.clips.length} clips · ${info.frame[0]} × ${info.frame[1]}`;
  }

  function place(p) {
    state.point = p;
    draw();
    run(() => apply({ mode: state.mode, uv: p }));
  }

  // pressing between the points and dragging: the point under the pointer, applied where it is let go
  let dragging = false;
  const uvAt = (e) => {
    let r;
    try {
      r = board.getBoundingClientRect();
    } catch (err) {
      return null;
    }
    const inset = 14;                                          // the points' centres sit this far inside the board's edges
    return [Math.max(0, Math.min(1, (e.clientX - r.left - inset) / Math.max(1, r.width - 2 * inset))),
      Math.max(0, Math.min(1, (e.clientY - r.top - inset) / Math.max(1, r.height - 2 * inset)))];
  };
  board.addEventListener("pointerdown", (e) => {
    if (state.busy || (e.target && String(e.target.className).indexOf("anchor-pt") >= 0)) return;
    const p = uvAt(e);
    if (!p) return;
    dragging = true;
    try {
      board.setPointerCapture(e.pointerId);
    } catch (err) { /* follows inside the board */ }
    state.point = p;
    draw();
  });
  board.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const p = uvAt(e);
    if (p) {
      state.point = p;
      draw();
    }
  });
  const letGo = () => {
    if (!dragging) return;
    dragging = false;
    place(state.point);
  };
  board.addEventListener("pointerup", letGo);
  board.addEventListener("pointercancel", () => { dragging = false; });

  draw();
  bindTips(root);
  return { info: () => ({ ...state, status: status.textContent }), place, relayout: draw };
}

module.exports = { mount };
