// „СУБТИТРИ“: reads the selected dialogue from the active sequence (read only) and builds the engine request.
// Nothing is written into the project here; the engine makes the .srt next to the project file (M3). Importing it
// into a bin is M4.
const P = require("./premiere.js");
const engine = require("./engine.js");
const { planDialogue, sizeFrom, dirOf } = require("./subtitleplan.js");

async function frameSize(sequence) {
  const settings = await P.maybe(sequence, "getSettings");
  for (const name of ["getVideoFrameRect", "getVideoFrameSize"]) {
    const size = sizeFrom(await P.maybe(settings, name));
    if (size) return size;
  }
  engine.log("info", "subtitles: sequence frame size not readable, preset falls back to the short one");
  return null;
}

/** -> { payload, plan } or throws P.UserError with what to fix. */
async function readInput(project, terms, speaker = "auto", notes = "") {
  const t = await P.readTimeline(project);
  const plan = planDialogue(t.items);
  if (!plan.selected) throw new P.UserError("Маркирай в таймлайна аудио клиповете с говор.");
  if (!plan.use.length) throw new P.UserError(`Няма подходящ клип за разпознаване. ${plan.skipped.join("; ")}`);
  const folder = dirOf(project.path);
  if (!folder) throw new P.UserError("Запази проекта (Cmd/Ctrl+S): субтитрите се слагат в папката му.");
  const size = await frameSize(t.sequence);
  const payload = {
    items: plan.use, out_dir: folder, name: t.sequence.name || "секвенция", fps: t.fps || 25,
    width: size && size.width, height: size && size.height, preset: "auto", terms: terms || [], skipped: plan.skipped, gender: speaker, text: notes,
  };
  engine.log("info", `subtitles: ${plan.use.length} items (${plan.use.map((x) => `A${x.track + 1} ${x.name}`).join(" | ")}), ` +
    `${plan.skipped.length} skipped, ${t.fps} fps, ${size ? `${size.width}x${size.height}` : "size unknown"}`);
  return { payload, plan };
}

module.exports = { readInput };
