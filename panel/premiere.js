// Premiere operations through the official UXP API (require("premierepro")).
// Auto Sync reads the clips selected in the active sequence (read only) and builds a new
// "SYNC – …" sequence from them. Nothing is ever removed: in Premiere 26.0 removing track items
// while CEP panels run ExtendScript can crash Premiere (V8 abort in dvascripting, seen 2026-11-01).
const ppro = require("premierepro");
const { TickTime, Constants } = ppro;
const engine = require("./engine.js");

class UserError extends Error {}

const debug = (msg) => engine.log("info", msg);

async function activeProject() {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new UserError("Няма отворен проект в Premiere.");
  return project;
}

function transaction(project, label, build) {
  let ok = false;
  project.lockedAccess(() => {
    ok = project.executeTransaction((compound) => build(compound), label);
  });
  if (!ok) throw new Error(`Premiere отказа операцията: ${label}`);
}

const ms = (s) => Math.round(s * 1000);
const TICKS_PER_SECOND = 254016000000;

// Premiere 26.0 lacks some methods of later versions: call only what exists
const has = (o, name) => !!o && typeof o[name] === "function";
async function maybe(o, name, ...args) {
  if (!has(o, name)) return undefined;
  try {
    return await o[name](...args);
  } catch (e) {
    return undefined;
  }
}
const secs = (t) => (t && Number.isFinite(t.seconds) ? t.seconds : undefined);

let reported = false;
function reportApi(objects) {
  if (reported) return;
  reported = true;
  const names = (o) => {
    const out = new Set();
    for (let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const n of Object.getOwnPropertyNames(p)) if (n !== "constructor") out.add(n);
    }
    return [...out].sort().join(",");
  };
  for (const [label, o] of Object.entries(objects)) if (o) debug(`api ${label}: ${names(o)}`);
}

async function frameRate(sequence) {
  const settings = await maybe(sequence, "getSettings");
  const rate = await maybe(settings, "getVideoFrameRate");
  if (rate && rate.value > 0) return rate.value;
  const ticks = Number(await maybe(sequence, "getTimebase"));     // ticks per frame
  if (ticks > 0) return TICKS_PER_SECOND / ticks;
  return null;
}

async function readItem(ti, kind, track) {
  const item = { ti, kind, track, start: secs(await ti.getStartTime()), end: secs(await ti.getEndTime()),
    selected: false, path: null, clip: null, projectItem: null, name: "", speed: 1, reversed: false };
  item.inPt = secs(await maybe(ti, "getInPoint")) || 0;
  item.outPt = secs(await maybe(ti, "getOutPoint"));
  item.name = (await maybe(ti, "getName")) || "";
  const raw = await maybe(ti, "getProjectItem");
  const clip = ppro.ClipProjectItem.cast(raw);
  if (clip) {
    const type = await maybe(clip, "getContentType");
    const offline = await maybe(clip, "isOffline");
    if ((type === undefined || type === Constants.ContentType.MEDIA) && !offline) {
      item.path = (await maybe(clip, "getMediaFilePath")) || null;
      item.clip = clip;
      item.projectItem = raw;          // the plain ProjectItem: what the sequence editor expects
    }
    if (!item.name) item.name = clip.name || "";
  }
  const speed = await maybe(ti, "getSpeed");
  if (Number.isFinite(speed)) {
    item.speed = speed;
  } else {
    // no getSpeed: compare the media span with the timeline span
    const out = secs(await maybe(ti, "getOutPoint"));
    if (out !== undefined && item.end > item.start) item.speed = Math.round(((out - item.inPt) / (item.end - item.start)) * 100) / 100;
  }
  item.reversed = !!(await maybe(ti, "isSpeedReversed"));
  return item;
}

async function readItems(sequence) {
  const counts = { video: await sequence.getVideoTrackCount(), audio: await sequence.getAudioTrackCount() };
  const items = [];
  for (const [kind, count, getTrack] of [["video", counts.video, (i) => sequence.getVideoTrack(i)],
    ["audio", counts.audio, (i) => sequence.getAudioTrack(i)]]) {
    for (let t = 0; t < count; t++) {
      const track = await getTrack(t);
      const list = (await track.getTrackItems(Constants.TrackItemType.CLIP, false)) || [];
      for (const ti of list) items.push(await readItem(ti, kind, t));
    }
  }
  return { counts, items };
}

// The selected media clips of the active sequence (read only).
async function readTimeline(project) {
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new UserError("Няма отворена секвенция.");
  const fps = await frameRate(sequence);
  const { counts, items } = await readItems(sequence);

  // which items are selected: the sequence selection (works in every version), matched by place
  const selection = await maybe(sequence, "getSelection");
  const picked = (await maybe(selection, "getTrackItems")) || [];
  const keys = new Set();
  for (const ti of picked) {
    const video = has(ti, "createAddVideoTransitionAction");
    keys.add(`${video ? "video" : "audio"}|${ms(secs(await ti.getStartTime()))}|${ms(secs(await ti.getEndTime()))}`);
  }
  // either way of knowing counts: the selection list, or the clip itself saying it is selected
  for (const it of items) {
    it.selected = keys.has(`${it.kind}|${ms(it.start)}|${ms(it.end)}`) || !!(await maybe(it.ti, "getIsSelected"));
  }
  const sel = items.filter((x) => x.selected);
  debug(`selection: ${picked.length} in the list, ${sel.length} selected parts: ` +
    sel.map((x) => `${x.kind[0].toUpperCase()}${x.track + 1} ${x.name}${x.path ? "" : " (без файл: офлайн/вложена/графика)"}` +
      `${Math.abs(x.speed - 1) >= 0.01 ? " (скорост)" : ""}`).join(" | "));
  reportApi({ project, sequence, trackItem: items[0] && items[0].ti, tickTime: TickTime,
    editor: ppro.SequenceEditor.getEditor(sequence) });

  const clips = {};          // path -> { path, name, clip, start (earliest use on the timeline) }
  const skipped = new Set();
  for (const it of items) {
    if (!it.selected || !it.path) continue;
    if (Math.abs(it.speed - 1) >= 0.01 || it.reversed) {
      skipped.add(`${it.name} (променена скорост)`);
      continue;
    }
    const c = clips[it.path] || (clips[it.path] = { path: it.path, name: it.name, clip: it.clip,
      projectItem: it.projectItem, start: it.start });
    c.start = Math.min(c.start, it.start);
  }
  return { sequence, fps, counts, items, clips: Object.values(clips), skipped: [...skipped] };
}

async function findBin(root, name) {
  for (const item of await root.getItems()) {
    if (item.name !== name || ppro.ClipProjectItem.cast(item)) continue;
    const folder = ppro.FolderItem.cast(item);
    if (folder) return folder;
  }
  return null;
}

async function ensureBin(project, name) {
  const root = await project.getRootItem();
  let bin = await findBin(root, name);
  if (bin) return bin;
  transaction(project, `Asistent: папка ${name}`, (c) => c.addAction(root.createBinAction(name, false)));
  bin = await findBin(root, name);
  if (!bin) throw new Error(`Не успях да създам папка ${name}.`);
  return bin;
}

async function uniqueName(project, base) {
  const taken = new Set(((await maybe(project, "getSequences")) || []).map((s) => s.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`)) return `${base} (${n})`;
}

// the clip's own In point in the project (a source In makes it start later in the media)
async function sourceIn(clip, hasVideo) {
  const t = await maybe(clip, "getInPoint", hasVideo ? Constants.MediaType.VIDEO : Constants.MediaType.AUDIO);
  const s = secs(t);
  return Number.isFinite(s) && s > 0 && s < 1e6 ? s : 0;
}

/**
 * Build "SYNC – <sequence>" from the layout (layout.js). Each placement: { path, name, zero (s, where
 * the clip's media starts), track, hasVideo }. Returns { name, checks, worstMs }.
 */
async function buildSyncSequence(project, timeline, lay) {
  const clipOf = Object.fromEntries(timeline.clips.map((c) => [c.path, c.clip]));
  const itemOf = Object.fromEntries(timeline.clips.map((c) => [c.path, c.projectItem]));
  const missing = [];
  if (!has(project, "createSequenceFromMedia")) missing.push("createSequenceFromMedia");
  const anyEditor = ppro.SequenceEditor.getEditor(timeline.sequence);
  if (!has(anyEditor, "createInsertProjectItemAction")) missing.push("createInsertProjectItemAction");
  if (missing.length) throw new UserError(`Тази версия на Premiere няма ${missing.join(", ")}.`);
  if (lay.seed < 0) throw new UserError("Няма клип с картина, от който да се направи секвенцията.");

  for (const p of lay.placements) {
    p.item = clipOf[p.path];
    p.projectItem = itemOf[p.path] || p.item;
    if (!p.item) throw new Error(`Няма клип в проекта за ${p.name}.`);
    p.srcIn = await sourceIn(p.item, p.hasVideo);
  }
  const bin = await ensureBin(project, "SYNC");
  const name = await uniqueName(project, `SYNC – ${timeline.sequence.name}`);
  const seed = lay.placements[lay.seed];
  const sequence = await project.createSequenceFromMedia(name, [seed.item], bin);
  if (!sequence) throw new Error("Premiere не създаде секвенцията.");
  const fps = (await frameRate(sequence)) || timeline.fps || 30;
  const editor = ppro.SequenceEditor.getEditor(sequence);
  // whole frames in Premiere's own ticks (an in-between time can be refused as an invalid parameter)
  const tpf = Number(await maybe(sequence, "getTimebase"));
  const at = (s) => (tpf > 0
    ? TickTime.createWithTicks((BigInt(Math.round((s * TICKS_PER_SECOND) / tpf)) * BigInt(Math.round(tpf))).toString())
    : TickTime.createWithSeconds(s));

  // the seed opened the sequence at 0; slide it (same track, time only) to where it belongs
  const delta = seed.zero + seed.srcIn;
  if (Math.abs(delta) > 0.5 / fps) {
    const { items } = await readItems(sequence);
    const parts = items.filter((x) => x.path === seed.path);
    const lead = parts.find((x) => x.kind === "video") || parts[0];
    transaction(project, "Asistent: синхрон", (c) => c.addAction(lead.ti.createMoveAction(at(delta))));
    const rest = [];
    for (const x of parts) {
      if (x === lead) continue;
      const now = secs(await x.ti.getStartTime());
      if (Math.abs(now - x.start) < 0.5 / fps) rest.push(x);          // not carried along with the video
    }
    if (rest.length) {
      transaction(project, "Asistent: синхрон (звук)", (c) => {
        for (const x of rest) c.addAction(x.ti.createMoveAction(at(delta)));
      });
    }
    debug(`seed ${seed.name} moved ${delta.toFixed(3)} s, audio parts moved separately: ${rest.length}`);
  }

  // everything else in time order: an insert at the end of a track shifts nothing, and adds a track
  // when the index is past the last one (documented for createInsertProjectItemAction)
  const others = lay.placements.filter((p) => p !== seed).sort((a, b) => a.zero - b.zero);
  // the API of 26.0 is not documented: try the documented insert first, then the alternatives, and
  // remember the first one that works
  const ways = [
    ["insert", (p, t) => editor.createInsertProjectItemAction(p.projectItem, t, p.track, p.track, true)],
    ["overwrite", (p, t) => editor.createOverwriteItemAction(p.projectItem, t, p.track, p.track)],
    ["insert(clip)", (p, t) => editor.createInsertProjectItemAction(p.item, t, p.track, p.track, true)],
    ["overwrite(clip)", (p, t) => editor.createOverwriteItemAction(p.item, t, p.track, p.track)],
  ];
  let way = null;
  // first choice: every clip in ONE transaction, so one Undo removes it all (no markers: layout.js)
  try {
    transaction(project, "Asistent: SYNC", (c) => {
      for (const p of others) c.addAction(ways[0][1](p, at(p.zero + p.srcIn)));
    });
    way = "done";
    debug(`SYNC: ${others.length} clips placed in one transaction`);
  } catch (e) {
    debug(`one-transaction placing failed: ${e && e.message ? e.message : e}`);
    const placed = (await readItems(sequence)).items.filter((x) => x.path && x.path !== seed.path);
    if (placed.length) {
      throw new UserError(`Premiere прие само част от клиповете. ${name} остана непълна: изтрий я. ` +
        "Подробности има в лога на engine-а.");
    }
  }
  for (const p of way === "done" ? [] : others) {
    const time = at(p.zero + p.srcIn);
    const order = way ? [way] : ways;
    let last = null;
    for (const w of order) {
      try {
        transaction(project, `Asistent: ${p.name}`, (c) => c.addAction(w[1](p, time)));
        if (!way) debug(`placing clips works with: ${w[0]}`);
        way = w;
        last = null;
        break;
      } catch (e) {
        last = e;
        debug(`${w[0]} failed for ${p.name} (track ${p.track}): ${e && e.message ? e.message : e}`);
      }
    }
    if (last) {
      throw new UserError(`Premiere не прие ${p.name} (${last.message || last}). ${name} остана непълна: ` +
        "изтрий я. Подробности има в лога на engine-а.");
    }
  }

  // verify: each clip must sit on its track with its media starting where the engine says
  const { items } = await readItems(sequence);
  const tol = 0.5 / fps + 0.002;
  const bad = [];
  let worst = 0;
  for (const p of lay.placements) {
    const kind = p.hasVideo ? "video" : "audio";
    const hit = items.find((x) => x.kind === kind && x.track === p.track && x.path === p.path &&
      Math.abs((x.start - x.inPt) - p.zero) < tol);
    if (!hit) bad.push(p.name);
    else worst = Math.max(worst, Math.abs((hit.start - hit.inPt) - p.zero));
  }
  debug(`verify ${name}: ${lay.placements.length} clips, bad ${JSON.stringify(bad)}, worst ${(worst * 1000).toFixed(2)} ms`);
  await maybe(project, "openSequence", sequence);
  return { name, bad, worstMs: worst * 1000, fps };
}

module.exports = { UserError, activeProject, readTimeline, readItems, buildSyncSequence, transaction, has, maybe,
  secs, debug, ensureBin };
