// Where on the timeline a clip can be measured. Pure (no Premiere), so it is tested with node.

// a picture with something on top of the clip (a title, a logo, an adjustment layer) cannot be measured; a clip on a
// hidden track (eye off) or switched off shows nothing and covers nothing. `through`: an adjustment layer that only
// holds a LUT (`seeThrough`, premiere-color.js) is looked through: the frame is the clip as the viewer sees it, and the
// engine keeps it only when it is a log clip's plain conversion (0.10.25, Pulse Fitness: S-Log3 under a LUT layer)
function covered(timeline, clip, t, through = false) {
  return timeline.items.some((x) => x.kind === "video" && !x.hidden && !x.unused && !(through && x.seeThrough) &&
    x.track > clip.track && x.start <= t && x.end > t);
}

// Moments inside the clip to measure: evenly spread, away from the cuts, none covered by an upper layer
function analysisMoments(timeline, clip, n = 4, through = false) {
  const len = clip.end - clip.start;
  const out = [];
  for (let k = 1; k <= n; k++) {
    const t = clip.start + (len * k) / (n + 1);
    if (!covered(timeline, clip, t, through)) out.push(t);
  }
  return out;
}

// Shot Match: which camera a clip comes from. The media folder (as Sync uses it); when every clip sits in one
// folder, the letters before the number in the file name (fx31031 → fx, C0731 → C).
function cameras(clips) {
  const folder = (p) => p.split(/[\\/]/).slice(-2, -1)[0] || "?";
  const prefix = (p) => (p.split(/[\\/]/).pop() || "").replace(/\d.*$/, "") || "?";
  const byFolder = new Set(clips.map((c) => folder(c.path)));
  const key = byFolder.size >= 2 ? folder : prefix;
  return clips.map((c) => key(c.path));
}

// Shot Match moments of one clip: the same real moments as clips of the other cameras when they overlap on the
// timeline (synced POVs), evenly across the clip otherwise. Timeline seconds; `overlap` says which it is.
function shotMoments(clip, others, n = 4) {
  const segs = others
    .map((o) => [Math.max(clip.start, o.start), Math.min(clip.end, o.end)])
    .filter(([a, b]) => b - a > 0.5)
    .sort((x, y) => x[0] - y[0]);
  const total = segs.reduce((t, [a, b]) => t + (b - a), 0);
  if (total >= 1) {
    const out = [];
    for (let k = 1; k <= n; k++) {
      let at = (total * k) / (n + 1);
      for (const [a, b] of segs) {
        if (at <= b - a) { out.push(a + at); break; }
        at -= b - a;
      }
    }
    return { times: out, overlap: true };
  }
  const len = clip.end - clip.start;
  return { times: Array.from({ length: n }, (_, k) => clip.start + (len * (k + 1)) / (n + 1)), overlap: false };
}

module.exports = { covered, analysisMoments, cameras, shotMoments };
