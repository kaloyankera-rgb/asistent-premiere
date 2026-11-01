// Where on the timeline a clip can be measured. Pure (no Premiere), so it is tested with node.

// a picture with something on top of the clip (a title, a logo, an adjustment layer) cannot be measured
function covered(timeline, clip, t) {
  return timeline.items.some((x) => x.kind === "video" && x.track > clip.track && x.start <= t && x.end > t);
}

// Moments inside the clip to measure: evenly spread, away from the cuts, none covered by an upper layer
function analysisMoments(timeline, clip, n = 4) {
  const len = clip.end - clip.start;
  const out = [];
  for (let k = 1; k <= n; k++) {
    const t = clip.start + (len * k) / (n + 1);
    if (!covered(timeline, clip, t)) out.push(t);
  }
  return out;
}

module.exports = { covered, analysisMoments };
