// A small points-curve editor (docs/IN_OUT_PLAN.md Phase 5, step 3): the Keyframer's "Edit as points" behaviour (keyframer.js 0.10.68:
// click the graph to add a point, drag it, press it twice to remove it, Alt + press for a sharp corner) as a module of its own that
// another page can mount. The Keyframer's editor is closures inside its mount() and cannot be reused, so its RULES are reproduced
// here with the same numbers; every curve calculation is keyframeplan.js (pointsOk, ease -> pointsAt, MAX_POINTS), none is copied.
// Two halves: the pure part (geometry and the point rules; Node-tested) and mount() (the DOM). Nothing here reads or writes Premiere.
//
// Premiere 26.5.3 crashed in its SVG painter (0.10.130) when a drawing created and removed SVG nodes while it ran. So mount() makes
// every node ONCE in build(): the frame, the path and a fixed pool of MAX_POINTS circles (smooth points) and MAX_POINTS squares
// (corner points). A redraw only changes attributes; an unused shape is hidden with r / width 0 (keyframer.js, "kfH1" r="0").
// No timer either: the double press is timed by the event's own timestamp.
const K = require("./keyframeplan.js");

const POOL = K.MAX_POINTS;                      // 16 circles and 16 squares, made once
const GRAB = 12;                                // px: a point within this is grabbed (keyframer.js `nearest`: `let d = 12`)
const GAP_ADD = 0.015;                          // a new point needs this much time between it and any other (keyframer.js pointerdown)
const GAP_MOVE = 0.012;                         // a dragged point keeps this much from its neighbours (keyframer.js pointermove)
const ADD_MIN = 0.02;                           // a new point needs x > 0.02 and x < 0.98 (keyframer.js pointerdown)
const ADD_MAX = 0.98;
const DRAG_MIN = 0.012;                         // the first / last point may be dragged to GAP_MOVE from the ends (keyframer.js pointermove)
const DRAG_MAX = 0.988;
const Y_MIN = -0.5;
const Y_MAX = 1.5;
const DOUBLE_MS = 350;                          // two presses on one point within this remove it (keyframer.js `now - lastDown.at < 350`)
const R_POINT = 6;                              // a smooth point's radius (px); a corner is a square of 2 * 5 px
const R_CORNER = 5;
const PAD_X = 12;                               // the Keyframer cuts its drawing to 12 px beside x 0..1: room for a handle, no more
const SAMPLES = 120;                            // the curve's line (keyframeplan.samplePath's default)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The mapping between curve space (x 0..1, y -0.5..1.5) and pixels. y 0..1 fills the middle half of the height, so an overshoot
 * up to 0.5 either way is drawn (the Keyframer's PAD of a quarter of its size); x 0..1 sits PAD_X in from each side.
 * -> {w, h, x0, span (px of x 0..1), fx (curve x -> px), fy (curve y -> px), tx (px -> curve x), ty (px -> curve y),
 *     frame: {x, y, width, height} (the unit square)}
 */
function geometry(w, h) {
  const span = w - 2 * PAD_X;
  const rise = h / 2;                           // px of y 0..1
  const base = h - h / 4;                       // px of y 0
  return {
    w, h, x0: PAD_X, span,
    fx: (x) => PAD_X + x * span,
    fy: (y) => base - y * rise,
    tx: (px) => (px - PAD_X) / span,
    ty: (py) => (base - py) / rise,
    frame: { x: PAD_X, y: h / 4, width: span, height: rise },
  };
}

const copy = (pts) => pts.map((q) => q.slice());

/** the list the caller asked for, if it is a legal curve: a sorted copy; else null */
function legal(list) {
  if (!K.pointsOk(list)) return null;
  return list;
}

/** the index of the point within GRAB px of (px, py) (the nearest wins), else -1 */
function nearest(pts, px, py, geo) {
  let best = -1;
  let d = GRAB;
  pts.forEach((q, i) => {
    const e = Math.hypot(geo.fx(q[0]) - px, geo.fy(q[1]) - py);
    if (e < d) {
      d = e;
      best = i;
    }
  });
  return best;
}

/** a new point at curve (x, y), kept in time order; the input when it would not fit (too close to the ends or to a point, full) */
function add(pts, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return pts;
  if (x <= ADD_MIN || x >= ADD_MAX || pts.length >= POOL) return pts;
  if (pts.some((q) => Math.abs(q[0] - x) < GAP_ADD)) return pts;
  const out = copy(pts);
  out.push([x, clamp(y, Y_MIN, Y_MAX)]);
  out.sort((a, b) => a[0] - b[0]);
  return legal(out) || pts;
}

/** point i dragged to curve (x, y): x stays GAP_MOVE from its neighbours (time only runs forward), y within -0.5..1.5; a corner stays one */
function move(pts, i, x, y) {
  if (!Number.isInteger(i) || i < 0 || i >= pts.length || !Number.isFinite(x) || !Number.isFinite(y)) return pts;
  const lo = i > 0 ? pts[i - 1][0] + GAP_MOVE : DRAG_MIN;
  const hi = i < pts.length - 1 ? pts[i + 1][0] - GAP_MOVE : DRAG_MAX;
  const q = pts[i];
  const out = copy(pts);
  out[i] = [Math.min(hi, Math.max(lo, x)), clamp(y, Y_MIN, Y_MAX), ...(q[2] ? [1] : [])];
  return legal(out) || pts;
}

/** point i taken out; the last point stays (a curve keeps at least one) */
function remove(pts, i) {
  if (!Number.isInteger(i) || i < 0 || i >= pts.length || pts.length <= 1) return pts;
  const out = copy(pts);
  out.splice(i, 1);
  return legal(out) || pts;
}

/** point i made a sharp corner (a third element 1), or smooth again */
function corner(pts, i) {
  if (!Number.isInteger(i) || i < 0 || i >= pts.length) return pts;
  const out = copy(pts);
  const q = out[i];
  out[i] = q[2] ? [q[0], q[1]] : [q[0], q[1], 1];
  return legal(out) || pts;
}

// ---------------------------------------------------------------- the DOM
const NS = "http://www.w3.org/2000/svg";

// let go of a captured pointer by hand (keyframer.js 0.10.77: UXP seemed to keep it after the release)
const release = (node, e) => {
  try {
    if (e && e.pointerId !== undefined) node.releasePointerCapture(e.pointerId);
  } catch (err) { /* not captured */ }
};

/**
 * The ONE place that makes nodes: the svg shell (frame, path, a group) and the pool of shapes. Called once by mount().
 * -> {svg, path, circles: [POOL], squares: [POOL]}
 */
function build(host, el, w, h) {
  const geo = geometry(w, h);
  const wrap = el("div", "kf-editor");
  wrap.innerHTML = `<svg width="${w}" height="${h}">` +
    `<rect class="kf-frame" x="${geo.frame.x}" y="${geo.frame.y}" width="${geo.frame.width}" height="${geo.frame.height}"/>` +
    '<path class="kf-curve" d=""/><g></g></svg>';
  host.appendChild(wrap);
  const svg = wrap.querySelector("svg");
  const path = wrap.querySelector("path");
  const group = wrap.querySelector("g");
  const circles = [];
  const squares = [];
  for (let i = 0; i < POOL; i++) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("class", "kf-handle kf-pt");
    c.setAttribute("cx", "0");
    c.setAttribute("cy", "0");
    c.setAttribute("r", "0");
    group.appendChild(c);
    circles.push(c);
    const s = document.createElementNS(NS, "rect");
    s.setAttribute("class", "kf-handle kf-pt");
    s.setAttribute("x", "0");
    s.setAttribute("y", "0");
    s.setAttribute("width", "0");
    s.setAttribute("height", "0");
    group.appendChild(s);
    squares.push(s);
  }
  return { svg, path, circles, squares };
}

const countNodes = (n) => 1 + Array.from(n.childNodes || []).reduce((s, c) => s + countNodes(c), 0);

/**
 * Builds the editor into `host`. {host, el (the page's element maker), width, height (px, default 208 x 120)}
 * -> {set(pts, enabled) (show a curve; enabled false: shown, presses ignored), get() (a copy of the points), onChange(fn(pts, dragging))
 *     (dragging true on every move of a drag, false once on its release, an add, a remove or a corner toggle), info()}
 */
function mount({ host, el, width, height }) {
  const w = Number.isFinite(width) ? width : 208;
  const h = Number.isFinite(height) ? height : 120;
  const geo = geometry(w, h);
  const { svg, path, circles, squares } = build(host, el, w, h);
  let pts = [[0.5, 0.5]];                       // the Keyframer's starting Custom curve
  let enabled = false;
  let listener = null;
  let drag = -1;                                // the point being dragged (-1: none)
  let moved = false;                            // the drag changed something (a plain press-and-release does not)
  let pressed = false;                          // this host reports held buttons (the press showed one): a move with none is a missed release
  let last = { at: 0, i: -1 };                  // the previous press, for the double press
  let shown = 0;

  function paint() {
    const line = [];
    const curve = { kind: "points", pts };
    for (let i = 0; i <= SAMPLES; i++) {
      const x = i / SAMPLES;
      line.push(`${geo.fx(x).toFixed(1)} ${geo.fy(K.ease(curve, x)).toFixed(1)}`);
    }
    path.setAttribute("d", `M ${line.join(" L ")}`);
    shown = 0;
    for (let i = 0; i < POOL; i++) {
      const c = circles[i];
      const s = squares[i];
      const q = pts[i];
      if (q && q[2]) {
        s.setAttribute("x", (geo.fx(q[0]) - R_CORNER).toFixed(1));
        s.setAttribute("y", (geo.fy(q[1]) - R_CORNER).toFixed(1));
        s.setAttribute("width", String(2 * R_CORNER));
        s.setAttribute("height", String(2 * R_CORNER));
        c.setAttribute("r", "0");
        shown += 1;
      } else if (q) {
        c.setAttribute("cx", geo.fx(q[0]).toFixed(1));
        c.setAttribute("cy", geo.fy(q[1]).toFixed(1));
        c.setAttribute("r", String(R_POINT));
        s.setAttribute("width", "0");
        s.setAttribute("height", "0");
        shown += 1;
      } else {
        c.setAttribute("r", "0");
        s.setAttribute("width", "0");
        s.setAttribute("height", "0");
      }
      const cls = i === drag ? "kf-handle kf-pt on" : "kf-handle kf-pt";
      c.setAttribute("class", cls);
      s.setAttribute("class", cls);
    }
    svg.style.opacity = enabled ? "1" : "0.55";
  }

  const fire = (dragging) => {
    if (listener) listener(copy(pts), dragging);
  };

  // where an event is inside the drawing, in px (the svg has no viewBox: its user units are px)
  function local(e) {
    try {
      const r = svg.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    } catch (err) {
      return [e.offsetX, e.offsetY];
    }
  }

  svg.addEventListener("pointerdown", (e) => {
    if (!enabled) return;
    const [lx, ly] = local(e);
    let i = nearest(pts, lx, ly, geo);
    const now = Number.isFinite(e.timeStamp) ? e.timeStamp : Date.now();
    if (i >= 0 && last.i === i && now - last.at < DOUBLE_MS) {         // a double press (UXP may send no dblclick): remove
      last = { at: 0, i: -1 };
      const next = remove(pts, i);
      if (next !== pts) {
        pts = next;
        paint();
        fire(false);
      }
      return;
    }
    last = { at: now, i };
    if (i >= 0 && e.altKey) {                                          // Alt + press: a sharp corner, or smooth again
      pts = corner(pts, i);
      paint();
      fire(false);
      return;
    }
    if (i < 0) {                                                       // a new point where the graph was pressed
      const x = geo.tx(lx);
      const next = add(pts, x, geo.ty(ly));
      if (next === pts) return;
      pts = next;
      i = pts.findIndex((q) => q[0] === x);
      paint();
      fire(false);
    }
    drag = i;
    moved = false;
    pressed = typeof e.buttons === "number" && e.buttons !== 0;
    try {
      svg.setPointerCapture(e.pointerId);
    } catch (err) { /* the drag still follows inside the drawing */ }
    paint();
  });
  svg.addEventListener("pointermove", (e) => {
    if (drag < 0) return;
    if (pressed && e.buttons === 0) { stop(e); return; }                          // the release was missed (no capture, let go outside): end the drag
    const [lx, ly] = local(e);
    const next = move(pts, drag, geo.tx(lx), geo.ty(ly));
    if (next === pts) return;
    pts = next;
    moved = true;
    paint();
    fire(true);
  });
  const stop = (e) => {
    release(svg, e);
    const was = drag;
    drag = -1;
    if (was < 0) return;
    paint();
    if (moved) fire(false);
    moved = false;
  };
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);

  paint();
  return {
    set(next, on) {
      const to = copy(legal(next) || [[0.5, 0.5]]);
      // the page may hand back the points it was just told about: that is no change and must not end a drag
      if (!!on === enabled && JSON.stringify(to) === JSON.stringify(pts)) return;
      pts = to;
      enabled = !!on;
      drag = -1;
      moved = false;
      last = { at: 0, i: -1 };
      paint();
    },
    get: () => copy(pts),
    onChange(fn) {
      listener = typeof fn === "function" ? fn : null;
    },
    info: () => ({ nodes: countNodes(svg), points: pts.length, shown, enabled, width: w, height: h }),
  };
}

module.exports = {
  POOL, GRAB, GAP_ADD, GAP_MOVE, ADD_MIN, ADD_MAX, DRAG_MIN, DRAG_MAX, Y_MIN, Y_MAX, DOUBLE_MS, PAD_X,
  geometry, nearest, add, move, remove, corner, build, mount,
};
