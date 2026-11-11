// The Tracker page (COCKPIT_PLAN.md A3, 0.10.51): box an object on a frame, track it through the clip, attach a text or logo
// to it. The engine tracks (tracker.py), trackplan.js does the maths, premiere-tracker.js reads and writes Premiere.
const TP = require("./trackplan.js");
const TR = require("./premiere-tracker.js");
const engine = require("./engine.js");

const MAX_H = 340;                                   // the preview is never taller than this (9:16 clips)
const COLORS = { sure: "#3fb950", unsure: "#e3b341", lost: "#d9534f" };

function mount({ $, el, button, enable, bindTips, premiere }) {
  const root = $("paneTracker");
  const state = { source: null, preview: null, box: null, track: null, job: null, busy: false, opts: { scale: false, rotation: false } };

  root.innerHTML = "";
  root.appendChild(el("p", "desc", "Makes a text, logo or clip follow a moving object, as After Effects' tracker does. " +
    "1. Select the clip with the object, park the playhead on a clear frame, press Load frame. 2. Drag a box around the " +
    "object: something with detail (a logo, a face, an edge), not a plain area. 3. Press Track. 4. Put the text where it " +
    "belongs on that same frame, select it and press Attach selected. One Cmd/Ctrl+Z takes an attach back."));
  const top = el("div", "row buttons");
  root.appendChild(top);
  const clipLine = el("div", "muted", "No frame loaded yet.");
  root.appendChild(clipLine);
  const view = el("div", "tr-view");
  view.hidden = true;
  const img = document.createElement("img");
  img.className = "tr-img";
  const boxEl = el("div", "tr-box");
  boxEl.hidden = true;
  const dot = el("div", "tr-dot");
  dot.hidden = true;
  view.appendChild(img);
  view.appendChild(boxEl);
  view.appendChild(dot);
  root.appendChild(view);
  const boxLine = el("div", "muted", "");
  root.appendChild(boxLine);

  const optRow = el("div", "row options");
  const checks = {};                                  // read when Attach is pressed (the box itself is the truth)
  for (const [k, label, tip] of [["scale", "Scale", "Also grow and shrink the attached clip with the object."],
    ["rotation", "Rotation", "Also turn the attached clip with the object."]]) {
    const c = document.createElement("input");
    c.type = "checkbox";
    c.id = `tr_${k}`;
    c.checked = state.opts[k];
    c.addEventListener("change", () => { state.opts[k] = c.checked; });
    checks[k] = c;
    const l = el("label", "tr-opt", label);
    l.setAttribute("for", c.id);
    l.setAttribute("data-tip", tip);
    optRow.appendChild(c);
    optRow.appendChild(l);
  }
  root.appendChild(optRow);
  const actions = el("div", "row buttons spaced");
  root.appendChild(actions);
  const strip = el("div", "tr-strip");
  strip.hidden = true;
  root.appendChild(strip);
  const stripLine = el("div", "muted", "");
  root.appendChild(stripLine);
  const attachRow = el("div", "row buttons spaced");
  root.appendChild(attachRow);
  const status = el("div", "kf-status");
  root.appendChild(status);

  function say(lines, cls) {
    status.innerHTML = "";
    for (const l of [].concat(lines)) status.appendChild(el("div", cls || "line", l));
  }

  function setBusy(b) {
    state.busy = b;
    for (const x of [...top.children, ...actions.children, ...attachRow.children]) {
      if (x.id === "trCancel") enable(x, b && !!state.job);
      else enable(x, !b);
    }
  }

  async function guarded(fn) {
    if (state.busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      say(e.message || String(e), "warn");
      premiere.debug(`tracker: ${e && e.stack ? e.stack : e}`);
    } finally {
      state.job = null;
      setBusy(false);
    }
  }

  // ---- the preview and the box
  function size() {
    const p = state.preview;
    let w = 0;
    try {
      w = root.getBoundingClientRect().width - 4;
    } catch (e) { /* hidden page */ }
    if (!(w > 40)) w = 260;
    const ww = Math.min(w, (MAX_H * p.w) / p.h);
    return [Math.round(ww), Math.round((ww * p.h) / p.w)];
  }

  function layout() {
    if (!state.preview) return;
    const [w, h] = size();
    view.style.width = `${w}px`;
    view.style.height = `${h}px`;
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    drawBox();
  }

  function drawBox() {
    const b = state.box;
    if (!b || !state.preview) {
      boxEl.hidden = true;
      return;
    }
    const [w, h] = size();
    boxEl.hidden = false;
    boxEl.style.left = `${Math.round(b[0] * w)}px`;
    boxEl.style.top = `${Math.round(b[1] * h)}px`;
    boxEl.style.width = `${Math.round(b[2] * w)}px`;
    boxEl.style.height = `${Math.round(b[3] * h)}px`;
    const px = Math.round(b[2] * state.preview.width);
    const py = Math.round(b[3] * state.preview.height);
    boxLine.textContent = `Box: ${px} x ${py} px of the picture.${px < 24 || py < 24 ? " Small: a bigger box with more detail tracks better." : ""}`;
  }

  // a tracked frame's point on the preview (the green dot follows the strip clicks)
  function showPoint(i) {
    const f = state.track && state.track.frames[i];
    if (!f || !state.preview) return;
    const [w, h] = size();
    dot.hidden = false;
    dot.style.left = `${Math.round((f.x / state.track.width) * w) - 3}px`;
    dot.style.top = `${Math.round((f.y / state.track.height) * h) - 3}px`;
  }

  let drag = null;
  function local(e) {
    try {
      const r = view.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    } catch (err) {
      return [e.offsetX, e.offsetY];
    }
  }
  view.addEventListener("pointerdown", (e) => {
    if (state.busy || !state.preview) return;
    drag = local(e);
    try {
      view.setPointerCapture(e.pointerId);
    } catch (err) { /* the drag still follows inside the picture */ }
  });
  view.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [w, h] = size();
    const [x, y] = local(e);
    const b = TP.boxFrom(drag[0], drag[1], x, y, w, h);
    if (b) {
      state.box = b;
      drawBox();
    }
  });
  const stop = () => {
    if (!drag) return;
    drag = null;
    if (state.box) {
      state.track = null;
      strip.hidden = true;
      stripLine.textContent = "";
      dot.hidden = true;
      say("Box set. Press Track.");
    }
  };
  view.addEventListener("pointerup", stop);
  view.addEventListener("pointercancel", stop);

  // ---- the confidence strip: green sure, yellow unsure, red lost; a click moves the playhead there
  function drawStrip() {
    const t = state.track;
    strip.innerHTML = "";
    if (!t) {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    const n = t.frames.length;
    for (const r of TP.runs(t.frames)) {
      const seg = el("div", "tr-seg");
      seg.style.left = `${(100 * r.from) / n}%`;
      seg.style.width = `${(100 * (r.to - r.from)) / n}%`;
      seg.style.backgroundColor = COLORS[r.state] || COLORS.lost;
      seg.addEventListener("click", () => guarded(async () => {
        const i = r.from;
        const project = await premiere.activeProject();
        const s = state.source;
        await TR.seek(project, TP.toSeq({ start: s.clip.start, inPt: s.clip.inPt, speed: s.clip.speed }, t.frames[i].t));
        showPoint(i);
        say(`Frames ${r.from + 1}-${r.to} of ${n}: ${r.state === "sure" ? "sure" : r.state === "unsure" ? "unsure (check them)" : "lost (no keys there)"}.`);
      }));
      strip.appendChild(seg);
    }
    const mark = el("div", "tr-mark");
    mark.style.left = `${(100 * t.k0) / n}%`;
    strip.appendChild(mark);
    const c = { sure: 0, unsure: 0, lost: 0 };
    for (const f of t.frames) c[f.state] = (c[f.state] || 0) + 1;
    stripLine.textContent = `${n} frames: ${c.sure} sure, ${c.unsure} unsure, ${c.lost} lost. Click a colour to go there.`;
  }

  // ---- buttons
  top.appendChild(button("action", "Load frame", "Shows the selected clip's frame at the playhead, to box the object on.", () => guarded(async () => {
    const project = await premiere.activeProject();
    const s = await TR.readSource(project);
    const p = await engine.trackerFrame({ path: s.clip.path, t: s.t0, width: 640 });
    state.source = s;
    state.preview = p;
    state.box = null;
    state.track = null;
    view.hidden = false;
    dot.hidden = true;
    img.src = `data:image/jpeg;base64,${p.jpeg}`;
    layout();
    drawStrip();
    stripLine.textContent = "";
    boxLine.textContent = "";
    clipLine.textContent = `${s.clip.name} at ${s.at.toFixed(2)} s (V${s.clip.track + 1}${Math.abs(s.clip.speed - 1) > 0.01 ? `, speed ${Math.round(s.clip.speed * 100)} %` : ""}).`;
    say("Drag a box around the object on the picture.");
  })));

  actions.appendChild(button("action", "Track", "Follows the boxed object through the whole clip, forwards and backwards from this frame.", () => guarded(async () => {
    const s = state.source;
    if (!s || !state.box) return say("Load a frame and drag a box around the object first.", "warn");
    const started = await engine.startTracking({ path: s.clip.path, from: s.from, to: s.to, step: s.step, t0: s.t0, box: state.box });
    state.job = started.job;
    setBusy(true);
    for (;;) {
      const j = await engine.job(started.job);
      say(j.message || "Tracking…");
      if (j.state === "done") {
        state.track = j.result;
        break;
      }
      if (j.state === "cancelled") return say("Cancelled. Nothing was changed.");
      if (j.state === "error") return say(j.error || "The tracker stopped.", "warn");
      await new Promise((r) => setTimeout(r, 300));
    }
    drawStrip();
    showPoint(state.track.k0);
    const lost = state.track.frames.filter((f) => f.state === "lost").length;
    say(lost ? `Tracked. ${lost} frames were lost (red): the object was hidden or changed too much there. Attach writes no keys on them.`
      : "Tracked. Put the text where it belongs on the boxed frame, select it and press Attach selected.", lost ? "warn" : "line");
  })));
  const cancel = button("secondary", "Cancel", "Stops the tracking.", async () => {
    if (state.job) await engine.cancel(state.job).catch(() => null);
  });
  cancel.id = "trCancel";
  actions.appendChild(cancel);

  attachRow.appendChild(button("action", "Attach selected", "Gives the selected text, logo or clip Position keys (and Scale / Rotation when ticked) so it follows the tracked object, keeping where you put it on the boxed frame. One Undo step.", () => guarded(async () => {
    if (!state.track) return say("Track the object first.", "warn");
    const project = await premiere.activeProject();
    state.opts = { scale: !!checks.scale.checked, rotation: !!checks.rotation.checked };
    const r = await TR.attach(project, state.source, state.track, state.opts);
    say([`Done: ${r.clip} follows the object, ${r.written} keyframes per property. Cmd/Ctrl+Z takes it back.`, ...r.lines]);
  })));
  attachRow.appendChild(button("secondary", "Detach", "Takes the tracker's keyframes off the selected clip (only those still where the tracker put them).", () => guarded(async () => {
    const project = await premiere.activeProject();
    const r = await TR.detach(project);
    say(r.removed ? `Taken off ${r.clip}: ${r.removed} tracker keyframes.` : "The selected clip has no tracker keyframes.");
  })));

  setBusy(false);
  bindTips(root);

  // the test bridge sets a box as a drag would (the bridge cannot drag)
  return {
    setBox(b) {
      if (!state.preview) throw new Error("Load a frame first.");
      state.box = b;
      state.track = null;
      drawBox();
      return { box: b };
    },
    info() {
      return { source: state.source, box: state.box, preview: state.preview && { w: state.preview.w, h: state.preview.h, width: state.preview.width, height: state.preview.height },
        track: state.track && { n: state.track.frames.length, k0: state.track.k0, states: TP.runs(state.track.frames), first: state.track.frames[0], ref: state.track.frames[state.track.k0] } };
    },
    track() {
      return state.track;
    },
    busy() {
      return state.busy;
    },
    relayout: layout,
  };
}

module.exports = { mount };
