const engine = require("./engine.js");
const premiere = require("./premiere.js");
const layout = require("./layout.js");
const premiereAudio = require("./premiere-audio.js");
const PANEL_VERSION = require("./version.js");
const premiereImport = require("./premiere-import.js");
const premiereColor = require("./premiere-color.js");
const premiereProbe = require("./premiere-probe.js");

const $ = (id) => document.getElementById(id);
const state = { online: false, busy: false, jobId: null };

function show(id, visible) {
  $(id).hidden = !visible;
}

function setBusy(busy) {
  state.busy = busy;
  for (const b of document.querySelectorAll("button.action, button.small")) b.disabled = busy || !state.online;
  show("work", busy);
}

function progress(fraction, message) {
  $("fill").style.width = `${Math.round(fraction * 100)}%`;
  $("message").textContent = message || "";
}

function signed(seconds) {
  return `${seconds >= 0 ? "+" : "−"}${Math.abs(seconds).toFixed(3)} s`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function finish(text, ok, blocks) {
  show("result", true);
  try {
    $("app").scrollTop = 0;                      // the answer is at the top of the panel: bring it into view
  } catch (e) {
    /* older UXP */
  }
  $("summary").textContent = text;
  $("summary").className = ok ? "ok" : "err";
  const box = $("details");
  box.innerHTML = "";
  for (const b of blocks || []) box.appendChild(b);
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
  } catch (e) {
    $("project").textContent = "Няма отворен проект";
  }
  if (!state.busy) for (const b of document.querySelectorAll("button.action, button.small")) b.disabled = !state.online;
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

function describe(result, timeline) {
  const name = (i) => result.clips[i].name;
  const blocks = [];
  result.groups.forEach((g, n) => {
    const box = el("div", "group");
    box.appendChild(el("div", "name", `Група ${n + 1}: ${g.members.map((m) => name(m.clip)).join(", ")}`));
    for (const m of g.members) {
      if (m.clip !== g.anchor) box.appendChild(el("div", "line", `${name(m.clip)}  ${signed(m.offset)} спрямо ${name(g.anchor)}`));
    }
    blocks.push(box);
  });
  const notes = [];
  if (result.unsynced.length) {
    notes.push(`Без общ звук с друг клип (сложени накрая): ${result.unsynced.map(name).join(", ")}`);
  }
  for (const c of result.conflicts) notes.push(`Не е синхронизирано: ${c.reason}.`);
  for (const s of result.suggestions) {
    notes.push(`Възможно, но несигурно (не е приложено): ${name(s.a)} и ${name(s.b)} ${signed(s.offset)}. Провери ръчно.`);
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
    const blocks = describe(result, timeline);
    if (!result.groups.length) {
      finish("Не намерих клипове със сигурно общ звук. Не е създадена секвенция.", false, blocks);
      return;
    }
    progress(0.95, "Правя SYNC секвенцията…");
    const order = Object.fromEntries(timeline.clips.map((c) => [c.path, c.start]));
    const lay = layout.syncLayout(result, order);
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

const ROUTE_FORCE = { LL: "use_left", RR: "use_right" };

async function onAudio(force) {
  // "phrases": everything "Оправи звука" does, plus Volume keyframes that even out the phrases
  const phrases = force === "phrases";
  if (phrases) force = null;
  if (state.busy) return;
  if (!state.online) {
    finish("Няма връзка с engine-а. Виж README.", false);
    return;
  }
  show("result", false);
  setBusy(true);
  progress(0, "Чета маркираните аудио клипове…");
  try {
    const project = await premiere.activeProject();
    const sel = await premiereAudio.readAudioSelection(project);
    if (!sel.items.length) throw new premiere.UserError("Маркирай в таймлайна поне един клип със звук.");
    // "split_rl" is the same split, only the other way round on the tracks
    const order = force === "split_rl" ? "RL" : "LR";
    const engineForce = force === "split_rl" ? "split" : force;
    const payload = sel.items.map((it) => ({ path: it.path, start: it.inPt, end: it.outPt,
      force: it.route ? ROUTE_FORCE[it.route] : (engineForce || null) }));
    engine.log("info", `audio: ${sel.items.length} clips, force ${force || "auto"}${phrases ? ", phrases" : ""}`);
    const { job } = await engine.startAudio(payload, phrases);
    const result = await runJob(job);

    progress(0.95, "Прилагам…");
    // prepare every clip first (reads only), then apply everything as one Undo step
    const plans = [];
    const usedTracks = [];
    for (let i = 0; i < sel.items.length; i++) {
      const it = sel.items[i];
      const res = result.items[i];
      const plan = { it, res, actions: [], checks: [], lines: [], problems: [] };
      if (res.error) plan.problems.push(res.error);
      else {
        try {
          Object.assign(plan, await premiereAudio.prepare(sel.timeline, it, res, usedTracks, order));
        } catch (e) {
          plan.problems.push(e.message || String(e));
          if (!(e instanceof premiere.UserError)) engine.log("error", `audio ${it.name}: ${e && e.stack ? e.stack : e}`);
        }
      }
      plans.push(plan);
    }
    const ready = plans.filter((p) => !p.problems.length);
    const { undoSteps } = await premiereAudio.applyAll(project, sel.timeline, ready);

    const blocks = [];
    let changed = 0;
    let failed = 0;
    for (const p of plans) {
      const box = el("div", "group");
      box.appendChild(el("div", "name", p.it.name));
      for (const r of (p.res && p.res.reasons) || []) if (r) box.appendChild(el("div", "reason", r));
      if (p.it.route) box.appendChild(el("div", "reason", "Вече има Fill ефект: само силата е сменена."));
      for (const l of p.lines || []) box.appendChild(el("div", "line", l));
      if (p.res && p.res.action === "ask") box.appendChild(el("div", "warn", "Не е пипано: избери с бутоните по-горе."));
      for (const pr of p.problems || []) box.appendChild(el("div", "warn", pr));
      if ((p.problems || []).length) failed++;
      else if (p.res && p.res.action !== "ask" && (p.actions || []).length) changed++;
      blocks.push(box);
    }
    for (const s of sel.skipped) blocks.push(el("div", "warn", `Пропуснат: ${s}.`));
    const clips = (n) => `${n} ${n === 1 ? "клип" : "клипа"}`;
    const undo = undoSteps === 1 ? "Един Cmd/Ctrl+Z връща всичко." : undoSteps > 1 ? `${undoSteps} пъти Cmd/Ctrl+Z връщат всичко.` : "";
    finish(failed ? `Готово с проблеми: ${clips(changed)} оправени, ${failed} не. ${undo}`
      : `Готово: ${changed} от ${clips(sel.items.length)}. ${undo}`, !failed, blocks);
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `audio: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
  }
}

// ---------------------------------------------------------------- colour

const CONF = { high: "висока", medium: "средна", low: "ниска" };
const colorState = { project: null, sel: null, results: null };

function colorBlock(clip, r) {
  const box = el("div", "group");
  box.appendChild(el("div", "name", clip.name));
  if (r.error) {
    box.appendChild(el("div", "warn", r.error));
    return box;
  }
  if (r.preview && r.preview.before) {
    const row = el("div", r.preview.portrait ? "thumbs portrait" : "thumbs");
    for (const k of ["before", "after"]) {
      const img = document.createElement("img");
      img.src = `data:image/jpeg;base64,${r.preview[k]}`;
      row.appendChild(img);
    }
    box.appendChild(row);
    box.appendChild(el("div", "cap", "преди · след (приблизително)"));
  }
  const e = r.exposure;
  box.appendChild(el("div", "line", e.stops
    ? `Експозиция ${e.stops > 0 ? "+" : ""}${e.stops} (${CONF[e.confidence]} сигурност)` : "Експозиция: без промяна"));
  const w = r.white;
  box.appendChild(el("div", "line", w.balanced ? `Бяло: наред (${CONF[w.confidence]})`
    : `Бяло: корекция (${CONF[w.confidence]} сигурност)`));
  for (const x of r.reasons || []) box.appendChild(el("div", "reason", x));
  for (const x of r.warnings || []) box.appendChild(el("div", "warn", x));
  return box;
}

function colorPlans(level) {
  const ok = (c) => c === "high" || (level === "all" && c === "medium");
  const plans = [];
  colorState.sel.clips.forEach((clip, i) => {
    const r = colorState.results[i];
    if (!r || r.error) return;
    const exposure = r.exposure.stops && ok(r.exposure.confidence) ? r.exposure.stops : null;
    const wb = !r.white.balanced && ok(r.white.confidence);
    if (exposure || wb) plans.push({ clip, res: r, exposure, wb });
  });
  return plans;
}

async function onColor() {
  if (state.busy) return;
  if (!state.online) return finish("Няма връзка с engine-а. Виж README.", false);
  show("result", false);
  setBusy(true);
  progress(0, "Гледам маркираните клипове…");
  try {
    const project = await premiere.activeProject();
    const sel = await premiereColor.readVideoSelection(project);
    if (!sel.clips.length) throw new premiere.UserError("Маркирай в таймлайна поне един видео клип.");
    const { job } = await engine.startColor(sel.clips.map((c) => ({ path: c.path, start: c.inPt, end: c.outPt })));
    const result = await runJob(job);
    Object.assign(colorState, { project, sel, results: result.items });
    const blocks = sel.clips.map((c, i) => colorBlock(c, result.items[i]));
    const sure = colorPlans("sure").length;
    const all = colorPlans("all").length;
    const bar = el("div", "row buttons");
    if (sure) {
      const b = el("button", "small", `Приложи сигурните (${sure})`);
      b.addEventListener("click", () => onColorApply("sure"));
      bar.appendChild(b);
    }
    if (all > sure) {
      const b = el("button", "small", `Приложи и средните (${all})`);
      b.addEventListener("click", () => onColorApply("all"));
      bar.appendChild(b);
    }
    blocks.unshift(bar);
    finish(all ? `Само предложение: в Lumetri още нищо не е сложено. Натисни „${sure ? `Приложи сигурните (${sure})` :
      `Приложи и средните (${all})`}“ отдолу, за да се приложи.` : "Няма какво да се поправя със сигурност: нищо не е пипано.",
    true, blocks);
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `color: ${e && e.stack ? e.stack : e}`);
  } finally {
    state.jobId = null;
    setBusy(false);
  }
}

async function onColorApply(level) {
  if (state.busy || !colorState.sel) return;
  setBusy(true);
  progress(0.5, "Прилагам в Lumetri и проверявам на кадър…");
  try {
    const plans = colorPlans(level);
    const { steps } = await premiereColor.apply(colorState.project, colorState.sel.timeline, plans);
    const blocks = plans.map((pl) => {
      const box = el("div", "group");
      box.appendChild(el("div", "name", pl.clip.name));
      for (const l of pl.lines || []) box.appendChild(el("div", "line", l));
      return box;
    });
    const undo = steps === 1 ? "Един Cmd/Ctrl+Z връща всичко." : steps > 1 ? `${steps} пъти Cmd/Ctrl+Z връщат всичко.` : "";
    finish(`Приложено на ${plans.length} ${plans.length === 1 ? "клип" : "клипа"}. ${undo}`, true, blocks);
    colorState.sel = null;
  } catch (e) {
    finish(e.message || String(e), false);
    if (!(e instanceof premiere.UserError)) engine.log("error", `color apply: ${e && e.stack ? e.stack : e}`);
  } finally {
    setBusy(false);
  }
}

// capability probe: asks first, because it puts a Lumetri on the selected clip
function onProbeAsk() {
  const go = el("button", "small", "Да, пусни пробата");
  go.addEventListener("click", onProbe);
  finish("Пробата слага Lumetri на маркирания клип, пише по един параметър, изнася кадри и връща стойностите. " +
    "Само в тестов проект, с ЕДИН маркиран видео клип без Lumetri.", false, [go]);
}

const STATE_BG = { SUPPORTED: "работи", BLOCKED: "не е достъпно" };

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

$("color").addEventListener("click", onColor);
$("probe").addEventListener("click", onProbeAsk);

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

$("importToggle").addEventListener("click", () => importSwitch(null));
$("importFolder").addEventListener("click", async () => {
  const folder = await premiereImport.pickFolder().catch(() => null);
  if (folder) importSwitch(folder);
});
importLoop();

$("sync").addEventListener("click", onSync);
$("audio").addEventListener("click", () => onAudio(null));
// only the audio buttons carry data-force: "button.small" alone also caught the probe and the import
// buttons, so they ran „Оправи звука“ too (and its result hid the probe's question)
for (const b of document.querySelectorAll("button.small[data-force]")) b.addEventListener("click", () => onAudio(b.getAttribute("data-force")));
$("cancel").addEventListener("click", () => {
  if (state.jobId) engine.cancel(state.jobId).catch(() => {});
});

refreshHeader();
setInterval(() => {
  if (!state.busy) refreshHeader();
}, 4000);
