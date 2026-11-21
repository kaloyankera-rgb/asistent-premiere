// The In & Out page's small preview (docs/IN_OUT_PLAN.md Phase 4): a box in a small frame that plays the picked In, a hold, the
// picked Out and a pause, again and again, from the very rows Apply bakes (inoutplan.plan(), the same direction, turn, frames and
// Strength), so what is previewed is what is written. Like the Keyframer's preview (keyframer.js, 0.10.78) it is inline
// SVG on a setTimeout chain at the frame rate, but its two polygons are made once and a frame only changes `points` and the
// opacity: since 0.10.131 nothing is created or removed per frame (that crashed Premiere's SVG painter in 0.10.130).
// Two halves: the pure part (rows -> box values, the loop's timeline, the caption; Node-tested) and mount() (the DOM and the
// timer). Nothing here reads or writes Premiere, and the timer only moves the picture: it stops when the pane is not showing.
const I = require("./inoutplan.js");

const W = 208;                                  // the drawing (px), centred in a frame as wide as the page: it fits the narrowest panel (240 px
const H = 94;                                   // minus the page's 12 px sides and the frame's border); 0.10.133 (was 104 x 72 beside the settings)
const BOX_W = 46;                               // the box at rest (px): a picture, not a square, so a turn can be seen
const BOX_H = 32;
const FPS = 30;                                 // the frame rate the loop is played at
const HOLD = 15;                                // frames at rest between In and Out (0.5 s)
const PAUSE = 24;                               // frames the last picture stays before the loop starts again (0.8 s)

const REST = { dx: 0, dy: 0, s: 1, r: 0, o: 1 };

/** the distance an exit animation travels: the box fully off the frame towards `edge`, in frame fractions (inoutplan.exitDistance) */
function exitOf(edge) {
  return I.exitDistance({ cx: 0.5, cy: 0.5, hw: BOX_W / 2 / W, hh: BOX_H / 2 / H }, edge);
}

/**
 * One plan row -> how the box looks in the frame: {x, y (centre, px), w, h (px), rot (degrees, clockwise), opacity 0..1}.
 * dx / dy are frame fractions, or `dist` x those when the side is in exit distances (as inoutplan.transformKeys does).
 */
function styleOf(row, dist) {
  const d = Number.isFinite(dist) ? dist : 1;
  return {
    x: W / 2 + row.dx * d * W,
    y: H / 2 + row.dy * d * H,
    w: BOX_W * row.s,
    h: BOX_H * row.s,
    rot: row.r,
    opacity: row.o,
  };
}

/** a style's four corners as an SVG polygon's points ("x,y x,y x,y x,y"), turned about the centre (positive = clockwise, y down) */
function corners(st) {
  const r = (st.rot * Math.PI) / 180;
  const co = Math.cos(r);
  const si = Math.sin(r);
  return [[-st.w / 2, -st.h / 2], [st.w / 2, -st.h / 2], [st.w / 2, st.h / 2], [-st.w / 2, st.h / 2]]
    .map(([px, py]) => `${(st.x + co * px - si * py).toFixed(1)},${(st.y + si * px + co * py).toFixed(1)}`).join(" ");
}

/**
 * The loop for the picked animations. `opts` is inoutui.view(state).opts (what Apply sends): {inPreset, outPreset, inFrames,
 * outFrames, direction, turn, strength}. Planned on an imaginary clip just long enough for In, HOLD frames of rest and Out, so
 * plan() shortens nothing and the rows are exactly the ones a clip would get.
 * -> {steps: [{kind: "in" | "hold" | "out" | "pause", style}], lens: {in, hold, out, pause}, animated, fps, rest (the resting style),
 *     error}. Both None (or a plan error): no steps, `animated` false, only the resting box.
 */
function build(opts) {
  const o = opts || {};
  const rest = styleOf(REST, 1);
  const none = (error) => ({ steps: [], lens: { in: 0, hold: 0, out: 0, pause: 0 }, animated: false, fps: FPS, rest, error: error || null });
  const hasIn = !!o.inPreset && o.inPreset !== "none";
  const hasOut = !!o.outPreset && o.outPreset !== "none";
  if (!hasIn && !hasOut) return none();
  const inP = hasIn ? I.find("in", o.inPreset) : null;
  const outP = hasOut ? I.find("out", o.outPreset) : null;
  if ((hasIn && !inP) || (hasOut && !outP)) return none("unknown preset");
  const nIn = inP ? (Number.isFinite(o.inFrames) ? o.inFrames : inP.frames) : 0;
  const nOut = outP ? (Number.isFinite(o.outFrames) ? o.outFrames : outP.frames) : 0;
  const len = nIn + nOut + HOLD + (inP && outP ? 2 : 1);
  const p = I.plan({ clip: { frames: len }, inPreset: o.inPreset, outPreset: o.outPreset, inFrames: o.inFrames, outFrames: o.outFrames,
    direction: o.direction, turn: o.turn, strength: o.strength });
  if (p.error) return none(p.error);
  const dist = (side, preset) => (p.exit[side] ? exitOf(I.edgeOf(side, preset, o.direction)) : 1);
  const dIn = dist("in", o.inPreset);
  const dOut = dist("out", o.outPreset);
  const byFrame = new Map();
  for (const r of p.in) byFrame.set(r.f, { kind: "in", style: styleOf(r, dIn) });
  for (const r of p.out) byFrame.set(r.f, { kind: "out", style: styleOf(r, dOut) });
  const steps = [];
  for (let f = 0; f < len; f++) steps.push(byFrame.get(f) || { kind: "hold", style: rest });
  const last = steps[steps.length - 1].style;
  for (let k = 0; k < PAUSE; k++) steps.push({ kind: "pause", style: last });
  const count = (kind) => steps.filter((s) => s.kind === kind).length;
  return { steps, lens: { in: count("in"), hold: count("hold"), out: count("out"), pause: count("pause") }, animated: true, fps: FPS, rest, error: null };
}

/** the line inside the frame (bottom left) and its tooltip: what plays, from inoutui.view(state); `hovering`: the pointer rests on a preset */
function caption(v, built, hovering) {
  const c = captionOf(v, built);
  return hovering && v.canApply ? { text: `Preview: ${c.text}`, tip: c.tip } : c;
}

function captionOf(v, built) {
  if (!v.canApply) return { text: "Nothing picked", tip: "Pick an In or an Out animation and it plays here, as Apply will write it." };
  const parts = [];
  const names = [];
  for (const [side, label, id] of [["in", "In", v.opts.inPreset], ["out", "Out", v.opts.outPreset]]) {
    if (!id) continue;
    const pr = I.find(side, id);
    const n = v.frames[side];
    parts.push(`${label} ${pr ? pr.name : id}`);
    names.push(`${label} ${pr ? pr.name : id}, ${n} frames`);
  }
  if (built && built.error) return { text: parts.join(" · "), tip: `Not previewed: ${built.error}.` };
  return { text: parts.join(" · "), tip: `${names.join("; ")}. The same rows Apply writes, on a sample clip; the frame and the box are not your clip's size.` };
}

// ---------------------------------------------------------------- the DOM and the timer
const NS = "http://www.w3.org/2000/svg";

/**
 * Builds the preview into `host` (the page). {el (the page's div maker), visible () -> is the pane showing, debug (log a failure)}.
 * -> {set(view, hovering) (the page's choices changed: rebuild and replay; hovering: the caption says "Preview: ..."), wake() (start
 * again after the timer stopped because the pane was hidden), stop(), info()}
 */
const LOOPS = 8;

function mount({ host, el, visible, debug }) {
  // a frame as wide as the page, the drawing centred in it at a fixed size (UXP is not proven to scale a percent-sized svg), the caption
  // inside the frame at the bottom left (an absolutely placed element over the frame, as the progress bar already is)
  const pv = el("div", "io-pvframe");
  pv.innerHTML = `<svg id="ioPv" width="${W}" height="${H}"><g id="ioPvBack"></g><g id="ioPvObj"></g></svg>` +
    '<div id="ioPvCap" class="io-pvcap"></div><div class="kf-pv-bar"><div id="ioPvFill" class="kf-pv-fill"></div></div>';
  host.appendChild(pv);
  const info = pv.querySelector("#ioPvCap");
  const back = pv.querySelector("#ioPvBack");
  const objs = pv.querySelector("#ioPvObj");
  const fill = pv.querySelector("#ioPvFill");
  pv.setAttribute("data-tip", "The picked animations on a sample box, played over and over from the same numbers Apply writes. Nothing is applied by this.");

  let timer = null;
  let built = build(null);
  let at = 0;
  let sig = null;
  let loops = 0;                                               // full plays since the last sign of the user
  let failed = false;                                          // a draw threw: no retry until the picks change
  // Premiere 26.5.3 crashed (2026-11-21 18:18:44, torq SvgGeometryNode::prePaint -> NodeImpl::hasAttribute, EXC_BAD_ACCESS) six
  // seconds into this loop when every frame removed the box and made a new one: the painter still held the removed node. So
  // the two shapes are made ONCE here and never leave the tree; a frame only changes `points` and the opacity.
  const poly = (cls, g) => {
    const n = document.createElementNS(NS, "polygon");
    n.setAttribute("class", cls);
    n.setAttribute("points", corners(styleOf(REST, 1)));
    g.appendChild(n);
    return n;
  };
  const restBox = poly("kf-pv-rest", back);                    // where the box comes to rest, as an outline
  const box = poly("kf-pv-obj", objs);
  const place = (st) => {
    box.setAttribute("points", corners(st));
    box.style.opacity = String(st.opacity === undefined ? 1 : st.opacity);
  };
  function draw(step, i) {
    place(step.style);
    fill.style.width = `${built.steps.length > 1 ? (100 * i) / (built.steps.length - 1) : 0}%`;
  }
  function stop() {
    clearTimeout(timer);
    timer = null;
  }
  function tick() {
    timer = null;
    if (!visible()) return;                                    // the pane is hidden or the panel closed: no timer left running
    try {
      draw(built.steps[at], at);
    } catch (e) {
      failed = true;
      if (debug) debug(`inout preview: ${e && e.stack ? e.stack : e}`);
      return;
    }
    at = (at + 1) % built.steps.length;
    // a hidden panel can still look visible to UXP (stale sizes, measured 2026-11-21), so the loop also ends by itself:
    // LOOPS plays without a pointer move or a new pick, then it rests until the next one
    if (at === 0 && ++loops >= LOOPS) return;
    timer = setTimeout(tick, 1000 / built.fps);
  }
  function wake() {
    loops = 0;
    if (timer === null && !failed && built.animated && visible()) tick();
  }
  function set(view, hovering) {
    // paint() runs on every press and blur: the same picks must not restart the loop
    const now = JSON.stringify([view.canApply, view.opts, view.frames, !!hovering]);
    if (now === sig) return wake();
    sig = now;
    stop();
    failed = false;
    loops = 0;
    built = build(view.opts);
    at = 0;
    const cap = caption(view, built, hovering);
    info.textContent = cap.text;
    info.setAttribute("data-tip", cap.tip);
    restBox.setAttribute("points", corners(built.rest));
    if (built.animated && visible()) return tick();
    place(built.rest);                                           // nothing to play (or hidden): a resting box, no timer
    fill.style.width = "0%";
  }
  return {
    set, wake, stop,
    info: () => ({ animated: built.animated, playing: timer !== null, steps: built.steps.length, lens: built.lens, error: built.error, drawn: objs.childNodes.length }),
  };
}

module.exports = { W, H, BOX_W, BOX_H, FPS, HOLD, PAUSE, REST, exitOf, styleOf, corners, build, caption, mount };
