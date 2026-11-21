// The panel states the preview can show (?s=name). Texts are copied from what main.js and the plan modules really
// write, so a screenshot shows real lengths; numbers and clip names are made up (no client material).

// a made-up brand kit for the Brand page (0.10.71)
function brandKits() {
  return { kits: [{ id: "k1", name: "Northwind", folder: "/Volumes/Production/Brand Kits/Northwind", source: "library", online: true, remote: true },
    { id: "k2", name: "Harbor Coffee", folder: "/Volumes/Production/Brand Kits/Harbor Coffee", source: "library", online: true, remote: true }],
  detected: "k1", why: "the folder \"Northwind\"", roots: ["/Volumes/Production/Brand Kits"], missing: [] };
}
function brandKit() {
  const img = (rel, extra) => ({ rel, name: rel.replace(/^.*\//, "").replace(/\.[^.]+$/, ""), ext: rel.split(".").pop(), kind: "image", importable: true, folder: rel.replace(/\/[^/]*$/, ""), uses: 0, fav: false, ...extra });
  return { id: "k1", name: "Northwind", folder: "/Volumes/Production/Brand Kits/Northwind", source: "library", online: true, remote: true,
    sig: "s1", read_at: "2026-11-14 12:01", status: "draft-2", deletable: true, aliases: ["NW"],
    colors: [{ group: "Primary", items: [{ hex: "#1F6FEB", name: "Northwind Blue" }, { hex: "#0B1F3A", name: "Deep Navy" }, { hex: "#FFFFFF", name: "White" }] },
      { group: "Accents", items: [{ hex: "#F2B705", name: "Signal Yellow" }, { hex: "#E5533D", name: "Coral" }, { hex: "#3FB950", name: "Leaf" }] },
      { group: "Subtitles", items: [{ hex: "#FFFFFF", name: "Subtitle text" }, { hex: "#F2B705", name: "Subtitle keyword" }] }],
    fonts: [{ family: "Inter", role: "brand", installed: "yes", files: [{ style: "Regular", usable: true, installed: true }, { style: "Bold", usable: true, installed: true }] },
      { family: "Fraunces", role: "secondary", installed: "no", files: [{ style: "SemiBold", usable: true, installed: false }] },
      { family: "Montserrat", role: "subtitles", installed: "yes", files: [] }],
    assets: {
      logos: [img("assets/logo/northwind-horizontal.png", { fav: true, uses: 6, alts: [{ ext: "svg" }] }), img("assets/logo/northwind-horizontal-white.png", { variant: "for dark backgrounds", uses: 3 }),
        img("assets/logo/northwind-mark.png"), { ...img("assets/logo/northwind-mark.svg"), kind: "vector", importable: false, why: "Premiere does not import SVG: use the PNG version." }],
      graphics: [img("assets/graphics/price-tag.png"), img("assets/graphics/lower-third-frame.png")],
      video: [{ rel: "assets/intro-outro/Northwind intro.mov", name: "Northwind intro", ext: "mov", kind: "video", importable: true, role: "intro", duration: 3.2, has_audio: true, uses: 2 },
        { rel: "assets/intro-outro/Northwind outro.mov", name: "Northwind outro", ext: "mov", kind: "video", importable: true, role: "outro", duration: 4.5, has_audio: true, uses: 0 }],
      audio: [], other: [],
      presets: [{ rel: "assets/presets/Price callout.mogrt", name: "Price callout", ext: "mogrt", kind: "mogrt", importable: false, cat: "presets", uses: 0 }],
      references: [{ rel: "assets/reference/Brand book 2026.pdf", name: "Brand book 2026", ext: "pdf", kind: "doc", importable: false, cat: "references", uses: 0 }],
    },
    subtitle: { preset: "gstroy", name: "Northwind", font: "Montserrat Black 52", case: "UPPERCASE" },
    notes: ["Name: Northwind (never \"the Northwind\")", "Prices only after checking the site on the day"],
    counts: { logos: 4, graphics: 2, video: 2, audio: 0, presets: 1, references: 1, other: 0, fonts: 3 } };
}
function brandThumb(rel) {
  if (!/\.(png|mov)$/.test(rel)) return null;
  const c = document.createElement("canvas");
  c.width = 80;
  c.height = 80;
  const g = c.getContext("2d");
  if (/\.mov$/.test(rel)) {
    g.fillStyle = "#0B1F3A";
    g.fillRect(0, 0, 80, 80);
  }
  g.fillStyle = /white/.test(rel) ? "#FFFFFF" : /price|lower/.test(rel) ? "#F2B705" : "#1F6FEB";
  g.beginPath();
  g.arc(40, 40, 22, 0, Math.PI * 2);
  g.fill();
  return c.toDataURL("image/png");
}

// presses buttons of the Keyframer page by their label, in order (a click with no press before it acts, like a test click)
function kfPress(labels) {
  const pane = document.getElementById("paneKeyframer");
  for (const l of labels) {
    const b = [...pane.querySelectorAll(".btn")].filter((x) => x.textContent.trim() === l).pop();
    if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
}

// presses the In & Out page's controls by id (a click with no press before it acts, like a test click)
function ioPress(ids) {
  for (const id of ids) {
    const b = document.getElementById(id);
    if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
}

// the Tracker page with a drawn clip: a court, a ball bouncing across it (no footage)
// variant "box": a frame with a box drawn, not yet tracked; "busy": the first track running (live frame, 40 % done)
// 0.10.75: shape "wide" (16:9) or "square" (1:1) instead of the vertical 9:16 court, for the adaptive layouts
function trackerDemo(api, cur, variant, shape) {
  const [W, H] = shape === "wide" ? [1920, 1080] : shape === "square" ? [1080, 1080] : [1080, 1920];
  const N = 120;
  const pos = (i) => [W * 0.28 + 5 * i, H * 0.6 + H * 0.22 * Math.abs(Math.sin(i / 7))];
  const pic = (i) => {
    const c = document.createElement("canvas");
    const [cw, ch] = [W / 4, H / 4];
    c.width = cw;
    c.height = ch;
    const g = c.getContext("2d");
    g.fillStyle = "#2f4a2c";
    g.fillRect(0, 0, cw, ch * 0.625);
    g.fillStyle = "#8c3b2a";
    g.fillRect(0, ch * 0.625, cw, ch * 0.375);
    g.strokeStyle = "#3a7ca5";
    for (let x = 10; x < cw; x += 60) g.strokeRect(x, 20, 50, ch * 0.56);
    const [x, y] = pos(i);
    g.fillStyle = "#d9772b";
    g.beginPath();
    g.arc(x / 4, y / 4, 14, 0, Math.PI * 2);
    g.fill();
    return c.toDataURL("image/jpeg", 0.8).split(",")[1];
  };
  const frames = Array.from({ length: N }, (_, i) => {
    const [x, y] = pos(i);
    const state = i >= 60 && i < 66 ? "lost" : i >= 40 && i < 48 ? "unsure" : "sure";
    return { t: 2 + i / 30, x, y, s: 1, a: 0, c: state === "sure" ? 0.95 - 0.05 * Math.sin(i / 5) : state === "unsure" ? 0.62 : 0.2, state };
  });
  const p = api.tracker();
  const source = { clip: { name: "C0412.MP4", path: "/x/C0412.MP4", track: 0, start: 10, inPt: 2, speed: 1 }, step: 1 / 30, t0: 2 + 20 / 30, from: 2, to: 6, at: 10.67 };
  const preview = { jpeg: pic(20), width: W, height: H, w: W / 4, h: H / 4 };
  const box = [(pos(20)[0] - 60) / W, (pos(20)[1] - 60) / H, 120 / W, 120 / H];
  if (variant === "box") {
    p.demo({ source, preview });
    return p.setBox(box);
  }
  if (variant === "busy") {
    const [x, y] = pos(68);
    return p.demo({ source, preview, box: null, busy: true, job: "demo", progress: 0.4, liveLo: 20, liveHi: 68,
      live: { k: 68, jpeg: pic(68), x, y, s: 1, a: 0, state: "sure" } });
  }
  if (variant === "range") {                    // 0.10.63: tracked 10-90 of a range 10-110, then Stop: the rest not tracked
    const fr = frames.map((f, i) => (i < 10 || i > 90 ? { ...f, c: 0, state: "none" } : f));
    return p.demo({ source, preview, range: [10, 110],
      track: { frames: fr, width: W, height: H, k0: 20, id: "demo", box: [pos(20)[0] - 60, pos(20)[1] - 60, 120, 120], stopped: true },
      thumbs: fr.map((f, i) => (f.state === "none" ? null : pic(i))), cur });
  }
  p.demo({
    source,
    preview,
    track: { frames, width: W, height: H, k0: 20, id: "demo", box: [pos(20)[0] - 60, pos(20)[1] - 60, 120, 120] },
    thumbs: frames.map((_, i) => pic(i)), cur,
  });
}

window.PREVIEW_SCENARIOS = (function () {
  // a before/after frame pair drawn on a canvas (base64 JPEG without the data: prefix, as the engine sends it)
  function frame(warm) {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 180;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 320, 180);
    grad.addColorStop(0, warm ? "#6b5640" : "#4a4f57");
    grad.addColorStop(1, warm ? "#2b2118" : "#1e2126");
    g.fillStyle = grad;
    g.fillRect(0, 0, 320, 180);
    g.fillStyle = warm ? "#c9a27e" : "#b9a796";
    g.beginPath();
    g.arc(160, 80, 34, 0, Math.PI * 2);
    g.fill();
    g.fillRect(110, 118, 100, 62);
    return c.toDataURL("image/jpeg", 0.8).split(",")[1];
  }

  const lines = (api, list) => list.map(([cls, text]) => api.el("div", cls, text));

  function roughDone(api) {
    const box = api.el("div", "group");
    box.appendChild(api.el("div", "name", "ROUGH – Interview (safe) v2"));
    box.appendChild(api.el("div", "line", "Pauses cut: 38 (1:12 in all). Repeated takes: 3 groups, 2 cut (24.6 s)."));
    box.appendChild(api.el("div", "line", "Kept take #3 of „Виж тази чиния…“, the others were cut."));
    api.finish("Done: ROUGH – Interview (safe) v2, 4:31 → 2:54. The original is not touched.", true, [
      box,
      ...lines(api, [
        ["warn", "A1: 6 audio clips on a muted track or switched off, not used."],
        ["warn", "Said differently, only listed: 0:42 „Ако е под 200 евро…“ / 1:05 „Ако е под 300 евро…“."],
        ["hint", "The level, the limiter and the Lumetri values were carried over. Not carried: Warp Stabilizer (2 clips)."],
      ]),
    ]);
  }

  // a made-up recording for the Cut silences preview: speech, pauses, a quiet conversation between two takes
  function silencesDemo(api, set) {
    document.getElementById("optRough").hidden = false;
    for (const [id, v] of Object.entries(set)) {
      const e = document.getElementById(id);
      if (e.type === "checkbox") e.checked = !!v;
      else e.value = v;
      e.dispatchEvent(new Event("change"));
    }
    const db = [];
    const regions = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const plan = [[2.5, "silence"], [14, "speech"], [1.6, "silence"], [9, "speech"], [0.3, "short"], [6, "speech"], [2, "silence"], [18, "offmic"], [1.4, "silence"],
      [3, "flag"], [1.2, "silence"], [4, "take"], [0.8, "silence"], [16, "speech"], [0.7, "filler"], [8, "speech"], [3, "silence"]];
    let t = 12;
    for (const [len, kind] of plan) {
      const level = { speech: -18, offmic: -31, flag: -25, take: -19, filler: -24 }[kind] || -62;
      for (let i = 0; i < Math.round(len / 0.05); i++) db.push(Math.round(level + (level > -50 ? (rnd() - 0.6) * 22 : rnd() * 4)));
      if (kind !== "speech") {
        const text = { silence: "silence", short: "short pause", offmic: "a voice 13 dB under the main voice", flag: "a voice 7 dB under the main voice: kept, not sure",
          take: "repeated take", filler: "hesitation sound" }[kind];
        regions.push({ start: t, end: t + len, kind: kind === "flag" ? "offmic" : kind, cut: kind !== "flag", flag: kind === "flag", text });
      }
      t += len;
    }
    api.silences().showResult({ preview: true, t_start: 12, t_end: t, before_s: t - 12, action: "remove", method: set.roughMethod || "auto", mode: "ai",
      env: { hop: 0.05, db }, regions, tracks: [0, 1], suggest_db: -30,
      speech: { asr: true, vad: true, listened: [{ name: "C0731.MP4", track: 0, floor: -61, main: -19.4, open: -45.2 }, { name: "Lav 2.WAV", track: 1, floor: -66, main: -22.1, open: -48 }] } });
  }

  function colorProposal(api) {
    const blocks = [];
    const previews = [];
    for (const [name, warm, l] of [["C0731.MP4", true, ["Exposure +1 stops (high confidence)", "White balance: correction (high confidence)"]],
      ["C0732.MP4", false, ["Exposure: no change", "White balance: fine (medium)"]]]) {
      const box = api.el("div", "group");
      box.appendChild(api.el("div", "name", name));
      for (const x of l) box.appendChild(api.el("div", "line", x));
      box.appendChild(api.el("div", "reason", "Measured on the timeline (5 frames)."));
      blocks.push(box);
      previews.push(api.previewBlock(name, { before: frame(warm), after: frame(false), portrait: false }, "before · after (approximate)", l));
    }
    const done = api.el("div", "group");
    done.appendChild(api.el("div", "name", "C0731.MP4 · corrected"));
    done.appendChild(api.el("div", "line", "Exposure +1 · Temperature -8 · Tint +3"));
    api.finish("Applied to 1 clip. One Cmd/Ctrl+Z undoes everything.", true, [done, ...blocks], { previews });
  }

  const captions = {
    captions: [
      { start: 0.4, end: 2.1, text: "Днес ще ви покажа\nтри неща" },
      { start: 2.1, end: 3.9, text: "мога и един раф", flags: ["unsure"] },
      { start: 4.0, end: 6.2, text: "сума ти нища" },
      { start: 6.3, end: 8.0, text: "за градината" },
      { start: 61.5, end: 63.0, text: "Джи Строй прави всичко" },
    ],
    review: [{ at: 4.5 }],
  };

  return {
    idle: {},
    offline: { engine: { status: { error: "Failed to fetch" } } },
    nudge: { run: (api) => api.finish("Exposure +0.5 on 1 clip (now +1.5), one Undo step.", true, [], { toast: "+0.5 exposure added · fx31028.MP4 now +1.5" }) },
    update: { engine: { update: { current: "0.9.87", latest: "0.9.88", newer: true, notes: "## 0.9.88 - Example" } } },
    busy: { run: (api) => { api.setBusy(true); api.progress(0.42, "Recognising the speech: piece 3 of 8…"); } },
    done: { run: roughDone },
    // 0.10.96 Cut silences: the options open, and a preview of a made-up interview (off-mic talk between two takes)
    silences: { run: (api) => { document.getElementById("optRough").hidden = false; } },
    "silences-preview": { run: (api) => silencesDemo(api, {}) },
    "silences-custom": { run: (api) => silencesDemo(api, { roughPacing: "custom", roughMethod: "manual", roughShort: true }) },
    error: { run: (api) => api.finish("Select at least one clip with sound in the timeline (its video or its audio).", false) },
    log: { run: (api) => { roughDone(api); api.openTab("paneLog"); } },
    color: { run: colorProposal },
    beforeafter: { run: (api) => { colorProposal(api); api.openTab("panePreview"); } },
    captions: { run: (api) => { api.renderCaptionEditor(captions); api.openTab("paneCaptions"); } },
    keyframer: { run: (api) => api.openTab("paneKeyframer") },
    // 0.10.33: Elastic with Ping-pong until the clip ends, and Bounce at both ends (clicks the page's own buttons)
    "keyframer-elastic": { run: (api) => { api.openTab("paneKeyframer"); kfPress(["Elastic", "Ping-pong"]); } },
    "keyframer-stash": {
      engine: { stash: { bytes: 41000, items: [
        { id: "a1", name: "C0738 · Position, Scale", client: "GStroy", span: 1.5, props: ["Motion › Position", "Motion › Scale"] },
        { id: "a2", name: "Logo slide in", client: "ReShape", span: 0.8, props: ["Motion › Position"] }] } },
      run: (api) => { api.openTab("paneKeyframer"); setTimeout(() => { const e = document.getElementById("kfProfile"); if (e) e.scrollIntoView(); }, 80); },
    },
    // 0.10.55: the Tracker page with a made-up track of a bouncing ball (an unsure and a lost stretch), on frame 52
    tracker: { run: (api) => { api.openTab("paneTracker"); trackerDemo(api, 52); } },
    "tracker-wide": { run: (api) => { api.openTab("paneTracker"); trackerDemo(api, 52, null, "wide"); } },
    "tracker-square": { run: (api) => { api.openTab("paneTracker"); trackerDemo(api, 52, null, "square"); } },
    // 0.10.59: a Tools row opened (Rough cut), Settings, the Log icon's page
    "row-open": { run: (api) => { const b = document.querySelector('#secRough .btn.more'); if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true })); } },
    settings: { run: (api) => { api.openTab("paneSettings"); } },
    "log-page": { run: (api) => { api.openTab("paneLog"); } },
    "tracker-empty": { run: (api) => { api.openTab("paneTracker"); } },
    "tracker-range": { run: (api) => { api.openTab("paneTracker"); trackerDemo(api, 90, "range"); } },
    "tracker-box": { run: (api) => { api.openTab("paneTracker"); trackerDemo(api, 0, "box"); } },
    // 0.10.73: zoomed in twice on the tracked point (the path and the box move with the frame)
    "tracker-zoom": { run: (api) => { api.openTab("paneTracker"); trackerDemo(api, 52); for (const id of ["trZoomIn", "trZoomIn", "trZoomIn", "trZoomMove"]) document.getElementById(id).dispatchEvent(new MouseEvent("click", { bubbles: true })); } },
    "tracker-busy": { run: (api) => { api.openTab("paneTracker"); trackerDemo(api, 0, "busy"); } },
    "tracker-lock": { run: (api) => { api.openTab("paneTracker"); trackerDemo(api, 75); const b = [...document.querySelectorAll("#paneTracker .tr-mode")].pop(); if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true })); } },
    // 0.10.71: the Brand page with a made-up client (no client material): colours, logos, video, fonts, presets
    brand: { engine: { brandKits: brandKits(), brandKit: brandKit() }, thumb: brandThumb, run: (api) => api.openTab("paneBrand") },
    "brand-manage": { engine: { brandKits: brandKits(), brandKit: brandKit() }, thumb: brandThumb,
      run: (api) => { api.openTab("paneBrand"); setTimeout(() => { const b = [...document.querySelectorAll("#paneBrand .btn")].find((x) => x.textContent === "Manage"); if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, 120); } },
    "brand-offline": { engine: { brandKits: brandKits(), brandKit: { ...brandKit(), online: false, note: "The kit's folder is not reachable (/Volumes/Production/Brand Kits/Northwind): showing what this computer read last (2026-11-14 12:01). Files with a copy here still work." } },
      thumb: brandThumb, run: (api) => api.openTab("paneBrand") },
    anchor: { run: (api) => api.openTab("paneAnchor") },
    // In & Out (Phase 3): nothing picked; Slide in + Anticipate out (edge asked, Strength on); Spin in + Fade out (turn asked, Strength
    // greyed); after Apply with a made-up result
    inout: { run: (api) => api.openTab("paneInOut") },
    "inout-edge": { run: (api) => { api.openTab("paneInOut"); ioPress(["ioIn-slide", "ioOut-anticipate", "ioDir-top"]); } },
    "inout-turn": { run: (api) => { api.openTab("paneInOut"); ioPress(["ioIn-spinIn", "ioOut-fade", "ioTurn-ccw", "ioBlurSwitch"]); } },
    "inout-out": { run: (api) => { api.openTab("paneInOut"); ioPress(["ioIn-pop", "ioOut-spinOut", "ioTurn-ccw"]); } },
    "inout-scale": { run: (api) => { api.openTab("paneInOut"); ioPress(["ioIn-popElastic", "ioOut-shrink", "ioFilter-scale"]); } },
    "inout-hover": { run: (api) => { api.openTab("paneInOut"); ioPress(["ioIn-slide", "ioOut-fade", "ioSideIn"]); const b = document.getElementById("ioIn-elastic");
      if (b) b.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false })); } },
    "inout-done": { run: (api) => { api.openTab("paneInOut"); ioPress(["ioIn-slide", "ioOut-fade"]); setTimeout(() => ioPress(["ioApply"]), 150); } },
    // 0.10.78: the preview and the motion blur switched on (Overshoot+ sample move)
    "keyframer-blur": { run: (api) => {
      api.openTab("paneKeyframer");
      kfPress(["Overshoot+"]);
      document.getElementById("kfBlurSwitch").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    } },
    "keyframer-custom": { run: (api) => { api.openTab("paneKeyframer"); kfPress(["Bounce", "Edit as points"]); } },
    "keyframer-bounce": { run: (api) => { api.openTab("paneKeyframer"); kfPress(["Bounce", "Both", "Loop", "+"]); } },
    review: {
      engine: { review: {
        lines: [
          [],
          [{ kind: "recognition", severity: 3, label: "changed by dictionary repair", word: "рафт", from: "раф", to: "рафт" },
            { kind: "timing", severity: 1, label: "the aligner was unsure where this word is", word: "мога" }],
          [{ kind: "recognition", severity: 3, label: "a word may be missing here", word: "" },
            { kind: "recognition", severity: 2, label: "the recognition was unsure of this word", word: "нища" }],
          [],
          [{ kind: "recognition", severity: 3, label: "the recognition was unsure of this word", word: "Строй", why: "name" }],
        ],
        summary: { lines_to_check: 3, meaning: 3, timing: 1, recognition: 4, order: [1, 2, 4] },
      } },
      run: (api) => { api.renderCaptionEditor({ ...captions, json: "/p/Asistent_subtitles/a.json" }); api.openTab("paneCaptions"); },
    },
    search: {
      run: (api) => {
        api.renderCaptionEditor(captions);
        document.getElementById("captionSearch").value = "ра";
        api.runSearch();
        api.openTab("paneCaptions");
      },
    },
    learned: {
      run: (api) => {
        api.renderCaptionEditor({ ...captions, tracks: [0, 1], speakers: { 0: "m" } });
        api.renderSpeakers({ tracks: [0, 1], speakers: { 0: "m" } }, "/p/A.prproj");
        api.learnedView.open = true;
        api.renderLearned({ client: "ReShape", shared: true, rules: [
          { key: "a", heard: "масоните", said: "мастните", projects: 3, computers: 2, used: 5, active: true, removed: false, examples: ["При липедема масните клетки"] },
          { key: "b", heard: "Решейп", said: "ReShape", projects: 1, computers: 1, used: 0, active: true, removed: false, examples: [] },
          { key: "c", heard: "при", said: "по", projects: 1, computers: 1, used: 0, active: false, removed: false, examples: [] },
          { key: "d", heard: "компроментира", said: "компрометира", projects: 2, computers: 1, used: 1, active: false, removed: true, examples: [] },
        ] });
        api.openTab("paneCaptions");
      },
    },
    exports: {
      engine: {
        exports: { enabled: true, app: "Finder", folders: [{ path: "/Volumes/Production/Exported Videos/Екопак/Контент план 8", why: "premiere" }],
          items: [
            { id: "c", name: "Видео 7 - final.mp4", at: Date.now() / 1000 - 60, shown: true, note: "shown in Finder" },
            { id: "b", name: "Видео 7 - 9x16.mp4", at: Date.now() / 1000 - 70, shown: false, note: "in a queue: the last export was shown" },
            { id: "a", name: "Видео 6.mp4", at: Date.now() / 1000 - 3600, shown: false, note: "could not be shown: moved" },
          ] },
      },
      run: (api) => {
        document.querySelector('[data-more="optExports"]').click();
        setTimeout(() => api.openTab("paneLog"), 400);
      },
    },
    afterexport: {
      engine: {
        exports: { enabled: false, check: true, app: "Finder", folders: [{ path: "/Volumes/Production/Exported Videos/Екопак/Контент план 8", why: "premiere" }],
          items: [
            { id: "c", name: "Видео 7 - final.mp4", at: Date.now() / 1000 - 60, shown: false, check: { status: "look", summary: "3 things to look at", took: 9.8, lines: [
              { level: "ok", text: "The file is complete: 0:58.4, 141.2 MB." },
              { level: "info", text: "1080x1920, 29.97 fps, H264, 19.3 Mb/s, bt709" },
              { level: "check", text: "Black bars top and bottom: 0:20.2-0:21.3 (or a very dark edge)." },
              { level: "ok", text: "No black frames." },
              { level: "check", text: "The picture stands still 0:51.0-0:52.6 (1.6 s): a still on purpose, or a frozen clip?" },
              { level: "check", text: "True peak +0.3 dBFS: above -1 dBFS, the platforms' encoding may distort it." },
              { level: "info", text: "Loudness -17.1 LUFS (-3.1 LU from -14, the usual platform level; information only)." },
            ] } },
            { id: "b", name: "Видео 6.mp4", at: Date.now() / 1000 - 3600, shown: false, check: { status: "fine", summary: "everything measured looks fine", lines: [] } },
          ] },
      },
      run: (api) => {
        document.querySelector('[data-more="optAfter"]').click();
        setTimeout(() => document.getElementById("secAfter").scrollIntoView(), 600);
      },
    },
    open: {
      engine: {
        model: { backend: true, model: false, expected_bytes: 3.1e9, bytes: 0, dir: "~/Library/Application Support/Asistent/models/whisper" },
        import: { enabled: true, folder: "/Users/editor/Downloads", pending: [], recent: [
          { state: "imported", name: "whoosh_fast_03.wav", category: "SFX" },
          { state: "imported", name: "Epidemic - Night Drive.mp3", category: "MUSIC" },
          { state: "failed", name: "broken.mov", category: "OTHER", note: "FFprobe cannot read it" },
        ] },
      },
      run: () => {
        document.querySelector('[data-more="optAudio"]').click();
      },
    },
  };
})();
