// Keyframer page (COCKPIT_PLAN.md A1, 0.10.32): a curve editor, curve presets, the selected clip's keyframed properties,
// Apply and Undo. A page of its own: nothing on the other tabs changes. The maths is keyframeplan.js, Premiere is
// premiere-keyframes.js. Panel CSS is limited (no grid, gap, transitions): flex rows and inline SVG only; dragging on SVG
// was probed (Phase 0, P-A6: pointer events and setPointerCapture work). 0.10.33: Elastic and Bounce next to the bezier
// curves, and Ping-pong / Loop after the last keyframe (the user's request: "a smooth bounce in, ping pong").
const K = require("./keyframeplan.js");
const KF = require("./premiere-keyframes.js");
const store = require("./store.js");
const ST = require("./premiere-stash.js");
const engine = require("./engine.js");

const SIZE = 200;
const PAD = 50;                         // room above and below for Overshoot (y from -0.5 to 1.5 is visible)
const MINE = "asistent.keyframer.curves";

function mount({ $, el, button, enable, bindTips, premiere }) {
  const root = $("paneKeyframer");
  const state = {
    curve: { id: "easeInOut", p: K.PRESETS[0].p.slice() }, sel: null, ticked: new Set(), busy: false,
    kind: "curve",                                            // curve | elastic | bounce | overshoot | bounceBack
    spring: { dir: "end", elastic: { n: 2, over: 20 }, bounce: { n: 3, h: 50 } },
    // 0.10.45: the user's reference (BOUNCr in After Effects), its settings as defaults
    after: { overshoot: { amp: 50, freq: 2, decay: 4 }, bounceBack: { elast: 50, grav: 50, max: 10 } },
    repeat: { mode: "off", times: 0 },                        // times 0 = until the clip ends
  };

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

  root.appendChild(el("div", "title spaced", "Motion"));
  const kinds = el("div", "row wrap kf-presets");
  root.appendChild(kinds);
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
  const curveRows = el("div", "");                          // the bezier curves: presets, Premiere's own, saved
  root.appendChild(curveRows);
  const presets = el("div", "row wrap kf-presets");
  curveRows.appendChild(presets);
  curveRows.appendChild(el("div", "muted", "Premiere's own (no keyframes added):"));
  const natives = el("div", "row wrap kf-presets");
  curveRows.appendChild(natives);
  const mineRow = el("div", "row wrap kf-presets");
  curveRows.appendChild(mineRow);
  const springRows = el("div", "");                         // Elastic and Bounce: where, how many, how strong
  root.appendChild(springRows);
  const dirRow = el("div", "row wrap kf-presets");
  springRows.appendChild(dirRow);
  const countRow = el("div", "row kf-step");
  springRows.appendChild(countRow);
  const strengthRow = el("div", "row kf-step");
  springRows.appendChild(strengthRow);
  const afterRows = el("div", "");                          // Overshoot+ and Bounce Back: three settings each (0.10.45)
  root.appendChild(afterRows);
  afterRows.appendChild(el("div", "muted", "Make the move short and Linear (two keyframes a few frames apart): the motion happens after the last keyframe, from the speed it arrives with."));
  const afterSteps = [0, 1, 2].map(() => {
    const r = el("div", "row kf-step");
    afterRows.appendChild(r);
    return r;
  });

  root.appendChild(el("div", "title spaced", "Repeat after the last keyframe"));
  const repeatRow = el("div", "row wrap kf-presets");
  root.appendChild(repeatRow);
  const timesRow = el("div", "row kf-step");
  root.appendChild(timesRow);

  const actions = el("div", "row buttons spaced kf-actions");
  root.appendChild(actions);
  const status = el("div", "kf-status");
  root.appendChild(status);

  // Stash v1 (0.10.37): the ticked properties' animation saved as data, applied to any clip at the playhead
  root.appendChild(el("div", "title spaced", "Stash"));
  root.appendChild(el("p", "desc", "Save the ticked properties' animation, then put it on any clip: select the clip, park the " +
    "playhead where it should start, press the stash. Same timing and easing; kept on this computer for every project."));
  const stashTop = el("div", "row buttons");
  root.appendChild(stashTop);
  const profileRow = el("div", "row options");
  const profileLabel = el("label", "muted kf-wide", "Show");
  profileLabel.setAttribute("for", "kfProfile");
  const profile = document.createElement("select");
  profile.id = "kfProfile";
  profileRow.appendChild(profileLabel);
  profileRow.appendChild(profile);
  root.appendChild(profileRow);
  const stashList = el("div", "kf-stash");
  root.appendChild(stashList);
  const stashFoot = el("div", "muted");
  root.appendChild(stashFoot);
  const PROFILE = "asistent.stash.profile";
  let armed = null;                                          // the stash whose × was pressed once (a second press deletes)

  async function fillStash() {
    let r;
    try {
      r = await engine.stashList();
    } catch (e) {
      stashFoot.textContent = "The stash needs the engine.";
      return;
    }
    const clients = [...new Set(r.items.map((i) => i.client).filter(Boolean))].sort();
    const want = store.getItem(PROFILE) || "";
    profile.innerHTML = "";
    for (const [v, t] of [["", "All clients"], ...clients.map((c) => [c, c])]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      profile.appendChild(o);
    }
    profile.value = clients.includes(want) ? want : "";
    stashList.innerHTML = "";
    const shown = r.items.filter((i) => !profile.value || i.client === profile.value);
    for (const it of shown) {
      const row = el("div", "row kf-stash-row");
      const b = button("small", it.name, `Puts this animation on the selected clip from the playhead (${(it.props || []).join(", ")}; ${Number(it.span || 0).toFixed(2)} s). One Undo step.`,
        () => guarded(async () => {
          const s = await engine.stashGet(it.id);
          const project = await premiere.activeProject();
          const res = await ST.apply(project, s);
          say([res.written ? `Done: ${it.name} on ${res.clip}, ${res.written} keyframes. Cmd/Ctrl+Z takes it back.` : `${it.name}: nothing written.`, ...res.lines], res.written ? "line" : "warn");
          if (state.sel) await read(true);
        }));
      const del = button("link", armed === it.id ? "Delete?" : "×", "Deletes this stash from this computer (press twice).", async () => {
        if (armed !== it.id) {
          armed = it.id;
          return fillStash();
        }
        armed = null;
        await engine.stashDelete(it.id).catch(() => null);
        say(`Deleted ${it.name}.`);
        fillStash();
      });
      row.appendChild(b);
      row.appendChild(del);
      stashList.appendChild(row);
    }
    if (!r.items.length) stashList.appendChild(el("div", "muted", "No stash yet: read a clip, tick its moving properties, press Save animation."));
    stashFoot.textContent = r.items.length ? `${r.items.length} saved · ${Math.max(1, Math.round(r.bytes / 1024))} KB on disk` : "";
    bindTips(root);
  }
  profile.addEventListener("change", () => {
    store.setItem(PROFILE, profile.value);
    fillStash();
  });

  const svg = box.querySelector("#kfSvg");
  const X = (x) => PAD + x * (SIZE - 2 * PAD);
  const Y = (y) => SIZE - PAD - y * (SIZE - 2 * PAD);

  function say(lines, cls) {
    status.innerHTML = "";
    for (const l of [].concat(lines)) status.appendChild(el("div", cls || "line", l));
  }

  function mark(row, id) {
    for (const b of row.children) if (b.getAttribute("data-id")) b.className = b.getAttribute("data-id") === id ? "btn small on" : "btn small";
  }

  // the curve the planner gets: Premiere's own mode, a bezier, or elastic / bounce
  function chosen() {
    if (state.kind === "elastic") return { kind: "elastic", dir: state.spring.dir, n: state.spring.elastic.n, over: state.spring.elastic.over / 100 };
    if (state.kind === "bounce") return { kind: "bounce", dir: state.spring.dir, n: state.spring.bounce.n, h: state.spring.bounce.h / 100 };
    if (state.kind === "overshoot") return { kind: "overshoot", ...state.after.overshoot };
    if (state.kind === "bounceBack") return { kind: "bounceBack", ...state.after.bounceBack };
    const nat = K.NATIVE.find((n) => n.id === state.curve.id);
    return nat ? { mode: nat.mode } : { p: state.curve.p };
  }

  const WHERE = { end: "at the end", start: "at the start", both: "at both ends" };
  function draw() {
    mark(kinds, state.kind);
    mark(dirRow, state.spring.dir);
    mark(repeatRow, state.repeat.mode);
    const after = state.kind === "overshoot" || state.kind === "bounceBack";
    curveRows.hidden = state.kind !== "curve";
    springRows.hidden = state.kind === "curve" || after;
    afterRows.hidden = !after;
    for (const r of afterSteps) if (r.refresh) r.refresh();
    timesRow.hidden = state.repeat.mode === "off";
    for (const r of [countRow, strengthRow, timesRow]) if (r.refresh) r.refresh();
    const handles = state.kind === "curve";
    for (const id of ["#kfH1", "#kfH2"]) box.querySelector(id).setAttribute("r", handles ? "7" : "0");
    for (const id of ["#kfL1", "#kfL2"]) box.querySelector(id).setAttribute("stroke-width", handles ? "1" : "0");
    if (!handles) {
      svg.style.opacity = "1";
      const c = chosen();
      box.querySelector("#kfPath").setAttribute("d", K.samplePath(c, SIZE, PAD));
      if (after) {
        curveName.textContent = c.kind === "overshoot"
          ? `Overshoot+: amplitude ${c.amp}, frequency ${c.freq}, decay ${c.decay} (after the last keyframe)`
          : `Bounce Back: elasticity ${c.elast}, gravity ${c.grav}, at most ${c.max} bounces (after the last keyframe)`;
        return;
      }
      curveName.textContent = c.kind === "elastic"
        ? `Elastic: ${c.n} ${c.n === 1 ? "wobble" : "wobbles"}, first overshoot ${state.spring.elastic.over} %, ${WHERE[c.dir]}`
        : `Bounce: ${c.n} ${c.n === 1 ? "hop" : "hops"}, each ${state.spring.bounce.h} % as high as the one before, ${WHERE[c.dir]}`;
      return;
    }
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
    for (const r of [presets, natives, mineRow]) mark(r, state.curve.id);
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
      if (state.kind !== "curve") return;
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

  // a "−  value  +" row; get/set work on the state, fmt shows the value
  function stepper(row, label, help, get, set, min, max, step, fmt) {
    row.appendChild(el("div", "kf-label", label));
    const minus = button("small", "−", help, () => { set(Math.max(min, get() - step)); draw(); });
    const value = el("div", "kf-value");
    const plus = button("small", "+", help, () => { set(Math.min(max, get() + step)); draw(); });
    row.appendChild(minus);
    row.appendChild(value);
    row.appendChild(plus);
    row.refresh = () => { value.textContent = fmt(get()); };
  }

  function fillMotion() {
    for (const [id, name, help] of [
      ["curve", "Curve", "A smooth curve between your keyframes: the presets, your own drag, or Premiere's own interpolation."],
      ["elastic", "Elastic", "Overshoots the target and wobbles into place, like a spring. For titles and logos popping in."],
      ["bounce", "Bounce", "Drops onto the target and bounces back in smaller and smaller hops, never past it."],
      ["overshoot", "Overshoot+", "As BOUNCr's Overshoot+: the move arrives at full speed, swings past the target and settles. The motion is added after your last keyframe."],
      ["bounceBack", "Bounce Back", "As BOUNCr's Bounce Back: the move hits the target and bounces back toward where it came from, smaller each time, never past it."],
    ]) {
      const b = button("small", name, help, () => { state.kind = id; draw(); });
      b.setAttribute("data-id", id);
      kinds.appendChild(b);
    }
    for (const [id, name, help] of [
      ["end", "At the end", "The wobble or the hops happen as the move arrives (the usual bounce in)."],
      ["start", "At the start", "The move winds up first, then goes (the mirror of At the end)."],
      ["both", "Both", "At the start and at the end of each move."],
    ]) {
      const b = button("small", name, help, () => { state.spring.dir = id; draw(); });
      b.setAttribute("data-id", id);
      dirRow.appendChild(b);
    }
    const cur = () => state.spring[state.kind] || state.spring.elastic;
    stepper(countRow, "Bounces", "How many wobbles (Elastic) or hops (Bounce) after the move arrives.",
      () => cur().n, (v) => { cur().n = v; }, 1, 8, 1, (v) => String(v));
    strengthRow.appendChild(el("div", "kf-label", ""));
    const strengthLabel = strengthRow.firstChild;
    stepper(strengthRow, "", "Elastic: how far the first overshoot goes, in % of the move. Bounce: each hop's height compared to the one before.",
      () => (state.kind === "bounce" ? cur().h : cur().over),
      (v) => { if (state.kind === "bounce") cur().h = v; else cur().over = v; },
      5, 80, 5, (v) => `${v} %`);
    strengthRow.removeChild(strengthRow.children[1]);         // the stepper's own (empty) label; ours names the kind
    const refreshStrength = strengthRow.refresh;
    strengthRow.refresh = () => {
      strengthLabel.textContent = state.kind === "bounce" ? "Height" : "Overshoot";
      if (state.kind === "elastic") cur().over = Math.min(50, cur().over);   // the curve box shows up to 50 % over
      refreshStrength();
    };
    // Overshoot+ / Bounce Back: the plugin's three settings, under its names
    const SETTINGS = {
      overshoot: [["amp", "Amplitude", "How far it swings past the target (BOUNCr's Amplitude; 50 as in your reference).", 5, 200, 5],
        ["freq", "Frequency", "Swings per second (2 as in your reference).", 0.5, 8, 0.5],
        ["decay", "Decay", "How fast it settles: higher stops sooner (4 as in your reference).", 1, 20, 1]],
      bounceBack: [["elast", "Elasticity", "How much speed each bounce keeps, in % (50 as in your reference).", 5, 95, 5],
        ["grav", "Gravity", "How hard it is pulled back to the target: higher = lower, quicker bounces (50 as in your reference).", 5, 200, 5],
        ["max", "Max bounces", "The most bounces before it rests.", 1, 20, 1]],
    };
    afterSteps.forEach((row, i) => {
      const kind = () => (state.kind === "bounceBack" ? "bounceBack" : "overshoot");
      const spec = () => SETTINGS[kind()][i];
      const vals = () => state.after[kind()];
      const go = (dir) => () => {
        const [key, , , lo, hi, st] = spec();
        vals()[key] = Math.min(hi, Math.max(lo, Math.round((vals()[key] + dir * st) * 10) / 10));
        draw();
      };
      const label = el("div", "kf-label", "");
      const minus = button("small", "−", "", go(-1));
      const value = el("div", "kf-value");
      const plus = button("small", "+", "", go(1));
      for (const x of [label, minus, value, plus]) row.appendChild(x);
      row.refresh = () => {
        const [key, name, help] = spec();
        label.textContent = name;
        minus.setAttribute("data-tip", help);
        plus.setAttribute("data-tip", help);
        value.textContent = String(vals()[key]);
      };
    });
    for (const [id, name, help] of [
      ["off", "Off", "The animation plays once."],
      ["pingpong", "Ping-pong", "After your last keyframe the animation plays backwards, then forwards again, and so on."],
      ["loop", "Loop", "After your last keyframe the animation jumps back to its start and plays again."],
    ]) {
      const b = button("small", name, help, () => { state.repeat.mode = id; draw(); });
      b.setAttribute("data-id", id);
      repeatRow.appendChild(b);
    }
    stepper(timesRow, "Times", "How many times it repeats; below 1 it repeats until the clip ends.",
      () => state.repeat.times, (v) => { state.repeat.times = v; }, 0, 20, 1, (v) => (v ? `${v}×` : "until the clip ends"));
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
    for (const x of [...top.children, ...actions.children, ...stashTop.children]) enable(x, !b);
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
    const planned = K.plan(props.map((p) => ({ id: p.id, keys: p.keys, earlier: p.earlier })), chosen(), sel.step,
      { repeat: state.repeat.mode === "off" ? null : state.repeat, until: sel.clip.outPt });
    if (planned.error) return say(planned.error, "warn");
    const skipped = planned.props.filter((p) => p.skip).map((p) => `${sel.props.find((q) => q.id === p.id).label}: ${p.skip}`);
    const res = await KF.apply(project, sel, planned);
    await read(true);
    say([`Done: ${res.written} keyframes added. Cmd/Ctrl+Z takes it back.`, ...res.lines, ...skipped]);
  })));

  stashTop.appendChild(button("secondary", "Save animation", "Saves the ticked properties of the read clip (their keyframes and easing, every frame) as a stash.", () => guarded(async () => {
    if (!state.sel) return say("Read a clip first, then tick the properties to save.", "warn");
    const { project, sel } = await read(true);
    const s = await ST.capture(sel, state.ticked);
    if (s.error) return say(s.error, "warn");
    const r = await engine.stashSave(s, project.path);
    say(`Saved as ${r.name}${r.client ? ` (${r.client})` : ""}.`);
    await fillStash();
  })));

  actions.appendChild(button("secondary", "Undo last", "Takes out the keyframes Asistent's last curve added on this clip (only those still where it put them).", () => guarded(async () => {
    const { project, sel } = await read(true);
    const res = await KF.undo(project, sel);
    await read(true);
    say(res.removed ? `Taken out: ${res.removed} keyframes Asistent had added.` : "Nothing of Asistent's to take out on this clip.");
  })));

  fillMotion();
  fillPresets();
  draw();
  fillStash();
}

module.exports = { mount };
