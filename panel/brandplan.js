// The Brand page's decisions (0.10.71), pure so node tests cover them: where an asset goes on the timeline, which buttons an
// asset gets, the quick list, search, the colour maths, which kit is shown, and the paths a drop carries.
const { fromUri } = require("./dropfolder.js");

const LABELS = { logos: "Logos", graphics: "Graphics", video: "Video", audio: "Sound", presets: "Presets", references: "References", other: "Other files" };
const ORDER = ["logos", "graphics", "video", "audio", "presets", "references", "other"];
// What `new ppro.Color(r, g, b, a)` takes: 1 = values 0-1, 255 = values 0-255. Measured 2026-11-15 in NEW TEST (Premiere 26.5.3):
// 0-1 is right, #ED1C24 written this way reads back 236,27,40 and the tinted letters render 232,28,40.
const COLOR_RANGE = 1;

/**
 * The tracks a new clip goes on at `at` (seconds) for `duration` seconds (unknown: till the end of everything): the video
 * track just above every video clip that overlaps that span, so the asset is seen and nothing is covered or cut, and the
 * lowest audio track free for the span. A track index past the last one means "add a track" (the host adds it first).
 * items: [{kind: "video"|"audio", track, start, end}], counts: {video, audio}; opts: {video: true, audio: false}.
 * -> {video, audio, addVideo, addAudio, end}
 */
function placeOn(items, counts, at, duration, opts = {}) {
  const wantVideo = opts.video !== false;
  const end = duration > 0 ? at + duration : Infinity;
  const eps = 1e-4;
  const over = (x) => x.start < end - eps && x.end > at + eps;
  let video = 0;
  let addVideo = 0;
  if (wantVideo) {
    let top = -1;
    for (const x of items) if (x.kind === "video" && over(x)) top = Math.max(top, x.track);
    video = top + 1;
    addVideo = Math.max(0, video + 1 - (counts.video || 0));
  }
  let audio = 0;
  let addAudio = 0;
  if (opts.audio) {
    const busy = new Set(items.filter((x) => x.kind === "audio" && over(x)).map((x) => x.track));
    audio = -1;
    for (let t = 0; t < (counts.audio || 0); t++) {
      if (!busy.has(t)) {
        audio = t;
        break;
      }
    }
    if (audio < 0) {
      audio = counts.audio || 0;
      addAudio = 1;
    }
  }
  return { video, audio, addVideo, addAudio, end };
}

/** Where the sequence ends (the latest clip end on any track), for "at the end" (an outro). */
function sequenceEnd(items) {
  let end = 0;
  for (const x of items) if (Number.isFinite(x.end)) end = Math.max(end, x.end);
  return end;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The colour as `ppro.Color` takes it (r, g, b, a in its own range). */
function colorArgs(hex, range = COLOR_RANGE) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return range === 255 ? [...rgb, 255] : [...rgb.map((v) => Math.round((v / 255) * 10000) / 10000), 1];
}

/** Dark or light text on a swatch of this colour (WCAG relative luminance). */
function textOn(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const lin = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return L > 0.4 ? "#111216" : "#ffffff";
}

/**
 * The buttons of one asset: `primary` is what a click on the asset does (also its first button), `more` the rest.
 * kinds: place (at the playhead), end (at the sequence's end), mogrt, import (into the bin only), open (in its own app),
 * show (in Finder / Explorer). Anything Premiere cannot import gets show only, with the reason.
 */
function actionsFor(a) {
  if (a.kind === "mogrt") return { primary: "mogrt", more: ["show"] };
  if (a.cat === "references") {
    const more = a.importable ? ["import", "show"] : ["show"];
    return { primary: "open", more };
  }
  if (!a.importable) return { primary: "show", more: [], why: a.why || whyNot(a) };
  if (["image", "vector", "video", "audio"].includes(a.kind)) {
    const more = [];
    if (a.kind === "video" || a.kind === "audio") more.push("end");
    more.push("import", "show");
    return { primary: "place", more };
  }
  return { primary: "show", more: [] };
}

function whyNot(a) {
  if (a.kind === "effect") return "Premiere cannot apply an effect preset by script: import it once in the Effects panel (Presets > Import Presets).";
  if (a.kind === "lut") return "A LUT goes into Lumetri (Creative > Look > Browse): Asistent shows the file.";
  if (a.kind === "font") return "A font is installed, not imported (Fonts).";
  if (a.kind === "source") return "A design app's own file: Premiere does not import it.";
  return "Premiere does not import this kind of file.";
}

const VERB = { place: "Add", end: "At end", mogrt: "Add", import: "Import", open: "Open", show: "Show" };
const VERB_TIP = {
  place: "Adds it at the playhead on the first track above everything there, so nothing is covered or cut (imported into the client's bin the first time). One Cmd/Ctrl+Z takes it off the timeline.",
  end: "Adds it after the last clip of the sequence (an outro, an end card).",
  mogrt: "Places this Motion Graphics template at the playhead on a free track above everything there.",
  import: "Imports it into the client's Brand Kit bin without putting it on the timeline (once: a second press finds it there).",
  open: "Opens it in its own app (a PDF in Preview, a picture or a video in its player).",
  show: "Shows the file in Finder / Explorer.",
};

/** Favourites first, then the most used, from every category: the Quick row (one press each). */
function quick(kit, n = 8) {
  const all = [];
  for (const c of ORDER) for (const a of (kit && kit.assets && kit.assets[c]) || []) all.push(a);
  const favs = all.filter((a) => a.fav);
  const used = all.filter((a) => !a.fav && a.uses > 0).sort((x, y) => y.uses - x.uses);
  return [...favs, ...used].slice(0, n);
}

function simple(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/** Assets whose name, folder or type holds every word of the search. */
function filter(list, query) {
  const words = simple(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((a) => {
    const hay = simple(`${a.name} ${a.rel} ${a.ext} ${a.variant || ""} ${a.role || ""}`);
    return words.every((w) => hay.includes(w));
  });
}

/** The kit to show: the editor's choice for this project when it still exists, else the detected one. */
function chooseKit(kits, detected, choice) {
  const ids = new Set((kits || []).map((k) => k.id));
  if (choice && ids.has(choice)) return { id: choice, how: "chosen" };
  if (detected && ids.has(detected)) return { id: detected, how: "detected" };
  return { id: null, how: "none" };
}

/** Asistent's subtitle preset for the kit, when the Subtitles row has it (values of its Style list). */
function presetFor(kit, values) {
  const p = kit && kit.subtitle && kit.subtitle.preset;
  return p && (values || []).includes(p) ? p : null;
}

function duration(s) {
  if (!Number.isFinite(s) || s <= 0) return "";
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** The project bin of a client's brand files. */
function binName(kitName) {
  return `Brand Kit - ${String(kitName || "client").replace(/[\\/:*?"<>|]+/g, " ").trim() || "client"}`;
}

/** Every path a drop from Finder / Explorer carries (files list, uri-list lines, or text lines). */
function droppedPaths(parts) {
  const out = [];
  for (const f of parts.files || []) {
    const p = f && (f.nativePath || f.path);
    if (p) out.push(String(p));
  }
  if (!out.length) {
    for (const l of String(parts.uriList || "").split(/\r?\n/).map((x) => x.trim())) if (l && !l.startsWith("#")) out.push(fromUri(l));
  }
  if (!out.length) {
    for (const l of String(parts.text || "").split(/\r?\n/).map((x) => x.trim())) if (/^(file:|\/|[A-Za-z]:[\\/]|\\\\)/.test(l)) out.push(fromUri(l));
  }
  return [...new Set(out)];
}

module.exports = { LABELS, ORDER, COLOR_RANGE, VERB, VERB_TIP, placeOn, sequenceEnd, hexToRgb, colorArgs, textOn, actionsFor, quick,
  filter, chooseKit, presetFor, duration, binName, droppedPaths };
