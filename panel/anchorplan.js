// The Anchor page's geometry (0.10.69): Anchor Studio's core.js (github kaloyankera-rgb/anchor-studio 0.3.1, the user's own panel),
// brought into Asistent unchanged: where a clip's anchor point goes on a 3x3 grid (or any point) of its own bounds, the
// sequence frame or the selection, and the Position that keeps the picture where it is. Pure, tested in node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnchorMath = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function finite(v, label) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(label + ' must be a finite number.');
    return v;
  }
  function point(v) {
    if (!Array.isArray(v) || v.length !== 2) throw new Error('Expected a two-dimensional point.');
    return [finite(v[0], 'X'), finite(v[1], 'Y')];
  }
  function size(v) {
    point(v);
    if (v[0] <= 0 || v[1] <= 0) throw new Error('Frame dimensions must be positive.');
    return v;
  }
  function decimal(value) {
    if (typeof value === 'number') return finite(value, 'Value');
    const text = String(value).trim();
    if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) throw new Error('Enter a valid number, such as 50 or 48,5.');
    return finite(Number(text.replace(',', '.')), 'Value');
  }
  function squareSequenceAspect(raw, presets) {
    // SequenceSettings uses Premiere's PixelAspectRatio preset, which need
    // not be a numeric ratio. Compare the SDK constants before parsing text.
    if (presets && presets.SQUARE !== undefined) {
      if (raw === presets.SQUARE || String(raw) === String(presets.SQUARE)) return true;
      for (const name of ['DVNTSC', 'DVNTSCWide', 'DVPAL', 'DVPALWide', 'Anamorphic', 'HDAnamorphic1080', 'DVCProHD']) {
        if (presets[name] !== undefined && (raw === presets[name] || String(raw) === String(presets[name]))) return false;
      }
    }
    const text = String(raw).trim();
    if (/^square(?:\s+pixels?)?$/i.test(text)) return true;
    const ratio = text.match(/^(\d+(?:[.,]\d+)?)\s*[/:]\s*(\d+(?:[.,]\d+)?)$/);
    if (ratio) {
      const denominator = decimal(ratio[2]);
      return denominator > 0 && Math.abs(decimal(ratio[1]) / denominator - 1) < 0.0001;
    }
    try { return Math.abs(decimal(text) - 1) < 0.0001; } catch (_) { /* explicit display labels below */ }
    const labeled = text.match(/^square\s+pixels?\s*\((\d+(?:[.,]\d+)?)\)$/i);
    return Boolean(labeled && Math.abs(decimal(labeled[1]) - 1) < 0.0001);
  }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function matrix(scaleX, scaleY, degrees) {
    finite(scaleX, 'Horizontal scale'); finite(scaleY, 'Vertical scale'); finite(degrees, 'Rotation');
    const r = degrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [c * scaleX, s * scaleX, -s * scaleY, c * scaleY];
  }
  function transform(m, p) { return [m[0] * p[0] + m[2] * p[1], m[1] * p[0] + m[3] * p[1]]; }
  function multiply(a, b) {
    return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3]];
  }
  function inverse(m, p) {
    const d = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(d) < 1e-10) throw new Error('A zero-scale clip cannot use a sequence anchor.');
    return [(m[3] * p[0] - m[2] * p[1]) / d, (-m[1] * p[0] + m[0] * p[1]) / d];
  }
  function toWorld(clip, p) { return add(clip.position, transform(clip.matrix, sub(p, clip.anchor))); }
  function toSource(clip, p) { return add(clip.anchor, inverse(clip.matrix, sub(p, clip.position))); }
  function sourceBounds(clip) {
    const b = clip.bounds || { x: 0, y: 0, width: clip.size[0], height: clip.size[1] };
    [b.x, b.y, b.width, b.height].forEach(v => finite(v, 'Source bounds'));
    if (b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 || b.x + b.width > clip.size[0] || b.y + b.height > clip.size[1]) throw new Error('Invalid visible-pixel bounds.');
    return b;
  }
  function bounds(clips) {
    const points = [];
    clips.forEach(function (c) {
      size(c.size);
      const b = sourceBounds(c);
      [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].forEach(function (p) { points.push(toWorld(c, p)); });
    });
    if (!points.length) throw new Error('Select at least one video clip.');
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    return { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
      width: Math.max.apply(null, xs) - Math.min.apply(null, xs),
      height: Math.max.apply(null, ys) - Math.min.apply(null, ys) };
  }
  function plan(clips, frame, request) {
    size(frame);
    if (!clips.length) throw new Error('Select at least one video clip.');
    const uv = point(request.uv || [0.5, 0.5]);
    if (uv.some(v => v < 0 || v > 1)) throw new Error('Placement must be between 0% and 100%.');
    if (['clip', 'sequence', 'selection', 'saved'].indexOf(request.mode) < 0) throw new Error('Unknown reference area.');
    const box = request.mode === 'selection' ? bounds(clips) : null;
    let world = null;
    if (request.mode === 'sequence') world = [frame[0] * uv[0], frame[1] * uv[1]];
    if (box) world = [box.x + box.width * uv[0], box.y + box.height * uv[1]];
    if (request.mode === 'saved') world = point(request.world);
    return clips.map(function (c) {
      size(c.size); point(c.anchor); point(c.position);
      const b = sourceBounds(c);
      const target = world ? toSource(c, world) : [b.x + b.width * uv[0], b.y + b.height * uv[1]];
      const offset = transform(c.matrix, sub(target, c.anchor));
      return { anchor: target, offset: offset, position: add(c.position, offset),
        positionKeys: (c.positionKeys || []).map(k => ({ time: k.time, value: add(k.value, offset), interpolation: k.interpolation })) };
    });
  }
  function normalized(p, dimensions) { point(p); size(dimensions); return [p[0] / dimensions[0], p[1] / dimensions[1]]; }
  function pixels(p, dimensions) { point(p); size(dimensions); return [p[0] * dimensions[0], p[1] * dimensions[1]]; }
  function metadataSize(xml) {
    if (typeof xml !== 'string') return null;
    // Premiere's intrinsic video-info column carries the source raster dimensions.
    const vi = xml.match(/<(?:\w+:)?Column\.Intrinsic\.VideoInfo\b[^>]*>([^<]+)</i);
    let match = vi && vi[1].match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (!match) {
      const block = xml.match(/<(?:\w+:)?videoFrameSize\b[^>]*>([\s\S]*?)<\/(?:\w+:)?videoFrameSize>/i);
      if (block) {
        const w = block[1].match(/(?:\b\w+:)?w(?:\s*=\s*["']|\b[^>]*>)(\d+)/);
        const h = block[1].match(/(?:\b\w+:)?h(?:\s*=\s*["']|\b[^>]*>)(\d+)/);
        if (w && h) match = [null, w[1], h[1]];
      }
    }
    if (!match) return null;
    const result = [Number(match[1]), Number(match[2])];
    return result[0] > 0 && result[1] > 0 ? result : null;
  }
  return { point, size, decimal, squareSequenceAspect, add, sub, matrix, transform, multiply, inverse, toWorld, toSource, bounds, plan, normalized, pixels, metadataSize };
}));
