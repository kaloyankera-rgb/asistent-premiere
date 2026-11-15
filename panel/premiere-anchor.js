// The Anchor page's Premiere side (0.10.69): Anchor Studio's premiere.js (kaloyankera-rgb/anchor-studio 0.3.1, the user's own
// panel; one-click Motion placement confirmed by the user in Premiere at its 0.1.2) brought into Asistent. Changes: the
// visible pixels come from Asistent's engine (anchoralpha.js: no file dialog, any size, PNG / TIFF / WebP) instead of the
// panel's own PNG decoder, and the Undo step is named Asistent's. Every selected clip is read and checked before any write;
// the anchor and the compensating Position go in one transaction inside lockedAccess, then are read back.
'use strict';
const ppro = require('premierepro');
const math = require('./anchorplan.js');

function unwrap(value) {
  for (let i = 0; i < 4 && value && typeof value === 'object' && 'value' in value; i++) value = value.value;
  if (value && typeof value.x === 'number' && typeof value.y === 'number') return [value.x, value.y];
  return value;
}
async function value(param, time) {
  return unwrap(await (param.isTimeVarying() ? param.getValueAtTime(time) : param.getStartValue()));
}
async function componentOf(item, target) {
  target = target || 'motion';
  if (target !== 'motion' && target !== 'transform') throw new Error('Unknown effect target.');
  const matchName = target === 'transform' ? 'AE.ADBE Geometry2' : 'AE.ADBE Motion';
  const chain = await item.getComponentChain();
  const found = [];
  for (let i = 0; i < chain.getComponentCount(); i++) {
    const component = chain.getComponentAtIndex(i);
    if (await component.getMatchName() === matchName) found.push({ chain, component, index: i, matchName });
  }
  if (found.length > 1) throw new Error('This clip has multiple ' + (target === 'transform' ? 'Transform effects. Use a clip with one Transform effect in this version.' : 'Motion components.'));
  if (found.length === 1) return found[0];
  if (target === 'transform') throw new Error('Add Video Effects > Distort > Transform to every selected clip first. No clips were changed.');
  throw new Error('This clip does not expose the standard Motion component.');
}
function paramsOf(component, target) {
  // Standard Motion's fixed parameter order is locale-independent.
  // Require recognizable English labels too, where available, to detect layout changes.
  const count = component.getParamCount();
  if (count < (target === 'transform' ? 8 : 6)) throw new Error('The selected effect parameter layout is not supported.');
  const params = [];
  for (let i = 0; i < count; i++) params.push(component.getParam(i));
  const byName = name => params.find(p => String(p.displayName).toLowerCase() === name);
  if (target === 'transform') {
    // Adobe's AE.ADBE Geometry2 schema, also observed in local Premiere presets.
    return { anchor: byName('anchor point') || params[0], position: byName('position') || params[1],
      uniform: byName('uniform scale') || params[2], scale: byName('scale height') || byName('scale') || params[3],
      scaleWidth: byName('scale width') || params[4], skew: byName('skew') || params[5],
      skewAxis: byName('skew axis') || params[6], rotation: byName('rotation') || params[7] };
  }
  const position = byName('position') || params[0];
  const anchor = byName('anchor point') || params[5];
  const scale = byName('scale') || params[1];
  const scaleWidth = byName('scale width') || params[2];
  const uniform = byName('uniform scale') || params[3];
  const rotation = byName('rotation') || params[4];
  return { position, anchor, scale, scaleWidth, uniform, rotation };
}
// A text or shape made in Premiere (Type tool, Essential Graphics) has no project item: its layer is the sequence frame
// (Motion Anchor 0.5, 0.5 shows as 1080, 1920 in a 2160 x 3840 sequence, measured 2026-11-15). Premiere does not tell a script
// where the text sits inside that layer (Source Text reads back as binary, there is no box).
const GRAPHIC = ['AE.ADBE Graphic Group', 'AE.ADBE Text', 'AE.ADBE Shape'];
async function nativeGraphic(item) {
  const chain = await item.getComponentChain();
  for (let i = 0; i < chain.getComponentCount(); i++) {
    if (GRAPHIC.indexOf(await chain.getComponentAtIndex(i).getMatchName()) >= 0) return true;
  }
  return false;
}
async function sourceSize(item, name, frame) {
  const projectItem = await item.getProjectItem();
  if (!projectItem) {
    if (frame && await nativeGraphic(item)) return frame.slice();
    throw new Error(name + ': source media is unavailable.');
  }
  const clip = ppro.ClipProjectItem.cast(projectItem);
  if (clip && await clip.isSequence()) {
    const nested = await clip.getSequence();
    const frame = await nested.getFrameSize();
    return [frame.width, frame.height];
  }
  const metadata = await ppro.Metadata.getProjectMetadata(projectItem);
  let dimensions = math.metadataSize(metadata);
  if (!dimensions) dimensions = math.metadataSize(await ppro.Metadata.getXMPMetadata(projectItem));
  if (!dimensions) throw new Error(name + ': Premiere did not expose the source dimensions. Native graphics, MOGRTs and generated media are not supported in this version.');
  if (clip) {
    const interpretation = await clip.getFootageInterpretation();
    if (Math.abs(interpretation.getPixelAspectRatio() - 1) > 0.0001) {
      throw new Error(name + ': use square-pixel source media in this version.');
    }
  }
  return dimensions;
}
async function snapshot(request) {
  const target = request && request.target || 'motion';
  if (target !== 'motion' && target !== 'transform') throw new Error('Unknown effect target.');
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error('Open a project in Premiere Pro.');
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error('Open a timeline sequence.');
  const selection = await sequence.getSelection();
  const selected = await selection.getTrackItems();
  const items = selected.filter(item => item instanceof ppro.VideoClipTrackItem);
  if (!items.length) throw new Error('Select one or more video clips in the timeline.');
  if (items.length > 64) throw new Error('Select up to 64 video clips at a time.');
  const frame = await sequence.getFrameSize();
  const dimensions = [frame.width, frame.height];
  math.size(dimensions);
  const settings = await sequence.getSettings();
  const parText = await settings.getVideoPixelAspectRatio();
  if (!math.squareSequenceAspect(parText, ppro.Constants.PixelAspectRatio)) {
    throw new Error('Unsupported sequence pixel aspect: ' + JSON.stringify(parText) +
      '. Premiere square-pixel preset: ' + JSON.stringify(ppro.Constants.PixelAspectRatio && ppro.Constants.PixelAspectRatio.SQUARE) + '.');
  }
  const playhead = await sequence.getPlayerPosition();
  const clips = [];
  for (const item of items) {
    const name = await item.getName();
    if (await item.isAdjustmentLayer()) throw new Error(name + ': adjustment layers are not supported.');
    if (await item.isSpeedReversed() || Math.abs(await item.getSpeed() - 1) > 0.0001) throw new Error(name + ': retimed clips are not supported.');
    const start = await item.getStartTime(), end = await item.getEndTime(), inPoint = await item.getInPoint();
    const seqTime = Math.max(start.seconds, Math.min(playhead.seconds, end.seconds));
    // Motion keyframe times use source-media time, not absolute sequence time.
    const time = ppro.TickTime.createWithSeconds(inPoint.seconds + seqTime - start.seconds);
    // Validate the chosen effect before requesting PNG file access.
    let motion = await componentOf(item, target);
    const source = await sourceSize(item, name, dimensions);
    let bounds = null;
    if (request && request.alpha && (request.mode === 'clip' || request.mode === 'selection')) {
      const raw = await item.getProjectItem();
      const projectItem = raw ? ppro.ClipProjectItem.cast(raw) : null;
      if (!raw) { /* a text made in Premiere: always measured from two renders (measureDrawn), Use alpha or not */ } else {
      if (!projectItem || await projectItem.isSequence()) throw new Error(name + ': Use alpha needs a still image with transparency (PNG, TIFF, WebP).');
      const path = await projectItem.getMediaFilePath();
      if (!/\.(png|tiff?|webp)$/i.test(path)) throw new Error(name + ': Use alpha works on still images with transparency (PNG, TIFF, WebP) only.');
      const interpretation = await projectItem.getFootageInterpretation();
      if (interpretation.getIgnoreAlpha()) throw new Error(name + ': Premiere is ignoring the source alpha. Enable its alpha interpretation first.');
      bounds = await require('./anchoralpha.js').bounds(path, source, request.threshold, interpretation.getInvertAlpha(), request.onProgress);
      }
    }
    if (bounds) motion = await componentOf(item, target);
    const params = paramsOf(motion.component, target);
    if (params.anchor.isTimeVarying()) throw new Error(name + ': animated Anchor Point is not supported. Remove its keyframes first.');
    // Animated Scale / Rotation (0.10.89): the picture is kept where it is at the playhead (Position moves by one fixed
    // amount, read with Scale and Rotation at that moment), and from then on the animation grows and turns around the new point.
    const animated = [params.scale, params.scaleWidth, params.uniform, params.rotation].some(p => p.isTimeVarying());
    if (target === 'transform') {
      if (params.skew.isTimeVarying() || params.skewAxis.isTimeVarying() || Math.abs(Number(await value(params.skew, time))) > 0.00001) {
        throw new Error(name + ': Transform Skew must be zero and unanimated in this version.');
      }
    }
    const anchor = math.pixels(math.point(await value(params.anchor, time)), source);
    const positionDimensions = target === 'transform' ? source : dimensions;
    let position = math.pixels(math.point(await value(params.position, time)), positionDimensions);
    const sy = Number(await value(params.scale, time)) / 100;
    const uniform = await value(params.uniform, time);
    if (uniform !== true && uniform !== false && uniform !== 0 && uniform !== 1) throw new Error(name + ': unexpected Uniform Scale value.');
    const sx = uniform ? sy : Number(await value(params.scaleWidth, time)) / 100;
    let matrix = math.matrix(sx, sy, Number(await value(params.rotation, time)));
    if (animated) {
      // the playhead is the moment whose picture stays put: it must be on the clip (a clamped start is often a pop's
      // Scale 0, measured 2026-11-15) and the picture must be visible there (Scale 0 moves nothing, then every other frame would)
      if (playhead.seconds < start.seconds || playhead.seconds >= end.seconds) {
        throw new Error(name + ': Scale or Rotation is animated. Put the playhead on this clip, at the moment whose picture should stay where it is. No clips were changed.');
      }
      if (Math.abs(sx) < 0.005 || Math.abs(sy) < 0.005) {
        throw new Error(name + ': Scale is 0 at the playhead, so the picture is not there to keep. Move the playhead to where the picture is visible (for a pop, its end). No clips were changed.');
      }
    }
    let outer = null;
    if (target === 'transform') {
      const outerMotion = await componentOf(item, 'motion'), outerParams = paramsOf(outerMotion.component);
      for (const p of [outerParams.anchor, outerParams.position, outerParams.scale, outerParams.scaleWidth, outerParams.uniform, outerParams.rotation]) {
        if (p.isTimeVarying()) throw new Error(name + ': keep Motion static when editing the Transform anchor. Animate Position inside Transform instead.');
      }
      const outerUniform = await value(outerParams.uniform, time);
      if (outerUniform !== true && outerUniform !== false && outerUniform !== 0 && outerUniform !== 1) throw new Error(name + ': unexpected Motion Uniform Scale value.');
      const outerScale = Number(await value(outerParams.scale, time)) / 100;
      outer = { owner: outerMotion, anchor: math.pixels(math.point(await value(outerParams.anchor, time)), source),
        position: math.pixels(math.point(await value(outerParams.position, time)), dimensions),
        matrix: math.matrix(outerUniform ? outerScale : Number(await value(outerParams.scaleWidth, time)) / 100,
          outerScale, Number(await value(outerParams.rotation, time))) };
      position = math.toWorld(outer, position);
      matrix = math.multiply(outer.matrix, matrix);
    }
    const positionKeys = [];
    if (params.position.isTimeVarying()) {
      const keys = params.position.getKeyframeListAsTickTimes();
      if (!keys.length || keys.length > 2000) throw new Error(name + ': Position needs between 1 and 2000 existing keyframes.');
      for (const keyTime of keys) {
        const key = params.position.getKeyframePtr(keyTime);
        if (typeof key.getTemporalInterpolationMode !== 'function') throw new Error(name + ': this Premiere build cannot expose Position keyframe interpolation. Use a clip without animated Position for now.');
        const interpolation = await key.getTemporalInterpolationMode();
        // Reject curves whose unexposed tangents could be lost by replacing a point.
        if (interpolation !== ppro.Constants.InterpolationMode.LINEAR && interpolation !== ppro.Constants.InterpolationMode.HOLD) {
          throw new Error(name + ': use Linear or Hold Position keyframes. Bezier motion paths cannot be preserved by this build.');
        }
        const keyPosition = math.pixels(math.point(await value(params.position, keyTime)), positionDimensions);
        positionKeys.push({ time: keyTime, interpolation, value: outer ? math.toWorld(outer, keyPosition) : keyPosition });
      }
    }
    const identity = [await item.getTrackIndex(), start.seconds, end.seconds, inPoint.seconds, name];
    clips.push({ name, item, params, motion, target, outer, positionDimensions, identity, size: source, bounds, anchor, position, matrix, positionKeys, animated,
      at: seqTime, graphic: !(await item.getProjectItem()),
      positionAnimated: params.position.isTimeVarying() });
  }
  return { project, sequence, dimensions, clips, target, sequenceName: sequence.name };
}
function publicSnapshot(state) {
  return { sequence: state.sequenceName, frame: state.dimensions, target: state.target,
    clips: state.clips.map(c => ({ name: c.name, size: c.size, anchor: c.anchor,
      position: c.position, keyframes: c.positionKeys.length })) };
}
function keyframe(param, vector) {
  return param.createKeyframe(new ppro.PointF(vector[0], vector[1]));
}
function fingerprint(state) {
  return JSON.stringify({ project: state.project.path, sequence: state.sequenceName, guid: String(state.sequence.guid),
    frame: state.dimensions, target: state.target, clips: state.clips.map(c => ({ identity: c.identity, effectIndex: c.motion.index, size: c.size, anchor: c.anchor,
      position: c.position, matrix: c.matrix, keys: c.positionKeys.map(k => [k.time.seconds, k.value, k.interpolation]) })) });
}
// What a text made in Premiere draws (0.10.91, the user's screen recording 2026-11-15: selecting the letters should anchor on the
// letters). Premiere tells no script where they sit, so the frame is rendered as it is and once more with the clip hidden for
// a moment (its Opacity 0, then put back exactly): the pixels that differ are the clip (two renders of one moment are
// identical, measured in NEW TEST; about one second). Two extra Undo steps that cancel out; the anchor is the last one.
async function hideTarget(item, name) {
  const chain = await item.getComponentChain();
  const found = [];
  let layers = [];
  for (let i = 0; i < chain.getComponentCount(); i++) {
    const c = chain.getComponentAtIndex(i), match = await c.getMatchName();
    for (let j = 0; j < c.getParamCount(); j++) {
      const p = c.getParam(j);
      if (!/^opacity$/i.test(String(p.displayName).trim())) continue;
      if (match === 'AE.ADBE Opacity') { if (!p.isTimeVarying()) found.push({ comp: i, param: j }); break; }
      if (GRAPHIC.indexOf(match) >= 0 && !p.isTimeVarying()) layers.push({ comp: i, param: j });
    }
  }
  const list = found.length ? found : layers;
  if (!list.length) throw new Error(name + ': its Opacity is animated, so Asistent cannot hide it for a moment to see where the text sits. No clips were changed.');
  for (const t of list) t.value = Number(unwrap(await chain.getComponentAtIndex(t.comp).getParam(t.param).getStartValue()));
  return list;
}
function setOpacity(project, item, targets, show, label) {
  return item.getComponentChain().then(chain => {
    let ok = false;
    project.lockedAccess(() => {
      ok = project.executeTransaction(compound => {
        for (const t of targets) {
          const p = chain.getComponentAtIndex(t.comp).getParam(t.param);
          compound.addAction(p.createSetValueAction(p.createKeyframe(show ? t.value : 0), true));
        }
      }, label);
    });
    return ok;
  });
}
// 0.10.92 (the user: "it needs to be instant like before"): a text's box is kept per clip in the layer's own pixels, so it stays
// right when the anchor, Position, Scale or Rotation change; the next clicks on the same text need no render and no extra Undo
// step. It is measured again when the clip or anything readable inside the graphic changes (its layers' transforms, the
// text's length); Premiere gives no script the words or the font, so a same-length rewording keeps the old box until the
// clip is selected anew (Selecting it again in the timeline does not clear it: moving or trimming it does).
const drawnCache = new Map();
async function graphicKey(clip) {
  const chain = await clip.item.getComponentChain();
  const parts = [clip.identity];
  for (let i = 0; i < chain.getComponentCount(); i++) {
    const c = chain.getComponentAtIndex(i), match = await c.getMatchName();
    if (GRAPHIC.indexOf(match) < 0) continue;
    const values = [match];
    for (let j = 0; j < c.getParamCount(); j++) {
      const p = c.getParam(j);
      if (/^opacity$/i.test(String(p.displayName).trim())) continue;
      let v = null;
      try { v = p.isTimeVarying() ? ['keys', p.getKeyframeListAsTickTimes().map(t => t.seconds), unwrap(await p.getValueAtTime(ppro.TickTime.createWithSeconds(clip.at)))] : unwrap(await p.getStartValue()); } catch (e) { v = 'unread'; }
      values.push(v);
    }
    parts.push(values);
  }
  return JSON.stringify(parts);
}
async function measureDrawn(state, clip, onProgress) {
  const key = await graphicKey(clip);
  if (drawnCache.has(key)) return Object.assign({ cached: true }, drawnCache.get(key));
  const box = await renderDrawn(state, clip, onProgress);
  if (drawnCache.size > 200) drawnCache.clear();
  drawnCache.set(key, box);
  return Object.assign({}, box);
}
async function renderDrawn(state, clip, onProgress) {
  const engine = require('./engine.js');
  const dir = (await engine.status()).frames_dir;
  const at = ppro.TickTime.createWithSeconds(clip.at);
  const [w, h] = state.dimensions;
  // half a 4K frame is enough for a pivot (an edge within 1 px of the sequence's own pixels) and renders and compares
  // about three times faster (0.7 -> 0.3 s a frame, 0.40 -> 0.07 s the comparison, timed in NEW TEST)
  const k = Math.min(1, 1920 / Math.max(w, h)), ew = Math.max(1, Math.round(w * k)), eh = Math.max(1, Math.round(h * k));
  const shot = async tag => {
    const name = 'anchor_' + Date.now().toString(36) + '_' + tag + '.png';
    await ppro.Exporter.exportSequenceFrame(state.sequence, at, name, dir, ew, eh);
    const got = await engine.waitFrame(dir + '/' + name, 20, true);
    if (!got || !got.path) throw new Error('Premiere did not render the frame to measure. No clips were changed.');
    return got.path;
  };
  if (onProgress) onProgress('Finding where ' + clip.name + ' draws…');
  const targets = await hideTarget(clip.item, clip.name);
  const before = await shot('as_is');
  if (!await setOpacity(state.project, clip.item, targets, false, 'Asistent: hide ' + clip.name + ' to measure it')) {
    throw new Error('Premiere declined to hide the clip for the measurement. No clips were changed.');
  }
  let after;
  try { after = await shot('hidden'); } finally {
    if (!await setOpacity(state.project, clip.item, targets, true, 'Asistent: show ' + clip.name + ' again')) {
      throw new Error(clip.name + ' is still hidden (Opacity 0): Premiere declined to show it again. Use Edit > Undo once.');
    }
  }
  const r = await engine.anchorDrawn(before, after);
  if (r.width !== ew || r.height !== eh) throw new Error('The measured frame has another size than asked for. No clips were changed.');
  // rendered pixels -> sequence pixels -> the clip's own picture (through Motion, and Transform when that is the target)
  const fx = w / ew, fy = h / eh;
  const pts = r.hull.map(p => math.toSource(clip, [p[0] * fx, p[1] * fy]));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const m = clip.matrix, scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const pad = 0.5 * Math.max(fx, fy) / scale;                 // half a rendered pixel, in the layer's pixels
  const x0 = Math.max(0, Math.min.apply(null, xs) - pad), y0 = Math.max(0, Math.min.apply(null, ys) - pad);
  const x1 = Math.min(clip.size[0], Math.max.apply(null, xs) + pad), y1 = Math.min(clip.size[1], Math.max.apply(null, ys) + pad);
  if (!(x1 > x0 && y1 > y0)) throw new Error(clip.name + ': nothing of it is inside its own picture. No clips were changed.');
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
async function apply(request) {
  // Snapshot and validate every selected clip before creating any write action.
  let state = await snapshot(request);
  const measure = (request.mode === 'clip' || request.mode === 'selection') && state.clips.some(c => c.graphic);
  if (measure) {
    if (state.clips.filter(c => c.graphic).length > 8) throw new Error('Select up to 8 texts made in Premiere at a time. No clips were changed.');
    let rendered = 0;
    for (const c of state.clips) if (c.graphic) {
      const box = await measureDrawn(state, c, request.onProgress);
      if (!box.cached) rendered++;
      delete box.cached;
      c.bounds = box;
    }
    state.rendered = rendered;
    // the hide / show steps changed nothing else: read every clip again and compare before the anchor is written
    const fresh = await snapshot({ target: state.target });
    if (fingerprint(state) !== fingerprint(fresh)) throw new Error('The selection or clip settings changed while the text was measured. Only the measuring steps ran. Click again.');
    fresh.clips.forEach((c, i) => { c.bounds = state.clips[i].bounds; });
    fresh.rendered = state.rendered;
    state = fresh;
  }
  if (!measure && state.clips.some(c => Boolean(c.bounds))) {
    // File authorization may keep a modal open for a while. Revalidate the
    // entire selected target and re-read native handles before any edits.
    const fresh = await snapshot({ target: state.target });
    if (fingerprint(state) !== fingerprint(fresh)) throw new Error('The selection or clip settings changed while the image was read. No clips were changed. Click again.');
    fresh.clips.forEach((c, i) => { c.bounds = state.clips[i].bounds; });
    fresh.rendered = state.rendered;
    state = fresh;
  }
  const plans = math.plan(state.clips, state.dimensions, request);
  const edits = [], readbacks = [];
  for (let i = 0; i < state.clips.length; i++) {
    const c = state.clips[i], plan = plans[i];
    const anchor = math.normalized(plan.anchor, c.size);
    edits.push({ clip: c, property: 'anchor', expected: anchor });
    if (c.positionAnimated) {
      for (const key of plan.positionKeys) {
        const p = math.normalized(c.outer ? math.toSource(c.outer, key.value) : key.value, c.positionDimensions);
        edits.push({ clip: c, property: 'position', time: key.time,
          interpolation: key.interpolation, expected: p });
      }
    } else {
      const p = math.normalized(c.outer ? math.toSource(c.outer, plan.position) : plan.position, c.positionDimensions);
      edits.push({ clip: c, property: 'position', expected: p });
    }
  }
  let ok = false;
  // Premiere 26.3+ requires Action creation inside lockedAccess. Create both
  // keyframes and actions inside the synchronous transaction callback too.
  // The preparation above contains only desired values, never Action objects.
  state.project.lockedAccess(() => {
    ok = state.project.executeTransaction(compound => {
      for (const edit of edits) {
        const component = edit.clip.motion.chain.getComponentAtIndex(edit.clip.motion.index);
        const param = paramsOf(component, edit.clip.target)[edit.property];
        const k = keyframe(param, edit.expected);
        if (edit.time) {
          k.position = edit.time;
          compound.addAction(param.createAddKeyframeAction(k));
          compound.addAction(param.createSetInterpolationAtKeyframeAction(edit.time, edit.interpolation, true));
        } else compound.addAction(param.createSetValueAction(k, true));
        readbacks.push({ clip: edit.clip, property: edit.property, time: edit.time, expected: edit.expected });
      }
    }, 'Asistent: Move the ' + (state.target === 'transform' ? 'Transform' : 'Motion') + ' anchor');
  });
  if (!ok) throw new Error('Premiere declined the transaction.');
  try { for (const check of readbacks) {
    // Reacquire the component after the transaction rather than keeping a
    // write-time parameter wrapper across a project mutation.
    const motion = await componentOf(check.clip.item, check.clip.target);
    const param = paramsOf(motion.component, check.clip.target)[check.property];
    const actual = math.point(unwrap(await (check.time ? param.getValueAtTime(check.time) : param.getStartValue())));
    if (actual.some((v, i) => Math.abs(v - check.expected[i]) > 0.00001)) {
      throw new Error('Premiere did not retain the requested values.');
    }
  } } catch (error) {
    throw new Error('The edit was committed, but verification failed: ' + (error.message || String(error)) + ' Use Edit > Undo before trying again.');
  }
  return { count: state.clips.length, keys: state.clips.reduce((n, c) => n + c.positionKeys.length, 0),
    alpha: state.clips.some(c => Boolean(c.bounds)), target: state.target,
    animated: state.clips.filter(c => c.animated).length, graphics: state.clips.filter(c => c.graphic).length, measured: measure, rendered: state.rendered || 0,
    box: measure && state.clips.length === 1 ? state.clips[0].bounds : null };
}
async function save(request) {
  const state = await snapshot(request);
  if (state.clips.length !== 1) throw new Error('Select exactly one clip to save its anchor.');
  // Both targets save their anchor location in sequence/world coordinates.
  return { world: state.clips[0].position, frame: state.dimensions, name: state.clips[0].name };
}
module.exports = { inspect: async request => publicSnapshot(await snapshot(request)), apply, save, unwrap, paramsOf };
