// The panel's settings, kept by the engine in its app folder (engine panelstore.py) so a panel update cannot lose them: UXP
// localStorage goes with the installed panel, and every update removes the old one (found 2026-11-09). Reads are synchronous
// from memory (loaded once at start); writes go to the engine in order, and to localStorage as a fallback. On the first start
// with this module, what localStorage still holds is copied to the engine.
let engine = null;
let storage = null;
const mem = new Map();
let queue = Promise.resolve();

function local() {
  if (storage) return storage;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (e) {
    return null;
  }
}

function use(eng, st) {                 // tests: a fake engine and storage
  engine = eng;
  storage = st || null;
}

async function load() {
  if (!engine) engine = require("./engine.js");
  try {
    const r = await engine.panelStore();
    for (const [k, v] of Object.entries((r && r.values) || {})) mem.set(k, v);
  } catch (e) {
    return false;                       // engine offline: localStorage below still answers
  }
  const ls = local();
  try {
    for (let i = 0; ls && i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith("asistent.") && !mem.has(k)) setItem(k, ls.getItem(k));
    }
  } catch (e) {
    /* no storage to copy from */
  }
  return true;
}

function getItem(key) {
  if (mem.has(key)) return mem.get(key);
  try {
    const ls = local();
    return ls ? ls.getItem(key) : null;
  } catch (e) {
    return null;
  }
}

function setItem(key, value) {
  const v = String(value);
  mem.set(key, v);
  try {
    const ls = local();
    if (ls) ls.setItem(key, v);
  } catch (e) {
    /* the engine copy is the one that lasts */
  }
  if (!engine) engine = require("./engine.js");
  queue = queue.then(() => engine.panelStorePut(key, v)).catch(() => {});
  return queue;
}

module.exports = { use, load, getItem, setItem };
