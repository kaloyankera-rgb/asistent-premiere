// Smart Audio Assistant in Premiere: the clips' levels, and what the selection is. The channels (L/L, R/R) are set by
// the host through each side's own Audio Channels (host.jsx as_audio_route), never by the Fill effects any more
// (user, 2026-11-03); this module only recognises a Fill effect that is already on a clip (earlier versions, or by
// hand) so such a clip keeps its routing and only gets its level. Nothing is removed and the media is never changed.
//
// The levels of one press are one transaction, so one Undo step. The splitting is done by ExtendScript, where
// every overwrite and link is its own step in Premiere's history.
const ppro = require("premierepro");
const { TickTime } = ppro;
const P = require("./premiere.js");
const { routeOf } = require("./channels.js");
const { sideOf, limiterState, dynValue, LIMITER_DB } = require("./audioplan.js");

const { transaction, maybe, debug } = P;

async function components(ti) {
  const chain = await maybe(ti, "getComponentChain");
  const list = [];
  const count = chain ? (await chain.getComponentCount()) : 0;
  for (let i = 0; i < count; i++) {
    const comp = await chain.getComponentAtIndex(i);
    list.push({ comp, name: (await maybe(comp, "getDisplayName")) || "", match: (await maybe(comp, "getMatchName")) || "" });
  }
  return { chain, list };
}

async function currentRoute(ti) {
  return routeOf((await components(ti)).list.map((c) => c.name));
}

// Volume > Level is always in Premiere's own scale on 26.0.2 (0.1778 = 0 dB, 1.0 = +15 dB, verified).
// The unit used to be guessed from the current value, which read a clip already at +15 dB (exactly 1.0)
// as plain linear and asked for the wrong value: never guess.
function levelValue(db) {
  return Math.pow(10, (db - 15) / 20);
}

async function levelParam(ti, label) {
  const { list } = await components(ti);
  const vol = list.find((c) => /^volume$/i.test(c.name) || /volume/i.test(c.match));
  if (!vol) throw new Error(`Няма Volume на ${label}.`);
  let param = null;
  for (let i = 0; i < (await vol.comp.getParamCount()); i++) {
    const p = await vol.comp.getParam(i);
    if (/level/i.test(p.displayName || "")) param = p;
  }
  if (!param) throw new Error(`Няма Level във Volume на ${label}.`);
  const start = await param.getStartValue();
  const v0 = Number(start && start.value !== undefined ? (start.value.value ?? start.value) : NaN);
  return { param, keyframed: !!(await maybe(param, "isTimeVarying")), toValue: levelValue, scale: "premiere", v0 };
}

async function readLevel(param) {
  const v = await param.getStartValue();
  return Number(v && v.value !== undefined ? (v.value.value ?? v.value) : NaN);
}

// Audio clips selected in the active sequence, with the part of the media they use. A selected video clip brings its
// own audio (same file, same place), so the button also works with linked selection off.
async function readAudioSelection(project) {
  const t = await P.readTimeline(project);
  const picked = t.items.filter((x) => x.selected && x.kind === "audio" && x.path);
  const near = (a, b) => Math.abs(a - b) < 0.002;
  for (const v of t.items.filter((x) => x.selected && x.kind === "video" && x.path)) {
    for (const a of t.items) {
      if (a.kind === "audio" && a.path === v.path && near(a.start, v.start) && near(a.end, v.end) && !picked.includes(a)) picked.push(a);
    }
  }
  const skipped = [];
  const items = [];
  for (const x of picked) {
    if (Math.abs(x.speed - 1) >= 0.01 || x.reversed) {
      skipped.push(`${x.name} (променена скорост)`);
      continue;
    }
    items.push({ ...x, route: await currentRoute(x.ti), side: sideOf(x.name) });
  }
  items.sort((a, b) => a.start - b.start || a.track - b.track);
  return { timeline: t, items, skipped };
}

// The Volume level as actions: one static value, or (phrase leveling) keyframes at media times.
// Premiere's clip Volume goes up to +15 dB (1.0 in its own scale); more is clamped, so ask for at most that
const LEVEL_MAX_DB = 15;

function levelActions(lv, o, who, inPt) {
  const actions = [];
  const checks = [];
  const lines = [];
  if (o.gain_db > LEVEL_MAX_DB) {
    lines.push(`${who}: трябваха +${o.gain_db} dB, но Volume на клип в Premiere стига до +${LEVEL_MAX_DB} dB: сложени са +${LEVEL_MAX_DB}`);
    o = { ...o, result_lufs: Math.round((o.result_lufs - (o.gain_db - LEVEL_MAX_DB)) * 10) / 10,
      result_peak_db: Math.round((o.result_peak_db - (o.gain_db - LEVEL_MAX_DB)) * 10) / 10, gain_db: LEVEL_MAX_DB,
      keyframes: (o.keyframes || []).map(([t, g]) => [t, Math.min(g, LEVEL_MAX_DB)]) };
  }
  lines.unshift(levelLine(who, o));
  const keys = o.keyframes || [];
  if (keys.length) {
    actions.push(() => lv.param.createSetTimeVaryingAction(true));
    for (const [t, g] of keys) {
      actions.push(() => {
        const kf = lv.param.createKeyframe(lv.toValue(g));
        kf.position = TickTime.createWithSeconds(t);
        return lv.param.createAddKeyframeAction(kf);
      });
    }
    checks.push(async () => {
      const got = (await lv.param.getKeyframeListAsTickTimes()) || [];
      debug(`keyframes ${who}: asked ${keys.length} at ${keys.slice(0, 3).map((k) => k[0]).join(", ")}… ` +
        `(clip In ${inPt.toFixed(3)} s), got ${got.length} at ${got.slice(0, 3).map((t) => (t.seconds || 0).toFixed(3)).join(", ")}…`);
      return got.length >= keys.length ? null : `ключовите кадри на ${who} не се записаха`;
    });
    lines.push(`${who}: изравнени ${o.phrases_moved} фрази (разликата беше ${o.spread_db} dB), ${keys.length} ключови кадъра`);
    if (inPt > 0.01) lines.push(`${who}: клипът е подрязан: провери, че ключовите кадри са в паузите`);
  } else {
    const value = lv.toValue(o.gain_db);
    actions.push(() => lv.param.createSetValueAction(lv.param.createKeyframe(value), true));
    checks.push(async () => (Math.abs((await readLevel(lv.param)) - value) < 1e-3 * Math.max(1, Math.abs(value))
      ? null : `силата на ${who} не се записа`));
    if (o.note) lines.push(`${who}: ${o.note}`);
  }
  return { actions, checks, lines };
}

function levelLine(who, o) {
  return `${who}: ${o.gain_db >= 0 ? "+" : ""}${o.gain_db} dB → ${o.result_lufs} LUFS, пик ${o.result_peak_db} dB` +
    (o.limited_by_peak ? " (спряно от границата −6 dB)" : "");
}

/**
 * Levels for the clips as they are on the timeline now (after the host routed): targets from
 * audioplan.levelTargets ({plan, track, start, out, who}). Everything in one transaction (one Undo step), then
 * checked. Problems go into plan.problems, lines into plan.lines.
 */
async function applyLevels(project, sequence, targets) {
  const items = (await P.readItems(sequence)).items;
  const actions = [];
  const checks = [];
  const limit = [];                                // clips whose Dynamics needs the limiter: { ti, p, who, state }
  for (const t of targets) {
    const ti = items.find((x) => x.kind === "audio" && x.track === t.track && Math.abs(x.start - t.start) < 0.002);
    const p = t.plan;
    if (!ti) {
      p.problems.push(`${t.who}: клипът не е намерен за силата`);
      continue;
    }
    try {
      if (t.noLimiter) throw Object.assign(new Error("skip"), { skip: true });
      // the limiter (Dynamics > Limiter -6 dB): appended in the same step as the levels, switched on in the next
      // (a new effect has no parameters before it is applied); an existing Dynamics is reused, never doubled
      const dyn = await dynamicsOf(ti.ti);
      const lim = limiterState(dyn.map((d) => ({ params: d.values })));
      if (lim.state === "add") {
        const comp = await createEffect("Dynamics", ti.ti);
        const { chain } = await components(ti.ti);
        actions.push(() => chain.createAppendComponentAction(comp));
        limit.push({ ti, p, who: t.who, state: "added" });
      } else if (lim.state === "configure") {
        limit.push({ ti, p, who: t.who, state: "configured" });
      } else if (lim.state === "ok") {
        p.lines.push(`${t.who}: лимитерът е вече на ${LIMITER_DB} dB.`);
      } else {
        p.lines.push(`${t.who}: лимитерът не е пипан: ${lim.why}.`);
      }
    } catch (e) {
      if (!e.skip) p.problems.push(`${t.who}: лимитер: ${e.message || e}`);
    }
    if (t.out.lufs === null) {
      p.lines.push(`${t.who}: ${t.out.note}`);
      continue;
    }
    try {
      const lv = await levelParam(ti.ti, t.who);
      if (lv.keyframed) {
        p.lines.push(`${t.who}: вече има ключови кадри на силата: не е пипано (Cmd/Ctrl+Z и пусни пак)`);
        continue;
      }
      const l = levelActions(lv, t.out, t.who, ti.inPt || 0);
      actions.push(...l.actions);
      checks.push(...l.checks.map((c) => ({ c, p })));
      p.lines.push(...l.lines);
      debug(`level ${t.who}: was ${lv.v0}, ${t.out.gain_db} dB, keyframes ${(t.out.keyframes || []).length}`);
    } catch (e) {
      p.problems.push(e.message || String(e));
    }
  }
  if (actions.length) {
    transaction(project, "Asistent: сила на звука", (c) => {
      for (const make of actions) c.addAction(make());
    });
  }
  for (const { c, p } of checks) {
    const bad = await c();
    if (bad) p.problems.push(bad);
  }
  const switched = await switchLimiterOn(project, limit);
  return { undoSteps: (actions.length ? 1 : 0) + (switched ? 1 : 0) };
}

// What a rough cut must carry over from an audio clip (docs/ROUGHCUT_PLAN.md: a new sequence has no effects): the Volume
// level in dB (null at 0 dB), whether the level is keyframed (not carried), whether Asistent's limiter (Dynamics, Limiter
// −6 dB) is on, and the names of the other effects (said as not carried). Read only.
const KNOWN_AUDIO = /^(volume|channel volume|dynamics|panner|mute)$/i;
async function readEffects(ti) {
  const out = { gain_db: null, keyframed: false, limiter: false, others: [] };
  try {
    const lv = await levelParam(ti, "клипа");
    out.keyframed = lv.keyframed;
    if (!lv.keyframed && Number.isFinite(lv.v0) && lv.v0 > 0) {
      const db = Math.round((20 * Math.log10(lv.v0) + LEVEL_MAX_DB) * 100) / 100;
      out.gain_db = Math.abs(db) < 0.05 ? null : db;
    }
  } catch (e) {
    /* no Volume: nothing to carry */
  }
  const dyn = await dynamicsOf(ti);
  out.limiter = dyn.length === 1 && limiterState(dyn.map((d) => ({ params: d.values }))).state === "ok";
  for (const c of (await components(ti)).list) {
    if (!KNOWN_AUDIO.test(c.name) && !/^fill (left|right)/i.test(c.name)) out.others.push(c.name);
  }
  return out;
}

async function createEffect(name, ti) {
  const comp = await ppro.AudioFilterFactory.createComponentByDisplayName(name, ti);
  if (!comp) throw new Error(`Premiere не направи ефекта ${name}`);
  return comp;
}

// the Dynamics effects of a clip, with their parameter values by name
async function dynamicsOf(ti) {
  const { list } = await components(ti);
  const out = [];
  for (const c of list) {
    if (!/^dynamics$/i.test(c.name)) continue;
    const params = {};
    const values = {};
    const n = (await maybe(c.comp, "getParamCount")) || 0;
    for (let i = 0; i < n; i++) {
      const prm = await c.comp.getParam(i);
      const label = (prm.displayName || "") + "";
      if (!label) continue;
      params[label] = prm;
      values[label] = await readLevel(prm);
    }
    out.push({ comp: c.comp, params, values });
  }
  return out;
}

// step 2: Limiter on, Threshold -6 dB (in the clip's single Dynamics), everything else as it was; then read back
async function switchLimiterOn(project, limit) {
  if (!limit.length) return false;
  const work = [];
  for (const l of limit) {
    const dyn = await dynamicsOf(l.ti.ti);
    if (dyn.length !== 1 || !dyn[0].params["Limiter Enabled"] || !dyn[0].params["Limiter Threshold"]) {
      l.p.problems.push(`${l.who}: Dynamics не се появи с параметри на лимитера`);
      continue;
    }
    work.push({ l, d: dyn[0] });
  }
  if (work.length) {
    transaction(project, "Asistent: лимитер −6 dB", (c) => {
      for (const { d } of work) {
        c.addAction(d.params["Limiter Enabled"].createSetValueAction(d.params["Limiter Enabled"].createKeyframe(1), true));
        c.addAction(d.params["Limiter Threshold"].createSetValueAction(d.params["Limiter Threshold"].createKeyframe(dynValue(LIMITER_DB)), true));
      }
    });
  }
  for (const { l } of work) {
    const back = (await dynamicsOf(l.ti.ti))[0];
    const st = back ? limiterState([{ params: back.values }]) : { state: "missing" };
    if (st.state === "ok") {
      l.p.lines.push(`${l.who}: Dynamics → Limiter включен, праг ${LIMITER_DB} dB (${l.state === "added" ? "нов ефект" : "съществуващ Dynamics"}).`);
    } else {
      l.p.problems.push(`${l.who}: лимитерът не се записа като ${LIMITER_DB} dB (${st.why || st.state}; праг ${back && back.values["Limiter Threshold"]})`);
    }
  }
  return work.length > 0;
}

// the clip's Volume level in dB as it is now (0 for an untouched clip), or null
async function readLevelDb(ti) {
  try {
    const lv = await levelParam(ti, "клипа");
    return Number.isFinite(lv.v0) && lv.v0 > 0 ? Math.round((20 * Math.log10(lv.v0) + LEVEL_MAX_DB) * 100) / 100 : null;
  } catch (e) {
    return null;
  }
}

// every effect of an audio clip with all its parameters, read only (development: how Premiere names them)
async function dumpChain(x) {
  const { list } = await components(x.ti);
  const out = [];
  for (const c of list) {
    const params = [];
    const n = c.comp.getParamCount ? await c.comp.getParamCount() : 0;
    for (let i = 0; i < n; i++) {
      const prm = await c.comp.getParam(i);
      let value = null;
      try {
        const v = await prm.getStartValue();
        value = v && v.value !== undefined ? (v.value.value !== undefined ? v.value.value : v.value) : v;
      } catch (e) {
        value = `unreadable: ${e && e.message ? e.message : e}`;
      }
      params.push({ i, name: (prm.displayName || "") + "", value, keyframed: !!(await maybe(prm, "isTimeVarying")) });
    }
    const methods = new Set();
    if (n) for (let q = await c.comp.getParam(n - 1); q && q !== Object.prototype; q = Object.getPrototypeOf(q)) {
      for (const m of Object.getOwnPropertyNames(q)) if (m !== "constructor") methods.add(m);
    }
    out.push({ name: c.name, match: c.match, params, paramMethods: [...methods].sort() });
  }
  return out;
}

// development: append one named audio effect to a clip (one Undo step)
async function addEffectProbe(project, x, name) {
  const step = async (label, fn) => {
    try {
      return await fn();
    } catch (e) {
      throw new Error(`${label}: ${e && e.message ? e.message : e}`);
    }
  };
  const comp = await step("create", () => ppro.AudioFilterFactory.createComponentByDisplayName(name, x.ti));
  const { chain } = await step("chain", () => components(x.ti));
  await step("append", () => transaction(project, `Asistent: проба ${name}`, (c) => c.addAction(chain.createAppendComponentAction(comp))));
}

module.exports = { readAudioSelection, applyLevels, readEffects, readLevelDb, dumpChain, addEffectProbe };
