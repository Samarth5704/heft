/**
 * geometry.js — arc maths for the hand-drawn charts.
 *
 * Pure: numbers in, path strings out. No DOM, no SVG elements. That is what
 * lets the awkward case — one category filling the whole ring — be tested
 * rather than discovered in the browser.
 *
 * Angles are degrees clockwise from twelve o'clock, which is how a donut is
 * read, not how Math.cos works. polarToCartesian does that rotation once.
 */

const round = (n) => Math.round(n * 100) / 100;

/** Degrees clockwise from 12 o'clock -> a point on the circle. */
export function polarToCartesian(cx, cy, r, angleDeg) {
  const radians = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(radians), y: cy + r * Math.sin(radians) };
}

/** One wedge of a ring, as a closed path. */
export function donutSegmentPath({ cx, cy, rOuter, rInner, startAngle, endAngle }) {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const o1 = polarToCartesian(cx, cy, rOuter, startAngle);
  const o2 = polarToCartesian(cx, cy, rOuter, endAngle);
  const i2 = polarToCartesian(cx, cy, rInner, endAngle);
  const i1 = polarToCartesian(cx, cy, rInner, startAngle);
  return [
    `M ${round(o1.x)} ${round(o1.y)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${round(o2.x)} ${round(o2.y)}`,
    `L ${round(i2.x)} ${round(i2.y)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${round(i1.x)} ${round(i1.y)}`,
    'Z',
  ].join(' ');
}

/**
 * A complete ring, for when one category is everything.
 *
 * The naive wedge breaks here: a sweep of exactly 360° puts the start and end
 * points on top of each other, and an SVG arc between two identical points
 * draws nothing at all — the chart silently disappears. Two half arcs per
 * edge, with fill-rule="evenodd" to punch out the hole, draw it correctly.
 */
export function donutRingPath({ cx, cy, rOuter, rInner }) {
  const ring = (r, sweep) => [
    `M ${round(cx)} ${round(cy - r)}`,
    `A ${r} ${r} 0 1 ${sweep} ${round(cx)} ${round(cy + r)}`,
    `A ${r} ${r} 0 1 ${sweep} ${round(cx)} ${round(cy - r)}`,
    'Z',
  ].join(' ');
  // Opposite sweep flags so evenodd leaves the middle empty.
  return `${ring(rOuter, 1)} ${ring(rInner, 0)}`;
}

const MIN_SWEEP = 0.6;

/**
 * Lay values out around a ring.
 *
 * @param {number[]} values non-negative, in draw order
 * @param {{cx, cy, rOuter, rInner, gapDegrees?}} opts
 * @returns {{index, value, fraction, startAngle, endAngle, path,
 *            isFullCircle: boolean}[]}
 */
export function donutSegments(values = [], opts = {}) {
  const {
    cx = 100, cy = 100, rOuter = 88, rInner = 56, gapDegrees = 1.2,
  } = opts;

  const positive = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = positive.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];

  const drawn = positive.filter((v) => v > 0).length;
  const gap = drawn > 1 ? gapDegrees : 0;

  const out = [];
  let cursor = 0;
  for (let i = 0; i < positive.length; i += 1) {
    const value = positive[i];
    const fraction = value / total;
    const startAngle = cursor;
    const endAngle = cursor + fraction * 360;
    cursor = endAngle;
    if (value <= 0) continue;

    const isFullCircle = drawn === 1;
    const from = startAngle + gap / 2;
    const to = Math.max(from + MIN_SWEEP, endAngle - gap / 2);

    out.push({
      index: i,
      value,
      fraction,
      startAngle,
      endAngle,
      isFullCircle,
      path: isFullCircle
        ? donutRingPath({ cx, cy, rOuter, rInner })
        : donutSegmentPath({ cx, cy, rOuter, rInner, startAngle: from, endAngle: to }),
    });
  }
  return out;
}

/** A polyline through points, as an SVG path. */
export function linePath(points = []) {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p.x)} ${round(p.y)}`)
    .join(' ');
}
