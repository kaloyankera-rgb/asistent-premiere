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
    // method names of an object, to find what this Premiere offers
    async api(a) {
      const { p } = await project();
      const seq = await p.getActiveSequence();
      const objects = { project: p, sequence: seq, ppro: require("premierepro"), selection: await premiere.maybe(seq, "getSelection") };
      const o = objects[a.target];
      if (!o) throw new Error(`Знам: ${Object.keys(objects).join(", ")}`);
      const names = new Set();
      for (let q = o; q && q !== Object.prototype; q = Object.getPrototypeOf(q)) {
        for (const n of Object.getOwnPropertyNames(q)) if (n !== "constructor") names.add(n);
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
