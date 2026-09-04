/**
 * dates.js — a date here is a 'YYYY-MM-DD' local-date string, never a Date.
 *
 * An expense happens on a calendar day, not at an instant. Timestamps drag in
 * timezone and DST arithmetic and produce off-by-one-day bugs. Every helper
 * below is pure and string-in / string-out. `Date` appears only inside
 * today() and the UTC arithmetic used to roll dates over month boundaries —
 * UTC because it has no DST, so adding 86400000ms is always exactly one day.
 */

export const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Is `y` a leap year? Gregorian rule: 2000 yes, 1900 no. */
export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Days in month, 1-indexed month. daysInMonthOf(2024, 2) === 29 */
export function daysInMonthOf(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Split 'YYYY-MM-DD' into parts, or null if it is not a real calendar date. */
export function parts(iso) {
  if (typeof iso !== 'string') return null;
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonthOf(year, month)) return null;
  return { year, month, day };
}

export function isValid(iso) {
  return parts(iso) !== null;
}

/** Build 'YYYY-MM-DD' from numbers, without validating. */
export function toISO(year, month, day) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The only place a clock is read. Normalised to a local-date string at once. */
export function today(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Days in the month containing `iso`. */
export function daysInMonth(iso) {
  const p = parts(iso) ?? parts(`${iso}-01`);
  return p ? daysInMonthOf(p.year, p.month) : 0;
}

/** Add (or subtract) whole days. Rolls across months, years and leap days. */
export function addDays(iso, n) {
  const p = parts(iso);
  if (!p) return null;
  const t = Date.UTC(p.year, p.month - 1, p.day) + n * 86400000;
  const d = new Date(t);
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function diffDays(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return 0;
  const ta = Date.UTC(pa.year, pa.month - 1, pa.day);
  const tb = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((tb - ta) / 86400000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso) {
  const p = parts(iso);
  if (!p) return 0;
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

export function startOfMonth(iso) {
  const p = parts(iso);
  return p ? toISO(p.year, p.month, 1) : null;
}

export function endOfMonth(iso) {
  const p = parts(iso);
  return p ? toISO(p.year, p.month, daysInMonthOf(p.year, p.month)) : null;
}

/** 'YYYY-MM-DD' -> 'YYYY-MM'. Also passes a 'YYYY-MM' through unchanged. */
export function monthKey(iso) {
  if (typeof iso !== 'string') return null;
  if (/^\d{4}-\d{2}$/.test(iso)) return iso;
  const p = parts(iso);
  return p ? `${pad(p.year, 4)}-${pad(p.month)}` : null;
}

export function monthKeyParts(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}/.test(key)) return null;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return month >= 1 && month <= 12 ? { year, month } : null;
}

/** Shift a 'YYYY-MM' key by n months. */
export function addMonths(key, n) {
  const p = monthKeyParts(key);
  if (!p) return null;
  const total = p.year * 12 + (p.month - 1) + n;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}`;
}

/** Every date string in a month key, in order. */
export function datesInMonth(key) {
  const p = monthKeyParts(key);
  if (!p) return [];
  const n = daysInMonthOf(p.year, p.month);
  return Array.from({ length: n }, (_, i) => toISO(p.year, p.month, i + 1));
}

/**
 * Compare two date strings. ISO strings sort lexicographically in
 * chronological order, which is the whole reason for this format.
 */
export function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const isBefore = (a, b) => compare(a, b) < 0;
export const isAfter = (a, b) => compare(a, b) > 0;
export const isSameMonth = (a, b) => monthKey(a) === monthKey(b);

/** Clamp a date into [min, max]; either bound may be null. */
export function clampDate(iso, min, max) {
  if (min && isBefore(iso, min)) return min;
  if (max && isAfter(iso, max)) return max;
  return iso;
}

/* --- display helpers (still pure: strings in, strings out) --- */

export function formatDay(iso, { weekday = false } = {}) {
  const p = parts(iso);
  if (!p) return '';
  const base = `${p.day} ${MONTH_NAMES[p.month - 1]}`;
  return weekday ? `${WEEKDAY_NAMES[dayOfWeek(iso)]}, ${base}` : base;
}

export function formatMonth(key, { short = false } = {}) {
  const p = monthKeyParts(monthKey(key) ?? '');
  if (!p) return '';
  const name = MONTH_NAMES[p.month - 1];
  return `${short ? name.slice(0, 3) : name} ${p.year}`;
}

/** 'Today' / 'Yesterday' / '12 August' — for day headers in the ledger. */
export function formatRelativeDay(iso, todayISO) {
  if (iso === todayISO) return 'Today';
  if (iso === addDays(todayISO, -1)) return 'Yesterday';
  const p = parts(iso);
  const t = parts(todayISO);
  if (p && t && p.year !== t.year) return `${formatDay(iso)} ${p.year}`;
  return formatDay(iso);
}

/* ------------------------------------------------------------- periods */

/**
 * The view modes the period stepper offers. Everything downstream — filters,
 * analytics, budgets — consumes the {start, end} range these produce, never a
 * month key, so month-specific logic lives here and nowhere else.
 */
export const VIEW_MODES = Object.freeze([
  'daily', 'weekly', 'monthly', '3-month', '6-month', 'yearly',
]);

/** How many months one step of each mode moves. Null = not a month-based mode. */
const MONTH_SPAN = { monthly: 1, '3-month': 3, '6-month': 6, yearly: 12 };

const normaliseWeekStart = (n) => (Number.isInteger(n) ? ((n % 7) + 7) % 7 : 1);

/** Shift a date by whole months, clamping the day into the target month. */
export function addMonthsToDate(iso, n) {
  const p = parts(iso);
  if (!p) return null;
  const q = monthKeyParts(addMonths(monthKey(iso), n));
  return toISO(q.year, q.month, Math.min(p.day, daysInMonthOf(q.year, q.month)));
}

/** '11–17 August 2025' / '28 July – 3 August 2025' / across a year, both years. */
function spanLabel(start, end) {
  const a = parts(start);
  const b = parts(end);
  if (a.year !== b.year) return `${formatDay(start)} ${a.year} – ${formatDay(end)} ${b.year}`;
  if (a.month !== b.month) return `${formatDay(start)} – ${formatDay(end)} ${b.year}`;
  return `${a.day}–${b.day} ${MONTH_NAMES[b.month - 1]} ${b.year}`;
}

/** 'November 2025 – January 2026', collapsing a shared year to one mention. */
function monthSpanLabel(start, end) {
  const a = parts(start);
  const b = parts(end);
  if (a.year === b.year && a.month === b.month) return formatMonth(monthKey(start));
  const from = a.year === b.year
    ? MONTH_NAMES[a.month - 1]
    : `${MONTH_NAMES[a.month - 1]} ${a.year}`;
  return `${from} – ${MONTH_NAMES[b.month - 1]} ${b.year}`;
}

/**
 * The inclusive date range a view mode covers around an anchor day.
 *
 * Weekly honours `weekStartsOn` (0 = Sunday … 6 = Saturday). The multi-month
 * modes are *trailing* windows ending with the anchor's month — a 3-month view
 * anchored in January covers November to January, which is what makes a window
 * able to cross a year boundary at all. Yearly is the calendar year.
 *
 * @returns {{start: string, end: string, label: string}|null} null on bad input
 */
export function periodRange(viewMode, anchorDate, weekStartsOn = 1) {
  const p = parts(anchorDate);
  if (!p) return null;

  if (viewMode === 'daily') {
    return { start: anchorDate, end: anchorDate, label: `${formatDay(anchorDate)} ${p.year}` };
  }

  if (viewMode === 'weekly') {
    const wk = normaliseWeekStart(weekStartsOn);
    const start = addDays(anchorDate, -(((dayOfWeek(anchorDate) - wk) + 7) % 7));
    const end = addDays(start, 6);
    return { start, end, label: spanLabel(start, end) };
  }

  if (viewMode === 'yearly') {
    return { start: toISO(p.year, 1, 1), end: toISO(p.year, 12, 31), label: String(p.year) };
  }

  const span = MONTH_SPAN[viewMode];
  if (!span) return null;

  const endKey = monthKey(anchorDate);
  const startKey = addMonths(endKey, -(span - 1));
  const s = monthKeyParts(startKey);
  const e = monthKeyParts(endKey);
  const start = toISO(s.year, s.month, 1);
  const end = toISO(e.year, e.month, daysInMonthOf(e.year, e.month));
  return { start, end, label: monthSpanLabel(start, end) };
}

/** Move an anchor `n` whole periods. Negative goes back. */
export function stepAnchor(viewMode, anchorDate, n = 1) {
  if (!isValid(anchorDate)) return null;
  if (viewMode === 'daily') return addDays(anchorDate, n);
  if (viewMode === 'weekly') return addDays(anchorDate, n * 7);
  const span = MONTH_SPAN[viewMode];
  return span ? addMonthsToDate(anchorDate, n * span) : null;
}

/**
 * `count` consecutive ranges ending with the one containing `anchorDate`,
 * oldest first. This is the input to carry-over and to period comparison.
 */
export function periodsEndingAt(viewMode, anchorDate, count = 6, weekStartsOn = 1) {
  if (!isValid(anchorDate) || !Number.isInteger(count) || count < 1) return [];
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const anchor = stepAnchor(viewMode, anchorDate, -i);
    const range = anchor ? periodRange(viewMode, anchor, weekStartsOn) : null;
    if (range) out.push(range);
  }
  return out;
}

/**
 * Every 'YYYY-MM' key a range touches, in order.
 *
 * A budget is set per month and a period may be a day, a week or six months,
 * so this is the join between the two. A week straddling 31 July returns both
 * months; a yearly range returns twelve.
 */
export function monthsInRange(range) {
  if (!range || !isValid(range.start) || !isValid(range.end)) return [];
  if (compare(range.start, range.end) > 0) return [];
  const last = monthKey(range.end);
  const out = [];
  for (let key = monthKey(range.start); ; key = addMonths(key, 1)) {
    out.push(key);
    if (key === last) break;
  }
  return out;
}

/**
 * How many days of a month key fall inside an inclusive range.
 *
 * This is what makes a monthly budget mean something in a weekly view: the
 * week gets the share of the month it actually covers, rather than the whole
 * figure or nothing.
 */
export function daysOfMonthInRange(key, range) {
  const p = monthKeyParts(key);
  if (!p || !range) return 0;
  const first = toISO(p.year, p.month, 1);
  const last = toISO(p.year, p.month, daysInMonthOf(p.year, p.month));
  const start = compare(first, range.start) < 0 ? range.start : first;
  const end = compare(last, range.end) > 0 ? range.end : last;
  return compare(start, end) > 0 ? 0 : diffDays(start, end) + 1;
}

/** Whole days in an inclusive range. */
export function periodLength(range) {
  if (!range || !isValid(range.start) || !isValid(range.end)) return 0;
  return Math.max(0, diffDays(range.start, range.end) + 1);
}

/** Is a date inside an inclusive range? A null bound means unbounded. */
export function isInRange(iso, range) {
  if (!range) return true;
  if (range.start && iso < range.start) return false;
  if (range.end && iso > range.end) return false;
  return true;
}
