/**
 * chart.js — the shaping layer between `analytics.js` and the SVG.
 *
 * Pure: numbers in, numbers out. No DOM, no colours, no state. Everything
 * here exists because a chart drawn straight from a true total is often an
 * unreadable chart, and the corrections that fix that are exactly the kind of
 * thing that should be tested rather than eyeballed once in a browser.
 *
 * Three corrections live here, and each is a deliberate, bounded lie about
 * the geometry — never about the number, which is always printed as it is:
 *
 *   - a slice too small to resolve is folded into "Other";
 *   - a slice that survives is still given a minimum legible arc;
 *   - a period too long to draw one bar per day is bucketed into weeks.
 */

import { niceTicks } from './analytics.js';

/* --------------------------------------------------------- small slices */

/** The id the grouped slice carries. Not a category id — no category owns it. */
export const OTHER_SLICE_ID = '__other';

/** Below this share of the total, a slice is not worth its own arc. */
export const TINY_SHARE = 0.03;

/** Beyond this many named slices, the ring stops being readable. */
export const MAX_SLICES = 7;

/**
 * Fold the tail of a ranked list into one "Other" slice.
 *
 * A row joins the tail if it is below `tinyShare` of the total *or* ranked
 * beyond `maxSlices`. The one refusal worth stating: a tail of exactly one
 * row is left alone. Hiding a single named category behind the word "Other"
 * costs the reader information and saves them nothing — the arc is the same
 * size either way.
 *
 * Shares are computed against the original total, so they still sum to 1 and
 * the grouped slice's share is exactly the sum of its members'.
 *
 * @param {{categoryId: string, totalPaise: number}[]} rows descending by amount
 * @returns {{slices: object[], other: object|null}} `other` is also the last
 *   entry of `slices` when one was made, carrying its `members`.
 */
export function groupSmallSlices(rows = [], opts = {}) {
  const { tinyShare = TINY_SHARE, maxSlices = MAX_SLICES } = opts;
  const total = rows.reduce((sum, r) => sum + Math.max(0, r.totalPaise), 0);
  if (total <= 0) return { slices: [], other: null };

  const withShare = rows.map((r) => ({ ...r, share: r.totalPaise / total }));
  const keep = [];
  const tail = [];
  for (const row of withShare) {
    if (row.share < tinyShare || keep.length >= maxSlices) tail.push(row);
    else keep.push(row);
  }

  // One straggler is named, not hidden. See the note above.
  if (tail.length < 2) return { slices: withShare, other: null };

  const otherPaise = tail.reduce((sum, r) => sum + r.totalPaise, 0);
  const other = {
    categoryId: OTHER_SLICE_ID,
    totalPaise: otherPaise,
    count: tail.reduce((sum, r) => sum + (r.count ?? 0), 0),
    share: otherPaise / total,
    members: tail,
  };
  return { slices: [...keep, other], other };
}

/* --------------------------------------------------- minimum legible arc */

/** Below roughly this fraction of the ring, an arc is a hairline. */
export const MIN_ARC_SHARE = 0.02;

/**
 * Raise every positive value to at least `minShare` of the total, taking the
 * difference from the values above it, in proportion to their size.
 *
 * This is what stops a 0.4% slice from disappearing. The total is preserved
 * exactly, so the ring still closes; what changes is that the largest slices
 * each give up a sliver rather than one slice being invisible. The printed
 * amount and percentage always come from the true value — this touches the
 * geometry and nothing else.
 *
 * A donor pushed under the floor by donating joins the floored set on the
 * next pass, so the correction never trades one invisible slice for another.
 * The set only grows, so the loop terminates. When there are so many positive
 * values that flooring them all would need more than the whole ring, no
 * arrangement satisfies the floor and the ring is split equally — the honest
 * degenerate answer, and the same shape of answer the weight scale gives.
 *
 * @param {number[]} values non-negative; zeros stay zero and take no arc
 * @returns {number[]} same length, same order, same sum
 */
export function enforceMinShare(values = [], minShare = MIN_ARC_SHARE) {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  if (total <= 0) return clean;

  const positives = clean.filter((v) => v > 0).length;
  const equalSplit = () => clean.map((v) => (v > 0 ? total / positives : 0));
  if (positives * minShare >= 1) return equalSplit();

  const floor = total * minShare;
  const floored = new Set();
  let out = clean.slice();

  for (let pass = 0; pass < clean.length; pass += 1) {
    let added = false;
    out.forEach((v, i) => {
      if (v > 0 && !floored.has(i) && v < floor) {
        floored.add(i);
        added = true;
      }
    });
    if (!added) break;

    // Donors are always reflowed from the original values, not from the
    // previous pass's output, so repeated passes cannot compound a shrink.
    const donorTotal = clean.reduce((sum, v, i) => (v > 0 && !floored.has(i) ? sum + v : sum), 0);
    if (donorTotal <= 0) return equalSplit();

    const remaining = total - floored.size * floor;
    out = clean.map((v, i) => {
      if (v <= 0) return 0;
      return floored.has(i) ? floor : (v / donorTotal) * remaining;
    });
  }
  return out;
}

/* ---------------------------------------------------------------- buckets */

/** Beyond this many days, one bar per day is a picket fence, not a chart. */
export const MAX_DAILY_BARS = 62;

/** How many days one bar covers, for a period of `dayCount` days. */
export const barSpanFor = (dayCount) => (dayCount > MAX_DAILY_BARS ? 7 : 1);

/**
 * Group a zero-filled daily series into fixed-width buckets, aligned to the
 * start of the series.
 *
 * Alignment is to the range, not to the calendar week: buckets restarting on
 * every Monday would give a six-month view a short first bar that means
 * nothing. The last bucket is short whenever the range does not divide
 * evenly — that is true of the range, so it is drawn as it is, and `days`
 * reports it so a caller can say so.
 *
 * @param {{date: string, totalPaise: number}[]} days
 * @returns {{start: string, end: string, totalPaise: number, days: number}[]}
 */
export function bucketDays(days = [], span = 1) {
  const size = Math.max(1, Math.trunc(span));
  if (size === 1) {
    return days.map((d) => ({
      start: d.date, end: d.date, totalPaise: d.totalPaise, days: 1,
    }));
  }
  const out = [];
  for (let i = 0; i < days.length; i += size) {
    const chunk = days.slice(i, i + size);
    out.push({
      start: chunk[0].date,
      end: chunk[chunk.length - 1].date,
      totalPaise: chunk.reduce((sum, d) => sum + d.totalPaise, 0),
      days: chunk.length,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ ticks */

/**
 * Axis ticks for a series that can go both ways.
 *
 * The zero line has to sit at zero, so the scale is symmetric: the nice-number
 * step is chosen from the larger extent and mirrored below the axis. A series
 * that never goes negative gets exactly what `niceTicks` would have given it,
 * which is what keeps the expense and income views identical to before.
 *
 * @returns {{step: number, min: number, max: number, ticks: number[]}}
 */
export function signedTicks(minValue, maxValue, targetCount = 4) {
  const extent = Math.max(Math.abs(minValue ?? 0), Math.abs(maxValue ?? 0));
  const positive = niceTicks(extent, targetCount);
  if ((minValue ?? 0) >= 0) return { ...positive, min: 0 };

  const negatives = positive.ticks.filter((t) => t > 0).map((t) => -t).reverse();
  return {
    step: positive.step,
    min: -positive.max,
    max: positive.max,
    ticks: [...negatives, ...positive.ticks],
  };
}

/* ------------------------------------------------------------------ shade */

/** The deepest a slice is taken toward the ink. Past this the hue is gone. */
const SHADE_SPAN = 54;
const SHADE_STEP = 11;

/**
 * How far slice `index` of `count` is mixed toward the ink, as a percentage.
 *
 * Two things at once. It gives the ring a luminance ramp, so neighbouring
 * slices differ in value and not in hue alone — which is what a greyscale
 * print, or a viewer who cannot separate the hues, is left with. And it ramps
 * in the direction that helps: the tail slices are the thin ones, and a thin
 * arc in a deeper ink reads better against the page than a pale one, never
 * worse. Mixing toward the ink can only raise contrast against the ground,
 * in either theme, which is why it is never mixed toward the page.
 *
 * Identity never rests on this. Every slice is named in the ranked list
 * directly below the ring, with the same swatch, its amount and its share.
 */
export function shadeFor(index, count) {
  if (count <= 1) return 0;
  const step = Math.min(SHADE_STEP, SHADE_SPAN / (count - 1));
  return Math.round(Math.min(SHADE_SPAN, index * step));
}
