// The Tracker page (COCKPIT_PLAN.md A3; 0.10.51, redesigned 0.10.55 on the user's word "we need a preview of what's being
// tracked, a better timeline that we can go through easily after the thing is tracked, a better UI overall").
// Viewer: the frame with the tracked box, the path (coloured by how sure each frame is) and a readout; live while tracking.
// Timeline: drag to scrub, coloured states, a confidence curve, second marks, the boxed frame; transport buttons step, play
// and jump to the next / previous problem; Premiere's playhead can follow. A bad stretch is fixed by drawing a new box on
// one of its frames and tracking from there (forwards or backwards: only that part is replaced). Then Attach (a text or logo
// follows) or Lock (the clip follows the object). The engine tracks (tracker.py), trackplan.js does the maths,
// premiere-tracker.js reads and writes Premiere.
const TP = require("./trackplan.js");
const TR = require("./premiere-tracker.js");
const engine = require("./engine.js");

const MAX_H = 360;                                   // the viewer is never taller than this (9:16 clips)
const COLORS = { sure: "#3fb950", unsure: "#e3b341", lost: "#d9534f" };
const NS = "http://www.w3.org/2000/svg";
const ICONS = {                                      // 14 x 14, filled with the text colour
  first: "M1 2h2v10H1z M8 2v10L3 7z M13 2v10L8 7z",
  prev: "M8 2v10L2 7z M10 2h2v10h-2z",
  play: "M4 2v10l8-5z",
  pause: "M3 2h3v10H3z M8 2h3v10H8z",
  next: "M2 2h2v10H2z M6 2v10l6-5z",
  last: "M11 2h2v10h-2z M1 2v10l5-5z M6 2v10l5-5z",
  probPrev: "M7 2v10L1 7z M13 2v10L7 7z",
  probNext: "M1 2v10l6-5z M7 2v10l6-5z",
};

function mount({ $, el, button, enable, bindTips, premiere }) {
  const root = $("paneTracker");
  const state = { source: null, preview: null, box: null, boxAt: -1, track: null, thumbs: [], cur: 0, timer: null, job: null,
    busy: false, live: null, mode: "attach", sync: true, lastSeek: 0, timelineW: 0 };
  const checks = {};

  root.innerHTML = "";
  root.appendChild(el("p", "desc", "Follows an object through a clip, as After Effects' tracker does: a text or logo can then " +
    "follow it (Attach), or the clip can follow it like a camera (Lock)."));
  const steps = el("div", "tr-steps");
  root.appendChild(steps);
  const top = el("div", "row buttons");
  root.appendChild(top);
  const clipLine = el("div", "muted", "Select the clip with the moving object, park the playhead on a clear frame, press Load frame.");
  root.appendChild(clipLine);

  // ---- viewer
  const view = el("div", "tr-view");
  view.hidden = true;
  const img = document.createElement("img");
  img.className = "tr-img";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "tr-svg");
  const hud = el("div", "tr-hud", "");
  view.appendChild(img);
  view.appendChild(svg);
  view.appendChild(hud);
  root.appendChild(view);
  const hint = el("div", "muted", "");
  root.appendChild(hint);

  // ---- transport and timeline
  const transport = el("div", "row tr-transport");
  transport.hidden = true;
  root.appendChild(transport);
  const timeline = el("div", "tr-time");
  timeline.hidden = true;
  root.appendChild(timeline);
  const syncRow = el("div", "row options");
  syncRow.hidden = true;
  root.appendChild(syncRow);

  // ---- tracking
  const trackRow = el("div", "row buttons spaced");
  root.appendChild(trackRow);
  const prog = el("div", "tr-prog");
  const bar = el("div", "tr-bar");
  prog.appendChild(bar);
  prog.hidden = true;
  root.appendChild(prog);

  // ---- using the track
  root.appendChild(el("div", "title spaced", "Use the track"));
  const modeRow = el("div", "row tr-modes");
  root.appendChild(modeRow);
  const modeDesc = el("p", "desc", "");
  root.appendChild(modeDesc);
  const optRow = el("div", "row options");
  root.appendChild(optRow);
  const useRow = el("div", "row buttons");
  root.appendChild(useRow);
  const status = el("div", "kf-status");
  root.appendChild(status);

  function say(lines, cls) {
    status.innerHTML = "";
    for (const l of [].concat(lines)) if (l) status.appendChild(el("div", cls || "line", l));
  }

  // ---------------------------------------------------------------- geometry
  function size() {
    const p = state.preview;
    let w = 0;
    try {
      w = root.getBoundingClientRect().width - 4;
    } catch (e) { /* hidden page */ }
    if (!(w > 40)) w = 260;
    const ww = Math.min(w, (MAX_H * p.width) / p.height);
    return [Math.round(ww), Math.round((ww * p.height) / p.width)];
  }

  function svgEl(name, attrs) {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    svg.appendChild(e);
    return e;
  }

  // ---------------------------------------------------------------- drawing
  function drawSteps() {
    const at = !state.preview ? 0 : !state.track ? (state.box ? 2 : 1) : 3;
    steps.innerHTML = "";
    ["1 Load frame", "2 Draw a box", "3 Track", "4 Use"].forEach((t, i) => {
      steps.appendChild(el("span", i === at ? "tr-step on" : i < at ? "tr-step done" : "tr-step", t));
    });
  }

  function frameSrc() {
    if (state.live && state.job) return state.live.jpeg;
    if (state.track && state.thumbs[state.cur]) return state.thumbs[state.cur];
    return state.preview ? state.preview.jpeg : null;
  }

  function drawView() {
    if (!state.preview) {
      view.hidden = true;
      return;
    }
    view.hidden = false;
    const [w, h] = size();
    for (const e of [view, img]) {
      e.style.width = `${w}px`;
      e.style.height = `${h}px`;
    }
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    const src = frameSrc();
    if (src && img.getAttribute("data-src") !== src.slice(-40)) {
      img.src = `data:image/jpeg;base64,${src}`;
      img.setAttribute("data-src", src.slice(-40));
    }
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const k = w / state.preview.width;
    const t = state.track;
    // the path: every tracked point, coloured by run
    if (t && !state.job) {
      for (const r of TP.runs(t.frames)) {
        if (r.state === "lost") continue;
        const pts = [];
        for (let i = Math.max(0, r.from - 1); i < r.to; i++) {
          if (t.frames[i] && t.frames[i].state !== "lost") pts.push(`${(t.frames[i].x * k).toFixed(1)},${(t.frames[i].y * k).toFixed(1)}`);
        }
        if (pts.length > 1) svgEl("polyline", { points: pts.join(" "), fill: "none", stroke: COLORS[r.state], "stroke-width": 1.5, "stroke-opacity": 0.8 });
      }
    }
    // the box on this frame (tracked, or live while tracking)
    const f = state.job && state.live ? state.live : t && !state.job ? t.frames[state.cur] : null;
    const box = t ? t.box : state.box && [state.box[0] * state.preview.width, state.box[1] * state.preview.height,
      state.box[2] * state.preview.width, state.box[3] * state.preview.height];
    if (f && box && f.state !== "lost") {
      const c = TP.corners(f, box).map(([x, y]) => `${(x * k).toFixed(1)},${(y * k).toFixed(1)}`).join(" ");
      svgEl("polygon", { points: c, fill: "none", stroke: COLORS[f.state] || COLORS.sure, "stroke-width": 2 });
      svgEl("line", { x1: f.x * k - 6, y1: f.y * k, x2: f.x * k + 6, y2: f.y * k, stroke: "#ffffff", "stroke-width": 1.5 });
      svgEl("line", { x1: f.x * k, y1: f.y * k - 6, x2: f.x * k, y2: f.y * k + 6, stroke: "#ffffff", "stroke-width": 1.5 });
    } else if (f && f.state === "lost") {
      svgEl("rect", { x: 1.5, y: 1.5, width: w - 3, height: h - 3, fill: "none", stroke: COLORS.lost, "stroke-width": 3 });
    }
    // a box the editor is drawing (a first box, or a fix on the frame shown)
    if (state.box && !state.job && (!t || state.boxAt === state.cur)) {
      svgEl("rect", { x: state.box[0] * w, y: state.box[1] * h, width: state.box[2] * w, height: state.box[3] * h, fill: "none",
        stroke: t ? "#7aa7e6" : COLORS.sure, "stroke-width": 2, "stroke-dasharray": t ? "5 3" : "none" });
    }
    // readout
    if (state.job && state.live) {
      hud.textContent = `Tracking frame ${state.live.k + 1}`;
    } else if (t) {
      const fr = t.frames[state.cur];
      const s = state.source;
      const at = s ? TP.toSeq({ start: s.clip.start, inPt: s.clip.inPt, speed: s.clip.speed }, fr.t) : fr.t;
      hud.textContent = `${state.cur + 1} / ${t.frames.length} · ${at.toFixed(2)} s · ${fr.state === "lost" ? "lost" : `${fr.state} ${Math.round(fr.c * 100)} %`}${fr.fixed ? " · fixed" : ""}`;
    } else {
      hud.textContent = state.box ? "Box set: press Track" : "Drag a box around the object";
    }
  }

  function drawTimeline() {
    const t = state.track;
    transport.hidden = timeline.hidden = syncRow.hidden = !t;
    if (!t) return;
    timeline.innerHTML = "";
    const n = t.frames.length;
    let W = 0;
    try {
      W = timeline.getBoundingClientRect().width;
    } catch (e) { /* hidden */ }
    if (!(W > 40)) W = 260;
    state.timelineW = W;
    const pos = (i) => (n > 1 ? (i / (n - 1)) * (W - 2) + 1 : W / 2);
    const per = (W - 2) / Math.max(1, n - 1);
    for (const r of TP.runs(t.frames)) {
      const seg = el("div", "tr-seg");
      const left = Math.max(0, pos(r.from) - per / 2);
      seg.style.left = `${left}px`;
      seg.style.width = `${Math.max(1, Math.min(W, pos(r.to - 1) + per / 2) - left)}px`;
      seg.style.backgroundColor = COLORS[r.state] || COLORS.lost;
      timeline.appendChild(seg);
    }
    // the confidence curve over the colours (top = sure)
    const g = document.createElementNS(NS, "svg");
    g.setAttribute("class", "tr-curve");
    g.setAttribute("width", W);
    g.setAttribute("height", 22);
    const pl = document.createElementNS(NS, "polyline");
    pl.setAttribute("points", t.frames.map((f, i) => `${pos(i).toFixed(1)},${(2 + 18 * (1 - (f.state === "lost" ? 0 : f.c))).toFixed(1)}`).join(" "));
    pl.setAttribute("fill", "none");
    pl.setAttribute("stroke", "#111111");
    pl.setAttribute("stroke-width", "1.2");
    g.appendChild(pl);
    timeline.appendChild(g);
    for (const tk of TP.ticks(t.frames, state.source ? state.source.clip.inPt : 0)) {
      const m = el("div", "tr-tick", tk.label);
      m.style.left = `${pos(tk.i)}px`;
      timeline.appendChild(m);
    }
    const k0 = el("div", "tr-k0");
    k0.style.left = `${pos(t.k0) - 4}px`;
    timeline.appendChild(k0);
    const ph = el("div", "tr-ph");
    ph.style.left = `${pos(state.cur) - 1}px`;
    timeline.appendChild(ph);
  }

  function redraw() {
    drawSteps();
    drawView();
    drawTimeline();
    drawControls();
  }

  // ---------------------------------------------------------------- moving through the track
  async function seekPremiere(force) {
    const s = state.source;
    const t = state.track;
    if (!state.sync || !s || !t || !t.frames[state.cur]) return;
    const now = Date.now();
    if (!force && now - state.lastSeek < 150) return;
    state.lastSeek = now;
    try {
      const project = await premiere.activeProject();
      await TR.seek(project, TP.toSeq({ start: s.clip.start, inPt: s.clip.inPt, speed: s.clip.speed }, t.frames[state.cur].t) + 0.0005);
    } catch (e) { /* the panel's own view still moves */ }
  }

  function goto(i, final = true) {
    const t = state.track;
    if (!t) return;
    state.cur = Math.max(0, Math.min(t.frames.length - 1, i));
    drawView();
    drawTimeline();
    drawControls();
    seekPremiere(final);
  }

  function stopPlay() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    drawControls();
  }

  function play() {
    const t = state.track;
    if (!t) return;
    if (state.timer) {
      stopPlay();
      seekPremiere(true);
      return;
    }
    if (state.cur >= t.frames.length - 1) state.cur = 0;
    const fps = state.source ? Math.min(60, Math.max(5, state.source.clip.speed / state.source.step)) : 30;
    state.timer = setInterval(() => {
      if (state.cur >= t.frames.length - 1) {
        stopPlay();
        seekPremiere(true);
        return;
      }
      goto(state.cur + 1, false);
    }, 1000 / fps);
    drawControls();
  }

  function setIcon(b, name) {
    b.setAttribute("data-icon", name);
    b.innerHTML = `<svg width="14" height="14"><path d="${ICONS[name]}" fill="${name.startsWith("prob") ? "#e3b341" : "#dddddd"}"/></svg>`;
  }
  function icon(name, tip, fn) {
    const b = button("small tr-icon", "", tip, fn);
    setIcon(b, name);
    return b;
  }
  const playBtn = icon("play", "Play the track (press again to stop).", () => play());
  for (const b of [icon("first", "First frame.", () => goto(0)), icon("prev", "One frame back.", () => goto(state.cur - 1)), playBtn,
    icon("next", "One frame on.", () => goto(state.cur + 1)), icon("last", "Last frame.", () => goto(1e9)),
    icon("probPrev", "The previous unsure or lost stretch.", () => jumpProblem(-1)),
    icon("probNext", "The next unsure or lost stretch.", () => jumpProblem(1))]) transport.appendChild(b);

  function jumpProblem(dir) {
    if (!state.track) return;
    stopPlay();
    const k = TP.problem(state.track.frames, state.cur, dir);
    if (k < 0) return say(dir > 0 ? "No unsure or lost frames after this one." : "No unsure or lost frames before this one.");
    goto(k);
    say(`Frame ${k + 1}: ${state.track.frames[k].state}. To fix it, draw a new box around the object here, then Track from here.`);
  }

  // scrub: press and drag on the timeline
  let scrubbing = false;
  const scrubTo = (e, final) => {
    let x = 0;
    try {
      x = e.clientX - timeline.getBoundingClientRect().left;
    } catch (err) {
      x = e.offsetX;
    }
    const n = state.track.frames.length;
    goto(Math.round(((x - 1) / Math.max(1, (state.timelineW || 260) - 2)) * (n - 1)), final);
  };
  timeline.addEventListener("pointerdown", (e) => {
    if (!state.track || state.job) return;
    stopPlay();
    scrubbing = true;
    try {
      timeline.setPointerCapture(e.pointerId);
    } catch (err) { /* still follows inside */ }
    scrubTo(e, false);
  });
  timeline.addEventListener("pointermove", (e) => {
    if (scrubbing) scrubTo(e, false);
  });
  timeline.addEventListener("pointerup", (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    scrubTo(e, true);
  });
  timeline.addEventListener("pointercancel", () => { scrubbing = false; });

  const sync = document.createElement("input");
  sync.type = "checkbox";
  sync.id = "tr_sync";
  sync.checked = state.sync;
  sync.addEventListener("change", () => { state.sync = sync.checked; });
  const syncLabel = el("label", "tr-opt", "Move Premiere's playhead along");
  syncLabel.setAttribute("for", "tr_sync");
  syncRow.appendChild(sync);
  syncRow.appendChild(syncLabel);

  // drawing a box on the viewer: a first box, or a fix on the frame shown
  let drag = null;
  const local = (e) => {
    try {
      const r = view.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    } catch (err) {
      return [e.offsetX, e.offsetY];
    }
  };
  view.addEventListener("pointerdown", (e) => {
    if (state.busy || !state.preview) return;
    stopPlay();
    drag = local(e);
    try {
      view.setPointerCapture(e.pointerId);
    } catch (err) { /* follows inside */ }
  });
  view.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [w, h] = size();
    const [x, y] = local(e);
    const b = TP.boxFrom(drag[0], drag[1], x, y, w, h);
    if (b) {
      state.box = b;
      state.boxAt = state.track ? state.cur : -1;
      drawView();
    }
  });
  const endDraw = () => {
    if (!drag) return;
    drag = null;
    if (!state.box) return;
    boxHint();
    redraw();
  };
  view.addEventListener("pointerup", endDraw);
  view.addEventListener("pointercancel", endDraw);

  function boxHint() {
    const px = Math.round(state.box[2] * state.preview.width);
    const py = Math.round(state.box[3] * state.preview.height);
    hint.textContent = `Box ${px} x ${py} px.${px < 24 || py < 24 ? " Small: a bigger box with more detail tracks better." : ""}` +
      (state.track ? " Track from here (or back from here) replaces only that part; Track starts again from this frame." : " Press Track.");
  }

  // ---------------------------------------------------------------- engine jobs
  async function runTrack(payload) {
    const started = await engine.startTracking(payload);
    state.job = started.job;
    state.live = null;
    prog.hidden = false;
    bar.style.width = "0%";
    drawControls();
    try {
      for (;;) {
        const j = await engine.job(started.job);
        bar.style.width = `${Math.round(100 * (j.progress || 0))}%`;
        if (j.extra && j.extra.live) {
          state.live = j.extra.live;
          drawView();
        }
        if (j.state === "done") return j.result;
        if (j.state === "cancelled") throw new premiere.UserError("Cancelled. The track is as it was.");
        if (j.state === "error") throw new premiere.UserError(j.error || "The tracker stopped.");
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      state.job = null;
      state.live = null;
      prog.hidden = true;
    }
  }

  async function fetchThumbs(id, from, to) {
    for (let i = from; i < to; i += 120) {
      const r = await engine.trackerThumbs(id, i, Math.min(120, to - i));
      r.items.forEach((x, n) => {
        if (x) state.thumbs[r.from + n] = x;
      });
      if (i === from) drawView();
    }
  }

  async function trackAll() {
    const s = state.source;
    if (!s || !state.box) return say("Load a frame and drag a box around the object first.", "warn");
    const t0 = state.track && state.boxAt >= 0 ? state.track.frames[state.boxAt].t : s.t0;
    const res = await runTrack({ path: s.clip.path, from: s.from, to: s.to, step: s.step, t0, box: state.box });
    Object.assign(state, { track: res, thumbs: [], cur: res.k0, box: null, boxAt: -1 });
    hint.textContent = "";
    redraw();
    await fetchThumbs(res.id, 0, res.frames.length);
    report();
  }

  async function trackPart(dir) {
    const s = state.source;
    const t = state.track;
    if (!t || !state.box || state.boxAt !== state.cur) return say("Go to the frame to fix, draw a new box around the object there, then press this.", "warn");
    const k = state.cur;
    const payload = dir > 0
      ? { path: s.clip.path, from: t.frames[k].t, to: s.to, step: s.step, t0: t.frames[k].t, box: state.box, into: { id: t.id, offset: k } }
      : { path: s.clip.path, from: t.frames[0].t, to: t.frames[k].t + s.step, step: s.step, t0: t.frames[k].t, box: state.box, into: { id: t.id, offset: 0 } };
    const part = await runTrack(payload);
    const offset = dir > 0 ? k : 0;
    state.track = TP.merge(t, part, offset, part.box);
    Object.assign(state, { box: null, boxAt: -1 });
    hint.textContent = "";
    await fetchThumbs(t.id, offset, offset + part.frames.length);
    report(`${dir > 0 ? "From" : "Up to"} frame ${k + 1}: ${part.frames.length} frames tracked again.`);
  }

  function report(first) {
    const c = { sure: 0, unsure: 0, lost: 0 };
    for (const f of state.track.frames) c[f.state] = (c[f.state] || 0) + 1;
    const lines = [first || "Tracked.", `${state.track.frames.length} frames: ${c.sure} sure, ${c.unsure} unsure, ${c.lost} lost.`];
    if (c.lost || c.unsure) lines.push("The double arrows jump to them; draw a new box there and Track from here to fix a stretch.");
    say(lines, c.lost ? "warn" : "line");
  }

  // ---------------------------------------------------------------- buttons
  function setBusy(b) {
    state.busy = b;
    drawControls();
  }

  async function guarded(fn) {
    if (state.busy) return;
    stopPlay();
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      say(e.message || String(e), "warn");
      premiere.debug(`tracker: ${e && e.stack ? e.stack : e}`);
    } finally {
      setBusy(false);
      redraw();
    }
  }

  top.appendChild(button("action", "Load frame", "Shows the selected clip's frame at the playhead, to draw the box on. Starts a new track.", () => guarded(async () => {
    const project = await premiere.activeProject();
    const s = await TR.readSource(project);
    const p = await engine.trackerFrame({ path: s.clip.path, t: s.t0, width: 640 });
    Object.assign(state, { source: s, preview: p, box: null, boxAt: -1, track: null, thumbs: [], cur: 0 });
    clipLine.textContent = `${s.clip.name} at ${s.at.toFixed(2)} s (V${s.clip.track + 1}${Math.abs(s.clip.speed - 1) > 0.01 ? `, speed ${Math.round(s.clip.speed * 100)} %` : ""}).`;
    hint.textContent = "Drag a box around something with detail (a logo, a face, an edge), not a plain area.";
    say("");
  })));

  const trackBtn = button("action", "Track", "Follows the boxed object through the whole clip, forwards and backwards from the boxed frame.", () => guarded(trackAll));
  const cancelBtn = button("secondary", "Cancel", "Stops the tracking (the track stays as it was).", async () => {
    if (state.job) await engine.cancel(state.job).catch(() => null);
  });
  const fromHere = button("secondary", "Track from here", "Tracks again from this frame to the end with the new box you drew here (only that part is replaced).", () => guarded(() => trackPart(1)));
  const backHere = button("secondary", "Track back from here", "Tracks again from this frame back to the start with the new box you drew here (only that part is replaced).", () => guarded(() => trackPart(-1)));
  for (const b of [trackBtn, cancelBtn, fromHere, backHere]) trackRow.appendChild(b);

  for (const [mode, label, tip] of [["attach", "Attach", "A text, logo or clip follows the object."], ["lock", "Lock", "The clip follows the object like a camera."]]) {
    const b = button("small tr-mode", label, tip, () => {
      state.mode = mode;
      drawControls();
    });
    b.setAttribute("data-mode", mode);
    modeRow.appendChild(b);
  }
  for (const [k, label, tip, on] of [["scale", "Scale", "Also grow and shrink with the object.", false],
    ["rotation", "Rotation", "Also turn with the object.", false],
    ["centre", "Centre it", "Puts the object in the middle of the frame instead of where it is now.", false],
    ["smooth", "Smooth", "A calm path through the object's motion (a bouncing ball, a hand-held shot).", false],
    ["zoom", "Zoom", "Scales the clip just enough that the moves never show an edge.", true]]) {
    const c = document.createElement("input");
    c.type = "checkbox";
    c.id = `tr_${k}`;
    c.checked = on;
    checks[k] = c;
    const l = el("label", "tr-opt", label);
    l.setAttribute("for", c.id);
    l.setAttribute("data-tip", tip);
    optRow.appendChild(c);
    optRow.appendChild(l);
  }

  const attachBtn = button("action", "Attach selected", "Gives the selected text, logo or clip Position keys (Scale / Rotation when ticked) so it follows the object, keeping where you put it on the boxed frame. One Undo step.", () => guarded(async () => {
    const project = await premiere.activeProject();
    const r = await TR.attach(project, state.source, state.track, { scale: !!checks.scale.checked, rotation: !!checks.rotation.checked });
    say([`Done: ${r.clip} follows the object, ${r.written} keyframes per property. Cmd/Ctrl+Z takes it back.`, ...r.lines]);
  }));
  const lockBtn = button("action", "Lock to it", "Gives the tracked clip Position keys so the object stays put on screen (and zooms it when Zoom is ticked). One Undo step.", () => guarded(async () => {
    const project = await premiere.activeProject();
    const r = await TR.lockClip(project, state.source, state.track, { centre: !!checks.centre.checked, smooth: !!checks.smooth.checked, zoom: !!checks.zoom.checked });
    say([`Done: ${r.clip} is locked to the object. Cmd/Ctrl+Z takes it back.`, ...r.lines]);
  }));
  const detachBtn = button("secondary", "Detach", "Takes the tracker's keyframes off the selected clip (only those still where the tracker put them).", () => guarded(async () => {
    const project = await premiere.activeProject();
    const r = await TR.detach(project);
    say(r.removed ? `Taken off ${r.clip}: ${r.removed} tracker keyframes.` : "The selected clip has no tracker keyframes.");
  }));
  for (const b of [attachBtn, lockBtn, detachBtn]) useRow.appendChild(b);

  function drawControls() {
    const t = state.track;
    const fixable = !!(t && state.box && state.boxAt === state.cur);
    for (const x of top.children) enable(x, !state.busy);
    enable(trackBtn, !state.busy && !!state.box && !!state.source);
    enable(cancelBtn, !!state.job);
    enable(fromHere, !state.busy && fixable);
    enable(backHere, !state.busy && fixable && state.cur > 0);
    fromHere.hidden = backHere.hidden = !t;
    for (const x of transport.children) enable(x, !state.busy);
    setIcon(playBtn, state.timer ? "pause" : "play");
    for (const x of useRow.children) enable(x, !state.busy && !!t);
    attachBtn.hidden = state.mode !== "attach";
    lockBtn.hidden = state.mode !== "lock";
    for (const [k, c] of Object.entries(checks)) {
      const on = (state.mode === "attach") === (k === "scale" || k === "rotation");
      c.hidden = !on;
      const l = optRow.querySelector(`label[for="${c.id}"]`);
      if (l) l.hidden = !on;
    }
    for (const b of modeRow.children) b.className = `btn small tr-mode${b.getAttribute("data-mode") === state.mode ? " on" : ""}`;
    modeDesc.textContent = state.mode === "attach"
      ? "Put the text, logo or clip where it belongs on the boxed frame, select it and press Attach selected: it follows the object (Scale / Rotation: it also grows and turns with it)."
      : "The tracked clip moves so the object stays where it is on the boxed frame (Centre it: in the middle). Smooth follows it like a camera operator; Zoom scales the clip just enough that no edge shows.";
  }

  redraw();
  bindTips(root);

  // hooks for main.js (relayout when the tab opens) and the test bridge (it cannot drag)
  return {
    setBox(b) {
      if (!state.preview) throw new Error("Load a frame first.");
      state.box = b;
      state.boxAt = state.track ? state.cur : -1;
      boxHint();
      redraw();
      return { box: b, at: state.boxAt };
    },
    goto(i) {
      goto(i);
      return { cur: state.cur };
    },
    mode(m) {
      state.mode = m === "lock" ? "lock" : "attach";
      drawControls();
      return { mode: state.mode };
    },
    info() {
      const t = state.track;
      return { source: state.source, box: state.box, boxAt: state.boxAt, cur: state.cur, mode: state.mode, busy: state.busy,
        preview: state.preview && { w: state.preview.w, h: state.preview.h, width: state.preview.width, height: state.preview.height },
        thumbs: state.thumbs.filter(Boolean).length, hud: hud.textContent, svg: svg.childNodes.length,
        timeline: timeline.childNodes.length, status: status.textContent,
        track: t && { n: t.frames.length, k0: t.k0, id: t.id, states: TP.runs(t.frames), first: t.frames[0], ref: t.frames[t.k0], fixed: t.frames.filter((f) => f.fixed).length } };
    },
    track() {
      return state.track;
    },
    busy() {
      return state.busy;
    },
    relayout: redraw,
    // the browser preview shows the page with a made-up track (no Premiere, no engine)
    demo(d) {
      Object.assign(state, d);
      redraw();
    },
  };
}

module.exports = { mount };
