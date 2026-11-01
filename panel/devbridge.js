// Test bridge, panel side: runs commands the engine hands out (`GET /dev/poll`) so a developer can drive the
// panel in the user's test project without a person pressing buttons. Off unless the engine has the flag file
// `devbridge.enabled` (then /dev/poll answers 404 and this loop only sleeps). Refuses every command except `ping`
// unless the open project is TEST.prproj (the user's rule: Premiere tests only there). Never closes or
// restarts Premiere, never writes anything itself: it presses the panel's own buttons and reads.
const engine = require("./engine.js");

const TEST_PROJECT = /(^|[\\/])TEST\.prproj$/i;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTLE = 900;                                 // main.js ignores clicks for 700 ms after the panel changed

function createBridge({ premiere, premiereColor, doc, version, engineApi = engine, sleep = wait }) {
  const $ = (id) => doc.getElementById(id);
  const text = (n) => ((n && n.textContent) || "").trim();
  const buttons = () => [...doc.querySelectorAll("button")].filter((b) => !b.hidden);
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
    while (busy() && Date.now() < end) await sleep(300);
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

  const commands = {
    async ping() {
      const pr = await project().catch((e) => ({ name: null, ok: false, error: String(e && e.message || e) }));
      return { panel: version, project: pr.name, path: pr.path, test_project: pr.ok, busy: busy() };
    },
    async state() {
      return panelState();
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
    // select clips by (part of) name / track / time range; needs TrackItemSelection (API unverified on 26.0.2: an
    // error here says what is missing)
    async select(a) {
      const { p } = await project();
      const t = await premiere.readTimeline(p);
      const chosen = pick(t.items, { kind: "video", ...a });
      if (!chosen.length) throw new Error("Няма клипове по тези условия.");
      const ppro = require("premierepro");
      const Sel = ppro.TrackItemSelection;
      if (!Sel || !premiere.has(Sel, "createEmptySelection")) throw new Error("Няма TrackItemSelection в това API.");
      const sel = await Sel.createEmptySelection();
      for (const x of chosen) await sel.addItem(x.ti, true);
      await t.sequence.setSelection(sel);
      const again = await premiere.readTimeline(p);
      return { requested: chosen.map(brief), selected: again.items.filter((x) => x.selected).map(brief) };
    },
    async click(a) {
      await idle(120);
      const want = String(a.text || "").trim().toLowerCase();
      const all = buttons();
      const hit = a.id ? [$(a.id)].filter(Boolean)
        : all.filter((b) => text(b).toLowerCase() === want).concat(all.filter((b) => text(b).toLowerCase().includes(want)));
      const b = hit[0];
      if (!b) throw new Error(`Няма такъв бутон. Има: ${all.map(text).join(" | ")}`);
      if (b.disabled) throw new Error(`Бутонът „${text(b)}“ е изключен.`);
      b.click();
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
    // write Lumetri values (e.g. {"exposure": 3}) into ONE clip's existing Lumetri, in one Undo step: for measuring how
    // Lumetri really responds. Refuses unless exactly one clip matches; returns the values before and after.
    async set_lumetri(a) {
      const { p } = await project();
      const t = await premiere.readTimeline(p);
      const chosen = pick(t.items, { kind: "video", ...a });
      if (chosen.length !== 1) throw new Error(`Трябва точно един клип, намерени ${chosen.length}: ${chosen.map((x) => `${x.name} ${x.start.toFixed(1)}`).join(", ")}`);
      const values = a.values || {};
      if (!Object.keys(values).length || !Object.keys(values).every((k) => ["exposure", "temperature", "tint", "contrast", "saturation"].includes(k))) {
        throw new Error("values: само exposure, temperature, tint, contrast, saturation.");
      }
      const before = (await premiereColor.lumetriState(chosen[0])).current;
      const after = await premiereColor.devWrite(p, chosen[0], values);
      return { clip: brief(chosen[0]), before, after };
    },
    // ---- Phase 7 probes (docs/SUBTITLES_PLAN.md, M0); they write only into TEST.prproj, the user undoes/deletes

    // P1: import .srt files (paths on this Mac) into the bin „Asistent тест“ and report what Premiere made of them
    async srt_import(a) {
      const { p } = await project();
      const ppro = require("premierepro");
      const bin = await premiere.ensureBin(p, "Asistent тест");
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
      const bin = await premiere.ensureBin(p, "Asistent тест");
      const all = (await bin.getItems()) || [];
      const item = all.find((x) => x.name === a.name) || all[0];
      if (!item) throw new Error("Няма нищо в „Asistent тест“: първо srt_import.");
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
          premiere.transaction(p, `Asistent тест: субтитри (${name})`, (c) => c.addAction(make()));
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
      const bin = await premiere.ensureBin(p, "Asistent тест");
      const item = ((await bin.getItems()) || []).find((x) => x.name === a.name);
      if (!item) throw new Error("Няма такъв елемент в „Asistent тест“: " + a.name);
      const editor = ppro.SequenceEditor.getEditor(seq);
      const args = (a.args || []).map((x) => (x === "$item" ? (ppro.ProjectItem.cast(item) || item) : x === "$seq" ? seq
        : typeof x === "string" && x.startsWith("$t:") ? ppro.TickTime.createWithSeconds(Number(x.slice(3))) : x));
      const before = { captions: await seq.getCaptionTrackCount(), video: await seq.getVideoTrackCount(), audio: await seq.getAudioTrackCount() };
      let outcome;
      try {
        let act;
        premiere.transaction(p, `Asistent тест: ${a.method}`, (c) => { act = editor[a.method](...args); if (act) c.addAction(act); });
        outcome = { ok: true, returned: typeof act };
      } catch (e) {
        outcome = { ok: false, error: (e && e.message) || String(e) };
      }
      const after = { captions: await seq.getCaptionTrackCount(), video: await seq.getVideoTrackCount(), audio: await seq.getAudioTrackCount() };
      return { method: a.method, outcome, before, after };
    },
    // caption tracks of the active sequence: items with their names and times, and the method names of one item
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
      if (!x) throw new Error("Маркирай един клип с транскрипт.");
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
    // method names of an object, to find what this Premiere offers
    async api(a) {
      const { p } = await project();
      const seq = await p.getActiveSequence();
      const objects = { project: p, sequence: seq, ppro: require("premierepro"), selection: await premiere.maybe(seq, "getSelection") };
      let o = objects[a.target];
      if (!o) throw new Error(`Знам: ${Object.keys(objects).join(", ")}`);
      for (const part of String(a.path || "").split(".").filter(Boolean)) o = o && o[part];     // e.g. "Transcript"
      if (!o) throw new Error(`Няма ${a.target}.${a.path}`);
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
    if (!fn) return { ok: false, data: { error: `Непозната команда: ${cmd.name}`, known: Object.keys(commands) } };
    try {
      if (cmd.name !== "ping") {
        const pr = await project();
        if (!pr.ok) return { ok: false, data: { error: `Само в TEST.prproj: сега е отворен „${pr.name}“. Нищо не е пипано.` } };
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
