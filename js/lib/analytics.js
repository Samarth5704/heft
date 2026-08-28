/**
 * analytics.js — every function here is pure and takes the expense array as an
 * argument. Nothing reads global state, nothing touches the DOM, nothing reads
 * a clock (today is always passed in). That is what makes them testable.
 *
 * All money in, all money out, is integer paise.
 */

import { sumPaise } from './money.js';
import {
  addDays, compare, datesInMonth, daysInMonthOf, monthKey, monthKeyParts,
  addMonths, dayOfWeek, parts,
} from './dates.js';

/* ------------------------------------------------------------------ totals */

export function totalPaise(expenses = []) {
  return sumPaise(expenses, (e) => e.amountPaise);
}

/** Only the expenses inside a 'YYYY-MM' month. */
export function inMonth(expenses = [], key) {
  return expenses.filter((e) => monthKey(e.date) === key);
}

/**
 * Totals per category, largest first.
 * @returns {{categoryId: string, totalPaise: number, count: number, share: number}[]}
 */
export function byCategory(expenses = []) {
  const map = new Map();
  for (const e of expenses) {
    const row = map.get(e.categoryId) ?? { categoryId: e.categoryId, totalPaise: 0, count: 0 };
    row.totalPaise += e.amountPaise;
    row.count += 1;
    map.set(e.categoryId, row);
  }
  const total = totalPaise(expenses);
  return [...map.values()]
    .map((row) => ({ ...row, share: total ? row.totalPaise / total : 0 }))
    .sort((a, b) => b.totalPaise - a.totalPaise || compare(a.categoryId, b.categoryId));
}

export function byPaymentMethod(expenses = []) {
  const map = new Map();
  for (const e of expenses) {
    const k = e.paymentMethod || 'unknown';
    map.set(k, (map.get(k) ?? 0) + e.amountPaise);
  }
  return [...map.entries()]
    .map(([method, paise]) => ({ method, totalPaise: paise }))
    .sort((a, b) => b.totalPaise - a.totalPaise);
}

/** One entry per calendar day of the month, zero-filled. */
export function dailyTotals(expenses = [], key) {
  const dates = datesInMonth(key);
  const map = new Map(dates.map((d) => [d, 0]));
  for (const e of expenses) {
    if (map.has(e.date)) map.set(e.date, map.get(e.date) + e.amountPaise);
  }
  return dates.map((date) => ({ date, totalPaise: map.get(date) }));
}

/**
 * Daily totals across an arbitrary inclusive date range, zero-filled.
 * The rolling average needs the days *before* a month starts, or the line
 * would restart from nothing on the first of every month.
 */
export function dailyTotalsBetween(expenses = [], startISO, endISO) {
  if (!startISO || !endISO || compare(startISO, endISO) > 0) return [];
  const map = new Map();
  for (let d = startISO; compare(d, endISO) <= 0; d = addDays(d, 1)) map.set(d, 0);
  for (const e of expenses) {
    if (map.has(e.date)) map.set(e.date, map.get(e.date) + e.amountPaise);
  }
  return [...map.entries()].map(([date, totalPaise]) => ({ date, totalPaise }));
}

/** Group into day buckets, newest day first, for the ledger. */
export function groupByDay(expenses = []) {
  const map = new Map();
  for (const e of expenses) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return [...map.entries()]
    .sort((a, b) => compare(b[0], a[0]))
    .map(([date, items]) => ({
      date,
      // Stable order inside a day: newest entry first, id as the tiebreak.
      expenses: items.slice().sort(
        (a, b) => compare(b.createdAt ?? '', a.createdAt ?? '') || compare(a.id, b.id),
      ),
      totalPaise: totalPaise(items),
    }));
}

export function topExpenses(expenses = [], limit = 5) {
  return expenses
    .slice()
    .sort((a, b) => b.amountPaise - a.amountPaise || compare(b.date, a.date))
    .slice(0, limit);
}

/* -------------------------------------------------------------- statistics */

/** Median of a number list. Even counts average the middle pair. */
export function median(values = []) {
  const nums = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

export function mean(values = []) {
  const nums = values.filter(Number.isFinite);
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/**
 * How many days of a month have happened, counting today as elapsed.
 * A future month is 0; a past month is the whole month.
 */
export function daysElapsed(key, todayISO) {
  const m = monthKeyParts(key);
  const t = parts(todayISO);
  if (!m || !t) return 0;
  const todayKey = monthKey(todayISO);
  if (key < todayKey) return daysInMonthOf(m.year, m.month);
  if (key > todayKey) return 0;
  return t.day;
}

/**
 * Mean vs median daily spend for a month — the comparison this app exists to
 * surface. The denominator is *days elapsed*, not days with an expense: a day
 * you spent nothing is a real day, and dropping it flatters both numbers.
 * Mean is dragged up by rent and EMIs; median is what an ordinary day costs.
 */
export function dailySpendStats(expenses = [], key, todayISO) {
  const elapsed = daysElapsed(key, todayISO);
  const series = dailyTotals(inMonth(expenses, key), key)
    .slice(0, elapsed)
    .map((d) => d.totalPaise);
  return {
    days: elapsed,
    meanPaise: mean(series),
    medianPaise: median(series),
    totalPaise: sumPaise(series),
  };
}

/**
 * Trailing average over `window` points.
 * At the start of the series the window is incomplete; we average over the
 * points that exist rather than emitting null, so the line starts at the
 * first data point instead of floating in from nowhere.
 */
export function rollingAverage(series = [], window = 30) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < series.length; i += 1) {
    sum += series[i];
    if (i >= window) sum -= series[i - window];
    const n = Math.min(i + 1, window);
    out.push(Math.round(sum / n));
  }
  return out;
}

/** Totals for the last `count` months ending at `key`, oldest first. */
export function monthOverMonth(expenses = [], key, count = 6) {
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) keys.push(addMonths(key, -i));
  const map = new Map(keys.map((k) => [k, 0]));
  for (const e of expenses) {
    const k = monthKey(e.date);
    if (map.has(k)) map.set(k, map.get(k) + e.amountPaise);
  }
  return keys.map((k) => ({ monthKey: k, totalPaise: map.get(k) }));
}

/** Month total plus the delta against the previous month. */
export function monthDelta(expenses = [], key) {
  const current = totalPaise(inMonth(expenses, key));
  const previousKey = addMonths(key, -1);
  const previous = totalPaise(inMonth(expenses, previousKey));
  const deltaPaise = current - previous;
  return {
    monthKey: key,
    previousKey,
    totalPaise: current,
    previousPaise: previous,
    deltaPaise,
    // No previous spend means no meaningful percentage — say so, don't print Infinity.
    deltaPercent: previous ? (deltaPaise / previous) * 100 : null,
    direction: deltaPaise > 0 ? 'up' : deltaPaise < 0 ? 'down' : 'flat',
  };
}

/** Weekend (Sat/Sun) vs weekday average daily spend. */
export function weekendSkew(expenses = [], key) {
  const days = dailyTotals(inMonth(expenses, key), key);
  const weekend = [];
  const weekday = [];
  for (const d of days) {
    const dow = dayOfWeek(d.date);
    (dow === 0 || dow === 6 ? weekend : weekday).push(d.totalPaise);
  }
  const weekendMean = mean(weekend);
  const weekdayMean = mean(weekday);
  return {
    weekendMeanPaise: weekendMean,
    weekdayMeanPaise: weekdayMean,
    ratio: weekdayMean ? weekendMean / weekdayMean : null,
  };
}

/* ------------------------------------------------------------ budget pace */

/**
 * Projected month-end spend = spend / daysElapsed * daysInMonth.
 * Zero days elapsed returns null rather than dividing by zero.
 */
export function projectMonthEnd(spentPaise, elapsed, inMonthDays) {
  if (!elapsed || elapsed <= 0) return null;
  return Math.round((spentPaise / elapsed) * inMonthDays);
}

/**
 * Budget pace for one category (or the month as a whole).
 *
 *   expectedSpend = budget × (daysElapsed / daysInMonth)
 *
 * `daysElapsed` counts today as elapsed. For a past month pace is meaningless,
 * so the status is 'final' and the result is what actually happened.
 * 'on-track' is a band, not a knife edge: within 2% of the budget either way.
 */
export function pace({ budgetPaise, spentPaise, monthKey: key, today }) {
  const m = monthKeyParts(key);
  const total = m ? daysInMonthOf(m.year, m.month) : 0;
  const elapsed = daysElapsed(key, today);
  const isPast = key < monthKey(today);
  const isFuture = key > monthKey(today);
  const projectedPaise = projectMonthEnd(spentPaise, elapsed, total);

  const base = {
    budgetPaise: budgetPaise ?? null,
    spentPaise,
    daysElapsed: elapsed,
    daysInMonth: total,
    isPast,
    isFuture,
    projectedPaise,
    expectedPaise: null,
    deltaPaise: 0,
    remainingPaise: null,
    ratio: null,
    status: 'no-budget',
  };

  if (budgetPaise === null || budgetPaise === undefined) return base;

  const expectedPaise = total ? Math.round(budgetPaise * (elapsed / total)) : 0;
  const deltaPaise = spentPaise - expectedPaise;
  const tolerance = Math.round(budgetPaise * 0.02);

  let status;
  if (isPast) status = spentPaise > budgetPaise ? 'over' : 'under';
  else if (isFuture) status = 'upcoming';
  else if (Math.abs(deltaPaise) <= tolerance) status = 'on-track';
  else status = deltaPaise > 0 ? 'ahead' : 'behind';

  return {
    ...base,
    expectedPaise,
    deltaPaise,
    remainingPaise: budgetPaise - spentPaise,
    ratio: budgetPaise ? spentPaise / budgetPaise : null,
    status,
  };
}

/** Per-category budget report for a month, plus the unbudgeted remainder. */
export function budgetReport(expenses = [], categories = [], key, today) {
  const monthExpenses = inMonth(expenses, key);
  const spentBy = new Map(byCategory(monthExpenses).map((r) => [r.categoryId, r.totalPaise]));

  const rows = categories.map((cat) => ({
    categoryId: cat.id,
    name: cat.name,
    budgetPaise: cat.budgetPaise ?? null,
    ...pace({
      budgetPaise: cat.budgetPaise ?? null,
      spentPaise: spentBy.get(cat.id) ?? 0,
      monthKey: key,
      today,
    }),
  }));

  const budgeted = rows.filter((r) => r.budgetPaise !== null);
  const unbudgetedPaise = sumPaise(
    rows.filter((r) => r.budgetPaise === null),
    (r) => r.spentPaise,
  );
  const overallBudget = budgeted.length ? sumPaise(budgeted, (r) => r.budgetPaise) : null;

  return {
    rows,
    budgeted,
    unbudgetedPaise,
    /**
     * The overall row compares budgeted spend against budgeted money — not
     * the whole month against a plan that only covers part of it, which would
     * guarantee an overrun and double-count what `unbudgetedPaise` already
     * reports. The two figures add up to the month total.
     */
    overall: pace({
      budgetPaise: overallBudget,
      spentPaise: sumPaise(budgeted, (r) => r.spentPaise),
      monthKey: key,
      today,
    }),
    monthTotalPaise: totalPaise(monthExpenses),
  };
}

/* ------------------------------------------------------- the weight scale */

/**
 * Percentile of a sorted numeric array, linearly interpolated (the R-7 /
 * spreadsheet definition).
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const HALF = 0.5;

/**
 * The Heft weight scale.
 *
 * Linear scaling fails: rent is 400x a chai, so on a linear ramp everything
 * that is not rent collapses to the same invisible weight. Instead we map the
 * *logarithm* of each amount onto [0,1] between the 5th and 95th percentile of
 * the currently visible set, and clamp. Percentile bounds mean a single
 * outlier cannot crush the rest of the list, and clamping means the outlier
 * still reads as the heaviest thing on screen.
 *
 * Because the bounds come from the visible set, the topography re-normalises
 * on every filter change — filter to one category and small differences inside
 * it become legible instead of flattening.
 *
 * Degenerate cases (empty, one expense, all-identical amounts) resolve to 0.5:
 * a middle weight, never a division by zero.
 *
 * @param {number[]} amounts positive integer paise
 * @returns {{p5:number, p95:number, degenerate:boolean, t:(n:number)=>number}}
 */
export function weightScale(amounts = []) {
  const positive = amounts.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);

  if (positive.length < 2) {
    return { p5: positive[0] ?? 0, p95: positive[0] ?? 0, degenerate: true, t: () => HALF };
  }

  const p5 = percentile(positive, 0.05);
  const p95 = percentile(positive, 0.95);
  const lo = Math.log(p5);
  const hi = Math.log(p95);

  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo === 0) {
    return { p5, p95, degenerate: true, t: () => HALF };
  }

  const span = hi - lo;
  return {
    p5,
    p95,
    degenerate: false,
    t(amount) {
      if (!Number.isFinite(amount) || amount <= 0) return 0;
      const raw = (Math.log(amount) - lo) / span;
      return Math.min(1, Math.max(0, raw));
    },
  };
}

/** Round a value up to the nearest 1/2/5 x 10^n. */
function niceNumber(range, round) {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let nice;
  if (round) {
    if (fraction < 1.5) nice = 1;
    else if (fraction < 3) nice = 2;
    else if (fraction < 7) nice = 5;
    else nice = 10;
  } else if (fraction <= 1) nice = 1;
  else if (fraction <= 2) nice = 2;
  else if (fraction <= 5) nice = 5;
  else nice = 10;
  return nice * 10 ** exponent;
}

/**
 * Axis ticks by the "nice numbers" algorithm — round the range to a 1/2/5x10^n
 * step so labels read as 0 / 1,000 / 2,000, not as max/5 = 3,847.
 */
export function niceTicks(maxValue, targetCount = 5) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return { step: 1, max: 1, ticks: [0, 1] };
  const step = niceNumber(niceNumber(maxValue, false) / Math.max(1, targetCount), true);
  const max = Math.ceil(maxValue / step) * step;
  const ticks = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(Math.round(v));
  return { step, max, ticks };
}
