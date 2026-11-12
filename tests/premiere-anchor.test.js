// The Anchor page's Premiere side (0.10.69): Anchor Studio's own host tests (tests/host.test.cjs) on simulated Premiere
// objects, pointed at panel/premiere-anchor.js; the PNG reader is anchoralpha.js now
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const math = require('../panel/anchorplan.js');

function fixture(options = {}) {
  let transactions = 0, locked = false, inTransaction = false, creations = 0, selectionReads = 0;
  function requireWriteScope() {
    assert.equal(locked, true, 'Premiere 26.3+: create keyframes/actions inside lockedAccess');
    assert.equal(inTransaction, true, 'Create keyframes/actions inside the synchronous transaction callback');
    creations++;
  }
  class PointF { constructor(x, y) { this.x = x; this.y = y; } }
  function param(name, initial, varying = false, keyList) {
    let stored = initial;
    const keys = new Map(keyList || options.keys || []);
    return { displayName: name, isTimeVarying: () => varying,
      getStartValue: async () => ({ value: { value: stored } }),
      getValueAtTime: async time => ({ value: keys.get(time.seconds) || stored }),
      getKeyframeListAsTickTimes: () => Array.from(keys.keys()).map(seconds => ({ seconds })),
      getKeyframePtr: () => ({ getTemporalInterpolationMode: async () => options.interpolation || 1 }),
      createKeyframe: p => { requireWriteScope(); return { value: { value: [p.x, p.y] } }; },
      createSetValueAction: k => { requireWriteScope(); return () => { stored = k.value.value; }; },
      createAddKeyframeAction: k => { requireWriteScope(); return () => { keys.set(k.position.seconds, k.value.value); }; },
      createSetInterpolationAtKeyframeAction: () => { requireWriteScope(); return () => {}; },
      stored: () => stored, keys
    };
  }
  const params = [param('Position', options.motionPosition || [0.5, 0.5], Boolean(options.keys)), param('Scale', options.motionScale === undefined ? 50 : options.motionScale, options.animatedScale),
    param('Scale Width', options.motionWidth === undefined ? 50 : options.motionWidth), param('Uniform Scale', options.motionUniform === undefined ? true : options.motionUniform),
    param('Rotation', options.motionRotation || 0), param('Anchor Point', [0.5, 0.5])];
  const component = { getMatchName: async () => 'AE.ADBE Motion', getParamCount: () => params.length, getParam: i => params[i] };
  const transformParams = [param('Anchor Point', [0.5, 0.5]),
    param('Position', options.transformPosition || [0.5, 0.5], Boolean(options.transformKeys), options.transformKeys),
    param('Uniform Scale', options.transformUniform === undefined ? true : options.transformUniform),
    param('Scale Height', options.transformScale === undefined ? 100 : options.transformScale, options.animatedTransformScale),
    param('Scale Width', options.transformWidth === undefined ? 100 : options.transformWidth),
    param('Skew', options.skew || 0), param('Skew Axis', 0), param('Rotation', options.transformRotation || 0),
    param('Opacity', 73), param('Use Composition Shutter Angle', true), param('Shutter Angle', 180), param('Sampling', 0)];
  const transformComponent = { getMatchName: async () => 'AE.ADBE Geometry2', getParamCount: () => transformParams.length, getParam: i => transformParams[i] };
  const components = [component];
  if (options.hasTransform) components.push(transformComponent);
  if (options.duplicateTransform) components.push(transformComponent);
  if (options.localizedTransform) transformParams.forEach((p, i) => { p.displayName = 'Lokalisierte Eigenschaft ' + i; });
  class VideoClipTrackItem {
    async getComponentChain() { return { getComponentCount: () => components.length, getComponentAtIndex: i => components[i] }; }
    async getName() { return options.changeSelection && selectionReads > 1 ? 'Other clip' : 'Test clip'; }
    async getTrackIndex() { return 0; }
    async getSpeed() { return options.speed || 1; }
    async isSpeedReversed() { return false; }
    async isAdjustmentLayer() { return false; }
    async getStartTime() { return { seconds: 10 }; }
    async getEndTime() { return { seconds: 20 }; }
    async getInPoint() { return { seconds: 3 }; }
    async getProjectItem() { return {}; }
  }
  const items = [new VideoClipTrackItem()];
  const sequence = { name: 'Test sequence', getSelection: async () => { selectionReads++; return { getTrackItems: async () => items }; },
    getPlayerPosition: async () => ({ seconds: 12 }), getFrameSize: async () => ({ width: 1920, height: 1080 }),
    getSettings: async () => ({ getVideoPixelAspectRatio: async () => options.par === undefined ? '1/1' : options.par }) };
  const project = { getActiveSequence: async () => sequence,
    lockedAccess: fn => { locked = true; try { assert.equal(fn(), undefined); } finally { locked = false; } },
    executeTransaction: fn => {
      assert.equal(locked, true);
      const actions = [];
      inTransaction = true;
      try {
        assert.equal(fn({ addAction: a => actions.push(a) }), undefined, 'Transaction callback must remain synchronous');
        if (options.declineTransaction) return false;
        actions.forEach(a => a()); transactions++; return true;
      } finally { inTransaction = false; }
    } };
  const ppro = { PointF, VideoClipTrackItem, Project: { getActiveProject: async () => project },
    ClipProjectItem: { cast: () => ({ isSequence: async () => false,
      getMediaFilePath: async () => options.mediaPath || 'C:\\media\\logo.png',
      getFootageInterpretation: async () => ({ getPixelAspectRatio: () => 1,
        getIgnoreAlpha: () => Boolean(options.ignoreAlpha), getInvertAlpha: () => Boolean(options.invertAlpha) }) }) },
    Metadata: { getProjectMetadata: async () => options.missingSize ? '' : '<x:Column.Intrinsic.VideoInfo>3840 x 2160 (1.0)</x:Column.Intrinsic.VideoInfo>', getXMPMetadata: async () => '' },
    TickTime: { createWithSeconds: seconds => ({ seconds }) }, Constants: {
      InterpolationMode: { LINEAR: 1, HOLD: 2 }, PixelAspectRatio: { SQUARE: 'square-preset', DVNTSC: 'ntsc-preset' }
    } };
  const alpha = { bounds: async (path, size, threshold, invert) => {
    if (options.alphaError) throw new Error(options.alphaError);
    assert.equal(path, options.mediaPath || 'C:\\media\\logo.png');
    assert.equal(threshold, 50); assert.equal(invert, Boolean(options.invertAlpha));
    return { x: 128, y: 240, width: 512, height: 600 };
  } };
  const context = { module: { exports: {} }, require: name => name === 'premierepro' ? ppro : name === './anchoralpha.js' ? alpha : math, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'panel', 'premiere-anchor.js'), 'utf8'), context);
  return { host: context.module.exports, params, transformParams, transactions: () => transactions, creations: () => creations };
}
test('host applies source/sequence normalization in one transaction and reads back values', async () => {
  const f = fixture();
  const result = await f.host.apply({ mode: 'clip', uv: [0, 0] });
  assert.equal(result.count, 1);
  assert.equal(f.transactions(), 1);
  assert.deepEqual(Array.from(f.params[5].stored()), [0, 0]);
  assert.deepEqual(Array.from(f.params[0].stored()), [0, 0]);
});
test('host offsets every existing Position key without moving key times', async () => {
  const f = fixture({ keys: [[3, [0.25, 0.25]], [5, [0.5, 0.5]]] });
  const result = await f.host.apply({ mode: 'clip', uv: [1, 1] });
  assert.equal(result.keys, 2);
  assert.equal(f.transactions(), 1);
  assert.deepEqual(Array.from(f.params[0].keys.keys()), [3, 5]);
  assert.deepEqual(Array.from(f.params[0].keys.get(3)), [0.75, 0.75]);
  assert.deepEqual(Array.from(f.params[0].keys.get(5)), [1, 1]);
});
test('unsupported animation, curves, retiming and missing dimensions produce zero writes', async () => {
  for (const options of [{ animatedScale: true }, { keys: [[3, [0.5, 0.5]]], interpolation: 5 }, { speed: 2 }, { missingSize: true }]) {
    const f = fixture(options);
    await assert.rejects(() => f.host.apply({ mode: 'clip', uv: [0, 0] }));
    assert.equal(f.transactions(), 0);
  }
});
test('host save captures sequence-space anchor location', async () => {
  const f = fixture();
  const saved = await f.host.save();
  assert.deepEqual(Array.from(saved.world), [960, 540]);
  assert.equal(f.transactions(), 0);
});
test('host accepts the SDK square-pixel preset and localized ratios', async () => {
  for (const par of ['square-preset', '1,0', '1:1', 'Square Pixels (1.0)']) {
    const f = fixture({ par });
    const result = await f.host.apply({ mode: 'clip', uv: [0, 0] });
    assert.equal(result.count, 1);
    assert.equal(f.transactions(), 1);
  }
});
test('unsupported aspect presets still stop before any project writes', async () => {
  for (const par of ['ntsc-preset', '1.333', 'not-a-preset']) {
    const f = fixture({ par });
    await assert.rejects(() => f.host.apply({ mode: 'clip', uv: [0, 0] }), /Unsupported sequence pixel aspect/);
    assert.equal(f.transactions(), 0);
  }
});
test('Premiere 26.3+ action and keyframe creation stays inside both write scopes', async () => {
  for (const options of [{}, { keys: [[3, [0.25, 0.25]], [5, [0.5, 0.5]]] }]) {
    const f = fixture(options);
    await f.host.apply({ mode: 'clip', uv: [0, 0] });
    assert.ok(f.creations() >= 4);
    assert.equal(f.transactions(), 1);
  }
});
test('a declined transaction leaves Anchor and Position unchanged', async () => {
  const f = fixture({ declineTransaction: true });
  await assert.rejects(() => f.host.apply({ mode: 'clip', uv: [0, 0] }), /declined the transaction/);
  assert.equal(f.transactions(), 0);
  assert.deepEqual(f.params[5].stored(), [0.5, 0.5]);
  assert.deepEqual(f.params[0].stored(), [0.5, 0.5]);
});
test('PNG Alpha Mode uses visible bounds and compensates Position in one locked transaction', async () => {
  const f = fixture({ invertAlpha: true });
  const result = await f.host.apply({ mode: 'clip', uv: [0, 0], alpha: true, threshold: 50 });
  assert.equal(result.alpha, true); assert.equal(f.transactions(), 1);
  assert.deepEqual(Array.from(f.params[5].stored()), [128 / 3840, 240 / 2160]);
  assert.ok(Math.abs(f.params[0].stored()[0] - 64 / 1920) < 1e-9);
  assert.ok(Math.abs(f.params[0].stored()[1] - 120 / 1080) < 1e-9);
});
test('cancelled PNG access, unsupported media and ignored alpha make no edits', async () => {
  for (const options of [{ alphaError: 'PNG access cancelled' }, { mediaPath: 'C:\\media\\clip.mp4' }, { ignoreAlpha: true }]) {
    const f = fixture(options);
    await assert.rejects(() => f.host.apply({ mode: 'clip', uv: [0, 0], alpha: true, threshold: 50 }));
    assert.equal(f.transactions(), 0);
  }
});
test('Sequence mode does not read PNG alpha even when the remembered toggle is on', async () => {
  const f = fixture({ mediaPath: 'C:\\media\\clip.mp4', alphaError: 'must not read this' });
  const result = await f.host.apply({ mode: 'sequence', uv: [0, 0], alpha: true, threshold: 50 });
  assert.equal(result.alpha, false); assert.equal(f.transactions(), 1);
});
test('selection changes during PNG authorization stop before writing any edit actions', async () => {
  const f = fixture({ changeSelection: true });
  await assert.rejects(() => f.host.apply({ mode: 'clip', uv: [0, 0], alpha: true, threshold: 50 }), /selection or clip settings changed/);
  assert.equal(f.transactions(), 0); assert.equal(f.creations(), 0);
});
test('Transform target changes only its own Anchor and Position in source coordinates', async () => {
  const f = fixture({ hasTransform: true });
  const beforeMotion = f.params.map(p => p.stored());
  const result = await f.host.apply({ mode: 'clip', target: 'transform', uv: [0, 0] });
  assert.equal(result.target, 'transform'); assert.equal(f.transactions(), 1);
  assert.deepEqual(Array.from(f.transformParams[0].stored()), [0, 0]);
  assert.deepEqual(Array.from(f.transformParams[1].stored()), [0, 0]);
  assert.deepEqual(f.params.map(p => p.stored()), beforeMotion);
  assert.equal(f.transformParams[8].stored(), 73); assert.equal(f.transformParams[10].stored(), 180);
});
test('Transform compensation remains local under scaled and rotated Motion', async () => {
  const f = fixture({ hasTransform: true, transformScale: 50, transformRotation: 90,
    motionScale: 70, motionWidth: 40, motionUniform: false, motionRotation: 31 });
  await f.host.apply({ mode: 'clip', target: 'transform', uv: [0, 0] });
  const position = f.transformParams[1].stored();
  assert.ok(Math.abs(position[0] - 2460 / 3840) < 1e-9);
  assert.ok(Math.abs(position[1] - 120 / 2160) < 1e-9);
});
test('Transform sequence placement converts the world target through Motion', async () => {
  const f = fixture({ hasTransform: true, motionPosition: [0.75, 0.25] });
  await f.host.apply({ mode: 'sequence', target: 'transform', uv: [0, 0] });
  const position = f.transformParams[1].stored();
  assert.ok(Math.abs(position[0] + 0.25) < 1e-9); assert.ok(Math.abs(position[1] - 0.25) < 1e-9);
});
test('Motion target does not write to an existing Transform effect', async () => {
  const f = fixture({ hasTransform: true });
  const before = f.transformParams.map(p => p.stored());
  await f.host.apply({ mode: 'clip', target: 'motion', uv: [1, 1] });
  assert.deepEqual(f.transformParams.map(p => p.stored()), before);
});
test('missing/multiple Transform effects, skew, animated Motion and unknown targets stop before writes', async () => {
  for (const options of [{}, { hasTransform: true, duplicateTransform: true }, { hasTransform: true, skew: 10 },
    { hasTransform: true, animatedScale: true }, { hasTransform: true, animatedTransformScale: true }]) {
    const f = fixture(options);
    await assert.rejects(() => f.host.apply({ mode: 'clip', target: 'transform', uv: [0, 0] }));
    assert.equal(f.transactions(), 0); assert.equal(f.creations(), 0);
  }
  await assert.rejects(() => fixture().host.apply({ mode: 'clip', target: 'unknown', uv: [0, 0] }), /Unknown effect/);
});
test('Transform Position keyframes keep their times and get a source-normalized offset', async () => {
  const f = fixture({ hasTransform: true, transformKeys: [[3, [0.25, 0.25]], [5, [0.5, 0.5]]] });
  const result = await f.host.apply({ mode: 'clip', target: 'transform', uv: [1, 1] });
  assert.equal(result.keys, 2); assert.equal(f.transactions(), 1);
  assert.deepEqual(Array.from(f.transformParams[1].keys.keys()), [3, 5]);
  assert.deepEqual(Array.from(f.transformParams[1].keys.get(3)), [0.75, 0.75]);
  assert.deepEqual(Array.from(f.transformParams[1].keys.get(5)), [1, 1]);
});
test('Transform saves a shared sequence-space anchor and supports PNG Alpha bounds', async () => {
  const f = fixture({ hasTransform: true, transformPosition: [0.25, 0.75] });
  const saved = await f.host.save({ target: 'transform' });
  assert.deepEqual(Array.from(saved.world), [480, 810]);
  const alpha = fixture({ hasTransform: true });
  const result = await alpha.host.apply({ mode: 'clip', target: 'transform', uv: [0, 0], alpha: true, threshold: 50 });
  assert.equal(result.alpha, true); assert.equal(result.target, 'transform');
  assert.deepEqual(Array.from(alpha.transformParams[0].stored()), [128 / 3840, 240 / 2160]);
  assert.deepEqual(Array.from(alpha.transformParams[1].stored()), [128 / 3840, 240 / 2160]);
});
test('Transform fixed-order mapping works with localized parameter names', async () => {
  const f = fixture({ hasTransform: true, localizedTransform: true });
  await f.host.apply({ mode: 'clip', target: 'transform', uv: [0, 0] });
  assert.deepEqual(Array.from(f.transformParams[0].stored()), [0, 0]);
  assert.deepEqual(Array.from(f.transformParams[1].stored()), [0, 0]);
});
