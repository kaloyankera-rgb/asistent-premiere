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

// What to write into Lumetri and what was added. The analysis measures the timeline with any earlier
// Asistent correction included, so its suggestion is a difference: it is added to the current values of
// Asistent's own Lumetri (0 on a new one). `applied` holds only the differences (for the render check).
function mergeValues(current, exposureUnits, sliders) {
  const cur = { exposure: 0, temperature: 0, tint: 0, ...(current || {}) };
  const values = {};
  const applied = {};
  if (exposureUnits) {
    applied.exposure = exposureUnits;
    values.exposure = Math.round((cur.exposure + exposureUnits) * 100) / 100;
  }
  if (sliders) {
    applied.temperature = sliders.temperature;
    applied.tint = sliders.tint;
    values.temperature = Math.round((cur.temperature + sliders.temperature) * 10) / 10;
    values.tint = Math.round((cur.tint + sliders.tint) * 10) / 10;
  }
  return { values, applied };
}

// What the render check accepts as neutral (|cast| per log2 axis). The analysis alone flags a cast from 0.08 / 0.05,
// so a white just corrected by Asistent could be „corrected" back on the next press (fx39024 16:12: residual
// 0.096 → Temperature −4.9 turned into −0.2). On Asistent's own Lumetri a white within these limits is kept.
const WHITE_OK = { temp: 0.1, tint: 0.06 };

function whiteWithinCheck(white) {
  return Math.abs(white.fix_temp || 0) <= WHITE_OK.temp && Math.abs(white.fix_tint || 0) <= WHITE_OK.tint;
}

module.exports = { plansFor, corrections, mergeValues, whiteWithinCheck, WHITE_OK };
