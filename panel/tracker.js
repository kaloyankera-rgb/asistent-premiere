// The Tracker page (COCKPIT_PLAN.md A3; 0.10.51, redesigned 0.10.55 on the user's word "we need a preview of what's being
// tracked, a better timeline that we can go through easily after the thing is tracked, a better UI overall"; restyled
// 0.10.57 as a dark tracking workspace: "a premium, professional tracking tool", nothing in the tracking changed).
// Layout: the clip and Load frame; the viewer (the frame, the tracked box with corner handles, the path coloured by how sure
// each frame is, live while tracking) with transport and a timeline under it (ruler, coloured states with the confidence as
// the height, the boxed frame, the playhead; drag to scrub; Premiere's playhead can follow); then Track (and fixing a bad
// stretch from a new box: only that part is replaced) and Apply (Attach: a text or logo follows; Lock: the clip follows the
// object). The engine tracks (tracker.py), trackplan.js does the maths, premiere-tracker.js reads and writes Premiere.
// UXP draws an SVG outline only from a style, never from the stroke attribute (CHANGELOG 0.9.71): every shape gets a style.
const TP = require("./trackplan.js");
const TR = require("./premiere-tracker.js");
const engine = require("./engine.js");

const COLORS = { sure: "#3fb950", unsure: "#f0883e", lost: "#e5534b", none: "#5a5d68" };   // none: not tracked (0.10.63)   // the --ok-dot / --unsure / --err-dot tokens (0.10.59: unsure orange, golden marks a selection)
const ACCENT = "#8745a5";                                                  // --accent (Amethyst, 0.10.59)
const SEL = "#ffc945";                                                     // --sel (Golden Yellow): the boxed frame
const NS = "http://www.w3.org/2000/svg";
const TL_H = 44;                                     // timeline: ruler 0-14, lane 17-41
const LANE = [17, 41];
const ICONS = {                                      // 14 x 14, filled with the icon colour (CSS)
  first: "M2 2h1.6v10H2z M12 2.5v9L5 7z",
  prev: "M3 2h1.6v10H3z M12 2.5v9L6 7z",
  play: "M4 2.2v9.6L12 7z",
  pause: "M3.5 2.5h2.4v9H3.5z M8.1 2.5h2.4v9H8.1z",
  next: "M9.4 2H11v10H9.4z M2 2.5v9L8 7z",
  last: "M10.4 2H12v10h-1.6z M2 2.5v9L9 7z",
  probPrev: "M6 3v8L1.5 7z M9 2h2v6.5H9z M9 10h2v2H9z",
  probNext: "M8 3v8l4.5-4z M3 2h2v6.5H3z M3 10h2v2H3z",
};

function mount({ $, el, button, enable, bindTips, premiere }) {
  const root = $("paneTracker");
  const state = { source: null, preview: null, box: null, boxAt: -1, track: null, thumbs: [], cur: 0, timer: null, job: null,
    busy: false, loading: false, live: null, liveLo: -1, liveHi: -1, progress: 0, part: null, mode: "attach", sync: true,
    lastSeek: 0, timelineW: 0, viewW: 0, range: null, rangeDrag: -1 };
  const checks = {};
  const optWrap = {};

  root.innerHTML = "";
  const svgEl = (parent, name, attrs, style) => {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (style) e.setAttribute("style", style);
    parent.appendChild(e);
    return e;
  };
  // a class on or off (by the class string: UXP's classList is not relied on)
  const flag = (node, name, on) => {
    const has = ` ${node.className} `.indexOf(` ${name} `) >= 0;
    if (on && !has) node.className = `${node.className} ${name}`.trim();
    if (!on && has) node.className = ` ${node.className} `.replace(` ${name} `, " ").trim();
  };
  const div = (parent, cls, text) => {
    const e = el("div", cls, text);
    parent.appendChild(e);
    return e;
  };

  // ---- steps and the clip
  const steps = div(root, "row tr-steps");
  steps.setAttribute("data-tip", "Follows an object through a clip, as After Effects' tracker does: a text or logo can then " +
    "follow it (Attach), or the clip can follow it like a camera (Lock).");
  const clipBar = div(root, "row tr-clipbar");
  const clipText = div(clipBar, "tr-cliptext");
  const clipName = div(clipText, "tr-clipname", "No clip loaded");
  const clipLine = div(clipText, "tr-clipmeta", "");
  const top = div(clipBar, "row tr-clipact");

  // ---- the workspace: viewer, transport, timeline
  const work = div(root, "tr-card tr-work");
  const stage = div(work, "row tr-stage");
  const empty = div(stage, "tr-empty");
  const emptyTitle = div(empty, "tr-empty-t", "No frame loaded");
  const emptyText = div(empty, "tr-empty-d", "Select the clip with the moving object, park the playhead on a clear frame, then press Load frame.");
  const view = div(stage, "tr-view");
  view.hidden = true;
  const img = document.createElement("img");
  img.className = "tr-img";
  view.appendChild(img);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "tr-svg");
  view.appendChild(svg);
  const hud = div(view, "row tr-chip tr-hud");                       // the state of the frame shown
  const frameChip = div(view, "tr-chip tr-frame");                   // frame number
  const veil = div(view, "tr-veil", "Loading frame");
  veil.hidden = true;
  const sbar = div(view, "tr-sbar");
  const sfill = div(sbar, "tr-sfill");
  sbar.hidden = true;

  const timeArea = div(work, "tr-timearea");
  const transport = div(timeArea, "row tr-transport");
  const navGroup = div(transport, "row");
  div(transport, "spacer");
  const probGroup = div(transport, "row");
  const timeline = div(timeArea, "tr-time");
  const rangeLine = div(timeArea, "row tr-range");                     // 0.10.63: what will be tracked, the handles' times
  const rangeText = div(rangeLine, "tr-range-l", "");
  div(rangeLine, "spacer");
  const foot = div(timeArea, "row tr-foot");
  const timeText = div(foot, "tr-tc", "");
  const legend = div(foot, "row tr-legend");
  div(foot, "spacer");
  const syncRow = div(foot, "row tr-sync");

  // ---- Track
  const cols = div(root, "tr-cols");                                  // side by side in a wide panel
  const trackCard = div(cols, "tr-card");
  const trackHead = div(trackCard, "row tr-card-h");
  div(trackHead, "tr-card-t", "Track");
  const boxMeta = div(trackHead, "tr-card-m", "");
  const trackRow = div(trackCard, "row tr-btns");
  const hint = div(trackCard, "tr-hint", "");
  const fixHint = div(trackCard, "tr-hint", "To fix a stretch: go to a bad frame, draw a new box there, then Track from here. To go on after Stop: go to the last tracked frame, Track from here.");

  // ---- Apply (Attach / Lock)
  const useCard = div(cols, "tr-card");
  const useHead = div(useCard, "row tr-card-h");
  div(useHead, "tr-card-t", "Apply");
  const modeRow = div(useCard, "row tr-modes");
  const modeDesc = div(useCard, "tr-hint tr-mode-d", "");
  const optRow = div(useCard, "row tr-opts");
  const useRow = div(useCard, "row tr-btns");

  const status = div(root, "tr-msg");
  status.hidden = true;

  function say(lines, cls) {
    status.innerHTML = "";
    const list = [].concat(lines).filter(Boolean);
    status.hidden = !list.length;
    status.className = `tr-msg${cls === "warn" ? " warn" : cls === "err" ? " err" : cls === "ok" ? " ok" : ""}`;
    list.forEach((l, i) => div(status, i ? "tr-msg-l" : "tr-msg-l first", l));
  }

  // ---------------------------------------------------------------- geometry
  function stageWidth() {
    let w = 0;
    try {
      w = stage.getBoundingClientRect().width;
    } catch (e) { /* hidden page */ }
    return w > 40 ? w : 260;
  }

  // the tallest the viewer may be: about half the panel's height, so the timeline and Track stay in sight
  function maxHeight() {
    let H = 0;
    try {
      H = root.parentElement.getBoundingClientRect().height;
    } catch (e) { /* no parent yet */ }
    if (!(H > 120)) return 360;
    return Math.max(200, Math.min(620, Math.round(H * 0.52)));
  }

  function size() {
    const p = state.preview;
    const W = stageWidth();
    const ww = Math.min(W, (maxHeight() * p.width) / p.height);
    return [Math.round(ww), Math.round((ww * p.height) / p.width)];
  }

  // ---------------------------------------------------------------- drawing
  function drawSteps() {
    const at = !state.preview ? 0 : !state.track ? (state.box ? 2 : 1) : 3;
    steps.innerHTML = "";
    ["Load", "Box", "Track", "Apply"].forEach((t, i) => {
      const s = div(steps, i === at ? "tr-step on" : i < at ? "tr-step done" : "tr-step");
      div(s, "tr-step-bar");
      div(s, "tr-step-l", `${i + 1}  ${t}`);
    });
  }

  function frameSrc() {
    if (state.live && state.job) return state.live.jpeg;
    if (state.track && state.thumbs[state.cur]) return state.thumbs[state.cur];
    return state.preview ? state.preview.jpeg : null;
  }

  // a box with a dark edge under it (it shows on light and dark pictures) and small corner handles
  function drawBox(pts, color, dashed) {
    const p = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    svgEl(svg, "polygon", { points: p }, "fill:none;stroke:#000000;stroke-opacity:0.5;stroke-width:3px");
    svgEl(svg, "polygon", { points: p }, `fill:none;stroke:${color};stroke-width:1.5px${dashed ? ";stroke-dasharray:5 3" : ""}`);
    for (const [x, y] of pts) {
      svgEl(svg, "rect", { x: (x - 2.5).toFixed(1), y: (y - 2.5).toFixed(1), width: 5, height: 5 },
        `fill:#141518;stroke:${color};stroke-width:1px`);
    }
  }

  // the tracked point: four short arms with a gap in the middle, so the point itself stays visible
  function crosshair(x, y) {
    for (const under of [true, false]) {
      const st = under ? "stroke:#000000;stroke-opacity:0.55;stroke-width:3px" : "stroke:#ffffff;stroke-width:1.2px";
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        svgEl(svg, "line", { x1: (x + dx * 2.5).toFixed(1), y1: (y + dy * 2.5).toFixed(1), x2: (x + dx * 8).toFixed(1), y2: (y + dy * 8).toFixed(1) }, st);
      }
    }
  }

  function chip(node, text, color) {
    node.innerHTML = "";
    if (!text) {
      node.hidden = true;
      return;
    }
    node.hidden = false;
    if (color) {
      const d = div(node, "tr-dot");
      d.style.backgroundColor = color;
    }
    div(node, "tr-chip-l", text);
  }

  function drawView() {
    const p = state.preview;
    empty.hidden = !!p;
    view.hidden = !p;
    if (!p) {
      stage.style.height = "";
      emptyTitle.textContent = state.loading ? "Loading frame" : "No frame loaded";
      emptyText.hidden = state.loading;
      return;
    }
    const [w, h] = size();
    state.viewW = stageWidth();
    stage.style.height = `${h}px`;
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
    const k = w / p.width;
    const t = state.track;
    // the path: every tracked point, coloured by run
    if (t && !state.job) {
      for (const r of TP.runs(t.frames)) {
        if (r.state === "lost" || r.state === "none") continue;
        const pts = [];
        for (let i = Math.max(0, r.from - 1); i < r.to; i++) {
          if (TP.usable(t.frames[i])) pts.push(`${(t.frames[i].x * k).toFixed(1)},${(t.frames[i].y * k).toFixed(1)}`);
        }
        if (pts.length > 1) svgEl(svg, "polyline", { points: pts.join(" ") }, `fill:none;stroke:${COLORS[r.state]};stroke-width:1.25px;stroke-opacity:0.75`);
      }
    }
    // the box on this frame (tracked, or live while tracking)
    const f = state.job && state.live ? state.live : t && !state.job ? t.frames[state.cur] : null;
    const box = t ? t.box : state.box && [state.box[0] * p.width, state.box[1] * p.height, state.box[2] * p.width, state.box[3] * p.height];
    if (f && box && f.state !== "lost" && f.state !== "none") {
      drawBox(TP.corners(f, box).map(([x, y]) => [x * k, y * k]), COLORS[f.state] || COLORS.sure, false);
      crosshair(f.x * k, f.y * k);
    } else if (f && f.state === "lost") {
      svgEl(svg, "rect", { x: 1, y: 1, width: w - 2, height: h - 2 }, `fill:none;stroke:${COLORS.lost};stroke-width:2px`);
    }
    // a box the editor is drawing (a first box, or a fix on the frame shown)
    if (state.box && !state.job && (!t || state.boxAt === state.cur)) {
      const [x, y, bw, bh] = [state.box[0] * w, state.box[1] * h, state.box[2] * w, state.box[3] * h];
      drawBox([[x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]], ACCENT, !!t);
    }
    // readouts: the state of this frame (left), the frame number (right), a thin progress line while tracking
    veil.hidden = !state.loading;
    sbar.hidden = !state.job;
    sfill.style.width = `${Math.round(100 * state.progress)}%`;
    if (state.job) {
      chip(hud, state.live ? `Tracking  ${Math.round(100 * state.progress)} %` : "Starting", ACCENT);
      chip(frameChip, state.live ? `${state.live.k + 1}` : "");
    } else if (t) {
      const fr = t.frames[state.cur];
      chip(hud, fr.state === "none" ? "Not tracked" : fr.state === "lost" ? "Lost" : `${fr.state === "sure" ? "Sure" : "Unsure"}  ${Math.round(fr.c * 100)} %${fr.fixed ? "  ·  fixed" : ""}`, COLORS[fr.state]);
      chip(frameChip, `${state.cur + 1} / ${t.frames.length}`);
    } else {
      chip(hud, state.box ? "Box set: press Track" : "Drag a box around the object", state.box ? ACCENT : null);
      chip(frameChip, "");
    }
  }

  // frames of the clip being tracked for the first time (the engine's count, tracker.py track()), to show its progress
  function pendingCount() {
    const s = state.source;
    return s ? Math.max(1, Math.floor((s.to - s.from) / s.step + 1e-6)) : 0;
  }

  function drawTimeline() {
    const t = state.track;
    const n = t ? t.frames.length : state.source ? pendingCount() : 0;
    timeArea.hidden = !n;
    transport.hidden = foot.hidden = !t;
    rangeLine.hidden = !n || !state.range;
    if (!n) return;
    if (!state.range) state.range = [0, n - 1];
    timeline.innerHTML = "";
    let W = 0;
    try {
      W = timeline.getBoundingClientRect().width;
    } catch (e) { /* hidden */ }
    if (!(W > 40)) W = 260;
    state.timelineW = W;
    const pos = (i) => (n > 1 ? (i / (n - 1)) * (W - 2) + 1 : W / 2);
    const per = (W - 2) / Math.max(1, n - 1);
    const g = document.createElementNS(NS, "svg");
    g.setAttribute("class", "tr-tl");
    g.setAttribute("width", W);
    g.setAttribute("height", TL_H);
    timeline.appendChild(g);
    const [y0, y1] = LANE;
    // the ruler: a mark every frame when there is room, else every 2 / 5 / 10 ... frames
    const every = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((e) => e * per >= 5) || 600;
    const minor = [];
    for (let i = 0; i < n; i += every) minor.push(`M${pos(i).toFixed(1)} 11V14`);
    svgEl(g, "path", { d: minor.join(" ") }, "fill:none;stroke:#3a3d45;stroke-width:1px");
    svgEl(g, "rect", { x: 0, y: y0, width: W, height: y1 - y0 }, "fill:#202228");             // untracked: muted
    if (t) {
      for (const r of TP.runs(t.frames)) {
        if (r.state === "none") continue;                                  // not tracked: the muted lane shows through
        const a = Math.max(0, pos(r.from) - per / 2);
        const b = Math.min(W, pos(r.to - 1) + per / 2);
        const c = COLORS[r.state] || COLORS.lost;
        if (r.state === "lost") {
          svgEl(g, "rect", { x: a.toFixed(1), y: y0, width: Math.max(1, b - a).toFixed(1), height: y1 - y0 }, `fill:${c};fill-opacity:0.6`);
          continue;
        }
        // the run's band, and its confidence as the height of the colour (top = certain)
        svgEl(g, "rect", { x: a.toFixed(1), y: y0, width: Math.max(1, b - a).toFixed(1), height: y1 - y0 }, `fill:${c};fill-opacity:0.14`);
        const top = [];
        for (let i = r.from; i < r.to; i++) {
          const yc = y1 - (y1 - y0) * Math.max(0.06, Math.min(1, t.frames[i].c || 0));
          top.push(`${(i === r.from ? a : i === r.to - 1 ? b : pos(i)).toFixed(1)},${yc.toFixed(1)}`);
        }
        if (top.length === 1) top.push(`${b.toFixed(1)},${top[0].split(",")[1]}`);
        svgEl(g, "polygon", { points: `${a.toFixed(1)},${y1} ${top.join(" ")} ${b.toFixed(1)},${y1}` }, `fill:${c};fill-opacity:0.7`);
      }
      for (const tk of TP.ticks(t.frames, state.source ? state.source.clip.inPt : 0)) {
        svgEl(g, "line", { x1: pos(tk.i).toFixed(1), y1: 6, x2: pos(tk.i).toFixed(1), y2: 14 }, "stroke:#5a5d68;stroke-width:1px");
        const m = div(timeline, "tr-tick", tk.label);
        m.style.left = `${Math.min(W - 18, pos(tk.i) + 3)}px`;
      }
    }
    // tracking now: what is done so far (the first track) or the part being tracked again, and where the tracker is
    if (state.job) {
      const lo = state.part ? state.part[0] : state.liveLo;
      const hi = state.part ? state.part[1] : state.liveHi;
      if (lo >= 0 && hi >= lo) {
        svgEl(g, "rect", { x: pos(lo).toFixed(1), y: y0, width: Math.max(1, pos(hi) - pos(lo)).toFixed(1), height: y1 - y0 },
          `fill:${ACCENT};fill-opacity:${state.part ? 0.22 : 0.45}`);
      }
      if (state.live && state.live.k < n) {
        svgEl(g, "line", { x1: pos(state.live.k).toFixed(1), y1: y0 - 2, x2: pos(state.live.k).toFixed(1), y2: y1 + 2 }, `stroke:${ACCENT};stroke-width:2px`);
      }
    }
    // the range to track (0.10.63): outside it darker, a golden handle at each end (drag them; Premiere's playhead follows)
    const [ra, rb] = state.range;
    const xa = Math.max(0, pos(ra) - per / 2);
    const xb = Math.min(W, pos(rb) + per / 2);
    if (xa > 0) svgEl(g, "rect", { x: 0, y: y0, width: xa.toFixed(1), height: y1 - y0 }, "fill:#000000;fill-opacity:0.45");
    if (xb < W) svgEl(g, "rect", { x: xb.toFixed(1), y: y0, width: (W - xb).toFixed(1), height: y1 - y0 }, "fill:#000000;fill-opacity:0.45");
    for (const [x, dir] of [[xa, 1], [xb, -1]]) {
      svgEl(g, "rect", { x: (dir > 0 ? x : x - 2).toFixed(1), y: y0 - 3, width: 2, height: y1 - y0 + 6 }, `fill:${SEL}`);
      const tip = dir > 0 ? x + 2 : x - 2;
      svgEl(g, "polygon", { points: `${tip.toFixed(1)},${y0 - 3} ${(tip + dir * 5).toFixed(1)},${y0 - 3} ${tip.toFixed(1)},${y0 + 3}` }, `fill:${SEL}`);
    }
    rangeText.textContent = rangeLabel();
    // the boxed frame
    const k0 = t ? t.k0 : state.source ? Math.round((state.source.t0 - state.source.from) / state.source.step) : -1;
    if (k0 >= 0 && k0 < n) {
      const x = pos(k0);
      svgEl(g, "polygon", { points: `${x.toFixed(1)},${y0 - 6} ${(x + 3.5).toFixed(1)},${y0 - 2.5} ${x.toFixed(1)},${y0 + 1} ${(x - 3.5).toFixed(1)},${y0 - 2.5}` },
        `fill:${SEL};stroke:#141518;stroke-width:1px`);
    }
    // the playhead
    if (t && !state.job) {
      const x = pos(state.cur);
      svgEl(g, "line", { x1: x.toFixed(1), y1: 2, x2: x.toFixed(1), y2: TL_H }, "stroke:#ffffff;stroke-width:1.5px");
      svgEl(g, "polygon", { points: `${(x - 4).toFixed(1)},0 ${(x + 4).toFixed(1)},0 ${(x + 4).toFixed(1)},4 ${x.toFixed(1)},8 ${(x - 4).toFixed(1)},4` },
        "fill:#ffffff");
    }
    // under the timeline: the time of this frame, how many frames are in each state, Premiere's playhead
    if (t) {
      const fr = t.frames[state.cur];
      const s = state.source;
      const at = s ? TP.toSeq({ start: s.clip.start, inPt: s.clip.inPt, speed: s.clip.speed }, fr.t) : fr.t;
      timeText.textContent = `${at.toFixed(2)} s`;
      const c = { sure: 0, unsure: 0, lost: 0, none: 0 };
      for (const x of t.frames) c[x.state] = (c[x.state] || 0) + 1;
      legend.innerHTML = "";
      for (const st of ["sure", "unsure", "lost"]) {
        const it = div(legend, `row tr-leg${c[st] ? "" : " none"}`);
        it.setAttribute("data-tip", `${c[st]} ${st} frames${st === "sure" ? "" : ": the arrows on the right jump to them"}.`);
        const d = div(it, "tr-dot");
        d.style.backgroundColor = COLORS[st];
        div(it, "tr-leg-l", String(c[st]));
      }
      bindTips(legend);
    }
  }

  function redraw() {
    drawSteps();
    drawView();
    drawTimeline();
    drawControls();
  }

  // the panel was made wider or narrower: the viewer and the timeline are drawn again for the new width (the box always
  // stays on the object: the picture and its overlay share one size in pixels)
  function relayoutIfResized() {
    if (root.hidden) return;
    const w = stageWidth();
    let tw = 0;
    try {
      tw = timeline.getBoundingClientRect().width;
    } catch (e) { /* hidden */ }
    if ((state.preview && Math.abs(w - state.viewW) > 1) || (tw > 40 && Math.abs(tw - state.timelineW) > 1)) {
      drawView();
      drawTimeline();
    }
  }
  let resizeTimer = null;
  try {
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(relayoutIfResized, 80);
    });
  } catch (e) { /* no window events: the mouse check below */ }
  root.addEventListener("mouseenter", relayoutIfResized);

  // ---------------------------------------------------------------- moving through the track
  async function seekPremiere(force, frame) {
    const s = state.source;
    const t = state.track;
    const i = frame === undefined ? state.cur : frame;
    if (!state.sync || !s || (frame === undefined && (!t || !t.frames[i]))) return;
    const now = Date.now();
    if (!force && now - state.lastSeek < 150) return;
    state.lastSeek = now;
    try {
      const project = await premiere.activeProject();
      await TR.seek(project, TP.toSeq({ start: s.clip.start, inPt: s.clip.inPt, speed: s.clip.speed }, s.from + i * s.step) + 0.0005);
    } catch (e) { /* the panel's own view still moves */ }
  }

  // 0.10.63: "Track 1.20-4.80 s (108 frames)", in the sequence's time
  function rangeLabel() {
    const s = state.source;
    if (!s || !state.range) return "";
    const at = (i) => TP.toSeq({ start: s.clip.start, inPt: s.clip.inPt, speed: s.clip.speed }, s.from + i * s.step);
    const [a, b] = state.range;
    const all = a === 0 && b === pendingCount() - 1;
    return `${all ? "Track the whole clip" : "Track"} ${at(a).toFixed(2)}-${at(b + 1).toFixed(2)} s  ·  ${b - a + 1} frames` +
      (all ? "  ·  drag the golden handles to track a part" : "");
  }

  function setRange(a, b) {
    const n = pendingCount();
    a = Math.max(0, Math.min(n - 1, Math.round(a)));
    b = Math.max(0, Math.min(n - 1, Math.round(b)));
    state.range = a <= b ? [a, b] : [b, a];
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
    b.innerHTML = `<svg class="tr-ico" width="14" height="14" viewBox="0 0 14 14"><path d="${ICONS[name]}"/></svg>`;
  }
  function icon(name, tip, fn) {
    const b = button("small tr-icon", "", tip, fn);
    setIcon(b, name);
    return b;
  }
  const playBtn = icon("play", "Play the track (press again to stop).", () => play());
  playBtn.className += " tr-play";
  for (const b of [icon("first", "First frame.", () => goto(0)), icon("prev", "One frame back.", () => goto(state.cur - 1)), playBtn,
    icon("next", "One frame on.", () => goto(state.cur + 1)), icon("last", "Last frame.", () => goto(1e9))]) navGroup.appendChild(b);
  for (const b of [icon("probPrev", "The previous unsure or lost stretch.", () => jumpProblem(-1)),
    icon("probNext", "The next unsure or lost stretch.", () => jumpProblem(1))]) {
    b.className += " tr-prob";
    probGroup.appendChild(b);
  }

  function jumpProblem(dir) {
    if (!state.track) return;
    stopPlay();
    const k = TP.problem(state.track.frames, state.cur, dir);
    if (k < 0) return say(dir > 0 ? "No unsure or lost frames after this one." : "No unsure or lost frames before this one.");
    goto(k);
    say(`Frame ${k + 1} is ${state.track.frames[k].state}. To fix it, draw a new box around the object here, then Track from here.`);
  }

  // scrub: press and drag on the timeline
  let scrubbing = false;
  const xOf = (e) => {
    try {
      return e.clientX - timeline.getBoundingClientRect().left;
    } catch (err) {
      return e.offsetX;
    }
  };
  const frameAt = (x, n) => Math.round(((x - 1) / Math.max(1, (state.timelineW || 260) - 2)) * (n - 1));
  const scrubTo = (e, final) => {
    const x = xOf(e);
    if (state.rangeDrag >= 0) {                                          // a golden handle: the range, and Premiere follows
      const n = pendingCount();
      const k = Math.max(0, Math.min(n - 1, frameAt(x, n)));
      const r = state.range.slice();
      r[state.rangeDrag] = k;
      if (r[0] > r[1]) r[state.rangeDrag] = r[1 - state.rangeDrag];
      state.range = r;
      drawTimeline();
      seekPremiere(final, k);
      return;
    }
    goto(frameAt(x, state.track.frames.length), final);
  };
  timeline.addEventListener("pointerdown", (e) => {
    if (state.job || !state.source || !state.range) return;
    const n = pendingCount();
    const W = state.timelineW || 260;
    const per = (W - 2) / Math.max(1, n - 1);
    const px = (i) => (n > 1 ? (i / (n - 1)) * (W - 2) + 1 : W / 2);
    const x = xOf(e);
    const da = Math.abs(x - (px(state.range[0]) - per / 2));
    const db = Math.abs(x - (px(state.range[1]) + per / 2));
    state.rangeDrag = Math.min(da, db) <= 8 ? (da <= db ? 0 : 1) : -1;
    if (state.rangeDrag < 0 && !state.track) return;
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
    state.rangeDrag = -1;
  });
  timeline.addEventListener("pointercancel", () => {
    scrubbing = false;
    state.rangeDrag = -1;
  });

  const sync = document.createElement("input");
  sync.type = "checkbox";
  sync.id = "tr_sync";
  sync.checked = state.sync;
  sync.addEventListener("change", () => { state.sync = sync.checked; });
  const syncLabel = el("label", "tr-opt", "Sync Premiere");
  syncLabel.setAttribute("for", "tr_sync");
  syncLabel.setAttribute("data-tip", "Moves Premiere's playhead along when you step or scrub here.");
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
    boxMeta.textContent = `Box ${px} × ${py} px`;
    hint.textContent = (px < 24 || py < 24 ? "Small box: a bigger one with more detail tracks better. " : "") +
      (state.track ? "Track from here (or back from here) redoes only that part; Track starts again from this frame." : "");
  }

  // ---------------------------------------------------------------- engine jobs
  async function runTrack(payload) {
    const started = await engine.startTracking(payload);
    Object.assign(state, { job: started.job, live: null, liveLo: -1, liveHi: -1, progress: 0 });
    redraw();
    try {
      for (;;) {
        const j = await engine.job(started.job);
        state.progress = j.progress || 0;
        if (j.extra && j.extra.live) {
          state.live = j.extra.live;
          const k = state.live.k;
          state.liveLo = state.liveLo < 0 ? k : Math.min(state.liveLo, k);
          state.liveHi = Math.max(state.liveHi, k);
        }
        drawView();
        drawTimeline();
        if (j.state === "done") return j.result;                          // also after Stop: what was tracked
        if (j.state === "cancelled") throw new premiere.UserError("Cancelled. The track is as it was.");
        if (j.state === "error") throw new premiere.UserError(j.error || "The tracker stopped.");
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      Object.assign(state, { job: null, live: null, part: null, progress: 0 });
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
    if (!state.range) state.range = [0, pendingCount() - 1];
    const kb = Math.round((t0 - s.from) / s.step);
    if (kb < state.range[0] || kb > state.range[1]) return say("The boxed frame is outside the range to track: drag a golden handle past it.", "warn");
    const res = await runTrack({ path: s.clip.path, from: s.from, to: s.to, step: s.step, t0, box: state.box, range: state.range });
    Object.assign(state, { track: res, thumbs: [], cur: res.k0, box: null, boxAt: -1 });
    hint.textContent = "";
    redraw();
    await fetchThumbs(res.id, res.range ? res.range[0] : 0, res.range ? res.range[1] + 1 : res.frames.length);
    report(res.stopped ? "Stopped: what was tracked is kept." : "");
  }

  // 0.10.63: from a frame with a new box (a fix), or on from a tracked frame with the box the tracker had there (to go on
  // after Stop or past the range), up to the range's end (forwards) or start (backwards); only that part is replaced
  async function trackPart(dir) {
    const s = state.source;
    const t = state.track;
    const k = state.cur;
    const drawn = !!(state.box && state.boxAt === k);
    if (!t || (!drawn && !TP.usable(t.frames[k]))) {
      return say("This frame is not tracked: draw a box around the object here, then press this.", "warn");
    }
    const [ra, rb] = state.range || [0, t.frames.length - 1];
    const range = dir > 0 ? [k, Math.max(k + 1, rb)] : [Math.min(ra, k - 1), k];
    if (range[0] < 0 || range[1] > t.frames.length - 1) return say(dir > 0 ? "This is the clip's last frame." : "This is the clip's first frame.", "warn");
    const box = drawn ? state.box : TP.boxAt(t, t.frames[k]);
    state.part = range;
    const part = await runTrack({ path: s.clip.path, from: s.from, to: s.to, step: s.step, t0: t.frames[k].t, box, range, into: { id: t.id, offset: 0 } });
    state.track = TP.merge(t, part, 0, drawn ? part.box : null);
    Object.assign(state, { box: null, boxAt: -1 });
    hint.textContent = "";
    await fetchThumbs(t.id, range[0], range[1] + 1);
    const got = part.frames.filter((f) => f.state !== "none").length;
    report(`${part.stopped ? "Stopped: " : ""}${dir > 0 ? "From" : "Back from"} frame ${k + 1}: ${got} frames tracked${drawn ? " again" : ""}.`);
  }

  function report(first) {
    const c = { sure: 0, unsure: 0, lost: 0, none: 0 };
    for (const f of state.track.frames) c[f.state] = (c[f.state] || 0) + 1;
    const lines = [first || "Tracked.", `${state.track.frames.length - c.none} frames: ${c.sure} sure, ${c.unsure} unsure, ${c.lost} lost.` +
      (c.none ? ` ${c.none} not tracked (outside the range or after Stop): go to the last tracked frame and press Track from here to go on.` : "")];
    if (c.lost || c.unsure) lines.push("The arrows at the right of the transport jump to them; draw a new box there and Track from here to fix a stretch.");
    say(lines, c.lost ? "warn" : "ok");
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
      const m = e.message || String(e);
      say(m, /^Cancelled/.test(m) ? "" : "err");
      premiere.debug(`tracker: ${e && e.stack ? e.stack : e}`);
    } finally {
      setBusy(false);
      redraw();
    }
  }

  const loadBtn = button("action", "Load frame", "Shows the selected clip's frame at the playhead, to draw the box on. Starts a new track.", () => guarded(async () => {
    state.loading = true;
    drawView();
    try {
      const project = await premiere.activeProject();
      const s = await TR.readSource(project);
      const p = await engine.trackerFrame({ path: s.clip.path, t: s.t0, width: 640 });
      Object.assign(state, { source: s, preview: p, box: null, boxAt: -1, track: null, thumbs: [], cur: 0, range: null });
      clipName.textContent = s.clip.name;
      clipLine.textContent = `${s.at.toFixed(2)} s  ·  V${s.clip.track + 1}${Math.abs(s.clip.speed - 1) > 0.01 ? `  ·  speed ${Math.round(s.clip.speed * 100)} %` : ""}  ·  ${p.width} × ${p.height}`;
      boxMeta.textContent = "";
      hint.textContent = "Drag a box around something with detail (a logo, a face, an edge), not a plain area.";
      say("");
    } finally {
      state.loading = false;
    }
  }));
  top.appendChild(loadBtn);

  const trackBtn = button("action", "Track", "Follows the boxed object through the range (the golden handles; the whole clip unless you moved them), forwards then backwards from the boxed frame. Stop ends it when you want and keeps what is tracked.", () => guarded(trackAll));
  const cancelBtn = button("", "Stop", "Stops the tracking now and keeps every frame tracked so far.", async () => {
    if (state.job) await engine.stop(state.job).catch(() => null);
  });
  const fromHere = button("", "Track from here", "Tracks from this frame to the range's end: with a new box you drew here (a fix), or on from where the tracker was (after Stop). Only that part is replaced.", () => guarded(() => trackPart(1)));
  const backHere = button("", "Track back from here", "Tracks from this frame back to the range's start: with a new box you drew here, or on from where the tracker was. Only that part is replaced.", () => guarded(() => trackPart(-1)));
  for (const b of [trackBtn, cancelBtn, fromHere, backHere]) trackRow.appendChild(b);

  const MODE_TEXT = {
    attach: ["A selected text, logo or clip follows the object.",
      "Put the text, logo or clip where it belongs on the boxed frame, select it and press Attach selected: it follows the object (Scale / Rotation: it also grows and turns with it)."],
    lock: ["The tracked clip moves so the object stays put, like a camera.",
      "The tracked clip moves so the object stays where it is on the boxed frame (Centre it: in the middle). Smooth follows it like a camera operator; Zoom scales the clip just enough that no edge shows."],
  };
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
    const w = div(optRow, "row tr-optw");
    w.setAttribute("data-tip", tip);
    const c = document.createElement("input");
    c.type = "checkbox";
    c.id = `tr_${k}`;
    c.checked = on;
    checks[k] = c;
    optWrap[k] = w;
    const l = el("label", "tr-opt", label);
    l.setAttribute("for", c.id);
    w.appendChild(c);
    w.appendChild(l);
  }

  const attachBtn = button("action", "Attach selected", "Gives the selected text, logo or clip Position keys (Scale / Rotation when ticked) so it follows the object, keeping where you put it on the boxed frame. One Undo step.", () => guarded(async () => {
    const project = await premiere.activeProject();
    const r = await TR.attach(project, state.source, state.track, { scale: !!checks.scale.checked, rotation: !!checks.rotation.checked });
    say([`Done: ${r.clip} follows the object, ${r.written} keyframes per property. Cmd/Ctrl+Z takes it back.`, ...r.lines], "ok");
  }));
  const lockBtn = button("action", "Lock to it", "Gives the tracked clip Position keys so the object stays put on screen (and zooms it when Zoom is ticked). One Undo step.", () => guarded(async () => {
    const project = await premiere.activeProject();
    const r = await TR.lockClip(project, state.source, state.track, { centre: !!checks.centre.checked, smooth: !!checks.smooth.checked, zoom: !!checks.zoom.checked });
    say([`Done: ${r.clip} is locked to the object. Cmd/Ctrl+Z takes it back.`, ...r.lines], "ok");
  }));
  const detachBtn = button("", "Detach", "Takes the tracker's keyframes off the selected clip (only those still where the tracker put them).", () => guarded(async () => {
    const project = await premiere.activeProject();
    const r = await TR.detach(project);
    say(r.removed ? `Taken off ${r.clip}: ${r.removed} tracker keyframes.` : "The selected clip has no tracker keyframes.");
  }));
  for (const b of [attachBtn, lockBtn, detachBtn]) useRow.appendChild(b);

  // the next step's button is the one in the accent colour; the others are quiet
  function hot() {
    if (state.busy) return null;
    if (!state.preview) return loadBtn;
    if (!state.track) return state.box ? trackBtn : null;
    if (state.box && state.boxAt === state.cur) return fromHere;
    const fr = state.track.frames;
    // after Stop or a range: going on is the next step only at the edge of what is tracked
    const edge = TP.usable(fr[state.cur]) && fr[state.cur + 1] && fr[state.cur + 1].state === "none";
    if (edge) return fromHere;
    return state.mode === "attach" ? attachBtn : lockBtn;
  }

  function drawControls() {
    const t = state.track;
    const fixable = !!(t && ((state.box && state.boxAt === state.cur) || TP.usable(t.frames[state.cur])));
    enable(loadBtn, !state.busy);
    enable(trackBtn, !state.busy && !!state.box && !!state.source);
    enable(cancelBtn, !!state.job);
    enable(fromHere, !state.busy && fixable);
    enable(backHere, !state.busy && fixable && state.cur > 0);
    fromHere.hidden = backHere.hidden = !t;
    fixHint.hidden = !t || !!state.box || !!state.job;
    cancelBtn.hidden = !state.job;
    for (const x of [...navGroup.children, ...probGroup.children]) enable(x, !state.busy);
    setIcon(playBtn, state.timer ? "pause" : "play");
    for (const x of useRow.children) enable(x, !state.busy && !!t);
    attachBtn.hidden = state.mode !== "attach";
    lockBtn.hidden = state.mode !== "lock";
    for (const [k, w] of Object.entries(optWrap)) w.hidden = (state.mode === "attach") !== (k === "scale" || k === "rotation");
    for (const b of modeRow.children) b.className = `btn small tr-mode${b.getAttribute("data-mode") === state.mode ? " on" : ""}`;
    modeDesc.textContent = MODE_TEXT[state.mode][0];
    modeDesc.setAttribute("data-tip", MODE_TEXT[state.mode][1]);
    const h = hot();
    const part = state.part;
    for (const b of [loadBtn, trackBtn, cancelBtn, fromHere, backHere, attachBtn, lockBtn, detachBtn]) {
      flag(b, "tr-hot", b === h);
      flag(b, "tr-loading", (b === loadBtn && state.loading) || (b === trackBtn && !!state.job && !part) ||
        (!!part && ((b === fromHere && part[0] > 0) || (b === backHere && part[0] === 0))));
    }
    flag(useCard, "tr-off", !t);
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
    range(a, b) {
      if (!state.source) throw new Error("Load a frame first.");
      setRange(a, b);
      drawTimeline();
      return { range: state.range, label: rangeLabel() };
    },
    mode(m) {
      state.mode = m === "lock" ? "lock" : "attach";
      drawControls();
      return { mode: state.mode };
    },
    info() {
      const t = state.track;
      return { source: state.source, box: state.box, boxAt: state.boxAt, cur: state.cur, mode: state.mode, busy: state.busy, range: state.range, rangeText: rangeText.textContent,
        preview: state.preview && { w: state.preview.w, h: state.preview.h, width: state.preview.width, height: state.preview.height },
        thumbs: state.thumbs.filter(Boolean).length, hud: hud.textContent, frame: frameChip.textContent, svg: svg.childNodes.length,
        view: { w: Number(svg.getAttribute("width")) || 0, h: Number(svg.getAttribute("height")) || 0, stage: Math.round(stageWidth()) },
        timeline: timeline.childNodes.length, timelineW: state.timelineW, status: status.textContent,
        track: t && { n: t.frames.length, k0: t.k0, id: t.id, states: TP.runs(t.frames), stopped: !!t.stopped, first: t.frames[0], ref: t.frames[t.k0], fixed: t.frames.filter((f) => f.fixed).length } };
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
      if (d.source) {
        clipName.textContent = d.source.clip.name;
        clipLine.textContent = `${d.source.at.toFixed(2)} s  ·  V${d.source.clip.track + 1}  ·  ${d.preview ? `${d.preview.width} × ${d.preview.height}` : ""}`;
      }
      redraw();
    },
  };
}

module.exports = { mount };
