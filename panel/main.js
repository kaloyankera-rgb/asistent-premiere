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
const premiereRough = require("./premiere-roughcut.js");
const roughcutplan = require("./roughcutplan.js");

const $ = (id) => document.getElementById(id);
const state = { online: false, busy: false, jobId: null, settleUntil: 0 };

// Every press goes through onTap: it is logged with the button's label (so the log says what was really
// pressed) and ignored for a moment after the panel changed under the pointer. An answer appearing at the
// top moves every button down, and a second click on the same spot landed on „Оправи звука“ (2026-11-01).
const SETTLE_MS = 700;

function settle() {
  state.settleUntil = Date.now() + SETTLE_MS;
}

function onTap(button, fn) {
  button.addEventListener("click", () => {
    const label = (button.textContent || "").trim();
    if (Date.now() < state.settleUntil) {
      engine.log("info", `panel: click ignored (panel just changed): ${label}`);
      return;
    }
    engine.log("info", `panel: click: ${label}`);
    fn();
  });
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function setBusy(busy) {
  state.busy = busy;
  for (const b of document.querySelectorAll("button.action, button.small")) b.disabled = busy || !state.online;
  show("work", busy);
  if (busy && $("paneTools").hidden) openTab("paneTools");      // the progress and Отказ are there
  settle();
}

function progress(fraction, message) {
  $("fill").style.width = `${Math.round(fraction * 100)}%`;
  $("message").textContent = message || "";
}

function signed(seconds) {
  return `${seconds >= 0 ? "+" : "−"}${Math.abs(seconds).toFixed(3)} s`;
}

// a camera clock difference in words: "+730 дни 0:47 ч", "−3:12 мин"
function clockGap(seconds) {
  const s = Math.abs(Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sign = seconds >= 0 ? "+" : "−";
  if (d) return `${sign}${d} дни ${h}:${String(m).padStart(2, "0")} ч`;
  if (h) return `${sign}${h}:${String(m).padStart(2, "0")} ч`;
  return `${sign}${m}:${String(s % 60).padStart(2, "0")} мин`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// A button made in code: label, its tooltip and its handler (through onTap like every other press).
function button(cls, label, help, fn) {
  const b = el("button", cls, label);
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
  if (y + h > H - 6) y = Math.max(6, r.top - h - 4);
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
// The main view keeps only the summary, the decisions (Приложи …) and links; the full report goes to
// „Дневник“ and the before/after pictures to „Преди / след“ (2026-11-03: they used to push the buttons away).
const history = [];

function openTab(pane) {
  hideTip();
  for (const t of document.querySelectorAll("button.tab")) {
    const on = t.getAttribute("data-tab") === pane;
    t.className = on ? "tab on" : "tab";
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
 * text: one line; ok: green/red; blocks: the report („Дневник“); opts.actions: () => [buttons] for the
 * decisions, shown under the summary and above the pictures; opts.previews: [nodes] for „Преди / след“.
 */
function finish(text, ok, blocks, opts = {}) {
  show("result", true);
  settle();
  try {
    $("app").scrollTop = 0;                      // the answer is at the top of the panel: bring it into view
  } catch (e) {
    /* older UXP */
  }
  $("summary").textContent = text;
  $("summary").className = ok ? "ok" : "err";
  fillWith("details", blocks);
  $("logSummary").textContent = text;
  $("logSummary").className = ok ? "ok" : "err";
  const warns = $("details").querySelectorAll(".warn, .err").length;
  const link = $("openLog");
  link.textContent = warns ? `Подробности · ${warns} ${warns === 1 ? "бележка" : "бележки"}` : "Подробности";
  link.className = warns ? "link has-warn" : "link";
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
  if (history.length < 2) $("history").textContent = "Още няма.";
}

async function refreshHeader() {
  const st = await engine.status();
  state.online = !!(st && st.ok);
  $("dot").className = `dot ${state.online ? "on" : "off"}`;
  $("engine").textContent = state.online ? `Свързан · панел ${PANEL_VERSION} · engine ${st.version}`
    : `Няма връзка с engine-а (панел ${PANEL_VERSION})`;
  $("detail").textContent = state.online ? "" : `${st.error}. Провери дали engine-ът е пуснат (README).`;
  show("detail", !state.online);
  try {
    const project = await premiere.activeProject();
    $("project").textContent = project.name;
    if (state.online && !state.busy) loadSubtitleSettings(project.path);
  } catch (e) {
    $("project").textContent = "Няма отворен проект";
  }
  if (!state.busy) for (const b of document.querySelectorAll("button.action, button.small")) b.disabled = !state.online;
  if (state.online && !state.modelShown) {                 // once per start: does the subtitle section need the install?
    state.modelShown = true;
    engine.subtitlesModel().then(renderSubtitleModel).catch(() => {
      state.modelShown = false;
    });
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
    if (j.state === "cancelled") throw new premiere.UserError("Отказано.");
    if (j.state === "error") throw new premiere.UserError(j.error || "Грешка в engine-а.");
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
    box.appendChild(el("div", "name", `Група ${n + 1}: ${g.members.map((m) => name(m.clip)).join(", ")}`));
    for (const m of g.members) {
      if (m.clip !== g.anchor) box.appendChild(el("div", "line", `${name(m.clip)}  ${signed(m.offset)} спрямо ${name(g.anchor)}`));
    }
    // pairs that needed the scattered-window rule or the clocks say how they were decided
    for (const x of result.accepted_notes || []) {
      if (g.members.some((m) => m.clip === x.a)) box.appendChild(el("div", "hint", `${name(x.a)} и ${name(x.b)}: ${x.text}`));
    }
    blocks.push(box);
  });
  const notes = [];
  if (result.unsynced.length) {
    notes.push(`Без общ звук с друг клип (сложени на мястото си по време на запис): ${result.unsynced.map(name).join(", ")}`);
  }
  for (const c of result.clocks || []) {
    if (c.linked && c.name !== result.clock_reference && Math.abs(c.offset) >= 60) {
      notes.push(`Часовникът на ${c.name} е разместен спрямо ${result.clock_reference} (${clockGap(c.offset)}): поправен по синхрона.`);
    }
  }
  for (const u of (lay && lay.uncertain) || []) notes.push(`Несигурно място: ${u.name} (${u.reason}).`);
  for (const c of result.conflicts) notes.push(`Не е синхронизирано: ${c.reason}.`);
  for (const s of result.suggestions) {
    const why = (s.reasons || []).join(" ");
    notes.push(`Възможно, но несигурно (не е приложено): ${name(s.a)} и ${name(s.b)} ${signed(s.offset)}.` +
      `${why ? ` Причина: ${why}` : ""} Провери ръчно.`);
  }
  for (const s of timeline.skipped) notes.push(`Пропуснат: ${s}.`);
  for (const n of notes) blocks.push(el("div", "warn", n));
  return blocks;
}

async function onSync() {
  if (state.busy) return;
  if (!state.online) {
    finish("Няма връзка с engine-а. Виж README.", false);
    return;
  }
  show("result", false);
  setBusy(true);
  progress(0, "Чета маркираните клипове в таймлайна…");
  try {
    const project = await premiere.activeProject();
    const timeline = await premiere.readTimeline(project);
    if (timeline.clips.length < 2) {
      const seen = timeline.clips.map((c) => c.name).join(", ") || "нищо";
      throw new premiere.UserError(`Синхронът подравнява поне две камери: маркирай клипове от поне два различни ` +
        `файла. Сега е маркирано: ${seen}. (За цвят или звук стига и един клип: бутоните в ЦВЯТ и ЗВУК.)`);
    }
    engine.log("info", `timeline: ${timeline.clips.length} files selected, fps ${timeline.fps}`);
    const t0 = Date.now();
    const { job } = await engine.startGroups(timeline.clips.map((c) => c.path));
    const result = await runJob(job);
    if (!result.groups.length) {
      finish("Не намерих клипове със сигурно общ звук. Не е създадена секвенция.", false, describe(result, timeline));
      return;
    }
    progress(0.95, "Правя SYNC секвенцията…");
    const order = Object.fromEntries(timeline.clips.map((c) => [c.path, c.start]));
    const lay = layout.syncLayout(result, order);
    const blocks = describe(result, timeline, lay);
    const done = await premiere.buildSyncSequence(project, timeline, lay);
    const secsTaken = ((Date.now() - t0) / 1000).toFixed(0);
    if (done.bad.length) {
      finish(`${done.name} е създадена, но проверката не мина за: ${done.bad.join(", ")}. Провери ги ръчно.`, false, blocks);
      return;
    }
    const synced = result.groups.reduce((n, g) => n + g.members.length, 0);
    finish(`Готово за ${secsTaken} s: ${done.name}, ${synced} клипа в ${result.groups.length} групи. ` +
      `Проверено (разлика до ${done.worstMs.toFixed(1)} ms от кадрите). Твоята секвенция не е пипана.`, true, blocks);
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `sync: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
  }
}

async function onAudio(force) {
  // "phrases": everything "Оправи звука" does, plus Volume keyframes that even out the phrases
  const phrases = force === "phrases";
  if (state.busy) return;
  if (!state.online) {
    finish("Няма връзка с engine-а. Виж README.", false);
    return;
  }
  show("result", false);
  setBusy(true);
  progress(0, "Чета маркираните клипове…");
  try {
    const project = await premiere.activeProject();
    const sel = await premiereAudio.readAudioSelection(project);
    if (!sel.items.length) throw new premiere.UserError("Маркирай в таймлайна поне един клип със звук (видеото или звука му).");
    const work = audioplan.engineJobs(sel.items, force);
    engine.log("info", `audio: ${sel.items.length} clips (${work.jobs.length} measured), force ${force || "auto"}`);
    const { job } = await engine.startAudio(work.jobs, phrases);
    const result = await runJob(job);
    const plans = sel.items.map((it, i) => ({ it, res: result.items[work.index[i]], routed: null, lines: [], problems: [] }));
    for (const p of plans) if (p.res.error) p.problems.push(p.res.error);

    // the channels: the host makes the L/L and R/R copies and puts them where the clip is (ExtendScript)
    const todo = plans.map((p) => ({ p, route: audioplan.routeFor(p.it, p.res, force) })).filter((x) => x.route);
    if (todo.length) {
      progress(0.9, `Разделям каналите: ${todo.length} ${todo.length === 1 ? "клип" : "клипа"}…`);
      const answer = await engine.routeAudio({ sequence: sel.timeline.sequence.name, project: project.path,
        items: todo.map((x) => ({ track: x.p.it.track, start: x.p.it.start, end: x.p.it.end, route: x.route })) });
      if (!answer.ok) throw new premiere.UserError(answer.msg || "Premiere не раздели каналите.");
      todo.forEach((x, i) => { x.p.routed = answer.items[i] || { ok: false, msg: "няма отговор" }; });
      engine.log("info", `audio route: ${JSON.stringify(answer.items)}`);
    }
    progress(0.95, "Слагам силата…");
    const { undoSteps } = await premiereAudio.applyLevels(project, sel.timeline.sequence, audioplan.levelTargets(plans));

    const blocks = [];
    let changed = 0;
    let failed = 0;
    for (const p of plans) {
      const box = el("div", "group");
      box.appendChild(el("div", "name", p.it.name));
      // a side Asistent made earlier: its analysis lines describe the pair, not this clip
      if (p.it.side) {
        box.appendChild(el("div", "reason", "Вече е разделен от Asistent: само силата."));
        // what the pair's analysis said about the balance of the two speakers still applies
        for (const r of (p.res && p.res.reasons) || []) if (/Говорителите се различаваха|няма свой говорител/.test(r)) box.appendChild(el("div", "reason", r));
      }
      else if (p.it.route) box.appendChild(el("div", "reason", "Има Fill ефект отпреди: каналите не са пипани, само силата."));
      else for (const r of (p.res && p.res.reasons) || []) if (r) box.appendChild(el("div", "reason", r));
      const line = audioplan.routeLine(p.routed);
      if (line) box.appendChild(el("div", p.routed.ok ? "line" : "warn", line));
      for (const l of p.lines) box.appendChild(el("div", "line", l));
      if (p.res && p.res.action === "ask") box.appendChild(el("div", "warn", "Не е пипано: избери ръчно (Ръчно ▸)."));
      if (p.routed && !p.routed.ok) p.problems.push("каналите не са разделени");
      for (const pr of p.problems) box.appendChild(el("div", "warn", pr));
      if (p.problems.length) failed++;
      else if (p.res && p.res.action !== "ask") changed++;
      blocks.push(box);
    }
    for (const s of sel.skipped) blocks.push(el("div", "warn", `Пропуснат: ${s}.`));
    blocks.push(el("div", "hint", `Лимитерът (Dynamics → Limiter ${audioplan.LIMITER_DB} dB) е на всеки клип, не на Mix пистата: скриптовете на ` +
      "Premiere не стигат до главната писта. Сборът на двете писти е държан под −6 dB от самите нива."));
    const split = plans.filter((p) => p.routed && p.routed.ok && p.routed.status === "done").length;
    const clips = (n) => `${n} ${n === 1 ? "клип" : "клипа"}`;
    const undo = [undoSteps ? `силата и лимитерът са ${undoSteps === 1 ? "една стъпка" : `${undoSteps} стъпки`} Cmd/Ctrl+Z` : "",
      split ? "разделянето е отделни стъпки на Premiere (копията и връзката на всеки клип)" : ""].filter(Boolean).join("; ");
    finish(`${failed ? `Готово с проблеми: ${clips(changed)} оправени, ${failed} не.` : `Готово: ${changed} от ${clips(plans.length)}.`}` +
      `${split ? ` Разделени: ${split}.` : ""}${undo ? ` Връщане: ${undo}.` : ""}`, !failed, blocks);
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
    text = "Липсват пакетите за разпознаване на реч: пусни scripts/setup_mac.sh --subtitles (виж README).";
  } else if (!st.model) {
    text = `Моделът за българска реч (около ${gb(st.expected_bytes)} GB) още не е свален. Ще се запише в ${st.dir}.` +
      (st.bytes ? ` Вече са свалени ${gb(st.bytes)} GB: свалянето продължава от там.` : "");
  }
  $("subtitleModel").textContent = text;
  show("subtitleModel", !!text);
  show("subtitleAsk", st.backend && !st.model);
}

// who speaks and the corrections text are kept per project in the engine; shown again when the project changes
async function saveSubtitleSettings(path) {
  const r = await engine.saveSubtitleSettings(path, $("notes").value);
  showNotesState(r.errors || []);
  return r;
}

function showNotesState(errors) {
  $("notesState").textContent = errors.length ? `Не разбирам: ${errors.join("; ")}` : "";
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

async function onSubtitles() {
  if (state.busy) return;
  if (!state.online) {
    finish("Няма връзка с engine-а. Виж README.", false);
    return;
  }
  show("result", false);
  setBusy(true);
  progress(0, "Проверявам модела за реч…");
  try {
    const st = await engine.subtitlesModel();
    renderSubtitleModel(st);
    if (!st.backend || !st.model) {
      throw new premiere.UserError(!st.backend ? "Липсват пакетите за разпознаване на реч (виж СУБТИТРИ)."
        : "Моделът за реч още не е свален: натисни „Свали модела“ в раздел СУБТИТРИ.");
    }
    const project = await premiere.activeProject();
    progress(0.02, "Чета маркираните клипове…");
    const saved = await saveSubtitleSettings(project.path);                  // what is in the boxes now is what runs, and is remembered
    const { payload, plan } = await premiereSubtitles.readInput(project, [], $("notes").value);
    engine.log("info", `subtitles: ${plan.use.length} клипа, ${plan.skipped.length} пропуснати`);
    const { job } = await engine.startSubtitles(payload);
    const result = await runJob(job);
    const out = describeResult(result);
    if (out.ok) {
      // one press: the file is made, then it goes onto a caption track of the same sequence (engine host, see DECISIONS.md)
      progress(0.98, "Слагам субтитрите на таймлайна…");
      const placed = describePlacement(await premiereCaptions.place(project, await project.getActiveSequence(), result), result.srt);
      out.text = placed.ok ? `Готово: ${result.counts.captions} реда субтитри, на таймлайна.` : placed.text;
      out.ok = placed.ok;
      out.lines = [...placed.lines, ...out.lines.filter((l) => !/^Файл: /.test(l.text))];
    }
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
    finish("Няма връзка с engine-а. Виж README.", false);
    return;
  }
  show("result", false);
  setBusy(true);
  progress(0, "Чета маркираните клипове…");
  try {
    const project = await premiere.activeProject();
    const opts = { mode: $("roughMode").value, tempo: $("roughTempo").value, markers: $("roughMarkers").checked };
    const { payload, meta } = await premiereRough.readInput(project, opts);
    const { job } = await engine.startRoughcut(payload);
    const result = await runJob(job);
    progress(0.92, "Внасям новата секвенция…");
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
    finish("Няма връзка с engine-а. Виж README.", false);
    return;
  }
  show("result", false);
  setBusy(true);
  progress(0, "Свалям модела…");
  try {
    const r = await engine.downloadSubtitleModel();
    if (!r.done) await runJob(r.job);
    renderSubtitleModel(await engine.subtitlesModel());
    finish("Моделът е свален. Натисни „Субтитри (български)“.", true);
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `subtitle model: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
    engine.subtitlesModel().then(renderSubtitleModel).catch(() => {});
  }
}

// ---------------------------------------------------------------- colour

const CONF = { high: "висока", medium: "средна", low: "ниска" };
// part: null is Auto Color (white and exposure), "white" / "exposure" the separate buttons (same analysis, same apply)
const colorState = { project: null, sel: null, results: null, part: null };

function colorBlock(clip, r) {
  const box = el("div", "group");
  box.appendChild(el("div", "name", clip.name));
  if (r.error) {
    box.appendChild(el("div", "warn", r.error));
    return box;
  }
  if (r.measured_on === "timeline") box.appendChild(el("div", "reason", `Мерено на таймлайна (${r.frames} кадъра).`));
  for (const line of colorLines(r, colorState.part)) box.appendChild(el("div", "line", line));
  for (const x of r.reasons || []) box.appendChild(el("div", "reason", x));
  for (const x of r.warnings || []) box.appendChild(el("div", "warn", x));
  return box;
}

function colorLines(r, part = null) {
  const e = r.exposure;
  // stops are what the picture needs; units are what goes into Lumetri (they differ above the shadows)
  const units = e.units !== undefined && e.units !== null && e.units !== e.stops ? ` = Exposure ${e.units > 0 ? "+" : ""}${e.units} в Lumetri` : "";
  const w = r.white;
  const lines = { exposure: e.stops ? `Експозиция ${e.stops > 0 ? "+" : ""}${e.stops} стопа${units} (${CONF[e.confidence]} сигурност)` : "Експозиция: без промяна",
    white: w.balanced ? `Бяло: наред (${CONF[w.confidence]})` : `Бяло: корекция (${CONF[w.confidence]} сигурност)` };
  return [part !== "white" ? lines.exposure : null, part !== "exposure" ? lines.white : null].filter(Boolean);
}

// one clip in „Преди / след“: its name, the two pictures and what would change
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
  if (!state.online) return finish("Няма връзка с engine-а. Виж README.", false);
  show("result", false);
  setBusy(true);
  progress(0, "Гледам маркираните клипове…");
  try {
    const project = await premiere.activeProject();
    const sel = await premiereColor.readVideoSelection(project);
    if (!sel.clips.length) throw new premiere.UserError("Маркирай в таймлайна поне един видео клип.");
    // measure what is on the timeline (an earlier correction included), not the source file
    const dir = (await engine.status()).frames_dir;
    const items = [];
    for (const [i, c] of sel.clips.entries()) {
      progress((0.4 * i) / sel.clips.length, `Кадри от таймлайна: ${i + 1} от ${sel.clips.length}…`);
      const tl = dir ? await premiereColor.timelineFrames(sel.timeline, c, dir, i) : { frames: [] };
      items.push({ path: c.path, start: c.inPt, end: c.outPt, frames: tl.frames });
    }
    const { job } = await engine.startColor(items);
    const result = await runJob(job);
    Object.assign(colorState, { project, sel, results: result.items, part });
    const blocks = sel.clips.map((c, i) => colorBlock(c, result.items[i]));
    const previews = sel.clips.map((c, i) => [c, result.items[i]]).filter(([, r]) => !r.error && r.preview && r.preview.before)
      .map(([c, r]) => previewBlock(c.name, r.preview, "преди · след (приблизително)", colorLines(r, part)));
    // buttons by what they apply: „и средните“ appears whenever it adds a correction „сигурните“ leaves out
    const sure = colorPlans("sure").length;
    const all = colorPlans("all").length;
    const more = corrections(colorPlans("all")) > corrections(colorPlans("sure"));
    const actions = () => [
      ...(sure ? [button("small", `Приложи сигурните (${sure})`, "Слага в Lumetri само корекциите с висока сигурност.",
        () => onColorApply("sure"))] : []),
      ...(more ? [button("small", `Приложи и средните (${all})`, "Слага в Lumetri и корекциите със средна сигурност.",
        () => onColorApply("all"))] : []),
    ];
    finish(all ? `Само предложение: в Lumetri още нищо не е сложено. Натисни „${sure ? `Приложи сигурните (${sure})` :
      `Приложи и средните (${all})`}“ отдолу, за да се приложи.` : "Няма какво да се поправя със сигурност: нищо не е пипано.",
    true, blocks, { actions, previews });
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `color: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
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
  progress(0.5, "Прилагам в Lumetri и проверявам на кадър…");
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
        box.appendChild(el("div", "warn", `Не е приложено (средна сигурност): ${pl.left.join(" и ")}. ` +
          "За да влезе и то: натисни пак същия бутон и „Приложи и средните“ (добавя се към тази поправка)."));
      }
      return box;
    });
    const undo = steps === 1 ? "Един Cmd/Ctrl+Z връща всичко." : steps > 1 ? `${steps} пъти Cmd/Ctrl+Z връщат всичко.` : "";
    // a clip that already has a graded Lumetri is left alone: never report it as applied
    const done = plans.filter((pl) => !pl.skipped).length;
    const skipped = plans.length - done;
    finish(done ? `Приложено на ${done} ${done === 1 ? "клип" : "клипа"}${skipped ? `, ${skipped} пропуснати` : ""}. ${undo}`
      : "Нищо не е приложено: виж причината отдолу.", done > 0, blocks);
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
  box.appendChild(el("p", "hint", "Пробата слага Lumetri на маркирания клип, пише по един параметър, изнася кадри и " +
    "връща стойностите. Само в тестов проект, с ЕДИН маркиран видео клип без Lumetri."));
  const bar = el("div", "row buttons");
  const close = () => box.parentNode && box.parentNode.removeChild(box);
  bar.appendChild(button("small", "Да, пусни пробата", "Слага Lumetri на маркирания клип и мери как реагира. Само в тестов проект.", () => {
    close();
    onProbe();
  }));
  bar.appendChild(button("small", "Не", "Затваря въпроса, нищо не се пипа.", close));
  box.appendChild(bar);
  row.parentNode.insertBefore(box, row.nextSibling);
  bindTips(box);
  settle();
}

const STATE_BG = { SUPPORTED: "работи", BLOCKED: "не е достъпно", UNVERIFIED: "не е измерено достоверно" };

async function onProbe() {
  if (state.busy) return;
  setBusy(true);
  progress(0.3, "Проба: параметри, запис, кадри…");
  try {
    const project = await premiere.activeProject();
    const rep = await premiereProbe.run(project);
    const res = rep.result || {};
    const blocks = [];
    const tbl = el("div", "group");
    tbl.appendChild(el("div", "name", `Premiere ${rep.host ? rep.host.version : "?"} · Lumetri: ${rep.lumetriMatch} · ` +
      `${(rep.lumetriParams || []).length} параметъра · изнасяне на кадър: ${rep.exporter ? "да" : "не"}`));
    for (const [k, v] of Object.entries(res.table || {})) {
      tbl.appendChild(el("div", "line", `${k}: ${STATE_BG[v] ? `${v} (${STATE_BG[v]})` : v}`));
    }
    blocks.push(tbl);
    const units = res.units || {};
    if (Object.keys(units).length) blocks.push(el("div", "line", `Единици: ${JSON.stringify(units)}`));
    if (res.identity) blocks.push(el("div", "line", `Празен Lumetri променя кадъра с: ${JSON.stringify(res.identity)}`));
    if (res.error) blocks.push(el("div", "warn", res.error + (rep.exportError ? ` Premiere каза: ${rep.exportError}` : "")));
    blocks.push(el("div", "reason", `Входен LUT на клипа: ${rep.colorManagement.clipInputLUT || "няма"}; вграден: ` +
      `${rep.colorManagement.clipEmbeddedLUT || "няма"}. На клипа остана празен Lumetri: изтрий го или Cmd/Ctrl+Z.`));
    finish("Пробата е готова: резултатът е записан и в engine-а.", !res.error, blocks);
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
const SHOT_PART_BG = { white: "бялото", exposure: "яркостта", saturation: "наситеността", contrast: "контрастът" };
const SHOT_STATUS_BG = { CORRECTED: "изравнено", ALREADY_MATCHED: "вече съвпада", REVERTED: "върнато (стана по-лошо)",
  PARTLY_REVERTED: "изравнено, част е върната", BLOCKED: "не е пипано (ръчна корекция)", FAILED: "не стана" };

// Selected clips from two or more cameras → a suggestion against one reference camera (chosen, or the most
// reliable one). Nothing is written until „Приложи изравняването“.
async function onShotMatch(reference = null) {
  if (state.busy) return;
  if (!state.online) return finish("Няма връзка с engine-а. Виж README.", false);
  show("result", false);
  setBusy(true);
  progress(0, "Гледам камерите…");
  try {
    const project = await premiere.activeProject();
    const sel = await premiereColor.readVideoSelection(project);
    const clips = sel.clips.filter((c) => Math.abs((c.speed ?? 1) - 1) < 0.01 && !c.reversed);
    const odd = sel.clips.length - clips.length;
    const cams = cameras(clips);
    if (new Set(cams).size < 2) {
      throw new premiere.UserError("Маркирай в таймлайна клипове от поне две камери (различни папки).");
    }
    const items = [];
    for (const [i, c] of clips.entries()) {
      progress((0.3 * i) / clips.length, `Подготвям ${i + 1} от ${clips.length}…`);
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
    top.appendChild(el("div", "name", `Еталон: ${res.reference}`));
    top.appendChild(el("div", "reason", reference ? "Избран от теб. Друга камера като еталон: бутоните горе."
      : "Избран автоматично (най-надеждната камера). Друга камера като еталон: бутоните горе."));
    for (const n of res.notes || []) top.appendChild(el("div", "warn", n));
    if (odd) top.appendChild(el("div", "warn", `${odd} клипа с променена скорост са пропуснати.`));
    blocks.push(top);
    for (const r of res.clips) blocks.push(shotBlock(clips[r.index], r));
    const previews = res.clips.filter((r) => r.role === "match" && r.preview && r.preview.before)
      .map((r) => previewBlock(clips[r.index].name, r.preview, "сега · след (приблизително)", [shotLine(r)]));
    const ready = res.clips.filter((r) => r.role === "match" && (r.changed || []).length && r.lumetri !== "manual").length;
    // the decisions: apply, and the reference as a plain choice (one button per camera, the current one ticked)
    const actions = () => [
      ...(ready ? [button("small", `Приложи изравняването (${ready})`, "Слага предложените стойности в Lumetri на камерите, които се изравняват.",
        onShotMatchApply)] : []),
      ...res.cameras.map((cam) => (cam === res.reference
        ? button("small", `✓ ${cam}`, "Това е еталонът: другите камери се изравняват към него.", () => {})
        : button("small", cam, `Пуска изравняването отново с ${cam} като еталон.`, () => onShotMatch(cam)))),
    ];
    finish(ready ? "Само предложение: в Lumetri още нищо не е сложено. Натисни „Приложи изравняването“."
      : "Няма какво да се изравнява със сигурност: нищо не е пипано.", true, blocks, { actions, previews });
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
    : "без промяна: вече съвпада или разликите са отбелязани отдолу";
}

function shotBlock(clip, r) {
  const box = el("div", "group");
  const role = r.role === "reference" ? "еталон" : r.role === "match" ? "изравнява се" : "пропуснат";
  box.appendChild(el("div", "name", `${clip.name} · ${r.camera} · ${role}`));
  if (r.role === "match") {
    box.appendChild(el("div", "line", shotLine(r)));
    const basis = Object.entries(r.basis || {}).map(([k, v]) => `${SHOT_PART_BG[k]} по ${v}${r.confidence && r.confidence[k] ? ` (${r.confidence[k]} сигурност)` : ""}`).join("; ");
    if (basis) box.appendChild(el("div", "reason", `Мерено: ${basis}${r.overlap ? " (общи моменти с еталона)" : ""}.`));
  }
  for (const f of r.flags || []) box.appendChild(el("div", "warn", f));
  return box;
}

async function onShotMatchApply() {
  if (state.busy || !shotState.res) return;
  setBusy(true);
  progress(0.5, "Изравнявам и проверявам на кадър…");
  try {
    const entries = shotState.res.clips.filter((r) => r.role === "match" && (r.changed || []).length)
      .map((r) => ({ clip: shotState.clips[r.index], r }));
    const { steps, plans } = await premiereColor.applyShotMatch(shotState.project, shotState.sel.timeline, shotState.job, entries);
    const blocks = plans.map((pl) => {
      pl.status = pl.skipped ? (/не стана/.test(pl.skipReason || "") ? "FAILED" : "BLOCKED") : pl.nothing ? "ALREADY_MATCHED"
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
    const undo = steps === 1 ? "Един Cmd/Ctrl+Z връща всичко." : steps > 1 ? `${steps} пъти Cmd/Ctrl+Z връщат всичко.` : "";
    finish(done ? `Изравнени: ${done} ${done === 1 ? "клип" : "клипа"} спрямо ${shotState.res.reference}. ${undo}`
      : "Нищо не е приложено: виж причината отдолу.", done > 0, blocks);
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
onTap($("probe"), onProbeAsk);

// ---------------------------------------------------------------- auto import

const CAT = { MUSIC: "музика", SFX: "SFX", BROLL: "B-roll", IMAGES: "снимки", GRAPHICS: "графики", OTHER: "други" };
const imp = { running: false, enabled: false, project: null };
const short = (p) => (p || "").replace(/^.*[\\/](.*[\\/].*)$/, "…/$1");

function renderImport(st, project) {
  imp.enabled = !!st.enabled;
  $("importToggle").textContent = st.enabled ? "Спри следенето" : "Следи Downloads";
  $("importStatus").textContent = st.enabled
    ? `Следя ${short(st.folder)} → ${project.name}` + (st.pending.length ? ` · чакат ${st.pending.length}` : "")
    : st.folder ? `Изключено (беше ${short(st.folder)})` : "Изключено. Новите файлове в папката ще влизат сами в проекта.";
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
      finish(`Папката беше свързана с друг проект (${short(st.previous_project)}): сега е с ${project.name}.`, true);
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
onTap($("subtitles"), onSubtitles);
onTap($("rough"), onRoughCut);
onTap($("subtitleDownload"), onSubtitleDownload);
// only the audio buttons carry data-force: "button.small" alone also caught the probe and the import
// buttons, so they ran „Оправи звука“ too (and its result hid the probe's question)
for (const b of document.querySelectorAll("button.small[data-force]")) onTap(b, () => onAudio(b.getAttribute("data-force")));
// Отказ must always work, also right after the panel changed
$("cancel").addEventListener("click", () => {
  if (state.jobId) engine.cancel(state.jobId).catch(() => {});
});

for (const t of document.querySelectorAll("button.tab")) onTap(t, () => openTab(t.getAttribute("data-tab")));
onTap($("openLog"), () => openTab("paneLog"));
onTap($("openPreview"), () => openTab("panePreview"));
onTap($("audioMore"), () => {
  const open = $("audioManual").hidden;
  show("audioManual", open);
  $("audioMore").textContent = open ? "Ръчно ▾" : "Ръчно ▸";
});
bindTips(document);
$("app").addEventListener("scroll", hideTip);

refreshHeader();
// test bridge: does nothing unless the engine has its flag file (see devbridge.js)
createBridge({ premiere, premiereColor, premiereAudio, doc: document, version: PANEL_VERSION }).loop();
setInterval(() => {
  if (!state.busy) refreshHeader();
}, 4000);
