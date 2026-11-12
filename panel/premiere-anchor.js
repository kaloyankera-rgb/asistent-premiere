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
async function sourceSize(item, name) {
  const projectItem = await item.getProjectItem();
  if (!projectItem) throw new Error(name + ': source media is unavailable.');
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
    const source = await sourceSize(item, name);
    let bounds = null;
    if (request && request.alpha && (request.mode === 'clip' || request.mode === 'selection')) {
      const projectItem = ppro.ClipProjectItem.cast(await item.getProjectItem());
      if (!projectItem || await projectItem.isSequence()) throw new Error(name + ': Use alpha needs a still image with transparency (PNG, TIFF, WebP).');
      const path = await projectItem.getMediaFilePath();
      if (!/\.(png|tiff?|webp)$/i.test(path)) throw new Error(name + ': Use alpha works on still images with transparency (PNG, TIFF, WebP) only.');
      const interpretation = await projectItem.getFootageInterpretation();
      if (interpretation.getIgnoreAlpha()) throw new Error(name + ': Premiere is ignoring the source alpha. Enable its alpha interpretation first.');
      bounds = await require('./anchoralpha.js').bounds(path, source, request.threshold, interpretation.getInvertAlpha(), request.onProgress);
    }
    if (bounds) motion = await componentOf(item, target);
    const params = paramsOf(motion.component, target);
    for (const p of [params.anchor, params.scale, params.scaleWidth, params.uniform, params.rotation]) {
      if (p.isTimeVarying()) throw new Error(name + ': animated Anchor, Scale or Rotation needs a more advanced compensation pass.');
    }
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
    clips.push({ name, item, params, motion, target, outer, positionDimensions, identity, size: source, bounds, anchor, position, matrix, positionKeys,
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
async function apply(request) {
  // Snapshot and validate every selected clip before creating any write action.
  let state = await snapshot(request);
  if (state.clips.some(c => Boolean(c.bounds))) {
    // File authorization may keep a modal open for a while. Revalidate the
    // entire selected target and re-read native handles before any edits.
    const fresh = await snapshot({ target: state.target });
    if (fingerprint(state) !== fingerprint(fresh)) throw new Error('The selection or clip settings changed while the image was read. No clips were changed. Click again.');
    fresh.clips.forEach((c, i) => { c.bounds = state.clips[i].bounds; });
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
    alpha: state.clips.some(c => Boolean(c.bounds)), target: state.target };
}
async function save(request) {
  const state = await snapshot(request);
  if (state.clips.length !== 1) throw new Error('Select exactly one clip to save its anchor.');
  // Both targets save their anchor location in sequence/world coordinates.
  return { world: state.clips[0].position, frame: state.dimensions, name: state.clips[0].name };
}
module.exports = { inspect: async request => publicSnapshot(await snapshot(request)), apply, save, unwrap, paramsOf };
