// Smart Audio Assistant in Premiere: route L/R with the Fill effects, split two lavaliers onto two
// tracks, set the clip's Volume level. Nothing is removed and the media is never changed.
//
// One press of the button is as few Undo steps as Premiere allows: everything goes into one transaction,
// except that a copy for "Раздели L/R" can only get its own effect after it exists (Premiere 26.0.2
// clones the clip as it was BEFORE the transaction, seen 2026-11-01). So: step 1 = every effect and
// level of every clip plus the copies; step 2 (only if something was split) = the copies' channel and level, all
// copies together. Never more than two Cmd/Ctrl+Z, however many clips.
const ppro = require("premierepro");
const { TickTime } = ppro;
const P = require("./premiere.js");
const { routeOf, RE } = require("./channels.js");

const { UserError, transaction, maybe, debug } = P;

// display names of the effects in this Premiere (asked once, logged once)
let names = null;
async function effectNames() {
  if (names) return names;
  const all = (await maybe(ppro.AudioFilterFactory, "getDisplayNames")) || [];
  debug(`audio effects: ${all.join(" | ")}`);
  const find = (re) => all.find((n) => re.test(n));
  names = { LL: find(RE.fillLL), RR: find(RE.fillRR), swap: find(RE.swap) };
  return names;
}

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

async function effect(route, ti) {
  const n = await effectNames();
  const name = n[route];
  if (!name) throw new UserError(`В този Premiere няма ефект „${route === "swap" ? "Swap Channels" : "Fill"}“.`);
  return ppro.AudioFilterFactory.createComponentByDisplayName(name, ti);
}

// Volume > Level. Its unit is not documented for 26.0: recognised from the current value (0 dB shows as
// 0.1778 in Premiere's own scale, 0 in dB, 1 as plain linear); confirmed on 26.0.2: Premiere's scale.
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
  let scale = "db";
  if (Math.abs(v0 - 0.17783) < 0.002 || (v0 > 0 && v0 < 0.95)) scale = "premiere";
  else if (Math.abs(v0 - 1) < 1e-6) scale = "linear";
  const toValue = (db) => (scale === "premiere" ? Math.pow(10, (db - 15) / 20) : scale === "linear" ? Math.pow(10, db / 20) : db);
  return { param, keyframed: !!(await maybe(param, "isTimeVarying")), toValue, scale, v0 };
}

async function readLevel(param) {
  const v = await param.getStartValue();
  return Number(v && v.value !== undefined ? (v.value.value ?? v.value) : NaN);
}

// nearest audio track (below first) that is empty over [start, end]; past the last one if none is
function freeAudioTrack(items, track, start, end, count) {
  const busy = (t) => items.some((x) => x.kind === "audio" && x.track === t && Math.min(end, x.end) - Math.max(start, x.start) > 0.0005);
  for (let d = 1; d < count; d++) {
    if (track + d < count && !busy(track + d)) return track + d;
    if (track - d >= 0 && !busy(track - d)) return track - d;
  }
  return count;
}

// Audio clips selected in the active sequence, with the part of the media they use.
async function readAudioSelection(project) {
  const t = await P.readTimeline(project);
  const picked = t.items.filter((x) => x.selected && x.kind === "audio" && x.path);
  const skipped = [];
  const items = [];
  for (const x of picked) {
    if (Math.abs(x.speed - 1) >= 0.01 || x.reversed) {
      skipped.push(`${x.name} (променена скорост)`);
      continue;
    }
    items.push({ ...x, route: await currentRoute(x.ti) });
  }
  return { timeline: t, items, skipped };
}

// The Volume level as actions: one static value, or (phrase leveling) keyframes at media times.
function levelActions(lv, o, who, inPt) {
  const actions = [];
  const checks = [];
  const lines = [levelLine(who, o)];
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
 * Prepare one clip: the actions (in order) and how to check them afterwards. Reads only.
 * Returns { actions: [() => Action], checks: [async () => string|null], lines: [], split?: {...} }
 */
async function prepare(timeline, it, res, usedTracks, order = "LR") {
  const plan = { actions: [], checks: [], lines: [] };
  if (res.action === "ask") return plan;
  const out = Object.fromEntries((res.outputs || []).map((o) => [o.route, o]));
  const label = it.name;

  const setLevel = async (ti, o, who) => {
    if (!o) return;
    if (o.lufs === null) {
      plan.lines.push(`${who}: ${o.note}`);
      return;
    }
    const lv = await levelParam(ti, who);
    if (lv.keyframed) {
      plan.lines.push(`${who}: вече има ключови кадри на силата: не е пипано (Cmd/Ctrl+Z и пусни пак)`);
      return;
    }
    const l = levelActions(lv, o, who, it.inPt || 0);
    plan.actions.push(...l.actions);
    plan.checks.push(...l.checks);
    plan.lines.push(...l.lines);
    debug(`level ${who}: was ${lv.v0} (${lv.scale}), ${o.gain_db} dB, keyframes ${(o.keyframes || []).length}`);
  };

  if (it.route) {                        // already routed earlier (by us or by hand): only the level
    await setLevel(it.ti, out[it.route] || out.as_is, label);
    return plan;
  }
  if (res.action === "use_left" || res.action === "use_right") {
    const route = res.action === "use_left" ? "LL" : "RR";
    const comp = await effect(route, it.ti);
    const { chain } = await components(it.ti);
    plan.actions.push(() => chain.createAppendComponentAction(comp));
    plan.checks.push(async () => ((await currentRoute(it.ti)) === route ? null : `ефектът не се появи на ${label}`));
    await setLevel(it.ti, out[route], label);
    return plan;
  }
  if (res.action === "split") {
    const items = (await P.readItems(timeline.sequence)).items;
    const count = await timeline.sequence.getAudioTrackCount();
    // tracks already promised to other clips of this same press count as busy
    const taken = items.concat(usedTracks.map((u) => ({ kind: "audio", ...u })));
    const target = freeAudioTrack(taken, it.track, it.start, it.end, count);
    usedTracks.push({ track: target, start: it.start, end: it.end });
    const editor = ppro.SequenceEditor.getEditor(timeline.sequence);
    const { chain } = await components(it.ti);
    // order "LR": this track keeps L, the copy gets R; "RL": the other way round
    const keep = order === "RL" ? "RR" : "LL";
    const give = keep === "LL" ? "RR" : "LL";
    const ch = (r) => (r === "LL" ? "L" : "R");
    const ll = await effect(keep, it.ti);
    const lvl = await levelParam(it.ti, label);
    if (lvl.keyframed) throw new UserError(`${label}: има ключови кадри на силата, не е разделено.`);
    // the clone takes the clip as it is before this step: a plain copy that step 2 turns into R/R
    plan.actions.push(() => editor.createCloneTrackItemAction(it.ti, TickTime.TIME_ZERO, 0, target - it.track, false, false));
    plan.actions.push(() => chain.createAppendComponentAction(ll));
    const l = levelActions(lvl, out[keep], `${ch(keep)} (A${it.track + 1})`, it.inPt || 0);
    plan.actions.push(...l.actions);
    plan.checks.push(...l.checks);
    plan.lines.push(...l.lines, levelLine(`${ch(give)} (A${target + 1}, копие)`, out[give]));
    plan.split = { it, target, count, outGive: out[give], give, label, who: `${ch(give)} (A${target + 1})` };
    plan.checks.push(async () => ((await currentRoute(it.ti)) === keep ? null : `${label} не стана ${ch(keep)}/${ch(keep)}`));
    return plan;
  }
  await setLevel(it.ti, out.as_is, label);
  return plan;
}

/**
 * Apply all prepared clips: step 1 = everything that exists already (and the copies), step 2 = the
 * copies' R/R and level, all copies together. Returns how many Undo steps it took.
 */
async function applyAll(project, timeline, plans) {
  const actions = plans.flatMap((p) => p.actions);
  if (actions.length) {
    transaction(project, "Asistent: оправи звука", (c) => {
      for (const make of actions) c.addAction(make());
    });
  }
  const second = [];
  const splits = plans.filter((p) => p.split);
  if (splits.length) {
    const after = (await P.readItems(timeline.sequence)).items;
    for (const p of splits) {
      const s = p.split;
      const copy = after.find((x) => x.kind === "audio" && x.track === s.target && x.path === s.it.path &&
        Math.abs(x.start - s.it.start) < 0.01);
      if (!copy) {
        p.problems = [s.target >= s.count
          ? `Няма празна аудио писта до ${s.label}, а Premiere не добави нова: добави една (десен клик → Add Track) и пусни пак.`
          : `Копието на ${s.label} не се появи на A${s.target + 1}.`];
        continue;
      }
      const route = await currentRoute(copy.ti);
      const lv = await levelParam(copy.ti, `${s.label} (копие)`);
      const rr = route === s.give ? null : await effect(s.give, copy.ti);
      const { chain } = await components(copy.ti);
      if (rr) second.push(() => chain.createAppendComponentAction(rr));
      const l = levelActions(lv, s.outGive, s.who, s.it.inPt || 0);
      second.push(...l.actions);
      p.checks.push(...l.checks);
      p.checks.push(async () => ((await currentRoute(copy.ti)) === s.give ? null : `копието на ${s.label} не стана ${s.give === "LL" ? "L/L" : "R/R"}`));
      debug(`split ${s.label}: copy on A${s.target + 1} (route before step 2: ${route})`);
    }
    if (second.length) {
      transaction(project, "Asistent: оправи звука (копия R)", (c) => {
        for (const make of second) c.addAction(make());
      });
    }
  }
  for (const p of plans) {
    p.problems = p.problems || [];
    for (const check of p.checks) {
      const bad = await check();
      if (bad) p.problems.push(bad);
    }
  }
  return { undoSteps: (actions.length ? 1 : 0) + (second.length ? 1 : 0) };
}

module.exports = { readAudioSelection, prepare, applyAll };
