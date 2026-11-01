// Puts the finished SRT on a caption track of the active sequence. Reading the caption tracks is UXP (read only);
// creating the track is the engine's host (host/, ExtendScript), because UXP has no way to do it (probed on Premiere
// 26.0.2). Nothing is removed or muted here: the rule is "never remove track items through UXP".
const ppro = require("premierepro");
const P = require("./premiere.js");
const engine = require("./engine.js");
const plan = require("./captionplan.js");

/** [{index, name, count, start, end}] of every caption track (seconds) */
async function readTracks(sequence) {
  const n = (await P.maybe(sequence, "getCaptionTrackCount")) || 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const tr = await sequence.getCaptionTrack(i);
    const items = (await P.maybe(tr, "getTrackItems", ppro.Constants.TrackItemType.CLIP, false)) || [];
    let start = Infinity;
    let end = 0;
    for (const ti of items) {
      start = Math.min(start, P.secs(await ti.getStartTime()));
      end = Math.max(end, P.secs(await ti.getEndTime()));
    }
    out.push({ index: i, name: tr.name || "", count: items.length, start: items.length ? start : 0, end });
  }
  return out;
}

/** result: the engine's /subtitles result. -> { status, ... } for captionplan.describePlacement */
async function place(project, sequence, result) {
  const name = sequence.name || "";
  const before = await readTracks(sequence);
  const sig = await engine.captionsState(project.path, name);
  const own = plan.findOwn(sig, before);
  if (own) return { status: "exists", track: own };
  let answer;
  try {
    answer = await engine.placeCaptions({ srt: result.srt, sequence: name, project: project.path });
  } catch (e) {
    const message = (e && e.message) || String(e);
    return { status: /не работи/.test(message) ? "nohost" : "error", message };
  }
  if (!answer.ok) return { status: "error", message: answer.msg || "Premiere отказа." };
  const after = await readTracks(sequence);
  const track = plan.addedTrack(before, after);
  const problems = plan.problems(track, result.captions);
  if (track) {
    await engine.recordCaptions(project.path, name, { index: track.index, count: track.count, first: track.start, last: track.end, srt: result.srt });
  }
  engine.log("info", `captions: placed on C${track ? track.index + 1 : "?"}, ${track ? track.count : 0} items, problems: ${problems.join("; ") || "none"}`);
  return track ? { status: "placed", track, problems } : { status: "error", message: problems[0] };
}

module.exports = { readTracks, place };
