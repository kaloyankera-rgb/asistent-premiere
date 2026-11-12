// HTTP client for the local Asistent engine (127.0.0.1 only).
const BASE = "http://127.0.0.1:47390";
// 0.10.45: the Premiere this panel runs in (major version), so the engine sends its host commands back to this Premiere
// when two versions run side by side (devbridge.Bridge.submit)
const LANE = (() => {
  try {
    return String(require("uxp").host.version || "").split(".")[0];
  } catch (e) {
    return "";
  }
})();

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "X-Asistent": "1", "X-Asistent-Lane": LANE, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (!res.ok) throw new Error(data.error || `Engine: HTTP ${res.status}`);
  return data;
}

// { ok, version } when the engine answers, otherwise { error } with the reason Premiere gave
async function status() {
  try {
    return await call("GET", "/status");
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
}

function startSync(paths, reference) {
  return call("POST", "/sync", { paths, reference: reference === undefined ? null : reference });
}

function startGroups(paths) {
  return call("POST", "/sync_groups", { paths });
}

function startAudio(items, phrases) {
  return call("POST", "/audio", { items, phrases: !!phrases });
}

// wait > 0: the engine answers as soon as a file is ready for this project (or after `wait` seconds)
function importStatus(project, wait) {
  return call("GET", `/import/status?project=${encodeURIComponent(project)}${wait ? `&wait=${wait}` : ""}`);
}

function importBind(project, folder) {
  return call("POST", "/import/bind", { project, folder: folder || null });
}

function importUnbind(project) {
  return call("POST", "/import/unbind", { project });
}

function importResult(id, ok, note) {
  return call("POST", "/import/result", { id, ok, note: note || "" });
}

function startColor(items) {
  return call("POST", "/color", { items });
}

function colorSliders(fixTemp, fixTint) {
  return call("POST", "/color/sliders", { fix_temp: fixTemp, fix_tint: fixTint });
}

function colorCheck(before, after, applied, fix, final = false) {
  return call("POST", "/color/check", { before, after, applied, fix, final });
}

function managedCheck(key, snapshot) {
  return call("POST", "/color/managed/check", { key, snapshot });
}

function managedRecord(key, snapshot, values) {
  return call("POST", "/color/managed/record", { key, snapshot, values });
}

function startShotMatch(items, reference) {
  return call("POST", "/shotmatch", { items, reference });
}

function shotMatchCheck(job, before, after, clip) {
  return call("POST", "/shotmatch/check", { job, before, after, clip });
}

function colorAudit(record) {
  return call("POST", "/color/audit", { record });
}

function waitFrame(path, timeout = 20) {
  return call("POST", "/frames/wait", { path, timeout });
}

function colorProbe(report, refs, frames) {
  return call("POST", "/color/probe", { report, refs, frames });
}

function subtitlesModel() {
  return call("GET", "/subtitles/model");
}

// only from the panel button the user pressed knowing the size: {done: true} or {job}
function downloadSubtitleModel() {
  return call("POST", "/subtitles/model/download", {});
}

// 0.10.40: large-v3-turbo, the rough cut's faster recognizer (never used for subtitles)
function downloadTurbo() {
  return call("POST", "/roughcut/model/download", {});
}

// the update check (GitHub releases, through the engine) and the update itself (only from the panel's Update button)
function updateCheck(force) {
  return call("GET", force ? "/update/check?force=1" : "/update/check");
}

function startUpdate() {
  return call("POST", "/update/install", {});
}

// only from the panel button the user pressed knowing the size: {done: true} or {job}
function downloadTranslator() {
  return call("POST", "/subtitles/translator/download", {});
}

function startSubtitles(payload) {
  return call("POST", "/subtitles", payload);
}

// Stash v1 (0.10.37): saved animations in the engine's app folder
function stashList() {
  return call("GET", "/stash/list");
}
function stashGet(id) {
  return call("GET", `/stash/get?id=${encodeURIComponent(id)}`);
}
function stashSave(stash, project) {
  return call("POST", "/stash/save", { stash, project });
}
function stashDelete(id) {
  return call("POST", "/stash/delete", { id });
}

// colour learning at export (0.10.36): queued in the engine, read only
function colorLearnRecord(project, sequence, clips) {
  return call("POST", "/colorlearn/record", { project, sequence, clips });
}

function colorLearnReport(project) {
  return call("GET", `/colorlearn/report?project=${encodeURIComponent(project)}`);
}

// pre-export check (0.10.35): each audio clip's peak in its range, read only
// 0.10.44: each file's frame (size, rotation, transparency) for the pre-export coverage check
function exportFrames(paths) {
  return call("POST", "/export/frames", { paths });
}

function startExportPeaks(items) {
  return call("POST", "/export/peaks", { items });
}

function startRoughcut(payload) {
  return call("POST", "/roughcut", payload);
}

function subtitleSettings(project) {
  return call("GET", `/subtitles/settings?project=${encodeURIComponent(project)}`);
}

function saveSubtitleSettings(project, text) {
  return call("POST", "/subtitles/settings", { project, text });
}

function saveSpeakers(project, speakers) {
  return call("POST", "/subtitles/speakers", { project, speakers });
}

function learned(project) {
  return call("GET", `/subtitles/learned?project=${encodeURIComponent(project)}`);
}

function setLearned(project, key, action) {
  return call("POST", "/subtitles/learned", { project, key, action });
}

function captionsState(project, sequence) {
  return call("GET", `/captions/state?project=${encodeURIComponent(project)}&sequence=${encodeURIComponent(sequence)}`);
}

function recordCaptions(project, sequence, signature) {
  return call("POST", "/captions/record", { project, sequence, signature });
}

// the engine's host (CEP extension, ExtendScript) puts the SRT on a caption track; can take a few seconds
function placeCaptions(payload) {
  return call("POST", "/captions/place", payload);
}

// every subtitle line as a text graphic on a new video track (the user's choice 2026-11-04)
function placeGraphics(payload) {
  return call("POST", "/captions/graphics", payload);
}

// L/L and R/R through the clips' own channels, done by the host (ExtendScript): can take a few seconds per clip
// Motion tracker (0.10.51): a frame of the file to box the object on, and the tracking job
function trackerFrame(payload) {
  return call("POST", "/tracker/frame", payload);
}
function startTracking(payload) {
  return call("POST", "/tracker/track", payload);
}
// every tracked frame as a small JPEG (0.10.55): the Tracker's viewer scrubs and plays them
function trackerThumbs(id, from, n) {
  return call("GET", `/tracker/thumbs?id=${encodeURIComponent(id)}&from=${from}&n=${n}`);
}

// Stash clips (0.10.50): a new stash's folder and empty sequence; the host saves the stash sequence as a project file
function stashClipsBegin(payload) {
  return call("POST", "/stash/clips/begin", payload);
}
function stashClipsExport(payload) {
  return call("POST", "/stash/clips/export", payload);
}
// tracks added at the top of the active sequence (host QE), when a stash has no free room
function addTracks(payload) {
  return call("POST", "/host/tracks", payload);
}

function roughLink(payload) {
  return call("POST", "/roughcut/link", payload);
}

function routeAudio(payload) {
  return call("POST", "/audio/route", payload);
}

function job(id) {
  return call("GET", `/jobs/${id}`);
}

function cancel(id) {
  return call("POST", `/jobs/${id}/cancel`, {});
}

// 0.10.63: finish now and keep what is done (the tracker's Stop)
function stop(id) {
  return call("POST", `/jobs/${id}/stop`, {});
}

// test bridge (devbridge.js): 404 while the engine's flag file is missing
function devPoll(wait) {
  return call("GET", `/dev/poll?wait=${wait}`);
}

function devResult(id, ok, data) {
  return call("POST", "/dev/result", { id, ok, data });
}

// show exported files in Finder / Explorer (engine exports.py)
function exportSettings(change) {
  return change ? call("POST", "/exports/settings", change) : call("GET", "/exports/settings");
}

function exportsRecent() {
  return call("GET", "/exports/recent");
}

function exportDone(path, kind, source, sequence) {
  return call("POST", "/exports/done", { path: path || null, kind, source, sequence: sequence || null });
}

function exportReveal(id) {
  return call("POST", "/exports/reveal", { id });
}

// Captions tab review (engine review.py): what to check per line; ▶ plays in Premiere's Program Monitor through the host (0.10.11)
function review(json) {
  return call("POST", "/subtitles/review", { json });
}

// the panel's settings, kept by the engine so a panel update cannot lose them (store.js)
function panelStore() {
  return call("GET", "/panel/store");
}

function panelStorePut(key, value) {
  return call("POST", "/panel/store", { key, value });
}

// Move off faces: faces in frames the panel exported (fractions of the frame; the engine deletes the frames after)
function captionFaces(frames, project, graphics) {
  return call("POST", "/captions/faces", { frames, project, graphics });
}

// 0.10.69: the visible pixels of a still with transparency (the Anchor page's Use alpha)
function anchorAlpha(path, threshold, invert) {
  return call("POST", "/anchor/alpha", { path, threshold, invert: !!invert });
}

// 0.10.66: the subtitles as a transcript (.txt next to the SRT, shown in Finder)
function transcript(json, times) {
  return call("POST", "/subtitles/transcript", { json, times: !!times });
}

function playFrom(start) {
  return call("POST", "/subtitles/play", { start });
}

function playStop(from, until) {
  return call("POST", "/subtitles/play", { stop: true, from, until });
}

function log(level, message) {
  return call("POST", "/log", { level, message }).catch(() => {});
}

module.exports = { anchorAlpha, transcript, status, startSync, startGroups, startAudio, importStatus, importBind, importUnbind, importResult,
  startColor, colorSliders, colorCheck, colorProbe, waitFrame, managedCheck, managedRecord, colorAudit, startShotMatch, shotMatchCheck, subtitlesModel, downloadSubtitleModel, downloadTurbo, downloadTranslator, updateCheck, startUpdate, startSubtitles, startRoughcut, startExportPeaks, exportFrames, colorLearnRecord, colorLearnReport, stashList, stashGet, stashSave, stashDelete, stashClipsBegin, stashClipsExport, addTracks, trackerFrame, startTracking, trackerThumbs, subtitleSettings, saveSubtitleSettings, saveSpeakers, learned, setLearned, captionsState, recordCaptions, placeCaptions, placeGraphics, routeAudio, roughLink, exportSettings, exportsRecent, exportDone, exportReveal, review, panelStore, panelStorePut, captionFaces, playFrom, playStop, devPoll, devResult, job, cancel, stop, log };
