// Browser preview of the panel (development only, never packed). Loads the real panel/index.html markup and runs the
// real main.js with a tiny CommonJS loader; Premiere ("premierepro", "uxp", "os") and the engine (./engine.js) are
// fakes, and a scenario (?s=name) fills the views through the functions main.js hands to window.__asistentPreview.
(function () {
  const PANEL = "../panel/";
  const params = new URLSearchParams(location.search);
  const scenario = params.get("s") || "idle";

  function get(url) {
    const x = new XMLHttpRequest();
    x.open("GET", url, false);                          // synchronous on purpose: require() is synchronous
    x.send();
    if (x.status !== 200) throw new Error(`preview: ${url} ${x.status}`);
    return x.responseText;
  }

  // the panel's markup, without its own <script> (main.js is started below through the loader)
  const doc = new DOMParser().parseFromString(get(PANEL + "index.html"), "text/html");
  for (const n of [...doc.body.childNodes]) {
    if (n.nodeName !== "SCRIPT") document.body.insertBefore(document.importNode(n, true), document.currentScript);
  }

  // ------------------------------------------------------------ fakes
  const project = { name: "TEST.prproj", path: "/Users/editor/Projects/TEST.prproj", getActiveSequence: async () => null };
  const anything = () => new Proxy(function () {}, { get: (t, k) => (k === "then" ? undefined : anything()), apply: () => anything() });
  const fakePremiere = new Proxy({ Project: { getActiveProject: async () => project }, ClipProjectItem: { cast: () => null } },
    { get: (t, k) => (k in t ? t[k] : anything()) });

  const S = window.PREVIEW_SCENARIOS[scenario];
  if (!S) throw new Error(`preview: no scenario "${scenario}". Known: ${Object.keys(window.PREVIEW_SCENARIOS).join(", ")}`);
  const panelVersion = (get(PANEL + "version.js").match(/"([^"]+)"/) || [])[1];
  const engineState = Object.assign({
    status: { ok: true, version: panelVersion, frames_dir: "/tmp/frames" },
    model: { backend: true, model: true },
    notes: "раф => рафт\nДжи Строй",
    import: { enabled: false, folder: null, pending: [], recent: [] },
    exports: { enabled: false, app: "Finder", folders: [], items: [] },
  }, S.engine || {});

  const fakeEngine = new Proxy({
    status: async () => engineState.status,
    log: () => {},
    subtitlesModel: async () => engineState.model,
    updateCheck: async () => engineState.update || { current: panelVersion, latest: panelVersion, newer: false },
    subtitleSettings: async () => ({ text: engineState.notes }),
    saveSubtitleSettings: async () => ({ errors: [] }),
    importStatus: async () => engineState.import,
    exportSettings: async () => engineState.exports,
    exportsRecent: async () => ({ items: engineState.exports.items || [] }),
    review: async () => engineState.review || { lines: [], summary: null },
    listen: async () => ({ seconds: 4.0 }),
    devPoll: () => Promise.reject(new Error("bridge off in the preview")),
  }, { get: (t, k) => (k in t ? t[k] : async () => ({})) });

  const fakes = {
    premierepro: fakePremiere,
    uxp: { host: { version: "26.0.2" }, storage: { localFileSystem: { getFolder: async () => null } } },
    os: { platform: () => "darwin", release: () => "24.6.0" },
    "./engine.js": fakeEngine,
  };

  // ------------------------------------------------------------ loader
  const cache = {};
  function require(name) {
    if (name in fakes) return fakes[name];
    const file = name.replace(/^\.\//, "");
    if (cache[file]) return cache[file].exports;
    const module = { exports: {} };
    cache[file] = module;
    const src = get(PANEL + file);
    new Function("require", "module", "exports", `${src}\n//# sourceURL=panel/${file}`)(require, module, module.exports);
    return module.exports;
  }

  window.__asistentPreview = (api) => {
    window.asistent = api;
    // main.js has bound everything and started its loops; the scenario runs after the first header refresh
    setTimeout(() => {
      if (S.run) S.run(api);
      document.documentElement.setAttribute("data-ready", "1");
    }, 300);
  };
  require("./main.js");
})();
