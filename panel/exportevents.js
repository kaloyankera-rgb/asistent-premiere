// Premiere's own export events (0.10.7). The engine finds a finished export by watching folders and reading Premiere's
// preferences, but Premiere writes those preferences when it likes: an export into a new folder was shown up to ~30 s late.
// This Premiere (26.0.2, probed through the bridge 2026-11-08) offers EncoderManager.EVENT_RENDER_COMPLETE / _ERROR /
// _CANCEL and OperationCompleteEvent.EVENT_EXPORT_MEDIA_COMPLETE; whichever fires tells the engine "an export ended now",
// with the file's path when the event carries one. Every event is also written to the engine log, so the payload of a real
// export can be read there.

const MEDIA = /\.(mp4|mov|m4v|mxf|avi|mkv|webm|wav|aif|aiff|mp3|aac|m4a|gif)$/i;

// every readable non-function property of an event, own and inherited (UXP events keep them on the prototype)
function fieldsOf(e) {
  const fields = {};
  for (let q = e; q && q !== Object.prototype; q = Object.getPrototypeOf(q)) {
    for (const k of Object.getOwnPropertyNames(q)) {
      if (k === "constructor" || k in fields) continue;
      try {
        const v = e[k];
        if (typeof v !== "function") fields[k] = typeof v === "object" && v !== null ? String(v) : v;
      } catch (err) {
        fields[k] = `?${err}`;
      }
    }
  }
  return fields;
}

// the exported file's path, if the event names one (any field holding an absolute path to a media file)
function pathIn(fields) {
  for (const v of Object.values(fields || {})) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (MEDIA.test(s) && (s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\"))) return s;
  }
  return null;
}

// Attach to every export event this Premiere offers. onEvent(kind, path|null, name, fields); kind: complete|error|cancel.
// Returns what was attached (for the log). Never throws: without events the folder watching still works.
async function listen(ppro, onEvent, log) {
  const wanted = [
    ["EncoderManager", "EVENT_RENDER_COMPLETE", "complete"],
    ["EncoderManager", "EVENT_RENDER_ERROR", "error"],
    ["EncoderManager", "EVENT_RENDER_CANCEL", "cancel"],
    ["OperationCompleteEvent", "EVENT_EXPORT_MEDIA_COMPLETE", "complete"],
  ];
  const attached = [];
  const em = ppro && ppro.EventManager;
  if (!em || typeof em.addGlobalEventListener !== "function") return attached;
  let manager = null;
  try {
    const cls = ppro.EncoderManager;
    if (cls && typeof cls.getManager === "function") manager = await cls.getManager();
  } catch (e) {
    manager = null;
  }
  for (const [cls, name, kind] of wanted) {
    const value = ppro[cls] && ppro[cls][name];
    if (!value) continue;
    const handler = (e) => {
      let fields = {};
      try {
        fields = fieldsOf(e);
      } catch (err) {
        fields = {};
      }
      try {
        onEvent(kind, pathIn(fields), `${cls}.${name}`, fields);
      } catch (err) {
        if (log) log(`export event handler failed: ${err}`);
      }
    };
    try {
      await em.addGlobalEventListener(value, handler);
      attached.push(`${cls}.${name}`);
    } catch (e) {
      if (log) log(`export event ${cls}.${name}: ${(e && e.message) || e}`);
    }
    if (manager && cls === "EncoderManager" && typeof em.addEventListener === "function") {
      try {
        await em.addEventListener(manager, value, handler);
        attached.push(`${cls}.${name} (manager)`);
      } catch (e) {
        // global is enough
      }
    }
  }
  return attached;
}

module.exports = { listen, pathIn, fieldsOf };
