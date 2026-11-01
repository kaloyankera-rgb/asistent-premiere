// What „Приложи сигурните“ and „Приложи и средните“ apply. Pure (no Premiere), so it is tested with node.
// Counted per correction, not per clip: a clip with a high white balance and a medium exposure needs both
// buttons (fx39024, 2026-11-01: counting clips hid „Приложи и средните“ and the exposure could not be applied).

const ok = (level, c) => c === "high" || (level === "all" && c === "medium");

function plansFor(clips, results, level) {
  const plans = [];
  clips.forEach((clip, i) => {
    const r = results[i];
    if (!r || r.error) return;
    // Lumetri units for the wanted stops (engine: the probe's Exposure curve); older engines send stops only
    const units = r.exposure.units ?? r.exposure.stops;
    const exposure = r.exposure.stops && ok(level, r.exposure.confidence) ? units : null;
    const wb = !r.white.balanced && ok(level, r.white.confidence);
    const left = [];
    if (level === "sure" && r.exposure.stops && r.exposure.confidence === "medium") left.push("експозицията");
    if (level === "sure" && !r.white.balanced && r.white.confidence === "medium") left.push("бялото");
    if (exposure || wb) plans.push({ clip, res: r, exposure, wb, left });
  });
  return plans;
}

// how many single corrections (exposure or white, per clip) a level applies
function corrections(plans) {
  return plans.reduce((n, p) => n + (p.exposure ? 1 : 0) + (p.wb ? 1 : 0), 0);
}

module.exports = { plansFor, corrections };
