// The panel states the preview can show (?s=name). Texts are copied from what main.js and the plan modules really
// write, so a screenshot shows real lengths; numbers and clip names are made up (no client material).

// presses buttons of the Keyframer page by their label, in order (a click with no press before it acts, like a test click)
function kfPress(labels) {
  const pane = document.getElementById("paneKeyframer");
  for (const l of labels) {
    const b = [...pane.querySelectorAll(".btn")].filter((x) => x.textContent.trim() === l).pop();
    if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
}

// the Tracker page with a drawn clip: a court, a ball bouncing across it (no footage)
// variant "box": a frame with a box drawn, not yet tracked; "busy": the first track running (live frame, 40 % done)
function trackerDemo(api, cur, variant) {
  const W = 1080, H = 1920, N = 120;
  const pos = (i) => [300 + 5 * i, 1150 + 420 * Math.abs(Math.sin(i / 7))];
  const pic = (i) => {
    const c = document.createElement("canvas");
    c.width = 270;
    c.height = 480;
    const g = c.getContext("2d");
    g.fillStyle = "#2f4a2c";
    g.fillRect(0, 0, 270, 300);
    g.fillStyle = "#8c3b2a";
    g.fillRect(0, 300, 270, 180);
    g.strokeStyle = "#3a7ca5";
    for (let x = 10; x < 270; x += 60) g.strokeRect(x, 20, 50, 270);
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
  const preview = { jpeg: pic(20), width: W, height: H, w: 270, h: 480 };
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
    "tracker-empty": { run: (api) => { api.openTab("paneTracker"); } },
    "tracker-box": { run: (api) => { api.openTab("paneTracker"); trackerDemo(api, 0, "box"); } },
    "tracker-busy": { run: (api) => { api.openTab("paneTracker"); trackerDemo(api, 0, "busy"); } },
    "tracker-lock": { run: (api) => { api.openTab("paneTracker"); trackerDemo(api, 75); const b = [...document.querySelectorAll("#paneTracker .tr-mode")].pop(); if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true })); } },
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
        document.querySelector('[data-more="aboutExports"]').click();
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
        document.querySelector('[data-more="aboutAfter"]').click();
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
        for (const sel of ["#audioMore", '[data-more="aboutRough"]', '[data-more="devTools"]']) document.querySelector(sel).click();
      },
    },
  };
})();
