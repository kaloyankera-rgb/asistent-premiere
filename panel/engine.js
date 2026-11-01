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

function job(id) {
  return call("GET", `/jobs/${id}`);
}

function cancel(id) {
  return call("POST", `/jobs/${id}/cancel`, {});
}

function log(level, message) {
  return call("POST", "/log", { level, message }).catch(() => {});
}

module.exports = { status, startSync, startGroups, startAudio, importStatus, importBind, importUnbind, importResult,
  job, cancel, log };
