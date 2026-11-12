// The Anchor page's geometry (0.10.69): Anchor Studio's own tests (tests/core.test.cjs), unchanged but for the path
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../panel/anchorplan.js');
const near = (a, b) => a.forEach((n, i) => assert.ok(Math.abs(n - b[i]) < 1e-7, `${a} != ${b}`));
function clip(options = {}) { return Object.assign({ size: [3840, 2160], anchor: [1920, 1080], position: [960, 540], matrix: m.matrix(0.5, 0.5, 0), positionKeys: [] }, options); }

test('all nine anchors preserve every source point under rotation and nonuniform scale', () => {
  for (const angle of [-135, -30, 0, 90, 225]) for (const scales of [[0.25, 0.7], [1, 1], [2, 0.4]]) {
    const c = clip({ matrix: m.matrix(scales[0], scales[1], angle) });
    for (const x of [0, 0.5, 1]) for (const y of [0, 0.5, 1]) {
      const p = m.plan([c], [1920, 1080], { mode: 'clip', uv: [x, y] })[0];
      const updated = Object.assign({}, c, p);
      for (const sample of [[0, 0], [3840, 2160], [832, 251]]) near(m.toWorld(updated, sample), m.toWorld(c, sample));
    }
  }
});
test('sequence anchors map to one world point across different media sizes and rotations', () => {
  const clips = [clip(), clip({ size: [1080, 1920], position: [500, 400], matrix: m.matrix(0.7, 0.4, 35) })];
  const plans = m.plan(clips, [1920, 1080], { mode: 'sequence', uv: [1, 0] });
  plans.forEach((p, i) => { near(m.toWorld(clips[i], p.anchor), [1920, 0]); near(p.position, [1920, 0]); });
});
test('selection bounds include rotated corners, not only clip centers', () => {
  const clips = [clip({ size: [100, 50], anchor: [0, 0], position: [0, 0], matrix: m.matrix(1, 1, 90) }),
    clip({ size: [20, 20], anchor: [0, 0], position: [100, 100], matrix: m.matrix(1, 1, 0) })];
  const box = m.bounds(clips);
  near([box.x, box.y, box.width, box.height], [-50, 0, 170, 120]);
  const plans = m.plan(clips, [1920, 1080], { mode: 'selection', uv: [0.5, 0.5] });
  plans.forEach(p => near(p.position, [35, 60]));
});
test('all position keys receive a constant rotated pixel offset', () => {
  const c = clip({ positionKeys: [{ time: 'a', value: [10, 30], interpolation: 1 }, { time: 'b', value: [70, 90], interpolation: 2 }] });
  const p = m.plan([c], [1920, 1080], { mode: 'clip', uv: [0, 0] })[0];
  near(m.sub(p.positionKeys[1].value, p.positionKeys[0].value), [60, 60]);
  assert.equal(p.positionKeys[0].time, 'a');
  assert.equal(p.positionKeys[1].interpolation, 2);
});
test('saved anchors remain absolute world coordinates', () => {
  const c = clip({ position: [150, 240], matrix: m.matrix(0.8, 0.7, 60) });
  const p = m.plan([c], [1920, 1080], { mode: 'saved', world: [600, 1000] })[0];
  near(p.position, [600, 1000]);
});
test('normalization keeps source and sequence dimensions separate', () => {
  near(m.normalized([1920, 1080], [3840, 2160]), [0.5, 0.5]);
  near(m.normalized([1920, 1080], [1920, 1080]), [1, 1]);
});
test('invalid coordinates, unknown modes and singular inverse transforms are rejected', () => {
  assert.throws(() => m.plan([clip()], [1920, 1080], { mode: 'clip', uv: [NaN, 0] }));
  assert.throws(() => m.plan([clip()], [0, 1080], { mode: 'clip' }));
  assert.throws(() => m.plan([clip()], [1920, 1080], { mode: 'other' }));
  assert.throws(() => m.plan([clip({ matrix: m.matrix(0, 0, 0) })], [1920, 1080], { mode: 'sequence' }));
});
test('source dimensions are read from intrinsic and structured XMP metadata', () => {
  assert.deepEqual(m.metadataSize('<a:Column.Intrinsic.VideoInfo>3840 x 2160 (1.0)</a:Column.Intrinsic.VideoInfo>'), [3840, 2160]);
  assert.deepEqual(m.metadataSize('<xmpDM:videoFrameSize><rdf:Description stDim:w="1280" stDim:h="720" /></xmpDM:videoFrameSize>'), [1280, 720]);
  assert.equal(m.metadataSize('<noDimensions/>'), null);
});
test('pixel aspect checks compare SDK presets before assuming numeric ratios', () => {
  const presets = { SQUARE: 0, DVNTSC: 1 };
  assert.equal(m.squareSequenceAspect(0, presets), true);
  assert.equal(m.squareSequenceAspect('0', presets), true);
  assert.equal(m.squareSequenceAspect(1, presets), false);
  assert.equal(m.squareSequenceAspect('1,0', presets), true);
  assert.equal(m.squareSequenceAspect('1/1', presets), true);
  assert.equal(m.squareSequenceAspect('1:1', presets), true);
  assert.equal(m.squareSequenceAspect('1.333', presets), false);
  assert.equal(m.squareSequenceAspect('Square Pixels (1,0)', presets), true);
  assert.equal(m.squareSequenceAspect('', presets), false);
});
test('decimal inputs accept Premiere comma decimals without accepting malformed text', () => {
  assert.equal(m.decimal('48,0'), 48);
  assert.equal(m.decimal('67,4'), 67.4);
  assert.equal(m.decimal(50), 50);
  assert.equal(m.decimal(' 12.5 '), 12.5);
  for (const value of ['', '1,2,3', '50px', 'NaN', 'Infinity']) assert.throws(() => m.decimal(value));
});
test('visible clip bounds place anchors on the subject rather than the full raster', () => {
  const c = clip({ bounds: { x: 300, y: 200, width: 900, height: 600 } });
  const topLeft = m.plan([c], [1920, 1080], { mode: 'clip', uv: [0, 0] })[0];
  near(topLeft.anchor, [300, 200]);
  near(m.plan([c], [1920, 1080], { mode: 'clip', uv: [1, 1] })[0].anchor, [1200, 800]);
  near(m.toWorld(Object.assign({}, c, topLeft), [100, 200]), m.toWorld(c, [100, 200]));
});
test('selection bounds combine rotated visible rectangles', () => {
  const c = clip({ size: [100, 100], anchor: [0, 0], position: [0, 0], matrix: m.matrix(1, 1, 90),
    bounds: { x: 10, y: 20, width: 30, height: 40 } });
  const b = m.bounds([c]); near([b.x, b.y, b.width, b.height], [-60, 10, 40, 30]);
});
test('composed Transform and Motion preserve source points after anchor compensation', () => {
  const outer = { anchor: [1920, 1080], position: [750, 400], matrix: m.matrix(0.4, 0.7, 31) };
  const inner = { size: [3840, 2160], anchor: [1800, 1000], position: [1500, 1200], matrix: m.matrix(0.5, 1.2, 70) };
  const composed = Object.assign({}, inner, { position: m.toWorld(outer, inner.position), matrix: m.multiply(outer.matrix, inner.matrix) });
  const plan = m.plan([composed], [1920, 1080], { mode: 'clip', uv: [0, 0] })[0];
  const changedInner = Object.assign({}, inner, { anchor: plan.anchor, position: m.toSource(outer, plan.position) });
  for (const p of [[0, 0], [3840, 2160], [123, 456]]) near(m.toWorld(outer, m.toWorld(changedInner, p)), m.toWorld(outer, m.toWorld(inner, p)));
});
