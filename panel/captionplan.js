// Pure logic of putting the SRT on a caption track (no Premiere here, so node can test it): is a caption track the one
// Asistent placed earlier, which track did a placement add, did the track really receive the captions at the right
// times, and what the panel tells the editor. Asistent never removes or mutes a track, so an own track from an earlier
// press is reported, not replaced.

const TOL = 0.12;     // seconds: Premiere snaps caption times to its own grid

/** tracks: [{index, count, start, end}] read from the sequence; sig: what the engine remembered. -> the track or null */
function findOwn(sig, tracks) {
  if (!sig || !Number.isInteger(sig.index)) return null;
  const t = tracks.find((x) => x.index === sig.index);
  if (!t || t.count !== sig.count) return null;
  if (Math.abs(t.start - sig.first) > TOL || Math.abs(t.end - sig.last) > TOL) return null;
  return t;
}

/** The one track that is in `after` and not in `before`, or null (nothing added, or more than one). */
function addedTrack(before, after) {
  const known = new Set(before.map((t) => t.index));
  const added = after.filter((t) => !known.has(t.index));
  return added.length === 1 ? added[0] : null;
}

/** Did the new track receive the captions of the SRT, at their times? -> list of problems (empty = verified) */
function problems(track, captions) {
  if (!track) return ["Premiere did not add a new subtitle track."];
  const out = [];
  if (!captions.length) return out;
  if (track.count !== captions.length) out.push(`the track has ${track.count} lines instead of ${captions.length}`);
  const first = captions[0].start;
  const last = captions[captions.length - 1].end;
  if (Math.abs(track.start - first) > TOL) out.push(`the first line starts at ${track.start.toFixed(2)} s instead of ${first.toFixed(2)} s`);
  if (Math.abs(track.end - last) > TOL) out.push(`the last line ends at ${track.end.toFixed(2)} s instead of ${last.toFixed(2)} s`);
  return out;
}

// a track's name on the timeline: V3 for the graphics' video track, C2 for a caption track
const label = (t) => t.label || `C${t.index + 1}`;

function clock(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

/** { status: placed|exists|nohost|error, track?, problems?, message?, srt } -> { ok, text, lines } for the result box */
function describePlacement(p, srt, again) {
  const file = { cls: "hint", text: `File: ${srt}` };
  if (p.status === "placed") {
    const lines = [{ cls: "line", text: `The subtitles are ${p.graphics ? "text graphics" : "captions"} on track ${label(p.track)}: ${p.track.count} lines, ${clock(p.track.start)} to ${clock(p.track.end)}.` }];
    if (p.english) lines.push({ cls: "line", text: `The English line is on track ${label(p.english)}: ${p.english.count} lines at the same times.` });
    for (const x of p.problems || []) lines.push({ cls: "warn", text: `Check: ${x}.` });
    if (p.replaces) lines.push({ cls: "warn", text: `The earlier subtitles are still on track ${label(p.replaces)}: delete that track (right-click ${label(p.replaces)} > Delete Track), or the two sets show on top of each other.` });
    lines.push({ cls: "hint", text: p.graphics ? "Retype, move or restyle any line in Essential Graphics. Undo: delete the track (each line was its own step)."
      : "To restyle all of them: select every caption on the track and change font, size, outline or shadow in the Properties panel; " +
        "save it as a Track Style to reuse it. The file is also in the bin \"Subtitles\"." });
    lines.push(file);
    return { ok: !(p.problems || []).length, text: "The subtitles are on the timeline.", lines };
  }
  if (p.status === "exists") {
    return { ok: false, text: "This sequence already has subtitles from Asistent.", lines: [
      { cls: "warn", text: `Track ${label(p.track)} holds the subtitles from the previous press (${p.track.count} lines). Not putting a second set over them.` },
      { cls: "line", text: `For new subtitles: delete that track (right-click ${label(p.track)} > Delete Track) and press the button again.` },
      { cls: "hint", text: `The new file is ready if you want it by hand: ${srt}` } ] };
  }
  if (p.status === "nohost") {
    return { ok: false, text: "The subtitles are ready, but not on the timeline.", lines: [
      { cls: "warn", text: p.message },
      { cls: "line", text: "The file is ready: import it into the project and drag it onto the sequence." }, file ] };
  }
  return { ok: false, text: "The subtitles are ready, but I could not put them on the timeline.", lines: [
    { cls: "warn", text: p.message || "Unknown error." },
    { cls: "line", text: "The file is ready: import it into the project and drag it onto the sequence." }, file ] };
}

module.exports = { findOwn, addedTrack, problems, describePlacement, TOL };
