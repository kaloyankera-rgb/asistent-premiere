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
