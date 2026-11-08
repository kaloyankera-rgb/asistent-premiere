// node --test tests/routeguard.test.js
// premiere-audio.routeBlockers: a clip whose split copies would replace it without its effects or keyframes is not split
// (0.10.6, BUG-005). Fake Premiere components; what overwriteClip really drops is checked in NEW TEST.
const test = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");

const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "premierepro") return { Constants: {}, AudioFilterFactory: {} };
  if (request === "./engine.js") return { log: () => {} };
  return load.call(this, request, parent, isMain);
};
const PA = require("../panel/premiere-audio.js");
Module._load = load;

const param = (displayName, v, keyed = false) => ({ displayName, getStartValue: async () => ({ value: v }), isTimeVarying: async () => keyed });
const comp = (name, params) => ({ getDisplayName: async () => name, getMatchName: async () => name, getParamCount: async () => params.length, getParam: async (i) => params[i] });
const clip = (...comps) => ({ getComponentChain: async () => ({ getComponentCount: async () => comps.length, getComponentAtIndex: async (i) => comps[i] }) });

test("a plain clip (Volume, Channel Volume, Panner, no keyframes) may be split", async () => {
  const ti = clip(comp("Volume", [param("Bypass", 0), param("Level", 0.1778)]), comp("Channel Volume", [param("Left", 0.1778)]), comp("Panner", [param("Balance", 0)]));
  assert.deepStrictEqual(await PA.routeBlockers(ti), []);
});

test("Volume keyframes, another effect, or a Dynamics with its own settings stop the split", async () => {
  const keyed = clip(comp("Volume", [param("Level", 0.1778, true)]));
  assert.deepStrictEqual(await PA.routeBlockers(keyed), ["Volume keyframes"]);
  const eq = clip(comp("Volume", [param("Level", 0.1778)]), comp("Parametric Equalizer", [param("Gain", 0)]));
  assert.match((await PA.routeBlockers(eq))[0], /effects \(Parametric Equalizer\)/);
  const comp1 = clip(comp("Volume", [param("Level", 0.1778)]), comp("Dynamics", [param("Compressor Enabled", 1), param("Limiter Enabled", 0)]));
  assert.match((await PA.routeBlockers(comp1)).join(), /Dynamics with its own settings/);
  const pan = clip(comp("Volume", [param("Level", 0.1778)]), comp("Panner", [param("Balance", 0, true)]));
  assert.deepStrictEqual(await PA.routeBlockers(pan), ["Panner keyframes"]);
});

test("Asistent's own limiter (-6 dB) does not stop the split: it is set again on the copies", async () => {
  const ti = clip(comp("Volume", [param("Level", 0.1778)]), comp("Dynamics", [param("Limiter Enabled", 1), param("Limiter Threshold", 0.9)]));
  assert.deepStrictEqual(await PA.routeBlockers(ti), []);
});
