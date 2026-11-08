// Layout of the new "SYNC – …" sequence. Pure logic (no Premiere calls), tested with node.
//
// engine: result of /sync_groups: clips[{ path, name, duration, has_video }],
//         groups[{ anchor, members[{ clip, offset }] }], unsynced[clip index]
// order:  path -> where the clip was in the editor's timeline (groups keep that order)
//
// Every camera (= folder of the file) gets its own track, the same one in every group. Groups and clips
// without a match follow each other with a gap in the order they were recorded (`chronological`).
// Times are where each clip's media starts. No markers are written into the sequence.

const GAP = 2.0;

function folderOf(path) {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : "";
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Groups and single clips in the order they were recorded. The engine gives every clip `rec_time`, the
 * start of its recording on one clock for all cameras (chrono.py), or null. A group starts when its
 * earliest member started (the median over its timed members, so one odd clock cannot move it). An
 * entry without any time keeps its place from the editor's timeline: it follows the entry before it
 * there (deterministic, and listed in `uncertain`). Nothing is pushed to the end for having no partner.
 */
function chronological(engine, when) {
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
  entries.sort((a, b) => (a.sortKey === b.sortKey ? 0 : a.sortKey - b.sortKey) ||
    (a.key === null) - (b.key === null) || a.rank - b.rank);
  const uncertain = [];
  for (const e of entries) {
    const ids = e.members ? e.members.map((m) => m.clip) : [e.clip];
    const name = ids.map((i) => clips[i].name).join(" + ");
    const why = ids.map((i) => clips[i].rec_note).find((x) => x);
    if (e.key === null) uncertain.push({ name, reason: `${why || "no recording time"}: placed by the timeline` });
    else if (!e.members && why) uncertain.push({ name, reason: why });
  }
  return { entries, uncertain };
}

function syncLayout(engine, order) {
  const clips = engine.clips;
  const when = (i) => (order && order[clips[i].path] !== undefined ? order[clips[i].path] : i);
  const { entries, uncertain } = chronological(engine, when);

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

  // the sequence is created from the first clip with picture (its settings, on V1/A1), so that clip's
  // camera gets track 0; the other cameras follow in order of appearance
  const seed = placements.findIndex((p) => clips[p.clip].has_video !== false);
  const cameras = [];
  if (seed >= 0) cameras.push(folderOf(clips[placements[seed].clip].path));
  for (const p of placements) {
    const cam = folderOf(clips[p.clip].path);
    if (!cameras.includes(cam)) cameras.push(cam);
  }
  for (const p of placements) {
    p.track = cameras.indexOf(folderOf(clips[p.clip].path));
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
  return { placements, cameras, seed, uncertain };
}

module.exports = { syncLayout, folderOf, GAP };
