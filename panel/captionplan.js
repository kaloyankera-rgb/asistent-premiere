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
  if (!track) return ["Premiere не добави нова писта със субтитри."];
  const out = [];
  if (!captions.length) return out;
  if (track.count !== captions.length) out.push(`на пистата има ${track.count} реда вместо ${captions.length}`);
  const first = captions[0].start;
  const last = captions[captions.length - 1].end;
  if (Math.abs(track.start - first) > TOL) out.push(`първият ред започва в ${track.start.toFixed(2)} s вместо в ${first.toFixed(2)} s`);
  if (Math.abs(track.end - last) > TOL) out.push(`последният ред свършва в ${track.end.toFixed(2)} s вместо в ${last.toFixed(2)} s`);
  return out;
}

function clock(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

/** { status: placed|exists|nohost|error, track?, problems?, message?, srt } -> { ok, text, lines } for the result box */
function describePlacement(p, srt) {
  const file = { cls: "hint", text: `Файл: ${srt}` };
  if (p.status === "placed") {
    const lines = [{ cls: "line", text: `Субтитрите са на пистата C${p.track.index + 1}: ${p.track.count} реда, ${clock(p.track.start)} до ${clock(p.track.end)}.` }];
    for (const x of p.problems || []) lines.push({ cls: "warn", text: `Провери: ${x}.` });
    lines.push({ cls: "hint", text: "Стилът се сменя в Essential Graphics. Файлът е и в бин „Субтитри“." });
    lines.push(file);
    return { ok: !(p.problems || []).length, text: "Субтитрите са на таймлайна.", lines };
  }
  if (p.status === "exists") {
    return { ok: false, text: "Вече има субтитри от Asistent на тази секвенция.", lines: [
      { cls: "warn", text: `На пистата C${p.track.index + 1} са субтитрите от предишното натискане (${p.track.count} реда). Не слагам втори комплект над тях.` },
      { cls: "line", text: "За нови субтитри: изтрий тази писта (десен бутон върху C" + (p.track.index + 1) + " > Delete Track) и натисни бутона пак." },
      { cls: "hint", text: `Новият файл е готов, ако го искаш ръчно: ${srt}` } ] };
  }
  if (p.status === "nohost") {
    return { ok: false, text: "Субтитрите са готови, но не са на таймлайна.", lines: [
      { cls: "warn", text: p.message },
      { cls: "line", text: "Файлът е готов: внеси го в проекта и го довлечи върху секвенцията." }, file ] };
  }
  return { ok: false, text: "Субтитрите са готови, но не успях да ги сложа на таймлайна.", lines: [
    { cls: "warn", text: p.message || "Неизвестна грешка." },
    { cls: "line", text: "Файлът е готов: внеси го в проекта и го довлечи върху секвенцията." }, file ] };
}

module.exports = { findOwn, addedTrack, problems, describePlacement, TOL };
