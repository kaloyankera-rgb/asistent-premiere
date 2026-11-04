const engine = require("./engine.js");
const premiere = require("./premiere.js");
const layout = require("./layout.js");
const premiereAudio = require("./premiere-audio.js");
const audioplan = require("./audioplan.js");
const PANEL_VERSION = require("./version.js");
const premiereImport = require("./premiere-import.js");
const premiereColor = require("./premiere-color.js");
const premiereProbe = require("./premiere-probe.js");
const { plansFor, corrections, statusOf, STATUS_BG } = require("./colorplans.js");
const { cameras, shotMoments } = require("./moments.js");
const { createBridge } = require("./devbridge.js");
const premiereSubtitles = require("./premiere-subtitles.js");
const premiereCaptions = require("./premiere-captions.js");
const { describeResult } = require("./subtitleplan.js");
const { describePlacement } = require("./captionplan.js");
const captionedit = require("./captionedit.js");
const premiereRough = require("./premiere-roughcut.js");
const roughcutplan = require("./roughcutplan.js");

const $ = (id) => document.getElementById(id);
const state = { online: false, busy: false, jobId: null, settleUntil: 0 };

// Every press goes through onTap: it is logged with the button's label (so the log says what was really
// pressed) and ignored for a moment after the panel changed under the pointer. An answer appearing at the
// top moves every button down, and a second click on the same spot landed on Fix audio (2026-11-01).
const SETTLE_MS = 700;

function settle() {
  state.settleUntil = Date.now() + SETTLE_MS;
}

// Every button acts when the mouse button goes down, not on the finished click (0.9.93). The user's screen recordings
// (2026-11-04 10:19 and 10:26): whenever one of Premiere's own panels has the focus (after a write it shows the new value in
// Effect Controls, or the user worked in the timeline), the first click on Asistent only takes the focus back and never
// arrives as a click; the cursor is an arrow instead of the hand. The press itself does arrive (Exposure ±0.5, 0.9.91: every
// press counted). A press is acted on once, by whichever of pointerdown / mousedown / click comes first; the click that
// ends a press already acted on is not counted again.
// { repeat: true } (Exposure ±0.5, Cancel): never ignored by the "panel just changed" guard; since the 2026-11-03 layout the
// answer appears at the bottom and nothing above it moves, and the guard ate every quick second press.
function onTap(button, fn, opts = {}) {
  let downAt = 0;
  const act = (kind) => {
    if (button.disabled) return;                     // own buttons are divs: a disabled one must not act (enable())
    const label = (button.textContent || "").trim();
    if (!opts.repeat && Date.now() < state.settleUntil) {
      engine.log("info", `panel: click ignored (panel just changed): ${label}`);
      return;
    }
    engine.log("info", `panel: click${kind === "click" ? "" : ` (${kind})`}: ${label}`);
    fn();
  };
  for (const kind of ["pointerdown", "mousedown"]) {
    button.addEventListener(kind, () => {
      const now = Date.now();
      if (now - downAt < 80) return;                    // the same press reported as pointerdown and as mousedown
      downAt = now;
      act(kind);
    });
  }
  button.addEventListener("click", () => {
    if (Date.now() - downAt < 1000) return;              // the end of a press already acted on when it went down
    act("click");                                        // no down event arrived for this press (also the test bridge)
  });
}

function show(id, visible) {
  $(id).hidden = !visible;
}

// The buttons are Asistent's own (divs with class btn, 0.9.72): Premiere draws every <button> with its own grey face
// and ignores the panel's colours. `disabled` is what onTap and the test bridge read; the attribute dims it (CSS).
function enable(b, on) {
  b.disabled = !on;
  if (on) b.removeAttribute("disabled");
  else b.setAttribute("disabled", "");
}

function setBusy(busy) {
  state.busy = busy;
  for (const b of document.querySelectorAll(".btn.action, .btn.small")) enable(b, !busy && state.online);
  show("work", busy);
  if (busy && $("paneTools").hidden) openTab("paneTools");      // the progress and Cancel are there
  settle();
}

function progress(fraction, message) {
  $("fill").style.width = `${Math.round(fraction * 100)}%`;
  $("message").textContent = message || "";
}

function signed(seconds) {
  return `${seconds >= 0 ? "+" : "−"}${Math.abs(seconds).toFixed(3)} s`;
}

// a camera clock difference in words: "+730 days 0:47 h", "−3:12 min"
function clockGap(seconds) {
  const s = Math.abs(Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sign = seconds >= 0 ? "+" : "−";
  if (d) return `${sign}${d} days ${h}:${String(m).padStart(2, "0")} h`;
  if (h) return `${sign}${h}:${String(m).padStart(2, "0")} h`;
  return `${sign}${m}:${String(s % 60).padStart(2, "0")} min`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// A button made in code: label, its tooltip and its handler (through onTap like every other press).
function button(cls, label, help, fn) {
  const b = el("div", `btn ${cls}`, label);
  b.setAttribute("data-tip", help);
  onTap(b, fn);
  return b;
}

// ---------------------------------------------------------------- tooltips
// UXP shows nothing for `title`, so every button carries data-tip and this box shows it after a short hover:
// under the button, above it near the panel's bottom edge, always inside the panel; gone on leave or press.
let tipTimer = null;

function hideTip() {
  clearTimeout(tipTimer);
  show("tip", false);
}

function overNative(x, y, w, h) {
  for (const n of document.querySelectorAll("input, textarea, select")) {
    const b = n.getBoundingClientRect();
    if (!b.width || !b.height) continue;                 // hidden
    if (b.left < x + w && b.right > x && b.top < y + h && b.bottom > y) return true;
  }
  return false;
}

function showTip(node) {
  const box = $("tip");
  box.textContent = node.getAttribute("data-tip");
  box.hidden = false;
  const r = node.getBoundingClientRect();
  const W = document.body.clientWidth || window.innerWidth;
  const H = document.body.clientHeight || window.innerHeight;
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const x = Math.min(Math.max(6, r.left), Math.max(6, W - w - 6));
  let y = r.bottom + 4;
  // text boxes and dropdowns are drawn by Premiere over everything, so a tip below a button can end up under them
  // (2026-11-04: "Apply and rebuild" over the caption lines): then it goes above the button
  if (y + h > H - 6 || overNative(x, y, w, h)) y = Math.max(6, r.top - h - 4);
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
}

function bindTips(root) {
  for (const n of root.querySelectorAll("[data-tip]")) {
    if (n.getAttribute("data-tip-bound")) continue;
    n.setAttribute("data-tip-bound", "1");
    n.addEventListener("mouseenter", () => {
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => showTip(n), 450);
    });
    n.addEventListener("mouseleave", hideTip);
    n.addEventListener("pointerdown", hideTip);
  }
}

// ---------------------------------------------------------------- views and the result of a run
// The main view keeps only the summary, the decisions (Apply …) and links; the full report goes to
// Log and the before/after pictures to Before / after (2026-11-03: they used to push the buttons away).
const history = [];

function openTab(pane) {
  hideTip();
  for (const t of document.querySelectorAll(".btn.tab")) {
    const on = t.getAttribute("data-tab") === pane;
    t.className = on ? "btn tab on" : "btn tab";
    show(t.getAttribute("data-tab"), on);
  }
  try {
    $("app").scrollTop = 0;
  } catch (e) {
    /* older UXP */
  }
}

function fillWith(id, nodes) {
  const box = $(id);
  box.innerHTML = "";
  for (const n of nodes || []) box.appendChild(n);
  bindTips(box);
}

/**
 * text: one line; ok: green/red; blocks: the report (Log); opts.actions: () => [buttons] for the
 * decisions, shown under the summary and above the pictures; opts.previews: [nodes] for Before / after.
 */
// The toast (2026-11-04: "a little pop up when something is added or removed, so we don't have to look at the bottom"):
// every answer also shows for a few seconds under the header, visible wherever the list is scrolled.
const TOAST_MS = { ok: 3500, err: 7000 };

function toast(text, ok) {
  const box = $("toast");
  box.textContent = text;
  box.className = ok ? "toast" : "toast err";
  // over the project name and the engine line (text only): under the header it covered the tabs, and a tab clicked in those
  // seconds hit the toast instead (0.9.93)
  box.style.top = `${$("top").getBoundingClientRect().top + 4}px`;
  box.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { box.hidden = true; }, ok ? TOAST_MS.ok : TOAST_MS.err);
}

function finish(text, ok, blocks, opts = {}) {
  toast(opts.toast || text, ok);
  show("result", true);                          // at the bottom of the panel (2026-11-03): the list does not need to scroll
  settle();
  $("summary").textContent = text;
  $("summary").className = ok ? "ok" : "err";
  fillWith("details", blocks);
  $("logSummary").textContent = text;
  $("logSummary").className = ok ? "ok" : "err";
  const warns = $("details").querySelectorAll(".warn, .err").length;
  const link = $("openLog");
  link.textContent = warns ? `Details · ${warns} ${warns === 1 ? "note" : "notes"}` : "Details";
  link.className = warns ? "btn link has-warn" : "btn link";
  show("openLog", (blocks || []).length > 0);
  $("logBadge").textContent = warns ? String(warns) : "!";
  $("logBadge").className = ok ? "count" : "count err";
  show("logBadge", warns > 0 || !ok);
  fillWith("actions", opts.actions ? opts.actions() : []);
  const pics = opts.previews || [];
  fillWith("previews", pics);
  fillWith("previewActions", pics.length && opts.actions ? opts.actions() : []);
  show("tabPreview", pics.length > 0);
  show("openPreview", pics.length > 0);
  if (!pics.length && !$("panePreview").hidden) openTab("paneTools");
  history.unshift({ at: new Date().toLocaleTimeString().slice(0, 5), text, ok });
  history.length = Math.min(history.length, 11);
  fillWith("history", history.slice(1).map((h) => el("div", `history-item ${h.ok ? "" : "err"}`, `${h.at}  ${h.text}`)));
  if (history.length < 2) $("history").textContent = "None yet.";
}

async function refreshHeader() {
  const st = await engine.status();
  state.online = !!(st && st.ok);
  $("dot").className = `dot ${state.online ? "on" : "off"}`;
  // short, it shares the line with the project name; both versions only when they differ
  $("engine").textContent = !state.online ? `No engine · ${PANEL_VERSION}`
    : st.version === PANEL_VERSION ? `Connected · ${PANEL_VERSION}` : `Connected · panel ${PANEL_VERSION} · engine ${st.version}`;
  $("detail").textContent = state.online ? "" : `${st.error}. Check that the engine is running (README).`;
  show("detail", !state.online);
  try {
    const project = await premiere.activeProject();
    $("project").textContent = project.name;
    if (state.online && !state.busy) loadSubtitleSettings(project.path);
  } catch (e) {
    $("project").textContent = "No project open";
  }
  if (!state.busy) for (const b of document.querySelectorAll(".btn.action, .btn.small")) enable(b, state.online);
  if (state.online && Date.now() - (state.updateAt || 0) > UPDATE_EVERY_MS) checkUpdate(false);
  if (state.online && !state.modelShown) {                 // once per start: does the subtitle section need the install?
    state.modelShown = true;
    engine.subtitlesModel().then(renderSubtitleModel).catch(() => {
      state.modelShown = false;
    });
  }
}

// ---------------------------------------------------------------- updates (GitHub releases, through the engine)

const UPDATE_EVERY_MS = 3 * 3600 * 1000;                     // the engine itself asks GitHub at most every 6 hours

async function checkUpdate(force) {
  state.updateAt = Date.now();
  try {
    const u = await engine.updateCheck(force);
    if (u.just_updated) finish(u.just_updated, true);       // the panel reloaded during the update: say it happened
    state.update = u.newer ? u : null;
    $("updateText").textContent = u.newer ? `Asistent ${u.latest} is available (you have ${u.current}).` : "";
    if (u.newer && u.notes) $("updateGo").setAttribute("data-tip", `What is new: ${u.notes}`);
    show("update", !!u.newer);
  } catch (e) {
    /* offline or an old engine: no update line */
  }
}

async function onUpdate() {
  if (state.busy || !state.update) return;
  show("result", false);
  setBusy(true);
  progress(0, `Updating to ${state.update.latest}…`);
  try {
    const r = await engine.startUpdate();
    const res = await runJob(r.job);                          // the new panel may load before this returns: it then says it
    show("update", false);
    finish(res.text, true);
  } catch (e) {
    finish(e.message || String(e), false);
    engine.log("error", `update: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runJob(id) {
  state.jobId = id;
  for (;;) {
    const j = await engine.job(id);
    progress(0.05 + 0.85 * j.progress, j.message);
    if (j.state === "done") return j.result;
    if (j.state === "cancelled") throw new premiere.UserError("Cancelled.");
    if (j.state === "error") throw new premiere.UserError(j.error || "Engine error.");
    await wait(300);
  }
}

function describe(result, timeline, lay) {
  const name = (i) => result.clips[i].name;
  const blocks = [];
  // groups in the order they sit in the new sequence (recording order), when it was built
  const first = (g) => (lay ? lay.placements.findIndex((p) => g.members.some((m) => m.clip === p.clip)) : 0);
  result.groups.slice().sort((a, b) => first(a) - first(b)).forEach((g, n) => {
    const box = el("div", "group");
    box.appendChild(el("div", "name", `Group ${n + 1}: ${g.members.map((m) => name(m.clip)).join(", ")}`));
    for (const m of g.members) {
      if (m.clip !== g.anchor) box.appendChild(el("div", "line", `${name(m.clip)}  ${signed(m.offset)} against ${name(g.anchor)}`));
    }
    // pairs that needed the scattered-window rule or the clocks say how they were decided
    for (const x of result.accepted_notes || []) {
      if (g.members.some((m) => m.clip === x.a)) box.appendChild(el("div", "hint", `${name(x.a)} and ${name(x.b)}: ${x.text}`));
    }
    blocks.push(box);
  });
  const notes = [];
  if (result.unsynced.length) {
    notes.push(`No shared sound with another clip (placed where they belong in recording time): ${result.unsynced.map(name).join(", ")}`);
  }
  for (const c of result.clocks || []) {
    if (c.linked && c.name !== result.clock_reference && Math.abs(c.offset) >= 60) {
      notes.push(`The clock of ${c.name} is off against ${result.clock_reference} (${clockGap(c.offset)}): corrected by the sync.`);
    }
  }
  for (const u of (lay && lay.uncertain) || []) notes.push(`Uncertain place: ${u.name} (${u.reason}).`);
  for (const c of result.conflicts) notes.push(`Not synced: ${c.reason}.`);
  for (const s of result.suggestions) {
    const why = (s.reasons || []).join(" ");
    notes.push(`Possible but uncertain (not applied): ${name(s.a)} and ${name(s.b)} ${signed(s.offset)}.` +
      `${why ? ` Reason: ${why}` : ""} Check it by hand.`);
  }
  for (const s of timeline.skipped) notes.push(`Skipped: ${s}.`);
  for (const n of notes) blocks.push(el("div", "warn", n));
  return blocks;
}

async function onSync() {
  if (state.busy) return;
  if (!state.online) {
    finish("No connection to the engine. See README.", false);
    return;
  }
  show("result", false);
  setBusy(true);
  progress(0, "Reading the selected clips in the timeline…");
  try {
    const project = await premiere.activeProject();
    const timeline = await premiere.readTimeline(project);
    if (timeline.clips.length < 2) {
      const seen = timeline.clips.map((c) => c.name).join(", ") || "nothing";
      throw new premiere.UserError(`Sync lines up at least two cameras: select clips from at least two different ` +
        `files. Selected now: ${seen}. (For color or audio one clip is enough: the buttons in COLOR and AUDIO.)`);
    }
    engine.log("info", `timeline: ${timeline.clips.length} files selected, fps ${timeline.fps}`);
    const t0 = Date.now();
    const { job } = await engine.startGroups(timeline.clips.map((c) => c.path));
    const result = await runJob(job);
    if (!result.groups.length) {
      finish("Found no clips with surely shared sound. No sequence was made.", false, describe(result, timeline));
      return;
    }
    progress(0.95, "Making the SYNC sequence…");
    const order = Object.fromEntries(timeline.clips.map((c) => [c.path, c.start]));
    const lay = layout.syncLayout(result, order);
    const blocks = describe(result, timeline, lay);
    const done = await premiere.buildSyncSequence(project, timeline, lay);
    const secsTaken = ((Date.now() - t0) / 1000).toFixed(0);
    if (done.bad.length) {
      finish(`${done.name} was made, but the check failed for: ${done.bad.join(", ")}. Check them by hand.`, false, blocks);
      return;
    }
    const synced = result.groups.reduce((n, g) => n + g.members.length, 0);
    finish(`Done in ${secsTaken} s: ${done.name}, ${synced} clips in ${result.groups.length} groups. ` +
      `Checked (off by at most ${done.worstMs.toFixed(1)} ms from the frames). Your sequence was not touched.`, true, blocks);
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `sync: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
  }
}

async function onAudio(force) {
  // "phrases": everything "Fix audio" does, plus Volume keyframes that even out the phrases
  const phrases = force === "phrases";
  if (state.busy) return;
  if (!state.online) {
    finish("No connection to the engine. See README.", false);
    return;
  }
  show("result", false);
  setBusy(true);
  progress(0, "Reading the selected clips…");
  try {
    const project = await premiere.activeProject();
    const sel = await premiereAudio.readAudioSelection(project);
    if (!sel.items.length) throw new premiere.UserError("Select at least one clip with sound in the timeline (its video or its audio).");
    const work = audioplan.engineJobs(sel.items, force);
    engine.log("info", `audio: ${sel.items.length} clips (${work.jobs.length} measured), force ${force || "auto"}`);
    const { job } = await engine.startAudio(work.jobs, phrases);
    const result = await runJob(job);
    const plans = sel.items.map((it, i) => ({ it, res: result.items[work.index[i]], routed: null, lines: [], problems: [] }));
    for (const p of plans) if (p.res.error) p.problems.push(p.res.error);

    // the channels: the host makes the L/L and R/R copies and puts them where the clip is (ExtendScript)
    const todo = plans.map((p) => ({ p, route: audioplan.routeFor(p.it, p.res, force) })).filter((x) => x.route);
    if (todo.length) {
      progress(0.9, `Splitting the channels: ${todo.length} ${todo.length === 1 ? "clip" : "clips"}…`);
      const answer = await engine.routeAudio({ sequence: sel.timeline.sequence.name, project: project.path,
        items: todo.map((x) => ({ track: x.p.it.track, start: x.p.it.start, end: x.p.it.end, route: x.route })) });
      if (!answer.ok) throw new premiere.UserError(answer.msg || "Premiere did not split the channels.");
      todo.forEach((x, i) => { x.p.routed = answer.items[i] || { ok: false, msg: "no answer" }; });
      engine.log("info", `audio route: ${JSON.stringify(answer.items)}`);
    }
    progress(0.95, "Setting the levels…");
    const { undoSteps } = await premiereAudio.applyLevels(project, sel.timeline.sequence, audioplan.levelTargets(plans));

    const blocks = [];
    let changed = 0;
    let failed = 0;
    for (const p of plans) {
      const box = el("div", "group");
      box.appendChild(el("div", "name", p.it.name));
      // a side Asistent made earlier: its analysis lines describe the pair, not this clip
      if (p.it.side) {
        box.appendChild(el("div", "reason", "Already split by Asistent: level only."));
        // what the pair's analysis said about the balance of the two speakers still applies
        for (const r of (p.res && p.res.reasons) || []) if (/The speakers differed|has no speaker of its own/.test(r)) box.appendChild(el("div", "reason", r));
      }
      else if (p.it.route) box.appendChild(el("div", "reason", "Has a Fill effect from before: channels left alone, level only."));
      else for (const r of (p.res && p.res.reasons) || []) if (r) box.appendChild(el("div", "reason", r));
      const line = audioplan.routeLine(p.routed);
      if (line) box.appendChild(el("div", p.routed.ok ? "line" : "warn", line));
      for (const l of p.lines) box.appendChild(el("div", "line", l));
      if (p.res && p.res.action === "ask") box.appendChild(el("div", "warn", "Not touched: choose by hand (Manual ▸)."));
      if (p.routed && !p.routed.ok) p.problems.push("the channels were not split");
      for (const pr of p.problems) box.appendChild(el("div", "warn", pr));
      if (p.problems.length) failed++;
      else if (p.res && p.res.action !== "ask") changed++;
      blocks.push(box);
    }
    for (const s of sel.skipped) blocks.push(el("div", "warn", `Skipped: ${s}.`));
    blocks.push(el("div", "hint", `The limiter (Dynamics → Limiter ${audioplan.LIMITER_DB} dB) is on every clip, not on the Mix track: Premiere's ` +
      "scripts cannot reach the main track. The sum of both tracks is kept under −6 dB by the levels themselves."));
    const split = plans.filter((p) => p.routed && p.routed.ok && p.routed.status === "done").length;
    const clips = (n) => `${n} ${n === 1 ? "clip" : "clips"}`;
    const undo = [undoSteps ? `the levels and the limiter are ${undoSteps === 1 ? "one step" : `${undoSteps} steps`} of Cmd/Ctrl+Z` : "",
      split ? "the split is separate Premiere steps (the copies and the link of each clip)" : ""].filter(Boolean).join("; ");
    finish(`${failed ? `Done with problems: ${clips(changed)} fixed, ${failed} not.` : `Done: ${changed} of ${clips(plans.length)}.`}` +
      `${split ? ` Split: ${split}.` : ""}${undo ? ` Undo: ${undo}.` : ""}`, !failed, blocks);
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `audio: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
  }
}

// ---------------------------------------------------------------- subtitles

const gb = (b) => (b / 1e9).toFixed(1).replace(".", ",");

// What the section says about the speech model, and whether to offer the download (never started on its own).
function renderSubtitleModel(st) {
  let text = "";
  if (!st.backend) {
    text = "The speech recognition packages are missing: run scripts/setup_mac.sh --subtitles (see README).";
  } else if (!st.model) {
    text = `The Bulgarian speech model (about ${gb(st.expected_bytes)} GB) is not downloaded yet. It will be saved in ${st.dir}.` +
      (st.bytes ? ` ${gb(st.bytes)} GB are already downloaded: the download continues from there.` : "");
  }
  // the English line needs the translator: offered only where the speech model is there and the line is wanted
  const noTranslator = st.backend && st.model && st.translator === false && $("subtitleEnglish").checked;
  if (noTranslator) text = `The English line needs the translator (about ${st.translator_mb || 620} MB), not downloaded yet.`;
  $("subtitleModel").textContent = text;
  show("subtitleModel", !!text);
  show("subtitleAsk", st.backend && !st.model);
  show("translatorAsk", !!noTranslator);
}

// who speaks and the corrections text are kept per project in the engine; shown again when the project changes
async function saveSubtitleSettings(path) {
  const r = await engine.saveSubtitleSettings(path, $("notes").value);
  showNotesState(r.errors || []);
  return r;
}

function showNotesState(errors) {
  $("notesState").textContent = errors.length ? `Not understood: ${errors.join("; ")}` : "";
  show("notesState", errors.length > 0);
}

async function loadSubtitleSettings(path) {
  if (state.settingsFor === path) return;
  state.settingsFor = path;
  try {
    const r = await engine.subtitleSettings(path);
    $("notes").value = r.text || "";
  } catch (e) {
    state.settingsFor = null;
  }
}

// The caption editor (the Captions tab): one field per line of the last subtitles. What the user changed becomes
// correction lines (captionedit.js); the next run applies them and places the result on a NEW caption track.
const captionEdit = { result: null, inputs: [], enInputs: [] };

// The editor's own English lines, per project on this computer: {Bulgarian line (normalised): English}. Sent with every
// subtitles run; the engine keeps them wherever the Bulgarian line is still the same (subtitle_job.py, english_fixed).
const lineKey = (s) => String(s || "").trim().split(/\s+/).join(" ").toLowerCase();

function englishFixed(projectPath) {
  try {
    return JSON.parse(localStorage.getItem(`asistent.englishFixed.${projectPath}`) || "{}");
  } catch (e) {
    return {};
  }
}

function saveEnglishFixed(projectPath, map) {
  try {
    localStorage.setItem(`asistent.englishFixed.${projectPath}`, JSON.stringify(map));
  } catch (e) {
    /* no storage: the fixes last until the next rebuild only */
  }
}

function renderCaptionEditor(result) {
  captionEdit.result = result;
  captionEdit.inputs = [];
  captionEdit.enInputs = [];
  const list = $("captionList");
  while (list.firstChild) list.removeChild(list.firstChild);
  const unsure = new Set((result.review || []).map((r) => Math.round(r.at * 10)));
  for (const c of result.captions) {
    const row = el("div", (c.flags || []).length || [...unsure].some((u) => u >= Math.round(c.start * 10) && u <= Math.round(c.end * 10)) ? "capline flag" : "capline");
    row.appendChild(el("span", "t", `${Math.floor(c.start / 60)}:${String(Math.floor(c.start % 60)).padStart(2, "0")}`));
    const input = document.createElement("input");
    input.value = String(c.text).replace(/\s+/g, " ");
    input.setAttribute("data-original", input.value);
    input.addEventListener("input", () => { row.className = row.className.replace(" edited", "") + (input.value !== input.getAttribute("data-original") ? " edited" : ""); });
    captionEdit.inputs.push(input);
    row.appendChild(input);
    list.appendChild(row);
    if (c.en !== undefined) {                              // the English line under it, editable too
      const enRow = el("div", "capline en");
      enRow.appendChild(el("span", "t", "EN"));
      const en = document.createElement("input");
      en.value = String(c.en || "");
      en.setAttribute("data-original", en.value);
      en.addEventListener("input", () => { enRow.className = en.value !== en.getAttribute("data-original") ? "capline en edited" : "capline en"; });
      captionEdit.enInputs.push(en);
      enRow.appendChild(en);
      list.appendChild(enRow);
    } else {
      captionEdit.enInputs.push(null);
    }
  }
  $("captionEditState").textContent = `${result.captions.length} lines. Lines with a yellow edge hold a word that is not certain.`;
  show("tabCaptions", true);
}

async function onCaptionApply() {
  if (state.busy || !captionEdit.result) return;
  const edited = captionEdit.inputs.map((i) => i.value);
  const pairs = captionedit.pairsFromEdits(captionEdit.result.captions, edited);
  // English lines typed right: kept for their Bulgarian line as it will read after the rebuild (the edited one)
  const enChanged = captionEdit.enInputs.map((en, i) => [en, i]).filter(([en]) => en && en.value.trim() !== en.getAttribute("data-original"));
  if (!pairs.length && !enChanged.length) {
    $("captionEditState").textContent = "Nothing changed: type a word right in one of the lines first.";
    return;
  }
  if (enChanged.length) {
    const project = await premiere.activeProject();
    const map = englishFixed(project.path);
    for (const [en, i] of enChanged) map[lineKey(edited[i])] = en.value.trim();
    saveEnglishFixed(project.path, map);
  }
  if (pairs.length) $("notes").value = captionedit.addToNotes($("notes").value, pairs);
  const said = [];
  if (pairs.length) said.push(`${pairs.length} ${pairs.length === 1 ? "correction" : "corrections"} added: ${pairs.map((p) => `${p.heard} → ${p.said}`).join("; ")}`);
  if (enChanged.length) said.push(`${enChanged.length} English ${enChanged.length === 1 ? "line" : "lines"} kept as typed`);
  $("captionEditState").textContent = `${said.join(". ")}. Rebuilding…`;
  openTab("paneTools");
  await onSubtitles({ again: true });
}

async function onSubtitles(opts = {}) {
  if (state.busy) return;
  if (!state.online) {
    finish("No connection to the engine. See README.", false);
    return;
  }
  show("result", false);
  setBusy(true);
  progress(0, "Checking the speech model…");
  try {
    const st = await engine.subtitlesModel();
    renderSubtitleModel(st);
    if (!st.backend || !st.model) {
      throw new premiere.UserError(!st.backend ? "The speech recognition packages are missing (see SUBTITLES)."
        : "The speech model is not downloaded yet: press Download the model in SUBTITLES.");
    }
    const project = await premiere.activeProject();
    progress(0.02, "Reading the selected clips…");
    const saved = await saveSubtitleSettings(project.path);                  // what is in the boxes now is what runs, and is remembered
    const { payload, plan } = await premiereSubtitles.readInput(project, [], $("notes").value);
    payload.english = $("subtitleEnglish").checked;                          // the English line under every Bulgarian line
    payload.preset = $("subtitleStyle").value;                               // auto, or a client's own style
    payload.english_fixed = englishFixed(project.path);                      // English lines typed in the Captions tab
    engine.log("info", `subtitles: ${plan.use.length} clips, ${plan.skipped.length} skipped`);
    const { job } = await engine.startSubtitles(payload);
    const result = await runJob(job);
    const out = describeResult(result);
    if (out.ok) {
      // one press: the file is made, then it goes onto a caption track of the same sequence (engine host, see DECISIONS.md)
      progress(0.98, "Putting the subtitles on the timeline…");
      const placed = describePlacement(await premiereCaptions.place(project, await project.getActiveSequence(), result, { again: !!opts.again }), result.srt, !!opts.again);
      out.text = placed.ok ? `Done: ${result.counts.captions} subtitle lines, on the timeline.` : placed.text;
      out.ok = placed.ok;
      out.lines = [...placed.lines, ...out.lines.filter((l) => !/^File: /.test(l.text))];
    }
    if (result.english_note) out.lines.unshift({ cls: "warn", text: result.english_note });
    renderCaptionEditor(result);
    finish(out.text, out.ok, out.lines.map((l) => el("div", l.cls, l.text)));
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `subtitles: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
  }
}

// ---------------------------------------------------------------- rough cut (Phase 8 M2)

// One press: the engine finds the pauses and writes an XML, Premiere imports it as a NEW sequence (the source sequence
// is only read), and the new sequence is checked against the engine's list before it is opened.
async function onRoughCut() {
  if (state.busy) return;
  if (!state.online) {
    finish("No connection to the engine. See README.", false);
    return;
  }
  show("result", false);
  setBusy(true);
  progress(0, "Reading the selected clips…");
  try {
    const project = await premiere.activeProject();
    const opts = { mode: $("roughMode").value, tempo: $("roughTempo").value, markers: $("roughMarkers").checked };
    const { payload, meta } = await premiereRough.readInput(project, opts);
    const { job } = await engine.startRoughcut(payload);
    const result = await runJob(job);
    progress(0.92, "Importing the new sequence…");
    const placed = await premiereRough.place(project, result, meta);
    const out = roughcutplan.describeResult(result, placed);
    finish(out.text, !placed.problems.length, out.lines.map((l) => el("div", l.cls, l.text)));
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `roughcut: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
  }
}

// The user pressed a button that names the size: this is the confirmation (SUBTITLES_PLAN.md, downloads).
async function onSubtitleDownload() {
  if (state.busy) return;
  if (!state.online) {
    finish("No connection to the engine. See README.", false);
    return;
  }
  show("result", false);
  setBusy(true);
  progress(0, "Downloading the model…");
  try {
    const r = await engine.downloadSubtitleModel();
    if (!r.done) await runJob(r.job);
    renderSubtitleModel(await engine.subtitlesModel());
    finish("The model is downloaded. Press Subtitles (Bulgarian).", true);
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `subtitle model: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
    engine.subtitlesModel().then(renderSubtitleModel).catch(() => {});
  }
}

async function onTranslatorDownload() {
  if (state.busy) return;
  if (!state.online) {
    finish("No connection to the engine. See README.", false);
    return;
  }
  show("result", false);
  setBusy(true);
  progress(0, "Downloading the translator…");
  try {
    const r = await engine.downloadTranslator();
    if (!r.done) await runJob(r.job);
    finish("The translator is downloaded. Press Subtitles (Bulgarian) with English line on.", true);
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `translator: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
    engine.subtitlesModel().then(renderSubtitleModel).catch(() => {});
  }
}

// ---------------------------------------------------------------- colour

const CONF = { high: "high", medium: "medium", low: "low" };
// part: null is Auto Color (white and exposure), "white" / "exposure" the separate buttons (same analysis, same apply)
const colorState = { project: null, sel: null, results: null, part: null };

function colorBlock(clip, r) {
  const box = el("div", "group");
  box.appendChild(el("div", "name", clip.name));
  if (r.error) {
    box.appendChild(el("div", "warn", r.error));
    return box;
  }
  if (r.measured_on === "timeline") box.appendChild(el("div", "reason", `Measured on the timeline (${r.frames} frames).`));
  for (const line of colorLines(r, colorState.part)) box.appendChild(el("div", "line", line));
  for (const x of r.reasons || []) box.appendChild(el("div", "reason", x));
  for (const x of r.warnings || []) box.appendChild(el("div", "warn", x));
  return box;
}

function colorLines(r, part = null) {
  const e = r.exposure;
  // stops are what the picture needs; units are what goes into Lumetri (they differ above the shadows)
  const units = e.units !== undefined && e.units !== null && e.units !== e.stops ? ` = Exposure ${e.units > 0 ? "+" : ""}${e.units} in Lumetri` : "";
  const w = r.white;
  const lines = { exposure: e.stops ? `Exposure ${e.stops > 0 ? "+" : ""}${e.stops} stops${units} (${CONF[e.confidence]} confidence)` : "Exposure: no change",
    white: w.balanced ? `White balance: fine (${CONF[w.confidence]})` : `White balance: correction (${CONF[w.confidence]} confidence)` };
  return [part !== "white" ? lines.exposure : null, part !== "exposure" ? lines.white : null].filter(Boolean);
}

// one clip in Before / after: its name, the two pictures and what would change
function previewBlock(name, preview, caption, lines) {
  const box = el("div", "group");
  box.appendChild(el("div", "name", name));
  const row = el("div", preview.portrait ? "thumbs portrait" : "thumbs");
  for (const k of ["before", "after"]) {
    const img = document.createElement("img");
    img.src = `data:image/jpeg;base64,${preview[k]}`;
    row.appendChild(img);
  }
  box.appendChild(row);
  box.appendChild(el("div", "cap", caption));
  for (const l of lines) box.appendChild(el("div", "line", l));
  return box;
}

function colorPlans(level) {
  return plansFor(colorState.sel.clips, colorState.results, level, colorState.part);
}

async function onColor(part = null) {
  if (state.busy) return;
  if (!state.online) return finish("No connection to the engine. See README.", false);
  show("result", false);
  setBusy(true);
  progress(0, "Looking at the selected clips…");
  try {
    const project = await premiere.activeProject();
    const sel = await premiereColor.readVideoSelection(project);
    if (!sel.clips.length) throw new premiere.UserError("Select at least one video clip in the timeline.");
    // measure what is on the timeline (an earlier correction included), not the source file
    const dir = (await engine.status()).frames_dir;
    // all clips' frames are queued in Premiere together and waited for together (premiere-color.js, exportFrames)
    progress(0, `Frames from the timeline: ${sel.clips.length} ${sel.clips.length === 1 ? "clip" : "clips"}…`);
    const tl = dir ? await premiereColor.timelineFrames(sel.timeline, sel.clips, dir,
      (done, total) => progress((0.4 * done) / total, `Frames from the timeline: ${done} of ${total}…`)) : sel.clips.map(() => ({ frames: [] }));
    const items = sel.clips.map((c, i) => ({ path: c.path, start: c.inPt, end: c.outPt, frames: tl[i].frames }));
    const { job } = await engine.startColor(items);
    const result = await runJob(job);
    Object.assign(colorState, { project, sel, results: result.items, part });
    const blocks = sel.clips.map((c, i) => colorBlock(c, result.items[i]));
    const previews = sel.clips.map((c, i) => [c, result.items[i]]).filter(([, r]) => !r.error && r.preview && r.preview.before)
      .map(([c, r]) => previewBlock(c.name, r.preview, "before · after (approximate)", colorLines(r, part)));
    // buttons by what they apply: "and the medium ones" appears whenever it adds a correction "the sure ones" leaves out
    const sure = colorPlans("sure").length;
    const all = colorPlans("all").length;
    const more = corrections(colorPlans("all")) > corrections(colorPlans("sure"));
    const actions = () => [
      ...(sure ? [button("small", `Apply the sure ones (${sure})`, "Puts only the high-confidence corrections into Lumetri.",
        () => onColorApply("sure"))] : []),
      ...(more ? [button("small", `Apply the medium ones too (${all})`, "Also puts the medium-confidence corrections into Lumetri.",
        () => onColorApply("all"))] : []),
    ];
    finish(all ? `Only a proposal: nothing is in Lumetri yet. Press "${sure ? `Apply the sure ones (${sure})` :
      `Apply the medium ones too (${all})`}" below to apply it.` : "Nothing to correct with certainty: nothing was touched.",
    true, blocks, { actions, previews });
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `color: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
  }
}

// Exposure −0.5 / +0.5: the editor's own step, applied at once (premiere-color.js, nudgeExposure). Pressed in quick succession:
// the panel is not greyed out for it (a press takes ~50 ms), and a press that comes while one is being written is added to
// the next write, so no click is lost (2026-11-04).
async function onExposureNudge(delta) {
  if (state.busy) return;                                   // a long task is running: its buttons are greyed, so are these
  if (!state.online) return finish("No connection to the engine. See README.", false);
  if (state.nudging) {
    state.nudgeQueued = (state.nudgeQueued || 0) + delta;
    return;
  }
  state.nudging = true;
  try {
    const project = await premiere.activeProject();
    let step = delta;
    while (step) {
      const sel = await premiereColor.readVideoSelection(project);
      if (!sel.clips.length) throw new premiere.UserError("Select at least one video clip in the timeline.");
      const r = await premiereColor.nudgeExposure(project, sel.clips, step);
      const done = r.results.filter((x) => !x.skipped);
      const skipped = r.results.filter((x) => x.skipped);
      const blocks = r.results.map((x) => {
        const box = el("div", "group");
        box.appendChild(el("div", "name", x.clip.name));
        box.appendChild(el("div", x.skipped ? "warn" : "line", x.line));
        return box;
      });
      const steps = r.steps === 1 ? "one Undo step" : `${r.steps} Undo steps`;
      const one = done.length === 1 ? ` (now ${done[0].now > 0 ? "+" : ""}${done[0].now})` : "";
      const signed = (v) => `${v > 0 ? "+" : ""}${v}`;
      // the toast in plain words: "+0.5 exposure added · C0728 now +1" / "0.5 exposure removed · 3 clips"
      const short = !done.length ? "Exposure not changed: see the details"
        : `${step > 0 ? `+${step} exposure added` : `${-step} exposure removed`} · ` +
          (done.length === 1 ? `${done[0].clip.name} now ${signed(done[0].now)}` : `${done.length} clips`) +
          (skipped.length ? ` · ${skipped.length} not touched` : "");
      finish(done.length ? `Exposure ${signed(step)} on ${done.length} ${done.length === 1 ? "clip" : "clips"}${one}, ${steps}` +
        (skipped.length ? `; ${skipped.length} not touched.` : ".") : "Nothing changed: see the details.", done.length > 0, blocks, { toast: short });
      engine.log("info", `exposure nudge ${step}: ${r.results.map((x) => `${x.clip.name} ${x.line}`).join(" | ")}`);
      step = state.nudgeQueued || 0;
      state.nudgeQueued = 0;
    }
  } catch (e) {
    state.nudgeQueued = 0;
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `exposure nudge: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.nudging = false;
  }
}

// one JSON record per clip and press in the engine's audit log (colour plan B4); never blocks the panel
function audit(pl, level) {
  const chk = (c) => (c ? { new_clipping: c.new_clipping, clipping_status: c.clipping_status, exposure_before: c.exposure_before,
    exposure_after: c.exposure_after, cast_before: c.cast_before, cast_after: c.cast_after, gates: c.gates } : null);
  engine.colorAudit({
    clip: pl.clip.name, path: pl.clip.path, in: pl.clip.inPt, out: pl.clip.outPt, button: level, part: colorState.part, status: pl.status,
    measured_on: pl.res.measured_on, suggestion: { stops: pl.res.exposure.stops, units: pl.res.exposure.units,
      exposure_confidence: pl.res.exposure.confidence, white: pl.res.white },
    asistent_lumetri: !!(pl.t && pl.t.owned), before: pl.t ? pl.t.current : null, written: pl.values || null,
    final: pl.final || null, reverted: pl.reverted || [], first_check: chk(pl.firstChk), final_check: chk(pl.finalChk),
    lines: pl.lines || [],
  }).catch(() => {});
}

async function onColorApply(level) {
  if (state.busy || !colorState.sel) return;
  setBusy(true);
  progress(0.5, "Applying in Lumetri and checking on a frame…");
  try {
    const plans = colorPlans(level);
    const { steps } = await premiereColor.apply(colorState.project, colorState.sel.timeline, plans);
    const blocks = plans.map((pl) => {
      pl.status = statusOf(pl);
      audit(pl, level);
      const box = el("div", "group");
      box.appendChild(el("div", "name", `${pl.clip.name} · ${STATUS_BG[pl.status]}`));
      for (const l of pl.lines || []) box.appendChild(el("div", "line", l));
      if (pl.left && pl.left.length && !pl.skipped) {
        box.appendChild(el("div", "warn", `Not applied (medium confidence): ${pl.left.join(" and ")}. ` +
          "To add it too: press the same button again and Apply the medium ones too (it adds to this correction)."));
      }
      return box;
    });
    const undo = steps === 1 ? "One Cmd/Ctrl+Z undoes everything." : steps > 1 ? `${steps} times Cmd/Ctrl+Z undo everything.` : "";
    // a clip that already has a graded Lumetri is left alone: never report it as applied
    const done = plans.filter((pl) => !pl.skipped).length;
    const skipped = plans.length - done;
    finish(done ? `Applied to ${done} ${done === 1 ? "clip" : "clips"}${skipped ? `, ${skipped} skipped` : ""}. ${undo}`
      : "Nothing was applied: see the reason below.", done > 0, blocks);
    colorState.sel = null;
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `color apply: ${e && e.stack ? e.stack : e}`);
  } finally {
    setBusy(false);
  }
}

// capability probe: asks first, because it puts a Lumetri on the selected clip. The question opens right
// under the probe button, so nothing above it moves and a second click hits the probe button again
function onProbeAsk() {
  if ($("probeConfirm")) return;
  const row = $("probe").parentNode;
  const box = el("div", "confirm");
  box.id = "probeConfirm";
  box.appendChild(el("p", "hint", "The probe puts Lumetri on the selected clip, writes one parameter at a time, exports frames and " +
    "restores the values. Test project only, with ONE selected video clip without Lumetri."));
  const bar = el("div", "row buttons");
  const close = () => box.parentNode && box.parentNode.removeChild(box);
  bar.appendChild(button("small", "Yes, run the probe", "Puts Lumetri on the selected clip and measures how it responds. Test project only.", () => {
    close();
    onProbe();
  }));
  bar.appendChild(button("small", "No", "Closes the question, nothing is touched.", close));
  box.appendChild(bar);
  row.parentNode.insertBefore(box, row.nextSibling);
  bindTips(box);
  settle();
}

const STATE_BG = { SUPPORTED: "works", BLOCKED: "not available", UNVERIFIED: "not measured reliably" };

async function onProbe() {
  if (state.busy) return;
  setBusy(true);
  progress(0.3, "Probe: parameters, writing, frames…");
  try {
    const project = await premiere.activeProject();
    const rep = await premiereProbe.run(project);
    const res = rep.result || {};
    const blocks = [];
    const tbl = el("div", "group");
    tbl.appendChild(el("div", "name", `Premiere ${rep.host ? rep.host.version : "?"} · Lumetri: ${rep.lumetriMatch} · ` +
      `${(rep.lumetriParams || []).length} parameters · frame export: ${rep.exporter ? "yes" : "no"}`));
    for (const [k, v] of Object.entries(res.table || {})) {
      tbl.appendChild(el("div", "line", `${k}: ${STATE_BG[v] ? `${v} (${STATE_BG[v]})` : v}`));
    }
    blocks.push(tbl);
    const units = res.units || {};
    if (Object.keys(units).length) blocks.push(el("div", "line", `Units: ${JSON.stringify(units)}`));
    if (res.identity) blocks.push(el("div", "line", `An empty Lumetri changes the frame by: ${JSON.stringify(res.identity)}`));
    if (res.error) blocks.push(el("div", "warn", res.error + (rep.exportError ? ` Premiere said: ${rep.exportError}` : "")));
    blocks.push(el("div", "reason", `Input LUT of the clip: ${rep.colorManagement.clipInputLUT || "none"}; embedded: ` +
      `${rep.colorManagement.clipEmbeddedLUT || "none"}. An empty Lumetri is left on the clip: delete it or Cmd/Ctrl+Z.`));
    finish("The probe is done: the result is saved in the engine too.", !res.error, blocks);
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `probe: ${e && e.stack ? e.stack : e}`);
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- Auto Shot Match

const shotState = {};
const SHOT_NAMES = { exposure: "Exposure", temperature: "Temperature", tint: "Tint", contrast: "Contrast", saturation: "Saturation" };
const SHOT_PART_BG = { white: "white balance", exposure: "brightness", saturation: "saturation", contrast: "contrast" };
const SHOT_STATUS_BG = { CORRECTED: "matched", ALREADY_MATCHED: "already matches", REVERTED: "reverted (it got worse)",
  PARTLY_REVERTED: "matched, part reverted", BLOCKED: "not touched (manual grade)", FAILED: "did not work" };

// Selected clips from two or more cameras → a suggestion against one reference camera (chosen, or the most
// reliable one). Nothing is written until Apply the match.
async function onShotMatch(reference = null) {
  if (state.busy) return;
  if (!state.online) return finish("No connection to the engine. See README.", false);
  show("result", false);
  setBusy(true);
  progress(0, "Looking at the cameras…");
  try {
    const project = await premiere.activeProject();
    const sel = await premiereColor.readVideoSelection(project);
    const clips = sel.clips.filter((c) => Math.abs((c.speed ?? 1) - 1) < 0.01 && !c.reversed);
    const odd = sel.clips.length - clips.length;
    const cams = cameras(clips);
    if (new Set(cams).size < 2) {
      throw new premiere.UserError("Select clips from at least two cameras (different folders) in the timeline.");
    }
    const items = [];
    for (const [i, c] of clips.entries()) {
      progress((0.3 * i) / clips.length, `Preparing ${i + 1} of ${clips.length}…`);
      const m = shotMoments(c, clips.filter((_, j) => cams[j] !== cams[i]));
      const st = await premiereColor.lumetriState(c);
      items.push({ path: c.path, camera: cams[i], times: m.times.map((t) => (c.inPt || 0) + (t - c.start)),
        overlap: m.overlap, current: st.current, lumetri: st.lumetri });
    }
    const { job } = await engine.startShotMatch(items, reference);
    state.jobId = job;
    const res = await runJob(job);
    Object.assign(shotState, { project, sel, clips, res, job, reference });
    const blocks = [];
    const top = el("div", "group");
    top.appendChild(el("div", "name", `Reference: ${res.reference}`));
    top.appendChild(el("div", "reason", reference ? "Chosen by you. Another camera as the reference: the buttons above."
      : "Chosen automatically (the most reliable camera). Another camera as the reference: the buttons above."));
    for (const n of res.notes || []) top.appendChild(el("div", "warn", n));
    if (odd) top.appendChild(el("div", "warn", `${odd} clips with changed speed were skipped.`));
    blocks.push(top);
    for (const r of res.clips) blocks.push(shotBlock(clips[r.index], r));
    const previews = res.clips.filter((r) => r.role === "match" && r.preview && r.preview.before)
      .map((r) => previewBlock(clips[r.index].name, r.preview, "now · after (approximate)", [shotLine(r)]));
    const ready = res.clips.filter((r) => r.role === "match" && (r.changed || []).length && r.lumetri !== "manual").length;
    // the decisions: apply, and the reference as a plain choice (one button per camera, the current one ticked)
    const actions = () => [
      ...(ready ? [button("small", `Apply the match (${ready})`, "Puts the proposed values into Lumetri of the cameras being matched.",
        onShotMatchApply)] : []),
      ...res.cameras.map((cam) => (cam === res.reference
        ? button("small", `✓ ${cam}`, "This is the reference: the other cameras are matched to it.", () => {})
        : button("small", cam, `Runs the match again with ${cam} as the reference.`, () => onShotMatch(cam)))),
    ];
    finish(ready ? "Only a proposal: nothing is in Lumetri yet. Press Apply the match."
      : "Nothing to match with certainty: nothing was touched.", true, blocks, { actions, previews });
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `shot match: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
  }
}

function shotLine(r) {
  const ch = r.changed || [];
  return ch.length ? ch.map((k) => `${SHOT_NAMES[k]} ${r.proposal[k]}`).join(" · ")
    : "no change: it already matches or the differences are noted below";
}

function shotBlock(clip, r) {
  const box = el("div", "group");
  const role = r.role === "reference" ? "reference" : r.role === "match" ? "matched" : "skipped";
  box.appendChild(el("div", "name", `${clip.name} · ${r.camera} · ${role}`));
  if (r.role === "match") {
    box.appendChild(el("div", "line", shotLine(r)));
    const basis = Object.entries(r.basis || {}).map(([k, v]) => `${SHOT_PART_BG[k]} by ${v}${r.confidence && r.confidence[k] ? ` (${r.confidence[k]} confidence)` : ""}`).join("; ");
    if (basis) box.appendChild(el("div", "reason", `Measured: ${basis}${r.overlap ? " (shared moments with the reference)" : ""}.`));
  }
  for (const f of r.flags || []) box.appendChild(el("div", "warn", f));
  return box;
}

async function onShotMatchApply() {
  if (state.busy || !shotState.res) return;
  setBusy(true);
  progress(0.5, "Matching and checking on a frame…");
  try {
    const entries = shotState.res.clips.filter((r) => r.role === "match" && (r.changed || []).length)
      .map((r) => ({ clip: shotState.clips[r.index], r }));
    const { steps, plans } = await premiereColor.applyShotMatch(shotState.project, shotState.sel.timeline, shotState.job, entries);
    const blocks = plans.map((pl) => {
      pl.status = pl.skipped ? (/did not work/.test(pl.skipReason || "") ? "FAILED" : "BLOCKED") : pl.nothing ? "ALREADY_MATCHED"
        : (pl.reverted || []).length >= Object.keys(SHOT_PART_KEYS(pl)).length ? "REVERTED"
          : (pl.reverted || []).length ? "PARTLY_REVERTED" : "CORRECTED";
      engine.colorAudit({ kind: "shotmatch", clip: pl.clip.name, path: pl.clip.path, in: pl.clip.inPt, out: pl.clip.outPt,
        status: pl.status, reference: shotState.res.reference, camera: pl.res.camera, overlap: pl.res.overlap,
        proposal: pl.res.proposal, flags: pl.res.flags, before: pl.t ? pl.t.current : null, written: pl.values || null,
        final: pl.final || null, reverted: pl.reverted || [], check: pl.check || null, lines: pl.lines }).catch(() => {});
      const box = el("div", "group");
      box.appendChild(el("div", "name", `${pl.clip.name} · ${SHOT_STATUS_BG[pl.status]}`));
      for (const l of pl.lines) box.appendChild(el("div", "line", l));
      for (const f of pl.res.flags || []) box.appendChild(el("div", "warn", f));
      return box;
    });
    const done = plans.filter((pl) => !pl.skipped && !pl.nothing).length;
    const undo = steps === 1 ? "One Cmd/Ctrl+Z undoes everything." : steps > 1 ? `${steps} times Cmd/Ctrl+Z undo everything.` : "";
    finish(done ? `Matched: ${done} ${done === 1 ? "clip" : "clips"} against ${shotState.res.reference}. ${undo}`
      : "Nothing was applied: see the reason below.", done > 0, blocks);
    shotState.res = null;
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `shot match apply: ${e && e.stack ? e.stack : e}`);
  } finally {
    setBusy(false);
  }
}

// the parts a clip's write touched (white counts once for Temperature + Tint)
function SHOT_PART_KEYS(pl) {
  const parts = {};
  for (const k of Object.keys(pl.values || {})) parts[k === "temperature" || k === "tint" ? "white" : k] = true;
  return parts;
}

onTap($("shotmatch"), () => onShotMatch(null));
onTap($("color"), () => onColor(null));
onTap($("colorWhite"), () => onColor("white"));
onTap($("colorExposure"), () => onColor("exposure"));
onTap($("exposureDown"), () => onExposureNudge(-0.5), { repeat: true });
onTap($("exposureUp"), () => onExposureNudge(0.5), { repeat: true });
// when the panel loses and gets back the keyboard focus, in the log: shows whether Premiere takes it after a write (2026-11-04)
window.addEventListener("blur", () => engine.log("info", "panel: focus lost"));
window.addEventListener("focus", () => engine.log("info", "panel: focus back"));
onTap($("probe"), onProbeAsk);

// ---------------------------------------------------------------- auto import

const CAT = { MUSIC: "music", SFX: "SFX", BROLL: "B-roll", IMAGES: "images", GRAPHICS: "graphics", OTHER: "other" };
const imp = { running: false, enabled: false, project: null };
const short = (p) => (p || "").replace(/^.*[\\/](.*[\\/].*)$/, "…/$1");

function renderImport(st, project) {
  imp.enabled = !!st.enabled;
  $("importToggle").textContent = st.enabled ? "Stop watching" : "Watch Downloads";
  $("importStatus").textContent = st.enabled
    ? `Watching ${short(st.folder)} → ${project.name}` + (st.pending.length ? ` · ${st.pending.length} waiting` : "")
    : st.folder ? `Off (was ${short(st.folder)})` : "Off. New files in the folder will go into the project by themselves.";
  const box = $("importRecent");
  box.innerHTML = "";
  for (const r of (st.recent || []).slice(0, 5)) {
    const ok = r.state === "imported";
    box.appendChild(el("div", ok ? "line" : "warn", `${ok ? "✓" : "✗"} ${r.name} → ${CAT[r.category] || r.category}` +
      (r.note ? ` (${r.note})` : "")));
  }
}

// One request at a time waits at the engine and returns the moment a file is ready, so a finished
// download is in Premiere within about a second instead of on the next poll.
async function importLoop() {
  for (;;) {
    let pause = 300;
    try {
      if (state.busy || !state.online) {
        pause = 1000;
      } else {
        const project = await premiere.activeProject();
        let st = await engine.importStatus(project.path, imp.enabled ? 10 : 0);
        if (st.enabled && st.pending.length && !state.busy) {
          await premiereImport.importPending(project, st.pending);
          st = await engine.importStatus(project.path);
        }
        renderImport(st, project);
        if (!st.enabled) pause = 3000;
      }
    } catch (e) {
      pause = 3000;
      if (!(e instanceof premiere.UserError)) engine.log("error", `import: ${e && e.stack ? e.stack : e}`);
    }
    await wait(pause);
  }
}

async function importSwitch(folder) {
  try {
    const project = await premiere.activeProject();
    const st = imp.enabled && !folder ? await engine.importUnbind(project.path)
      : await engine.importBind(project.path, folder);
    if (st.previous_project) {
      finish(`The folder was tied to another project (${short(st.previous_project)}): now it is tied to ${project.name}.`, true);
    }
    renderImport(st, project);
  } catch (e) {
    finish(e.message || String(e), false);
  }
}

onTap($("importToggle"), () => importSwitch(null));
onTap($("importFolder"), async () => {
  const folder = await premiereImport.pickFolder().catch(() => null);
  if (folder) importSwitch(folder);
});
importLoop();

onTap($("sync"), onSync);
onTap($("audio"), () => onAudio(null));
onTap($("subtitles"), () => onSubtitles());
onTap($("captionApply"), onCaptionApply);
onTap($("rough"), onRoughCut);
onTap($("subtitleDownload"), onSubtitleDownload);
onTap($("translatorDownload"), onTranslatorDownload);
onTap($("updateGo"), onUpdate);
// only the audio buttons carry data-force: ".small" alone also caught the probe and the import
// buttons, so they ran Fix audio too (and its result hid the probe's question)
for (const b of document.querySelectorAll(".btn.small[data-force]")) onTap(b, () => onAudio(b.getAttribute("data-force")));
// Cancel must always work, also right after the panel changed
onTap($("cancel"), () => {
  if (state.jobId) engine.cancel(state.jobId).catch(() => {});
}, { repeat: true });

for (const t of document.querySelectorAll(".btn.tab")) onTap(t, () => openTab(t.getAttribute("data-tab")));
onTap($("openLog"), () => openTab("paneLog"));
onTap($("openPreview"), () => openTab("panePreview"));
onTap($("hideResult"), () => show("result", false));       // the full answer stays in Log
onTap($("audioMore"), () => {
  const open = $("audioManual").hidden;
  show("audioManual", open);
  $("audioMore").textContent = open ? "Manual ▾" : "Manual ▸";
});
// the English line and the style are remembered on this computer
try {
  $("subtitleEnglish").checked = localStorage.getItem("asistent.subtitleEnglish") === "1";
  if (localStorage.getItem("asistent.subtitleStyle") === "reshape") $("subtitleStyle").value = "reshape";
} catch (e) {
  /* no storage */
}
$("subtitleEnglish").addEventListener("change", () => {
  if (state.online) engine.subtitlesModel().then(renderSubtitleModel).catch(() => {});
  try {
    localStorage.setItem("asistent.subtitleEnglish", $("subtitleEnglish").checked ? "1" : "0");
  } catch (e) {
    /* no storage */
  }
});
$("subtitleStyle").addEventListener("change", () => {
  try {
    localStorage.setItem("asistent.subtitleStyle", $("subtitleStyle").value);
  } catch (e) {
    /* no storage */
  }
});
// the ⓘ of each card (what the feature does) and the Developer tools: open or closed, remembered on this computer
for (const t of document.querySelectorAll(".btn.more")) {
  const id = t.getAttribute("data-more");
  const key = `asistent.open.${id}`;
  const set = (open) => {
    show(id, open);
    t.className = open ? "btn more open" : "btn more";
    try {
      localStorage.setItem(key, open ? "1" : "0");
    } catch (e) {
      /* no storage: it simply starts closed next time */
    }
  };
  let open = false;
  try {
    open = localStorage.getItem(key) === "1";
  } catch (e) {
    /* no storage */
  }
  show(id, open);
  t.className = open ? "btn more open" : "btn more";
  onTap(t, () => set($(id).hidden));
}
bindTips(document);
$("toast").addEventListener("click", () => { $("toast").hidden = true; });
$("app").addEventListener("scroll", hideTip);

refreshHeader();
// test bridge: does nothing unless the engine has its flag file (see devbridge.js)
createBridge({ premiere, premiereColor, premiereAudio, doc: document, version: PANEL_VERSION }).loop();
setInterval(() => {
  if (!state.busy) refreshHeader();
}, 4000);

// browser preview only (preview/boot.js sets this; inside Premiere it never exists): sample results fill the views
if (typeof window !== "undefined" && typeof window.__asistentPreview === "function") {
  window.__asistentPreview({ finish, setBusy, progress, el, button, previewBlock, renderCaptionEditor, renderSubtitleModel, openTab });
}
