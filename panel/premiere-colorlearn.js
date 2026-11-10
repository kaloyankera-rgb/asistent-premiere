// Colour learning at export in Premiere (TODO EL1, 0.10.36): when an export ends, the exported sequence's picture clips with
// their Lumetri (the five Basic values, whether the Lumetri is still Asistent's own, keyframes, Input LUT / Look) and a
// Lumetri on an adjustment layer above them. Read only: no transaction, nothing written; the engine analyses the files in the
// background and keeps the record (colorlearn.py).
const P = require("./premiere.js");
const PC = require("./premiere-color.js");

const { maybe } = P;
const MAX = 150;

// Input LUT and Look of the clip's Lumetri, as Premiere names them (a file name or a list choice); null when none
async function lutOf(ti) {
  const chain = await maybe(ti, "getComponentChain");
  const n = chain ? await chain.getComponentCount() : 0;
  for (let i = 0; i < n; i++) {
    const comp = await chain.getComponentAtIndex(i);
    if (!/lumetri/i.test((await maybe(comp, "getMatchName")) || "")) continue;
    const out = {};
    for (let j = 0; j < (await comp.getParamCount()); j++) {
      const p = await comp.getParam(j);
      const name = (p && p.displayName) || "";
      if (!/^(input lut|look)$/i.test(name)) continue;
      const v = await maybe(p, "getStartValue");
      const raw = v && v.value !== undefined ? (v.value.value ?? v.value) : v;
      if (raw !== null && raw !== undefined && raw !== "" && raw !== 0) out[name.toLowerCase().replace(" ", "_")] = typeof raw === "object" ? JSON.stringify(raw) : raw;
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

/** -> { sequence, clips: [{path, start, end, lumetri, owned, animated, layer, lut}] } of the open sequence */
async function gather(project) {
  const t = await P.readTimeline(project);
  const pics = t.items.filter((x) => x.kind === "video" && x.path && !x.unused && !x.hidden && !x.adjustment);
  const layers = t.items.filter((x) => x.kind === "video" && x.adjustment && !x.unused && !x.hidden);
  const layerValues = new Map();
  const clips = [];
  for (const x of pics.slice(0, MAX)) {
    const lum = await PC.readLumetri(x).catch(() => null);
    const mid = (x.start + x.end) / 2;
    const over = layers.filter((l) => l.track > x.track && l.start <= mid && l.end >= mid);
    let layer = null;
    for (const l of over) {
      if (!layerValues.has(l)) layerValues.set(l, await PC.readLumetri(l).catch(() => null));
      const lv = layerValues.get(l);
      if (lv && lv.values) {
        layer = layer || { exposure: 0, temperature: 0, tint: 0, contrast: 0, saturation: 0 };
        for (const k of Object.keys(layer)) {
          const v = Number(lv.values[k]);
          if (Number.isFinite(v)) layer[k] += k === "saturation" ? v - 100 : v;             // saturation: its change from 100
        }
      }
    }
    clips.push({ path: x.path, start: x.inPt || 0, end: Number.isFinite(x.outPt) ? x.outPt : null, name: x.name,
      lumetri: lum && lum.values ? lum.values : null, owned: !!(lum && lum.owned), animated: !!(lum && lum.animated && lum.animated.length),
      layer, lut: await lutOf(x.ti).catch(() => null) });
  }
  return { sequence: t.sequence.name, clips, more: Math.max(0, pics.length - MAX) };
}

module.exports = { gather, lutOf };
