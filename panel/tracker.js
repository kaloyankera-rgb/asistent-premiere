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
  move: "M7 0.5L9.6 3.4H7.8V6.2H10.6V4.4L13.5 7L10.6 9.6V7.8H7.8V10.6H9.6L7 13.5L4.4 10.6H6.2V7.8H3.4V9.6L0.5 7L3.4 4.4V6.2H6.2V3.4H4.4Z",   // 0.10.74 Move
};

// 0.10.77: let go of a captured pointer by hand (UXP seemed to keep it after the release, and the next presses on the
// page's buttons went here)
const release = (node, e) => {
  try {
    if (e && e.pointerId !== undefined) node.releasePointerCapture(e.pointerId);
  } catch (err) { /* not captured */ }
};

function mount({ $, el, button, enable, bindTips, premiere }) {
  const root = $("paneTracker");
  const state = { source: null, preview: null, box: null, boxAt: -1, track: null, thumbs: [], cur: 0, timer: null, job: null,
    busy: false, loading: false, live: null, liveLo: -1, liveHi: -1, progress: 0, part: null, mode: "attach", sync: true,
    lastSeek: 0, timelineW: 0, viewW: 0, range: null, rangeDrag: -1, zoom: { z: 1, cx: 0.5, cy: 0.5 }, hand: false,
    project: "", saved: { open: false, all: false, items: [], ask: null, note: "" } };          // saved tracks (0.10.152)
  let vp = null;
  let lay = null;                                                      // the layout as last drawn: { side, w, h, aspect, key } (0.10.75)                                                       // the viewer's zoom in pixels, as last drawn (0.10.73)
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

  // ---- 0.10.152 saved tracks: every finished track, to open again after another track or a Premiere restart
  const savedCard = div(root, "tr-card tr-saved");
  savedCard.hidden = true;
  const savedHead = div(savedCard, "row tr-card-h");
  div(savedHead, "tr-card-t", "Saved tracks");
  const savedMeta = div(savedHead, "tr-card-m", "");
  const savedList = div(savedCard, "tr-saved-list");
  const savedFoot = div(savedCard, "row tr-saved-foot");
  const savedNote = div(savedFoot, "tr-hint tr-saved-note", "");
  div(savedFoot, "spacer");
  let savedButtons = [];                                             // [button, usable when not busy]: drawControls switches them

  // ---- 0.10.75 side by side (a vertical clip in a wide panel): the viewer card left, timeline and the cards in a column right;
  // the same nodes are moved between the two layouts, nothing is built twice
  const sideRow = div(root, "row tr-side");
  sideRow.hidden = true;
  const rightCol = div(sideRow, "tr-right");
  const timeCard = div(rightCol, "tr-card tr-work tr-timecard");

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
  // 0.10.73 zoom: − / Fit / + (and Move, 0.10.74) in the viewer's corner; Alt + click zooms there, Alt-drag pans (0.10.74)
  const zoomBar = div(view, "row tr-zoom");

  // 0.10.74: the one-line guide while zoomed in
  const zoomHint = div(work, "tr-zhint", "Alt + click: zoom  ·  Alt + drag: move");
  zoomHint.hidden = true;
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

  // the page's room: its width, and the scrolling area's height (0.10.75: the layout is chosen from these, never from the
  // viewer's own box, which depends on the layout)
  function room() {
    let W = 0;
    let H = 0;
    let top = 70;
    try {
      W = root.getBoundingClientRect().width;
      H = root.parentElement.getBoundingClientRect().height - 22;      // #app's padding
      top = steps.getBoundingClientRect().height + clipBar.getBoundingClientRect().height + 16;
    } catch (e) { /* hidden page */ }
    return { W: W > 40 ? W : 260, H: H > 120 ? H : 700, top };
  }

  // which layout and how big the viewer is, for the loaded frame's real shape (the file's size, read by the engine)
  function plan() {
    const p = state.preview;
    const r = room();
    const L = TP.layoutFor(p.width, p.height, r.W - 2, r.H, r.top, 44);   // 44: the zoom line and the card edges under the picture
    return { ...L, key: `${Math.round(r.W)}x${Math.round(r.H)}|${p.width}x${p.height}` };
  }

  function size() {
    if (!lay) lay = plan();
    return [lay.w, lay.h];
  }

  // puts the cards where the layout wants them (moving the same nodes)
  function applyLayout(side) {
    const now = !sideRow.hidden;
    if (side === now) return false;
    if (side) {
      sideRow.insertBefore(work, rightCol);
      timeCard.appendChild(timeArea);
      rightCol.appendChild(cols);
      sideRow.hidden = false;
    } else {
      root.insertBefore(work, sideRow);
      work.appendChild(timeArea);
      root.insertBefore(cols, status);
      sideRow.hidden = true;
      work.style.width = "";
      stage.style.width = "";
    }
    flag(cols, "tr-cols-v", side);
    flag(root, "tr-sidewise", side);
    return true;
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
      lay = null;
      applyLayout(false);
      stage.style.height = "";
      emptyTitle.textContent = state.loading ? "Loading frame" : "No frame loaded";
      emptyText.hidden = state.loading;
      return;
    }
    lay = plan();
    const moved = applyLayout(lay.side);
    const [w, h] = [lay.w, lay.h];
    state.viewW = stageWidth();
    stage.style.height = `${h}px`;
    stage.style.width = lay.side ? `${w}px` : "";                       // side by side: the card is exactly the picture, no bars
    work.style.width = lay.side ? `${w + 2}px` : "";
    if (moved) setTimeout(drawTimeline, 0);                             // the timeline's width changed with its place
    view.style.width = `${w}px`;
    view.style.height = `${h}px`;
    vp = TP.viewport(state.zoom, w, h);
    state.zoom = { z: vp.z, cx: vp.cx, cy: vp.cy };
    // the frame and its overlay: one size, one shift, so the box always sits on the object
    for (const e of [img, svg]) {
      e.style.width = `${vp.cw}px`;
      e.style.height = `${vp.ch}px`;
      e.style.left = `${-vp.px}px`;
      e.style.top = `${-vp.py}px`;
    }
    svg.setAttribute("width", vp.cw);
    svg.setAttribute("height", vp.ch);
    drawZoom();
    const src = frameSrc();
    if (src && img.getAttribute("data-src") !== src.slice(-40)) {
      img.src = `data:image/jpeg;base64,${src}`;
      img.setAttribute("data-src", src.slice(-40));
    }
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const k = vp.cw / p.width;
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
      svgEl(svg, "rect", { x: vp.px + 1, y: vp.py + 1, width: w - 2, height: h - 2 }, `fill:none;stroke:${COLORS.lost};stroke-width:2px`);
    }
    // a box the editor is drawing (a first box, or a fix on the frame shown)
    if (state.box && !state.job && (!t || state.boxAt === state.cur)) {
      const [x, y, bw, bh] = [state.box[0] * vp.cw, state.box[1] * vp.ch, state.box[2] * vp.cw, state.box[3] * vp.ch];
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
    let tw = 0;
    try {
      tw = timeline.getBoundingClientRect().width;
    } catch (e) { /* hidden */ }
    if ((state.preview && (!lay || plan().key !== lay.key)) || (tw > 40 && Math.abs(tw - state.timelineW) > 1)) {
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
    const f = t.frames[state.cur];
    if (state.zoom.z > 1 && vp && TP.usable(f) && state.preview) {                     // zoomed in: the view follows the object
      state.zoom = TP.follow(state.zoom, f.x / state.preview.width, f.y / state.preview.height, ...size());
    }
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
    release(timeline, e);
    if (!scrubbing) return;
    scrubbing = false;
    scrubTo(e, true);
    state.rangeDrag = -1;
  });
  timeline.addEventListener("pointercancel", (e) => {
    release(timeline, e);
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
  // a point on the frame as drawn now (zoomed and shifted), from the viewer's pixels
  const onFrame = ([x, y]) => (vp ? [x + vp.px, y + vp.py] : [x, y]);
  const inZoomBar = (node) => {
    for (let n = node; n && n !== view; n = n.parentNode) if (n === zoomBar) return true;
    return false;
  };
  let pan = null;                                                    // Alt-drag: the last mouse point
  // 0.10.74 (the user: "I can't move around the frame", then "a little guide, minimal"): Alt (or Move, or the middle button)
  // drags the view; Alt + click zooms in where clicked (Alt + Shift + click out). Measured in Premiere 26.5.3: Alt and the
  // drag reach the panel, a scroll never does (no wheel / mousewheel on the viewer, the page or the document), so no scroll zoom.
  let panFrom = null;                                                // where an Alt press began, to tell a click from a drag
  view.addEventListener("pointerdown", (e) => {
    if (!state.preview || inZoomBar(e.target)) return;
    let r = null;
    try {
      r = view.getBoundingClientRect();
    } catch (err) { /* older UXP: no check */ }
    if (r && r.width > 0 && (e.clientX < r.left || e.clientY < r.top || e.clientX > r.right || e.clientY > r.bottom)) {                     // a press elsewhere delivered here (still captured)
      release(view, e);
      return;
    }
    if (e.altKey || ((state.hand || e.button === 1) && state.zoom.z > 1)) {
      pan = local(e);
      panFrom = e.altKey ? { at: pan.slice(), out: !!e.shiftKey } : null;
      try {
        view.setPointerCapture(e.pointerId);
      } catch (err) { /* follows inside */ }
      return;
    }
    if (state.busy) return;
    stopPlay();
    drag = onFrame(local(e));
    try {
      view.setPointerCapture(e.pointerId);
    } catch (err) { /* follows inside */ }
  });
  view.addEventListener("pointermove", (e) => {
    if (pan) {
      const [x, y] = local(e);
      if (panFrom && Math.hypot(x - panFrom.at[0], y - panFrom.at[1]) > 4) panFrom.moved = true;
      if (state.zoom.z > 1) {
        state.zoom = TP.panBy(state.zoom, pan[0] - x, pan[1] - y, ...size());
        drawView();
      }
      pan = [x, y];
      return;
    }
    if (!drag || !vp) return;
    const [x, y] = onFrame(local(e));
    const b = TP.boxFrom(drag[0], drag[1], x, y, vp.cw, vp.ch);
    if (b) {
      state.box = b;
      state.boxAt = state.track ? state.cur : -1;
      drawView();
    }
  });
  const endDraw = (e) => {
    release(view, e);
    const click = pan && panFrom && !panFrom.moved ? panFrom : null;
    pan = null;
    panFrom = null;
    if (click) zoomTo(TP.zoomStep(state.zoom.z, click.out ? -1 : 1), click.at);       // Alt + click: zoom here
    if (!drag) return;
    drag = null;
    if (!state.box) return;
    boxHint();
    redraw();
  };
  view.addEventListener("pointerup", endDraw);
  view.addEventListener("pointercancel", endDraw);

  // ---------------------------------------------------------------- zoom (0.10.73)
  function zoomTo(z, at) {
    if (!state.preview) return;
    const [w, h] = size();
    if (state.zoom.z <= 1 && z > 1 && !at) {                        // from the whole frame: zoom in on the object
      const f = state.track && state.track.frames[state.cur];
      const focus = TP.usable(f) ? [f.x / state.preview.width, f.y / state.preview.height]
        : state.box ? [state.box[0] + state.box[2] / 2, state.box[1] + state.box[3] / 2] : null;
      if (focus) state.zoom = { z: 1, cx: focus[0], cy: focus[1] };
      state.zoom = { z, cx: state.zoom.cx, cy: state.zoom.cy };
    } else {
      state.zoom = TP.zoomAt(state.zoom, z, at ? at[0] : w / 2, at ? at[1] : h / 2, w, h);
    }
    drawView();
  }
  const zoomOut = button("small tr-zbtn", "−", "Zoom out.", () => zoomTo(TP.zoomStep(state.zoom.z, -1)));
  const zoomFit = button("small tr-zbtn tr-zfit", "Fit", "Shows the whole frame again. Alt + click zooms in where you click (Alt + Shift + click: out); zoomed in, Move or Alt + drag moves around.", () => zoomTo(1));
  const zoomIn = button("small tr-zbtn", "+", "Zoom in (on the object when there is a box). Alt + click zooms in where you click; Move or Alt + drag moves around.", () => zoomTo(TP.zoomStep(state.zoom.z, 1)));
  const handBtn = button("small tr-zbtn tr-zhand", "", "Move: while on, dragging the picture moves around it instead of drawing a box. Alt + drag does the same without it.", () => {
    state.hand = !state.hand;
    drawZoom();
  });
  handBtn.id = "trZoomMove";
  handBtn.innerHTML = `<svg class="tr-ico" width="14" height="14" viewBox="0 0 14 14"><path d="${ICONS.move}"/></svg>`;
  zoomBar.appendChild(handBtn);
  zoomOut.id = "trZoomOut";
  zoomFit.id = "trZoomFit";
  zoomIn.id = "trZoomIn";
  for (const b of [zoomOut, zoomFit, zoomIn]) zoomBar.appendChild(b);
  function drawZoom() {
    const z = state.zoom.z;
    zoomFit.textContent = z <= 1 ? "Fit" : `${Math.round(z * 10) / 10}×`;
    enable(zoomOut, z > 1);
    enable(zoomIn, z < TP.ZOOMS[TP.ZOOMS.length - 1]);
    flag(view, "tr-zoomed", z > 1);
    zoomHint.hidden = z <= 1;
    if (z <= 1) state.hand = false;                                   // nothing to move at Fit: dragging draws again
    handBtn.hidden = z <= 1;
    flag(handBtn, "on", state.hand);
    flag(view, "tr-hand", state.hand);
  }
  function boxHint() {
    const px = Math.round(state.box[2] * state.preview.width);
    const py = Math.round(state.box[3] * state.preview.height);
    boxMeta.textContent = `Box ${px} × ${py} px`;
    // 0.10.76: small boxes are tracked on the file's own pixels; the hint only helps drawing them tight
    hint.textContent = (px < 24 || py < 24 ? "Small box: zoom in (Alt + click) to draw it tight around the object. " : "") +
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
    const kept = await autoSave();
    await fetchThumbs(res.id, res.range ? res.range[0] : 0, res.range ? res.range[1] + 1 : res.frames.length);
    report(res.stopped ? "Stopped: what was tracked is kept." : "", kept);
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
    const kept = await autoSave();
    await fetchThumbs(t.id, range[0], range[1] + 1);
    const got = part.frames.filter((f) => f.state !== "none").length;
    report(`${part.stopped ? "Stopped: " : ""}${dir > 0 ? "From" : "Back from"} frame ${k + 1}: ${got} frames tracked${drawn ? " again" : ""}.`, kept);
  }

  function report(first, kept) {
    const c = { sure: 0, unsure: 0, lost: 0, none: 0 };
    for (const f of state.track.frames) c[f.state] = (c[f.state] || 0) + 1;
    const lines = [first || "Tracked.", `${state.track.frames.length - c.none} frames: ${c.sure} sure, ${c.unsure} unsure, ${c.lost} lost.` +
      (c.none ? ` ${c.none} not tracked (outside the range or after Stop): go to the last tracked frame and press Track from here to go on.` : "")];
    if (c.lost || c.unsure) lines.push("The arrows at the right of the transport jump to them; draw a new box there and Track from here to fix a stretch.");
    if (kept) lines.push(kept);
    say(lines, c.lost ? "warn" : "ok");
  }

  // ---------------------------------------------------------------- saved tracks (0.10.152)
  function showClip(s, p) {
    clipName.textContent = s.clip.name;
    clipLine.textContent = `${s.at.toFixed(2)} s  ·  V${s.clip.track + 1}${Math.abs(s.clip.speed - 1) > 0.01 ? `  ·  speed ${Math.round(s.clip.speed * 100)} %` : ""}  ·  ${p.width} × ${p.height}  ·  ${TP.aspectName(p.width, p.height)}`;
  }

  // every finished track (and every fixed or continued part of it, under the same id) goes to <app>/tracks/; a failure
  // never spoils the track itself, it is only said -> the line for the report
  async function autoSave() {
    const s = state.source;
    const t = state.track;
    if (!s || !t || !t.id) return "";
    try {
      await engine.trackerSave({ id: t.id, name: TP.savedName(s), project: state.project, sequence: s.sequence, source: s, track: t });
      if (state.saved.open) await loadSaved();
      return "Saved: Saved tracks opens it again later, also after Premiere restarts.";
    } catch (e) {
      premiere.debug(`tracker: not saved: ${e && e.stack ? e.stack : e}`);
      return `Not saved for later (${e.message || e}); the track itself is fine.`;
    }
  }

  async function loadSaved() {
    if (!state.project) {
      const project = await premiere.activeProject().catch(() => null);
      state.project = (project && project.path) || "";
    }
    const r = await engine.trackerSaved(state.project);
    state.saved.items = r.items || [];
    state.saved.mine = r.mine || 0;
    drawSaved();
  }

  function drawSaved() {
    const sv = state.saved;
    savedCard.hidden = !sv.open;
    flag(savedBtn, "on", sv.open);
    if (!sv.open) return;
    while (savedList.firstChild) savedList.removeChild(savedList.firstChild);
    savedButtons = [];
    while (savedFoot.childNodes.length > 2) savedFoot.removeChild(savedFoot.lastChild);
    const shown = TP.savedShown(sv.items, sv.all);
    savedMeta.textContent = sv.items.length ? `${shown.length} of ${sv.items.length}` : "";
    if (!sv.items.length) div(savedList, "tr-hint", "Nothing saved yet: every track is kept here when it finishes, to attach a picture to it later.");
    else if (!sv.all && !sv.mine) div(savedList, "tr-hint", "None from this project: these are from other projects.");
    for (const x of shown) {
      const row = div(savedList, "row tr-saved-row");
      if (x.poster) {
        const pic = document.createElement("img");
        pic.className = "tr-saved-pic";
        pic.src = `data:image/jpeg;base64,${x.poster}`;
        row.appendChild(pic);
      }
      const txt = div(row, "tr-saved-txt");
      div(txt, "tr-saved-name", x.name || x.clip);
      div(txt, "tr-saved-line", TP.savedLine(x));
      if (x.offline) div(txt, "tr-saved-line tr-saved-warn", "The file is offline: reconnect it to open this track.");
      else if (!x.here) div(txt, "tr-saved-line", `From ${String(x.project).split(/[\\/]/).pop() || "another project"}`);
      const open = button("small", "Open", "Opens this track again: the frames, the box and the clip it came from. Then select a text or logo and Attach selected, or Lock to it.", () => guarded(() => openSaved(x)));
      const asking = sv.ask === x.id;
      const del = button("small", asking ? "Delete?" : "Delete", asking ? "Press again to delete this saved track for good. The keys it gave clips stay." : "Deletes this saved track (press twice). Keys it gave clips stay.", () => guarded(async () => {
        if (sv.ask !== x.id) {
          sv.ask = x.id;
          return drawSaved();
        }
        sv.ask = null;
        await engine.trackerSavedDelete(x.id);
        await loadSaved();
      }));
      if (asking) flag(del, "tr-hot", true);
      savedButtons.push([open, !x.offline], [del, true]);
      enable(open, !state.busy && !x.offline);
      enable(del, !state.busy);
      row.appendChild(open);
      row.appendChild(del);
    }
    if (sv.mine && sv.items.length > sv.mine) {
      savedFoot.appendChild(button("small", sv.all ? "This project only" : "All projects", sv.all ? "Shows only the tracks made in this project." : "Shows the tracks of every project.", () => {
        sv.all = !sv.all;
        drawSaved();
      }));
    }
    savedNote.textContent = sv.note;
  }

  async function openSaved(x) {
    const rec = await engine.trackerSavedGet(x.id);
    const project = await premiere.activeProject();
    state.project = project.path || state.project;
    const found = await TR.findSource(project, rec.source);
    say("Opening the saved track: making its frames again…");
    const started = await engine.trackerReopen(x.id);
    let res = null;
    for (;;) {
      const j = await engine.job(started.job);
      if (j.state === "done") {
        res = j.result;
        break;
      }
      if (j.state === "error") throw new premiere.UserError(j.error || "The saved track did not open.");
      if (j.state === "cancelled") throw new premiere.UserError("Cancelled.");
      await new Promise((r) => setTimeout(r, 200));
    }
    const t = rec.track;
    const range = Array.isArray(t.range) && t.range.length === 2 ? [t.range[0], t.range[1]] : null;
    Object.assign(state, { source: found.source, preview: res.preview, track: t, thumbs: [], cur: t.k0 || 0, box: null, boxAt: -1,
      range, zoom: { z: 1, cx: 0.5, cy: 0.5 }, hand: false });
    showClip(found.source, res.preview);
    boxMeta.textContent = "";
    hint.textContent = "";
    state.saved.open = false;
    drawSaved();
    redraw();
    await fetchThumbs(t.id, res.from, res.to);
    const name = rec.name || found.source.clip.name;
    const next = "Select the text or logo, placed where it belongs on the boxed frame, and press Attach selected (or Lock to it).";
    if (found.how === "same") say([`Opened: ${name}.`, next], "ok");
    else if (found.how === "moved") say([`Opened: ${name}. The clip has moved on the timeline since: the keys go to where it is now (V${found.source.clip.track + 1}, ${found.source.clip.start.toFixed(2)} s).`, next], "ok");
    else say([`Opened: ${name}, but its clip is not in the open sequence ${found.sequence}${rec.sequence && rec.sequence !== found.sequence ? ` (it was tracked in ${rec.sequence})` : ""}` +
      `${found.twins > 1 ? `: ${found.twins} clips of that file could be it` : ""}.`, "Open that sequence and press Open again before Attach or Lock. The frames can be looked at."], "warn");
    seekPremiere(true);
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
      state.project = project.path || "";
      // 0.10.73: 1280 px on the long side (was 640), so the frame stays sharp zoomed in
      const p = await engine.trackerFrame({ path: s.clip.path, t: s.t0, width: 1280 });
      Object.assign(state, { source: s, preview: p, box: null, boxAt: -1, track: null, thumbs: [], cur: 0, range: null, zoom: { z: 1, cx: 0.5, cy: 0.5 }, hand: false });
      showClip(s, p);
      boxMeta.textContent = "";
      hint.textContent = "Drag a box around something with detail (a logo, a face, an edge), not a plain area.";
      say("");
    } finally {
      state.loading = false;
    }
  }));
  top.appendChild(loadBtn);
  const savedBtn = button("tr-savedbtn", "Saved", "Every track you made, kept after another track or a Premiere restart: open one to attach a picture to it later.", () => guarded(async () => {
    state.saved.open = !state.saved.open;
    state.saved.ask = null;
    if (state.saved.open) await loadSaved();
    else drawSaved();
  }));
  top.appendChild(savedBtn);

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
    enable(savedBtn, !state.busy);
    for (const [b, ok] of savedButtons) enable(b, !state.busy && ok);
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
      return { zoom: state.zoom, viewport: vp, layout: lay && { side: lay.side, w: lay.w, h: lay.h, aspect: TP.aspectName(state.preview.width, state.preview.height), room: room() }, source: state.source, box: state.box, boxAt: state.boxAt, cur: state.cur, mode: state.mode, busy: state.busy, range: state.range, rangeText: rangeText.textContent,
        preview: state.preview && { w: state.preview.w, h: state.preview.h, width: state.preview.width, height: state.preview.height },
        thumbs: state.thumbs.filter(Boolean).length, hud: hud.textContent, frame: frameChip.textContent, svg: svg.childNodes.length,
        view: { w: Number(svg.getAttribute("width")) || 0, h: Number(svg.getAttribute("height")) || 0, stage: Math.round(stageWidth()) },
        timeline: timeline.childNodes.length, timelineW: state.timelineW, status: status.textContent,
        track: t && { n: t.frames.length, k0: t.k0, id: t.id, states: TP.runs(t.frames), stopped: !!t.stopped, first: t.frames[0], ref: t.frames[t.k0], fixed: t.frames.filter((f) => f.fixed).length } };
    },
    track() {
      return state.track;
    },
    // 0.10.152 saved tracks for the test bridge: the list as the page holds it, and Open on one of them
    async saved() {
      state.saved.open = true;
      await loadSaved();
      return { items: state.saved.items.map((x) => ({ ...x, poster: !!x.poster })), mine: state.saved.mine };
    },
    async openSaved(id) {
      const x = state.saved.items.find((i) => i.id === id) || { id };
      await guarded(() => openSaved(x));
      return { source: state.source, cur: state.cur, n: state.track && state.track.frames.length, status: status.textContent };
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
        clipLine.textContent = `${d.source.at.toFixed(2)} s  ·  V${d.source.clip.track + 1}  ·  ${d.preview ? `${d.preview.width} × ${d.preview.height}  ·  ${TP.aspectName(d.preview.width, d.preview.height)}` : ""}`;
      }
      redraw();
    },
  };
}

module.exports = { mount };
