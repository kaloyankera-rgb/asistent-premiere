// HTTP client for the local Asistent engine (127.0.0.1 only).
const BASE = "http://127.0.0.1:47390";

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "X-Asistent": "1", "Content-Type": "application/json" },
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

function startSubtitles(payload) {
  return call("POST", "/subtitles", payload);
}

function job(id) {
  return call("GET", `/jobs/${id}`);
}

function cancel(id) {
  return call("POST", `/jobs/${id}/cancel`, {});
}

// test bridge (devbridge.js): 404 while the engine's flag file is missing
function devPoll(wait) {
  return call("GET", `/dev/poll?wait=${wait}`);
}

function devResult(id, ok, data) {
  return call("POST", "/dev/result", { id, ok, data });
}

function log(level, message) {
  return call("POST", "/log", { level, message }).catch(() => {});
}

module.exports = { status, startSync, startGroups, startAudio, importStatus, importBind, importUnbind, importResult,
  startColor, colorSliders, colorCheck, colorProbe, waitFrame, managedCheck, managedRecord, colorAudit, startShotMatch, shotMatchCheck, subtitlesModel, downloadSubtitleModel, startSubtitles, devPoll, devResult, job, cancel, log };
