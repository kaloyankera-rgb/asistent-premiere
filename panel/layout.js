// Layout of the new "SYNC – …" sequence. Pure logic (no Premiere calls), tested with node.
//
// engine: result of /sync_groups: clips[{ path, name, duration, has_video }],
//         groups[{ anchor, members[{ clip, offset }] }], unsynced[clip index]
// order:  path -> where the clip was in the editor's timeline (groups keep that order)
//
// Every camera (= folder of the file) gets its own track, the same one in every group. Groups follow
// each other with a gap; clips without a match come last. Times are where each clip's media starts.

const GAP = 2.0;

function folderOf(path) {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : "";
}

function syncLayout(engine, order) {
  const clips = engine.clips;
  const when = (i) => (order && order[clips[i].path] !== undefined ? order[clips[i].path] : i);

  const groups = engine.groups
    .map((g) => ({ members: g.members.slice(), first: Math.min(...g.members.map((m) => when(m.clip))) }))
    .sort((a, b) => a.first - b.first);

  const placements = [];
  const markers = [];
  let cursor = 0;
  groups.forEach((g, n) => {
    const lead = Math.min(...g.members.map((m) => m.offset));
    let end = cursor;
    // earliest clip first: the very first placement opens the sequence at 0
    g.members.sort((a, b) => a.offset - b.offset);
    for (const m of g.members) {
      const zero = cursor + (m.offset - lead);
      placements.push({ clip: m.clip, zero, group: n + 1 });
      end = Math.max(end, zero + clips[m.clip].duration);
    }
    markers.push({ time: cursor, name: `Група ${n + 1}`,
      note: g.members.map((m) => clips[m.clip].name).join(", ") });
    cursor = end + GAP;
  });
  const lonely = engine.unsynced.slice().sort((a, b) => when(a) - when(b));
  if (lonely.length) markers.push({ time: cursor, name: "Без синхрон", note: lonely.map((i) => clips[i].name).join(", ") });
  for (const i of lonely) {
    placements.push({ clip: i, zero: cursor, group: null });
    cursor += clips[i].duration + GAP;
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
  return { placements, markers, cameras, seed };
}

module.exports = { syncLayout, folderOf, GAP };
