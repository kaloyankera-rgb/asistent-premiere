// Keyframer page (COCKPIT_PLAN.md A1, 0.10.32): a curve editor, curve presets, the selected clip's keyframed properties,
// Apply and Undo. A page of its own: nothing on the other tabs changes. The maths is keyframeplan.js, Premiere is
// premiere-keyframes.js. Panel CSS is limited (no grid, gap, transitions): flex rows and inline SVG only; dragging on SVG
// was probed (Phase 0, P-A6: pointer events and setPointerCapture work).
const K = require("./keyframeplan.js");
const KF = require("./premiere-keyframes.js");
const store = require("./store.js");

const SIZE = 200;
const PAD = 50;                         // room above and below for Overshoot (y from -0.5 to 1.5 is visible)
const MINE = "asistent.keyframer.curves";

function mount({ $, el, button, enable, bindTips, premiere }) {
  const root = $("paneKeyframer");
  const state = { curve: { id: "easeInOut", p: K.PRESETS[0].p.slice() }, sel: null, ticked: new Set(), busy: false };

  root.innerHTML = "";
  root.appendChild(el("p", "desc", "Shapes the motion between two keyframes. Select one clip with keyframes, press Read, tick the " +
    "properties, choose a curve and press Apply. Custom curves are written as one keyframe per frame between your keyframes " +
    "(yours stay as they are); Premiere's own curves only change how your keyframes move. One Cmd/Ctrl+Z takes a press back."));
  const top = el("div", "row buttons");
  root.appendChild(top);
  const clipLine = el("div", "muted", "No clip read yet.");
  root.appendChild(clipLine);
  const list = el("div", "kf-props");
  root.appendChild(list);

  root.appendChild(el("div", "title spaced", "Curve"));
  const box = el("div", "kf-editor");
  box.innerHTML = `<svg id="kfSvg" width="${SIZE}" height="${SIZE}">` +
    `<rect x="${PAD}" y="${PAD}" width="${SIZE - 2 * PAD}" height="${SIZE - 2 * PAD}" fill="none" stroke="#4a4a4a" stroke-width="1"/>` +
    `<line id="kfL1" stroke="#7aa7e6" stroke-width="1"/><line id="kfL2" stroke="#7aa7e6" stroke-width="1"/>` +
    `<path id="kfPath" fill="none" stroke="#dddddd" stroke-width="2"/>` +
    `<circle id="kfH1" r="7" fill="#2d5fa8" stroke="#ffffff" stroke-width="1"/><circle id="kfH2" r="7" fill="#2d5fa8" stroke="#ffffff" stroke-width="1"/>` +
    "</svg>";
  root.appendChild(box);
  const curveName = el("div", "muted");
  root.appendChild(curveName);
  const presets = el("div", "row wrap kf-presets");
  root.appendChild(presets);
  root.appendChild(el("div", "muted", "Premiere's own (no keyframes added):"));
  const natives = el("div", "row wrap kf-presets");
  root.appendChild(natives);
  const mineRow = el("div", "row wrap kf-presets");
  root.appendChild(mineRow);

  const actions = el("div", "row buttons spaced kf-actions");
  root.appendChild(actions);
  const status = el("div", "kf-status");
  root.appendChild(status);

  const svg = box.querySelector("#kfSvg");
  const X = (x) => PAD + x * (SIZE - 2 * PAD);
  const Y = (y) => SIZE - PAD - y * (SIZE - 2 * PAD);

  function say(lines, cls) {
    status.innerHTML = "";
    for (const l of [].concat(lines)) status.appendChild(el("div", cls || "line", l));
  }

  function draw() {
    const nat = K.NATIVE.find((n) => n.id === state.curve.id);
    svg.style.opacity = nat ? "0.35" : "1";
    const p = state.curve.p;
    box.querySelector("#kfPath").setAttribute("d", K.curvePath(p, SIZE, PAD));
    for (const [line, from, x, y] of [["#kfL1", [0, 0], p[0], p[1]], ["#kfL2", [1, 1], p[2], p[3]]]) {
      const l = box.querySelector(line);
      l.setAttribute("x1", X(from[0]));
      l.setAttribute("y1", Y(from[1]));
      l.setAttribute("x2", X(x));
      l.setAttribute("y2", Y(y));
    }
    box.querySelector("#kfH1").setAttribute("cx", X(p[0]));
    box.querySelector("#kfH1").setAttribute("cy", Y(p[1]));
    box.querySelector("#kfH2").setAttribute("cx", X(p[2]));
    box.querySelector("#kfH2").setAttribute("cy", Y(p[3]));
    const named = [...K.PRESETS, ...mine()].find((c) => c.p.every((v, i) => Math.abs(v - p[i]) < 0.005));
    curveName.textContent = nat ? `${nat.name}: Premiere's own interpolation on your keyframes` :
      `${named ? named.name : "Custom"} (${p.map((v) => v.toFixed(2)).join(", ")})`;
    for (const b of [...presets.children, ...natives.children, ...mineRow.children]) {
      if (b.getAttribute("data-id")) b.className = b.getAttribute("data-id") === state.curve.id ? "btn small on" : "btn small";
    }
  }

  // dragging a handle (x stays in 0..1 so time only runs forward; y may overshoot)
  let drag = 0;
  function local(e) {
    try {
      const r = svg.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    } catch (err) {
      return [e.offsetX, e.offsetY];
    }
  }
  for (const [id, n] of [["#kfH1", 1], ["#kfH2", 2]]) {
    const h = box.querySelector(id);
    h.addEventListener("pointerdown", (e) => {
      drag = n;
      try {
        svg.setPointerCapture(e.pointerId);
      } catch (err) { /* without capture the drag still follows inside the box */ }
    });
  }
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [lx, ly] = local(e);
    const x = Math.min(1, Math.max(0, (lx - PAD) / (SIZE - 2 * PAD)));
    const y = Math.min(1.5, Math.max(-0.5, (SIZE - PAD - ly) / (SIZE - 2 * PAD)));
    const p = state.curve.p.slice();
    if (drag === 1) { p[0] = x; p[1] = y; } else { p[2] = x; p[3] = y; }
    state.curve = { id: "custom", p };
    draw();
  });
  const stop = () => { drag = 0; };
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);

  function mine() {
    try {
      return (JSON.parse(store.getItem(MINE) || "[]") || []).filter((c) => K.validCurve(c.p));
    } catch (e) {
      return [];
    }
  }

  function pick(c) {
    state.curve = { id: c.id, p: (c.p || state.curve.p).slice(), mode: c.mode };
    draw();
  }

  function fillPresets() {
    presets.innerHTML = "";
    for (const c of K.PRESETS) {
      const b = button("small", c.name, `Curve ${c.name}: baked as one keyframe per frame between your keyframes.`, () => pick(c));
      b.setAttribute("data-id", c.id);
      presets.appendChild(b);
    }
    natives.innerHTML = "";
    for (const c of K.NATIVE) {
      const b = button("small", c.name, `Sets your keyframes to Premiere's ${c.name.toLowerCase()} interpolation. No keyframes are added.`, () => pick(c));
      b.setAttribute("data-id", c.id);
      natives.appendChild(b);
    }
    mineRow.innerHTML = "";
    for (const c of mine()) {
      const b = button("small", c.name, "One of your saved curves.", () => pick(c));
      b.setAttribute("data-id", c.id);
      mineRow.appendChild(b);
    }
    mineRow.appendChild(button("link", "Save this curve", "Keeps the curve in the editor under My curve N (for every project).", () => {
      if (K.NATIVE.some((n) => n.id === state.curve.id)) return say("Choose or drag a curve first: Premiere's own ones cannot be saved.", "warn");
      const all = mine();
      const c = { id: `mine${Date.now()}`, name: `My curve ${all.length + 1}`, p: state.curve.p.map((v) => Math.round(v * 1000) / 1000) };
      store.setItem(MINE, JSON.stringify([...all, c]));
      state.curve = { id: c.id, p: c.p.slice() };
      fillPresets();
      draw();
      say(`Saved as ${c.name}.`);
    }));
    bindTips(root);
  }

  function renderProps() {
    list.innerHTML = "";
    if (!state.sel) return;
    if (!state.sel.props.length) {
      list.appendChild(el("div", "warn", "This clip has no keyframed properties that can be shaped (numbers and positions)."));
      return;
    }
    for (const p of state.sel.props) {
      const row = el("div", "row options");
      const box2 = document.createElement("input");
      box2.type = "checkbox";
      box2.id = `kf_${p.id}`;
      box2.checked = state.ticked.has(p.id);
      box2.addEventListener("change", () => (box2.checked ? state.ticked.add(p.id) : state.ticked.delete(p.id)));
      const frames = p.keys.slice(1).map((k, i) => Math.round((k.t - p.keys[i].t) / state.sel.step));
      const label = el("label", "", `${p.label}: ${p.keys.length} keyframes, ${frames.join(" + ")} frames${p.earlier ? " (shaped by Asistent)" : ""}`);
      label.setAttribute("for", box2.id);
      row.appendChild(box2);
      row.appendChild(label);
      list.appendChild(row);
    }
  }

  function setBusy(b) {
    state.busy = b;
    for (const x of [...top.children, ...actions.children]) enable(x, !b);
  }

  async function read(keepTicks) {
    const project = await premiere.activeProject();
    const sel = await KF.readSelection(project);
    if (!keepTicks) state.ticked = new Set(sel.props.filter((p) => p.keys.length >= 2).map((p) => p.id));
    state.sel = sel;
    clipLine.textContent = `${sel.clip.name}${Math.abs((sel.clip.speed || 1) - 1) > 0.01 ? ` (speed ${Math.round(sel.clip.speed * 100)} %)` : ""}` +
      `${sel.others ? ` · ${sel.others} more selected: only the first is shaped` : ""}`;
    renderProps();
    return { project, sel };
  }

  async function guarded(fn) {
    if (state.busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      say(e.message || String(e), "warn");
      premiere.debug(`keyframer: ${e && e.stack ? e.stack : e}`);
    } finally {
      setBusy(false);
    }
  }

  top.appendChild(button("action", "Read the selected clip", "Lists the keyframed properties of the selected clip (the first one if several are selected).", () => guarded(async () => {
    await read(false);
    say(state.sel.props.length ? "Tick the properties to shape, choose a curve, press Apply." : "Nothing to shape on this clip.");
  })));

  actions.appendChild(button("action", "Apply", "Shapes the ticked properties with the curve, in one Undo step. Earlier Asistent curves on them are replaced.", () => guarded(async () => {
    const { project, sel } = await read(true);
    const props = sel.props.filter((p) => state.ticked.has(p.id));
    if (!props.length) return say("Tick at least one property.", "warn");
    const nat = K.NATIVE.find((n) => n.id === state.curve.id);
    const planned = K.plan(props.map((p) => ({ id: p.id, keys: p.keys, earlier: p.earlier })), nat ? { mode: nat.mode } : { p: state.curve.p }, sel.step);
    if (planned.error) return say(planned.error, "warn");
    const skipped = planned.props.filter((p) => p.skip).map((p) => `${sel.props.find((q) => q.id === p.id).label}: ${p.skip}`);
    const res = await KF.apply(project, sel, planned);
    await read(true);
    say([`Done: ${res.written} keyframes added. Cmd/Ctrl+Z takes it back.`, ...res.lines, ...skipped]);
  })));

  actions.appendChild(button("secondary", "Undo last", "Takes out the keyframes Asistent's last curve added on this clip (only those still where it put them).", () => guarded(async () => {
    const { project, sel } = await read(true);
    const res = await KF.undo(project, sel);
    await read(true);
    say(res.removed ? `Taken out: ${res.removed} keyframes Asistent had added.` : "Nothing of Asistent's to take out on this clip.");
  })));

  fillPresets();
  draw();
}

module.exports = { mount };
