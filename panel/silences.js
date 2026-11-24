// CUT SILENCES in the panel (0.10.96): its options, the preview with the waveform and the parts that would go, and the cut.
// The engine decides (engine/asistent/silence.py) and silenceplan.js holds the logic; this file only reads the controls,
// draws and listens to presses. The waveform is a row of flex columns with one centred bar each: no canvas and no
// absolutely placed element (UXP paints those over everything, CLAUDE.md 0.10.59).
const store = require("./store.js");
const engine = require("./engine.js");
const SP = require("./silenceplan.js");
const roughcutplan = require("./roughcutplan.js");

const KEY = "asistent.silences";
const COLS = 120;                                  // columns of the waveform (each a few pixels in a narrow panel)
const FLAG_LINES = 8;
const CONTROLS = { mode: "roughMode", method: "roughMethod", db: "roughDb", pacing: "roughPacing", minSilence: "roughMinSilence",
  minSpeech: "roughMinSpeech", before: "roughBefore", after: "roughAfter", sensitivity: "roughSensitivity", shortMin: "roughShortMin",
  shortMax: "roughShortMax", range: "roughRange", action: "roughAction" };
const BOXES = { short: "roughShort", fillers: "roughFillers", markTakes: "roughMarkTakes" };

function mount({ $, el, button, onTap, enable, bindTips, premiere, premiereRough, state, setBusy, progress, finish, show, runJob, autoLabels }) {
  // the preview that is on screen: the clips it was made from, the engine's plan, the editor's own choices
  const pv = { input: null, sig: null, result: null, regions: [], view: null, listen: null, timer: null, again: false, guard: null };
  let cloud = null;                                      // engine.cloud(): is ElevenLabs on (for the line about who reads the words)

  const values = () => {
    const v = {};
    for (const [k, id] of Object.entries(CONTROLS)) v[k] = $(id).value;
    for (const [k, id] of Object.entries(BOXES)) v[k] = !!$(id).checked;
    return v;
  };

  function remember() {
    try {
      store.setItem(KEY, JSON.stringify(values()));
    } catch (e) {
      /* no storage: the choices last until the panel closes */
    }
  }

  function remembered() {
    let v = null;
    try {
      v = JSON.parse(store.getItem(KEY) || "null");
      if (!v) {
        // the choices of 0.10.65-0.10.95, once: Pauses, Level and Quieter voices
        const tempo = store.getItem("asistent.roughTempo");
        const th = store.getItem("asistent.roughThreshold");
        const quiet = store.getItem("asistent.roughQuiet");
        if (tempo || th || quiet) {
          v = { pacing: { calm: "calm", normal: "measured", tight: "paced" }[tempo] || "measured" };
          if (th && th !== "auto") Object.assign(v, { method: "manual", db: th });
          if (quiet === "keep") v.mode = "silence";
        }
      }
    } catch (e) {
      v = null;
    }
    if (!v) return;
    for (const [k, id] of Object.entries(CONTROLS)) {
      if (v[k] === undefined || v[k] === null) continue;
      const e = $(id);
      if (e.tagName === "SELECT" && ![...e.options].some((o) => o.value === String(v[k]))) continue;
      e.value = String(v[k]);
    }
    for (const [k, id] of Object.entries(BOXES)) if (typeof v[k] === "boolean") $(id).checked = v[k];
    reflect();
  }

  // what the choices switch on and off: the dB field only for Manual dB, the numbers only for Custom, hesitation sounds
  // only with the words, AI rough cut always with them
  function reflect() {
    // 0.10.157: Simple is one choice: the other options are put away (their values wait for when Simple is left)
    const simple = $("roughMode").value === "simple";
    show("roughSimpleNote", simple);
    show("roughAdvanced", !simple);
    show("roughActionRow", !simple);
    if ($("roughMode").value === "ai" && $("roughMethod").value === "auto") $("roughMethod").value = "ai";
    const method = $("roughMethod").value;
    show("roughDbRow", method === "manual");
    show("roughCustom", $("roughPacing").value === "custom");
    const words = method === "ai" || $("roughMode").value === "ai";        // hesitation sounds need the words (the engine's rule)
    $("roughFillers").disabled = !words;
    if (!words) $("roughFillers").checked = false;
    for (const id of ["roughShortMin", "roughShortMax"]) $(id).disabled = !$("roughShort").checked;
    showWords();
  }

  // 0.10.122: when the current choices read the words (hesitation sounds, AI rough cut), who reads them
  function showWords() {
    const line = SP.wordsLine($("roughMode").value === "simple" ? SP.SIMPLE
      : { mode: $("roughMode").value, fillers: $("roughFillers").checked, mark_takes: $("roughMarkTakes").checked }, cloud);
    $("roughWords").textContent = line || "";
    show("roughWords", !!line);
  }

  async function refreshWords() {
    try {
      cloud = typeof engine.cloud === "function" ? await engine.cloud() : null;
    } catch (e) {
      cloud = null;                                      // no engine: no line
    }
    showWords();
  }

  // a preset chosen: its numbers go into the Custom fields (so Custom starts from them) and its short-pause choice applies
  function presetChosen() {
    const p = SP.PACING[$("roughPacing").value];
    if (!p) return;
    $("roughMinSilence").value = String(p.min_silence);
    $("roughMinSpeech").value = String(p.min_speech);
    $("roughBefore").value = String(p.before);
    $("roughAfter").value = String(p.after);
    $("roughShort").checked = p.short;
  }

  function options() {
    const r = SP.readOptions(values());
    if (r.error) throw new premiere.UserError(r.error);
    return r.opts;
  }

  // ---------------------------------------------------------------- the preview
  function clearPreview(note) {
    Object.assign(pv, { input: null, sig: null, result: null, regions: [], view: null, listen: null });
    show("silPreview", false);
    $("roughPreviewNote").textContent = note || "";
  }

  function fill(id, nodes) {
    const box = $(id);
    while (box.firstChild) box.removeChild(box.firstChild);
    for (const n of nodes) box.appendChild(n);
  }

  function draw() {
    const r = pv.result;
    if (!r) return;
    fill("silSummary", SP.describePreview(r, pv.regions).map((l) => el("div", l.cls, l.text)));
    const cols = SP.columns(r, pv.regions, pv.view, COLS);
    const wave = $("silWave");
    while (wave.firstChild) wave.removeChild(wave.firstChild);
    cols.forEach((c, i) => {
      const col = el("div", `sl-col k-${c.kind}${c.cut ? " cut" : ""}${c.flag && !c.cut ? " flag" : ""}${c.region >= 0 && !c.cut && !c.flag ? " kept" : ""}`);
      const bar = el("div", "sl-bar");
      bar.style.height = `${Math.round(c.h * 100)}%`;
      col.appendChild(bar);
      if (c.region >= 0) onTap(col, () => toggle(c.region, pv.view.from + ((i + 0.5) * pv.view.span) / COLS), { repeat: true });
      wave.appendChild(col);
    });
    $("silSpan").textContent = `${SP.clock(pv.view.from)} – ${SP.clock(pv.view.to)}${pv.view.zoom > 1 ? ` (×${pv.view.zoom})` : ""}`;
    enable($("silOut"), pv.view.zoom > 1);
    enable($("silIn"), pv.view.zoom < 64);
    enable($("silLeft"), pv.view.from > r.t_start + 0.01);
    enable($("silRight"), pv.view.to < r.t_end - 0.01);
    // the parts that are not sure, as lines with their own switch (they are easy to miss in the picture)
    const flags = [];
    pv.regions.forEach((x, i) => {
      if (!x.flag || flags.length >= FLAG_LINES) return;
      const row = el("div", "row sl-flagrow");
      row.appendChild(button("small", x.cut ? "Keep" : "Cut", x.cut ? "Keep this part after all." : "Cut this part too.", () => toggle(i)));
      row.appendChild(el("div", "reason", SP.describeRegion(x)));
      flags.push(row);
    });
    fill("silFlags", flags);
    bindTips($("silFlags"));
  }

  function toggle(i, at) {
    pv.regions = SP.toggled(pv.regions, i);
    if (Number.isFinite(at)) pv.touched = at;
    $("silInfo").textContent = SP.describeRegion(pv.regions[i]);
    draw();
  }

  function drawStatic() {
    const r = pv.result;
    // which tracks are listened to: all of them unless the editor unticks one
    const boxes = [];
    if (r.tracks.length > 1) {
      boxes.push(el("span", "muted", "Listen to:"));
      for (const t of r.tracks) {
        const id = `silTrack${t}`;
        const box = el("input");
        box.type = "checkbox";
        box.id = id;
        box.checked = !pv.listen || pv.listen.includes(t);
        box.addEventListener("change", () => {
          const on = r.tracks.filter((x) => { const b = $(`silTrack${x}`); return b && b.checked; });
          if (!on.length) {
            box.checked = true;                              // somebody has to be listened to
            return;
          }
          pv.listen = on.length === r.tracks.length ? null : on;
          schedule();
        });
        const label = el("label", "muted", `A${t + 1}`);
        label.setAttribute("for", id);
        label.setAttribute("data-tip", `Count the speech on audio track ${t + 1}. Unticked, the track is still cut like the others, it is only not listened to (a camera microphone next to a lavalier).`);
        boxes.push(box, label);
      }
    }
    fill("silTracks", boxes);
    bindTips($("silTracks"));
    const mics = SP.micLines(r).map((l) => el("div", l.cls, l.text));
    if (r.suggest_db !== null && r.suggest_db !== undefined && r.method !== "manual") {
      mics.push(el("div", "reason", `Manual dB could start at ${r.suggest_db} dB (8 dB under the main voice).`));
    }
    fill("silMics", mics);
  }

  function showResult(result, keepView) {
    pv.result = result;
    pv.regions = result.regions.map((x) => ({ ...x }));
    pv.view = keepView && pv.view ? SP.view(result, pv.view.zoom, pv.view.from) : SP.view(result, 1, result.t_start);
    show("silPreview", true);
    $("roughPreviewNote").textContent = "";
    $("silInfo").textContent = "Tap a marked part to keep it or cut it.";
    drawStatic();
    draw();
  }

  // the engine plans; nothing is made in Premiere. fresh: read the clips again (the Preview button); else the same clips
  // with the changed options (Premiere is not read again, and the engine remembers what it measured)
  async function preview(fresh) {
    if (state.busy) {
      pv.again = true;                                       // a change made while it was working: once more after it
      return false;
    }
    if (!state.online) {
      finish("No connection to the engine. See README.", false);
      return false;
    }
    let ok = false;
    setBusy(true);
    progress(0, fresh ? "Reading the clips…" : "Updating the preview…");
    try {
      const opts = options();
      if (fresh || !pv.input) {
        const project = await premiere.activeProject();
        const input = await premiereRough.readInput(project, opts);
        const sig = SP.signature(input.payload);
        if (sig !== pv.sig) {
          pv.regions = [];
          pv.listen = null;
          pv.view = null;
        }
        pv.input = input;
        pv.sig = sig;
      }
      const payload = premiereRough.withOptions(pv.input, opts, { preview: true, overrides: SP.overridesOf(pv.regions), listen: pv.listen });
      const { job } = await engine.startRoughcut(payload);
      const result = await runJob(job);
      showResult(result, !fresh);
      ok = true;
    } catch (e) {
      $("roughPreviewNote").textContent = e.message || String(e);
      if (!(e instanceof premiere.UserError)) engine.log("error", `silences preview: ${e && e.stack ? e.stack : e}`);
    } finally {
      state.jobId = null;
      setBusy(false);
      if (pv.again) {
        pv.again = false;
        schedule();
      }
    }
    return ok;
  }

  // an option changed while a preview is on screen: the picture follows (after a moment, so typing a number is one update)
  function schedule() {
    if (!pv.result) return;
    if (pv.timer) clearTimeout(pv.timer);
    pv.timer = setTimeout(() => {
      pv.timer = null;
      preview(false);
    }, 450);
  }

  // ---------------------------------------------------------------- the cut
  async function cut() {
    if (state.busy) return;
    if (!state.online) {
      finish("No connection to the engine. See README.", false);
      return;
    }
    // 0.10.122: an option changed less than a moment ago is still waiting to update the preview: bring the regions up to the
    // options first, so the cut never takes new options with the old regions' choices. A preview that fails stops the press
    // (its note says why).
    if (pv.timer) {
      clearTimeout(pv.timer);
      pv.timer = null;
      if (!(await preview(false))) return;
    }
    show("result", false);
    setBusy(true);
    progress(0, "Reading the selected clips…");
    try {
      const opts = options();
      const project = await premiere.activeProject();
      const input = await premiereRough.readInput(project, opts);
      let extra = {};
      if (pv.result) {
        // a preview is on screen: the cut is that preview, with the editor's own choices. Other clips than it was made
        // from: the choices are not theirs, so nothing is cut until the editor has looked again
        if (SP.signature(input.payload) !== pv.sig) {
          clearPreview("The clips changed since the preview.");
          throw new premiere.UserError("The clips are not the ones the preview was made from, so nothing was cut. Press Preview again, or Cut silences once more to cut without a review.");
        }
        extra = { overrides: SP.overridesOf(pv.regions), listen: pv.listen };
      }
      // Manual dB that would remove most of the selection (a level set too high): one more press of the same cut goes on. The
      // share is read BEFORE the real job: from the preview on screen when it is this cut's, else from a preview run (which
      // writes nothing; the real job writes its XML into the project folder, and a stopped press must leave nothing there).
      if (opts.method === "manual" && opts.action !== "split") {
        const key = `${SP.signature(input.payload)}|${JSON.stringify(SP.payloadOptions(opts, extra))}`;
        if (pv.guard !== key) {
          const shown = pv.result && SP.signature(input.payload) === pv.sig && pv.result.method === opts.method && pv.result.threshold === opts.threshold;
          let share;
          if (shown) share = SP.removedShare(pv.result, pv.regions);
          else {
            progress(0.05, "Checking how much goes…");
            const probe = await engine.startRoughcut(premiereRough.withOptions(input, opts, { ...extra, preview: true }));
            share = SP.removedShare(await runJob(probe.job));
          }
          if (share !== null && share > SP.MANUAL_GUARD_PCT) {
            pv.guard = key;
            throw new premiere.UserError(SP.guardText(share));
          }
        }
      }
      pv.guard = null;
      const { job } = await engine.startRoughcut(premiereRough.withOptions(input, opts, extra));
      const result = await runJob(job);
      progress(0.92, "Making the new sequence…");
      premiere.trace("job done, place>");
      const placed = await premiereRough.place(project, result, input.meta, input, (m) => progress(0.95, m), () => state.cancelRequested);
      premiere.trace("place<");
      const out = roughcutplan.describeResult(result, placed);
      const named = placed.problems.length ? "" : await autoLabels(project);
      premiere.trace("labels done");
      finish(out.text + named, !placed.problems.length, out.lines.map((l) => el("div", l.cls, l.text)));
      premiere.trace("finished");
    } catch (e) {
      finish(e.message || String(e), false);
      if (!(e instanceof premiere.UserError)) engine.log("error", `roughcut: ${e && e.stack ? e.stack : e}`);
    } finally {
      state.jobId = null;
      setBusy(false);
    }
  }

  // Manual dB's starting point: listens (a preview with the current options) and puts the engine's proposal in the field
  async function suggest() {
    // 0.10.122: it never does nothing without saying why
    if (state.busy) {
      $("roughPreviewNote").textContent = "Suggest did nothing: Asistent is busy. Wait for it to finish.";
      return;
    }
    if (!state.online) {
      $("roughPreviewNote").textContent = "Suggest did nothing: no connection to the engine. See README.";
      return;
    }
    setBusy(true);
    progress(0, "Listening to the dialogue…");
    try {
      const project = await premiere.activeProject();
      const opts = { ...options(), method: "auto", threshold: null, fillers: false, mode: "silence", mark_takes: false };
      const input = await premiereRough.readInput(project, opts);
      const { job } = await engine.startRoughcut(premiereRough.withOptions(input, opts, { preview: true }));
      const r = await runJob(job);
      if (r.suggest_db === null || r.suggest_db === undefined) throw new premiere.UserError("No speech was found to measure.");
      $("roughDb").value = String(r.suggest_db);
      $("roughPreviewNote").textContent = `${r.suggest_db} dB: 8 dB under the main voice. Preview shows what it cuts.`;
      remember();
      schedule();
    } catch (e) {
      // nothing selected is the usual reason: readInput says "Select the clips…"; the note says Suggest did nothing because of it
      $("roughPreviewNote").textContent = `Suggest did nothing: ${e.message || String(e)}`;
      if (!(e instanceof premiere.UserError)) engine.log("error", `silences suggest: ${e && e.stack ? e.stack : e}`);
    } finally {
      state.jobId = null;
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- wiring
  onTap($("rough"), cut);
  onTap($("roughPreview"), () => preview(true));
  onTap($("roughSuggest"), suggest);
  const nav = (fn) => () => {
    if (!pv.result) return;
    pv.view = fn();
    draw();
  };
  onTap($("silIn"), nav(() => SP.zoomed(pv.result, pv.view, 2, pv.touched)), { repeat: true });
  onTap($("silOut"), nav(() => SP.zoomed(pv.result, pv.view, 0.5)), { repeat: true });
  onTap($("silLeft"), nav(() => SP.scrolled(pv.result, pv.view, -1)), { repeat: true });
  onTap($("silRight"), nav(() => SP.scrolled(pv.result, pv.view, 1)), { repeat: true });
  for (const id of [...Object.values(CONTROLS), ...Object.values(BOXES)]) {
    $(id).addEventListener("change", () => {
      if (id === "roughPacing") presetChosen();
      reflect();
      remember();
      // other clips are read for another range: the preview on screen is not theirs
      if (id === "roughRange") clearPreview(pv.result ? "The range changed: press Preview again." : "");
      else schedule();
    });
  }
  remembered();
  reflect();
  refreshWords();

  return { remembered, preview, cut, showResult, refreshWords, state: pv };
}

module.exports = { mount };
