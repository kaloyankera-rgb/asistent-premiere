// Test bridge, panel side: runs commands the engine hands out (`GET /dev/poll`) so a developer can drive the
// panel in the user's test project without a person pressing buttons. Off unless the engine has the flag file
// `devbridge.enabled` (then /dev/poll answers 404 and this loop only sleeps). Refuses every command except `ping`
// unless the open project is one of the user's test projects, TEST.prproj or NEW TEST.prproj (the user's rule: Premiere
// tests only there; NEW TEST added by the user 2026-11-04). Never closes or
// restarts Premiere, never writes anything itself: it presses the panel's own buttons and reads.
const engine = require("./engine.js");
const { cssProbe } = require("./cssprobe.js");

const TEST_PROJECT = /(^|[\\/])(NEW )?TEST\.prproj$/i;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTLE = 900;                                 // main.js ignores clicks for 700 ms after the panel changed

function createBridge({ premiere, premiereColor, premiereAudio, doc, version, engineApi = engine, sleep = wait, hooks = {} }) {
  const $ = (id) => doc.getElementById(id);
  const text = (n) => ((n && n.textContent) || "").trim();
  // .btn: the panel's own buttons (divs); .jump (0.10.45): a check line with a time, which moves the playhead
  const buttons = () => [...doc.querySelectorAll("button, .btn, .jump")].filter((b) => !b.hidden);
  const busy = () => !$("work").hidden;

  async function project() {
    const p = await premiere.activeProject();
    return { p, name: p.name, path: p.path || "", ok: TEST_PROJECT.test(p.path || "") || TEST_PROJECT.test(p.name || "") };
  }

  function panelState() {
    const blocks = [...($("details") ? $("details").children : [])].map((b) => {
      const lines = [...b.children].map(text).filter(Boolean);
      return lines.length ? lines : [text(b)];
    });
    return { busy: busy(), message: text($("message")), summary: text($("summary")), summary_class: $("summary").className,
      result_visible: !$("result").hidden, blocks, buttons: buttons().map((b) => ({ text: text(b), disabled: !!b.disabled })) };
  }

  async function idle(timeout) {
    const end = Date.now() + timeout * 1000;
    await sleep(300);
    const pageBusy = () => !!(hooks.tracker && hooks.tracker() && hooks.tracker().busy());     // the Tracker page's own work
    while ((busy() || pageBusy()) && Date.now() < end) await sleep(300);
    await sleep(SETTLE);
    return panelState();
  }

  function pick(items, args) {
    let list = items;
    if (args.kind) list = list.filter((x) => x.kind === args.kind);
    if (Array.isArray(args.names) && args.names.length) {
      const names = args.names.map((n) => String(n).toLowerCase());
      list = list.filter((x) => names.some((n) => (x.name || "").toLowerCase().includes(n)));
    }
    if (Number.isInteger(args.track)) list = list.filter((x) => x.track + 1 === args.track);
    if (Number.isFinite(args.from)) list = list.filter((x) => x.end > args.from);
    if (Number.isFinite(args.to)) list = list.filter((x) => x.start < args.to);
    return list;
  }

  // a project item as Premiere sees it: kind, content type, media path (for the probes)
  async function describe(it) {
    const ppro = require("premierepro");
    const clip = ppro.ClipProjectItem.cast(it);
    return { name: it.name, type: it.type, clip: !!clip, content_type: clip ? await premiere.maybe(clip, "getContentType") : null,
      media: clip ? await premiere.maybe(clip, "getMediaFilePath") : null };
  }

  const brief = (x) => ({ name: x.name, kind: x.kind, track: x.track + 1, start: +x.start.toFixed(3), end: +x.end.toFixed(3),
    in: +(x.inPt || 0).toFixed(3), out: x.outPt === undefined ? null : +x.outPt.toFixed(3), selected: !!x.selected,
    file: x.path ? x.path.split(/[\\/]/).slice(-2).join("/") : null, speed: x.speed });

  const exportProbe = { events: [] };

  const commands = {
    async ping() {
      const pr = await project().catch((e) => ({ name: null, ok: false, error: String(e && e.message || e) }));
      return { panel: version, project: pr.name, path: pr.path, test_project: pr.ok, busy: busy() };
    },
    async state() {
      return panelState();
    },
    // which CSS this UXP really supports (measured on temporary elements; the panel redesign uses only what works)
    async css_probe() {
      return cssProbe(doc, typeof window !== "undefined" ? window : globalThis);
    },
    async timeline(a) {
      const { p } = await project();
      const t = await premiere.readTimeline(p);
      return { items: pick(t.items, a).map(brief) };
    },
    async selection() {
      const { p } = await project();
      const t = await premiere.readTimeline(p);
      return { items: t.items.filter((x) => x.selected).map(brief) };
    },
    // select clips by (part of) name / track / time range; kind "video" (default), "audio" or "any" (one call sets the
    // whole selection)
    async select(a) {
      const { p } = await project();
      const t = await premiere.readTimeline(p);
      const chosen = pick(t.items, a.kind === "any" ? { ...a, kind: undefined } : { kind: "video", ...a });
      if (!chosen.length) throw new Error("No clips match these conditions.");
      const ppro = require("premierepro");
      const Sel = ppro.TrackItemSelection;
      if (!Sel || !premiere.has(Sel, "createEmptySelection")) throw new Error("This API has no TrackItemSelection.");
      // 26.0.2 (verified 2026-11-04 in NEW TEST, 24 clips): createEmptySelection needs a callback and hands the selection
      // to it; the selection is filled and set there (used after the callback, setSelection dereferenced a null pointer),
      // and setSelection returns a promise that rejects ("A nullptr was dereferenced") once the selection is gone, even when
      // the clips were selected: the promise is ignored and the timeline read back is the answer
      const step = [];
      let reached = false;
      await Sel.createEmptySelection((sel) => {
        try {
          for (const x of chosen) sel.addItem(x.ti, true);
          const r = t.sequence.setSelection(sel);
          if (r && r.catch) r.catch(() => {});
          reached = true;
        } catch (e) {
          step.push(`inside createEmptySelection: ${(e && e.message) || e}`);
        }
      });
      if (!reached) throw new Error(step.join(" | ") || "setSelection was not reached.");
      await sleep(400);
      const again = await premiere.readTimeline(p);
      return { requested: chosen.map(brief), selected: again.items.filter((x) => x.selected).map(brief) };
    },
    // fill the corrections box the way a person would
    async fill(a) {
      // the notes box, and (0.10.34) the Track names options, so a test can choose colours and the auto switch
      // 0.10.41: and the rough cut's Fast switch (with whether its row and the download offer are shown)
      if (!["notes", "labelsColor1", "labelsColor2", "labelsAuto", "roughFast", "tr_scale", "tr_rotation", "tr_centre", "tr_smooth", "tr_zoom"].includes(a.id)) throw new Error("fill: notes, the Track names options, roughFast and the Tracker's Scale / Rotation only.");
      const e = doc.getElementById(a.id);
      const box = a.id === "labelsAuto" || a.id === "roughFast" || a.id.startsWith("tr_");
      if (box) e.checked = !!a.value;
      else e.value = String(a.value);
      if (a.id !== "notes") {
        try {
          e.dispatchEvent(new Event("change"));
        } catch (err) {
          // UXP's own checkbox code reads a detail a script's event lacks (a box the panel made itself, 0.10.53); the box is set
          if (!box) throw err;
        }
      }
      const extra = a.id === "roughFast" ? { row_shown: !$("roughFastRow").hidden, download_shown: !$("roughFaster").hidden } : {};
      return { id: a.id, value: box ? e.checked : e.value, ...extra };
    },
    async click(a) {
      if (!a.now) await idle(120);                       // { now: true }: press while the panel is busy (Cancel during a job)
      const want = String(a.text || "").trim().toLowerCase();
      const all = buttons();
      const hit = a.id ? [$(a.id)].filter(Boolean)
        : all.filter((b) => text(b).toLowerCase() === want).concat(all.filter((b) => text(b).toLowerCase().includes(want)));
      const b = hit[0];
      if (!b) throw new Error(`No such button. There are: ${all.map(text).join(" | ")}`);
      if (b.disabled) throw new Error(`The button "${text(b)}" is disabled.`);
      if (typeof b.click === "function") b.click();
      else b.dispatchEvent(new Event("click"));
      return { clicked: text(b) };
    },
    async wait_idle(a) {
      return idle(Number(a.timeout) || 120);
    },
    // a frame of the sequence at `seconds`, written to the engine's frames folder (measured by the engine, never shown)
    async frame(a) {
      const { p } = await project();
      const seq = await p.getActiveSequence();
      const st = await engineApi.status();
      const path = await premiereColor.exportFrame(seq, Number(a.seconds), `dev_${String(a.name || "frame").replace(/[^\w-]/g, "")}.png`,
        st.frames_dir, (m) => { throw new Error(m); });
      return { path };
    },
    // what Lumetri holds on the clips (by name): Asistent's own, manual or none, and the values
    async lumetri(a) {
      const { p } = await project();
      const t = await premiere.readTimeline(p);
      const out = [];
      for (const x of pick(t.items, { kind: "video", ...a })) {
        const st = await premiereColor.lumetriState(x);
        out.push({ ...brief(x), lumetri: st.lumetri, values: st.current });
      }
      return { clips: out };
    },
    // every effect on the clips in chain order, with the Lumetri values (read only)
    async chain(a) {
      const { p } = await project();
      const t = await premiere.readTimeline(p);
      const out = [];
      for (const x of pick(t.items, { kind: "video", ...a })) out.push({ clip: brief(x), effects: await premiereColor.devChain(x) });
      return { clips: out };
    },
    // a graphic's text through UXP (2026-11-04: ExtendScript reads a Premiere text graphic's Source Text as one useless
    // character): every parameter of the last graphic on V1 (or `track`), and with {"text": "..."} an attempt to write it
    async graphic_text(a) {
      const { p } = await project();
      const seq = await p.getActiveSequence();
      const ppro = require("premierepro");
      const tr = await seq.getVideoTrack(Number.isInteger(a.track) ? a.track - 1 : 0);
      const items = (await premiere.maybe(tr, "getTrackItems", ppro.Constants.TrackItemType.CLIP, false)) || [];
      let ti = null;
      for (const x of items) {
        const n = (await premiere.maybe(x, "getName")) || "";
        if (a.name ? n === a.name : /graphic|subtitle/i.test(n)) ti = x;
      }
      if (!ti) throw new Error("No graphic on that track.");
      const chain = await ti.getComponentChain();
      const out = [];
      let source = null;
      const show = async (prm) => {
        const r = { name: prm.displayName };
        for (const m of ["getStartValue", "getValue"]) {
          try {
            const v = await prm[m]();
            r[m] = typeof v === "object" ? JSON.stringify(v && v.value !== undefined ? { value: v.value, type: typeof v.value } : v).slice(0, 400) : String(v).slice(0, 400);
          } catch (e) {
            r[m] = `error: ${(e && e.message) || e}`;
          }
        }
        return r;
      };
      for (let i = 0; i < (await chain.getComponentCount()); i++) {
        const comp = await chain.getComponentAtIndex(i);
        const match = (await premiere.maybe(comp, "getMatchName")) || "";
        const row = { match, params: [] };
        for (let j = 0; j < (await comp.getParamCount()); j++) {
          const prm = await comp.getParam(j);
          if (/text/i.test(match) && /source text/i.test(prm.displayName || "")) source = prm;
          if (/text/i.test(match) || j < 3) row.params.push(await show(prm));
        }
        out.push(row);
      }
      const names = [];
      for (let q = source; q && q !== Object.prototype; q = Object.getPrototypeOf(q)) names.push(...Object.getOwnPropertyNames(q));
      let written = null;
      if (a.text && source) {
        try {
          const kf = source.createKeyframe(String(a.text));
          premiere.transaction(p, "Asistent test: graphic text", (c) => c.addAction(source.createSetValueAction(kf, true)));
          written = await show(source);
        } catch (e) {
          written = `error: ${(e && e.message) || e}`;
        }
      }
      return { components: out, source_methods: [...new Set(names)].sort(), written };
    },
    // which value a point parameter (Motion > Position) takes through UXP, for moving subtitle graphics in one Undo step
    async graphic_move(a) {
      const { p } = await project();
      const seq = await p.getActiveSequence();
      const ppro = require("premierepro");
      const tr = await seq.getVideoTrack(Number.isInteger(a.track) ? a.track - 1 : 0);
      const items = (await premiere.maybe(tr, "getTrackItems", ppro.Constants.TrackItemType.CLIP, false)) || [];
      let ti = null;
      for (const x of items) if (((await premiere.maybe(x, "getName")) || "") === (a.name || "Graphic")) ti = x;
      if (!ti) throw new Error("No such graphic.");
      const chain = await ti.getComponentChain();
      let pos = null;
      for (let i = 0; i < (await chain.getComponentCount()); i++) {
        const comp = await chain.getComponentAtIndex(i);
        if (((await premiere.maybe(comp, "getMatchName")) || "") !== "AE.ADBE Motion") continue;
        for (let j = 0; j < (await comp.getParamCount()); j++) {
          const prm = await comp.getParam(j);
          if (prm.displayName === "Position") pos = prm;
        }
      }
      const read = async () => JSON.stringify((await pos.getStartValue()).value);
      const tries = [];
      const ways = [["PointF", () => new ppro.PointF(a.x, a.y)], ["array", () => [a.x, a.y]], ["object", () => ({ x: a.x, y: a.y })]];
      for (const [label, make] of ways) {
        try {
          const kf = pos.createKeyframe(make());
          premiere.transaction(p, "Asistent test: move graphic", (c) => c.addAction(pos.createSetValueAction(kf, true)));
          tries.push({ label, after: await read() });
          break;
        } catch (e) {
          tries.push({ label, error: (e && e.message) || String(e) });
        }
      }
      return { before_ok: true, tries, PointF: typeof ppro.PointF };
    },
    // every effect on audio clips with all parameters (name, value, keyframed), read only: for finding how Premiere
    // names the parameters of an audio effect (Dynamics, Volume). args: names/track/from/to as for `timeline`
    async audio_chain(a) {
      const { p } = await project();
      const t = await premiere.readTimeline(p);
      const out = [];
      for (const x of pick(t.items, { kind: "audio", ...a })) out.push({ clip: brief(x), effects: await premiereAudio.dumpChain(x) });
      return { clips: out };
    },
    // append one audio effect (default "Dynamics") to ONE audio clip, in one Undo step, and report its parameters
    async audio_fx_add(a) {
      const { p } = await project();
      const t = await premiere.readTimeline(p);
      const chosen = pick(t.items, { kind: "audio", ...a });
      if (chosen.length !== 1) throw new Error(`Exactly one clip is needed, found ${chosen.length}: ${chosen.map((x) => `${x.name} ${x.start.toFixed(1)}`).join(", ")}`);
      await premiereAudio.addEffectProbe(p, chosen[0], a.effect || "Dynamics");
      return { clip: brief(chosen[0]), effects: await premiereAudio.dumpChain(chosen[0]) };
    },
    // write Lumetri values (e.g. {"exposure": 3}) into ONE clip's existing Lumetri, in one Undo step: for measuring how
    // Lumetri really responds. Refuses unless exactly one clip matches; returns the values before and after.
    async set_lumetri(a) {
      const { p } = await project();
      const t = await premiere.readTimeline(p);
      const chosen = pick(t.items, { kind: "video", ...a });
      if (chosen.length !== 1) throw new Error(`Exactly one clip is needed, found ${chosen.length}: ${chosen.map((x) => `${x.name} ${x.start.toFixed(1)}`).join(", ")}`);
      const values = a.values || {};
      if (!Object.keys(values).length || !Object.keys(values).every((k) => ["exposure", "temperature", "tint", "contrast", "saturation"].includes(k))) {
        throw new Error("values: only exposure, temperature, tint, contrast, saturation.");
      }
      const before = (await premiereColor.lumetriState(chosen[0])).current;
      const after = await premiereColor.devWrite(p, chosen[0], values);
      return { clip: brief(chosen[0]), before, after };
    },
    // ---- Phase 7 probes (docs/SUBTITLES_PLAN.md, M0); they write only into TEST.prproj, the user undoes/deletes

    // P-A5b (Stash clips, 2026-11-11, temporary): clone the clips of one video track of sequence a.from into sequence a.to
    // (test project only) with createCloneTrackItemAction: does a clone cross sequences, with its effects and keyframes?
    async clone_probe(a) {
      const { p } = await project();
      const ppro = require("premierepro");
      const seqs = await p.getSequences();
      const src = seqs.find((s) => s.name === a.from), dst = seqs.find((s) => s.name === a.to);
      if (!src || !dst) throw new Error("from / to sequence not found");
      const track = await src.getVideoTrack(a.track || 0);
      const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
      const editor = ppro.SequenceEditor.getEditor(dst);
      const tried = [];
      for (const it of items) {
        try {
          premiere.transaction(p, "Asistent test: clone", (c) => c.addAction(editor.createCloneTrackItemAction(it,
            ppro.TickTime.createWithSeconds(a.offset || 0), a.vOffset || 0, 0, true, false)));
          tried.push({ name: it.name, ok: true });
        } catch (e) {
          tried.push({ name: it.name, ok: false, error: (e && e.message) || String(e) });
        }
      }
      return { items: items.length, tried };
    },
    // 0.10.45 rough cut by clones (temporary probe): clone one clip of `from` into `to` far out (scratch), trim the copy,
    // move it into place; report what each step did (which parts came along, their files, in / out, start / end)
    async rough_probe(a) {
      const { p } = await project();
      const ppro = require("premierepro");
      const seqs = await p.getSequences();
      const src = seqs.find((s) => s.name === a.from), dst = seqs.find((s) => s.name === a.to);
      if (!src || !dst) throw new Error("from / to sequence not found");
      const T = (s) => ppro.TickTime.createWithSeconds(s);
      const snap = async () => (await premiere.readItems(dst)).items.map((x) => ({ kind: x.kind, track: x.track, name: x.name,
        file: x.path, start: +x.start.toFixed(3), end: +x.end.toFixed(3), in: +(x.inPt || 0).toFixed(3), out: +(x.outPt || 0).toFixed(3) }));
      const before = await snap();
      const srcItems = (await premiere.readItems(src)).items.filter((x) => x.kind === (a.kind || "video") && x.track === (a.track || 0));
      const it = srcItems[a.index || 0];
      if (!it) throw new Error("no such clip in from");
      const scratch = a.scratch || 3000;
      const out = { source: { name: it.name, start: it.start, end: it.end, in: it.inPt, out: it.outPt }, before: before.length, steps: [] };
      const editor = ppro.SequenceEditor.getEditor(dst);
      try {
        premiere.transaction(p, "Asistent test: clone far", (c) => c.addAction(editor.createCloneTrackItemAction(it.ti,
          T(scratch - it.start), a.vOffset || 0, a.aOffset || 0, a.align !== false, false)));
        out.steps.push({ step: "clone", ok: true });
      } catch (e) { out.steps.push({ step: "clone", ok: false, error: String(e && e.message || e) }); return out; }
      const afterClone = (await snap()).filter((x) => x.start >= scratch - 1);
      out.afterClone = afterClone;
      const all = (await premiere.readItems(dst)).items.filter((x) => x.start >= scratch - 1);
      const mine = all.find((x) => x.kind === (a.kind || "video")) || all[0];
      if (!mine) return out;
      out.methods = Object.getOwnPropertyNames(Object.getPrototypeOf(mine.ti)).filter((n) => /^create/.test(n));
      const newIn = (mine.inPt || 0) + (a.cutIn || 1), newOut = (mine.inPt || 0) + (a.cutOut || 3);
      for (const [name, make] of [
        ["in", () => mine.ti.createSetInPointAction(T(newIn))],
        ["out", () => mine.ti.createSetOutPointAction(T(newOut))],
      ]) {
        try {
          premiere.transaction(p, `Asistent test: trim ${name}`, (c) => c.addAction(make()));
          out.steps.push({ step: `trim ${name}`, ok: true, now: (await snap()).filter((x) => x.start >= scratch - 1 - 60) });
        } catch (e) { out.steps.push({ step: `trim ${name}`, ok: false, error: String(e && e.message || e) }); }
      }
      const moved = (await premiere.readItems(dst)).items.filter((x) => x.start >= scratch - 60);
      try {
        premiere.transaction(p, "Asistent test: move", (c) => {
          for (const x of moved) c.addAction(x.ti.createMoveAction(T((a.moveTo || 0) - x.start)));
        });
        out.steps.push({ step: "move", ok: true, now: await snap() });
      } catch (e) { out.steps.push({ step: "move", ok: false, error: String(e && e.message || e) }); }
      return out;
    },
    // P1: import .srt files (paths on this Mac) into the bin "Asistent test" and report what Premiere made of them
    async srt_import(a) {
      const { p } = await project();
      const ppro = require("premierepro");
      const bin = await premiere.ensureBin(p, "Asistent test");
      const target = ppro.ProjectItem.cast(bin) || bin;
      const accepted = await p.importFiles(a.paths || [], true, target, false);
      const items = [];
      for (const it of (await bin.getItems()) || []) items.push(await describe(it));
      return { accepted, items };
    },
    // P2: place the imported caption item after the end of the sequence (never over the user's clips), one
    // transaction per way tried; report caption track counts and what appeared. Nothing is removed: the user undoes.
    async caption_place(a) {
      const { p } = await project();
      const ppro = require("premierepro");
      const seq = await p.getActiveSequence();
      const bin = await premiere.ensureBin(p, "Asistent test");
      const all = (await bin.getItems()) || [];
      const item = all.find((x) => x.name === a.name) || all[0];
      if (!item) throw new Error("Nothing in \"Asistent test\": run srt_import first.");
      const end = premiere.secs(await seq.getEndTime()) || 0;
      const at = ppro.TickTime.createWithSeconds(end + 5);
      const v = await seq.getVideoTrackCount(), au = await seq.getAudioTrackCount();
      const before = { captions: await seq.getCaptionTrackCount(), video: v, audio: au };
      const editor = ppro.SequenceEditor.getEditor(seq);
      const proj = ppro.ProjectItem.cast(item) || item;
      const ways = [
        ["overwrite", () => editor.createOverwriteItemAction(proj, at, v - 1, au - 1)],
        ["insert", () => editor.createInsertProjectItemAction(proj, at, v - 1, au - 1, true)],
      ];
      const tried = [];
      for (const [name, make] of a.way ? ways.filter((w) => w[0] === a.way) : ways) {
        try {
          premiere.transaction(p, `Asistent test: subtitles (${name})`, (c) => c.addAction(make()));
          tried.push({ way: name, ok: true });
          break;
        } catch (e) {
          tried.push({ way: name, ok: false, error: (e && e.message) || String(e) });
        }
      }
      const after = { captions: await seq.getCaptionTrackCount(), video: await seq.getVideoTrackCount(), audio: await seq.getAudioTrackCount() };
      const placed = [];
      for (let i = 0; i < after.captions; i++) {
        const tr = await seq.getCaptionTrack(i);
        for (const ti of (await premiere.maybe(tr, "getTrackItems", ppro.Constants.TrackItemType.CLIP, false)) || []) {
          placed.push({ track: i, name: await premiere.maybe(ti, "getName"), start: premiere.secs(await premiere.maybe(ti, "getStartTime")),
            end: premiere.secs(await premiere.maybe(ti, "getEndTime")) });
        }
      }
      const t = await premiere.readTimeline(p);
      const near = t.items.filter((x) => x.end > end + 1).map(brief);
      return { item: await describe(item), at_seconds: end + 5, before, after, tried, caption_items: placed, other_items_after_end: near };
    },
    // P2b: try one SequenceEditor method with tokens as arguments: "$item" = the bin item `name`, "$t:N" = TickTime of N
    // seconds, "$seq" = active sequence, numbers/booleans as they are. Reports caption tracks before/after.
    async editor_try(a) {
      const { p } = await project();
      const ppro = require("premierepro");
      const seq = await p.getActiveSequence();
      const bin = await premiere.ensureBin(p, "Asistent test");
      const item = ((await bin.getItems()) || []).find((x) => x.name === a.name);
      if (!item) throw new Error("No such item in \"Asistent test\": " + a.name);
      const editor = ppro.SequenceEditor.getEditor(seq);
      const args = (a.args || []).map((x) => (x === "$item" ? (ppro.ProjectItem.cast(item) || item) : x === "$seq" ? seq
        : typeof x === "string" && x.startsWith("$t:") ? ppro.TickTime.createWithSeconds(Number(x.slice(3))) : x));
      const before = { captions: await seq.getCaptionTrackCount(), video: await seq.getVideoTrackCount(), audio: await seq.getAudioTrackCount() };
      let outcome;
      try {
        let act;
        premiere.transaction(p, `Asistent test: ${a.method}`, (c) => { act = editor[a.method](...args); if (act) c.addAction(act); });
        outcome = { ok: true, returned: typeof act };
      } catch (e) {
        outcome = { ok: false, error: (e && e.message) || String(e) };
      }
      const after = { captions: await seq.getCaptionTrackCount(), video: await seq.getVideoTrackCount(), audio: await seq.getAudioTrackCount() };
      return { method: a.method, outcome, before, after };
    },
    // caption tracks of the active sequence: items with their names and times, and the method names of one item
    // 0.9.97 probe (the user's OK, 2026-11-04: Apply and rebuild should replace the old pair): remove every line of one caption
    // track in one step. That is the call that crashed Premiere 26.0.2 while CEP panels ran ExtendScript (DECISIONS: "No track
    // item removal through UXP"), so only here, in the test projects, and the references to the removed lines are dropped at once.
    async caption_remove(a) {
      const { p } = await project();
      const ppro = require("premierepro");
      const seq = await p.getActiveSequence();
      let items = (await premiere.maybe(await seq.getCaptionTrack(a.track), "getTrackItems", ppro.Constants.TrackItemType.CLIP, false)) || [];
      const count = items.length;
      if (!count) throw new Error("That caption track has no lines.");
      const editor = ppro.SequenceEditor.getEditor(seq);
      const step = [];
      let done = false;
      await ppro.TrackItemSelection.createEmptySelection((sel) => {
        try {
          for (const ti of items) sel.addItem(ti, true);
          premiere.transaction(p, "Asistent test: remove caption lines", (c) => c.addAction(editor.createRemoveItemsAction(sel, false, ppro.Constants.MediaType.ANY)));
          done = true;
        } catch (e) {
          step.push((e && e.message) || String(e));
        }
      });
      items = null;
      const left = ((await premiere.maybe(await seq.getCaptionTrack(a.track), "getTrackItems", ppro.Constants.TrackItemType.CLIP, false)) || []).length;
      return { done, step, count, left, tracks: await seq.getCaptionTrackCount() };
    },
    // the panel's own placement (premiere-captions.place) with a given SRT pair: a second call must replace the first pair
    async place_test(a) {
      const { p } = await project();
      const seq = await p.getActiveSequence();
      const r = await require("./premiere-captions.js").place(p, seq, { srt: a.srt, srt_en: a.srt_en || null, captions: a.captions || [] }, { again: true });
      return { status: r.status, track: r.track, english: r.english, problems: r.problems, message: r.message, replaces: r.replaces,
        removed: r.removed && { count: r.removed.count, tracks: r.removed.tracks.map((t) => t.index) } };
    },
    // the other way: hide a caption track (its eye), nothing removed
    async caption_hide(a) {
      const { p } = await project();
      const tr = await (await p.getActiveSequence()).getCaptionTrack(a.track);
      const before = await premiere.maybe(tr, "isMuted");
      const r = await premiere.maybe(tr, "setMute", !!a.hide);
      return { before, returned: r, after: await premiere.maybe(tr, "isMuted") };
    },
    async captions_state() {
      const { p } = await project();
      const ppro = require("premierepro");
      const seq = await p.getActiveSequence();
      const n = await seq.getCaptionTrackCount();
      const tracks = [];
      let sample = null;
      for (let i = 0; i < n; i++) {
        const tr = await seq.getCaptionTrack(i);
        const items = [];
        for (const ti of (await premiere.maybe(tr, "getTrackItems", ppro.Constants.TrackItemType.CLIP, false)) || []) {
          sample = sample || ti;
          items.push({ name: await premiere.maybe(ti, "getName"), start: premiere.secs(await premiere.maybe(ti, "getStartTime")),
            end: premiere.secs(await premiere.maybe(ti, "getEndTime")) });
        }
        tracks.push({ index: i, name: tr.name, items });
      }
      const methods = [];
      for (let q = sample; q && q !== Object.prototype; q = Object.getPrototypeOf(q)) methods.push(...Object.getOwnPropertyNames(q));
      let source = null;
      if (sample) {
        const pi = await premiere.maybe(sample, "getProjectItem");
        const cp = pi && (ppro.ClipProjectItem.cast(pi) || pi);
        source = pi ? { name: pi.name, path: await premiere.maybe(cp, "getMediaFilePath"), type: pi.type } : null;
      }
      return { count: n, tracks, source, methods: [...new Set(methods)].sort() };
    },
    // P3: Premiere's own transcript of the selected clip (needs Speech to Text run on it once) as JSON text
    async transcript_export(a) {
      const { p } = await project();
      const ppro = require("premierepro");
      const t = await premiere.readTimeline(p);
      const x = t.items.find((i) => i.selected && i.kind === "video" && i.clip) || t.items.find((i) => i.selected && i.clip);
      if (!x) throw new Error("Select one clip with a transcript.");
      const tries = [];
      for (const [label, arg] of [["clip", x.clip], ["projectItem", x.projectItem]]) {
        try {
          const out = await ppro.Transcript.exportToJSON(arg);
          const text = typeof out === "string" ? out : JSON.stringify(out);
          tries.push({ with: label, ok: true, length: (text || "").length, json: (text || "").slice(0, Number(a.max) || 20000) });
          break;
        } catch (e) {
          tries.push({ with: label, ok: false, error: (e && e.message) || String(e) });
        }
      }
      return { clip: brief(x), tries };
    },
    // export reveal, phase 0 (docs/EXPORT_REVEAL_PLAN.md): which render / export events this Premiere sends to UXP for
    // exports the editor starts by hand, and what they carry. Listens to every EVENT_ constant of EncoderManager (and any
    // other ppro class whose constant names say export / render / encode), both globally and on the manager.
    async export_listen() {
      const ppro = require("premierepro");
      const consts = [];
      for (const cls of Object.getOwnPropertyNames(ppro)) {
        const o = ppro[cls];
        if (!o || (typeof o !== "object" && typeof o !== "function")) continue;
        for (const n of Object.getOwnPropertyNames(o)) {
          if (/^EVENT_/.test(n) && (cls === "EncoderManager" || /EXPORT|RENDER|ENCOD/i.test(n))) consts.push({ cls, name: n, value: o[n] });
        }
      }
      const manager = await premiere.maybe(ppro.EncoderManager, "getManager");
      const attached = [];
      const fieldsOf = (e) => {
        const fields = {};
        for (let q = e; q && q !== Object.prototype; q = Object.getPrototypeOf(q)) {
          for (const k of Object.getOwnPropertyNames(q)) {
            if (k === "constructor" || k in fields) continue;
            try { const v = e[k]; if (typeof v !== "function") fields[k] = typeof v === "object" && v !== null ? String(v) : v; } catch (err) { fields[k] = "?" + err; }
          }
        }
        return fields;
      };
      for (const c of consts) {
        for (const how of manager ? ["global", "manager"] : ["global"]) {
          const handler = (e) => {
            const fields = fieldsOf(e);
            exportProbe.events.push({ at: new Date().toISOString(), event: `${c.cls}.${c.name}`, value: c.value, how, fields });
            engineApi.log("info", `export probe: ${c.cls}.${c.name} (${how}) ${JSON.stringify(fields).slice(0, 1500)}`);
          };
          try {
            if (how === "global") await ppro.EventManager.addGlobalEventListener(c.value, handler);
            else await ppro.EventManager.addEventListener(manager, c.value, handler);
            attached.push(`${c.cls}.${c.name} ${how}`);
          } catch (e) {
            attached.push(`${c.cls}.${c.name} ${how} FAILED ${(e && e.message) || e}`);
          }
        }
      }
      return { constants: consts, manager: !!manager, manager_methods: manager ? Object.getOwnPropertyNames(Object.getPrototypeOf(manager)) : [], attached };
    },
    // 0.10.36: what the panel does when Premiere says an export ended (an export started by a script fires no event)
    async learn_export() {
      if (!hooks.learnFromExport) throw new Error("no colour learning in this panel");
      return hooks.learnFromExport(true);
    },
    // 0.10.39: what the panel's export-event handler sends for the after-export check (a scripted export fires no event):
    // the active sequence read by premiere-exportcheck.js, then /exports/done with the file
    // 0.10.51 Tracker: the box a drag would set (the bridge cannot drag), and what the page holds
    async tracker_box(a) {
      if (!hooks.tracker) throw new Error("no Tracker page in this panel");
      return hooks.tracker().setBox(a.box);
    },
    async tracker_info() {
      if (!hooks.tracker) throw new Error("no Tracker page in this panel");
      return hooks.tracker().info();
    },
    async after_export(a) {
      if (!hooks.afterExport) throw new Error("no after-export check in this panel");
      return hooks.afterExport(a.out || null);
    },
    async export_events(a) {
      const out = exportProbe.events.slice();
      if (a.clear) exportProbe.events.length = 0;
      return { events: out };
    },
    // export the active sequence of the test project to a.out with preset a.preset through EncoderManager (0.10.7: does
    // Premiere's export-complete event reach the panel, and what does it carry). Writes only the one file it is given.
    async export_try(a) {
      if (!a.out || !a.preset) throw new Error("out and preset are needed");
      const ppro = require("premierepro");
      const { p } = await project();
      const seq = await p.getActiveSequence();
      const manager = await ppro.EncoderManager.getManager();
      const types = (ppro.Constants && ppro.Constants.ExportType) || ppro.ExportType || null;
      const type = types ? (types.IMMEDIATELY !== undefined ? types.IMMEDIATELY : types.Immediately) : undefined;
      const started = Date.now();
      const ok = await manager.exportSequence(seq, type, a.out, a.preset);
      return { ok, type, types: types ? Object.keys(types) : null, ms: Date.now() - started };
    },
    // method names of an object, to find what this Premiere offers
    async api(a) {
      const { p } = await project();
      const seq = await p.getActiveSequence();
      const objects = { project: p, sequence: seq, ppro: require("premierepro"), selection: await premiere.maybe(seq, "getSelection") };
      let o = objects[a.target];
      if (!o) throw new Error(`Known: ${Object.keys(objects).join(", ")}`);
      for (const part of String(a.path || "").split(".").filter(Boolean)) o = o && o[part];     // e.g. "Transcript"
      if (!o) throw new Error(`No ${a.target}.${a.path}`);
      const names = new Set();
      const walk = (q) => {
        for (; q && q !== Object.prototype && q !== Function.prototype; q = Object.getPrototypeOf(q)) {
          for (const n of Object.getOwnPropertyNames(q)) if (n !== "constructor" && !["length", "name", "arguments", "caller"].includes(n)) names.add(n);
        }
      };
      walk(o);
      if (typeof o === "function" && o.prototype) {                                              // a class: statics + instance methods
        const inst = new Set([...names]);
        names.clear();
        for (const n of inst) names.add(`static ${n}`);
        walk(o.prototype);
        for (const n of Object.getOwnPropertyNames(o.prototype)) if (n !== "constructor") names.add(n);
      }
      return { names: [...names].sort() };
    },
  };

  async function run(cmd) {
    const fn = commands[cmd.name];
    if (!fn) return { ok: false, data: { error: `Unknown command: ${cmd.name}`, known: Object.keys(commands) } };
    try {
      if (cmd.name !== "ping") {
        const pr = await project();
        if (!pr.ok) return { ok: false, data: { error: `Test projects only (TEST.prproj, NEW TEST.prproj): "${pr.name}" is open now. Nothing was touched.` } };
      }
      return { ok: true, data: await fn(cmd.args || {}) };
    } catch (e) {
      return { ok: false, data: { error: (e && e.message) || String(e) } };
    }
  }

  async function loop() {
    for (;;) {
      let pause = 0;
      try {
        const cmd = await engineApi.devPoll(10);
        if (cmd && cmd.id) {
          const res = await run(cmd);
          await engineApi.devResult(cmd.id, res.ok, res.data);
        }
      } catch (e) {
        pause = 5000;                                  // bridge off (404) or engine away: look again in a few seconds
      }
      if (pause) await sleep(pause);
    }
  }

  return { run, loop, commands };
}

module.exports = { createBridge, TEST_PROJECT };
