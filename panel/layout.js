// Layout of the new "SYNC – …" sequence. Pure logic (no Premiere calls), tested with node.
//
// engine: result of /sync_groups: clips[{ path, name, duration, has_video }],
//         groups[{ anchor, members[{ clip, offset }] }], unsynced[clip index]
// order:  path -> where the clip was in the editor's timeline (groups keep that order)
//
// meta:   { tracks: path -> the lowest video track the file sits on in the editor's timeline } (optional)
//
// Every camera (= folder of the file) gets its own track, the same one in every group. The main POV's clips make
// the order (0.10.154, `mainCamera`, `chronological`): they follow each other by file number on V1, each synced
// partner sits against its main clip, and what has no main clip goes where it was recorded. No gap (0.10.38).
// Times are where each clip's media starts. No markers are written into the sequence.

// 0.10.38 (the user: "a small gap between the clips which we don't have in the original timeline"): no gap, entries follow
// each other directly in recording order
const GAP = 0;

function folderOf(path) {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : "";
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// 0.10.154 (the user, 2026-11-23: "prioritize to order the clips in the timeline by the main POV which is usually on V1 and
// on V2 is the second POV and when it's organized then you sync to that the 2nd POV", "some clips are at the back because
// the 2nd POV's files are prioritized"). The main POV is the camera on the lowest video track of the editor's timeline; when
// several cameras share that track (everything laid on V1), the one with the most clips there, then the most footage, then
// the one that comes first.
function mainCamera(clips, cameraOf, when, tracks) {
  const stats = new Map();
  clips.forEach((c, i) => {
    if (c.has_video === false) return;
    const cam = cameraOf(i);
    const s = stats.get(cam) || { cam, track: Infinity, onTrack: 0, n: 0, secs: 0, first: Infinity };
    const t = tracks && Number.isInteger(tracks[c.path]) ? tracks[c.path] : 0;
    if (t < s.track) { s.track = t; s.onTrack = 0; }
    if (t === s.track) s.onTrack += 1;
    s.n += 1;
    s.secs += c.duration || 0;
    s.first = Math.min(s.first, when(i));
    stats.set(cam, s);
  });
  const ranked = [...stats.values()].sort((a, b) => a.track - b.track || b.onTrack - a.onTrack || b.secs - a.secs || a.first - b.first);
  return ranked.length ? ranked[0].cam : null;
}

/**
 * The order of the SYNC sequence: groups and single clips. The entries holding a clip of the main POV are the spine, in the
 * main POV's file-number order (`byFileNumber` with only that camera's numbers; the clock where the numbers say nothing).
 * Every other entry (a second-POV clip with no main partner, a group without the main POV) is slotted into the spine: between
 * the spine entries its own camera's file numbers put it between, and inside that stretch by the time it was recorded (the
 * engine gives every clip `rec_time`, the start of its recording on one clock for all cameras, chrono.py, or null). Its own
 * numbers never move a main clip: where they contradict the spine, the clock places it and it is listed in `uncertain`.
 * An entry without any time keeps its place from the editor's timeline: it follows the entry before it there.
 */
function chronological(engine, when, main, cameraOf) {
  const clips = engine.clips;
  const entries = engine.groups.map((g) => {
    const lead = Math.min(...g.members.map((m) => m.offset));
    const starts = g.members.filter((m) => Number.isFinite(clips[m.clip].rec_time))
      .map((m) => clips[m.clip].rec_time - (m.offset - lead));
    return { members: g.members.slice(), key: starts.length ? median(starts) : null,
      tl: Math.min(...g.members.map((m) => when(m.clip))) };
  });
  for (const i of engine.unsynced) {
    const t = clips[i].rec_time;
    entries.push({ members: null, clip: i, key: Number.isFinite(t) ? t : null, tl: when(i) });
  }
  const byTimeline = entries.slice().sort((a, b) => a.tl - b.tl);
  let last = -Infinity;
  byTimeline.forEach((e, k) => {
    if (e.key !== null) last = e.key;
    e.sortKey = e.key !== null ? e.key : last;
    e.rank = k;
  });
  const byClock = (a, b) => (a.sortKey === b.sortKey ? 0 : a.sortKey - b.sortKey) ||
    (a.key === null) - (b.key === null) || a.rank - b.rank;
  const idsOf = (e) => (e.members ? e.members.map((m) => m.clip) : [e.clip]);
  const isMain = (i) => main !== null && cameraOf(i) === main;
  const spineOf = entries.filter((e) => idsOf(e).some(isMain));
  const others = entries.filter((e) => !spineOf.includes(e));

  const spine = byFileNumber(spineOf, clips, byClock, isMain);
  const clashes = new Set(spine.clashes);
  const named = new Set(spine.named);

  // where each other entry goes: slot k = just before spine entry k (spine.length = after the last one)
  const numbers = {};                         // file-number camera -> [{ n, at: index in the spine }]
  spine.ordered.forEach((e, at) => {
    for (const i of idsOf(e)) {
      const f = fileNumber(clips[i]);
      if (f) (numbers[f.camera] = numbers[f.camera] || []).push({ n: f.n, at });
    }
  });
  const slots = spine.ordered.map(() => []).concat([[]]);
  for (const e of others) {
    let lo = 0;
    let hi = spine.ordered.length;
    let bound = false;
    for (const i of idsOf(e)) {
      const f = fileNumber(clips[i]);
      for (const x of (f && numbers[f.camera]) || []) {
        bound = true;
        if (x.n < f.n) lo = Math.max(lo, x.at + 1);
        if (x.n > f.n) hi = Math.min(hi, x.at);
      }
    }
    if (bound) named.add(e);
    const clash = lo > hi;
    if (clash) { clashes.add(e); lo = 0; hi = spine.ordered.length; }
    let slot = lo;
    // inside the stretch its numbers allow: after every spine entry that comes before it by the clock (or the timeline)
    for (let k = lo; k < hi; k += 1) if (byClock(spine.ordered[k], e) <= 0) slot = k + 1;
    slots[slot].push(e);
  }
  const ordered = [];
  slots.forEach((list, k) => {
    if (list.length) {
      const inner = byFileNumber(list, clips, byClock);
      ordered.push(...inner.ordered);
      for (const e of inner.clashes) clashes.add(e);
    }
    if (k < spine.ordered.length) ordered.push(spine.ordered[k]);
  });

  const uncertain = [];
  for (const e of ordered) {
    const ids = idsOf(e);
    const name = ids.map((i) => clips[i].name).join(" + ");
    const why = ids.map((i) => clips[i].rec_note).find((x) => x);
    if (clashes.has(e)) uncertain.push({ name, reason: "the file numbers and the sync disagree: placed by the camera clock" });
    else if (e.key === null) uncertain.push({ name, reason: `${why || "no recording time"}: placed by ${named.has(e) ? "its file number" : "the timeline"}` });
    else if (!e.members && why) uncertain.push({ name, reason: why });
  }
  return { entries: ordered, uncertain };
}

// 2026-11-23 (the user, MASTERHAUS КП-4 Видео 4, two FX30s: "it needs to sort it on the timeline by the names so 661 is first,
// 662 and so on", "synced with each POV in order"): a camera numbers its files in the order it recorded them, which is surer
// than any clock (the learnt clock put fx30668/669 before fx30661). So within one camera the file numbers decide, synced
// partners stay together, and the clocks only decide how the cameras' clips interleave where the numbers say nothing.
// A camera is the file's folder plus the name before its last number ("fx30-3-2032" -> "fx30-3-", "fx30661" -> "fx"), so two
// cameras sharing one folder keep their own counters.
function fileNumber(clip) {
  const stem = clip.name.replace(/\.[^.]*$/, "");
  const m = /^(.*?)(\d+)$/.exec(stem);
  return m ? { camera: `${folderOf(clip.path)}|${m[1].toLowerCase()}`, n: Number(m[2]) } : null;
}

/**
 * Entries in file-number order per camera (a topological order: an entry comes after every entry holding an earlier file of
 * any of its cameras). Among entries free to go next, the clock order (`byClock`) picks. When the numbers contradict the sync
 * (a loop: a group holds 661 and 2033 while another holds 662 and 2032), the clock breaks the loop and that entry is reported.
 * `counts(clip index)`: whose numbers count (all when absent).
 */
function byFileNumber(entries, clips, byClock, counts) {
  const after = new Map(entries.map((e) => [e, new Set()]));     // e -> entries that must come after e
  const need = new Map(entries.map((e) => [e, 0]));
  const named = new Set();
  const perCamera = {};
  for (const e of entries) {
    for (const i of e.members ? e.members.map((m) => m.clip) : [e.clip]) {
      if (counts && !counts(i)) continue;          // the spine: only the main POV's numbers decide
      const f = fileNumber(clips[i]);
      if (f) (perCamera[f.camera] = perCamera[f.camera] || []).push({ n: f.n, e });
    }
  }
  for (const list of Object.values(perCamera)) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.n - b.n);
    for (let k = 1; k < list.length; k += 1) {
      const a = list[k - 1].e;
      const b = list[k].e;
      named.add(a); named.add(b);
      if (a !== b && !after.get(a).has(b)) { after.get(a).add(b); need.set(b, need.get(b) + 1); }
    }
  }
  const ordered = [];
  const clashes = new Set();
  const left = new Set(entries);
  while (left.size) {
    let pool = [...left].filter((e) => need.get(e) === 0);
    if (!pool.length) { pool = [...left]; }
    const next = pool.sort(byClock)[0];
    if (need.get(next) > 0) clashes.add(next);
    left.delete(next);
    ordered.push(next);
    for (const b of after.get(next)) need.set(b, need.get(b) - 1);
  }
  return { ordered, clashes, named };
}

function syncLayout(engine, order, meta) {
  const clips = engine.clips;
  const when = (i) => (order && order[clips[i].path] !== undefined ? order[clips[i].path] : i);
  // 0.10.149: the engine names each clip's camera (a folder, or a folder + file prefix when two cameras share one folder,
  // groups._cameras); with an older engine the folder is the camera, as before
  const cameraOf = (i) => clips[i].camera || folderOf(clips[i].path);
  const main = mainCamera(clips, cameraOf, when, meta && meta.tracks);
  const { entries, uncertain } = chronological(engine, when, main, cameraOf);

  // No markers: the offsets alone place the clips, and the group list is shown in the panel, so the new
  // sequence stays clean (the user asked for no Asistent markers on the timeline, 2026-11-03).
  const placements = [];
  let cursor = 0;
  let n = 0;
  for (const e of entries) {
    if (!e.members) {
      placements.push({ clip: e.clip, zero: cursor, group: null });
      cursor += clips[e.clip].duration + GAP;
      continue;
    }
    n += 1;
    const lead = Math.min(...e.members.map((m) => m.offset));
    let end = cursor;
    // earliest clip first: the very first placement opens the sequence at 0
    e.members.sort((a, b) => a.offset - b.offset);
    for (const m of e.members) {
      const zero = cursor + (m.offset - lead);
      placements.push({ clip: m.clip, zero, group: n });
      end = Math.max(end, zero + clips[m.clip].duration);
    }
    cursor = end + GAP;
  }

  // the sequence is created from one clip with picture (its settings, on V1/A1): the first clip of the main POV, so the
  // main POV has track 0 (V1); the other cameras follow in order of appearance
  let seed = placements.findIndex((p) => clips[p.clip].has_video !== false && cameraOf(p.clip) === main);
  if (seed < 0) seed = placements.findIndex((p) => clips[p.clip].has_video !== false);
  const cameras = [];
  if (seed >= 0) cameras.push(cameraOf(placements[seed].clip));
  for (const p of placements) {
    const cam = cameraOf(p.clip);
    if (!cameras.includes(cam)) cameras.push(cam);
  }
  for (const p of placements) {
    p.track = cameras.indexOf(cameraOf(p.clip));
    p.path = clips[p.clip].path;
    p.name = clips[p.clip].name;
    p.hasVideo = clips[p.clip].has_video !== false;
    p.duration = clips[p.clip].duration;
  }
  // 0.10.6 (BUG-011): the engine may sync two cameras whose files share one folder (a single-folder selection compares every
  // pair), but by folder both got the same track and lay on top of each other. A clip that would overlap another on its
  // track moves to the next track where it fits; "one folder = one camera" stays the rule whenever it works.
  const busy = {};
  const fits = (t, p) => !(busy[t] || []).some(([a, b]) => Math.min(b, p.zero + p.duration) - Math.max(a, p.zero) > 1e-6);
  const seedFirst = seed >= 0 ? [placements[seed], ...placements.filter((_, i) => i !== seed)] : placements;   // the seed keeps V1
  for (const p of seedFirst) {
    let t = p.track;
    if (p !== placements[seed]) while (!fits(t, p)) t += 1;
    if (t !== p.track) uncertain.push({ name: p.name, reason: `shares a folder with another camera: put on track ${t + 1}` });
    p.track = t;
    (busy[t] = busy[t] || []).push([p.zero, p.zero + p.duration]);
  }
  // 0.10.45 (the user: after Fix audio "A1 A2 for POV 1 and A3 A4 for POV 2"): with two or more tracks every camera's sound
  // goes on every other audio track (A1, A3, A5…), so Fix audio's second side of each camera lands right under it
  const spaced = new Set(placements.map((p) => p.track)).size > 1;
  for (const p of placements) p.audioTrack = spaced ? 2 * p.track : p.track;
  return { placements, cameras, seed, uncertain, main };
}

module.exports = { syncLayout, mainCamera, folderOf, GAP };
